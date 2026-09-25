import { beforeEach, describe, expect, it } from 'vitest';
import { MockWdrApi } from '../src/lib/api/mockApi';
import { splitByMonth } from '../src/features/courierStops/model';

/**
 * Pun lokalni tok kroz mock adapter, bez baze.
 * Sve monetarne vrednosti su DEMO (120 RSD/stop) i tako su i označene u kodu.
 */

const PERIOD = '55555555-5555-5555-5555-555555555501';
const CENTER = '10000000-0000-0000-0000-0000000000b6';

type Detail = {
  submission: { status: string; return_reason: string | null };
  totals: { total_stops: number; total_amount: number | null; source: string };
  lines: Array<{ stop_count: number; rate_used: number | null; calculated_amount: number | null;
                 work_date: string; source: string }>;
  errors: Array<{ code: string }>;
};

describe('Stopovi kurira — lokalni mock tok', () => {
  let api: MockWdrApi;
  let subId: string;
  let courierId: string;

  beforeEach(async () => {
    api = new MockWdrApi();
    await api.signIn('operater@wdr.local', 'demo');
    const ctx = await api.courierStopContext() as {
      employees: Array<{ id: string }>; centers: Array<{ id: string }>;
    };
    courierId = ctx.employees[0].id;
    const sub = await api.courierStopOpenSubmission(PERIOD, CENTER) as { id: string };
    subId = sub.id;
  });

  it('kontekst nudi centre, otvorene periode i kurire iz matične evidencije', async () => {
    const ctx = await api.courierStopContext() as {
      centers: unknown[]; periods: unknown[]; employees: unknown[];
    };
    expect(ctx.centers.length).toBeGreaterThan(0);
    expect(ctx.periods.length).toBeGreaterThan(0);
    expect(ctx.employees.length).toBeGreaterThan(0);
  });

  it('unos, obračun, slanje, vraćanje, ponovno slanje i odobrenje', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 100);

    let d = await api.courierStopFinanceDetail(subId) as Detail;
    expect(d.totals.total_stops).toBe(100);
    expect(d.totals.total_amount).toBe(12000);
    expect(d.totals.source).toBe('CALCULATED');

    await api.courierStopSubmit(subId);
    d = await api.courierStopFinanceDetail(subId) as Detail;
    expect(d.submission.status).toBe('SUBMITTED');

    const queue = await api.courierStopFinanceQueue() as Array<{ submission_type: string }>;
    expect(queue[0].submission_type).toBe('COURIER_STOPS');

    await api.courierStopFinanceReturn(subId, 'Proveriti 06.07.');
    d = await api.courierStopFinanceDetail(subId) as Detail;
    expect(d.submission.status).toBe('RETURNED');
    expect(d.submission.return_reason).toBe('Proveriti 06.07.');

    await api.courierStopSetEntry(subId, courierId, '2026-07-07', 12);
    await api.courierStopSubmit(subId);
    const res = await api.courierStopFinanceApprove(subId) as { approved_amount: number };
    expect(res.approved_amount).toBe(13440);

    d = await api.courierStopFinanceDetail(subId) as Detail;
    expect(d.submission.status).toBe('FINANCE_APPROVED');
    expect(d.totals.source).toBe('SNAPSHOT');
    expect(d.lines.every((l) => l.source === 'SNAPSHOT')).toBe(true);
  });

  it('vraćanje bez razloga se odbija', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 10);
    await api.courierStopSubmit(subId);
    await expect(api.courierStopFinanceReturn(subId, '  ')).rejects.toThrow();
  });

  it('negativan broj stopova je greška i ne briše postojeći zapis', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 42);
    await expect(api.courierStopSetEntry(subId, courierId, '2026-07-06', -5)).rejects.toThrow();
    const d = await api.courierStopFinanceDetail(subId) as Detail;
    expect(d.lines[0].stop_count).toBe(42);
  });

  it('nula briše zapis', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 42);
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 0);
    const d = await api.courierStopFinanceDetail(subId) as Detail;
    expect(d.lines).toHaveLength(0);
    expect(d.errors.some((e) => e.code === 'EMPTY_COURIER_STOP_SUBMISSION')).toBe(true);
  });

  it('prazna prijava se ne šalje', async () => {
    await expect(api.courierStopSubmit(subId)).rejects.toThrow();
  });

  it('poslata prijava se više ne menja', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 10);
    await api.courierStopSubmit(subId);
    await expect(
      api.courierStopSetEntry(subId, courierId, '2026-07-06', 20)).rejects.toThrow();
  });

  it('dvostruko odobrenje nije moguće', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 10);
    await api.courierStopSubmit(subId);
    await api.courierStopFinanceApprove(subId);
    await expect(api.courierStopFinanceApprove(subId)).rejects.toThrow();
  });

  it('BA podela po mesecu koristi stvarni datum rada', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 100);
    await api.courierStopSubmit(subId);
    await api.courierStopFinanceApprove(subId);
    const d = await api.courierStopFinanceDetail(subId) as Detail;
    expect(splitByMonth(d.lines)).toEqual([{ month: '2026-07', stops: 100, amount: 12000 }]);
  });
});

describe('Stopovi kurira u istoriji Finansija (mock)', () => {
  let api: MockWdrApi;
  let subId: string;
  let courierId: string;

  beforeEach(async () => {
    api = new MockWdrApi({ role: 'finance' });
    await api.signIn('finansije@wdr.local', 'demo');
    const ctx = await api.courierStopContext() as { employees: Array<{ id: string }> };
    courierId = ctx.employees[0].id;
    const sub = await api.courierStopOpenSubmission(PERIOD, CENTER) as { id: string };
    subId = sub.id;
  });

  it('odobreni stopovi se pojavljuju u istoriji sa zamrznutim iznosom', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 100);
    await api.courierStopSubmit(subId);
    await api.courierStopFinanceApprove(subId);

    const h = await api.getFinanceHistory();
    const item = h.items.find((i) => i.transaction_type === 'COURIER_STOPS');
    expect(item).toBeDefined();
    expect(item?.approved_amount).toBe(12000);
    expect(item?.transaction_type_label).toBe('Stopovi kurira');
  });

  it('filter COURIER_STOPS vraća samo stopove', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 10);
    await api.courierStopSubmit(subId);
    await api.courierStopFinanceApprove(subId);

    const h = await api.getFinanceHistory(undefined, undefined, undefined, ['COURIER_STOPS']);
    expect(h.items.length).toBeGreaterThan(0);
    expect(h.items.every((i) => i.transaction_type === 'COURIER_STOPS')).toBe(true);
  });

  it('filter PERIOD ne vraća stopove', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 10);
    await api.courierStopSubmit(subId);
    await api.courierStopFinanceApprove(subId);

    const h = await api.getFinanceHistory(undefined, undefined, undefined, ['PERIOD']);
    expect(h.items.some((i) => i.transaction_type === 'COURIER_STOPS')).toBe(false);
  });

  it('neodobrena prijava se NE pojavljuje u istoriji', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-06', 10);
    await api.courierStopSubmit(subId);
    const h = await api.getFinanceHistory();
    expect(h.items.some((i) => i.transaction_type === 'COURIER_STOPS')).toBe(false);
  });

  it('ekonomska pripadnost ide po stvarnom datumu rada, ne po periodu prijave', async () => {
    await api.courierStopSetEntry(subId, courierId, '2026-07-08', 10);
    await api.courierStopSubmit(subId);
    await api.courierStopFinanceApprove(subId);

    const h = await api.getFinanceHistory(undefined, undefined, undefined, ['COURIER_STOPS']);
    expect(h.items[0].economic_period_start).toBe('2026-07-08');
  });
});
