import { centerLabel, sortCenters } from '../lib/format/sort';
import { formatPeriod } from '../lib/format/date';
import { useEffect, useMemo, useState } from 'react';
import { Banner, StatusBadge } from './Bits';
import { addDays, periodError, weekStart } from '../features/payouts/model';
import type { BaseType } from '../features/grid/eligibility';
import { slotLabel } from '../features/periods/baseType';
import type {
  IsoDate,
  PeriodSubmissionSlot,
  SubmissionBaseType,
  SubmissionListItem,
  Uuid,
} from '../lib/api/types';

const TYPE_LABEL: Record<BaseType, string> = { KARNET: 'Karnet', OBUKA: 'Obuka', OSTALO: 'Ostalo' };


/**
 * Vrh stranice Unos (redizajn §1, K1): Centar · Period · Karnet/Obuka.
 *
 * Izbor centra i perioda automatski otvara postojeći ili kreira nov draft
 * (api.rpc_create_period_submission: jedinstven po centru i periodu, ≤ 7 dana,
 * zaštićen od trke). Karnet i Obuka NISU posebne prijave — to su sekcije iste
 * prijave; izbor sekcije samo menja koji dani su otvoreni za unos.
 */
export function EntryBar({
  centers,
  current,
  baseType,
  counts,
  busy,
  error,
  onOpen,
  onBaseType,
  onCopyPreviousWeek,
  onAddEmployee,
  onContextChange,
  slots = null,
}: {
  centers: Array<{ center_id: Uuid; center_code: string; center_name?: string | null }>;
  current: SubmissionListItem | null;
  baseType: BaseType;
  counts: Record<BaseType, number> | null;
  busy: boolean;
  error: string | null;
  /** 0074: tip je deo identiteta — otvara se KARNET ili OBUKA prijava. */
  onOpen(centerId: Uuid, from: IsoDate, to: IsoDate, baseType: SubmissionBaseType): void;
  onBaseType(t: BaseType): void;
  onCopyPreviousWeek?(): void;
  /** „+ Dodaj zaposlenog" u izabrani centar i sekciju (Karnet/Obuka). */
  onAddEmployee?(): void;
  /**
   * Da li izbor u traci odgovara otvorenoj prijavi. Dok ne odgovara (period nije
   * ispravan ili se nova prijava još otvara), grid se NE prikazuje — nikada se ne
   * prikazuje prijava drugog perioda kao da pripada novom izboru.
   */
  onContextChange?(state: { valid: boolean; matchesCurrent: boolean }): void;
  /** 0074: postojeće prijave centra za izabrani period (status po tipu). */
  slots?: PeriodSubmissionSlot[] | null;
}) {
  const [centerId, setCenterId] = useState<Uuid>(current?.center_id ?? centers[0]?.center_id ?? '');
  const [from, setFrom] = useState<IsoDate>(current?.period_start ?? weekStart(new Date().toISOString().slice(0, 10)));
  const [to, setTo] = useState<IsoDate>(current?.period_end ?? addDays(from, 6));

  // Kada se promeni otvorena prijava (npr. link iz „Moje prijave"), traka je prati.
  useEffect(() => {
    if (!current) return;
    setCenterId(current.center_id);
    setFrom(current.period_start);
    setTo(current.period_end);
  }, [current]);

  const perr = periodError(from, to);
  const isLegacy = Boolean(current && !current.base_type);
  // 0074: otvorena prijava odgovara izboru tek kada se poklapa i TIP (stara
  // zajednička prijava pokriva oba tipa — tamo izbor tipa samo filtrira).
  const same = Boolean(current && current.center_id === centerId
    && current.period_start === from && current.period_end === to
    && (isLegacy || current.base_type === baseType));
  const pickType: SubmissionBaseType = baseType === 'OBUKA' ? 'OBUKA' : 'KARNET';

  useEffect(() => {
    onContextChange?.({ valid: !perr && Boolean(centerId), matchesCurrent: same });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perr, centerId, same]);

  // Automatsko otvaranje: posle kratke pauze, kada je izbor ispravan i drugačiji.
  useEffect(() => {
    if (!centerId || perr || same || busy) return;
    const t = setTimeout(() => onOpen(centerId, from, to, pickType), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, from, to, pickType]);

  const tabs = useMemo<BaseType[]>(
    () => (isLegacy && counts && counts.OSTALO > 0 ? ['KARNET', 'OBUKA', 'OSTALO'] : ['KARNET', 'OBUKA']),
    [counts, isLegacy],
  );

  return (
    <div className="entry-bar">
      <div className="entry-bar-row toolbar-unified">
        <label>
          <span>Centar</span>
          {centers.length === 1 ? (
            <strong className="entry-bar-static">{centers[0].center_code}</strong>
          ) : (
            <select value={centerId} onChange={(e) => setCenterId(e.target.value)} disabled={busy}>
              {sortCenters(centers.map((c) => ({ ...c, code: c.center_code, name: c.center_name }))).map((c) => (
                <option key={c.center_id} value={c.center_id}>{centerLabel(c)}</option>
              ))}
            </select>
          )}
        </label>
        <label>
          <span>Od</span>
          <input type="date" value={from} disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              setFrom(v);
              if (v && (!to || to < v || periodError(v, to))) setTo(addDays(v, 6));
            }} />
        </label>
        <label>
          <span>Do</span>
          <input type="date" value={to} min={from} max={from ? addDays(from, 6) : undefined}
            disabled={busy} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="entry-bar-tabs segmented" role="tablist" aria-label="Osnovna naknada">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={baseType === t}
              className={baseType === t ? 'btn seg-active' : 'btn'}
              onClick={() => onBaseType(t)}>
              {t === 'OSTALO' ? TYPE_LABEL[t] : slotLabel(slots, t)}
              {isLegacy && counts ? ` (${counts[t]})` : ''}
            </button>
          ))}
        </div>
        {onCopyPreviousWeek && (
          <button type="button" className="btn" onClick={onCopyPreviousWeek} disabled={busy || !same}
            title="Upoređuje spisak zaposlenih sa prethodnom nedeljom; ne kopira sate, statuse ni iznose">
            Kopiraj prethodnu nedelju
          </button>
        )}
        {onAddEmployee && baseType !== 'OSTALO' && (
          <button type="button" className="btn" onClick={onAddEmployee} disabled={busy || !same}>
            + Dodaj zaposlenog
          </button>
        )}
        {busy && <span className="muted small">Otvaranje…</span>}
      </div>
      {same && current && (
        <div className="entry-bar-summary" aria-label="Izabrani kontekst">
          <strong>{current.center_code}</strong>
          <span>·</span>
          <span>
            {isLegacy
              ? `STARA ZAJEDNIČKA PRIJAVA · prikaz ${TYPE_LABEL[baseType].toUpperCase()}`
              : TYPE_LABEL[baseType].toUpperCase()}
          </span>
          <span>·</span>
          <span>{formatPeriod(current.period_start, current.period_end)}</span>
          <span>·</span>
          <StatusBadge status={current.status} />
        </div>
      )}
      {perr && <Banner kind="warning">{perr}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
    </div>
  );
}
