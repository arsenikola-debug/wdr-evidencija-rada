import { describe, expect, it } from 'vitest';
import {
  employeeTotals,
  summarizeByEmployee,
  type SummaryLine,
} from '../src/features/finance/employeeSummary';

const L = (over: Partial<SummaryLine>): SummaryLine => ({
  employee_id: 'marko', employee_name: 'Marković Marko', employee_code: 'E-001',
  line_kind: 'PRIMARY', payment_type_code: 'KARNET', units: 1, amount: 4000, ...over,
});

/** Redizajn §7 / §21 — zbir po zaposlenom za ceo period, bez dnevnog raščlanjenja. */
describe('summarizeByEmployee', () => {
  const lines: SummaryLine[] = [
    L({}), L({}),
    L({ payment_type_code: 'OBUKA', amount: 2000 }), L({ payment_type_code: 'OBUKA', amount: 2000 }),
    L({ line_kind: 'COMPONENT', payment_type_code: 'PREKOVREMENI', units: 2, amount: 800 }),
    L({ employee_id: 'ana', employee_name: 'Jovanović Ana', employee_code: 'E-003' }),
    L({ employee_id: 'ana', employee_name: 'Jovanović Ana', line_kind: 'TRANSPORT', payment_type_code: 'GAMZED', amount: 500 }),
  ];
  const groups = summarizeByEmployee(lines);

  it('zaposleni sa delom perioda Karnet i delom Obuka je u obe grupe', () => {
    const karnet = groups.find((g) => g.key === 'KARNET')!;
    const obuka = groups.find((g) => g.key === 'OBUKA')!;
    expect(karnet.rows.find((r) => r.employeeId === 'marko')).toMatchObject({ units: 2, amount: 8000 });
    expect(obuka.rows.find((r) => r.employeeId === 'marko')).toMatchObject({ units: 2, amount: 4000 });
  });

  it('jedan red po zaposlenom po vrsti — nema redova po danima', () => {
    expect(groups.find((g) => g.key === 'KARNET')!.rows).toHaveLength(2);
  });

  it('redosled: osnovne, komponente, prevoz na kraju', () => {
    expect(groups.map((g) => g.key)).toEqual(['KARNET', 'OBUKA', 'PREKOVREMENI', 'PREVOZ']);
  });

  it('stavka bez pravila se ne računa kao nula', () => {
    const g = summarizeByEmployee([L({}), L({ amount: null })]);
    expect(g[0].rows[0]).toMatchObject({ amount: 4000, units: 1, blockedLines: 1 });
    expect(g[0].blockedLines).toBe(1);
  });

  it('ukupno po zaposlenom je bez prevoza, prevoz je odvojen', () => {
    const t = employeeTotals(lines);
    expect(t.get('marko')).toMatchObject({ amount: 12800, transportAmount: 0, blockedLines: 0 });
    expect(t.get('ana')).toMatchObject({ amount: 4000, transportAmount: 500 });
  });
});
