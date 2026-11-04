import type { Dataset, RepairPatch, UndoEntry } from './dataset';

export function applyPatch(data: Dataset, patch: RepairPatch): { dataset: Dataset; undo: UndoEntry } {
  if (patch.datasetId !== data.id || patch.datasetVersion !== data.version) throw new Error('This preview is out of date. Select the repair again.');
  if (!patch.edits.length && !patch.removedRows.length && !patch.headers?.length) throw new Error('This repair contains no changes.');
  const rows = new Map(data.rows.map(r => [r.id, r]));
  const columns = new Set(data.columns.map(c => c.id));
  const deleted = new Set<string>();
  for (const removal of patch.removedRows) {
    const current = data.rows[removal.originalIndex];
    if (deleted.has(removal.row.id) || current?.id !== removal.row.id || data.columns.some(c => current.values[c.id] !== removal.row.values[c.id])) {
      throw new Error('A row changed or a removal conflicts. Refresh the preview.');
    }
    if (removal.kind === 'empty') {
      if (data.columns.some(c => current.values[c.id].trim())) throw new Error('Only empty rows can be removed by this repair.');
    } else {
      const retained = removal.retainedRowId ? rows.get(removal.retainedRowId) : undefined;
      const keys = removal.kind === 'key' ? removal.keyColumnIds ?? [] : data.columns.map(c => c.id);
      if (!retained || retained.id === current.id || !keys.length || keys.some(k => !columns.has(k)) ||
        keys.some(k => current.values[k] !== retained.values[k]) ||
        (removal.kind === 'key' && keys.some(k => !current.values[k].trim()))) {
        throw new Error('A row changed or a removal conflicts. Refresh the preview.');
      }
    }
    deleted.add(removal.row.id);
  }
  if (patch.removedRows.some(r => r.retainedRowId !== undefined && deleted.has(r.retainedRowId))) throw new Error('A retained row cannot also be removed.');
  const edits = new Map<string, Map<string, string>>();
  for (const edit of patch.edits) {
    if (!rows.has(edit.rowId) || !columns.has(edit.columnId) || rows.get(edit.rowId)!.values[edit.columnId] !== edit.before || deleted.has(edit.rowId)) {
      throw new Error('A cell changed or an edit conflicts. Refresh the preview.');
    }
    const rowEdits = edits.get(edit.rowId) ?? new Map<string, string>();
    if (rowEdits.has(edit.columnId)) throw new Error('A repair cannot edit the same cell twice.');
    rowEdits.set(edit.columnId, edit.after);
    edits.set(edit.rowId, rowEdits);
  }
  const headerEdits = new Map<string, string>();
  for (const edit of patch.headers ?? []) {
    if (!columns.has(edit.columnId) || headerEdits.has(edit.columnId) || data.columns.find(c => c.id === edit.columnId)?.name !== edit.before || !edit.after.trim()) throw new Error('Invalid or conflicting header edit.');
    headerEdits.set(edit.columnId, edit.after);
  }
  const nextColumns = data.columns.map(c => headerEdits.has(c.id) ? { ...c, name: headerEdits.get(c.id)! } : c);
  if (new Set(nextColumns.map(c => c.name.trim())).size !== nextColumns.length) throw new Error('Headers must be unique.');
  const next: Dataset = {
    ...data, columns: nextColumns, version: data.version + 1,
    rows: data.rows.filter(r => !deleted.has(r.id)).map(r => edits.has(r.id) ? { ...r, values: { ...r.values, ...Object.fromEntries(edits.get(r.id)!) } } : r),
  };
  return { dataset: next, undo: { previous: data, appliedVersion: next.version, title: patch.title } };
}

export function undoPatch(data: Dataset, undo: UndoEntry): Dataset {
  if (data.id !== undo.previous.id || data.version !== undo.appliedVersion) throw new Error('This undo no longer matches the dataset.');
  return { ...undo.previous, version: data.version + 1 };
}
