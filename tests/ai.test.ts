import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { parseCsv } from '../lib/csv';
import { buildAiPatch, buildRepairContext } from '../lib/ai-repairs';
import { validateSuggestions } from '../lib/schemas';
import { applyPatch, undoPatch } from '../lib/patches';
import { proposeRepairs } from '../lib/ai/meta';
import { GET, POST } from '../app/api/repairs/route';

const dataset = () => parseCsv('country,private\nUSA,secret1\nU.S.,secret2\nUnited States,secret3\nUSA,secret4\n,secret5', 'private.csv');
const ctx = () => buildRepairContext(dataset(), 'c0');
const suggestions = () => ({ mappings: [{ from: 'USA', to: 'United States', reason: 'Same country.' }, { from: 'U.S.', to: 'United States', reason: 'Same country abbreviation.' }], ambiguities: [] });
function configured() {
  vi.stubEnv('META_API_KEY', 'test-secret-not-real');
  vi.stubEnv('META_MODEL', 'test-meta-model');
  vi.stubEnv('META_API_BASE_URL', 'https://api.meta.ai/v1');
}
function providerResponse(content: unknown = suggestions(), finish = 'stop') {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }] }));
}
function request(body: unknown = ctx(), origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/repairs', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('AI context and reversible repairs', () => {
  it('sends only the selected column name and distinct nonempty values with counts', () => {
    expect(ctx()).toEqual({ columnName: 'country', values: [{ value: 'USA', count: 2 }, { value: 'U.S.', count: 1 }, { value: 'United States', count: 1 }] });
    expect(JSON.stringify(ctx())).not.toContain('secret');
  });
  it('bounds cardinality, value length, and minimum variation', () => {
    expect(() => buildRepairContext(parseCsv('a\n' + 'x'.repeat(201) + '\ny', 'x.csv'), 'c0')).toThrow('long text');
    expect(() => buildRepairContext(parseCsv('a\n' + Array.from({ length: 101 }, (_, i) => `v${i}`).join('\n'), 'x.csv'), 'c0')).toThrow('100 distinct');
    expect(() => buildRepairContext(parseCsv('a\nx\nx', 'x.csv'), 'c0')).toThrow('at least two');
  });
  it('applies only approved mappings and supports exact undo', () => {
    const data = dataset();
    const patch = buildAiPatch(data, 'c0', ctx(), suggestions(), ['USA']);
    expect(patch.edits).toHaveLength(2);
    const result = applyPatch(data, patch);
    expect(result.dataset.rows.map(r => r.values.c0)).toEqual(['United States', 'U.S.', 'United States', 'United States', '']);
    expect(undoPatch(result.dataset, result.undo).rows).toEqual(data.rows);
    expect(() => buildAiPatch(data, 'c0', ctx(), suggestions(), [])).toThrow('Select at least');
  });
  it.each([
    { mappings: [{ from: 'unknown', to: 'USA', reason: 'bad' }], ambiguities: [] },
    { mappings: [{ from: 'USA', to: 'invented', reason: 'bad' }], ambiguities: [] },
    { mappings: [{ from: 'USA', to: 'USA', reason: 'bad' }], ambiguities: [] },
    { mappings: [{ from: 'USA', to: 'U.S.', reason: 'bad' }, { from: 'U.S.', to: 'USA', reason: 'cycle' }], ambiguities: [] },
    { mappings: [{ from: 'USA', to: 'U.S.', reason: 'bad' }, { from: 'U.S.', to: 'United States', reason: 'chain' }], ambiguities: [] },
    { ...suggestions(), ambiguities: [{ values: ['USA'], reason: 'unclear' }] },
    { mappings: [], ambiguities: [{ values: ['unknown'], reason: 'bad' }] },
    { ...suggestions(), extra: 'not allowed' },
  ])('rejects unsafe/inconsistent output %#', bad => expect(() => validateSuggestions(bad, ctx())).toThrow());
  it('rejects stale context and stale patches', () => {
    const data = dataset();
    const patch = buildAiPatch(data, 'c0', ctx(), suggestions(), ['USA']);
    const result = applyPatch(data, patch);
    expect(() => buildAiPatch(result.dataset, 'c0', ctx(), suggestions(), ['USA'])).toThrow('changed');
    expect(() => applyPatch(result.dataset, patch)).toThrow('out of date');
  });
  it('allows an honest empty result or ambiguity-only response', () => {
    expect(validateSuggestions({ mappings: [], ambiguities: [] }, ctx()).mappings).toEqual([]);
    expect(validateSuggestions({ mappings: [], ambiguities: [{ values: ['USA'], reason: 'Needs review' }] }, ctx()).ambiguities).toHaveLength(1);
  });
});

describe('server adapter and route (mocked provider, no real AI calls)', () => {
  it('reports missing configuration without exposing a key or calling a provider', async () => {
    vi.stubEnv('META_API_KEY', ''); vi.stubEnv('META_MODEL', '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await (await GET()).json()).toEqual({ configured: false });
    const response = await POST(request());
    expect(response.status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });
  it('uses server credentials and returns validated suggestions', async () => {
    configured();
    const fetch = vi.fn().mockResolvedValue(providerResponse()); vi.stubGlobal('fetch', fetch);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.suggestions).toEqual(suggestions());
    const [endpoint, init] = fetch.mock.calls[0];
    expect(endpoint).toBe('https://api.meta.ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-secret-not-real');
    const body = JSON.parse(init.body);
    expect(JSON.parse(body.messages[1].content)).toEqual(ctx());
    expect(body.messages[0].content).toContain('UNTRUSTED DATA');
    expect(body.max_completion_tokens).toBe(4096);
    expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(JSON.stringify(await (await GET()).json())).not.toContain('test-secret');
  });
  it.each([401, 403, 402, 429, 500])('sanitizes upstream error %s without retrying', async status => {
    configured();
    const fetch = vi.fn().mockResolvedValue(new Response('secret provider body', { status })); vi.stubGlobal('fetch', fetch);
    const response = await POST(request());
    expect(response.status).toBe(status === 429 ? 429 : 502);
    expect(await response.text()).not.toContain('secret provider body'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([providerResponse({ mappings: [{ from: 'alien', to: 'USA', reason: 'bad' }], ambiguities: [] }), providerResponse(suggestions(), 'length'), new Response('not json')])('rejects invalid provider output %#', async response => {
    configured(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect((await POST(request())).status).toBe(502);
  });
  it('rejects invalid and oversized requests before calling the provider', async () => {
    configured(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await POST(request({ ...ctx(), filename: 'must not send' }))).status).toBe(400);
    expect((await POST(request({ values: 'x'.repeat(33_000) }))).status).toBe(413);
    expect((await POST(request(ctx(), 'https://unrelated.example'))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts the browser host when Next normalizes the internal request URL', async () => {
    vi.stubEnv('META_API_KEY', '');
    const req = request();
    req.headers.set('host', '127.0.0.1:3000');
    req.headers.set('origin', 'http://127.0.0.1:3000');
    expect((await POST(req)).status).toBe(503); // Reached configuration, not the origin rejection.
  });
  it('bounds provider response size', async () => {
    configured(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(128_001))));
    expect((await POST(request())).status).toBe(502);
  });
  it('does not follow redirects and requires an HTTPS base URL', async () => {
    configured(); vi.stubEnv('META_API_BASE_URL', 'http://insecure.example/v1');
    expect((await POST(request())).status).toBe(503);
  });
  it('handles network failures without leaking errors', async () => {
    configured(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test-secret-not-real')));
    const response = await POST(request());
    expect(response.status).toBe(502); expect(await response.text()).not.toContain('test-secret');
  });
  it('propagates cancellation', async () => {
    configured(); const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))));
    const pending = proposeRepairs(ctx(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 499 });
  });
});
