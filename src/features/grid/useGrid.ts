import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AttendanceStatusCode,
  BulkEntryInput,
  BulkUpsertResult,
  GridPayload,
  Uuid,
} from '../../lib/api/types';
import type { WdrApi } from '../../lib/api/WdrApi';
import {
  applyStatus,
  clearCells,
  copyFromOffset,
  describeSkips,
  type BulkPlan,
} from './bulk';
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
  copyPreviousWeek(): void;
}

const EMPTY_INDEX: CellIndex = new Map();

export function useGrid(api: WdrApi, submissionId: Uuid | null): UseGridResult {
  const [payload, setPayload] = useState<GridPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMap, setSaveMap] = useState<SaveMap>({});
  const [selection, setSelection] = useState<Selection>(singleCell(0, 0));
  const [notice, setNotice] = useState<string | null>(null);
  const [expectedMode, setExpectedMode] = useState<ExpectedDaysMode>('MON_SAT');
  const decayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const index = useMemo(() => (payload ? buildCellIndex(payload) : EMPTY_INDEX), [payload]);
  const employees = payload?.employees ?? [];
  const dates = payload?.dates ?? [];
  const editable = Boolean(payload?.submission.editable && payload?.submission.can_write);

  const load = useCallback(async () => {
    if (!submissionId) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const p = await api.getGrid(submissionId);
      setPayload(p);
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
  }, [api, submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // --- autosave -------------------------------------------------------------

  const onFlushStart = useCallback((keys: string[]) => {
    setSaveMap((m) => markSaving(m, keys));
  }, []);

  const scheduleDecay = useCallback(() => {
    if (decayTimer.current) clearTimeout(decayTimer.current);
    decayTimer.current = setTimeout(() => setSaveMap((m) => decaySaved(m)), 2000);
  }, []);

  const onResult = useCallback(
    (result: BulkUpsertResult, _keys: string[]) => {
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

  const onError = useCallback((err: unknown, _keys: string[]) => {
    const msg = messageForCode(null, err instanceof Error ? err.message : undefined);
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
        }),
      );
    },
    [editable, runPlan, currentKeys, index, employees, statusAllowsSegments],
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
        }),
      );
    },
    [editable, payload, runPlan, currentKeys, index],
  );

  const completion = useMemo(
    () =>
      payload
        ? computeCompletion({ dates, employees, index, mode: expectedMode })
        : null,
    [payload, dates, employees, index, expectedMode],
  );

  return {
    loading,
    loadError,
    payload,
    index,
    selection,
    saveMap,
    saveSummary: summarize(saveMap),
    autosave: { queued: autosave.queued, saving: autosave.saving },
    notice,
    expectedMode,
    completion,
    editable,

    setSelection,
    setExpectedMode,
    dismissNotice: () => setNotice(null),
    reload: load,
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
    copyPreviousWeek: () => copyOffset(7),
  };
}
