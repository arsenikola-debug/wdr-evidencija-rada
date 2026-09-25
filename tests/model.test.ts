import { describe, expect, it } from 'vitest';
import { formatDateHeader, formatRsd, isoWeekday, shiftDate, toCellView } from '../src/features/grid/model';
import type { GridCellPayload, GridSegment } from '../src/lib/api/types';

const seg = (over: Partial<GridSegment> = {}): GridSegment => ({
  id: 1, center_code: 'B6', cost_center_code: 'B6', segment_type: 'REGULAR',
  shift_template_id: 't1', shift_start: '06:00:00', shift_end: '14:00:00',
  crosses_midnight: false, worked_hours: 8, sequence_no: 1,
  in_this_submission: true, editable_here: true, ...over,
});

const base: GridCellPayload = {
  work_entry_id: 'w1', employee_id: 'e1', work_date: '2026-07-06', attendance_status: 'WORK',
  primary_payment_type_id: null, home_center_code: 'B6', owner_submission_id: 's1',
  owned_by_this_submission: true, notes: null, segments: [seg()], components: [],
  has_assistance: false, has_foreign_segment: false,
};

describe('cell view', () => {
  it('treats a missing row as EMPTY, not as an error', () => {
    const v = toCellView('e1', '2026-07-06', undefined);
    expect(v.kind).toBe('EMPTY');
    expect(v.label).toBe('');
    expect(v.editableHere).toBe(true);
  });

  it('labels a work day with the shift range', () => {
    expect(toCellView('e1', '2026-07-06', base).label).toBe('06-14');
  });

  it('flags WORK without a segment as an error state', () => {
    const v = toCellView('e1', '2026-07-06', { ...base, segments: [] });
    expect(v.kind).toBe('WORK_NO_SHIFT');
  });

  it('marks a day owned by another center as read-only', () => {
    const v = toCellView('e1', '2026-07-06', {
      ...base,
      owned_by_this_submission: false,
      segments: [seg({ in_this_submission: false, center_code: 'BZ' })],
    });
    expect(v.kind).toBe('FOREIGN_ONLY');
    expect(v.editableHere).toBe(false);
    expect(v.label).toBe('BZ');
  });

  it('shows absence codes', () => {
    expect(toCellView('e1', '2026-07-06', { ...base, attendance_status: 'GO', segments: [] }).label).toBe('GO');
    expect(toCellView('e1', '2026-07-06', { ...base, attendance_status: 'NOT_WORKING', segments: [] }).label).toBe('NR');
  });

  it('sums hours across own and foreign segments', () => {
    const v = toCellView('e1', '2026-07-06', {
      ...base,
      segments: [seg({ worked_hours: 4 }), seg({ id: 2, worked_hours: 4, in_this_submission: false, center_code: 'BZ' })],
    });
    expect(v.hours).toBe(8);
  });
});

describe('dates', () => {
  it('uses ISO weekdays with Monday = 1', () => {
    expect(isoWeekday('2026-07-06')).toBe(1);
    expect(isoWeekday('2026-07-12')).toBe(7);
  });

  it('marks Saturday and Sunday as weekend in the header', () => {
    expect(formatDateHeader('2026-07-11').weekend).toBe(true);
    expect(formatDateHeader('2026-07-08').weekend).toBe(false);
    expect(formatDateHeader('2026-07-08').dm).toBe('08.07.');
  });

  it('shifts dates across month boundaries', () => {
    expect(shiftDate('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftDate('2026-07-31', 1)).toBe('2026-08-01');
  });
});

describe('display formatting', () => {
  it('renders a dash instead of zero for an unpriced line', () => {
    expect(formatRsd(null)).toBe('—');
  });
  it('formats numbers without inventing arithmetic', () => {
    expect(formatRsd(9300).replace(/\u00a0/g, ' ')).toMatch(/9[.,\s]?300/);
  });
});
