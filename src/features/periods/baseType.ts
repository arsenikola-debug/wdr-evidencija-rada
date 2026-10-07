import { formatPeriod } from '../../lib/format/date';
import type {
  PeriodSubmissionSlot,
  SubmissionBaseType,
  SubmissionStatus,
  Uuid,
} from '../../lib/api/types';

/**
 * 0074 — KARNET i OBUKA su DVE NEZAVISNE prijave za isti centar i period.
 * Traka u Unosu (Centar → Od → Do → KARNET/OBUKA) bira KOJU prijavu otvaramo;
 * korisnik ne vidi interni ID. Ovaj modul je čista odluka nad stanjem iz
 * api.rpc_period_submission_slots — baza i dalje sprovodi sva pravila.
 */
export type OpenDecision =
  | { kind: 'open'; submissionId: Uuid; readOnly: boolean; status: SubmissionStatus }
  | { kind: 'create' }
  | { kind: 'legacy'; submissionId: Uuid; editable: boolean; status: SubmissionStatus }
  | { kind: 'conflict'; message: string };

export const TYPE_NAME: Record<SubmissionBaseType, string> = { KARNET: 'Karnet', OBUKA: 'Obuka' };

const STATUS_SHORT: Record<SubmissionStatus, string> = {
  DRAFT: 'nacrt',
  READY_FOR_REVIEW: 'spremno',
  SUBMITTED: 'poslato',
  RETURNED: 'vraćeno',
  FINANCE_APPROVED: 'odobreno',
  CLOSED: 'zatvoreno',
};

export function decideOpen(slots: PeriodSubmissionSlot[], type: SubmissionBaseType): OpenDecision {
  const same = slots.filter((s) => s.base_type === type);
  const exact = same.find((s) => s.exact);
  if (exact) {
    return { kind: 'open', submissionId: exact.submission_id, readOnly: !exact.editable, status: exact.status };
  }
  const overlapping = same.find((s) => !s.exact);
  if (overlapping) {
    return {
      kind: 'conflict',
      message: `Već postoji ${TYPE_NAME[type]} prijava ${formatPeriod(overlapping.period_start, overlapping.period_end)} `
        + 'koja se preklapa sa izabranim periodom. Izaberite njen tačan raspon ili drugi period.',
    };
  }
  const legacy = slots.find((s) => s.base_type === 'LEGACY');
  if (legacy) {
    // Prazna stara prijava istog raspona: server je usvaja kao ovaj tip (ili odbija ako je mešovita).
    if (legacy.exact && legacy.editable) return { kind: 'create' };
    return { kind: 'legacy', submissionId: legacy.submission_id, editable: legacy.editable, status: legacy.status };
  }
  return { kind: 'create' };
}

/** Oznaka na dugmetu tipa: npr. „Karnet · poslato" kada prijava već postoji. */
export function slotLabel(slots: PeriodSubmissionSlot[] | null, type: SubmissionBaseType): string {
  const s = slots?.find((x) => x.base_type === type && x.exact);
  return s ? `${TYPE_NAME[type]} · ${STATUS_SHORT[s.status]}` : TYPE_NAME[type];
}

/** Tip koji je preostao: ako je jedan tip već poslat/odobren, ponudi drugi. */
export function suggestedType(
  slots: PeriodSubmissionSlot[] | null, preferred: SubmissionBaseType,
): SubmissionBaseType {
  const done = (t: SubmissionBaseType) =>
    Boolean(slots?.some((x) => x.base_type === t && x.exact && !x.editable));
  const other: SubmissionBaseType = preferred === 'KARNET' ? 'OBUKA' : 'KARNET';
  return done(preferred) && !done(other) ? other : preferred;
}
