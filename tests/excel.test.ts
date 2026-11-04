import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { read, utils, write } from 'xlsx';
import { strToU8, zipSync } from 'fflate';
import { openWorkbook, readSheet, listSheets, writeWorkbook } from '../lib/excel';
import { importCsv, parseCsv } from '../lib/csv';

const file = 'messy-workbook.xlsx';
// Independent fixture (openpyxl): the table starts at B3, the IDs are numbers
// formatted with leading zeros, and Totals has a formula with no cached value.
const bytes = Uint8Array.from(readFileSync(new URL('../public/demo/' + file, import.meta.url))).buffer;
it('imports the selected range and displayed text, keeping original Excel row numbers', () => {
  const book = openWorkbook(bytes);
  expect(listSheets(book).map(s => [s.name, Boolean(s.problem)])).toEqual([['Orders',false],['Returns',false],['Totals',true]]);
  const draft = readSheet(book, file, 'Orders');
  expect(draft.records[0]).toEqual(['order_id','customer','country','ordered_on']);
  expect(draft.records[1]).toEqual(['0017','  Ada  ','USA','2026-11-02']);
  const data = importCsv(draft, true, draft.records[0]);
  expect(data.rows.map(r => r.sourceRow)).toEqual([4,5,6,7]);
  expect(data.rows[3].values.c2).toBe('');
  expect(importCsv(draft, false, draft.records[0]).rows[0].sourceRow).toBe(3);
  expect(() => readSheet(book, file, 'Totals')).toThrow(/formulas/);
  const onlyOrders = read(writeWorkbook(data));
  expect(onlyOrders.SheetNames).toEqual(['Orders']);
  expect(onlyOrders.Sheets.Orders.A2).toMatchObject({ t: 's', v: '0017' });
});

it('does not silently flatten merged/error sheets, or reveal hidden worksheets', () => {
  const book = utils.book_new();
  const merged = utils.aoa_to_sheet([['one','two']]); merged['!merges'] = [utils.decode_range('A1:B1')];
  utils.book_append_sheet(book, merged, 'Merged');
  utils.book_append_sheet(book, { A1: { t: 'e', v: 7 }, '!ref': 'A1' }, 'Errors');
  utils.book_append_sheet(book, utils.aoa_to_sheet([]), 'Empty');
  utils.book_append_sheet(book, utils.aoa_to_sheet([['secret']]), 'Hidden');
  utils.book_set_sheet_visibility(book, 3, 2);
  const parsed = openWorkbook(write(book, { type: 'array', bookType: 'xlsx' }));
  expect(listSheets(parsed).map(s => s.name)).toEqual(['Merged','Errors','Empty']);
  for (const [name, reason] of [['Merged',/Unmerge/],['Errors',/error cells/],['Empty',/empty/],['Hidden',/visible/]] as const)
    expect(() => readSheet(parsed, file, name)).toThrow(reason);
});

it('blocks oversized sheets before materializing the rectangular grid', () => {
  const book = utils.book_new();
  const sheet = { A1: { t: 's', v: 'header' }, A5003: { t: 's', v: 'last' }, '!ref': 'A1:A5003' };
  utils.book_append_sheet(book, sheet, 'Tall');
  expect(() => readSheet(book, file, 'Tall')).toThrow(/5,000/);
});

it('exports text beginning with formula characters as literal Excel cells', () => {
  const data = parseCsv('id,value\n0007,=1+2\n0008,東京', 'a.csv');
  const book = read(writeWorkbook(data), { type: 'array' });
  expect(book.SheetNames).toEqual(['Cleaned data']);
  const sheet = book.Sheets['Cleaned data'];
  expect(sheet.B2).toMatchObject({ t: 's', v: '=1+2' });
  expect(sheet.B2.f).toBeUndefined();
  expect(sheet.B3.v).toBe('東京');
  data.rows[0].values.c1 = 'x'.repeat(32768);
  expect(() => writeWorkbook(data)).toThrow(/Choose CSV/);
});

it('rejects disguised or over-limit archives instead of guessing a file type', () => {
  expect(() => openWorkbook(new TextEncoder().encode('id,name\n1,Ada').buffer)).toThrow(/readable/);
  expect(() => openWorkbook(Uint8Array.from(zipSync({ 'other.txt': strToU8('no workbook') })).buffer)).toThrow(/readable/);
  expect(() => openWorkbook(new ArrayBuffer(5 * 1024 ** 2 + 1))).toThrow(/5 MB/);
  const parts = Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [String(i), new Uint8Array()]));
  expect(() => openWorkbook(Uint8Array.from(zipSync(parts)).buffer)).toThrow(/unpacked/);
});
