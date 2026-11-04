// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AiRepairsPanel from '../components/ai-repairs-panel';
import { parseCsv } from '../lib/csv';
const data = () => parseCsv('country,category\nUSA,Home\nUnited States,Office\nU.S.,Home', 'demo.csv');
const response = { model: 'test-model', suggestions: { mappings: [{ from: 'USA', to: 'United States', reason: 'Same country' }], ambiguities: [] } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('requires a mapping selection, previews only that selection, and clears preview when deselected', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockResolvedValueOnce(Response.json(response)));
  const preview = vi.fn();
  render(<AiRepairsPanel data={data()} disabled={false} onPreview={preview} />);
  fireEvent.click(screen.getByRole('button', { name: 'Analyze with Meta' }));
  await screen.findByText('Suggested mappings');
  const button = screen.getByRole('button', { name: 'Preview selected AI repairs' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use mapping USA to United States' }));
  fireEvent.click(button);
  expect(preview.mock.calls.at(-1)?.[0].edits).toEqual([{ rowId: 'r0', columnId: 'c0', before: 'USA', after: 'United States' }]);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use mapping USA to United States' }));
  expect(preview.mock.calls.at(-1)?.[0]).toBeNull();
});
it('shows configuration failure with a manual retry and makes no repair', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ configured: false })).mockResolvedValueOnce(Response.json({ error: 'Meta is not connected.' }, { status: 503 })));
  const preview = vi.fn();
  render(<AiRepairsPanel data={data()} disabled={false} onPreview={preview} />);
  fireEvent.click(screen.getByRole('button', { name: 'Analyze with Meta' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Meta is not connected.');
  expect(screen.getByRole('button', { name: 'Retry analysis with Meta' })).toBeTruthy();
  expect(preview.mock.calls.every(call => call[0] === null)).toBe(true);
});
it('clears prior results on column changes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockResolvedValueOnce(Response.json(response)));
  const preview = vi.fn();
  render(<AiRepairsPanel data={data()} disabled={false} onPreview={preview} />);
  fireEvent.click(screen.getByRole('button', { name: 'Analyze with Meta' }));
  await screen.findByText('Suggested mappings');
  fireEvent.change(screen.getByRole('combobox', { name: 'Category column' }), { target: { value: 'c1' } });
  expect(screen.queryByText('Suggested mappings')).toBeNull();
  expect(preview.mock.calls.at(-1)?.[0]).toBeNull();
});
it('handles a hosting rate limit without requiring JSON or changing the spreadsheet', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockResolvedValueOnce(new Response('<html>Too many requests</html>', { status: 429 })));
  const preview = vi.fn();
  render(<AiRepairsPanel data={data()} disabled={false} onPreview={preview} />);
  fireEvent.click(screen.getByRole('button', { name: 'Analyze with Meta' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Wait a minute');
  expect(screen.getByRole('button', { name: 'Retry analysis with Meta' })).toBeTruthy();
  expect(preview.mock.calls.every(call => call[0] === null)).toBe(true);
});
it('cancels an in-flight call and ignores its late response', async () => {
  let resolve!: (r: Response) => void;
  const pending = new Promise<Response>(r => { resolve = r; });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ configured: true })).mockReturnValueOnce(pending));
  render(<AiRepairsPanel data={data()} disabled={false} onPreview={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Analyze with Meta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel analysis' }));
  resolve(Response.json(response));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cancelled'));
  expect(screen.queryByText('Suggested mappings')).toBeNull();
});
