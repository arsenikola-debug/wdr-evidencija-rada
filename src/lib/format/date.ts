/**
 * JEDINSTVEN PRIKAZ DATUMA u celoj aplikaciji (UI standard):
 *
 *   datum:          05.10.2026.
 *   period:         05.10.2026. – 11.10.2026.
 *   datum i vreme:  05.10.2026. 14:30
 *
 * Samo PRIKAZ. Vrednosti u bazi, ISO format u API-ju, RPC parametri, filteri,
 * sortiranje i <input type="date"> ostaju ISO (YYYY-MM-DD).
 *
 * Kalendarski datum (YYYY-MM-DD) se formatira BEZ pretvaranja u Date, da vremenska
 * zona ne bi pomerila dan. Vremenska oznaka (timestamp) se prikazuje u lokalnom
 * vremenu korisnika.
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TS = /^(\d{4})-(\d{2})-(\d{2})[T ]/;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parts(value: string | Date): { y: number; m: number; d: number; hh?: number; mi?: number } | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate(), hh: value.getHours(), mi: value.getMinutes() };
  }
  const s = value.trim();
  const day = ISO_DAY.exec(s);
  if (day) return { y: Number(day[1]), m: Number(day[2]), d: Number(day[3]) };
  if (ISO_TS.test(s)) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) return parts(dt);
  }
  return null;
}

/** 05.10.2026. — za kalendarski datum ili vremensku oznaku; prazno → „—". */
export function formatDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const p = parts(value);
  return p ? `${pad(p.d)}.${pad(p.m)}.${p.y}.` : String(value);
}

/** 05.10.2026. 14:30 — za vremensku oznaku (kalendarski datum dobija samo datum). */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const p = parts(value);
  if (!p) return String(value);
  const date = `${pad(p.d)}.${pad(p.m)}.${p.y}.`;
  return p.hh === undefined ? date : `${date} ${pad(p.hh)}:${pad(p.mi ?? 0)}`;
}

/** 05.10.2026. – 11.10.2026. */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return '—';
  if (!start) return formatDate(end);
  if (!end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** Kratak prikaz dana u zaglavlju kolone grida: „05.10.2026." (vidi formatDateHeader). */
export function formatDayMonthYear(value: string): string {
  return formatDate(value);
}

/** Mesec za prikaz: „2026-10" → „10.2026." */
export function formatMonth(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})/.exec(value);
  return m ? `${m[2]}.${m[1]}.` : value;
}

/**
 * Tekst koji dolazi iz baze (poruke grešaka, obaveštenja) može sadržati ISO datume;
 * za prikaz se svaki „YYYY-MM-DD" pretvara u „DD.MM.YYYY.".
 */
export function localizeIsoDates(text: string | null | undefined): string {
  if (!text) return text ?? '';
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b(?!T)/g, (_m, y, mo, d) => `${d}.${mo}.${y}.`);
}
