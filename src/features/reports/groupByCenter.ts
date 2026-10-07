/**
 * Grupisanje rezultata izveštaja po centru (Admin → Izveštaji isplata).
 * Red sa više centara (npr. „više kategorija istog dana" u dva centra) pojavljuje
 * se pod SVAKIM svojim centrom. Redosled: šifra centra; unutar grupe red ostaje.
 */
export interface CenterGroup<T> {
  centerCode: string;
  rows: T[];
}

export function groupByCenter<T>(rows: T[], centersOf: (row: T) => string[]): CenterGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const codes = centersOf(r);
    for (const code of codes.length > 0 ? codes : ['—']) {
      const list = map.get(code) ?? [];
      list.push(r);
      map.set(code, list);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'sr'))
    .map(([centerCode, list]) => ({ centerCode, rows: list }));
}

/** Kopija sortirana po centru (za Excel): grupe po centru, unutar grupe stabilno. */
export function sortByCenter<T>(rows: T[], centerOf: (row: T) => string, then?: (a: T, b: T) => number): T[] {
  return [...rows].sort((a, b) => centerOf(a).localeCompare(centerOf(b), 'sr') || (then ? then(a, b) : 0));
}
