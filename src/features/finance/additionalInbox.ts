import type { FinanceHistoryItem, PayoutListItem } from '../../lib/api/types';

/**
 * Finansije — objedinjeni prikaz „Dodatne isplate" (dodatne isplate + Stopovi).
 *
 * Samo PREZENTACIJA: pozadinski tokovi ostaju odvojeni (payout_requests sa
 * rpc_payout_finance_* i courier_stop_submissions sa rpc_courier_stop_finance_*).
 * Svaki red nosi svoju VRSTU i vodi na postojeći detalj te vrste. Iznosi stižu iz
 * baze; ovde se ništa ne računa.
 */
export type InboxStatus = 'SUBMITTED' | 'RETURNED' | 'FINANCE_APPROVED';

export const INBOX_TABS: Array<{ key: InboxStatus; label: string }> = [
  { key: 'SUBMITTED', label: 'Čeka odobrenje' },
  { key: 'RETURNED', label: 'Vraćeno' },
  { key: 'FINANCE_APPROVED', label: 'Odobreno' },
];

export interface InboxRow {
  key: string;
  source: 'PAYOUT' | 'STOPS';
  kind: string;
  isCorrection: boolean;
  centerCode: string;
  periodStart: string;
  periodEnd: string;
  /** null = podatak nije deo reda za odobrenje (Stopovi broje stopove, ne zaposlene). */
  employees: number | null;
  totalStops: number | null;
  /** null = obračun nepotpun (bar jedna stavka bez upotrebljivog pravila). */
  amount: number | null;
  status: InboxStatus;
  submittedAt: string | null;
  /** Postojeći detail workflow za konkretnu vrstu. */
  href: string;
}

/** Red iz api.rpc_courier_stop_finance_queue. */
export interface StopsQueueItem {
  submission_id: string;
  center_code: string;
  period_start: string;
  period_end: string;
  status: 'SUBMITTED' | 'RETURNED';
  submitted_at: string | null;
  total_stops: number;
  total_calculated_amount: number | null;
  blocking_line_count: number;
}

export function rowsFromPayouts(items: PayoutListItem[]): InboxRow[] {
  return items
    .filter((i) => i.status === 'SUBMITTED' || i.status === 'RETURNED' || i.status === 'FINANCE_APPROVED')
    .map((i) => ({
      key: `PAYOUT:${i.id}`,
      source: 'PAYOUT' as const,
      kind: i.request_type_name,
      isCorrection: i.is_correction,
      centerCode: i.center_code,
      periodStart: i.period_start,
      periodEnd: i.period_end,
      employees: i.employees,
      totalStops: null,
      amount: i.total_amount,
      status: i.status as InboxStatus,
      submittedAt: i.submitted_at,
      href: `/finansije/dodatne-isplate/zahtev?zahtev=${i.id}`,
    }));
}

export function rowsFromStopsQueue(items: StopsQueueItem[]): InboxRow[] {
  return items.map((q) => ({
    key: `STOPS:${q.submission_id}`,
    source: 'STOPS' as const,
    kind: 'Stopovi',
    isCorrection: false,
    centerCode: q.center_code,
    periodStart: q.period_start,
    periodEnd: q.period_end,
    employees: null,
    totalStops: q.total_stops,
    amount: q.blocking_line_count > 0 ? null : q.total_calculated_amount,
    status: q.status,
    submittedAt: q.submitted_at,
    href: `/finansije/stopovi-kurira?prijava=${q.submission_id}`,
  }));
}

/** Odobreni Stopovi (nisu u redu za odobrenje) — iz istorije finansija. */
export function rowsFromStopsHistory(items: FinanceHistoryItem[]): InboxRow[] {
  return items
    .filter((h) => h.transaction_type === 'COURIER_STOPS' && h.submission_id)
    .map((h) => ({
      key: `STOPS:${h.submission_id}`,
      source: 'STOPS' as const,
      kind: 'Stopovi',
      isCorrection: false,
      centerCode: h.center_code,
      periodStart: h.economic_period_start,
      periodEnd: h.economic_period_end,
      employees: null,
      totalStops: h.total_stops ?? null,
      amount: h.approved_amount,
      status: 'FINANCE_APPROVED' as const,
      submittedAt: h.approved_at,
      href: `/finansije/stopovi-kurira?prijava=${h.submission_id}`,
    }));
}

/** Jedan spisak za izabrani status; najnovije prvo, bez duplikata. */
export function mergeInbox(rows: InboxRow[], status: InboxStatus): InboxRow[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => r.status === status)
    .filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)))
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '')
      || a.centerCode.localeCompare(b.centerCode) || a.kind.localeCompare(b.kind, 'sr'));
}

/** Broj zahteva koji čekaju odobrenje — SVE vrste (dodatne isplate + Stopovi). */
export function pendingAdditionalCount(payouts: PayoutListItem[], stops: StopsQueueItem[]): number {
  return payouts.filter((p) => p.status === 'SUBMITTED').length
    + stops.filter((s) => s.status === 'SUBMITTED').length;
}
