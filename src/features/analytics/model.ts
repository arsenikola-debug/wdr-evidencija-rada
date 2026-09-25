import type {
  BaCenterRow,
  BaDailyRow,
  BaKpi,
  BaOverview,
  BaPaymentRow,
  BaTransportRow,
} from '../../lib/api/types';

/**
 * Presentation logic for BA analytics.
 *
 * Nothing here aggregates money — PostgreSQL does that over immutable snapshots.
 * These helpers only label, format and lay out numbers that already exist, and
 * they are deliberately strict about two things: a NULL comparison is not 0%,
 * and economic cost (work_date) is never shown as if it were approval flow
 * (approved_at).
 */

export interface KpiCard {
  key: string;
  label: string;
  value: number | null;
  /** 'money' | 'count' | 'hours' — decides formatting, not meaning. */
  unit: 'money' | 'count' | 'hours';
  kpi: BaKpi | null;
}

export const KPI_CARDS: Array<{ key: keyof BaOverview['kpi']; label: string;
  unit: KpiCard['unit'] }> = [
  { key: 'total_calculated_amount', label: 'Ukupan trošak', unit: 'money' },
  { key: 'employee_calculated_amount', label: 'Naknade zaposlenima', unit: 'money' },
  { key: 'transport_calculated_amount', label: 'Prevoz', unit: 'money' },
  { key: 'adjustment_calculated_amount', label: 'Korekcije', unit: 'money' },
  { key: 'worked_employee_days', label: 'Radni dani zaposlenih', unit: 'count' },
  { key: 'overtime_hours', label: 'Prekovremeni sati', unit: 'hours' },
  { key: 'distinct_employees', label: 'Broj zaposlenih u obračunu', unit: 'count' },
  { key: 'cost_per_worked_employee_day', label: 'Trošak po radnom danu', unit: 'money' },
];

export function kpiCards(overview: BaOverview | null): KpiCard[] {
  return KPI_CARDS.map((c) => ({
    key: c.key,
    label: c.label,
    unit: c.unit,
    value: overview ? overview.kpi[c.key]?.current ?? null : null,
    kpi: overview ? overview.kpi[c.key] ?? null : null,
  }));
}

/**
 * How a comparison should read.
 *
 * `unavailable` when the previous period has no data at all — that is different
 * from "no change", and the UI must say so instead of printing 0%.
 */
export function comparisonLabel(kpi: BaKpi | null): {
  kind: 'up' | 'down' | 'flat' | 'unavailable';
  text: string;
} {
  if (!kpi || kpi.previous_period === null) {
    return { kind: 'unavailable', text: 'nema uporednog perioda' };
  }
  if (kpi.percentage_change === null) {
    const abs = kpi.absolute_change ?? 0;
    if (abs === 0) return { kind: 'flat', text: 'bez promene' };
    return {
      kind: abs > 0 ? 'up' : 'down',
      // Prethodni period je nula: procenat ne postoji, apsolutna promena postoji.
      text: `${abs > 0 ? '+' : '−'}${formatNumber(Math.abs(abs))} (prethodno 0)`,
    };
  }
  const pct = kpi.percentage_change;
  if (pct === 0) return { kind: 'flat', text: '0,0% u odnosu na prethodni period' };
  return {
    kind: pct > 0 ? 'up' : 'down',
    text: `${pct > 0 ? '+' : '−'}${formatNumber(Math.abs(pct))}% u odnosu na prethodni period`,
  };
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('sr-Latn-RS', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Bar width in percent, for dependency-free CSS charts. */
export function barWidth(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Math.abs(value) / max) * 100)));
}

export function maxAbs(values: Array<number | null | undefined>): number {
  return values.reduce<number>((m, v) => Math.max(m, Math.abs(v ?? 0)), 0);
}

/** Does the center breakdown reconcile with the overall total? */
export function centersReconcile(rows: BaCenterRow[], total: number): boolean {
  const sum = rows.reduce((s, r) => s + r.total_calculated_amount, 0);
  return Math.abs(sum - total) < 0.005;
}

export function paymentsReconcile(rows: BaPaymentRow[], total: number): boolean {
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  return Math.abs(sum - total) < 0.005;
}

/**
 * How to present a transport group's rate.
 *
 * With more than one rate in the group an average would be misleading, so the
 * range is shown instead.
 */
export function rateLabel(row: BaTransportRow): string {
  if (row.distinct_rate_count === 0) return '—';
  if (row.distinct_rate_count === 1) return formatNumber(row.single_rate ?? row.min_rate);
  return `${formatNumber(row.min_rate)} – ${formatNumber(row.max_rate)} `
    + `(${row.distinct_rate_count} stope)`;
}

/** Default range: current month to date. */
export function defaultRange(today = new Date()): { from: string; to: string } {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: iso(first), to: iso(today) };
}

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    + `-${String(d.getDate()).padStart(2, '0')}`;
}

export function rangeIsValid(from: string, to: string): boolean {
  return from !== '' && to !== '' && from <= to;
}

/** Days with no approved cost are still points on the trend line. */
export function fillDailyGaps(rows: BaDailyRow[], from: string, to: string): BaDailyRow[] {
  const byDate = new Map(rows.map((r) => [r.work_date, r]));
  const out: BaDailyRow[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end && out.length < 400) {
    const key = iso(cursor);
    out.push(byDate.get(key) ?? {
      work_date: key,
      center_code: null,
      distinct_employees: 0,
      worked_employee_days: 0,
      go_days: 0,
      bo_days: 0,
      overtime_hours: 0,
      employee_calculated_amount: 0,
      transport_calculated_amount: 0,
      adjustment_calculated_amount: 0,
      total_calculated_amount: 0,
      cost_per_worked_employee_day: null,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
