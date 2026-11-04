import { describe, expect, it } from 'vitest';
import { parseCsv } from '../lib/csv';
import { detectRepairs } from '../lib/detectors';
import { applyPatch } from '../lib/patches';
import { automaticIssueCount, buildCellStates } from '../lib/presentation';

describe('repair presentation', () => {
  it('prioritizes proposed cells and marks every cell of a removed row', () => {
    const data = parseCsv('name,code\n" Alice ",001\n" Alice ",001', 'x.csv');
    const repairs = detectRepairs(data);
    expect(automaticIssueCount(repairs)).toBe(3);
    const whitespace = repairs.find(p => p.id === 'whitespace')!;
    const states = buildCellStates(data, repairs, whitespace);
    expect(states(data.rows[0].id, 'c0')).toBe('proposed');
    expect(states(data.rows[1].id, 'c1')).toBe('issue');
    expect(states(data.rows[0].id, 'c1')).toBe(null);
    const duplicate = repairs.find(p => p.removedRows.length)!;
    expect(buildCellStates(data, repairs, duplicate)(data.rows[1].id, 'c1')).toBe('proposed');
  });
  it('highlights applied edits without marking unchanged IDs and clears them on undo', () => {
    const data = parseCsv('name,code\n" Alice ",001', 'x.csv');
    const patch = detectRepairs(data)[0];
    const next = applyPatch(data, patch).dataset;
    const states = buildCellStates(next, detectRepairs(next), null, { previous: data, title: patch.title, appliedVersion: next.version });
    expect(states(next.rows[0].id, 'c0')).toBe('applied');
    expect(states(next.rows[0].id, 'c1')).toBe(null);
    expect(automaticIssueCount(detectRepairs(next))).toBe(0);
    expect(buildCellStates(data, detectRepairs(data), null)(data.rows[0].id, 'c0')).toBe('issue');
  });
});
