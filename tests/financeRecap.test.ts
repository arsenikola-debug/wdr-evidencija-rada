import { describe, expect, it } from 'vitest';
import {
  RECAP_LABELS,
  approvalState,
  blockerMessages,
  monthAllocation,
  needsAttention,
  pricingProblemText,
  rateTimesUnits,
  recapAddsUp,
  recapRows,
  totalForDisplay,
  transportByProvider,
  waitingLabel,
} from '../src/features/finance/recap';
import type {
  CalcLine,
  FinanceRecap,
  FinanceSubmissionDetail,
  TransportGroup,
} from '../src/lib/api/types';

function recap(over: Partial<FinanceRecap> = {}): FinanceRecap {
  return {
    naknade_zaposlenima: 8000,
    prekovremeni: 800,
    radna_subota: 0,
    ispomoc: 0,
    dodatne_stavke: 0,
    prevoz: 500,
    resolved_subtotal: 9300,
    ukupno_za_odobrenje: 9300,
    is_complete: true,
    blocking_line_count: 0,
    line_count: 5,
    employee_count: 2,
    worked_employee_days: 2,
    ...over,
  };
}

describe('recap', () => {
  it('keeps the six Finance groups in a fixed order', () => {
    expect(RECAP_LABELS.map((r) => r.key)).toEqual([
      'naknade_zaposlenima',
      'prekovremeni',
      'radna_subota',
      'ispomoc',
      'dodatne_stavke',
      'prevoz',
    ]);
  });

  it('keeps a group with 0.00 instead of hiding it', () => {
    const rows = recapRows(recap());
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.key === 'radna_subota')?.amount).toBe(0);
  });

  it('shows a total only when the calculation is complete', () => {
    expect(totalForDisplay(recap())).toEqual({ kind: 'complete', amount: 9300 });
  });

  it('never presents a partial sum as the amount to approve', () => {
    const t = totalForDisplay(
      recap({ is_complete: false, ukupno_za_odobrenje: null, blocking_line_count: 2 }),
    );
    expect(t.kind).toBe('partial');
    expect(t).not.toHaveProperty('amount');
    if (t.kind === 'partial') {
      expect(t.resolvedSubtotal).toBe(9300);
      expect(t.blockingLines).toBe(2);
    }
  });

  it('verifies the groups add up to the server total', () => {
    expect(recapAddsUp(recap())).toBe(true);
    expect(recapAddsUp(recap({ prevoz: 501 }))).toBe(false);
  });
});

describe('waitingLabel', () => {
  it('handles a submission that has not been submitted', () => {
    expect(waitingLabel(null)).toBe('—');
  });

  it('rounds down inside the first day', () => {
    expect(waitingLabel(0.4)).toBe('manje od 1 h');
    expect(waitingLabel(5.9)).toBe('5 h');
  });

  it('switches to days and keeps the remainder', () => {
    expect(waitingLabel(24)).toBe('1 dan');
    expect(waitingLabel(51.5)).toBe('2 dana 3 h');
  });
});

describe('queue triage', () => {
  it('flags an incomplete calculation even without errors', () => {
    expect(
      needsAttention({
        hard_error_count: 0,
        unacknowledged_warning_count: 0,
        recap: recap({ is_complete: false, ukupno_za_odobrenje: null }),
      }),
    ).toBe(true);
  });

  it('leaves a clean, priceable submission alone', () => {
    expect(
      needsAttention({
        hard_error_count: 0,
        unacknowledged_warning_count: 0,
        recap: recap(),
      }),
    ).toBe(false);
  });
});

describe('approval', () => {
  it('follows the server decision, not a client calculation', () => {
    const detail = {
      can_approve: false,
      approval_blockers: ['INCOMPLETE_CALCULATION', 'NO_PERMISSION'],
      recap: recap(),
    } as unknown as FinanceSubmissionDetail;

    const state = approvalState(detail);
    expect(state.canApprove).toBe(false);
    expect(state.reasons).toHaveLength(2);
    expect(state.reasons[0]).toContain('Obračun nije kompletan');
  });

  it('translates every known blocker', () => {
    expect(
      blockerMessages(['WRONG_STATUS', 'HARD_ERRORS', 'UNACKNOWLEDGED_WARNINGS']),
    ).toEqual([
      expect.stringContaining('Poslato finansijama'),
      expect.stringContaining('blokirajuće greške'),
      expect.stringContaining('nepotvrđena upozorenja'),
    ]);
  });

  it('passes an unknown blocker through instead of swallowing it', () => {
    expect(blockerMessages(['SOMETHING_NEW' as never])).toEqual(['SOMETHING_NEW']);
  });
});

describe('line display', () => {
  it('shows rate × units for a priced line', () => {
    expect(rateTimesUnits({ rate: 400, units: 2 })).toBe('400 × 2');
  });

  it('shows a dash rather than 0 when there is no rate', () => {
    expect(rateTimesUnits({ rate: null, units: 1 })).toBe('—');
  });

  it('explains why a resolved rule is still not payable', () => {
    expect(pricingProblemText('COMP_RULE_MULTIPLIER_UNSUPPORTED')).toContain('množilac');
    expect(pricingProblemText('TRANSPORT_RULE_TYPE_UNSUPPORTED')).toContain('fiksni model');
    expect(pricingProblemText(null)).toBe('');
  });
});

describe('transportByProvider', () => {
  const group = (over: Partial<TransportGroup>): TransportGroup => ({
    transport_provider_code: 'GAMZED',
    responsible_person_code: 'GAMZED_RESP',
    center_code: 'B6',
    rate: 500,
    liters_per_unit: null,
    eligible_employee_days: 2,
    units: 2,
    amount: 1000,
    blocking_line_count: 0,
    status: 'RESOLVED',
    ...over,
  });

  it('groups rows per provider and sums the provider subtotal', () => {
    const out = transportByProvider([
      group({}),
      group({ center_code: 'BZ', amount: 500, units: 1, eligible_employee_days: 1 }),
      group({ transport_provider_code: 'KNEZEVIC', responsible_person_code: 'KNEZ_RESP', amount: 300 }),
    ]);
    expect(out).toHaveLength(2);
    const gamzed = out.find((o) => o.provider === 'GAMZED')!;
    expect(gamzed.rows).toHaveLength(2);
    expect(gamzed.amount).toBe(1500);
    expect(gamzed.responsible).toBe('GAMZED_RESP');
  });

  it('makes the provider subtotal undefined when one group cannot be priced', () => {
    const out = transportByProvider([group({}), group({ amount: null, status: 'RULE_NOT_PRICEABLE' })]);
    expect(out[0].amount).toBeNull();
  });
});

describe('monthAllocation', () => {
  const line = (date: string, amount: number | null): CalcLine =>
    ({ work_date: date, amount } as unknown as CalcLine);

  it('splits one submission across the months its work dates fall in', () => {
    expect(
      monthAllocation([
        line('2026-07-31', 3900),
        line('2026-08-01', 3900),
        line('2026-08-03', 500),
      ]),
    ).toEqual([
      { month: '2026-07', amount: 3900 },
      { month: '2026-08', amount: 4400 },
    ]);
  });

  it('ignores lines that could not be priced', () => {
    expect(monthAllocation([line('2026-07-31', null)])).toEqual([]);
  });
});
