'use client';
import { useMemo, useState } from 'react';
import type { Dataset, RepairPatch, Row } from '@/lib/dataset';
import { duplicateGroups, emptyRowsPatch, headerPatch, keyDuplicatesPatch, missingValues, normalizationPatch, type DateConvention, type NumberConvention } from '@/lib/cleanup';
function DuplicateGroupRows({ data, group }: { data: Dataset; group: Row[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(group.length / 50), current = Math.min(page, pages - 1);
  return <><table><thead><tr><th>Source record</th>{data.columns.map(c => <th key={c.id}>{c.name}</th>)}</tr></thead><tbody>{group.slice(current * 50, (current + 1) * 50).map(r => <tr key={r.id}><td>{r.sourceRow}</td>{data.columns.map(c => <td key={c.id}><code>{JSON.stringify(r.values[c.id])}</code></td>)}</tr>)}</tbody></table>
    {pages > 1 && <p className="controls"><button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous records</button>Records page {current + 1} of {pages}<button disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Next records</button></p>}</>;
}
function HeaderEditor({ data, disabled, onPreview }: { data: Dataset; disabled: boolean; onPreview: (p: RepairPatch | null) => void }) {
  const [names, setNames] = useState(data.columns.map(c => c.name));
  const [error, setError] = useState('');
  return <details><summary>Edit column headers</summary><div className="controls">{data.columns.map((c, i) => <label key={c.id}>{c.name}<br /><input aria-label={`Rename ${c.name}`} disabled={disabled} value={names[i]} onChange={e => { setNames(names.map((n, j) => j === i ? e.target.value : n)); onPreview(null); }} /></label>)}</div>
    {error && <p role="alert">{error}</p>}<p><button disabled={disabled || names.every((n, i) => n === data.columns[i].name)} onClick={() => { try { onPreview(headerPatch(data, names)); setError(''); } catch (e) { setError((e as Error).message); } }}>Preview header changes</button></p></details>;
}
export default function CleanupPanel({ data, disabled, onPreview }: { data: Dataset; disabled: boolean; onPreview: (p: RepairPatch | null) => void }) {
  const [required, setRequired] = useState<string[]>([]);
  const [groupPage, setGroupPage] = useState(0);
  const [keys, setKeys] = useState<string[]>([]);
  const [retained, setRetained] = useState<Record<string, string>>({});
  const [column, setColumn] = useState(data.columns[0].id);
  const [kind, setKind] = useState<'date' | 'number'>('date');
  const [convention, setConvention] = useState<DateConvention | NumberConvention>('auto');
  const [error, setError] = useState('');
  const [normalizerOpen, setNormalizerOpen] = useState(false);
  const missing = useMemo(() => missingValues(data, required), [data, required]);
  const empty = useMemo(() => emptyRowsPatch(data), [data]);
  const groups = useMemo(() => duplicateGroups(data, keys), [data, keys]);
  const groupPages = Math.max(1, Math.ceil(groups.length / 10));
  const currentGroupPage = Math.min(groupPage, groupPages - 1);
  const normalized = useMemo(() => normalizerOpen ? normalizationPatch(data, column, kind, convention) : null, [data, column, kind, convention, normalizerOpen]);
  function show(patch: RepairPatch) { if (!patch.edits.length && !patch.removedRows.length && !patch.headers?.length) { setError('No selected changes to preview.'); return; } setError(''); onPreview(patch); }
  const columnOptions = data.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>);
  return <section aria-label="Additional cleanup"><h2>Additional cleanup</h2>
    <p>Repairs and checks cover the entire file, including rows hidden by filters. All batch changes require preview and Apply.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <p>{empty.removedRows.length} empty rows. <button disabled={disabled || !empty.removedRows.length} onClick={() => show(empty)}>Preview empty-row removal</button></p>
    <details><summary>Check required fields ({missing.length} missing values)</summary><p>Choose columns that must have a value. Other blanks are allowed. Missing values are flagged, never invented; fill them by editing the grid.</p>
      <div className="controls">{data.columns.map(c => <label key={c.id}><input type="checkbox" checked={required.includes(c.id)} onChange={e => setRequired(e.target.checked ? [...required, c.id] : required.filter(id => id !== c.id))} />{c.name}</label>)}</div>
      <div className="table-scroll"><table><thead><tr><th>Source record</th><th>Missing column</th></tr></thead><tbody>{missing.slice(0, 100).map(m => <tr key={`${m.rowId}-${m.columnId}`}><td>{m.sourceRow}</td><td>{data.columns.find(c => c.id === m.columnId)?.name}</td></tr>)}</tbody></table></div>
      {missing.length > 100 && <p>Showing the first 100 of {missing.length} missing values. Recheck as you edit.</p>}
    </details>
    <details onToggle={e => setNormalizerOpen(e.currentTarget.open)}><summary>Normalize dates or numbers</summary>
      <div className="controls">
        <label>Repair column <select aria-label="Repair column" disabled={disabled} value={column} onChange={e => { setColumn(e.target.value); onPreview(null); }}>{columnOptions}</select></label>
        <label>Repair type <select aria-label="Repair type" disabled={disabled} value={kind} onChange={e => { setKind(e.target.value as 'date' | 'number'); setConvention('auto'); onPreview(null); }}><option value="date">Dates → YYYY-MM-DD</option><option value="number">Numbers → decimal point</option></select></label>
        <label>{kind === 'date' ? 'Ambiguous date order' : 'Source decimal separator'} <select aria-label="Source convention" disabled={disabled} value={convention} onChange={e => { setConvention(e.target.value as DateConvention | NumberConvention); onPreview(null); }}>
          <option value="auto">Leave ambiguous values unchanged</option>
          {kind === 'date' ? <><option value="dmy">Day first: 03/04 = 3 April</option><option value="mdy">Month first: 03/04 = March 4</option></> : <><option value="dot">Dot decimal: 1,234.50 → 1234.50</option><option value="comma">Comma decimal: 1.234,50 → 1234.50</option></>}
        </select></label>
      </div>
      <p className="notice">{kind === 'date' ? 'Year-first and unambiguous dates are recognized individually. Your choice resolves ambiguous day/month values. Invalid dates and unsupported formats remain unchanged.' : 'Only use this on numeric columns, not identifiers. Decimal/grouping conventions are validated. Existing currency tokens stay in place; no currency conversion. Unsupported values remain unchanged.'}</p>
      {normalized && <><p>{normalized.patch.edits.length} proposed changes · {normalized.unresolved.length} unresolved values.</p>
        <button disabled={disabled || !normalized.patch.edits.length} onClick={() => show(normalized.patch)}>Preview normalization</button>
        {!!normalized.unresolved.length && <><h3>Unresolved — will remain unchanged</h3><div className="table-scroll"><table><thead><tr><th>Source record</th><th>Value</th><th>Reason</th></tr></thead><tbody>{normalized.unresolved.slice(0, 100).map(r => <tr key={r.sourceRow}><td>{r.sourceRow}</td><td><code>{JSON.stringify(r.value)}</code></td><td>{r.reason}</td></tr>)}</tbody></table></div>{normalized.unresolved.length > 100 && <p>Showing first 100 unresolved values.</p>}</>}
      </>}
    </details>
    <details><summary>Find duplicates by selected key columns</summary>
      <p>Choose what identifies a record (for example, order_id). Non-key fields may differ. Inspect every record before deciding which one to keep. Rows with blank key values are excluded.</p>
      <div className="controls">{data.columns.map(c => <label key={c.id}><input type="checkbox" aria-label={`Duplicate key ${c.name}`} disabled={disabled} checked={keys.includes(c.id)} onChange={e => { setKeys(e.target.checked ? [...keys, c.id] : keys.filter(k => k !== c.id)); setRetained({}); setGroupPage(0); onPreview(null); }} />{c.name}</label>)}</div>
      <p>{groups.length} duplicate groups. Choose “Skip” to leave a group unchanged.</p>
      <div className="table-scroll">{groups.slice(currentGroupPage * 10, (currentGroupPage + 1) * 10).map(group => <fieldset key={group[0].id}><legend>Key: {JSON.stringify(keys.map(k => group[0].values[k]))}</legend>
        <label>Keep record <select aria-label={`Keep record in group ${group[0].sourceRow}`} disabled={disabled} value={retained[group[0].id] ?? ''} onChange={e => { setRetained({ ...retained, [group[0].id]: e.target.value }); onPreview(null); }}><option value="">Skip this group</option>{group.map(r => <option key={r.id} value={r.id}>Source record {r.sourceRow}</option>)}</select></label>
        <DuplicateGroupRows data={data} group={group} />
      </fieldset>)}</div>
      {groupPages > 1 && <p className="controls"><button disabled={currentGroupPage === 0} onClick={() => setGroupPage(currentGroupPage - 1)}>Previous groups</button>Groups page {currentGroupPage + 1} of {groupPages}<button disabled={currentGroupPage + 1 === groupPages} onClick={() => setGroupPage(currentGroupPage + 1)}>Next groups</button></p>}
      <button disabled={disabled || !groups.some(g => retained[g[0].id])} onClick={() => { try { show(keyDuplicatesPatch(data, keys, retained)); } catch (e) { setError((e as Error).message); } }}>Preview key duplicate removal</button>
    </details>
    <HeaderEditor key={`${data.id}:${data.version}`} data={data} disabled={disabled} onPreview={onPreview} />
  </section>;
}
