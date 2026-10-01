import { describe, expect, it } from 'vitest';
import {
  classifyNameMatch,
  levenshtein,
  normalizePersonName,
  personNameKey,
  trigramSimilarity,
} from '../src/features/employees/nameMatch';
import { MockWdrApi } from '../src/lib/api/mockApi';

/**
 * Redizajn §12 — zaštita od duplikata zaposlenih. Serversko pravilo je u 0057
 * (pgTAP 125); ovo je ogledalo koje koristi mock, pa mora da daje iste odluke.
 */
describe('normalizacija imena', () => {
  it('uklanja srpske dijakritike, interpunkciju i višak razmaka', () => {
    expect(normalizePersonName('  Đorđević   Džemal ')).toBe('djordjevic dzemal');
    expect(normalizePersonName('Čolić-Šćekić, Žaklina')).toBe('colic scekic zaklina');
  });

  it('ključ ne zavisi od redosleda imena i prezimena', () => {
    expect(personNameKey('Nikola Arsenović')).toBe(personNameKey('ARSENOVIC nikola'));
  });

  it('levenshtein i trigram daju očekivane vrednosti', () => {
    expect(levenshtein('arsenovic', 'asenovic')).toBe(1);
    expect(trigramSimilarity('ana ilic', 'ana ilic')).toBe(1);
    expect(trigramSimilarity('ana', 'zoran')).toBeLessThan(0.3);
  });
});

describe('classifyNameMatch', () => {
  const m = (candidate: string, existing: string, code?: string, existingCode?: string) =>
    classifyNameMatch({
      candidateFullName: candidate,
      existingFullName: existing,
      candidateCode: code,
      existingCode,
    })?.reason ?? null;

  it('primer iz zahteva: Nikola Asenovic → upozorenje na Nikola Arsenović', () => {
    expect(m('Asenovic Nikola', 'Arsenović Nikola')).toBe('SIMILAR_NAME');
  });

  it('isto ime bez dijakritika je EXACT_NAME (i dalje samo upozorenje)', () => {
    expect(m('Petrovic Ana', 'Petrović Ana')).toBe('EXACT_NAME');
    expect(m('Djordjevic Marko', 'Đorđević Marko')).toBe('EXACT_NAME');
    expect(m('Nikola Arsenović', 'Arsenović Nikola')).toBe('EXACT_NAME');
  });

  it('ista šifra ima prioritet nad imenom', () => {
    expect(m('Neko Drugi', 'Marković Marko', 'E-001', 'E-001')).toBe('EXACT_CODE');
  });

  it('potpuno drugo ime ne daje upozorenje', () => {
    expect(m('Stanković Zoran', 'Marković Marko')).toBeNull();
  });
});

describe('MockWdrApi.checkEmployeeDuplicates', () => {
  it('upozorava na slično ime i ne kreira ni ne spaja ništa', async () => {
    const api = new MockWdrApi({ role: 'admin' });
    await api.signIn('admin@wdr.local', 'mock1234');
    const before = (await api.getEmployees(null, null, null, 200, 0)).items.length;
    const r = await api.checkEmployeeDuplicates(null, 'Marko', 'Markovic');
    expect(r.exact_name.map((x) => x.full_name)).toContain('Marković Marko');
    const after = (await api.getEmployees(null, null, null, 200, 0)).items.length;
    expect(after).toBe(before);
  });
});
