'use client';
import { useState } from 'react';
import { importCsv, type TableDraft } from '@/lib/csv';
import type { Dataset } from '@/lib/dataset';
import type { SheetInfo } from '@/lib/excel';

export function SheetPicker({ name, sheets, busy, onSelect, onCancel }: { name: string; sheets: SheetInfo[]; busy: boolean; onSelect: (sheet: string) => void; onCancel: () => void }) {
  return <section className="wizard-card sheet-picker" aria-label="Choose a worksheet"><h2>{name}</h2><p>Pick one worksheet to clean. Your original workbook stays unchanged.</p>
    <ul>{sheets.map(sheet => <li key={sheet.name}><button disabled={busy || !!sheet.problem} onClick={() => onSelect(sheet.name)}><span className="sheet-tile" aria-hidden="true">▤</span><span><strong>{sheet.name}</strong>{sheet.problem && <small>{sheet.problem}</small>}</span>{!sheet.problem && <span aria-hidden="true">→</span>}</button></li>)}</ul>
    <button disabled={busy} onClick={onCancel}>Back</button></section>;
}

export default function ImportPreview({ draft, onImport, onCancel }: { draft: TableDraft; onImport: (d: Dataset) => void; onCancel: () => void }) {
  const [hasHeader, setHasHeader] = useState(true);
  const namesFor = (header: boolean) => Array.from({ length: draft.width }, (_, i) => header ? draft.records[0][i] ?? '' : `Column ${i + 1}`);
  const [names, setNames] = useState(namesFor(true));
  const [error, setError] = useState('');
  return <section className="wizard-card import-preview" aria-label="Confirm spreadsheet headers"><h2>{draft.name}</h2>
    {draft.source && <p className="notice-box">Cleaning <strong>{draft.source.sheetName}</strong> only. Values become text, including those in hidden rows or columns. Other sheets, styling, and charts won’t be copied.</p>}
    <p>Check the column names. You can edit any that are missing or repeated.</p>
    <label className="checkbox-label"><input type="checkbox" checked={hasHeader} onChange={e => { setHasHeader(e.target.checked); setNames(namesFor(e.target.checked)); setError(''); }} /> The first row contains column names</label>
    <div className="table-scroll"><table><thead><tr><th scope="col">#</th><th scope="col">Column name</th><th scope="col">First data values</th></tr></thead><tbody>{names.map((n, i) => <tr key={i}><td>{i + 1}</td><td><input aria-label={`Header ${i + 1}`} value={n} onChange={e => setNames(names.map((v, j) => i === j ? e.target.value : v))} /></td><td><div className="value-samples">{draft.records.slice(hasHeader ? 1 : 0, hasHeader ? 4 : 3).map((r, j) => <code key={j}>{r[i] || <em>empty</em>}</code>)}</div></td></tr>)}</tbody></table></div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="wizard-nav"><button onClick={onCancel}>Back</button><button className="primary" onClick={() => { try { onImport(importCsv(draft, hasHeader, names)); } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); } }}>Continue to cleanup →</button></div>
  </section>;
}
