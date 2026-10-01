import { describe, expect, it } from 'vitest';
import {
  applyBaseType, buildEligibilityIndex, employeesInSection, isLocked, lockReasonText, sectionCounts,
} from '../src/features/grid/eligibility';
import { cellKey } from '../src/features/grid/model';
import { duplicateSeverity } from '../src/features/employees/model';
import type { EntryEligibility } from '../src/lib/api/types';

const DATES = ['2026-07-06', '2026-07-07', '2026-07-08'];
const E: EntryEligibility = {
  submission_id: 's', center_id: 'c', period_start: DATES[0], period_end: DATES[2],
  basis: 'EMPLOYMENT_AND_ASSIGNMENT_ON_DATE',
  days: [
    ...DATES.map((d, i) => ({ employee_id: 'marko', work_date: d, eligible: true, lock_reason: null,
      payment_type_code: i < 2 ? 'KARNET' : 'OBUKA' })),
    ...DATES.map((d) => ({ employee_id: 'ana', work_date: d, eligible: true, lock_reason: null,
      payment_type_code: 'KARNET' })),
    ...DATES.map((d) => ({ employee_id: 'dragan', work_date: d, eligible: true, lock_reason: null,
      payment_type_code: 'DNEVNICA' })),
  ],
};
const emps = ['marko', 'ana', 'dragan'].map((employee_id) => ({ employee_id }));

describe('K1: Karnet i Obuka kao sekcije iste prijave', () => {
  const base = buildEligibilityIndex(E);

  it('u Karnet sekciji je dan Obuke zaključan, i obrnuto', () => {
    const k = applyBaseType(base, 'KARNET');
    expect(isLocked(k, cellKey('marko', '2026-07-07'))).toBe(false);
    expect(isLocked(k, cellKey('marko', '2026-07-08'))).toBe(true);
    const o = applyBaseType(base, 'OBUKA');
    expect(isLocked(o, cellKey('marko', '2026-07-07'))).toBe(true);
    expect(isLocked(o, cellKey('marko', '2026-07-08'))).toBe(false);
    expect(lockReasonText('OTHER_TYPE', 'OBUKA')).toMatch(/Obuci/);
  });

  it('zaposleni sa promenom tipa je u obe sekcije; ostali samo u svojoj', () => {
    expect(employeesInSection(base, emps, 'KARNET', DATES).map((e) => e.employee_id)).toEqual(['marko', 'ana']);
    expect(employeesInSection(base, emps, 'OBUKA', DATES).map((e) => e.employee_id)).toEqual(['marko']);
    expect(sectionCounts(base, emps, DATES)).toEqual({ KARNET: 2, OBUKA: 1, OSTALO: 1 });
  });

  it('bez eligibility podataka ništa se ne filtrira ni ne zaključava', () => {
    const none = buildEligibilityIndex(null);
    expect(employeesInSection(none, emps, 'KARNET', DATES)).toHaveLength(3);
    expect(applyBaseType(none, 'KARNET').locked.size).toBe(0);
  });
});

describe('K10: poklapanje u drugom centru', () => {
  it('broji se kao upozorenje bez otkrivanja identiteta', () => {
    expect(duplicateSeverity({ exact_code: null, exact_name: [], similar: [], note: '',
      outside_scope_match_count: 1 })).toEqual({ kind: 'warning', count: 1 });
  });
});
