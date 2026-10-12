import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Sesija za render pravog Layout-a (efekti se u SSR-u ne izvršavaju — bez API poziva).
const auth = vi.hoisted(() => ({ perms: new Set<string>(), roles: ['SUPER_ADMIN_BA'] as string[] }));
vi.mock('../src/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { profile_id: 'p', full_name: 'Test', email: 't@wdr.rs', roles: auth.roles,
               permissions: [...auth.perms], centers: [] },
    signOut: async () => {}, apiKind: 'mock', demoRates: false, loading: false,
    can: (p: string) => auth.perms.has(p),
    api: {},
  }),
}));

import { Layout } from '../src/components/Layout';
import {
  ADMIN_ROUTE_MODULE_PATHS,
  NAV_GROUPS,
  navItemVisible,
  pageTitle,
} from '../src/components/navConfig';
import { ADMIN_ENTRY_PERMISSIONS, ADMIN_GROUPS, visibleAdminGroups } from '../src/features/admin/adminNavigation';
import { resolveProfile } from '../src/features/auth/profile';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '..', 'src', rel), 'utf8');
const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
const adminItem = all.find((i) => i.to === '/administracija')!;

/** Stavke koje su do a5ebd12 bile u meniju (definicije iz a5ebd12). */
const FORMER = [
  { to: '/administracija/korisnici', label: 'Korisnici', permission: 'users.manage' },
  { to: '/zaposleni', label: 'Zaposleni', permission: 'employee.view' },
  { to: '/administracija/uvoz-zaposlenih', label: 'Uvoz zaposlenih', permission: 'centers.manage' },
  { to: '/administracija/dodatne-isplate', label: 'Tarife dodatnih isplata', permission: 'payout.cutover.manage' },
] as const;

function renderLayout(path: string, perms = ADMIN_ENTRY_PERMISSIONS as readonly string[], roles = ['SUPER_ADMIN_BA']) {
  auth.perms = new Set(perms);
  auth.roles = roles;
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Layout)));
}
/** Atribut class linka u meniju za datu rutu (ili null ako link nije prikazan). */
function linkClass(html: string, to: string): string | null {
  const nav = html.slice(html.indexOf('aria-label="Glavna navigacija"'));
  const m = nav.match(new RegExp(`<a [^>]*href="${to.replace(/[?/]/g, (c) => `\\${c}`)}"[^>]*>`));
  if (!m) return null;
  return m[0].match(/class="([^"]*)"/)?.[1] ?? '';
}

// =============================================================================
describe('meni: u grupi Administracija ostaje samo „Administracija"', () => {
  it('jedina stavka grupe je /administracija; četiri modula nisu ni u jednoj grupi', () => {
    expect(NAV_GROUPS.find((g) => g.title === 'Administracija')!.items.map((i) => [i.to, i.label]))
      .toEqual([['/administracija', 'Administracija']]);
    for (const f of FORMER) expect(all.some((i) => i.to === f.to), f.to).toBe(false);
  });

  it('pravilo vidljivosti stavke „Administracija" je nepromenjeno (anyPermission + profil admin)', () => {
    expect(adminItem.permission).toBeUndefined();
    expect(adminItem.anyPermission).toEqual(ADMIN_ENTRY_PERMISSIONS);
    expect(adminItem.profiles).toEqual(['admin']);
    expect(adminItem.end).toBe(true);
  });

  it('niko ne gubi ulaz u meniju: kome je bila vidljiva bilo koja uklonjena stavka, vidljiva mu je „Administracija"', () => {
    const perms = ['users.manage', 'employee.view', 'centers.manage', 'payout.cutover.manage', 'entry.view'];
    const profiles = [['SUPER_ADMIN_BA'], ['DATA_ENTRY_OPERATOR'], ['FINANCE'], ['NEPOZNATA_ULOGA']].map(resolveProfile);
    let checked = 0;
    for (let mask = 0; mask < 1 << perms.length; mask += 1) {
      const have = perms.filter((_, i) => mask & (1 << i));
      const can = (p: string) => have.includes(p);
      for (const profile of profiles) {
        const formerVisible = FORMER.some((f) => navItemVisible({ permission: f.permission, profiles: ['admin'] }, profile, can));
        if (formerVisible) {
          expect(navItemVisible(adminItem, profile, can), `${have} / ${[...profile.profiles]}`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

// =============================================================================
describe('dostupnost modula je nepromenjena', () => {
  it('svaki uklonjeni modul je na landingu sa ISTIM pravom', () => {
    const routeModules = ADMIN_GROUPS.flatMap((g) => g.modules).filter((m) => m.kind === 'route');
    for (const f of FORMER) {
      const m = routeModules.find((x) => x.kind === 'route' && x.to === f.to);
      expect(m, f.to).toBeDefined();
      expect(m!.kind === 'route' && m!.permission, f.to).toBe(f.permission);
      expect(m!.label).toBe(f.label);
      expect(visibleAdminGroups((p) => p === f.permission).flatMap((g) => g.modules).some((x) => x.key === m!.key)).toBe(true);
    }
  });

  it('rute i RequireAuth uslovi su isti (direktni URL radi kao i ranije)', () => {
    const app = read('App.tsx').replace(/\s+/g, ' ');
    for (const f of FORMER) {
      expect(app, f.to).toMatch(new RegExp(`path="${f.to.replace(/\//g, '\\/')}" element=\\{ ?<RequireAuth permission="${f.permission.replace('.', '\\.')}">`));
    }
  });
});

// =============================================================================
describe('aktivno stanje i naslov (pravi Layout)', () => {
  it('„Administracija" je aktivna na landingu, u sekcijama i na pod-rutama modula', () => {
    for (const path of ['/administracija', '/administracija?modul=centri', '/administracija/korisnici',
      '/administracija/uvoz-zaposlenih', '/administracija/dodatne-isplate', '/zaposleni', '/zaposleni/novi',
      '/zaposleni/123']) {
      expect(linkClass(renderLayout(path), '/administracija'), path).toBe('active');
    }
  });

  it('ali NE na „Izveštaji isplata" (/administracija/izvestaji pripada Analitici) i ne na drugim stranama', () => {
    const html = renderLayout('/administracija/izvestaji', [...ADMIN_ENTRY_PERMISSIONS, 'analytics.ba.view']);
    expect(linkClass(html, '/administracija')).toBe('');
    expect(linkClass(html, '/administracija/izvestaji')).toBe('active');
    expect(linkClass(renderLayout('/analitika/zaposleni', [...ADMIN_ENTRY_PERMISSIONS, 'analytics.ba.view']),
      '/administracija')).toBe('');
    expect(ADMIN_ROUTE_MODULE_PATHS).not.toContain('/administracija/izvestaji');
  });

  it('meni ne prikazuje uklonjene stavke ni Super adminu', () => {
    const html = renderLayout('/administracija');
    expect(linkClass(html, '/administracija')).not.toBeNull();
    for (const f of FORMER) expect(linkClass(html, f.to), f.to).toBeNull();
  });

  it('korisnik bez administrativnog prava ne vidi stavku „Administracija"', () => {
    expect(linkClass(renderLayout('/', ['entry.view'], ['DATA_ENTRY_OPERATOR']), '/administracija')).toBeNull();
  });

  it('naslov u gornjoj traci ostaje isti kao pre uklanjanja stavki', () => {
    expect(pageTitle('/administracija')).toBe('Administracija');
    expect(pageTitle('/administracija/korisnici')).toBe('Korisnici');
    expect(pageTitle('/zaposleni')).toBe('Zaposleni');
    expect(pageTitle('/zaposleni/novi')).toBe('Zaposleni');
    expect(pageTitle('/administracija/uvoz-zaposlenih')).toBe('Uvoz zaposlenih');
    expect(pageTitle('/administracija/dodatne-isplate')).toBe('Tarife dodatnih isplata');
    expect(pageTitle('/administracija/izvestaji')).toBe('Izveštaji isplata');
    expect(pageTitle('/')).not.toBe('WDR');
    expect(read('components/Layout.tsx')).toContain('useMemo(() => pageTitle(pathname), [pathname])');
  });
});
