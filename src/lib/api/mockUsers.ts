/**
 * Mock „Korisnici" — preslikava semantiku 0076 + Edge Function-a bez baze.
 *
 * Ovo NIJE izvor istine za prava (to je baza); služi lokalnom razvoju i
 * testovima toka ekrana. Pravila koja se ovde ponavljaju namerno koriste iste
 * šifre grešaka kao server (ADMIN_LAST_ADMIN, USER_ALREADY_EXISTS, …).
 */
import { effectiveOf, isValidEmail, normalizeEmail } from '../../features/admin/users';
import { WdrApiError } from './WdrApi';
import { sortByLabel } from '../format/sort';
import type {
  AdminAuthStatus,
  AdminCreateUserInput,
  AdminCreateUserResult,
  AdminResetPasswordResult,
  AdminRoleCatalogItem,
  AdminUpdateUserAccessInput,
  AdminUpdateUserAccessResult,
  AdminUserAuditEvent,
  AdminUserList,
  AdminUserRow,
} from './types';

const OPERATOR_PERMS = [
  'entry.view', 'entry.edit_draft', 'entry.bulk_apply', 'period.submit', 'period.view_status',
  'period.create', 'employee.view', 'employee.create', 'employee.edit', 'employee.assign_center',
  'transport.assign_employee', 'adjustment.create', 'adjustment.submit', 'comment.write',
  'notification.view_own', 'payout.create', 'night_work.declare',
  'courier_stops.view', 'courier_stops.edit', 'courier_stops.submit',
];
const FINANCE_PERMS = [
  'period.view_status', 'finance.queue.view', 'finance.approve', 'finance.return',
  'finance.history.view', 'finance.export', 'adjustment.approve', 'comment.write',
  'notification.view_own', 'courier_stops.view', 'payout.approve',
];
const ADMIN_EXTRA = [
  'centers.manage', 'reference.manage', 'payment_types.manage', 'users.manage', 'roles.manage',
  'analytics.ba.view', 'controls.view', 'controls.manage', 'audit.view', 'cost_center.override',
  'adjustment.manage_all', 'payout.cutover.manage',
];

const PERMISSION_NAMES: Record<string, [string, string]> = {
  'entry.view': ['Pregled unosa', 'entry'], 'entry.edit_draft': ['Izmena radne verzije unosa', 'entry'],
  'entry.bulk_apply': ['Grupne akcije u gridu', 'entry'], 'period.submit': ['Slanje perioda finansijama', 'entry'],
  'period.view_status': ['Pregled statusa prijava', 'entry'], 'period.create': ['Otvaranje perioda', 'entry'],
  'employee.view': ['Pregled zaposlenih', 'entry'], 'employee.create': ['Kreiranje zaposlenog', 'entry'],
  'employee.edit': ['Izmena matičnih podataka zaposlenog', 'admin'],
  'employee.assign_center': ['Raspodela zaposlenog po centrima', 'admin'],
  'transport.assign_employee': ['Dodela prevoza zaposlenom', 'admin'],
  'adjustment.create': ['Kreiranje dodatnog zahteva', 'entry'], 'adjustment.submit': ['Slanje dodatnog zahteva', 'entry'],
  'adjustment.approve': ['Odobrenje dodatnog zahteva', 'finance'],
  'adjustment.manage_all': ['Upravljanje tuđim dodatnim zahtevima', 'admin'],
  'comment.write': ['Pisanje komentara', 'common'], 'notification.view_own': ['Pregled sopstvenih obaveštenja', 'common'],
  'payout.create': ['Dodatne isplate — zahtev', 'entry'], 'payout.approve': ['Dodatne isplate — odobrenje', 'finance'],
  'payout.cutover.manage': ['Tarife dodatnih isplata', 'admin'], 'night_work.declare': ['Prijava noćnog rada', 'entry'],
  'courier_stops.view': ['Pregled stopova kurira', 'entry'], 'courier_stops.edit': ['Unos stopova kurira', 'entry'],
  'courier_stops.submit': ['Slanje stopova kurira', 'entry'],
  'finance.queue.view': ['Pregled reda za odobrenje', 'finance'], 'finance.approve': ['Odobrenje sredstava', 'finance'],
  'finance.return': ['Vraćanje na ispravku', 'finance'], 'finance.history.view': ['Istorija isplata', 'finance'],
  'finance.export': ['Izvoz finansijskih izveštaja', 'finance'],
  'centers.manage': ['Upravljanje centrima', 'admin'], 'reference.manage': ['Upravljanje šifarnicima', 'admin'],
  'payment_types.manage': ['Upravljanje vrstama isplata', 'admin'], 'users.manage': ['Upravljanje korisnicima', 'admin'],
  'roles.manage': ['Upravljanje rolama i permisijama', 'admin'], 'analytics.ba.view': ['BA analitika', 'analytics'],
  'controls.view': ['Pregled kontrolnog centra', 'analytics'], 'controls.manage': ['Konfiguracija kontrolnih pravila', 'admin'],
  'audit.view': ['Pregled audit loga', 'admin'], 'cost_center.override': ['Prebacivanje troška na drugi centar', 'admin'],
};

const SENSITIVE = [
  'finance.approve', 'period.submit_incomplete', 'cost_center.override', 'adjustment.manage_all',
  'users.manage', 'roles.manage', 'controls.review', 'controls.manage',
];

const ROLES: AdminRoleCatalogItem[] = [
  { code: 'DATA_ENTRY_OPERATOR', name: 'Operater unosa', is_system: true,
    description: 'Unosi operativne činjenice za dodeljene centre.', permissions: [...OPERATOR_PERMS].sort() },
  { code: 'FINANCE', name: 'Finansije', is_system: true,
    description: 'Verifikuje i odobrava sredstva.', permissions: [...FINANCE_PERMS].sort() },
  { code: 'SUPER_ADMIN_BA', name: 'Super administrator / BA', is_system: true,
    description: 'Administracija sistema i analitika.',
    permissions: [...new Set([...OPERATOR_PERMS, ...FINANCE_PERMS, ...ADMIN_EXTRA])].sort() },
];

const CENTERS = [
  { id: '10000000-0000-0000-0000-0000000000b6', code: 'B6', name: 'Rakovica', active: true },
  { id: 'c-bz', code: 'BZ', name: 'Bežanija', active: true },
  { id: 'c-ls', code: 'LS', name: 'Leštane', active: true },
  { id: 'c-mk', code: 'MK', name: 'Makiš', active: true },
];

interface MockAuth { state: AdminAuthStatus['state']; confirmed: string | null; lastSignIn: string | null }

/** Samo mock: u pravom režimu privremenu lozinku generiše ISKLJUČIVO Edge Function. */
function mockTemporaryPassword(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(20));
  const c = [...buf].map((b) => a[b % a.length]);
  return [0, 5, 10, 15].map((i) => c.slice(i, i + 5).join('')).join('-');
}

let seq = 100;
const nextId = (p: string) => `${p}-${(seq += 1)}`;
const now = () => new Date().toISOString();

function fail(message: string, code: string, raw?: unknown): never {
  throw new WdrApiError(message, code, raw);
}

export class MockUserDirectory {
  readonly me: string;
  private users: AdminUserRow[];
  private auth = new Map<string, MockAuth>();
  private audit: AdminUserAuditEvent[] = [];
  /** Test može da simulira trenutak kada Edge Function nije deployovana. */
  edgeAvailable = true;

  constructor(me = 'p4') {
    this.me = me;
    const center = (code: string, write: boolean) => {
      const c = CENTERS.find((x) => x.code === code)!;
      return { center_id: c.id, center_code: c.code, center_name: c.name, center_active: c.active, can_write: write };
    };
    const row = (id: string, name: string, email: string, role: AdminRoleCatalogItem,
                 centers: AdminUserRow['centers']): AdminUserRow => ({
      profile_id: id, auth_user_id: `auth-${id}`, full_name: name, email, active: true,
      created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z',
      roles: [{ code: role.code, name: role.name }], centers, permission_overrides: [],
      all_centers: role.permissions.includes('centers.manage'), must_change_password: false,
      password_changed_at: '2026-09-01T09:00:00Z', last_password_reset_at: null, created_by_name: null,
    });
    this.users = [
      row('p4', 'Administrator (mock)', 'admin@wdr.local', ROLES[2], []),
      row('p1', 'Operater B6 (mock)', 'operater@wdr.local', ROLES[0], [center('B6', true)]),
      row('p3', 'Finansije (mock)', 'finansije@wdr.local', ROLES[1], []),
    ];
    for (const u of this.users) {
      this.auth.set(u.auth_user_id, { state: 'ACTIVE', confirmed: '2026-09-01T09:00:00Z', lastSignIn: '2026-10-06T07:30:00Z' });
    }
  }

  private find(id: string): AdminUserRow {
    const u = this.users.find((x) => x.profile_id === id);
    if (!u) fail('Korisnik ne postoji (ADMIN_USER_NOT_FOUND).', 'ADMIN_USER_NOT_FOUND');
    return u;
  }

  private log(action: string, profileId: string, changes: unknown) {
    const actor = this.users.find((u) => u.profile_id === this.me);
    this.audit.unshift({ id: this.audit.length + 1, action, entity_type: 'PROFILE', occurred_at: now(),
      actor_id: this.me, actor_name: actor?.full_name ?? null, changes });
    (this.audit[0] as AdminUserAuditEvent & { entity_id?: string }).entity_id = profileId;
  }

  private adminCount(users = this.users): number {
    return users.filter((u) => u.active && (() => {
      const e = effectiveOf(u, ROLES); return e.has('users.manage') && e.has('roles.manage');
    })()).length;
  }

  private requireEdge() {
    if (!this.edgeAvailable) {
      fail('Server funkcija za upravljanje korisnicima nije dostupna.', 'ADMIN_USERS_FN_UNAVAILABLE');
    }
  }

  list(): AdminUserList {
    return {
      me: this.me,
      can: { users: true, roles: true },
      active_admin_count: this.adminCount(),
      roles: ROLES.map((r) => ({ ...r, permissions: [...r.permissions] })),
      permissions: Object.entries(PERMISSION_NAMES)
        .map(([code, [name, area]]) => ({ code, name, area }))
        .sort((a, b) => a.area.localeCompare(b.area) || a.code.localeCompare(b.code)),
      centers: CENTERS.map((c) => ({ ...c })),
      sensitive_permissions: [...SENSITIVE],
      users: sortByLabel(structuredClone(this.users), (u) => u.full_name),
    };
  }

  authStatus(): AdminAuthStatus[] {
    this.requireEdge();
    return this.users.map((u) => {
      const a = this.auth.get(u.auth_user_id);
      return {
        auth_user_id: u.auth_user_id, state: a?.state ?? 'MISSING',
        email_confirmed_at: a?.confirmed ?? null,
        last_sign_in_at: a?.lastSignIn ?? null, banned_until: a?.state === 'BANNED' ? '2126-01-01T00:00:00Z' : null,
      };
    });
  }

  create(i: AdminCreateUserInput): AdminCreateUserResult {
    this.requireEdge();
    const email = normalizeEmail(i.email);
    if (!isValidEmail(email)) fail('Email nije ispravnog oblika (ADMIN_INVALID_EMAIL).', 'ADMIN_INVALID_EMAIL');
    if (!i.first_name.trim() || !i.last_name.trim()) {
      fail('Ime i prezime su obavezni (ADMIN_INVALID_FULL_NAME).', 'ADMIN_INVALID_FULL_NAME');
    }
    if (i.role_codes.length === 0) fail('Uloga je obavezna (ADMIN_ROLE_REQUIRED).', 'ADMIN_ROLE_REQUIRED');
    const roles = i.role_codes.map((c) => ROLES.find((r) => r.code === c)
      ?? fail(`Nepoznata uloga ${c} (ADMIN_UNKNOWN_ROLE).`, 'ADMIN_UNKNOWN_ROLE'));
    const existing = this.users.find((u) => u.email === email);
    if (existing) {
      fail('Korisnik sa ovim emailom već postoji.', 'USER_ALREADY_EXISTS',
        { status: 409, profile_id: existing.profile_id, active: existing.active });
    }
    if (this.orphanAuthEmails.has(email) && !i.link_existing_auth) {
      fail('Supabase Auth nalog sa ovim emailom već postoji, ali nije povezan sa WDR profilom.',
        'AUTH_USER_EXISTS_UNLINKED', { status: 409 });
    }
    const centers = i.center_access.map((c) => {
      const x = CENTERS.find((k) => k.code === c.center_code)
        ?? fail('Nepoznat centar (ADMIN_UNKNOWN_CENTER).', 'ADMIN_UNKNOWN_CENTER');
      return { center_id: x.id, center_code: x.code, center_name: x.name, center_active: x.active, can_write: c.can_write };
    });
    const id = nextId('p');
    const full = `${i.first_name.trim()} ${i.last_name.trim()}`;
    const row: AdminUserRow = {
      profile_id: id, auth_user_id: nextId('auth'), full_name: full, email, active: true,
      created_at: now(), updated_at: now(), roles: roles.map((r) => ({ code: r.code, name: r.name })),
      centers, permission_overrides: [], all_centers: roles.some((r) => r.permissions.includes('centers.manage')),
      must_change_password: true, password_changed_at: null, last_password_reset_at: null,
      created_by_name: 'Administrator (mock)',
    };
    this.users.push(row);
    this.orphanAuthEmails.delete(email);
    this.auth.set(row.auth_user_id, { state: 'ACTIVE', confirmed: now(), lastSignIn: null });
    this.log('USER_CREATED', id, { email, must_change_password: true });
    return { profile_id: id, auth_user_id: row.auth_user_id, email, full_name: full,
             auth_user_reused: Boolean(i.link_existing_auth), must_change_password: true,
             temporary_password: mockTemporaryPassword() };
  }

  /** Test pomoćnik: Auth nalog bez WDR profila (npr. ranije ručno napravljen). */
  readonly orphanAuthEmails = new Set<string>();

  update(i: AdminUpdateUserAccessInput): AdminUpdateUserAccessResult {
    const u = this.find(i.profile_id);
    const next = structuredClone(u);
    const changed: AdminUpdateUserAccessResult['changed'] = [];
    if (i.role_codes) {
      if (i.role_codes.length === 0) fail('Bar jedna uloga (ADMIN_ROLE_REQUIRED).', 'ADMIN_ROLE_REQUIRED');
      next.roles = i.role_codes.map((c) => {
        const r = ROLES.find((x) => x.code === c) ?? fail('Nepoznata uloga (ADMIN_UNKNOWN_ROLE).', 'ADMIN_UNKNOWN_ROLE');
        return { code: r.code, name: r.name };
      });
      next.all_centers = ROLES.filter((r) => i.role_codes!.includes(r.code)).some((r) => r.permissions.includes('centers.manage'));
      changed.push('roles');
    }
    if (i.center_access) {
      next.centers = i.center_access.map((c) => {
        const x = CENTERS.find((k) => k.code === c.center_code)
          ?? fail('Nepoznat centar (ADMIN_UNKNOWN_CENTER).', 'ADMIN_UNKNOWN_CENTER');
        return { center_id: x.id, center_code: x.code, center_name: x.name, center_active: x.active, can_write: c.can_write };
      });
      changed.push('centers');
    }
    if (i.permission_overrides) {
      for (const o of i.permission_overrides) {
        if ((o.reason ?? '').trim().length < 10) {
          fail('Obrazloženje (ADMIN_OVERRIDE_REASON_REQUIRED).', 'ADMIN_OVERRIDE_REASON_REQUIRED');
        }
      }
      next.permission_overrides = i.permission_overrides.map((o) => ({ ...o }));
      changed.push('overrides');
    }
    if (u.profile_id === this.me && !effectiveOf(next, ROLES).has('users.manage')) {
      fail('Ne možete sebi oduzeti upravljanje korisnicima (ADMIN_SELF_LOCKOUT).', 'ADMIN_SELF_LOCKOUT');
    }
    const after = this.users.map((x) => (x.profile_id === u.profile_id ? next : x));
    if (this.adminCount(after) === 0) fail('Bez administratora (ADMIN_LAST_ADMIN).', 'ADMIN_LAST_ADMIN');
    next.updated_at = now();
    this.users = after;
    for (const c of changed) {
      this.log({ roles: 'USER_ROLE_CHANGED', centers: 'USER_CENTERS_CHANGED',
                 overrides: 'USER_PERMISSION_OVERRIDE_CHANGED' }[c], u.profile_id, { reason: i.reason ?? null });
    }
    return { profile_id: u.profile_id, changed };
  }

  setActive(profileId: string, active: boolean, reason?: string | null) {
    const u = this.find(profileId);
    if (!active && profileId === this.me) {
      fail('Ne možete deaktivirati sopstveni nalog (ADMIN_SELF_DEACTIVATE).', 'ADMIN_SELF_DEACTIVATE');
    }
    if (u.active === active) return { changed: false };
    const after = this.users.map((x) => (x.profile_id === profileId ? { ...x, active } : x));
    if (!active && this.adminCount(after) === 0) fail('Bez administratora (ADMIN_LAST_ADMIN).', 'ADMIN_LAST_ADMIN');
    this.users = after.map((x) => (x.profile_id === profileId ? { ...x, updated_at: now() } : x));
    const a = this.auth.get(u.auth_user_id);
    if (a && this.edgeAvailable) a.state = active ? (a.confirmed ? 'ACTIVE' : 'UNCONFIRMED') : 'BANNED';
    this.log(active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', profileId, { reason: reason ?? null });
    return { changed: true };
  }

  resetPassword(profileId: string, reason?: string | null): AdminResetPasswordResult {
    this.requireEdge();
    const u = this.find(profileId);
    if (profileId === this.me) fail('Sopstvenu lozinku menjate na ekranu za promenu lozinke (ADMIN_SELF_RESET).', 'ADMIN_SELF_RESET');
    if (!u.active) fail('Korisnik je deaktiviran (ADMIN_USER_INACTIVE).', 'ADMIN_USER_INACTIVE');
    u.must_change_password = true;
    u.last_password_reset_at = now();
    this.log('USER_PASSWORD_RESET_BY_ADMIN', profileId, { reason: reason ?? null });
    return { profile_id: profileId, email: u.email, full_name: u.full_name,
             must_change_password: true, temporary_password: mockTemporaryPassword() };
  }

  /** Test pomoćnik: korisnik je sam postavio lozinku (Edge change_own_password). */
  completePasswordChange(profileId: string) {
    const u = this.find(profileId);
    u.must_change_password = false;
    u.password_changed_at = now();
    this.log('USER_PASSWORD_CHANGED', profileId, { was_required: true });
  }

  auditFor(profileId: string): AdminUserAuditEvent[] {
    this.find(profileId);
    return this.audit.filter((e) => (e as AdminUserAuditEvent & { entity_id?: string }).entity_id === profileId);
  }
}
