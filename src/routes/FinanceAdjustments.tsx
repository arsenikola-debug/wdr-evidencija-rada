import { useCallback, useEffect, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { STATUS_LABEL, signedAmountLabel } from '../features/finance/adjustment';
import { WdrApiError } from '../lib/api';
import type { Adjustment, AdjustmentQueue, AdjustmentStatus } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const FILTERS: Array<{ label: string; statuses: AdjustmentStatus[] }> = [
  { label: 'Za odobrenje', statuses: ['SUBMITTED'] },
  { label: 'Vraćeno', statuses: ['RETURNED'] },
  { label: 'Rešeno', statuses: ['APPROVED', 'REJECTED'] },
];

export function FinanceAdjustments() {
  const { api } = useAuth();
  const [filter, setFilter] = useState(0);
  const [data, setData] = useState<AdjustmentQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await api.getAdjustmentQueue(FILTERS[filter].statuses));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(a: Adjustment, action: 'approve' | 'return' | 'reject') {
    setBusy(true);
    setNotice(null);
    try {
      if (action === 'approve') {
        await api.approveAdjustment(a.id, comment.trim() === '' ? null : comment.trim());
        setNotice({
          kind: 'success',
          text: `${a.direction_label} je odobrena: ${signedAmountLabel(a.calculation.amount_signed)} RSD. `
            + 'Ekonomski efekat pripada datumu rada, transakcija današnjem danu.',
        });
      } else if (action === 'return') {
        await api.returnAdjustment(a.id, comment.trim());
        setNotice({ kind: 'success', text: 'Zahtev je vraćen na ispravku.' });
      } else {
        await api.rejectAdjustment(a.id, comment.trim());
        setNotice({ kind: 'success', text: 'Zahtev je odbijen.' });
      }
      setComment('');
      setOpenId(null);
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

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Finansije — dodatni zahtevi</h1>
          <p className="muted">
            Korekcija je zasebna transakcija. Odobreni obračun perioda se nikada ne menja,
            a iznos korekcije se ne unosi ručno.
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

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      {!error && !data && <Spinner label="Čitanje dodatnih zahteva…" />}

      {data && data.items.length === 0 && (
        <EmptyState title="Nema dodatnih zahteva u ovom filteru" />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="metrics">
            <div className="metric">
              <span className="metric-label">Zahteva</span>
              <span className="metric-value">{data.totals.count}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Doplata</span>
              <span className="metric-value">{formatRsd(data.totals.doplata_total)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Umanjenje</span>
              <span className="metric-value">{formatRsd(data.totals.umanjenje_total)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Neto</span>
              <span className="metric-value">{signedAmountLabel(data.totals.net_total)}</span>
            </div>
            {data.totals.blocked_count > 0 && (
              <div className="metric metric-bad">
                <span className="metric-label">Bez pravila</span>
                <span className="metric-value">{data.totals.blocked_count}</span>
              </div>
            )}
          </div>

          <table className="list">
            <thead>
              <tr>
                <th>Zaposleni</th>
                <th>Datum rada</th>
                <th>Vrsta</th>
                <th>Stavka</th>
                <th className="num">Stopa × kol.</th>
                <th className="num">Iznos</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id} className={a.errors.length > 0 ? 'row-error' : ''}>
                  <td>
                    {a.employee_name}
                    <div className="muted small">{a.center_code} · {a.reason}</div>
                  </td>
                  <td>{a.related_work_date}</td>
                  <td>{a.direction_label}</td>
                  <td>{a.payment_type_code}</td>
                  <td className="num">
                    {a.calculation.rate === null
                      ? '—'
                      : `${formatRsd(a.calculation.rate)} × ${a.calculation.units}`}
                  </td>
                  <td className="num">{signedAmountLabel(a.calculation.amount_signed)}</td>
                  <td>
                    {STATUS_LABEL[a.status]}
                    {a.errors.map((e) => (
                      <div key={e.code} className="muted small">{e.message}</div>
                    ))}
                    {a.warnings.map((w) => (
                      <div key={w.code} className="muted small">{w.message}</div>
                    ))}
                    {a.approval && (
                      <div className="muted small">
                        Odobreno {new Date(a.approval.approved_at).toLocaleDateString('sr-Latn-RS')}
                        {' '}· ekonomski datum {a.approval.economic_date}
                        {' '}· potpis <code>{a.approval.content_hash.slice(0, 12)}…</code>
                      </div>
                    )}
                  </td>
                  <td>
                    {a.can_decide && (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => {
                          setOpenId(openId === a.id ? null : a.id);
                          setComment('');
                        }}
                      >
                        {openId === a.id ? 'Zatvori' : 'Odluka'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {openId && (() => {
            const a = data.items.find((x) => x.id === openId);
            if (!a) return null;
            return (
              <section className="control-section">
                <h2>
                  Odluka: {a.direction_label} · {a.employee_name} · {a.related_work_date}
                </h2>

                <div className={a.can_approve ? 'totals totals-complete' : 'totals totals-partial'}>
                  <span className="totals-label">
                    {a.calculation.rate === null
                      ? 'Iznos'
                      : `${formatRsd(a.calculation.rate)} × ${a.calculation.units}`}
                  </span>
                  <span className="totals-value">
                    {signedAmountLabel(a.calculation.amount_signed)} RSD
                  </span>
                  <span className="muted small">
                    Pravilo je rezolvirano za datum rada {a.related_work_date}. Iznos nije
                    izmenljiv — odobrava se ili se zahtev vraća/odbija.
                  </span>
                </div>

                <p className="muted small">
                  Obrazloženje podnosioca: {a.reason}
                </p>

                <textarea
                  rows={3}
                  value={comment}
                  placeholder="Obrazloženje (obavezno za vraćanje i odbijanje, najmanje 10 znakova)"
                  onChange={(e) => setComment(e.target.value)}
                />

                <div className="filter-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !a.can_approve}
                    onClick={() => void decide(a, 'approve')}
                  >
                    Odobri
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || comment.trim().length < 10}
                    onClick={() => void decide(a, 'return')}
                  >
                    Vrati na ispravku
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || comment.trim().length < 10}
                    onClick={() => void decide(a, 'reject')}
                  >
                    Odbij
                  </button>
                </div>
              </section>
            );
          })()}
        </>
      )}
    </div>
  );
}
