import { describe, expect, it } from 'vitest';
import { effectivePermissions, roleCodes } from '../src/features/auth/permissions';
import type { OverrideRow, RolePermissionRow, RoleRow } from
  '../src/features/auth/permissions';

/**
 * Sastavljanje sesije u PRAVOM režimu.
 *
 * Ovaj fajl postoji zbog konkretne greške: upit za uloge nije vraćao `role_id`,
 * a presek se radio upravo po njemu — pa je ispravno dodeljen korisnik dobijao
 * PRAZAN spisak permisija i zaključane ekrane. Mock režim to nikada ne bi
 * pokazao, jer mock ne prolazi kroz PostgREST.
 */

const ROLES: RoleRow[] = [
  { role_id: 'r-op', code: 'DATA_ENTRY_OPERATOR' },
];

const CATALOG: RolePermissionRow[] = [
  { role_id: 'r-op', code: 'entry.view' },
  { role_id: 'r-op', code: 'entry.edit' },
  { role_id: 'r-fin', code: 'finance.approve' },
  { role_id: 'r-fin', code: 'finance.return' },
];

describe('prava iz uloga', () => {
  it('uloga donosi svoja prava', () => {
    expect(effectivePermissions(ROLES, CATALOG)).toEqual(['entry.edit', 'entry.view']);
  });

  it('prava tuđe uloge se ne uvlače', () => {
    expect(effectivePermissions(ROLES, CATALOG)).not.toContain('finance.approve');
  });

  it('dve uloge sabiraju svoja prava', () => {
    const both: RoleRow[] = [...ROLES, { role_id: 'r-fin', code: 'FINANCE' }];
    expect(effectivePermissions(both, CATALOG)).toEqual([
      'entry.edit', 'entry.view', 'finance.approve', 'finance.return',
    ]);
  });

  it('bez ijedne uloge nema prava — ne pada na „uzmi sve"', () => {
    expect(effectivePermissions([], CATALOG)).toEqual([]);
  });

  it('red bez role_id se ignoriše umesto da poništi presek', () => {
    // Tačno ovo je bio uzrok greške: `role_id` nije bio u SELECT-u.
    const broken: RoleRow[] = [{ role_id: null, code: 'DATA_ENTRY_OPERATOR' }];
    expect(effectivePermissions(broken, CATALOG)).toEqual([]);
  });

  it('šifre uloga se čitaju za prikaz', () => {
    expect(roleCodes(ROLES)).toEqual(['DATA_ENTRY_OPERATOR']);
  });
});

describe('izuzeci: uloge + GRANT − REVOKE', () => {
  it('izričit GRANT dodaje pravo koje uloga ne daje', () => {
    const ov: OverrideRow[] = [{ permission_code: 'finance.approve', mode: 'GRANT' }];
    expect(effectivePermissions(ROLES, CATALOG, ov)).toContain('finance.approve');
  });

  it('izričit REVOKE uklanja pravo koje uloga daje', () => {
    const ov: OverrideRow[] = [{ permission_code: 'entry.edit', mode: 'REVOKE' }];
    expect(effectivePermissions(ROLES, CATALOG, ov)).toEqual(['entry.view']);
  });

  it('REVOKE pobeđuje i kada uloga daje pravo', () => {
    const ov: OverrideRow[] = [
      { permission_code: 'entry.edit', mode: 'GRANT' },
      { permission_code: 'entry.edit', mode: 'REVOKE' },
    ];
    // Redosled unosa ne sme da menja ishod: oduzimanje ide posle unije.
    expect(effectivePermissions(ROLES, CATALOG, ov)).not.toContain('entry.edit');
    expect(effectivePermissions(ROLES, CATALOG, [...ov].reverse()))
      .not.toContain('entry.edit');
  });

  it('REVOKE prava koje korisnik ionako nema ništa ne kvari', () => {
    const ov: OverrideRow[] = [{ permission_code: 'finance.approve', mode: 'REVOKE' }];
    expect(effectivePermissions(ROLES, CATALOG, ov)).toEqual(['entry.edit', 'entry.view']);
  });

  it('nepoznat mod se ignoriše, ne tumači se kao GRANT', () => {
    const ov = [{ permission_code: 'finance.approve', mode: 'MOZDA' }];
    expect(effectivePermissions(ROLES, CATALOG, ov)).not.toContain('finance.approve');
  });
});
