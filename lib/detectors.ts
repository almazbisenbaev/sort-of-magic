import type { Dataset, RepairPatch } from './dataset';

export function detectRepairs(data: Dataset): RepairPatch[] {
  const base = { datasetId: data.id, datasetVersion: data.version };
  const whitespace: RepairPatch = { ...base, id: 'whitespace', title: 'Trim surrounding whitespace', edits: [], removedRows: [] };
  const duplicates: RepairPatch = { ...base, id: 'duplicates', title: 'Remove exact duplicate rows', edits: [], removedRows: [] };
  const seen = new Map<string, string>();
  data.rows.forEach((row, originalIndex) => {
    for (const column of data.columns) {
      const before = row.values[column.id];
      if (before !== before.trim()) whitespace.edits.push({ rowId: row.id, columnId: column.id, before, after: before.trim() });
    }
    const signature = JSON.stringify(data.columns.map(c => row.values[c.id]));
    const retainedRowId = seen.get(signature);
    if (retainedRowId !== undefined) duplicates.removedRows.push({ row, originalIndex, retainedRowId });
    else seen.set(signature, row.id);
  });
  return [whitespace, duplicates].filter(p => p.edits.length || p.removedRows.length);
}
