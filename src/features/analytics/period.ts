/**
 * Opis izabranog vremenskog raspona.
 *
 * Ovde se ne računa nijedan iznos. Jedini posao je da korisnik ne pomeša
 * PARCIJALAN raspon (npr. 01.09–23.09, jer je danas 23.09) sa celim mesecom.
 * Ta zabuna je skupa: broj za 23 dana izgleda kao mesečni trošak.
 */

export interface RangeDescription {
  /** „01.09.2026 – 23.09.2026" */
  label: string;
  days: number;
  valid: boolean;
  /** Raspon pokriva tačno jedan ceo kalendarski mesec. */
  wholeMonth: boolean;
  /** Počinje 1. u mesecu, ali se završava pre kraja tog meseca. */
  partialMonth: boolean;
  /** Krajnji datum je danas ili kasnije — podaci se još „pune". */
  endsToday: boolean;
  /** „septembar 2026" kada je raspon u okviru jednog meseca, inače null. */
  monthLabel: string | null;
  /** Koliko dana meseca nedostaje kada je raspon parcijalan mesec. */
  missingDays: number;
}

const MONTHS = [
  'januar', 'februar', 'mart', 'april', 'maj', 'jun',
  'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar',
];

export function formatDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}.`;
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function describeRange(from: string, to: string, today: string): RangeDescription {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  const empty: RangeDescription = {
    label: `${formatDay(from)} – ${formatDay(to)}`,
    days: 0,
    valid: false,
    wholeMonth: false,
    partialMonth: false,
    endsToday: false,
    monthLabel: null,
    missingDays: 0,
  };
  if (!valid) return empty;

  const days =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    ) + 1;

  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);

  const sameMonth = fy === ty && fm === tm;
  const startsFirst = fd === 1;
  const lastDay = lastDayOfMonth(ty, tm);
  const endsLast = td === lastDay;

  return {
    label: `${formatDay(from)} – ${formatDay(to)}`,
    days,
    valid: true,
    wholeMonth: sameMonth && startsFirst && endsLast,
    partialMonth: sameMonth && startsFirst && !endsLast,
    endsToday: to >= today,
    monthLabel: sameMonth ? `${MONTHS[tm - 1]} ${ty}` : null,
    missingDays: sameMonth && startsFirst && !endsLast ? lastDay - td : 0,
  };
}

/** Kratka rečenica koju ekran prikazuje uz raspon. Namerno bez procenata. */
export function rangeNotice(r: RangeDescription): { kind: 'info' | 'warning'; text: string } | null {
  if (!r.valid) return null;
  if (r.wholeMonth && r.monthLabel) {
    return { kind: 'info', text: `Raspon pokriva ceo mesec — ${r.monthLabel}.` };
  }
  if (r.partialMonth && r.monthLabel) {
    return {
      kind: 'warning',
      text:
        `Parcijalan mesec: prikazano je prvih ${r.days} dana meseca ` +
        `(${r.monthLabel}), nedostaje još ${r.missingDays}. ` +
        'Ovi brojevi nisu mesečni ukupni iznos.',
    };
  }
  if (r.endsToday) {
    return {
      kind: 'warning',
      text: 'Raspon se završava danas — period još nije zaokružen i brojevi se mogu menjati.',
    };
  }
  return null;
}
