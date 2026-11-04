import type { Dataset } from './dataset';
import type { TableDraft } from './csv';
import type { SheetInfo } from './excel';

export type ExcelTask = { type: 'open'; bytes: ArrayBuffer } | { type: 'read'; fileName: string; sheetName: string } | { type: 'write'; data: Dataset };

// One local worker per import/export. The parsed workbook stays off the UI thread.
export function excelSession() {
  const worker = new Worker(new URL('./excel-worker.ts', import.meta.url), { type: 'module' });
  function request<T>(task: ExcelTask): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Excel took too long to respond. Choose the file again or try a smaller sheet.')); }, 30000);
      worker.onmessage = ({ data }) => { clearTimeout(timer); if (data.error) reject(new Error(data.error)); else resolve(data.value); };
      worker.onerror = () => { clearTimeout(timer); reject(new Error('Could not open the Excel tool. Refresh the page and try again.')); };
      worker.postMessage(task, task.type === 'open' ? [task.bytes] : []);
    });
  }
  return {
    open: (bytes: ArrayBuffer) => request<SheetInfo[]>({ type: 'open', bytes }),
    read: (fileName: string, sheetName: string) => request<TableDraft>({ type: 'read', fileName, sheetName }),
    write: (data: Dataset) => request<ArrayBuffer>({ type: 'write', data }),
    close: () => worker.terminate(),
  };
}
