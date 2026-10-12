/**
 * Autosave red — čista logika (bez React-a), da bi granice konkurentnosti mogle
 * da se testiraju ponašanjem, ne čitanjem izvornog koda.
 *
 * Garancije:
 *  1. Svaki paket je pri unosu VEZAN za svoj kontekst (`owner`: ključ konteksta,
 *     ID prijave ili funkcija prvog čuvanja tog pregleda). Šalje se isključivo
 *     tom vlasniku — promena prijave/perioda ga nikad ne preusmerava.
 *  2. Promena konteksta šalje stare pakete ODMAH, njihovim vlasnicima; novi
 *     kontekst počinje prazan (nov nacrt ne nastaje od starog paketa).
 *  3. `flush()` se vraća tek kada nema ni paketa u redu ni slanja u toku
 *     („flush and wait"), pa brisanje nacrta posle njega nema više kome da piše.
 *  4. Prvo čuvanje pregleda (`create`) daje ID; kasniji paketi istog pregleda,
 *     uneti dok je prvo čuvanje trajalo, idu u taj ID (nikad drugo kreiranje).
 */
import type { BulkEntryInput, BulkUpsertResult, Uuid } from '../../lib/api/types';
import { cellKey } from './model';
import { isMeaningfulBatch } from '../entry/drafts';

export type SaveQueue = Map<string, BulkEntryInput>;
export type CreateFirst = (batch: BulkEntryInput[]) => Promise<{ submissionId: Uuid; result: BulkUpsertResult }>;

/** Kome paket pripada — zamrznuto u trenutku unosa. */
export interface Owner {
  key: string;
  target: Uuid | null;
  create?: CreateFirst;
}

/** Last write per cell wins (isto kao ranije). */
export function enqueue(queue: SaveQueue, entries: BulkEntryInput[]): SaveQueue {
  const next = new Map(queue);
  for (const e of entries) next.set(cellKey(e.employee_id, e.work_date), e);
  return next;
}

export type AutosaveDecision = 'send' | 'create-then-send' | 'skip';

export function autosaveDecision(
  target: Uuid | null, batch: readonly BulkEntryInput[], canEnsure: boolean,
): AutosaveDecision {
  if (batch.length === 0) return 'skip';
  if (target) return 'send';
  return canEnsure && isMeaningfulBatch(batch) ? 'create-then-send' : 'skip';
}

export async function sendBatch(
  target: Uuid | null,
  batch: BulkEntryInput[],
  deps: {
    bulkUpsert(id: Uuid, entries: BulkEntryInput[], atomic: boolean): Promise<BulkUpsertResult>;
    createWithFirstBatch?: CreateFirst;
  },
): Promise<{ target: Uuid; result: BulkUpsertResult }> {
  if (target) return { target, result: await deps.bulkUpsert(target, batch, false) };
  if (!deps.createWithFirstBatch) throw new Error('Nema prijave za upis.');
  const r = await deps.createWithFirstBatch(batch);
  return { target: r.submissionId, result: r.result };
}

export interface EngineDeps {
  bulkUpsert(id: Uuid, entries: BulkEntryInput[], atomic: boolean): Promise<BulkUpsertResult>;
  onFlushStart(keys: string[], owner: Owner): void;
  onResult(result: BulkUpsertResult, keys: string[], owner: Owner, target: Uuid): void;
  onError(error: unknown, keys: string[], owner: Owner): void;
  onDiscard?(keys: string[], owner: Owner): void;
  onState?(state: { queued: number; saving: boolean }): void;
  debounceMs?: number;
  schedule?(fn: () => void, ms: number): unknown;
  cancel?(handle: unknown): void;
}

interface Pending { owner: Owner; queue: SaveQueue }

export class AutosaveEngine {
  private pending: Pending[] = [];
  private inFlight: Promise<void> | null = null;
  private timer: unknown = null;
  /** ključ pregleda → ID nacrta koji je napravilo njegovo prvo čuvanje */
  private created = new Map<string, Uuid>();
  private enabled = true;

  constructor(private deps: EngineDeps) {}

  setDeps(deps: EngineDeps): void { this.deps = deps; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  get queued(): number { return this.pending.reduce((n, p) => n + p.queue.size, 0); }
  get saving(): boolean { return this.inFlight !== null; }
  /** Stvarni cilj vlasnika (uključujući ID koji je napravilo njegovo prvo čuvanje). */
  targetOf(owner: Owner): Uuid | null { return owner.target ?? this.created.get(owner.key) ?? null; }

  push(entries: BulkEntryInput[], owner: Owner): void {
    if (!this.enabled || entries.length === 0) return;
    const last = this.pending[this.pending.length - 1];
    if (last && last.owner.key === owner.key) last.queue = enqueue(last.queue, entries);
    else this.pending.push({ owner, queue: enqueue(new Map(), entries) });
    this.emit();
    this.cancelTimer();
    const schedule = this.deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = schedule(() => { this.timer = null; void this.kick(); }, this.deps.debounceMs ?? 800);
  }

  /** Kontekst je promenjen: paketi drugih vlasnika idu odmah — svojim vlasnicima. */
  contextChanged(currentKey: string): void {
    if (this.pending.some((p) => p.owner.key !== currentKey)) {
      this.cancelTimer();
      void this.kick();
    }
  }

  /** Vraća se tek kada nema ni reda ni slanja u toku. Ne baca grešku. */
  async flush(): Promise<void> {
    this.cancelTimer();
    while (this.inFlight || this.pending.length > 0) {
      await (this.inFlight ?? this.kick());
    }
  }

  dispose(): void { this.cancelTimer(); }

  private cancelTimer(): void {
    if (this.timer !== null) {
      (this.deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
      this.timer = null;
    }
  }

  private emit(): void { this.deps.onState?.({ queued: this.queued, saving: this.saving }); }

  /** Šalje pakete redom (jedan po jedan); vraća obećanje tekućeg slanja. */
  private kick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const next = this.pending.shift();
    if (!next) return Promise.resolve();
    const run = this.sendOne(next).finally(() => {
      this.inFlight = null;
      this.emit();
      // Ono što je otkucano dok je slanje trajalo ide odmah.
      if (this.pending.length > 0) void this.kick();
    });
    this.inFlight = run;
    this.emit();
    return run;
  }

  private async sendOne(p: Pending): Promise<void> {
    const keys = Array.from(p.queue.keys());
    const batch = Array.from(p.queue.values());
    const target = this.targetOf(p.owner);
    if (autosaveDecision(target, batch, Boolean(p.owner.create)) === 'skip') {
      // Pregled bez smislene izmene (npr. uneto pa obrisano pre slanja): no-op.
      if (!target) this.deps.onDiscard?.(keys, p.owner);
      return;
    }
    this.deps.onFlushStart(keys, p.owner);
    try {
      const sent = await sendBatch(target, batch, {
        bulkUpsert: (id, e, atomic) => this.deps.bulkUpsert(id, e, atomic),
        createWithFirstBatch: p.owner.create,
      });
      if (!target) this.created.set(p.owner.key, sent.target); // tek posle USPEHA
      this.deps.onResult(sent.result, keys, p.owner, sent.target);
    } catch (err) {
      this.deps.onError(err, keys, p.owner);
    }
  }
}
