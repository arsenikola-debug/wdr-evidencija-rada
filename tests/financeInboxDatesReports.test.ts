import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CenterMultiSelect, CenterOptionRow, filterCenters } from '../src/components/CenterMultiSelect';
import {
  type StopsQueueItem,
  mergeInbox,
  pendingAdditionalCount,
  rowsFromPayouts,
  rowsFromStopsQueue,
} from '../src/features/finance/additionalInbox';
import { formatDateHeader } from '../src/features/grid/model';
import { groupByCenter, sortByCenter } from '../src/features/reports/groupByCenter';
import { MockWdrApi } from '../src/lib/api/mockApi';
import type { PayoutListItem } from '../src/lib/api/types';
import {
  formatDate, formatDateTime, formatMonth, formatPeriod, localizeIsoDates,
} from '../src/lib/format/date';

const B6 = '10000000-0000-0000-0000-0000000000b6';
const payout = (o: Partial<PayoutListItem>): PayoutListItem => ({
  id: 'p1', request_type: 'DNEVNICA', request_type_name: 'Dnevnice', center_id: 'c', center_code: 'BZ',
  period_start: '2026-10-05', period_end: '2026-10-11', status: 'SUBMITTED', is_correction: false,
  corrects_request_id: null, submitted_at: '2026-10-06T08:00:00Z', approved_at: null, employees: 3, lines: 4,
  total_amount: 16000, ...o,
});
const stops = (o: Partial<StopsQueueItem>): StopsQueueItem => ({
  submission_id: 's1', center_code: 'B6', period_start: '2026-10-05', period_end: '2026-10-11', status: 'SUBMITTED',
  submitted_at: '2026-10-07T08:00:00Z', total_stops: 120, total_calculated_amount: 14400, blocking_line_count: 0, ...o,
});

// =============================================================================
describe('Finansije: objedinjene „Dodatne isplate" (dodatne isplate + Stopovi)', () => {
  const rows = [
    ...rowsFromPayouts([payout({}), payout({ id: 'p2', request_type: 'RADNA_SUBOTA', request_type_name: 'Radna subota', status: 'RETURNED' }),
      payout({ id: 'p3', request_type: 'ISPOMOC', request_type_name: 'Ispomoć', status: 'FINANCE_APPROVED' })]),
    ...rowsFromStopsQueue([stops({}), stops({ submission_id: 's2', status: 'RETURNED' })]),
  ];

  it('Stopovi i ostale vrste su u istoj listi; svaki red ima vrstu', () => {
    const pending = mergeInbox(rows, 'SUBMITTED');
    expect(pending.map((r) => r.kind).sort()).toEqual(['Dnevnice', 'Stopovi']);
    expect(pending.every((r) => r.kind.length > 0)).toBe(true);
  });

  it('statusi Čeka odobrenje / Vraćeno / Odobreno rade za obe vrste', () => {
    expect(mergeInbox(rows, 'RETURNED').map((r) => r.kind).sort()).toEqual(['Radna subota', 'Stopovi']);
    expect(mergeInbox(rows, 'FINANCE_APPROVED').map((r) => r.kind)).toEqual(['Ispomoć']);
  });

  it('klik vodi na POSTOJEĆI detalj odgovarajuće vrste', () => {
    const [d] = mergeInbox(rows, 'SUBMITTED').filter((r) => r.kind === 'Dnevnice');
    const [s] = mergeInbox(rows, 'SUBMITTED').filter((r) => r.kind === 'Stopovi');
    expect(d.href).toBe('/finansije/dodatne-isplate/zahtev?zahtev=p1');
    expect(s.href).toBe('/finansije/stopovi-kurira?prijava=s1');
    expect(d).toMatchObject({ centerCode: 'BZ', employees: 3, amount: 16000 });
  });

  it('Stopovi sa blokiranom stavkom nemaju iznos (nepotpuno), ne nulu', () => {
    expect(rowsFromStopsQueue([stops({ blocking_line_count: 1 })])[0].amount).toBeNull();
  });
});

describe('pending / brojač za „Dodatne isplate"', () => {
  it('obuhvata SVE vrste koje čekaju odobrenje (dodatne isplate + Stopovi)', () => {
    expect(pendingAdditionalCount(
      [payout({}), payout({ id: 'x', status: 'RETURNED' }), payout({ id: 'y', status: 'FINANCE_APPROVED' })],
      [stops({}), stops({ submission_id: 'z', status: 'RETURNED' })],
    )).toBe(2);
    expect(pendingAdditionalCount([], [])).toBe(0);
  });

  it('posle slanja dodatne isplate Finansije vide zahtev koji čeka (mock tok)', async () => {
    // DEMO admin ima i payout.create i payout.approve (jedan mock = jedno stanje).
    const op = new MockWdrApi({ role: 'admin' });
    await op.signIn('admin@wdr.local', 'mock1234');
    const before = (await op.payoutFinanceQueue(['SUBMITTED'])).length;
    const d = await op.payoutOpen('DNEVNICA', B6, '2026-07-13', '2026-07-19');
    await op.payoutSetEmployees(d.request.id, ['e1']);
    await op.payoutSetLine({ request_id: d.request.id, employee_id: 'e1', work_date: '2026-07-13', units: 1 });
    await op.payoutSubmit(d.request.id);
    const after = await op.payoutFinanceQueue(['SUBMITTED']);
    expect(after.length).toBe(before + 1);
    expect(pendingAdditionalCount(after, [])).toBe(before + 1);
  });

  it('meni prikazuje brojač na „Dodatne isplate" iz oba reda za odobrenje', () => {
    const layout = readFileSync(join(__dirname, '..', 'src', 'components', 'Layout.tsx'), 'utf8');
    expect(layout).toContain("n.to === '/finansije/dodatne-isplate' && pendingAdditional > 0");
    expect(layout).toContain('api.payoutFinanceQueue([\'SUBMITTED\'])');
    expect(layout).toContain('api.courierStopFinanceQueue()');
  });
});

// =============================================================================
describe('jedinstven format datuma (lib/format/date.ts)', () => {
  it('datum, period, datum i vreme, mesec', () => {
    expect(formatDate('2026-10-05')).toBe('05.10.2026.');
    expect(formatPeriod('2026-10-05', '2026-10-11')).toBe('05.10.2026. – 11.10.2026.');
    expect(formatDateTime('2026-10-05T14:30:00')).toBe('05.10.2026. 14:30');
    expect(formatMonth('2026-10')).toBe('10.2026.');
  });
  it('kalendarski datum se ne pomera zbog vremenske zone; prazno → „—"', () => {
    expect(formatDate('2026-01-01')).toBe('01.01.2026.');
    expect(formatDate(null)).toBe('—');
    expect(formatPeriod(null, null)).toBe('—');
  });
  it('ISO datum u tekstu iz baze (greške, obaveštenja) se lokalizuje', () => {
    expect(localizeIsoDates('Datum 2026-10-05 je van perioda 2026-10-05 – 2026-10-11.'))
      .toBe('Datum 05.10.2026. je van perioda 05.10.2026. – 11.10.2026..');
  });
  it('zaglavlje kolone grida koristi isti format', () => {
    expect(formatDateHeader('2026-10-05').dm).toBe('05.10.2026.');
  });

  it('ISO datum se ne prikazuje korisniku: nijedan ekran ne renderuje sirovo datumsko polje', () => {
    const root = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p);
    });
    walk(root);
    const FIELD = '(period_start|period_end|work_date|related_work_date|valid_from|valid_to|employment_start_date|employment_end_date|economic_period_start|economic_period_end|cutover_date|period_label|submitted_at|approved_at|created_at)';
    const jsxRaw = new RegExp(`(^|[^=])\\{\\s*[A-Za-z_][\\w.?]*\\.${FIELD}\\s*(\\?\\?\\s*'[^']*'\\s*)?\\}`);
    const tmplRaw = new RegExp(`\\$\\{\\s*[A-Za-z_][\\w.?]*\\.${FIELD}\\s*\\}`);
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const l = line.replace(/key=\{`[^`]*`\}/g, '');
        if (jsxRaw.test(l) || (tmplRaw.test(l) && !/key=|href|to=|\/(finansije|unos|dodatne)/.test(l))
            || /toLocale(Date)?String\(/.test(l) || /\.slice\(0, ?16\)\.replace\('T'/.test(l)) {
          offenders.push(`${f.split('/src/')[1]}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

// =============================================================================
describe('Admin → Izveštaji isplata: izbor centara i grupisanje', () => {
  const centers = [
    { id: '1', code: 'BZ', name: 'Bežanija' }, { id: '2', code: 'BM', name: 'Beograd M' },
    { id: '3', code: 'NP', name: 'Novi Pazar' }, { id: '4', code: 'LS', name: 'Leštane' },
  ];

  it('pretraga centra po šifri i nazivu, bez obzira na dijakritiku', () => {
    expect(filterCenters(centers, 'bz').map((c) => c.code)).toEqual(['BZ']);
    expect(filterCenters(centers, 'bezanija').map((c) => c.code)).toEqual(['BZ']);
    expect(filterCenters(centers, 'LEŠT').map((c) => c.code)).toEqual(['LS']);
    expect(filterCenters(centers, '').length).toBe(4);
  });

  it('kontrola: prazan izbor = svi centri; izabrani su kompaktne oznake (+N)', () => {
    const r = (value: string[]) => renderToStaticMarkup(createElement(CenterMultiSelect, { centers, value, onChange: () => {} }));
    expect(r([])).toContain('Svi centri');
    const one = r(['1']);
    expect(one).toContain('BZ');
    expect(one).toContain('Ukloni BZ');
    expect(one).toContain('Očisti');
    const many = r(['1', '2', '3', '4']);
    expect(many).toContain('+1');
  });

  it('rezultati za više centara su grupisani po centru; jedan centar radi', () => {
    const rows = [{ c: 'NP', n: 1 }, { c: 'BZ', n: 2 }, { c: 'BM', n: 3 }, { c: 'BZ', n: 4 }];
    expect(groupByCenter(rows, (r) => [r.c]).map((g) => `${g.centerCode}:${g.rows.map((r) => r.n).join('+')}`))
      .toEqual(['BM:3', 'BZ:2+4', 'NP:1']);
    expect(groupByCenter([{ c: 'BZ', n: 1 }], (r) => [r.c])).toHaveLength(1);
  });

  it('red u više centara se prikazuje pod svakim centrom', () => {
    expect(groupByCenter([{ codes: ['BZ', 'BM'] }], (r) => r.codes).map((g) => g.centerCode)).toEqual(['BM', 'BZ']);
  });

  it('Excel: redovi sortirani po centru', () => {
    expect(sortByCenter([{ c: 'NP' }, { c: 'BZ' }, { c: 'BM' }], (r) => r.c).map((r) => r.c)).toEqual(['BM', 'BZ', 'NP']);
  });
});

// =============================================================================
describe('izbor centara: opcija u jednom redu (☐ B6 — Rakovica)', () => {
  const row = (selected: boolean) => renderToStaticMarkup(createElement(CenterOptionRow, {
    center: { id: '1', code: 'B6', name: 'Rakovica' }, selected, onToggle: () => {},
  }));

  it('checkbox, šifra i naziv su u ISTOM klikabilnom redu (jedan label), redom', () => {
    const html = row(false);
    expect((html.match(/<label/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<label class="center-ms-option"[^>]*><input type="checkbox"[^>]*\/><strong class="center-ms-code">B6<\/strong><em class="center-ms-name">— Rakovica<\/em><\/label>/);
    expect(html).not.toContain('<span');            // naziv nije pogođen pravilom `label > span`
  });

  it('izabrani centar je suptilno istaknut i označen za čitače ekrana', () => {
    const html = row(true);
    expect(html).toContain('class="center-ms-option is-selected"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('checked=""');
  });

  it('CSS: opcija je horizontalna i poništava kolonski raspored oznaka polja', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    const rule = css.slice(css.indexOf('.center-ms-menu .center-ms-option {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('flex-direction: row');
    expect(body).toContain('cursor: pointer');
    expect(body).toContain('white-space: nowrap');
    // specifičnost iznad `.report-filters label` (koji postavlja kolonu)
    expect('.center-ms-menu .center-ms-option'.split('.').length - 1).toBeGreaterThan(1);
  });
});
