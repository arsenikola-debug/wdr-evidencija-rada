import { useCallback, useState } from 'react';
import { Banner, EmptyState } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { correctionPreview, directionLabel, parseDeltaInput } from
  '../features/courierStops/corrections';
import { WdrApiError } from '../lib/api';
import { useAuth } from '../lib/auth/AuthProvider';

interface CorrectionDetail {
  correction: {
    id: string; delta_stop_count: number; original_stop_count: number;
    original_rate_used: number; calculated_amount: number; reason: string;
    status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'FINANCE_APPROVED';
    return_reason: string | null; related_work_date: string;
  };
  direction_label: string;
  original: {
    snapshot_line_id: number; employee_name: string; center_code: string;
    work_date: string; stop_count: number; rate_used: number;
    calculated_amount: number | null;
  };
  already_approved_delta: number;
  effective_stops_now: number;
  effective_stops_after: number;
}

interface ApprovedLine {
  snapshot_line_id?: number;
  employee_name: string; center_code: string; work_date: string;
  stop_count: number; rate_used: number | null; calculated_amount: number | null;
}

/**
 * Korekcija KOLIČINE stopova posle odobrenja.
 *
 * Original se NIKADA ne prepisuje — prikazuje se odvojeno, pored korekcije.
 * Operater unosi samo promenu količine i obrazloženje; iznos je delta ×
 * ZAMRZNUTA originalna cena i računa ga server.
 */
export function CourierStopCorrections({ lines }: { lines?: ApprovedLine[] }) {
  const { api, can } = useAuth();
  const [lineId, setLineId] = useState<number | null>(null);
  const [deltaText, setDeltaText] = useState('');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState<CorrectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  const reload = useCallback(async (id: string) => {
    try {
      setDetail(await api.courierStopCorrectionDetail(id) as CorrectionDetail);
    } catch (err) {
      fail(err);
    }
  }, [api, fail]);

  const selected = (lines ?? []).find((l) => l.snapshot_line_id === lineId) ?? null;
  const parsed = parseDeltaInput(deltaText);
  const preview = selected && parsed.kind === 'value'
    ? correctionPreview(selected.stop_count, parsed.value, selected.rate_used ?? 0)
    : null;

  async function create() {
    if (!lineId || parsed.kind !== 'value') return;
    setBusy(true);
    setError(null);
    try {
      const rec = await api.courierStopCorrectionSet(
        null, lineId, parsed.value, reason) as { id: string };
      setNotice('Korekcija je kreirana kao nacrt.');
      await reload(rec.id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!detail) return;
    setBusy(true);
    try {
      await api.courierStopCorrectionSubmit(detail.correction.id);
      setNotice('Korekcija je poslata Finansijama.');
      await reload(detail.correction.id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Korekcija stopova</h1>
          <p className="muted">Zasebna transakcija nad već odobrenim obračunom.</p>
        </div>
      </div>

      <p className="muted small">
        Odobreni obračun se ne menja. Korekcija je zasebna transakcija koja
        koristi ORIGINALNU cenu iz odobrenog obračuna — tekući cenovnik se ne
        dodiruje. Pogrešna cena je drugi slučaj i ovde se ne rešava.
      </p>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="success">{notice}</Banner>}
      {parsed.kind === 'error' && <Banner kind="error">{parsed.message}</Banner>}

      {(lines ?? []).length === 0 ? (
        <EmptyState title="Nema odobrenih stopova za korekciju."
          hint="Korekcija se pravi samo nad već odobrenim obračunom." />
      ) : (
        <div className="filter-row">
          <label><span>Odobrena stavka</span>
            <select value={lineId ?? ''}
              onChange={(e) => setLineId(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">—</option>
              {(lines ?? []).map((l) => (
                <option key={l.snapshot_line_id} value={l.snapshot_line_id}>
                  {l.employee_name} · {l.work_date} · {l.stop_count} stopova
                </option>
              ))}
            </select></label>
          <label><span>+/- broj stopova</span>
            <input value={deltaText} inputMode="numeric"
              onChange={(e) => setDeltaText(e.target.value)} placeholder="npr. 10 ili -10" /></label>
          <label><span>Razlog</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="obavezno" /></label>
        </div>
      )}

      {selected && (
        <>
          <h3>Original (ne menja se)</h3>
          <table className="list list-compact">
            <tbody>
              <tr><th>Kurir</th><td>{selected.employee_name}</td></tr>
              <tr><th>Datum rada</th><td>{selected.work_date}</td></tr>
              <tr><th>Centar</th><td>{selected.center_code}</td></tr>
              <tr><th>Odobreno stopova</th><td>{selected.stop_count}</td></tr>
              <tr><th>Odobrena cena po stopu</th>
                <td>{selected.rate_used === null ? '—' : formatRsd(selected.rate_used)}</td></tr>
              <tr><th>Odobren iznos</th>
                <td>{selected.calculated_amount === null
                  ? '—' : formatRsd(selected.calculated_amount)}</td></tr>
            </tbody>
          </table>
        </>
      )}

      {preview && (
        <>
          <h3>Korekcija</h3>
          <table className="list list-compact">
            <tbody>
              <tr><th>Vrsta</th><td>{directionLabel(preview.delta)}</td></tr>
              <tr><th>Promena količine</th>
                <td>{preview.delta > 0 ? `+${preview.delta}` : preview.delta}</td></tr>
              <tr><th>Nova efektivna količina</th><td>{preview.effectiveStops}</td></tr>
              <tr><th>Korekcija iznosa</th><td>{formatRsd(preview.amount)}</td></tr>
            </tbody>
          </table>
          <p className="muted small">
            Iznos je informativan prikaz; konačan iznos računa server iz zamrznute
            originalne cene.
          </p>
          <button type="button" className="btn btn-primary"
            disabled={busy || !can('courier_stops.edit') || reason.trim().length < 5}
            onClick={() => void create()}>Kreiraj korekciju</button>
        </>
      )}

      {detail && (
        <>
          <h3>Nacrt korekcije</h3>
          {detail.correction.status === 'RETURNED' && detail.correction.return_reason && (
            <Banner kind="warning">
              Finansije su vratile korekciju: {detail.correction.return_reason}
            </Banner>
          )}
          <table className="list list-compact">
            <tbody>
              <tr><th>Vrsta</th><td>{detail.direction_label}</td></tr>
              <tr><th>Original</th>
                <td>{detail.original.stop_count} stopova × {formatRsd(detail.original.rate_used)}</td></tr>
              <tr><th>Već odobrene korekcije</th><td>{detail.already_approved_delta}</td></tr>
              <tr><th>Promena količine</th><td>{detail.correction.delta_stop_count}</td></tr>
              <tr><th>Efektivno posle</th><td>{detail.effective_stops_after}</td></tr>
              <tr><th>Korekcija iznosa</th>
                <td>{formatRsd(detail.correction.calculated_amount)}</td></tr>
              <tr><th>Razlog</th><td>{detail.correction.reason}</td></tr>
            </tbody>
          </table>
          {['DRAFT', 'RETURNED'].includes(detail.correction.status) && (
            <button type="button" className="btn btn-primary"
              disabled={busy || !can('courier_stops.submit')}
              onClick={() => void submit()}>POŠALJI FINANSIJAMA</button>
          )}
        </>
      )}
    </div>
  );
}
