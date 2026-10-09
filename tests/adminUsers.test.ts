import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  EMPTY_NEW_USER,
  accessUpdatePayload,
  auditLabel,
  credentialsText,
  deactivateBlocker,
  draftFromUser,
  draftProblems,
  filterUsers,
  fullNameOf,
  hasAccessChanges,
  isTechnicalAudit,
  isValidEmail,
  newUserPayload,
  permissionRows,
  privilegedRoleCodes,
  resetBlocker,
  setOverride,
  userStatus,
  validateNewUser,
  wideningWarnings,
} from '../src/features/admin/users';
import { effectivePermissions } from '../src/features/auth/permissions';
import { centerLabel, sortCenters } from '../src/lib/format/sort';
import { MIN_PASSWORD_LENGTH, SET_PASSWORD_PATH, newPasswordProblem, passwordFormError } from '../src/features/auth/passwordPolicy';
import { ADMIN_USERS_FUNCTION, edgeErrorToWdr } from '../src/lib/api/edgeFunction';
import { NAV_GROUPS } from '../src/components/navConfig';
import { MockWdrApi } from '../src/lib/api/mockApi';
import { WdrApiError } from '../src/lib/api/WdrApi';
import { messageForCode } from '../src/features/grid/errors';
import type { AdminAuthStatus, AdminUserList, AdminUserRow } from '../src/lib/api/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

function user(over: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    profile_id: 'p1', auth_user_id: 'a1', full_name: 'Đorđe Čavić', email: 'djordje@wdr.rs', active: true,
    created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z',
    roles: [{ code: 'DATA_ENTRY_OPERATOR', name: 'Operater unosa' }],
    centers: [{ center_id: 'c1', center_code: 'B6', center_name: 'Rakovica', center_active: true, can_write: true }],
    permission_overrides: [], all_centers: false, must_change_password: false, password_changed_at: null,
    last_password_reset_at: null, created_by_name: null, ...over,
  };
}

async function adminMock() {
  const api = new MockWdrApi({ role: 'admin' });
  await api.signIn('admin@wdr.local', 'mock1234');
  return api;
}

// =============================================================================
describe('novi korisnik: validacija i payload', () => {
  it('obavezna polja i oblik emaila', () => {
    expect(validateNewUser(EMPTY_NEW_USER)).toEqual({
      first_name: 'Ime je obavezno.', last_name: 'Prezime je obavezno.',
      email: 'Email je obavezan.', role_codes: 'Izaberite bar jednu ulogu.',
    });
    const ok = { ...EMPTY_NEW_USER, first_name: 'Ana', last_name: 'Anić', email: 'ana@wdr.rs', role_codes: ['FINANCE'] };
    expect(validateNewUser(ok)).toEqual({});
    expect(validateNewUser({ ...ok, email: 'ana@wdr' }).email).toBeTruthy();
  });

  it('email pravilo je isto kao u bazi (0076) i Edge Function-u', () => {
    expect(isValidEmail(' Ana.Anic@WDR.rs ')).toBe(true);
    expect(isValidEmail('a b@wdr.rs')).toBe(false);
    expect(isValidEmail('a@@wdr.rs')).toBe(false);
    expect(isValidEmail('a@wdr..rs')).toBe(false);
    expect(isValidEmail('xy@y.z')).toBe(true);
    expect(isValidEmail('x@y.z')).toBe(false); // ispod 6 znakova, kao u bazi
  });

  it('payload: normalizovan email, jedan nivo pristupa za sve centre, bez lozinke', () => {
    const p = newUserPayload({ first_name: ' Ana ', last_name: 'Anić', email: ' ANA@wdr.rs',
      role_codes: ['DATA_ENTRY_OPERATOR'], center_codes: ['BZ', 'B6'], center_write: false });
    expect(p).toEqual({
      first_name: 'Ana', last_name: 'Anić', email: 'ana@wdr.rs', role_codes: ['DATA_ENTRY_OPERATOR'],
      center_access: [{ center_code: 'B6', can_write: false }, { center_code: 'BZ', can_write: false }],
      permission_overrides: null,
    });
    expect(JSON.stringify(p)).not.toMatch(/password|lozink/i);
    expect(fullNameOf({ first_name: ' Ana  Marija ', last_name: ' Anić ' })).toBe('Ana Marija Anić');
  });

  it('„Kopiraj podatke": login + privremena lozinka + uputstvo, bez ičega drugog', () => {
    const t = credentialsText({ email: 'pera.petrovic@firma.rs', temporary_password: 'Abcde-Fghij-23456-Kmnpq' });
    expect(t).toContain('Login: pera.petrovic@firma.rs');
    expect(t).toContain('Privremena lozinka: Abcde-Fghij-23456-Kmnpq');
    expect(t).toContain('postavite svoju lozinku');
    expect(t).not.toMatch(/http|token|link/i);
  });
});

describe('lista: sortiranje, prikaz centra i filteri', () => {
  it('centri: zajednički sortCenters (po NAZIVU) i prikaz „šifra — naziv" iz 16bbf2c', () => {
    const names = sortCenters([
      { code: 'MK', name: 'Makiš' }, { code: 'B6', name: 'Rakovica' }, { code: 'BZ', name: 'Bežanija' },
      { code: 'ZZ', name: 'Žarkovo' }, { code: 'CC', name: 'Čukarica' }, { code: 'LS', name: 'Leštane' },
    ]).map((c) => c.name);
    expect(names).toEqual(['Bežanija', 'Čukarica', 'Leštane', 'Makiš', 'Rakovica', 'Žarkovo']);
    expect(centerLabel({ code: 'B6', name: 'Rakovica' })).toBe('B6 — Rakovica');
  });

  it('korisnici u listi abecedno po imenu (srpska latinica, brojevi prirodno), bez obzira na redosled sa servera', () => {
    const rows = ['Žika Žikić', 'Ćira Ćirić', 'Ana Anić', 'Đorđe Đokić', 'Čeda Čolić', 'Dragan Dukić',
      'Operater 10', 'Operater 2'].map((n, i) => user({ profile_id: `p${i}`, auth_user_id: `a${i}`, full_name: n }));
    expect(filterUsers(rows, EMPTY_FILTER).map((u) => u.full_name)).toEqual([
      'Ana Anić', 'Čeda Čolić', 'Ćira Ćirić', 'Dragan Dukić', 'Đorđe Đokić', 'Operater 2', 'Operater 10', 'Žika Žikić']);
  });

  it('prava u editoru abecedno po vidljivom nazivu', () => {
    const rows = permissionRows([
      { code: 'z.z', name: 'Žalbe', area: 'admin' }, { code: 'a.a', name: 'Čitanje', area: 'entry' },
      { code: 'm.m', name: 'Analitika', area: 'analytics' }], [], [], [], []);
    expect(rows.map((r) => r.name)).toEqual(['Analitika', 'Čitanje', 'Žalbe']);
  });

  it('pretraga bez dijakritike, po imenu i emailu; filter po ulozi, centru, statusu', () => {
    const users = [
      user(),
      user({ profile_id: 'p2', auth_user_id: 'a2', full_name: 'Marko Finansije', email: 'marko@wdr.rs',
             roles: [{ code: 'FINANCE', name: 'Finansije' }], centers: [] }),
      user({ profile_id: 'p3', auth_user_id: 'a3', full_name: 'Admin', email: 'admin@wdr.rs',
             roles: [{ code: 'SUPER_ADMIN_BA', name: 'Admin' }], centers: [], all_centers: true }),
      user({ profile_id: 'p4', auth_user_id: 'a4', full_name: 'Bivši', email: 'bivsi@wdr.rs', active: false }),
    ];
    const ids = (f: Partial<typeof EMPTY_FILTER>, auth?: Map<string, AdminAuthStatus>) =>
      filterUsers(users, { ...EMPTY_FILTER, ...f }, auth).map((u) => u.profile_id);
    expect(ids({ q: 'djordje' })).toEqual(['p1']);
    expect(ids({ q: 'cavic' })).toEqual(['p1']);
    expect(ids({ q: 'MARKO@' })).toEqual(['p2']);
    expect(ids({ role: 'FINANCE' })).toEqual(['p2']);
    // Rezultat je abecedni po imenu: Admin, Bivši, Đorđe Čavić.
    expect(ids({ center: 'B6' })).toEqual(['p3', 'p4', 'p1']); // admin vidi sve centre
    expect(ids({ status: 'inactive' })).toEqual(['p4']);
    const pending = filterUsers([...users, user({ profile_id: 'p5', auth_user_id: 'a5', full_name: 'Nova Osoba',
      email: 'nova@wdr.rs', must_change_password: true })], { ...EMPTY_FILTER, status: 'pending_password' });
    expect(pending.map((u) => u.profile_id)).toEqual(['p5']);
  });

  it('status: WDR aktivnost je merodavna; Auth stanje je dopuna', () => {
    expect(userStatus(user({ active: false })).label).toBe('Neaktivan');
    expect(userStatus(user()).label).toBe('Aktivan');
    const a = (state: AdminAuthStatus['state']): AdminAuthStatus => ({ auth_user_id: 'a1', state,
      email_confirmed_at: null, last_sign_in_at: null, banned_until: null });
    expect(userStatus(user({ must_change_password: true })).label).toBe('Čeka promenu lozinke');
    expect(userStatus(user({ must_change_password: true }), a('ACTIVE')).key).toBe('PENDING_PASSWORD');
    expect(userStatus(user(), a('MISSING')).tone).toBe('error');
    expect(userStatus(user({ active: false, must_change_password: true }), a('BANNED')).label).toBe('Neaktivan');
  });

  it('reset lozinke: ne sopstveni, ne neaktivan (server: ADMIN_SELF_RESET / ADMIN_USER_INACTIVE)', () => {
    expect(resetBlocker(user({ profile_id: 'me' }), { me: 'me' })).toContain('Promeni šifru');
    expect(resetBlocker(user({ active: false }), { me: 'x' })).toContain('aktivirajte');
    expect(resetBlocker(user(), { me: 'x' })).toBeNull();
  });
});

// =============================================================================
const LIST: AdminUserList = {
  me: 'p-admin',
  can: { users: true, roles: true },
  active_admin_count: 1,
  roles: [
    { code: 'DATA_ENTRY_OPERATOR', name: 'Operater unosa', description: null, is_system: true,
      permissions: ['entry.view', 'entry.edit_draft'] },
    { code: 'FINANCE', name: 'Finansije', description: null, is_system: true,
      permissions: ['finance.approve', 'finance.queue.view'] },
    { code: 'SUPER_ADMIN_BA', name: 'Admin', description: null, is_system: true,
      permissions: ['users.manage', 'roles.manage', 'centers.manage', 'entry.view'] },
    // Uloga koja NE postoji u kodu — npr. buduća Faza 2.
    { code: 'REGIONALNI_MENADZER', name: 'Regionalni menadžer', description: null, is_system: false,
      permissions: ['entry.view', 'cost_center.override'] },
  ],
  permissions: [
    { code: 'entry.view', name: 'Pregled unosa', area: 'entry' },
    { code: 'entry.edit_draft', name: 'Izmena unosa', area: 'entry' },
    { code: 'finance.approve', name: 'Odobrenje', area: 'finance' },
    { code: 'finance.queue.view', name: 'Red', area: 'finance' },
    { code: 'cost_center.override', name: 'Trošak', area: 'admin' },
    { code: 'users.manage', name: 'Korisnici', area: 'admin' },
    { code: 'roles.manage', name: 'Uloge', area: 'admin' },
    { code: 'centers.manage', name: 'Centri', area: 'admin' },
  ],
  centers: [{ id: 'c1', code: 'B6', name: 'Rakovica', active: true }],
  sensitive_permissions: ['finance.approve', 'cost_center.override', 'users.manage', 'roles.manage'],
  users: [],
};

describe('prava: nasleđeno iz uloge / dodatno / oduzeto', () => {
  it('isto pravilo kao baza i sesija: (uloge ∪ GRANT) ∖ REVOKE', () => {
    const overrides = [
      { permission_code: 'finance.approve', mode: 'GRANT' as const, reason: 'zamena tokom odmora' },
      { permission_code: 'entry.edit_draft', mode: 'REVOKE' as const, reason: 'samo pregled u pilotu' },
    ];
    const rows = permissionRows(LIST.permissions, LIST.roles, ['DATA_ENTRY_OPERATOR'], overrides, LIST.sensitive_permissions);
    const eff = rows.filter((r) => r.effective).map((r) => r.code).sort();

    const shared = effectivePermissions(
      [{ role_id: 'r-op', code: 'DATA_ENTRY_OPERATOR' }],
      [{ role_id: 'r-op', code: 'entry.view' }, { role_id: 'r-op', code: 'entry.edit_draft' }],
      overrides,
    );
    expect(eff).toEqual(shared);
    const by = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(by['entry.view'].source).toBe('ROLE');
    expect(by['entry.view'].fromRoles).toEqual(['Operater unosa']);
    expect(by['finance.approve'].source).toBe('GRANT');
    expect(by['entry.edit_draft'].source).toBe('REVOKE');
    expect(by['entry.edit_draft'].effective).toBe(false);
  });

  it('suvišan GRANT se označava; izuzetak van kataloga se ne gubi', () => {
    const rows = permissionRows(LIST.permissions, LIST.roles, ['DATA_ENTRY_OPERATOR'], [
      { permission_code: 'entry.view', mode: 'GRANT', reason: 'nepotrebno ali postoji' },
      { permission_code: 'stara.permisija', mode: 'REVOKE', reason: 'iz ranijeg modela' },
    ], []);
    expect(rows.find((r) => r.code === 'entry.view')!.redundant).toBe(true);
    expect(rows.find((r) => r.code === 'stara.permisija')!.area).toBe('nepoznato');
  });

  it('setOverride dodaje, menja i uklanja izuzetak', () => {
    let o = setOverride([], 'finance.approve', 'GRANT', 'razlog dovoljno dug');
    o = setOverride(o, 'entry.view', 'REVOKE');
    expect(o.map((x) => x.permission_code)).toEqual(['entry.view', 'finance.approve']);
    o = setOverride(o, 'finance.approve', 'REVOKE');
    expect(o.find((x) => x.permission_code === 'finance.approve')).toMatchObject({ mode: 'REVOKE', reason: 'razlog dovoljno dug' });
    expect(setOverride(o, 'entry.view', 'NONE').map((x) => x.permission_code)).toEqual(['finance.approve']);
  });

  it('privilegovane uloge se izvode iz osetljivih permisija — bez hardkodovanih šifara', () => {
    expect(privilegedRoleCodes(LIST.roles, LIST.sensitive_permissions).sort())
      .toEqual(['FINANCE', 'REGIONALNI_MENADZER', 'SUPER_ADMIN_BA']);
    const w = wideningWarnings(user(), { ...draftFromUser(user()), role_codes: ['DATA_ENTRY_OPERATOR', 'REGIONALNI_MENADZER'] }, LIST);
    expect(w).toContain('Dodaje se privilegovana uloga REGIONALNI_MENADZER.');
  });
});

// =============================================================================
describe('izmena pristupa: šta se šalje serveru', () => {
  it('nepromenjen deo je null (server ga ne dira); bez izmena nema poziva', () => {
    const u = user();
    const p = accessUpdatePayload(u, draftFromUser(u), true);
    expect(p).toMatchObject({ role_codes: null, center_access: null, permission_overrides: null });
    expect(hasAccessChanges(p)).toBe(false);
  });

  it('promena samo centara šalje samo centre', () => {
    const u = user();
    const d = { ...draftFromUser(u), centers: [{ code: 'B6', write: true }, { code: 'BZ', write: false }] };
    const p = accessUpdatePayload(u, d, true, '  premeštaj  ');
    expect(p.role_codes).toBeNull();
    expect(p.center_access).toEqual([{ center_code: 'B6', can_write: true }, { center_code: 'BZ', can_write: false }]);
    expect(p.reason).toBe('premeštaj');
  });

  it('bez roles.manage uloge i izuzeci se NIKADA ne šalju (ni kao prazan niz)', () => {
    const u = user({ permission_overrides: [{ permission_code: 'finance.approve', mode: 'GRANT', reason: 'postojeći izuzetak' }] });
    const d = { ...draftFromUser(u), role_codes: ['FINANCE'], overrides: [] };
    const p = accessUpdatePayload(u, d, false);
    expect(p.role_codes).toBeNull();
    expect(p.permission_overrides).toBeNull();
  });

  it('zaštite pre slanja: bar jedna uloga, obrazloženje izuzetka', () => {
    expect(draftProblems({ role_codes: [], centers: [], overrides: [] })[0]).toContain('bar jedna uloga');
    expect(draftProblems({ role_codes: ['FINANCE'], centers: [],
      overrides: [{ permission_code: 'x.y', mode: 'GRANT', reason: 'kratko' }] })[0]).toContain('obrazloženje');
  });

  it('deaktivacija: ne sopstveni nalog, ne poslednji administrator', () => {
    const admin = user({ profile_id: 'p-admin', roles: [{ code: 'SUPER_ADMIN_BA', name: 'Admin' }] });
    const other = user({ profile_id: 'p-other', roles: [{ code: 'SUPER_ADMIN_BA', name: 'Admin' }] });
    expect(deactivateBlocker(admin, LIST)).toContain('sopstveni');
    expect(deactivateBlocker(other, LIST)).toContain('poslednji');
    expect(deactivateBlocker(other, { ...LIST, active_admin_count: 2 })).toBeNull();
    expect(deactivateBlocker(user(), LIST)).toBeNull();
  });
});

// =============================================================================
describe('pravila nove lozinke (isto kao server: logic.ts → newPasswordProblem)', () => {
  it('dužina, ista lozinka, email u lozinci, ponovljena lozinka', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(newPasswordProblem('kratka', 'x', 'a@b.rs')).toBe('PASSWORD_TOO_SHORT');
    expect(newPasswordProblem('č'.repeat(40), 'x', 'a@b.rs')).toBe('PASSWORD_TOO_LONG'); // 80 bajtova > 72
    expect(newPasswordProblem('Ista-lozinka-1', 'Ista-lozinka-1', 'a@b.rs')).toBe('SAME_PASSWORD');
    expect(newPasswordProblem('pera.petrovic2026!', 'x', 'pera.petrovic@firma.rs')).toBe('PASSWORD_CONTAINS_EMAIL');
    expect(newPasswordProblem('Moja-Nova-Lozinka-7', 'x', 'pera@firma.rs')).toBeNull();
    expect(passwordFormError('Moja-Nova-Lozinka-7', 'Moja-Nova-Lozinka-8', 'x', null)).toContain('ne poklapaju');
    expect(passwordFormError('Moja-Nova-Lozinka-7', 'Moja-Nova-Lozinka-7', 'x', null)).toBeNull();
  });
});

describe('Edge Function greške → poruka korisniku', () => {
  it('serverska šifra i dodatna polja (profile_id) se čuvaju', async () => {
    const e = await edgeErrorToWdr({ name: 'FunctionsHttpError', context: {
      status: 409, json: async () => ({ error: { code: 'USER_ALREADY_EXISTS', message: 'Postoji.', profile_id: 'p9' } }) } });
    expect(e).toBeInstanceOf(WdrApiError);
    expect(e.code).toBe('USER_ALREADY_EXISTS');
    expect((e.raw as { profile_id: string }).profile_id).toBe('p9');
  });

  it('nedeployovana funkcija i mrežna greška su prepoznatljivo stanje rollout-a', async () => {
    const notFound = await edgeErrorToWdr({ name: 'FunctionsHttpError',
      context: { status: 404, json: async () => { throw new Error('not json'); } } });
    expect(notFound.code).toBe('ADMIN_USERS_FN_UNAVAILABLE');
    expect((await edgeErrorToWdr({ name: 'FunctionsFetchError', message: 'Failed to fetch' })).code)
      .toBe('ADMIN_USERS_FN_UNAVAILABLE');
    expect(messageForCode('ADMIN_USERS_FN_UNAVAILABLE')).toContain('wdr-admin-users');
  });

  it('svaka nova serverska šifra ima srpsku poruku', () => {
    for (const code of ['USER_ALREADY_EXISTS', 'ADMIN_LAST_ADMIN', 'ADMIN_SELF_LOCKOUT', 'ADMIN_SELF_DEACTIVATE',
      'ADMIN_INVALID_EMAIL', 'ADMIN_ROLE_REQUIRED', 'ADMIN_CENTER_INACTIVE', 'ADMIN_OVERRIDE_REASON_REQUIRED',
      'AUTH_RATE_LIMIT', 'AUTH_USER_EXISTS_UNLINKED', 'ADMIN_USER_INACTIVE', 'ADMIN_SELF_RESET',
      'ADMIN_RESET_PRIVILEGED_TARGET', 'TEMP_PASSWORD_NOT_SET', 'CURRENT_PASSWORD_INVALID', 'WEAK_PASSWORD',
      'SAME_PASSWORD', 'PASSWORD_TOO_SHORT', 'PASSWORD_CONTAINS_EMAIL', 'PASSWORD_FLAG_NOT_CLEARED',
      'PROFILE_INACTIVE', 'DB_MIGRATION_MISSING',
      'ORIGIN_NOT_ALLOWED', 'CONFIG_MISSING']) {
      expect(messageForCode(code, 'FALLBACK')).not.toBe('FALLBACK');
    }
  });
});

// =============================================================================
describe('tok u mock režimu (ista semantika kao 0076 + Edge Function)', () => {
  it('kreiranje (privremena lozinka) → lista → duplikat → izmena → deaktivacija → reaktivacija → reset', async () => {
    const api = await adminMock();
    const r = await api.adminCreateUser({ first_name: 'Ana', last_name: 'Anić', email: 'ANA@wdr.rs',
      role_codes: ['DATA_ENTRY_OPERATOR'], center_access: [{ center_code: 'BZ', can_write: true }] });
    expect(r.must_change_password).toBe(true);
    expect(r.temporary_password).toMatch(/^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/);

    let list = await api.adminListUsers();
    const ana = list.users.find((u) => u.email === 'ana@wdr.rs')!;
    expect(ana.must_change_password).toBe(true);
    expect(userStatus(ana).key).toBe('PENDING_PASSWORD');
    expect(ana.centers[0]).toMatchObject({ center_code: 'BZ', center_name: 'Bežanija', can_write: true });
    // Lista NIKAD ne nosi lozinku.
    expect(JSON.stringify(list)).not.toContain(r.temporary_password);

    await expect(api.adminCreateUser({ first_name: 'X', last_name: 'Y', email: 'ana@wdr.rs',
      role_codes: ['FINANCE'], center_access: [] })).rejects.toMatchObject({ code: 'USER_ALREADY_EXISTS',
      raw: expect.objectContaining({ profile_id: ana.profile_id }) });

    const upd = await api.adminUpdateUserAccess(accessUpdatePayload(ana,
      { ...draftFromUser(ana), role_codes: ['FINANCE'], centers: [] }, true, 'prelazak u finansije'));
    expect(upd.changed).toEqual(['roles', 'centers']);

    api.userDirectory.completePasswordChange(ana.profile_id);
    expect((await api.adminListUsers()).users.find((u) => u.profile_id === ana.profile_id)!.must_change_password).toBe(false);

    expect((await api.adminDeactivateUser(ana.profile_id, 'odlazak')).auth_ban).toBe('ok');
    list = await api.adminListUsers();
    expect(list.users.find((u) => u.profile_id === ana.profile_id)!.active).toBe(false);
    await expect(api.adminResetPassword(ana.profile_id)).rejects.toMatchObject({ code: 'ADMIN_USER_INACTIVE' });

    await api.adminReactivateUser(ana.profile_id);
    const reset = await api.adminResetPassword(ana.profile_id, 'zaboravljena');
    expect(reset.temporary_password).not.toBe(r.temporary_password);
    const after = (await api.adminListUsers()).users.find((u) => u.profile_id === ana.profile_id)!;
    expect(after.must_change_password).toBe(true);
    expect(after.last_password_reset_at).not.toBeNull();
    expect(JSON.stringify(after)).not.toContain(reset.temporary_password);

    const auditRows = await api.adminUserAudit(ana.profile_id);
    const audit = auditRows.map((a) => a.action);
    for (const a of ['USER_CREATED', 'USER_ROLE_CHANGED', 'USER_CENTERS_CHANGED', 'USER_PASSWORD_CHANGED',
      'USER_DEACTIVATED', 'USER_REACTIVATED', 'USER_PASSWORD_RESET_BY_ADMIN']) {
      expect(audit).toContain(a);
    }
    expect(audit).not.toContain('USER_INVITED');
    const auditText = JSON.stringify(auditRows);
    expect(auditText).not.toContain(r.temporary_password);
    expect(auditText).not.toContain(reset.temporary_password);
  });

  it('postojeći Auth nalog bez profila: 409 dok Admin izričito ne potvrdi povezivanje', async () => {
    const api = await adminMock();
    api.userDirectory.orphanAuthEmails.add('rucno@wdr.rs');
    const input = { first_name: 'R', last_name: 'U', email: 'rucno@wdr.rs', role_codes: ['FINANCE'], center_access: [] };
    await expect(api.adminCreateUser(input)).rejects.toMatchObject({ code: 'AUTH_USER_EXISTS_UNLINKED' });
    const r = await api.adminCreateUser({ ...input, link_existing_auth: true });
    expect(r.auth_user_reused).toBe(true);
  });

  it('administrator ne resetuje sopstvenu lozinku resetom', async () => {
    const api = await adminMock();
    const me = (await api.adminListUsers()).me;
    await expect(api.adminResetPassword(me)).rejects.toMatchObject({ code: 'ADMIN_SELF_RESET' });
  });

  it('promena sopstvene lozinke: pravila se proveravaju; posle uspeha nova prijava', async () => {
    const api = await adminMock();
    await expect(api.changePassword('stara-lozinka', 'kratka')).rejects.toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
    await expect(api.changePassword('Ista-lozinka-1', 'Ista-lozinka-1')).rejects.toMatchObject({ code: 'SAME_PASSWORD' });
    await api.changePassword('stara-lozinka', 'Moja-Nova-Lozinka-7');
    expect(await api.getSession()).toBeNull();
  });

  it('zaštite: sopstveni nalog, poslednji administrator, samozaključavanje', async () => {
    const api = await adminMock();
    const me = (await api.adminListUsers()).me;
    await expect(api.adminDeactivateUser(me)).rejects.toMatchObject({ code: 'ADMIN_SELF_DEACTIVATE' });
    await expect(api.adminUpdateUserAccess({ profile_id: me, role_codes: ['FINANCE'],
      center_access: null, permission_overrides: null })).rejects.toMatchObject({ code: 'ADMIN_SELF_LOCKOUT' });
  });

  it('bez server funkcije: deaktivacija i dalje gasi pristup (auth_ban = skipped), kreiranje i reset ne', async () => {
    const api = await adminMock();
    api.userDirectory.edgeAvailable = false;
    const op = (await api.adminListUsers()).users.find((u) => u.email === 'operater@wdr.local')!;
    expect((await api.adminDeactivateUser(op.profile_id)).auth_ban).toBe('skipped');
    await expect(api.adminCreateUser({ first_name: 'A', last_name: 'B', email: 'ab@wdr.rs',
      role_codes: ['FINANCE'], center_access: [] })).rejects.toMatchObject({ code: 'ADMIN_USERS_FN_UNAVAILABLE' });
    await expect(api.adminResetPassword(op.profile_id)).rejects.toMatchObject({ code: 'ADMIN_USERS_FN_UNAVAILABLE' });
  });

  it('operater i finansije nemaju pristup listi korisnika', async () => {
    for (const role of ['operator', 'finance'] as const) {
      const api = new MockWdrApi({ role });
      await api.signIn('x@wdr.local', 'mock1234');
      await expect(api.adminListUsers()).rejects.toBeTruthy();
      await expect(api.adminCreateUser({ first_name: 'A', last_name: 'B', email: 'ab@wdr.rs',
        role_codes: ['SUPER_ADMIN_BA'], center_access: [] })).rejects.toBeTruthy();
    }
  });

  it('audit oznake: semantički događaji su čitljivi, tehnički se razlikuju', () => {
    expect(auditLabel('USER_DEACTIVATED')).toBe('Deaktiviran');
    expect(auditLabel('USER_ROLE_INSERT')).toContain('Tehnički zapis');
    expect(isTechnicalAudit('USER_CENTER_ACCESS_DELETE')).toBe(true);
    expect(isTechnicalAudit('USER_CENTERS_CHANGED')).toBe(false);
  });
});

// =============================================================================
describe('bezbednosne granice u izvoru (frontend)', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }

  it('nijedan frontend fajl ne pominje service-role ključ ni Auth Admin API', () => {
    const offenders = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => {
      const s = readFileSync(f, 'utf8');
      return /SERVICE_ROLE|service_role_key|auth\.admin\.|VITE_[A-Z_]*(SERVICE|SECRET)/.test(s);
    });
    expect(offenders).toEqual([]);
  });

  it('privilegovane akcije idu kroz Edge Function sa korisnikovim JWT-om, bez ručnog ključa', () => {
    const adapter = read('lib/api/supabaseApi.ts');
    expect(ADMIN_USERS_FUNCTION).toBe('wdr-admin-users');
    expect(adapter).toContain('functions.invoke(ADMIN_USERS_FUNCTION');
    for (const action of ['create', 'reset_password', 'change_own_password', 'deactivate', 'reactivate', 'auth_status']) {
      expect(adapter).toContain(`action: '${action}'`);
    }
    const edge = adapter.slice(adapter.indexOf('private async edge<T>'));
    expect(edge.slice(0, 400)).not.toMatch(/headers|apikey|Authorization/);
  });

  it('deaktiviran profil dobija jasnu poruku i odjavu, a ne prazne ekrane', () => {
    const s = read('lib/api/supabaseApi.ts');
    const session = s.slice(s.indexOf('async getSession('), s.indexOf('async listSubmissions('));
    // '*' namerno: kolona must_change_password postoji tek posle 0076.
    expect(session).toContain(".select('*')");
    expect(session).toMatch(/must_change_password === true/);
    expect(session).toMatch(/active === false[\s\S]{0,200}signOut\(\)[\s\S]{0,200}PROFILE_INACTIVE/);
  });

  it('ekran Korisnici traži users.manage; postavljanje lozinke traži sesiju', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/path="\/administracija\/korisnici" element=\{<RequireAuth permission="users\.manage"><AdminUsers \/>/);
    expect(app).toMatch(/path="\/postavi-lozinku" element=\{<RequireAuth><SetPassword \/><\/RequireAuth>\}/);
    const item = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })))
      .find((i) => i.to === '/administracija/korisnici');
    expect(item).toMatchObject({ group: 'Administracija', permission: 'users.manage', profiles: ['admin'] });
  });

  it('stari tok „Auth User ID" je uklonjen iz Administracije', () => {
    const admin = read('routes/Admin.tsx');
    // Nema polja za ručni unos Auth UUID-a ni poziva starog linkovanja.
    expect(admin).not.toContain('newAuthUserId');
    expect(admin).not.toContain('UUID iz Supabase Auth');
    expect(admin).not.toContain('adminLinkUser');
    expect(admin).toContain('/administracija/korisnici');
  });

  it('nema email toka: bez invite/recovery/SMTP poziva i bez obrade email linkova', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC).filter((x) => /\.(ts|tsx)$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      if (/inviteUserByEmail|resetPasswordForEmail|resend_invite|signInWithOtp|authRedirect/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
    expect(read('main.tsx')).not.toMatch(/location\.hash/);
  });

  it('obavezna promena lozinke: RequireAuth vodi samo na /postavi-lozinku', () => {
    expect(SET_PASSWORD_PATH).toBe('/postavi-lozinku');
    const guard = read('routes/RequireAuth.tsx');
    expect(guard).toMatch(/session\.must_change_password && location\.pathname !== SET_PASSWORD_PATH/);
    expect(guard).toMatch(/<Navigate to=\{SET_PASSWORD_PATH\} replace \/>/);
  });

  it('privremena lozinka: nikad u storage-u, URL-u ili logu na frontendu', () => {
    for (const f of ['routes/AdminUsers.tsx', 'routes/SetPassword.tsx', 'routes/ChangePassword.tsx',
      'lib/auth/AuthProvider.tsx', 'lib/api/supabaseApi.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/localStorage|sessionStorage/);
      expect(src, f).not.toMatch(/console\.(log|info|warn|error)\([^)]*(password|lozink)/i);
      expect(src, f).not.toMatch(/[?&](temporary_password|password)=/);
    }
    // lozinke idu samo u telo POST zahteva ka Edge Function-u
    const adapter = read('lib/api/supabaseApi.ts');
    expect(adapter).toMatch(/action: 'change_own_password', current_password: currentPassword, new_password: newPassword/);
  });

  it('Login ne obećava email reset; upućuje na administratora', () => {
    const login = read('routes/Login.tsx');
    expect(login).toContain('Za reset lozinke obratite se administratoru WDR sistema.');
    expect(login).not.toMatch(/resetPasswordForEmail|Pošalji link/);
  });

  it('dijalog sa lozinkom: „Kopiraj podatke" i upozorenje da se lozinka više ne prikazuje', () => {
    const screen = read('routes/AdminUsers.tsx');
    expect(screen).toContain('Kopiraj podatke');
    expect(screen).toContain('Ova lozinka se više neće moći prikazati.');
    expect(screen).toContain('Generiši novu privremenu lozinku');
    expect(screen).not.toContain('Pošalji ponovo poziv');
  });

  it('modul Korisnici koristi zajednički lib/format/sort.ts — bez sopstvenog pravila sortiranja', () => {
    for (const f of ['routes/AdminUsers.tsx', 'components/SearchableMultiSelect.tsx', 'features/admin/users.ts']) {
      const src = read(f);
      expect(src, f).toMatch(/from '(\.\.\/)+lib\/format\/sort'/);
      expect(src, f).not.toMatch(/new Intl\.Collator/);
    }
    // Prikaz/izbor ne sortira „ručno": localeCompare ostaje samo za kanonski payload u users.ts.
    expect(read('routes/AdminUsers.tsx')).not.toMatch(/localeCompare\(/);
    expect(read('components/SearchableMultiSelect.tsx')).not.toMatch(/localeCompare\(/);
    const screen = read('routes/AdminUsers.tsx');
    expect(screen).toContain('sortByLabel(list.roles, (r) => r.name)');
    expect(screen).toContain('sortCenters(list.centers)');
  });

  it('pregled korisnika u Administraciji (16bbf2c) je sačuvan i abecedan', () => {
    const admin = read('routes/Admin.tsx');
    expect(admin).toContain('sortByLabel(cfg.users, (u) => u.full_name || u.email)');
  });

  it('ekran ne zadaje lozinku drugom korisniku', () => {
    const screen = read('routes/AdminUsers.tsx');
    expect(screen).not.toMatch(/type="password"/);
    expect(screen).not.toMatch(/updatePassword/);
  });
});
