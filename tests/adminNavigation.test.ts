import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_GROUPS,
  ADMIN_PAGE_PERMISSION,
  ADMIN_SECTION_KEYS,
  groupOfSection,
  moduleHref,
  parseSectionParam,
  visibleAdminGroups,
} from '../src/features/admin/adminNavigation';
import { AdminLanding, AdminSectionNav } from '../src/components/AdminNavigation';
import { NAV_GROUPS } from '../src/components/navConfig';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, '..', 'src', rel), 'utf8');
const canAll = () => true;
const canOnly = (...perms: string[]) => (p: string) => perms.includes(p);
const labels = (groups = ADMIN_GROUPS) => groups.map((g) => [g.title, g.modules.map((m) => m.label)]);

// =============================================================================
describe('grupe i redosled', () => {
  it('5 grupa, traženim redom; Korisnici/Zaposleni/Uvoz zaposlenih zajedno i prvi', () => {
    expect(labels()).toEqual([
      ['Korisnici i zaposleni', ['Korisnici', 'Zaposleni', 'Uvoz zaposlenih']],
      ['Organizacija rada', ['Centri', 'Smene', 'Statusi evidencije', 'Radni kalendar']],
      ['Obračun', ['Vrste isplata', 'Tarife dodatnih isplata', 'Pravila naknada', 'Cene po stopu']],
      ['Prevoz', ['Prevoznici i odgovorna lica', 'Pravila prevoza']],
      ['Sistem', ['Kontrolna pravila', 'Spremnost sistema']],
    ]);
  });

  it('„Korisnici" ostaje naziv (modul dodeljuje postojeće uloge, ne upravlja ulogama)', () => {
    const all = ADMIN_GROUPS.flatMap((g) => g.modules.map((m) => m.label));
    expect(all).toContain('Korisnici');
    expect(all).not.toContain('Korisnici i uloge');
  });

  it('svaka grupa i svaki modul imaju opis', () => {
    for (const g of ADMIN_GROUPS) {
      expect(g.description.length, g.key).toBeGreaterThan(10);
      for (const m of g.modules) expect(m.description.length, m.key).toBeGreaterThan(10);
    }
  });
});

// =============================================================================
describe('svi postojeći moduli ostaju dostupni (proverava izvorni kod)', () => {
  it('svaka sekcija stranice Administracija ima mesto u grupama — i obrnuto', () => {
    const admin = read('routes/Admin.tsx');
    const inPage = [...admin.matchAll(/\{tab === '([a-z]+)' && \(/g)].map((m) => m[1]).sort();
    expect(inPage).toEqual([...ADMIN_SECTION_KEYS].sort());
    expect(inPage).toHaveLength(11);
    expect(new Set(ADMIN_SECTION_KEYS).size).toBe(ADMIN_SECTION_KEYS.length);
  });

  it('svaka ruta u grupama postoji u App.tsx sa ISTIM pravom kao njen RequireAuth', () => {
    const app = read('App.tsx').replace(/\s+/g, ' ');
    for (const m of ADMIN_GROUPS.flatMap((g) => g.modules)) {
      if (m.kind !== 'route') continue;
      const re = new RegExp(`path="${m.to.replace(/\//g, '\\/')}" element=\\{ ?<RequireAuth permission="([^"]+)"`);
      const hit = app.match(re);
      expect(hit, m.to).not.toBeNull();
      expect(hit![1], m.to).toBe(m.permission);
    }
    // landing: sesija (RequireAuth bez prava) + bar jedan modul (AdminEntryGate);
    // sekcije stranice i dalje traže centers.manage
    expect(app).toMatch(/path="\/administracija" element=\{ ?(\/\/[^\n]*?)?<RequireAuth> ?<AdminEntryGate> ?<Admin \/>/);
    expect(app).not.toMatch(/path="\/administracija" element=\{ ?<RequireAuth permission="centers\.manage">/);
    expect(ADMIN_PAGE_PERMISSION).toBe('centers.manage');
  });

  it('svi administrativni linkovi iz bočne navigacije su i u grupama (ništa ne nestaje)', () => {
    const sidebar = NAV_GROUPS.find((g) => g.title === 'Administracija')!.items
      .map((i) => i.to).filter((to) => to !== '/administracija');
    const inGroups = ADMIN_GROUPS.flatMap((g) => g.modules).map(moduleHref);
    for (const to of sidebar) expect(inGroups, to).toContain(to);
  });
});

// =============================================================================
describe('vidljivost = postojeća prava (bez promene semantike)', () => {
  it('Super admin vidi svih 5 grupa i svih 15 modula (11 sekcija + 4 rute)', () => {
    const v = visibleAdminGroups(canAll);
    expect(v).toHaveLength(5);
    expect(v.flatMap((g) => g.modules)).toHaveLength(15);
  });

  it('samo centers.manage: sekcije stranice + Uvoz zaposlenih; bez Korisnika, Zaposlenih i Tarifa', () => {
    const v = visibleAdminGroups(canOnly('centers.manage'));
    expect(labels(v)).toEqual([
      ['Korisnici i zaposleni', ['Uvoz zaposlenih']],
      ['Organizacija rada', ['Centri', 'Smene', 'Statusi evidencije', 'Radni kalendar']],
      ['Obračun', ['Vrste isplata', 'Pravila naknada', 'Cene po stopu']],
      ['Prevoz', ['Prevoznici i odgovorna lica', 'Pravila prevoza']],
      ['Sistem', ['Kontrolna pravila', 'Spremnost sistema']],
    ]);
  });

  it('modul se ne prikazuje samo zato što grupa postoji; prazna grupa se ne prikazuje', () => {
    const v = visibleAdminGroups(canOnly('users.manage', 'employee.view'));
    expect(labels(v)).toEqual([['Korisnici i zaposleni', ['Korisnici', 'Zaposleni']]]);
    expect(visibleAdminGroups(canOnly())).toEqual([]);
    expect(labels(visibleAdminGroups(canOnly('centers.manage', 'payout.cutover.manage')))[2][1])
      .toContain('Tarife dodatnih isplata');
  });
});

// =============================================================================
describe('deep linkovi', () => {
  it('sekcije: /administracija?modul=<ključ>; rute ostaju iste', () => {
    const byKey = Object.fromEntries(ADMIN_GROUPS.flatMap((g) => g.modules).map((m) => [m.key, moduleHref(m)]));
    expect(byKey.smene).toBe('/administracija?modul=smene');
    expect(byKey.korisnici).toBe('/administracija/korisnici');
    expect(byKey.zaposleni).toBe('/zaposleni');
    expect(byKey['uvoz-zaposlenih']).toBe('/administracija/uvoz-zaposlenih');
    expect(byKey['tarife-dodatnih-isplata']).toBe('/administracija/dodatne-isplate');
  });

  it('parametar: poznata sekcija ili landing; nepoznato ne ruši stranicu', () => {
    expect(parseSectionParam('kalendar')).toBe('kalendar');
    expect(parseSectionParam(null)).toBeNull();
    expect(parseSectionParam('nepostojeci')).toBeNull();
    expect(parseSectionParam('korisnici')).toBeNull(); // stari putokaz više nije sekcija
    expect(groupOfSection('stopovi').title).toBe('Obračun');
    expect(groupOfSection('spremnost').title).toBe('Sistem');
  });
});

// =============================================================================
describe('UI', () => {
  function render<P extends object>(el: FunctionComponent<P>, props: P, url = '/administracija'): string {
    return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, createElement(el, props)));
  }

  it('landing: 5 kartica sa naslovom, opisom i linkovima modula (bez horizontalne trake tabova)', () => {
    const html = render(AdminLanding, { groups: visibleAdminGroups(canAll) });
    expect((html.match(/class="admin-group-card"/g) ?? [])).toHaveLength(5);
    for (const t of ['Korisnici i zaposleni', 'Organizacija rada', 'Obračun', 'Prevoz', 'Sistem']) {
      expect(html).toContain(`>${t}</h2>`);
    }
    expect(html).toContain('href="/administracija/korisnici"');
    expect(html).toContain('href="/administracija?modul=centri"');
    expect(html).not.toContain('role="tablist"');
    expect(html.indexOf('Korisnici i zaposleni')).toBeLessThan(html.indexOf('Organizacija rada'));
  });

  it('landing poštuje prava: bez users.manage nema linka na Korisnike', () => {
    const html = render(AdminLanding, { groups: visibleAdminGroups(canOnly('centers.manage')) });
    expect(html).not.toContain('href="/administracija/korisnici"');
    expect(html).toContain('href="/administracija/uvoz-zaposlenih"');
  });

  it('unutar grupe: putanja nazad + sekundarna navigacija, aktivni modul označen', () => {
    const group = visibleAdminGroups(canAll).find((g) => g.key === 'obracun')!;
    const html = render(AdminSectionNav, { group, active: 'naknade' }, '/administracija?modul=naknade');
    expect(html).toContain('href="/administracija">Administracija</a>');
    expect(html).toContain('Obračun');
    expect(html).toMatch(/aria-current="page"[^>]*>Pravila naknada</);
    expect(html).toContain('href="/administracija/dodatne-isplate"');
    expect((html.match(/class="btn btn-(primary|quiet)"/g) ?? [])).toHaveLength(4);
  });

  it('Admin.tsx: nema više trake od 12 tabova; grupe se filtriraju pravima pozivaoca', () => {
    const admin = read('routes/Admin.tsx');
    expect(admin).not.toMatch(/const TABS\b/);
    expect(admin).not.toContain('role="tablist"');
    expect(admin).toContain('visibleAdminGroups(can)');
    expect(admin).toContain("parseSectionParam(params.get('modul'))");
    const css = read('styles.css');
    expect(css).toMatch(/\.admin-groups \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 300px\), 1fr\)\)/);
    expect(css).toMatch(/\.admin-subnav \{[^}]*flex-wrap: wrap/);
  });
});
