import type { GridEmployee, IsoDate } from '../../lib/api/types';
import { cellKey, isoWeekday, type CellIndex } from './model';

/**
 * Completion model (see docs/GRID-UX.md for the reasoning).
 *
 * The operator must not be forced to fill weekend or off days just to make a
 * progress bar reach 100%. An empty cell means "nije pregledano": no database
 * row, no cost, and no validation error.
 *
 * Completion is therefore computed against EXPECTED days, not against "every
 * cell in the period". It is an operator aid only. The gate for sending a period
 * is always the database: `validation.errors` and `preview.can_submit`.
 */
export type ExpectedDaysMode = 'MON_FRI' | 'MON_SAT' | 'MON_SUN';

export const EXPECTED_MODE_LABEL: Record<ExpectedDaysMode, string> = {
  MON_FRI: 'pon–pet',
  MON_SAT: 'pon–sub',
  MON_SUN: 'pon–ned',
};

const MAX_WEEKDAY: Record<ExpectedDaysMode, number> = {
  MON_FRI: 5,
  MON_SAT: 6,
  MON_SUN: 7,
};

export function isExpectedDate(date: IsoDate, mode: ExpectedDaysMode): boolean {
  return isoWeekday(date) <= MAX_WEEKDAY[mode];
}

/**
 * Podrazumevani režim očekivanih dana je UVEK Mon–Fri, bez obzira na dužinu
 * perioda. Potvrđena poslovna odluka: subota nije podrazumevano očekivan radni
 * dan — radna subota se dodaje po nedelji kroz `setExpectedDate`. Operater može
 * da promeni režim u toolbaru, a izbor se pamti po prijavi.
 *
 * Parametar se namerno zadržava u potpisu: pozivaoci ga već prosleđuju, a
 * ukidanje bi bilo izmena API-ja komponente bez ikakve koristi.
 */
export function defaultExpectedMode(_dates: IsoDate[]): ExpectedDaysMode {
  return 'MON_FRI';
}

/** Any explicit attendance status counts as reviewed — including NOT_WORKING. */
export function isReviewed(index: CellIndex, employeeId: string, date: IsoDate): boolean {
  return index.has(cellKey(employeeId, date));
}

export interface EmployeeCompletion {
  employeeId: string;
  expected: number;
  reviewed: number;
  missingDates: IsoDate[];
}

export interface CompletionSummary {
  expected: number;
  reviewed: number;
  /** 0–100, rounded. 100 when nothing is expected. */
  percent: number;
  byEmployee: EmployeeCompletion[];
  /** Cells that are expected but still empty. */
  missingKeys: string[];
}

export function computeCompletion(args: {
  dates: IsoDate[];
  employees: GridEmployee[];
  index: CellIndex;
  mode: ExpectedDaysMode;
}): CompletionSummary {
  const { dates, employees, index, mode } = args;
  const expectedDates = dates.filter((d) => isExpectedDate(d, mode));

  const byEmployee: EmployeeCompletion[] = [];
  const missingKeys: string[] = [];
  let expected = 0;
  let reviewed = 0;

  for (const e of employees) {
    const missing: IsoDate[] = [];
    let empReviewed = 0;
    for (const d of expectedDates) {
      if (isReviewed(index, e.employee_id, d)) empReviewed += 1;
      else {
        missing.push(d);
        missingKeys.push(cellKey(e.employee_id, d));
      }
    }
    expected += expectedDates.length;
    reviewed += empReviewed;
    byEmployee.push({
      employeeId: e.employee_id,
      expected: expectedDates.length,
      reviewed: empReviewed,
      missingDates: missing,
    });
  }

  return {
    expected,
    reviewed,
    percent: expected === 0 ? 100 : Math.round((reviewed / expected) * 100),
    byEmployee,
    missingKeys,
  };
}

/**
 * Sending is decided by the SERVER, never by this browser-side estimate.
 *
 * Since migration 0017 an empty expected employee-day is a hard error
 * (INCOMPLETE_EXPECTED_ENTRIES), so completeness DOES block submission — but the
 * authoritative expected dates, the completeness count and the warning
 * acknowledgements all come from `api.rpc_get_submission_preview`. This helper
 * exists so no component is tempted to invent its own gate: it only forwards
 * `ready_to_submit`, and refuses to guess when the server has not answered yet.
 */
export function canSend(args: { previewReadyToSubmit: boolean | null }): boolean {
  return args.previewReadyToSubmit === true;
}
