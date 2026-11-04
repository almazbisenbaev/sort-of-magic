import { describe, expect, it } from 'vitest';
import { importCsv, inspectCsv, parseCsv } from '../lib/csv';
import { duplicateGroups, emptyRowsPatch, headerPatch, keyDuplicatesPatch, missingValues, normalizationPatch, normalizeDate, normalizeNumber } from '../lib/cleanup';
import { applyPatch } from '../lib/patches';
import { initialWorkspace, workspaceReducer } from '../lib/workspace-state';
import { buildRepairContext } from '../lib/ai-repairs';
const data = (text: string) => parseCsv(text, 'test.csv');

describe('date normalization without guessing', () => {
  it.each([
    ['2024/2/29','auto','2024-02-29'], ['31/12/2026','auto','2026-12-31'], ['12/31/2026','auto','2026-12-31'],
    ['03/04/2026','dmy','2026-04-03'], ['03/04/2026','mdy','2026-03-04'], ['04/04/2026','auto','2026-04-04'],
  ] as const)('normalizes %s with %s', (v,c,result) => expect(normalizeDate(v,c)).toEqual({value:result}));
  it.each(['03/04/2026','2023-02-29','31/04/2026','01/02/26','not a date','2026-12-01T10:00:00Z'])('leaves %s unresolved', v => expect(normalizeDate(v,'auto').issue).toBeTruthy());
  it('previews safe edits while listing ambiguous and invalid records', () => {
    const d = data('date\n2026/1/2\n03/04/2026\ninvalid\n""');
    const result = normalizationPatch(d,'c0','date','auto');
    expect(result.patch.edits).toHaveLength(1); expect(result.unresolved).toHaveLength(2);
    expect(normalizationPatch(d,'c0','date','dmy').patch.edits).toHaveLength(2);
  });
});
describe('numeric normalization preserves meaning and currency', () => {
  it.each([
    ['1,234.50','auto','1234.50'], ['1.234,50','auto','1234.50'], ['1 234,50','auto','1234.50'],
    ['USD 1,234.50','dot','USD 1234.50'], ['1.234,50 EUR','comma','1234.50 EUR'], ['$1,234.50','dot','$1234.50'],
    ['-€1.234,50','comma','-€1234.50'], ['9007199254740993.25','dot','9007199254740993.25'],
    ['1,234','dot','1234'], ['1,234','comma','1.234'], ['1.234','dot','1.234'], ['1.234','comma','1234'],
    ['1,234,567','auto','1234567'], ['0012.50','dot','12.50'], ['0','auto','0'],
  ] as const)('normalizes %s with %s', (v,c,result) => expect(normalizeNumber(v,c)).toEqual({value:result}));
  it.each(['1,234','1.234','1,23,456','12 34','1e5','10%','USD 10 EUR','NaN','--1','1.2.3'])('does not guess %s', v => expect(normalizeNumber(v,'auto').issue).toBeTruthy());
  it('does not reinterpret a conflicting explicit decimal convention', () => expect(normalizeNumber('1.234,50','dot').issue).toBeTruthy());
});
describe('additional cleanup and import', () => {
  it('repairs headers and supports headerless files without losing the first row', () => {
    const draft = inspectCsv('id,,id\n1,A,B', 'x.csv');
    expect(() => importCsv(draft,true,['id','','id'])).toThrow();
    expect(importCsv(draft,true,['id','name','code']).rows).toHaveLength(1);
    const raw = importCsv(inspectCsv('001,A\n002,B','x.csv'),false,['id','name']);
    expect(raw.rows[0]).toMatchObject({sourceRow:1,values:{c0:'001',c1:'A'}});
    expect(applyPatch(raw,headerPatch(raw,['order_id','customer'])).dataset.columns.map(c=>c.name)).toEqual(['order_id','customer']);
    expect(() => headerPatch(raw,['id','id'])).toThrow();
  });
  it('removes only empty rows and checks only required fields', () => {
    const d = data('id,optional\n1,\n,\n , \n,notes');
    const patch = emptyRowsPatch(d);
    expect(patch.removedRows).toHaveLength(2);
    expect(missingValues(d,[])).toEqual([]);
    expect(missingValues(d,['c0'])).toHaveLength(3);
    const result = applyPatch(d,patch).dataset;
    expect(result.rows.map(r=>r.values)).toEqual([{c0:'1',c1:''},{c0:'',c1:'notes'}]);
    expect(() => applyPatch(d,{...patch,removedRows:[{row:d.rows[0],originalIndex:0,kind:'empty'}]})).toThrow();
  });
  it('lets the user retain a non-first key duplicate with different other fields', () => {
    const d = data('id,name\n1,Old\n1,New\n2,Third\n,Blank\n,Other');
    expect(duplicateGroups(d,['c0'])).toHaveLength(1);
    const p = keyDuplicatesPatch(d,['c0'],{r0:'r1'});
    expect(p.removedRows[0].row.id).toBe('r0');
    expect(applyPatch(d,p).dataset.rows.map(r=>r.values.c1)).toEqual(['New','Third','Blank','Other']);
    expect(keyDuplicatesPatch(d,['c0'],{}).removedRows).toHaveLength(0);
    expect(() => keyDuplicatesPatch(d,['c0'],{r0:'r2'})).toThrow();
  });
  it('supports composite keys and rejects invalid removal rules', () => {
    const d = data('id,store,name\n1,A,Old\n1,B,Other\n1,A,New');
    expect(duplicateGroups(d,['c0','c1'])[0].map(r=>r.id)).toEqual(['r0','r2']);
    const p = keyDuplicatesPatch(d,['c0','c1'],{r0:'r2'});
    expect(() => applyPatch(d,{...p,removedRows:[{...p.removedRows[0],keyColumnIds:['c2']}]})).toThrow();
  });
  it('parses and profiles 5,000 rows within a generous performance budget', () => {
    const start = performance.now();
    const d = data('id,country\n'+Array.from({length:5000},(_,i)=>`${String(i).padStart(5,'0')},${i%2?'USA':'United States'}`).join('\n'));
    expect(d.rows).toHaveLength(5000);
    expect(buildRepairContext(d,'c1').values[0].count).toBe(2500);
    expect(performance.now()-start).toBeLessThan(2000);
    expect(() => data('id\n'+Array(5001).fill('x').join('\n'))).toThrow('5,000');
  });
  it('passes bounded user guidance without broadening operations', () => {
    const d = data('country\nUSA\nUnited States');
    expect(buildRepairContext(d,'c0','Keep abbreviations').guidance).toBe('Keep abbreviations');
    expect(() => buildRepairContext(d,'c0','x'.repeat(1001))).toThrow();
  });
});
describe('undo history across operation types', () => {
  it('undoes manual edits, row removal, and header changes while versions stay monotonic', () => {
    const d = data('id,name\n1,Old\n1,New');
    let state = workspaceReducer(initialWorkspace,{type:'load',data:d});
    const stale = headerPatch(d,['key','name']);
    state = workspaceReducer(state,{type:'edit',rowId:'r1',columnId:'c1',before:'New',after:'Newest'});
    expect(state.preview).toBeNull();
    state = workspaceReducer(state,{type:'preview',patch:keyDuplicatesPatch(state.data!,['c0'],{r0:'r1'})});
    state = workspaceReducer(state,{type:'apply'});
    state = workspaceReducer(state,{type:'preview',patch:headerPatch(state.data!,['order_id','name'])});
    state = workspaceReducer(state,{type:'apply'});
    expect(state.history).toHaveLength(3);
    state = workspaceReducer(state,{type:'undo'}); expect(state.data!.columns[0].name).toBe('id');
    state = workspaceReducer(state,{type:'undo'}); expect(state.data!.rows).toHaveLength(2);
    state = workspaceReducer(state,{type:'undo'}); expect(state.data!.rows).toEqual(d.rows);
    expect(state.data!.version).toBe(6); expect(state.history).toHaveLength(0);
    expect(() => applyPatch(state.data!,stale)).toThrow('out of date');
  });
  it('clears old previews on an edit and invalidates old before-values', () => {
    const d = data('a\nx');
    let state = workspaceReducer(initialWorkspace,{type:'load',data:d});
    state = workspaceReducer(state,{type:'preview',patch:headerPatch(d,['b'])});
    state = workspaceReducer(state,{type:'edit',rowId:'r0',columnId:'c0',before:'x',after:'y'});
    expect(state.preview).toBeNull();
    const bad = workspaceReducer(state,{type:'edit',rowId:'r0',columnId:'c0',before:'x',after:'z'});
    expect(bad.error).toBeTruthy(); expect(bad.data).toBe(state.data);
  });
});
