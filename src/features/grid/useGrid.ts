import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AttendanceStatusCode,
  BulkEntryInput,
  BulkUpsertResult,
  EntryEligibility,
  GridPayload,
  Uuid,
} from '../../lib/api/types';
import type { WdrApi } from '../../lib/api/WdrApi';
import {
  applyStatus,
  clearCells,
  copyFromOffset,
  describeSkips,
  planUndoWholePeriodNotWorking,
  planWholePeriodNotWorking,
  wholePeriodNotWorkingState,
  type BulkPlan,
  type WholePeriodState,
} from './bulk';
import {
  applyBaseType,
  buildEligibilityIndex,
  EMPTY_ELIGIBILITY,
  employeesInSection,
  isLocked as isLockedIn,
  sectionCounts,
  type BaseType,
  type EligibilityIndex,
} from './eligibility';
import {
  applyResults,
  decaySaved,
  markDirty,
  markSaving,
  revertInFlight,
  summarize,
  type SaveMap,
} from './cellState';
import {
  computeCompletion,
  defaultExpectedMode,
  type ExpectedDaysMode,
} from './completion';
import { messageForCode } from './errors';
import { buildCellIndex, cellKey, type CellIndex } from './model';
import {
  moveFocus,
  normalize,
  selectAll,
  selectColumn,
  selectRow,
  selectionKeys,
  singleCell,
  tabNext,
  type Selection,
} from './selection';
import { useAutosave } from './useAutosave';

export interface UseGridResult {
  loading: boolean;
  loadError: string | null;
  payload: GridPayload | null;
  index: CellIndex;
  selection: Selection;
  saveMap: SaveMap;
  saveSummary: ReturnType<typeof summarize>;
  autosave: { queued: number; saving: boolean };
  notice: string | null;
  expectedMode: ExpectedDaysMode;
  completion: ReturnType<typeof computeCompletion> | null;
  editable: boolean;
  /** Dozvoljeni dani po zaposlenom (0059) + zaključavanje po sekciji tipa. */
  eligibility: EligibilityIndex;
  /** K1: izabrana sekcija osnovne naknade (Karnet / Obuka) u ISTOJ prijavi. */
  baseType: BaseType;
  setBaseType(t: BaseType): void;
  /** Broj zaposlenih sa bar jednim dostupnim danom po sekciji. */
  sectionCounts: Record<BaseType, number> | null;

  setSelection(sel: Selection): void;
  setExpectedMode(mode: ExpectedDaysMode): void;
  dismissNotice(): void;
  reload(): Promise<void>;
  flush(): Promise<void>;

  move(dr: number, dc: number, extend: boolean): void;
  tab(back: boolean): void;
  selectEverything(): void;
  selectCurrentRow(): void;
  selectCurrentColumn(): void;
  collapseSelection(): void;

  applyStatusToSelection(status: AttendanceStatusCode, shiftTemplateId?: Uuid | null): void;
  applyShiftIndexToSelection(index: number): void;
  clearSelection(): void;
  copyPreviousDay(): void;

  /** „Nije radio ceo period" — stanje opcije za zaposlenog. */
  notWorkingState(employeeId: Uuid): WholePeriodState;
  /**
   * Uključuje/isključuje „Nije radio ceo period". `confirmOverwrite` se pita
   * samo kada bi uključivanje prepisalo dane koji već imaju drugi status.
   */
  toggleNotWorkingWholePeriod(
    employeeId: Uuid,
    confirmOverwrite: (days: number) => boolean,
  ): void;
}

const EMPTY_INDEX: CellIndex = new Map();

/**
 * Usvajanje novog nacrta TEK posle uspešnog prvog čuvanja: ako `create` padne,
 * `adopt` se ne poziva (grid ostaje u pregledu, ćelije nose grešku za ponovni pokušaj).
 */
/**
 * Usvajanje samo ako je korisnik i dalje u ISTOM pregledu u kom je otkucao prvi
 * paket. Kasno prvo čuvanje starog pregleda čuva nacrt u svom periodu, ali
 * korisnika ne vraća tamo.
 */
export function adoptIfCurrent(
  keyAtEntry: string, currentKey: () => string, adopt: (id: Uuid) => void,
): (id: Uuid) => void {
  return (id) => {
    if (currentKey() === keyAtEntry) adopt(id);
  };
}

export function withAdoption<T extends { submissionId: Uuid }>(
  create: (batch: BulkEntryInput[]) => Promise<T>,
  adopt: (id: Uuid) => void,
): (batch: BulkEntryInput[]) => Promise<T> {
  return async (batch) => {
    const r = await create(batch);
    adopt(r.submissionId);
    return r;
  };
}

/**
 * 0077: nova prijava koja još ne postoji — grid iz dry-run pregleda. Pravi nacrt
 * pravi `ensureSubmission` pri prvoj smislenoj izmeni (autosave).
 */
export interface GridPreviewOptions {
  preview: { grid: GridPayload; eligibility: EntryEligibility } | null;
  /**
   * PRVO čuvanje: kreiranje + prvi paket u jednoj serverskoj transakciji
   * (rpc_create_period_submission_with_entries). Vraća ID tek posle uspeha.
   */
  createWithFirstBatch?: (batch: BulkEntryInput[]) => Promise<{ submissionId: Uuid; result: BulkUpsertResult }>;
  /** Pozvano TEK posle uspešnog prvog čuvanja (ovde se menja URL). */
  onAdopted?: (id: Uuid) => void;
  /**
   * Identitet pregleda (centar|od|do|tip). Paketi su vezani za njega; kasno prvo
   * čuvanje STAROG pregleda nikad ne prebacuje korisnika (nema usvajanja).
   */
  previewKey?: string;
  /** Unos zaključan (npr. dok traje brisanje nacrta): ništa novo ne ulazi u autosave. */
  readOnly?: boolean;
  /** Ponovno čitanje pregleda (npr. posle dodavanja zaposlenog). */
  reloadPreview?: () => Promise<void>;
}

export function useGrid(
  api: WdrApi,
  submissionId: Uuid | null,
  previewOptions: GridPreviewOptions = { preview: null },
): UseGridResult {
  const { preview } = previewOptions;
  const previewOpts = useRef(previewOptions);
  previewOpts.current = previewOptions;
  /** ID nacrta koji je autosave upravo napravio — prelazak bez treptanja i skoka fokusa. */
  const adoptedRef = useRef<Uuid | null>(null);
  const [payload, setPayload] = useState<GridPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMap, setSaveMap] = useState<SaveMap>({});
  const [selection, setSelection] = useState<Selection>(singleCell(0, 0));
  const [notice, setNotice] = useState<string | null>(null);
  const [expectedMode, setExpectedMode] = useState<ExpectedDaysMode>('MON_SAT');
  const [rawEligibility, setEligibility] = useState<EligibilityIndex>(EMPTY_ELIGIBILITY);
  const [baseType, setBaseType] = useState<BaseType>('KARNET');
  const eligibility = useMemo(() => applyBaseType(rawEligibility, baseType), [rawEligibility, baseType]);
  const decayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const index = useMemo(() => (payload ? buildCellIndex(payload) : EMPTY_INDEX), [payload]);
  const allEmployees = useMemo(() => payload?.employees ?? [], [payload]);
  const counts = useMemo(
    () => (rawEligibility.available ? sectionCounts(rawEligibility, allEmployees, payload?.dates ?? []) : null),
    [rawEligibility, allEmployees, payload],
  );
  // Redovi grida = zaposleni sa bar jednim danom u izabranoj sekciji. Svi potrošači
  // (selekcija, grupne akcije, tabela) koriste ISTI filtriran spisak.
  const employees = useMemo(
    () => employeesInSection(rawEligibility, allEmployees, baseType, payload?.dates ?? []),
    [rawEligibility, allEmployees, baseType, payload],
  );
  const viewPayload = useMemo(
    () => (payload ? { ...payload, employees } : null),
    [payload, employees],
  );
  const dates = payload?.dates ?? [];
  const editable = Boolean(payload?.submission.editable && payload?.submission.can_write && !previewOptions.readOnly);
  // Kontekst autosave-a: postojeća prijava ili pregled nove prijave.
  const contextKey = submissionId ?? (preview ? `preview:${previewOptions.previewKey ?? ''}` : 'none');
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  const load = useCallback(async () => {
    if (!submissionId) {
      if (preview) {
        // Pregled nove prijave: ništa nije upisano; grid je onakav kakav bi bio nacrt.
        setPayload(preview.grid);
        setEligibility(buildEligibilityIndex(preview.eligibility));
        setExpectedMode(defaultExpectedMode(preview.grid.dates));
        setSelection(singleCell(0, 0));
        setLoadError(null);
      } else {
        setPayload(null);
      }
      return;
    }
    if (adoptedRef.current === submissionId) {
      // Nacrt je upravo nastao iz ovog grida: tiho osveži, bez resetovanja fokusa,
      // dozvoljenih dana i režima očekivanih dana.
      adoptedRef.current = null;
      try {
        const [p, e] = await Promise.all([api.getGrid(submissionId), api.getEntryEligibility(submissionId)]);
        setPayload(p);
        setEligibility(buildEligibilityIndex(e));
      } catch {
        // Neuspelo pozadinsko osvežavanje ne sme da obriše grid koji se koristi.
      }
      return;
    }
    setLoading(true);
    setLoadError(null);
    setEligibility(EMPTY_ELIGIBILITY);
    try {
      const p = await api.getGrid(submissionId);
      setPayload(p);
      // Eligibility je pomoć, ne preduslov: ako ne stigne, grid radi kao ranije
      // i baza ostaje jedina koja odbija nedozvoljen dan.
      api
        .getEntryEligibility(submissionId)
        .then((e) => {
          if (e.submission_id === submissionId) setEligibility(buildEligibilityIndex(e));
        })
        .catch(() => setEligibility(EMPTY_ELIGIBILITY));
      const savedExpectedMode = window.localStorage.getItem(
        `wdr:expected-mode:${submissionId}`,
      );
      setExpectedMode(
        savedExpectedMode === 'MON_FRI' ||
        savedExpectedMode === 'MON_SAT' ||
        savedExpectedMode === 'MON_SUN'
          ? savedExpectedMode
          : defaultExpectedMode(p.dates),
      );
      setSelection(singleCell(0, 0));
    } catch (err) {
      setPayload(null);
      setLoadError(
        messageForCode(null, err instanceof Error ? err.message : undefined),
      );
    } finally {
      setLoading(false);
    }
  }, [api, submissionId, preview]);

  useEffect(() => {
    void load();
  }, [load]);

  // --- autosave -------------------------------------------------------------

  const onFlushStart = useCallback((keys: string[], stale?: boolean) => {
    if (stale) return; // paket prethodnog konteksta: tekući grid se ne dira
    setSaveMap((m) => markSaving(m, keys));
  }, []);

  const scheduleDecay = useCallback(() => {
    if (decayTimer.current) clearTimeout(decayTimer.current);
    decayTimer.current = setTimeout(() => setSaveMap((m) => decaySaved(m)), 2000);
  }, []);

  const onResult = useCallback(
    (result: BulkUpsertResult, _keys: string[], stale?: boolean) => {
      // Paket prethodnog konteksta je sačuvan u SVOJU prijavu; tekući grid ostaje isti.
      if (stale) return;
      setSaveMap((m) => applyResults(m, result.results, messageForCode));
      setPayload((prev) =>
        prev ? { ...prev, validation: result.validation } : prev,
      );
      scheduleDecay();
      // The authoritative cell shape (segments, hours, ownership) comes from the
      // database, so a successful batch is followed by a quiet refresh instead of
      // trusting the optimistic guess.
      void refreshQuietly();
    },
    [scheduleDecay],
  );

  const onError = useCallback((err: unknown, _keys: string[], stale?: boolean) => {
    const msg = messageForCode(null, err instanceof Error ? err.message : undefined);
    if (stale) {
      // Ne sme da nestane tiho: korisnik je u drugoj prijavi, ali mora da zna.
      setNotice(`Izmene iz prethodno otvorene prijave nisu sačuvane: ${msg}`);
      return;
    }
    setSaveMap((m) => revertInFlight(m, msg));
    setNotice(msg);
  }, []);

  const autosave = useAutosave({
    api,
    submissionId,
    enabled: editable,
    onResult,
    onError,
    onFlushStart,
    contextKey,
    // Odbačen no-op paket u pregledu: ćelije više ne „čekaju slanje".
    onDiscard: (keys, stale) => !stale && setSaveMap((m) => {
      const next = { ...m };
      for (const k of keys) delete next[k];
      return next;
    }),
    // Vezano za OVAJ render (ovaj pregled), ne za tekući u trenutku slanja.
    createWithFirstBatch: previewOptions.createWithFirstBatch
      ? withAdoption(
          previewOptions.createWithFirstBatch,
          adoptIfCurrent(contextKey, () => contextKeyRef.current, (id) => {
            adoptedRef.current = id; // PRE promene URL-a → load() radi tih prelaz
            previewOptions.onAdopted?.(id);
          }),
        )
      : undefined,
  });

  const refreshQuietly = useCallback(async () => {
    if (!submissionId) return;
    try {
      const p = await api.getGrid(submissionId);
      setPayload(p);
    } catch {
      // A failed background refresh must not wipe the grid the operator is using.
    }
  }, [api, submissionId]);

  // --- selection helpers ----------------------------------------------------

  const rows = employees.length;
  const cols = dates.length;

  const move = useCallback(
    (dr: number, dc: number, extend: boolean) => {
      if (rows === 0 || cols === 0) return;
      setSelection((s) => moveFocus(s, dr, dc, rows, cols, extend));
    },
    [rows, cols],
  );

  const tab = useCallback(
    (back: boolean) => {
      if (rows === 0 || cols === 0) return;
      setSelection((s) => tabNext(s, rows, cols, back));
    },
    [rows, cols],
  );

  // --- mutations ------------------------------------------------------------

  const runPlan = useCallback(
    (plan: BulkPlan) => {
      const skips = describeSkips(plan);
      setNotice(skips);
      if (plan.entries.length === 0) return;
      const keys = plan.entries.map((e) => cellKey(e.employee_id, e.work_date));
      setSaveMap((m) => markDirty(m, keys));
      autosave.push(plan.entries);
      applyOptimistic(plan.entries);
    },
    [autosave],
  );

  /**
   * Optimistic update is deliberately shallow: only the attendance status and
   * the shift label change locally. Hours, ownership and validation counts are
   * never guessed — they arrive with the refresh after the save.
   */
  const applyOptimistic = useCallback((entries: BulkEntryInput[]) => {
    setPayload((prev) => {
      if (!prev) return prev;
      const cells = [...prev.cells];
      for (const e of entries) {
        const at = cells.findIndex(
          (c) => c.employee_id === e.employee_id && c.work_date === e.work_date,
        );
        if (e.delete) {
          if (at >= 0) cells.splice(at, 1);
          continue;
        }
        if (!e.attendance_status) continue;
        const tpl = prev.reference.shift_templates.find(
          (t) => t.id === e.shift_template_id,
        );
        const segments =
          e.attendance_status === 'WORK' && tpl
            ? [
                {
                  id: at >= 0 ? (cells[at].segments[0]?.id ?? -1) : -1,
                  center_code: prev.submission.center_code,
                  cost_center_code: prev.submission.center_code,
                  segment_type: 'REGULAR' as const,
                  shift_template_id: tpl.id,
                  shift_start: tpl.shift_start,
                  shift_end: tpl.shift_end,
                  crosses_midnight: tpl.crosses_midnight,
                  worked_hours: 0,
                  sequence_no: 1,
                  in_this_submission: true,
                  editable_here: true,
                },
              ]
            : [];
        const foreign = at >= 0 ? cells[at].segments.filter((s) => !s.in_this_submission) : [];

        if (at >= 0) {
          cells[at] = {
            ...cells[at],
            attendance_status: e.attendance_status,
            segments: [...segments, ...foreign],
          };
        } else {
          cells.push({
            work_entry_id: `optimistic-${e.employee_id}-${e.work_date}`,
            employee_id: e.employee_id,
            work_date: e.work_date,
            attendance_status: e.attendance_status,
            primary_payment_type_id: null,
            home_center_code: prev.submission.center_code,
            owner_submission_id: prev.submission.id,
            owned_by_this_submission: true,
            notes: null,
            segments,
            components: [],
            has_assistance: false,
            has_foreign_segment: false,
          });
        }
      }
      return { ...prev, cells };
    });
  }, []);

  const isLocked = useCallback((key: string) => isLockedIn(eligibility, key), [eligibility]);

  const currentKeys = useCallback(
    () => selectionKeys(selection, employees, dates),
    [selection, employees, dates],
  );

  const statusAllowsSegments = useCallback(
    (code: AttendanceStatusCode) =>
      Boolean(
        payload?.reference.attendance_statuses.find((s) => s.code === code)
          ?.allows_segments,
      ),
    [payload],
  );

  const applyStatusToSelection = useCallback(
    (status: AttendanceStatusCode, shiftTemplateId?: Uuid | null) => {
      if (!editable) return;
      runPlan(
        applyStatus({
          keys: currentKeys(),
          status,
          index,
          employees,
          shiftTemplateId: shiftTemplateId ?? null,
          statusAllowsSegments,
          isLocked,
        }),
      );
    },
    [editable, runPlan, currentKeys, index, employees, statusAllowsSegments, isLocked],
  );

  const applyShiftIndexToSelection = useCallback(
    (i: number) => {
      const tpl = payload?.reference.shift_templates[i];
      if (!tpl) {
        setNotice(`Šablon smene ${i + 1} ne postoji.`);
        return;
      }
      applyStatusToSelection('WORK', tpl.id);
    },
    [payload, applyStatusToSelection],
  );

  const clearSelection = useCallback(() => {
    if (!editable) return;
    runPlan(clearCells({ keys: currentKeys(), index }));
  }, [editable, runPlan, currentKeys, index]);

  const copyOffset = useCallback(
    (offsetDays: number) => {
      if (!editable || !payload) return;
      runPlan(
        copyFromOffset({
          keys: currentKeys(),
          index,
          offsetDays,
          periodStart: payload.submission.period_start,
          periodEnd: payload.submission.period_end,
          isLocked,
        }),
      );
    },
    [editable, payload, runPlan, currentKeys, index, isLocked],
  );

  const completion = useMemo(
    () =>
      payload
        ? computeCompletion({ dates, employees, index, mode: expectedMode, isLocked })
        : null,
    [payload, dates, employees, index, expectedMode, isLocked],
  );

  const notWorkingState = useCallback(
    (employeeId: Uuid) => wholePeriodNotWorkingState({ employeeId, dates, index, isLocked }),
    [dates, index, isLocked],
  );

  const toggleNotWorkingWholePeriod = useCallback(
    (employeeId: Uuid, confirmOverwrite: (days: number) => boolean) => {
      if (!editable) return;
      if (notWorkingState(employeeId) === 'ALL') {
        runPlan(planUndoWholePeriodNotWorking({ employeeId, dates, index }));
        return;
      }
      const plan = planWholePeriodNotWorking({ employeeId, dates, index, isLocked });
      if (plan.overwrites > 0 && !confirmOverwrite(plan.overwrites)) return;
      runPlan(plan);
    },
    [editable, notWorkingState, runPlan, dates, index, isLocked],
  );

  return {
    loading,
    loadError,
    payload: viewPayload,
    index,
    selection,
    saveMap,
    saveSummary: summarize(saveMap),
    autosave: { queued: autosave.queued, saving: autosave.saving },
    notice,
    expectedMode,
    completion,
    editable,
    eligibility,
    baseType,
    setBaseType,
    sectionCounts: counts,

    setSelection,
    setExpectedMode,
    dismissNotice: () => setNotice(null),
    reload: async () => {
      if (!submissionId && previewOpts.current.reloadPreview) await previewOpts.current.reloadPreview();
      else await load();
    },
    flush: autosave.flush,

    move,
    tab,
    selectEverything: () => setSelection(selectAll(rows, cols)),
    selectCurrentRow: () => setSelection(selectRow(selection.focus.r, cols)),
    selectCurrentColumn: () => setSelection(selectColumn(selection.focus.c, rows)),
    collapseSelection: () =>
      setSelection((s) => singleCell(normalize(s).r0, normalize(s).c0)),

    applyStatusToSelection,
    applyShiftIndexToSelection,
    clearSelection,
    copyPreviousDay: () => copyOffset(1),
    notWorkingState,
    toggleNotWorkingWholePeriod,
  };
}
