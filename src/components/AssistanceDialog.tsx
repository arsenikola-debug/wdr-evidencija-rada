import { useState } from 'react';
import type {
  AssistanceSegmentInput,
  CenterRef,
  GridEmployee,
  IsoDate,
  ShiftTemplateRef,
  Uuid,
} from '../lib/api/types';
import { Banner } from './Bits';

/**
 * Cross-center assistance goes through api.rpc_add_assistance_segment, which is
 * the only supported path: the operator of the WORK center does not need write
 * access to the employee's home-center submission.
 *
 * The cost-center field is deliberately absent. Overriding it requires the
 * `cost_center.override` permission (SUPER_ADMIN_BA only for MVP), so offering
 * the choice here would produce a guaranteed rejection. Cost defaults to the
 * work center.
 */
export function AssistanceDialog({
  employee,
  date,
  centers,
  shiftTemplates,
  ownCenterId,
  onClose,
  onSubmit,
}: {
  employee: GridEmployee;
  date: IsoDate;
  centers: CenterRef[];
  shiftTemplates: ShiftTemplateRef[];
  ownCenterId: Uuid;
  onClose(): void;
  onSubmit(input: AssistanceSegmentInput): Promise<{ ok: boolean; message: string }>;
}) {
  const [workCenterId, setWorkCenterId] = useState<Uuid>(ownCenterId);
  const [templateId, setTemplateId] = useState<string>('');
  const [start, setStart] = useState('14:00');
  const [end, setEnd] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const useTemplate = templateId !== '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await onSubmit({
      p_employee_id: employee.employee_id,
      p_work_date: date,
      p_work_center_id: workCenterId,
      p_segment_type: 'ASSISTANCE',
      p_shift_template_id: useTemplate ? templateId : null,
      p_shift_start: useTemplate ? null : `${start}:00`,
      p_shift_end: useTemplate ? null : `${end}:00`,
    });
    setResult(res);
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Unos ispomoći">
      <form className="modal" onSubmit={submit}>
        <h2>Unos ispomoći</h2>
        <p className="muted">
          {employee.full_name} · {date} · matični centar {employee.home_center_code}
        </p>

        {result && (
          <Banner kind={result.ok ? 'success' : 'error'}>{result.message}</Banner>
        )}

        <label>
          <span>Centar u kome je radio</span>
          <select value={workCenterId} onChange={(e) => setWorkCenterId(e.target.value)}>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Šablon smene</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— ručno vreme —</option>
            {shiftTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {!useTemplate && (
          <div className="modal-row">
            <label>
              <span>Od</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
            </label>
            <label>
              <span>Do</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </label>
          </div>
        )}

        <p className="muted small">
          Trošak nosi centar u kome je rad izvršen. Osnovna dnevna naknada se i
          dalje obračunava po matičnom centru zaposlenog.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {result?.ok ? 'Zatvori' : 'Otkaži'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Čuvanje…' : 'Sačuvaj ispomoć'}
          </button>
        </div>
      </form>
    </div>
  );
}
