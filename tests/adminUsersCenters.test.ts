import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  type CenterChoice,
  CENTERS_LIST_LIMIT,
  EMPTY_NEW_USER,
  applyModeToAll,
  bulkSelectCenters,
  centersCountLabel,
  centersSummary,
  defaultBulkWrite,
  grantsAllCenters,
  newUserPayload,
} from '../src/features/admin/users';
import { CenterAccessPicker, UserCentersCell } from '../src/components/UserCenters';
import type { AdminRoleCatalogItem, AdminUserRow } from '../src/lib/api/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '..', 'src', rel), 'utf8');

const ROLES: AdminRoleCatalogItem[] = [
  { code: 'DATA_ENTRY_OPERATOR', name: 'Operater unosa', description: null, is_system: true, permissions: ['entry.view'] },
  { code: 'FINANCE', name: 'Finansije', description: null, is_system: true, permissions: ['finance.approve'] },
  { code: 'SUPER_ADMIN_BA', name: 'Super administrator / BA', description: null, is_system: true,
    permissions: ['centers.manage', 'users.manage', 'roles.manage'] },
];

// 45 centara (kao na produkciji), jedan neaktivan
const CATALOG = Array.from({ length: 45 }, (_, i) => ({
  code: `C${String(i + 1).padStart(2, '0')}`, name: `Centar ${String(i + 1).padStart(2, '0')}`, active: i !== 44,
}));
const ACTIVE = CATALOG.filter((c) => c.active);

type Row = Pick<AdminUserRow, 'all_centers' | 'centers'>;
const centersOf = (codes: string[], write: boolean | ((i: number) => boolean)): Row['centers'] =>
  codes.map((code, i) => {
    const c = CATALOG.find((x) => x.code === code)!;
    return { center_id: code, center_code: code, center_name: c.name, center_active: c.active,
             can_write: typeof write === 'function' ? write(i) : write };
  });
const user = (centers: Row['centers'], all_centers = false): Row => ({ all_centers, centers });

// =============================================================================
describe('1. centers.manage → „Svi centri (administrator)" (isto pravilo kao baza)', () => {
  it('uloga sa centers.manage daje sve centre; ostale ne', () => {
    expect(grantsAllCenters(ROLES, ['SUPER_ADMIN_BA'])).toBe(true);
    expect(grantsAllCenters(ROLES, ['FINANCE', 'SUPER_ADMIN_BA'])).toBe(true);
    expect(grantsAllCenters(ROLES, ['FINANCE'])).toBe(false);
    expect(grantsAllCenters(ROLES, [])).toBe(false);
  });

  it('izuzeci: GRANT daje, REVOKE oduzima i kada uloga daje (uloge ∪ GRANT − REVOKE)', () => {
    expect(grantsAllCenters(ROLES, ['FINANCE'], [{ permission_code: 'centers.manage', mode: 'GRANT' }])).toBe(true);
    expect(grantsAllCenters(ROLES, ['SUPER_ADMIN_BA'], [{ permission_code: 'centers.manage', mode: 'REVOKE' }])).toBe(false);
    expect(grantsAllCenters(ROLES, ['SUPER_ADMIN_BA'], [{ permission_code: 'users.manage', mode: 'REVOKE' }])).toBe(true);
  });

  it('kreiranje administratora: centri se NE šalju (uloga ih već daje); ostali kao pre', () => {
    const form = { ...EMPTY_NEW_USER, first_name: 'A', last_name: 'B', email: 'a@b.rs',
      role_codes: ['SUPER_ADMIN_BA'], center_codes: ['C01', 'C02'], center_write: false };
    expect(newUserPayload(form, true).center_access).toEqual([]);
    expect(newUserPayload(form, false).center_access).toEqual([
      { center_code: 'C01', can_write: false }, { center_code: 'C02', can_write: false }]);
    expect(newUserPayload(form).center_access).toHaveLength(2); // podrazumevano: nepromenjeno ponašanje
  });

  it('UI: administrator ne dobija izbor centara, već „Svi centri (administrator)"', () => {
    const html = renderToStaticMarkup(createElement(CenterAccessPicker, {
      id: 'nu-centers', label: 'Centri', catalog: CATALOG, selected: [], onChange: () => {},
      write: true, onWriteChange: () => {}, adminAll: true,
    }));
    expect(html).toContain('Svi centri (administrator)');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('Označi sve');
  });

  it('UI izmena administratora: postojeće eksplicitne dodele se pominju i ne menjaju', () => {
    const html = renderToStaticMarkup(createElement(CenterAccessPicker, {
      id: 'eu', label: 'Pristup centrima', catalog: CATALOG, selected: [{ code: 'C01', write: true }],
      onChange: () => {}, write: true, onWriteChange: () => {}, adminAll: true, perCenter: true,
      existingExplicitCount: 1,
    }));
    expect(html).toContain('Postojeće pojedinačne dodele (1 centar) se ne menjaju.');
    expect(html).not.toContain('type="checkbox"');
  });
});

// =============================================================================
describe('2. sažet prikaz centara u tabeli', () => {
  it('administrator', () => {
    expect(centersSummary(user([], true), CATALOG)).toMatchObject({ kind: 'admin', label: 'Svi centri (administrator)' });
  });

  it('Pilot Finance: svi postojeći centri, samo pregled → „Svi trenutni centri · samo pregled"', () => {
    const s = centersSummary(user(centersOf(ACTIVE.map((c) => c.code), false)), CATALOG);
    expect(s).toMatchObject({ kind: 'all_current', label: 'Svi trenutni centri · samo pregled', mode: 'read' });
    expect(s.details).toHaveLength(44);
  });

  it('svi trenutni, upis i pregled', () => {
    expect(centersSummary(user(centersOf(ACTIVE.map((c) => c.code), true)), CATALOG).label)
      .toBe('Svi trenutni centri · upis i pregled');
  });

  it('svi trenutni, mešovito: tačan opis, nikad netačan zbir', () => {
    const s = centersSummary(user(centersOf(ACTIVE.map((c) => c.code), (i) => i < 4)), CATALOG);
    expect(s.label).toBe('Svi trenutni centri · 4 upis i pregled, 40 samo pregled');
    expect(s.mode).toBe('mixed');
  });

  it('„svi trenutni" = svi AKTIVNI centri; neaktivan centar ne kvari zbir, nedostajući aktivan da', () => {
    const allButOneActive = ACTIVE.slice(1).map((c) => c.code);
    expect(centersSummary(user(centersOf(allButOneActive, false)), CATALOG))
      .toMatchObject({ kind: 'partial', label: '43 centra · samo pregled' });
    expect(centersSummary(user(centersOf([...ACTIVE.map((c) => c.code), 'C45'], false)), CATALOG).kind)
      .toBe('all_current');
  });

  it('deo centara: sažeto sa brojem i režimom; do 3 centra pojedinačno', () => {
    expect(centersSummary(user(centersOf(['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08'], false)), CATALOG).label)
      .toBe('8 centara · samo pregled');
    expect(centersSummary(user(centersOf(['C01', 'C02', 'C03', 'C04', 'C05'], (i) => i % 2 === 0)), CATALOG).label)
      .toBe('5 centara · 3 upis i pregled, 2 samo pregled');
    const few = centersSummary(user(centersOf(['C02', 'C01'], (i) => i === 0)), CATALOG);
    expect(CENTERS_LIST_LIMIT).toBe(3);
    expect(few.kind).toBe('list');
    expect(few.details).toEqual(['C01 — Centar 01 · samo pregled', 'C02 — Centar 02 · upis i pregled']);
    expect(centersSummary(user([]), CATALOG).label).toBe('—');
  });

  it('srpska množina', () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25, 44].map(centersCountLabel)).toEqual([
      '1 centar', '2 centra', '4 centra', '5 centara', '11 centara', '12 centara',
      '21 centar', '22 centra', '25 centara', '44 centra']);
  });

  it('UI: 44 centra su JEDAN red u tabeli (ne 44 reda), detalji u tooltip-u, bez obećanja budućih centara', () => {
    const html = renderToStaticMarkup(createElement(UserCentersCell, {
      user: user(centersOf(ACTIVE.map((c) => c.code), false)), catalog: CATALOG }));
    expect(html).toContain('Svi trenutni centri · samo pregled');
    expect(html).toContain('novi centri se ne dodaju sami');
    expect((html.match(/<div/g) ?? []).length).toBe(0);
    expect(html).toContain('title="C01 — Centar 01 · samo pregled\nC02');
  });

  it('UI: do 3 centra se prikazuju pojedinačno kao i pre', () => {
    const html = renderToStaticMarkup(createElement(UserCentersCell, {
      user: user(centersOf(['C01'], false)), catalog: CATALOG }));
    expect(html).toContain('C01 — Centar 01 · samo pregled');
  });
});

// =============================================================================
describe('3. Označi sve / Poništi sve', () => {
  it('„Označi sve" dodaje sve AKTIVNE centre u izabranom režimu; već izabrani zadržavaju svoj', () => {
    const current: CenterChoice[] = [{ code: 'C01', write: true }, { code: 'C45', write: false }];
    const next = bulkSelectCenters(current, CATALOG, false);
    expect(next).toHaveLength(45); // 44 aktivna + već dodeljen neaktivan C45
    expect(next.find((c) => c.code === 'C01')!.write).toBe(true);
    expect(next.find((c) => c.code === 'C02')!.write).toBe(false);
    expect(next.filter((c) => c.code === 'C01')).toHaveLength(1);
    expect(bulkSelectCenters([], CATALOG, true).every((c) => c.write)).toBe(true);
    expect(bulkSelectCenters([], CATALOG, true).some((c) => c.code === 'C45')).toBe(false);
  });

  it('„Primeni na sve izabrane" i podrazumevani režim izmene', () => {
    expect(applyModeToAll([{ code: 'C01', write: true }, { code: 'C02', write: false }], false)
      .every((c) => !c.write)).toBe(true);
    expect(defaultBulkWrite([])).toBe(true);
    expect(defaultBulkWrite([{ code: 'C01', write: false }])).toBe(false); // read-only korisnik ostaje read-only
    expect(defaultBulkWrite([{ code: 'C01', write: false }, { code: 'C02', write: true }])).toBe(true);
  });

  it('UI kreiranje: „Označi sve (44)" i „Poništi sve" su vidljive akcije; režim je zajednički', () => {
    const html = renderToStaticMarkup(createElement(CenterAccessPicker, {
      id: 'nu-centers', label: 'Centri', catalog: CATALOG, selected: [{ code: 'C01', write: false }],
      onChange: () => {}, write: false, onWriteChange: () => {}, adminAll: false,
    }));
    expect(html).toContain('Označi sve (44)');
    expect(html).toContain('Poništi sve');
    expect(html).toContain('Samo pregled');
    expect(html).not.toContain('Primeni na sve izabrane'); // samo u izmeni
    expect(html).toContain('trenutne</em> centre');
  });

  it('UI izmena: režim po centru + „Primeni na sve izabrane"', () => {
    const html = renderToStaticMarkup(createElement(CenterAccessPicker, {
      id: 'eu', label: 'Pristup centrima', catalog: CATALOG,
      selected: [{ code: 'C02', write: false }, { code: 'C01', write: true }],
      onChange: () => {}, write: true, onWriteChange: () => {}, adminAll: false, perCenter: true,
    }));
    expect(html).toContain('Primeni na sve izabrane');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html.indexOf('C01 — Centar 01')).toBeLessThan(html.indexOf('C02 — Centar 02')); // abecedno po nazivu
  });
});

// =============================================================================
describe('4. tabela i granice izmene', () => {
  it('ćelija akcija nije display:flex (ostaje table-cell); kolona centara je sažeta', () => {
    const screen = read('routes/AdminUsers.tsx');
    expect(screen).not.toContain('<td className="row-actions"');
    expect(screen).toContain('<td className="users-actions-cell">');
    expect(screen).toContain('<UserCentersCell user={u} catalog={list.centers} />');
    const css = read('styles.css');
    expect(css).toMatch(/\.users-table th, \.users-table td \{ vertical-align: top; \}/);
    expect(css).toMatch(/\.users-table td\.users-actions-cell \{[^}]*text-align: right/);
  });

  it('zajednički sort iz 16bbf2c, bez sopstvenog pravila', () => {
    const src = read('components/UserCenters.tsx');
    expect(src).toMatch(/from '\.\.\/lib\/format\/sort'/);
    expect(src).not.toMatch(/localeCompare|Intl\.Collator/);
  });

  it('frontend-only: nema novih API poziva ni „all centers" koncepta u payload-u', () => {
    const src = read('components/UserCenters.tsx') + read('features/admin/users.ts');
    expect(src).not.toMatch(/all_centers\s*:/); // ne šalje se, samo se čita sa servera
    expect(src).not.toMatch(/\.rpc\(|functions\.invoke|fetch\(/);
  });
});
