import { listSheets, openWorkbook, readSheet, writeWorkbook } from './excel';
import type { ExcelTask } from './excel-client';

let book: ReturnType<typeof openWorkbook> | undefined;
self.onmessage = ({ data }: MessageEvent<ExcelTask>) => {
  try {
    if (data.type === 'open') {
      book = openWorkbook(data.bytes);
      self.postMessage({ value: listSheets(book) });
    } else if (data.type === 'read') {
      if (!book) throw new Error('Choose your workbook again.');
      self.postMessage({ value: readSheet(book, data.fileName, data.sheetName) });
    } else {
      const bytes = writeWorkbook(data.data);
      self.postMessage({ value: bytes }, { transfer: [bytes] });
    }
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not process the workbook.' }); }
};
