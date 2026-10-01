import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GridToolbar } from '../src/components/GridToolbar';
import { LOCK_REASON_TEXT } from '../src/features/grid/eligibility';
import { dayAvailable } from '../src/features/payouts/model';
import { MockWdrApi } from '../src/lib/api/mockApi';
import type { GridPayload, PayoutDetail } from '../src/lib/api/types';

/**
 * Finalna korekcija (2026-10-01):
 *   • osnovni Karnet/Obuka Unos NIKADA nema „Dodatno", Ispomoć ni Prekovremeni;
 *   • zaposleni iz uvoza bez Karnet/Obuka, masovna dodela, Admin datumi.
 */
function payload(start: string, end: string): GridPayload {
  return {
    submission: {
      id: 's', center_id: 'c', center_code: 'B6', center_name: 'B6', period_id: 'p',
      period_start: start, period_end: end, status: 'DRAFT', review_confirmed: false, editable: true, can_write: true,
    },
    reference: { shift_templates: [{ id: 't', code: '06-14', label: '06-14' }] },
    validation: { errors: 0, warnings: 0 },
  } as unknown as GridPayload;
}

function toolbarHtml(start: string, end: string): string {
  const noop = () => {};
  return renderToStaticMarkup(createElement(GridToolbar, {
    payload: payload(start, end),
    selection: { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } },
    editable: true, completion: null, expectedMode: 'MON_SAT',
    onExpectedMode: noop, saveSummary: { dirty: 0, saving: 0, errors: 0 }, autosave: { queued: 0, saving: false },
    onApplyStatus: noop, onApplyShift: noop, onClear: noop, onCopyDay: noop, onOpenPreview: noop,
  } as unknown as Parameters<typeof GridToolbar>[0]));
}

describe('osnovni Unos — bez legacy dodatnih isplata', () => {
  for (const [label, start, end] of [
    ['PRE cutover-a (28.09–04.10.2026)', '2026-09-28', '2026-10-04'],
    ['POSLE cutover-a (05.10–11.10.2026)', '2026-10-05', '2026-10-11'],
  ] as const) {
    it(`toolbar nema Dodatno / Ispomoć / Prekovremeni — ${label}`, () => {
      const html = toolbarHtml(start, end);
      expect(html).not.toMatch(/Dodatno/);
      expect(html).not.toMatch(/Ispomo/);
      expect(html).not.toMatch(/Prekovremen/);
      expect(html).not.toMatch(/Prelazni period/);
      expect(html).toMatch(/Kopiraj prethodni dan/);
    });
  }

  it('Unos ne uvozi dijaloge ispomoći/prekovremenog ni datumsku logiku prelaznog perioda', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'DailyEntry.tsx'), 'utf8');
    expect(src).not.toMatch(/AssistanceDialog|OvertimeDialog|legacyPayouts|payoutCutover/);
  });
});

describe('zaposleni bez Karnet/Obuka', () => {
  it('dan bez osnovne vrste ima jasan razlog zaključavanja', () => {
    expect(LOCK_REASON_TEXT.NO_BASE_TYPE).toMatch(/Karnet\/Obuka/);
  });

  it('masovna dodela: samo Admin; dodeljeni nestaju sa liste; greška jednog ne ruši ostale', async () => {
    const op = new MockWdrApi({ role: 'operator' });
    await op.signIn('operater@wdr.local', 'mock1234');
    await expect(op.adminEmployeesWithoutBaseType()).rejects.toBeTruthy();
    await expect(op.adminBulkAssignBaseType(['imp-1'], 'KARNET', '2026-08-01')).rejects.toBeTruthy();

    const admin = new MockWdrApi({ role: 'admin' });
    await admin.signIn('admin@wdr.local', 'mock1234');
    expect((await admin.adminEmployeesWithoutBaseType()).length).toBe(2);
    const r = await admin.adminBulkAssignBaseType(['imp-1', 'nepostoji'], 'KARNET', '2026-08-01');
    expect(r).toMatchObject({ assigned: 1, failed: 1 });
    expect((await admin.adminEmployeesWithoutBaseType()).map((x) => x.employee_id)).toEqual(['imp-2']);
  });

  it('Admin menja baseline datum početka; kraj pre početka je odbijen', async () => {
    const admin = new MockWdrApi({ role: 'admin' });
    await admin.signIn('admin@wdr.local', 'mock1234');
    await expect(admin.adminSetEmploymentDates('e1', '2026-03-01', null)).resolves.toBeTruthy();
    await expect(admin.adminSetEmploymentDates('e1', '2026-08-01', '2026-07-01')).rejects.toBeTruthy();
  });
});

describe('Radna subota u UI-ju', () => {
  it('dan koji nije subota je zaključan za unos', () => {
    const d = {
      request: { saturday_only: true }, cutover_date: '2026-10-05',
      employees: [{ employee_id: 'e', employed_dates: ['2026-10-09', '2026-10-10', '2026-10-11'] }],
    } as unknown as PayoutDetail;
    expect(dayAvailable(d, 'e', '2026-10-10')).toBe(true);   // subota
    expect(dayAvailable(d, 'e', '2026-10-09')).toBe(false);  // petak
    expect(dayAvailable(d, 'e', '2026-10-11')).toBe(false);  // nedelja
  });
});
