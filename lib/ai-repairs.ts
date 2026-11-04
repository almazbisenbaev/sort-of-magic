import type { Dataset, RepairPatch } from './dataset';
import { AI_LIMITS, RepairContextSchema, validateSuggestions, type RepairContext, type Suggestions } from './schemas';

export function buildRepairContext(data: Dataset, columnId: string, guidance = ''): RepairContext {
  const col = data.columns.find(c => c.id === columnId);
  if (!col) throw new Error('Select a column.');
  const counts = new Map<string, number>();
  for (const row of data.rows) {
    const v = row.values[columnId];
    if (!v.trim()) continue; // Never fill missing values.
    if (v.length > AI_LIMITS.valueLength) throw new Error('This column contains long text. Select a category column with values up to 200 characters.');
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size < 2) throw new Error('Choose a column with at least two distinct nonempty values.');
  if (counts.size > AI_LIMITS.values) throw new Error('Select a category column with no more than 100 distinct nonempty values.');
  if (col.name.length > 200) throw new Error('This column name is too long for AI analysis (maximum 200 characters).');
  const context = RepairContextSchema.parse({ ...(guidance.trim() ? { guidance: guidance.trim() } : {}), columnName: col.name, values: [...counts].map(([value, count]) => ({ value, count })) });
  if (new TextEncoder().encode(JSON.stringify(context)).length > AI_LIMITS.requestBytes) throw new Error('This column is too large for one AI request. Select a smaller category column.');
  return context;
}

export function buildAiPatch(data: Dataset, columnId: string, context: RepairContext, raw: Suggestions, selected: string[]): RepairPatch {
  const current = buildRepairContext(data, columnId, context.guidance);
  if (JSON.stringify(current) !== JSON.stringify(context)) throw new Error('The column has changed. Analyze it again.');
  const suggestions = validateSuggestions(raw, context);
  const selection = new Set(selected);
  if (selection.size !== selected.length || selected.some(v => !suggestions.mappings.some(m => m.from === v))) throw new Error('Invalid mapping selection.');
  const mappings = new Map(suggestions.mappings.filter(m => selection.has(m.from)).map(m => [m.from, m.to]));
  const edits = data.rows.flatMap(row => {
    const before = row.values[columnId];
    const after = mappings.get(before);
    return after === undefined ? [] : [{ rowId: row.id, columnId, before, after }];
  });
  if (!edits.length) throw new Error('Select at least one mapping to preview.');
  return { id: `ai-${columnId}`, datasetId: data.id, datasetVersion: data.version, title: `Normalize ${current.columnName} with Meta suggestions`, edits, removedRows: [] };
}
