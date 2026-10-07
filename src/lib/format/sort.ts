/**
 * ABECEDNI REDOSLED opcija u svim izborima (dropdown, multi-select, liste za izbor).
 *
 * Pravilo: opcije se ređaju po KORISNIČKI VIDLJIVOM nazivu, A–Ž, po srpskoj latinici
 * (Č i Ć posle C, Đ posle D, Š posle S, Ž posle Z; bez razlike velika/mala slova;
 * brojevi prirodno: B2 pre B10). Izuzeci sa jasnim poslovnim redosledom ostaju
 * nesortirani: smene (hronološki), statusi, ozbiljnost/prioritet, fiksni koraci,
 * prijave i stavke (hronološki), rezultati pretrage zaposlenih (najbolje poklapanje).
 *
 * Samo PREZENTACIJA: podaci i redosled iz baze se ne menjaju (sortira se kopija).
 */
const collator = new Intl.Collator('sr-Latn', { sensitivity: 'base', numeric: true });

export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return collator.compare(a ?? '', b ?? '');
}

/** Kopija niza sortirana po vidljivom nazivu (stabilno; nulti nazivi na kraj). */
export function sortByLabel<T>(items: readonly T[] | null | undefined, label: (item: T) => string | null | undefined): T[] {
  return [...(items ?? [])].sort((x, y) => {
    const a = label(x);
    const b = label(y);
    if (!a && b) return 1;
    if (a && !b) return -1;
    return compareText(a, b);
  });
}

export interface CenterLike {
  code: string;
  name?: string | null;
}

/** Centri: po NAZIVU centra A–Ž (ne po šifri); isti naziv → po šifri. */
export function sortCenters<T extends CenterLike>(centers: readonly T[] | null | undefined): T[] {
  return [...(centers ?? [])].sort((x, y) =>
    compareText(x.name || x.code, y.name || y.code) || compareText(x.code, y.code));
}

/** Prikaz centra u jednom redu: „B6 — Rakovica" (bez naziva: samo šifra). */
export function centerLabel(c: CenterLike): string {
  return c.name ? `${c.code} — ${c.name}` : c.code;
}
