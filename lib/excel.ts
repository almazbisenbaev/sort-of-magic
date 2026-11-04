import { read, utils, write, type Range, type WorkBook, type WorkSheet } from 'xlsx';
import { unzipSync } from 'fflate';
import { LIMITS, type TableDraft } from './csv';
import type { Dataset } from './dataset';

export type SheetInfo = { name: string; problem?: string };
const INVALID = 'This file isn’t a readable .xlsx workbook. Open it in Excel and save an unencrypted .xlsx copy.';

export function openWorkbook(bytes: ArrayBuffer): WorkBook {
  if (bytes.byteLength > LIMITS.bytes) throw new Error('File exceeds the 5 MB limit.');
  // Check archive metadata before handing any XML to the workbook parser.
  const parts = new Set<string>();
  let expanded = 0, entries = 0, tooLarge = false;
  try {
    unzipSync(new Uint8Array(bytes), { filter(entry) {
      expanded += entry.originalSize;
      if (++entries > 1024 || expanded > 32 * 1024 ** 2) { tooLarge = true; throw Error(); }
      parts.add(entry.name);
      return false;
    } });
  } catch { throw new Error(tooLarge ? 'This workbook is too large when unpacked. Save the sheet in a smaller file.' : INVALID); }
  if (!parts.has('[Content_Types].xml') || !parts.has('xl/workbook.xml') || parts.has('xl/vbaProject.bin')) throw new Error(INVALID);
  try {
    return read(bytes, { type: 'array', nodim: true, cellFormula: true, cellText: true, cellHTML: false, sheetStubs: true });
  } catch { throw new Error(INVALID); }
}

// Use occupied cells: some writers declare a range starting at A1 even when
// the actual table begins at B3, or include trailing rows with only styling.
function inspectSheet(sheet?: WorkSheet): { problem: string } | { range: Range } {
  if (!sheet || (sheet['!type'] && sheet['!type'] !== 'sheet')) return { problem: 'This tab is not a data worksheet.' };
  if (sheet['!merges']?.length) return { problem: 'Unmerge the cells in a copy of this sheet first.' };
  let range: Range | undefined, chars = 0;
  for (const key in sheet) {
    if (key.startsWith('!')) continue;
    const cell = sheet[key];
    if (cell.f !== undefined || cell.F || cell.D) return { problem: 'This sheet has formulas. Paste them as values in a copy first.' };
    if (cell.t === 'e') return { problem: 'Resolve the Excel error cells in a copy of this sheet first.' };
    if (cell.v == null || cell.t === 'z') continue;
    const pos = utils.decode_cell(key);
    if (!range) range = { s: { ...pos }, e: { ...pos } };
    else {
      range.s.r = Math.min(range.s.r, pos.r); range.e.r = Math.max(range.e.r, pos.r);
      range.s.c = Math.min(range.s.c, pos.c); range.e.c = Math.max(range.e.c, pos.c);
    }
    chars += (cell.w ?? String(cell.v)).length;
    if (chars > LIMITS.bytes) return { problem: 'This sheet contains too much text. Save a smaller selection.' };
  }
  if (!range) return { problem: 'This sheet is empty.' };
  if (range.e.c - range.s.c + 1 > LIMITS.columns || range.e.r - range.s.r + 1 > LIMITS.rows + 1)
    return { problem: 'Choose a sheet with up to 5,000 data rows and 50 columns.' };
  return { range };
}

export function listSheets(book: WorkBook): SheetInfo[] {
  const sheets = book.SheetNames.flatMap((name, i) => {
    if (book.Workbook?.Sheets?.[i]?.Hidden) return [];
    const info = inspectSheet(book.Sheets[name]);
    return [{ name, problem: 'problem' in info ? info.problem : undefined }];
  });
  if (!sheets.length) throw new Error('There are no visible worksheets in this workbook.');
  return sheets;
}

export function readSheet(book: WorkBook, fileName: string, sheetName: string): TableDraft {
  const index = book.SheetNames.indexOf(sheetName);
  if (index < 0 || book.Workbook?.Sheets?.[index]?.Hidden) throw new Error('Choose a visible worksheet.');
  const sheet = book.Sheets[sheetName];
  const info = inspectSheet(sheet);
  if ('problem' in info) throw new Error(info.problem);
  const { s, e } = info.range;
  const width = e.c - s.c + 1;
  const records = Array.from({ length: e.r - s.r + 1 }, (_, r) =>
    Array.from({ length: width }, (_, c) => {
      const cell = sheet[utils.encode_cell({ r: s.r + r, c: s.c + c })];
      return cell?.v == null ? '' : cell.w ?? utils.format_cell(cell);
    }));
  return { name: fileName, width, records, source: { sheetName, firstRow: s.r + 1 } };
}

export function writeWorkbook(data: Dataset): ArrayBuffer {
  const records = [data.columns.map(c => c.name), ...data.rows.map(row => data.columns.map(c => row.values[c.id]))];
  if (records.some(row => row.some(value => value.length > 32767))) throw new Error('A cell exceeds Excel’s text limit. Choose CSV to keep its full value.');
  const book = utils.book_new();
  // Every value is a string, including leading zeros and text beginning with "=".
  utils.book_append_sheet(book, utils.aoa_to_sheet(records), data.source?.sheetName ?? 'Cleaned data');
  return write(book, { type: 'array', bookType: 'xlsx', compression: true });
}
