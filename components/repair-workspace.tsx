'use client';

import { useMemo, useReducer, useState, useRef, useEffect, type ChangeEvent, type DragEvent } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type CellClassParams } from 'ag-grid-community';
import type { Row, Dataset, RepairPatch } from '@/lib/dataset';
import { exportCsv, formulaLikeCount, LIMITS, inspectCsv, type TableDraft } from '@/lib/csv';
import { buildCellStates, automaticIssueCount, summarizeChanges } from '@/lib/presentation';
import { detectRepairs } from '@/lib/detectors';
import { initialWorkspace, workspaceReducer } from '@/lib/workspace-state';
import ImportPreview, { SheetPicker } from './import-preview';
import { BrandMark, UploadArt, UploadGlyph } from './studio-art';
import { excelSession } from '@/lib/excel-client';
import type { SheetInfo } from '@/lib/excel';
import CleanupPanel from './cleanup-panel';
import RepairPreview from './repair-preview';
import AiRepairsPanel from './ai-repairs-panel';

ModuleRegistry.registerModules([AllCommunityModule]);
const sheetTheme = themeQuartz.withParams({ accentColor: '#55438a', backgroundColor: '#ffffff', foregroundColor: '#203048', borderColor: '#e1e6ee', headerBackgroundColor: '#f5f2f8', headerTextColor: '#586779', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, headerFontSize: 12, rowHeight: 40, headerHeight: 40, wrapperBorderRadius: 0, cellHorizontalPadding: 16 });
const steps = ['Upload', 'Clean up', 'AI labels', 'Download'] as const;
type Step = 0 | 1 | 2 | 3;

export default function RepairWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspace);
  const [step, setStep] = useState<Step>(0);
  const [furthestStep, setFurthestStep] = useState<Step>(0);
  const [original, setOriginal] = useState<Dataset | null>(null);
  const [draft, setDraft] = useState<TableDraft | null>(null);
  const [workbook, setWorkbook] = useState<{ name: string; sheets: SheetInfo[] } | null>(null);
  const reader = useRef<ReturnType<typeof excelSession> | null>(null);
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [exporting, setExporting] = useState(false);
  const returnStep = useRef<Step>(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiVisited, setAiVisited] = useState(false);
  const [pendingAi, setPendingAi] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [location, setLocation] = useState<{ rowId: string; columnId?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [protectFormulas, setProtectFormulas] = useState(true);
  const [downloadedVersion, setDownloadedVersion] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLDetailsElement>(null);
  const grid = useRef<AgGridReact<Row>>(null);
  const { data, preview } = state;
  const navigationLocked = busy || exporting || aiBusy || !!preview;
  const repairs = useMemo(() => data ? detectRepairs(data) : [], [data]);
  const count = automaticIssueCount(repairs);
  const riskyCount = useMemo(() => data ? formulaLikeCount(data) : 0, [data]);
  const summary = useMemo(() => data && original ? summarizeChanges(original, data) : null, [data, original]);
  const columns = useMemo<ColDef<Row>[]>(() => data ? [
    { width: 82, headerName: 'Row', pinned: 'left' as const, editable: false, filter: 'agNumberColumnFilter', valueGetter: p => p.data?.sourceRow },
    ...data.columns.map(col => ({ colId: col.id, headerName: col.name, width: 155, valueGetter: (p: { data?: Row }) => p.data?.values[col.id] ?? '' })),
  ] : [], [data?.columns]);
  const cellState = useMemo(() => data ? buildCellStates(data, repairs, preview, state.history.at(-1)) : () => null, [data, repairs, preview, state.history]);
  useEffect(() => { grid.current?.api?.refreshCells({ force: true }); }, [cellState]);
  useEffect(() => () => { reader.current?.close(); }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [step, draft, workbook]);
  useEffect(() => {
    if (!location || !sheetOpen) return;
    const frame = requestAnimationFrame(() => {
      const api = grid.current?.api;
      if (!api) return;
      setQuery(''); api.setGridOption('quickFilterText', ''); api.setFilterModel(null);
      const node = api.getRowNode(location.rowId);
      if (node) {
        api.ensureNodeVisible(node, 'middle');
        const col = location.columnId ?? data?.columns[0].id;
        if (col) { api.ensureColumnVisible(col); if (node.rowIndex !== null) api.setFocusedCell(node.rowIndex, col); }
      }
      sheet.current?.scrollIntoView({ block: 'nearest' });
      setLocation(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [location, sheetOpen, data]);
  const cellClass = (p: CellClassParams<Row>, kind: string) => !!p.data && cellState(p.data.id, p.column.getColId()) === kind;

  function goTo(next: Step) {
    if (navigationLocked || (next > 0 && !data)) return;
    if (next === 2) setAiVisited(true);
    setStep(next);
    setFurthestStep(current => Math.max(current, next) as Step);
    setSheetOpen(false);
    dispatch({ type: 'message', message: '' });
  }
  function loadData(next: Dataset) {
    closeWorkbook(); setFormat(next.source ? 'xlsx' : 'csv');
    setDraft(null); setOriginal(next); setQuery(''); setProtectFormulas(true);
    setDownloadedVersion(null); setAiVisited(false); setPendingAi(false); setAiBusy(false); setSheetOpen(false);
    setStep(1); setFurthestStep(1);
    dispatch({ type: 'load', data: next });
  }
  function showPreview(patch: RepairPatch | null) {
    dispatch({ type: 'preview', patch });
    if (patch) requestAnimationFrame(() => inspector.current?.focus());
  }
  function canReplace() {
    return !data || window.confirm('Replace the current file? Current repairs and undo will be discarded after you confirm the new file.');
  }
  function showImport(next: TableDraft) {
    returnStep.current = step;
    setDraft(next); setStep(0);
    dispatch({ type: 'message', message: '' });
  }
  function closeWorkbook() {
    reader.current?.close(); reader.current = null; setWorkbook(null);
  }
  function cancelImport() {
    setDraft(null); dispatch({ type: 'message', message: '' });
    if (draft && workbook && workbook.sheets.length > 1) return;
    closeWorkbook(); setStep(returnStep.current);
  }
  async function chooseSheet(name: string) {
    if (!workbook || !reader.current || busy) return;
    setBusy(true);
    try {
      setDraft(await reader.current.read(workbook.name, name));
      dispatch({ type: 'message', message: '' });
    } catch (error) { dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Could not read the worksheet.' }); }
    finally { setBusy(false); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (file) await readFile(file);
  }
  async function readFile(file: File) {
    if (navigationLocked || !canReplace()) return;
    setBusy(true);
    try {
      if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Choose a CSV or Excel (.xlsx) file. For older Excel files, save a copy as .xlsx first.');
      if (file.size > LIMITS.bytes) throw new Error('File exceeds the 5 MB limit.');
      if (/\.xlsx$/i.test(file.name)) {
        const session = excelSession(); reader.current = session;
        const sheets = await session.open(await file.arrayBuffer());
        if (sheets.length === 1) {
          if (sheets[0].problem) throw new Error(sheets[0].problem);
          showImport(await session.read(file.name, sheets[0].name)); closeWorkbook();
        } else {
          returnStep.current = step; setWorkbook({ name: file.name, sheets }); setStep(0);
          dispatch({ type: 'message', message: '' });
        }
        return;
      }
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('This file is not valid UTF-8. Save it as CSV UTF-8 and try again.'); }
      showImport(inspectCsv(text, file.name));
    } catch (error) { closeWorkbook(); dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Could not read this file.' }); }
    finally { setBusy(false); }
  }
  async function loadDemo() {
    if (navigationLocked || !canReplace()) return;
    setBusy(true);
    try {
      const response = await fetch('/demo/messy-orders.csv');
      if (!response.ok) throw new Error('Could not load the sample file. Please try again.');
      showImport(inspectCsv(await response.text(), 'messy-orders.csv'));
    } catch (error) { dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Could not load sample.' }); }
    finally { setBusy(false); }
  }
  async function dropFile(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    if (event.dataTransfer.files.length !== 1) { dispatch({ type: 'error', message: 'Choose one spreadsheet at a time.' }); return; }
    await readFile(event.dataTransfer.files[0]);
  }
  async function download() {
    if (!data || navigationLocked) return;
    let writer: ReturnType<typeof excelSession> | undefined;
    setExporting(true);
    try {
      let blob: Blob;
      if (format === 'xlsx') {
        writer = excelSession();
        blob = new Blob([await writer.write(data)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      } else blob = new Blob([exportCsv(data, protectFormulas)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const sheetSuffix = data.source ? '-' + data.source.sheetName.replace(/[^\p{L}\p{N}_-]+/gu, '-') : '';
      anchor.download = `${data.name.replace(/\.(csv|xlsx)$/i, '')}${sheetSuffix}-${state.history.length ? 'repaired' : 'export'}.${format}`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadedVersion(data.version);
      dispatch({ type: 'message', message: 'Download started. Your original file is unchanged.' });
    } catch (error) { dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Could not export this file.' }); }
    finally { writer?.close(); setExporting(false); }
  }

  const title = step === 0 ? draft ? 'Check your columns' : workbook ? 'Choose your worksheet' : 'Clean up your spreadsheet' : step === 1 ? 'Start with the easy fixes' : step === 2 ? 'Make matching labels consistent' : 'Review and download';
  const subtitle = step === 0 ? draft ? 'Make sure the file looks right before moving on.' : workbook ? 'Choose the tab you want to work on.' : 'Find messy cells, review the fixes, and download a clean copy.' : step === 1 ? 'Review each fix before applying it. You can skip anything you want to keep.' : step === 2 ? 'Optional: let Meta AI find labels like “USA” and “U.S.” that mean the same thing.' : 'Only the changes you applied are included in your download.';

  return <div className="wizard-shell">
    <header className="mast"><div className="wordmark"><BrandMark /> Sort of Magic</div><span className="mast-caption">A little order, a little magic.</span></header>
    <input ref={fileInput} className="sr-only" aria-label="Upload spreadsheet" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={navigationLocked || !!workbook || !!draft} onChange={upload} tabIndex={-1} />
    <nav aria-label="Cleanup steps" className="stepper"><ol>{steps.map((label, index) => <li key={label} className={step === index ? 'current' : index < step ? 'visited' : ''}>
      <button aria-current={step === index ? 'step' : undefined} disabled={navigationLocked || !!draft || !!workbook || index > furthestStep || (index > 0 && !data)} onClick={() => goTo(index as Step)}><span className="step-number" aria-hidden="true">{index < step ? '✓' : index + 1}</span><span>{label}</span></button>
    </li>)}</ol></nav>
    <main className="wizard-content">
      <header key={title} className="stage-heading"><p className="eyebrow">Step {String(step + 1).padStart(2, '0')} <span>/</span> 04</p><h1 tabIndex={-1} ref={heading}>{title}</h1><p>{subtitle}</p></header>
      <div className="feedback" role="status" aria-live="polite">{exporting ? 'Preparing your download…' : busy ? 'Reading your file…' : state.message}</div>
      {state.error && <p role="alert" className="error">{state.error}</p>}
      {step === 0 && (draft ? <ImportPreview key={draft.name + draft.records.length} draft={draft} onCancel={cancelImport} onImport={loadData} /> : workbook ? <SheetPicker name={workbook.name} sheets={workbook.sheets} busy={busy} onSelect={chooseSheet} onCancel={cancelImport} /> : <section className="upload-stage" aria-label="Choose your file">
        {data && <div className="resume-card"><div><strong>{data.name}</strong><p>Your changes are still here.</p></div><button onClick={() => goTo(1)}>Continue with this file →</button></div>}
        <div className={'upload-box' + (dragging ? ' dragging' : '')} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={dropFile}>
          <UploadArt /><div className="drop-body"><div className="format-tags" aria-hidden="true"><span>CSV</span><span>XLSX</span></div>
          <h2>{data ? 'Choose a different file' : 'Drop your file here'}</h2><p>Excel workbook or CSV</p>
          <button className="primary choose-file" disabled={busy} onClick={() => fileInput.current?.click()}><UploadGlyph />Choose a file</button>
          <small>Up to 5 MB · 5,000 rows · 50 columns</small></div>
        </div>
        <div className="sample-row"><span>Just exploring?</span><button className="text-button" disabled={busy} onClick={loadDemo}>Try a sample CSV →</button></div>
        <p className="privacy-copy">Your original file stays unchanged. Your spreadsheet stays in this browser unless you choose to use AI.</p>
      </section>)}
      {data && step > 0 && <>
        <div className="file-bar"><div><span className="file-icon" aria-hidden="true">{data.source ? 'XLSX' : 'CSV'}</span><div><strong>{data.name}</strong><small>{data.source && <>{data.source.sheetName} · </>}{data.rows.length.toLocaleString()} rows · {data.columns.length} columns</small></div></div><button className="text-button" disabled={navigationLocked || !state.history.length} onClick={() => dispatch({ type: 'undo' })}>↶ Undo last change</button></div>
        <section ref={inspector} tabIndex={-1} className="stage-body" aria-label={steps[step]}>
          {preview && <div className="wizard-card"><RepairPreview key={data.version + preview.id} data={data} patch={preview} disabled={busy} apply={() => dispatch({ type: 'apply' })} cancel={() => showPreview(null)} locate={(rowId, columnId) => { setSheetOpen(true); setLocation({ rowId, columnId }); }} /></div>}
          <div hidden={step !== 1 || !!preview}>
            <section className="wizard-card" aria-label="Quick fixes">
              <div className="card-heading"><h2>{repairs.length ? 'Here’s what we found' : 'The quick checks look good'}</h2><span className={repairs.length ? 'count-badge' : 'success-badge'}>{repairs.length ? `${repairs.length} fix${repairs.length === 1 ? '' : 'es'} to review` : '✓ Checked'}</span></div>
              {!repairs.length && <p>No extra spaces or exact duplicate rows remain. You can move on to AI labels, or explore the optional tools below.</p>}
              {repairs.map((patch, index) => <div key={patch.id} className="fix-row"><div><h3>{patch.id === 'whitespace' ? 'Trim extra spaces' : 'Remove exact duplicates'}</h3><p>{patch.id === 'whitespace' ? 'Remove spaces at the beginning and end of values.' : 'Keep the first copy of each identical row.'}</p><small>{patch.edits.length ? `${patch.edits.length} cell${patch.edits.length === 1 ? '' : 's'} affected` : `${patch.removedRows.length} duplicate row${patch.removedRows.length === 1 ? '' : 's'}`}</small></div><button className={index === 0 ? 'primary' : ''} aria-label={'Review ' + patch.title} onClick={() => showPreview(patch)}>Review fix →</button></div>)}
            </section>
            <details className="tools-disclosure"><summary><span>Need to clean up something else?</span><small>Dates, numbers, empty rows, and more</small></summary><div className="tools-content"><CleanupPanel key={data.id} data={data} disabled={navigationLocked} onPreview={showPreview} /></div></details>
          </div>
          {aiVisited && <div hidden={step !== 2 || !!preview} className="wizard-card ai-card"><AiRepairsPanel key={data.id + data.version} data={data} disabled={busy || step !== 2} onPreview={showPreview} onBusyChange={setAiBusy} onPendingChange={setPendingAi} /></div>}
          {step === 3 && summary && <section className="wizard-card download-card" aria-label="Download summary">
            <h2>{downloadedVersion === data.version ? 'Your download has started' : 'Your file, with your changes'}</h2>
            <p>{downloadedVersion === data.version ? 'Look in your Downloads folder. You can still go back and make changes.' : 'Here’s what changed during cleanup.'}</p>
            <dl className="change-summary"><div><dt>Cells updated</dt><dd>{summary.editedCells.toLocaleString()}</dd></div><div><dt>Rows removed</dt><dd>{summary.removedRows.toLocaleString()}</dd></div><div><dt>Rows in your file</dt><dd>{data.rows.length.toLocaleString()}</dd></div></dl>
            {!!summary.renamedColumns && <p>{summary.renamedColumns} column names updated.</p>}
            {!!count && <div className="notice-box"><p>{count} quick-check findings were left unchanged. You can download as is or go back to review them.</p><button className="text-button" onClick={() => goTo(1)}>Back to cleanup →</button></div>}
            {pendingAi && <p className="notice-box">Your selected AI suggestions haven’t been applied, so they won’t be included. Go back to AI labels if you want to use them.</p>}
            {!!state.history.length && <details className="history"><summary>See applied changes ({state.history.length})</summary><ol>{state.history.map((entry, i) => <li key={i}>{entry.title}</li>)}</ol></details>}
            <fieldset className="export-format" disabled={exporting}><legend>Download format</legend>
              {(['csv', 'xlsx'] as const).map(value => <label key={value}><input type="radio" name="format" value={value} checked={format === value} onChange={() => { setFormat(value); setDownloadedVersion(null); dispatch({ type: 'message', message: '' }); }} />{value === 'csv' ? 'CSV' : 'Excel (.xlsx)'}</label>)}
            </fieldset>
            {format === 'xlsx' && <p className="notice format-note">A new workbook with one sheet. All values are saved as text, including numbers and dates.</p>}
            {format === 'csv' && riskyCount > 0 && <div className="download-options"><label className="checkbox-label"><input type="checkbox" checked={protectFormulas} onChange={e => { setProtectFormulas(e.target.checked); setDownloadedVersion(null); }} /> Protect {riskyCount} formula-like values when opening in Excel</label><p className="notice">Adds an apostrophe to formula-like fields in the downloaded CSV only, including negative numbers. Uncheck to keep their exact text.</p></div>}
            <p className="notice">Your original file is unchanged. Download before closing—this session isn’t saved.</p>
            {downloadedVersion === data.version && <button className="text-button" onClick={() => goTo(0)}>Clean another file →</button>}
          </section>}
        </section>
        <div className="wizard-nav">
          <button disabled={navigationLocked} onClick={() => goTo((step - 1) as Step)}>← Back</button>
          <div className="next-action">
            {preview ? <p>Apply or cancel the preview to continue.</p> : aiBusy ? <p>Wait for AI, or cancel the analysis to continue.</p> : step === 1 && count > 0 ? <p>You can leave the remaining fixes unchanged.</p> : step === 2 ? <p>{pendingAi ? 'Selected suggestions aren’t applied yet.' : 'AI is optional. Skip this step any time.'}</p> : null}
            {step < 3 ? <button className={count && step === 1 ? '' : 'primary'} disabled={navigationLocked} onClick={() => goTo((step + 1) as Step)}>{step === 1 ? 'Continue to AI labels →' : pendingAi ? 'Continue without selected suggestions →' : 'Continue to download →'}</button> : <button className="primary" disabled={navigationLocked} onClick={download}>{downloadedVersion === data.version ? 'Download again ↓' : `Download ${format.toUpperCase()} ↓`}</button>}
          </div>
        </div>
        <details className="sheet-disclosure" ref={sheet} open={sheetOpen} onToggle={event => setSheetOpen(event.currentTarget.open)}><summary><span>View {step === 3 ? 'your final ' : 'or edit your '}spreadsheet</span><small>{data.rows.length.toLocaleString()} rows · {data.columns.length} columns</small></summary>
          <section className="sheet-card" aria-label="Spreadsheet"><div className="sheet-toolbar"><h2>Spreadsheet</h2><div className="sheet-search"><input aria-label="Search all cells" placeholder="Search cells…" value={query} onChange={event => setQuery(event.target.value)} /><button className="text-button" onClick={() => { setQuery(''); grid.current?.api?.setFilterModel(null); }}>Clear filters</button></div></div>
            <div className="grid"><AgGridReact<Row> key={data.id} ref={grid} theme={sheetTheme} rowData={data.rows} columnDefs={columns} quickFilterText={query} getRowId={p => p.data.id} readOnlyEdit stopEditingWhenCellsLoseFocus
              onCellEditRequest={event => { if (!navigationLocked && step !== 3 && event.data && event.colDef.colId) dispatch({ type: 'edit', rowId: event.data.id, columnId: event.colDef.colId, before: String(event.oldValue ?? ''), after: String(event.newValue ?? '') }); }}
              defaultColDef={{ editable: !navigationLocked && step !== 3, sortable: true, filter: 'agTextColumnFilter', resizable: true, cellDataType: false, suppressMovable: true, cellEditor: 'agTextCellEditor', cellEditorParams: { maxLength: 10000 }, cellClassRules: { 'cell-issue': p => cellClass(p, 'issue'), 'cell-proposed': p => cellClass(p, 'proposed'), 'cell-applied': p => cellClass(p, 'applied') } }} enableCellTextSelection /></div>
            <div className="sheet-footer"><span>{step === 3 ? 'Go back to cleanup to edit cells.' : preview ? 'Apply or cancel the preview before editing.' : 'Double-click to edit · Enter to save · Esc to cancel'}</span><div className="legend"><span><i className="issue-dot" /> Finding</span><span><i className="proposed-dot" /> Proposed</span><span><i className="applied-dot" /> Applied</span></div></div>
          </section><p className="notice">Filters only change this view. Repairs and downloads include the full file.</p>
        </details>
        {step !== 3 && <p className="privacy-copy">Nothing changes until you apply a fix or edit a cell. You can undo changes at any step.</p>}
      </>}
    </main>
    <footer className="site-footer"><span className="footer-brand"><span aria-hidden="true">✦</span> Sort of Magic</span><span>Made by <a href="https://helloalmaz.com" target="_blank" rel="noopener noreferrer">Almaz <span aria-hidden="true">↗</span></a></span></footer>
  </div>;
}
