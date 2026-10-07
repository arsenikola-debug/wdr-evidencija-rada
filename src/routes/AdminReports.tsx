import { useCallback, useEffect, useMemo, useState } from 'react';
import { CenterMultiSelect } from '../components/CenterMultiSelect';
import { groupByCenter } from '../features/reports/groupByCenter';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { defaultRange, rangeIsValid } from '../features/analytics/model';
import { formatDay } from '../features/analytics/period';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import {
  buildPayoutWorkbook,
  categoryLabel,
  reportFileName,
} from '../features/reports/payoutReport';
import { WdrApiError } from '../lib/api';
import type { AdminConfig, AdminPayoutReport } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

type Tab = 'employees' | 'days' | 'multi';

/**
 * Admin izveštaji (redizajn §22–24).
 *
 * Svi brojevi dolaze iz `api.rpc_admin_payout_report` (samo odobreni snapshot-i,
 * po datumu rada). Stranica ništa ne preračunava; Excel je isti skup podataka.
 */
export function AdminReports() {
  const { api } = useAuth();
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [centerIds, setCenterIds] = useState<string[]>([]);
  const [report, setReport] = useState<AdminPayoutReport | null>(null);
  const [tab, setTab] = useState<Tab>('employees');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminConfig().then(setCfg).catch(() => setCfg(null));
  }, [api]);

  const load = useCallback(async () => {
    if (!rangeIsValid(from, to)) {
      setError('Izaberite ispravan opseg datuma.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setReport(await api.adminPayoutReport(from, to, centerIds.length > 0 ? centerIds : null));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, [api, from, to, centerIds]);

  useEffect(() => {
    void load();
    // Prvo učitavanje sa podrazumevanim opsegom; dalje na dugme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportXlsx() {
    if (!report) return;
    setExporting(true);
    try {
      // ExcelJS se učitava tek na zahtev, da ne opterećuje ostatak aplikacije.
      const mod = await import('exceljs');
      const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const wb = buildPayoutWorkbook(ExcelJS, report);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = reportFileName(report);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(`Excel izvoz nije uspeo: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  // Kolone su samo kategorije koje u izveštaju imaju vrednost (Excel ima sve).
  const usedCats = useMemo(() => {
    if (!report) return [];
    const used = new Set<string>();
    for (const r of report.by_employee) Object.keys(r.categories).forEach((k) => used.add(k));
    for (const d of report.by_day) Object.keys(d.counts).forEach((k) => used.add(k));
    return report.categories.filter((c) => used.has(c.key) && c.key !== 'PREVOZ');
  }, [report]);
  const amountCats = useMemo(() => usedCats.filter((c) => !c.headcount_only), [usedCats]);

  const centers = cfg?.centers ?? [];

  return (
    <div className="page">
      <h1>Izveštaji isplata</h1>
      <p className="muted small">
        Samo odobreni obračuni, po datumu rada. Iznosi uključuju odobrene korekcije.
        Prevoz se prikazuje odvojeno i nije deo naknade zaposlenom.
      </p>

      <div className="report-filters toolbar-unified">
        <label>
          <span>Od</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span>Do</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {centers.length > 0 && (
          <CenterMultiSelect
            centers={centers.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
            value={centerIds}
            onChange={setCenterIds}
          />
        )}
        <button type="button" className="btn btn-primary" onClick={() => void load()} disabled={busy}>
          {busy ? 'Učitavanje…' : 'Prikaži'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void exportXlsx()}
          disabled={!report || exporting}
          title="Pravi .xlsx fajl: Po zaposlenom, Po danu i centru, Višestruke kategorije"
        >
          {exporting ? 'Pravim Excel…' : 'Izvezi u Excel (.xlsx)'}
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {busy && !report && <Spinner label="Učitavanje izveštaja…" />}

      {report && (
        <>
          <div className="metrics">
            <div className="metric">
              <span className="metric-label">Zaposlenih</span>
              <span className="metric-value">{report.totals.employees}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Ukupno naknade</span>
              <span className="metric-value">{formatRsd(report.totals.payout_total)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Od toga korekcije</span>
              <span className="metric-value">{formatRsd(report.totals.adjustment_amount)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Prevoz (odvojeno)</span>
              <span className="metric-value">{formatRsd(report.totals.transport_amount)}</span>
            </div>
          </div>

          <div className="tabs" role="tablist">
            {([
              ['employees', `Po zaposlenom (${report.by_employee.length})`],
              ['days', `Po danu i centru (${report.by_day.length})`],
              ['multi', `Više kategorija istog dana (${report.multi_category.length})`],
            ] as Array<[Tab, string]>).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={tab === k ? 'btn btn-primary' : 'btn'}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'employees' && (
            report.by_employee.length === 0 ? (
              <EmptyState title="Nema odobrenih isplata u izabranom periodu" />
            ) : (
              groupByCenter(report.by_employee, (r) => [r.center_code]).map((g) => (
              <section key={g.centerCode} className="report-center-group">
              <h3>{g.centerCode} <span className="muted small">· {g.rows.length} zaposl.</span></h3>
              <div className="table-scroll">
                <table className="list list-compact">
                  <thead>
                    <tr>
                      <th>Šifra</th>
                      <th>Zaposleni</th>
                      <th>Centar</th>
                      {amountCats.map((c) => (
                        <th key={c.key} className="num">{c.label}</th>
                      ))}
                      <th className="num">Korekcije</th>
                      <th className="num">Ukupno</th>
                      <th className="num">Prevoz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={`${r.employee_id}-${r.center_id}`}>
                        <td>{r.employee_code ?? '—'}</td>
                        <td>{r.employee_name}</td>
                        <td>{r.center_code}</td>
                        {amountCats.map((c) => {
                          const cell = r.categories[c.key];
                          return (
                            <td key={c.key} className="num" title={cell ? `količina: ${cell.units}` : undefined}>
                              {cell ? formatRsd(cell.amount) : '—'}
                              {cell && c.key !== 'KARNET' && c.key !== 'OBUKA' && (
                                <span className="muted small"> ({cell.units})</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="num">{formatRsd(r.adjustment_amount)}</td>
                        <td className="num"><strong>{formatRsd(r.payout_total)}</strong></td>
                        <td className="num">{formatRsd(r.transport_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </section>
              ))
            )
          )}

          {tab === 'days' && (
            report.by_day.length === 0 ? (
              <EmptyState title="Nema evidentiranih ljudi u izabranom periodu" />
            ) : (
              groupByCenter(report.by_day, (d) => [d.center_code]).map((g) => (
              <section key={g.centerCode} className="report-center-group">
              <h3>{g.centerCode}</h3>
              <div className="table-scroll">
                <table className="list list-compact">
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Centar</th>
                      {usedCats.map((c) => (
                        <th key={c.key} className="num">{c.label}</th>
                      ))}
                      <th className="num">U više kategorija</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((d) => (
                      <tr key={`${d.work_date}-${d.center_id}`}>
                        <td>{formatDay(d.work_date)}</td>
                        <td>{d.center_code}</td>
                        {usedCats.map((c) => (
                          <td key={c.key} className="num">{d.counts[c.key] ?? 0}</td>
                        ))}
                        <td className="num">
                          {d.multi_category_employees > 0 ? (
                            <span className="chip chip-warn">{d.multi_category_employees}</span>
                          ) : 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </section>
              ))
            )
          )}

          {tab === 'multi' && (
            <>
              <p className="muted small">
                Zaposleni se broji u svakoj kategoriji u kojoj je evidentiran. Ova lista nije
                spisak grešaka — služi da se proveri da li je kombinacija očekivana.
              </p>
              {report.multi_category.length === 0 ? (
                <EmptyState title="Nema zaposlenih u više kategorija istog dana" />
              ) : (
                groupByCenter(report.multi_category, (m) => m.center_codes).map((g) => (
                <section key={g.centerCode} className="report-center-group">
                <h3>{g.centerCode}</h3>
                <table className="list list-compact">
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Šifra</th>
                      <th>Zaposleni</th>
                      <th>Centar</th>
                      <th>Kategorije</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((m) => (
                      <tr key={`${m.employee_id}-${m.work_date}`}>
                        <td>{formatDay(m.work_date)}</td>
                        <td>{m.employee_code ?? '—'}</td>
                        <td>{m.employee_name}</td>
                        <td>{m.center_codes.join(', ')}</td>
                        <td>{m.categories.map((k) => categoryLabel(report, k)).join(' + ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </section>
                ))
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
