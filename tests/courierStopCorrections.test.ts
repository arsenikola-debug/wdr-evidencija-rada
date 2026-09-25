import { beforeEach, describe, expect, it } from 'vitest';
import { correctionPreview, directionLabel, parseDeltaInput } from
  '../src/features/courierStops/corrections';
import { MockWdrApi } from '../src/lib/api/mockApi';

/** Sve monetarne vrednosti su DEMO (120 RSD/stop). */

describe('unos promene količine', () => {
  it('nula nije korekcija', () => {
    expect(parseDeltaInput('0').kind).toBe('error');
  });
  it('prazno polje nije greška, samo još nema vrednosti', () => {
    expect(parseDeltaInput('').kind).toBe('empty');
    expect(parseDeltaInput('-').kind).toBe('empty');
  });
  it('decimalan broj se odbija', () => {
    expect(parseDeltaInput('10.5').kind).toBe('error');
  });
  it('pozitivan i negativan ceo broj prolaze', () => {
    expect(parseDeltaInput('10')).toEqual({ kind: 'value', value: 10 });
    expect(parseDeltaInput('-10')).toEqual({ kind: 'value', value: -10 });
  });
  it('srpske oznake pravca', () => {
    expect(directionLabel(10)).toBe('Doplata');
    expect(directionLabel(-10)).toBe('Umanjenje');
  });
});

describe('pregled korekcije koristi ZAMRZNUTU cenu', () => {
  it('+10 × 120 = +1.200', () => {
    expect(correctionPreview(100, 10, 120).amount).toBe(1200);
  });
  it('-10 × 120 = -1.200', () => {
    expect(correctionPreview(100, -10, 120).amount).toBe(-1200);
  });
  it('efektivna količina uključuje već odobrene korekcije', () => {
    expect(correctionPreview(100, -80, 120, -30).effectiveStops).toBe(-10);
    expect(correctionPreview(100, -80, 120, -30).belowZero).toBe(true);
  });
  it('dozvoljeno umanjenje ne pada ispod nule', () => {
    expect(correctionPreview(100, -30, 120).belowZero).toBe(false);
  });
});

describe('mock: pun tok korekcije', () => {
  let api: MockWdrApi;
  let lineId: number;

  beforeEach(async () => {
    api = new MockWdrApi({ role: 'finance' });
    await api.signIn('finansije@wdr.local', 'demo');
    const ctx = await api.courierStopContext() as { employees: Array<{ id: string }> };
    const sub = await api.courierStopOpenSubmission(
      '55555555-5555-5555-5555-555555555501',
      '10000000-0000-0000-0000-0000000000b6') as { id: string };
    await api.courierStopSetEntry(sub.id, ctx.employees[0].id, '2026-07-06', 100);
    await api.courierStopSubmit(sub.id);
    await api.courierStopFinanceApprove(sub.id);
    lineId = 1;
  });

  it('korekcija nad neodobrenom linijom se odbija', async () => {
    await expect(api.courierStopCorrectionSet(null, 999, 10, 'Ispravka.')).rejects.toThrow();
  });

  it('nulta korekcija i prazan razlog se odbijaju', async () => {
    await expect(api.courierStopCorrectionSet(null, lineId, 0, 'Ispravka.')).rejects.toThrow();
    await expect(api.courierStopCorrectionSet(null, lineId, 10, 'kr')).rejects.toThrow();
  });

  it('+10 daje +1.200 po zamrznutoj ceni', async () => {
    const c = await api.courierStopCorrectionSet(
      null, lineId, 10, 'Utvrđeno 110 stopova.') as { calculated_amount: number };
    expect(c.calculated_amount).toBe(1200);
  });

  it('pun tok: slanje, vraćanje, ponovno slanje, odobrenje', async () => {
    const c = await api.courierStopCorrectionSet(
      null, lineId, 10, 'Utvrđeno 110 stopova.') as { id: string };
    await api.courierStopCorrectionSubmit(c.id);

    const q = await api.courierStopCorrectionQueue() as Array<{ submission_type: string }>;
    expect(q[0].submission_type).toBe('COURIER_STOP_ADJUSTMENT');

    await expect(api.courierStopCorrectionFinanceReturn(c.id, ' ')).rejects.toThrow();
    await api.courierStopCorrectionFinanceReturn(c.id, 'Priložiti dokaz.');
    await api.courierStopCorrectionSet(c.id, null, 10, 'Dokaz priložen.');
    await api.courierStopCorrectionSubmit(c.id);
    await api.courierStopCorrectionFinanceApprove(c.id);

    await expect(api.courierStopCorrectionFinanceApprove(c.id)).rejects.toThrow();

    const d = await api.courierStopCorrectionDetail(c.id) as {
      original: { stop_count: number }; effective_stops_now: number;
    };
    // Original se ne prepisuje; efektivna količina je 110.
    expect(d.original.stop_count).toBe(100);
    expect(d.effective_stops_now).toBe(110);
  });

  it('kumulativne korekcije ne mogu ispod nule', async () => {
    const a = await api.courierStopCorrectionSet(
      null, lineId, -30, 'Prvo umanjenje.') as { id: string };
    await api.courierStopCorrectionSubmit(a.id);
    await api.courierStopCorrectionFinanceApprove(a.id);

    const b = await api.courierStopCorrectionSet(
      null, lineId, -80, 'Drugo umanjenje.') as { id: string };
    await api.courierStopCorrectionSubmit(b.id);
    await expect(api.courierStopCorrectionFinanceApprove(b.id)).rejects.toThrow();
  });

  it('istorija Finansija prikazuje korekciju zasebno', async () => {
    const c = await api.courierStopCorrectionSet(
      null, lineId, 10, 'Utvrđeno 110 stopova.') as { id: string };
    await api.courierStopCorrectionSubmit(c.id);
    await api.courierStopCorrectionFinanceApprove(c.id);

    const h = await api.getFinanceHistory(
      undefined, undefined, undefined, ['COURIER_STOP_ADJUSTMENT']);
    expect(h.items).toHaveLength(1);
    expect(h.items[0].approved_amount).toBe(1200);
    // Ekonomski datum je ORIGINALNI datum rada, ne datum odobrenja korekcije.
    expect(h.items[0].economic_period_start).toBe('2026-07-06');
  });

  it('BA uključuje odobrenu korekciju po originalnom datumu rada', async () => {
    const c = await api.courierStopCorrectionSet(
      null, lineId, 10, 'Utvrđeno 110 stopova.') as { id: string };
    await api.courierStopCorrectionSubmit(c.id);
    await api.courierStopCorrectionFinanceApprove(c.id);

    const ba = await api.baCourierStops() as {
      totals: { total_stops: number; approved_cost: number };
      by_month: Array<{ month: string; stops: number }>;
    };
    expect(ba.totals.total_stops).toBe(110);
    expect(ba.totals.approved_cost).toBe(13200);
    expect(ba.by_month).toEqual([{ month: '2026-07', stops: 110, approved_cost: 13200 }]);
  });
});

describe('mock BA poštuje filtere', () => {
  let api: MockWdrApi;

  beforeEach(async () => {
    api = new MockWdrApi({ role: 'finance' });
    await api.signIn('finansije@wdr.local', 'demo');
    const ctx = await api.courierStopContext() as { employees: Array<{ id: string }> };
    const sub = await api.courierStopOpenSubmission(
      '55555555-5555-5555-5555-555555555501',
      '10000000-0000-0000-0000-0000000000b6') as { id: string };
    await api.courierStopSetEntry(sub.id, ctx.employees[0].id, '2026-07-06', 100);
    await api.courierStopSubmit(sub.id);
    await api.courierStopFinanceApprove(sub.id);
  });

  it('bez filtera vidi sve', async () => {
    const ba = await api.baCourierStops() as { totals: { total_stops: number } };
    expect(ba.totals.total_stops).toBe(100);
  });

  it('datumski filter van opsega vraća nulu', async () => {
    const ba = await api.baCourierStops('2026-08-01', '2026-08-31') as {
      totals: { total_stops: number };
    };
    expect(ba.totals.total_stops).toBe(0);
  });

  it('datumski filter u opsegu vraća podatke', async () => {
    const ba = await api.baCourierStops('2026-07-01', '2026-07-31') as {
      totals: { total_stops: number };
    };
    expect(ba.totals.total_stops).toBe(100);
  });

  it('filter centra se STVARNO primenjuje', async () => {
    const other = await api.baCourierStops(null, null, ['nepostojeci-centar']) as {
      totals: { total_stops: number };
    };
    expect(other.totals.total_stops).toBe(0);

    const own = await api.baCourierStops(
      null, null, ['10000000-0000-0000-0000-0000000000b6']) as {
      totals: { total_stops: number };
    };
    expect(own.totals.total_stops).toBe(100);
  });
});
