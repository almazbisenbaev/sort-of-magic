import type { Dataset, RepairPatch, Row } from './dataset';
export function emptyPatch(data: Dataset, title: string): RepairPatch {
  return { id: title, datasetId: data.id, datasetVersion: data.version, title, edits: [], removedRows: [] };
}
export function emptyRowsPatch(data: Dataset): RepairPatch {
  const patch = emptyPatch(data, 'Remove empty rows');
  data.rows.forEach((row, originalIndex) => {
    if (data.columns.every(c => !row.values[c.id].trim())) patch.removedRows.push({ row, originalIndex, kind: 'empty' });
  });
  return patch;
}
export function missingValues(data: Dataset, required: string[]) {
  return data.rows.flatMap(row => required.filter(id => data.columns.some(c => c.id === id) && !row.values[id].trim()).map(columnId => ({ rowId: row.id, sourceRow: row.sourceRow, columnId })));
}
export function duplicateGroups(data: Dataset, keys: string[]): Row[][] {
  if (!keys.length || keys.some(id => !data.columns.some(c => c.id === id))) return [];
  const groups = new Map<string, Row[]>();
  for (const row of data.rows) {
    if (keys.some(k => !row.values[k].trim())) continue; // A missing key is not proof of identity.
    const signature = JSON.stringify(keys.map(k => row.values[k]));
    const group = groups.get(signature);
    if (group) group.push(row); else groups.set(signature, [row]);
  }
  return [...groups.values()].filter(g => g.length > 1);
}
export function keyDuplicatesPatch(data: Dataset, keys: string[], retained: Record<string, string>): RepairPatch {
  const patch = emptyPatch(data, 'Remove duplicates on selected keys');
  const index = new Map(data.rows.map((r, i) => [r.id, i]));
  for (const group of duplicateGroups(data, keys)) {
    const keepId = retained[group[0].id];
    if (!keepId) continue; // Group not selected for removal.
    if (!group.some(r => r.id === keepId)) throw new Error('Choose a retained record from its duplicate group.');
    for (const row of group) if (row.id !== keepId) patch.removedRows.push({ row, originalIndex: index.get(row.id)!, retainedRowId: keepId, kind: 'key', keyColumnIds: [...keys] });
  }
  return patch;
}

type Normalized = { value: string; issue?: never } | { value?: never; issue: string };
export type DateConvention = 'auto' | 'dmy' | 'mdy';
export type NumberConvention = 'auto' | 'dot' | 'comma';
function validDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function normalizeDate(raw: string, convention: DateConvention): Normalized {
  const text = raw.trim();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(text);
  const other = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(text);
  if (iso) { year = +iso[1]; month = +iso[3]; day = +iso[4]; }
  else if (other) {
    year = +other[4]; const a = +other[1], b = +other[3];
    const dmy = validDate(year, b, a), mdy = validDate(year, a, b);
    if (!dmy && !mdy) return { issue: 'Invalid calendar date.' };
    if (dmy && mdy && a !== b && convention === 'auto') return { issue: 'Ambiguous day/month order. Choose a convention.' };
    const dayFirst = dmy && (!mdy || convention !== 'mdy');
    day = dayFirst ? a : b; month = dayFirst ? b : a;
  } else return { issue: 'Unsupported date. Use numeric dates with a four-digit year (no time component).' };
  if (!validDate(year, month, day)) return { issue: 'Invalid calendar date.' };
  return { value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}
export function normalizeNumber(raw: string, convention: NumberConvention): Normalized {
  const text = raw.trim();
  // Keep an existing currency token in its original prefix/suffix position. Never change currencies.
  const match = /^([+-]?)([$€£¥]|[A-Z]{3})?\s*([+-]?)(\d[\d., \u00a0\u202f]*)(?:\s*([$€£¥]|[A-Z]{3}))?$/.exec(text);
  if (!match || (match[1] && match[3]) || (match[2] && match[5])) return { issue: 'Unsupported number or currency format; edit manually.' };
  const token = match[4].trim().replace(/[\u00a0\u202f]/g, ' ');
  let decimal: '.' | ',' | null = convention === 'dot' ? '.' : convention === 'comma' ? ',' : null;
  if (convention === 'auto') {
    const dots = (token.match(/\./g) ?? []).length, commas = (token.match(/,/g) ?? []).length;
    if (dots && commas) decimal = token.lastIndexOf('.') > token.lastIndexOf(',') ? '.' : ',';
    else if (dots + commas === 1) {
      const separator = dots ? '.' : ',';
      const tail = token.split(separator)[1];
      if (tail.length === 3) return { issue: 'Ambiguous decimal/thousands separator. Choose a convention.' };
      decimal = separator;
    }
  }
  const parts = decimal ? token.split(decimal) : [token];
  if (parts.length > 2 || (parts.length === 2 && !/^\d+$/.test(parts[1]))) return { issue: 'Does not match the chosen decimal convention.' };
  const integer = parts[0];
  const separators = [...new Set(integer.replace(/\d/g, '').split(''))];
  if (separators.length > 1 || (separators.length === 1 && (separators[0] === decimal || !new RegExp(`^\\d{1,3}(?:\\${separators[0]}\\d{3})+$`).test(integer)))) return { issue: 'Invalid grouping or incompatible separator convention.' };
  const digits = integer.replace(/[., ]/g, '');
  if (!/^\d+$/.test(digits)) return { issue: 'Invalid number.' };
  const number = digits.replace(/^0+(?=\d)/, '') + (parts.length === 2 ? `.${parts[1]}` : '');
  return { value: `${match[1] || match[3]}${match[2] ?? ''}${match[2] && /[A-Z]/.test(match[2]) ? ' ' : ''}${number}${match[5] ? ` ${match[5]}` : ''}` };
}
export function normalizationPatch(data: Dataset, columnId: string, kind: 'date' | 'number', convention: DateConvention | NumberConvention) {
  const col = data.columns.find(c => c.id === columnId);
  if (!col) throw new Error('Choose a column.');
  const patch = emptyPatch(data, `Normalize ${kind}s in ${col.name}`);
  const unresolved: { sourceRow: number; value: string; reason: string }[] = [];
  for (const row of data.rows) {
    const before = row.values[columnId];
    if (!before.trim()) continue;
    const result = kind === 'date' ? normalizeDate(before, convention as DateConvention) : normalizeNumber(before, convention as NumberConvention);
    if (result.issue !== undefined) unresolved.push({ sourceRow: row.sourceRow, value: before, reason: result.issue });
    else if (result.value !== before) patch.edits.push({ rowId: row.id, columnId, before, after: result.value! });
  }
  return { patch, unresolved };
}
export function headerPatch(data: Dataset, names: string[]): RepairPatch {
  if (names.length !== data.columns.length || names.some(v => !v.trim()) || new Set(names.map(v => v.trim())).size !== names.length) throw new Error('Headers must be nonempty and unique.');
  const patch = emptyPatch(data, 'Rename column headers');
  patch.headers = data.columns.flatMap((c, i) => c.name === names[i] ? [] : [{ columnId: c.id, before: c.name, after: names[i] }]);
  return patch;
}
