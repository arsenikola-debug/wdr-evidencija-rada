import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { defaultRange, formatNumber, rangeIsValid } from '../features/analytics/model';
import { WdrApiError } from '../lib/api';
import type { AdminConfig } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

interface Totals {
  total_stops: number;
  approved_cost: number;
  cost_per_stop: number | null;
  courier_count: number;
  active_courier_days: number;
  avg_stops_per_courier_day: number | null;
}
interface ByCourier {
  employee_id: string | null; employee_name: string;
  stops: number; approved_cost: number; active_days: number;
}
interface ByKey { stops: number; approved_cost: number }
interface BaStops {
  totals: Totals;
  by_courier: ByCourier[];
  by_center: Array<ByKey & { center_code: string }>;
  by_work_date: Array<ByKey & { work_date: string }>;
  by_month: Array<ByKey & { month: string }>;
  note: string;
}

const TABS = [
  { label: 'Pregled', to: '/analitika' },
  { label: 'Dnevno', to: '/analitika/dnevno' },
  { label: 'Zaposleni', to: '/analitika/zaposleni' },
  { label: 'Prevoz', to: '/analitika/prevoz' },
  { label: 'Stopovi kurira', to: '/analitika/stopovi-kurira' },
];

/**
 * Analitika stopova kurira.
 *
 * Novac dolazi ISKLJUČIVO iz odobrenih snapshot-a koje vraća server; ovde se
 * ništa ne preračunava. Troškovi stopova su namerno ZASEBNA kategorija i ne
 * ulaze u postojeće KPI-jeve ukupnog troška redovne evidencije — inače bi se
 * ista para brojala dvaput ili bi postojeći pokazatelj tiho promenio značenje.
 *
 * Nema rangiranja kurira, ocena, ciljeva ni pragova.
 */
export function AnalyticsCourierStops() {
  const { api } = useAuth();
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [centerIds, setCenterIds] = useState<string[]>([]);
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [data, setData] = useState<BaStops | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Isti izvor spiska centara kao ostatak Analitike.
  useEffect(() => {
    void (async () => {
      try { setCfg(await api.getAdminConfig()); } catch { setCfg(null); }
    })();
  }, [api]);

  const load = useCallback(async () => {
    if (!rangeIsValid(from, to)) {
      setError('Period nije ispravan: „od" mora biti pre „do".');
      return;
    }
    setError(null);
    setData(null);
    try {
      setData(await api.baCourierStops(
        from, to, centerIds.length > 0 ? centerIds : null) as BaStops);
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api, from, to, centerIds]);

  useEffect(() => { void load(); }, [load]);

  const t = data?.totals;

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Analitika — stopovi kurira</h1>
          <p className="muted">Odobreni trošak stopova po datumu rada.</p>
        </div>
      </div>

      <nav className="filter-row tabs" aria-label="Sekcije analitike">
        {TABS.map((x) => (
          <Link key={x.to} to={x.to}
            className={x.to === '/analitika/stopovi-kurira' ? 'btn btn-primary' : 'btn btn-quiet'}>
            {x.label}
          </Link>
        ))}
      </nav>

      <div className="filter-row">
        <label><span>Datum rada od</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label><span>do</span>
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
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!data && !error && <Spinner label="Učitavanje analitike stopova…" />}

      {data && t && t.total_stops === 0 && (
        <EmptyState title="Nema odobrenih stopova u izabranom periodu."
          hint="Analitika se gradi isključivo iz odobrenih obračuna." />
      )}

      {data && t && t.total_stops > 0 && (
        <>
          <div className="kpi-row">
            <div className="kpi">
              <span className="kpi-label">Ukupno stopova</span>
              <strong className="kpi-value">{formatNumber(t.total_stops)}</strong>
            </div>
            <div className="kpi">
              <span className="kpi-label">Odobreni trošak stopova</span>
              <strong className="kpi-value">{formatRsd(t.approved_cost)}</strong>
            </div>
            <div className="kpi">
              <span className="kpi-label">Trošak po stopu</span>
              <strong className="kpi-value">
                {t.cost_per_stop === null ? '—' : formatRsd(t.cost_per_stop)}
              </strong>
            </div>
            <div className="kpi">
              <span className="kpi-label">Prosečno stopova po kuriru/danu</span>
              <strong className="kpi-value">
                {t.avg_stops_per_courier_day === null
                  ? '—' : formatNumber(t.avg_stops_per_courier_day)}
              </strong>
            </div>
            <div className="kpi">
              <span className="kpi-label">Aktivnih kurira</span>
              <strong className="kpi-value">{formatNumber(t.courier_count)}</strong>
            </div>
            <div className="kpi">
              <span className="kpi-label">Aktivnih dana kurira</span>
              <strong className="kpi-value">{formatNumber(t.active_courier_days)}</strong>
            </div>
          </div>

          <Banner kind="info">
            Ovo je zaseban trošak i NE ulazi u ukupne troškove redovne evidencije.
            Iznosi dolaze iz odobrenih obračuna i ne preračunavaju se tekućim cenama.
          </Banner>

          <h3>Po kuriru</h3>
          <table className="list list-compact">
            <thead>
              <tr><th>Kurir</th><th>Stopova</th><th>Aktivnih dana</th>
                <th>Odobreni trošak</th></tr>
            </thead>
            <tbody>
              {data.by_courier.map((c) => (
                <tr key={c.employee_id ?? c.employee_name}>
                  <td>{c.employee_name}</td>
                  <td>{formatNumber(c.stops)}</td>
                  <td>{formatNumber(c.active_days)}</td>
                  <td>{formatRsd(c.approved_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Po centru</h3>
          <table className="list list-compact">
            <thead><tr><th>Centar</th><th>Stopova</th><th>Odobreni trošak</th></tr></thead>
            <tbody>
              {data.by_center.map((c) => (
                <tr key={c.center_code}>
                  <td>{c.center_code}</td>
                  <td>{formatNumber(c.stops)}</td>
                  <td>{formatRsd(c.approved_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Po mesecu</h3>
          <p className="muted small">
            Podela ide po STVARNOM datumu rada, pa jedno odobrenje koje prelazi
            granicu meseca ostaje jedna finansijska transakcija, a ovde se deli.
          </p>
          <table className="list list-compact">
            <thead><tr><th>Mesec</th><th>Stopova</th><th>Odobreni trošak</th></tr></thead>
            <tbody>
              {data.by_month.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{formatNumber(m.stops)}</td>
                  <td>{formatRsd(m.approved_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Po datumu rada</h3>
          <table className="list list-compact">
            <thead><tr><th>Datum rada</th><th>Stopova</th><th>Odobreni trošak</th></tr></thead>
            <tbody>
              {data.by_work_date.map((d) => (
                <tr key={d.work_date}>
                  <td>{d.work_date}</td>
                  <td>{formatNumber(d.stops)}</td>
                  <td>{formatRsd(d.approved_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
