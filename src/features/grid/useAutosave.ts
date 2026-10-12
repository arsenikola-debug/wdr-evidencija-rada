import { useCallback, useEffect, useRef, useState } from 'react';
import type { BulkEntryInput, BulkUpsertResult, Uuid } from '../../lib/api/types';
import type { WdrApi } from '../../lib/api/WdrApi';
import { AutosaveEngine, type CreateFirst, type Owner, type SaveQueue } from './autosaveEngine';

export {
  autosaveDecision, enqueue, sendBatch,
  type AutosaveDecision, type SaveQueue,
} from './autosaveEngine';

export function queueKeys(queue: SaveQueue): string[] {
  return Array.from(queue.keys());
}

export interface AutosaveHandle {
  /** Number of cells waiting to be sent. */
  queued: number;
  /** A request is currently in flight. */
  saving: boolean;
  push(entries: BulkEntryInput[]): void;
  /**
   * Send immediately AND wait (Ctrl+S, navigating away, opening the review
   * screen, switching period, deleting a draft). Resolves only when nothing is
   * queued and nothing is in flight.
   */
  flush(): Promise<void>;
}

export interface AutosaveOptions {
  api: WdrApi;
  submissionId: Uuid | null;
  enabled: boolean;
  debounceMs?: number;
  /**
   * Kontekst grida (ID prijave ili ključ pregleda nove prijave). Svaki paket je
   * vezan za kontekst u kom je unet; promena konteksta šalje stare pakete
   * njihovom vlasniku, nikad u novu prijavu. Podrazumevano: submissionId.
   */
  contextKey?: string;
  /**
   * Per-row results. Autosave uses p_atomic = false so one bad cell cannot
   * discard the operator's other keystrokes; each failed cell is reported back
   * and stays visibly unsaved. `stale` = paket pripada prethodnom kontekstu
   * (podatak je sačuvan u SVOJU prijavu; tekući grid se ne menja).
   */
  onResult(result: BulkUpsertResult, keys: string[], stale?: boolean): void;
  onError(error: unknown, keys: string[], stale?: boolean): void;
  onFlushStart(keys: string[], stale?: boolean): void;
  /**
   * 0077: nova prijava još ne postoji (pregled). Prvi SMISLEN paket ide ovom
   * funkcijom: kreiranje + upis u JEDNOJ serverskoj transakciji. Vezuje se za
   * paket u trenutku unosa (pregled u kom je otkucan), ne u trenutku slanja.
   */
  createWithFirstBatch?: CreateFirst;
  /** 0077: paket koji u pregledu nema smislenu izmenu je odbačen (no-op). */
  onDiscard?(keys: string[], stale?: boolean): void;
}

export function useAutosave(opts: AutosaveOptions): AutosaveHandle {
  const { submissionId, enabled, debounceMs = 800 } = opts;
  const contextKey = opts.contextKey ?? submissionId ?? 'none';
  const [queued, setQueued] = useState(0);
  const [saving, setSaving] = useState(false);

  // Keep the latest callbacks without restarting the debounce timer.
  const cbs = useRef(opts);
  cbs.current = opts;
  const current = useRef({ key: contextKey, submissionId });
  current.current = { key: contextKey, submissionId };

  const engineRef = useRef<AutosaveEngine | null>(null);
  if (!engineRef.current) {
    const isStale = (owner: Owner) => {
      const now = current.current;
      if (owner.key === now.key) return false;
      const t = engineRef.current?.targetOf(owner) ?? null;
      return !(t && t === now.submissionId);
    };
    engineRef.current = new AutosaveEngine({
      bulkUpsert: (id, entries, atomic) => cbs.current.api.bulkUpsert(id, entries, atomic),
      onFlushStart: (keys, owner) => cbs.current.onFlushStart(keys, isStale(owner)),
      onResult: (result, keys, owner) => cbs.current.onResult(result, keys, isStale(owner)),
      onError: (err, keys, owner) => cbs.current.onError(err, keys, isStale(owner)),
      onDiscard: (keys, owner) => cbs.current.onDiscard?.(keys, isStale(owner)),
      onState: (s) => { setQueued(s.queued); setSaving(s.saving); },
      debounceMs,
    });
  }
  const engine = engineRef.current;
  engine.setEnabled(enabled);

  // Promena prijave/perioda: stari paketi odmah, SVOM vlasniku.
  useEffect(() => {
    engine.contextChanged(contextKey);
  }, [engine, contextKey]);

  const push = useCallback(
    (entries: BulkEntryInput[]) => {
      if (!enabled) return;
      engine.push(entries, {
        key: current.current.key,
        target: current.current.submissionId,
        create: current.current.submissionId ? undefined : cbs.current.createWithFirstBatch,
      });
    },
    [engine, enabled],
  );

  const flush = useCallback(() => engine.flush(), [engine]);

  useEffect(() => () => engine.dispose(), [engine]);

  // Warn before losing keystrokes that never reached the database.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (engine.queued > 0 || engine.saving) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [engine]);

  return { queued, saving, push, flush };
}
