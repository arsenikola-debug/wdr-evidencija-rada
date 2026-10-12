import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ perms: new Set<string>(['adjustment.create']) }));
vi.mock('../src/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ api: {}, can: (p: string) => auth.perms.has(p), session: null, loading: false }),
}));

import { DELETE_DRAFT_CONFIRM, canDeleteOwnDraft, isDeletableDraft, isMeaningfulBatch } from '../src/features/entry/drafts';
import { autosaveDecision, sendBatch } from '../src/features/grid/useAutosave';
import { withAdoption } from '../src/features/grid/useGrid';
import { MockWdrApi } from '../src/lib/api/mockApi';
import { CorrectionBatches } from '../src/routes/CorrectionBatches';
import type { BulkEntryInput, BulkUpsertResult } from '../src/lib/api/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '..', 'src', rel), 'utf8');
const B6 = '10000000-0000-0000-0000-0000000000b6';
const E = 'e1'; // mock zaposleni (B6, KARNET)
const set: BulkEntryInput = { employee_id: E, work_date: '2026-07-14', attendance_status: 'GO' };
const del: BulkEntryInput = { employee_id: E, work_date: '2026-07-14', delete: true };

async function operator() {
  const api = new MockWdrApi({ role: 'operator' });
  await api.signIn('operater@wdr.local', 'mock1234');
  return api;
}

// =============================================================================
describe('smislena izmena i nacrt koji sme da se obriše', () => {
  it('smislena izmena = bar jedan unos koji postavlja vrednost (ne samo brisanje)', () => {
    expect(isMeaningfulBatch([set])).toBe(true);
    expect(isMeaningfulBatch([del, set])).toBe(true);
    expect(isMeaningfulBatch([del])).toBe(false);
    expect(isMeaningfulBatch([])).toBe(false);
  });

  it('brisanje samo za DRAFT koji nikada nije poslat/vraćen/odobren/zatvoren', () => {
    expect(isDeletableDraft({ status: 'DRAFT' })).toBe(true);
    for (const status of ['READY_FOR_REVIEW', 'SUBMITTED', 'RETURNED', 'FINANCE_APPROVED', 'CLOSED'] as const) {
      expect(isDeletableDraft({ status }), status).toBe(false);
    }
    expect(isDeletableDraft({ status: 'DRAFT', submitted_at: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(isDeletableDraft({ status: 'DRAFT', returned_at: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(DELETE_DRAFT_CONFIRM).toBe('Obrisati nacrt? Ova radnja se ne može opozvati.');
  });
});

// =============================================================================
describe('autosave: nacrt nastaje tek pri smislenoj izmeni', () => {
  it('postojeća prijava: šalje se kao i ranije (i samo brisanje)', () => {
    expect(autosaveDecision('sub-1', [set], false)).toBe('send');
    expect(autosaveDecision('sub-1', [del], true)).toBe('send');
  });
  it('pregled nove prijave: smislena izmena → prvo nacrt, pa slanje', () => {
    expect(autosaveDecision(null, [set], true)).toBe('create-then-send');
  });
  it('pregled bez smislene izmene → ništa se ne pravi i ne šalje', () => {
    expect(autosaveDecision(null, [del], true)).toBe('skip');
    expect(autosaveDecision(null, [], true)).toBe('skip');
    expect(autosaveDecision(null, [set], false)).toBe('skip');
  });
});

// =============================================================================
const OK: BulkUpsertResult = { atomic: false, succeeded: 1, failed: 0, results: [], validation: {} } as unknown as BulkUpsertResult;

describe('prvo čuvanje je atomsko; prijava se usvaja tek posle uspeha', () => {
  it('postojeći nacrt: autosave je nepromenjen (bulkUpsert, bez prvog čuvanja)', async () => {
    const calls: string[] = [];
    const r = await sendBatch('sub-1', [set], {
      bulkUpsert: async (id, e, atomic) => { calls.push(`bulk:${id}:${e.length}:${atomic}`); return OK; },
      createWithFirstBatch: async () => { calls.push('first'); return { submissionId: 'x', result: OK }; },
    });
    expect(calls).toEqual(['bulk:sub-1:1:false']);
    expect(r.target).toBe('sub-1');
  });

  it('pregled: JEDAN atomski poziv (kreiranje + paket), bez zasebnog bulkUpsert-a', async () => {
    const calls: string[] = [];
    const r = await sendBatch(null, [set], {
      bulkUpsert: async () => { calls.push('bulk'); return OK; },
      createWithFirstBatch: async (b) => { calls.push(`first:${b.length}`); return { submissionId: 'new-1', result: OK }; },
    });
    expect(calls).toEqual(['first:1']);
    expect(r.target).toBe('new-1');
  });

  it('neuspeh prvog čuvanja: greška se prosleđuje, nema cilja (ostaje pregled)', async () => {
    await expect(sendBatch(null, [set], {
      bulkUpsert: async () => OK,
      createWithFirstBatch: async () => { throw new Error('mreža'); },
    })).rejects.toThrow('mreža');
  });

  it('onAdopted se NE poziva pre uspeha kompletnog prvog čuvanja', async () => {
    const log: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((r) => { release = r; });
    const wrapped = withAdoption(async () => { log.push('create:start'); await pending; log.push('create:done');
      return { submissionId: 'new-1', result: OK }; }, (id) => log.push(`adopt:${id}`));
    const p = wrapped([set]);
    await Promise.resolve();
    expect(log).toEqual(['create:start']); // dok traje — nema usvajanja
    release();
    await p;
    expect(log).toEqual(['create:start', 'create:done', 'adopt:new-1']);

    const log2: string[] = [];
    const failing = withAdoption(async () => { throw new Error('FIRST_SAVE_FAILED'); }, (id) => log2.push(`adopt:${id}`));
    await expect(failing([set])).rejects.toThrow('FIRST_SAVE_FAILED');
    expect(log2).toEqual([]); // neuspeh → bez usvajanja, bez URL-a
  });

  it('mock: simulirani neuspeh prvog upisa → nema novog nacrta', async () => {
    const api = await operator();
    const before = (await api.listSubmissions()).length;
    api.failNextFirstSave = true;
    await expect(api.createPeriodSubmissionWithEntries(B6, '2026-07-13', '2026-07-19', 'KARNET', [set]))
      .rejects.toMatchObject({ code: 'FIRST_SAVE_FAILED' });
    expect((await api.listSubmissions()).length).toBe(before);
    await expect(api.createPeriodSubmissionWithEntries(B6, '2026-07-13', '2026-07-19', 'KARNET', []))
      .rejects.toMatchObject({ code: 'FIRST_SAVE_EMPTY' });
    expect((await api.listSubmissions()).length).toBe(before);
  });

  it('mock: uspešan prvi unos → nacrt (autor = korisnik) i upis zajedno', async () => {
    const api = await operator();
    const me = (await api.getSession())!.profile_id;
    const r = await api.createPeriodSubmissionWithEntries(B6, '2026-07-13', '2026-07-19', 'KARNET', [set]);
    expect(r.submission.created).toBe(true);
    expect(r.upsert.succeeded).toBe(1);
    const item = (await api.listSubmissions()).find((x) => x.id === r.submission.submission_id)!;
    expect(item).toMatchObject({ deletable_draft: true, created_by: me });
  });
});

// =============================================================================
describe('tok kroz API (mock ogleda 0077)', () => {
  it('otvaranje novog unosa i izlazak bez izmene → nema novog zapisa', async () => {
    const api = await operator();
    const before = (await api.listSubmissions()).length;
    const pv = await api.previewNewPeriodSubmission(B6, '2026-07-13', '2026-07-19', 'KARNET');
    expect(pv.preview).toBe(true);
    if (!pv.preview) throw new Error('expected preview');
    expect(pv.grid.submission.id).toBe('');
    expect(pv.grid.submission.preview).toBe(true);
    expect(pv.grid.dates).toHaveLength(7);
    expect(pv.eligibility.submission_id).toBe('');
    expect((await api.listSubmissions()).length).toBe(before);
  });

  it('prva izmena pravi nacrt (deletable); ponovni pregled istog perioda vraća postojeći', async () => {
    const api = await operator();
    const before = (await api.listSubmissions()).length;
    const created = (await api.createPeriodSubmissionWithEntries(B6, '2026-07-13', '2026-07-19', 'KARNET', [set])).submission;
    expect(created.created).toBe(true);
    const list = await api.listSubmissions();
    expect(list.length).toBe(before + 1);
    expect(list.find((x) => x.id === created.submission_id)?.deletable_draft).toBe(true);
    const again = await api.previewNewPeriodSubmission(B6, '2026-07-13', '2026-07-19', 'KARNET');
    expect(again).toEqual({ preview: false, existing_submission_id: created.submission_id });
  });

  it('nacrt može da se obriše; brisanje jednog ne dira druge; drugi pokušaj → ne postoji', async () => {
    const api = await operator();
    const a = await api.createPeriodSubmission(B6, '2026-07-13', '2026-07-19', 'KARNET');
    const b = await api.createPeriodSubmission(B6, '2026-07-20', '2026-07-26', 'KARNET');
    const before = await api.listSubmissions();
    await api.deleteDraftSubmission(a.submission_id);
    const after = await api.listSubmissions();
    expect(after.some((x) => x.id === a.submission_id)).toBe(false);
    expect(after.some((x) => x.id === b.submission_id)).toBe(true);
    expect(after.length).toBe(before.length - 1);
    await expect(api.deleteDraftSubmission(a.submission_id)).rejects.toMatchObject({ code: 'SUBMISSION_NOT_FOUND' });
  });

  it('poslat/potvrđen/odobren zapis (i nacrt sa istorijom slanja) → nema brisanja', async () => {
    const api = await operator();
    // ugrađena prijava mock-a nije novi nacrt (fixture)
    await expect(api.deleteDraftSubmission('66666666-6666-6666-6666-666666666601'))
      .rejects.toMatchObject({ code: 'DRAFT_DELETE_NOT_DRAFT' });
    const c = await api.createPeriodSubmission(B6, '2026-07-13', '2026-07-19', 'KARNET');
    api.everSubmitted.add(c.submission_id);
    expect((await api.listSubmissions()).find((x) => x.id === c.submission_id)?.deletable_draft).toBe(false);
    await expect(api.deleteDraftSubmission(c.submission_id)).rejects.toMatchObject({ code: 'DRAFT_DELETE_NOT_DRAFT' });
  });

  it('samo AUTOR: tuđi nacrt istog centra i nacrt bez autora se ne brišu', async () => {
    const api = await operator();
    const a = await api.createPeriodSubmission(B6, '2026-07-13', '2026-07-19', 'KARNET');
    const b = await api.createPeriodSubmission(B6, '2026-07-20', '2026-07-26', 'KARNET');
    const list = (api as unknown as { createdSubmissions: Array<{ id: string; created_by?: string | null }> }).createdSubmissions;
    list.find((x) => x.id === a.submission_id)!.created_by = '22222222-2222-2222-2222-2222222222b6'; // kolega
    list.find((x) => x.id === b.submission_id)!.created_by = null;                                   // bez autora
    await expect(api.deleteDraftSubmission(a.submission_id)).rejects.toMatchObject({ code: 'DRAFT_DELETE_NOT_AUTHOR' });
    await expect(api.deleteDraftSubmission(b.submission_id)).rejects.toMatchObject({ code: 'DRAFT_DELETE_NOT_AUTHOR' });
    expect((await api.listSubmissions()).filter((x) => [a.submission_id, b.submission_id].includes(x.id))).toHaveLength(2);
  });

  it('„Obriši nacrt" se nudi samo autoru (bez autora — nikome)', () => {
    expect(canDeleteOwnDraft({ deletable_draft: true, created_by: 'p1' }, 'p1')).toBe(true);
    expect(canDeleteOwnDraft({ deletable_draft: true, created_by: 'p1' }, 'p2')).toBe(false);
    expect(canDeleteOwnDraft({ deletable_draft: true, created_by: null }, 'p1')).toBe(false);
    expect(canDeleteOwnDraft({ deletable_draft: false, created_by: 'p1' }, 'p1')).toBe(false);
    expect(canDeleteOwnDraft({ deletable_draft: true, created_by: 'p1' }, null)).toBe(false);
  });

  it('bez prava izmene nacrta nema brisanja', async () => {
    const fin = new MockWdrApi({ role: 'finance' });
    await fin.signIn('finansije@wdr.local', 'mock1234');
    await expect(fin.deleteDraftSubmission('77777777-7777-7777-7777-000000000001')).rejects.toBeTruthy();
  });
});

// =============================================================================
describe('Unos (DailyEntry) i Moje prijave — granice izmene', () => {
  const entry = read('routes/DailyEntry.tsx');
  it('otvaranje nove prijave koristi pregled; prijava nastaje SAMO atomskim prvim čuvanjem', () => {
    expect(entry).toContain('api.previewNewPeriodSubmission(centerId, from, to, type)');
    expect(entry.match(/api\.createPeriodSubmission\(/g) ?? []).toHaveLength(0);
    const first = entry.slice(entry.indexOf('createWithFirstBatch: newDraft ? async (batch) => {'), entry.indexOf('onAdopted:'));
    expect(first.length).toBeGreaterThan(50);
    expect(first).toContain('api.createPeriodSubmissionWithEntries(k.centerId, k.from, k.to, k.type, batch)');
    expect(first).toContain('return { submissionId: res.submission_id, result: first.upsert };');
  });

  it('„Obriši nacrt": samo nikad-poslat nacrt, potvrda, autosave se završi pre brisanja', () => {
    expect(entry).toContain("canDeleteOwnDraft(current, session?.profile_id)");
    expect(entry).toMatch(/window\.confirm\(DELETE_DRAFT_CONFIRM\)[\s\S]{0,400}flush: \(\) => grid\.flush\(\),[\s\S]{0,200}remove: \(\) => api\.deleteDraftSubmission\(id\)/);
    expect(entry).toMatch(/after: async \(\) => \{\s*setSubmissions\(await api\.listSubmissions\(\)\)/);
    const mine = read('routes/MySubmissions.tsx');
    expect(mine).toContain("canDeleteOwnDraft(s, session?.profile_id) && can('entry.edit_draft')");
    expect(mine).toMatch(/window\.confirm\(DELETE_DRAFT_CONFIRM\)[\s\S]{0,200}api\.deleteDraftSubmission\(s\.id\)[\s\S]{0,80}setItems\(await api\.listSubmissions\(\)\)/);
  });

  it('pregled nove prijave: jasna poruka, bez linka na Pregled i bez localStorage ključa bez ID-a', () => {
    expect(entry).toContain('Nov unos — ništa nije sačuvano.');
    expect(entry).toMatch(/if \(!grid\.payload!\.submission\.id\) \{[\s\S]{0,200}Nacrt još nije sačuvan/);
    expect(entry).toMatch(/if \(grid\.payload!\.submission\.id\) \{\s*window\.localStorage\.setItem/);
  });

  it('autosave: hook koristi AutosaveEngine (ponašanje: draftsConcurrency.test.ts); paket vezan za kontekst pri unosu', () => {
    const src = read('features/grid/useAutosave.ts');
    expect(src).toContain('new AutosaveEngine(');
    expect(src).toMatch(/engine\.push\(entries, \{\s*key: current\.current\.key,\s*target: current\.current\.submissionId,/);
    expect(src).toMatch(/engine\.contextChanged\(contextKey\)/);
    expect(src).not.toMatch(/targetRef/);
    const grid = read('features/grid/useGrid.ts');
    expect(grid).toMatch(/createWithFirstBatch: previewOptions\.createWithFirstBatch\s*\? withAdoption\(/);
    expect(grid).toContain('adoptIfCurrent(contextKey, () => contextKeyRef.current');
    const entry = read('routes/DailyEntry.tsx');
    // pre otvaranja drugog perioda: flush koji čeka
    expect(entry).toMatch(/async function openPeriod[\s\S]{0,400}await grid\.flush\(\);/);
    // brisanje: zaključaj → flush (čeka) → obriši
    expect(entry).toMatch(/deleteDraftSafely\(\{\s*lock: \(\) => setDeleting\(true\)/);
    expect(entry).toContain('readOnly: deleting,');
  });
});

// =============================================================================
describe('Korekcije obračuna → Nova korekcija: jedan ravan red na desktopu', () => {
  function render() {
    return renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(CorrectionBatches, { mode: 'operator' })));
  }

  it('labele iznad svojih polja (htmlFor), select/input/dugme kao kontrole istog reda', () => {
    const html = render();
    const form = html.slice(html.indexOf('class="correction-open-form"'));
    expect(form).toMatch(/<label class="cof-label-orig" for="cof-orig">Odobren obračun<\/label><select id="cof-orig" class="cof-orig"/);
    expect(form).toMatch(/<label class="cof-label-reason" for="cof-reason">Razlog \(najmanje 10 znakova\)<\/label><input id="cof-reason" class="cof-reason"/);
    expect(form).toMatch(/<button type="button" class="btn btn-primary cof-submit"[^>]*disabled=""[^>]*>Otvori korekciju<\/button>/);
  });

  it('CSS: grid sa redom labela i redom kontrola, iste visine, bez margin-top; usko → jedna kolona', () => {
    const css = read('styles.css');
    const block = css.slice(css.indexOf('.correction-open-form {'), css.indexOf('/* --- Unos: akcija nad nacrtom'));
    expect(block).toMatch(/grid-template-areas:\s*"label-orig label-reason \."\s*"orig\s+reason\s+submit";/);
    expect(block).toMatch(/\.correction-open-form select,\s*\.correction-open-form input,\s*\.correction-open-form \.cof-submit \{\s*height: 34px; box-sizing: border-box;/);
    expect(block).not.toMatch(/margin-top/);
    expect(block).toMatch(/@media \(max-width: 720px\)[\s\S]*grid-template-areas: "label-orig" "orig" "label-reason" "reason" "submit";/);
  });

  it('ostali ekrani sa .report-filters nisu dirani (forma ima svoju klasu)', () => {
    const src = read('routes/CorrectionBatches.tsx');
    const section = src.slice(src.indexOf('<h2>Nova korekcija</h2>'), src.indexOf('Otvori korekciju'));
    expect(section).not.toContain('report-filters');
    expect(section).toContain('className="correction-open-form"');
    expect(read('styles.css')).toContain('.report-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 12px; }');
  });
});
