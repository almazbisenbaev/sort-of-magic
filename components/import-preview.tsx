'use client';
import { useState } from 'react';
import { importCsv, type CsvDraft } from '@/lib/csv';
import type { Dataset } from '@/lib/dataset';
export default function ImportPreview({ draft, onImport, onCancel }: { draft: CsvDraft; onImport: (d: Dataset) => void; onCancel: () => void }) {
  const [hasHeader, setHasHeader] = useState(true);
  const namesFor = (header: boolean) => Array.from({ length: draft.width }, (_, i) => header ? draft.records[0][i] ?? '' : `Column ${i + 1}`);
  const [names, setNames] = useState(namesFor(true));
  const [error, setError] = useState('');
  return <section aria-label="Confirm CSV headers"><h2>Confirm import: {draft.name}</h2>
    <p>Check whether the first record contains column names. Fix blank or duplicate names here. Your current dataset is unchanged until you confirm.</p>
    <label><input type="checkbox" checked={hasHeader} onChange={e => { setHasHeader(e.target.checked); setNames(namesFor(e.target.checked)); setError(''); }} /> First record contains headers</label>
    <div className="table-scroll"><table><thead><tr><th>Position</th><th>Column name</th><th>First data values</th></tr></thead><tbody>{names.map((n, i) => <tr key={i}><td>{i + 1}</td><td><input aria-label={`Header ${i + 1}`} value={n} onChange={e => setNames(names.map((v, j) => i === j ? e.target.value : v))} /></td><td><code>{JSON.stringify(draft.records.slice(hasHeader ? 1 : 0, hasHeader ? 4 : 3).map(r => r[i] ?? ''))}</code></td></tr>)}</tbody></table></div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="controls"><button onClick={() => { try { onImport(importCsv(draft, hasHeader, names)); } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); } }}>Confirm import</button><button onClick={onCancel}>Cancel import</button></div>
  </section>;
}
