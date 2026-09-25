import { describe, expect, it } from 'vitest';
import { applyStatus, clearCells, copyFromOffset, describeSkips } from '../src/features/grid/bulk';
import { cellKey, type CellIndex } from '../src/features/grid/model';
import type { AttendanceStatusCode, GridCellPayload, GridEmployee, GridSegment } from '../src/lib/api/types';

const allows = (c: AttendanceStatusCode) => c === 'WORK';

const emp = (id: string, tpl: string | null = 't1'): GridEmployee => ({
  employee_id: id, full_name: id, employee_code: null, home_center_code: 'B6',
  primary_payment_type_id: null, primary_payment_type_code: null,
  default_shift_template_id: tpl, transport_required: null, transport_provider_code: null,
});

const seg = (over: Partial<GridSegment> = {}): GridSegment => ({
  id: 1, center_code: 'B6', cost_center_code: 'B6', segment_type: 'REGULAR',
  shift_template_id: 't1', shift_start: '06:00:00', shift_end: '14:00:00',
  crosses_midnight: false, worked_hours: 8, sequence_no: 1,
  in_this_submission: true, editable_here: true, ...over,
});

function cell(over: Partial<GridCellPayload>): GridCellPayload {
  return {
    work_entry_id: 'w', employee_id: 'e1', work_date: '2026-07-06', attendance_status: 'WORK',
    primary_payment_type_id: null, home_center_code: 'B6', owner_submission_id: 's1',
    owned_by_this_submission: true, notes: null, segments: [seg()], components: [],
    has_assistance: false, has_foreign_segment: false, ...over,
  };
}

function idx(cells: GridCellPayload[]): CellIndex {
  const m: CellIndex = new Map();
  for (const c of cells) m.set(cellKey(c.employee_id, c.work_date), c);
  return m;
}

describe('applyStatus', () => {
  it('sends an absence status without a shift', () => {
    const plan = applyStatus({
      keys: ['e1|2026-07-06'], status: 'GO', index: new Map(), employees: [emp('e1')],
      statusAllowsSegments: allows,
    });
    expect(plan.entries).toEqual([
      { employee_id: 'e1', work_date: '2026-07-06', attendance_status: 'GO' },
    ]);
  });

  it('falls back to the employee default shift for WORK', () => {
    const plan = applyStatus({
      keys: ['e1|2026-07-06'], status: 'WORK', index: new Map(), employees: [emp('e1', 't9')],
      statusAllowsSegments: allows,
    });
    expect(plan.entries[0].shift_template_id).toBe('t9');
  });

  it('skips a WORK cell when no shift can be determined', () => {
    const plan = applyStatus({
      keys: ['e1|2026-07-06'], status: 'WORK', index: new Map(), employees: [emp('e1', null)],
      statusAllowsSegments: allows,
    });
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('NO_SHIFT');
  });

  it('never touches a cell owned by another center', () => {
    const index = idx([cell({ owned_by_this_submission: false })]);
    const plan = applyStatus({
      keys: ['e1|2026-07-06'], status: 'GO', index, employees: [emp('e1')],
      statusAllowsSegments: allows,
    });
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('FOREIGN_CELL');
  });
});

describe('clearCells', () => {
  it('deletes existing cells and skips empty ones', () => {
    const index = idx([cell({})]);
    const plan = clearCells({ keys: ['e1|2026-07-06', 'e1|2026-07-07'], index });
    expect(plan.entries).toEqual([
      { employee_id: 'e1', work_date: '2026-07-06', delete: true },
    ]);
    expect(plan.skipped[0].reason).toBe('ALREADY_EMPTY');
  });

  it('refuses to delete a day owned by another center', () => {
    const index = idx([cell({ owned_by_this_submission: false })]);
    const plan = clearCells({ keys: ['e1|2026-07-06'], index });
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('FOREIGN_CELL');
  });
});

describe('copy previous day / week', () => {
  const period = { periodStart: '2026-07-06', periodEnd: '2026-07-12' };

  it('copies the shift template of the previous day', () => {
    const index = idx([cell({ work_date: '2026-07-06', segments: [seg({ shift_template_id: 't2' })] })]);
    const plan = copyFromOffset({ keys: ['e1|2026-07-07'], index, offsetDays: 1, ...period });
    expect(plan.entries).toEqual([
      {
        employee_id: 'e1', work_date: '2026-07-07', attendance_status: 'WORK',
        shift_template_id: 't2', shift_start: null, shift_end: null,
      },
    ]);
  });

  it('copies explicit times when the source has no template', () => {
    const index = idx([cell({
      work_date: '2026-07-06',
      segments: [seg({ shift_template_id: null, shift_start: '09:30:00', shift_end: '17:30:00' })],
    })]);
    const plan = copyFromOffset({ keys: ['e1|2026-07-07'], index, offsetDays: 1, ...period });
    expect(plan.entries[0].shift_start).toBe('09:30:00');
    expect(plan.entries[0].shift_end).toBe('17:30:00');
  });

  it('copies an absence status as-is', () => {
    const index = idx([cell({ work_date: '2026-07-06', attendance_status: 'GO', segments: [] })]);
    const plan = copyFromOffset({ keys: ['e1|2026-07-07'], index, offsetDays: 1, ...period });
    expect(plan.entries[0]).toEqual({
      employee_id: 'e1', work_date: '2026-07-07', attendance_status: 'GO',
    });
  });

  it('skips when the source day is empty', () => {
    const plan = copyFromOffset({ keys: ['e1|2026-07-07'], index: new Map(), offsetDays: 1, ...period });
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('NO_SOURCE');
  });

  it('skips when the source day is outside the loaded period', () => {
    const plan = copyFromOffset({ keys: ['e1|2026-07-06'], index: new Map(), offsetDays: 1, ...period });
    expect(plan.skipped[0].reason).toBe('NOT_IN_PERIOD');
  });

  it('previous week reaches seven days back', () => {
    const index = idx([cell({ work_date: '2026-07-06' })]);
    const plan = copyFromOffset({ keys: ['e1|2026-07-13'], index, offsetDays: 7, periodStart: '2026-07-06', periodEnd: '2026-07-19' });
    expect(plan.entries[0].work_date).toBe('2026-07-13');
  });

  it('never duplicates a foreign assistance segment', () => {
    const index = idx([cell({
      work_date: '2026-07-06',
      segments: [seg({ in_this_submission: false, center_code: 'BZ', segment_type: 'ASSISTANCE' })],
    })]);
    const plan = copyFromOffset({ keys: ['e1|2026-07-07'], index, offsetDays: 1, ...period });
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('NO_SHIFT');
  });
});

describe('skip reporting', () => {
  it('summarises skips for the operator', () => {
    const text = describeSkips({
      entries: [],
      skipped: [
        { key: 'a', reason: 'FOREIGN_CELL' },
        { key: 'b', reason: 'FOREIGN_CELL' },
        { key: 'c', reason: 'NO_SOURCE' },
      ],
    });
    expect(text).toContain('2 ×');
    expect(text).toContain('1 ×');
  });

  it('returns null when nothing was skipped', () => {
    expect(describeSkips({ entries: [], skipped: [] })).toBeNull();
  });
});
