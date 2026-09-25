import { describe, expect, it } from 'vitest';
import {
  canSend, computeCompletion, defaultExpectedMode, isExpectedDate,
} from '../src/features/grid/completion';
import { cellKey, type CellIndex } from '../src/features/grid/model';
import type { GridCellPayload, GridEmployee } from '../src/lib/api/types';

// 2026-07-06 is a Monday, so 11.07 = Saturday and 12.07 = Sunday.
const WEEK = ['2026-07-06','2026-07-07','2026-07-08','2026-07-09','2026-07-10','2026-07-11','2026-07-12'];

const emp = (id: string): GridEmployee => ({
  employee_id: id, full_name: id, employee_code: null, home_center_code: 'B6',
  primary_payment_type_id: null, primary_payment_type_code: 'KARNET',
  default_shift_template_id: 't1', transport_required: false, transport_provider_code: null,
});

function index(entries: Array<[string, string, GridCellPayload['attendance_status']]>): CellIndex {
  const m: CellIndex = new Map();
  for (const [e, d, status] of entries) {
    m.set(cellKey(e, d), {
      work_entry_id: `${e}-${d}`, employee_id: e, work_date: d, attendance_status: status,
      primary_payment_type_id: null, home_center_code: 'B6', owner_submission_id: 's1',
      owned_by_this_submission: true, notes: null, segments: [], components: [],
      has_assistance: false, has_foreign_segment: false,
    });
  }
  return m;
}

describe('expected days', () => {
  it('MON_FRI excludes Saturday and Sunday', () => {
    expect(isExpectedDate('2026-07-10', 'MON_FRI')).toBe(true);
    expect(isExpectedDate('2026-07-11', 'MON_FRI')).toBe(false);
    expect(isExpectedDate('2026-07-12', 'MON_FRI')).toBe(false);
  });

  it('MON_SAT includes Saturday but not Sunday', () => {
    expect(isExpectedDate('2026-07-11', 'MON_SAT')).toBe(true);
    expect(isExpectedDate('2026-07-12', 'MON_SAT')).toBe(false);
  });

  it('MON_SUN includes every day', () => {
    expect(WEEK.every((d) => isExpectedDate(d, 'MON_SUN'))).toBe(true);
  });

  it('default je uvek MON_FRI, bez obzira na dužinu perioda', () => {
    // Potvrđena poslovna odluka: subota NIJE podrazumevano očekivan radni dan.
    // Radna subota se dodaje po nedelji kroz setExpectedDate, a operater i dalje
    // može ručno da promeni režim u toolbaru.
    expect(defaultExpectedMode(WEEK.slice(0, 5))).toBe('MON_FRI');
    expect(defaultExpectedMode(WEEK)).toBe('MON_FRI');
    expect(defaultExpectedMode([])).toBe('MON_FRI');
  });
});

describe('completion', () => {
  it('does not require weekend cells to reach 100%', () => {
    // Mon-Sat filled, Sunday untouched
    const idx = index(WEEK.slice(0, 6).map((d) => ['e1', d, 'WORK'] as const));
    const c = computeCompletion({ dates: WEEK, employees: [emp('e1')], index: idx, mode: 'MON_SAT' });
    expect(c.expected).toBe(6);
    expect(c.reviewed).toBe(6);
    expect(c.percent).toBe(100);
    expect(c.missingKeys).toEqual([]);
  });

  it('counts an explicit NOT_WORKING day as reviewed', () => {
    const idx = index([['e1', '2026-07-06', 'NOT_WORKING']]);
    const c = computeCompletion({ dates: ['2026-07-06'], employees: [emp('e1')], index: idx, mode: 'MON_FRI' });
    expect(c.reviewed).toBe(1);
  });

  it('reports empty expected cells as missing', () => {
    const idx = index([['e1', '2026-07-06', 'WORK']]);
    const c = computeCompletion({
      dates: WEEK.slice(0, 5), employees: [emp('e1'), emp('e2')], index: idx, mode: 'MON_FRI',
    });
    expect(c.expected).toBe(10);
    expect(c.reviewed).toBe(1);
    expect(c.percent).toBe(10);
    expect(c.byEmployee.find((x) => x.employeeId === 'e2')?.missingDates).toHaveLength(5);
  });

  it('is 100% when nothing is expected', () => {
    const c = computeCompletion({ dates: ['2026-07-12'], employees: [emp('e1')], index: new Map(), mode: 'MON_SAT' });
    expect(c.expected).toBe(0);
    expect(c.percent).toBe(100);
  });
});

describe('sending is decided by the server, never by the local estimate', () => {
  it('forwards the server answer', () => {
    expect(canSend({ previewReadyToSubmit: true })).toBe(true);
    expect(canSend({ previewReadyToSubmit: false })).toBe(false);
  });

  it('refuses to guess before the server has answered', () => {
    expect(canSend({ previewReadyToSubmit: null })).toBe(false);
  });

  it('a 100% local completion estimate is not a permission to send', () => {
    const idx = index([['e1', '2026-07-06', 'WORK']]);
    const c = computeCompletion({
      dates: ['2026-07-06'], employees: [emp('e1')], index: idx, mode: 'MON_FRI',
    });
    expect(c.percent).toBe(100);
    expect(canSend({ previewReadyToSubmit: false })).toBe(false);
  });
});
