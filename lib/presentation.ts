import type { Dataset, RepairPatch, UndoEntry } from './dataset';
export type CellState = 'issue' | 'proposed' | 'applied' | null;
export function buildCellStates(data: Dataset, repairs: RepairPatch[], preview: RepairPatch | null, last?: UndoEntry) {
  const issues = new Set<string>(), proposed = new Set<string>(), applied = new Set<string>();
  const key = (row: string, column: string) => `${row}:${column}`;
  for (const p of repairs) {
    for (const e of p.edits) issues.add(key(e.rowId, e.columnId));
    for (const r of p.removedRows) for (const c of data.columns) issues.add(key(r.row.id, c.id));
  }
  if (preview) {
    for (const e of preview.edits) proposed.add(key(e.rowId, e.columnId));
    for (const r of preview.removedRows) for (const c of data.columns) proposed.add(key(r.row.id, c.id));
  }
  if (last) {
    const before = new Map(last.previous.rows.map(r => [r.id, r]));
    for (const row of data.rows) for (const col of data.columns) {
      if (before.has(row.id) && before.get(row.id)!.values[col.id] !== row.values[col.id]) applied.add(key(row.id, col.id));
    }
  }
  return (row: string, column: string): CellState => {
    const id = key(row, column);
    return proposed.has(id) ? 'proposed' : issues.has(id) ? 'issue' : applied.has(id) ? 'applied' : null;
  };
}
export function automaticIssueCount(repairs: RepairPatch[]) { return repairs.reduce((n, p) => n + p.edits.length + p.removedRows.length, 0); }
