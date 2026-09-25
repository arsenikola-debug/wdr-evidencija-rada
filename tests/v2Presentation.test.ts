import { describe, expect, it } from 'vitest';
import { describeRange, formatDay, rangeNotice } from '../src/features/analytics/period';
import {
  breakdownByPaymentType,
  groupMissingByEmployee,
} from '../src/features/finance/previewBreakdown';
import type { PreviewLine } from '../src/lib/api/types';

/**
 * Dve stvari koje ovi testovi čuvaju:
 *  1. parcijalan raspon se NIKAD ne sme prikazati kao ceo mesec;
 *  2. stavka bez pravila se NIKAD ne sme sabrati kao nula.
 */

describe('describeRange — parcijalan raspon nije mesec', () => {
  it('prepoznaje ceo mesec', () => {
    const r = describeRange('2026-09-01', '2026-09-30', '2026-10-05');
    expect(r.wholeMonth).toBe(true);
    expect(r.partialMonth).toBe(false);
    expect(r.days).toBe(30);
    expect(rangeNotice(r)?.kind).toBe('info');
  });

  it('parcijalan mesec je upozorenje i kaže koliko dana nedostaje', () => {
    const r = describeRange('2026-09-01', '2026-09-23', '2026-09-23');
    expect(r.partialMonth).toBe(true);
    expect(r.wholeMonth).toBe(false);
    expect(r.days).toBe(23);
    expect(r.missingDays).toBe(7);
    const n = rangeNotice(r);
    expect(n?.kind).toBe('warning');
    expect(n?.text).toContain('nedostaje još 7');
  });

  it('februar prestupne godine ima 29 dana', () => {
    const r = describeRange('2028-02-01', '2028-02-29', '2028-03-10');
    expect(r.wholeMonth).toBe(true);
    expect(r.missingDays).toBe(0);
  });

  it('raspon koji se završava danas je označen kao nezaokružen', () => {
    const r = describeRange('2026-09-10', '2026-09-23', '2026-09-23');
    expect(r.wholeMonth).toBe(false);
    expect(r.partialMonth).toBe(false);
    expect(r.endsToday).toBe(true);
    expect(rangeNotice(r)?.kind).toBe('warning');
  });

  it('obrnut raspon nije validan i ne nudi poruku', () => {
    const r = describeRange('2026-09-20', '2026-09-01', '2026-09-23');
    expect(r.valid).toBe(false);
    expect(rangeNotice(r)).toBeNull();
  });

  it('formatDay ne izmišlja format za smeće', () => {
    expect(formatDay('2026-09-01')).toBe('01.09.2026.');
    expect(formatDay('')).toBe('—');
  });
});

function line(over: Partial<PreviewLine>): PreviewLine {
  return {
    work_entry_id: 'we1',
    employee_id: 'e1',
    employee_name: 'Test',
    work_date: '2026-07-06',
    line_kind: 'COMPONENT',
    payment_type_code: 'PREKOVREMENI',
    basis: 'B6',
    center_code: 'B6',
    rule_id: 'r1',
    rule_version: 1,
    rate: 100,
    unit_type: 'PER_HOUR',
    units: 2,
    calculated_amount: 200,
    status: 'RESOLVED',
    ...over,
  };
}

describe('breakdownByPaymentType — stvarne komponente, ne generički zbir', () => {
  it('grupiše po vrsti isplate i sabira serverske iznose', () => {
    const groups = breakdownByPaymentType([
      line({ payment_type_code: 'PREKOVREMENI', calculated_amount: 600, units: 6 }),
      line({ payment_type_code: 'ISPOMOC', calculated_amount: 1000, units: 1 }),
      line({ payment_type_code: 'PREKOVREMENI', calculated_amount: 200, units: 2 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].lineKind).toBe('COMPONENT');
    const codes = groups[0].rows.map((r) => r.code);
    expect(codes).toContain('PREKOVREMENI');
    expect(codes).toContain('ISPOMOC');

    const ot = groups[0].rows.find((r) => r.code === 'PREKOVREMENI')!;
    expect(ot.amount).toBe(800);
    expect(ot.units).toBe(8);
    expect(ot.resolvedLines).toBe(2);
    expect(groups[0].amount).toBe(1800);
  });

  it('stavka bez pravila se broji posebno, a ne kao nula', () => {
    const groups = breakdownByPaymentType([
      line({ payment_type_code: 'PREKOVREMENI', calculated_amount: 600 }),
      line({
        payment_type_code: 'PREKOVREMENI',
        calculated_amount: null,
        status: 'MISSING_RULE',
        units: 4,
      }),
    ]);

    const row = groups[0].rows[0];
    expect(row.amount).toBe(600);
    expect(row.resolvedLines).toBe(1);
    expect(row.blockedLines).toBe(1);
    // Količina blokirane linije se ne pripisuje obračunatom delu.
    expect(row.units).toBe(2);
    expect(groups[0].blockedLines).toBe(1);
  });

  it('zadržava redosled kategorija: osnovna naknada, komponente, prevoz', () => {
    const groups = breakdownByPaymentType([
      line({ line_kind: 'TRANSPORT', payment_type_code: 'PREVOZ', calculated_amount: 50 }),
      line({ line_kind: 'PRIMARY', payment_type_code: 'KARNET', calculated_amount: 900 }),
      line({ line_kind: 'COMPONENT', payment_type_code: 'ISPOMOC', calculated_amount: 100 }),
    ]);
    expect(groups.map((g) => g.lineKind)).toEqual(['PRIMARY', 'COMPONENT', 'TRANSPORT']);
  });

  it('prazan ulaz daje praznu listu, ne izmišljene redove', () => {
    expect(breakdownByPaymentType([])).toEqual([]);
  });
});

describe('groupMissingByEmployee', () => {
  it('grupiše po zaposlenom i sortira datume', () => {
    const rows = groupMissingByEmployee([
      { employee_id: 'e1', employee_name: 'Ana', work_date: '2026-07-08' },
      { employee_id: 'e2', employee_name: 'Marko', work_date: '2026-07-06' },
      { employee_id: 'e1', employee_name: 'Ana', work_date: '2026-07-06' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].employee_name).toBe('Ana');
    expect(rows[0].dates).toEqual(['2026-07-06', '2026-07-08']);
  });

  it('ne gubi nijednu ćeliju', () => {
    const input = Array.from({ length: 37 }, (_, i) => ({
      employee_id: `e${i % 4}`,
      employee_name: `Zaposleni ${i % 4}`,
      work_date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
    }));
    const total = groupMissingByEmployee(input).reduce((s, g) => s + g.dates.length, 0);
    expect(total).toBe(37);
  });
});
