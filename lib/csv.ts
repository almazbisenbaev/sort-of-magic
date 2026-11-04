import Papa from 'papaparse';
import type { Dataset, ExcelSource } from './dataset';

export const LIMITS = { rows: 5000, columns: 50, bytes: 5 * 1024 * 1024 };
export const FORMULA_LIKE = /^(?:\s*[=+\-@]|[\t\r\n])/;

export type TableDraft = { source?: ExcelSource; name: string; records: string[][]; width: number };
export function inspectCsv(text: string, name: string): TableDraft {
  if (new TextEncoder().encode(text).length > LIMITS.bytes) throw new Error('File exceeds the 5 MB limit.');
  const input = text.replace(/^\uFEFF/, '');
  if (!input.trim()) throw new Error('This file is empty.');
  const parsed = Papa.parse<string[]>(input, { delimiter: ',', dynamicTyping: false, skipEmptyLines: false });
  if (parsed.errors.length) throw new Error(`CSV could not be read: ${parsed.errors[0].message}`);
  const records = parsed.data;
  if (/(?:\r\n|\r|\n)$/.test(input) && records.at(-1)?.length === 1 && records.at(-1)?.[0] === '') records.pop();
  const width = records.reduce((n, r) => Math.max(n, r.length), 0);
  if (width > LIMITS.columns) throw new Error('This phase supports at most 50 columns.');
  if (records.length > LIMITS.rows + 1) throw new Error('This phase supports at most 5,000 data rows.');
  return { name, records, width };
}
export function importCsv(draft: TableDraft, firstRowIsHeader: boolean, names: string[]): Dataset {
  if (names.length !== draft.width || names.some(h => !h.trim())) throw new Error('Every column needs a nonempty header.');
  if (new Set(names.map(h => h.trim())).size !== names.length) throw new Error('Column headers must be unique (ignoring surrounding spaces).');
  const records = firstRowIsHeader ? draft.records.slice(1) : draft.records;
  if (records.length > LIMITS.rows) throw new Error('This phase supports at most 5,000 data rows.');
  const columns = names.map((name, i) => ({ id: `c${i}`, name }));
  const rows = records.map((record, i) => {
    const values = record.length === 1 && record[0] === '' ? names.map(() => '') : record;
    const sourceRow = i + (draft.source?.firstRow ?? 1) + Number(firstRowIsHeader);
    if (values.length !== names.length) throw new Error(`Record ${sourceRow} has ${values.length} fields; expected ${names.length}. Check delimiters and quoting.`);
    return { id: `r${i}`, sourceRow, values: Object.fromEntries(columns.map((col, j) => [col.id, values[j]])) };
  });
  return { ...(draft.source ? { source: draft.source } : {}), id: crypto.randomUUID(), name: draft.name, version: 0, columns, rows };
}
export function parseCsv(text: string, name: string): Dataset {
  const draft = inspectCsv(text, name);
  return importCsv(draft, true, draft.records[0]);
}

export function formulaLikeCount(data: Dataset): number {
  return [...data.columns.map(c => c.name), ...data.rows.flatMap(r => data.columns.map(c => r.values[c.id]))]
    .filter(value => FORMULA_LIKE.test(value)).length;
}

export function exportCsv(data: Dataset, protectFormulas: boolean): string {
  const records = [data.columns.map(c => c.name), ...data.rows.map(r => data.columns.map(c => r.values[c.id]))];
  const output = protectFormulas ? records.map(row => row.map(value => FORMULA_LIKE.test(value) ? `'${value}` : value)) : records;
  return Papa.unparse(output, { newline: '\r\n', quotes: true });
}
