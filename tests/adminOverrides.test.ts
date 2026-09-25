import { describe, expect, it } from 'vitest';
import {
  intendedOverrides,
  overrideEditorRows,
  overrideProblems,
  sensitiveChanges,
  userAccessPayload,
} from '../src/features/admin/config';
import type { PermissionOverrideRow } from '../src/features/admin/config';
import type { AdminUser } from '../src/lib/api/types';

/**
 * Izuzeci permisija — semantika ZAMENE.
 *
 * `rpc_admin_set_user_access` briše i ponovo upisuje ceo skup izuzetaka kada
 * dobije niz koji nije null. Zato ovde nije bitno „da li se dugme vidi", nego
 * jedna jedina stvar: šta tačno ode na server. Prazan niz poslat iz pogrešnog
 * razloga tiho oduzima prava koja niko nije tražio da se oduzmu.
 */

const PERMISSIONS = [
  { code: 'entry.view', name: 'Pregled evidencije', area: 'entry' },
  { code: 'finance.approve', name: 'Odobravanje obračuna', area: 'finance' },
  { code: 'controls.review', name: 'Odlučivanje o nalazima', area: 'controls' },
  { code: 'roles.manage', name: 'Upravljanje ulogama', area: 'access' },
];

const SENSITIVE = ['finance.approve', 'controls.review', 'roles.manage'];

function user(overrides: AdminUser['permission_overrides']): AdminUser {
  return {
    profile_id: 'u1',
    full_name: 'Test Korisnik',
    email: 'test@wdr.local',
    active: true,
    roles: ['DATA_ENTRY_OPERATOR'],
    centers: [{ center_code: 'B6', can_write: true }],
    permission_overrides: overrides,
  };
}

function rows(u: AdminUser): PermissionOverrideRow[] {
  return overrideEditorRows(PERMISSIONS, u, SENSITIVE);
}

describe('1 — postojeći izuzeci se učitavaju u editor', () => {
  it('server → editor: prazno lokalno stanje NE znači da izuzetaka nema', () => {
    const r = rows(user([
      { permission_code: 'finance.approve', mode: 'GRANT', reason: 'Zamena tokom odsustva.' },
      { permission_code: 'entry.view', mode: 'REVOKE', reason: 'Prelazak na drugo radno mesto.' },
    ]));

    expect(r.find((x) => x.permission_code === 'finance.approve')?.choice).toBe('GRANT');
    expect(r.find((x) => x.permission_code === 'entry.view')?.choice).toBe('REVOKE');
    // Permisije bez izuzetka su vidljive, ali prazne.
    expect(r.find((x) => x.permission_code === 'roles.manage')?.choice).toBe('NONE');
    expect(r).toHaveLength(PERMISSIONS.length);
  });

  it('osetljive permisije su označene, a katalog dolazi sa servera', () => {
    const r = rows(user([]));
    expect(r.find((x) => x.permission_code === 'finance.approve')?.sensitive).toBe(true);
    expect(r.find((x) => x.permission_code === 'entry.view')?.sensitive).toBe(false);
    expect(r.map((x) => x.area)).toContain('finance');
  });

  it('izuzetak za permisiju van kataloga se prikazuje, ne gubi tiho', () => {
    const r = rows(user([
      { permission_code: 'nesto.staro', mode: 'GRANT', reason: 'Istorijski izuzetak.' },
    ]));
    expect(r.find((x) => x.permission_code === 'nesto.staro')?.choice).toBe('GRANT');
  });
});

describe('2–4 — GRANT, REVOKE i obrazloženje preživljavaju pun krug', () => {
  const payloadFor = (u: AdminUser) => userAccessPayload({
    profileId: u.profile_id,
    active: u.active,
    roles: u.roles,
    centers: u.centers.map((c) => ({ code: c.center_code, write: c.can_write })),
    canManageRoles: true,
    overrides: rows(u),
  });

  it('2 — GRANT preživljava server → editor → payload', () => {
    const p = payloadFor(user([
      { permission_code: 'finance.approve', mode: 'GRANT', reason: 'Zamena tokom odsustva.' },
    ]));
    expect(p.permission_overrides).toEqual([
      { permission_code: 'finance.approve', mode: 'GRANT', reason: 'Zamena tokom odsustva.' },
    ]);
  });

  it('3 — REVOKE preživljava server → editor → payload', () => {
    const p = payloadFor(user([
      { permission_code: 'entry.view', mode: 'REVOKE', reason: 'Privremeno oduzeto.' },
    ]));
    expect(p.permission_overrides).toEqual([
      { permission_code: 'entry.view', mode: 'REVOKE', reason: 'Privremeno oduzeto.' },
    ]);
  });

  it('4 — obrazloženje se prenosi nepromenjeno', () => {
    const reason = 'Revizija je tražila privremeno pravo do 30.09.';
    const p = payloadFor(user([
      { permission_code: 'controls.review', mode: 'GRANT', reason },
    ]));
    expect(p.permission_overrides?.[0].reason).toBe(reason);
  });

  it('GRANT/REVOKE bez obrazloženja se ne čuva', () => {
    const r = rows(user([]));
    r[1] = { ...r[1], choice: 'GRANT', reason: 'kratko' };
    expect(overrideProblems(r)).toHaveLength(1);
    expect(overrideProblems(r)[0]).toContain('finance.approve');
  });
});

describe('5–6 — izmena centara ili uloga ne briše izuzetke', () => {
  const u = user([
    { permission_code: 'finance.approve', mode: 'GRANT', reason: 'Zamena tokom odsustva.' },
    { permission_code: 'entry.view', mode: 'REVOKE', reason: 'Prelazak na drugo mesto.' },
  ]);

  it('5 — dodavanje centra šalje i dalje PUN skup izuzetaka', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: u.roles,
      centers: [{ code: 'B6', write: true }, { code: 'BZ', write: false }],
      canManageRoles: true,
      overrides: rows(u),
    });
    expect(p.center_access).toHaveLength(2);
    expect(p.permission_overrides?.map((o) => o.permission_code).sort())
      .toEqual(['entry.view', 'finance.approve']);
  });

  it('6 — izmena uloga šalje i dalje PUN skup izuzetaka', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['FINANCE'],
      centers: u.centers.map((c) => ({ code: c.center_code, write: c.can_write })),
      canManageRoles: true,
      overrides: rows(u),
    });
    expect(p.role_codes).toEqual(['FINANCE']);
    expect(p.permission_overrides).toHaveLength(2);
  });
});

describe('7–9 — šta se šalje, a šta ne', () => {
  const u = user([
    { permission_code: 'finance.approve', mode: 'GRANT', reason: 'Zamena tokom odsustva.' },
    { permission_code: 'controls.review', mode: 'GRANT', reason: 'Privremena revizija.' },
  ]);

  it('7 — bez roles.manage šalje se null (ne diraj tuđe izuzetke)', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['FINANCE'],
      centers: [{ code: 'B6', write: true }],
      canManageRoles: false,
      overrides: rows(u),
    });
    expect(p.permission_overrides).toBeNull();
    expect(p.role_codes).toBeNull();
  });

  it('7b — ni sa roles.manage se ne šalje prazan niz ako editor nije učitan', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['FINANCE'],
      centers: [], canManageRoles: true,
      // overrides izostavljen: editor nije prikazan / nije se učitao
    });
    expect(p.permission_overrides).toBeNull();
  });

  it('8 — sa roles.manage šalje se KOMPLETAN nameravani skup', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['FINANCE'],
      centers: [], canManageRoles: true,
      overrides: rows(u),
    });
    expect(p.permission_overrides?.map((o) => o.permission_code).sort())
      .toEqual(['controls.review', 'finance.approve']);
  });

  it('9 — uklanjanje jednog izuzetka uklanja samo njega', () => {
    const r = rows(u).map((x) => (
      x.permission_code === 'controls.review' ? { ...x, choice: 'NONE' as const } : x));
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['FINANCE'],
      centers: [], canManageRoles: true,
      overrides: r,
    });
    expect(p.permission_overrides).toEqual([
      { permission_code: 'finance.approve', mode: 'GRANT', reason: 'Zamena tokom odsustva.' },
    ]);
  });

  it('9b — namerno brisanje SVIH izuzetaka je prazan niz, ne null', () => {
    const r = rows(u).map((x) => ({ ...x, choice: 'NONE' as const }));
    const p = userAccessPayload({
      profileId: 'u1', active: true, roles: ['FINANCE'],
      centers: [], canManageRoles: true,
      overrides: r,
    });
    expect(p.permission_overrides).toEqual([]);
  });
});

describe('10–11 — potvrda širenja prava', () => {
  it('10 — nova osetljiva GRANT se pojavljuje u potvrdi', () => {
    const r = rows(user([])).map((x) => (
      x.permission_code === 'finance.approve'
        ? { ...x, choice: 'GRANT' as const, reason: 'Zamena tokom odsustva.' } : x));

    const w = sensitiveChanges({
      currentRoles: ['DATA_ENTRY_OPERATOR'],
      nextRoles: ['DATA_ENTRY_OPERATOR'],
      sensitivePermissions: SENSITIVE,
      nextOverrides: intendedOverrides(r),
      currentOverrides: [],
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('finance.approve');
  });

  it('10b — već postojeća osetljiva GRANT nije NOVO širenje prava', () => {
    const existing = [{ permission_code: 'finance.approve', mode: 'GRANT', reason: 'x' }];
    const w = sensitiveChanges({
      currentRoles: [], nextRoles: [], sensitivePermissions: SENSITIVE,
      nextOverrides: intendedOverrides(rows(user(existing))),
      currentOverrides: existing,
    });
    expect(w).toEqual([]);
  });

  it('10c — REVOKE osetljive permisije ne traži potvrdu', () => {
    const w = sensitiveChanges({
      currentRoles: [], nextRoles: [], sensitivePermissions: SENSITIVE,
      nextOverrides: [{ permission_code: 'finance.approve', mode: 'REVOKE' }],
      currentOverrides: [],
    });
    expect(w).toEqual([]);
  });

  it('11 — privilegovana uloga i osetljiva permisija idu u ISTU potvrdu', () => {
    const r = rows(user([])).map((x) => (
      x.permission_code === 'controls.review'
        ? { ...x, choice: 'GRANT' as const, reason: 'Privremena revizija.' } : x));

    const w = sensitiveChanges({
      currentRoles: ['DATA_ENTRY_OPERATOR'],
      nextRoles: ['DATA_ENTRY_OPERATOR', 'SUPER_ADMIN_BA'],
      sensitivePermissions: SENSITIVE,
      nextOverrides: intendedOverrides(r),
      currentOverrides: [],
      currentCenters: [{ code: 'B6', write: true }],
      nextCenters: [{ code: 'B6', write: true }, { code: 'BZ', write: true }],
    });

    expect(w.some((x) => x.includes('SUPER_ADMIN_BA'))).toBe(true);
    expect(w.some((x) => x.includes('controls.review'))).toBe(true);
    expect(w.some((x) => x.includes('BZ'))).toBe(true);
  });

  it('11b — nepromenjen pristup centrima nije širenje', () => {
    const w = sensitiveChanges({
      currentRoles: [], nextRoles: [], sensitivePermissions: SENSITIVE,
      nextOverrides: [],
      currentCenters: [{ code: 'B6', write: true }],
      nextCenters: [{ code: 'B6', write: true }],
    });
    expect(w).toEqual([]);
  });
});

describe('12 — oblik payload-a odgovara RPC potpisu', () => {
  it('šalje tačno polja koja adapter mapira u p_* parametre', () => {
    const p = userAccessPayload({
      profileId: 'u1', active: false, roles: ['FINANCE'],
      centers: [{ code: 'B6', write: false }],
      canManageRoles: true,
      overrides: rows(user([
        { permission_code: 'entry.view', mode: 'REVOKE', reason: 'Privremeno oduzeto.' },
      ])),
    });
    expect(Object.keys(p).sort()).toEqual(
      ['active', 'center_access', 'permission_overrides', 'profile_id', 'role_codes']);
    expect(Object.keys(p.permission_overrides![0]).sort())
      .toEqual(['mode', 'permission_code', 'reason']);
    expect(['GRANT', 'REVOKE']).toContain(p.permission_overrides![0].mode);
  });
});
