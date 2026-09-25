/**
 * Stopovi kurira — čist model.
 *
 * Ovde namerno NE postoji nijedan tip koji nosi cenu ili iznos kao ULAZ.
 * Operater unosi broj stopova; cena i iznos stižu sa servera i samo se
 * prikazuju. Sve što je ovde izračunato nad novcem je prepis serverskog
 * odgovora, nikada sopstveni obračun.
 */

export type CourierStopStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'FINANCE_APPROVED';

export interface CourierStopSubmission {
  id: string;
  center_id: string;
  period_id: string;
  period_start: string;
  period_end: string;
  status: CourierStopStatus;
  return_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
}

export interface CourierStopLine {
  /** Stabilan identitet. Ime se koristi SAMO za prikaz — imenjaci postoje. */
  employee_id: string | null;
  center_id: string | null;
  employee_name: string;
  employee_code: string | null;
  center_code: string;
  work_date: string;
  stop_count: number;
  /** Serverska vrednost. Nikada se ne unosi. */
  rate_used: number | null;
  /** Serverska vrednost. Nikada se ne unosi. */
  calculated_amount: number | null;
  status?: string;
  source: 'SNAPSHOT' | 'CALCULATED';
}

export interface CourierStopTotals {
  total_stops: number;
  total_amount: number | null;
  line_count: number;
  employee_count: number;
  blocking_line_count: number;
  is_complete: boolean;
  source: 'SNAPSHOT' | 'CALCULATED';
}

export interface CourierStopValidationError {
  severity: string;
  code: string;
  message: string;
}

export interface CourierStopDetail {
  submission_type: 'COURIER_STOPS';
  submission: CourierStopSubmission;
  is_approved: boolean;
  totals: CourierStopTotals;
  errors: CourierStopValidationError[];
  lines: CourierStopLine[];
}

/** Datumi dolaze iz STVARNOG perioda prijave, ne iz pretpostavke pon–pet. */
export function periodDates(start: string, end: string): string[] {
  const out: string[] = [];
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return out;
  for (let d = from; d <= to; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const DAY_SHORT = ['Ned', 'Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub'];

export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAY_SHORT[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Mesec za BA podelu; linija koja prelazi granicu meseca ide po SVOM datumu. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export interface CourierRow {
  employee_id: string;
  employee_name: string;
  employee_code: string | null;
  /** work_date → broj stopova */
  stops: Record<string, number>;
}

/**
 * Red po kuriru. Prikazuju se SAMO kuriri koji stvarno učestvuju u evidenciji
 * stopova, plus oni koje je operater izričito dodao — ne ceo centar.
 */
export function buildRows(
  lines: Array<{ employee_id?: string | null; employee_name: string;
                 employee_code?: string | null; work_date: string; stop_count: number }>,
  extra: Array<{ employee_id: string; full_name: string; employee_code?: string | null }> = [],
): CourierRow[] {
  const byId = new Map<string, CourierRow>();

  for (const l of lines) {
    // Ime je rezervni ključ samo za istorijske linije bez identiteta; dok
    // `employee_id` postoji, ime se NIKADA ne koristi kao identitet reda.
    const id = l.employee_id ?? l.employee_name;
    let row = byId.get(id);
    if (!row) {
      row = {
        employee_id: id,
        employee_name: l.employee_name,
        employee_code: l.employee_code ?? null,
        stops: {},
      };
      byId.set(id, row);
    }
    row.stops[l.work_date] = l.stop_count;
  }

  for (const e of extra) {
    if (byId.has(e.employee_id)) continue;
    byId.set(e.employee_id, {
      employee_id: e.employee_id,
      employee_name: e.full_name,
      employee_code: e.employee_code ?? null,
      stops: {},
    });
  }

  return [...byId.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'sr'));
}

export function rowTotal(row: CourierRow): number {
  return Object.values(row.stops).reduce((a, b) => a + b, 0);
}

/**
 * Provera unosa PRE slanja na server. Server ostaje merodavan — ovo samo
 * sprečava da operater pošalje očiglednu grešku i dobije poruku tek posle
 * mrežnog poziva.
 */
export type StopInput =
  | { kind: 'clear' }
  | { kind: 'value'; value: number }
  | { kind: 'error'; message: string };

export function parseStopInput(raw: string): StopInput {
  const text = raw.trim();
  if (text === '') return { kind: 'clear' };

  if (!/^-?\d+$/.test(text)) {
    return { kind: 'error', message: 'Broj stopova mora biti ceo broj.' };
  }

  const n = Number(text);
  // `-5` je omaška u kucanju. Tiho brisanje zapisa je najgori mogući odgovor na
  // omašku, pa se odbija i ovde i na serveru (INVALID_STOP_COUNT).
  if (n < 0) {
    return { kind: 'error', message: 'Broj stopova ne može biti negativan. Za brisanje unesite 0.' };
  }
  if (n === 0) return { kind: 'clear' };
  return { kind: 'value', value: n };
}

/** Slanje je moguće samo bez blokirajućih grešaka i samo iz dozvoljenog statusa. */
export function canSubmit(detail: CourierStopDetail | null, canSubmitPerm: boolean): boolean {
  if (!detail || !canSubmitPerm) return false;
  if (!['DRAFT', 'RETURNED'].includes(detail.submission.status)) return false;
  if (detail.errors.some((e) => e.severity === 'ERROR')) return false;
  return detail.totals.line_count > 0;
}

export function isEditable(detail: CourierStopDetail | null): boolean {
  if (!detail) return false;
  return ['DRAFT', 'RETURNED'].includes(detail.submission.status);
}

export const STATUS_LABEL: Record<CourierStopStatus, string> = {
  DRAFT: 'U pripremi',
  SUBMITTED: 'Poslato Finansijama',
  RETURNED: 'Vraćeno na ispravku',
  FINANCE_APPROVED: 'Odobreno',
};

/** BA: podela po mesecu radi ekonomske atribucije po stvarnom work_date. */
export function splitByMonth(
  lines: Array<{ work_date: string; stop_count: number; calculated_amount: number | null }>,
): Array<{ month: string; stops: number; amount: number }> {
  const acc = new Map<string, { month: string; stops: number; amount: number }>();
  for (const l of lines) {
    const k = monthKey(l.work_date);
    const cur = acc.get(k) ?? { month: k, stops: 0, amount: 0 };
    cur.stops += l.stop_count;
    cur.amount += l.calculated_amount ?? 0;
    acc.set(k, cur);
  }
  return [...acc.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Prosečan broj stopova po kuriru i danu — samo kada je matematički smisleno. */
export function averageStopsPerCourierDay(
  lines: Array<{ employee_id?: string | null; employee_name: string; work_date: string;
                 stop_count: number }>,
): number | null {
  const activeDays = new Set(lines.map((l) => `${l.employee_id ?? l.employee_name}|${l.work_date}`));
  if (activeDays.size === 0) return null;
  const stops = lines.reduce((a, l) => a + l.stop_count, 0);
  return stops / activeDays.size;
}

/**
 * Cena po stopu iz ODOBRENIH podataka. Namerno se računa iz iznosa i stopova,
 * a ne uzima iz tekućeg cenovnika — odobrena prošlost se ne preračunava.
 */
export function costPerStop(totalAmount: number | null, totalStops: number): number | null {
  if (totalAmount === null || totalStops <= 0) return null;
  return totalAmount / totalStops;
}
