import type { BulkRowResult } from '../../lib/api/types';
import { cellKey } from './model';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface CellSave {
  state: SaveState;
  errorCode?: string;
  errorMessage?: string;
}

export type SaveMap = Record<string, CellSave>;

export function stateOf(map: SaveMap, key: string): SaveState {
  return map[key]?.state ?? 'idle';
}

export function markDirty(map: SaveMap, keys: string[]): SaveMap {
  const next = { ...map };
  for (const k of keys) next[k] = { state: 'dirty' };
  return next;
}

/** Only `dirty` cells enter a save. Cells already in flight are left alone. */
export function markSaving(map: SaveMap, keys: string[]): SaveMap {
  const next = { ...map };
  for (const k of keys) {
    if (next[k]?.state === 'dirty') next[k] = { state: 'saving' };
  }
  return next;
}

export function pendingKeys(map: SaveMap): string[] {
  return Object.keys(map).filter((k) => map[k].state === 'dirty');
}

export function inFlightKeys(map: SaveMap): string[] {
  return Object.keys(map).filter((k) => map[k].state === 'saving');
}

export function hasUnsavedWork(map: SaveMap): boolean {
  return Object.values(map).some((v) => v.state === 'dirty' || v.state === 'saving');
}

export function errorKeys(map: SaveMap): string[] {
  return Object.keys(map).filter((k) => map[k].state === 'error');
}

/**
 * Fold a bulk-upsert response back into per-cell state.
 *
 * The `state === 'saving'` guard is the important part: if the operator edited a
 * cell again while its save was in flight, that cell is back to `dirty` and must
 * NOT be reported as `saved` — otherwise the newer keystrokes would look
 * persisted and get dropped on the next flush.
 */
export function applyResults(
  map: SaveMap,
  results: BulkRowResult[],
  messageFor: (code: string | undefined, fallback: string | undefined) => string,
): SaveMap {
  const next = { ...map };
  for (const r of results) {
    const k = cellKey(r.employee_id, r.work_date);
    if (r.status === 'ERROR') {
      next[k] = {
        state: 'error',
        errorCode: r.error_code,
        errorMessage: messageFor(r.error_code, r.error_message),
      };
      continue;
    }
    if (next[k]?.state === 'saving') next[k] = { state: 'saved' };
  }
  return next;
}

/**
 * An atomic save failed as a whole, so every cell that was in flight goes back
 * to `dirty`: the data is still only in the browser and must be retried.
 */
export function revertInFlight(map: SaveMap, message: string): SaveMap {
  const next = { ...map };
  for (const k of Object.keys(next)) {
    if (next[k].state === 'saving') {
      next[k] = { state: 'error', errorCode: 'SAVE_FAILED', errorMessage: message };
    }
  }
  return next;
}

/** `saved` is a transient badge; it decays to `idle` so the grid stays calm. */
export function decaySaved(map: SaveMap): SaveMap {
  const next: SaveMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v.state !== 'saved') next[k] = v;
  }
  return next;
}

export function clearError(map: SaveMap, key: string): SaveMap {
  const next = { ...map };
  delete next[key];
  return next;
}

export interface SaveSummary {
  dirty: number;
  saving: number;
  errors: number;
}

export function summarize(map: SaveMap): SaveSummary {
  let dirty = 0;
  let saving = 0;
  let errors = 0;
  for (const v of Object.values(map)) {
    if (v.state === 'dirty') dirty += 1;
    else if (v.state === 'saving') saving += 1;
    else if (v.state === 'error') errors += 1;
  }
  return { dirty, saving, errors };
}
