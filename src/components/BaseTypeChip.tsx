import type { SubmissionBaseType } from '../lib/api/types';

/**
 * 0074 — oznaka osnovnog tipa prijave. KARNET i OBUKA su zasebne prijave;
 * prijava bez tipa je stara zajednička (pre razdvajanja).
 */
export function BaseTypeChip({ type }: { type?: SubmissionBaseType | null }) {
  if (type === undefined) return null;
  if (type === null) {
    return <span className="chip" title="Stara zajednička prijava (Karnet + Obuka, pre razdvajanja)">Karnet + Obuka</span>;
  }
  return <span className={type === 'KARNET' ? 'chip chip-ok' : 'chip chip-warn'}>{type === 'KARNET' ? 'Karnet' : 'Obuka'}</span>;
}
