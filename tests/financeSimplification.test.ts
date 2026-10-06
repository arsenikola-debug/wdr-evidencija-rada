import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmployeePeriodTable } from '../src/components/EmployeePeriodTable';
import { headerShowsCenters } from '../src/components/navConfig';
import {
  employeePeriodRows,
  fromCalcLines,
  fromCalcLinesWithStatus,
  fromPreviewLines,
} from '../src/features/finance/employeeSummary';
import { financeApprovalSummary, formatPeriod } from '../src/features/finance/recap';
import type { CalcLine, FinanceRecap, PreviewLine } from '../src/lib/api/types';

/** Pojednostavljen Finance prikaz posle 0074 + ispravka „nepotpuno". */
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

const line = (o: Partial<CalcLine>): CalcLine => ({
  line_no: 1, employee_id: 'm', employee_name: 'Zaposleni BM', employee_code: 'E-1', work_date: '2026-08-17',
  attendance_status: 'WORK', line_kind: 'PRIMARY', payment_type_code: 'KARNET', units: 1, rate: 3900,
  amount: 3900, status: 'RESOLVED', pricing_problem: null, ...o,
} as unknown as CalcLine);

// Produkcijski slučaj: BM · Karnet · 17.08.–22.08.2026. · 6 dana × 3.900 = 23.400,
// zaposleni bez prava na prevoz → TRANSPORT stavka NOT_ELIGIBLE bez iznosa.
const BM: CalcLine[] = [
  ...['17', '18', '19', '20', '21', '22'].map((d, i) => line({ line_no: i + 1, work_date: `2026-08-${d}` })),
  ...['17', '18', '19', '20', '21', '22'].map((d, i) => line({
    line_no: 10 + i, work_date: `2026-08-${d}`, line_kind: 'TRANSPORT', payment_type_code: null,
    rate: null, amount: null, status: 'NOT_ELIGIBLE' as CalcLine['status'],
  })),
];

describe('bug „nepotpuno": zaposleni bez prevoza na odobrenoj prijavi', () => {
  it('UKUPNO je 23.400, ne „nepotpuno" (NOT_ELIGIBLE je rešen odgovor, ne blokada)', () => {
    const [row] = employeePeriodRows(fromCalcLinesWithStatus(BM));
    expect(row).toMatchObject({ baseAmount: 23400, transportAmount: 0, total: 23400, blockedLines: 0 });
    const html = renderToStaticMarkup(createElement(EmployeePeriodTable, {
      rows: [row], periodLabel: formatPeriod('2026-08-17', '2026-08-22'),
    }));
    expect(html).toContain('23.400 RSD');
    expect(html).not.toContain('nepotpuno');
  });

  it('i NO_TRANSPORT_ASSIGNMENT je rešen odgovor (0), ne blokada', () => {
    const rows = employeePeriodRows(fromCalcLinesWithStatus([
      line({}), line({ line_no: 2, line_kind: 'TRANSPORT', amount: null, status: 'NO_TRANSPORT_ASSIGNMENT' as CalcLine['status'] }),
    ]));
    expect(rows[0].blockedLines).toBe(0);
  });

  it('stvarna blokada (isti skup kao u bazi) i dalje daje „nepotpuno"', () => {
    for (const status of ['MISSING_RULE', 'MISSING_PAYMENT_TYPE', 'RULE_NOT_PRICEABLE']) {
      const [row] = employeePeriodRows(fromCalcLinesWithStatus([
        line({}), line({ line_no: 2, amount: null, status: status as CalcLine['status'] }),
      ]));
      expect(row.blockedLines, status).toBe(1);
    }
  });

  it('Finansije i operaterski Pregled se više ne razilaze za iste statuse', () => {
    for (const status of ['RESOLVED', 'NOT_ELIGIBLE', 'NO_TRANSPORT_ASSIGNMENT', 'MISSING_RULE', 'MISSING_PAYMENT_TYPE', 'RULE_NOT_PRICEABLE']) {
      const fin = fromCalcLines([line({ status: status as CalcLine['status'], amount: status === 'RESOLVED' ? 3900 : null })])[0];
      const prev = fromPreviewLines([{
        employee_id: 'm', employee_name: 'X', line_kind: 'PRIMARY', payment_type_code: 'KARNET', units: 1,
        calculated_amount: status === 'RESOLVED' ? 3900 : null, status,
      } as unknown as PreviewLine])[0];
      expect(fin.amount, status).toBe(prev.amount);
    }
  });
});

describe('Finance rezime za odobrenje: samo naknade, prevoz, ukupno', () => {
  const recap = {
    naknade_zaposlenima: 23400, prekovremeni: 400, radna_subota: 0, ispomoc: 500, dodatne_stavke: 100,
    prevoz: 1500, ukupno_za_odobrenje: 25900, is_complete: true, resolved_subtotal: 25900, blocking_line_count: 0,
  } as unknown as FinanceRecap;

  it('naknade = sve grupe osim prevoza; naknade + prevoz = ukupno iz baze', () => {
    const s = financeApprovalSummary(recap);
    expect(s).toEqual({ employeePay: 24400, transport: 1500 });
    expect(s.employeePay + s.transport).toBe(25900);
  });

  it('BM primer: 23.400 + 0 = 23.400', () => {
    expect(financeApprovalSummary({ ...recap, prekovremeni: 0, ispomoc: 0, dodatne_stavke: 0, prevoz: 0,
      ukupno_za_odobrenje: 23400 } as FinanceRecap)).toEqual({ employeePay: 23400, transport: 0 });
  });

  it('detalj prijave nema gornji breakdown ni tri drill-downa; zeleni ukupno, prevoz i tabela ostaju', () => {
    const page = src('routes/FinanceSubmission.tsx');
    for (const gone of ['Po vrsti naknade', 'Po zaposlenom i danu', 'Sve stavke obračuna', '<h2>Obračunato</h2>', 'recapRows(']) {
      expect(page, gone).not.toContain(gone);
    }
    for (const kept of ['Naknade zaposlenima', '<h2>Prevoz</h2>', 'Nema obračunatog prevoza u ovom periodu.',
      'UKUPNO ZA ODOBRENJE', 'Po zaposlenom — ukupno za period', '<BaseTypeChip']) {
      expect(page, kept).toContain(kept);
    }
  });
});

describe('period i zaglavlje', () => {
  it('period se prikazuje jednom, čitljivo', () => {
    expect(formatPeriod('2026-08-17', '2026-08-22')).toBe('17.08.–22.08.2026.');
    expect(formatPeriod('2025-12-29', '2026-01-04')).toBe('29.12.2025.–04.01.2026.');
  });

  it('red za odobrenje i istorija ne ispisuju period dva puta', () => {
    const queue = src('routes/FinanceQueue.tsx');
    expect(queue).not.toMatch(/it\.period_label/);
    expect(queue).toContain('formatPeriod(it.period_start, it.period_end)');
    expect(src('routes/FinanceHistory.tsx')).toContain('formatPeriod(h.economic_period_start, h.economic_period_end)');
    expect(queue).toContain('<BaseTypeChip');
  });

  it('Finansije: zaglavlje bez spiska centara (ostali delovi aplikacije nepromenjeni)', () => {
    expect(headerShowsCenters('/finansije', 'finance')).toBe(false);
    expect(headerShowsCenters('/finansije/prijava', 'admin')).toBe(false);
    expect(headerShowsCenters('/finansije/istorija', 'finance')).toBe(false);
    expect(headerShowsCenters('/', 'finance')).toBe(false);
    expect(headerShowsCenters('/unos', 'operator')).toBe(true);
  });
});
