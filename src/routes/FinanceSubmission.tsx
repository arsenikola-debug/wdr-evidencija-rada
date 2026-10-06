import { BaseTypeChip } from '../components/BaseTypeChip';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Banner, EmptyState, Spinner, StatusBadge } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import {
  approvalState,
  financeApprovalSummary,
  formatPeriod,
  monthAllocation,
  pricingProblemText,
  totalForDisplay,
  transportByProvider,
} from '../features/finance/recap';
import { employeePeriodRows, fromCalcLinesWithStatus } from '../features/finance/employeeSummary';
import { EmployeePeriodTable } from '../components/EmployeePeriodTable';
import { WdrApiError } from '../lib/api';
import type { FinanceSubmissionDetail } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const KIND_LABEL: Record<string, string> = {
  PRIMARY: 'Osnovna naknada',
  COMPONENT: 'Komponenta',
  TRANSPORT: 'Prevoz',
};

const LINE_STATUS_LABEL: Record<string, string> = {
  RESOLVED: 'obračunato',
  MISSING_RULE: 'pravilo nije konfigurisano',
  MISSING_PAYMENT_TYPE: 'nema vrste isplate',
  RULE_NOT_PRICEABLE: 'pravilo nije naplativo',
  NOT_ELIGIBLE: 'nema pravo',
  NO_TRANSPORT_ASSIGNMENT: 'nema evidencije o prevozu',
};

export function FinanceSubmission() {
  const { api } = useAuth();
  const [params] = useSearchParams();
  const submissionId = params.get('prijava');

  const [data, setData] = useState<FinanceSubmissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [returnComment, setReturnComment] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);

  const load = useCallback(async () => {
    if (!submissionId) return;
    setError(null);
    try {
      setData(await api.getFinanceSubmission(submissionId));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api, submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    if (!submissionId) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.financeApprove(
        submissionId,
        approveComment.trim() === '' ? null : approveComment.trim(),
      );
      setNotice({
        kind: 'success',
        text: `Odobreno ${formatRsd(res.approved_amount)} RSD. ${res.note}`,
      });
      setConfirmApprove(false);
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

  async function sendBack() {
    if (!submissionId) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.financeReturn(submissionId, returnComment.trim());
      setNotice({ kind: 'success', text: 'Prijava je vraćena operateru na ispravku.' });
      setReturnComment('');
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
  if (!data) return <Spinner label="Čitanje obračuna…" />;

  const s = data.submission;
  const total = totalForDisplay(data.recap);
  const summary = financeApprovalSummary(data.recap);
  const { canApprove, reasons } = approvalState(data);
  const months = monthAllocation(data.lines);

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>
            {s.center_code} <BaseTypeChip type={s.base_type} /> · {formatPeriod(s.period_start, s.period_end)} <StatusBadge status={s.status} />
          </h1>
          <p className="muted">
            Poslao {s.submitted_by ?? '—'}
            {s.submitted_at ? ` · ${new Date(s.submitted_at).toLocaleString('sr-Latn-RS')}` : ''}
          </p>
        </div>
        <Link className="btn btn-quiet" to="/finansije">← Red za odobrenje</Link>
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      {data.incomplete_override && (
        <Banner kind="warning">
          <strong>Prijava je poslata uz odobren izuzetak za nepotpunu evidenciju.</strong>
          <div>Obrazloženje: {data.incomplete_override.reason}</div>
          <div className="small">
            Odobrio: {data.incomplete_override.by ?? '—'}
            {data.incomplete_override.at
              ? ` · ${new Date(data.incomplete_override.at).toLocaleString('sr-Latn-RS')}`
              : ''}
          </div>
          <div className="small">
            Očekivano {data.completeness.expected_count} employee-dana · pregledano{' '}
            {data.completeness.reviewed_count} · nepregledano{' '}
            {data.completeness.missing_count}.
          </div>
          {data.overridden_errors.length > 0 && (
            <div className="small">
              Izuzetak neutralizuje {data.overridden_errors.length} kontrolu kompletnosti;
              ona više ne blokira odobrenje, ali se ne skriva.
            </div>
          )}
        </Banner>
      )}

      {s.crosses_month && (
        <Banner kind="info">
          Period preseca dva meseca. Odobrenje se <strong>ne deli</strong> — jedan obračun i
          jedno odobrenje. Analitika raspoređuje svaku stavku po njenom datumu rada:{' '}
          {months.map((m) => `${m.month}: ${formatRsd(m.amount)}`).join(' · ')}.
        </Banner>
      )}

      {/* ===================================================== Za odobrenje ==== */}
      {/*
        Finansije odobravaju konkretnu KARNET ili OBUKA prijavu (0074). Za odobrenje
        su dovoljne tri vrednosti; tehnički raspored po grupama naknada se ovde ne
        prikazuje. Iznosi dolaze iz baze — ovde se samo sabiraju za prikaz.
      */}
      <section className="control-section">
        <h2>Za odobrenje</h2>

        <table className="list list-compact finance-summary">
          <tbody>
            <tr>
              <td>Naknade zaposlenima</td>
              <td className="num">{formatRsd(summary.employeePay)} RSD</td>
            </tr>
            <tr>
              <td>Prevoz</td>
              <td className="num">{formatRsd(summary.transport)} RSD</td>
            </tr>
          </tbody>
        </table>

        <div className={total.kind === 'complete' ? 'totals totals-complete' : 'totals totals-partial'}>
          {total.kind === 'complete' ? (
            <>
              <span className="totals-label">UKUPNO ZA ODOBRENJE</span>
              <span className="totals-value">{formatRsd(total.amount)} RSD</span>
              <span className="muted small">
                Iznos nije izmenljiv. Finansije potvrđuju obračun ili vraćaju period na
                ispravku.
              </span>
            </>
          ) : (
            <>
              <span className="totals-label">Delimično obračunato</span>
              <span className="totals-value">{formatRsd(total.resolvedSubtotal)} RSD</span>
              <strong className="totals-warning">
                Nema iznosa za odobrenje — {total.blockingLines}{' '}
                {total.blockingLines === 1 ? 'stavka' : 'stavki'} bez upotrebljivog pravila.
              </strong>
            </>
          )}
        </div>

        <p className="muted small">
          {data.recap.employee_count} zaposlenih · {data.recap.worked_employee_days}{' '}
          employee-dana · {data.recap.line_count} stavki obračuna · verzija{' '}
          {data.engine_version}
        </p>

        {data.blocking.length > 0 && (
          <>
            <h3>Stavke bez iznosa ({data.blocking.length})</h3>
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
                {data.blocking.map((l) => (
                  <tr key={l.line_no} className="row-error">
                    <td>{l.employee_name}</td>
                    <td>{l.work_date}</td>
                    <td>{l.payment_type_code ?? KIND_LABEL[l.line_kind]}</td>
                    <td>{l.center_code ?? '—'}</td>
                    <td>
                      {LINE_STATUS_LABEL[l.status] ?? l.status}
                      {l.pricing_problem ? ` — ${pricingProblemText(l.pricing_problem)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ======================================================= Prevoz ==== */}
      <section className="control-section">
        <h2>Prevoz</h2>
        {data.transport.groups.length === 0 ? (
          <p className="muted">Nema obračunatog prevoza u ovom periodu.</p>
        ) : (
          transportByProvider(data.transport.groups).map((p) => (
            <div key={p.provider} className="totals-breakdown">
              <span>
                <strong>{p.provider}</strong>
                {p.responsible ? ` · odgovorno lice ${p.responsible}` : ''}:{' '}
                <strong>{p.amount === null ? 'nije obračunato' : formatRsd(p.amount)}</strong>
              </span>
              <table className="list list-compact">
                <thead>
                  <tr>
                    <th>Centar</th>
                    <th className="num">Employee-dana</th>
                    <th className="num">Stopa</th>
                    <th className="num">Iznos</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((g, i) => (
                    <tr key={`${g.center_code}-${g.rate}-${i}`}>
                      <td>{g.center_code ?? '—'}</td>
                      <td className="num">{g.eligible_employee_days}</td>
                      <td className="num">
                        {formatRsd(g.rate)}
                        {g.liters_per_unit ? ` (${g.liters_per_unit} l)` : ''}
                      </td>
                      <td className="num">{formatRsd(g.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
        {(data.transport.not_eligible_count > 0 || data.transport.no_assignment_count > 0) && (
          <p className="muted small">
            Bez prava na prevoz: {data.transport.not_eligible_count} · bez evidencije:{' '}
            {data.transport.no_assignment_count}. Oba su rešeni odgovori, ne praznine.
          </p>
        )}
      </section>

      {/* ================================================ Po zaposlenom ==== */}
      {/*
        Finansijama je za odobrenje dovoljan zbir po zaposlenom za ceo period
        (osnovno · prevoz · ukupno). Dnevni i stavkovni drill-down nije deo
        odobravanja; iznosi i obračun se ne menjaju.
      */}
      <section className="control-section">
        <h2>Po zaposlenom — ukupno za period</h2>
        <p className="muted small">
          {s.center_code} · {s.base_type === 'OBUKA' ? 'Obuka' : s.base_type === 'KARNET' ? 'Karnet' : 'Karnet + Obuka'}
          {' '}· {formatPeriod(s.period_start, s.period_end)}
        </p>
        <EmployeePeriodTable
          rows={employeePeriodRows(fromCalcLinesWithStatus(data.lines))}
          periodLabel={formatPeriod(s.period_start, s.period_end)}
        />
      </section>

      {/* ===================================================== Kontrole ==== */}
      <section className="control-section">
        <h2>Kontrole iz unosa</h2>

        {data.hard_errors.length === 0 && data.warnings.length === 0 && (
          <p className="muted">Nema grešaka ni upozorenja.</p>
        )}

        {data.hard_errors.length > 0 && (
          <ul className="ctrl-list">
            {data.hard_errors.map((e, i) => (
              <li key={`${e.code}-${i}`} className="v-err">
                <span className="v-sev">GREŠKA</span>
                <span className="v-code">{e.code}</span>
                {e.message}
              </li>
            ))}
          </ul>
        )}

        {data.warnings.length > 0 && (
          <ul className="ctrl-list">
            {data.warnings.map((w) => (
              <li key={w.fingerprint} className={w.acknowledged ? 'v-ack' : 'v-warn'}>
                <span className="v-sev">{w.acknowledged ? 'POTVRĐENO' : 'NEPOTVRĐENO'}</span>
                <span className="v-code">{w.code}</span>
                {w.message}
                {w.acknowledged && (
                  <span className="muted small">
                    {' '}— {w.acknowledged_by ?? '—'}
                    {w.acknowledged_at
                      ? `, ${new Date(w.acknowledged_at).toLocaleString('sr-Latn-RS')}`
                      : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {data.comments.length > 0 && (
          <>
            <h3>Komentari</h3>
            <ul className="ctrl-list">
              {data.comments.map((c, i) => (
                <li key={i}>
                  <strong>{c.author ?? '—'}</strong>{' '}
                  <span className="muted small">
                    {new Date(c.created_at).toLocaleString('sr-Latn-RS')}
                  </span>
                  <div>{c.message}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ====================================================== Odobrenje === */}
      {data.approval ? (
        <section className="control-section">
          <h2>Odobrenje</h2>
          <Banner kind="success">
            Odobreno {formatRsd(data.approval.approved_amount)} RSD ·{' '}
            {data.approval.approved_by ?? '—'} ·{' '}
            {new Date(data.approval.approved_at).toLocaleString('sr-Latn-RS')}
          </Banner>
          <p className="muted small">
            Odobreno znači da je iznos potvrđen i raspoloživ za ovaj proces. Ne znači
            izvršenu isplatu.
          </p>
          <table className="list list-compact">
            <tbody>
              <tr><td>Isplatni iznos</td><td className="num">{formatRsd(data.approval.payable_amount)}</td></tr>
              <tr><td>Naknade zaposlenima</td><td className="num">{formatRsd(data.approval.employee_calculated_amount)}</td></tr>
              <tr><td>Prekovremeni</td><td className="num">{formatRsd(data.approval.overtime_calculated_amount)}</td></tr>
              <tr><td>Ostale komponente</td><td className="num">{formatRsd(data.approval.other_calculated_amount)}</td></tr>
              <tr><td>Prevoz</td><td className="num">{formatRsd(data.approval.transport_calculated_amount)}</td></tr>
            </tbody>
          </table>
          {data.approval.finance_comment && (
            <p>Komentar finansija: {data.approval.finance_comment}</p>
          )}
          <p className="muted small">
            Nepromenljivi zapis: verzija {data.approval.engine_version}, potpis{' '}
            <code>{data.approval.content_hash.slice(0, 16)}…</code>. Ispravka posle
            odobrenja ide isključivo kroz zahtev za korekciju (Doplata / Umanjenje).
          </p>
        </section>
      ) : (
        <section className="control-section">
          <h2>Odluka finansija</h2>

          {reasons.length > 0 && (
            <Banner kind="error">
              <strong>Odobrenje trenutno nije moguće:</strong>
              <ul>
                {reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </Banner>
          )}

          <div className="override-box">
            <strong>ODOBRI</strong>
            <p className="muted small">
              Potvrđujete obračunati iznos u celini. Ne postoji polje za izmenu iznosa i
              ne postoji delimično odobrenje — ako se ne slažete, vratite period na
              ispravku.
            </p>
            <textarea
              rows={2}
              value={approveComment}
              placeholder="Komentar finansija (opciono)"
              onChange={(e) => setApproveComment(e.target.value)}
            />
            <label className="confirm-row">
              <input
                type="checkbox"
                checked={confirmApprove}
                onChange={(e) => setConfirmApprove(e.target.checked)}
                disabled={!canApprove}
              />
              <span>
                Potvrđujem odobrenje iznosa{' '}
                <strong>
                  {total.kind === 'complete' ? `${formatRsd(total.amount)} RSD` : '—'}
                </strong>{' '}
                za period {s.period_start} – {s.period_end}.
              </span>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-submit"
              disabled={busy || !canApprove || !confirmApprove}
              onClick={() => void approve()}
            >
              {busy ? 'Obrada…' : 'ODOBRI'}
            </button>
          </div>

          <div className="override-box">
            <strong>VRATI NA ISPRAVKU</strong>
            <p className="muted small">
              Obrazloženje je obavezno (najmanje 10 znakova) i vidljivo je operateru.
              Operater ispravlja podatke, sistem ponovo obračunava i prijava se šalje
              iznova.
            </p>
            <textarea
              rows={3}
              value={returnComment}
              placeholder="Šta konkretno treba ispraviti"
              onChange={(e) => setReturnComment(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !data.can_return || returnComment.trim().length < 10}
              onClick={() => void sendBack()}
            >
              {busy ? 'Obrada…' : 'VRATI NA ISPRAVKU'}
            </button>
          </div>

          <p className="muted small">
            Dugmad prate odgovor servera (<code>can_approve</code>, <code>can_return</code>).
            Odobrenje je jedna transakcija: nepromenljivi obračun, odobrenje, prelaz
            statusa, analitika, obaveštenje i audit — sve ili ništa.
          </p>
        </section>
      )}
    </div>
  );
}
