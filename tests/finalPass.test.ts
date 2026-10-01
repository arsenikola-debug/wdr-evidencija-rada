import { describe, expect, it } from 'vitest';
import { employeePeriodRows, type PeriodLine } from '../src/features/finance/employeeSummary';
import { mapKey } from '../src/features/grid/keyboard';
import { parseCellInput, periodError } from '../src/features/payouts/model';
import { splitSourceName } from '../src/routes/AdminImport';
import { MockWdrApi } from '../src/lib/api/mockApi';
import type { PayoutRequestType } from '../src/lib/api/types';

/** Završni production-ready prolaz (2026-10): finalna payout pravila i UX pravila. */
const B6 = '10000000-0000-0000-0000-0000000000b6';

async function operator() {
  const api = new MockWdrApi({ role: 'operator' });
  await api.signIn('operater@wdr.local', 'mock1234');
  return api;
}

async function fill(type: PayoutRequestType, days: Array<[string, string, number]>) {
  const op = await operator();
  const d = await op.payoutOpen(type, B6, '2026-07-13', '2026-07-19');
  await op.payoutSetEmployees(d.request.id, [...new Set(days.map((x) => x[0]))]);
  let last = d;
  for (const [e, date, units] of days) {
    last = await op.payoutSetLine({ request_id: d.request.id, employee_id: e, work_date: date, units });
  }
  return last;
}

describe('Unos: period i kontekst', () => {
  it('1 dan i tačno 7 dana su ispravni, 8 dana je odbijeno', () => {
    expect(periodError('2026-10-05', '2026-10-05')).toBeNull();
    expect(periodError('2026-10-05', '2026-10-11')).toBeNull();
    expect(periodError('2026-10-05', '2026-10-12')).toMatch(/najviše 7/);
  });
  it('nema prečice koja kopira dnevne podatke prethodne nedelje (K12)', () => {
    expect(mapKey({ key: 'D', ctrlKey: true, shiftKey: true })).toBeNull();
  });
});

describe('Dodatne isplate — finalna pravila', () => {
  it('DNEVNICA: 1 dan = 4000, 2 dana = 8000, više zaposlenih', async () => {
    const one = await fill('DNEVNICA', [['e1', '2026-07-13', 1]]);
    expect(one.totals.amount).toBe(4000);
    const two = await fill('DNEVNICA', [['e1', '2026-07-13', 1], ['e1', '2026-07-14', 1], ['e2', '2026-07-13', 1]]);
    expect(two.summary.find((s) => s.employee_id === 'e1')?.amount).toBe(8000);
    expect(two.totals.amount).toBe(12000);
  });
  it('RADNA_SUBOTA: samo subota, po danu — jedna subota × 4000 (0069)', async () => {
    const d = await fill('RADNA_SUBOTA', [['e1', '2026-07-18', 1]]);
    expect(d.totals.amount).toBe(4000);
    expect(d.request.input_mode).toBe('DAYS');
    expect(d.request.saturday_only).toBe(true);
  });
  it('RADNA_SUBOTA: ponedeljak–petak i nedelja su odbijeni', async () => {
    const op = await operator();
    const d = await op.payoutOpen('RADNA_SUBOTA', B6, '2026-07-13', '2026-07-19');
    await op.payoutSetEmployees(d.request.id, ['e1']);
    for (const day of ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-19']) {
      await expect(op.payoutSetLine({ request_id: d.request.id, employee_id: 'e1', work_date: day, units: 1 }), day)
        .rejects.toMatchObject({ code: 'PAYOUT_NOT_SATURDAY' });
    }
    await expect(op.payoutSetLine({ request_id: d.request.id, employee_id: 'e1', work_date: '2026-07-18',
      time_from: '08:00', time_to: '14:00' })).rejects.toMatchObject({ code: 'PAYOUT_TIME_NOT_ALLOWED' });
  });
  it('NOCNI_RAD: po danu, N dana × 4000', async () => {
    const d = await fill('NOCNI_RAD', [['e1', '2026-07-13', 1], ['e1', '2026-07-14', 1], ['e1', '2026-07-15', 1]]);
    expect(d.totals.amount).toBe(12000);
    expect(d.request.input_mode).toBe('DAYS');
  });
  it('ISPOMOC ostaje 500 po danu', async () => {
    expect((await fill('ISPOMOC', [['e1', '2026-07-13', 1]])).totals.amount).toBe(500);
  });
  it('PREKOVREMENI ostaje 200 po satu; prazno = 0', async () => {
    expect((await fill('PREKOVREMENI', [['e1', '2026-07-13', 2.5]])).totals.amount).toBe(500);
    expect(parseCellInput('HOURS', { hours: '' })).toEqual({ ok: true, value: null });
  });
  it('dnevne vrste: unos je čekiranje dana, bez sati i vremena', () => {
    expect(parseCellInput('DAYS', { checked: true })).toEqual({ ok: true, value: { units: 1 } });
  });
});

describe('Finance: pregled po zaposlenom za ceo period', () => {
  const L = (o: Partial<PeriodLine>): PeriodLine => ({
    employee_id: 'm', employee_name: 'Marković Marko', employee_code: 'E-001', line_kind: 'PRIMARY',
    payment_type_code: 'KARNET', units: 1, amount: 4000, attendance_status: 'WORK', ...o,
  });
  it('osnovno + prevoz posebno + UKUPNO; Karnet→Obuka u istom redu', () => {
    const rows = employeePeriodRows([
      L({}), L({}), L({ attendance_status: 'GO' }),
      L({ payment_type_code: 'OBUKA', amount: 2000 }),
      L({ line_kind: 'TRANSPORT', payment_type_code: 'GAMZED', amount: 500 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ baseAmount: 14000, transportAmount: 500, total: 14500, blockedLines: 0 });
    expect(rows[0].baseTypes).toEqual(['Karnet', 'Obuka']);
    expect(rows[0].dayCounts).toEqual({ rad: 3, GO: 1 });
  });
  it('stavka bez pravila čini red nepotpunim (ne nula)', () => {
    expect(employeePeriodRows([L({ amount: null })])[0].blockedLines).toBe(1);
  });
});

describe('Uvoz zaposlenih', () => {
  it('„Prezime Ime" iz izvora je samo predlog za formu', () => {
    expect(splitSourceName('Jovanović Nikola')).toEqual({ last: 'Jovanović', first: 'Nikola' });
    expect(splitSourceName('Al Soudani Abd Al Hassin')).toEqual({ last: 'Al', first: 'Soudani Abd Al Hassin' });
  });
  it('kreiranje traži stvarni datum početka i osnovnu vrstu; rešen red se ne rešava ponovo', async () => {
    const admin = new MockWdrApi({ role: 'admin' });
    await admin.signIn('admin@wdr.local', 'mock1234');
    const list = await admin.adminImportStagingList(null, ['PENDING']);
    const row = list.items[0];
    await expect(admin.adminImportStagingCreate({
      id: row.id, employee_code: null, first_name: 'Nina', last_name: 'Novaković', employment_start_date: '',
      center_id: 'c', primary_payment_type_id: 'p', default_shift_template_id: null, transport_required: false,
      transport_provider_id: null, transport_valid_from: null, confirm_similar: false,
    })).rejects.toBeTruthy();
    await admin.adminImportStagingDismiss(row.id, 'Test odbacivanja');
    await expect(admin.adminImportStagingDismiss(row.id, 'ponovo')).rejects.toBeTruthy();
  });
  it('operater nema pristup uvozu', async () => {
    const op = await operator();
    await expect(op.adminImportStagingList()).rejects.toBeTruthy();
  });
});
