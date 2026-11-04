export type Column = { id: string; name: string };
export type Row = { id: string; sourceRow: number; values: Record<string, string> };
export type ExcelSource = { sheetName: string; firstRow: number };
export type Dataset = { source?: ExcelSource; id: string; name: string; version: number; columns: Column[]; rows: Row[] };
export type CellEdit = { rowId: string; columnId: string; before: string; after: string };
export type HeaderEdit = { columnId: string; before: string; after: string };
export type RemovedRow = { row: Row; originalIndex: number; retainedRowId?: string; kind?: 'empty' | 'key'; keyColumnIds?: string[] };
export type RepairPatch = {
  id: string; datasetId: string; datasetVersion: number; title: string;
  edits: CellEdit[]; removedRows: RemovedRow[]; headers?: HeaderEdit[];
};
export type UndoEntry = { previous: Dataset; appliedVersion: number; title: string };
