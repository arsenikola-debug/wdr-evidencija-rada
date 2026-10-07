import { sortByCenter } from './groupByCenter';
import { formatPeriod } from '../../lib/format/date';
import type {
  AdminPayoutReport,
  IsoDate,
  PayoutReportCategory,
  PayoutReportEmployeeRow,
  Uuid,
} from '../../lib/api/types';

/**
 * Admin izveštaj isplata (redizajn §22–24).
 *
 * Podaci dolaze iz `api.rpc_admin_payout_report` (0059) — samo odobreni
 * snapshot-i, po datumu rada. Ovaj modul:
 *   1. ogleda serversko mapiranje kategorija (za mock i testove),
 *   2. gradi pravi .xlsx workbook (ExcelJS) sa tri obavezna sheet-a
 *      + sheet sa napomenama o osnovi izveštaja.
 * Ništa se ovde ne preračunava iz stope; Excel samo prikazuje serverske brojeve.
 */

export const REPORT_CATEGORIES: PayoutReportCategory[] = [
  { key: 'KARNET', label: 'Karnet', unit: 'DAY' },
  { key: 'OBUKA', label: 'Obuka', unit: 'DAY' },
  { key: 'DNEVNICA', label: 'Dnevnica (stari osnovni tip)', unit: 'DAY' },
  { key: 'DODATNA_DNEVNICA', label: 'Dnevnice', unit: 'DAY' },
  { key: 'ISPOMOC', label: 'Ispomoć', unit: 'DAY' },
  { key: 'RADNA_SUBOTA', label: 'Radna subota', unit: 'DAY' },
  { key: 'PREKOVREMENI', label: 'Prekovremeni', unit: 'HOUR' },
  { key: 'NOCNI_RAD', label: 'Noćni rad', unit: 'DAY' },
  { key: 'STOPOVI', label: 'Stopovi', unit: 'STOP' },
  { key: 'OSNOVNO_OSTALO', label: 'Osnovno — ostalo', unit: 'DAY' },
  { key: 'OSTALO', label: 'Ostalo', unit: 'UNIT' },
  { key: 'PREVOZ', label: 'Prevoz', unit: 'DAY' },
  { key: 'GO', label: 'GO (bez rada)', unit: 'DAY', headcount_only: true },
  { key: 'BO', label: 'BO (bez rada)', unit: 'DAY', headcount_only: true },
];

const UNIT_LABEL: Record<string, string> = {
  DAY: 'dana',
  HOUR: 'sati',
  EVENT: 'kom',
  STOP: 'stopova',
  UNIT: 'jed.',
};

/** Ogledalo `app.payout_report_category` (0059). */
export function reportCategoryFor(
  lineKind: string,
  paymentCode: string | null,
  behaviorKey?: string | null,
): string {
  if (lineKind === 'TRANSPORT') return 'PREVOZ';
  if (behaviorKey === 'PRIMARY_DAILY' || (!behaviorKey && lineKind === 'PRIMARY')) {
    return paymentCode && ['KARNET', 'OBUKA', 'DNEVNICA'].includes(paymentCode)
      ? paymentCode
      : 'OSNOVNO_OSTALO';
  }
  switch (behaviorKey) {
    case 'ASSISTANCE': return 'ISPOMOC';
    case 'SATURDAY_WORK': return 'RADNA_SUBOTA';
    case 'OVERTIME_HOURS': return 'PREKOVREMENI';
    case 'ADDITIONAL_ALLOWANCE': return 'DODATNA_DNEVNICA';
    case 'NIGHT_WORK': return 'NOCNI_RAD';
    default: break;
  }
  if (paymentCode === 'NOCNI_RAD') return 'NOCNI_RAD';
  if (paymentCode && ['ISPOMOC', 'RADNA_SUBOTA', 'PREKOVREMENI', 'DODATNA_DNEVNICA'].includes(paymentCode)) {
    return paymentCode;
  }
  return 'OSTALO';
}

// ---------------------------------------------------------------------------
// Gradnja izveštaja iz linija (koristi mock; ista pravila kao SQL)
// ---------------------------------------------------------------------------

export interface ReportSourceLine {
  employee_id: Uuid;
  employee_name: string;
  employee_code: string | null;
  center_id: Uuid;
  center_code: string;
  work_date: IsoDate;
  category: string;
  units: number;
  amount: number;
  is_adjustment: boolean;
  counts_headcount: boolean;
}

export function buildPayoutReport(args: {
  from: IsoDate;
  to: IsoDate;
  centerIds?: Uuid[] | null;
  lines: ReportSourceLine[];
}): AdminPayoutReport {
  const centers = args.centerIds && args.centerIds.length > 0 ? new Set(args.centerIds) : null;
  const src = args.lines.filter(
    (l) => l.work_date >= args.from && l.work_date <= args.to && (!centers || centers.has(l.center_id)),
  );

  const empMap = new Map<string, PayoutReportEmployeeRow>();
  for (const l of src) {
    const k = `${l.employee_id}|${l.center_id}`;
    const row =
      empMap.get(k) ??
      {
        employee_id: l.employee_id,
        employee_code: l.employee_code,
        employee_name: l.employee_name,
        center_id: l.center_id,
        center_code: l.center_code,
        categories: {},
        adjustment_amount: 0,
        transport_amount: 0,
        payout_total: 0,
      };
    const cell = row.categories[l.category] ?? { units: 0, amount: 0 };
    cell.units = r2(cell.units + l.units);
    cell.amount = r2(cell.amount + l.amount);
    row.categories[l.category] = cell;
    if (l.is_adjustment) row.adjustment_amount = r2(row.adjustment_amount + l.amount);
    if (l.category === 'PREVOZ') row.transport_amount = r2(row.transport_amount + l.amount);
    else row.payout_total = r2(row.payout_total + l.amount);
    empMap.set(k, row);
  }

  const hc = src.filter((l) => l.counts_headcount && l.category !== 'PREVOZ');
  const dayMap = new Map<string, { work_date: IsoDate; center_id: Uuid; center_code: string; sets: Map<string, Set<string>> }>();
  const empDay = new Map<string, { work_date: IsoDate; employee: ReportSourceLine; cats: Set<string>; centers: Set<string> }>();
  for (const l of hc) {
    const dk = `${l.work_date}|${l.center_id}`;
    const d = dayMap.get(dk) ?? { work_date: l.work_date, center_id: l.center_id, center_code: l.center_code, sets: new Map() };
    const set = d.sets.get(l.category) ?? new Set<string>();
    set.add(l.employee_id);
    d.sets.set(l.category, set);
    dayMap.set(dk, d);

    const ek = `${l.employee_id}|${l.work_date}`;
    const e = empDay.get(ek) ?? { work_date: l.work_date, employee: l, cats: new Set(), centers: new Set() };
    e.cats.add(l.category);
    e.centers.add(l.center_code);
    empDay.set(ek, e);
  }

  const multi = [...empDay.values()]
    .filter((e) => e.cats.size > 1)
    .map((e) => ({
      work_date: e.work_date,
      employee_id: e.employee.employee_id,
      employee_code: e.employee.employee_code,
      employee_name: e.employee.employee_name,
      center_codes: [...e.centers].sort(),
      categories: [...e.cats].sort(),
    }))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.employee_name.localeCompare(b.employee_name, 'sr'));

  const byDay = [...dayMap.values()]
    .map((d) => ({
      work_date: d.work_date,
      center_id: d.center_id,
      center_code: d.center_code,
      counts: Object.fromEntries([...d.sets].map(([k, s]) => [k, s.size])),
      multi_category_employees: new Set(
        multi.filter((m) => m.work_date === d.work_date && m.center_codes.includes(d.center_code))
          .map((m) => m.employee_id),
      ).size,
    }))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.center_code.localeCompare(b.center_code));

  const byEmployee = [...empMap.values()].sort(
    (a, b) => a.employee_name.localeCompare(b.employee_name, 'sr') || a.center_code.localeCompare(b.center_code),
  );

  return {
    basis: 'APPROVED_SNAPSHOTS_BY_WORK_DATE',
    period: { from: args.from, to: args.to },
    center_ids: centers ? [...centers] : null,
    categories: REPORT_CATEGORIES,
    by_employee: byEmployee,
    by_day: byDay,
    multi_category: multi,
    totals: {
      employees: new Set(byEmployee.map((r) => r.employee_id)).size,
      payout_total: r2(byEmployee.reduce((s, r) => s + r.payout_total, 0)),
      transport_amount: r2(byEmployee.reduce((s, r) => s + r.transport_amount, 0)),
      adjustment_amount: r2(byEmployee.reduce((s, r) => s + r.adjustment_amount, 0)),
    },
    notes: [
      'Samo odobreni obračuni (snapshot), po datumu rada.',
      'Iznosi uključuju odobrene korekcije; broj ljudi ih ne uključuje.',
      'Prevoz je prikazan odvojeno i nije deo ukupnih naknada zaposlenom.',
      'Karnet/Obuka/Dnevnica se u broju ljudi broje samo za dane stvarnog rada.',
      'GO/BO su posebne kolone broja ljudi (plaćeni dani bez rada).',
    ],
  };
}

/** Kategorije koje imaju bar jednu vrednost — u Excel ulaze sve standardne. */
export function categoryLabel(report: AdminPayoutReport, key: string): string {
  return report.categories.find((c) => c.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// XLSX (ExcelJS)
// ---------------------------------------------------------------------------

/** Minimalni podskup ExcelJS API-ja koji koristimo — lakše testiranje i tipovi. */
type ExcelJsModule = typeof import('exceljs');
type Workbook = InstanceType<ExcelJsModule['Workbook']>;
type Worksheet = ReturnType<Workbook['addWorksheet']>;

const MONEY = '#,##0.00';
const QTY = '#,##0.##';
const DATE = 'dd.mm.yyyy.'; // jedinstven UI format: 05.10.2026.

function toDate(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function styleHeader(ws: Worksheet, columns: number) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 32;
  for (let c = 1; c <= columns; c += 1) {
    header.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns } };
}

export function buildPayoutWorkbook(ExcelJS: ExcelJsModule, report: AdminPayoutReport): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WDR';
  wb.created = new Date();

  const cats = report.categories.filter((c) => c.key !== 'PREVOZ' && !c.headcount_only);
  const dayCats = report.categories.filter((c) => c.key !== 'PREVOZ');

  // ---- Sheet 1: Po zaposlenom ----------------------------------------------
  const s1 = wb.addWorksheet('Po zaposlenom');
  const s1Cols: Array<{ header: string; key: string; width: number; fmt?: string }> = [
    { header: 'Šifra', key: 'code', width: 12 },
    { header: 'Ime i prezime', key: 'name', width: 28 },
    { header: 'Centar', key: 'center', width: 9 },
  ];
  for (const c of cats) {
    const unit = UNIT_LABEL[c.unit] ?? '';
    if (c.key !== 'KARNET' && c.key !== 'OBUKA') {
      s1Cols.push({ header: `${c.label} (${unit})`, key: `${c.key}_u`, width: 12, fmt: QTY });
    }
    s1Cols.push({ header: `${c.label} iznos`, key: `${c.key}_a`, width: 14, fmt: MONEY });
  }
  s1Cols.push(
    { header: 'Od toga korekcije', key: 'adj', width: 14, fmt: MONEY },
    { header: 'Ukupno naknade', key: 'total', width: 16, fmt: MONEY },
    { header: 'Prevoz (odvojeno)', key: 'transport', width: 14, fmt: MONEY },
  );
  s1.columns = s1Cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  // Više centara: redovi grupisani po centru (kolona Centar u svakom redu).
  for (const r of sortByCenter(report.by_employee, (x) => x.center_code, (x, y) => x.employee_name.localeCompare(y.employee_name, 'sr'))) {
    const row: Record<string, string | number | null> = {
      code: r.employee_code ?? '',
      name: r.employee_name,
      center: r.center_code,
      adj: r.adjustment_amount,
      total: r.payout_total,
      transport: r.transport_amount,
    };
    for (const c of cats) {
      const cell = r.categories[c.key];
      row[`${c.key}_u`] = cell ? cell.units : 0;
      row[`${c.key}_a`] = cell ? cell.amount : 0;
    }
    s1.addRow(row);
  }
  s1Cols.forEach((c, i) => {
    if (c.fmt) s1.getColumn(i + 1).numFmt = c.fmt;
  });
  const t1 = s1.addRow({
    name: 'UKUPNO',
    adj: report.totals.adjustment_amount,
    total: report.totals.payout_total,
    transport: report.totals.transport_amount,
  });
  t1.font = { bold: true };
  styleHeader(s1, s1Cols.length);

  // ---- Sheet 2: Po danu i centru -------------------------------------------
  const s2 = wb.addWorksheet('Po danu i centru');
  const s2Cols = [
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Centar', key: 'center', width: 9 },
    ...dayCats.map((c) => ({ header: c.label, key: c.key, width: 12 })),
    { header: 'U više kategorija', key: 'multi', width: 14 },
  ];
  s2.columns = s2Cols;
  for (const d of sortByCenter(report.by_day, (x) => x.center_code, (x, y) => x.work_date.localeCompare(y.work_date))) {
    const row: Record<string, string | number | Date> = {
      date: toDate(d.work_date),
      center: d.center_code,
      multi: d.multi_category_employees,
    };
    for (const c of dayCats) row[c.key] = d.counts[c.key] ?? 0;
    s2.addRow(row);
  }
  s2.getColumn(1).numFmt = DATE;
  styleHeader(s2, s2Cols.length);

  // ---- Sheet 3: Višestruke kategorije --------------------------------------
  const s3 = wb.addWorksheet('Višestruke kategorije');
  const s3Cols = [
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Šifra', key: 'code', width: 12 },
    { header: 'Ime i prezime', key: 'name', width: 28 },
    { header: 'Centar/centri', key: 'centers', width: 14 },
    { header: 'Kategorije', key: 'cats', width: 40 },
    { header: 'Broj kategorija', key: 'n', width: 10 },
  ];
  s3.columns = s3Cols;
  for (const m of report.multi_category) {
    s3.addRow({
      date: toDate(m.work_date),
      code: m.employee_code ?? '',
      name: m.employee_name,
      centers: m.center_codes.join(', '),
      cats: m.categories.map((k) => categoryLabel(report, k)).join(' + '),
      n: m.categories.length,
    });
  }
  s3.getColumn(1).numFmt = DATE;
  styleHeader(s3, s3Cols.length);

  // ---- Sheet 4: Napomene ----------------------------------------------------
  const s4 = wb.addWorksheet('Napomene');
  s4.columns = [{ header: 'Osnova izveštaja', key: 'n', width: 100 }];
  s4.addRow({ n: `Period: ${formatPeriod(report.period.from, report.period.to)}` });
  s4.addRow({ n: `Zaposlenih: ${report.totals.employees}` });
  for (const n of report.notes) s4.addRow({ n });
  s4.addRow({ n: 'Višestruka kategorija istog dana NIJE automatski greška — proveriti da li je kombinacija očekivana.' });
  s4.getRow(1).font = { bold: true };

  return wb;
}

export function reportFileName(report: AdminPayoutReport): string {
  return `WDR_isplate_${report.period.from}_${report.period.to}.xlsx`;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
