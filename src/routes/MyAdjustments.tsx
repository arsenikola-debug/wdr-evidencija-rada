import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import {
  DIRECTION_LABEL,
  STATUS_LABEL,
  adjustmentFormErrors,
  netEffect,
  signedAmountLabel,
  submitState,
  toAdjustmentInput,
  type AdjustmentFormValues,
} from '../features/finance/adjustment';
import { WdrApiError } from '../lib/api';
import type {
  Adjustment,
  AdjustmentPreview,
  GridPayload,
  SubmissionListItem,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const EMPTY_FORM: AdjustmentFormValues = {
  employee_id: '',
  related_work_date: '',
  center_id: '',
  payment_type_id: '',
  units: '',
  direction: 'DEBIT',
  reason: '',
};

export function MyAdjustments() {
  const { api } = useAuth();
  const [items, setItems] = useState<Adjustment[] | null>(null);
  const [reference, setReference] = useState<GridPayload | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AdjustmentFormValues>(EMPTY_FORM);
  const [originalId, setOriginalId] = useState<string>('');
  const [preview, setPreview] = useState<AdjustmentPreview | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, subs] = await Promise.all([api.getMyAdjustments(), api.listSubmissions()]);
      setItems(list);
      setSubmissions(subs);
      // Reference lists (zaposleni, vrste isplate, centri) dolaze iz grida —
      // isti izvor koji operater već koristi za unos.
      if (subs.length > 0) setReference(await api.getGrid(subs[0].id));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const componentTypes = useMemo(
    () => (reference?.reference.payment_types ?? []).filter((p) => p.kind === 'COMPONENT'),
    [reference],
  );

  const formErrors = adjustmentFormErrors(form);

  async function refreshPreview(next: AdjustmentFormValues) {
    setPreview(null);
    if (adjustmentFormErrors(next).length > 0) return;
    try {
      setPreview(
        await api.previewAdjustment(
          next.employee_id,
          next.related_work_date,
          next.center_id,
          next.payment_type_id,
          Number(next.units),
          next.direction,
        ),
      );
    } catch {
      // Predlog je pomoć, ne kontrola: server odlučuje pri slanju.
      setPreview(null);
    }
  }

  function update(patch: Partial<AdjustmentFormValues>) {
    const next = { ...form, ...patch };
    setForm(next);
    void refreshPreview(next);
  }

  function startNew() {
    const centerId = reference?.submission.center_id ?? '';
    setEditingId(null);
    setOriginalId('');
    setPreview(null);
    setForm({ ...EMPTY_FORM, center_id: centerId });
    setFormOpen(true);
  }

  function startEdit(a: Adjustment) {
    setEditingId(a.id);
    setOriginalId(a.original_submission_id ?? '');
    setForm({
      employee_id: a.employee_id,
      related_work_date: a.related_work_date,
      center_id: a.center_id,
      payment_type_id: a.payment_type_id,
      units: String(a.units),
      direction: a.direction,
      reason: a.reason,
    });
    setPreview(null);
    setFormOpen(true);
  }

  async function save(thenSubmit: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.upsertAdjustment(
        toAdjustmentInput(form, editingId, originalId === '' ? null : originalId),
      );
      if (thenSubmit) {
        await api.submitAdjustment(saved.id);
        setNotice({ kind: 'success', text: 'Dodatni zahtev je poslat finansijama.' });
        setFormOpen(false);
      } else {
        setEditingId(saved.id);
        setNotice({ kind: 'success', text: 'Sačuvano kao radna verzija.' });
      }
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

  async function submitExisting(a: Adjustment) {
    setBusy(true);
    setNotice(null);
    try {
      await api.submitAdjustment(a.id);
      setNotice({ kind: 'success', text: 'Dodatni zahtev je poslat finansijama.' });
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

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!items) return <Spinner label="Čitanje dodatnih zahteva…" />;

  const totals = netEffect(items.filter((a) => a.status !== 'REJECTED'));

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Moji dodatni zahtevi</h1>
          <p className="muted">
            Doplata i umanjenje za već odobrene periode. Iznos se ne unosi — sistem ga
            računa po pravilu koje je važilo na datum rada.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={startNew}>
          Novi dodatni zahtev
        </button>
      </div>

      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      {/* ================================================= Novi / izmena ==== */}
      {formOpen && (
        <section className="control-section">
          <h2>{editingId ? 'Izmena dodatnog zahteva' : 'Novi dodatni zahtev'}</h2>

          <div className="form-grid">
            <label>
              <span>Zaposleni</span>
              <select
                value={form.employee_id}
                onChange={(e) => update({ employee_id: e.target.value })}
              >
                <option value="">—</option>
                {(reference?.employees ?? []).map((e) => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Datum na koji se zahtev odnosi</span>
              <input
                type="date"
                value={form.related_work_date}
                onChange={(e) => update({ related_work_date: e.target.value })}
              />
            </label>

            <label>
              <span>Vrsta</span>
              <select
                value={form.direction}
                onChange={(e) =>
                  update({ direction: e.target.value as AdjustmentFormValues['direction'] })
                }
              >
                <option value="DEBIT">{DIRECTION_LABEL.DEBIT}</option>
                <option value="CREDIT">{DIRECTION_LABEL.CREDIT}</option>
              </select>
            </label>

            <label>
              <span>Vrsta isplate</span>
              <select
                value={form.payment_type_id}
                onChange={(e) => update({ payment_type_id: e.target.value })}
              >
                <option value="">—</option>
                {componentTypes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Količina</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.units}
                onChange={(e) => update({ units: e.target.value })}
              />
            </label>

            <label>
              <span>Originalna prijava (opciono)</span>
              <select value={originalId} onChange={(e) => setOriginalId(e.target.value)}>
                <option value="">—</option>
                {submissions
                  .filter((sm) => sm.status === 'FINANCE_APPROVED' || sm.status === 'CLOSED')
                  .map((sm) => (
                    <option key={sm.id} value={sm.id}>
                      {sm.center_code} · {sm.period_start} – {sm.period_end}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <label className="full-width">
            <span>Obrazloženje</span>
            <textarea
              rows={3}
              value={form.reason}
              placeholder="Zašto je korekcija potrebna (najmanje 10 znakova)"
              onChange={(e) => update({ reason: e.target.value })}
            />
          </label>

          {/* Izračunat predlog — samo za čitanje, po definiciji */}
          <div className={preview?.status === 'RESOLVED' ? 'totals totals-complete' : 'totals totals-partial'}>
            {preview?.status === 'RESOLVED' ? (
              <>
                <span className="totals-label">
                  {preview.direction_label} · {formatRsd(preview.rate)} × {preview.units}
                </span>
                <span className="totals-value">
                  {signedAmountLabel(preview.amount_signed)} RSD
                </span>
                <span className="muted small">
                  Pravilo važeće na {preview.related_work_date}. Iznos nije izmenljiv.
                </span>
              </>
            ) : (
              <>
                <span className="totals-label">Iznos</span>
                <span className="totals-value">—</span>
                <span className="muted small">
                  {preview
                    ? 'Za taj datum i vrstu isplate nema upotrebljivog pravila, pa zahtev ne može da se pošalje.'
                    : 'Popunite polja da biste videli izračunat iznos.'}
                </span>
              </>
            )}
          </div>

          {formErrors.length > 0 && (
            <Banner kind="warning">
              <ul>
                {formErrors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </Banner>
          )}

          <div className="filter-row">
            <button
              type="button"
              className="btn"
              disabled={busy || formErrors.length > 0}
              onClick={() => void save(false)}
            >
              Sačuvaj radnu verziju
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || formErrors.length > 0 || preview?.status !== 'RESOLVED'}
              onClick={() => void save(true)}
            >
              Pošalji finansijama
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setFormOpen(false)}>
              Odustani
            </button>
          </div>
        </section>
      )}

      {/* ========================================================= Lista ==== */}
      {items.length === 0 ? (
        <EmptyState
          title="Nema dodatnih zahteva"
          hint="Dodatni zahtev se koristi kada je period već odobren i više se ne može menjati."
        />
      ) : (
        <>
          <div className="metrics">
            <div className="metric">
              <span className="metric-label">Doplata</span>
              <span className="metric-value">{formatRsd(totals.doplata)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Umanjenje</span>
              <span className="metric-value">{formatRsd(totals.umanjenje)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Neto</span>
              <span className="metric-value">{signedAmountLabel(totals.net)}</span>
            </div>
          </div>

          <table className="list">
            <thead>
              <tr>
                <th>Zaposleni</th>
                <th>Datum rada</th>
                <th>Vrsta</th>
                <th>Stavka</th>
                <th className="num">Količina</th>
                <th className="num">Iznos</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const st = submitState(a);
                return (
                  <tr key={a.id} className={a.errors.length > 0 ? 'row-error' : ''}>
                    <td>{a.employee_name}</td>
                    <td>{a.related_work_date}</td>
                    <td>{a.direction_label}</td>
                    <td>{a.payment_type_code}</td>
                    <td className="num">{a.units}</td>
                    <td className="num">
                      {signedAmountLabel(a.calculation.amount_signed)}
                    </td>
                    <td>
                      {STATUS_LABEL[a.status]}
                      {a.finance_comment && (
                        <div className="muted small">Finansije: {a.finance_comment}</div>
                      )}
                      {st.reasons.map((r) => (
                        <div key={r} className="muted small">{r}</div>
                      ))}
                    </td>
                    <td>
                      {a.editable && (
                        <>
                          <button type="button" className="btn btn-quiet" onClick={() => startEdit(a)}>
                            Izmeni
                          </button>{' '}
                          <button
                            type="button"
                            className="btn btn-quiet"
                            disabled={busy || !st.canSubmit}
                            onClick={() => void submitExisting(a)}
                          >
                            Pošalji finansijama
                          </button>
                        </>
                      )}
                      {a.approval && (
                        <span className="muted small">
                          Odobreno {new Date(a.approval.approved_at).toLocaleDateString('sr-Latn-RS')}
                          {' '}· ekonomski datum {a.approval.economic_date}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
