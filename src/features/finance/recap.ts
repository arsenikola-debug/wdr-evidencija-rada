import type {
  ApprovalBlocker,
  CalcLine,
  FinanceRecap,
  FinanceSubmissionDetail,
  TransportGroup,
} from '../../lib/api/types';

/**
 * Presentation logic for the Finance screens.
 *
 * Nothing here computes money. Every amount arrives from the database, which is
 * the only place that resolves a rate. These functions decide how a number that
 * already exists is grouped, labelled and — most importantly — whether it may be
 * shown as a total at all.
 */

export interface RecapRow {
  key: keyof FinanceRecap;
  label: string;
  amount: number;
}

/**
 * The six groups the Finance detail must always separate (Q18), in a fixed
 * order. The order is part of the contract with Finance: the same screen must
 * read the same way every period, so a group with 0.00 is kept, not hidden.
 */
export const RECAP_LABELS: Array<{ key: keyof FinanceRecap; label: string }> = [
  { key: 'naknade_zaposlenima', label: 'Naknade zaposlenima' },
  { key: 'prekovremeni', label: 'Prekovremeni' },
  { key: 'radna_subota', label: 'Radna subota' },
  { key: 'ispomoc', label: 'Ispomoć' },
  { key: 'dodatne_stavke', label: 'Dodatne stavke' },
  { key: 'prevoz', label: 'Prevoz' },
];

export function recapRows(recap: FinanceRecap): RecapRow[] {
  return RECAP_LABELS.map((r) => ({
    key: r.key,
    label: r.label,
    amount: Number(recap[r.key] ?? 0),
  }));
}

/**
 * What the big number at the bottom of the screen is allowed to say.
 *
 * `partial` exists because a sum of the lines that happened to be priceable is
 * NOT the amount to approve. The UI must render it as an incomplete calculation,
 * never as "UKUPNO ZA ODOBRENJE".
 */
export type TotalDisplay =
  | { kind: 'complete'; amount: number }
  | { kind: 'partial'; resolvedSubtotal: number; blockingLines: number };

export function totalForDisplay(recap: FinanceRecap): TotalDisplay {
  if (recap.is_complete && recap.ukupno_za_odobrenje !== null) {
    return { kind: 'complete', amount: Number(recap.ukupno_za_odobrenje) };
  }
  return {
    kind: 'partial',
    resolvedSubtotal: Number(recap.resolved_subtotal ?? 0),
    blockingLines: recap.blocking_line_count,
  };
}

/** Sanity check the client can run on the server's own numbers. */
export function recapAddsUp(recap: FinanceRecap): boolean {
  const sum = recapRows(recap).reduce((s, r) => s + r.amount, 0);
  const total = recap.is_complete
    ? Number(recap.ukupno_za_odobrenje ?? 0)
    : Number(recap.resolved_subtotal ?? 0);
  // Rounding happens per line in the database, so the comparison is exact to
  // two decimals rather than approximate.
  return Math.abs(sum - total) < 0.005;
}

/** How long the period has been waiting for Finance. */
export function waitingLabel(hours: number | null): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return 'manje od 1 h';
  if (hours < 24) return `${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.floor(hours - days * 24);
  const dayWord = days === 1 ? 'dan' : 'dana';
  return rest === 0 ? `${days} ${dayWord}` : `${days} ${dayWord} ${rest} h`;
}

/** Queue rows that need attention before anything can be approved. */
export function needsAttention(item: {
  hard_error_count: number;
  unacknowledged_warning_count: number;
  recap: FinanceRecap;
}): boolean {
  return (
    item.hard_error_count > 0 ||
    item.unacknowledged_warning_count > 0 ||
    !item.recap.is_complete
  );
}

const BLOCKER_TEXT: Record<ApprovalBlocker, string> = {
  WRONG_STATUS: 'Prijava nije u statusu „Poslato finansijama".',
  HARD_ERRORS: 'Prijava ima blokirajuće greške — mora se vratiti na ispravku.',
  UNACKNOWLEDGED_WARNINGS: 'Postoje nepotvrđena upozorenja iz unosa.',
  INCOMPLETE_CALCULATION:
    'Obračun nije kompletan: nedostaje upotrebljivo pravilo, pa nema iznosa za odobrenje.',
  NO_PERMISSION: 'Nemate permisiju finance.approve.',
};

export function blockerMessages(blockers: ApprovalBlocker[]): string[] {
  return blockers.map((b) => BLOCKER_TEXT[b] ?? b);
}

/**
 * The approve button follows the SERVER. This helper never re-derives the
 * decision from amounts or statuses; it only restates the server's answer and
 * explains it.
 */
export function approvalState(detail: FinanceSubmissionDetail): {
  canApprove: boolean;
  reasons: string[];
} {
  return {
    canApprove: detail.can_approve,
    reasons: blockerMessages(detail.approval_blockers),
  };
}

/** `stopa × jedinice` as Finance reads it, or a dash when there is no rate. */
export function rateTimesUnits(line: Pick<CalcLine, 'rate' | 'units'>): string {
  if (line.rate === null || line.rate === undefined) return '—';
  return `${line.rate} × ${line.units}`;
}

/** Transport grouped by provider, each provider keeping its own rate rows. */
export function transportByProvider(
  groups: TransportGroup[],
): Array<{ provider: string; responsible: string | null; rows: TransportGroup[]; amount: number | null }> {
  const out = new Map<string, { provider: string; responsible: string | null; rows: TransportGroup[]; amount: number | null }>();
  for (const g of groups) {
    const provider = g.transport_provider_code ?? 'NEPOZNAT';
    const bucket = out.get(provider) ?? {
      provider,
      responsible: g.responsible_person_code,
      rows: [],
      amount: 0 as number | null,
    };
    bucket.rows.push(g);
    // One unpriceable group makes the provider subtotal undefined, exactly like
    // the grand total.
    bucket.amount = bucket.amount === null || g.amount === null
      ? null
      : bucket.amount + Number(g.amount);
    out.set(provider, bucket);
  }
  return Array.from(out.values());
}

/**
 * Allocation of a submission's lines to calendar months.
 *
 * A period may cross a month (31.07–06.08) and is deliberately NOT split into
 * two submissions or two snapshots, so the screen shows where the cost lands.
 * Keys are `YYYY-MM` of the line's own work_date.
 */
export function monthAllocation(lines: CalcLine[]): Array<{ month: string; amount: number }> {
  const acc = new Map<string, number>();
  for (const l of lines) {
    if (l.amount === null || l.amount === undefined) continue;
    const month = l.work_date.slice(0, 7);
    acc.set(month, (acc.get(month) ?? 0) + Number(l.amount));
  }
  return Array.from(acc.entries())
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Serbian wording for the reason a resolved rule still cannot be priced. */
const PRICING_PROBLEM_TEXT: Record<string, string> = {
  RULE_MISSING: 'pravilo nije konfigurisano',
  COMP_RULE_MULTIPLIER_UNSUPPORTED:
    'pravilo ima množilac čije značenje nije potvrđeno sa finansijama',
  COMP_RULE_UNIT_TYPE_UNSUPPORTED: 'jedinica pravila („OSTALO") nema definisan obračun',
  COMP_RULE_FIXED_WITH_UNITS:
    'fiksni iznos uz količinu različitu od 1 — raspodela nije definisana',
  TRANSPORT_RULE_TYPE_UNSUPPORTED:
    'fiksni model prevoza nije raspoređen po employee-danima (čeka odluku finansija)',
  LINE_KIND_UNSUPPORTED: 'nepoznata vrsta stavke',
};

export function pricingProblemText(problem: string | null): string {
  if (!problem) return '';
  return PRICING_PROBLEM_TEXT[problem] ?? problem;
}
