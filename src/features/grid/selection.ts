import type { GridEmployee, IsoDate } from '../../lib/api/types';
import { cellKey } from './model';

export interface CellRef {
  /** row = employee index */
  r: number;
  /** column = date index */
  c: number;
}

export interface Selection {
  anchor: CellRef;
  focus: CellRef;
}

export interface Rect {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export function singleCell(r: number, c: number): Selection {
  return { anchor: { r, c }, focus: { r, c } };
}

export function normalize(sel: Selection): Rect {
  return {
    r0: Math.min(sel.anchor.r, sel.focus.r),
    r1: Math.max(sel.anchor.r, sel.focus.r),
    c0: Math.min(sel.anchor.c, sel.focus.c),
    c1: Math.max(sel.anchor.c, sel.focus.c),
  };
}

export function isInSelection(sel: Selection, r: number, c: number): boolean {
  const n = normalize(sel);
  return r >= n.r0 && r <= n.r1 && c >= n.c0 && c <= n.c1;
}

export function selectionSize(sel: Selection): number {
  const n = normalize(sel);
  return (n.r1 - n.r0 + 1) * (n.c1 - n.c0 + 1);
}

export function selectionKeys(
  sel: Selection,
  employees: GridEmployee[],
  dates: IsoDate[],
): string[] {
  const n = normalize(sel);
  const keys: string[] = [];
  for (let r = n.r0; r <= n.r1; r += 1) {
    const emp = employees[r];
    if (!emp) continue;
    for (let c = n.c0; c <= n.c1; c += 1) {
      const d = dates[c];
      if (!d) continue;
      keys.push(cellKey(emp.employee_id, d));
    }
  }
  return keys;
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(v, max));
}

/**
 * Arrow / Tab / Enter movement. `extend` (Shift held) keeps the anchor so the
 * rectangle grows, which is what an Excel user expects.
 */
export function moveFocus(
  sel: Selection,
  dr: number,
  dc: number,
  rows: number,
  cols: number,
  extend: boolean,
): Selection {
  const focus: CellRef = {
    r: clamp(sel.focus.r + dr, rows - 1),
    c: clamp(sel.focus.c + dc, cols - 1),
  };
  return extend ? { anchor: sel.anchor, focus } : { anchor: focus, focus };
}

/**
 * Tab wraps to the next row's first column at the end of a row, so a whole
 * employee can be typed without touching the mouse.
 */
export function tabNext(sel: Selection, rows: number, cols: number, back: boolean): Selection {
  let { r, c } = sel.focus;
  if (back) {
    c -= 1;
    if (c < 0) {
      c = cols - 1;
      r = Math.max(0, r - 1);
    }
  } else {
    c += 1;
    if (c > cols - 1) {
      c = 0;
      r = Math.min(rows - 1, r + 1);
    }
  }
  const focus = { r, c };
  return { anchor: focus, focus };
}

export function selectAll(rows: number, cols: number): Selection {
  return { anchor: { r: 0, c: 0 }, focus: { r: rows - 1, c: cols - 1 } };
}

export function selectRow(r: number, cols: number): Selection {
  return { anchor: { r, c: 0 }, focus: { r, c: cols - 1 } };
}

export function selectColumn(c: number, rows: number): Selection {
  return { anchor: { r: 0, c }, focus: { r: rows - 1, c } };
}
