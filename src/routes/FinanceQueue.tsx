import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, EmptyState, Spinner, StatusBadge } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { needsAttention, totalForDisplay, waitingLabel } from '../features/finance/recap';
import { WdrApiError } from '../lib/api';
import type { FinanceQueue as Queue, FinanceQueueStatus } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const FILTERS: Array<{ label: string; statuses: FinanceQueueStatus[] }> = [
  { label: 'Za odobrenje', statuses: ['SUBMITTED'] },
  { label: 'Vraćeno na ispravku', statuses: ['RETURNED'] },
  { label: 'Odobreno', statuses: ['FINANCE_APPROVED', 'CLOSED'] },
];

export function FinanceQueue() {
  const { api } = useAuth();
  const [filter, setFilter] = useState(0);
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await api.getFinanceQueue(FILTERS[filter].statuses));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Odobrenje obračuna</h1>
          <p className="muted">
            Iznos se ne unosi ručno. Finansije potvrđuju obračun ili vraćaju period na
            ispravku.
          </p>
        </div>
      </div>

      <div className="filter-row tabs">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            type="button"
            className={i === filter ? 'btn btn-primary' : 'btn btn-quiet'}
            onClick={() => setFilter(i)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!error && !data && <Spinner label="Čitanje reda za odobrenje…" />}

      {data && data.items.length === 0 && (
        <EmptyState
          title="Nema prijava u ovom filteru"
          hint="Kada operater pošalje period, pojaviće se ovde."
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="metrics">
            <div className="metric">
              <span className="metric-label">Prijava</span>
              <span className="metric-value">{data.totals.count}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Ukupno za odobrenje</span>
              <span className="metric-value">
                {formatRsd(data.totals.approvable_total)} RSD
              </span>
            </div>
            <div className={data.totals.blocked_count > 0 ? 'metric metric-bad' : 'metric metric-ok'}>
              <span className="metric-label">Blokirano</span>
              <span className="metric-value">{data.totals.blocked_count}</span>
            </div>
            {data.totals.incomplete_override_count > 0 && (
              <div className="metric metric-bad">
                <span className="metric-label">Poslato nepotpuno</span>
                <span className="metric-value">{data.totals.incomplete_override_count}</span>
              </div>
            )}
          </div>

          {data.totals.blocked_count > 0 && (
            <Banner kind="warning">
              Blokirane prijave nemaju iznos za odobrenje: nedostaje pravilo obračuna ili
              postoji blokirajuća greška. Zbir iznad ih ne uključuje.
            </Banner>
          )}

          <table className="list">
            <thead>
              <tr>
                <th>Centar</th>
                <th>Period</th>
                <th>Status</th>
                <th>Čeka</th>
                <th className="num">Zaposlenih</th>
                <th className="num">Employee-dana</th>
                <th className="num">Za odobrenje</th>
                <th>Kontrole</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => {
                const total = totalForDisplay(it.recap);
                return (
                  <tr
                    key={it.submission_id}
                    className={needsAttention(it) ? 'row-error' : ''}
                  >
                    <td>
                      <strong>{it.center_code}</strong>
                      <span className="muted small"> {it.center_name}</span>
                    </td>
                    <td>
                      {it.period_start} – {it.period_end}
                      <span className="muted small"> {it.period_label}</span>
                    </td>
                    <td><StatusBadge status={it.status} /></td>
                    <td>{waitingLabel(it.waiting_hours)}</td>
                    <td className="num">{it.recap.employee_count}</td>
                    <td className="num">{it.recap.worked_employee_days}</td>
                    <td className="num">
                      {total.kind === 'complete' ? (
                        <strong>{formatRsd(total.amount)}</strong>
                      ) : (
                        <span className="totals-warning">nije kompletan</span>
                      )}
                    </td>
                    <td className="small">
                      {it.hard_error_count > 0 && (
                        <span className="v-sev">{it.hard_error_count} greške</span>
                      )}
                      {it.unacknowledged_warning_count > 0 && (
                        <span className="v-sev">
                          {it.unacknowledged_warning_count} nepotvrđeno
                        </span>
                      )}
                      {it.incomplete_override && (
                        <span className="v-sev">POSLATO NEPOTPUNO</span>
                      )}
                      {it.approved && (
                        <span className="muted">
                          odobrio {it.approved.approved_by ?? '—'}
                        </span>
                      )}
                      {!it.approved
                        && it.hard_error_count === 0
                        && it.unacknowledged_warning_count === 0
                        && !it.incomplete_override
                        && it.recap.is_complete && <span className="muted">čisto</span>}
                    </td>
                    <td>
                      <Link
                        className="btn btn-quiet"
                        to={`/finansije/prijava?prijava=${it.submission_id}`}
                      >
                        Otvori
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="muted small">Verzija obračuna: {data.engine_version}</p>
        </>
      )}
    </div>
  );
}
