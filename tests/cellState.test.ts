import { describe, expect, it } from 'vitest';
import {
  applyResults, decaySaved, errorKeys, hasUnsavedWork, markDirty, markSaving,
  pendingKeys, revertInFlight, stateOf, summarize,
} from '../src/features/grid/cellState';
import { cellKey } from '../src/features/grid/model';
import type { BulkRowResult } from '../src/lib/api/types';

const K1 = cellKey('e1', '2026-07-06');
const K2 = cellKey('e2', '2026-07-06');
const msg = (code: string | undefined, fb: string | undefined) => code ?? fb ?? 'greška';

describe('per-cell save state', () => {
  it('goes dirty -> saving -> saved', () => {
    let m = markDirty({}, [K1]);
    expect(stateOf(m, K1)).toBe('dirty');
    m = markSaving(m, [K1]);
    expect(stateOf(m, K1)).toBe('saving');
    m = applyResults(m, [{ employee_id: 'e1', work_date: '2026-07-06', status: 'CREATED' }], msg);
    expect(stateOf(m, K1)).toBe('saved');
  });

  it('does NOT mark a cell saved if it was edited again while in flight', () => {
    let m = markSaving(markDirty({}, [K1]), [K1]);
    // operator types again before the response arrives
    m = markDirty(m, [K1]);
    expect(stateOf(m, K1)).toBe('dirty');
    m = applyResults(m, [{ employee_id: 'e1', work_date: '2026-07-06', status: 'UPDATED' }], msg);
    expect(stateOf(m, K1)).toBe('dirty');
    expect(pendingKeys(m)).toEqual([K1]);
  });

  it('markSaving only promotes dirty cells', () => {
    const m = markSaving({}, [K1]);
    expect(stateOf(m, K1)).toBe('idle');
  });

  it('maps a per-row failure to an error with its code', () => {
    let m = markSaving(markDirty({}, [K1, K2]), [K1, K2]);
    const results: BulkRowResult[] = [
      { employee_id: 'e1', work_date: '2026-07-06', status: 'CREATED' },
      {
        employee_id: 'e2', work_date: '2026-07-06', status: 'ERROR',
        error_code: 'EMPLOYEE_NOT_IN_CENTER', error_message: 'raw db text',
      },
    ];
    m = applyResults(m, results, msg);
    expect(stateOf(m, K1)).toBe('saved');
    expect(stateOf(m, K2)).toBe('error');
    expect(m[K2].errorCode).toBe('EMPLOYEE_NOT_IN_CENTER');
    expect(errorKeys(m)).toEqual([K2]);
  });

  it('a whole-request failure puts in-flight cells back into error, not saved', () => {
    let m = markSaving(markDirty({}, [K1, K2]), [K1, K2]);
    m = revertInFlight(m, 'Čuvanje nije uspelo.');
    expect(stateOf(m, K1)).toBe('error');
    expect(stateOf(m, K2)).toBe('error');
    expect(m[K1].errorCode).toBe('SAVE_FAILED');
  });

  it('saved badges decay, errors and dirty do not', () => {
    let m = markSaving(markDirty({}, [K1]), [K1]);
    m = applyResults(m, [{ employee_id: 'e1', work_date: '2026-07-06', status: 'CREATED' }], msg);
    m = markDirty(m, [K2]);
    m = decaySaved(m);
    expect(stateOf(m, K1)).toBe('idle');
    expect(stateOf(m, K2)).toBe('dirty');
  });

  it('hasUnsavedWork covers dirty and in-flight', () => {
    expect(hasUnsavedWork({})).toBe(false);
    expect(hasUnsavedWork(markDirty({}, [K1]))).toBe(true);
    expect(hasUnsavedWork(markSaving(markDirty({}, [K1]), [K1]))).toBe(true);
  });

  it('summarize counts each state', () => {
    let m = markDirty({}, [K1, K2]);
    m = markSaving(m, [K1]);
    expect(summarize(m)).toEqual({ dirty: 1, saving: 1, errors: 0 });
  });
});
