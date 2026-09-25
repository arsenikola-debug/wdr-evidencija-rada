import type { AttendanceStatusCode } from '../../lib/api/types';

export type GridAction =
  | { type: 'move'; dr: number; dc: number; extend: boolean }
  | { type: 'tab'; back: boolean }
  | { type: 'status'; code: AttendanceStatusCode }
  | { type: 'shiftIndex'; index: number }
  | { type: 'clear' }
  | { type: 'copyPrevDay' }
  | { type: 'copyPrevWeek' }
  | { type: 'selectAll' }
  | { type: 'selectRow' }
  | { type: 'selectColumn' }
  | { type: 'escape' }
  | { type: 'flush' }
  | { type: 'openCell' };

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Keyboard-first mapping for people coming from Excel.
 *
 * Letters use the Serbian words the operators already say out loud:
 *   G = godišnji odmor, B = bolovanje, S = slobodan dan, N = ne radi, R = rad.
 * Digits 1–9 pick the n-th shift template from the toolbar legend.
 */
export function mapKey(e: KeyEventLike): GridAction | null {
  const ctrl = Boolean(e.ctrlKey || e.metaKey);
  const shift = Boolean(e.shiftKey);

  if (ctrl) {
    switch (e.key.toLowerCase()) {
      case 'd':
        return shift ? { type: 'copyPrevWeek' } : { type: 'copyPrevDay' };
      case 'a':
        return { type: 'selectAll' };
      case 's':
        return { type: 'flush' };
      case 'arrowleft':
        return { type: 'selectRow' };
      case 'arrowup':
        return { type: 'selectColumn' };
      default:
        return null;
    }
  }

  switch (e.key) {
    case 'ArrowUp':
      return { type: 'move', dr: -1, dc: 0, extend: shift };
    case 'ArrowDown':
      return { type: 'move', dr: 1, dc: 0, extend: shift };
    case 'ArrowLeft':
      return { type: 'move', dr: 0, dc: -1, extend: shift };
    case 'ArrowRight':
      return { type: 'move', dr: 0, dc: 1, extend: shift };
    case 'Tab':
      return { type: 'tab', back: shift };
    case 'Enter':
      return { type: 'move', dr: shift ? -1 : 1, dc: 0, extend: false };
    case 'Delete':
    case 'Backspace':
      return { type: 'clear' };
    case 'Escape':
      return { type: 'escape' };
    case ' ':
      return { type: 'openCell' };
    default:
      break;
  }

  if (/^[1-9]$/.test(e.key)) {
    return { type: 'shiftIndex', index: Number(e.key) - 1 };
  }

  const letter = e.key.toLowerCase();
  const statusByLetter: Record<string, AttendanceStatusCode> = {
    g: 'GO',
    b: 'BO',
    s: 'OFF',
    n: 'NOT_WORKING',
    r: 'WORK',
    o: 'OTHER',
  };
  if (statusByLetter[letter]) return { type: 'status', code: statusByLetter[letter] };

  return null;
}

export const KEY_HELP: Array<{ keys: string; what: string }> = [
  { keys: '↑ ↓ ← →', what: 'kretanje' },
  { keys: 'Shift + strelice', what: 'proširivanje selekcije' },
  { keys: 'Tab / Shift+Tab', what: 'sledeća / prethodna ćelija' },
  { keys: 'Enter / Shift+Enter', what: 'dole / gore' },
  { keys: '1 – 9', what: 'šablon smene' },
  { keys: 'R', what: 'rad (podrazumevana smena)' },
  { keys: 'G', what: 'godišnji odmor' },
  { keys: 'B', what: 'bolovanje' },
  { keys: 'S', what: 'slobodan dan' },
  { keys: 'N', what: 'ne radi' },
  { keys: 'Delete', what: 'obriši izabrane ćelije' },
  { keys: 'Ctrl + D', what: 'kopiraj prethodni dan' },
  { keys: 'Ctrl + Shift + D', what: 'kopiraj prethodnu nedelju' },
  { keys: 'Ctrl + A', what: 'izaberi sve' },
  { keys: 'Ctrl + ←', what: 'izaberi red' },
  { keys: 'Ctrl + ↑', what: 'izaberi kolonu' },
  { keys: 'Ctrl + S', what: 'sačuvaj odmah' },
  { keys: 'Esc', what: 'otkaži selekciju' },
];
