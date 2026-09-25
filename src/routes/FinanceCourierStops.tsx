import { useCallback, useEffect, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { STATUS_LABEL } from '../features/courierStops/model';
import type { CourierStopDetail } from '../features/courierStops/model';
import { WdrApiError } from '../lib/api';
import { useAuth } from '../lib/auth/AuthProvider';

interface QueueItem {
  submission_type: 'COURIER_STOPS';
  submission_id: string;
  center_code: string;
  period_start: string;
  period_end: string;
  status: 'SUBMITTED' | 'RETURNED';
  submitted_by?: string | null;
  submitted_at: string | null;
  total_stops: number;
  total_calculated_amount: number | null;
  blocking_line_count: number;
  can_approve: boolean;
  can_return: boolean;
}

/**
 * Finansije — „Stopovi kurira".
 *
 * Namerno je ZASEBAN ekran, a ne red pomešan sa redovnim prijavama: dva izvora
 * imaju različite kolone (stopovi vs. radni dani) i različit snapshot. Mešanje
 * bi značilo ili prazne kolone ili tiho sabiranje dve različite stvari.
 *
 * Finansije ovde ne unose ni cenu, ni iznos, ni broj stopova.
 */
export function FinanceCourierStops() {
  const { api, can } = useAuth();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CourierStopDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setQueue(await api.courierStopFinanceQueue() as QueueItem[]);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }, [api, fail]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const open = useCallback(async (id: string) => {
    setOpenId(id);
    setDetail(null);
    setReason('');
    try {
      setDetail(await api.courierStopFinanceDetail(id) as CourierStopDetail);
    } catch (err) {
      fail(err);
    }
  }, [api, fail]);

  async function approve() {
    if (!openId || !detail) return;
    const total = detail.totals.total_amount;
    if (!window.confirm(
      `Odobravate stopove kurira — centar ${detail.lines[0]?.center_code ?? ''}, `
      + `period ${detail.submission.period_start}–${detail.submission.period_end}.\n\n`
      + `Ukupno stopova: ${detail.totals.total_stops}\n`
      + `Ukupno za odobrenje: ${total === null ? '—' : formatRsd(total)}\n\n`
      + 'Odobrenje je konačno i pravi nepromenljiv snapshot. Nastaviti?')) return;

    setBusy(true);
    try {
      await api.courierStopFinanceApprove(openId);
      setNotice('Stopovi kurira su odobreni.');
      await open(openId);
      await loadQueue();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function ret() {
    if (!openId) return;
    if (reason.trim().length < 5) {
      setError('Razlog vraćanja je obavezan.');
      return;
    }
    setBusy(true);
    try {
      await api.courierStopFinanceReturn(openId, reason.trim());
      setNotice('Prijava je vraćena na ispravku.');
      await open(openId);
      await loadQueue();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const item = queue.find((q) => q.submission_id === openId);

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Finansije — stopovi kurira</h1>
          <p className="muted">Odobravanje prijava iz evidencije stopova kurira.</p>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="success">{notice}</Banner>}
      {loading && <Spinner label="Učitavanje reda čekanja…" />}

      {!loading && queue.length === 0 && (
        <EmptyState title="Nema prijava stopova na čekanju."
          hint="Ovde se pojavljuju isključivo prijave iz evidencije stopova kurira." />
      )}

      {queue.length > 0 && (
        <table className="list">
          <thead>
            <tr><th>Vrsta</th><th>Centar</th><th>Period</th><th>Status</th>
              <th>Poslao</th><th>Poslato</th><th>Stopova</th><th>Iznos</th><th /></tr>
          </thead>
          <tbody>
            {queue.map((q) => (
              <tr key={q.submission_id}>
                <td><span className="chip">Stopovi kurira</span></td>
                <td>{q.center_code}</td>
                <td>{q.period_start} – {q.period_end}</td>
                <td>{STATUS_LABEL[q.status]}</td>
                <td>{q.submitted_by ?? '—'}</td>
                <td>{q.submitted_at?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                <td>{q.total_stops}</td>
                <td>
                  {q.total_calculated_amount === null
                    ? <span className="chip chip-warn">nije obračunato</span>
                    : formatRsd(q.total_calculated_amount)}
                </td>
                <td>
                  <button type="button" className="btn btn-quiet"
                    onClick={() => void open(q.submission_id)}>Otvori</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openId && !detail && <Spinner label="Učitavanje detalja…" />}

      <CorrectionsQueue />

      {detail && (
        <>
          <h3>Detalj — {detail.submission.period_start} – {detail.submission.period_end}</h3>
          {detail.is_approved && (
            <Banner kind="success">
              Odobreno. Prikazane su nepromenljive vrednosti iz snapshot-a; ne
              preračunavaju se tekućim cenama.
            </Banner>
          )}
          <table className="list list-compact">
            <thead>
              <tr><th>Kurir</th><th>Datum rada</th><th>Centar</th><th>Stopova</th>
                <th>Cena po stopu</th><th>Iznos</th></tr>
            </thead>
            <tbody>
              {detail.lines.map((l, i) => (
                <tr key={l.employee_id ? `${l.employee_id}|${l.work_date}` : i}>
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
                <td><strong>UKUPNO ZA ODOBRENJE</strong></td>
                <td><strong>
                  {detail.totals.total_amount === null
                    ? '—' : formatRsd(detail.totals.total_amount)}
                </strong></td>
              </tr>
            </tfoot>
          </table>

          {!detail.is_approved && (
            <>
              <p className="muted small">
                Finansije potvrđuju obračun i ne menjaju ga. Ako se iznos ne slaže,
                prijava se vraća na ispravku.
              </p>
              <div className="filter-row">
                <button type="button" className="btn btn-primary"
                  disabled={busy || !can('finance.approve') || !item?.can_approve}
                  onClick={() => void approve()}>ODOBRI</button>
              </div>
              <label className="full-width"><span>Razlog vraćanja</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="obavezno" />
              </label>
              <button type="button" className="btn"
                disabled={busy || !can('finance.return') || !item?.can_return}
                onClick={() => void ret()}>VRATI NA ISPRAVKU</button>
            </>
          )}
        </>
      )}
    </div>
  );
}


interface CorrectionQueueItem {
  correction_id: string; center_code: string; employee_name: string;
  related_work_date: string; status: string; original_stop_count: number;
  delta_stop_count: number; original_rate_used: number; calculated_amount: number;
  direction_label: string; reason: string;
  can_approve: boolean; can_return: boolean;
}

/**
 * Korekcije stopova su TREĆA vrsta transakcije i prikazuju se odvojeno od
 * odobrenja stopova: imaju predznak, zamrznutu cenu i referencu na original.
 * Finansije ovde ne unose ništa osim razloga vraćanja.
 */
function CorrectionsQueue() {
  const { api, can } = useAuth();
  const [items, setItems] = useState<CorrectionQueueItem[]>([]);
  const [reason, setReason] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.courierStopCorrectionQueue() as CorrectionQueueItem[]);
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  if (items.length === 0) return null;

  return (
    <>
      <h3>Korekcije stopova</h3>
      {error && <Banner kind="error">{error}</Banner>}
      <table className="list">
        <thead>
          <tr><th>Vrsta</th><th>Centar</th><th>Kurir</th><th>Datum rada</th>
            <th>Odobreno stopova</th><th>Promena</th><th>Zamrznuta cena</th>
            <th>Iznos korekcije</th><th>Razlog</th><th /></tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.correction_id}>
              <td><span className="chip chip-warn">Korekcija stopova</span></td>
              <td>{c.center_code}</td>
              <td>{c.employee_name}</td>
              <td>{c.related_work_date}</td>
              <td>{c.original_stop_count}</td>
              <td>{c.delta_stop_count > 0 ? `+${c.delta_stop_count}` : c.delta_stop_count}
                {' '}({c.direction_label})</td>
              <td>{formatRsd(c.original_rate_used)}</td>
              <td>{formatRsd(c.calculated_amount)}</td>
              <td className="muted small">{c.reason}</td>
              <td>
                <button type="button" className="btn btn-quiet"
                  disabled={busy || !c.can_approve || !can('finance.approve')}
                  onClick={() => {
                    if (!window.confirm(
                      `Odobravate korekciju: ${c.delta_stop_count} stopova × `
                      + `${formatRsd(c.original_rate_used)} = `
                      + `${formatRsd(c.calculated_amount)}.\n\n`
                      + 'Original ostaje nepromenjen. Nastaviti?')) return;
                    setBusy(true);
                    void api.courierStopCorrectionFinanceApprove(c.correction_id)
                      .then(load)
                      .catch((err: unknown) => setError(
                        err instanceof Error ? err.message : 'Greška.'))
                      .finally(() => setBusy(false));
                  }}>ODOBRI</button>
                <button type="button" className="btn btn-quiet"
                  disabled={busy || !c.can_return || !can('finance.return')
                    || openId !== c.correction_id || reason.trim().length < 5}
                  onClick={() => {
                    setBusy(true);
                    void api.courierStopCorrectionFinanceReturn(c.correction_id, reason)
                      .then(load)
                      .catch((err: unknown) => setError(
                        err instanceof Error ? err.message : 'Greška.'))
                      .finally(() => setBusy(false));
                  }}>VRATI</button>
                <input value={openId === c.correction_id ? reason : ''}
                  placeholder="razlog vraćanja"
                  onFocus={() => setOpenId(c.correction_id)}
                  onChange={(e) => setReason(e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Finansije potvrđuju korekciju; količinu, cenu i iznos ne menjaju.
      </p>
    </>
  );
}
