import { useState } from 'react';
import type { GridEmployee, IsoDate } from '../lib/api/types';
import { Banner } from './Bits';

export function OvertimeDialog({
  employee,
  date,
  initialUnits,
  onClose,
  onSubmit,
}: {
  employee: GridEmployee;
  date: IsoDate;
  initialUnits: number;
  onClose(): void;
  onSubmit(units: number): Promise<{ ok: boolean; message: string }>;
}) {
  const [units, setUnits] = useState(String(initialUnits || 0));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const value = Number(units);
    if (!Number.isFinite(value) || value < 0) {
      setResult({ ok: false, message: 'Unesite ispravan broj sati (0 ili više).' });
      return;
    }

    setBusy(true);
    setResult(null);

    const res = await onSubmit(value);
    setResult(res);
    setBusy(false);
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Unos prekovremenih sati"
    >
      <form className="modal" onSubmit={submit}>
        <h2>Prekovremeni rad</h2>

        <p className="muted">
          {employee.full_name} · {date}
        </p>

        {result && (
          <Banner kind={result.ok ? 'success' : 'error'}>{result.message}</Banner>
        )}

        <label>
          <span>Prekovremeni sati</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            required
            autoFocus
          />
        </label>

        <p className="muted small">
          Operater unosi samo stvarni broj prekovremenih sati. Iznos obračunava server.
          Vrednost 0 uklanja prekovremene sate za ovaj dan.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {result?.ok ? 'Zatvori' : 'Otkaži'}
          </button>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Čuvanje…' : 'Sačuvaj sate'}
          </button>
        </div>
      </form>
    </div>
  );
}
