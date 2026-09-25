import type { AttendanceStatusCode, GridPayload, SubmissionListItem } from '../lib/api/types';
import type { CompletionSummary, ExpectedDaysMode } from '../features/grid/completion';
import { EXPECTED_MODE_LABEL } from '../features/grid/completion';
import { selectionSize, type Selection } from '../features/grid/selection';
import { SaveIndicator, StatusBadge } from './Bits';

export function GridToolbar({
  payload,
  submissions,
  selectedSubmissionId,
  onSelectSubmission,
  selection,
  editable,
  completion,
  expectedMode,
  onExpectedMode,
  saveSummary,
  autosave,
  onApplyStatus,
  onApplyShift,
  onClear,
  onCopyDay,
  onCopyWeek,
  onOpenPreview,
  onAssistance,
  onOvertime,
}: {
  payload: GridPayload;
  submissions: SubmissionListItem[];
  selectedSubmissionId: string;
  onSelectSubmission(id: string): void;
  selection: Selection;
  editable: boolean;
  completion: CompletionSummary | null;
  expectedMode: ExpectedDaysMode;
  onExpectedMode(m: ExpectedDaysMode): void;
  saveSummary: { dirty: number; saving: number; errors: number };
  autosave: { queued: number; saving: boolean };
  onApplyStatus(s: AttendanceStatusCode): void;
  onApplyShift(index: number): void;
  onClear(): void;
  onCopyDay(): void;
  onCopyWeek(): void;
  onOpenPreview(): void;
  onAssistance(): void;
  onOvertime?(): void;
}) {
  const centers = Array.from(
    new Map(submissions.map((s) => [s.center_id, { id: s.center_id, code: s.center_code }])).values(),
  );
  const current = submissions.find((s) => s.id === selectedSubmissionId);
  const centerSubmissions = submissions.filter((s) => s.center_id === current?.center_id);
  const n = selectionSize(selection);

  return (
    <div className="toolbar">
      {/* --- kontekst: šta se uređuje ------------------------------------- */}
      <div className="tb-row tb-row-main">
        <label className="tb-field">
          <span>Centar</span>
          <select
            value={current?.center_id ?? ''}
            onChange={(e) => {
              const first = submissions.find((s) => s.center_id === e.target.value);
              if (first) onSelectSubmission(first.id);
            }}
          >
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>

        <label className="tb-field">
          <span>Period</span>
          <select value={selectedSubmissionId} onChange={(e) => onSelectSubmission(e.target.value)}>
            {centerSubmissions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.period_label}
              </option>
            ))}
          </select>
        </label>

        <StatusBadge status={payload.submission.status} />

        {!editable && (
          <span className="tb-locked" title="Unos je moguć samo u statusu Radna verzija ili Vraćeno">
            Zaključano za unos
          </span>
        )}

        <span className="tb-spacer" />

        <SaveIndicator
          dirty={saveSummary.dirty}
          saving={saveSummary.saving}
          errors={saveSummary.errors}
          queued={autosave.queued}
        />

        <button type="button" className="btn btn-primary" onClick={onOpenPreview}>
          Pregled pre slanja
        </button>
      </div>

      {/* --- akcije nad izborom ------------------------------------------- */}
      <div className="tb-row tb-row-actions">
        <div className="tb-group" role="group" aria-label="Šabloni smena">
          <span className="tb-group-label">Smene</span>
          <div className="tb-buttons">
            {payload.reference.shift_templates.slice(0, 9).map((t, i) => (
              <button
                key={t.id}
                type="button"
                className="btn btn-shift"
                disabled={!editable}
                onClick={() => onApplyShift(i)}
                title={`${t.label} — taster ${i + 1}`}
              >
                <span className="btn-key">{i + 1}</span>
                {t.code}
              </button>
            ))}
          </div>
        </div>

        <span className="tb-divider" aria-hidden />

        <div className="tb-group" role="group" aria-label="Statusi">
          <span className="tb-group-label">Statusi</span>
          <div className="tb-buttons">
            <button type="button" className="btn" disabled={!editable} onClick={() => onApplyStatus('GO')} title="Taster G">
              GO
            </button>
            <button type="button" className="btn" disabled={!editable} onClick={() => onApplyStatus('BO')} title="Taster B">
              BO
            </button>
            <button type="button" className="btn" disabled={!editable} onClick={() => onApplyStatus('OFF')} title="Taster S">
              Slobodan
            </button>
            <button
              type="button"
              className="btn"
              disabled={!editable}
              onClick={() => onApplyStatus('NOT_WORKING')}
              title="Taster N"
            >
              Ne radi
            </button>
          </div>
        </div>

        <span className="tb-divider" aria-hidden />

        <div className="tb-group" role="group" aria-label="Dodatne akcije">
          <span className="tb-group-label">Dodatno</span>
          <div className="tb-buttons">
            <button type="button" className="btn" disabled={!editable} onClick={onCopyDay} title="Ctrl + D">
              Kopiraj prethodni dan
            </button>
            <button type="button" className="btn" disabled={!editable} onClick={onCopyWeek} title="Ctrl + Shift + D">
              Kopiraj prethodnu nedelju
            </button>
            <button type="button" className="btn" disabled={!editable} onClick={onAssistance}>
              Ispomoć…
            </button>
            <button
              type="button"
              className="btn"
              disabled={!editable || !onOvertime}
              onClick={onOvertime}
            >
              Prekovremeni…
            </button>
          </div>
        </div>

        <span className="tb-spacer" />

        <div className="tb-group">
          <span className="tb-group-label">
            Izabrano <strong>{n}</strong>
          </span>
          <div className="tb-buttons">
            <button type="button" className="btn btn-danger" disabled={!editable} onClick={onClear} title="Delete">
              Obriši izabrano
            </button>
          </div>
        </div>
      </div>

      {/* --- kontekst kompletnosti i validacije ---------------------------- */}
      <div className="tb-row tb-row-meta">
        {completion && (
          <span className="tb-completion" title="Pomoć operateru — ne uslovljava slanje">
            Pregledano: <strong>{completion.reviewed}</strong>/{completion.expected} (
            {completion.percent}%)
            <span className="progress" aria-hidden>
              <span className="progress-fill" style={{ width: `${completion.percent}%` }} />
            </span>
          </span>
        )}

        <label className="tb-field tb-field-inline">
          <span>Očekivani radni dani</span>
          <select
            value={expectedMode}
            disabled={!editable}
            onChange={(e) => onExpectedMode(e.target.value as ExpectedDaysMode)}
          >
            {(Object.keys(EXPECTED_MODE_LABEL) as ExpectedDaysMode[]).map((m) => (
              <option key={m} value={m}>
                {EXPECTED_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        <span className="tb-spacer" />

        <span className={payload.validation.errors > 0 ? 'tb-val tb-val-err' : 'tb-val'}>
          {payload.validation.errors > 0
            ? `${payload.validation.errors} blokirajućih grešaka`
            : 'Bez blokirajućih grešaka'}
          {payload.validation.warnings > 0 && ` · ${payload.validation.warnings} upozorenja`}
        </span>
      </div>
    </div>
  );
}
