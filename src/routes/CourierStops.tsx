import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import {
  STATUS_LABEL, buildRows, canSubmit, dayLabel, isEditable, parseStopInput, periodDates,
  rowTotal,
} from '../features/courierStops/model';
import type { CourierRow, CourierStopDetail } from '../features/courierStops/model';
import { WdrApiError } from '../lib/api';

interface CenterOption { id: string; code: string; name: string }
interface PeriodOption { id: string; label: string; period_start: string; period_end: string }
interface CourierOption { id: string; full_name: string; employee_code: string | null }
interface StopContext {
  centers: CenterOption[];
  periods: PeriodOption[];
  employees: CourierOption[];
}
import { CourierStopCorrections } from './CourierStopCorrections';
import { useAuth } from '../lib/auth/AuthProvider';

/**
 * „Stopovi kurira" — ZASEBNA evidencija.
 *
 * Namerno nije deo Karnet/Obuka grida: broj stopova nije komponenta radnog dana
 * nego druga vrsta poslovnog događaja, sa svojim tokom odobravanja. Ćelija
 * sadrži broj stopova i ništa drugo — cena i iznos dolaze sa servera i samo se
 * prikazuju.
 */
export function CourierStops() {
  const { api, can } = useAuth();

  const [centers, setCenters] = useState<CenterOption[]>([]);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [employees, setEmployees] = useState<CourierOption[]>([]);
  const [centerId, setCenterId] = useState('');
  const [periodId, setPeriodId] = useState('');

  const [detail, setDetail] = useState<CourierStopDetail | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [extraCouriers, setExtraCouriers] = useState<CourierOption[]>([]);

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const mayEdit = can('courier_stops.edit');
  const maySubmit = can('courier_stops.submit');

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const ctx = await api.courierStopContext() as StopContext;
        setCenters(ctx.centers);
        setPeriods(ctx.periods);
        setEmployees(ctx.employees);
        if (ctx.centers.length === 1) setCenterId(ctx.centers[0].id);
      } catch (err) {
        fail(err);
      }
    })();
  }, [api, fail]);

  const reload = useCallback(async (id: string) => {
    setLoading(true);
    try {
      setDetail(await api.courierStopFinanceDetail(id) as CourierStopDetail);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }, [api, fail]);

  const openSubmission = useCallback(async () => {
    if (!centerId || !periodId) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const sub = await api.courierStopOpenSubmission(periodId, centerId) as { id: string };
      setSubmissionId(sub.id);
      setExtraCouriers([]);
      await reload(sub.id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [api, centerId, periodId, reload, fail]);

  const dates = useMemo(
    () => (detail ? periodDates(detail.submission.period_start, detail.submission.period_end) : []),
    [detail],
  );

  const rows: CourierRow[] = useMemo(
    () => buildRows(
      // Identitet reda dolazi iz `employee_id` sa servera. Ranije se pogađao
      // poređenjem imena, što bi kod imenjaka upisalo stopove pogrešnoj osobi.
      detail?.lines.map((l) => ({
        employee_id: l.employee_id,
        employee_name: l.employee_name,
        employee_code: l.employee_code,
        work_date: l.work_date,
        stop_count: l.stop_count,
      })) ?? [],
      extraCouriers.map((e) => ({ employee_id: e.id, full_name: e.full_name })),
    ),
    [detail, extraCouriers],
  );

  const editable = isEditable(detail) && mayEdit;

  async function setStops(employeeId: string, workDate: string, raw: string) {
    if (!submissionId) return;
    const parsed = parseStopInput(raw);
    if (parsed.kind === 'error') {
      // Negativna vrednost se zaustavlja ovde i objašnjava; server je odbija i
      // sam (INVALID_STOP_COUNT), ali operater ne treba da čeka mrežni poziv.
      setCellError(parsed.message);
      return;
    }
    setCellError(null);
    setSaving(`${employeeId}|${workDate}`);
    try {
      await api.courierStopSetEntry(
        submissionId, employeeId, workDate, parsed.kind === 'clear' ? 0 : parsed.value,
      );
      await reload(submissionId);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(null);
    }
  }

  async function submit() {
    if (!submissionId) return;
    setBusy(true);
    setError(null);
    try {
      await api.courierStopSubmit(submissionId);
      setNotice('Stopovi su poslati Finansijama.');
      await reload(submissionId);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const hardErrors = detail?.errors.filter((e) => e.severity === 'ERROR') ?? [];

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Stopovi kurira</h1>
          <p className="muted">Operater unosi broj stopova; cenu i iznos računa server.</p>
        </div>
        {detail && (
          <div className="page-head-actions">
            <span className="badge">{STATUS_LABEL[detail.submission.status]}</span>
          </div>
        )}
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="success">{notice}</Banner>}

      <div className="filter-row">
        <label><span>Centar</span>
          <select value={centerId} onChange={(e) => setCenterId(e.target.value)}>
            <option value="">—</option>
            {centers.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </label>
        <label><span>Period</span>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">—</option>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <button
          type="button" className="btn btn-primary"
          disabled={busy || !centerId || !periodId}
          onClick={() => void openSubmission()}
        >
          Otvori evidenciju
        </button>
      </div>

      {loading && <Spinner label="Učitavanje evidencije stopova…" />}

      {detail && detail.submission.status === 'RETURNED' && detail.submission.return_reason && (
        <Banner kind="warning">
          Finansije su vratile evidenciju na ispravku: {detail.submission.return_reason}
        </Banner>
      )}

      {hardErrors.length > 0 && (
        <Banner kind="error">
          <strong>Slanje nije moguće dok ovo ne bude rešeno:</strong>
          <ul>{hardErrors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </Banner>
      )}

      {cellError && <Banner kind="error">{cellError}</Banner>}

      {detail && (
        <>
          {editable && (
            <div className="filter-row">
              <label><span>Dodaj kurira</span>
                <select
                  value=""
                  onChange={(e) => {
                    const emp = employees.find((x) => x.id === e.target.value);
                    if (emp) setExtraCouriers((prev) => [...prev, emp]);
                  }}
                >
                  <option value="">izaberi iz evidencije zaposlenih…</option>
                  {employees
                    .filter((e) => !rows.some((r) => r.employee_id === e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name}{e.employee_code ? ` (${e.employee_code})` : ''}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted small">
                Ne mora svaki zaposleni centra da ima stopove — prikazuju se samo kuriri
                koji učestvuju u ovoj evidenciji.
              </p>
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState title="Još nema unetih stopova za ovaj period." hint="Dodajte kurira iz evidencije zaposlenih i unesite broj stopova." />
          ) : (
            <table className="list list-compact">
              <thead>
                <tr>
                  <th>Kurir</th>
                  {dates.map((d) => <th key={d}>{dayLabel(d)}</th>)}
                  <th>Ukupno stopova</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee_id}>
                    <td>
                      {r.employee_name}
                      {r.employee_code && <div className="muted small">{r.employee_code}</div>}
                    </td>
                    {dates.map((d) => (
                      <td key={d}>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="cell-input"
                          disabled={!editable || saving === `${r.employee_id}|${d}`}
                          defaultValue={r.stops[d] ?? ''}
                          onBlur={(e) => void setStops(r.employee_id, d, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </td>
                    ))}
                    <td><strong>{rowTotal(r)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>Pregled pre slanja</h3>
          <p className="muted small">
            Cena po stopu i iznos su serverske vrednosti i ne unose se.
          </p>
          <table className="list list-compact">
            <thead>
              <tr><th>Kurir</th><th>Datum</th><th>Centar</th><th>Stopovi</th>
                <th>Cena po stopu</th><th>Iznos</th></tr>
            </thead>
            <tbody>
              {detail.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.employee_name}</td>
                  <td>{l.work_date}</td>
                  <td>{l.center_code}</td>
                  <td>{l.stop_count}</td>
                  <td>{l.rate_used === null ? '—' : formatRsd(l.rate_used)}</td>
                  <td>{l.calculated_amount === null ? '—' : formatRsd(l.calculated_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><strong>UKUPNO STOPOVA</strong></td>
                <td><strong>{detail.totals.total_stops}</strong></td>
                <td><strong>UKUPNO</strong></td>
                <td>
                  <strong>
                    {detail.totals.total_amount === null
                      ? '—' : formatRsd(detail.totals.total_amount)}
                  </strong>
                </td>
              </tr>
            </tfoot>
          </table>

          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !canSubmit(detail, maySubmit)}
            onClick={() => void submit()}
          >
            POŠALJI FINANSIJAMA
          </button>
          {!maySubmit && (
            <p className="muted small">Nemate pravo slanja evidencije stopova.</p>
          )}
          <p className="muted small">Status: {STATUS_LABEL[detail.submission.status]}</p>

          {detail.is_approved && (
            <>
              <h3>Korekcija posle odobrenja</h3>
              <p className="muted small">
                Odobreni obračun se ne menja. Ispod se pravi ZASEBNA transakcija
                nad izabranom odobrenom stavkom.
              </p>
              <CourierStopCorrections
                lines={detail.lines.map((l, i) => ({
                  snapshot_line_id: i + 1,
                  employee_name: l.employee_name,
                  center_code: l.center_code,
                  work_date: l.work_date,
                  stop_count: l.stop_count,
                  rate_used: l.rate_used,
                  calculated_amount: l.calculated_amount,
                }))}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
