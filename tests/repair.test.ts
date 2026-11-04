import { describe, expect, it } from 'vitest';
import { exportCsv, formulaLikeCount, parseCsv } from '../lib/csv';
import { detectRepairs } from '../lib/detectors';
import { applyPatch, undoPatch } from '../lib/patches';
const values = (d: ReturnType<typeof parseCsv>) => d.rows.map(r => d.columns.map(c => r.values[c.id]));

describe('CSV import and export', () => {
  it('round-trips commas, quotes, newlines, Unicode, leading zeros, and empty fields', () => {
    const data = parseCsv('id,note,name,optional\r\n0001,"a,b\n""quote""",Әлия,\r\n', 'test.csv');
    expect(values(data)).toEqual([['0001', 'a,b\n"quote"', 'Әлия', '']]);
    expect(values(parseCsv(exportCsv(data, false), 'roundtrip.csv'))).toEqual(values(data));
  });
  it('keeps actual empty records but not a trailing newline artifact', () => {
    expect(values(parseCsv('a,b\n1,2\n\n', 'x.csv'))).toEqual([['1', '2'], ['', '']]);
    expect(parseCsv('a,b\n', 'x.csv').rows).toHaveLength(0);
  });
  it('preserves a final empty single-column record on export', () => {
    const d = parseCsv('a\nvalue\n""', 'x.csv');
    expect(values(parseCsv(exportCsv(d, false), 'x.csv'))).toEqual([['value'], ['']]);
  });
  it('preserves headers and handles BOM and prototype-like names safely', () => {
    const d = parseCsv('\uFEFF__proto__, constructor \nx,y', 'x.csv');
    expect(d.columns.map(c => c.name)).toEqual(['__proto__', ' constructor ']);
    expect(values(d)).toEqual([['x', 'y']]);
  });
  it.each(['', 'a,\n1,2', 'a,a\n1,2', 'a, a\n1,2', 'a,b\n1,2,3', 'a,b\n1', 'a,b\n"unclosed,2'])('rejects invalid input %j', text => {
    expect(() => parseCsv(text, 'bad.csv')).toThrow();
  });
  it('enforces row, column, and byte limits', () => {
    expect(() => parseCsv('a\n' + Array(5001).fill('x').join('\n'), 'x.csv')).toThrow('5,000');
    expect(() => parseCsv(Array.from({ length: 51 }, (_, i) => `c${i}`).join(','), 'x.csv')).toThrow('50 columns');
    expect(() => parseCsv('a\n' + 'x'.repeat(5 * 1024 * 1024), 'x.csv')).toThrow('5 MB');
  });
  it('escapes formula-like headers and cells only when selected, without mutating data', () => {
    const d = parseCsv('=header,value\n001,  =SUM(A1)\n002,-10\n003,@ref', 'x.csv');
    expect(formulaLikeCount(d)).toBe(4);
    const safe = parseCsv(exportCsv(d, true), 'safe.csv');
    expect(safe.columns[0].name).toBe("'=header");
    expect(values(safe)[0][1]).toBe("'  =SUM(A1)");
    expect(values(parseCsv(exportCsv(d, false), 'raw.csv'))).toEqual(values(d));
    expect(values(d)[1][1]).toBe('-10');
  });
});

describe('repair lifecycle', () => {
  it('detects exact duplicates only and reveals new ones after trimming', () => {
    const d = parseCsv('id,name\n01, Alice \n01,Alice\n02,Bob\n02,Bob', 'x.csv');
    const repairs = detectRepairs(d);
    expect(repairs[0].edits).toHaveLength(1);
    expect(repairs[1].removedRows).toHaveLength(1);
    expect(repairs[1].removedRows[0].retainedRowId).toBe('r2');
    const result = applyPatch(d, repairs[0]);
    expect(detectRepairs(result.dataset)[0].removedRows).toHaveLength(2);
    expect(values(undoPatch(result.dataset, result.undo))).toEqual(values(d));
    expect(d.rows[0].values.c1).toBe(' Alice ');
  });
  it('removes multiple duplicate rows and restores exact positions and IDs', () => {
    const d = parseCsv('a\nx\ny\nx\nz\ny\nx', 'x.csv');
    const result = applyPatch(d, detectRepairs(d)[0]);
    expect(values(result.dataset)).toEqual([['x'], ['y'], ['z']]);
    const restored = undoPatch(result.dataset, result.undo);
    expect(restored.rows).toEqual(d.rows);
    expect(restored.version).toBe(2);
  });
  it('rejects stale previews, including after undo or replacement with another file', () => {
    const d = parseCsv('a\n x ', 'x.csv');
    const patch = detectRepairs(d)[0];
    const result = applyPatch(d, patch);
    expect(() => applyPatch(result.dataset, patch)).toThrow('out of date');
    expect(() => applyPatch(undoPatch(result.dataset, result.undo), patch)).toThrow('out of date');
    expect(() => applyPatch(parseCsv('a\n x ', 'x.csv'), patch)).toThrow('out of date');
    expect(() => undoPatch(undoPatch(result.dataset, result.undo), result.undo)).toThrow();
  });
  it('validates every edit before making any change', () => {
    const d = parseCsv('a,b\n x , y ', 'x.csv');
    const patch = detectRepairs(d)[0];
    patch.edits[1].before = 'incorrect';
    expect(() => applyPatch(d, patch)).toThrow('cell changed');
    expect(values(d)).toEqual([[' x ', ' y ']]);
  });
  it('rejects duplicate edits, unknown columns, and removal conflicts', () => {
    const d = parseCsv('a\n x \n x ', 'x.csv');
    const [trim, remove] = detectRepairs(d);
    expect(() => applyPatch(d, { ...trim, edits: [...trim.edits, trim.edits[0]] })).toThrow('same cell twice');
    expect(() => applyPatch(d, { ...trim, edits: [{ ...trim.edits[0], columnId: 'missing' }] })).toThrow();
    expect(() => applyPatch(d, { ...remove, edits: trim.edits })).toThrow();
    expect(() => applyPatch(d, { ...remove, removedRows: [{ ...remove.removedRows[0], originalIndex: 0 }] })).toThrow();
  });
  it('targets stable row IDs even if the current data is reordered', () => {
    const d = parseCsv('a\n x \ny', 'x.csv');
    const patch = detectRepairs(d)[0];
    const reordered = { ...d, rows: [...d.rows].reverse() };
    expect(values(applyPatch(reordered, patch).dataset)).toEqual([['y'], ['x']]);
  });
});
