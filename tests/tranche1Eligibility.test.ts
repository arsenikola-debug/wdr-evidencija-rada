import { describe, expect, it } from 'vitest';
import {
  applyStatus,
  copyFromOffset,
  describeSkips,
  planUndoWholePeriodNotWorking,
  planWholePeriodNotWorking,
  wholePeriodNotWorkingState,
} from '../src/features/grid/bulk';
import { computeCompletion } from '../src/features/grid/completion';
import { buildEligibilityIndex, isLocked } from '../src/features/grid/eligibility';
import { cellKey, type CellIndex } from '../src/features/grid/model';
import type {
  AttendanceStatusCode,
  EntryEligibility,
  GridCellPayload,
  GridEmployee,
} from '../src/lib/api/types';

const DATES = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
const allows = (c: AttendanceStatusCode) => c === 'WORK';

const emp = (id: string): GridEmployee => ({
  employee_id: id, full_name: id, employee_code: null, home_center_code: 'B6',
  primary_payment_type_id: null, primary_payment_type_code: 'KARNET',
  default_shift_template_id: 't1', transport_required: null, transport_provider_code: null,
});

function cell(employee: string, date: string, status: AttendanceStatusCode, own = true): GridCellPayload {
  return {
    work_entry_id: `w-${employee}-${date}`, employee_id: employee, work_date: date,
    attendance_status: status, primary_payment_type_id: null, home_center_code: 'B6',
    owner_submission_id: own ? 's1' : 's2', owned_by_this_submission: own, notes: null,
    segments: [], components: [], has_assistance: false, has_foreign_segment: false,
  };
}

function idx(cells: GridCellPayload[]): CellIndex {
  const m: CellIndex = new Map();
  for (const c of cells) m.set(cellKey(c.employee_id, c.work_date), c);
  return m;
}

/**
 * Marko: Karnet pon–uto, Obuka od srede (isti centar).
 * Nova:  počinje u sredu → pon i uto zaključani.
 * Ana:   prestaje u četvrtak → petak zaključan.
 */
const ELIG: EntryEligibility = {
  submission_id: 's1', center_id: 'c1', period_start: DATES[0], period_end: DATES[4],
  basis: 'EMPLOYMENT_AND_ASSIGNMENT_ON_DATE',
  days: [
    ...DATES.map((d, i) => ({
      employee_id: 'marko', work_date: d, eligible: true, lock_reason: null,
      payment_type_code: i < 2 ? 'KARNET' : 'OBUKA',
    })),
    ...DATES.map((d, i) => ({
      employee_id: 'nova', work_date: d, eligible: i >= 2,
      lock_reason: i >= 2 ? null : ('NOT_EMPLOYED' as const),
      payment_type_code: i >= 2 ? 'KARNET' : null,
    })),
    ...DATES.map((d, i) => ({
      employee_id: 'ana', work_date: d, eligible: i <= 3,
      lock_reason: i <= 3 ? null : ('NOT_EMPLOYED' as const),
      payment_type_code: i <= 3 ? 'KARNET' : null,
    })),
  ],
};

describe('eligibility po datumu', () => {
  const e = buildEligibilityIndex(ELIG);

  it('početak radnog odnosa u sredu zaključava ponedeljak i utorak', () => {
    expect(isLocked(e, cellKey('nova', '2026-07-06'))).toBe(true);
    expect(isLocked(e, cellKey('nova', '2026-07-07'))).toBe(true);
    expect(isLocked(e, cellKey('nova', '2026-07-08'))).toBe(false);
  });

  it('kraj radnog odnosa u četvrtak zaključava petak', () => {
    expect(isLocked(e, cellKey('ana', '2026-07-09'))).toBe(false);
    expect(isLocked(e, cellKey('ana', '2026-07-10'))).toBe(true);
  });

  it('Karnet → Obuka od srede deli nedelju po datumu', () => {
    expect(e.typeByKey.get(cellKey('marko', '2026-07-07'))).toBe('KARNET');
    expect(e.typeByKey.get(cellKey('marko', '2026-07-08'))).toBe('OBUKA');
    expect(e.typeChanges.get('marko')).toEqual([
      { from: '2026-07-06', code: 'KARNET' },
      { from: '2026-07-08', code: 'OBUKA' },
    ]);
    expect(e.typeChanges.has('ana')).toBe(false);
  });

  it('bez odgovora servera ništa se ne zaključava (odluka ostaje bazi)', () => {
    const none = buildEligibilityIndex(null);
    expect(none.available).toBe(false);
    expect(isLocked(none, cellKey('nova', '2026-07-06'))).toBe(false);
  });

  it('grupni unos i kopiranje preskaču zaključane dane uz objašnjenje', () => {
    const locked = (k: string) => isLocked(e, k);
    const plan = applyStatus({
      keys: DATES.map((d) => cellKey('nova', d)), status: 'GO', index: new Map(),
      employees: [emp('nova')], statusAllowsSegments: allows, isLocked: locked,
    });
    expect(plan.entries.map((x) => x.work_date)).toEqual(DATES.slice(2));
    expect(plan.skipped.filter((s) => s.reason === 'LOCKED_DAY')).toHaveLength(2);
    expect(describeSkips(plan)).toContain('zaključan');

    const copy = copyFromOffset({
      keys: [cellKey('ana', '2026-07-10')], index: idx([cell('ana', '2026-07-09', 'GO')]),
      offsetDays: 1, periodStart: DATES[0], periodEnd: DATES[4], isLocked: locked,
    });
    expect(copy.entries).toHaveLength(0);
    expect(copy.skipped[0].reason).toBe('LOCKED_DAY');
  });

  it('kompletnost ne očekuje zaključane dane', () => {
    const c = computeCompletion({
      dates: DATES, employees: [emp('nova')], index: new Map(), mode: 'MON_FRI',
      isLocked: (k) => isLocked(e, k),
    });
    expect(c.expected).toBe(3);
  });
});

describe('„Nije radio ceo period"', () => {
  const e = buildEligibilityIndex(ELIG);
  const locked = (k: string) => isLocked(e, k);

  it('popunjava SAMO dostupne dane kao NOT_WORKING', () => {
    const plan = planWholePeriodNotWorking({ employeeId: 'nova', dates: DATES, index: new Map(), isLocked: locked });
    expect(plan.entries.map((x) => x.work_date)).toEqual(DATES.slice(2));
    expect(plan.entries.every((x) => x.attendance_status === 'NOT_WORKING')).toBe(true);
    expect(plan.overwrites).toBe(0);
  });

  it('prijavljuje koliko postojećih dana bi prepisao i ne dira tuđi centar', () => {
    const index = idx([cell('marko', DATES[0], 'WORK'), cell('marko', DATES[1], 'WORK', false)]);
    const plan = planWholePeriodNotWorking({ employeeId: 'marko', dates: DATES, index, isLocked: locked });
    expect(plan.overwrites).toBe(1);
    expect(plan.entries.map((x) => x.work_date)).not.toContain(DATES[1]);
    expect(plan.skipped.find((s) => s.reason === 'FOREIGN_CELL')).toBeTruthy();
  });

  it('stanje je ALL kada su svi dostupni dani „Ne radi", i može da se poništi', () => {
    const index = idx(DATES.slice(2).map((d) => cell('nova', d, 'NOT_WORKING')));
    expect(wholePeriodNotWorkingState({ employeeId: 'nova', dates: DATES, index, isLocked: locked })).toBe('ALL');

    const undo = planUndoWholePeriodNotWorking({ employeeId: 'nova', dates: DATES, index });
    expect(undo.entries).toHaveLength(3);
    expect(undo.entries.every((x) => x.delete === true)).toBe(true);
  });

  it('poništavanje ne briše druge statuse; delimično stanje je PARTIAL', () => {
    const index = idx([cell('ana', DATES[0], 'NOT_WORKING'), cell('ana', DATES[1], 'GO')]);
    expect(wholePeriodNotWorkingState({ employeeId: 'ana', dates: DATES, index, isLocked: locked })).toBe('PARTIAL');
    const undo = planUndoWholePeriodNotWorking({ employeeId: 'ana', dates: DATES, index });
    expect(undo.entries.map((x) => x.work_date)).toEqual([DATES[0]]);
  });

  it('zaposleni bez ijednog dostupnog dana nema opciju', () => {
    const allLocked = () => true;
    expect(wholePeriodNotWorkingState({ employeeId: 'x', dates: DATES, index: new Map(), isLocked: allLocked }))
      .toBe('UNAVAILABLE');
  });
});
