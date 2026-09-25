import type { EmployeeDuplicateCheck, EmployeeProfile } from '../../lib/api/types';

/**
 * Pure rules for the Employee Master screens.
 *
 * These helpers never decide anything the database doesn't re-check; they exist
 * so the UI can refuse early and explain why, instead of sending the user to the
 * server to be told the obvious.
 */

export interface NewEmployeeForm {
  employee_code: string;
  first_name: string;
  last_name: string;
  employment_start_date: string;
  center_id: string;
  primary_payment_type_id: string;
  default_shift_template_id: string;
  transport_required: 'da' | 'ne';
  transport_provider_id: string;
  transport_valid_from: string;
  notes: string;
}

export function newEmployeeErrors(f: NewEmployeeForm): string[] {
  const out: string[] = [];
  if (f.first_name.trim() === '') out.push('Unesite ime.');
  if (f.last_name.trim() === '') out.push('Unesite prezime.');
  if (f.employment_start_date === '') out.push('Unesite datum početka radnog odnosa.');
  if (f.center_id === '') out.push('Izaberite centar.');
  if (f.primary_payment_type_id === '') out.push('Izaberite osnovnu vrstu isplate.');
  // „Prevoz DA" bez prevoznika nije podatak nego rupa.
  if (f.transport_required === 'da' && f.transport_provider_id === '') {
    out.push('Ako je prevoz potreban, izaberite prevoznika.');
  }
  return out;
}

/**
 * How a duplicate check should be presented.
 *
 * `blocked`  — same employee code: the same person is never entered twice.
 * `warning`  — same or similar name: legitimate namesakes exist, so this needs an
 *              explicit human confirmation and never an automatic merge.
 * `clear`    — nothing found.
 */
export function duplicateSeverity(
  d: EmployeeDuplicateCheck | null,
): { kind: 'blocked' | 'warning' | 'clear' | 'unknown'; count: number } {
  if (!d) return { kind: 'unknown', count: 0 };
  if (d.exact_code) return { kind: 'blocked', count: 1 };
  const count = d.exact_name.length + d.similar.length;
  return count > 0 ? { kind: 'warning', count } : { kind: 'clear', count: 0 };
}

/**
 * True when a proposed effective date falls inside approved history.
 *
 * The server refuses these anyway (ASSIGNMENT_HISTORY_PROTECTED /
 * TRANSPORT_HISTORY_PROTECTED); showing it early saves a pointless round trip.
 */
export function isChangeBlockedByHistory(
  fromDate: string | undefined | null,
  lastApprovedWorkDate: string | null,
): boolean {
  if (!fromDate || !lastApprovedWorkDate) return false;
  return fromDate <= lastApprovedWorkDate;
}

export function guardLabel(guard: EmployeeProfile['history_guard']): string {
  if (!guard.last_approved_work_date) {
    return 'Nema odobrene finansijske istorije — raspodele i prevoz su slobodno izmenljivi.';
  }
  return `Odobrena istorija do ${guard.last_approved_work_date}. `
    + 'Raspodele i prevoz se do tog datuma ne menjaju; izmene se prave kao buduće, '
    + 'efektivno datirane.';
}

/** Current row of an effective-dated history, if any. */
export function currentOf<T extends { is_current: boolean }>(rows: T[]): T | null {
  return rows.find((r) => r.is_current) ?? null;
}
