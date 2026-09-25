import { useCallback, useEffect, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { defaultRange, formatNumber, rangeIsValid } from '../features/analytics/model';
import {
  RULE_STATUS_LABEL,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  STATUS_LABEL,
  comparisonText,
  hasActiveRules,
  inactiveRules,
  sortFindings,
  statusChangeErrors,
  summaryCards,
} from '../features/controls/model';
import { WdrApiError } from '../lib/api';
import type {
  AdminConfig,
  ControlFindingDetail,
  ControlFindingStatus,
  ControlFindings,
  ControlRunResponse,
  ControlSeverity,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const STATUSES: ControlFindingStatus[] = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'];

/**
 * `/kontrolni-centar`
 *
 * Prikazuje odstupanja koja zaslužuju ljudsku proveru. Ništa ne menja novac,
 * prijave, evidenciju ni odobrenja — kontrola samo otkriva i objašnjava.
 * Skeniranje se pokreće IZRIČITO („Pokreni kontrolu"), nikad pri otvaranju
 * ekrana, da se ne bi tiho pravili skupi upiti.
 */
export function ControlCenter() {
  const initial = defaultRange();

  const { api } = useAuth();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [centerIds, setCenterIds] = useState<string[]>([]);
  const [cfg, setCfg] = useState<AdminConfig | null>(null);

  const [run, setRun] = useState<ControlRunResponse | null>(null);
  const [findings, setFindings] = useState<ControlFindings | null>(null);
  const [detail, setDetail] = useState<ControlFindingDetail | null>(null);

  const [status, setStatus] = useState<ControlFindingStatus[]>(['OPEN']);
  const [severity, setSeverity] = useState<ControlSeverity[]>([]);
  const [ruleCode, setRuleCode] = useState('');
  const [search, setSearch] = useState('');

  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try { setCfg(await api.getAdminConfig()); } catch { setCfg(null); }
    })();
  }, [api]);

  // Otvaranje ekrana čita POSLEDNJU završenu kontrolu; ne pokreće novu.
  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, f] = await Promise.all([
        api.getControlRun(),
        api.getControlFindings({
          status,
          severity: severity.length > 0 ? severity : null,
          rule_codes: ruleCode === '' ? null : [ruleCode],
          center_ids: centerIds.length > 0 ? centerIds : null,
          search: search.trim() === '' ? null : search.trim(),
        }),
      ]);
      setRun(r);
      setFindings(f);
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api, status, severity, ruleCode, centerIds, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runScan() {
    setScanning(true);
    setNotice(null);
    try {
      const r = await api.runControlScan(
        from, to, centerIds.length > 0 ? centerIds : null,
      );
      setNotice({
        kind: 'success',
        text: `Kontrola završena: ${r.run?.high_count ?? 0} visok prioritet, `
          + `${r.run?.warning_count ?? 0} upozorenja, `
          + `${r.run?.critical_count ?? 0} kritično.`,
      });
      await load();
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setNotice({
        kind: 'error',
        text: messageForCode(code, err instanceof Error ? err.message : undefined),
      });
    } finally {
      setScanning(false);
    }
  }

  async function open(id: string) {
    setComment('');
    setNotice(null);
    try {
      setDetail(await api.getControlFinding(id));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setNotice({
        kind: 'error',
        text: messageForCode(code, err instanceof Error ? err.message : undefined),
      });
    }
  }

  async function decide(next: ControlFindingStatus) {
    if (!detail) return;
    const errs = statusChangeErrors(next, comment);
    if (errs.length > 0) {
      setNotice({ kind: 'error', text: errs[0] });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      setDetail(await api.setControlFindingStatus(
        detail.finding.id, next, comment.trim() === '' ? null : comment.trim(),
      ));
      setNotice({ kind: 'success', text: `Nalaz je označen: ${STATUS_LABEL[next]}.` });
      setComment('');
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
  if (!run) return <Spinner label="Čitanje kontrola…" />;

  const rows = findings ? sortFindings(findings.items) : [];
  const inactive = inactiveRules(run.rules);

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Kontrolni centar</h1>
          <p className="muted">
            Odstupanja i neuobičajene vrednosti koje zaslužuju proveru. Kontrola ne
            menja novac, prijave ni odobrenja — samo otkriva i objašnjava.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={scanning || !rangeIsValid(from, to)}
          onClick={() => void runScan()}
        >
          {scanning ? 'Kontrola u toku…' : 'Pokreni kontrolu'}
        </button>
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <div className="metrics">
        {summaryCards(run).map((c) => (
          <div
            key={c.key}
            className={c.emphasis === 'high' && Number(c.value) > 0 ? 'metric metric-bad' : 'metric'}
          >
            <span className="metric-label">{c.label}</span>
            <span className="metric-value">{c.value}</span>
          </div>
        ))}
      </div>

      {run.run && (
        <p className="muted small">
          Period kontrole {run.run.period_from} – {run.run.period_to} · pokrenuo{' '}
          {run.run.started_by ?? '—'} · verzija {run.run.engine_version} · pravila:{' '}
          {run.run.rules_evaluated} izvršeno, {run.run.rules_skipped} preskočeno.
        </p>
      )}

      {!run.run && <Banner kind="info">{run.note}</Banner>}

      {!hasActiveRules(run.rules) && (
        <Banner kind="warning">
          Nijedna kontrola sa pragom još nije aktivna. Pragovi se potvrđuju u
          Administraciji — kontrola se ne aktivira sa pretpostavljenom vrednošću.
        </Banner>
      )}

      {/* ======================================================== FILTERI == */}
      <div className="form-grid">
        <label><span>Od</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label><span>Do</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {(cfg?.centers ?? []).length > 0 && (
          <label><span>Centar</span>
            <select
              value={centerIds[0] ?? ''}
              onChange={(e) => setCenterIds(e.target.value === '' ? [] : [e.target.value])}
            >
              <option value="">Svi centri</option>
              {(cfg?.centers ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
              ))}
            </select></label>
        )}
        <label><span>Status</span>
          <select
            value={status[0] ?? 'OPEN'}
            onChange={(e) => setStatus([e.target.value as ControlFindingStatus])}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select></label>
        <label><span>Prioritet</span>
          <select
            value={severity[0] ?? ''}
            onChange={(e) => setSeverity(e.target.value === ''
              ? [] : [e.target.value as ControlSeverity])}
          >
            <option value="">Svi</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
            ))}
          </select></label>
        <label><span>Kontrola</span>
          <select value={ruleCode} onChange={(e) => setRuleCode(e.target.value)}>
            <option value="">Sve kontrole</option>
            {run.rules.map((r) => (
              <option key={r.rule_code} value={r.rule_code}>{r.name}</option>
            ))}
          </select></label>
        <label><span>Pretraga</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      </div>

      {/* ========================================================= NALAZI == */}
      {rows.length === 0 ? (
        <EmptyState
          title="Nema nalaza po ovim kriterijumima"
          hint="Pokrenite kontrolu za izabrani period ili promenite filtere."
        />
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>Prioritet</th><th>Kontrola</th><th>Centar</th>
              <th>Zaposleni / entitet</th><th>Period / datum</th>
              <th className="num">Trenutna vrednost</th><th>Poređenje / prag</th>
              <th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr
                key={f.id}
                className={f.severity === 'CRITICAL' || f.severity === 'HIGH'
                  ? 'row-error' : ''}
              >
                <td><strong>{SEVERITY_LABEL[f.severity]}</strong></td>
                <td>{f.rule_name}</td>
                <td>{f.center_code ?? '—'}</td>
                <td>
                  {f.employee_name ?? f.entity_type}
                  {f.iso_week ? <div className="muted small">{f.iso_week}</div> : null}
                </td>
                <td>
                  {f.related_date
                    ?? (f.period_from ? `${f.period_from} – ${f.period_to}` : '—')}
                </td>
                <td className="num">
                  {f.current_value === null ? '—' : formatNumber(f.current_value)}
                </td>
                <td>{comparisonText(f)}</td>
                <td>
                  {STATUS_LABEL[f.status]}
                  {f.seen_count > 1 && (
                    <div className="muted small">viđeno {f.seen_count}×</div>
                  )}
                </td>
                <td>
                  <button type="button" className="btn btn-quiet" onClick={() => void open(f.id)}>
                    POGLEDAJ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {findings && findings.total_rows > rows.length && (
        <p className="muted small">
          Prikazano {rows.length} od {findings.total_rows}.
        </p>
      )}

      {/* ========================================================= DETALJ == */}
      {detail && (
        <section className="control-section">
          <h2>{detail.rule.name}</h2>
          <p>{detail.finding.message}</p>

          <table className="list list-compact">
            <tbody>
              <tr><td>Šta je pravilo</td><td>{detail.rule.description}</td></tr>
              <tr><td>Osnova podataka</td><td>{detail.rule.basis}</td></tr>
              <tr>
                <td>Period / entitet</td>
                <td>
                  {detail.finding.related_date
                    ?? `${detail.finding.period_from} – ${detail.finding.period_to}`}
                  {detail.finding.center_code ? ` · ${detail.finding.center_code}` : ''}
                  {detail.finding.employee_name ? ` · ${detail.finding.employee_name}` : ''}
                </td>
              </tr>
              <tr>
                <td>Trenutna vrednost</td>
                <td className="num">
                  {detail.finding.current_value === null
                    ? '—'
                    : formatNumber(detail.finding.current_value)}
                </td>
              </tr>
              <tr>
                <td>Poređenje</td>
                <td>
                  {detail.finding.comparison_value === null
                    ? comparisonText(detail.finding)
                    : `${formatRsd(detail.finding.comparison_value)} → `
                      + `${comparisonText(detail.finding)}`}
                </td>
              </tr>
              <tr>
                <td>Prag i verzija konfiguracije</td>
                <td>
                  {detail.finding.threshold_value === null
                    ? 'bez praga'
                    : formatNumber(detail.finding.threshold_value)}
                  {detail.config_used
                    ? ` · verzija ${detail.config_used.version} (od `
                      + `${detail.config_used.valid_from})`
                    : ''}
                </td>
              </tr>
              <tr><td>Prioritet</td><td>{SEVERITY_LABEL[detail.finding.severity]}</td></tr>
              <tr><td>Status</td><td>{STATUS_LABEL[detail.finding.status]}</td></tr>
              {detail.finding.acknowledged_by && (
                <tr>
                  <td>Potvrdio</td>
                  <td>
                    {detail.finding.acknowledged_by} ·{' '}
                    {new Date(detail.finding.acknowledged_at ?? '').toLocaleString('sr-Latn-RS')}
                  </td>
                </tr>
              )}
              {detail.finding.status_comment && (
                <tr><td>Obrazloženje</td><td>{detail.finding.status_comment}</td></tr>
              )}
            </tbody>
          </table>

          <p className="muted small">
            Nalaz je pokazatelj da nešto treba proveriti; nije dokaz nepravilnosti.
            {detail.run
              ? ` Kontrola pokrenuta ${new Date(detail.run.started_at)
                  .toLocaleString('sr-Latn-RS')}, verzija ${detail.run.engine_version}.`
              : ''}
          </p>

          <textarea
            rows={3}
            value={comment}
            placeholder={'Obrazloženje (obavezno za „Rešeno" i „Odbaci")'}
            onChange={(e) => setComment(e.target.value)}
          />

          <div className="filter-row">
            <button type="button" className="btn btn-primary" disabled={busy}
              onClick={() => void decide('ACKNOWLEDGED')}>POTVRDI</button>
            <button type="button" className="btn" disabled={busy || comment.trim().length < 10}
              onClick={() => void decide('RESOLVED')}>OZNAČI KAO REŠENO</button>
            <button type="button" className="btn" disabled={busy || comment.trim().length < 10}
              onClick={() => void decide('DISMISSED')}>ODBACI</button>
            <button type="button" className="btn btn-quiet" onClick={() => setDetail(null)}>
              Zatvori
            </button>
          </div>
        </section>
      )}

      {/* =================================================== STANJE PRAVILA == */}
      <section className="control-section">
        <h2>Kontrole i pragovi</h2>
        <table className="list list-compact">
          <thead>
            <tr><th>Kontrola</th><th>Entitet</th><th>Prioritet</th>
              <th className="num">Prag</th><th>Stanje</th></tr>
          </thead>
          <tbody>
            {run.rules.map((r) => (
              <tr key={r.rule_code} className={r.status === 'ACTIVE' ? '' : 'row-muted'}>
                <td>
                  <strong>{r.name}</strong>
                  <div className="muted small">{r.description}</div>
                </td>
                <td>{r.entity_type}</td>
                <td>{SEVERITY_LABEL[(r.severity ?? r.default_severity)]}</td>
                <td className="num">
                  {r.threshold_value === null
                    ? (r.requires_threshold ? 'nije potvrđen' : '—')
                    : `${formatNumber(r.threshold_value)} ${r.threshold_unit ?? ''}`}
                </td>
                <td>{RULE_STATUS_LABEL[r.status] ?? r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {inactive.length > 0 && (
          <>
            <h3>Zašto neke kontrole nisu radile</h3>
            <ul className="ctrl-list">
              {inactive.map((i) => (
                <li key={i.rule.rule_code} className="muted">
                  <strong>{i.rule.name}</strong> — {i.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
