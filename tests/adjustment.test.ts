import { describe, expect, it } from 'vitest';
import {
  DIRECTION_LABEL,
  STATUS_LABEL,
  adjustmentFormErrors,
  netEffect,
  signedAmountLabel,
  splitHistory,
  submitState,
  toAdjustmentInput,
  transactionVsEconomicMonth,
  type AdjustmentFormValues,
} from '../src/features/finance/adjustment';
import type { Adjustment, FinanceHistoryItem } from '../src/lib/api/types';

function form(over: Partial<AdjustmentFormValues> = {}): AdjustmentFormValues {
  return {
    employee_id: 'e1',
    related_work_date: '2026-07-17',
    center_id: 'c1',
    payment_type_id: 'pt-prekovremeni',
    units: '2',
    direction: 'DEBIT',
    reason: 'Dva sata prekovremenog nisu uneta u nedeljnu evidenciju.',
    ...over,
  };
}

function adjustment(over: Partial<Adjustment> = {}): Adjustment {
  return {
    id: 'adj-1',
    status: 'DRAFT',
    direction: 'DEBIT',
    direction_label: 'Doplata',
    employee_id: 'e1',
    employee_name: 'Marković Marko',
    related_work_date: '2026-07-17',
    center_id: 'c1',
    center_code: 'B6',
    cost_center_code: null,
    payment_type_id: 'pt-prekovremeni',
    payment_type_code: 'PREKOVREMENI',
    units: 2,
    reason: 'Dva sata prekovremenog nisu uneta.',
    original_submission_id: null,
    requested_by: 'Operater B6',
    requested_at: '2026-08-08T09:00:00Z',
    submitted_at: null,
    reviewed_by: null,
    reviewed_at: null,
    finance_comment: null,
    editable: true,
    calculation: {
      attendance_status: 'WORK',
      rate_center_code: 'B6',
      rate_center_basis: 'HOME_CENTER',
      rule_id: 'r1',
      rule_version: 1,
      rate: 400,
      unit_type: 'PER_HOUR',
      units: 2,
      units_signed: 2,
      amount_abs: 800,
      amount_signed: 800,
      sign: 1,
      status: 'RESOLVED',
      pricing_problem: null,
      amount_editable: false,
      note: '',
    },
    errors: [],
    warnings: [],
    can_submit: true,
    can_approve: false,
    can_decide: false,
    approval: null,
    ...over,
  };
}

describe('terminologija', () => {
  it('koristi poslovne pojmove, ne interne kodove', () => {
    expect(DIRECTION_LABEL.DEBIT).toBe('Doplata');
    expect(DIRECTION_LABEL.CREDIT).toBe('Umanjenje / Povraćaj');
    expect(STATUS_LABEL.RETURNED).toBe('Vraćeno na ispravku');
  });
});

describe('signedAmountLabel', () => {
  it('doplata dobija plus, umanjenje minus', () => {
    expect(signedAmountLabel(800)).toBe('+800');
    expect(signedAmountLabel(-500)).toBe('−500');
  });

  it('bez iznosa prikazuje crticu, nikad nulu', () => {
    expect(signedAmountLabel(null)).toBe('—');
    expect(signedAmountLabel(undefined)).toBe('—');
  });

  it('nula je nula, bez znaka', () => {
    expect(signedAmountLabel(0)).toBe('0');
  });
});

describe('adjustmentFormErrors', () => {
  it('prihvata ispravan zahtev', () => {
    expect(adjustmentFormErrors(form())).toEqual([]);
  });

  it('traži obrazloženje od najmanje 10 znakova', () => {
    expect(adjustmentFormErrors(form({ reason: 'kratko' }))).toContain(
      'Obrazloženje mora imati najmanje 10 znakova.',
    );
  });

  it('odbija količinu koja nije pozitivna', () => {
    expect(adjustmentFormErrors(form({ units: '0' }))).toContain(
      'Količina mora biti veća od nule.',
    );
    expect(adjustmentFormErrors(form({ units: '-3' }))).toContain(
      'Količina mora biti veća od nule.',
    );
  });

  it('traži datum na koji se zahtev odnosi', () => {
    expect(adjustmentFormErrors(form({ related_work_date: '' }))).toContain(
      'Unesite datum na koji se zahtev odnosi.',
    );
  });

  it('nema polje za iznos koje bi moglo da se validira', () => {
    const keys = Object.keys(form());
    expect(keys).not.toContain('amount');
    expect(keys).not.toContain('calculated_amount');
  });
});

describe('toAdjustmentInput', () => {
  it('prosleđuje samo poslovne činjenice, bez iznosa', () => {
    const input = toAdjustmentInput(form(), null, 'sub-1');
    expect(input).toMatchObject({
      employee_id: 'e1',
      related_work_date: '2026-07-17',
      units: 2,
      direction: 'DEBIT',
      original_submission_id: 'sub-1',
    });
    expect(Object.keys(input)).not.toContain('amount');
  });
});

describe('submitState', () => {
  it('prati odgovor servera i objašnjava odbijanje', () => {
    const s = submitState(
      adjustment({
        can_submit: false,
        errors: [{ code: 'ADJ_MISSING_RULE', message: 'Nema pravilo naknade za taj datum.' }],
      }),
    );
    expect(s.canSubmit).toBe(false);
    expect(s.reasons[0]).toContain('Nema pravilo');
  });
});

describe('netEffect', () => {
  it('doplata umanjena za umanjenje daje neto efekat', () => {
    const out = netEffect([
      adjustment(),
      adjustment({
        id: 'adj-2',
        direction: 'CREDIT',
        calculation: { ...adjustment().calculation, amount_abs: 500, amount_signed: -500, sign: -1 },
      }),
    ]);
    expect(out).toEqual({ doplata: 800, umanjenje: 500, net: 300, blocked: 0 });
  });

  it('zahtev bez upotrebljivog pravila se broji odvojeno, ne kao nula', () => {
    const out = netEffect([
      adjustment({
        calculation: {
          ...adjustment().calculation,
          status: 'MISSING_RULE',
          amount_abs: null,
          amount_signed: null,
        },
      }),
    ]);
    expect(out.blocked).toBe(1);
    expect(out.net).toBe(0);
    expect(out.doplata).toBe(0);
  });
});

describe('dva datuma', () => {
  const item = (over: Partial<FinanceHistoryItem> = {}): FinanceHistoryItem =>
    ({
      transaction_type: 'ADJUSTMENT',
      economic_period_start: '2026-07-17',
      approved_at: '2026-08-10T10:00:00Z',
      ...over,
    } as unknown as FinanceHistoryItem);

  it('razdvaja ekonomski mesec od meseca transakcije', () => {
    const out = transactionVsEconomicMonth(item());
    expect(out.economic).toBe('2026-07');
    expect(out.transaction).toBe('2026-08');
    expect(out.differs).toBe(true);
  });

  it('kod redovnog obračuna se obično poklapaju', () => {
    const out = transactionVsEconomicMonth(
      item({ economic_period_start: '2026-08-03', approved_at: '2026-08-10T10:00:00Z' }),
    );
    expect(out.differs).toBe(false);
  });

  it('deli istoriju po tipu transakcije', () => {
    const out = splitHistory([
      item(),
      item({ transaction_type: 'PERIOD' }),
      item({ transaction_type: 'PERIOD' }),
    ]);
    expect(out.adjustments).toHaveLength(1);
    expect(out.periods).toHaveLength(2);
  });
});
