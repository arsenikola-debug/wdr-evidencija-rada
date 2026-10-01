import type {
  IsoDate,
  PayoutDetail,
  PayoutInputMode,
  PayoutLine,
  PayoutStatus,
  PayoutRequestType,
} from '../../lib/api/types';

/**
 * Dodatne isplate — čista pravila prikaza i unosa (redizajn §8–§17).
 *
 * Iznos se ovde NIKADA ne računa: stopa i iznos dolaze sa servera
 * (app.payout_price_line). Ovaj modul samo:
 *   • tumači unos operatera u oblik koji server prihvata,
 *   • izvodi trajanje intervala za PRIKAZ dok server ne odgovori
 *     (server je merodavan — isto pravilo kao tg_payout_line_validate),
 *   • priprema tabelu zaposleni × dan.
 */

export const STATUS_LABEL: Record<PayoutStatus, string> = {
  DRAFT: 'U pripremi',
  SUBMITTED: 'Poslato finansijama',
  RETURNED: 'Vraćeno na ispravku',
  FINANCE_APPROVED: 'Odobreno',
};

export const TYPE_HINT: Record<PayoutRequestType, string> = {
  DNEVNICA: 'Označite dane za koje zaposleni dobija dnevnicu. Iznos = broj dana × dnevnica centra.',
  ISPOMOC: 'Označite dane ispomoći. Iznos = broj dana × tarifa ispomoći centra zahteva.',
  RADNA_SUBOTA: 'Za subotu unesite vreme rada. Iznos = sati × satnica radne subote centra.',
  PREKOVREMENI: 'Po danu unesite sate prekovremenog rada. Prazan dan = 0 sati.',
  NOCNI_RAD: 'Unesite konkretan interval noćnog rada (može preko ponoći). Iznos = sati × satnica noćnog rada.',
};

export const PROBLEM_TEXT: Record<string, string> = {
  RULE_MISSING: 'nema tarife centra za ovaj datum',
  PAYOUT_RULE_NOT_HOURLY: 'tarifa nije satna (potrebna je satnica)',
  PAYOUT_RULE_NOT_DAILY: 'tarifa nije dnevna',
  COMP_RULE_MULTIPLIER_UNSUPPORTED: 'tarifa sa množiocem nije podržana',
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "8" → "08:00", "830" → "08:30", "8:3" → null (nejasno), "22.30" → "22:30". */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim().replace('.', ':');
  if (s === '') return null;
  if (/^\d{1,2}$/.test(s)) {
    const h = Number(s);
    return h <= 23 ? `${String(h).padStart(2, '0')}:00` : null;
  }
  if (/^\d{3,4}$/.test(s)) {
    const h = Number(s.slice(0, s.length - 2));
    const m = Number(s.slice(-2));
    return h <= 23 && m <= 59 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null;
  }
  const m = TIME_RE.exec(s);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

export function minutesOf(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

/** Trajanje intervala; kraj pre početka = prelazak ponoći (K6). Isto kao server. */
export function hoursFromRange(from: string, to: string): { hours: number; crossesMidnight: boolean } | null {
  const a = minutesOf(from);
  const b = minutesOf(to);
  if (a === b) return null;
  const crossesMidnight = b < a;
  const minutes = b - a + (crossesMidnight ? 1440 : 0);
  return { hours: Math.round((minutes / 60) * 100) / 100, crossesMidnight };
}

export function isSaturday(iso: IsoDate): boolean {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() === 6;
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Ponedeljak nedelje kojoj datum pripada. */
export function weekStart(iso: IsoDate): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function periodError(from: IsoDate, to: IsoDate, max = 7): string | null {
  if (!from || !to) return 'Izaberite period.';
  if (to < from) return 'Datum „do" mora biti isti ili posle datuma „od".';
  const n = daysInclusive(from, to);
  if (n > max) return `Period može imati najviše ${max} kalendarskih dana (izabrano: ${n}).`;
  return null;
}

export interface CellInput {
  units?: number | null;
  time_from?: string | null;
  time_to?: string | null;
}

/**
 * Pretvara unos iz ćelije u zahtev serveru. `null` = brisanje stavke.
 * Greška se vraća kao tekst i ništa se ne šalje.
 */
export function parseCellInput(
  mode: PayoutInputMode,
  raw: { checked?: boolean; hours?: string; from?: string; to?: string },
): { ok: true; value: CellInput | null } | { ok: false; error: string } {
  if (mode === 'DAYS') {
    return { ok: true, value: raw.checked ? { units: 1 } : null };
  }
  if (mode === 'HOURS') {
    const s = (raw.hours ?? '').trim().replace(',', '.');
    if (s === '' || Number(s) === 0) return { ok: true, value: null };
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Unesite broj sati (npr. 2 ili 1,5).' };
    if (n > 24) return { ok: false, error: 'Najviše 24 sata po danu.' };
    return { ok: true, value: { units: Math.round(n * 100) / 100 } };
  }
  const fromRaw = (raw.from ?? '').trim();
  const toRaw = (raw.to ?? '').trim();
  if (fromRaw === '' && toRaw === '') return { ok: true, value: null };
  const from = normalizeTime(fromRaw);
  const to = normalizeTime(toRaw);
  if (!from || !to) return { ok: false, error: 'Unesite vreme od–do (npr. 22:30 i 03:30).' };
  if (!hoursFromRange(from, to)) return { ok: false, error: 'Vreme od i do ne mogu biti isti.' };
  return { ok: true, value: { time_from: from, time_to: to } };
}

export function lineIndex(detail: PayoutDetail): Map<string, PayoutLine> {
  const m = new Map<string, PayoutLine>();
  for (const l of detail.lines) m.set(`${l.employee_id}|${l.work_date}`, l);
  return m;
}

/** Dan je dostupan za unos: zaposleni je tog dana u radnom odnosu (K7); subota za radnu subotu. */
export function dayAvailable(detail: PayoutDetail, employeeId: string, date: IsoDate): boolean {
  const emp = detail.employees.find((e) => e.employee_id === employeeId);
  if (!emp || !emp.employed_dates.includes(date)) return false;
  if (detail.request.saturday_only && !isSaturday(date)) return false;
  if (detail.cutover_date && date < detail.cutover_date) return false;
  return true;
}

export function unitLabel(mode: PayoutInputMode): string {
  return mode === 'DAYS' ? 'dana' : 'sati';
}
