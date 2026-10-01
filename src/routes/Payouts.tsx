import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { STATUS_LABEL, TYPE_HINT, addDays, periodError, weekStart } from '../features/payouts/model';
import { WdrApiError } from '../lib/api';
import type { PayoutContext, PayoutListItem, PayoutRequestType } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

/**
 * Dodatne isplate (redizajn §8–§9): svaka vrsta je POSEBAN zahtev za
 * centar × period (≤ 7 dana). Izbor otvara postojeći ili kreira nov zahtev.
 */
export function Payouts() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState<PayoutContext | null>(null);
  const [items, setItems] = useState<PayoutListItem[] | null>(null);
  const [type, setType] = useState<PayoutRequestType>('DNEVNICA');
  const [centerId, setCenterId] = useState('');
  const [from, setFrom] = useState(weekStart(new Date().toISOString().slice(0, 10)));
  const [to, setTo] = useState(addDays(weekStart(new Date().toISOString().slice(0, 10)), 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([api.payoutContext(), api.payoutList()]);
      setCtx(c);
      setItems(l);
      if (c.centers.length === 1) setCenterId(c.centers[0].id);
      if (c.cutover_date && from < c.cutover_date) {
        setFrom(c.cutover_date);
        setTo(addDays(c.cutover_date, 6));
      }
    } catch (err) {
      fail(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, fail]);

  useEffect(() => { void load(); }, [load]);

  const perr = periodError(from, to, ctx?.max_period_days ?? 7);

  async function open() {
    if (!centerId || perr) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.payoutOpen(type, centerId, from, to);
      navigate(`/dodatne-isplate/${d.request.id}`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function openCorrection(original: PayoutListItem) {
    const reason = window.prompt(
      `Korekcija: ${original.request_type_name} ${original.center_code} ${original.period_start} – ${original.period_end}.\n`
      + 'Razlog korekcije (najmanje 10 znakova):',
    );
    if (!reason) return;
    try {
      const d = await api.payoutOpenCorrection(original.id, reason);
      navigate(`/dodatne-isplate/${d.request.id}`);
    } catch (err) {
      fail(err);
    }
  }

  const approvedOriginals = useMemo(
    () => (items ?? []).filter((i) => i.status === 'FINANCE_APPROVED' && !i.is_correction),
    [items],
  );

  if (!ctx && !error) return <Spinner label="Učitavanje dodatnih isplata…" />;

  return (
    <div className="page">
      <h1>Dodatne isplate</h1>
      {error && <Banner kind="error">{error}</Banner>}

      {ctx && !ctx.active && (
        <Banner kind="warning">
          Dodatne isplate još nisu aktivirane (cutover). Do aktivacije se dnevnice, ispomoć,
          radna subota i prekovremeni unose po dosadašnjem modelu.
        </Banner>
      )}

      {ctx?.active && (
        <section className="control-section">
          <h2>Novi ili postojeći zahtev</h2>
          <p className="muted small">
            Dodatne isplate važe od {ctx.cutover_date}. Svaka vrsta je poseban zahtev koji se
            zasebno šalje Finansijama.
          </p>
          <div className="entry-bar-tabs" role="tablist" aria-label="Vrsta dodatne isplate">
            {ctx.types.map((t) => (
              <button key={t.code} type="button" role="tab" aria-selected={type === t.code}
                className={type === t.code ? 'btn btn-primary' : 'btn'} onClick={() => setType(t.code)}>
                {t.name}
              </button>
            ))}
          </div>
          <p className="muted small">{TYPE_HINT[type]}</p>
          <div className="report-filters">
            <label>
              Centar
              {ctx.centers.length === 1 ? (
                <strong className="entry-bar-static">{ctx.centers[0].code}</strong>
              ) : (
                <select value={centerId} onChange={(e) => setCenterId(e.target.value)}>
                  <option value="">—</option>
                  {ctx.centers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              )}
            </label>
            <label>
              Od
              <input type="date" value={from} min={ctx.cutover_date ?? undefined}
                onChange={(e) => { setFrom(e.target.value); if (e.target.value) setTo(addDays(e.target.value, 6)); }} />
            </label>
            <label>
              Do
              <input type="date" value={to} min={from} max={from ? addDays(from, 6) : undefined}
                onChange={(e) => setTo(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy || !centerId || Boolean(perr)}
              onClick={() => void open()}>
              {busy ? 'Otvaranje…' : 'Otvori zahtev'}
            </button>
          </div>
          {perr && <Banner kind="warning">{perr}</Banner>}
          {ctx.centers.length === 0 && <Banner kind="warning">Nemate pravo unosa ni za jedan centar.</Banner>}
        </section>
      )}

      <section className="control-section">
        <h2>Moji zahtevi</h2>
        {!items || items.length === 0 ? (
          <EmptyState title="Još nema zahteva za dodatne isplate" />
        ) : (
          <div className="table-scroll">
            <table className="list list-compact">
              <thead>
                <tr>
                  <th>Vrsta</th><th>Centar</th><th>Period</th><th>Status</th>
                  <th className="num">Zaposlenih</th><th className="num">Ukupno</th><th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.request_type_name}
                      {i.is_correction && <span className="chip chip-warn"> KOREKCIJA</span>}
                    </td>
                    <td>{i.center_code}</td>
                    <td>{i.period_start} – {i.period_end}</td>
                    <td>{STATUS_LABEL[i.status]}</td>
                    <td className="num">{i.employees}</td>
                    <td className="num">{i.total_amount == null ? 'nepotpuno' : formatRsd(i.total_amount)}</td>
                    <td><Link className="btn btn-small" to={`/dodatne-isplate/${i.id}`}>Otvori</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="control-section">
        <h2>Korekcija prethodnog obračuna</h2>
        <p className="muted small">
          Poslat, a neodobren zahtev Finansije vraćaju na ispravku. Odobren zahtev ostaje
          nepromenjen — zaboravljena stavka ide kao posebna KOREKCIJA vezana za original.
          Korekcije osnovnog Karnet/Obuka obračuna su u <Link to="/korekcije">Korekcije obračuna</Link>.
        </p>
        {approvedOriginals.length === 0 ? (
          <p className="muted small">Nema odobrenih zahteva za korekciju.</p>
        ) : (
          <table className="list list-compact">
            <tbody>
              {approvedOriginals.map((i) => (
                <tr key={i.id}>
                  <td>{i.request_type_name}</td>
                  <td>{i.center_code}</td>
                  <td>{i.period_start} – {i.period_end}</td>
                  <td className="num">{i.total_amount == null ? '—' : formatRsd(i.total_amount)}</td>
                  <td>
                    <button type="button" className="btn btn-small" onClick={() => void openCorrection(i)}>
                      Koriguj
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
