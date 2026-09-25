import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, EmptyState, Spinner, StatusBadge } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { defaultRange } from '../features/analytics/model';
import { describeRange, rangeNotice } from '../features/analytics/period';
import type {
  AdminConfig,
  AdminReadiness,
  AdjustmentQueue,
  BaCenters,
  BaOverview,
  FinanceQueue,
  NotificationItem,
  SubmissionListItem,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';
import { resolveProfile } from '../features/auth/profile';

/**
 * Početna strana se bira po ULOZI korisnika.
 *
 * Svaki KPI dolazi iz postojećeg API-ja i klik vodi na konkretnu listu ili
 * entitet. Nijedan broj se ne izmišlja: kada podatka nema u API-ju, ekran to
 * kaže umesto da prikaže nulu.
 *
 * Vidljivost je samo UX. Baza i RLS ostaju konačni autoritet — ovde se ne
 * odlučuje ni o jednom pravu.
 */

type Persona = 'finance' | 'admin' | 'ba' | 'operator' | 'none';

/** Koliko otvorenih prijava sme da se proveri kroz preview na početnoj. */
const MAX_COMPLETENESS_LOOKUPS = 3;

/**
 * Početna se bira po ULOZI, ne po permisijama.
 *
 * `SUPER_ADMIN_BA` ima i `finance.queue.view`, pa bi provera po permisijama tu
 * ulogu prikazala kao Finansije — što je pogrešan identitet ekrana. Zato uloga
 * odlučuje kako ekran IZGLEDA, a permisije i dalje odlučuju šta se na njemu sme
 * uraditi (npr. `adjustment.approve` unutar Finance početne).
 *
 * Nalog sa nepoznatom ili nepostojećom ulogom ne ostaje bez ekrana: tada se
 * vraćamo na izvođenje po permisijama, gde `centers.manage` ima prednost nad
 * `finance.queue.view` — superadmin bez mapirane uloge i dalje dobija Admin.
 */
function usePersona(roles: string[] | undefined, can: (p: string) => boolean): Persona {
  return useMemo(() => {
    const { primary } = resolveProfile(roles);
    if (primary === 'admin') return 'admin';
    if (primary === 'finance') return 'finance';
    if (primary === 'operator') return 'operator';

    if (can('centers.manage')) return 'admin';
    if (can('finance.queue.view')) return 'finance';
    if (can('analytics.ba.view')) return 'ba';
    if (can('entry.view')) return 'operator';
    return 'none';
  }, [roles, can]);
}

// ---------------------------------------------------------------- zajedničko --

function Kpi({
  label,
  value,
  hint,
  tone,
  to,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'ok' | 'bad' | 'warn';
  to?: string;
}) {
  const cls = [
    'metric',
    tone === 'ok' ? 'metric-ok' : '',
    tone === 'bad' ? 'metric-bad' : '',
    tone === 'warn' ? 'metric-warn' : '',
    to ? 'metric-link' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {hint && <span className="muted small">{hint}</span>}
    </>
  );

  return to ? (
    <Link className={cls} to={to}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function PageHead({
  name,
  subtitle,
  actions,
}: {
  name: string | undefined;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="preview-head">
      <div>
        <h1>Dobar dan, {name ?? '—'}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}

/** Nepročitana obaveštenja su zajednički signal za sve uloge. */
function useUnread(): { unread: number; failed: boolean } {
  const { api } = useAuth();
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listNotifications()
      .then((items: NotificationItem[]) => {
        if (alive) setUnread(items.filter((i) => !i.read_at).length);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  return { unread, failed };
}

// ------------------------------------------------------------------ OPERATOR --

function OperatorHome() {
  const { api, session, can } = useAuth();
  const [items, setItems] = useState<SubmissionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ total: number; covered: number; partial: boolean } | null>(
    null,
  );
  const { unread } = useUnread();

  const canCreate = can('period.create') || can('entry.edit_draft');

  const load = useCallback(() => {
    let alive = true;
    api
      .listSubmissions()
      .then((r) => {
        if (alive) setItems(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(messageForCode(null, e instanceof Error ? e.message : undefined));
      });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c = { draft: 0, review: 0, submitted: 0, returned: 0, approved: 0 };
    for (const s of items ?? []) {
      if (s.status === 'DRAFT') c.draft += 1;
      else if (s.status === 'READY_FOR_REVIEW') c.review += 1;
      else if (s.status === 'SUBMITTED') c.submitted += 1;
      else if (s.status === 'RETURNED') c.returned += 1;
      else if (s.status === 'FINANCE_APPROVED') c.approved += 1;
    }
    return c;
  }, [items]);

  const returned = (items ?? []).filter((s) => s.status === 'RETURNED');
  const open = (items ?? []).filter(
    (s) => s.status === 'DRAFT' || s.status === 'READY_FOR_REVIEW',
  );

  /*
   * Kompletnost NE postoji u listSubmissions — jedini izvor je preview po
   * prijavi. Zato se dovlači samo za periode koji su još otvoreni i najviše za
   * tri, da početna ne bi radila N poziva. Kada je prijava više, broj se ne
   * prikazuje umesto da se prikaže pogrešan zbir.
   */
  useEffect(() => {
    const targets = [...open, ...returned].slice(0, MAX_COMPLETENESS_LOOKUPS);
    if (targets.length === 0) {
      setMissing({ total: 0, covered: 0, partial: false });
      return;
    }
    let alive = true;
    Promise.all(
      targets.map((s) =>
        api
          .getSubmissionPreview(s.id)
          .then((p) => ({ id: s.id, missing: p.completeness.missing_count }))
          .catch(() => null),
      ),
    ).then((rows) => {
      if (!alive) return;
      const ok = rows.filter((r): r is { id: string; missing: number } => r !== null);
      setMissing({
        total: ok.reduce((sum, r) => sum + r.missing, 0),
        covered: ok.length,
        partial:
          ok.length < targets.length ||
          open.length + returned.length > MAX_COMPLETENESS_LOOKUPS,
      });
    });
    return () => {
      alive = false;
    };
    // Zavisi od skupa otvorenih prijava, ne od referenci niza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, [...open, ...returned].map((s) => s.id).join(',')]);

  return (
    <div className="page">
      <PageHead
        name={session?.full_name}
        subtitle={`Dostupni centri: ${session?.centers.map((c) => c.center_code).join(', ') || '—'}`}
        actions={
          canCreate && (
            <Link className="btn btn-primary" to="/unos/novi">
              Novi unos
            </Link>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}
      {!items && !error && <Spinner label="Učitavanje prijava…" />}

      {items && (
        <>
          <div className="metrics">
            <Kpi
              label="U izradi"
              value={counts.draft + counts.review}
              hint="radna verzija i za pregled"
              to="/moje-prijave"
            />
            <Kpi label="Poslato" value={counts.submitted} hint="čeka finansije" to="/moje-prijave" />
            <Kpi
              label="Vraćeno na ispravku"
              value={counts.returned}
              tone={counts.returned > 0 ? 'bad' : undefined}
              hint={counts.returned > 0 ? 'zahteva vašu akciju' : 'nema vraćenih'}
              to="/moje-prijave"
            />
            <Kpi label="Odobreno" value={counts.approved} tone="ok" to="/moje-prijave" />
            <Kpi
              label="Nepregledanih ćelija"
              value={missing === null ? '…' : missing.total}
              tone={missing && missing.total > 0 ? 'warn' : undefined}
              hint={
                missing === null
                  ? 'provera u toku'
                  : missing.partial
                    ? `iz prvih ${missing.covered} otvorenih perioda`
                    : 'u otvorenim periodima'
              }
              to="/moje-prijave"
            />
            <Kpi
              label="Nepročitana obaveštenja"
              value={unread}
              tone={unread > 0 ? 'warn' : undefined}
              to="/obavestenja"
            />
          </div>

          {counts.returned > 0 && (
            <section className="control-section">
              <h2>Zahteva vašu akciju</h2>
              <ul className="signal-list">
                {returned.map((s) => (
                  <li key={s.id} className="signal signal-bad">
                    <div className="signal-main">
                      <strong>
                        {s.center_code} · {s.period_label}
                      </strong>
                      <span className="muted small">
                        {s.return_reason
                          ? `Razlog vraćanja: ${s.return_reason}`
                          : 'Finansije su vratile prijavu na ispravku.'}
                      </span>
                    </div>
                    <Link className="btn" to={`/unos?prijava=${s.id}`}>
                      Ispravi
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="control-section">
            <h2>Periodi u radu</h2>
            {open.length === 0 ? (
              <EmptyState
                title="Nema perioda u izradi"
                hint={
                  canCreate
                    ? 'Otvorite novi obračunski period da biste počeli unos.'
                    : 'Obratite se administratoru za otvaranje perioda.'
                }
              />
            ) : (
              <ul className="signal-list">
                {open.map((s) => (
                  <li key={s.id} className="signal">
                    <div className="signal-main">
                      <strong>
                        {s.center_code} · {s.period_label}
                      </strong>
                      <span className="muted small">
                        {s.period_start} – {s.period_end}
                      </span>
                    </div>
                    <StatusBadge status={s.status} />
                    <Link className="btn" to={`/unos?prijava=${s.id}`}>
                      Nastavi unos
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="muted small">
            Obračun radi baza. Ekran prikazuje vrednosti, ali ih ne izračunava.
          </p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- FINANCE --

function FinanceHome() {
  const { api, session, can } = useAuth();
  const [waiting, setWaiting] = useState<FinanceQueue | null>(null);
  const [rest, setRest] = useState<FinanceQueue | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentQueue | null>(null);
  const [adjFailed, setAdjFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { unread } = useUnread();

  const canApproveAdjustments = can('adjustment.approve');

  useEffect(() => {
    let alive = true;

    api
      .getFinanceQueue(['SUBMITTED'])
      .then((r) => {
        if (alive) setWaiting(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(messageForCode(null, e instanceof Error ? e.message : undefined));
      });

    api
      .getFinanceQueue(['RETURNED', 'FINANCE_APPROVED'])
      .then((r) => {
        if (alive) setRest(r);
      })
      .catch(() => {
        /* sporedni KPI ne sme da obori ekran */
      });

    if (canApproveAdjustments) {
      api
        .getAdjustmentQueue(['SUBMITTED'])
        .then((r) => {
          if (alive) setAdjustments(r);
        })
        .catch(() => {
          if (alive) setAdjFailed(true);
        });
    }

    return () => {
      alive = false;
    };
  }, [api, canApproveAdjustments]);

  /** Pregled po centru iz onoga što stvarno čeka odobrenje. */
  const byCenter = useMemo(() => {
    const map = new Map<string, { count: number; amount: number; incomplete: number }>();
    for (const it of waiting?.items ?? []) {
      const cur = map.get(it.center_code) ?? { count: 0, amount: 0, incomplete: 0 };
      cur.count += 1;
      cur.amount += it.recap.ukupno_za_odobrenje ?? 0;
      if (it.recap.ukupno_za_odobrenje === null) cur.incomplete += 1;
      map.set(it.center_code, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [waiting]);

  const waitingCount = waiting?.totals.count ?? 0;
  const blocked = waiting?.totals.blocked_count ?? 0;

  return (
    <div className="page">
      <PageHead
        name={session?.full_name}
        subtitle="Prijave koje čekaju odluku finansija, sa iznosom i centrom."
        actions={
          <Link className="btn btn-primary" to="/finansije">
            Otvori red za odobrenje
          </Link>
        }
      />

      {error && <Banner kind="error">{error}</Banner>}
      {!waiting && !error && <Spinner label="Učitavanje reda za odobrenje…" />}

      {waiting && (
        <>
          <div className="metrics">
            <Kpi
              label="Čeka odobrenje"
              value={waitingCount}
              hint="poslate prijave"
              tone={waitingCount > 0 ? 'warn' : 'ok'}
              to="/finansije"
            />
            <Kpi
              label="Iznos koji čeka odobrenje"
              value={`${formatRsd(waiting.totals.approvable_total)} RSD`}
              hint={
                blocked > 0
                  ? `bez ${blocked} prijava sa blokirajućim greškama`
                  : 'zbir prijava spremnih za odobrenje'
              }
              to="/finansije"
            />
            <Kpi
              label="Blokirano greškama"
              value={blocked}
              tone={blocked > 0 ? 'bad' : undefined}
              hint={blocked > 0 ? 'ne mogu se odobriti' : 'nema blokiranih'}
              to="/finansije"
            />
            <Kpi
              label="Vraćeno na ispravku"
              value={rest ? (rest.totals.by_status.RETURNED ?? 0) : '—'}
              hint={rest ? 'kod operatera' : 'nije učitano'}
              to="/finansije"
            />
            <Kpi
              label="Odobreno"
              value={rest ? (rest.totals.by_status.FINANCE_APPROVED ?? 0) : '—'}
              tone="ok"
              to="/finansije/istorija"
            />
            <Kpi
              label="Nepročitana obaveštenja"
              value={unread}
              tone={unread > 0 ? 'warn' : undefined}
              to="/obavestenja"
            />
          </div>

          {waiting.totals.incomplete_override_count > 0 && (
            <Banner kind="warning">
              {waiting.totals.incomplete_override_count} prijava je poslato{' '}
              <strong>nepotpuno uz izuzetak</strong>. Proverite obrazloženje pre odobrenja.{' '}
              <Link to="/finansije">Otvori red za odobrenje</Link>
            </Banner>
          )}

          <section className="control-section">
            <h2>Pregled po centru</h2>
            {byCenter.length === 0 ? (
              <EmptyState
                title="Nema prijava na čekanju"
                hint="Kada operater pošalje period, pojaviće se ovde."
              />
            ) : (
              <table className="list list-compact">
                <thead>
                  <tr>
                    <th>Centar</th>
                    <th className="num">Prijava</th>
                    <th className="num">Iznos za odobrenje</th>
                    <th>Napomena</th>
                  </tr>
                </thead>
                <tbody>
                  {byCenter.map(([code, v]) => (
                    <tr key={code}>
                      <td>
                        <strong>{code}</strong>
                      </td>
                      <td className="num">{v.count}</td>
                      <td className="num">{formatRsd(v.amount)}</td>
                      <td className="muted small">
                        {v.incomplete > 0
                          ? `${v.incomplete} bez ukupnog iznosa (nedostaju pravila)`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="control-section">
            <h2>Najduže čeka</h2>
            {waiting.items.length === 0 ? (
              <p className="muted small">Nema prijava na čekanju.</p>
            ) : (
              <ul className="signal-list">
                {[...waiting.items]
                  .sort((a, b) => (b.waiting_hours ?? 0) - (a.waiting_hours ?? 0))
                  .slice(0, 5)
                  .map((it) => (
                    <li
                      key={it.submission_id}
                      className={it.hard_error_count > 0 ? 'signal signal-bad' : 'signal'}
                    >
                      <div className="signal-main">
                        <strong>
                          {it.center_code} · {it.period_label}
                        </strong>
                        <span className="muted small">
                          {it.waiting_days != null ? `čeka ${it.waiting_days} dana` : 'čeka'}
                          {it.hard_error_count > 0 && ` · ${it.hard_error_count} blokirajućih grešaka`}
                          {it.unacknowledged_warning_count > 0 &&
                            ` · ${it.unacknowledged_warning_count} nepotvrđenih upozorenja`}
                        </span>
                      </div>
                      <span className="num">
                        {it.recap.ukupno_za_odobrenje === null
                          ? '—'
                          : `${formatRsd(it.recap.ukupno_za_odobrenje)} RSD`}
                      </span>
                      <Link className="btn" to={`/finansije/prijava?prijava=${it.submission_id}`}>
                        Otvori
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          {canApproveAdjustments && (
            <section className="control-section">
              <h2>Dodatni zahtevi</h2>
              {adjFailed ? (
                <p className="muted small">Red dodatnih zahteva trenutno nije dostupan.</p>
              ) : !adjustments ? (
                <Spinner label="Učitavanje zahteva…" />
              ) : adjustments.totals.count === 0 ? (
                <p className="muted small">Nema zahteva na čekanju.</p>
              ) : (
                <div className="metrics">
                  <Kpi
                    label="Zahteva na čekanju"
                    value={adjustments.totals.count}
                    tone="warn"
                    to="/finansije/dodatni-zahtevi"
                  />
                  <Kpi
                    label="Neto efekat"
                    value={`${formatRsd(adjustments.totals.net_total)} RSD`}
                    hint="doplata minus umanjenje"
                    to="/finansije/dodatni-zahtevi"
                  />
                  <Kpi
                    label="Blokirano"
                    value={adjustments.totals.blocked_count}
                    tone={adjustments.totals.blocked_count > 0 ? 'bad' : undefined}
                    to="/finansije/dodatni-zahtevi"
                  />
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- ADMIN --

function AdminHome() {
  const { api, session } = useAuth();
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [readiness, setReadiness] = useState<AdminReadiness | null>(null);
  const [readinessFailed, setReadinessFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { unread } = useUnread();

  useEffect(() => {
    let alive = true;

    api
      .getAdminConfig()
      .then((r) => {
        if (alive) setCfg(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(messageForCode(null, e instanceof Error ? e.message : undefined));
      });

    api
      .adminReadiness()
      .then((r) => {
        if (alive) setReadiness(r);
      })
      .catch(() => {
        if (alive) setReadinessFailed(true);
      });

    return () => {
      alive = false;
    };
  }, [api]);

  const users = cfg?.users ?? [];
  const activeUsers = users.filter((u) => u.active);
  /** Aktivan nalog bez ijedne uloge ne može ništa — to je konfiguracioni propust. */
  const withoutRole = activeUsers.filter((u) => u.roles.length === 0);
  /**
   * Aktivan nalog bez centra. Administratorske uloge legitimno nemaju centre
   * (dosežu sve), pa se broje samo nalozi koji nisu administratorski.
   */
  const withoutCenter = activeUsers.filter(
    (u) => u.centers.length === 0 && !u.roles.some((r) => r.includes('ADMIN')),
  );
  const activeCenters = (cfg?.centers ?? []).filter((c) => c.active);

  const configGaps = readiness
    ? [
        ...readiness.configuration.centers_without_expected_pattern.map((c) => ({
          text: `Centar ${c} nema definisan radni kalendar (očekivane dane).`,
          to: '/administracija',
        })),
        ...readiness.compensation.primary_types_without_rule.map((t) => ({
          text: `Vrsta isplate ${t} nema pravilo naknade — stavke ostaju bez iznosa.`,
          to: '/administracija',
        })),
        ...readiness.compensation.component_types_without_rule.map((t) => ({
          text: `Komponenta ${t} nema pravilo naknade.`,
          to: '/administracija',
        })),
        ...readiness.transport.providers_without_rule.map((p) => ({
          text: `Prevoznik ${p} nema pravilo prevoza.`,
          to: '/administracija',
        })),
      ]
    : [];

  return (
    <div className="page">
      <PageHead
        name={session?.full_name}
        subtitle="Stanje konfiguracije, naloga i pristupa."
        actions={
          <Link className="btn btn-primary" to="/administracija">
            Otvori administraciju
          </Link>
        }
      />

      {error && <Banner kind="error">{error}</Banner>}
      {!cfg && !error && <Spinner label="Čitanje konfiguracije…" />}

      {cfg && (
        <>
          <div className="metrics">
            <Kpi
              label="Aktivni korisnici"
              value={activeUsers.length}
              hint={`od ukupno ${users.length}`}
              to="/administracija"
            />
            <Kpi label="Aktivni centri" value={activeCenters.length} to="/administracija" />
            <Kpi
              label="Nalozi bez uloge"
              value={withoutRole.length}
              tone={withoutRole.length > 0 ? 'bad' : 'ok'}
              hint={withoutRole.length > 0 ? 'ne mogu da rade' : 'svi imaju ulogu'}
              to="/administracija"
            />
            <Kpi
              label="Nalozi bez centra"
              value={withoutCenter.length}
              tone={withoutCenter.length > 0 ? 'warn' : 'ok'}
              hint="bez administratorskih uloga"
              to="/administracija"
            />
            <Kpi
              label="Aktivni zaposleni"
              value={readiness ? readiness.configuration.active_employees : '—'}
              to="/zaposleni"
            />
            <Kpi
              label="Nepročitana obaveštenja"
              value={unread}
              tone={unread > 0 ? 'warn' : undefined}
              to="/obavestenja"
            />
          </div>

          {(withoutRole.length > 0 || withoutCenter.length > 0) && (
            <section className="control-section">
              <h2>Nalozi kojima nedostaje konfiguracija</h2>
              <ul className="signal-list">
                {withoutRole.map((u) => (
                  <li key={`r-${u.profile_id}`} className="signal signal-bad">
                    <div className="signal-main">
                      <strong>{u.full_name}</strong>
                      <span className="muted small">{u.email ?? 'bez e-adrese'} · nema dodeljenu ulogu</span>
                    </div>
                    <Link className="btn" to="/administracija">
                      Dodeli ulogu
                    </Link>
                  </li>
                ))}
                {withoutCenter
                  .filter((u) => u.roles.length > 0)
                  .map((u) => (
                    <li key={`c-${u.profile_id}`} className="signal signal-warn">
                      <div className="signal-main">
                        <strong>{u.full_name}</strong>
                        <span className="muted small">
                          {u.roles.join(', ')} · nema dodeljen nijedan centar
                        </span>
                      </div>
                      <Link className="btn" to="/administracija">
                        Dodeli centar
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section className="control-section">
            <h2>Konfiguracioni propusti</h2>
            {readinessFailed ? (
              <p className="muted small">
                Provera spremnosti sistema trenutno nije dostupna, pa se propusti ne
                prikazuju. Otvorite Administracija → Spremnost sistema.
              </p>
            ) : !readiness ? (
              <Spinner label="Provera spremnosti…" />
            ) : configGaps.length === 0 ? (
              <EmptyState
                title="Nema otkrivenih propusta"
                hint="Provera je read-only i ne menja konfiguraciju."
              />
            ) : (
              <ul className="signal-list">
                {configGaps.slice(0, 10).map((g) => (
                  <li key={g.text} className="signal signal-warn">
                    <div className="signal-main">
                      <span>{g.text}</span>
                    </div>
                    <Link className="btn" to={g.to}>
                      Otvori
                    </Link>
                  </li>
                ))}
                {configGaps.length > 10 && (
                  <li className="signal">
                    <div className="signal-main">
                      <span className="muted small">
                        i još {configGaps.length - 10} stavki u Spremnosti sistema.
                      </span>
                    </div>
                  </li>
                )}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------ BA --

function BaHome() {
  const { api, session } = useAuth();
  const initial = defaultRange();
  const [overview, setOverview] = useState<BaOverview | null>(null);
  const [centers, setCenters] = useState<BaCenters | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const range = describeRange(initial.from, initial.to, today);
  const notice = rangeNotice(range);

  useEffect(() => {
    let alive = true;
    api
      .baOverview(initial.from, initial.to)
      .then((r) => {
        if (alive) setOverview(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(messageForCode(null, e instanceof Error ? e.message : undefined));
      });
    api
      .baCenters(initial.from, initial.to)
      .then((r) => {
        if (alive) setCenters(r);
      })
      .catch(() => {
        /* sporedno */
      });
    return () => {
      alive = false;
    };
  }, [api, initial.from, initial.to]);

  return (
    <div className="page">
      <PageHead
        name={session?.full_name}
        subtitle="Odobreni obračuni po datumu rada. Pregled je read-only."
        actions={
          <Link className="btn btn-primary" to="/analitika">
            Otvori analitiku
          </Link>
        }
      />

      <div className="range-chip">
        <span className="metric-label">Period</span>
        <strong>{range.label}</strong>
        <span className="muted small">{range.days} dana</span>
      </div>
      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      {error && <Banner kind="error">{error}</Banner>}
      {!overview && !error && <Spinner label="Učitavanje analitike…" />}

      {overview && (
        <>
          <div className="metrics">
            <Kpi
              label="Ukupan odobreni trošak"
              value={
                overview.kpi.total_calculated_amount?.current == null
                  ? '—'
                  : `${formatRsd(overview.kpi.total_calculated_amount.current)} RSD`
              }
              hint="samo odobreni obračuni"
              to="/analitika"
            />
            <Kpi
              label="Odobrenih obračuna"
              value={overview.approved_snapshots}
              hint="nepromenljivi snapshot-i"
              to="/analitika"
            />
            <Kpi
              label="Radni dani zaposlenih"
              value={overview.kpi.worked_employee_days?.current ?? '—'}
              to="/analitika"
            />
            <Kpi
              label="Broj zaposlenih"
              value={overview.kpi.distinct_employees?.current ?? '—'}
              to="/analitika/zaposleni"
            />
          </div>

          {overview.approved_snapshots === 0 && (
            <EmptyState
              title="Nema odobrenih obračuna u ovom periodu"
              hint="Poslati periodi se ne računaju dok ih finansije ne odobre."
            />
          )}

          <section className="control-section">
            <h2>Pregled po centru</h2>
            {!centers || centers.items.length === 0 ? (
              <p className="muted small">Nema podataka po centru za izabrani period.</p>
            ) : (
              <table className="list list-compact">
                <thead>
                  <tr>
                    <th>Centar</th>
                    <th className="num">Radni dani</th>
                    <th className="num">Zaposlenih</th>
                    <th className="num">Ukupan trošak</th>
                  </tr>
                </thead>
                <tbody>
                  {centers.items.map((c) => (
                    <tr key={c.center_code}>
                      <td>
                        <strong>{c.center_code}</strong>
                      </td>
                      <td className="num">{c.worked_employee_days}</td>
                      <td className="num">{c.distinct_employees}</td>
                      <td className="num">{formatRsd(c.total_calculated_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- izbor --

export function Home() {
  const { can, session } = useAuth();
  const persona = usePersona(session?.roles, can);

  switch (persona) {
    case 'finance':
      return <FinanceHome />;
    case 'admin':
      return <AdminHome />;
    case 'ba':
      return <BaHome />;
    case 'operator':
      return <OperatorHome />;
    default:
      return (
        <div className="page page-narrow">
          <div className="preview-head">
            <div>
              <h1>Dobrodošli</h1>
              <p className="muted">Nalog još nema dodeljene module.</p>
            </div>
          </div>
          <EmptyState
            title="Nema dodeljenih prava"
            hint="Obratite se administratoru da vam dodeli ulogu i centar."
          />
        </div>
      );
  }
}
