import { formatPeriod } from '../lib/format/date';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, CellLegend, EmptyState, KeyboardHelp, Spinner } from '../components/Bits';
import { GridTable } from '../components/GridTable';
import { GridToolbar } from '../components/GridToolbar';
import { messageForCode } from '../features/grid/errors';
import { mapKey } from '../features/grid/keyboard';
import { useGrid } from '../features/grid/useGrid';
import { WdrApiError } from '../lib/api';
import type { PeriodSubmissionSlot, SubmissionBaseType, SubmissionListItem } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';
import { EntryBar } from '../components/EntryBar';
import { InlineAddEmployee } from '../components/InlineAddEmployee';
import { TYPE_NAME, decideOpen } from '../features/periods/baseType';
import {
  employeeTotals,
  fromPreviewLines,
  type EmployeeTotal,
} from '../features/finance/employeeSummary';

export function DailyEntry() {
  const { api, session, can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [submissions, setSubmissions] = useState<SubmissionListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

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
  const [barState, setBarState] = useState<{ valid: boolean; matchesCurrent: boolean }>({
    valid: true, matchesCurrent: true,
  });
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [addNotice, setAddNotice] = useState<string | null>(null);


  const [openError, setOpenError] = useState<string | null>(null);
  const [copyInfo, setCopyInfo] = useState<string | null>(null);

  const current: SubmissionListItem | null = useMemo(() => {
    const fromList = submissions?.find((x) => x.id === submissionId) ?? null;
    if (fromList) return fromList;
    const p = grid.payload?.submission;
    return p ? {
      id: p.id, center_id: p.center_id, center_code: p.center_code, period_id: p.period_id,
      period_label: `${formatPeriod(p.period_start, p.period_end)}`, period_start: p.period_start, period_end: p.period_end,
      status: p.status, base_type: p.base_type ?? null,
    } : null;
  }, [submissions, submissionId, grid.payload]);

  /*
   * 0074 — KARNET i OBUKA su zasebne prijave. Izbor u traci (centar, period, tip)
   * otvara postojeću prijavu tog tipa (editabilna se nastavlja, poslata/odobrena
   * se otvara samo za pregled) ili kreira novu; stara zajednička prijava za taj
   * period otvara se u starom režimu. Pravila sprovodi baza.
   */
  const [slots, setSlots] = useState<PeriodSubmissionSlot[] | null>(null);
  const [openNotice, setOpenNotice] = useState<string | null>(null);

  function showSubmission(item: SubmissionListItem) {
    setSubmissions((list) => (list?.some((x) => x.id === item.id) ? list : [item, ...(list ?? [])]));
    setParams({ prijava: item.id });
  }

  async function openPeriod(centerId: string, from: string, to: string, type: SubmissionBaseType) {
    setOpening(true);
    setOpenError(null);
    setOpenNotice(null);
    setCopyInfo(null);
    try {
      const sl = await api.periodSubmissionSlots(centerId, from, to);
      setSlots(sl.slots);
      const d = decideOpen(sl.slots, type);
      if (d.kind === 'conflict') {
        setOpenError(d.message);
        return;
      }
      if (d.kind === 'open' || d.kind === 'legacy') {
        const fresh = await api.listSubmissions();
        setSubmissions(fresh);
        setParams({ prijava: d.submissionId });
        if (d.kind === 'legacy') {
          setOpenNotice('Za ovaj period postoji stara zajednička prijava (Karnet + Obuka iz vremena pre razdvajanja). '
            + 'Otvorena je u starom režimu; Karnet/Obuka u traci samo filtriraju prikaz.');
        } else if (d.readOnly) {
          setOpenNotice(`${TYPE_NAME[type]} prijava za ovaj period je ${d.status === 'SUBMITTED' ? 'poslata Finansijama' : 'zaključena'} — otvorena je samo za pregled.`);
        }
        return;
      }
      try {
        const res = await api.createPeriodSubmission(centerId, from, to, type);
        showSubmission({
          id: res.submission_id, center_id: res.center_id, center_code: res.center_code,
          period_id: res.period_id, period_label: res.period_label,
          period_start: res.period_start, period_end: res.period_end, status: res.status,
          base_type: res.base_type ?? type,
        });
        setSlots((await api.periodSubmissionSlots(centerId, from, to)).slots);
      } catch (err) {
        const legacy = sl.slots.find((x) => x.base_type === 'LEGACY');
        if (err instanceof WdrApiError && err.code === 'PERIOD_LEGACY_COMBINED' && legacy) {
          setSubmissions(await api.listSubmissions());
          setParams({ prijava: legacy.submission_id });
          setOpenNotice('Za ovaj period postoji stara zajednička prijava sa unosima i Karneta i Obuke. '
            + 'Otvorena je u starom režimu (ne razdvaja se automatski).');
          return;
        }
        throw err;
      }
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setOpenError(messageForCode(code, err instanceof Error ? err.message : undefined));
    } finally {
      setOpening(false);
    }
  }

  // Tip otvorene prijave određuje sekciju grida; za staru zajedničku tip je filter.
  const [selType, setSelType] = useState<SubmissionBaseType>('KARNET');
  useEffect(() => {
    if (current?.base_type) {
      setSelType(current.base_type);
      grid.setBaseType(current.base_type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.base_type]);
  useEffect(() => {
    if (!current) return;
    api.periodSubmissionSlots(current.center_id, current.period_start, current.period_end)
      .then((r) => setSlots(r.slots)).catch(() => setSlots(null));
  }, [api, current?.id, current?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseType(t: 'KARNET' | 'OBUKA' | 'OSTALO') {
    if (t === 'OSTALO') {
      grid.setBaseType('OSTALO');
      return;
    }
    setSelType(t);
    if (current && !current.base_type) grid.setBaseType(t); // stara zajednička: samo filter
  }

  // Ponudi preostali tip kada je izabrani već poslat/odobren.
  const otherType: SubmissionBaseType = selType === 'KARNET' ? 'OBUKA' : 'KARNET';
  const otherPending = Boolean(current?.base_type && !grid.payload?.submission.editable
    && !slots?.some((x) => x.base_type === otherType && x.exact && !x.editable));

  /*
   * K12: „Kopiraj prethodnu nedelju" u osnovnom Unosu NE kopira sate, statuse,
   * „ne radi", iznose ni komponente. Spisak zaposlenih ovde dolazi iz raspodele
   * po datumu (izvor istine), pa funkcija samo upoređuje spisak sa prethodnom
   * nedeljom i jasno kaže ko više nije raspoređen — nikoga ne uklanja.
   */
  async function comparePreviousWeek() {
    if (!current || !submissions) return;
    const prev = submissions
      .filter((x) => x.center_id === current.center_id && x.period_end < current.period_start
        && (x.base_type ?? null) === (current.base_type ?? null))
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
        `Prethodna nedelja (${formatPeriod(prev.period_start, prev.period_end)}): ${prevGrid.employees.length} zaposlenih. `
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
      baseType={current && !current.base_type ? grid.baseType : selType}
      counts={grid.sectionCounts}
      busy={opening}
      error={openError}
      onOpen={(c, f, t, bt) => void openPeriod(c, f, t, bt)}
      onBaseType={chooseType}
      slots={slots}
      onCopyPreviousWeek={() => void comparePreviousWeek()}
      onAddEmployee={can('employee.create') ? () => setAddingEmployee(true) : undefined}
      onContextChange={setBarState}
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
        // Osnovni Unos nema dijalog dodatnih isplata (ispomoć/prekovremeni).
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
      {openNotice && <Banner kind="info" onClose={() => setOpenNotice(null)}>{openNotice}</Banner>}
      {otherPending && barState.matchesCurrent && (
        <Banner kind="info">
          {TYPE_NAME[selType]} za ovaj period je već poslat.{' '}
          <button type="button" className="btn btn-small" onClick={() => chooseType(otherType)}>
            Otvori {TYPE_NAME[otherType]}
          </button>
        </Banner>
      )}
      {addNotice && <Banner kind="success" onClose={() => setAddNotice(null)}>{addNotice}</Banner>}
      {addingEmployee && current && grid.baseType !== 'OSTALO' && (
        <InlineAddEmployee
          centerId={current.center_id}
          centerCode={current.center_code}
          baseType={grid.baseType}
          onClose={() => setAddingEmployee(false)}
          onDone={(msg) => {
            setAddingEmployee(false);
            setAddNotice(msg);
            void grid.reload();
          }}
        />
      )}
      {(!barState.valid || !barState.matchesCurrent) ? (
        <EmptyState
          title={barState.valid ? 'Otvaranje izabranog perioda…' : 'Izaberite ispravan centar i period'}
          hint="Grid se prikazuje tek kada izbor u traci odgovara otvorenoj prijavi (najviše 7 dana)."
        />
      ) : (<>
      {copyInfo && <Banner kind="info">{copyInfo}</Banner>}
      {grid.payload.employees.length === 0 && grid.eligibility.available && (
        <Banner kind="info">
          U ovoj sekciji nema zaposlenih za izabrani period. Proverite drugu sekciju
          (Karnet / Obuka).
        </Banner>
      )}
      <GridToolbar
        payload={grid.payload}
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
      </>)}

    </div>
  );
}
