import type { Dataset, RepairPatch, UndoEntry } from './dataset';
import { applyPatch, undoPatch } from './patches';
export type WorkspaceState = { data: Dataset | null; preview: RepairPatch | null; history: UndoEntry[]; message: string; error: string };
export type WorkspaceAction = { type: 'load'; data: Dataset } | { type: 'preview'; patch: RepairPatch | null } | { type: 'apply' } | { type: 'edit'; rowId: string; columnId: string; before: string; after: string } | { type: 'undo' } | { type: 'error'; message: string } | { type: 'message'; message: string };
export const initialWorkspace: WorkspaceState = { data: null, preview: null, history: [], message: '', error: '' };
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  try {
    switch (action.type) {
      case 'load': return { ...initialWorkspace, data: action.data };
      case 'preview': return { ...state, preview: action.patch, error: '', message: action.patch ? 'Review the exact changes below before applying.' : state.preview ? 'Preview cancelled. Nothing changed.' : '' };
      case 'error': return { ...state, error: action.message, message: '' };
      case 'message': return { ...state, message: action.message, error: '' };
      case 'edit':
      case 'apply': {
        if (!state.data) return state;
        if (action.type === 'edit' && action.before === action.after) return state;
        const patch = action.type === 'apply' ? state.preview : { id: 'manual', datasetId: state.data.id, datasetVersion: state.data.version, title: 'Manual cell edit', edits: [{ rowId: action.rowId, columnId: action.columnId, before: action.before, after: action.after }], removedRows: [] };
        if (!patch) return state;
        const result = applyPatch(state.data, patch);
        return { ...state, data: result.dataset, history: [...state.history, result.undo].slice(-100), preview: null, error: '', message: `Applied: ${patch.title}. You can undo this change.` };
      }
      case 'undo': {
        if (!state.data || !state.history.length) return state;
        const last = state.history.at(-1)!;
        const data = undoPatch(state.data, last);
        const history = state.history.slice(0, -1);
        // The restored snapshot is exactly the preceding operation's result. Rebase its guard to the new monotonic version.
        if (history.length) history[history.length - 1] = { ...history.at(-1)!, appliedVersion: data.version };
        return { ...state, data, history, preview: null, error: '', message: `Undid: ${last.title}. Values and row positions restored.` };
      }
    }
  } catch (error) { return { ...state, preview: null, error: error instanceof Error ? error.message : 'Operation failed; data is unchanged.', message: '' }; }
}
