import type {
  AttendanceStatusCode,
  GridCellPayload,
  GridPayload,
  IsoDate,
  Uuid,
} from '../../lib/api/types';

/**
 * How a grid cell looks to the operator.
 *
 * `EMPTY` is a first-class, legitimate state: no database row exists, so the day
 * costs nothing and validates cleanly. It means "nije pregledano", not "greška".
 * See docs/GRID-UX.md.
 */
export type CellKind =
  | 'EMPTY'
  | 'WORK'
  | 'WORK_NO_SHIFT'
  | 'GO'
  | 'BO'
  | 'OFF'
  | 'NOT_WORKING'
  | 'OTHER'
  | 'FOREIGN_ONLY';

export interface CellView {
  employeeId: Uuid;
  date: IsoDate;
  kind: CellKind;
  status: AttendanceStatusCode | null;
  workEntryId: Uuid | null;
  /** Short label rendered inside the cell, e.g. `06-14` or `GO`. */
  label: string;
  hours: number;
  shiftTemplateId: Uuid | null;
  hasAssistance: boolean;
  hasForeignSegment: boolean;
  /** false when the day is owned by another center's submission. */
  editableHere: boolean;
  notes: string | null;
}

export function cellKey(employeeId: Uuid, date: IsoDate): string {
  return `${employeeId}|${date}`;
}

export function parseCellKey(key: string): { employeeId: Uuid; date: IsoDate } {
  const i = key.indexOf('|');
  return { employeeId: key.slice(0, i), date: key.slice(i + 1) };
}

export type CellIndex = Map<string, GridCellPayload>;

export function buildCellIndex(payload: GridPayload): CellIndex {
  const idx: CellIndex = new Map();
  for (const c of payload.cells) idx.set(cellKey(c.employee_id, c.work_date), c);
  return idx;
}

export const STATUS_LABEL: Record<AttendanceStatusCode, string> = {
  WORK: 'RAD',
  GO: 'GO',
  BO: 'BO',
  OFF: 'SD',
  NOT_WORKING: 'NR',
  OTHER: 'OST',
};

export function shortShiftLabel(start: string, end: string): string {
  return `${start.slice(0, 2)}-${end.slice(0, 2)}`;
}

export function toCellView(
  employeeId: Uuid,
  date: IsoDate,
  cell: GridCellPayload | undefined,
): CellView {
  if (!cell) {
    return {
      employeeId,
      date,
      kind: 'EMPTY',
      status: null,
      workEntryId: null,
      label: '',
      hours: 0,
      shiftTemplateId: null,
      hasAssistance: false,
      hasForeignSegment: false,
      editableHere: true,
      notes: null,
    };
  }

  const own = cell.segments.filter((s) => s.in_this_submission);
  const foreign = cell.segments.filter((s) => !s.in_this_submission);
  const regular = own.find((s) => s.segment_type === 'REGULAR') ?? own[0];

  let kind: CellKind;
  if (!cell.owned_by_this_submission) {
    kind = 'FOREIGN_ONLY';
  } else if (cell.attendance_status === 'WORK') {
    kind = own.length === 0 ? 'WORK_NO_SHIFT' : 'WORK';
  } else {
    kind = cell.attendance_status;
  }

  const label =
    kind === 'WORK' && regular
      ? shortShiftLabel(regular.shift_start, regular.shift_end)
      : kind === 'FOREIGN_ONLY'
        ? (foreign[0] ? `${foreign[0].center_code}` : '—')
        : kind === 'WORK_NO_SHIFT'
          ? '?'
          : STATUS_LABEL[cell.attendance_status];

  return {
    employeeId,
    date,
    kind,
    status: cell.attendance_status,
    workEntryId: cell.work_entry_id,
    label,
    hours: cell.segments.reduce((s, x) => s + x.worked_hours, 0),
    shiftTemplateId: regular?.shift_template_id ?? null,
    hasAssistance: cell.has_assistance,
    hasForeignSegment: cell.has_foreign_segment,
    editableHere: cell.owned_by_this_submission,
    notes: cell.notes,
  };
}

/** Serbian day abbreviations for the sticky date header. */
const DAY_SHORT = ['ned', 'pon', 'uto', 'sre', 'čet', 'pet', 'sub'];

export function formatDateHeader(date: IsoDate): { day: string; dm: string; weekend: boolean } {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  return {
    day: DAY_SHORT[dow],
    dm: `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.`,
    weekend: dow === 0 || dow === 6,
  };
}

export function isoWeekday(date: IsoDate): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow; // 1 = Monday .. 7 = Sunday
}

export function shiftDate(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** RSD formatting for display only. All arithmetic happens in PostgreSQL. */
export function formatRsd(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('sr-Latn-RS', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
