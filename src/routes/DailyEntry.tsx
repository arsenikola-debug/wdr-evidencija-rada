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
import { EntryBar } from '../components/EntryBar';
import {
  employeeTotals,
  fromPreviewLines,
  type EmployeeTotal,
} from '../features/finance/employeeSummary';

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

  // --- K1: centar + period otvaraju (ili kreiraju) JEDNU prijavu -------------
  const writableCenters = useMemo(
    () => (session?.centers ?? []).filter((c) => c.can_write),
    [session],
  );
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [copyInfo, setCopyInfo] = useState<string | null>(null);

  const current: SubmissionListItem | null = useMemo(() => {
    const fromList = submissions?.find((x) => x.id === submissionId) ?? null;
    if (fromList) return fromList;
    const p = grid.payload?.submission;
    return p ? {
      id: p.id, center_id: p.center_id, center_code: p.center_code, period_id: p.period_id,
      period_label: `${p.period_start} – ${p.period_end}`, period_start: p.period_start, period_end: p.period_end,
      status: p.status,
    } : null;
  }, [submissions, submissionId, grid.payload]);

  async function openPeriod(centerId: string, from: string, to: string) {
    setOpening(true);
    setOpenError(null);
    setCopyInfo(null);
    try {
      const res = await api.createPeriodSubmission(centerId, from, to);
      const item: SubmissionListItem = {
        id: res.submission_id, center_id: res.center_id, center_code: res.center_code,
        period_id: res.period_id, period_label: res.period_label,
        period_start: res.period_start, period_end: res.period_end, status: res.status,
      };
      setSubmissions((list) => (list?.some((x) => x.id === item.id) ? list : [item, ...(list ?? [])]));
      setParams({ prijava: res.submission_id });
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setOpenError(messageForCode(code, err instanceof Error ? err.message : undefined));
    } finally {
      setOpening(false);
    }
  }

  /*
   * K12: „Kopiraj prethodnu nedelju" u osnovnom Unosu NE kopira sate, statuse,
   * „ne radi", iznose ni komponente. Spisak zaposlenih ovde dolazi iz raspodele
   * po datumu (izvor istine), pa funkcija samo upoređuje spisak sa prethodnom
   * nedeljom i jasno kaže ko više nije raspoređen — nikoga ne uklanja.
   */
  async function comparePreviousWeek() {
    if (!current || !submissions) return;
    const prev = submissions
      .filter((x) => x.center_id === current.center_id && x.period_end < current.period_start)
      .sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
    if (!prev) {
      setCopyInfo('Nema prethodne prijave za ovaj centar.');
      return;
    }
    try {
      const [prevGrid, curGrid] = await Promise.all([api.getGrid(prev.id), api.getGrid(current.id)]);
      const now = new Set(curGrid.employees.map((e) => e.employee_id));
      const kept = prevGrid.employees.filter((e) => now.has(e.employee_id));
      const gone = prevGrid.employees.filter((e) => !now.has(e.employee_id));
      const added = curGrid.employees.filter((e) => !prevGrid.employees.some((p) => p.employee_id === e.employee_id));
      setCopyInfo(
        `Prethodna nedelja (${prev.period_label}): ${prevGrid.employees.length} zaposlenih. `
        + `Na listi i sada: ${kept.length}. `
        + (gone.length > 0
          ? `Više nisu raspoređeni ovde (unos nije moguć): ${gone.map((e) => e.full_name).join(', ')}. `
          : '')
        + (added.length > 0 ? `Novi ove nedelje: ${added.map((e) => e.full_name).join(', ')}. ` : '')
        + 'Sati, statusi i iznosi se ne kopiraju.',
      );
    } catch (err) {
      setCopyInfo(messageForCode(null, err instanceof Error ? err.message : undefined));
    }
  }

  const entryBar = writableCenters.length > 0 ? (
    <EntryBar
      centers={writableCenters}
      current={current}
      baseType={grid.baseType}
      counts={grid.sectionCounts}
      busy={opening}
      error={openError}
      onOpen={(c, f, t) => void openPeriod(c, f, t)}
      onBaseType={grid.setBaseType}
      onCopyPreviousWeek={() => void comparePreviousWeek()}
    />
  ) : null;

  /*
   * Ukupan iznos po zaposlenom za period (redizajn §6). Iznos računa SERVER
   * (pregled pre slanja); ovde se samo sabiraju njegove linije po zaposlenom.
   * Osvežava se sa zakašnjenjem posle izmena, da unos ne čeka na obračun.
   */
  const [totals, setTotals] = useState<Map<string, EmployeeTotal> | null>(null);
  const cellsVersion = grid.payload?.cells;
  useEffect(() => {
    if (!submissionId || !grid.payload) return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .getSubmissionPreview(submissionId)
        .then((p) => {
          if (alive) setTotals(employeeTotals(fromPreviewLines(p.lines)));
        })
        .catch(() => {
          if (alive) setTotals(new Map());
        });
    }, 700);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // grid.payload se namerno ne navodi celo: bitne su promene ćelija.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, submissionId, cellsVersion]);
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
  if (!submissionId) {
    return (
      <div className="entry-page">
        {entryBar}
        <EmptyState
          title="Izaberite centar i period"
          hint={writableCenters.length > 0
            ? 'Prijava za izabrani centar i period se otvara automatski (najviše 7 dana).'
            : 'Nemate pravo unosa ni za jedan centar.'}
        />
      </div>
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
      {entryBar}
      {copyInfo && <Banner kind="info">{copyInfo}</Banner>}
      {grid.payload.employees.length === 0 && grid.eligibility.available && (
        <Banner kind="info">
          U ovoj sekciji nema zaposlenih za izabrani period. Proverite drugu sekciju
          (Karnet / Obuka).
        </Banner>
      )}
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
        eligibility={grid.eligibility}
        editable={grid.editable}
        notWorkingState={grid.notWorkingState}
        onToggleNotWorking={(employeeId) =>
          grid.toggleNotWorkingWholePeriod(employeeId, (days) =>
            window.confirm(
              `${days} dan(a) već ima unet drugi status. Da li ih označiti kao „Ne radi“?`,
            ),
          )
        }
        totals={totals}
        baseType={grid.baseType}
      />

      <div className="entry-footer">
        <CellLegend />
        <KeyboardHelp />
        <p className="muted small">
          Prazna ćelija znači „nije pregledano" — nema zapisa u bazi i nema troška.
          Vikend i neradni dani se ne moraju popunjavati. Prugasta ćelija (×) je
          zaključana: zaposleni tog dana nije u radnom odnosu ili nije raspoređen
          u ovaj centar. „Ukupno" je iznos naknada bez prevoza, prema serverskom
          obračunu.
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
