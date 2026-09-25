import type {
  AttendanceStatusCode,
  BulkEntryInput,
  GridEmployee,
  ShiftTemplateRef,
  Uuid,
} from '../../lib/api/types';
import { cellKey, parseCellKey, shiftDate, type CellIndex } from './model';

export interface BulkPlan {
  entries: BulkEntryInput[];
  /** Cells intentionally left alone, with the reason, so the UI can say why. */
  skipped: Array<{ key: string; reason: SkipReason }>;
}

export type SkipReason =
  | 'FOREIGN_CELL'
  | 'NO_SOURCE'
  | 'NO_SHIFT'
  | 'ALREADY_EMPTY'
  | 'NOT_IN_PERIOD';

function isForeign(index: CellIndex, key: string): boolean {
  const cell = index.get(key);
  return Boolean(cell && !cell.owned_by_this_submission);
}

/**
 * Apply one attendance status to every selected cell.
 *
 * A WORK status needs a shift; the caller passes either an explicit template or
 * we fall back to each employee's default. If neither exists the cell is skipped
 * rather than sent with missing times, because the database would reject the
 * whole atomic batch.
 */
export function applyStatus(args: {
  keys: string[];
  status: AttendanceStatusCode;
  index: CellIndex;
  employees: GridEmployee[];
  shiftTemplateId?: Uuid | null;
  statusAllowsSegments: (code: AttendanceStatusCode) => boolean;
}): BulkPlan {
  const { keys, status, index, employees, shiftTemplateId } = args;
  const byId = new Map(employees.map((e) => [e.employee_id, e]));
  const entries: BulkEntryInput[] = [];
  const skipped: BulkPlan['skipped'] = [];

  for (const key of keys) {
    if (isForeign(index, key)) {
      skipped.push({ key, reason: 'FOREIGN_CELL' });
      continue;
    }
    const { employeeId, date } = parseCellKey(key);

    if (!args.statusAllowsSegments(status)) {
      entries.push({ employee_id: employeeId, work_date: date, attendance_status: status });
      continue;
    }

    const tpl = shiftTemplateId ?? byId.get(employeeId)?.default_shift_template_id ?? null;
    if (!tpl) {
      skipped.push({ key, reason: 'NO_SHIFT' });
      continue;
    }
    entries.push({
      employee_id: employeeId,
      work_date: date,
      attendance_status: status,
      shift_template_id: tpl,
    });
  }

  return { entries, skipped };
}

export function clearCells(args: { keys: string[]; index: CellIndex }): BulkPlan {
  const entries: BulkEntryInput[] = [];
  const skipped: BulkPlan['skipped'] = [];

  for (const key of args.keys) {
    if (isForeign(args.index, key)) {
      skipped.push({ key, reason: 'FOREIGN_CELL' });
      continue;
    }
    if (!args.index.has(key)) {
      skipped.push({ key, reason: 'ALREADY_EMPTY' });
      continue;
    }
    const { employeeId, date } = parseCellKey(key);
    entries.push({ employee_id: employeeId, work_date: date, delete: true });
  }

  return { entries, skipped };
}

/**
 * Copy the cell `offsetDays` earlier onto each selected cell.
 * offsetDays = 1 -> previous day, 7 -> same weekday of the previous week.
 *
 * The source must be inside the loaded period; otherwise the grid has no data
 * for it and guessing would be worse than skipping.
 */
export function copyFromOffset(args: {
  keys: string[];
  index: CellIndex;
  offsetDays: number;
  periodStart: string;
  periodEnd: string;
}): BulkPlan {
  const { keys, index, offsetDays, periodStart, periodEnd } = args;
  const entries: BulkEntryInput[] = [];
  const skipped: BulkPlan['skipped'] = [];

  for (const key of keys) {
    if (isForeign(index, key)) {
      skipped.push({ key, reason: 'FOREIGN_CELL' });
      continue;
    }
    const { employeeId, date } = parseCellKey(key);
    const srcDate = shiftDate(date, -offsetDays);

    if (srcDate < periodStart || srcDate > periodEnd) {
      skipped.push({ key, reason: 'NOT_IN_PERIOD' });
      continue;
    }

    const src = index.get(cellKey(employeeId, srcDate));
    if (!src) {
      skipped.push({ key, reason: 'NO_SOURCE' });
      continue;
    }
    if (!src.owned_by_this_submission) {
      skipped.push({ key, reason: 'FOREIGN_CELL' });
      continue;
    }

    if (src.attendance_status !== 'WORK') {
      entries.push({
        employee_id: employeeId,
        work_date: date,
        attendance_status: src.attendance_status,
      });
      continue;
    }

    // Only this submission's own REGULAR segment is copied. Assistance segments
    // belong to another center's submission and are never duplicated.
    const regular = src.segments.find(
      (s) => s.in_this_submission && s.segment_type === 'REGULAR',
    );
    if (!regular) {
      skipped.push({ key, reason: 'NO_SHIFT' });
      continue;
    }
    entries.push({
      employee_id: employeeId,
      work_date: date,
      attendance_status: 'WORK',
      shift_template_id: regular.shift_template_id,
      shift_start: regular.shift_template_id ? null : regular.shift_start,
      shift_end: regular.shift_template_id ? null : regular.shift_end,
    });
  }

  return { entries, skipped };
}

export function applyShiftTemplate(args: {
  keys: string[];
  index: CellIndex;
  template: ShiftTemplateRef;
  statusAllowsSegments: (code: AttendanceStatusCode) => boolean;
  employees: GridEmployee[];
}): BulkPlan {
  return applyStatus({
    keys: args.keys,
    status: 'WORK',
    index: args.index,
    employees: args.employees,
    shiftTemplateId: args.template.id,
    statusAllowsSegments: args.statusAllowsSegments,
  });
}

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  FOREIGN_CELL: 'segment drugog centra — taj centar mora sam da ga izmeni',
  NO_SOURCE: 'izvorni dan je prazan',
  NO_SHIFT: 'nema šablon smene',
  ALREADY_EMPTY: 'ćelija je već prazna',
  NOT_IN_PERIOD: 'izvorni dan je van perioda prijave',
};

export function describeSkips(plan: BulkPlan): string | null {
  if (plan.skipped.length === 0) return null;
  const counts = new Map<SkipReason, number>();
  for (const s of plan.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const parts = Array.from(counts.entries()).map(
    ([reason, n]) => `${n} × ${SKIP_REASON_TEXT[reason]}`,
  );
  return `Preskočeno: ${parts.join(', ')}.`;
}
