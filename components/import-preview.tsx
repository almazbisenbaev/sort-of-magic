'use client';
import { useState } from 'react';
import { importCsv, type CsvDraft } from '@/lib/csv';
import type { Dataset } from '@/lib/dataset';
export default function ImportPreview({ draft, onImport, onCancel }: { draft: CsvDraft; onImport: (d: Dataset) => void; onCancel: () => void }) {
  const [hasHeader, setHasHeader] = useState(true);
  const namesFor = (header: boolean) => Array.from({ length: draft.width }, (_, i) => header ? draft.records[0][i] ?? '' : `Column ${i + 1}`);
  const [names, setNames] = useState(namesFor(true));
  const [error, setError] = useState('');
  return <section className="wizard-card import-preview" aria-label="Confirm CSV headers"><h2>{draft.name}</h2>
    <p>Check the column names below. You can edit them here if any are missing or repeated.</p>
    <label className="checkbox-label"><input type="checkbox" checked={hasHeader} onChange={e => { setHasHeader(e.target.checked); setNames(namesFor(e.target.checked)); setError(''); }} /> The first row contains column names</label>
    <div className="table-scroll"><table><thead><tr><th>Position</th><th>Column name</th><th>First data values</th></tr></thead><tbody>{names.map((n, i) => <tr key={i}><td>{i + 1}</td><td><input aria-label={`Header ${i + 1}`} value={n} onChange={e => setNames(names.map((v, j) => i === j ? e.target.value : v))} /></td><td><code>{JSON.stringify(draft.records.slice(hasHeader ? 1 : 0, hasHeader ? 4 : 3).map(r => r[i] ?? ''))}</code></td></tr>)}</tbody></table></div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="wizard-nav"><button onClick={onCancel}>Back</button><button className="primary" onClick={() => { try { onImport(importCsv(draft, hasHeader, names)); } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); } }}>Continue to cleanup →</button></div>
  </section>;
}
