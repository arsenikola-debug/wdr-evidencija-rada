/**
 * 0077 — nacrti osnovnog Unosa: jedno mesto za dva pravila prikaza.
 *
 * Server je konačna instanca (rpc_delete_draft_submission, rpc_bulk_upsert_*);
 * ovde se odlučuje samo KADA frontend pravi nacrt i KADA nudi brisanje.
 */
import type { BulkEntryInput, SubmissionStatus } from '../../lib/api/types';

/**
 * Smislena izmena = bar jedan unos koji POSTAVLJA vrednost (status/smena), tj. nije
 * `delete: true`. To je isti uslov pod kojim baza upisuje red u work_entries.
 * Brisanje prazne ćelije se ni ne šalje (ALREADY_EMPTY), pa ne pravi nacrt.
 */
export function isMeaningfulBatch(entries: readonly BulkEntryInput[]): boolean {
  return entries.some((e) => e.delete !== true);
}

export interface DraftHistory {
  status: SubmissionStatus;
  submitted_at?: string | null;
  returned_at?: string | null;
  approved_at?: string | null;
  closed_at?: string | null;
}

/**
 * Nacrt koji sme da se obriše: DRAFT koji NIKADA nije poslat, vraćen, odobren ni
 * zatvoren. Isto pravilo kao server; server dodatno proverava obračun, korekcije,
 * potvrđena upozorenja i pravo izmene za centar.
 */
export function isDeletableDraft(s: DraftHistory): boolean {
  return s.status === 'DRAFT'
    && !s.submitted_at && !s.returned_at && !s.approved_at && !s.closed_at;
}

export const DELETE_DRAFT_CONFIRM = 'Obrisati nacrt? Ova radnja se ne može opozvati.';

/**
 * „Obriši nacrt" se nudi SAMO autoru nikad-poslatog nacrta (server:
 * created_by = pozivalac, bez admin izuzetka). Nacrt bez autora se ne nudi.
 */
export function canDeleteOwnDraft(
  item: { deletable_draft?: boolean; created_by?: string | null },
  profileId: string | null | undefined,
): boolean {
  return Boolean(item.deletable_draft && item.created_by && profileId && item.created_by === profileId);
}

/**
 * Bezbedan redosled brisanja nacrta (ponašanje testirano u draftsConcurrency.test.ts):
 *  1. `lock()` — unos se zaključava (ništa novo ne ulazi u autosave);
 *  2. `flush()` — šalje i ČEKA sve, uključujući slanje koje je već u toku;
 *  3. `remove()` — serversko brisanje (server ponovo proverava sve uslove);
 *  4. `after()` — osvežavanje liste / promena ekrana.
 * Ako brisanje ne uspe, `unlock()` vraća unos (nacrt i dalje postoji).
 */
export async function deleteDraftSafely(steps: {
  lock(): void;
  unlock(): void;
  flush(): Promise<void>;
  remove(): Promise<unknown>;
  after(): Promise<void> | void;
}): Promise<void> {
  steps.lock();
  try {
    await steps.flush();
    await steps.remove();
  } catch (err) {
    steps.unlock();
    throw err;
  }
  await steps.after();
}
