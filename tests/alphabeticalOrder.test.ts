import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CenterMultiSelect, visibleOptions } from '../src/components/CenterMultiSelect';
import { centerLabel, compareText, sortByLabel, sortCenters } from '../src/lib/format/sort';

/** Opšte UX pravilo: opcije izbora abecedno po korisnički vidljivom nazivu (A–Ž). */
const CENTERS = [
  { id: '1', code: 'B6', name: 'Rakovica' },
  { id: '2', code: 'BZ', name: 'Bežanija' },
  { id: '3', code: 'ZM', name: 'Zemun' },
  { id: '4', code: 'CU', name: 'Čukarica' },
  { id: '5', code: 'AV', name: 'Avala' },
  { id: '6', code: 'SB', name: 'Šabac' },
];

describe('srpska latinica, A–Ž', () => {
  it('Č i Ć posle C, Đ posle D, Š posle S, Ž posle Z; bez razlike velika/mala slova', () => {
    const words = ['Žarkovo', 'cerak', 'Čukarica', 'Ćuprija', 'Đurđevo', 'Dorćol', 'Šabac', 'Sombor', 'Zemun', 'avala'];
    expect([...words].sort(compareText)).toEqual(
      ['avala', 'cerak', 'Čukarica', 'Ćuprija', 'Dorćol', 'Đurđevo', 'Sombor', 'Šabac', 'Zemun', 'Žarkovo']);
  });
  it('brojevi prirodno: B2 pre B10', () => {
    expect(['B10', 'B2', 'B1'].sort(compareText)).toEqual(['B1', 'B2', 'B10']);
  });
});

describe('centri: po NAZIVU, ne po šifri', () => {
  it('sortCenters ređa po nazivu A–Ž', () => {
    expect(sortCenters(CENTERS).map((c) => c.name)).toEqual(['Avala', 'Bežanija', 'Čukarica', 'Rakovica', 'Šabac', 'Zemun']);
  });
  it('isti naziv → po šifri; centar bez naziva po šifri', () => {
    expect(sortCenters([{ code: 'B2', name: 'Beograd' }, { code: 'B1', name: 'Beograd' }]).map((c) => c.code)).toEqual(['B1', 'B2']);
    expect(sortCenters([{ code: 'ZZ' }, { code: 'AA', name: 'Mladenovac' }]).map((c) => c.code)).toEqual(['AA', 'ZZ']);
  });
  it('prikaz u jednom redu: „B6 — Rakovica"', () => {
    expect(centerLabel({ code: 'B6', name: 'Rakovica' })).toBe('B6 — Rakovica');
    expect(centerLabel({ code: 'B6' })).toBe('B6');
  });
  it('ne menja ulazni niz (samo prezentacija)', () => {
    const input = [...CENTERS];
    sortCenters(input);
    expect(input.map((c) => c.code)).toEqual(CENTERS.map((c) => c.code));
  });
});

describe('izbor centara (multi-select)', () => {
  it('opcije abecedno po nazivu; rezultati pretrage ostaju abecedni', () => {
    expect(visibleOptions(CENTERS, '').map((c) => c.code)).toEqual(['AV', 'BZ', 'CU', 'B6', 'SB', 'ZM']);
    // „a" se pojavljuje u više naziva — redosled i dalje A–Ž
    expect(visibleOptions(CENTERS, 'a').map((c) => c.name)).toEqual(['Avala', 'Bežanija', 'Čukarica', 'Rakovica', 'Šabac']);
  });
  it('izabrani centri (oznake) su abecedni po nazivu, bez obzira na redosled izbora', () => {
    const html = renderToStaticMarkup(createElement(CenterMultiSelect, {
      centers: CENTERS, value: ['3', '1', '2'], onChange: () => {},
    }));
    const order = ['Ukloni BZ', 'Ukloni B6', 'Ukloni ZM'].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // Bežanija, Rakovica, Zemun
  });
  it('„Svi centri" ostaje na vrhu kada ništa nije izabrano', () => {
    expect(renderToStaticMarkup(createElement(CenterMultiSelect, { centers: CENTERS, value: [], onChange: () => {} })))
      .toContain('Svi centri');
  });
});

describe('opšte: druge liste izbora', () => {
  it('sortByLabel: kopija, stabilno, prazni nazivi na kraj', () => {
    const rows = [{ n: 'Marković Marko' }, { n: '' }, { n: 'Ilić Ana' }, { n: 'Đorđević Ana' }];
    expect(sortByLabel(rows, (r) => r.n).map((r) => r.n)).toEqual(['Đorđević Ana', 'Ilić Ana', 'Marković Marko', '']);
    expect(rows[0].n).toBe('Marković Marko');
  });

  it('svaka lista centara u aplikaciji je sortirana i prikazuje „šifra — naziv"', () => {
    const root = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p);
    });
    walk(root);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/<option key=\{c\.(id|center_id)\}/.test(line) && !line.includes('centerLabel(c)')) {
          offenders.push(`${f.split('/src/')[1]}:${i + 1}`);
        }
      });
      // svaka lista centara za IZBOR (option ili checkbox) mora proći kroz sortCenters.
      // Tabele/prikazi sa poslovnim redosledom (npr. Admin „Redosled") nisu izbor.
      for (const m of src.matchAll(/\{([^{}\n]*centers[^{}\n]*)\.map\(\(c\) =>/g)) {
        const after = src.slice(m.index ?? 0, (m.index ?? 0) + 700);
        const isChoice = /<option\b/.test(after.slice(0, 250)) || /type="checkbox"/.test(after);
        if (isChoice && !m[1].includes('sortCenters(')) offenders.push(`${f.split('/src/')[1]}: ${m[1].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('prevoznici, odgovorne osobe, korisnici, zaposleni, vrste i kontrole su sortirani po nazivu', () => {
    const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
    const admin = read('routes/Admin.tsx');
    for (const k of ['cfg.transport_providers', 'cfg.responsible_persons', 'cfg.payment_types',
      'cfg.payment_behaviors', 'cfg.attendance_behaviors', 'cfg.control_rules']) {
      expect(admin, k).toMatch(new RegExp(`sortByLabel\\(${k.replace('.', '\\.')}`));
    }
    // Korisnici: pregled u Administraciji je zamenjen modulom Administracija → Korisnici
    // (grupa „Korisnici i zaposleni"); isto pravilo, abecedno po imenu, važi tamo.
    expect(read('features/admin/users.ts')).toContain('sortByLabel(users, (u) => u.full_name || u.email)');
    expect(read('routes/MyAdjustments.tsx')).toContain('sortByLabel(reference?.employees');
    expect(read('routes/AdminPayouts.tsx')).toContain('sortByLabel(ctx.types');
    expect(read('components/NewEmployeeForm.tsx')).toContain('sortByLabel(providers');
  });
});
