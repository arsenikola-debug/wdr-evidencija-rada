import { describe, expect, it } from 'vitest';
import {
  KPI_CARDS,
  barWidth,
  centersReconcile,
  comparisonLabel,
  defaultRange,
  fillDailyGaps,
  kpiCards,
  maxAbs,
  paymentsReconcile,
  rangeIsValid,
  rateLabel,
} from '../src/features/analytics/model';
import type {
  BaCenterRow,
  BaKpi,
  BaOverview,
  BaPaymentRow,
  BaTransportRow,
} from '../src/lib/api/types';

const kpi = (over: Partial<BaKpi> = {}): BaKpi => ({
  current: 100,
  previous_period: 80,
  previous_year: null,
  absolute_change: 20,
  percentage_change: 25,
  absolute_change_year: null,
  percentage_change_year: null,
  ...over,
});

describe('KPI kartice', () => {
  it('prikazuje traženi set pokazatelja', () => {
    expect(KPI_CARDS.map((c) => c.label)).toEqual([
      'Ukupan trošak', 'Naknade zaposlenima', 'Prevoz', 'Korekcije',
      'Radni dani zaposlenih', 'Prekovremeni sati', 'Broj zaposlenih u obračunu',
      'Trošak po radnom danu',
    ]);
  });

  it('bez podataka daje prazne kartice, ne nule', () => {
    expect(kpiCards(null).every((c) => c.value === null)).toBe(true);
  });

  it('čita vrednosti iz pregleda', () => {
    const overview = { kpi: { total_calculated_amount: kpi() } } as unknown as BaOverview;
    expect(kpiCards(overview)[0].value).toBe(100);
  });
});

describe('poređenje perioda', () => {
  it('rast i pad se razlikuju', () => {
    expect(comparisonLabel(kpi()).kind).toBe('up');
    expect(comparisonLabel(kpi({ percentage_change: -10, absolute_change: -8 })).kind)
      .toBe('down');
  });

  it('bez uporednog perioda ne izmišlja 0%', () => {
    const out = comparisonLabel(kpi({ previous_period: null, percentage_change: null }));
    expect(out.kind).toBe('unavailable');
    expect(out.text).not.toContain('0');
  });

  it('kada je prethodni period nula, prikazuje apsolutnu promenu bez procenta', () => {
    const out = comparisonLabel(kpi({
      previous_period: 0, percentage_change: null, absolute_change: 9300,
    }));
    expect(out.kind).toBe('up');
    expect(out.text).toContain('prethodno 0');
    expect(out.text).not.toContain('%');
  });

  it('nula procenata je stvarno bez promene', () => {
    expect(comparisonLabel(kpi({ percentage_change: 0, absolute_change: 0 })).kind)
      .toBe('flat');
  });
});

describe('zbirovi', () => {
  const center = (amount: number): BaCenterRow =>
    ({ total_calculated_amount: amount } as BaCenterRow);
  const payment = (amount: number): BaPaymentRow => ({ amount } as BaPaymentRow);

  it('prepoznaje kada se centri slažu sa ukupnim', () => {
    expect(centersReconcile([center(8800), center(500)], 9300)).toBe(true);
    expect(centersReconcile([center(8800)], 9300)).toBe(false);
  });

  it('isto i za vrste isplate', () => {
    expect(paymentsReconcile([payment(8000), payment(800), payment(500)], 9300)).toBe(true);
  });
});

describe('stope prevoza', () => {
  const row = (over: Partial<BaTransportRow>): BaTransportRow => ({
    center_code: 'B6', transport_provider_code: 'GAMZED', responsible_person_code: null,
    employee_days: 2, units: 2, amount: 1000, share_of_transport: 100,
    distinct_rate_count: 1, min_rate: 500, max_rate: 500, single_rate: 500, ...over,
  });

  it('jedna stopa se prikazuje kao stopa', () => {
    expect(rateLabel(row({}))).toBe('500');
  });

  it('više stopa se prikazuje kao raspon, nikad kao prosek', () => {
    const label = rateLabel(row({ distinct_rate_count: 2, min_rate: 400, max_rate: 600,
                                  single_rate: null }));
    expect(label).toContain('400');
    expect(label).toContain('600');
    expect(label).not.toBe('500');
  });
});

describe('grafikoni bez zavisnosti', () => {
  it('širina stupca je ograničena na 0–100%', () => {
    expect(barWidth(50, 100)).toBe(50);
    expect(barWidth(500, 100)).toBe(100);
    expect(barWidth(10, 0)).toBe(0);
  });

  it('negativne korekcije se mere po apsolutnoj vrednosti', () => {
    expect(maxAbs([100, -500, 20])).toBe(500);
  });
});

describe('opseg datuma', () => {
  it('podrazumevani opseg je tekući mesec do danas', () => {
    const r = defaultRange(new Date(2026, 7, 15));
    expect(r.from).toBe('2026-08-01');
    expect(r.to).toBe('2026-08-15');
  });

  it('odbija neispravan opseg', () => {
    expect(rangeIsValid('2026-08-10', '2026-08-01')).toBe(false);
    expect(rangeIsValid('', '2026-08-01')).toBe(false);
    expect(rangeIsValid('2026-08-01', '2026-08-01')).toBe(true);
  });

  it('dani bez odobrenog troška ostaju točke na trendu', () => {
    const filled = fillDailyGaps(
      [{ work_date: '2026-08-02', total_calculated_amount: 100 } as never],
      '2026-08-01', '2026-08-03',
    );
    expect(filled).toHaveLength(3);
    expect(filled[0].total_calculated_amount).toBe(0);
    expect(filled[1].total_calculated_amount).toBe(100);
  });
});
