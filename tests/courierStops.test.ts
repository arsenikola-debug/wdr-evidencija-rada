import { describe, expect, it } from 'vitest';
import {
  STATUS_LABEL, averageStopsPerCourierDay, buildRows, canSubmit, costPerStop,
  dayLabel, isEditable, monthKey, parseStopInput, periodDates, rowTotal, splitByMonth,
} from '../src/features/courierStops/model';
import type { CourierStopDetail } from '../src/features/courierStops/model';

/**
 * Sve monetarne vrednosti ovde su SINTETIČKE (120 RSD/stop) i postoje samo radi
 * provere aritmetike prikaza. Operater ih nikada ne unosi.
 */

const detail = (over: Partial<CourierStopDetail> = {}): CourierStopDetail => ({
  submission_type: 'COURIER_STOPS',
  submission: {
    id: 's1', center_id: 'c1', period_id: 'p1',
    period_start: '2026-07-06', period_end: '2026-07-12',
    status: 'DRAFT', return_reason: null, submitted_at: null, approved_at: null,
  },
  is_approved: false,
  totals: {
    total_stops: 100, total_amount: 12000, line_count: 1, employee_count: 1,
    blocking_line_count: 0, is_complete: true, source: 'CALCULATED',
  },
  errors: [],
  lines: [],
  ...over,
});

describe('period prijave', () => {
  it('datumi dolaze iz stvarnog perioda, ne iz pretpostavke pon–pet', () => {
    const d = periodDates('2026-07-06', '2026-07-12');
    expect(d).toHaveLength(7);
    expect(d[0]).toBe('2026-07-06');
    expect(d[6]).toBe('2026-07-12');
  });

  it('period koji prelazi mesec daje neprekidan niz dana', () => {
    const d = periodDates('2026-07-29', '2026-08-02');
    expect(d).toEqual(['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
  });

  it('besmislen opseg daje praznu listu umesto beskonačne petlje', () => {
    expect(periodDates('2026-07-10', '2026-07-01')).toEqual([]);
  });

  it('oznaka dana je na srpskom', () => {
    expect(dayLabel('2026-07-06')).toBe('Pon 06');
  });
});

describe('unos broja stopova', () => {
  it('prazno polje briše zapis', () => {
    expect(parseStopInput('')).toEqual({ kind: 'clear' });
    expect(parseStopInput('   ')).toEqual({ kind: 'clear' });
  });

  it('nula briše zapis', () => {
    expect(parseStopInput('0')).toEqual({ kind: 'clear' });
  });

  it('negativan broj je GREŠKA, ne brisanje', () => {
    const r = parseStopInput('-5');
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.message).toContain('negativan');
  });

  it('decimalan broj se odbija', () => {
    expect(parseStopInput('12.5').kind).toBe('error');
  });

  it('tekst se odbija', () => {
    expect(parseStopInput('sto').kind).toBe('error');
  });

  it('pozitivan ceo broj prolazi', () => {
    expect(parseStopInput('100')).toEqual({ kind: 'value', value: 100 });
  });
});

describe('redovi po kuriru', () => {
  const lines = [
    { employee_id: 'e2', employee_name: 'Marko Marković', work_date: '2026-07-06', stop_count: 100 },
    { employee_id: 'e2', employee_name: 'Marko Marković', work_date: '2026-07-07', stop_count: 12 },
    { employee_id: 'e1', employee_name: 'Ana Anić', work_date: '2026-07-06', stop_count: 40 },
  ];

  it('prikazuje samo kurire koji stvarno učestvuju', () => {
    expect(buildRows(lines)).toHaveLength(2);
  });

  it('sortira po imenu', () => {
    expect(buildRows(lines)[0].employee_name).toBe('Ana Anić');
  });

  it('operater može izričito da doda kurira iz matične evidencije', () => {
    const rows = buildRows(lines, [{ employee_id: 'e3', full_name: 'Petar Petrović' }]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.employee_id === 'e3')?.stops).toEqual({});
  });

  it('dodavanje postojećeg kurira ne pravi duplikat', () => {
    expect(buildRows(lines, [{ employee_id: 'e2', full_name: 'Marko Marković' }])).toHaveLength(2);
  });

  it('zbir po kuriru', () => {
    expect(rowTotal(buildRows(lines)[1])).toBe(112);
  });
});

describe('slanje Finansijama', () => {
  it('moguće je kada nema blokirajućih grešaka', () => {
    expect(canSubmit(detail(), true)).toBe(true);
  });

  it('nije moguće bez permisije', () => {
    expect(canSubmit(detail(), false)).toBe(false);
  });

  it('nije moguće dok postoji blokirajuća greška', () => {
    const d = detail({ errors: [
      { severity: 'ERROR', code: 'MISSING_COURIER_STOP_RATE', message: 'nema cene' },
    ] });
    expect(canSubmit(d, true)).toBe(false);
  });

  it('zatvoren period blokira slanje', () => {
    const d = detail({ errors: [
      { severity: 'ERROR', code: 'PERIOD_NOT_OPEN', message: 'period zatvoren' },
    ] });
    expect(canSubmit(d, true)).toBe(false);
  });

  it('nije moguće iz poslatog ili odobrenog statusa', () => {
    expect(canSubmit(detail({
      submission: { ...detail().submission, status: 'SUBMITTED' } }), true)).toBe(false);
    expect(canSubmit(detail({
      submission: { ...detail().submission, status: 'FINANCE_APPROVED' } }), true)).toBe(false);
  });

  it('prazna prijava se ne šalje', () => {
    expect(canSubmit(detail({ totals: { ...detail().totals, line_count: 0 } }), true)).toBe(false);
  });

  it('vraćena prijava je ponovo uređiva', () => {
    expect(isEditable(detail({
      submission: { ...detail().submission, status: 'RETURNED' } }))).toBe(true);
  });

  it('odobrena prijava nije uređiva', () => {
    expect(isEditable(detail({
      submission: { ...detail().submission, status: 'FINANCE_APPROVED' } }))).toBe(false);
  });

  it('statusi imaju srpske nazive', () => {
    expect(STATUS_LABEL.RETURNED).toBe('Vraćeno na ispravku');
    expect(STATUS_LABEL.FINANCE_APPROVED).toBe('Odobreno');
  });
});

describe('BA nad odobrenim podacima', () => {
  const approved = [
    { work_date: '2026-07-30', stop_count: 100, calculated_amount: 12000 },
    { work_date: '2026-08-01', stop_count: 50, calculated_amount: 6000 },
  ];

  it('prijava koja prelazi mesec se deli po STVARNOM datumu rada', () => {
    expect(splitByMonth(approved)).toEqual([
      { month: '2026-07', stops: 100, amount: 12000 },
      { month: '2026-08', stops: 50, amount: 6000 },
    ]);
  });

  it('mesec se čita iz datuma rada, ne iz datuma odobrenja', () => {
    expect(monthKey('2026-07-30')).toBe('2026-07');
  });

  it('cena po stopu se izvodi iz ODOBRENIH iznosa', () => {
    expect(costPerStop(18000, 150)).toBe(120);
  });

  it('bez stopova nema cene po stopu — ne deli se nulom', () => {
    expect(costPerStop(18000, 0)).toBeNull();
    expect(costPerStop(null, 150)).toBeNull();
  });

  it('prosek po kuriru i danu broji aktivne kombinacije', () => {
    const lines = [
      { employee_id: 'e1', employee_name: 'A', work_date: '2026-07-06', stop_count: 100 },
      { employee_id: 'e1', employee_name: 'A', work_date: '2026-07-07', stop_count: 50 },
      { employee_id: 'e2', employee_name: 'B', work_date: '2026-07-06', stop_count: 30 },
    ];
    expect(averageStopsPerCourierDay(lines)).toBe(60);
  });

  it('bez podataka prosek je null, a ne nula', () => {
    expect(averageStopsPerCourierDay([])).toBeNull();
  });
});

describe('identitet reda u mreži', () => {
  // Dva zaposlena sa istim punim imenom nisu egzotičan slučaj. Dok postoji
  // `employee_id`, ime se NIKADA ne sme koristiti kao identitet reda.
  const twins = [
    { employee_id: 'e-1', employee_name: 'Marković Marko',
      work_date: '2026-07-06', stop_count: 100 },
    { employee_id: 'e-2', employee_name: 'Marković Marko',
      work_date: '2026-07-06', stop_count: 7 },
  ];

  it('imenjaci daju DVA reda, ne jedan', () => {
    expect(buildRows(twins)).toHaveLength(2);
  });

  it('svaki red zadržava svoj identitet i svoje stopove', () => {
    const rows = buildRows(twins);
    expect(rows.find((r) => r.employee_id === 'e-1')?.stops['2026-07-06']).toBe(100);
    expect(rows.find((r) => r.employee_id === 'e-2')?.stops['2026-07-06']).toBe(7);
  });

  it('dodavanje kurira koji već ima zapis ne pravi duplikat po imenu', () => {
    const rows = buildRows(twins, [{ employee_id: 'e-2', full_name: 'Marković Marko' }]);
    expect(rows).toHaveLength(2);
  });

  it('kurir sa istim imenom ali novim identitetom se dodaje kao poseban red', () => {
    const rows = buildRows(twins, [{ employee_id: 'e-3', full_name: 'Marković Marko' }]);
    expect(rows).toHaveLength(3);
  });
});
