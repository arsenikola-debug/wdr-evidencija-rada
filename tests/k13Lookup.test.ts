import { describe, expect, it } from 'vitest';
import { MockWdrApi } from '../src/lib/api/mockApi';
import type { PayoutRequestType } from '../src/lib/api/types';

/**
 * K13 (2026-09-25): kontrolisani globalni lookup zaposlenih u Dodatnim isplatama
 * i Stopovima. Serversko pravilo i bezbednost: pgTAP 132 (0066); mock ga ogleda.
 */
const B6 = '10000000-0000-0000-0000-0000000000b6';
const OTHER = 'x-bz-1'; // Arsenović Nikola, centar BZ

async function operator() {
  const api = new MockWdrApi({ role: 'operator' });
  await api.signIn('operater@wdr.local', 'mock1234');
  return api;
}

describe('K13 — globalni payout picker', () => {
  it('1. operater po imenu nalazi zaposlenog iz drugog centra', async () => {
    const api = await operator();
    const r = await api.payoutEmployeeSearch('Nikola Arsenovic');
    expect(r.items.map((i) => i.id)).toContain(OTHER);
    expect(r.items.find((i) => i.id === OTHER)?.center_code).toBe('BZ');
    // …a opšta lista zaposlenih (opseg operatera) ga i dalje ne vidi.
    const own = await api.getEmployees('Arsenović');
    expect(own.items.map((i) => i.id)).not.toContain(OTHER);
  });

  it('2. fuzzy: „Asenovic" nalazi „Arsenović"; radi i redosled i deo imena', async () => {
    const api = await operator();
    for (const q of ['Nikola Asenovic', 'Asenovic', 'Arsenović Nikola', 'arsen']) {
      expect((await api.payoutEmployeeSearch(q)).items.map((i) => i.id), q).toContain(OTHER);
    }
    expect((await api.payoutEmployeeSearch('x')).items).toHaveLength(0);
  });

  it('3. rezultat nosi samo dozvoljena identifikaciona polja', async () => {
    const api = await operator();
    const hit = (await api.payoutEmployeeSearch('Arsenovic', { from: '2026-07-13', to: '2026-07-19' }))
      .items.find((i) => i.id === OTHER)!;
    expect(Object.keys(hit).sort()).toEqual(
      ['active', 'center_code', 'employed_in_period', 'employee_code', 'full_name', 'id']);
    expect(hit.employed_in_period).toBe(true);
  });

  it('4–5. lookup ne daje pravo na profil ni izmenu zaposlenog drugog centra', async () => {
    const api = await operator();
    await expect(api.getEmployeeProfile(OTHER)).rejects.toBeTruthy();
    await expect(api.updateEmployee({ employee_id: OTHER, first_name: 'Nikola', last_name: 'X' }))
      .rejects.toBeTruthy();
  });

  it('6. zaposleni iz drugog centra se dodaje u sve vrste dodatnih isplata i u Stopove', async () => {
    const api = await operator();
    const types: PayoutRequestType[] = ['DNEVNICA', 'ISPOMOC', 'RADNA_SUBOTA', 'PREKOVREMENI', 'NOCNI_RAD'];
    for (const t of types) {
      const d = await api.payoutOpen(t, B6, '2026-07-13', '2026-07-19');
      const x = await api.payoutSetEmployees(d.request.id, [OTHER]);
      expect(x.employees.map((e) => e.employee_id), t).toContain(OTHER);
      expect(x.employees.find((e) => e.employee_id === OTHER)?.full_name).toBe('Arsenović Nikola');
    }
    const sub = await api.courierStopOpenSubmission('p1', B6) as { id: string };
    await expect(api.courierStopSetEntry(sub.id, OTHER, '2026-07-06', 10)).resolves.toBeTruthy();
  });

  it('7. osnovni Karnet/Obuka Unos ne koristi globalnu listu', async () => {
    const api = await operator();
    const subs = await api.listSubmissions();
    const grid = await api.getGrid(subs[0].id);
    expect(grid.employees.map((e) => e.employee_id)).not.toContain(OTHER);
    const elig = await api.getEntryEligibility(subs[0].id);
    expect(elig.days.some((d) => d.employee_id === OTHER)).toBe(false);
  });

  it('8. provera duplikata pre kreiranja gleda celu bazu (za razliku od opšte provere)', async () => {
    const api = await operator();
    const whole = await api.payoutEmployeeDuplicateCheck('Nikola', 'Asenovic');
    const m = whole.matches.find((x) => x.id === OTHER);
    expect(m).toMatchObject({ full_name: 'Arsenović Nikola', center_code: 'BZ', match_reason: 'SIMILAR_NAME' });
    expect(Object.keys(m!).sort()).toEqual(
      ['active', 'center_code', 'employee_code', 'full_name', 'id', 'match_reason', 'score']);
    const scoped = await api.checkEmployeeDuplicates(null, 'Nikola', 'Asenovic');
    expect([...scoped.exact_name, ...scoped.similar].map((x) => x.id)).not.toContain(OTHER);
  });

  it('finansije nemaju lookup', async () => {
    const fin = new MockWdrApi({ role: 'finance' });
    await fin.signIn('finance@wdr.local', 'mock1234');
    await expect(fin.payoutEmployeeSearch('Nikola')).rejects.toBeTruthy();
  });
});
