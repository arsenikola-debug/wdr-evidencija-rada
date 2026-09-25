import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, CellLegend, EmptyState, KeyboardHelp, Spinner } from '../components/Bits';
import { GridTable } from '../components/GridTable';
import { GridToolbar } from '../components/GridToolbar';
import { messageForCode } from '../features/grid/errors';
import { mapKey } from '../features/grid/keyboard';
import { useGrid } from '../features/grid/useGrid';
import { WdrApiError } from '../lib/api';
import type { SubmissionListItem } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';
import { AssistanceDialog } from '../components/AssistanceDialog';
import { OvertimeDialog } from '../components/OvertimeDialog';

export function DailyEntry() {
  const { api, session } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [submissions, setSubmissions] = useState<SubmissionListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [overtimeOpen, setOvertimeOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listSubmissions()
      .then((r) => {
        if (!alive) return;
        setSubmissions(r);
        if (!params.get('prijava') && r.length > 0) {
          setParams({ prijava: r[0].id }, { replace: true });
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setListError(messageForCode(null, e instanceof Error ? e.message : undefined));
        }
      });
    return () => {
      alive = false;
    };
    // params/setParams intentionally excluded: only the first load picks a default
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const submissionId = params.get('prijava');
  const grid = useGrid(api, submissionId);
  const rows = grid.payload?.employees.length ?? 0;
  const cols = grid.payload?.dates.length ?? 0;

  /*
   * Ispomoć se može uneti samo za centar u kome korisnik sme da radi. Baza to
   * svakako proverava (rpc_add_assistance_segment); ovde se samo ne nudi opcija
   * koja bi garantovano bila odbijena. Centar same prijave ostaje u spisku.
   */
  const assistanceCenters = useMemo(() => {
    const all = grid.payload?.reference.centers ?? [];
    const own = grid.payload?.submission.center_id;
    const allowed = new Set((session?.centers ?? []).filter((c) => c.can_write).map((c) => c.center_id));
    const filtered = all.filter((c) => allowed.has(c.id) || c.id === own);
    // Ako sesija nema nijedan poklopljen centar, ne gasimo dijalog — vraćamo
    // bar centar prijave, a odluku prepuštamo serveru.
    return filtered.length > 0 ? filtered : all.filter((c) => c.id === own);
  }, [grid.payload, session]);

  const focusedEmployee = useMemo(
    () => grid.payload?.employees[grid.selection.focus.r] ?? null,
    [grid.payload, grid.selection.focus.r],
  );
  const focusedDate = useMemo(
    () => grid.payload?.dates[grid.selection.focus.c] ?? null,
    [grid.payload, grid.selection.focus.c],
  );

  const focusedCell = useMemo(
    () =>
      grid.payload?.cells.find(
        (c) =>
          c.employee_id === focusedEmployee?.employee_id &&
          c.work_date === focusedDate,
      ) ?? null,
    [grid.payload, focusedEmployee, focusedDate],
  );

  const focusedOvertimeUnits =
    focusedCell?.components.find(
      (c) =>
        c.payment_type_code === 'PREKOVREMENI' &&
        c.work_segment_id == null &&
        c.in_this_submission,
    )?.units ?? 0;

  function onKeyDown(e: React.KeyboardEvent) {
    if (rows === 0 || cols === 0) return;
    const action = mapKey(e);
    if (!action) return;
    e.preventDefault();

    switch (action.type) {
      case 'move':
        grid.move(action.dr, action.dc, action.extend);
        break;
      case 'tab':
        grid.tab(action.back);
        break;
      case 'status':
        grid.applyStatusToSelection(action.code);
        break;
      case 'shiftIndex':
        grid.applyShiftIndexToSelection(action.index);
        break;
      case 'clear':
        grid.clearSelection();
        break;
      case 'copyPrevDay':
        grid.copyPreviousDay();
        break;
      case 'copyPrevWeek':
        grid.copyPreviousWeek();
        break;
      case 'selectAll':
        grid.selectEverything();
        break;
      case 'selectRow':
        grid.selectCurrentRow();
        break;
      case 'selectColumn':
        grid.selectCurrentColumn();
        break;
      case 'escape':
        grid.collapseSelection();
        break;
      case 'flush':
        void grid.flush();
        break;
      case 'openCell':
        setAssistOpen(true);
        break;
      default:
        break;
    }
  }

  if (listError) return <Banner kind="error">{listError}</Banner>;
  if (!submissions) return <Spinner label="Učitavanje perioda…" />;
  if (submissions.length === 0) {
    return (
      <EmptyState
        title="Nema otvorenog perioda"
        hint="Administrator još nije otvorio period za vaš centar."
      />
    );
  }

  // No page-wide spinner after the first load: the grid stays on screen and only
  // the save indicator moves.
  if (grid.loading && !grid.payload) return <Spinner label="Učitavanje evidencije…" />;
  if (grid.loadError) {
    return (
      <div className="page">
        <Banner kind="error">{grid.loadError}</Banner>
        <button type="button" className="btn" onClick={() => void grid.reload()}>
          Pokušaj ponovo
        </button>
      </div>
    );
  }
  if (!grid.payload) return <EmptyState title="Prijava nije dostupna" />;

  return (
    <div className="entry-page">
      <GridToolbar
        payload={grid.payload}
        submissions={submissions}
        selectedSubmissionId={grid.payload.submission.id}
        onSelectSubmission={(id) => setParams({ prijava: id })}
        selection={grid.selection}
        editable={grid.editable}
        completion={grid.completion}
        expectedMode={grid.expectedMode}
        onExpectedMode={(mode) => {
          grid.setExpectedMode(mode);
          window.localStorage.setItem(
            `wdr:expected-mode:${grid.payload!.submission.id}`,
            mode,
          );
        }}
        saveSummary={grid.saveSummary}
        autosave={grid.autosave}
        onApplyStatus={(s) => grid.applyStatusToSelection(s)}
        onApplyShift={(i) => grid.applyShiftIndexToSelection(i)}
        onClear={grid.clearSelection}
        onCopyDay={grid.copyPreviousDay}
        onCopyWeek={grid.copyPreviousWeek}
        onAssistance={() => setAssistOpen(true)}
        onOvertime={() => setOvertimeOpen(true)}
        onOpenPreview={() => {
          void grid.flush().then(() =>
            navigate(`/unos/pregled?prijava=${grid.payload!.submission.id}`),
          );
        }}
      />

      {grid.notice && (
        <Banner kind="warning" onClose={grid.dismissNotice}>
          {grid.notice}
        </Banner>
      )}

      {grid.payload.submission.status === 'RETURNED' && (
        <Banner kind="warning">
          Prijava je vraćena na ispravku. Pogledajte komentar finansija, ispravite i
          pošaljite ponovo.
        </Banner>
      )}

      {grid.saveSummary.errors > 0 && (
        <Banner kind="error">
          Neke ćelije nisu sačuvane. Označene su crvenom bojom — pređite mišem preko
          ćelije da vidite razlog.
        </Banner>
      )}

      <GridTable
        payload={grid.payload}
        index={grid.index}
        selection={grid.selection}
        saveMap={grid.saveMap}
        expectedMode={grid.expectedMode}
        onSelect={grid.setSelection}
        onKeyDown={onKeyDown}
      />

      <div className="entry-footer">
        <CellLegend />
        <KeyboardHelp />
        <p className="muted small">
          Prazna ćelija znači „nije pregledano" — nema zapisa u bazi i nema troška.
          Vikend i neradni dani se ne moraju popunjavati.
        </p>
      </div>

      {assistOpen && focusedEmployee && focusedDate && (
        <AssistanceDialog
          employee={focusedEmployee}
          date={focusedDate}
          centers={assistanceCenters}
          shiftTemplates={grid.payload.reference.shift_templates}
          ownCenterId={grid.payload.submission.center_id}
          onClose={() => setAssistOpen(false)}
          onSubmit={async (input) => {
            try {
              const res = await api.addAssistanceSegment(input);
              await grid.reload();
              setAssistOpen(false);
              return {
                ok: true as const,
                message: res.created_work_segment
                  ? `Ispomoć sačuvana: ${res.work_center_code} ${res.shift_start.slice(0, 5)}–${res.shift_end.slice(0, 5)}, trošak nosi ${res.cost_center_code}.`
                  : 'Ista ispomoć je već bila uneta — ništa nije promenjeno.',
              };
            } catch (err) {
              const code = err instanceof WdrApiError ? err.code : null;
              return {
                ok: false as const,
                message: messageForCode(code, err instanceof Error ? err.message : undefined),
              };
            }
          }}
        />
      )}

      {overtimeOpen && focusedEmployee && focusedDate && (
        <OvertimeDialog
          employee={focusedEmployee}
          date={focusedDate}
          initialUnits={focusedOvertimeUnits}
          onClose={() => setOvertimeOpen(false)}
          onSubmit={async (units) => {
            try {
              await grid.flush();

              await api.setOvertimeComponent({
                p_submission_id: grid.payload!.submission.id,
                p_employee_id: focusedEmployee.employee_id,
                p_work_date: focusedDate,
                p_units: units,
              });

              await grid.reload();
              setOvertimeOpen(false);

              return {
                ok: true as const,
                message:
                  units > 0
                    ? `Prekovremeni sati sačuvani: ${units}.`
                    : 'Prekovremeni sati su uklonjeni.',
              };
            } catch (err) {
              const code = err instanceof WdrApiError ? err.code : null;

              return {
                ok: false as const,
                message: messageForCode(
                  code,
                  err instanceof Error ? err.message : undefined,
                ),
              };
            }
          }}
        />
      )}
    </div>
  );
}
