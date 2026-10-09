/**
 * Admin → Korisnici — čista pravila ekrana (bez mreže, testirano u adminUsers.test.ts).
 *
 * Granica je ista kao u ostatku aplikacije: ovde se odlučuje šta se PRIKAZUJE i
 * šta se ŠALJE. Konačna odluka o pravima je uvek u bazi (0076), a privilegovane
 * Auth operacije u Edge Function-u `wdr-admin-users`.
 *
 * Nijedna uloga nije hardkodovana: „privilegovana uloga" je svaka uloga koja
 * nosi bar jednu osetljivu permisiju, a „nasleđeno iz uloge" se računa iz
 * kataloga koji šalje server.
 */
import type {
  AdminAuthStatus,
  AdminCreateUserInput,
  AdminRoleCatalogItem,
  AdminUpdateUserAccessInput,
  AdminUserList,
  AdminUserRow,
} from '../../lib/api/types';
import { sensitiveChanges } from './config';
import { sortByLabel } from '../../lib/format/sort';

// ----------------------------------------------------------------- tekst ----

/** Poređenje bez dijakritike i velikih/malih slova (č → c, đ → dj). */
export function foldText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Sortiranje i prikaz centra NISU ovde: koristi se zajednički `lib/format/sort.ts`
 * (16bbf2c) — srpska latinica A–Ž, brojevi prirodno, centri po NAZIVU, „B6 — Rakovica".
 * Jedno pravilo za celu aplikaciju; ovaj modul ga samo primenjuje.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Isto pravilo kao app.admin_email_is_valid (0076) i Edge Function. */
export function isValidEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length >= 6 && e.length <= 254
    && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !e.includes('..');
}

// -------------------------------------------------------------- novi korisnik

export interface NewUserForm {
  first_name: string;
  last_name: string;
  email: string;
  role_codes: string[];
  center_codes: string[];
  /** Jedan izbor za sve izabrane centre; pojedinačno se menja u izmeni korisnika. */
  center_write: boolean;
}

export const EMPTY_NEW_USER: NewUserForm = {
  first_name: '', last_name: '', email: '', role_codes: [], center_codes: [], center_write: true,
};

export type NewUserErrors = Partial<Record<'first_name' | 'last_name' | 'email' | 'role_codes', string>>;

export function validateNewUser(f: NewUserForm): NewUserErrors {
  const e: NewUserErrors = {};
  if (f.first_name.trim() === '') e.first_name = 'Ime je obavezno.';
  else if (f.first_name.trim().length > 60) e.first_name = 'Najviše 60 znakova.';
  if (f.last_name.trim() === '') e.last_name = 'Prezime je obavezno.';
  else if (f.last_name.trim().length > 60) e.last_name = 'Najviše 60 znakova.';
  if (f.email.trim() === '') e.email = 'Email je obavezan.';
  else if (!isValidEmail(f.email)) e.email = 'Email nije ispravnog oblika.';
  if (f.role_codes.length === 0) e.role_codes = 'Izaberite bar jednu ulogu.';
  return e;
}

/** Ime + prezime se čuvaju kao jedno `full_name` (šema profila se ne menja). */
export function fullNameOf(f: Pick<NewUserForm, 'first_name' | 'last_name'>): string {
  return `${f.first_name.trim()} ${f.last_name.trim()}`.replace(/\s+/g, ' ').trim();
}

export function newUserPayload(f: NewUserForm): AdminCreateUserInput {
  return {
    first_name: f.first_name.trim(),
    last_name: f.last_name.trim(),
    email: normalizeEmail(f.email),
    role_codes: [...f.role_codes],
    center_access: [...f.center_codes].sort().map((code) => ({ center_code: code, can_write: f.center_write })),
    permission_overrides: null,
  };
}

/**
 * Tekst za „Kopiraj podatke". Lozinka postoji samo u memoriji dijaloga koji ga
 * prikazuje; posle zatvaranja se više ne može dobiti.
 */
export function credentialsText(c: { email: string; temporary_password: string }): string {
  return [
    'WDR — podaci za prvu prijavu',
    `Login: ${c.email}`,
    `Privremena lozinka: ${c.temporary_password}`,
    'Pri prvoj prijavi WDR traži da postavite svoju lozinku.',
  ].join('\n');
}

// ------------------------------------------------------------- lista/filter

export type StatusFilter = 'all' | 'active' | 'inactive' | 'pending_password';

export interface UserFilter {
  q: string;
  role: string;     // '' = sve
  status: StatusFilter;
  center: string;   // šifra centra, '' = svi
}

export const EMPTY_FILTER: UserFilter = { q: '', role: '', status: 'all', center: '' };

export type UserStatusKey = 'ACTIVE' | 'INACTIVE' | 'PENDING_PASSWORD' | 'NO_AUTH' | 'AUTH_BLOCKED';

export interface UserStatus { key: UserStatusKey; label: string; tone: 'ok' | 'muted' | 'warn' | 'error' }

/**
 * Status u WDR-u (profiles.active, must_change_password) je merodavan za pristup.
 * Auth stanje je dopuna: bez Edge Function-a (auth === undefined) status je tačan.
 */
export function userStatus(u: AdminUserRow, auth?: AdminAuthStatus | null): UserStatus {
  if (!u.active) return { key: 'INACTIVE', label: 'Neaktivan', tone: 'muted' };
  if (auth?.state === 'MISSING') return { key: 'NO_AUTH', label: 'Bez Auth naloga', tone: 'error' };
  if (auth?.state === 'BANNED') return { key: 'AUTH_BLOCKED', label: 'Blokiran u Auth-u', tone: 'error' };
  if (u.must_change_password) return { key: 'PENDING_PASSWORD', label: 'Čeka promenu lozinke', tone: 'warn' };
  return { key: 'ACTIVE', label: 'Aktivan', tone: 'ok' };
}

export function filterUsers(
  users: readonly AdminUserRow[],
  f: UserFilter,
  auth: ReadonlyMap<string, AdminAuthStatus> = new Map(),
): AdminUserRow[] {
  const q = foldText(f.q.trim());
  // Korisnici abecedno po imenu (isto pravilo kao sve liste, 16bbf2c).
  return sortByLabel(users, (u) => u.full_name || u.email).filter((u) => {
    if (q && !foldText(u.full_name).includes(q) && !foldText(u.email).includes(q)) return false;
    if (f.role && !u.roles.some((r) => r.code === f.role)) return false;
    if (f.center && !u.all_centers && !u.centers.some((c) => c.center_code === f.center)) return false;
    const st = userStatus(u, auth.get(u.auth_user_id)).key;
    if (f.status === 'active' && !u.active) return false;
    if (f.status === 'inactive' && u.active) return false;
    if (f.status === 'pending_password' && st !== 'PENDING_PASSWORD') return false;
    return true;
  });
}

/** Reset nije dozvoljen za sopstveni ili neaktivan nalog (server: ADMIN_SELF_RESET / ADMIN_USER_INACTIVE). */
export function resetBlocker(u: AdminUserRow, list: Pick<AdminUserList, 'me'>): string | null {
  if (u.profile_id === list.me) return 'Sopstvenu lozinku menjate kroz „Promeni šifru".';
  if (!u.active) return 'Prvo ponovo aktivirajte korisnika.';
  return null;
}

// ------------------------------------------------------------ prava (editor)

export type OverrideChoice = 'NONE' | 'GRANT' | 'REVOKE';
export type PermissionSource = 'ROLE' | 'GRANT' | 'REVOKE' | 'NONE';

export const SOURCE_LABEL: Record<PermissionSource, string> = {
  ROLE: 'Nasleđeno iz uloge',
  GRANT: 'Dodatno dozvoljeno',
  REVOKE: 'Oduzeto korisniku',
  NONE: '—',
};

export interface OverrideDraft { permission_code: string; mode: 'GRANT' | 'REVOKE'; reason: string }

export interface PermissionRow {
  code: string;
  name: string;
  area: string;
  sensitive: boolean;
  /** Nazivi uloga (iz izabranih) koje daju ovu permisiju. */
  fromRoles: string[];
  override: OverrideChoice;
  reason: string;
  source: PermissionSource;
  effective: boolean;
  /** GRANT za nešto što uloga već daje — ne smeta, ali je suvišno. */
  redundant: boolean;
}

/**
 * Isto pravilo kao app.profile_has_perm: (uloge ∪ GRANT) ∖ REVOKE.
 * REVOKE pobeđuje i kada uloga daje permisiju.
 */
export function permissionRows(
  catalog: AdminUserList['permissions'],
  roles: readonly AdminRoleCatalogItem[],
  selectedRoles: readonly string[],
  overrides: readonly OverrideDraft[],
  sensitive: readonly string[],
): PermissionRow[] {
  const byCode = new Map(overrides.map((o) => [o.permission_code, o]));
  const chosen = roles.filter((r) => selectedRoles.includes(r.code));
  const rows = sortByLabel(catalog, (p) => p.name).map((p) => {
    const fromRoles = sortByLabel(chosen.filter((r) => r.permissions.includes(p.code)), (r) => r.name)
      .map((r) => r.name);
    const o = byCode.get(p.code);
    const override: OverrideChoice = o?.mode ?? 'NONE';
    const inherited = fromRoles.length > 0;
    const source: PermissionSource =
      override === 'REVOKE' ? 'REVOKE' : override === 'GRANT' ? 'GRANT' : inherited ? 'ROLE' : 'NONE';
    return {
      code: p.code, name: p.name, area: p.area,
      sensitive: sensitive.includes(p.code),
      fromRoles, override, reason: o?.reason ?? '', source,
      effective: (inherited || override === 'GRANT') && override !== 'REVOKE',
      redundant: override === 'GRANT' && inherited,
    };
  });
  // Izuzetak za permisiju van kataloga se ne gubi tiho (vidi i config.ts).
  for (const o of overrides) {
    if (catalog.some((p) => p.code === o.permission_code)) continue;
    rows.push({
      code: o.permission_code, name: o.permission_code, area: 'nepoznato',
      sensitive: sensitive.includes(o.permission_code), fromRoles: [], override: o.mode,
      reason: o.reason, source: o.mode, effective: o.mode === 'GRANT', redundant: false,
    });
  }
  return rows;
}

export function setOverride(
  overrides: readonly OverrideDraft[], code: string, choice: OverrideChoice, reason?: string,
): OverrideDraft[] {
  const rest = overrides.filter((o) => o.permission_code !== code);
  if (choice === 'NONE') return rest;
  const prev = overrides.find((o) => o.permission_code === code);
  return [...rest, { permission_code: code, mode: choice, reason: reason ?? prev?.reason ?? '' }]
    .sort((a, b) => a.permission_code.localeCompare(b.permission_code));
}

// ------------------------------------------------------------ izmena pristupa

export interface AccessDraft {
  role_codes: string[];
  centers: Array<{ code: string; write: boolean }>;
  overrides: OverrideDraft[];
}

export function draftFromUser(u: AdminUserRow): AccessDraft {
  return {
    role_codes: u.roles.map((r) => r.code).sort(),
    centers: u.centers.map((c) => ({ code: c.center_code, write: c.can_write }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    overrides: u.permission_overrides.map((o) => ({
      permission_code: o.permission_code, mode: o.mode, reason: o.reason ?? '',
    })).sort((a, b) => a.permission_code.localeCompare(b.permission_code)),
  };
}

const sameRoles = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const normCenters = (c: AccessDraft['centers']) =>
  JSON.stringify([...c].sort((x, y) => x.code.localeCompare(y.code)).map((x) => [x.code, x.write]));
const normOverrides = (o: readonly OverrideDraft[]) =>
  JSON.stringify([...o].sort((x, y) => x.permission_code.localeCompare(y.permission_code))
    .map((x) => [x.permission_code, x.mode, x.reason.trim()]));

/**
 * Šta se šalje serveru. Nepromenjen deo = null (server ga ne dira). Bez
 * roles.manage uloge i izuzeci se NIKADA ne šalju — server bi ih ionako odbio,
 * a slanje praznog niza bi, zbog semantike zamene, obrisalo tuđe izuzetke.
 */
export function accessUpdatePayload(
  u: AdminUserRow, draft: AccessDraft, canManageRoles: boolean, reason?: string | null,
): AdminUpdateUserAccessInput {
  const before = draftFromUser(u);
  return {
    profile_id: u.profile_id,
    role_codes: canManageRoles && !sameRoles(before.role_codes, draft.role_codes)
      ? [...draft.role_codes].sort() : null,
    center_access: normCenters(before.centers) !== normCenters(draft.centers)
      ? [...draft.centers].sort((a, b) => a.code.localeCompare(b.code))
        .map((c) => ({ center_code: c.code, can_write: c.write }))
      : null,
    permission_overrides: canManageRoles && normOverrides(before.overrides) !== normOverrides(draft.overrides)
      ? draft.overrides.map((o) => ({ permission_code: o.permission_code, mode: o.mode,
                                       reason: o.reason.trim() === '' ? null : o.reason.trim() }))
      : null,
    reason: reason?.trim() ? reason.trim() : null,
  };
}

export function hasAccessChanges(p: AdminUpdateUserAccessInput): boolean {
  return p.role_codes !== null || p.center_access !== null || p.permission_overrides !== null;
}

export const OVERRIDE_REASON_MIN = 10;

export function draftProblems(draft: AccessDraft): string[] {
  const out: string[] = [];
  if (draft.role_codes.length === 0) {
    out.push('Korisniku mora ostati bar jedna uloga. Za uklanjanje pristupa koristite deaktivaciju.');
  }
  for (const o of draft.overrides) {
    if (o.reason.trim().length < OVERRIDE_REASON_MIN) {
      out.push(`Izuzetak ${o.permission_code} zahteva obrazloženje (najmanje ${OVERRIDE_REASON_MIN} znakova).`);
    }
  }
  return out;
}

/** Privilegovana uloga = nosi bar jednu osetljivu permisiju (bez hardkodovanih šifara). */
export function privilegedRoleCodes(
  roles: readonly AdminRoleCatalogItem[], sensitive: readonly string[],
): string[] {
  return roles.filter((r) => r.permissions.some((p) => sensitive.includes(p))).map((r) => r.code);
}

/** Upozorenja pre širenja prava — postojeći helper, dinamička lista privilegovanih uloga. */
export function wideningWarnings(u: AdminUserRow | null, draft: AccessDraft, list: AdminUserList): string[] {
  const before = u ? draftFromUser(u) : { role_codes: [], centers: [], overrides: [] };
  return sensitiveChanges({
    currentRoles: before.role_codes,
    nextRoles: draft.role_codes,
    sensitivePermissions: list.sensitive_permissions,
    nextOverrides: draft.overrides,
    currentOverrides: before.overrides,
    currentCenters: before.centers,
    nextCenters: draft.centers,
    privilegedRoles: privilegedRoleCodes(list.roles, list.sensitive_permissions),
  });
}

// ------------------------------------------------------- aktivnost / zaštita

/** Efektivna prava drugog korisnika — isto pravilo kao u bazi. */
export function effectiveOf(u: AdminUserRow, roles: readonly AdminRoleCatalogItem[]): Set<string> {
  const out = new Set<string>();
  for (const r of roles) if (u.roles.some((x) => x.code === r.code)) r.permissions.forEach((p) => out.add(p));
  for (const o of u.permission_overrides) if (o.mode === 'GRANT') out.add(o.permission_code);
  for (const o of u.permission_overrides) if (o.mode === 'REVOKE') out.delete(o.permission_code);
  return out;
}

export function isFullAdmin(u: AdminUserRow, roles: readonly AdminRoleCatalogItem[]): boolean {
  const e = effectiveOf(u, roles);
  return e.has('users.manage') && e.has('roles.manage');
}

/** UI zaštita (server je i dalje konačan: ADMIN_SELF_DEACTIVATE / ADMIN_LAST_ADMIN). */
export function deactivateBlocker(u: AdminUserRow, list: AdminUserList): string | null {
  if (u.profile_id === list.me) return 'Ne možete deaktivirati sopstveni nalog.';
  if (u.active && isFullAdmin(u, list.roles) && list.active_admin_count <= 1) {
    return 'Ovo je poslednji aktivni administrator.';
  }
  return null;
}

// --------------------------------------------------------------------- audit

export const AUDIT_LABEL: Record<string, string> = {
  USER_CREATED: 'Korisnik kreiran (privremena lozinka)',
  USER_ROLE_CHANGED: 'Promenjene uloge',
  USER_CENTERS_CHANGED: 'Promenjeni centri',
  USER_PERMISSION_OVERRIDE_CHANGED: 'Promenjena dodatna/oduzeta prava',
  USER_DEACTIVATED: 'Deaktiviran',
  USER_REACTIVATED: 'Ponovo aktiviran',
  USER_PASSWORD_RESET_BY_ADMIN: 'Administrator generisao novu privremenu lozinku',
  USER_PASSWORD_CHANGED: 'Korisnik postavio svoju lozinku',
  USER_AUTH_BANNED: 'Prijava blokirana (Auth)',
  USER_AUTH_UNBANNED: 'Prijava odblokirana (Auth)',
  USER_AUTH_SYNC_FAILED: 'Auth usklađivanje nije uspelo',
  ADMIN_USER_LINKED: 'Profil povezan sa Auth nalogom',
  ADMIN_USER_ACCESS_SET: 'Pristup postavljen (tehnički zapis)',
};

export function auditLabel(action: string): string {
  if (AUDIT_LABEL[action]) return AUDIT_LABEL[action];
  // Redovi iz generičkog audit trigera: USER_ROLE_INSERT, USER_CENTER_ACCESS_DELETE…
  const m = action.match(/^(USER_ROLE|USER_CENTER_ACCESS|USER_PERMISSION_OVERRIDE)_(INSERT|UPDATE|DELETE)$/);
  if (m) {
    const what = { USER_ROLE: 'uloga', USER_CENTER_ACCESS: 'centar', USER_PERMISSION_OVERRIDE: 'izuzetak' }[m[1]];
    const op = { INSERT: 'dodat(a)', UPDATE: 'izmenjen(a)', DELETE: 'uklonjen(a)' }[m[2]];
    return `Tehnički zapis: ${what} ${op}`;
  }
  return action;
}

/** Semantički događaji idu prvi; tehnički trigger zapisi se mogu sakriti. */
export function isTechnicalAudit(action: string): boolean {
  return action === 'ADMIN_USER_ACCESS_SET' || /^(USER_ROLE|USER_CENTER_ACCESS|USER_PERMISSION_OVERRIDE)_/.test(action);
}
