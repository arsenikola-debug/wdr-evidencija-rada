import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  buildPayoutReport,
  buildPayoutWorkbook,
  reportCategoryFor,
  reportFileName,
  type ReportSourceLine,
} from '../src/features/reports/payoutReport';
import { MockWdrApi } from '../src/lib/api/mockApi';
import { WdrApiError } from '../src/lib/api/WdrApi';

const B6 = 'c-b6';
const BZ = 'c-bz';

const L = (over: Partial<ReportSourceLine>): ReportSourceLine => ({
  employee_id: 'marko', employee_name: 'Marković Marko', employee_code: 'E-001',
  center_id: B6, center_code: 'B6', work_date: '2026-07-06',
  category: 'KARNET', units: 1, amount: 4000, is_adjustment: false, counts_headcount: true,
  ...over,
});

const LINES: ReportSourceLine[] = [
  L({}),
  L({ category: 'PREKOVREMENI', units: 2, amount: 800 }),
  L({ category: 'DNEVNICA', work_date: '2026-07-07', amount: 1500 }),
  L({ employee_id: 'ana', employee_name: 'Jovanović Ana', employee_code: 'E-003' }),
  L({ employee_id: 'ana', employee_name: 'Jovanović Ana', employee_code: 'E-003',
      category: 'PREVOZ', amount: 500, counts_headcount: false }),
  L({ employee_id: 'petar', employee_name: 'Petrović Petar', employee_code: 'E-002',
      center_id: BZ, center_code: 'BZ', category: 'STOPOVI', units: 40, amount: 4800 }),
  // odobrena korekcija: ulazi u iznos, ne u broj ljudi
  L({ category: 'PREKOVREMENI', units: 1, amount: 400, is_adjustment: true, counts_headcount: false,
      work_date: '2026-07-08' }),
];

describe('kategorije izveštaja (ogledalo 0059)', () => {
  it('izvodi kategoriju iz ključa ponašanja, osnovne po šifri', () => {
    expect(reportCategoryFor('PRIMARY', 'KARNET', 'PRIMARY_DAILY')).toBe('KARNET');
    expect(reportCategoryFor('COMPONENT', 'MOJA_ISPOMOC', 'ASSISTANCE')).toBe('ISPOMOC');
    expect(reportCategoryFor('ADJUSTMENT', 'PREKOVREMENI', 'OVERTIME_HOURS')).toBe('PREKOVREMENI');
    expect(reportCategoryFor('TRANSPORT', null, null)).toBe('PREVOZ');
    expect(reportCategoryFor('COMPONENT', 'NOCNI_RAD', null)).toBe('NOCNI_RAD');
  });
});

describe('buildPayoutReport — po zaposlenom', () => {
  const r = buildPayoutReport({ from: '2026-07-06', to: '2026-07-12', lines: LINES });
  const marko = r.by_employee.find((x) => x.employee_id === 'marko')!;

  it('zbir po kategoriji i ukupno (sa korekcijom)', () => {
    expect(marko.categories.KARNET).toEqual({ units: 1, amount: 4000 });
    expect(marko.categories.PREKOVREMENI).toEqual({ units: 3, amount: 1200 });
    expect(marko.adjustment_amount).toBe(400);
    expect(marko.payout_total).toBe(6700);
  });

  it('prevoz je odvojen i nije u ukupnim naknadama', () => {
    const ana = r.by_employee.find((x) => x.employee_id === 'ana')!;
    expect(ana.transport_amount).toBe(500);
    expect(ana.payout_total).toBe(4000);
    expect(r.totals.transport_amount).toBe(500);
  });

  it('filter centra', () => {
    const bz = buildPayoutReport({ from: '2026-07-06', to: '2026-07-12', centerIds: [BZ], lines: LINES });
    expect(bz.by_employee.map((x) => x.employee_id)).toEqual(['petar']);
  });
});

describe('buildPayoutReport — broj ljudi po danu i višestruke kategorije', () => {
  const r = buildPayoutReport({ from: '2026-07-06', to: '2026-07-12', lines: LINES });

  it('isti zaposleni se broji u svakoj kategoriji i označava', () => {
    const d = r.by_day.find((x) => x.work_date === '2026-07-06' && x.center_code === 'B6')!;
    expect(d.counts.KARNET).toBe(2);
    expect(d.counts.PREKOVREMENI).toBe(1);
    expect(d.multi_category_employees).toBe(1);
    expect(r.multi_category).toEqual([
      expect.objectContaining({ employee_id: 'marko', work_date: '2026-07-06',
        categories: ['KARNET', 'PREKOVREMENI'] }),
    ]);
  });

  it('korekcija i prevoz ne ulaze u broj ljudi', () => {
    expect(r.by_day.find((x) => x.work_date === '2026-07-08')).toBeUndefined();
    expect(Object.keys(r.by_day[0].counts)).not.toContain('PREVOZ');
  });
});

describe('XLSX izvoz', () => {
  const report = buildPayoutReport({ from: '2026-07-06', to: '2026-07-12', lines: LINES });

  it('pravi pravi .xlsx sa tri obavezna sheet-a, formatima i autofilterom', async () => {
    const wb = buildPayoutWorkbook(ExcelJS, report);
    const buf = await wb.xlsx.writeBuffer();
    // ZIP potpis — pravi OOXML, ne CSV.
    expect(Buffer.from(buf as ArrayBuffer).subarray(0, 2).toString()).toBe('PK');

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as ArrayBuffer);
    expect(back.worksheets.map((w) => w.name)).toEqual([
      'Po zaposlenom', 'Po danu i centru', 'Višestruke kategorije', 'Napomene',
    ]);

    const s1 = back.getWorksheet('Po zaposlenom')!;
    expect(s1.getRow(1).getCell(2).value).toBe('Ime i prezime');
    expect(s1.getRow(1).font?.bold).toBe(true);
    expect(s1.autoFilter).toBeTruthy();
    const header = (s1.getRow(1).values as unknown[]).map(String);
    const totalCol = header.indexOf('Ukupno naknade');
    expect(totalCol).toBeGreaterThan(0);
    const markoRow = s1.getRows(2, 3)!.find((row) => row.getCell(2).value === 'Marković Marko')!;
    expect(markoRow.getCell(totalCol).value).toBe(6700);
    expect(s1.getColumn(totalCol).numFmt).toBe('#,##0.00');

    // GO/BO su samo broj ljudi: nema ih u sheet-u sa iznosima, ima ih po danu.
    expect(header.some((h) => h.startsWith('GO'))).toBe(false);
    const s2 = back.getWorksheet('Po danu i centru')!;
    expect((s2.getRow(1).values as unknown[]).map(String)).toContain('GO (bez rada)');
    expect(s2.getRow(2).getCell(1).value).toBeInstanceOf(Date);
    expect(s2.getColumn(1).numFmt).toBe('dd.mm.yyyy.'); // prikaz 05.10.2026. (pravi datum u ćeliji)

    const s3 = back.getWorksheet('Višestruke kategorije')!;
    expect(s3.getRow(2).getCell(5).value).toBe('Karnet + Prekovremeni');
  });

  it('ime fajla sadrži period', () => {
    expect(reportFileName(report)).toBe('WDR_isplate_2026-07-06_2026-07-12.xlsx');
  });
});

describe('MockWdrApi.adminPayoutReport', () => {
  it('operater nema pristup (analytics.ba.view)', async () => {
    const api = new MockWdrApi({ role: 'operator' });
    await api.signIn('operater@wdr.local', 'mock1234');
    await expect(api.adminPayoutReport('2026-07-06', '2026-07-12')).rejects.toBeInstanceOf(WdrApiError);
  });

  it('pre odobrenja nema redovnih isplata (samo odobreno)', async () => {
    const api = new MockWdrApi({ role: 'admin' });
    await api.signIn('admin@wdr.local', 'mock1234');
    const r = await api.adminPayoutReport('2026-07-06', '2026-07-12');
    expect(r.basis).toBe('APPROVED_SNAPSHOTS_BY_WORK_DATE');
    expect(r.by_employee.every((x) => Object.keys(x.categories).every((k) => k === 'STOPOVI'))).toBe(true);
  });
});

describe('MockWdrApi.createPeriodSubmission — najviše 7 dana', () => {
  it('8 dana je odbijeno, 7 dana prolazi', async () => {
    const api = new MockWdrApi({ role: 'operator' });
    await api.signIn('operater@wdr.local', 'mock1234');
    await expect(
      api.createPeriodSubmission('10000000-0000-0000-0000-0000000000b6', '2026-12-07', '2026-12-14', 'KARNET'),
    ).rejects.toMatchObject({ code: 'PERIOD_RANGE_TOO_LONG' });
    const ok = await api.createPeriodSubmission('10000000-0000-0000-0000-0000000000b6', '2026-12-07', '2026-12-13', 'KARNET');
    expect(ok.created).toBe(true);
  });
});
