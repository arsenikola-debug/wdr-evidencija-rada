import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { addDays, weekStart } from '../features/payouts/model';
import { WdrApiError } from '../lib/api';
import type { AdminConfig, CutoverReadiness, PayoutContext } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

/**
 * Jedinica pravila koju obračun dodatnih isplata prihvata po vrsti (0063/0067).
 * PO DANU: Dnevnica, Ispomoć, Radna subota, Noćni rad · PO SATU: Prekovremeni.
 * Dnevnica koristi PER_EVENT jer njena vrsta isplate (DODATNA_DNEVNICA) ne
 * dozvoljava PER_WORKED_DAY — obračun je isti: 1 označen dan = 1 jedinica.
 */
const RULE_UNIT: Record<string, string> = {
  DNEVNICA: 'PER_EVENT',
  ISPOMOC: 'PER_WORKED_DAY',
  RADNA_SUBOTA: 'PER_WORKED_DAY',
  PREKOVREMENI: 'PER_HOUR',
  NOCNI_RAD: 'PER_WORKED_DAY',
};

const UNIT_TEXT: Record<string, string> = {
  PER_EVENT: 'po danu', PER_WORKED_DAY: 'po danu', PER_HOUR: 'po satu', FIXED: 'fiksno',
};

/**
 * Administracija dodatnih isplata:
 *   1. spremnost i JEDNOKRATNA aktivacija cutover-a (blokeri iz baze),
 *   2. tarife po centru i vrsti — vremenski važeće (postojeći compensation_rules;
 *      nova tarifa od datuma zatvara staru dan ranije, istorija se ne menja).
 */
export function AdminPayouts() {
  const { api } = useAuth();
  const [ctx, setCtx] = useState<PayoutContext | null>(null);
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [date, setDate] = useState(addDays(weekStart(new Date().toISOString().slice(0, 10)), 7));
  const [ready, setReady] = useState<CutoverReadiness | null>(null);
  const [confirm, setConfirm] = useState('');
  const [rate, setRate] = useState<{ center: string; type: string; amount: string; from: string }>({
    center: '', type: 'DNEVNICA', amount: '', from: '',
  });
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [filterCenter, setFilterCenter] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([api.payoutContext(), api.getAdminConfig()]);
      setCtx(c);
      setCfg(a);
      if (c.cutover_date) setDate(c.cutover_date);
    } catch (err) {
      fail(err);
    }
  }, [api, fail]);

  useEffect(() => { void load(); }, [load]);

  async function check() {
    setError(null);
    try {
      setReady(await api.adminPayoutCutoverReadiness(date));
    } catch (err) {
      fail(err);
    }
  }

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      setReady(await api.adminActivatePayoutCutover(date, confirm));
      setNotice(`Cutover je aktiviran od ${date}.`);
      setConfirm('');
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const typeToPayment = useMemo(
    () => new Map((ctx?.types ?? []).map((t) => [t.code, t.payment_type_code])),
    [ctx],
  );

  const rateRows = useMemo(() => {
    if (!cfg || !ctx) return [];
    return ctx.types.flatMap((t) => cfg.compensation_rules
      .filter((r) => r.payment_type_code === t.payment_type_code && r.active && !r.attendance_status
        && (showHistory || !r.valid_to || r.valid_to >= today))
      .map((r) => ({ type: t, rule: r })))
      .filter((x) => !filterCenter || x.rule.center_id === filterCenter || (!x.rule.center_id && filterCenter === 'GLOBAL'))
      .sort((a, b) => (a.rule.center_code ?? '').localeCompare(b.rule.center_code ?? '')
        || a.type.name.localeCompare(b.type.name) || b.rule.valid_from.localeCompare(a.rule.valid_from));
  }, [cfg, ctx, showHistory, filterCenter, today]);

  async function saveRate() {
    if (!cfg) return;
    const ptCode = typeToPayment.get(rate.type as PayoutContext['types'][number]['code']);
    const pt = cfg.payment_types.find((p) => p.code === ptCode);
    const amount = Number(rate.amount.replace(',', '.'));
    if (!pt || !rate.center || !rate.from || !Number.isFinite(amount) || amount < 0) {
      setError('Izaberite centar, vrstu, iznos i datum od kog tarifa važi.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const open = cfg.compensation_rules.find((r) => r.payment_type_id === pt.id && r.center_id === rate.center
        && r.active && !r.attendance_status && !r.valid_to && r.unit_type === RULE_UNIT[rate.type]);
      if (open) {
        await api.adminSupersedeCompRule(open.id, amount, rate.from, 'Tarifa dodatne isplate');
      } else {
        await api.adminCreateCompRule({
          center_id: rate.center, payment_type_id: pt.id, attendance_status: null, amount,
          unit_type: RULE_UNIT[rate.type], valid_from: rate.from, notes: 'Tarifa dodatne isplate',
        });
      }
      setNotice('Tarifa je sačuvana. Obračuni pre datuma važenja se ne menjaju.');
      setRate((r) => ({ ...r, amount: '' }));
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (!ctx || !cfg) return error ? <Banner kind="error">{error}</Banner> : <Spinner label="Učitavanje…" />;

  return (
    <div className="page">
      <h1>Dodatne isplate — cutover i tarife</h1>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner kind="success" onClose={() => setNotice(null)}>{notice}</Banner>}

      <section className="control-section">
        <h2>Cutover</h2>
        {ctx.active ? (
          <Banner kind="info">
            Aktivirano od <strong>{ctx.cutover_date}</strong>. Od tog datuma dnevnice, ispomoć, radna
            subota i prekovremeni idu isključivo kroz Dodatne isplate; stari putevi su zaključani u bazi.
          </Banner>
        ) : (
          <>
            <p className="muted small">
              Predlog: prvi dan novog nedeljnog perioda (ponedeljak). Aktivacija je jednokratna i
              odbija se dok postoji ijedan bloker. Otvoreni draftovi se ne konvertuju.
            </p>
            <div className="report-filters">
              <label>Cutover datum
                <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setReady(null); }} />
              </label>
              <button type="button" className="btn" onClick={() => void check()}>Proveri spremnost</button>
            </div>
          </>
        )}

        {ready && (
          <>
            <h3>Blokeri ({ready.blockers.length})</h3>
            {ready.blockers.length === 0 ? <p className="muted small">Nema blokera.</p> : (
              <ul>{ready.blockers.map((b, i) => (
                <li key={i}><strong>{b.code}</strong>{b.center_code ? ` · ${b.center_code}` : ''} — {b.message}</li>
              ))}</ul>
            )}
            <h3>Upozorenja ({ready.warnings.length})</h3>
            {ready.warnings.length === 0 ? <p className="muted small">Nema upozorenja.</p> : (
              <ul>{ready.warnings.map((w, i) => (
                <li key={i}><strong>{w.code}</strong>{w.center_code ? ` · ${w.center_code}` : ''} — {w.message}</li>
              ))}</ul>
            )}
            {ready.deactivates.length > 0 && (
              <>
                <h3>Posle aktivacije se gasi</h3>
                <ul>{ready.deactivates.map((d) => <li key={d}>{d}</li>)}</ul>
              </>
            )}
            {!ctx.active && ready.can_activate && (
              <div className="report-filters">
                <label>Upišite AKTIVIRAJ za potvrdu
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </label>
                <button type="button" className="btn btn-primary" disabled={busy || confirm !== 'AKTIVIRAJ'}
                  onClick={() => void activate()}>
                  Aktiviraj cutover od {date}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="control-section">
        <h2>Tarife po centru</h2>
        <p className="muted small">
          Dnevnica, Ispomoć, Radna subota i Noćni rad: iznos <strong>po danu</strong>. Prekovremeni:
          iznos <strong>po satu</strong>. Nova tarifa važi od izabranog datuma; prethodna se
          automatski zatvara dan ranije, a odobreni obračuni se ne menjaju.
        </p>
        <div className="report-filters">
          <label>Centar
            <select value={rate.center} onChange={(e) => setRate({ ...rate, center: e.target.value })}>
              <option value="">—</option>
              {cfg.centers.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </label>
          <label>Vrsta
            <select value={rate.type} onChange={(e) => setRate({ ...rate, type: e.target.value })}>
              {ctx.types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
          </label>
          <label>{RULE_UNIT[rate.type] === 'PER_HOUR' ? 'Iznos po satu (RSD)' : 'Iznos po danu (RSD)'}
            <input inputMode="decimal" value={rate.amount} onChange={(e) => setRate({ ...rate, amount: e.target.value })} />
          </label>
          <label>Važi od
            <input type="date" value={rate.from} min={ctx.cutover_date ?? undefined}
              onChange={(e) => setRate({ ...rate, from: e.target.value })} />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveRate()}>
            Sačuvaj tarifu
          </button>
        </div>

        <div className="filter-row">
          <label>Centar{' '}
            <select value={filterCenter} onChange={(e) => setFilterCenter(e.target.value)}>
              <option value="">svi</option>
              <option value="GLOBAL">(globalno)</option>
              {cfg.centers.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </label>
          <label className="confirm-row">
            <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
            <span>Prikaži istoriju (i zatvorene tarife)</span>
          </label>
        </div>
        <table className="list list-compact">
          <thead>
            <tr><th>Vrsta</th><th>Centar</th><th>Jedinica</th><th className="num">Iznos</th><th>Od</th><th>Do</th><th>Verzija</th></tr>
          </thead>
          <tbody>
            {rateRows.length === 0 && <tr><td colSpan={7} className="muted">Nema unetih tarifa.</td></tr>}
            {rateRows.map(({ type, rule }) => (
              <tr key={rule.id} className={RULE_UNIT[type.code] !== rule.unit_type ? 'row-muted' : ''}
                title={RULE_UNIT[type.code] !== rule.unit_type ? 'Jedinica ne odgovara dodatnim isplatama (staro pravilo grida)' : undefined}>
                <td>{type.name}</td>
                <td>{rule.center_code ?? '(globalno)'}</td>
                <td>{UNIT_TEXT[rule.unit_type] ?? rule.unit_type}</td>
                <td className="num">{formatRsd(rule.amount)} RSD</td>
                <td>{rule.valid_from}</td>
                <td>{rule.valid_to ?? '—'}</td>
                <td>v{rule.version}{!rule.valid_to || rule.valid_to >= today ? '' : ' · zatvorena'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
