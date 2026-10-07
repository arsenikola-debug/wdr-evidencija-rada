import { formatDate, formatPeriod } from '../lib/format/date';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { WdrApiError } from '../lib/api';
import type {
  Adjustment,
  CorrectionBatchDetail,
  CorrectionBatchHeader,
  SubmissionListItem,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const STATUS: Record<string, string> = {
  DRAFT: 'U pripremi', SUBMITTED: 'Poslato', RETURNED: 'Vraćeno', APPROVED: 'Odobreno',
};

/**
 * K8 — korekcija ODOBRENOG osnovnog obračuna kao jedan zahtev sa više stavki.
 * Stavke su postojeći Dodatni zahtevi (sopstvena cena, snapshot i odobrenje);
 * zaglavlje ih šalje, vraća i odobrava zajedno. Original ostaje nepromenjen.
 */
export function CorrectionBatches({ mode }: { mode: 'operator' | 'finance' }) {
  const { api } = useAuth();
  const [list, setList] = useState<CorrectionBatchHeader[] | null>(null);
  const [sel, setSel] = useState<CorrectionBatchDetail | null>(null);
  const [approved, setApproved] = useState<SubmissionListItem[]>([]);
  const [drafts, setDrafts] = useState<Adjustment[]>([]);
  const [origId, setOrigId] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  const load = useCallback(async () => {
    try {
      setList(await api.correctionBatchList(mode === 'finance' ? ['SUBMITTED', 'RETURNED', 'APPROVED'] : null));
      if (mode === 'operator') {
        const subs = await api.listSubmissions();
        setApproved(subs.filter((s) => s.status === 'FINANCE_APPROVED' || s.status === 'CLOSED'));
        setDrafts(await api.getMyAdjustments(['DRAFT', 'RETURNED']));
      }
    } catch (err) {
      fail(err);
    }
  }, [api, mode, fail]);

  useEffect(() => { void load(); }, [load]);

  async function act(p: Promise<CorrectionBatchDetail>) {
    setBusy(true);
    setError(null);
    try {
      setSel(await p);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const attachable = useMemo(() => {
    if (!sel) return [];
    const inBatch = new Set(sel.items.map((i) => i.id));
    return drafts.filter((a) => a.original_submission_id === sel.batch.original_submission_id && !inBatch.has(a.id));
  }, [sel, drafts]);

  const editable = sel && mode === 'operator' && (sel.batch.status === 'DRAFT' || sel.batch.status === 'RETURNED');

  return (
    <div className="page">
      <h1>{mode === 'finance' ? 'Odobrenje korekcija obračuna' : 'Korekcije obračuna'}</h1>
      <p className="muted small">
        Poslat, a neodobren obračun se vraća na ispravku i menja postojećim tokom. Ovde se
        koriguje samo ODOBREN obračun: original ostaje nepromenjen, a korekcija ima vezu sa
        originalom, razlog, autora i audit trag.
      </p>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}

      {mode === 'operator' && (
        <section className="control-section">
          <h2>Nova korekcija</h2>
          <div className="report-filters">
            <label>
              Odobren obračun
              <select value={origId} onChange={(e) => setOrigId(e.target.value)}>
                <option value="">—</option>
                {approved.map((s) => (
                  <option key={s.id} value={s.id}>{s.center_code} · {formatPeriod(s.period_start, s.period_end)}</option>
                ))}
              </select>
            </label>
            <label className="full-width">
              Razlog (najmanje 10 znakova)
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary"
              disabled={busy || !origId || reason.trim().length < 10}
              onClick={() => void act(api.correctionBatchOpen(origId, reason)).then(() => setReason(''))}>
              Otvori korekciju
            </button>
          </div>
        </section>
      )}

      {!list ? <Spinner label="Učitavanje…" /> : list.length === 0 ? (
        <EmptyState title="Nema korekcija" />
      ) : (
        <table className="list list-compact">
          <thead>
            <tr><th>Original</th><th>Centar</th><th>Razlog</th><th>Status</th>
              <th className="num">Stavki</th><th className="num">Iznos</th><th /></tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td>{b.original_period_start} – {b.original_period_end}</td>
                <td>{b.center_code}</td>
                <td>{b.reason}</td>
                <td><span className="chip chip-warn">KOREKCIJA</span> {STATUS[b.status]}</td>
                <td className="num">{b.totals?.items ?? '—'}</td>
                <td className="num">{b.totals?.amount == null ? '—' : formatRsd(b.totals.amount)}</td>
                <td>
                  <button type="button" className="btn btn-small"
                    onClick={() => api.correctionBatchGet(b.id).then(setSel).catch(fail)}>Otvori</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && (
        <section className="control-section">
          <h2>
            KOREKCIJA obračuna {sel.batch.center_code} · {sel.batch.original_period_start} – {sel.batch.original_period_end}
          </h2>
          <p className="muted small">
            {STATUS[sel.batch.status]} · razlog: {sel.batch.reason} · kreirao {sel.batch.created_by ?? '—'}
          </p>
          {sel.batch.return_reason && sel.batch.status === 'RETURNED' && (
            <Banner kind="warning">Vraćeno: {sel.batch.return_reason}</Banner>
          )}

          <table className="list list-compact">
            <thead>
              <tr><th>Zaposleni</th><th>Datum</th><th>Vrsta</th><th>Smer</th>
                <th className="num">Količina</th><th className="num">Iznos</th><th>Status</th>{editable && <th />}</tr>
            </thead>
            <tbody>
              {sel.items.map((a) => (
                <tr key={a.id}>
                  <td>{a.employee_name}</td>
                  <td>{formatDate(a.related_work_date)}</td>
                  <td>{a.payment_type_code}</td>
                  <td>{a.direction_label}</td>
                  <td className="num">{a.units}</td>
                  <td className="num">{a.calculation.amount_signed == null ? 'nepotpuno' : formatRsd(a.calculation.amount_signed)}</td>
                  <td>{a.status}</td>
                  {editable && (
                    <td><button type="button" className="btn btn-small btn-quiet"
                      onClick={() => void act(api.correctionBatchDetach(sel.batch.id, a.id))}>Ukloni</button></td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th colSpan={5}>Ukupno korekcija</th>
                <th className="num">{sel.totals.amount == null ? 'nepotpuno' : formatRsd(sel.totals.amount)}</th>
                <th colSpan={editable ? 2 : 1} /></tr>
            </tfoot>
          </table>

          {editable && (
            <>
              <h3>Dodaj stavku</h3>
              <p className="muted small">
                Stavka je Dodatni zahtev vezan za ovaj original. Napravite ga u{' '}
                <Link to="/dodatni-zahtevi">Moji zahtevi</Link> (zaposleni, datum, vrsta, količina,
                razlog), pa ga ovde dodajte u korekciju.
              </p>
              {attachable.length === 0 ? (
                <p className="muted small">Nema pripremljenih stavki za ovaj original.</p>
              ) : (
                <ul className="picker-results">
                  {attachable.map((a) => (
                    <li key={a.id}>
                      <span>{a.employee_name} · {formatDate(a.related_work_date)} · {a.payment_type_code} · {a.direction_label} {a.units}</span>
                      <button type="button" className="btn btn-small"
                        onClick={() => void act(api.correctionBatchAttach(sel.batch.id, a.id))}>Dodaj</button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn btn-primary" disabled={busy || sel.items.length === 0}
                onClick={() => void act(api.correctionBatchSubmit(sel.batch.id))}>
                Pošalji korekciju Finansijama
              </button>
            </>
          )}

          {mode === 'finance' && sel.batch.status === 'SUBMITTED' && (
            <div className="report-filters">
              <label className="full-width">
                Komentar (obavezan za vraćanje)
                <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <label className="confirm-row">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>Potvrđujem stavke za dane bez evidentiranog rada (ako ih ima).</span>
              </label>
              <button type="button" className="btn btn-primary" disabled={busy}
                onClick={() => void act(api.correctionBatchApprove(sel.batch.id, comment || null, ack))}>
                Odobri korekciju
              </button>
              <button type="button" className="btn" disabled={busy || comment.trim().length < 10}
                onClick={() => void act(api.correctionBatchReturn(sel.batch.id, comment))}>
                Vrati na ispravku
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
