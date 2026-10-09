import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { SearchableMultiSelect, type MultiOption } from '../components/SearchableMultiSelect';
import {
  EMPTY_FILTER,
  EMPTY_NEW_USER,
  OVERRIDE_REASON_MIN,
  SOURCE_LABEL,
  type AccessDraft,
  type NewUserErrors,
  type NewUserForm,
  type OverrideChoice,
  type UserFilter,
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
  newUserPayload,
  permissionRows,
  resetBlocker,
  setOverride,
  userStatus,
  validateNewUser,
  wideningWarnings,
} from '../features/admin/users';
import { messageForCode } from '../features/grid/errors';
import { centerLabel, sortByLabel, sortCenters } from '../lib/format/sort';
import { WdrApiError } from '../lib/api';
import type {
  TemporaryCredentials,
  AdminAuthStatus,
  AdminUserAuditEvent,
  AdminUserList,
  AdminUserRow,
} from '../lib/api/types';
import { formatDateTime } from '../lib/format/date';
import { useAuth } from '../lib/auth/AuthProvider';
import type { WdrApi } from '../lib/api/WdrApi';

type Notice = { kind: 'success' | 'warning' | 'error' | 'info'; text: string; openProfileId?: string };

function errText(err: unknown): string {
  const code = err instanceof WdrApiError ? err.code : null;
  return messageForCode(code, err instanceof Error ? err.message : undefined);
}

function errProfileId(err: unknown): string | undefined {
  if (!(err instanceof WdrApiError) || err.code !== 'USER_ALREADY_EXISTS') return undefined;
  const id = (err.raw as { profile_id?: unknown } | undefined)?.profile_id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Administracija → Korisnici.
 *
 * Lista i izmena pristupa idu direktno kroz PostgREST (api.rpc_admin_*), a
 * kreiranje (privremena lozinka, bez emaila), reset lozinke i (de)aktivacija kroz
 * Edge Function `wdr-admin-users`. Privremena lozinka postoji samo u memoriji
 * dijaloga koji je prikazuje jednom.
 * Sakriveno dugme nije kontrola pristupa: svaki poziv server proverava ponovo.
 */
export function AdminUsers() {
  const { api } = useAuth();
  const [list, setList] = useState<AdminUserList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [auth, setAuth] = useState<Map<string, AdminAuthStatus>>(new Map());
  const [authNote, setAuthNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<UserFilter>(EMPTY_FILTER);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Privremena lozinka: samo ovde, u memoriji, do zatvaranja dijaloga.
  const [credentials, setCredentials] = useState<(TemporaryCredentials & { kind: 'created' | 'reset' }) | null>(null);

  const loadAuth = useCallback(async () => {
    try {
      const statuses = await api.adminUsersAuthStatus();
      setAuth(new Map(statuses.map((s) => [s.auth_user_id, s])));
      setAuthNote(null);
    } catch (err) {
      // Lista ostaje tačna i bez ovoga; prikazuje se samo napomena.
      setAuthNote(`Stanje Auth naloga (poslednja prijava, blokada) trenutno nije dostupno: ${errText(err)}`);
    }
  }, [api]);

  const load = useCallback(async () => {
    try {
      setList(await api.adminListUsers());
      setLoadError(null);
    } catch (err) {
      setLoadError(errText(err));
      return;
    }
    void loadAuth();
  }, [api, loadAuth]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => (list ? filterUsers(list.users, filter, auth) : []),
    [list, filter, auth],
  );
  // Isto pravilo kao cela aplikacija (lib/format/sort.ts, 16bbf2c).
  const roleOptions = useMemo(() => (list ? sortByLabel(list.roles, (r) => r.name) : []), [list]);

  if (loadError) return <Banner kind="error">{loadError}</Banner>;
  if (!list) return <Spinner label="Čitanje korisnika…" />;

  const editing = editingId ? list.users.find((u) => u.profile_id === editingId) ?? null : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Korisnici</h1>
          <p>
            Kreiranje naloga, uloge, centri i aktivnost — bez odlaska u Supabase i bez emaila.
            Admin dobija privremenu lozinku jednom i prosleđuje je korisniku; korisnik je pri
            prvoj prijavi menja svojom.
          </p>
        </div>
        <div className="page-head-actions">
          {list.can.roles ? (
            <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setCreating(true); }}>
              + Novi korisnik
            </button>
          ) : (
            <span className="muted small">Novi korisnik zahteva i pravo <code>roles.manage</code>.</span>
          )}
        </div>
      </div>

      {notice && (
        <Banner kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.text}
          {notice.openProfileId && (
            <>
              {' '}
              <button type="button" className="btn btn-small" onClick={() => {
                setEditingId(notice.openProfileId!); setNotice(null);
              }}>Otvori korisnika</button>
            </>
          )}
        </Banner>
      )}
      {authNote && <Banner kind="info">{authNote}</Banner>}

      <div className="filter-row users-filters" role="search">
        <label className="users-search"><span>Pretraga</span>
          <input type="search" value={filter.q} placeholder="ime, prezime ili email"
            onChange={(e) => setFilter({ ...filter, q: e.target.value })} /></label>
        <label><span>Uloga</span>
          <select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value })}>
            <option value="">Sve uloge</option>
            {roleOptions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select></label>
        <label><span>Status</span>
          <select value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value as UserFilter['status'] })}>
            <option value="all">Svi</option>
            <option value="active">Aktivni</option>
            <option value="inactive">Neaktivni</option>
            <option value="pending_password">Čeka promenu lozinke</option>
          </select></label>
        <label><span>Centar</span>
          <select value={filter.center} onChange={(e) => setFilter({ ...filter, center: e.target.value })}>
            <option value="">Svi centri</option>
            {sortCenters(list.centers).map((c) => <option key={c.id} value={c.code}>{centerLabel(c)}</option>)}
          </select></label>
        {(filter.q || filter.role || filter.center || filter.status !== 'all') && (
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setFilter(EMPTY_FILTER)}>
            Poništi filtere
          </button>
        )}
      </div>

      <p className="muted small">
        Prikazano {visible.length} od {list.users.length} · aktivnih administratora: {list.active_admin_count}
      </p>

      {visible.length === 0 ? (
        <EmptyState title="Nema korisnika za izabrane filtere." />
      ) : (
        <div className="table-scroll">
          <table className="list list-compact users-table">
            <thead>
              <tr>
                <th>Ime i prezime</th><th>Uloge</th><th>Centri</th><th>Status</th>
                <th>Poslednja prijava</th><th aria-label="Akcije" />
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => {
                const a = auth.get(u.auth_user_id);
                const st = userStatus(u, a);
                return (
                  <tr key={u.profile_id} className={u.active ? '' : 'row-muted'}>
                    <td>
                      <strong>{u.full_name}</strong>
                      {u.profile_id === list.me && <span className="chip">vi</span>}
                      <div className="muted small">{u.email}</div>
                    </td>
                    <td>{sortByLabel(u.roles, (r) => r.name).map((r) => r.name).join(', ') || '—'}</td>
                    <td className="small">
                      {u.all_centers
                        ? <span title="Pravo centers.manage">Svi centri (administrator)</span>
                        : u.centers.length === 0 ? '—'
                        : sortCenters(u.centers.map((c) => ({ ...c, code: c.center_code, name: c.center_name })))
                          .map((c) => (
                            <div key={c.center_code}>
                              {centerLabel(c)}
                              {!c.can_write && <span className="muted"> · samo pregled</span>}
                            </div>
                          ))}
                    </td>
                    <td><span className={`chip chip-status-${st.tone}`}>{st.label}</span></td>
                    <td className="small">
                      {a ? (a.last_sign_in_at ? formatDateTime(a.last_sign_in_at) : 'nikad') : '—'}
                    </td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-small" onClick={() => {
                        setNotice(null); setEditingId(u.profile_id);
                      }}>Izmeni</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewUserDialog
          api={api}
          list={list}
          onClose={() => setCreating(false)}
          onCreated={async (c) => {
            setCreating(false);
            setCredentials({ ...c, kind: 'created' });
            await load();
          }}
          onOpenExisting={(id) => { setCreating(false); setEditingId(id); }}
        />
      )}

      {editing && (
        <EditUserDialog
          key={editing.profile_id + editing.updated_at}
          api={api}
          list={list}
          user={editing}
          auth={auth.get(editing.auth_user_id) ?? null}
          onClose={() => setEditingId(null)}
          onChanged={async (n, close) => {
            setNotice(n);
            if (close) setEditingId(null);
            await load();
          }}
          onCredentials={async (c) => {
            setEditingId(null);
            setCredentials({ ...c, kind: 'reset' });
            await load();
          }}
        />
      )}

      {credentials && (
        <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
      )}
    </div>
  );
}

// =============================================================================
// Novi korisnik
// =============================================================================

function centerOptions(list: AdminUserList, keep: readonly string[] = []): MultiOption[] {
  // Po NAZIVU centra (sortCenters); red opcije: „B6 — Rakovica" (šifra + naziv).
  return sortCenters(list.centers)
    .filter((c) => c.active || keep.includes(c.code))
    .map((c) => ({ value: c.code, label: c.code, hint: `— ${c.name}${c.active ? '' : ' (neaktivan)'}` }));
}

function roleMultiOptions(list: AdminUserList): MultiOption[] {
  return sortByLabel(list.roles, (r) => r.name).map((r) => ({ value: r.code, label: r.name, hint: r.code }));
}

function NewUserDialog({
  api, list, onClose, onCreated, onOpenExisting,
}: {
  api: WdrApi;
  list: AdminUserList;
  onClose(): void;
  onCreated(c: TemporaryCredentials): Promise<void>;
  onOpenExisting(profileId: string): void;
}) {
  const [form, setForm] = useState<NewUserForm>(EMPTY_NEW_USER);
  const [errors, setErrors] = useState<NewUserErrors>({});
  const [error, setError] = useState<{ text: string; profileId?: string; unlinkedAuth?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(linkExisting: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.adminCreateUser({ ...newUserPayload(form), link_existing_auth: linkExisting });
      await onCreated({ email: r.email, full_name: r.full_name, temporary_password: r.temporary_password });
    } catch (err) {
      setError({
        text: errText(err),
        profileId: errProfileId(err),
        unlinkedAuth: err instanceof WdrApiError && err.code === 'AUTH_USER_EXISTS_UNLINKED',
      });
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateNewUser(form);
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    const warnings = wideningWarnings(null, {
      role_codes: form.role_codes,
      centers: form.center_codes.map((code) => ({ code, write: form.center_write })),
      overrides: [],
    }, list);
    const roleNames = list.roles.filter((r) => form.role_codes.includes(r.code)).map((r) => r.name);
    const summary = [
      `Korisnik: ${fullNameOf(form)}`,
      `Email: ${form.email.trim().toLowerCase()}`,
      `Uloge: ${roleNames.join(', ')}`,
      `Centri: ${form.center_codes.length === 0 ? 'bez centra' : form.center_codes.join(', ')}`
        + (form.center_codes.length > 0 ? (form.center_write ? ' (upis i pregled)' : ' (samo pregled)') : ''),
      ...(warnings.length ? ['', ...warnings] : []),
      '',
      'Biće generisana privremena lozinka koju vi prosleđujete korisniku (ne šalje se email).',
      'Kreirati korisnika?',
    ].join('\n');
    if (!window.confirm(summary)) return;
    await create(false);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Novi korisnik">
      <form className="modal-card" onSubmit={submit} noValidate>
        <h2>Novi korisnik</h2>
        <p className="muted small">
          Lozinku ne birate vi: server generiše jaku privremenu lozinku i prikazuje je jednom. Korisnik
          je pri prvoj prijavi mora zameniti svojom. Email se ne šalje.
        </p>

        {error && (
          <Banner kind="error">
            {error.text}
            {error.profileId && (
              <> <button type="button" className="btn btn-small"
                onClick={() => onOpenExisting(error.profileId!)}>Otvori postojećeg korisnika</button></>
            )}
            {error.unlinkedAuth && (
              <div style={{ marginTop: 6 }}>
                Ako je to nalog ove osobe (npr. ranije ručno napravljen u Supabase-u), možete ga povezati.
                Dosadašnja lozinka tog naloga prestaje da važi.{' '}
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => {
                  if (!window.confirm('Povezati postojeći Auth nalog sa ovim WDR korisnikom i generisati novu privremenu lozinku?')) return;
                  void create(true);
                }}>Poveži postojeći Auth nalog</button>
              </div>
            )}
          </Banner>
        )}

        <div className="form-grid">
          <label><span>Ime</span>
            <input value={form.first_name} autoFocus autoComplete="off" aria-invalid={Boolean(errors.first_name)}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            {errors.first_name && <small className="field-error">{errors.first_name}</small>}
          </label>
          <label><span>Prezime</span>
            <input value={form.last_name} autoComplete="off" aria-invalid={Boolean(errors.last_name)}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            {errors.last_name && <small className="field-error">{errors.last_name}</small>}
          </label>
          <label className="full-width"><span>Email</span>
            <input type="email" value={form.email} autoComplete="off" aria-invalid={Boolean(errors.email)}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {errors.email && <small className="field-error">{errors.email}</small>}
          </label>
        </div>

        <div className="users-form-block">
          <SearchableMultiSelect
            id="nu-roles"
            label="Uloga"
            options={roleMultiOptions(list)}
            value={form.role_codes}
            onChange={(v) => setForm({ ...form, role_codes: v })}
            emptyText="Izaberite ulogu"
            searchPlaceholder="Pretraga uloge…"
            sort={false}
          />
          {errors.role_codes && <small className="field-error">{errors.role_codes}</small>}
          <RolePermissionHint list={list} roleCodes={form.role_codes} />
        </div>

        <div className="users-form-block">
          <SearchableMultiSelect
            id="nu-centers"
            label="Centri"
            options={centerOptions(list)}
            value={form.center_codes}
            onChange={(v) => setForm({ ...form, center_codes: v })}
            emptyText="Bez centra"
            searchPlaceholder="Pretraga centra…"
            sort={false}
          />
          <div className="segmented users-write" role="radiogroup" aria-label="Nivo pristupa centrima">
            <label><input type="radio" checked={form.center_write}
              onChange={() => setForm({ ...form, center_write: true })} /> Upis i pregled</label>
            <label><input type="radio" checked={!form.center_write}
              onChange={() => setForm({ ...form, center_write: false })} /> Samo pregled</label>
          </div>
          <p className="muted small">
            Upis važi samo uz pravo iz uloge (npr. izmena unosa). Pristup svim centrima, uključujući
            buduće, daje isključivo pravo <code>centers.manage</code> (administratorska uloga).
          </p>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Otkaži</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Kreiranje…' : 'Kreiraj korisnika'}
          </button>
        </div>
      </form>
    </div>
  );
}

function RolePermissionHint({ list, roleCodes }: { list: AdminUserList; roleCodes: string[] }) {
  if (roleCodes.length === 0) return null;
  const names = new Map(list.permissions.map((p) => [p.code, p.name]));
  const perms = [...new Set(list.roles.filter((r) => roleCodes.includes(r.code)).flatMap((r) => r.permissions))];
  const sensitive = perms.filter((p) => list.sensitive_permissions.includes(p));
  return (
    <details className="muted small">
      <summary>Uloga daje {perms.length} prava{sensitive.length ? `, od toga ${sensitive.length} osetljivih` : ''}</summary>
      <ul className="users-perm-list">
        {sortByLabel(perms, (p) => names.get(p) ?? p).map((p) => (
          <li key={p}>{names.get(p) ?? p} <code>{p}</code>
            {list.sensitive_permissions.includes(p) && <span className="chip chip-warn">osetljiva</span>}</li>
        ))}
      </ul>
    </details>
  );
}

// =============================================================================
// Izmena korisnika
// =============================================================================

type PermView = 'exceptions' | 'effective' | 'all';

function EditUserDialog({
  api, list, user, auth, onClose, onChanged, onCredentials,
}: {
  api: WdrApi;
  list: AdminUserList;
  user: AdminUserRow;
  auth: AdminAuthStatus | null;
  onClose(): void;
  onChanged(n: Notice, close: boolean): Promise<void>;
  onCredentials(c: TemporaryCredentials): Promise<void>;
}) {
  const [draft, setDraft] = useState<AccessDraft>(() => draftFromUser(user));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permView, setPermView] = useState<PermView>('exceptions');
  const [permQ, setPermQ] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [statusReason, setStatusReason] = useState('');
  const [audit, setAudit] = useState<AdminUserAuditEvent[] | null>(null);
  const [showTech, setShowTech] = useState(false);

  const canRoles = list.can.roles;
  const isMe = user.profile_id === list.me;
  const st = userStatus(user, auth);
  const blocker = deactivateBlocker(user, list);
  const resetBlock = resetBlocker(user, list);
  const payload = accessUpdatePayload(user, draft, canRoles, reason);
  const dirty = hasAccessChanges(payload);
  const keepCenters = user.centers.map((c) => c.center_code);

  const rows = useMemo(() => permissionRows(
    list.permissions, list.roles, draft.role_codes, draft.overrides, list.sensitive_permissions,
  ), [list, draft.role_codes, draft.overrides]);

  const shownRows = rows.filter((r) => {
    if (permView === 'exceptions' && r.override === 'NONE') return false;
    if (permView === 'effective' && !r.effective && r.override === 'NONE') return false;
    const q = permQ.trim().toLowerCase();
    return !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      || r.area.toLowerCase().includes(q);
  });
  const counts = {
    role: rows.filter((r) => r.source === 'ROLE').length,
    grant: rows.filter((r) => r.source === 'GRANT').length,
    revoke: rows.filter((r) => r.source === 'REVOKE').length,
  };

  async function act(fn: () => Promise<Notice>, close = false) {
    setBusy(true);
    setError(null);
    try {
      const n = await fn();
      await onChanged(n, close);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const problems = draftProblems(draft);
    if (problems.length > 0) { setError(problems.join(' ')); return; }
    const warnings = wideningWarnings(user, draft, list);
    if (warnings.length > 0 && !window.confirm(`${user.full_name}\n\n${warnings.join('\n')}\n\nNastaviti?`)) return;
    void act(async () => {
      const r = await api.adminUpdateUserAccess(payload);
      const what = r.changed.map((c) => ({ roles: 'uloge', centers: 'centri', overrides: 'dodatna/oduzeta prava' }[c]));
      return { kind: 'success', text: what.length
        ? `Sačuvano za ${user.full_name}: ${what.join(', ')}. Važi od sledeće provere prava (sledeći zahtev / osvežavanje).`
        : 'Nema izmena za čuvanje.' };
    }, true);
  }

  async function loadAudit() {
    try { setAudit(await api.adminUserAudit(user.profile_id)); } catch (err) { setError(errText(err)); }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Korisnik ${user.full_name}`}>
      <div className="modal-card users-edit">
        <div className="users-edit-head">
          <div>
            <h2>{user.full_name} {isMe && <span className="chip">vi</span>}</h2>
            <p className="muted small">
              {user.email} · <span className={`chip chip-status-${st.tone}`}>{st.label}</span>
              {' · '}kreiran {formatDateTime(user.created_at)}
              {user.created_by_name ? ` (${user.created_by_name})` : ''}
              {user.password_changed_at ? ` · lozinku postavio ${formatDateTime(user.password_changed_at)}` : ''}
              {user.last_password_reset_at ? ` · poslednji reset ${formatDateTime(user.last_password_reset_at)}` : ''}
              {auth ? ` · poslednja prijava ${auth.last_sign_in_at ? formatDateTime(auth.last_sign_in_at) : 'nikad'}` : ''}
            </p>
          </div>
          <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Zatvori">×</button>
        </div>

        {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
        {!user.active && (
          <Banner kind="warning">
            Korisnik je deaktiviran i nema pristup aplikaciji. Profil, unosi, odobrenja i istorija su sačuvani.
          </Banner>
        )}

        {/* ------------------------------------------------------- uloge -- */}
        <section className="users-form-block">
          <h3>Uloge</h3>
          <SearchableMultiSelect
            id="eu-roles"
            label="Uloge korisnika"
            options={roleMultiOptions(list)}
            value={draft.role_codes}
            onChange={(v) => setDraft({ ...draft, role_codes: v })}
            emptyText="Bez uloge"
            disabled={!canRoles}
            sort={false}
          />
          {!canRoles && (
            <p className="muted small">Dodela uloga zahteva pravo <code>roles.manage</code>. Centre možete menjati.</p>
          )}
        </section>

        {/* ------------------------------------------------------ centri -- */}
        <section className="users-form-block">
          <h3>Centri</h3>
          {user.all_centers && (
            <p className="muted small">
              Uloga ovog korisnika daje <code>centers.manage</code>, pa vidi <strong>sve centre</strong>
              {' '}bez obzira na listu ispod.
            </p>
          )}
          <SearchableMultiSelect
            id="eu-centers"
            label="Pristup centrima"
            options={centerOptions(list, keepCenters)}
            value={draft.centers.map((c) => c.code)}
            onChange={(codes) => setDraft({
              ...draft,
              centers: codes.map((code) => draft.centers.find((c) => c.code === code) ?? { code, write: true }),
            })}
            emptyText="Bez centra"
            sort={false}
          />
          {draft.centers.length > 0 && (
            <table className="list list-compact users-centers">
              <tbody>
                {sortCenters(draft.centers.map((c) => ({
                  ...c, name: list.centers.find((x) => x.code === c.code)?.name ?? c.code,
                }))).map((c) => (
                  <tr key={c.code}>
                    <td>{centerLabel(c)}</td>
                    <td>
                      <label className="users-inline">
                        <input type="checkbox" checked={c.write} onChange={(e) => setDraft({
                          ...draft,
                          centers: draft.centers.map((x) => (x.code === c.code ? { ...x, write: e.target.checked } : x)),
                        })} /> upis
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ------------------------------------------------------- prava -- */}
        <section className="users-form-block">
          <h3>Prava</h3>
          {!canRoles ? (
            <p className="muted small">
              Dodatna i oduzeta prava vidi i menja samo korisnik sa pravom <code>roles.manage</code>.
            </p>
          ) : (
            <>
              <p className="muted small">
                Efektivna prava = prava iz uloga + dodatno dozvoljena − oduzeta. Oduzeto uvek pobeđuje.
                {' '}{SOURCE_LABEL.ROLE}: {counts.role} · {SOURCE_LABEL.GRANT}: {counts.grant}
                {' '}· {SOURCE_LABEL.REVOKE}: {counts.revoke}
              </p>
              <div className="filter-row">
                <div className="segmented" role="tablist" aria-label="Prikaz prava">
                  {([['exceptions', 'Samo izuzeci'], ['effective', 'Efektivna prava'], ['all', 'Sva prava']] as const)
                    .map(([k, l]) => (
                      <button key={k} type="button" role="tab" aria-selected={permView === k}
                        className={permView === k ? 'btn btn-small btn-primary' : 'btn btn-small btn-quiet'}
                        onClick={() => setPermView(k)}>{l}</button>
                    ))}
                </div>
                <input type="search" value={permQ} placeholder="pretraga prava"
                  aria-label="Pretraga prava" onChange={(e) => setPermQ(e.target.value)} />
              </div>
              {shownRows.length === 0 ? (
                <p className="muted small">
                  {permView === 'exceptions'
                    ? 'Korisnik nema izuzetaka — ima tačno prava svojih uloga. Izaberite „Sva prava" da dodate izuzetak.'
                    : 'Nema prava za prikaz.'}
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="list list-compact">
                    <thead>
                      <tr><th>Pravo</th><th>Izvor</th><th>Efektivno</th><th>Izuzetak</th><th>Obrazloženje</th></tr>
                    </thead>
                    <tbody>
                      {shownRows.map((r) => (
                        <tr key={r.code} className={r.override === 'NONE' ? '' : 'row-focus'}>
                          <td>
                            {r.name} {r.sensitive && <span className="chip chip-warn">osetljiva</span>}
                            <div className="muted small"><code>{r.code}</code></div>
                          </td>
                          <td className="small">
                            <span className={`chip chip-source-${r.source.toLowerCase()}`}>{SOURCE_LABEL[r.source]}</span>
                            {r.fromRoles.length > 0 && <div className="muted">{r.fromRoles.join(', ')}</div>}
                            {r.redundant && <div className="muted">već daje uloga</div>}
                          </td>
                          <td>{r.effective ? 'da' : 'ne'}</td>
                          <td>
                            <select value={r.override} aria-label={`Izuzetak za ${r.code}`}
                              onChange={(e) => setDraft({
                                ...draft,
                                overrides: setOverride(draft.overrides, r.code, e.target.value as OverrideChoice),
                              })}>
                              <option value="NONE">Bez izuzetka</option>
                              <option value="GRANT">Dodatno dozvoli</option>
                              <option value="REVOKE">Oduzmi korisniku</option>
                            </select>
                          </td>
                          <td>
                            <input value={r.reason} disabled={r.override === 'NONE'}
                              placeholder={r.override === 'NONE' ? '—' : `zašto (min. ${OVERRIDE_REASON_MIN} znakova)`}
                              aria-label={`Obrazloženje za ${r.code}`}
                              onChange={(e) => setDraft({
                                ...draft,
                                overrides: setOverride(draft.overrides, r.code, r.override, e.target.value),
                              })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>

        <label className="full-width"><span>Napomena za istoriju izmena (opciono)</span>
          <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
            placeholder="npr. prelazak u centar BZ od 01.11." /></label>

        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>Zatvori</button>
          <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
            {busy ? 'Čuvanje…' : 'Sačuvaj izmene'}
          </button>
        </div>

        {/* ------------------------------------------- status i lozinka -- */}
        <section className="users-form-block users-status">
          <h3>Status i pristup aplikaciji</h3>
          <div className="filter-row">
            <button type="button" className="btn" disabled={busy || Boolean(resetBlock)}
              title={resetBlock ?? undefined}
              onClick={() => {
                if (!window.confirm(`Generisati novu privremenu lozinku za ${user.full_name}?\n\n`
                  + '• dosadašnja lozinka odmah prestaje da važi,\n'
                  + '• korisnik se odjavljuje sa svih uređaja,\n'
                  + '• pri sledećoj prijavi mora da postavi svoju lozinku.')) return;
                setBusy(true);
                setError(null);
                void api.adminResetPassword(user.profile_id, statusReason || null)
                  .then((r) => onCredentials({ email: r.email, full_name: r.full_name,
                                               temporary_password: r.temporary_password }))
                  .catch((err) => setError(errText(err)))
                  .finally(() => setBusy(false));
              }}>
              Generiši novu privremenu lozinku
            </button>
            {user.active ? (
              <button type="button" className="btn btn-danger" disabled={busy || Boolean(blocker)}
                title={blocker ?? undefined} onClick={() => setConfirmDeactivate(true)}>
                Deaktiviraj korisnika
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Ponovo aktivirati ${user.full_name}? Dobija pristup prema sadašnjim ulogama i centrima.`)) return;
                  void act(async () => {
                    const r = await api.adminReactivateUser(user.profile_id, statusReason || null);
                    return r.auth_unban === 'skipped'
                      ? { kind: 'warning', text: `${user.full_name} je ponovo aktiviran u WDR-u. Server funkcija nije dostupna, pa Auth blokada (ako postoji) nije skinuta.` }
                      : { kind: 'success', text: `${user.full_name} je ponovo aktiviran.` };
                  }, true);
                }}>
                Ponovo aktiviraj
              </button>
            )}
          </div>
          {blocker && user.active && <p className="muted small">{blocker}</p>}
          {resetBlock && <p className="muted small">{resetBlock}</p>}
          {user.must_change_password && (
            <p className="muted small">
              Korisnik još nije zamenio privremenu lozinku i do tada nema pristup podacima.
            </p>
          )}

          {confirmDeactivate && (
            <div className="override-box">
              <p>
                <strong>Deaktivirati {user.full_name}?</strong> Gubi pristup odmah (sledeći zahtev). Ništa se ne
                briše: profil, unosi, odobrenja i audit ostaju povezani sa korisnikom.
              </p>
              <label className="full-width"><span>Razlog (opciono)</span>
                <input value={statusReason} maxLength={300} onChange={(e) => setStatusReason(e.target.value)} /></label>
              <div className="filter-row">
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmDeactivate(false)}>Odustani</button>
                <button type="button" className="btn btn-danger" disabled={busy}
                  onClick={() => void act(async () => {
                    const r = await api.adminDeactivateUser(user.profile_id, statusReason || null);
                    if (r.auth_ban === 'ok') return { kind: 'success', text: `${user.full_name} je deaktiviran.` };
                    return { kind: 'warning', text: `${user.full_name} je deaktiviran u WDR-u i nema pristup podacima, `
                      + (r.auth_ban === 'skipped'
                        ? 'ali server funkcija nije dostupna, pa prijava u Auth-u nije blokirana.'
                        : 'ali blokada prijave u Auth-u nije uspela. Pokušajte ponovo kasnije.') };
                  }, true)}>
                  Potvrdi deaktivaciju
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------- istorija -- */}
        <details className="users-form-block" onToggle={(e) => {
          if ((e.target as HTMLDetailsElement).open && audit === null) void loadAudit();
        }}>
          <summary><strong>Istorija izmena</strong></summary>
          {audit === null ? <Spinner label="Čitanje istorije…" /> : (
            <>
              <label className="users-inline small">
                <input type="checkbox" checked={showTech} onChange={(e) => setShowTech(e.target.checked)} />
                prikaži i tehničke zapise
              </label>
              <ul className="users-audit">
                {audit.filter((a) => showTech || !isTechnicalAudit(a.action)).map((a) => (
                  <li key={a.id}>
                    <span className="muted small">{formatDateTime(a.occurred_at)}</span>{' '}
                    <strong>{auditLabel(a.action)}</strong>
                    {a.actor_name && <span className="muted small"> · {a.actor_name}</span>}
                    <AuditDetail changes={a.changes} />
                  </li>
                ))}
                {audit.length === 0 && <li className="muted small">Nema zapisa.</li>}
              </ul>
            </>
          )}
        </details>
      </div>
    </div>
  );
}

function AuditDetail({ changes }: { changes: unknown }) {
  const c = (changes ?? {}) as Record<string, unknown>;
  const fmt = (v: unknown) => (Array.isArray(v)
    ? v.map((x) => (typeof x === 'string' ? x
      : (x as { center_code?: string; permission_code?: string; mode?: string; can_write?: boolean }).center_code
        ? `${(x as { center_code: string }).center_code}${(x as { can_write?: boolean }).can_write ? '' : ' (pregled)'}`
        : `${(x as { mode?: string }).mode === 'REVOKE' ? '−' : '+'}${(x as { permission_code?: string }).permission_code}`))
      .join(', ') || '—'
    : String(v ?? '—'));
  if ('before' in c && 'after' in c) {
    return (
      <div className="muted small">
        {fmt(c.before)} → {fmt(c.after)}{typeof c.reason === 'string' && c.reason ? ` · „${c.reason}"` : ''}
      </div>
    );
  }
  if (typeof c.reason === 'string' && c.reason) return <div className="muted small">„{c.reason}"</div>;
  if (typeof c.was_required === 'boolean') {
    return <div className="muted small">{c.was_required ? 'obavezna promena posle privremene lozinke' : 'dobrovoljna promena'}</div>;
  }
  if (typeof c.error_code === 'string') return <div className="muted small">šifra: {c.error_code}</div>;
  return null;
}

// =============================================================================
// Jednokratni prikaz privremene lozinke
// =============================================================================

/**
 * Prikazuje login i privremenu lozinku JEDNOM. Lozinka je samo u memoriji ove
 * komponente (prop iz stanja koje se briše pri zatvaranju): ne ide u URL,
 * storage, log ni na karticu korisnika i ne može se kasnije ponovo dobiti.
 */
function CredentialsDialog({
  credentials, onClose,
}: {
  credentials: TemporaryCredentials & { kind: 'created' | 'reset' };
  onClose(): void;
}) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const text = credentialsText(credentials);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Podaci za prvu prijavu">
      <div className="modal-card users-credentials">
        <h2>{credentials.kind === 'created' ? 'Korisnik je uspešno kreiran.' : 'Nova privremena lozinka je generisana.'}</h2>
        <p className="muted small">{credentials.full_name}</p>
        <dl className="users-credentials-list">
          <dt>Login</dt>
          <dd><code>{credentials.email}</code></dd>
          <dt>Privremena lozinka</dt>
          <dd><code className="users-temp-password" data-private="true">{credentials.temporary_password}</code></dd>
        </dl>
        <Banner kind="warning">
          <strong>Ova lozinka se više neće moći prikazati.</strong> Prosledite je korisniku lično (van WDR-a).
          Korisnik mora da je promeni pri prvom prijavljivanju.
          {credentials.kind === 'reset' && ' Dosadašnja lozinka više ne važi, a postojeće sesije su ugašene.'}
        </Banner>
        {copied === 'ok' && <Banner kind="success">Podaci su kopirani.</Banner>}
        {copied === 'fail' && <Banner kind="error">Kopiranje nije uspelo — označite i kopirajte ručno.</Banner>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => void copy()}>Kopiraj podatke</button>
          <button type="button" className="btn btn-primary" onClick={() => {
            if (copied !== 'ok' && !window.confirm('Lozinka se posle zatvaranja više neće moći prikazati. Zatvoriti?')) return;
            onClose();
          }}>Zatvori</button>
        </div>
      </div>
    </div>
  );
}
