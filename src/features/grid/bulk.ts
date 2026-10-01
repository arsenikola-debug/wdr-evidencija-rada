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
  | 'NOT_IN_PERIOD'
  | 'LOCKED_DAY';

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
  /** Dan van radnog odnosa / raspodele (eligibility, 0059). */
  isLocked?: (key: string) => boolean;
}): BulkPlan {
  const { keys, status, index, employees, shiftTemplateId } = args;
  const byId = new Map(employees.map((e) => [e.employee_id, e]));
  const entries: BulkEntryInput[] = [];
  const skipped: BulkPlan['skipped'] = [];

  for (const key of keys) {
    if (args.isLocked?.(key)) {
      skipped.push({ key, reason: 'LOCKED_DAY' });
      continue;
    }
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
  isLocked?: (key: string) => boolean;
}): BulkPlan {
  const { keys, index, offsetDays, periodStart, periodEnd } = args;
  const entries: BulkEntryInput[] = [];
  const skipped: BulkPlan['skipped'] = [];

  for (const key of keys) {
    if (args.isLocked?.(key)) {
      skipped.push({ key, reason: 'LOCKED_DAY' });
      continue;
    }
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
  LOCKED_DAY: 'dan je zaključan (van radnog odnosa ili raspodele u ovaj centar)',
};

// ---------------------------------------------------------------------------
// „Nije radio ceo period" (redizajn §5)
// ---------------------------------------------------------------------------

export type WholePeriodState = 'ALL' | 'PARTIAL' | 'NONE' | 'UNAVAILABLE';

function ownAvailableKeys(args: {
  employeeId: Uuid;
  dates: string[];
  index: CellIndex;
  isLocked?: (key: string) => boolean;
}): string[] {
  return args.dates
    .map((d) => cellKey(args.employeeId, d))
    .filter((k) => !args.isLocked?.(k) && !isForeign(args.index, k));
}

/**
 * Stanje opcije za jednog zaposlenog: ALL kada su SVI dostupni dani „Ne radi",
 * UNAVAILABLE kada zaposleni nema nijedan dostupan dan u ovoj prijavi.
 */
export function wholePeriodNotWorkingState(args: {
  employeeId: Uuid;
  dates: string[];
  index: CellIndex;
  isLocked?: (key: string) => boolean;
}): WholePeriodState {
  const keys = ownAvailableKeys(args);
  if (keys.length === 0) return 'UNAVAILABLE';
  const nw = keys.filter((k) => args.index.get(k)?.attendance_status === 'NOT_WORKING').length;
  if (nw === keys.length) return 'ALL';
  return nw === 0 ? 'NONE' : 'PARTIAL';
}

/**
 * Označava SVE dostupne dane zaposlenog kao NOT_WORKING. Zaključani dani i dani
 * drugog centra se ne diraju. `overwrites` je broj dana koji već imaju drugi
 * status — UI traži potvrdu pre nego što ih prepiše.
 */
export function planWholePeriodNotWorking(args: {
  employeeId: Uuid;
  dates: string[];
  index: CellIndex;
  isLocked?: (key: string) => boolean;
}): BulkPlan & { overwrites: number } {
  const entries: BulkEntryInput[] = [];
  const skipped: BulkPlan['skipped'] = [];
  let overwrites = 0;

  for (const d of args.dates) {
    const key = cellKey(args.employeeId, d);
    if (args.isLocked?.(key)) {
      skipped.push({ key, reason: 'LOCKED_DAY' });
      continue;
    }
    if (isForeign(args.index, key)) {
      skipped.push({ key, reason: 'FOREIGN_CELL' });
      continue;
    }
    const cur = args.index.get(key);
    if (cur?.attendance_status === 'NOT_WORKING') continue;
    if (cur) overwrites += 1;
    entries.push({ employee_id: args.employeeId, work_date: d, attendance_status: 'NOT_WORKING' });
  }
  return { entries, skipped, overwrites };
}

/**
 * Poništavanje: uklanja SAMO dane ovog zaposlenog koji su „Ne radi" u ovoj
 * prijavi, pa operater može ručno da unese stvarne podatke. Drugi statusi ostaju.
 */
export function planUndoWholePeriodNotWorking(args: {
  employeeId: Uuid;
  dates: string[];
  index: CellIndex;
}): BulkPlan {
  const entries: BulkEntryInput[] = [];
  for (const d of args.dates) {
    const key = cellKey(args.employeeId, d);
    const cur = args.index.get(key);
    if (cur && cur.owned_by_this_submission && cur.attendance_status === 'NOT_WORKING') {
      entries.push({ employee_id: args.employeeId, work_date: d, delete: true });
    }
  }
  return { entries, skipped: [] };
}

export function describeSkips(plan: BulkPlan): string | null {
  if (plan.skipped.length === 0) return null;
  const counts = new Map<SkipReason, number>();
  for (const s of plan.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const parts = Array.from(counts.entries()).map(
    ([reason, n]) => `${n} × ${SKIP_REASON_TEXT[reason]}`,
  );
  return `Preskočeno: ${parts.join(', ')}.`;
}
