import type { CalcLine, PreviewLine } from '../../lib/api/types';

/**
 * Zbir PO ZAPOSLENOM za ceo period, grupisan po vrsti naknade (redizajn §7, §21).
 *
 * Isto pravilo kao `previewBreakdown.ts`: ovo je PRIKAZ serverski izračunatih
 * linija — ništa se ne cenovniči, ne zaokružuje niti izvodi iz stope i količine.
 * Linija bez iznosa (pravilo nedostaje) se NE računa kao nula: broji se u
 * `blockedLines`, a iznos reda/grupe se tada prikazuje kao nepotpun.
 *
 * Prevoz je posebna grupa i NE ulazi u „ukupno naknade zaposlenom" (plaća se
 * prevozniku); prikazuje se odvojeno.
 */

export interface SummaryLine {
  employee_id: string;
  employee_name: string;
  employee_code?: string | null;
  line_kind: string;
  payment_type_code: string | null;
  units: number;
  amount: number | null;
}

export interface EmployeeSummaryRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  units: number;
  amount: number;
  blockedLines: number;
}

export interface EmployeeSummaryGroup {
  key: string;
  label: string;
  lineKind: string;
  rows: EmployeeSummaryRow[];
  units: number;
  amount: number;
  blockedLines: number;
}

export const PAYMENT_LABEL: Record<string, string> = {
  KARNET: 'Karnet',
  OBUKA: 'Obuka',
  DNEVNICA: 'Dnevnica',
  DODATNA_DNEVNICA: 'Dodatna dnevnica',
  ISPOMOC: 'Ispomoć',
  RADNA_SUBOTA: 'Radna subota',
  PREKOVREMENI: 'Prekovremeni rad',
  NOCNI_RAD: 'Noćni rad',
  STOPOVI: 'Stopovi',
  KOREKCIJA: 'Korekcija',
  PREVOZ: 'Prevoz',
};

const ORDER = [
  'KARNET', 'OBUKA', 'DNEVNICA', 'DODATNA_DNEVNICA', 'ISPOMOC', 'RADNA_SUBOTA',
  'PREKOVREMENI', 'NOCNI_RAD', 'STOPOVI', 'KOREKCIJA',
];

export function groupKeyOf(line: Pick<SummaryLine, 'line_kind' | 'payment_type_code'>): string {
  if (line.line_kind === 'TRANSPORT') return 'PREVOZ';
  return line.payment_type_code ?? '—';
}

export function fromPreviewLines(lines: PreviewLine[]): SummaryLine[] {
  return lines.map((l) => ({
    employee_id: l.employee_id,
    employee_name: l.employee_name,
    employee_code: null,
    line_kind: l.line_kind,
    payment_type_code: l.payment_type_code,
    units: l.units,
    // Isto pravilo kao fromCalcLines (operaterski Pregled i Finansije se ne razilaze).
    amount: summaryAmount(l.status, l.calculated_amount),
  }));
}

/**
 * Statusi stavke koji BLOKIRAJU obračun — isti skup kao u bazi
 * (app.submission_calc_totals: MISSING_RULE, MISSING_PAYMENT_TYPE,
 * RULE_NOT_PRICEABLE). Ostali ne-RESOLVED statusi su REŠENI ODGOVORI bez iznosa
 * (npr. NOT_ELIGIBLE = zaposleni nema pravo na prevoz, NO_TRANSPORT_ASSIGNMENT)
 * i doprinose 0, a ne „nepotpuno".
 */
export const BLOCKING_LINE_STATUSES: ReadonlySet<string> = new Set([
  'MISSING_RULE', 'MISSING_PAYMENT_TYPE', 'RULE_NOT_PRICEABLE',
]);

function summaryAmount(status: string, amount: number | null): number | null {
  if (status === 'RESOLVED') return amount;
  return BLOCKING_LINE_STATUSES.has(status) ? null : 0;
}

export function fromCalcLines(lines: CalcLine[]): SummaryLine[] {
  return lines.map((l) => ({
    employee_id: l.employee_id,
    employee_name: l.employee_name,
    employee_code: l.employee_code,
    line_kind: l.line_kind,
    payment_type_code: l.payment_type_code,
    units: l.units,
    // Ranije: svaki ne-RESOLVED status → null, pa je zaposleni BEZ prevoza
    // (TRANSPORT / NOT_ELIGIBLE) u Finansijama dobijao „nepotpuno" iako baza tu
    // stavku ne smatra blokadom i prijava je validno odobrena.
    amount: summaryAmount(l.status, l.amount),
  }));
}

function rank(key: string): number {
  if (key === 'PREVOZ') return 1000;
  const i = ORDER.indexOf(key);
  return i === -1 ? 500 : i;
}

export function summarizeByEmployee(lines: SummaryLine[]): EmployeeSummaryGroup[] {
  const groups = new Map<string, EmployeeSummaryGroup>();
  const rows = new Map<string, EmployeeSummaryRow>();

  for (const l of lines) {
    const key = groupKeyOf(l);
    const g =
      groups.get(key) ??
      {
        key,
        label: PAYMENT_LABEL[key] ?? key,
        lineKind: l.line_kind,
        rows: [],
        units: 0,
        amount: 0,
        blockedLines: 0,
      };
    groups.set(key, g);

    const rk = `${key}|${l.employee_id}`;
    let r = rows.get(rk);
    if (!r) {
      r = {
        employeeId: l.employee_id,
        employeeName: l.employee_name,
        employeeCode: l.employee_code ?? null,
        units: 0,
        amount: 0,
        blockedLines: 0,
      };
      rows.set(rk, r);
      g.rows.push(r);
    }

    if (l.amount == null) {
      r.blockedLines += 1;
      g.blockedLines += 1;
    } else {
      r.amount += l.amount;
      r.units += l.units;
      g.amount += l.amount;
      g.units += l.units;
    }
  }

  for (const g of groups.values()) {
    g.rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'sr'));
    g.amount = round2(g.amount);
    for (const r of g.rows) r.amount = round2(r.amount);
  }

  return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

export interface EmployeeTotal {
  employeeId: string;
  /** Zbir naknada zaposlenom (bez prevoza), samo iz obračunatih linija. */
  amount: number;
  transportAmount: number;
  /** > 0 znači da iznos nije konačan — neka linija nema pravilo. */
  blockedLines: number;
}

export function employeeTotals(lines: SummaryLine[]): Map<string, EmployeeTotal> {
  const out = new Map<string, EmployeeTotal>();
  for (const l of lines) {
    const t =
      out.get(l.employee_id) ??
      { employeeId: l.employee_id, amount: 0, transportAmount: 0, blockedLines: 0 };
    if (l.amount == null) t.blockedLines += 1;
    else if (l.line_kind === 'TRANSPORT') t.transportAmount = round2(t.transportAmount + l.amount);
    else t.amount = round2(t.amount + l.amount);
    out.set(l.employee_id, t);
  }
  return out;
}

/** Zbir već zaokruženih serverskih iznosa; samo uklanja binarni šum sabiranja. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Završni prolaz §5: Finance pregled Karnet/Obuka po zaposlenom (kao Preview)
// ---------------------------------------------------------------------------

export interface PeriodLine extends SummaryLine {
  attendance_status?: string | null;
}

export interface EmployeePeriodRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  /** npr. „Karnet" ili „Karnet + Obuka" kada se tip menja u toku perioda. */
  baseTypes: string[];
  /** Broj plaćenih osnovnih dana po statusu (rad, GO, BO …). */
  dayCounts: Record<string, number>;
  baseAmount: number;
  /** Komponente (stari model pre cutover-a: ispomoć, prekovremeni …). */
  otherAmount: number;
  transportAmount: number;
  total: number;
  blockedLines: number;
}

const STATUS_SHORT: Record<string, string> = {
  WORK: 'rad', GO: 'GO', BO: 'BO', OFF: 'slobodan', NOT_WORKING: 'ne radi',
};

/**
 * Jedan red po zaposlenom za ceo period: osnovna naknada, ostale stavke, prevoz
 * (odvojeno) i UKUPNO. Samo zbir serverskih iznosa — ništa se ne preračunava.
 * Stavka bez pravila → red je nepotpun (`blockedLines`), ne nula.
 */
export function employeePeriodRows(lines: PeriodLine[]): EmployeePeriodRow[] {
  const map = new Map<string, EmployeePeriodRow>();
  for (const l of lines) {
    const r =
      map.get(l.employee_id) ??
      {
        employeeId: l.employee_id, employeeName: l.employee_name, employeeCode: l.employee_code ?? null,
        baseTypes: [], dayCounts: {}, baseAmount: 0, otherAmount: 0, transportAmount: 0, total: 0,
        blockedLines: 0,
      };
    if (l.line_kind === 'PRIMARY') {
      const label = PAYMENT_LABEL[l.payment_type_code ?? ''] ?? l.payment_type_code ?? '—';
      if (!r.baseTypes.includes(label)) r.baseTypes.push(label);
      const st = STATUS_SHORT[l.attendance_status ?? ''] ?? (l.attendance_status ?? 'ostalo');
      r.dayCounts[st] = (r.dayCounts[st] ?? 0) + l.units;
    }
    if (l.amount == null) {
      r.blockedLines += 1;
    } else if (l.line_kind === 'TRANSPORT') {
      r.transportAmount = round2(r.transportAmount + l.amount);
    } else if (l.line_kind === 'PRIMARY') {
      r.baseAmount = round2(r.baseAmount + l.amount);
    } else {
      r.otherAmount = round2(r.otherAmount + l.amount);
    }
    r.total = round2(r.baseAmount + r.otherAmount + r.transportAmount);
    map.set(l.employee_id, r);
  }
  return [...map.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'sr'));
}

export function fromCalcLinesWithStatus(lines: CalcLine[]): PeriodLine[] {
  return lines.map((l) => ({ ...fromCalcLines([l])[0], attendance_status: l.attendance_status }));
}
