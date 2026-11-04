// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import RepairWorkspace from '../components/repair-workspace';

// Exercise the real import, repair, AI, and navigation code; the grid renderer is
// covered in browser checks and does not participate in wizard navigation.
vi.mock('ag-grid-react', () => ({ AgGridReact: () => null }));
const csv = 'id,country,name\n001,USA," Alice "\n002,United States,Bob\n002,United States,Bob\n003,U.S.,Chen';
const aiResult = { model: 'test-model', suggestions: { mappings: [{ from: 'USA', to: 'United States', reason: 'Same country.' }], ambiguities: [] } };
let exported: Blob | undefined;
let exportName: string;
beforeEach(() => {
  exported = undefined; exportName = '';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => Promise.resolve(url === '/demo/messy-orders.csv' ? new Response(csv) : Response.json(init?.method === 'POST' ? aiResult : { configured: true }))));
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { exportName = this.download; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
async function importSample() {
  click('Try a sample CSV →');
  await screen.findByRole('heading', { name: 'Check your columns' });
  click('Continue to cleanup →');
}
function readExport() {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(exported!);
  });
}

it('guides preview, apply, AI, undo, and export while preserving exact data between steps', async () => {
  render(<RepairWorkspace />);
  expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true);
  await importSample();
  click('Review Trim surrounding whitespace');
  expect((screen.getByRole('button', { name: 'Continue to AI labels →' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '← Back' }) as HTMLButtonElement).disabled).toBe(true);
  click('Apply 1 change');
  click('Review Remove exact duplicate rows');
  click('Apply 1 change');
  click('Continue to AI labels →');
  click('Analyze with Meta');
  await screen.findByText('Suggested mappings');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use mapping USA to United States' }));
  click('Preview selected AI repairs');
  click('Cancel preview');
  expect((screen.getByRole('checkbox', { name: 'Use mapping USA to United States' }) as HTMLInputElement).checked).toBe(true);
  click('Preview selected AI repairs');
  click('Apply 1 change');
  click('Continue to download →');
  expect(screen.getAllByRole('definition').map(node => node.textContent)).toEqual(['2', '1', '3']);
  click('↶ Undo last change');
  expect(screen.getAllByRole('definition').map(node => node.textContent)).toEqual(['1', '1', '3']);
  click('Download CSV ↓');
  expect(exportName).toBe('messy-orders-repaired.csv');
  expect(await readExport()).toBe('"id","country","name"\r\n"001","USA","Alice"\r\n"002","United States","Bob"\r\n"003","U.S.","Chen"');
});

it('lets people skip AI and remaining fixes without implying they were applied', async () => {
  render(<RepairWorkspace />); await importSample();
  click('Continue to AI labels →'); click('Continue to download →');
  expect(screen.getAllByRole('definition').map(node => node.textContent)).toEqual(['0', '0', '4']);
  expect(screen.getByText(/2 quick-check findings were left unchanged/)).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  click('Download CSV ↓');
  expect(exportName).toBe('messy-orders-export.csv');
  expect(await readExport()).toContain('"001","USA"," Alice "');
  expect((await readExport()).match(/"002"/g)).toHaveLength(2);
});

it('preserves selected AI suggestions on back/next without silently including them in the download', async () => {
  render(<RepairWorkspace />); await importSample(); click('Continue to AI labels →'); click('Analyze with Meta');
  await screen.findByText('Suggested mappings');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Use mapping USA to United States' }));
  click('Continue without selected suggestions →');
  expect(screen.getByText(/Your selected AI suggestions haven’t been applied/)).toBeTruthy();
  click('← Back');
  expect((screen.getByRole('checkbox', { name: 'Use mapping USA to United States' }) as HTMLInputElement).checked).toBe(true);
  click('Continue without selected suggestions →'); click('Download CSV ↓');
  expect(await readExport()).toContain('"001","USA"," Alice "');
});

it('holds navigation during an AI request and unlocks it when analysis is cancelled', async () => {
  render(<RepairWorkspace />); await importSample(); click('Continue to AI labels →');
  vi.mocked(fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
  click('Analyze with Meta');
  expect((screen.getByRole('button', { name: 'Continue to download →' }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(screen.getByRole('navigation')).getByRole('button', { name: 'Clean up' }) as HTMLButtonElement).disabled).toBe(true);
  click('Cancel analysis');
  expect((screen.getByRole('button', { name: 'Continue to download →' }) as HTMLButtonElement).disabled).toBe(false);
  click('Continue to download →');
  expect(screen.getByRole('heading', { name: 'Review and download' })).toBeTruthy();
});

it('keeps applied repairs when revisiting upload or cancelling a replacement', async () => {
  render(<RepairWorkspace />); await importSample();
  click('Review Trim surrounding whitespace'); click('Apply 1 change'); click('← Back');
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  click('Try a sample CSV →');
  expect(screen.getByText('Your changes are still here.')).toBeTruthy();
  click('Continue with this file →');
  expect(screen.queryByRole('button', { name: 'Review Trim surrounding whitespace' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Review Remove exact duplicate rows' })).toBeTruthy();
});
