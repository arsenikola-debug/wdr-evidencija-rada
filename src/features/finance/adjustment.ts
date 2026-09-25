import type {
  Adjustment,
  AdjustmentDirection,
  AdjustmentInput,
  AdjustmentStatus,
  FinanceHistoryItem,
} from '../../lib/api/types';

/**
 * Presentation logic for Dodatni zahtevi (Doplata / Umanjenje).
 *
 * No money is computed here. The engine resolves the rule in force on the WORK
 * date and returns the amount; this module only labels, groups and validates the
 * form fields the operator actually types — which never include an amount.
 */

export const DIRECTION_LABEL: Record<AdjustmentDirection, string> = {
  DEBIT: 'Doplata',
  CREDIT: 'Umanjenje / Povraćaj',
};

export const STATUS_LABEL: Record<AdjustmentStatus, string> = {
  DRAFT: 'Radna verzija',
  SUBMITTED: 'Poslato finansijama',
  RETURNED: 'Vraćeno na ispravku',
  APPROVED: 'Odobreno',
  REJECTED: 'Odbijeno',
};

/** `+800` for a Doplata, `−500` for an Umanjenje, `—` when there is no amount. */
export function signedAmountLabel(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat('sr-Latn-RS', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(abs);
  if (amount === 0) return formatted;
  return `${amount < 0 ? '−' : '+'}${formatted}`;
}

export interface AdjustmentFormValues {
  employee_id: string;
  related_work_date: string;
  center_id: string;
  payment_type_id: string;
  units: string;
  direction: AdjustmentDirection;
  reason: string;
}

/**
 * Client-side pre-check so the operator is not sent to the server to be told the
 * obvious. The database re-validates everything; this only saves a round trip.
 * Deliberately does NOT validate any amount: there is no amount field.
 */
export function adjustmentFormErrors(v: AdjustmentFormValues): string[] {
  const out: string[] = [];
  if (!v.employee_id) out.push('Izaberite zaposlenog.');
  if (!v.related_work_date) out.push('Unesite datum na koji se zahtev odnosi.');
  if (!v.center_id) out.push('Izaberite centar.');
  if (!v.payment_type_id) out.push('Izaberite vrstu isplate.');

  const units = Number(v.units);
  if (!v.units || Number.isNaN(units)) {
    out.push('Unesite količinu.');
  } else if (units <= 0) {
    out.push('Količina mora biti veća od nule.');
  }

  if (v.reason.trim().length < 10) {
    out.push('Obrazloženje mora imati najmanje 10 znakova.');
  }
  return out;
}

export function toAdjustmentInput(
  v: AdjustmentFormValues,
  id?: string | null,
  originalSubmissionId?: string | null,
): AdjustmentInput {
  return {
    id: id ?? null,
    employee_id: v.employee_id,
    related_work_date: v.related_work_date,
    center_id: v.center_id,
    payment_type_id: v.payment_type_id,
    units: Number(v.units),
    direction: v.direction,
    reason: v.reason.trim(),
    original_submission_id: originalSubmissionId ?? null,
  };
}

/** The server decides; this restates its answer and explains a refusal. */
export function submitState(a: Adjustment): { canSubmit: boolean; reasons: string[] } {
  return {
    canSubmit: a.can_submit,
    reasons: a.errors.map((e) => e.message),
  };
}

/** Net effect on cost: Doplata minus Umanjenje. */
export function netEffect(items: Adjustment[]): {
  doplata: number;
  umanjenje: number;
  net: number;
  blocked: number;
} {
  let doplata = 0;
  let umanjenje = 0;
  let blocked = 0;
  for (const a of items) {
    if (a.calculation.status !== 'RESOLVED' || a.calculation.amount_abs === null) {
      blocked += 1;
      continue;
    }
    if (a.direction === 'DEBIT') doplata += a.calculation.amount_abs;
    else umanjenje += a.calculation.amount_abs;
  }
  return { doplata, umanjenje, net: doplata - umanjenje, blocked };
}

/**
 * The two dates that must never be confused.
 *
 * `economic` — the month the correction belongs to (the work date), which is
 *              what BA and monthly analysis use.
 * `transaction` — the month Finance approved it, which is what Finance history
 *              uses. They are usually different, and that is intentional.
 */
export function transactionVsEconomicMonth(item: FinanceHistoryItem): {
  economic: string;
  transaction: string;
  differs: boolean;
} {
  const economic = item.economic_period_start.slice(0, 7);
  const transaction = item.approved_at.slice(0, 7);
  return { economic, transaction, differs: economic !== transaction };
}

/** Groups a Finance history list by transaction type for display. */
export function splitHistory(items: FinanceHistoryItem[]): {
  periods: FinanceHistoryItem[];
  adjustments: FinanceHistoryItem[];
} {
  return {
    periods: items.filter((i) => i.transaction_type === 'PERIOD'),
    adjustments: items.filter((i) => i.transaction_type === 'ADJUSTMENT'),
  };
}
