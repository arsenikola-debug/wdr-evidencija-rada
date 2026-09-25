import { describe, expect, it } from 'vitest';
import {
  isInSelection, moveFocus, normalize, selectAll, selectColumn, selectRow,
  selectionKeys, selectionSize, singleCell, tabNext,
} from '../src/features/grid/selection';
import type { GridEmployee } from '../src/lib/api/types';

const emp = (id: string): GridEmployee => ({
  employee_id: id, full_name: id, employee_code: null, home_center_code: 'B6',
  primary_payment_type_id: null, primary_payment_type_code: null,
  default_shift_template_id: null, transport_required: null, transport_provider_code: null,
});
const EMPLOYEES = [emp('e1'), emp('e2'), emp('e3')];
const DATES = ['2026-07-06', '2026-07-07', '2026-07-08'];

describe('selection rectangle', () => {
  it('normalizes regardless of drag direction', () => {
    expect(normalize({ anchor: { r: 2, c: 2 }, focus: { r: 0, c: 1 } })).toEqual({ r0: 0, r1: 2, c0: 1, c1: 2 });
  });

  it('counts cells', () => {
    expect(selectionSize(singleCell(1, 1))).toBe(1);
    expect(selectionSize({ anchor: { r: 0, c: 0 }, focus: { r: 1, c: 2 } })).toBe(6);
  });

  it('produces one key per selected cell', () => {
    const keys = selectionKeys({ anchor: { r: 0, c: 0 }, focus: { r: 1, c: 1 } }, EMPLOYEES, DATES);
    expect(keys).toEqual([
      'e1|2026-07-06', 'e1|2026-07-07', 'e2|2026-07-06', 'e2|2026-07-07',
    ]);
  });

  it('ignores out-of-range rows and columns', () => {
    const keys = selectionKeys({ anchor: { r: 0, c: 0 }, focus: { r: 9, c: 9 } }, EMPLOYEES, DATES);
    expect(keys).toHaveLength(9);
  });

  it('knows which cells are inside', () => {
    const sel = { anchor: { r: 1, c: 0 }, focus: { r: 2, c: 1 } };
    expect(isInSelection(sel, 1, 1)).toBe(true);
    expect(isInSelection(sel, 0, 0)).toBe(false);
  });
});

describe('keyboard movement', () => {
  it('moves and collapses without Shift', () => {
    const s = moveFocus(singleCell(0, 0), 1, 1, 3, 3, false);
    expect(s).toEqual({ anchor: { r: 1, c: 1 }, focus: { r: 1, c: 1 } });
  });

  it('extends and keeps the anchor with Shift', () => {
    const s = moveFocus(singleCell(1, 1), 1, 0, 3, 3, true);
    expect(s.anchor).toEqual({ r: 1, c: 1 });
    expect(s.focus).toEqual({ r: 2, c: 1 });
  });

  it('clamps at the edges instead of wrapping', () => {
    expect(moveFocus(singleCell(0, 0), -1, -1, 3, 3, false).focus).toEqual({ r: 0, c: 0 });
    expect(moveFocus(singleCell(2, 2), 5, 5, 3, 3, false).focus).toEqual({ r: 2, c: 2 });
  });

  it('Tab wraps to the next row at the end of a row', () => {
    expect(tabNext(singleCell(0, 2), 3, 3, false).focus).toEqual({ r: 1, c: 0 });
    expect(tabNext(singleCell(1, 0), 3, 3, true).focus).toEqual({ r: 0, c: 2 });
  });

  it('Tab stops at the last cell of the grid', () => {
    expect(tabNext(singleCell(2, 2), 3, 3, false).focus).toEqual({ r: 2, c: 0 });
  });
});

describe('bulk selection helpers', () => {
  it('selects everything', () => {
    expect(selectionSize(selectAll(3, 3))).toBe(9);
  });
  it('selects a row and a column', () => {
    expect(selectionKeys(selectRow(1, 3), EMPLOYEES, DATES)).toHaveLength(3);
    expect(selectionKeys(selectColumn(0, 3), EMPLOYEES, DATES)).toEqual([
      'e1|2026-07-06', 'e2|2026-07-06', 'e3|2026-07-06',
    ]);
  });
});
