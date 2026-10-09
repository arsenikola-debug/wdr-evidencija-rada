import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Prava pozivaoca se zadaju po testu; ostatak useAuth-a nije potreban za render.
const auth = vi.hoisted(() => ({ perms: new Set<string>() }));
vi.mock('../src/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    can: (p: string) => auth.perms.has(p),
    api: { getAdminConfig: () => new Promise(() => {}), adminReadiness: () => new Promise(() => {}) },
    session: { profile_id: 'p', full_name: 'Test', email: 't@wdr.rs', roles: [], permissions: [...auth.perms], centers: [] },
    loading: false,
  }),
}));

import {
  ADMIN_ENTRY_PERMISSIONS,
  adminSectionHref,
  canEnterAdmin,
  visibleAdminGroups,
} from '../src/features/admin/adminNavigation';
import { AdminEntryGate } from '../src/components/AdminNavigation';
import { NAV_GROUPS, navItemVisible } from '../src/components/navConfig';
import { resolveProfile } from '../src/features/auth/profile';
import { Admin } from '../src/routes/Admin';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '..', 'src', rel), 'utf8');
const canOnly = (...p: string[]) => (x: string) => p.includes(x);

/** /administracija kao u App.tsx: AdminEntryGate → Admin (RequireAuth je ispred, sesija postoji). */
function renderAdmin(perms: string[], url = '/administracija'): string {
  auth.perms = new Set(perms);
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] },
    createElement(AdminEntryGate, null, createElement(Admin))));
}

// =============================================================================
describe('ulaz u Administraciju: bar jedan administrativni modul', () => {
  it('ulazna prava su tačno prava modula (izvedeno iz grupa, bez novih prava)', () => {
    expect(ADMIN_ENTRY_PERMISSIONS).toEqual(['centers.manage', 'employee.view', 'payout.cutover.manage', 'users.manage']);
  });

  it('users.manage BEZ centers.manage: otvara Administraciju i vidi Korisnike', () => {
    const html = renderAdmin(['users.manage']);
    expect(html).toContain('<h1>Administracija</h1>');
    expect(html).toContain('href="/administracija/korisnici"');
    expect(html).toContain('Korisnici i zaposleni');
  });

  it('…ali NE vidi Centre ni ostale sekcije i grupe za koje nema pravo', () => {
    const html = renderAdmin(['users.manage']);
    expect(html).not.toContain('href="/administracija?modul=centri"');
    expect(html).not.toContain('?modul=');
    for (const g of ['Organizacija rada', 'Obračun', 'Prevoz', 'Sistem']) expect(html).not.toContain(`>${g}</h2>`);
    expect(html).not.toContain('Uvoz zaposlenih');
    expect(html).not.toContain('Tarife dodatnih isplata');
    expect(visibleAdminGroups(canOnly('users.manage')).flatMap((g) => g.modules.map((m) => m.label)))
      .toEqual(['Korisnici']);
  });

  it('…i deep link na sekciju Centri dobija „Nemate pravo", bez učitavanja konfiguracije', () => {
    const html = renderAdmin(['users.manage'], '/administracija?modul=centri');
    expect(html).toContain('Nemate pravo pristupa ovoj sekciji.');
    expect(html).toContain('Potrebna permisija: centers.manage');
    expect(html).not.toContain('Čitanje konfiguracije');
    expect(html).toContain('href="/administracija">Administracija</a>');
  });

  it('korisnik bez ijednog administrativnog prava NE dobija Administraciju', () => {
    for (const perms of [[], ['entry.view', 'period.submit'], ['finance.approve', 'finance.queue.view'], ['roles.manage']]) {
      const html = renderAdmin(perms);
      expect(html, perms.join(',')).toContain('Nemate pravo pristupa ovoj stranici.');
      expect(html).not.toContain('<h1>Administracija</h1>');
      expect(html).not.toContain('href="/administracija/korisnici"');
      expect(canEnterAdmin(canOnly(...perms))).toBe(false);
    }
  });

  it('centers.manage: sekcija se otvara (učitava konfiguraciju) kao i ranije', () => {
    const html = renderAdmin(['centers.manage'], '/administracija?modul=centri');
    expect(html).toContain('Čitanje konfiguracije');
    expect(html).not.toContain('Nemate pravo');
  });

  it('employee.view (npr. operater): landing samo sa „Zaposleni" — pravo koje već ima, ništa više', () => {
    const html = renderAdmin(['employee.view', 'entry.view']);
    expect(html).toContain('href="/zaposleni"');
    expect(html).not.toContain('?modul=');
    expect(html).not.toContain('href="/administracija/korisnici"');
  });
});

// =============================================================================
describe('direktne rute zadržavaju svoje RequireAuth uslove', () => {
  it('Korisnici, Zaposleni, Uvoz zaposlenih, Tarife dodatnih isplata', () => {
    const app = read('App.tsx').replace(/\s+/g, ' ');
    const routes: Array<[string, string]> = [
      ['/administracija/korisnici', 'users.manage'],
      ['/zaposleni', 'employee.view'],
      ['/administracija/uvoz-zaposlenih', 'centers.manage'],
      ['/administracija/dodatne-isplate', 'payout.cutover.manage'],
    ];
    for (const [path, perm] of routes) {
      expect(app, path).toMatch(new RegExp(`path="${path.replace(/\//g, '\\/')}" element=\\{ ?<RequireAuth permission="${perm.replace('.', '\\.')}">`));
    }
  });
});

// =============================================================================
describe('bočni meni: stavka „Administracija" po istom pravilu', () => {
  const item = NAV_GROUPS.find((g) => g.title === 'Administracija')!.items.find((i) => i.to === '/administracija')!;
  it('vidljiva uz bar jedno ulazno pravo; ostale stavke nepromenjene', () => {
    const admin = resolveProfile(['SUPER_ADMIN_BA']);
    const operator = resolveProfile(['DATA_ENTRY_OPERATOR']);
    expect(item.permission).toBeUndefined();
    expect(item.anyPermission).toEqual(ADMIN_ENTRY_PERMISSIONS);
    expect(item.profiles).toEqual(['admin']);
    expect(navItemVisible(item, admin, canOnly('users.manage'))).toBe(true);
    expect(navItemVisible(item, admin, canOnly('centers.manage'))).toBe(true);
    expect(navItemVisible(item, admin, canOnly('finance.approve'))).toBe(false);
    expect(navItemVisible(item, operator, canOnly('employee.view'))).toBe(false); // profil i dalje važi
    const korisnici = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === '/administracija/korisnici')!;
    expect(navItemVisible(korisnici, admin, canOnly('centers.manage'))).toBe(false);
    expect(navItemVisible(korisnici, admin, canOnly('users.manage'))).toBe(true);
  });

  it('Layout koristi isto pravilo (navItemVisible)', () => {
    expect(read('components/Layout.tsx')).toContain('(i) => navItemVisible(i, profile, can)');
  });
});

// =============================================================================
describe('postojeći direktni linkovi (Home) vode na odgovarajuću sekciju, ne na landing', () => {
  const home = read('routes/Home.tsx');
  const adminHome = home.slice(home.indexOf('function AdminHome() {'), home.indexOf('function BaHome() {'));

  it('Aktivni centri → Centri; propusti → Radni kalendar / Pravila naknada / Pravila prevoza', () => {
    expect(adminSectionHref('centri')).toBe('/administracija?modul=centri');
    expect(adminHome).toContain("to={adminSectionHref('centri')}");
    expect(adminHome).toContain("to: adminSectionHref('kalendar')");
    expect((adminHome.match(/to: adminSectionHref\('naknade'\)/g) ?? []).length).toBe(2);
    expect(adminHome).toContain("to: adminSectionHref('prevoz')");
  });

  it('nalozi (korisnici, bez uloge, bez centra, „Dodeli…") → Korisnici; bez users.manage → Centri kao ranije', () => {
    expect(adminHome).toContain("const usersHref = can('users.manage') ? '/administracija/korisnici' : adminSectionHref('centri');");
    expect((adminHome.match(/to=\{usersHref\}/g) ?? []).length).toBe(5);
  });

  it('jedini preostali link na landing je opšte dugme „Otvori administraciju"', () => {
    const plain = [...adminHome.matchAll(/to(?:=|: )["']\/administracija["']/g)];
    expect(plain).toHaveLength(1);
    expect(adminHome).toMatch(/to="\/administracija">\s*Otvori administraciju/);
  });
});
