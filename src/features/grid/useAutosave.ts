import { useCallback, useEffect, useRef, useState } from 'react';
import type { BulkEntryInput, BulkUpsertResult, Uuid } from '../../lib/api/types';
import type { WdrApi } from '../../lib/api/WdrApi';
import { cellKey } from './model';

export type SaveQueue = Map<string, BulkEntryInput>;

/**
 * Last write per cell wins. Typing `06-14` then `GO` into the same cell must
 * send one row, not two contradictory ones.
 */
export function enqueue(queue: SaveQueue, entries: BulkEntryInput[]): SaveQueue {
  const next = new Map(queue);
  for (const e of entries) next.set(cellKey(e.employee_id, e.work_date), e);
  return next;
}

export function queueKeys(queue: SaveQueue): string[] {
  return Array.from(queue.keys());
}

export interface AutosaveHandle {
  /** Number of cells waiting to be sent. */
  queued: number;
  /** A request is currently in flight. */
  saving: boolean;
  push(entries: BulkEntryInput[]): void;
  /** Send immediately (Ctrl+S, navigating away, opening the review screen). */
  flush(): Promise<void>;
}

export interface AutosaveOptions {
  api: WdrApi;
  submissionId: Uuid | null;
  enabled: boolean;
  debounceMs?: number;
  /**
   * Per-row results. Autosave uses p_atomic = false so one bad cell cannot
   * discard the operator's other keystrokes; each failed cell is reported back
   * and stays visibly unsaved.
   */
  onResult(result: BulkUpsertResult, keys: string[]): void;
  onError(error: unknown, keys: string[]): void;
  onFlushStart(keys: string[]): void;
}

export function useAutosave(opts: AutosaveOptions): AutosaveHandle {
  const { api, submissionId, enabled, debounceMs = 800 } = opts;
  const queueRef = useRef<SaveQueue>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const [queued, setQueued] = useState(0);
  const [saving, setSaving] = useState(false);

  // Keep the latest callbacks without restarting the debounce timer.
  const cbs = useRef(opts);
  cbs.current = opts;

  const send = useCallback(async () => {
    if (!submissionId || inFlightRef.current) return;
    const batch = Array.from(queueRef.current.values());
    if (batch.length === 0) return;

    const keys = queueKeys(queueRef.current);
    queueRef.current = new Map();
    setQueued(0);
    inFlightRef.current = true;
    setSaving(true);
    cbs.current.onFlushStart(keys);

    try {
      const result = await cbs.current.api.bulkUpsert(submissionId, batch, false);
      cbs.current.onResult(result, keys);
    } catch (err) {
      cbs.current.onError(err, keys);
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      // Anything typed while the request was in flight goes out right away.
      if (queueRef.current.size > 0) void send();
    }
  }, [api, submissionId]);

  const push = useCallback(
    (entries: BulkEntryInput[]) => {
      if (!enabled || entries.length === 0) return;
      queueRef.current = enqueue(queueRef.current, entries);
      setQueued(queueRef.current.size);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void send(), debounceMs);
    },
    [enabled, debounceMs, send],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await send();
  }, [send]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Warn before losing keystrokes that never reached the database.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (queueRef.current.size > 0 || inFlightRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return { queued, saving, push, flush };
}
