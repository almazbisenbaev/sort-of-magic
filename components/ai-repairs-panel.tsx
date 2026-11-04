'use client';
import WaitingCat from './waiting-cat';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset, RepairPatch } from '@/lib/dataset';
import { buildAiPatch, buildRepairContext } from '@/lib/ai-repairs';
import { AiResponseSchema, validateSuggestions, type RepairContext, type Suggestions } from '@/lib/schemas';

type Result = { context: RepairContext; suggestions: Suggestions; model: string };
export default function AiRepairsPanel({ data, disabled, onPreview, onBusyChange, onPendingChange }: { data: Dataset; disabled: boolean; onPreview: (patch: RepairPatch | null) => void; onBusyChange?: (busy: boolean) => void; onPendingChange?: (pending: boolean) => void }) {
  const [columnId, setColumnId] = useState(data.columns.find(c => /country|category/i.test(c.name))?.id ?? data.columns[0].id);
  const [guidance, setGuidance] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { onBusyChange?.(loading); }, [loading, onBusyChange]);
  useEffect(() => { onPendingChange?.(selected.length > 0); }, [selected, onPendingChange]);
  useEffect(() => () => { onBusyChange?.(false); onPendingChange?.(false); }, [onBusyChange, onPendingChange]);
  useEffect(() => {
    const statusController = new AbortController();
    fetch('/api/repairs', { signal: statusController.signal, cache: 'no-store' }).then(r => r.json()).then(r => setConfigured(r.configured === true)).catch(() => {});
    return () => { statusController.abort(); controller.current?.abort(); };
  }, []);
  const contextState = useMemo(() => {
    try { return { context: buildRepairContext(data, columnId, guidance), error: '' }; }
    catch (e) { return { context: null, error: e instanceof Error ? e.message : 'Choose another column.' }; }
  }, [data, columnId, guidance]);
  async function analyze() {
    if (!contextState.context) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timer = setTimeout(() => request.abort('timeout'), 50_000);
    setLoading(true); setError(''); setResult(null); setSelected([]); onPreview(null);
    try {
      const response = await fetch('/api/repairs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contextState.context), signal: request.signal });
      // Hosting rate limits can return HTML or plain text before our route runs.
      const body = await response.json().catch(() => null);
      if (response.status === 429) throw new Error(body?.error || 'Too many AI requests. Wait a minute, then try again. Your spreadsheet is unchanged.');
      if (!body) throw new Error('AI analysis is temporarily unavailable. Nothing changed; please try again.');
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'AI analysis failed. Please retry.');
      const parsed = AiResponseSchema.parse(body);
      const suggestions = validateSuggestions(parsed.suggestions, contextState.context);
      if (request.signal.aborted) return;
      setConfigured(true);
      setResult({ context: contextState.context, suggestions, model: parsed.model });
      // No mapping is approved automatically.
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Analysis failed. Nothing changed.');
      else if (request.signal.reason === 'timeout') setError('Analysis timed out. Nothing changed; retry manually.');
    } finally {
      clearTimeout(timer);
      if (controller.current === request && (!request.signal.aborted || request.signal.reason === 'timeout')) setLoading(false);
    }
  }
  function cancel() { controller.current?.abort(); controller.current = null; setLoading(false); setError('Analysis cancelled. No changes were made.'); }
  function preview() {
    if (!result) return;
    try { onPreview(buildAiPatch(data, columnId, result.context, result.suggestions, selected)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not build preview.'); }
  }
  return <section aria-label="Meta AI category repair">
    <h2>Choose a column to check</h2>
    <p>Country names, product categories, and status labels work well. You’ll choose which suggestions to use.</p>
    {configured === false && <p className="notice-box">AI suggestions are currently unavailable. You can continue to download with the changes you’ve already made.</p>}
    <div className="ai-input-row"><label>Category column<select aria-label="Category column" value={columnId} disabled={loading || disabled} onChange={e => { setColumnId(e.target.value); setResult(null); setSelected([]); setError(''); onPreview(null); }}>{data.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <button className="primary" disabled={loading || disabled || !contextState.context} onClick={analyze}>{loading ? 'Analyzing…' : error ? 'Retry analysis with Meta' : 'Analyze with Meta'}</button>{loading && <button onClick={cancel}>Cancel analysis</button>}</div>
    <details className="ai-guidance"><summary>Add instructions (optional)</summary><label><span className="sr-only">Optional cleanup guidance</span><textarea aria-label="Optional cleanup guidance" maxLength={1000} rows={2} value={guidance} disabled={loading || disabled} placeholder="For example: prefer full country names." onChange={e => { setGuidance(e.target.value); setResult(null); setSelected([]); setError(''); onPreview(null); }} /></label></details>
    <p className="notice">Analyze sends this column’s distinct nonempty values, counts, name, and any instructions to Meta. Other columns and your filename stay in your browser.</p>
    {contextState.error && <p>{contextState.error}</p>}
    {contextState.context && <details><summary>Review data to send ({contextState.context.values.length} distinct values)</summary><div className="table-scroll"><table><thead><tr><th>Value</th><th>Count</th></tr></thead><tbody>{contextState.context.values.map(v => <tr key={v.value}><td><code>{JSON.stringify(v.value)}</code></td><td>{v.count}</td></tr>)}</tbody></table></div></details>}
    <p role="status" aria-live="polite">{(loading) && <WaitingCat />}{loading ? 'Finding matching labels. Your spreadsheet is unchanged.' : result ? `${result.suggestions.mappings.length} suggestions ready to review. Nothing has been applied.` : ''}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <>
      <h3>Suggested mappings</h3>
      {!result.suggestions.mappings.length && <p>No clear label changes were found. You can try another column or continue to download.</p>}
      {!!result.suggestions.mappings.length && <>
        <p>Select the suggestions you want, then preview the exact changes.</p>
        <div className="table-scroll"><table><thead><tr><th>Use</th><th>Current label</th><th>Use instead</th><th>Cells</th><th>Why</th></tr></thead><tbody>{result.suggestions.mappings.map(m => <tr key={m.from}>
          <td><input aria-label={`Use mapping ${m.from} to ${m.to}`} type="checkbox" checked={selected.includes(m.from)} disabled={disabled} onChange={e => { setSelected(e.target.checked ? [...selected, m.from] : selected.filter(v => v !== m.from)); onPreview(null); }} /></td>
          <td><code>{JSON.stringify(m.from)}</code></td><td><code>{JSON.stringify(m.to)}</code></td><td>{result.context.values.find(v => v.value === m.from)?.count}</td><td>{m.reason}</td>
        </tr>)}</tbody></table></div>
        <button className="primary" disabled={!selected.length || disabled} onClick={preview}>Preview selected AI repairs</button>
      </>}
      {!!result.suggestions.ambiguities.length && <><h3>Needs your judgment — no changes proposed</h3><ul>{result.suggestions.ambiguities.map((a, i) => <li key={i}><code>{JSON.stringify(a.values)}</code>: {a.reason}</li>)}</ul></>}
      <p className="notice">AI can make mistakes. Review suggestions before applying them. Changing your data clears the suggestions so you can check again.</p>
    </>}
  </section>;
}
