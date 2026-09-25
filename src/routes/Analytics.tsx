import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import {
  barWidth,
  comparisonLabel,
  defaultRange,
  fillDailyGaps,
  formatNumber,
  kpiCards,
  maxAbs,
  rangeIsValid,
  rateLabel,
} from '../features/analytics/model';
import { describeRange, rangeNotice } from '../features/analytics/period';
import { WdrApiError } from '../lib/api';
import type {
  AdminConfig,
  BaCenters,
  BaDaily,
  BaEmployees,
  BaEmployeeSort,
  BaFinanceTimeline,
  BaOverview,
  BaPaymentBreakdown,
  BaTransport,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

type Section = 'pregled' | 'dnevno' | 'zaposleni' | 'prevoz' | 'stopovi';

const TABS: Array<{ key: Section; label: string; to: string }> = [
  { key: 'pregled', label: 'Pregled', to: '/analitika' },
  { key: 'dnevno', label: 'Dnevno', to: '/analitika/dnevno' },
  { key: 'zaposleni', label: 'Zaposleni', to: '/analitika/zaposleni' },
  { key: 'prevoz', label: 'Prevoz', to: '/analitika/prevoz' },
  // Stopovi kurira su ZASEBNA kategorija troška i ne ulaze u KPI-jeve iznad.
  { key: 'stopovi', label: 'Stopovi kurira', to: '/analitika/stopovi-kurira' },
];

const SORTS: Array<{ key: BaEmployeeSort; label: string }> = [
  { key: 'TOTAL', label: 'Ukupan trošak' },
  { key: 'OVERTIME', label: 'Prekovremeni' },
  { key: 'ADJUSTMENTS', label: 'Korekcije' },
  { key: 'WORKED_DAYS', label: 'Radni dani' },
  { key: 'NAME', label: 'Ime' },
];

/**
 * `/analitika` i podsekcije.
 *
 * Agregacija je u bazi; ovde se samo prikazuje. Grafikoni su CSS stupci bez
 * ijedne dodatne zavisnosti — nema eksternog BI servisa ni plaćene usluge.
 * Filteri (od, do, centri) su ULAZ u RPC, ne filtriranje globalnog skupa.
 */
export function Analytics({ section }: { section: Section }) {
  const { api } = useAuth();
  const initial = defaultRange();

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [centerIds, setCenterIds] = useState<string[]>([]);
  const [cfg, setCfg] = useState<AdminConfig | null>(null);

  const [overview, setOverview] = useState<BaOverview | null>(null);
  const [daily, setDaily] = useState<BaDaily | null>(null);
  const [centers, setCenters] = useState<BaCenters | null>(null);
  const [payments, setPayments] = useState<BaPaymentBreakdown | null>(null);
  const [transport, setTransport] = useState<BaTransport | null>(null);
  const [employees, setEmployees] = useState<BaEmployees | null>(null);
  const [timeline, setTimeline] = useState<BaFinanceTimeline | null>(null);

  const [sort, setSort] = useState<BaEmployeeSort>('TOTAL');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setCfg(await api.getAdminConfig());
      } catch {
        setCfg(null);
      }
    })();
  }, [api]);

  const load = useCallback(async () => {
    if (!rangeIsValid(from, to)) return;
    setBusy(true);
    setError(null);
    const ids = centerIds.length > 0 ? centerIds : null;
    try {
      if (section === 'pregled') {
        const [o, d, c, p, t] = await Promise.all([
          api.baOverview(from, to, ids),
          api.baDaily(from, to, ids),
          api.baCenters(from, to, ids),
          api.baPaymentBreakdown(from, to, ids),
          api.baFinanceTimeline(from, to, ids),
        ]);
        setOverview(o); setDaily(d); setCenters(c); setPayments(p); setTimeline(t);
        setEmployees(await api.baEmployees(from, to, ids, null, 'TOTAL', 5, 0));
      } else if (section === 'dnevno') {
        setDaily(await api.baDaily(from, to, ids, true));
        setOverview(await api.baOverview(from, to, ids));
      } else if (section === 'zaposleni') {
        setEmployees(await api.baEmployees(
          from, to, ids, search.trim() === '' ? null : search.trim(), sort, 50, 0,
        ));
      } else {
        setTransport(await api.baTransport(from, to, ids));
      }
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    } finally {
      setBusy(false);
    }
  }, [api, section, from, to, centerIds, sort, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const rangeInfo = describeRange(from, to, today);
  const rangeMessage = rangeNotice(rangeInfo);

  const dailyRows = daily ? fillDailyGaps(daily.items, from, to) : [];
  const dailyMax = maxAbs(dailyRows.map((r) => r.total_calculated_amount));

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Analitika</h1>
          <p className="muted">
            Ekonomski trošak po <strong>datumu rada</strong>, isključivo iz odobrenih
            nepromenljivih obračuna. Neodobreni periodi se ne prikazuju.
          </p>
        </div>
      </div>

      <div className="filter-row tabs">
        {TABS.map((t) => (
          <Link
            key={t.key}
            to={t.to}
            className={t.key === section ? 'btn btn-primary' : 'btn btn-quiet'}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Filteri su ulaz u RPC — server ih sprovodi. */}
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
        {section === 'zaposleni' && (
          <>
            <label><span>Zaposleni</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} /></label>
            <label><span>Sortiranje</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as BaEmployeeSort)}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select></label>
          </>
        )}
      </div>

      {/*
        Parcijalan raspon je najskuplja zabuna u analitici: broj za 23 dana
        izgleda kao mesečni trošak. Zato se raspon uvek ispisuje eksplicitno.
      */}
      <div className="range-chip">
        <span className="metric-label">Period</span>
        <strong>{rangeInfo.label}</strong>
        {rangeInfo.valid && <span className="muted small">{rangeInfo.days} dana</span>}
        {rangeInfo.wholeMonth && <span className="chip">ceo mesec</span>}
        {rangeInfo.partialMonth && <span className="chip chip-warn">parcijalan mesec</span>}
      </div>
      {rangeMessage && <Banner kind={rangeMessage.kind}>{rangeMessage.text}</Banner>}

      {!rangeIsValid(from, to) && (
        <Banner kind="warning">Datum „od" mora biti pre ili jednak datumu „do".</Banner>
      )}
      {error && <Banner kind="error">{error}</Banner>}
      {busy && <Spinner label="Računanje analitike…" />}

      {/* ======================================================== PREGLED == */}
      {section === 'pregled' && overview && (
        <>
          {overview.approved_snapshots === 0 && (
            <EmptyState
              title="Nema odobrenih obračuna u ovom periodu"
              hint="Analitika prikazuje samo odobrene obračune; poslati periodi se ne računaju."
            />
          )}

          <div className="metrics">
            {kpiCards(overview).map((c) => {
              const cmp = comparisonLabel(c.kpi);
              return (
                <div key={c.key} className="metric">
                  <span className="metric-label">{c.label}</span>
                  <span className="metric-value">
                    {c.value === null
                      ? '—'
                      : c.unit === 'money'
                        ? formatRsd(c.value)
                        : formatNumber(c.value)}
                  </span>
                  <span className={`small ${cmp.kind === 'up' ? 'v-warn' : 'muted'}`}>
                    {cmp.text}
                  </span>
                </div>
              );
            })}
          </div>

          <section className="control-section">
            <h2>Konačan ekonomski trošak</h2>
            <table className="list list-compact">
              <tbody>
                <tr>
                  <td>Redovno odobreno</td>
                  <td className="num">
                    {formatRsd(overview.economic_reconciliation.regular_approved_amount)}
                  </td>
                </tr>
                <tr>
                  <td>Neto korekcije (sa znakom)</td>
                  <td className="num">
                    {formatRsd(overview.economic_reconciliation.net_adjustment_amount)}
                  </td>
                </tr>
                <tr>
                  <td><strong>Konačan ekonomski trošak</strong></td>
                  <td className="num">
                    <strong>
                      {formatRsd(overview.economic_reconciliation.final_economic_amount)}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">
              {overview.definitions.cost_per_worked_employee_day}
            </p>
          </section>

          <section className="control-section">
            <h2>Dnevni trend troška</h2>
            {dailyRows.length === 0 ? (
              <p className="muted">Nema podataka za izabrani period.</p>
            ) : (
              <table className="list list-compact">
                <tbody>
                  {dailyRows.map((r) => (
                    <tr key={r.work_date}>
                      <td style={{ width: '7rem' }}>{r.work_date}</td>
                      <td>
                        <div
                          className="bar"
                          style={{ width: `${barWidth(r.total_calculated_amount, dailyMax)}%` }}
                        />
                      </td>
                      <td className="num">{formatRsd(r.total_calculated_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {centers && (
            <section className="control-section">
              <h2>Poređenje centara</h2>
              <table className="list list-compact">
                <thead>
                  <tr><th>Centar</th><th className="num">Employee-dani</th>
                    <th className="num">Naknade</th><th className="num">Prevoz</th>
                    <th className="num">Korekcije</th><th className="num">Ukupno</th>
                    <th className="num">Po danu</th><th className="num">Udeo</th>
                    <th className="num">vs. prethodni</th></tr>
                </thead>
                <tbody>
                  {centers.items.map((c) => (
                    <tr key={c.center_code}>
                      <td><strong>{c.center_code}</strong></td>
                      <td className="num">{c.worked_employee_days}</td>
                      <td className="num">{formatRsd(c.employee_calculated_amount)}</td>
                      <td className="num">{formatRsd(c.transport_calculated_amount)}</td>
                      <td className="num">{formatRsd(c.adjustment_calculated_amount)}</td>
                      <td className="num"><strong>{formatRsd(c.total_calculated_amount)}</strong></td>
                      <td className="num">{formatRsd(c.cost_per_worked_employee_day)}</td>
                      <td className="num">
                        {c.share_of_total === null ? '—' : `${formatNumber(c.share_of_total)}%`}
                      </td>
                      <td className="num">
                        {c.percentage_change === null
                          ? formatRsd(c.absolute_change)
                          : `${formatNumber(c.percentage_change)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {payments && (
            <section className="control-section">
              <h2>Struktura troška</h2>
              <table className="list list-compact">
                <thead>
                  <tr><th>Grupa</th><th className="num">Količina</th>
                    <th className="num">Iznos</th><th className="num">Udeo</th><th /></tr>
                </thead>
                <tbody>
                  {payments.items.map((p) => (
                    <tr key={p.group_key}>
                      <td>{p.label}</td>
                      <td className="num">{formatNumber(p.units)}</td>
                      <td className="num">{formatRsd(p.amount)}</td>
                      <td className="num">
                        {p.share_of_total === null ? '—' : `${formatNumber(p.share_of_total)}%`}
                      </td>
                      <td>
                        <div
                          className="bar"
                          style={{
                            width: `${barWidth(p.amount,
                              maxAbs(payments.items.map((x) => x.amount)))}%`,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Grupisanje koristi semantiku zapisanu u obračunu, pa preimenovanje vrste
                isplate ne menja istorijske grupe.
              </p>
            </section>
          )}

          {employees && employees.items.length > 0 && (
            <section className="control-section">
              <h2>Najveći ekonomski trošak po zaposlenom</h2>
              <table className="list list-compact">
                <thead>
                  <tr><th>Zaposleni</th><th className="num">Radni dani</th>
                    <th className="num">Prekovremeni</th><th className="num">Ukupno</th></tr>
                </thead>
                <tbody>
                  {employees.items.map((e) => (
                    <tr key={e.employee_id}>
                      <td>{e.employee_name_snapshot}</td>
                      <td className="num">{e.worked_days}</td>
                      <td className="num">{formatNumber(e.overtime_hours)}</td>
                      <td className="num">{formatRsd(e.total_calculated_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {timeline && (
            <section className="control-section">
              <h2>Finansijski tok po datumu odobrenja</h2>
              <Banner kind="info">
                Ovo <strong>nije</strong> ekonomski trošak po datumu rada. Julska korekcija
                odobrena u avgustu ovde se vidi u avgustu, a u ekonomskoj analizi u julu.
              </Banner>
              <table className="list list-compact">
                <tbody>
                  <tr><td>Broj odobrenja</td>
                    <td className="num">{timeline.totals.approval_count}</td></tr>
                  <tr><td>Redovna odobrenja</td>
                    <td className="num">{formatRsd(timeline.totals.regular_approved_amount)}</td></tr>
                  <tr><td>Odobrene korekcije</td>
                    <td className="num">{formatRsd(timeline.totals.adjustment_approved_amount)}</td></tr>
                  <tr><td><strong>Ukupno odobreno u periodu</strong></td>
                    <td className="num"><strong>
                      {formatRsd(timeline.totals.total_approved_amount)}
                    </strong></td></tr>
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* ========================================================= DNEVNO == */}
      {section === 'dnevno' && daily && (
        <section className="control-section">
          <h2>Dnevna analitika</h2>
          {daily.items.length === 0 ? (
            <EmptyState title="Nema odobrenih obračuna u ovom periodu" />
          ) : (
            <table className="list list-compact">
              <thead>
                <tr><th>Datum</th><th>Centar</th><th className="num">Zaposlenih</th>
                  <th className="num">Radni dani</th><th className="num">GO</th>
                  <th className="num">BO</th><th className="num">Prekovremeni</th>
                  <th className="num">Naknade</th><th className="num">Prevoz</th>
                  <th className="num">Korekcije</th><th className="num">Ukupno</th>
                  <th className="num">Po danu</th></tr>
              </thead>
              <tbody>
                {daily.items.map((r, i) => (
                  <tr key={`${r.work_date}-${r.center_code ?? 'all'}-${i}`}>
                    <td>{r.work_date}</td>
                    <td>{r.center_code ?? 'svi'}</td>
                    <td className="num">{r.distinct_employees}</td>
                    <td className="num">{r.worked_employee_days}</td>
                    <td className="num">{r.go_days}</td>
                    <td className="num">{r.bo_days}</td>
                    <td className="num">{formatNumber(r.overtime_hours)}</td>
                    <td className="num">{formatRsd(r.employee_calculated_amount)}</td>
                    <td className="num">{formatRsd(r.transport_calculated_amount)}</td>
                    <td className="num">{formatRsd(r.adjustment_calculated_amount)}</td>
                    <td className="num"><strong>{formatRsd(r.total_calculated_amount)}</strong></td>
                    <td className="num">{formatRsd(r.cost_per_worked_employee_day)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Period koji preseca mesec je prirodno razdvojen po stvarnom datumu rada.
          </p>
        </section>
      )}

      {/* ====================================================== ZAPOSLENI == */}
      {section === 'zaposleni' && employees && (
        <section className="control-section">
          <h2>Analitika zaposlenih</h2>
          {employees.items.length === 0 ? (
            <EmptyState title="Nema odobrenih obračuna za ove kriterijume" />
          ) : (
            <>
              <table className="list list-compact">
                <thead>
                  <tr><th>Zaposleni (u obračunu)</th><th>Trenutno ime</th>
                    <th className="num">Radni dani</th><th className="num">GO</th>
                    <th className="num">BO</th><th className="num">Prekovremeni</th>
                    <th className="num">Naknade</th><th className="num">Prevoz</th>
                    <th className="num">Korekcije</th><th className="num">Ukupno</th>
                    <th className="num">Po radnom danu</th></tr>
                </thead>
                <tbody>
                  {employees.items.map((e) => (
                    <tr key={e.employee_id}>
                      <td><strong>{e.employee_name_snapshot}</strong></td>
                      <td className="muted">
                        {e.employee_current_name !== e.employee_name_snapshot
                          ? e.employee_current_name ?? '—'
                          : ''}
                      </td>
                      <td className="num">{e.worked_days}</td>
                      <td className="num">{e.go_days}</td>
                      <td className="num">{e.bo_days}</td>
                      <td className="num">{formatNumber(e.overtime_hours)}</td>
                      <td className="num">{formatRsd(e.employee_calculated_amount)}</td>
                      <td className="num">{formatRsd(e.transport_calculated_amount)}</td>
                      <td className="num">{formatRsd(e.adjustment_calculated_amount)}</td>
                      <td className="num"><strong>{formatRsd(e.total_calculated_amount)}</strong></td>
                      <td className="num">{formatRsd(e.cost_per_worked_day)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Prikazano {employees.items.length} od {employees.total_rows}. Ime je iz
                obračuna (istorijsko); trenutno ime se prikazuje samo ako se razlikuje.
              </p>
            </>
          )}
        </section>
      )}

      {/* ========================================================= PREVOZ == */}
      {section === 'prevoz' && transport && (
        <section className="control-section">
          <h2>Analitika prevoza</h2>
          {transport.items.length === 0 ? (
            <EmptyState title="Nema odobrenog prevoza u ovom periodu" />
          ) : (
            <>
              <p>
                Ukupno prevoz: <strong>{formatRsd(transport.transport_total_amount)}</strong>
              </p>
              <table className="list list-compact">
                <thead>
                  <tr><th>Centar</th><th>Prevoznik</th><th>Odgovorno lice</th>
                    <th className="num">Employee-dani</th><th className="num">Stopa</th>
                    <th className="num">Iznos</th><th className="num">Udeo</th></tr>
                </thead>
                <tbody>
                  {transport.items.map((t, i) => (
                    <tr key={`${t.center_code}-${t.transport_provider_code}-${i}`}>
                      <td>{t.center_code ?? '—'}</td>
                      <td><strong>{t.transport_provider_code ?? '—'}</strong></td>
                      <td>{t.responsible_person_code ?? '—'}</td>
                      <td className="num">{formatNumber(t.employee_days)}</td>
                      <td className="num">{rateLabel(t)}</td>
                      <td className="num">{formatRsd(t.amount)}</td>
                      <td className="num">
                        {t.share_of_transport === null
                          ? '—'
                          : `${formatNumber(t.share_of_transport)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Prevoznik, odgovorno lice i stopa su vrednosti iz obračuna u trenutku
                odobrenja. Kada grupa ima više stopa, prikazuje se raspon — prosek bi
                zavaravao.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
