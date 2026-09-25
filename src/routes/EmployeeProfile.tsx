import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import {
  guardLabel,
  isChangeBlockedByHistory,
} from '../features/employees/model';
import { WdrApiError } from '../lib/api';
import type { EmployeeFormReference, EmployeeProfile as Profile } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

/** `/zaposleni/:id` — matični podaci, istorija i kontrolisane radnje. */
export function EmployeeProfile() {
  const { api } = useAuth();
  const { id } = useParams<{ id: string }>();

  const [p, setP] = useState<Profile | null>(null);
  const [cfg, setCfg] = useState<EmployeeFormReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setP(await api.getEmployeeProfile(id));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api, id]);

  useEffect(() => {
    void load();
    void (async () => {
      try { setCfg(await api.getEmployeeFormReference()); } catch { setCfg(null); }
    })();
  }, [api, load]);

  function set(k: string, v: string) {
    setDraft((d) => ({ ...d, [k]: v }));
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
  if (!id) return <EmptyState title="Nije izabran zaposleni" />;
  if (!p) return <Spinner label="Čitanje profila…" />;

  const e = p.employee;
  const guard = p.history_guard.last_approved_work_date;

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>
            {e.full_name}{' '}
            <span className="muted">{e.employee_code ?? 'bez šifre'}</span>
          </h1>
          <p className="muted">
            Radni odnos {e.employment_start_date}
            {e.employment_end_date ? ` – ${e.employment_end_date}` : ' (u toku)'} ·{' '}
            {e.active ? 'aktivan' : 'neaktivan'}
          </p>
        </div>
        <Link className="btn btn-quiet" to="/zaposleni">← Zaposleni</Link>
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <Banner kind="info">{guardLabel(p.history_guard)}</Banner>

      {/* ================================================== MATIČNI PODACI == */}
      {p.can.edit && (
        <section className="control-section">
          <h2>Matični podaci</h2>
          <p className="muted small">
            Promena imena je dozvoljena: odobreni obračun čuva istorijsko ime, pa se
            istorija ne menja time što se osoba preimenovala.
          </p>
          <div className="form-grid">
            <label><span>Ime</span>
              <input value={draft.first_name ?? e.first_name}
                onChange={(ev) => set('first_name', ev.target.value)} /></label>
            <label><span>Prezime</span>
              <input value={draft.last_name ?? e.last_name}
                onChange={(ev) => set('last_name', ev.target.value)} /></label>
            <label><span>Šifra</span>
              <input value={draft.employee_code ?? e.employee_code ?? ''}
                onChange={(ev) => set('employee_code', ev.target.value)} /></label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void run(
              () => api.updateEmployee({
                employee_id: e.id,
                first_name: draft.first_name ?? e.first_name,
                last_name: draft.last_name ?? e.last_name,
                employee_code: draft.employee_code ?? e.employee_code,
              }),
              'Matični podaci su sačuvani.',
            )}
          >
            Sačuvaj
          </button>

          <h3>Radni odnos</h3>
          <div className="form-grid">
            <label><span>Početak</span>
              <input type="date" value={draft.start ?? e.employment_start_date}
                onChange={(ev) => set('start', ev.target.value)} /></label>
            <label><span>Kraj (opciono)</span>
              <input type="date" value={draft.end ?? e.employment_end_date ?? ''}
                onChange={(ev) => set('end', ev.target.value)} /></label>
          </div>
          <div className="filter-row">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(
                () => api.setEmploymentDates(
                  e.id, draft.start ?? e.employment_start_date, draft.end || null,
                ),
                'Datumi radnog odnosa su sačuvani.',
              )}
            >
              Sačuvaj datume
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !draft.end}
              onClick={() => void run(
                () => api.terminateEmployee(e.id, draft.end, draft.notes || null),
                'Radni odnos je zaključen; istorija je sačuvana.',
              )}
            >
              Zaključi radni odnos
            </button>
          </div>
          <p className="muted small">
            Izmena datuma koja bi izbacila već odobren radni dan iz radnog odnosa se
            odbija — to bi značilo plaćen dan van zaposlenja.
          </p>
        </section>
      )}

      {/* ====================================================== RASPODELE == */}
      <section className="control-section">
        <h2>Raspodela po centrima</h2>
        <table className="list list-compact">
          <thead>
            <tr><th>Centar</th><th>Od</th><th>Do</th><th>Osnovna naknada</th>
              <th>Smena</th><th>Trenutna</th></tr>
          </thead>
          <tbody>
            {p.assignments.map((a) => (
              <tr key={a.id} className={a.is_current ? '' : 'row-muted'}>
                <td><strong>{a.center_code}</strong></td>
                <td>{a.valid_from}</td>
                <td>{a.valid_to ?? '—'}</td>
                <td>{a.primary_payment_type_code ?? '—'}</td>
                <td>{a.default_shift_code ?? '—'}</td>
                <td>{a.is_current ? 'da' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {p.can.assign && (
          <>
            <h3>Premeštaj u drugi centar</h3>
            <p className="muted small">
              Stara raspodela se zatvara dan pre, nova počinje od izabranog datuma — u
              istoj transakciji. Istorijska raspodela se ne prepisuje.
            </p>
            <div className="form-grid">
              <label><span>Novi centar</span>
                <select value={draft.center ?? ''}
                  onChange={(ev) => set('center', ev.target.value)}>
                  <option value="">—</option>
                  {(cfg?.centers ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
                  ))}
                </select></label>
              <label><span>Premeštaj od</span>
                <input type="date" value={draft.from ?? ''}
                  onChange={(ev) => set('from', ev.target.value)} /></label>
            </div>
            {isChangeBlockedByHistory(draft.from, guard) && (
              <Banner kind="warning">
                Izabrani datum je unutar već odobrene istorije (do {guard}). Server će
                odbiti takav premeštaj — izaberite datum posle poslednjeg odobrenog dana.
              </Banner>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !draft.center || !draft.from
                || isChangeBlockedByHistory(draft.from, guard)}
              onClick={() => void run(
                () => api.transferEmployee({
                  employee_id: e.id, new_center_id: draft.center, from_date: draft.from,
                }),
                'Premeštaj je izvršen.',
              )}
            >
              Premesti
            </button>
          </>
        )}
      </section>

      {/* ========================================================= PREVOZ == */}
      <section className="control-section">
        <h2>Prevoz</h2>
        {(() => {
          const cur = p.transport.find((t) => t.is_current);
          return (
            <p>
              Trenutno: <strong>{cur ? (cur.transport_required ? 'DA' : 'NE') : '—'}</strong>
              {cur?.transport_required
                ? ` · prevoznik ${cur.provider_code ?? '—'} · od ${cur.valid_from}`
                : ''}
            </p>
          );
        })()}

        <table className="list list-compact">
          <thead>
            <tr><th>Prevoz</th><th>Prevoznik</th><th>Od</th><th>Do</th><th>Trenutno</th></tr>
          </thead>
          <tbody>
            {p.transport.map((t) => (
              <tr key={t.id} className={t.is_current ? '' : 'row-muted'}>
                <td>{t.transport_required ? 'DA' : 'NE'}</td>
                <td>{t.provider_code ?? '—'}</td>
                <td>{t.valid_from}</td>
                <td>{t.valid_to ?? '—'}</td>
                <td>{t.is_current ? 'da' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {p.can.transport && (
          <>
            <h3>Promena prevoza</h3>
            <p className="muted small">
              Promena zatvara staru evidenciju i otvara novu. Istorija prevoza se ne
              prepisuje, jer je već ulazila u odobrene obračune.
            </p>
            <div className="form-grid">
              <label><span>Potreban prevoz</span>
                <select value={draft.treq ?? 'ne'}
                  onChange={(ev) => set('treq', ev.target.value)}>
                  <option value="ne">NE</option>
                  <option value="da">DA</option>
                </select></label>
              {draft.treq === 'da' && (
                <label><span>Prevoznik</span>
                  <select value={draft.provider ?? ''}
                    onChange={(ev) => set('provider', ev.target.value)}>
                    <option value="">—</option>
                    {(cfg?.transport_providers ?? []).map((x) => (
                      <option key={x.id} value={x.id}>{x.code} · {x.name}</option>
                    ))}
                  </select></label>
              )}
              <label><span>Važi od</span>
                <input type="date" value={draft.tfrom ?? ''}
                  onChange={(ev) => set('tfrom', ev.target.value)} /></label>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !draft.tfrom
                || (draft.treq === 'da' && !draft.provider)
                || isChangeBlockedByHistory(draft.tfrom, guard)}
              onClick={() => void run(
                () => api.setEmployeeTransport({
                  employee_id: e.id,
                  transport_required: draft.treq === 'da',
                  transport_provider_id: draft.provider || null,
                  valid_from: draft.tfrom,
                }),
                'Evidencija prevoza je ažurirana.',
              )}
            >
              Sačuvaj prevoz
            </button>
          </>
        )}
      </section>

      {/* ======================================================= ISTORIJA == */}
      <section className="control-section">
        <h2>Operativni i finansijski pregled</h2>
        <p className="muted small">
          Period {p.period.from} – {p.period.to}. Odobreni iznosi dolaze iz
          nepromenljivih obračuna, sa semantikom zapisanom u trenutku odobrenja.
        </p>

        {p.operational_summary.length === 0 ? (
          <p className="muted">Nema odobrenih obračuna u ovom periodu.</p>
        ) : (
          <table className="list list-compact">
            <thead>
              <tr><th>Mesec</th><th>Centar</th><th className="num">Radni dani</th>
                <th className="num">GO</th><th className="num">BO</th>
                <th className="num">Prekovremeni</th><th className="num">Naknade</th>
                <th className="num">Prevoz</th><th className="num">Korekcije</th>
                <th className="num">Ukupno</th></tr>
            </thead>
            <tbody>
              {p.operational_summary.map((m) => (
                <tr key={`${m.month}-${m.center_code}`}>
                  <td>{m.month}</td>
                  <td>{m.center_code ?? '—'}</td>
                  <td className="num">{m.worked_days}</td>
                  <td className="num">{m.go_days}</td>
                  <td className="num">{m.bo_days}</td>
                  <td className="num">{m.overtime_hours}</td>
                  <td className="num">{formatRsd(m.employee_calculated_amount)}</td>
                  <td className="num">{formatRsd(m.transport_calculated_amount)}</td>
                  <td className="num">{formatRsd(m.adjustment_calculated_amount)}</td>
                  <td className="num"><strong>{formatRsd(m.total_calculated_amount)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {p.approved_payments.length > 0 && (
          <details className="lines-details">
            <summary>Odobrene stavke ({p.approved_payments.length})</summary>
            <table className="list list-compact">
              <thead>
                <tr><th>Datum</th><th>Centar</th><th>Vrsta</th><th>Stavka</th>
                  <th>Ponašanje</th><th className="num">Kol.</th>
                  <th className="num">Stopa</th><th className="num">Iznos</th></tr>
              </thead>
              <tbody>
                {p.approved_payments.map((l, i) => (
                  <tr key={`${l.work_date}-${l.payment_type_code}-${i}`}>
                    <td>{l.work_date}</td>
                    <td>{l.center_code}</td>
                    <td>{l.is_adjustment ? 'Korekcija' : l.line_kind}</td>
                    <td>{l.payment_type_code}</td>
                    <td className="muted">{l.payment_behavior ?? '—'}</td>
                    <td className="num">{l.units}</td>
                    <td className="num">{formatRsd(l.rate_used)}</td>
                    <td className="num">{formatRsd(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {p.adjustments.length > 0 && (
          <>
            <h3>Dodatni zahtevi</h3>
            <table className="list list-compact">
              <thead>
                <tr><th>Datum rada</th><th>Vrsta</th><th>Stavka</th>
                  <th className="num">Kol.</th><th className="num">Iznos</th>
                  <th>Status</th></tr>
              </thead>
              <tbody>
                {p.adjustments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.related_work_date}</td>
                    <td>{a.direction_label}</td>
                    <td>{a.payment_type_code}</td>
                    <td className="num">{a.units}</td>
                    <td className="num">{formatRsd(a.calculated_amount)}</td>
                    <td>{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
