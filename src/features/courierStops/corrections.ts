/**
 * Korekcije KOLIČINE stopova — čist model.
 *
 * Ovde ne postoji nijedna funkcija koja prima cenu kao KORISNIČKI unos. Cena je
 * uvek zamrznuta vrednost iz odobrenog obračuna koju server vraća; ovde se samo
 * prikazuje i koristi za informativni pregled.
 */

export type DeltaInput =
  | { kind: 'empty' }
  | { kind: 'value'; value: number }
  | { kind: 'error'; message: string };

export function parseDeltaInput(raw: string): DeltaInput {
  const text = raw.trim();
  if (text === '' || text === '-' || text === '+') return { kind: 'empty' };

  if (!/^[+-]?\d+$/.test(text)) {
    return { kind: 'error', message: 'Promena količine mora biti ceo broj.' };
  }
  const n = Number(text);
  // Nula nije korekcija. Da jeste, značila bi „ništa se ne menja", a onda
  // transakcija ne treba ni da postoji.
  if (n === 0) {
    return { kind: 'error',
      message: 'Korekcija mora da menja količinu: unesite pozitivan ili negativan broj.' };
  }
  return { kind: 'value', value: n };
}

export function directionLabel(delta: number): string {
  return delta > 0 ? 'Doplata' : 'Umanjenje';
}

export interface CorrectionPreview {
  delta: number;
  effectiveStops: number;
  amount: number;
  belowZero: boolean;
}

/**
 * Informativni pregled pre slanja. Server ostaje merodavan i ponovo računa
 * iznos iz zamrznute cene; ovo samo sprečava da operater pošalje nešto što će
 * sigurno biti odbijeno.
 */
export function correctionPreview(
  originalStops: number,
  delta: number,
  frozenRate: number,
  alreadyApprovedDelta = 0,
): CorrectionPreview {
  const effectiveStops = originalStops + alreadyApprovedDelta + delta;
  return {
    delta,
    effectiveStops,
    amount: Math.round(delta * frozenRate),
    belowZero: effectiveStops < 0,
  };
}
