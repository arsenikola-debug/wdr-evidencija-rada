import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import {
  breakdownByPaymentType,
  groupMissingByEmployee,
} from '../features/finance/previewBreakdown';
import { formatDay } from '../features/analytics/period';
import { WdrApiError } from '../lib/api';
import type { PreviewLine, SubmissionPreview } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const LINE_KIND_LABEL: Record<string, string> = {
  PRIMARY: 'Osnovna naknada',
  COMPONENT: 'Komponente',
  TRANSPORT: 'Prevoz',
};

const STATUS_LABEL: Record<PreviewLine['status'], string> = {
  RESOLVED: 'obračunato',
  MISSING_RULE: 'pravilo nije konfigurisano',
  MISSING_PAYMENT_TYPE: 'nema vrste isplate',
  NOT_ELIGIBLE: 'nema pravo',
  NO_TRANSPORT_ASSIGNMENT: 'nema evidencije o prevozu',
};

export function Preview() {
  const { api, demoRates, can } = useAuth();
  const [params] = useSearchParams();
  const submissionId = params.get('prijava');

  const [data, setData] = useState<SubmissionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const load = useCallback(async () => {
    if (!submissionId) return;
    setError(null);
    try {
      setData(await api.getSubmissionPreview(submissionId));
    } catch (err) {
      setError(messageForCode(null, err instanceof Error ? err.message : undefined));
    }
  }, [api, submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function acknowledgeAll() {
    if (!submissionId || !data) return;
    const open = data.warnings.filter((w) => !w.acknowledged).map((w) => w.fingerprint);
    if (open.length === 0) return;
    setBusy(true);
    try {
      const n = await api.acknowledgeWarnings(submissionId, open, 'Potvrđeno na ekranu pregleda');
      setNotice({ kind: 'success', text: `Potvrđeno upozorenja: ${n}.` });
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

  async function submit() {
    if (!submissionId) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.submitPeriod(
        submissionId,
        reviewConfirmed,
        overrideReason.trim() === '' ? null : overrideReason.trim(),
      );
      setNotice({
        kind: 'success',
        text: res.incomplete_override
          ? `Period je poslat NEPOTPUN uz izuzetak (${res.missing_count} nepregledanih). Finansije su obaveštene.`
          : `Period je poslat finansijama. Pregledano ${res.reviewed_count}/${res.expected_count} employee-dana.`,
      });
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

  if (!submissionId) return <EmptyState title="Nije izabrana prijava" />;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!data) return <Spinner label="Provera prijave…" />;

  const t = data.totals;
  const c = data.completeness;
  const breakdown = breakdownByPaymentType(data.lines);
  const openWarnings = data.warnings.filter((w) => !w.acknowledged);
  const alreadySent = data.submission.status !== 'DRAFT' && data.submission.status !== 'RETURNED';
  const canOverride = can('period.submit_incomplete');

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Pregled pre slanja</h1>
          <p className="muted">
            Centar {data.submission.center_code} · period {data.submission.period_start} –{' '}
            {data.submission.period_end}
          </p>
        </div>
        <Link className="btn btn-quiet" to={`/unos?prijava=${submissionId}`}>
          ← Vrati se na unos
        </Link>
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <Banner kind="info">
        {data.note}
        {demoRates && ' Prikazane stope su DEMO vrednosti iz mock adaptera.'}
      </Banner>

      {data.incomplete_override && (
        <Banner kind="warning">
          Ovaj period je poslat <strong>nepotpun</strong> uz izuzetak
          {data.incomplete_override.by ? ` (${data.incomplete_override.by})` : ''}.
          Obrazloženje: {data.incomplete_override.reason}
        </Banner>
      )}

      {/* ===================================================== A. Evidencija === */}
      <section className="control-section">
        <h2>A. Evidencija</h2>
        {!c.dates_configured ? (
          <Banner kind="error">
            Za ovaj period nisu konfigurisani očekivani radni dani, pa kompletnost ne može
            da se proveri. Obratite se administratoru.
          </Banner>
        ) : (
          <>
            <div className="metrics">
              <div className="metric">
                <span className="metric-label">Očekivani employee-dani</span>
                <span className="metric-value">{c.expected_count}</span>
              </div>
              <div className="metric">
                <span className="metric-label">Pregledano</span>
                <span className="metric-value">{c.reviewed_count}</span>
              </div>
              <div className={c.missing_count > 0 ? 'metric metric-bad' : 'metric metric-ok'}>
                <span className="metric-label">Nepregledano</span>
                <span className="metric-value">{c.missing_count}</span>
              </div>
            </div>

            {c.missing_count > 0 && (
              <>
                <Banner kind="error">
                  Prijava se ne može poslati dok svaki očekivani dan ne dobije eksplicitno
                  stanje. Prazna ćelija znači „nije pregledano".
                </Banner>
                {/*
                  Duga lista se grupiše po zaposlenom: jedan red po osobi, datumi
                  kao klikabilni čipovi. Ništa se ne sakriva — sve nepregledane
                  ćelije su i dalje ovde, samo u skenirajućem obliku.
                */}
                <div className="missing-list" role="group" aria-label="Nepregledane ćelije">
                  {groupMissingByEmployee(c.missing).map((g) => (
                    <div className="missing-row" key={g.employee_id}>
                      <div className="missing-emp">
                        <strong>{g.employee_name}</strong>
                        <span className="muted small">
                          {g.dates.length}{' '}
                          {g.dates.length === 1 ? 'nepregledan dan' : 'nepregledanih dana'}
                        </span>
                      </div>
                      <div className="missing-dates">
                        {g.dates.map((d) => (
                          <Link
                            key={d}
                            className="date-chip"
                            title={`Otvori ćeliju ${g.employee_name} · ${d}`}
                            to={`/unos?prijava=${submissionId}&zaposleni=${g.employee_id}&datum=${d}`}
                          >
                            {formatDay(d).slice(0, 6)}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="muted small">
                  Ukupno {c.missing.length} nepregledanih ćelija kod{' '}
                  {groupMissingByEmployee(c.missing).length} zaposlenih. Klik na datum
                  otvara tačnu ćeliju u evidenciji.
                </p>
              </>
            )}
          </>
        )}
      </section>

      {/* ======================================================= B. Obračun === */}
      <section className="control-section">
        <h2>B. Obračun</h2>

        <div className={t.is_complete ? 'totals totals-complete' : 'totals totals-partial'}>
          {t.is_complete ? (
            <>
              <span className="totals-label">Ukupno</span>
              <span className="totals-value">{formatRsd(t.total_calculated_amount)} RSD</span>
            </>
          ) : (
            <>
              <span className="totals-label">Delimično obračunato</span>
              <span className="totals-value">{formatRsd(t.resolved_subtotal)} RSD</span>
              <strong className="totals-warning">
                Ukupan iznos nije moguće izračunati — nedostaju pravila obračuna.
              </strong>
              <span className="muted small">
                {t.blocking_line_count}{' '}
                {t.blocking_line_count === 1 ? 'stavka' : 'stavki'} bez konfigurisanog
                pravila. Prikazani iznos je nepotpun i ne sme se koristiti kao ukupan.
              </span>
            </>
          )}
        </div>

        <div className="totals-breakdown">
          {Object.entries(t.by_line_kind).map(([kind, value]) => (
            <span key={kind}>
              {LINE_KIND_LABEL[kind] ?? kind}: <strong>{formatRsd(value)}</strong>
            </span>
          ))}
          {Object.keys(data.resolved_by_center).length > 0 && (
            <span>
              Po centru (samo obračunato):{' '}
              {Object.entries(data.resolved_by_center)
                .map(([k, v]) => `${k} ${formatRsd(v)}`)
                .join(' · ')}
            </span>
          )}
        </div>

        {/*
          Raščlanjenje po stvarnoj vrsti isplate. Kategorijski zbirovi iznad
          dolaze sa servera; ovde se grupišu iste, već izračunate stavke po
          šifri vrste isplate, jer server ne vraća taj presek.
        */}
        {breakdown.length > 0 && (
          <table className="list list-compact breakdown-table">
            <thead>
              <tr>
                <th>Kategorija</th>
                <th>Vrsta isplate</th>
                <th className="num">Količina</th>
                <th className="num">Stavki</th>
                <th className="num">Iznos</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((g) =>
                g.rows.map((r, i) => (
                  <tr key={r.key} className={r.resolvedLines === 0 ? 'row-muted' : ''}>
                    <td>{i === 0 ? (LINE_KIND_LABEL[g.lineKind] ?? g.lineKind) : ''}</td>
                    <td>
                      <strong>{r.code}</strong>
                      {r.blockedLines > 0 && (
                        <span className="chip chip-warn" title="Stavke bez konfigurisanog pravila">
                          {r.blockedLines} bez pravila
                        </span>
                      )}
                    </td>
                    <td className="num">{r.units === 0 ? '—' : r.units}</td>
                    <td className="num">{r.resolvedLines}</td>
                    <td className="num">
                      {r.resolvedLines === 0 ? '—' : formatRsd(r.amount)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Iznosi u raščlanjenju su serverski izračunate vrednosti grupisane po vrsti
          isplate. Stavke bez pravila nemaju iznos i ne računaju se kao nula.
        </p>

        {data.blocking.length > 0 && (
          <>
            <h3>Stavke bez pravila ({data.blocking.length})</h3>
            <p className="muted small">
              Nedostajuće pravilo nije nula — unosi ga administrator.
            </p>
            <table className="list list-compact">
              <thead>
                <tr>
                  <th>Zaposleni</th>
                  <th>Datum</th>
                  <th>Stavka</th>
                  <th>Centar</th>
                  <th>Razlog</th>
                </tr>
              </thead>
              <tbody>
                {data.blocking.map((l, i) => (
                  <tr key={`${l.work_entry_id}-${l.payment_type_code}-${i}`} className="row-error">
                    <td>{l.employee_name}</td>
                    <td>{l.work_date}</td>
                    <td>{l.payment_type_code ?? '—'}</td>
                    <td>{l.center_code ?? '—'}</td>
                    <td>{STATUS_LABEL[l.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <details className="lines-details">
          <summary>Sve stavke obračuna ({data.lines.length})</summary>
          <table className="list list-compact">
            <thead>
              <tr>
                <th>Zaposleni</th>
                <th>Datum</th>
                <th>Vrsta</th>
                <th>Stavka</th>
                <th>Osnova centra</th>
                <th>Centar</th>
                <th className="num">Stopa</th>
                <th className="num">Količina</th>
                <th className="num">Iznos</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr
                  key={`${l.work_entry_id}-${l.line_kind}-${l.payment_type_code}-${i}`}
                  className={l.status === 'RESOLVED' ? '' : 'row-muted'}
                >
                  <td>{l.employee_name}</td>
                  <td>{l.work_date}</td>
                  <td>{LINE_KIND_LABEL[l.line_kind] ?? l.line_kind}</td>
                  <td>{l.payment_type_code ?? '—'}</td>
                  <td title="Zašto je izabran ovaj centar">{l.basis}</td>
                  <td>{l.center_code ?? '—'}</td>
                  <td className="num">{formatRsd(l.rate)}</td>
                  <td className="num">{l.units}</td>
                  <td className="num">{formatRsd(l.calculated_amount)}</td>
                  <td>{STATUS_LABEL[l.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {/* ====================================================== C. Kontrole === */}
      <section className="control-section">
        <h2>C. Kontrole</h2>

        <div className="metrics">
          <div className={data.hard_error_count > 0 ? 'metric metric-bad' : 'metric metric-ok'}>
            <span className="metric-label">Blokirajuće greške</span>
            <span className="metric-value">{data.hard_error_count}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Upozorenja</span>
            <span className="metric-value">{data.warnings.length}</span>
          </div>
          <div className={openWarnings.length > 0 ? 'metric metric-bad' : 'metric metric-ok'}>
            <span className="metric-label">Nepotvrđeno</span>
            <span className="metric-value">{openWarnings.length}</span>
          </div>
        </div>

        {data.hard_errors.length > 0 && (
          <>
            <h3>Blokirajuće greške</h3>
            <p className="muted small">Greške se ne mogu potvrditi — moraju se ispraviti.</p>
            <ul className="ctrl-list">
              {data.hard_errors.map((e, i) => (
                <li key={`${e.code}-${i}`} className="v-err">
                  <span className="v-sev">GREŠKA</span>
                  <span className="v-code">{e.code}</span>
                  {e.message}
                </li>
              ))}
            </ul>
          </>
        )}

        {data.warnings.length > 0 && (
          <>
            <h3>Upozorenja</h3>
            <p className="muted small">
              Svako upozorenje mora biti potvrđeno pre slanja. Ako se podatak izmeni,
              upozorenje dobija novi potpis i staru potvrdu treba obnoviti.
            </p>
            <ul className="ctrl-list">
              {data.warnings.map((w) => (
                <li key={w.fingerprint} className={w.acknowledged ? 'v-ack' : 'v-warn'}>
                  <span className="v-sev">{w.acknowledged ? 'POTVRĐENO' : 'UPOZORENJE'}</span>
                  <span className="v-code">{w.code}</span>
                  {w.message}
                </li>
              ))}
            </ul>
            {openWarnings.length > 0 && !alreadySent && (
              <button type="button" className="btn" disabled={busy} onClick={() => void acknowledgeAll()}>
                Potvrdi sva upozorenja ({openWarnings.length})
              </button>
            )}
          </>
        )}

        {data.hard_error_count === 0 && data.warnings.length === 0 && (
          <p className="muted">Nema grešaka ni upozorenja.</p>
        )}
      </section>

      {/* ======================================================== Slanje ==== */}
      <section className="control-section">
        <h2>Slanje finansijama</h2>

        {alreadySent ? (
          <Banner kind="success">
            Prijava je već poslata (status: {data.submission.status}).
          </Banner>
        ) : (
          <>
            {!data.ready_to_submit && (
              <Banner kind="error">
                Slanje nije moguće: {data.hard_error_count} blokirajućih grešaka,{' '}
                {t.blocking_line_count} stavki bez pravila, {openWarnings.length} nepotvrđenih
                upozorenja.
              </Banner>
            )}

            <label className="confirm-row">
              <input
                type="checkbox"
                checked={reviewConfirmed}
                onChange={(e) => setReviewConfirmed(e.target.checked)}
              />
              <span>
                Pregledao sam evidenciju, obračun i kontrole i potvrđujem da su podaci tačni.
              </span>
            </label>

            {c.missing_count > 0 && canOverride && (
              <div className="override-box">
                <strong>Izuzetak: slanje nepotpunog perioda</strong>
                <p className="muted small">
                  Koristite samo kada stvarno stanje ne može da se unese. Obrazloženje ide u
                  audit i vidno je finansijama. Najmanje 20 znakova.
                </p>
                <textarea
                  rows={3}
                  value={overrideReason}
                  placeholder="Zašto se period šalje nepotpun i ko je to odobrio"
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              </div>
            )}

            {c.missing_count > 0 && !canOverride && (
              <p className="muted small">
                Nemate pravo da pošaljete nepotpun period. Unesite stvarno stanje ili
                upotrebite grupnu akciju „Ne radi" za neradne dane.
              </p>
            )}

            <button
              type="button"
              className="btn btn-primary btn-submit"
              disabled={
                busy ||
                !reviewConfirmed ||
                (!data.ready_to_submit &&
                  !(c.missing_count > 0 && canOverride && overrideReason.trim().length >= 20))
              }
              onClick={() => void submit()}
            >
              {busy ? 'Slanje…' : 'POŠALJI FINANSIJAMA'}
            </button>

            <p className="muted small">
              Dugme prati odgovor servera (<code>ready_to_submit</code>). Slanje ne kreira
              obračunski snapshot — nepromenljivi finansijski zapis nastaje pri odobrenju.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
