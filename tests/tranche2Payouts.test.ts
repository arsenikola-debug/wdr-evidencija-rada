import { describe, expect, it } from 'vitest';
import {
  dayAvailable, hoursFromRange, normalizeTime, parseCellInput, periodError, weekStart,
} from '../src/features/payouts/model';
import { MockWdrApi } from '../src/lib/api/mockApi';
import type { PayoutDetail } from '../src/lib/api/types';

const B6 = '10000000-0000-0000-0000-0000000000b6';

describe('model dodatnih isplata', () => {
  it('normalizuje unos vremena', () => {
    expect(normalizeTime('8')).toBe('08:00');
    expect(normalizeTime('2230')).toBe('22:30');
    expect(normalizeTime('22.30')).toBe('22:30');
    expect(normalizeTime('25:00')).toBeNull();
  });

  it('noćni rad preko ponoći: 22:30–03:30 = 5 h', () => {
    expect(hoursFromRange('22:30', '03:30')).toEqual({ hours: 5, crossesMidnight: true });
    expect(hoursFromRange('08:00', '13:30')).toEqual({ hours: 5.5, crossesMidnight: false });
    expect(hoursFromRange('08:00', '08:00')).toBeNull();
  });

  it('prazan unos = brisanje stavke (prazan dan = 0 sati)', () => {
    expect(parseCellInput('HOURS', { hours: '' })).toEqual({ ok: true, value: null });
    expect(parseCellInput('HOURS', { hours: '0' })).toEqual({ ok: true, value: null });
    expect(parseCellInput('HOURS', { hours: '1,5' })).toEqual({ ok: true, value: { units: 1.5 } });
    expect(parseCellInput('HOURS', { hours: '30' }).ok).toBe(false);
    expect(parseCellInput('DAYS', { checked: true })).toEqual({ ok: true, value: { units: 1 } });
    expect(parseCellInput('DAYS', { checked: false })).toEqual({ ok: true, value: null });
    expect(parseCellInput('TIME_RANGE', { from: '22:30', to: '' }).ok).toBe(false);
    expect(parseCellInput('TIME_RANGE', { from: '', to: '' })).toEqual({ ok: true, value: null });
  });

  it('period najviše 7 dana; nedelja počinje ponedeljkom', () => {
    expect(periodError('2026-07-13', '2026-07-20')).toMatch(/najviše 7/);
    expect(periodError('2026-07-13', '2026-07-19')).toBeNull();
    expect(periodError('2026-07-13', '2026-07-14')).toBeNull();
    expect(weekStart('2026-07-16')).toBe('2026-07-13');
  });
});

async function as(role: 'operator' | 'finance' | 'admin') {
  const api = new MockWdrApi({ role });
  await api.signIn(`${role}@wdr.local`, 'mock1234');
  return api;
}

describe('tok dodatne isplate (mock ogleda 0063)', () => {
  it('pre cutover-a i duže od 7 dana je odbijeno', async () => {
    const op = await as('operator');
    await expect(op.payoutOpen('DNEVNICA', B6, '2026-07-06', '2026-07-12'))
      .rejects.toMatchObject({ code: 'PAYOUT_BEFORE_CUTOVER' });
    await expect(op.payoutOpen('DNEVNICA', B6, '2026-07-13', '2026-07-20'))
      .rejects.toMatchObject({ code: 'PERIOD_RANGE_TOO_LONG' });
  });

  it('dnevnice: dani × tarifa, poseban zahtev po vrsti, bez duplikata', async () => {
    const op = await as('operator');
    const d = await op.payoutOpen('DNEVNICA', B6, '2026-07-13', '2026-07-19');
    expect(d.created).toBe(true);
    const again = await op.payoutOpen('DNEVNICA', B6, '2026-07-13', '2026-07-19');
    expect(again.created).toBe(false);
    expect(again.request.id).toBe(d.request.id);
    const ot = await op.payoutOpen('PREKOVREMENI', B6, '2026-07-13', '2026-07-19');
    expect(ot.request.id).not.toBe(d.request.id);

    let x: PayoutDetail = await op.payoutSetEmployees(d.request.id, ['e1']);
    for (const day of ['2026-07-13', '2026-07-14']) {
      x = await op.payoutSetLine({ request_id: d.request.id, employee_id: 'e1', work_date: day, units: 1 });
    }
    expect(x.summary.find((s) => s.employee_id === 'e1')).toMatchObject({ days: 2, amount: 3000 });
    expect(dayAvailable(x, 'e1', '2026-07-15')).toBe(true);
  });

  it('radna subota samo subotom; noćni rad preko ponoći', async () => {
    const op = await as('operator');
    const rs = await op.payoutOpen('RADNA_SUBOTA', B6, '2026-07-13', '2026-07-19');
    await op.payoutSetEmployees(rs.request.id, ['e1']);
    await expect(op.payoutSetLine({ request_id: rs.request.id, employee_id: 'e1',
      work_date: '2026-07-15', time_from: '08:00', time_to: '14:00' }))
      .rejects.toMatchObject({ code: 'PAYOUT_NOT_SATURDAY' });
    const sat = await op.payoutSetLine({ request_id: rs.request.id, employee_id: 'e1',
      work_date: '2026-07-18', time_from: '08:00', time_to: '13:30' });
    expect(sat.lines[0]).toMatchObject({ units: 5.5, amount: 3300 });

    const nr = await op.payoutOpen('NOCNI_RAD', B6, '2026-07-13', '2026-07-19');
    await op.payoutSetEmployees(nr.request.id, ['e2']);
    const n = await op.payoutSetLine({ request_id: nr.request.id, employee_id: 'e2',
      work_date: '2026-07-13', time_from: '22:30', time_to: '03:30' });
    expect(n.lines[0]).toMatchObject({ units: 5, crosses_midnight: true, amount: 1500 });
  });

  it('poslat zahtev nije izmenljiv; operater ne odobrava; korekcija tek posle odobrenja', async () => {
    const op = await as('operator');
    const d = await op.payoutOpen('ISPOMOC', B6, '2026-07-13', '2026-07-19');
    await op.payoutSetEmployees(d.request.id, ['e1']);
    await op.payoutSetLine({ request_id: d.request.id, employee_id: 'e1', work_date: '2026-07-13', units: 1 });
    await op.payoutSubmit(d.request.id);
    await expect(op.payoutSetLine({ request_id: d.request.id, employee_id: 'e1', work_date: '2026-07-14', units: 1 }))
      .rejects.toMatchObject({ code: 'PAYOUT_NOT_EDITABLE' });
    // Operater ne odobrava; korekcija je moguća tek za ODOBREN zahtev (K8).
    await expect(op.payoutFinanceApprove(d.request.id)).rejects.toBeTruthy();
    await expect(op.payoutOpenCorrection(d.request.id, 'Zaboravljen dan ispomoći.'))
      .rejects.toMatchObject({ code: 'PAYOUT_CORRECTION_NEEDS_APPROVED' });
  });

  it('kopiranje prethodne nedelje kopira samo spisak zaposlenih', async () => {
    const op = await as('operator');
    const w1 = await op.payoutOpen('DNEVNICA', B6, '2026-07-13', '2026-07-19');
    await op.payoutSetEmployees(w1.request.id, ['e1', 'e2']);
    await op.payoutSetLine({ request_id: w1.request.id, employee_id: 'e1', work_date: '2026-07-13', units: 1 });
    const w2 = await op.payoutOpen('DNEVNICA', B6, '2026-07-20', '2026-07-26');
    const c = await op.payoutCopyPrevious(w2.request.id);
    expect(c.copy?.added).toBe(2);
    expect(c.lines).toHaveLength(0);
  });

  it('admin: cutover se ne aktivira drugi put', async () => {
    const admin = await as('admin');
    const r = await admin.adminPayoutCutoverReadiness('2026-07-20');
    expect(r.blockers.map((b) => b.code)).toContain('CUTOVER_ALREADY_ACTIVE');
    const tue = await admin.adminPayoutCutoverReadiness('2026-07-21');
    expect(tue.blockers.map((b) => b.code)).toContain('DATE_NOT_MONDAY');
  });

  it('finansije ne unose stavke', async () => {
    const fin = await as('finance');
    await expect(fin.payoutOpen('DNEVNICA', B6, '2026-07-13', '2026-07-19')).rejects.toBeTruthy();
  });
});
