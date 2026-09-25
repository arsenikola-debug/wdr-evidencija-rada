import type { SubmissionStatus } from '../lib/api/types';
import type { SaveState } from '../features/grid/cellState';
import { KEY_HELP } from '../features/grid/keyboard';

const STATUS_TEXT: Record<SubmissionStatus, string> = {
  DRAFT: 'Radna verzija',
  READY_FOR_REVIEW: 'Za pregled',
  SUBMITTED: 'Poslato finansijama',
  RETURNED: 'Vraćeno na ispravku',
  FINANCE_APPROVED: 'Odobreno',
  CLOSED: 'Zatvoreno',
};

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_TEXT[status]}</span>
  );
}

export function Banner({
  kind,
  children,
  onClose,
}: {
  kind: 'info' | 'warning' | 'error' | 'success';
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {onClose && (
        <button type="button" className="banner-close" onClick={onClose} aria-label="Zatvori">
          ×
        </button>
      )}
    </div>
  );
}

const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  dirty: 'nije sačuvano',
  saving: 'čuva se',
  saved: 'sačuvano',
  error: 'greška',
};

export function SaveDot({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  return <span className={`dot dot-${state}`} title={SAVE_TEXT[state]} aria-hidden />;
}

export function SaveIndicator({
  dirty,
  saving,
  errors,
  queued,
}: {
  dirty: number;
  saving: number;
  errors: number;
  queued: number;
}) {
  if (errors > 0) {
    return <span className="save-ind save-ind-error">{errors} ćelija sa greškom</span>;
  }
  if (saving > 0 || queued > 0) {
    return <span className="save-ind save-ind-saving">Čuvanje…</span>;
  }
  if (dirty > 0) {
    return <span className="save-ind save-ind-dirty">{dirty} nesačuvano</span>;
  }
  return <span className="save-ind save-ind-ok">Sve je sačuvano</span>;
}

export function CellLegend() {
  return (
    <div className="legend">
      <span><i className="sw sw-work" /> rad</span>
      <span><i className="sw sw-go" /> godišnji</span>
      <span><i className="sw sw-bo" /> bolovanje</span>
      <span><i className="sw sw-off" /> slobodan dan</span>
      <span><i className="sw sw-nw" /> ne radi</span>
      <span><i className="sw sw-empty" /> nije pregledano</span>
      <span><i className="sw sw-foreign" /> drugi centar (samo za čitanje)</span>
      <span><i className="sw sw-err" /> greška</span>
    </div>
  );
}

export function KeyboardHelp() {
  return (
    <details className="kbd-help">
      <summary>Tastatura</summary>
      <table>
        <tbody>
          {KEY_HELP.map((h) => (
            <tr key={h.keys}>
              <td><kbd>{h.keys}</kbd></td>
              <td>{h.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-ring" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
    </div>
  );
}
