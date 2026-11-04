'use client';

import { useMemo, useReducer, useState, useRef, useEffect, type ChangeEvent, type DragEvent } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type CellClassParams } from 'ag-grid-community';
import type { Row, Dataset, RepairPatch } from '@/lib/dataset';
import { exportCsv, formulaLikeCount, LIMITS, parseCsv, inspectCsv, type CsvDraft } from '@/lib/csv';
import { buildCellStates, automaticIssueCount } from '@/lib/presentation';
import { detectRepairs } from '@/lib/detectors';
import { initialWorkspace, workspaceReducer } from '@/lib/workspace-state';
import ImportPreview from './import-preview';
import CleanupPanel from './cleanup-panel';
import RepairPreview from './repair-preview';
import AiRepairsPanel from './ai-repairs-panel';

ModuleRegistry.registerModules([AllCommunityModule]);
const sheetTheme = themeQuartz.withParams({ accentColor: '#12776a', backgroundColor: '#ffffff', foregroundColor: '#263b36', borderColor: '#e1e7e3', headerBackgroundColor: '#f6f8f6', headerTextColor: '#5e7068', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, headerFontSize: 11, rowHeight: 40, headerHeight: 40, wrapperBorderRadius: 0, cellHorizontalPadding: 16 });


export default function RepairWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspace);
  const [draft, setDraft] = useState<CsvDraft | null>(null);


  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const grid = useRef<AgGridReact<Row>>(null);
  const [busy, setBusy] = useState(false);
  const [protectFormulas, setProtectFormulas] = useState(true);
  const { data, preview } = state;
  const repairs = useMemo(() => data ? detectRepairs(data) : [], [data]);
  const riskyCount = useMemo(() => data ? formulaLikeCount(data) : 0, [data]);
  const columns = useMemo<ColDef<Row>[]>(() => data ? [
    { width: 82, headerName: 'Row', pinned: 'left' as const, editable: false, filter: 'agNumberColumnFilter', valueGetter: p => p.data?.sourceRow },
    ...data.columns.map(col => ({ colId: col.id, headerName: col.name, width: 155, valueGetter: (p: { data?: Row }) => p.data?.values[col.id] ?? '' })),
  ] : [], [data?.columns]);

  const count = automaticIssueCount(repairs);

  const cellState = useMemo(() => data ? buildCellStates(data, repairs, preview, state.history.at(-1)) : () => null, [data, repairs, preview, state.history]);
  useEffect(() => { grid.current?.api?.refreshCells({ force: true }); }, [cellState]);
  const cellClass = (p: CellClassParams<Row>, kind: string) => !!p.data && cellState(p.data.id, p.column.getColId()) === kind;
  function loadData(next: Dataset) {
    setDraft(null); setQuery(''); setProtectFormulas(true);
    dispatch({ type: 'load', data: next });
  }
  function locate(rowId: string, columnId?: string) {
    const api = grid.current?.api;
    if (!api) return;
    setQuery(''); api.setGridOption('quickFilterText', ''); api.setFilterModel(null);
    const node = api.getRowNode(rowId);
    if (node) {
      api.ensureNodeVisible(node, 'middle');
      const col = columnId ?? data?.columns[0].id;
      if (col) { api.ensureColumnVisible(col); if (node.rowIndex !== null) api.setFocusedCell(node.rowIndex, col); }
    }
  }
  function showPreview(patch: RepairPatch | null) {
    dispatch({ type: 'preview', patch });
    if (patch) {

      const first = patch.edits[0]; const removed = patch.removedRows[0];
      if (first) locate(first.rowId, first.columnId); else if (removed) locate(removed.row.id);
      requestAnimationFrame(() => inspector.current?.focus());
    }
  }

  function canReplace() {
    return !data || window.confirm('Replace the current file? Current repairs and undo will be discarded.');
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (file) await readFile(file);
  }
  async function readFile(file: File) {
    if (busy || !canReplace()) return;
    setBusy(true);
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('Choose a .csv file. Excel workbooks are not supported yet.');
      if (file.size > LIMITS.bytes) throw new Error('File exceeds the 5 MB limit.');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('This file is not valid UTF-8. Save it as CSV UTF-8 and try again.'); }
      setDraft(inspectCsv(text, file.name));
    } catch (error) { dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Could not read this file.' }); }
    finally { setBusy(false); }
  }
  async function loadDemo() {
    if (!canReplace()) return;
    setBusy(true);
    try {
      const response = await fetch('/demo/messy-orders.csv');
      if (!response.ok) throw new Error('Could not load the demo file. Please try again.');
      loadData(parseCsv(await response.text(), 'messy-orders.csv'));
    } catch (error) { dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Could not load demo.' }); }
    finally { setBusy(false); }
  }
  async function dropFile(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    if (event.dataTransfer.files.length !== 1) { dispatch({ type: 'error', message: 'Choose one CSV file at a time.' }); return; }
    await readFile(event.dataTransfer.files[0]);
  }
  function download() {
    if (!data) return;
    if (preview && !window.confirm('A repair preview has not been applied. Export the current data without that repair?')) return;
    const blob = new Blob([exportCsv(data, protectFormulas)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${data.name.replace(/\.csv$/i, '')}-${state.history.length ? 'repaired' : 'export'}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dispatch({ type: 'message', message: `CSV exported.${protectFormulas && riskyCount ? ` ${riskyCount} formula-like fields were prefixed with an apostrophe in the download only.` : ''}` });
  }
  return <main className="simple-shell">
    <header className="mast"><div className="wordmark"><span aria-hidden="true">▦</span> Sort of Magic</div>{data && <button disabled={busy} onClick={() => fileInput.current?.click()}>Open another CSV</button>}</header>
    <input ref={fileInput} className="sr-only" aria-label="Upload CSV" type="file" accept=".csv,text/csv" disabled={busy} onChange={upload} tabIndex={-1} />
    <div className="feedback" role="status">{busy ? 'Reading file…' : state.message}</div>{state.error && <p role="alert" className="error">{state.error}</p>}
    {draft ? <ImportPreview key={draft.name + draft.records.length} draft={draft} onCancel={() => setDraft(null)} onImport={loadData} /> : !data ? <section className="start">
      <h1>Clean up a CSV</h1><p>Find extra spaces and duplicate rows. Review each fix before changing your file.</p>
      <div className={'upload-box' + (dragging ? ' dragging' : '')} onDragOver={e => {e.preventDefault();setDragging(true)}} onDragLeave={() => setDragging(false)} onDrop={dropFile}>
        <button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}>Choose CSV file</button><p>or drop it here</p><small>CSV only · Up to 5 MB and 5,000 rows</small>
      </div><button className="sample-link" disabled={busy} onClick={loadDemo}>Try a sample CSV →</button><p className="privacy-copy">Your original file stays unchanged. Local checks run in your browser.</p>
    </section> : <>
    <header className="document-head"><div><h1>{data.name}</h1><small>{data.rows.length} rows · {data.columns.length} columns</small></div><div className="controls">{!!state.history.length && <button onClick={() => dispatch({type:'undo'})}>Undo last change</button>}<button className={count || preview ? '' : 'primary'} disabled={busy || !!preview} title={preview ? 'Apply or cancel the preview before downloading' : undefined} onClick={download}>Download CSV ↓</button></div></header>
    <div className="repair-layout"><aside className="action-column" ref={inspector} tabIndex={-1}>
      <section className="task-card">{preview ? <RepairPreview key={data.version + preview.id} data={data} patch={preview} disabled={busy} apply={() => dispatch({type:'apply'})} cancel={() => showPreview(null)} locate={locate}/> : <>
        <h2>{repairs.length ? 'Suggested fixes' : 'Automatic checks complete'}</h2>
        <p>{repairs.length ? 'Choose a fix to see exactly what would change.' : 'No extra spaces or exact duplicate rows remain. Download your CSV when you’re ready.'}</p>
        {repairs.map(p => <div key={p.id} className="fix-row"><div><strong>{p.id === 'whitespace' ? 'Trim extra spaces' : 'Remove exact duplicates'}</strong><small>{p.edits.length ? p.edits.length + ' cells' : p.removedRows.length + ' duplicate rows'}</small></div><button aria-label={'Review ' + p.title} onClick={() => showPreview(p)}>Review →</button></div>)}
      </>}</section>
      <div hidden={!!preview} className="optional-tools"><details><summary>Standardize labels with Meta AI</summary><AiRepairsPanel key={data.id+data.version} data={data} disabled={busy} onPreview={showPreview}/></details>
      <details><summary>More cleanup tools</summary><CleanupPanel key={data.id} data={data} disabled={busy} onPreview={showPreview}/></details>
      {!!state.history.length && <details><summary>Changes made ({state.history.length})</summary><ol>{[...state.history].reverse().map((h,i)=><li key={i}>{h.title}</li>)}</ol></details>}</div>
    </aside><div className="sheet-column"><section className="sheet-card" aria-label="Spreadsheet">
      <div className="sheet-toolbar"><h2>Spreadsheet</h2><div className="sheet-search"><input aria-label="Search all cells" placeholder="Search cells…" value={query} onChange={e=>setQuery(e.target.value)}/><button className="text-button" onClick={()=>{setQuery('');grid.current?.api?.setFilterModel(null)}}>Clear filters</button></div></div>
            <div className="grid"><AgGridReact<Row> key={data.id} ref={grid} theme={sheetTheme} rowData={data.rows} columnDefs={columns} quickFilterText={query} getRowId={p => p.data.id} readOnlyEdit stopEditingWhenCellsLoseFocus
              onCellEditRequest={e => { if (e.data && e.colDef.colId) dispatch({ type: 'edit', rowId: e.data.id, columnId: e.colDef.colId, before: String(e.oldValue ?? ''), after: String(e.newValue ?? '') }); }}
              defaultColDef={{ editable: !busy, sortable: true, filter: 'agTextColumnFilter', floatingFilter: false, resizable: true, cellDataType: false, suppressMovable: true, cellEditor: 'agTextCellEditor', cellEditorParams: { maxLength: 10000 }, cellClassRules: { 'cell-issue': p => cellClass(p, 'issue'), 'cell-proposed': p => cellClass(p, 'proposed'), 'cell-applied': p => cellClass(p, 'applied') }, tooltipValueGetter: p => p.data ? `${cellState(p.data.id, p.colDef && 'colId' in p.colDef ? p.colDef.colId ?? '' : '') ?? 'Original value'}: ${String(p.value ?? '')}` : '' }} enableCellTextSelection /></div>
            <div className="sheet-footer"><span>Double-click to edit · Enter to save · Esc to cancel</span><div className="legend"><span><i className="issue-dot" /> Finding</span><span><i className="proposed-dot" /> Proposed</span><span><i className="applied-dot" /> Applied</span></div></div>
          </section>

      <p className="notice">Filters only change this view. Repairs and downloads use the full file.</p>
      {riskyCount > 0 && <details className="download-options"><summary>Download settings · {riskyCount} formula-like values</summary><label><input type="checkbox" checked={protectFormulas} onChange={e=>setProtectFormulas(e.target.checked)}/> Prefix formula-like values with an apostrophe in the downloaded CSV</label></details>}
    </div></div><p className="privacy-copy">Download before closing. This session is not saved automatically.</p>
    </>}</main>;
}
