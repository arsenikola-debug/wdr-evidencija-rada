import { useCallback, useEffect, useRef, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import {
  OVERRIDE_REASON_MIN,
  intendedOverrides,
  overrideEditorRows,
  overrideProblems,
  sensitiveChanges,
  userAccessPayload,
} from '../features/admin/config';
import type {
  OverrideChoice,
  PermissionOverrideRow,
} from '../features/admin/config';
import { formatRsd } from '../features/grid/model';
import { WdrApiError } from '../lib/api';
import type {
  AdminConfig,
  AdminReadiness,
  ControlSeverity,
  VerificationKind,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

/**
 * Administracija / Konfiguracija.
 *
 * Struktura je namerno „lista + forma" po sekciji: kasniji vizuelni redizajn
 * menja izgled, a ne rute ni poslovnu logiku. Svako dugme prati `config.can.*`
 * sa servera; baza svejedno ponovo proverava svaku izmenu.
 */
type Tab =
  | 'centri' | 'smene' | 'statusi' | 'isplate' | 'naknade'
  | 'prevoznici' | 'prevoz' | 'stopovi' | 'kalendar' | 'korisnici' | 'kontrole' | 'spremnost';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'centri', label: 'Centri' },
  { key: 'smene', label: 'Smene' },
  { key: 'statusi', label: 'Statusi evidencije' },
  { key: 'isplate', label: 'Vrste isplata' },
  { key: 'naknade', label: 'Pravila naknada' },
  { key: 'prevoznici', label: 'Prevoznici i odgovorna lica' },
  { key: 'prevoz', label: 'Pravila prevoza' },
  { key: 'stopovi', label: 'Cene po stopu' },
  { key: 'kalendar', label: 'Radni kalendar' },
  { key: 'korisnici', label: 'Korisnici i uloge' },
  { key: 'kontrole', label: 'Kontrolna pravila' },
  { key: 'spremnost', label: 'Spremnost sistema' },
];

const WEEKDAYS = ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'];

const VERIFICATION_LABEL: Record<string, string> = {
  BACKUP_RESTORE_TESTED: 'Testiran restore na čist projekat',
  HTTP_SMOKE_TEST: 'HTTP provera svih endpointa',
  BACKUP_LOCATION_CONFIRMED: 'Potvrđena lokacija rezervnih kopija',
  LEGAL_PRIVACY_REVIEW: 'Pravna provera i zaštita podataka',
};

interface StopRateRow {
  id: string; center_code: string; amount_per_stop: number; unit_type: string;
  valid_from: string; valid_to: string | null; version: number; active: boolean;
  notes: string | null;
}
interface StopRatesView {
  current: StopRateRow[];
  history: StopRateRow[];
  centers_without_rate: string[];
}

export function Admin() {
  const { api } = useAuth();
  const [tab, setTab] = useState<Tab>('centri');
  /** Aktivan tab mora ostati vidljiv i kada traka klizi vodoravno. */
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [readiness, setReadiness] = useState<AdminReadiness | null>(null);

  // Novi korisnik ima odvojeno stanje od editora postojećeg korisnika.
  const [newUserRoles, setNewUserRoles] = useState<string[]>([]);
  const [newUserCenters, setNewUserCenters] = useState<Array<{ code: string; write: boolean }>>([]);

  // Višestruki izbor za korisnike: rola i centar nisu „jedna vrednost".
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [userCenters, setUserCenters] = useState<Array<{ code: string; write: boolean }>>([]);
  // null = editor izuzetaka NIJE učitan. To nije isto što i „nema izuzetaka":
  // zbog semantike zamene prazan niz bi obrisao postojeće izuzetke.
  const [userOverrides, setUserOverrides] = useState<PermissionOverrideRow[] | null>(null);
  const [permFilter, setPermFilter] = useState('');
  const [stopRates, setStopRates] = useState<StopRatesView | null>(null);
  const [stopRatesError, setStopRatesError] = useState<string | null>(null);
  const [stopRatesDenied, setStopRatesDenied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCfg(await api.getAdminConfig());
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== 'spremnost') return;
    void (async () => {
      try {
        setReadiness(await api.adminReadiness());
      } catch (err) {
        const code = err instanceof WdrApiError ? err.code : null;
        setNotice({
          kind: 'error',
          text: messageForCode(code, err instanceof Error ? err.message : undefined),
        });
      }
    })();
  }, [api, tab, busy]);

  function set(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function run(action: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: 'success', text: okText });
      setDraft({});
      await load();
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setNotice({
        kind: 'error',
        text: messageForCode(code, err instanceof Error ? err.message : undefined),
      });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!cfg) return <Spinner label="Čitanje konfiguracije…" />;

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Administracija</h1>
          <p className="muted">
            Poslovni podaci se menjaju bez izmene koda. Ponašanje obračuna se bira iz
            podržanog skupa — nova aritmetika je softverska izmena, ne konfiguracija.
          </p>
        </div>
      </div>

      {/*
        12+ tabova se ne prelama u više redova — traka klizi vodoravno, a aktivan
        tab se sam dovlači u vidno polje posle osvežavanja ekrana.
      */}
      <div className="filter-row tabs" role="tablist" aria-label="Sekcije administracije">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            ref={t.key === tab ? activeTabRef : undefined}
            className={t.key === tab ? 'btn btn-primary' : 'btn btn-quiet'}
            onClick={() => { setTab(t.key); setNotice(null); setDraft({}); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      {/* ========================================================= CENTRI == */}
      {tab === 'centri' && (
        <section className="control-section">
          <h2>Centri</h2>
          <table className="list list-compact">
            <thead>
              <tr><th>Šifra</th><th>Naziv</th><th>Aktivan</th><th>Redosled</th><th /></tr>
            </thead>
            <tbody>
              {cfg.centers.map((c) => (
                <tr key={c.id} className={c.active ? '' : 'row-muted'}>
                  <td><strong>{c.code}</strong></td>
                  <td>{c.name}</td>
                  <td>{c.active ? 'da' : 'ne'}</td>
                  <td>{c.sort_order}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={busy || !cfg.can.centers}
                      onClick={() => void run(
                        () => api.adminUpsertCenter({
                          id: c.id, code: c.code, name: c.name,
                          active: !c.active, sort_order: c.sort_order,
                        }),
                        c.active ? 'Centar je deaktiviran.' : 'Centar je aktiviran.',
                      )}
                    >
                      {c.active ? 'Deaktiviraj' : 'Aktiviraj'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Novi centar</h3>
          <div className="form-grid">
            <label><span>Šifra</span>
              <input value={draft.code ?? ''} onChange={(e) => set('code', e.target.value)} /></label>
            <label><span>Naziv</span>
              <input value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.centers || !draft.code || !draft.name}
            onClick={() => void run(
              () => api.adminUpsertCenter({
                code: draft.code, name: draft.name, active: true, sort_order: 100,
              }),
              'Centar je kreiran.',
            )}
          >
            Sačuvaj centar
          </button>
        </section>
      )}

      {/* ========================================================== SMENE == */}
      {tab === 'smene' && (
        <section className="control-section">
          <h2>Smene</h2>
          <p className="muted small">
            Prelazak ponoći se izvodi automatski iz vremena. Smena koju istorija
            referencira se ne briše — deaktivira se.
          </p>
          <table className="list list-compact">
            <thead>
              <tr><th>Šifra</th><th>Naziv</th><th>Od</th><th>Do</th><th>Preko ponoći</th>
                <th>Aktivna</th><th /></tr>
            </thead>
            <tbody>
              {cfg.shift_templates.map((t) => (
                <tr key={t.id} className={t.active ? '' : 'row-muted'}>
                  <td><strong>{t.code}</strong></td>
                  <td>{t.label}</td>
                  <td>{t.shift_start}</td>
                  <td>{t.shift_end}</td>
                  <td>{t.crosses_midnight ? 'da' : 'ne'}</td>
                  <td>{t.active ? 'da' : 'ne'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={busy || !cfg.can.reference}
                      onClick={() => void run(
                        () => api.adminUpsertShiftTemplate({
                          id: t.id, code: t.code, label: t.label,
                          start: t.shift_start, end: t.shift_end,
                          center_id: t.center_id, active: !t.active, sort_order: t.sort_order,
                        }),
                        t.active ? 'Smena je deaktivirana.' : 'Smena je aktivirana.',
                      )}
                    >
                      {t.active ? 'Deaktiviraj' : 'Aktiviraj'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Nova smena</h3>
          <div className="form-grid">
            <label><span>Šifra</span>
              <input value={draft.code ?? ''} onChange={(e) => set('code', e.target.value)} /></label>
            <label><span>Naziv</span>
              <input value={draft.label ?? ''} onChange={(e) => set('label', e.target.value)} /></label>
            <label><span>Početak</span>
              <input type="time" value={draft.start ?? ''} onChange={(e) => set('start', e.target.value)} /></label>
            <label><span>Kraj</span>
              <input type="time" value={draft.end ?? ''} onChange={(e) => set('end', e.target.value)} /></label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.reference || !draft.code || !draft.start || !draft.end}
            onClick={() => void run(
              () => api.adminUpsertShiftTemplate({
                code: draft.code, label: draft.label ?? draft.code,
                start: draft.start, end: draft.end, active: true, sort_order: 100,
              }),
              'Smena je sačuvana.',
            )}
          >
            Sačuvaj smenu
          </button>
        </section>
      )}

      {/* ======================================================= STATUSI == */}
      {tab === 'statusi' && (
        <section className="control-section">
          <h2>Statusi evidencije</h2>
          <Banner kind="info">
            Ponašanje statusa je <strong>identitet</strong> i ne menja se posle kreiranja.
            Naziv, skraćenica, prečica, boja i redosled su prikaz i slobodno se menjaju.
            Novi status mora izabrati jedno od podržanih ponašanja — obračun ne ume da
            protumači ponašanje koje ne postoji.
          </Banner>
          <table className="list list-compact">
            <thead>
              <tr><th>Šifra</th><th>Naziv</th><th>Ponašanje</th><th>Segmenti</th>
                <th>Prisutan</th><th>Aktivan</th><th>U upotrebi</th></tr>
            </thead>
            <tbody>
              {cfg.attendance_statuses.map((a) => (
                <tr key={a.code} className={a.active ? '' : 'row-muted'}>
                  <td><strong>{a.code}</strong>{a.short_label ? ` (${a.short_label})` : ''}</td>
                  <td>{a.name}</td>
                  <td>
                    {cfg.attendance_behaviors.find((b) => b.behavior_key === a.behavior_key)?.name
                      ?? a.behavior_key}
                  </td>
                  <td>{a.allows_segments ? 'da' : 'ne'}</td>
                  <td>{a.counts_as_present ? 'da' : 'ne'}</td>
                  <td>{a.active ? 'da' : 'ne'}</td>
                  <td>{a.in_use ? 'da — šifra je deo istorije' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Novi status</h3>
          <div className="form-grid">
            <label><span>Šifra</span>
              <input value={draft.code ?? ''} onChange={(e) => set('code', e.target.value)} /></label>
            <label><span>Naziv</span>
              <input value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
            <label><span>Ponašanje</span>
              <select value={draft.behavior ?? ''} onChange={(e) => set('behavior', e.target.value)}>
                <option value="">—</option>
                {cfg.attendance_behaviors.map((b) => (
                  <option key={b.behavior_key} value={b.behavior_key}>{b.name}</option>
                ))}
              </select></label>
          </div>
          {draft.behavior && (() => {
            const b = cfg.attendance_behaviors.find((x) => x.behavior_key === draft.behavior);
            return (
              <p className="muted small">
                Izvedena semantika ovog ponašanja (ne bira se posebno):{' '}
                nosi segmente <strong>{b?.allows_segments ? 'da' : 'ne'}</strong>,{' '}
                računa se kao prisustvo{' '}
                <strong>{b?.counts_as_present ? 'da' : 'ne'}</strong>.
              </p>
            );
          })()}
          {draft.behavior && (
            <p className="muted small">
              {cfg.attendance_behaviors.find((b) => b.behavior_key === draft.behavior)?.description}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.reference || !draft.code || !draft.name || !draft.behavior}
            onClick={() => void run(
              () => api.adminUpsertAttendanceStatus({
                code: draft.code, name: draft.name, behavior_key: draft.behavior,
                active: true, sort_order: 100,
              }),
              'Status je sačuvan.',
            )}
          >
            Sačuvaj status
          </button>
        </section>
      )}

      {/* ======================================================== ISPLATE == */}
      {tab === 'isplate' && (
        <section className="control-section">
          <h2>Vrste isplata</h2>
          <Banner kind="info">
            Nova vrsta isplate bira jedno od <strong>podržanih ponašanja obračuna</strong>.
            Šifra koja je ušla u odobreni obračun se više ne preimenuje — snapshot je
            samostalan i mora da znači isto zauvek.
          </Banner>
          <table className="list list-compact">
            <thead>
              <tr><th>Šifra</th><th>Naziv</th><th>Ponašanje</th><th>Vrsta</th>
                <th>Jedinica</th><th>Aktivna</th><th>U obračunu</th></tr>
            </thead>
            <tbody>
              {cfg.payment_types.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'row-muted'}>
                  <td><strong>{p.code}</strong></td>
                  <td>{p.name}</td>
                  <td>
                    {cfg.payment_behaviors.find((b) => b.behavior_key === p.behavior_key)?.name
                      ?? p.behavior_key}
                  </td>
                  <td>{p.kind}</td>
                  <td>{p.default_unit_type}</td>
                  <td>{p.active ? 'da' : 'ne'}</td>
                  <td>{p.in_use ? 'da' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Nova vrsta isplate</h3>
          <div className="form-grid">
            <label><span>Šifra</span>
              <input value={draft.code ?? ''} onChange={(e) => set('code', e.target.value)} /></label>
            <label><span>Naziv</span>
              <input value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
            <label><span>Ponašanje obračuna</span>
              <select value={draft.behavior ?? ''} onChange={(e) => set('behavior', e.target.value)}>
                <option value="">—</option>
                {cfg.payment_behaviors.map((b) => (
                  <option key={b.behavior_key} value={b.behavior_key}>
                    {b.name} ({b.kind})
                  </option>
                ))}
              </select></label>
            <label><span>Jedinica</span>
              <select value={draft.unit ?? ''} onChange={(e) => set('unit', e.target.value)}>
                <option value="">—</option>
                {/* Nude se samo jedinice koje izabrano ponašanje ume da obračuna. */}
                {(cfg.payment_behaviors.find((b) => b.behavior_key === draft.behavior)
                  ?.allowed_unit_types ?? []).map((u) => (
                  <option key={u} value={u}>
                    {u === 'PER_WORKED_DAY' ? 'Po radnom danu'
                      : u === 'PER_HOUR' ? 'Po satu'
                      : u === 'PER_EVENT' ? 'Po događaju' : 'Fiksno (količina = 1)'}
                  </option>
                ))}
              </select></label>
          </div>
          {draft.behavior && (() => {
            const b = cfg.payment_behaviors.find((x) => x.behavior_key === draft.behavior);
            return (
              <p className="muted small">
                {b?.description} Izvedena semantika: količina{' '}
                <strong>{b?.requires_units ? 'obavezna' : 'nije obavezna'}</strong>, trošak
                drugog centra{' '}
                <strong>{b?.allows_cost_center_override ? 'dozvoljen' : 'nije dozvoljen'}</strong>.
                Ta polja se ne biraju posebno — nasleđuju se iz ponašanja.
              </p>
            );
          })()}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.payment_types || !draft.code || !draft.name || !draft.behavior}
            onClick={() => {
              const beh = cfg.payment_behaviors.find((b) => b.behavior_key === draft.behavior);
              void run(
                () => api.adminUpsertPaymentType({
                  code: draft.code, name: draft.name, behavior_key: draft.behavior,
                  kind: (beh?.kind ?? 'COMPONENT'),
                  default_unit_type: draft.unit
                    ?? beh?.allowed_unit_types?.[0] ?? 'PER_EVENT',
                  active: true, sort_order: 100,
                }),
                'Vrsta isplate je sačuvana.',
              );
            }}
          >
            Sačuvaj vrstu isplate
          </button>
        </section>
      )}

      {/* ======================================================== NAKNADE == */}
      {tab === 'naknade' && (
        <section className="control-section">
          <h2>Pravila naknada</h2>
          <Banner kind="info">
            Iznos važećeg pravila se <strong>ne menja</strong> — otvara se
            <strong> nova verzija od datuma</strong>. Stara verzija ostaje kao istorija, jer
            odobreni obračuni moraju da ostanu reproducibilni.
          </Banner>
          {cfg.compensation_rules.length === 0 ? (
            <EmptyState
              title="Nema konfigurisanih pravila"
              hint="Dok pravilo ne postoji, obračun prijavljuje grešku i odobrenje nije moguće."
            />
          ) : (
            <table className="list list-compact">
              <thead>
                <tr><th>Centar</th><th>Vrsta isplate</th><th>Status</th><th className="num">Iznos</th>
                  <th>Jedinica</th><th>Verzija</th><th>Važi od</th><th>Važi do</th><th>U obračunu</th></tr>
              </thead>
              <tbody>
                {cfg.compensation_rules.map((r) => (
                  <tr key={r.id} className={r.valid_to ? 'row-muted' : ''}>
                    <td>{r.center_code ?? 'GLOBALNO'}</td>
                    <td>{r.payment_type_code}</td>
                    <td>{r.attendance_status ?? '—'}</td>
                    <td className="num">{formatRsd(r.amount)}</td>
                    <td>{r.unit_type}</td>
                    <td>v{r.version}</td>
                    <td>{r.valid_from}</td>
                    <td>{r.valid_to ?? '—'}</td>
                    <td>{r.in_use ? 'da' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Novo pravilo</h3>
          <div className="form-grid">
            <label><span>Centar</span>
              <select value={draft.center ?? ''} onChange={(e) => set('center', e.target.value)}>
                <option value="">GLOBALNO</option>
                {cfg.centers.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.code}</option>
                ))}
              </select></label>
            <label><span>Vrsta isplate</span>
              <select value={draft.pt ?? ''} onChange={(e) => set('pt', e.target.value)}>
                <option value="">—</option>
                {cfg.payment_types.filter((p) => p.active).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select></label>
            <label><span>Status evidencije (opciono)</span>
              <select value={draft.att ?? ''} onChange={(e) => set('att', e.target.value)}>
                <option value="">svi statusi</option>
                {cfg.attendance_statuses.map((a) => (
                  <option key={a.code} value={a.code}>{a.code}</option>
                ))}
              </select></label>
            <label><span>Iznos (konačna stopa)</span>
              <input type="number" step="0.01" value={draft.amount ?? ''}
                onChange={(e) => set('amount', e.target.value)} /></label>
            <label><span>Jedinica</span>
              <select value={draft.unit ?? ''} onChange={(e) => set('unit', e.target.value)}>
                <option value="">—</option>
                {(cfg.payment_types.find((p) => p.id === draft.pt)?.default_unit_type
                  ? [cfg.payment_types.find((p) => p.id === draft.pt)!.default_unit_type]
                  : []).map((u) => <option key={u} value={u}>{u}</option>)}
              </select></label>
            <label><span>Važi od</span>
              <input type="date" value={draft.from ?? ''}
                onChange={(e) => set('from', e.target.value)} /></label>
          </div>
          <p className="muted small">
            Množilac se ne unosi: engine ga ne primenjuje (Q23), pa je iznos konačna
            stopa po jedinici. Jedinica dolazi iz vrste isplate i njenog ponašanja.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.comp_rules || !draft.pt || !draft.amount
              || !draft.unit || !draft.from}
            onClick={() => void run(
              () => api.adminCreateCompRule({
                center_id: draft.center || null,
                payment_type_id: draft.pt,
                attendance_status: draft.att || null,
                amount: Number(draft.amount),
                unit_type: draft.unit,
                valid_from: draft.from,
              }),
              'Pravilo naknade je sačuvano.',
            )}
          >
            Sačuvaj pravilo
          </button>

          <h3>Nova verzija postojećeg pravila</h3>
          <p className="muted small">
            Iznos važećeg pravila se ne menja u mestu — otvara se nova verzija od
            datuma, a stara ostaje kao istorija odobrenih obračuna.
          </p>
          <div className="form-grid">
            <label><span>Pravilo</span>
              <select value={draft.rule ?? ''} onChange={(e) => set('rule', e.target.value)}>
                <option value="">—</option>
                {cfg.compensation_rules.filter((r) => !r.valid_to).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.center_code ?? 'GLOBALNO'} · {r.payment_type_code} · {r.amount}
                  </option>
                ))}
              </select></label>
            <label><span>Novi iznos</span>
              <input type="number" step="0.01" value={draft.newAmount ?? ''}
                onChange={(e) => set('newAmount', e.target.value)} /></label>
            <label><span>Važi od</span>
              <input type="date" value={draft.newFrom ?? ''}
                onChange={(e) => set('newFrom', e.target.value)} /></label>
          </div>
          <button
            type="button"
            className="btn"
            disabled={busy || !cfg.can.comp_rules || !draft.rule || !draft.newAmount
              || !draft.newFrom}
            onClick={() => void run(
              () => api.adminSupersedeCompRule(
                draft.rule, Number(draft.newAmount), draft.newFrom,
              ),
              'Otvorena je nova verzija pravila.',
            )}
          >
            Nova verzija od datuma
          </button>
        </section>
      )}

      {/* ==================================================== PREVOZNICI == */}
      {tab === 'prevoznici' && (
        <section className="control-section">
          <h2>Prevoznici i odgovorna lica</h2>
          <table className="list list-compact">
            <thead><tr><th>Šifra</th><th>Naziv</th><th>Aktivan</th></tr></thead>
            <tbody>
              {cfg.transport_providers.map((p) => (
                <tr key={p.id}><td><strong>{p.code}</strong></td><td>{p.name}</td>
                  <td>{p.active ? 'da' : 'ne'}</td></tr>
              ))}
            </tbody>
          </table>
          <h3>Novi prevoznik</h3>
          <div className="form-grid">
            <label><span>Šifra</span>
              <input value={draft.pcode ?? ''} onChange={(e) => set('pcode', e.target.value)} /></label>
            <label><span>Naziv</span>
              <input value={draft.pname ?? ''} onChange={(e) => set('pname', e.target.value)} /></label>
            <label><span>Odgovorno lice</span>
              <select value={draft.presp ?? ''} onChange={(e) => set('presp', e.target.value)}>
                <option value="">—</option>
                {cfg.responsible_persons.filter((r) => r.active).map((r) => (
                  <option key={r.id} value={r.id}>{r.code} · {r.full_name}</option>
                ))}
              </select></label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.providers || !draft.pcode || !draft.pname}
            onClick={() => void run(
              () => api.adminUpsertTransportProvider({
                code: draft.pcode, name: draft.pname,
                responsible_person_id: draft.presp || null, active: true,
              }),
              'Prevoznik je sačuvan.',
            )}
          >
            Sačuvaj prevoznika
          </button>

          <h3>Odgovorna lica</h3>
          <table className="list list-compact">
            <thead><tr><th>Šifra</th><th>Ime</th><th>Aktivno</th></tr></thead>
            <tbody>
              {cfg.responsible_persons.map((p) => (
                <tr key={p.id}><td><strong>{p.code}</strong></td><td>{p.full_name}</td>
                  <td>{p.active ? 'da' : 'ne'}</td></tr>
              ))}
            </tbody>
          </table>

          <div className="form-grid">
            <label><span>Šifra</span>
              <input value={draft.rcode ?? ''} onChange={(e) => set('rcode', e.target.value)} /></label>
            <label><span>Ime i prezime</span>
              <input value={draft.rname ?? ''} onChange={(e) => set('rname', e.target.value)} /></label>
          </div>
          <button
            type="button"
            className="btn"
            disabled={busy || !cfg.can.providers || !draft.rcode || !draft.rname}
            onClick={() => void run(
              () => api.adminUpsertResponsiblePerson({
                code: draft.rcode, full_name: draft.rname, active: true,
              }),
              'Odgovorno lice je sačuvano.',
            )}
          >
            Sačuvaj odgovorno lice
          </button>
        </section>
      )}

      {/* ========================================================= PREVOZ == */}
      {tab === 'prevoz' && (
        <section className="control-section">
          <h2>Pravila prevoza</h2>
          <Banner kind="info">
            Nude se samo modeli koje obračun ume da primeni:{' '}
            {cfg.transport_rule_types_allowed.join(', ')}. Fiksni modeli
            (FIXED_DAILY/WEEKLY/MONTHLY, MANUAL, COMPOSITE) nisu podržani u MVP-u i baza
            ih odbija (Q22).
          </Banner>
          {cfg.transport_rules.length === 0 ? (
            <EmptyState title="Nema pravila prevoza" />
          ) : (
            <table className="list list-compact">
              <thead>
                <tr><th>Prevoznik</th><th>Centar</th><th>Model</th><th className="num">Stopa</th>
                  <th className="num">Litri</th><th className="num">Cena goriva</th>
                  <th>Važi od</th><th>U obračunu</th></tr>
              </thead>
              <tbody>
                {cfg.transport_rules.map((r) => (
                  <tr key={r.id} className={r.valid_to ? 'row-muted' : ''}>
                    <td>{r.provider_code}</td>
                    <td>{r.center_code ?? 'GLOBALNO'}</td>
                    <td>{r.rule_type}</td>
                    <td className="num">{formatRsd(r.amount_per_unit)}</td>
                    <td className="num">{r.liters_per_unit ?? '—'}</td>
                    <td className="num">{formatRsd(r.price_per_liter)}</td>
                    <td>{r.valid_from}</td>
                    <td>{r.in_use ? 'da' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Novo pravilo prevoza</h3>
          <div className="form-grid">
            <label><span>Prevoznik</span>
              <select value={draft.tprov ?? ''} onChange={(e) => set('tprov', e.target.value)}>
                <option value="">—</option>
                {cfg.transport_providers.filter((p) => p.active).map((p) => (
                  <option key={p.id} value={p.id}>{p.code}</option>
                ))}
              </select></label>
            <label><span>Centar</span>
              <select value={draft.tcenter ?? ''} onChange={(e) => set('tcenter', e.target.value)}>
                <option value="">GLOBALNO</option>
                {cfg.centers.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.code}</option>
                ))}
              </select></label>
            <label><span>Model</span>
              <select value={draft.ttype ?? ''} onChange={(e) => set('ttype', e.target.value)}>
                <option value="">—</option>
                {/* Samo naplativi modeli (Q22); fiksni i ručni se ne nude. */}
                {cfg.transport_rule_types_allowed.map((t) => (
                  <option key={t} value={t}>
                    {t === 'PER_ELIGIBLE_WORKED_DAY'
                      ? 'Po employee-danu sa pravom'
                      : 'Litri × cena goriva po employee-danu'}
                  </option>
                ))}
              </select></label>
            {draft.ttype === 'PER_ELIGIBLE_WORKED_DAY' && (
              <label><span>Iznos po jedinici</span>
                <input type="number" step="0.01" value={draft.tamount ?? ''}
                  onChange={(e) => set('tamount', e.target.value)} /></label>
            )}
            {draft.ttype === 'LITERS_PER_EMPLOYEE_DAY' && (
              <>
                <label><span>Litara po employee-danu</span>
                  <input type="number" step="0.001" value={draft.tliters ?? ''}
                    onChange={(e) => set('tliters', e.target.value)} /></label>
                <label><span>Konfigurisana cena goriva</span>
                  <input type="number" step="0.01" value={draft.tprice ?? ''}
                    onChange={(e) => set('tprice', e.target.value)} /></label>
              </>
            )}
            <label><span>Važi od</span>
              <input type="date" value={draft.tfrom ?? ''}
                onChange={(e) => set('tfrom', e.target.value)} /></label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.transport || !draft.tprov || !draft.ttype || !draft.tfrom}
            onClick={() => void run(
              () => api.adminCreateTransportRule({
                transport_provider_id: draft.tprov,
                center_id: draft.tcenter || null,
                rule_type: draft.ttype,
                valid_from: draft.tfrom,
                amount_per_unit: draft.tamount ? Number(draft.tamount) : null,
                liters_per_unit: draft.tliters ? Number(draft.tliters) : null,
                price_per_liter: draft.tprice ? Number(draft.tprice) : null,
              }),
              'Pravilo prevoza je sačuvano.',
            )}
          >
            Sačuvaj pravilo prevoza
          </button>
        </section>
      )}

      {/* ======================================================= KALENDAR == */}
      {tab === 'stopovi' && (
        <section className="admin-section">
          <h3>Cene po stopu</h3>
          <p className="muted small">
            Cena važi PO CENTRU. Nema globalne cene, cene po zaposlenom, klijentu
            ni ruti — ključ je centar i datum. Ako se svuda plaća isto, ista cena
            se unosi za svaki centar posebno, jer se centri mogu razići.
          </p>
          <p className="muted small">
            Istorijska cena se NIKADA ne menja na mestu. Promena znači novu
            efektivno datiranu verziju: stara dobija kraj važenja, nova svoj
            početak, a već odobrena istorija se ne preračunava.
          </p>

          {stopRatesDenied && (
            <Banner kind="warning">
              Za pregled i izmenu cena po stopu potrebna je permisija
              <code> rules.courier_stops.manage</code>. Server je merodavan.
            </Banner>
          )}

          {stopRatesError && <Banner kind="error">{stopRatesError}</Banner>}

          <button type="button" className="btn btn-quiet" disabled={busy}
            onClick={() => {
              setStopRatesError(null);
              void (async () => {
                try {
                  // RPC vraća ništa bez permisije — to je jedini merodavan odgovor.
                  const res = await api.adminStopRates() as StopRatesView | null;
                  setStopRates(res ?? null);
                  setStopRatesDenied(res == null);
                } catch (err) {
                  setStopRates(null);
                  setStopRatesError(err instanceof Error ? err.message : 'Greška.');
                }
              })();
            }}>
            Učitaj cene
          </button>

          {stopRates && stopRates.centers_without_rate.length > 0 && (
            <Banner kind="warning">
              Centri bez važeće cene po stopu: {stopRates.centers_without_rate.join(', ')}.
              Njihovi stopovi se ne mogu odobriti dok cena ne postoji.
            </Banner>
          )}

          {stopRates && (
            <>
              <h4>Trenutno važeće</h4>
              <table className="list list-compact">
                <thead>
                  <tr><th>Centar</th><th>Cena po stopu</th><th>Jedinica</th>
                    <th>Važi od</th><th>Važi do</th><th>Verzija</th><th>Aktivno</th>
                    <th>Napomena</th></tr>
                </thead>
                <tbody>
                  {stopRates.current.map((r) => (
                    <tr key={r.id}>
                      <td>{r.center_code}</td>
                      <td>{r.amount_per_stop}</td>
                      <td>{r.unit_type}</td>
                      <td>{r.valid_from}</td>
                      <td>{r.valid_to ?? '—'}</td>
                      <td>{r.version}</td>
                      <td>{r.active ? 'da' : 'ne'}</td>
                      <td className="muted small">{r.notes ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h4>Istorija verzija</h4>
              {stopRates.history.length === 0 ? (
                <p className="muted small">Nema ranijih verzija.</p>
              ) : (
                <table className="list list-compact">
                  <thead>
                    <tr><th>Centar</th><th>Verzija</th><th>Cena po stopu</th>
                      <th>Važi od</th><th>Važi do</th><th>Aktivno</th><th>Napomena</th></tr>
                  </thead>
                  <tbody>
                    {stopRates.history.map((r) => (
                      <tr key={r.id}>
                        <td>{r.center_code}</td>
                        <td>{r.version}</td>
                        <td>{r.amount_per_stop}</td>
                        <td>{r.valid_from}</td>
                        <td>{r.valid_to ?? '—'}</td>
                        <td>{r.active ? 'da' : 'ne'}</td>
                        <td className="muted small">{r.notes ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {stopRates !== null && (
            <>
              <h4>Nova cena za centar</h4>
              <div className="filter-row">
                <label><span>Centar</span>
                  <select value={draft.stopCenter ?? ''}
                    onChange={(e) => set('stopCenter', e.target.value)}>
                    <option value="">—</option>
                    {cfg.centers.map((c) => (
                      <option key={c.id} value={c.id}>{c.code}</option>
                    ))}
                  </select></label>
                <label><span>Cena po stopu</span>
                  <input value={draft.stopAmount ?? ''}
                    onChange={(e) => set('stopAmount', e.target.value)} /></label>
                <label><span>Važi od</span>
                  <input type="date" value={draft.stopFrom ?? ''}
                    onChange={(e) => set('stopFrom', e.target.value)} /></label>
                <label><span>Napomena</span>
                  <input value={draft.stopNotes ?? ''}
                    onChange={(e) => set('stopNotes', e.target.value)} /></label>
              </div>
              <button type="button" className="btn btn-primary"
                disabled={busy || !draft.stopCenter || !draft.stopAmount || !draft.stopFrom}
                onClick={() => void run(
                  () => api.adminCreateStopRate(
                    draft.stopCenter!, Number(draft.stopAmount),
                    draft.stopFrom!, null, draft.stopNotes ?? null),
                  'Cena po stopu je sačuvana.',
                )}>
                Sačuvaj prvu cenu
              </button>

              <h4>Nova verzija postojeće cene</h4>
              <p className="muted small">
                Stara verzija dobija kraj važenja; ne menja se na mestu.
              </p>
              <div className="filter-row">
                <label><span>Postojeća cena</span>
                  <select value={draft.stopRateId ?? ''}
                    onChange={(e) => set('stopRateId', e.target.value)}>
                    <option value="">—</option>
                    {(stopRates?.current ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.center_code} — {r.amount_per_stop} (v{r.version})
                      </option>
                    ))}
                  </select></label>
                <label><span>Nova cena</span>
                  <input value={draft.stopNewAmount ?? ''}
                    onChange={(e) => set('stopNewAmount', e.target.value)} /></label>
                <label><span>Važi od</span>
                  <input type="date" value={draft.stopNewFrom ?? ''}
                    onChange={(e) => set('stopNewFrom', e.target.value)} /></label>
              </div>
              <button type="button" className="btn btn-primary"
                disabled={busy || !draft.stopRateId || !draft.stopNewAmount || !draft.stopNewFrom}
                onClick={() => void run(
                  () => api.adminSupersedeStopRate(
                    draft.stopRateId!, Number(draft.stopNewAmount),
                    draft.stopNewFrom!, draft.stopNotes ?? null),
                  'Nova verzija cene je sačuvana.',
                )}>
                Napravi novu verziju
              </button>
            </>
          )}
        </section>
      )}

      {tab === 'kalendar' && (
        <section className="control-section">
          <h2>Radni kalendar</h2>
          <Banner kind="info">
            Obrazac radnih dana važi od datuma i <strong>ne menja se unazad</strong> preko
            poslate ili odobrene prijave. Izuzetni radni/neradni dan se i dalje označava na
            samoj prijavi, uz obavezno obrazloženje.
          </Banner>
          <table className="list list-compact">
            <thead>
              <tr><th>Centar</th><th>Radni dani</th><th>Važi od</th><th>Važi do</th></tr>
            </thead>
            <tbody>
              {cfg.expected_date_patterns.map((p) => (
                <tr key={p.id} className={p.valid_to ? 'row-muted' : ''}>
                  <td>{p.center_code ?? 'GLOBALNO'}</td>
                  <td>{p.included_iso_weekdays.map((d) => WEEKDAYS[d - 1]).join(', ')}</td>
                  <td>{p.valid_from}</td>
                  <td>{p.valid_to ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Novi obrazac radnih dana</h3>
          <div className="form-grid">
            <label><span>Centar</span>
              <select value={draft.kcenter ?? ''} onChange={(e) => set('kcenter', e.target.value)}>
                <option value="">GLOBALNO</option>
                {cfg.centers.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.code}</option>
                ))}
              </select></label>
            <label><span>Važi od</span>
              <input type="date" value={draft.kfrom ?? ''}
                onChange={(e) => set('kfrom', e.target.value)} /></label>
          </div>
          <div className="filter-row">
            {WEEKDAYS.map((d, i) => {
              const selected = (draft.kdays ?? '1,2,3,4,5').split(',');
              const value = String(i + 1);
              const on = selected.includes(value);
              return (
                <button
                  key={d}
                  type="button"
                  className={on ? 'btn btn-primary' : 'btn btn-quiet'}
                  onClick={() => set('kdays', (on
                    ? selected.filter((x) => x !== value)
                    : [...selected, value]).sort().join(','))}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.centers || !draft.kfrom}
            onClick={() => void run(
              () => api.adminSetExpectedPattern(
                draft.kcenter || null,
                (draft.kdays ?? '1,2,3,4,5').split(',').filter(Boolean).map(Number),
                draft.kfrom,
              ),
              'Obrazac radnih dana važi od izabranog datuma.',
            )}
          >
            Sačuvaj obrazac
          </button>
        </section>
      )}

      {/* ======================================================= KONTROLE == */}
      {tab === 'kontrole' && (
        <section className="control-section">
          <h2>Kontrolna pravila</h2>
          <Banner kind="info">
            Ponašanje kontrole je sistemsko i menja se samo softverskom izmenom. Admin
            uključuje kontrolu, postavlja <strong>podržani prag</strong>, prioritet i
            datum od kada važi. Promena praga otvara <strong>novu verziju</strong> —
            stari nalazi se ne pretumačuju. Nema slobodnog SQL-a, formula ni JSON-a.
          </Banner>
          <table className="list list-compact">
            <thead>
              <tr><th>Kontrola</th><th>Entitet</th><th className="num">Prag</th>
                <th>Prioritet</th><th>Važi od</th><th>Verzija</th><th>Stanje</th></tr>
            </thead>
            <tbody>
              {cfg.control_rules.map((r) => (
                <tr key={r.rule_code} className={r.status === 'ACTIVE' ? '' : 'row-muted'}>
                  <td>
                    <strong>{r.name}</strong>
                    <div className="muted small">{r.description}</div>
                  </td>
                  <td>{r.entity_type}</td>
                  <td className="num">
                    {r.threshold_value === null
                      ? (r.requires_threshold ? 'nije potvrđen' : '—')
                      : `${r.threshold_value} ${r.threshold_unit ?? ''}`}
                  </td>
                  <td>{r.severity ?? r.default_severity}</td>
                  <td>{r.valid_from ?? '—'}</td>
                  <td>{r.config_version ?? '—'}</td>
                  <td>
                    {r.status === 'ACTIVE' ? 'Aktivno'
                      : r.status === 'DISABLED' ? 'Isključeno' : 'Prag nije potvrđen'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Nova verzija pravila</h3>
          <div className="form-grid">
            <label><span>Kontrola</span>
              <select value={draft.crule ?? ''} onChange={(e) => set('crule', e.target.value)}>
                <option value="">—</option>
                {cfg.control_rules.map((r) => (
                  <option key={r.rule_code} value={r.rule_code}>{r.name}</option>
                ))}
              </select></label>
            <label><span>Uključeno</span>
              <select value={draft.cenabled ?? 'da'}
                onChange={(e) => set('cenabled', e.target.value)}>
                <option value="da">da</option><option value="ne">ne</option>
              </select></label>
            <label>
              <span>
                Prag{' '}
                {cfg.control_rules.find((r) => r.rule_code === draft.crule)?.threshold_unit
                  ?? ''}
              </span>
              <input
                type="number"
                step="0.01"
                value={draft.cthreshold ?? ''}
                disabled={!cfg.control_rules.find((r) => r.rule_code === draft.crule)
                  ?.requires_threshold}
                onChange={(e) => set('cthreshold', e.target.value)}
              /></label>
            <label><span>Prioritet</span>
              <select value={draft.cseverity ?? 'WARNING'}
                onChange={(e) => set('cseverity', e.target.value)}>
                {cfg.control_severities.map((sv) => (
                  <option key={sv} value={sv}>{sv}</option>
                ))}
              </select></label>
            <label><span>Važi od</span>
              <input type="date" value={draft.cfrom ?? ''}
                onChange={(e) => set('cfrom', e.target.value)} /></label>
          </div>
          <p className="muted small">
            Promena praga otvara novu verziju od datuma; stari nalazi zadržavaju
            vrednost koja je bila u upotrebi. Pravilo sa pragom ne može da se uključi
            bez potvrđene vrednosti.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cfg.can.controls || !draft.crule || !draft.cfrom}
            onClick={() => void run(
              () => api.adminSetControlRule({
                rule_code: draft.crule,
                enabled: (draft.cenabled ?? 'da') === 'da',
                threshold_value: draft.cthreshold ? Number(draft.cthreshold) : null,
                severity: (draft.cseverity ?? 'WARNING') as ControlSeverity,
                valid_from: draft.cfrom,
                notes: draft.cnotes || null,
              }),
              'Nova verzija kontrolnog pravila je sačuvana.',
            )}
          >
            Sačuvaj verziju
          </button>

          {cfg.control_rule_history.length > 0 && (
            <details className="lines-details">
              <summary>Istorija verzija ({cfg.control_rule_history.length})</summary>
              <table className="list list-compact">
                <thead>
                  <tr><th>Kontrola</th><th>Verzija</th><th className="num">Prag</th>
                    <th>Prioritet</th><th>Od</th><th>Do</th><th>Napomena</th></tr>
                </thead>
                <tbody>
                  {cfg.control_rule_history.map((h) => (
                    <tr key={h.id} className={h.valid_to ? 'row-muted' : ''}>
                      <td>{h.rule_code}</td>
                      <td>v{h.version}</td>
                      <td className="num">{h.threshold_value ?? '—'}</td>
                      <td>{h.severity}</td>
                      <td>{h.valid_from}</td>
                      <td>{h.valid_to ?? '—'}</td>
                      <td className="muted small">{h.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <p className="muted">
            Pregled nalaza i pokretanje kontrole su na ekranu{' '}
            <strong>Kontrolni centar</strong>.
          </p>
        </section>
      )}

      {/* ====================================================== SPREMNOST == */}
      {tab === 'spremnost' && (
        <section className="control-section">
          <h2>Spremnost sistema</h2>
          {!readiness ? (
            <Spinner label="Provera konfiguracije…" />
          ) : (
            <>
              <Banner kind="info">{readiness.note}</Banner>

              <h3>Konfiguracija</h3>
              <table className="list list-compact">
                <tbody>
                  <tr><td>Aktivni centri</td>
                    <td className="num">{readiness.configuration.active_centers}</td></tr>
                  <tr>
                    <td>Centri bez važećeg obrasca radnih dana</td>
                    <td className="num">
                      {readiness.configuration.centers_without_expected_pattern.length === 0
                        ? '—'
                        : readiness.configuration.centers_without_expected_pattern.join(', ')}
                    </td>
                  </tr>
                  <tr><td>Aktivne vrste isplata</td>
                    <td className="num">{readiness.configuration.active_payment_types}</td></tr>
                  <tr><td>Aktivni zaposleni</td>
                    <td className="num">{readiness.configuration.active_employees}</td></tr>
                </tbody>
              </table>

              <h3>Pravila naknada i prevoza</h3>
              <p className="muted small">
                Nedostajuće pravilo je konfiguracija koja nedostaje, a ne defekt: dok
                ga nema, obračun prijavljuje grešku i odobrenje nije moguće.
              </p>
              <table className="list list-compact">
                <tbody>
                  <tr><td>Važeća pravila naknada</td>
                    <td className="num">{readiness.compensation.rules_total}</td></tr>
                  <tr>
                    <td>Osnovne naknade bez pravila</td>
                    <td className="num">
                      {readiness.compensation.primary_types_without_rule.join(', ') || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td>Komponente bez pravila</td>
                    <td className="num">
                      {readiness.compensation.component_types_without_rule.join(', ') || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td>Prevoznici bez pravila</td>
                    <td className="num">
                      {readiness.transport.providers_without_rule.join(', ') || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td>Zaposleni sa prevozom, a bez pravila prevoznika</td>
                    <td className="num">
                      {readiness.transport.employees_with_transport_but_no_rule}
                    </td>
                  </tr>
                </tbody>
              </table>

              <h3>Kvalitet podataka i kontrole</h3>
              <table className="list list-compact">
                <tbody>
                  <tr>
                    <td>Zaposleni u radnom odnosu bez raspodele</td>
                    <td className="num">
                      {readiness.data_quality.active_employees_without_assignment}
                    </td>
                  </tr>
                  <tr><td>Aktivne kontrole</td>
                    <td className="num">
                      {readiness.controls.active} / {readiness.controls.rules_total}
                    </td></tr>
                  <tr>
                    <td>Kontrole koje čekaju potvrđen prag</td>
                    <td className="num">
                      {readiness.controls.not_configured.join(', ') || '—'}
                    </td>
                  </tr>
                  <tr><td>Otvoreni nalazi</td>
                    <td className="num">{readiness.controls.open_findings}</td></tr>
                </tbody>
              </table>

              <h3>Ručne i eksterne obaveze</h3>
              <Banner kind="warning">
                Sistem ne može sam da potvrdi ono što se dešava van njega. Dok ne
                postoji zapis o proveri, stavka stoji kao <strong>Nije potvrđeno</strong>.
              </Banner>
              <table className="list list-compact">
                <thead>
                  <tr><th>Obaveza</th><th>Stanje</th><th>Kada</th><th>Ko</th>
                    <th>Okruženje</th></tr>
                </thead>
                <tbody>
                  {(Object.keys(readiness.verifications) as VerificationKind[]).map((k) => {
                    const v = readiness.verifications[k];
                    return (
                      <tr key={k} className={v.confirmed ? '' : 'row-error'}>
                        <td>{VERIFICATION_LABEL[k] ?? k}</td>
                        <td><strong>{v.label}</strong></td>
                        <td>{v.verified_at
                          ? new Date(v.verified_at).toLocaleString('sr-Latn-RS') : '—'}</td>
                        <td>{v.verified_by ?? '—'}</td>
                        <td>{v.environment ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <h3>Evidentiraj izvršenu proveru</h3>
              <div className="form-grid">
                <label><span>Obaveza</span>
                  <select value={draft.vkind ?? ''} onChange={(e) => set('vkind', e.target.value)}>
                    <option value="">—</option>
                    {(Object.keys(readiness.verifications) as VerificationKind[]).map((k) => (
                      <option key={k} value={k}>{VERIFICATION_LABEL[k] ?? k}</option>
                    ))}
                  </select></label>
                <label><span>Okruženje</span>
                  <input value={draft.venv ?? ''}
                    onChange={(e) => set('venv', e.target.value)} /></label>
                <label><span>Referenca</span>
                  <input value={draft.vref ?? ''}
                    onChange={(e) => set('vref', e.target.value)} /></label>
              </div>
              <label className="full-width"><span>Beleška (obavezna)</span>
                <textarea rows={2} value={draft.vnote ?? ''}
                  onChange={(e) => set('vnote', e.target.value)} /></label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !draft.vkind || (draft.vnote ?? '').trim().length < 10}
                onClick={() => void run(
                  () => api.adminRecordVerification({
                    kind: draft.vkind as VerificationKind,
                    note: draft.vnote,
                    environment: draft.venv || null,
                    reference: draft.vref || null,
                  }),
                  'Provera je evidentirana.',
                )}
              >
                Evidentiraj proveru
              </button>

              <p className="muted small">
                Ovaj pregled ne donosi zaključak „sistem je spreman" i ne menja ni
                jedan poslovni podatak.
              </p>
            </>
          )}
        </section>
      )}

      {/* ====================================================== KORISNICI == */}
      {tab === 'korisnici' && (
        <section className="control-section">
          <h2>Korisnici i uloge</h2>
          <Banner kind="warning">
            Osetljive permisije: {cfg.sensitive_permissions.join(', ')}. Dodela bilo koje od
            njih menja ko sme da odobrava novac ili da zaobiđe kontrole.
          </Banner>
          {cfg.users.length === 0 ? (
            <EmptyState
              title="Lista korisnika nije dostupna"
              hint="Potrebna je permisija users.manage."
            />
          ) : (
            <table className="list list-compact">
              <thead>
                <tr><th>Ime</th><th>Aktivan</th><th>Uloge</th><th>Centri</th>
                  <th>Izuzeci permisija</th></tr>
              </thead>
              <tbody>
                {cfg.users.map((u) => (
                  <tr key={u.profile_id} className={u.active ? '' : 'row-muted'}>
                    <td>{u.full_name}<div className="muted small">{u.email}</div></td>
                    <td>{u.active ? 'da' : 'ne'}</td>
                    <td>{u.roles.join(', ')}</td>
                    <td>
                      {u.centers.map((c) =>
                        `${c.center_code}${c.can_write ? ' (upis)' : ''}`).join(', ') || '—'}
                    </td>
                    <td>
                      {u.permission_overrides.length === 0
                        ? '—'
                        : u.permission_overrides.map((o) =>
                            `${o.mode === 'GRANT' ? '+' : '−'}${o.permission_code}`).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {cfg.can.users && cfg.can.roles && (
            <>
              <h3>Dodaj / poveži korisnika</h3>
              <p className="muted small">
                Nalog prvo kreirajte u Supabase Auth-u. Ovde ga povezujete sa WDR profilom
                i dodeljujete mu uloge i pristup centrima.
              </p>

              <div className="form-grid">
                <label><span>Auth User ID</span>
                  <input
                    value={draft.newAuthUserId ?? ''}
                    placeholder="UUID iz Supabase Auth"
                    onChange={(e) => set('newAuthUserId', e.target.value)}
                  />
                </label>

                <label><span>Ime i prezime</span>
                  <input
                    value={draft.newFullName ?? ''}
                    onChange={(e) => set('newFullName', e.target.value)}
                  />
                </label>

                <label><span>Email</span>
                  <input
                    type="email"
                    value={draft.newEmail ?? ''}
                    onChange={(e) => set('newEmail', e.target.value)}
                  />
                </label>
              </div>

              <h4>Uloge</h4>
              <div className="filter-row">
                {cfg.roles.map((r) => {
                  const on = newUserRoles.includes(r.code);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={on ? 'btn btn-primary' : 'btn btn-quiet'}
                      onClick={() => setNewUserRoles(on
                        ? newUserRoles.filter((x) => x !== r.code)
                        : [...newUserRoles, r.code])}
                    >
                      {r.code}
                    </button>
                  );
                })}
              </div>

              <h4>Centri</h4>
              <table className="list list-compact">
                <thead>
                  <tr><th>Centar</th><th>Pristup</th><th>Pravo pisanja</th></tr>
                </thead>
                <tbody>
                  {cfg.centers.filter((c) => c.active).map((c) => {
                    const row = newUserCenters.find((x) => x.code === c.code);
                    return (
                      <tr key={c.id}>
                        <td><strong>{c.code}</strong> · {c.name}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(row)}
                            onChange={(e) => setNewUserCenters(e.target.checked
                              ? [...newUserCenters, { code: c.code, write: false }]
                              : newUserCenters.filter((x) => x.code !== c.code))}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            disabled={!row}
                            checked={row?.write ?? false}
                            onChange={(e) => setNewUserCenters(newUserCenters.map((x) =>
                              x.code === c.code ? { ...x, write: e.target.checked } : x))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy
                  || !(draft.newAuthUserId ?? '').trim()
                  || !(draft.newFullName ?? '').trim()
                  || !(draft.newEmail ?? '').trim()
                  || newUserRoles.length === 0
                }
                onClick={() => {
                  const authUserId = (draft.newAuthUserId ?? '').trim();
                  const fullName = (draft.newFullName ?? '').trim();
                  const email = (draft.newEmail ?? '').trim();

                  const summary = [
                    `Korisnik: ${fullName}`,
                    `Email: ${email}`,
                    `Uloge: ${newUserRoles.join(', ')}`,
                    `Centri: ${newUserCenters.map((c) =>
                      `${c.code}${c.write ? ' (upis)' : ''}`).join(', ') || 'bez centra'}`,
                  ].join('\n');

                  if (!window.confirm(`${summary}\n\nPovezati korisnika?`)) return;

                  void run(
                    async () => {
                      await api.adminLinkUser({
                        auth_user_id: authUserId,
                        full_name: fullName,
                        email,
                        active: true,
                        role_codes: newUserRoles,
                        center_access: newUserCenters.map((c) => ({
                          center_code: c.code,
                          can_write: c.write,
                        })),
                        permission_overrides: null,
                      });
                      setNewUserRoles([]);
                      setNewUserCenters([]);
                    },
                    'Korisnik je povezan i pristup je dodeljen.',
                  );
                }}
              >
                Poveži korisnika
              </button>
            </>
          )}

          {cfg.can.users && !cfg.can.roles && (
            <Banner kind="warning">
              Povezivanje novog korisnika zahteva permisije
              <code> users.manage </code> i <code>roles.manage</code>.
            </Banner>
          )}

          {cfg.can.users && cfg.users.length > 0 && (
            <>
              <h3>Izmena pristupa</h3>
              <div className="form-grid">
                <label><span>Korisnik</span>
                  <select
                    value={draft.user ?? ''}
                    onChange={(e) => {
                      set('user', e.target.value);
                      const u = cfg.users.find((x) => x.profile_id === e.target.value);
                      // Pun skup se puni trenutnim stanjem, da čuvanje ne obriše
                      // ono što nije ni prikazano.
                      setUserRoles(u?.roles ?? []);
                      setUserCenters((u?.centers ?? []).map((c) => ({
                        code: c.center_code, write: c.can_write,
                      })));
                      // Izuzeci se pune sa SERVERA. Bez `roles.manage` editor se
                      // ne otvara i ostaje null, pa se šalje null (ne diraj).
                      setUserOverrides(
                        u && cfg.can.roles
                          ? overrideEditorRows(cfg.permissions, u, cfg.sensitive_permissions)
                          : null,
                      );
                      setPermFilter('');
                      set('uactive', u?.active === false ? 'ne' : 'da');
                    }}
                  >
                    <option value="">—</option>
                    {cfg.users.map((u) => (
                      <option key={u.profile_id} value={u.profile_id}>{u.full_name}</option>
                    ))}
                  </select></label>
                <label><span>Aktivan</span>
                  <select value={draft.uactive ?? 'da'}
                    onChange={(e) => set('uactive', e.target.value)}>
                    <option value="da">da</option><option value="ne">ne</option>
                  </select></label>
              </div>
              <h4>Uloge</h4>
              <p className="muted small">
                Izbor je pun skup: sačuvani skup ZAMENJUJE postojeće uloge. Zato se
                polje puni trenutnim stanjem izabranog korisnika.
              </p>
              <div className="filter-row">
                {cfg.roles.map((r) => {
                  const on = userRoles.includes(r.code);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={on ? 'btn btn-primary' : 'btn btn-quiet'}
                      disabled={!cfg.can.roles}
                      onClick={() => setUserRoles(on
                        ? userRoles.filter((x) => x !== r.code)
                        : [...userRoles, r.code])}
                    >
                      {r.code}
                    </button>
                  );
                })}
              </div>
              {!cfg.can.roles && (
                <Banner kind="warning">
                  Dodela uloga zahteva permisiju <code>roles.manage</code>. Aktivnost i
                  pristup centrima možete menjati i bez nje.
                </Banner>
              )}

              <h4>Centri</h4>
              <table className="list list-compact">
                <thead><tr><th>Centar</th><th>Pristup</th><th>Pravo pisanja</th></tr></thead>
                <tbody>
                  {cfg.centers.filter((c) => c.active).map((c) => {
                    const row = userCenters.find((x) => x.code === c.code);
                    return (
                      <tr key={c.id}>
                        <td><strong>{c.code}</strong> · {c.name}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(row)}
                            onChange={(e) => setUserCenters(e.target.checked
                              ? [...userCenters, { code: c.code, write: false }]
                              : userCenters.filter((x) => x.code !== c.code))}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            disabled={!row}
                            checked={row?.write ?? false}
                            onChange={(e) => setUserCenters(userCenters.map((x) =>
                              x.code === c.code ? { ...x, write: e.target.checked } : x))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <h4>Izuzeci permisija</h4>
              {!cfg.can.roles ? (
                <Banner kind="warning">
                  Izuzeci permisija se uređuju samo uz <code>roles.manage</code>.
                  Čuvanje sa ovog ekrana ih neće promeniti.
                </Banner>
              ) : userOverrides === null ? (
                <p className="muted small">Izaberite korisnika.</p>
              ) : (
                <>
                  <p className="muted small">
                    Izuzetak nadjačava ono što uloga daje. Sačuvani skup ZAMENJUJE
                    postojeće izuzetke, zato je lista popunjena sa servera.
                    GRANT i REVOKE traže obrazloženje (najmanje {OVERRIDE_REASON_MIN} znakova).
                  </p>
                  <label className="full-width"><span>Pretraga permisija</span>
                    <input
                      value={permFilter}
                      placeholder="šifra, naziv ili oblast"
                      onChange={(e) => setPermFilter(e.target.value)} /></label>
                  <table className="list list-compact">
                    <thead>
                      <tr><th>Permisija</th><th>Oblast</th><th>Izuzetak</th>
                        <th>Obrazloženje</th></tr>
                    </thead>
                    <tbody>
                      {userOverrides
                        .filter((r) => {
                          const q = permFilter.trim().toLowerCase();
                          if (q === '') return true;
                          return r.permission_code.toLowerCase().includes(q)
                            || r.name.toLowerCase().includes(q)
                            || r.area.toLowerCase().includes(q);
                        })
                        .map((r) => (
                          <tr key={r.permission_code}
                              className={r.choice === 'NONE' ? '' : 'row-focus'}>
                            <td>
                              <code>{r.permission_code}</code>
                              {r.sensitive && (
                                <span className="chip chip-warn" title="Osetljiva permisija">
                                  osetljiva
                                </span>
                              )}
                              <div className="muted small">{r.name}</div>
                            </td>
                            <td className="muted small">{r.area}</td>
                            <td>
                              <select
                                value={r.choice}
                                onChange={(e) => setUserOverrides(userOverrides.map((x) =>
                                  x.permission_code === r.permission_code
                                    ? { ...x, choice: e.target.value as OverrideChoice }
                                    : x))}
                              >
                                <option value="NONE">Bez izuzetka</option>
                                <option value="GRANT">GRANT (dodaj)</option>
                                <option value="REVOKE">REVOKE (oduzmi)</option>
                              </select>
                            </td>
                            <td>
                              <input
                                value={r.reason}
                                disabled={r.choice === 'NONE'}
                                placeholder={r.choice === 'NONE' ? '—' : 'zašto'}
                                onChange={(e) => setUserOverrides(userOverrides.map((x) =>
                                  x.permission_code === r.permission_code
                                    ? { ...x, reason: e.target.value }
                                    : x))}
                              />
                              {r.server_choice !== r.choice && (
                                <div className="muted small">
                                  na serveru: {r.server_choice === 'NONE'
                                    ? 'bez izuzetka' : r.server_choice}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </>
              )}

              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !cfg.can.users || !draft.user}
                onClick={() => {
                  const current = cfg.users.find((u) => u.profile_id === draft.user);

                  const problems = userOverrides === null
                    ? [] : overrideProblems(userOverrides);
                  if (problems.length > 0) {
                    setNotice({ kind: 'error', text: problems.join(' ') });
                    return;
                  }

                  const payload = userAccessPayload({
                    profileId: draft.user,
                    active: (draft.uactive ?? 'da') === 'da',
                    roles: userRoles,
                    centers: userCenters,
                    canManageRoles: cfg.can.roles,
                    overrides: userOverrides ?? undefined,
                  });

                  const warnings = sensitiveChanges({
                    currentRoles: current?.roles ?? [],
                    nextRoles: cfg.can.roles ? userRoles : [],
                    sensitivePermissions: cfg.sensitive_permissions,
                    // Stvarno stanje editora, ne prazan niz.
                    nextOverrides: userOverrides === null
                      ? [] : intendedOverrides(userOverrides),
                    currentOverrides: current?.permission_overrides ?? [],
                    currentCenters: (current?.centers ?? []).map((c) => ({
                      code: c.center_code, write: c.can_write,
                    })),
                    nextCenters: userCenters,
                  });
                  // Pre širenja prava korisnik vidi šta tačno dodaje.
                  if (warnings.length > 0 && !window.confirm(
                    `${current?.full_name ?? draft.user}\n\n${warnings.join('\n')}`
                    + '\n\nNastaviti?')) return;

                  void run(
                    () => api.adminSetUserAccess(payload),
                    'Pristup korisnika je izmenjen.',
                  );
                }}
              >
                Sačuvaj pristup
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
