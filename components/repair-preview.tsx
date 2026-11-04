'use client';
import { useState } from 'react';
import type { Dataset, RepairPatch } from '@/lib/dataset';
export default function RepairPreview({ data, patch, disabled, apply, cancel, locate }: { data: Dataset; patch: RepairPatch; disabled: boolean; apply: () => void; cancel: () => void; locate?: (rowId: string, columnId?: string) => void }) {
  const [page, setPage] = useState(0);
  const rows = new Map(data.rows.map(r => [r.id, r]));
  const changes = [
    ...patch.edits.map(e => ({ rowId: e.rowId, columnId: e.columnId, location: `Record ${rows.get(e.rowId)?.sourceRow} · ${data.columns.find(c => c.id === e.columnId)?.name}`, before: JSON.stringify(e.before), after: JSON.stringify(e.after) })),
    ...(patch.headers ?? []).map(h => ({ rowId: undefined, columnId: undefined, location: 'Column header', before: JSON.stringify(h.before), after: JSON.stringify(h.after) })),
    ...patch.removedRows.map(r => ({ rowId: r.row.id, columnId: undefined, location: `Remove record ${r.row.sourceRow}`, before: JSON.stringify(data.columns.map(c => r.row.values[c.id])), after: r.retainedRowId ? `Keep record ${rows.get(r.retainedRowId)?.sourceRow}: ${JSON.stringify(data.columns.map(c => rows.get(r.retainedRowId!)?.values[c.id]))}` : 'Remove empty row' })),
  ];
  const pages = Math.max(1, Math.ceil(changes.length / 5));
  return <section aria-label="Repair preview"><div className="review-header"><span className="badge badge-proposed">Preview · Not applied</span><h2>{patch.title}</h2></div>
    <p>{changes.length} changes across the file. Apply to update your spreadsheet, or cancel to keep it as it is.</p>
    {!!patch.removedRows.some(r => r.kind === 'key') && <p className="warning">Key duplicates may contain different values. Check the retained record before discarding the others.</p>}
    <div className="controls review-actions"><button className="primary" disabled={disabled} onClick={apply}>Apply {changes.length} {changes.length === 1 ? 'change' : 'changes'}</button><button disabled={disabled} onClick={cancel}>Cancel preview</button></div>
    <ol className="diff-list">{changes.slice(page * 5, (page + 1) * 5).map((c, i) => <li className="diff-card" key={i}><div className="diff-location"><strong>{c.location}</strong>{c.rowId && locate && <button className="text-button" onClick={() => locate(c.rowId!, c.columnId)} aria-label={`Show ${c.location.toLowerCase()} in spreadsheet`}>Show ↗</button>}</div><div className="diff-value diff-before"><span>Before</span><code>{c.before}</code></div><div className="diff-value diff-after"><span>After</span><code>{c.after}</code></div></li>)}</ol>
    {pages > 1 && <p className="controls"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous changes</button>Page {page + 1} of {pages}<button disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>Next changes</button></p>}

  </section>;
}
