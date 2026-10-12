/**
 * Ponašanje autosave-a na granicama konteksta (0077). Pokreće se PRAVI
 * AutosaveEngine (isti kod koji koristi useAutosave) sa kontrolisanim tajmerom i
 * odloženim API odgovorima — proverava se šta se stvarno poziva i kojim redom.
 */
import { describe, expect, it } from 'vitest';
import { AutosaveEngine, type Owner } from '../src/features/grid/autosaveEngine';
import { adoptIfCurrent, withAdoption } from '../src/features/grid/useGrid';
import { deleteDraftSafely } from '../src/features/entry/drafts';
import type { BulkEntryInput, BulkUpsertResult } from '../src/lib/api/types';

const OK = (n: number): BulkUpsertResult =>
  ({ atomic: false, succeeded: n, failed: 0, results: [], validation: {} }) as unknown as BulkUpsertResult;
const cell = (emp: string, date: string, status = 'GO'): BulkEntryInput =>
  ({ employee_id: emp, work_date: date, attendance_status: status }) as BulkEntryInput;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Engine sa ručnim tajmerom i zapisom svakog poziva. */
function harness(opts: { holdBulk?: boolean } = {}) {
  const log: string[] = [];
  const bulkCalls: Array<{ id: string; entries: BulkEntryInput[] }> = [];
  const pendingBulk: Array<ReturnType<typeof deferred<BulkUpsertResult>>> = [];
  const errors: Array<{ owner: string; error: unknown }> = [];
  const results: Array<{ owner: string; target: string }> = [];
  let timer: (() => void) | null = null;
  const engine = new AutosaveEngine({
    bulkUpsert: (id, entries) => {
      bulkCalls.push({ id, entries });
      log.push(`bulk:${id}:${entries.map((e) => e.employee_id + '@' + e.work_date).join(',')}`);
      if (!opts.holdBulk) return Promise.resolve(OK(entries.length));
      const d = deferred<BulkUpsertResult>();
      pendingBulk.push(d);
      return d.promise;
    },
    onFlushStart: () => {},
    onResult: (_r, _k, owner, target) => { results.push({ owner: owner.key, target }); log.push(`result:${owner.key}->${target}`); },
    onError: (error, _k, owner) => { errors.push({ owner: owner.key, error }); log.push(`error:${owner.key}`); },
    onDiscard: (_k, owner) => log.push(`discard:${owner.key}`),
    schedule: (fn) => { timer = fn; return 1; },
    cancel: () => { timer = null; },
  });
  return {
    engine, log, bulkCalls, pendingBulk, errors, results,
    fireDebounce: () => { const f = timer; timer = null; f?.(); },
    hasTimer: () => timer !== null,
  };
}

const ownerA: Owner = { key: 'A', target: 'A' };
const ownerB: Owner = { key: 'B', target: 'B' };

function previewOwner(key: string, log: string[], hold?: ReturnType<typeof deferred<void>>): Owner {
  return {
    key, target: null,
    create: async (batch) => {
      log.push(`create:${key}:${batch.map((e) => e.employee_id + '@' + e.work_date).join(',')}`);
      if (hold) await hold.promise;
      return { submissionId: `new-${key}`, result: OK(batch.length) };
    },
  };
}

// =============================================================================
describe('1. stari autosave red ne prelazi u drugi period / prijavu', () => {
  it('A ima queued izmenu → prelazak na NOV pregled B: A završava samo u A, B NE nastaje', async () => {
    const h = harness();
    h.engine.push([cell('e1', '2026-07-07')], ownerA);      // queued, debounce još nije okinuo
    expect(h.engine.queued).toBe(1);
    h.engine.contextChanged('preview:B');                    // korisnik otvara drugi period
    await h.engine.flush();
    h.fireDebounce();                                        // i da je stari tajmer okinuo — prazan red
    await h.engine.flush();
    expect(h.log).toEqual(['bulk:A:e1@2026-07-07', 'result:A->A']);
    expect(h.log.some((l) => l.startsWith('create:'))).toBe(false);
    expect(h.engine.queued).toBe(0);
  });

  it('…posle prelaska, PRVA prava izmena u B tek tada pravi B (bez podataka iz A)', async () => {
    const h = harness();
    h.engine.push([cell('e1', '2026-07-07')], ownerA);
    h.engine.contextChanged('preview:B');
    await h.engine.flush();
    expect(h.log.some((l) => l.startsWith('create:'))).toBe(false);
    h.engine.push([cell('e2', '2026-07-14')], previewOwner('preview:B', h.log));
    await h.engine.flush();
    expect(h.log.filter((l) => l.startsWith('create:'))).toEqual(['create:preview:B:e2@2026-07-14']);
    expect(h.log).toContain('result:preview:B->new-preview:B');
  });

  it('A → POSTOJEĆA prijava B: queued podatak iz A ne ide u B', async () => {
    const h = harness();
    h.engine.push([cell('e1', '2026-07-07')], ownerA);
    // korisnik je već u B i kuca pre nego što je debounce poslao A
    h.engine.push([cell('e2', '2026-07-14')], ownerB);
    h.engine.contextChanged('B');
    await h.engine.flush();
    expect(h.bulkCalls.map((c) => [c.id, c.entries.map((e) => e.employee_id)])).toEqual([
      ['A', ['e1']], ['B', ['e2']],
    ]);
    // ni jedan red iz A nije u pozivu za B
    expect(h.bulkCalls.find((c) => c.id === 'B')!.entries.some((e) => e.employee_id === 'e1')).toBe(false);
  });

  it('promena konteksta dok je slanje A već u toku: čeka se, bez gubitka i bez upisa preko prijave', async () => {
    const h = harness({ holdBulk: true });
    h.engine.push([cell('e1', '2026-07-07')], ownerA);
    h.fireDebounce();                                        // slanje A je počelo
    expect(h.engine.saving).toBe(true);
    h.engine.push([cell('e1', '2026-07-08')], ownerA);       // još jedna izmena u A dok A traje
    h.engine.contextChanged('B');                            // prelazak na B
    h.engine.push([cell('e2', '2026-07-14')], ownerB);       // izmena u B

    let flushed = false;
    const f = h.engine.flush().then(() => { flushed = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(flushed).toBe(false);                             // flush ČEKA slanje u toku
    expect(h.bulkCalls).toHaveLength(1);

    h.pendingBulk[0].resolve(OK(1));                         // A #1 završen
    await new Promise((r) => setTimeout(r, 0));
    expect(h.bulkCalls.map((c) => c.id)).toEqual(['A', 'A']); // A #2 (ne u B)
    h.pendingBulk[1].resolve(OK(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.bulkCalls.map((c) => c.id)).toEqual(['A', 'A', 'B']);
    h.pendingBulk[2].resolve(OK(1));
    await f;
    expect(flushed).toBe(true);
    expect(h.bulkCalls.map((c) => `${c.id}:${c.entries[0].employee_id}@${c.entries[0].work_date}`)).toEqual([
      'A:e1@2026-07-07', 'A:e1@2026-07-08', 'B:e2@2026-07-14',
    ]);
    expect(h.errors).toEqual([]);
    expect(h.engine.queued).toBe(0);
    expect(h.engine.saving).toBe(false);
  });

  it('prvo čuvanje pregleda A u toku → prelazak na postojeću B: B izmene idu u B, nikad u nov nacrt A', async () => {
    const h = harness();
    const hold = deferred<void>();
    h.engine.push([cell('e1', '2026-07-07')], previewOwner('preview:A', h.log, hold));
    h.fireDebounce();                                        // prvo čuvanje A je počelo
    h.engine.contextChanged('B');
    h.engine.push([cell('e2', '2026-07-14')], ownerB);
    const f = h.engine.flush();
    hold.resolve();                                          // A je napravljen kasno
    await f;
    expect(h.log.filter((l) => l.startsWith('create:'))).toEqual(['create:preview:A:e1@2026-07-07']);
    expect(h.bulkCalls.map((c) => c.id)).toEqual(['B']);     // B nije preusmeren u new-preview:A
  });

  it('isti pregled: paket otkucan DOK traje prvo čuvanje ide u napravljen ID (bez drugog kreiranja)', async () => {
    const h = harness();
    const hold = deferred<void>();
    const owner = previewOwner('preview:A', h.log, hold);
    h.engine.push([cell('e1', '2026-07-07')], owner);
    h.fireDebounce();
    h.engine.push([cell('e1', '2026-07-08')], owner);       // korisnik kuca dalje
    const f = h.engine.flush();
    hold.resolve();
    await f;
    expect(h.log.filter((l) => l.startsWith('create:'))).toHaveLength(1);
    expect(h.bulkCalls.map((c) => c.id)).toEqual(['new-preview:A']);
  });

  it('kasno prvo čuvanje STAROG pregleda ne vraća korisnika (nema usvajanja); tekući se usvaja', async () => {
    let current = 'preview:A';
    const adopted: string[] = [];
    const wrapped = withAdoption(async () => ({ submissionId: 'new-A', result: OK(1) }),
      adoptIfCurrent('preview:A', () => current, (id) => adopted.push(id)));
    const p = wrapped([cell('e1', '2026-07-07')]);
    current = 'preview:B';                                   // korisnik je otvorio drugi period
    await p;
    expect(adopted).toEqual([]);
    const ok = withAdoption(async () => ({ submissionId: 'new-B', result: OK(1) }),
      adoptIfCurrent('preview:B', () => current, (id) => adopted.push(id)));
    await ok([cell('e2', '2026-07-14')]);
    expect(adopted).toEqual(['new-B']);
  });

  it('postojeći autosave za postojeći nacrt: debounce → jedan bulkUpsert u isti nacrt (nepromenjeno)', async () => {
    const h = harness();
    h.engine.push([cell('e1', '2026-07-07')], ownerA);
    h.engine.push([cell('e1', '2026-07-07', 'WORK')], ownerA); // poslednji upis pobeđuje
    expect(h.hasTimer()).toBe(true);
    h.fireDebounce();
    await h.engine.flush();
    expect(h.bulkCalls).toHaveLength(1);
    expect(h.bulkCalls[0]).toMatchObject({ id: 'A' });
    expect(h.bulkCalls[0].entries).toHaveLength(1);
    expect(h.bulkCalls[0].entries[0].attendance_status).toBe('WORK');
  });
});

// =============================================================================
describe('2. brisanje nacrta i autosave u toku', () => {
  it('brisanje čeka slanje u toku; posle brisanja nema reda ni slanja; nema ghost greške', async () => {
    const h = harness({ holdBulk: true });
    h.engine.push([cell('e1', '2026-07-07')], ownerA);
    h.fireDebounce();                                        // autosave u toku
    expect(h.engine.saving).toBe(true);
    const order: string[] = [];
    const del = deleteDraftSafely({
      lock: () => { h.engine.setEnabled(false); order.push('lock'); },
      unlock: () => { h.engine.setEnabled(true); order.push('unlock'); },
      flush: () => h.engine.flush(),
      remove: async () => {
        order.push(`remove(saving=${h.engine.saving},queued=${h.engine.queued})`);
        return { deleted: true };
      },
      after: () => { order.push('after'); },
    });
    // dok je zaključano, nova izmena se ne prima (ne može da ode u obrisanu prijavu)
    h.engine.push([cell('e1', '2026-07-08')], ownerA);
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['lock']);                         // brisanje još čeka
    h.pendingBulk[0].resolve(OK(1));
    await del;
    expect(order).toEqual(['lock', 'remove(saving=false,queued=0)', 'after']);
    expect(h.bulkCalls).toHaveLength(1);                     // samo započeti upis, ništa posle
    expect(h.engine.queued).toBe(0);
    expect(h.engine.saving).toBe(false);
    expect(h.errors).toEqual([]);
    h.fireDebounce();                                        // čak i kasni tajmer — nema poziva
    await h.engine.flush();
    expect(h.bulkCalls).toHaveLength(1);
  });

  it('ako brisanje ne uspe: unos se otključava, nacrt i dalje radi', async () => {
    const h = harness();
    await expect(deleteDraftSafely({
      lock: () => h.engine.setEnabled(false),
      unlock: () => h.engine.setEnabled(true),
      flush: () => h.engine.flush(),
      remove: async () => { throw new Error('DRAFT_DELETE_NOT_AUTHOR'); },
      after: () => {},
    })).rejects.toThrow('DRAFT_DELETE_NOT_AUTHOR');
    h.engine.push([cell('e1', '2026-07-07')], ownerA);
    await h.engine.flush();
    expect(h.bulkCalls).toHaveLength(1);
  });

  it('greška slanja u toku pre brisanja se prijavljuje (ne gubi se tiho) i brisanje se i dalje izvršava', async () => {
    const h = harness({ holdBulk: true });
    h.engine.push([cell('e1', '2026-07-07')], ownerA);
    h.fireDebounce();
    const order: string[] = [];
    const del = deleteDraftSafely({
      lock: () => h.engine.setEnabled(false), unlock: () => h.engine.setEnabled(true),
      flush: () => h.engine.flush(),
      remove: async () => { order.push('remove'); },
      after: () => { order.push('after'); },
    });
    h.pendingBulk[0].reject(new Error('mreža'));
    await del;
    expect(h.errors.map((e) => e.owner)).toEqual(['A']);     // prijavljeno vlasniku A
    expect(order).toEqual(['remove', 'after']);
    expect(h.engine.saving).toBe(false);
  });
});
