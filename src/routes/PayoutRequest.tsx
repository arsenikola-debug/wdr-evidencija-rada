import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Banner, Spinner } from '../components/Bits';
import { EmployeePicker } from '../components/EmployeePicker';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import {
  PROBLEM_TEXT, STATUS_LABEL, TYPE_HINT, dayAvailable, lineIndex, parseCellInput, unitLabel,
} from '../features/payouts/model';
import { WdrApiError } from '../lib/api';
import type { NightWorkDeclaration, PayoutDetail, PayoutLine } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const DOW = ['ned', 'pon', 'uto', 'sre', 'čet', 'pet', 'sub'];
function dayHead(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

/**
 * Jedan zahtev za dodatnu isplatu (redizajn §10–§17).
 * Iznos i stopa dolaze isključivo sa servera; ćelija šalje samo dan/sate/vreme.
 */
export function PayoutRequest() {
  const { id } = useParams();
  const { api } = useAuth();
  const [d, setD] = useState<PayoutDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [decl, setDecl] = useState<NightWorkDeclaration[]>([]);

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  useEffect(() => {
    if (!id) return;
    api.payoutGet(id).then(setD).catch(fail);
  }, [api, id, fail]);

  useEffect(() => {
    if (d?.request.request_type !== 'NOCNI_RAD') return;
    api.nightWorkDeclarations(d.request.center_id).then(setDecl).catch(() => setDecl([]));
  }, [api, d?.request.request_type, d?.request.center_id]);

  const lines = useMemo(() => (d ? lineIndex(d) : new Map<string, PayoutLine>()), [d]);
  const summary = useMemo(() => new Map((d?.summary ?? []).map((s) => [s.employee_id, s])), [d]);

  if (error && !d) return <Banner kind="error">{error}</Banner>;
  if (!d) return <Spinner label="Čitanje zahteva…" />;

  const r = d.request;
  const mode = r.input_mode;

  async function run(key: string, p: Promise<PayoutDetail>) {
    setSaving(key);
    setError(null);
    try {
      setD(await p);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(null);
    }
  }

  function save(employeeId: string, date: string, raw: { checked?: boolean; hours?: string; from?: string; to?: string }) {
    const parsed = parseCellInput(mode, raw);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    void run(`${employeeId}|${date}`, api.payoutSetLine({
      request_id: r.id, employee_id: employeeId, work_date: date,
      units: parsed.value?.units ?? null,
      time_from: parsed.value?.time_from ?? null,
      time_to: parsed.value?.time_to ?? null,
    }));
  }

  async function submit() {
    if (!window.confirm(`Poslati zahtev „${r.request_type_name}" Finansijama?`)) return;
    await run('submit', api.payoutSubmit(r.id));
    setNotice('Zahtev je poslat Finansijama.');
  }

  async function copyPrevious() {
    setSaving('copy');
    try {
      const res = await api.payoutCopyPrevious(r.id);
      setD(res);
      setNotice(res.copy?.source_request_id
        ? `Iz prethodnog zahteva dodato ${res.copy.added} zaposlenih (preskočeno ${res.copy.skipped}). Dani i sati se ne kopiraju.`
        : 'Nema prethodnog zahteva iste vrste za ovaj centar.');
    } catch (err) {
      fail(err);
    } finally {
      setSaving(null);
    }
  }

  async function toggleDeclaration(employeeId: string, declared: boolean) {
    try {
      await api.setNightWorkDeclaration({
        employee_id: employeeId, center_id: r.center_id, declared, from: r.period_start,
      });
      setDecl(await api.nightWorkDeclarations(r.center_id));
    } catch (err) {
      fail(err);
    }
  }

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>
            {r.request_type_name} — {r.center_code} · {r.period_start} – {r.period_end}
            {r.is_correction && <span className="chip chip-warn"> KOREKCIJA</span>}
          </h1>
          <p className="muted">{STATUS_LABEL[r.status]} · {TYPE_HINT[r.request_type]}</p>
        </div>
        <Link className="btn btn-quiet" to="/dodatne-isplate">← Dodatne isplate</Link>
      </div>

      {r.is_correction && r.corrects && (
        <Banner kind="info">
          Korekcija odobrenog zahteva {r.corrects.period_start} – {r.corrects.period_end}.
          Razlog: {r.correction_reason}. Original ostaje nepromenjen.
        </Banner>
      )}
      {r.status === 'RETURNED' && r.return_reason && (
        <Banner kind="warning">Vraćeno na ispravku: {r.return_reason}</Banner>
      )}
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner kind="success" onClose={() => setNotice(null)}>{notice}</Banner>}

      {d.can_edit && (
        <section className="control-section">
          <h2>Zaposleni</h2>
          <EmployeePicker
            scope="payout"
            period={{ from: r.period_start, to: r.period_end }}
            excludeIds={d.employees.map((e) => e.employee_id)}
            retireDnevnica
            defaultCenterId={r.center_id}
            onPick={(e) => run('add', api.payoutSetEmployees(r.id, [e.id], null))}
          />
          {!r.is_correction && (
            <button type="button" className="btn btn-quiet" disabled={saving !== null}
              onClick={() => void copyPrevious()}>
              Kopiraj spisak iz prethodne nedelje
            </button>
          )}
        </section>
      )}

      <section className="control-section">
        {d.employees.length === 0 ? (
          <p className="muted">Dodajte zaposlene preko pretrage iznad.</p>
        ) : (
          <div className="table-scroll">
            <table className="list list-compact payout-grid">
              <thead>
                <tr>
                  <th>Zaposleni</th>
                  {d.dates.map((dt) => <th key={dt}>{dayHead(dt)}</th>)}
                  <th className="num">{unitLabel(mode)}</th>
                  <th className="num">Ukupno</th>
                  {r.request_type === 'NOCNI_RAD' && <th>Noćni rad</th>}
                  {d.can_edit && <th />}
                </tr>
              </thead>
              <tbody>
                {d.employees.map((e) => {
                  const s = summary.get(e.employee_id);
                  const declared = decl.some((x) => x.employee_id === e.employee_id && x.active);
                  return (
                    <tr key={e.employee_id}>
                      <td>
                        {e.full_name}
                        <span className="muted small"> · {e.employee_code ?? 'bez šifre'}</span>
                        {e.source === 'NIGHT_DECLARATION' && <span className="chip"> predložen</span>}
                      </td>
                      {d.dates.map((dt) => {
                        const key = `${e.employee_id}|${dt}`;
                        const l = lines.get(key);
                        const ok = dayAvailable(d, e.employee_id, dt);
                        const dis = !d.can_edit || !ok || saving === key;
                        const title = !ok
                          ? 'Nije dostupno: van radnog odnosa, pre početka Dodatnih isplata ili (za radnu subotu) nije subota'
                          : l?.problem
                            ? `Nema cene: ${PROBLEM_TEXT[l.problem] ?? l.problem}`
                            : l?.amount != null ? `${l.units} × ${formatRsd(l.rate ?? 0)} = ${formatRsd(l.amount)}` : undefined;
                        return (
                          <td key={dt} title={title}
                            className={[!ok ? 'c-locked' : '', l?.problem ? 'row-error' : '', l?.unusual ? 'c-unusual' : ''].join(' ')}>
                            {mode === 'DAYS' && (
                              <input type="checkbox" checked={Boolean(l)} disabled={dis}
                                aria-label={`${e.full_name} ${dt}`}
                                onChange={(ev) => save(e.employee_id, dt, { checked: ev.target.checked })} />
                            )}
                            {mode === 'HOURS' && (
                              <input className="cell-input" inputMode="decimal" defaultValue={l ? String(l.units) : ''}
                                key={`${key}-${l?.units ?? ''}`} disabled={dis} aria-label={`${e.full_name} ${dt} sati`}
                                onBlur={(ev) => {
                                  if (ev.target.value !== (l ? String(l.units) : '')) {
                                    save(e.employee_id, dt, { hours: ev.target.value });
                                  }
                                }} />
                            )}
                            {mode === 'TIME_RANGE' && (
                              <TimeRangeCell line={l} disabled={dis} label={`${e.full_name} ${dt}`}
                                onSave={(from, to) => save(e.employee_id, dt, { from, to })} />
                            )}
                            {l?.unusual && <span className="small" title={`Istog dana: ${l.attendance_status}`}> ⚑</span>}
                          </td>
                        );
                      })}
                      <td className="num">{s?.units ?? 0}</td>
                      <td className="num">{s?.amount == null ? 'nepotpuno' : formatRsd(s.amount)}</td>
                      {r.request_type === 'NOCNI_RAD' && (
                        <td>
                          <label className="nw-toggle" title="Informativno: deklarisani zaposleni se automatski predlažu u novim zahtevima; ne utiče na obračun">
                            <input type="checkbox" checked={declared}
                              onChange={(ev) => void toggleDeclaration(e.employee_id, ev.target.checked)} />
                            deklarisan
                          </label>
                        </td>
                      )}
                      {d.can_edit && (
                        <td>
                          <button type="button" className="btn btn-small btn-quiet"
                            onClick={() => { if (window.confirm(`Ukloniti ${e.full_name} sa zahteva?`)) void run('rm', api.payoutSetEmployees(r.id, null, [e.employee_id])); }}>
                            Ukloni
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Ukupno zahtev</th>
                  <th colSpan={d.dates.length} />
                  <th className="num">{d.totals.units}</th>
                  <th className="num">{d.totals.amount == null ? 'nepotpuno' : formatRsd(d.totals.amount)}</th>
                  {r.request_type === 'NOCNI_RAD' && <th />}
                  {d.can_edit && <th />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {d.totals.unusual > 0 && (
          <Banner kind="info">
            ⚑ {d.totals.unusual} stavki je na dan kada je zaposleni na GO/BO, slobodan ili „ne radi".
            To je dozvoljeno, ali će biti prikazano u kontroli višestrukih kategorija.
          </Banner>
        )}
        {d.totals.problems > 0 && (
          <Banner kind="warning">
            {d.totals.problems} stavki nema upotrebljivu tarifu centra. Zahtev se ne može poslati dok
            administrator ne unese tarifu.
          </Banner>
        )}
      </section>

      {d.can_edit && (
        <div className="filter-row">
          <button type="button" className="btn btn-primary"
            disabled={saving !== null || d.totals.lines === 0 || d.totals.problems > 0}
            onClick={() => void submit()}>
            Pošalji Finansijama
          </button>
        </div>
      )}
    </div>
  );
}

function TimeRangeCell({
  line, disabled, label, onSave,
}: {
  line?: PayoutLine;
  disabled: boolean;
  label: string;
  onSave(from: string, to: string): void;
}) {
  const [from, setFrom] = useState(line?.time_from?.slice(0, 5) ?? '');
  const [to, setTo] = useState(line?.time_to?.slice(0, 5) ?? '');
  useEffect(() => {
    setFrom(line?.time_from?.slice(0, 5) ?? '');
    setTo(line?.time_to?.slice(0, 5) ?? '');
  }, [line?.time_from, line?.time_to]);

  function commit() {
    const same = from === (line?.time_from?.slice(0, 5) ?? '') && to === (line?.time_to?.slice(0, 5) ?? '');
    if (same) return;
    if ((from === '') !== (to === '')) return; // čeka se drugi kraj intervala
    onSave(from, to);
  }

  return (
    <span className="time-range" onBlur={commit}>
      <input className="cell-input" placeholder="od" value={from} disabled={disabled}
        aria-label={`${label} od`} onChange={(e) => setFrom(e.target.value)} />
      <input className="cell-input" placeholder="do" value={to} disabled={disabled}
        aria-label={`${label} do`} onChange={(e) => setTo(e.target.value)} />
      {line && <span className="muted small"> {line.units}h{line.crosses_midnight ? ' ↷' : ''}</span>}
    </span>
  );
}
