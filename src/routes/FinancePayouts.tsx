import { formatDate, formatDateTime, formatPeriod } from '../lib/format/date';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { PROBLEM_TEXT, STATUS_LABEL, unitLabel } from '../features/payouts/model';
import { WdrApiError } from '../lib/api';
import type { PayoutDetail, PayoutListItem, PayoutStatus } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const TABS: Array<{ key: PayoutStatus; label: string }> = [
  { key: 'SUBMITTED', label: 'Čeka odobrenje' },
  { key: 'RETURNED', label: 'Vraćeno' },
  { key: 'FINANCE_APPROVED', label: 'Odobreno' },
];

/**
 * Finansije — dodatne isplate (redizajn §21). Primarni pogled je ZBIR po
 * zaposlenom za period; dnevne stavke su drill-down. Odobrenje je potvrda
 * serverskog obračuna (model A) — iznos se ne menja ručno.
 */
export function FinancePayouts() {
  const { api } = useAuth();
  const [tab, setTab] = useState<PayoutStatus>('SUBMITTED');
  const [items, setItems] = useState<PayoutListItem[] | null>(null);
  const [sel, setSel] = useState<PayoutDetail | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params] = useSearchParams();
  const deepId = params.get('zahtev');

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  const load = useCallback(async () => {
    try {
      setItems(await api.payoutFinanceQueue([tab]));
    } catch (err) {
      fail(err);
    }
  }, [api, tab, fail]);

  useEffect(() => { setSel(null); void load(); }, [load]);

  // Otvaranje iz objedinjenog prikaza „Dodatne isplate" (?zahtev=<id>).
  useEffect(() => {
    if (!deepId) return;
    api.payoutGet(deepId).then((d) => {
      const st = d.request.status;
      if (st === 'SUBMITTED' || st === 'RETURNED' || st === 'FINANCE_APPROVED') setTab(st);
      setSel(d);
    }).catch(fail);
  }, [api, deepId, fail]);

  async function decide(kind: 'approve' | 'return') {
    if (!sel) return;
    setBusy(true);
    setError(null);
    try {
      const res = kind === 'approve'
        ? await api.payoutFinanceApprove(sel.request.id, comment || null)
        : await api.payoutFinanceReturn(sel.request.id, comment);
      setSel(res);
      setComment('');
      setNotice(kind === 'approve' ? 'Zahtev je odobren.' : 'Zahtev je vraćen operateru.');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <p className="small"><Link to="/finansije/dodatne-isplate">← Dodatne isplate</Link></p>
      <h1>Dodatne isplate — odobrenje</h1>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner kind="success" onClose={() => setNotice(null)}>{notice}</Banner>}

      <div className="entry-bar-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={tab === t.key ? 'btn btn-primary' : 'btn'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {!items ? <Spinner label="Učitavanje…" /> : items.length === 0 ? (
        <EmptyState title="Nema zahteva u ovom statusu" />
      ) : (
        <table className="list list-compact">
          <thead>
            <tr>
              <th>Vrsta</th><th>Centar</th><th>Period</th><th>Original / korekcija</th>
              <th className="num">Zaposlenih</th><th className="num">Iznos</th><th />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className={sel?.request.id === i.id ? 'row-focus' : ''}>
                <td>{i.request_type_name}</td>
                <td>{i.center_code}</td>
                <td>{formatPeriod(i.period_start, i.period_end)}</td>
                <td>{i.is_correction ? <span className="chip chip-warn">KOREKCIJA</span> : 'Original'}</td>
                <td className="num">{i.employees}</td>
                <td className="num">{i.total_amount == null ? 'nepotpuno' : formatRsd(i.total_amount)}</td>
                <td>
                  <button type="button" className="btn btn-small"
                    onClick={() => api.payoutGet(i.id).then(setSel).catch(fail)}>
                    Detalj
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && (
        <section className="control-section">
          <h2>
            {sel.request.request_type_name} · {sel.request.center_code} · {formatPeriod(sel.request.period_start, sel.request.period_end)}
            {sel.request.is_correction && <span className="chip chip-warn"> KOREKCIJA</span>}
          </h2>
          <p className="muted small">
            {STATUS_LABEL[sel.request.status]} · poslao {sel.request.submitted_by ?? '—'}
            {sel.request.submitted_at ? ` (${formatDateTime(sel.request.submitted_at)})` : ''}
          </p>
          {sel.request.is_correction && sel.request.corrects && (
            <Banner kind="info">
              Korekcija originala {formatPeriod(sel.request.corrects.period_start, sel.request.corrects.period_end)}
              {sel.request.corrects.approved_at ? `, odobrenog ${formatDate(sel.request.corrects.approved_at)}` : ''}.
              Razlog: {sel.request.correction_reason}
            </Banner>
          )}

          <table className="list list-compact">
            <thead>
              <tr>
                <th>Zaposleni</th><th>Period</th>
                <th className="num">{sel.request.unit_model === 'DAY' ? 'Broj dana' : 'Sati'}</th>
                <th className="num">Iznos</th>
              </tr>
            </thead>
            <tbody>
              {sel.summary.filter((s) => s.days > 0).map((s) => (
                <tr key={s.employee_id}>
                  <td>{s.full_name}<span className="muted small"> · {s.employee_code ?? 'bez šifre'}</span></td>
                  <td>{formatPeriod(sel.request.period_start, sel.request.period_end)}</td>
                  <td className="num">{sel.request.unit_model === 'DAY' ? s.days : s.units}</td>
                  <td className="num">{s.amount == null ? 'nepotpuno' : formatRsd(s.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Ukupno zahtev</th><th />
                <th className="num">{sel.totals.units} {unitLabel(sel.request.input_mode)}</th>
                <th className="num">{sel.totals.amount == null ? 'nepotpuno' : formatRsd(sel.totals.amount)}</th>
              </tr>
            </tfoot>
          </table>

          <details className="lines-details">
            <summary>Stavke po danima ({sel.lines.length}) — drill-down / audit</summary>
            <table className="list list-compact">
              <thead>
                <tr><th>Zaposleni</th><th>Datum</th><th>Vreme</th><th className="num">Količina</th>
                  <th className="num">Stopa</th><th className="num">Iznos</th><th>Napomena</th></tr>
              </thead>
              <tbody>
                {sel.lines.map((l) => (
                  <tr key={l.id} className={l.problem ? 'row-error' : ''}>
                    <td>{sel.employees.find((e) => e.employee_id === l.employee_id)?.full_name}</td>
                    <td>{formatDate(l.work_date)}</td>
                    <td>{l.time_from ? `${l.time_from.slice(0, 5)}–${l.time_to?.slice(0, 5)}${l.crosses_midnight ? ' (preko ponoći)' : ''}` : '—'}</td>
                    <td className="num">{l.units}</td>
                    <td className="num">{l.rate == null ? '—' : formatRsd(l.rate)}</td>
                    <td className="num">{l.amount == null ? (PROBLEM_TEXT[l.problem ?? ''] ?? l.problem) : formatRsd(l.amount)}</td>
                    <td>{l.unusual ? `⚑ istog dana ${l.attendance_status}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {sel.can_approve && (
            <div className="report-filters">
              <label className="full-width">
                Komentar (obavezan za vraćanje, najmanje 10 znakova)
                <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <button type="button" className="btn btn-primary"
                disabled={busy || sel.totals.problems > 0} onClick={() => void decide('approve')}>
                Odobri {sel.totals.amount == null ? '' : formatRsd(sel.totals.amount)}
              </button>
              <button type="button" className="btn" disabled={busy || comment.trim().length < 10}
                onClick={() => void decide('return')}>
                Vrati na ispravku
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
