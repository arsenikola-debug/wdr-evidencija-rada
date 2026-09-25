import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, buildCellIndex } from '../src/features/grid/model';
import { isReviewed } from '../src/features/grid/completion';
import type { GridPayload } from '../src/lib/api/types';

/**
 * „Ne radi" (NOT_WORKING) u gridu.
 *
 * Ispravka u bazi menja SEMANTIKU OBRAČUNA, ne prikaz. Ovaj test postoji da se
 * prikaz i pojam „pregledano" ne promene usput: prazna ćelija ostaje
 * nepregledana i blokira slanje, a NOT_WORKING je izričita operaterova odluka
 * koja kompletira pregled.
 */

function payload(cells: GridPayload['cells']): GridPayload {
  return { cells } as GridPayload;
}

const DAY = '2026-07-06';
const EMP = 'e1';

describe('Statusi bez naknade u gridu', () => {
  it('OFF se prikazuje kao SD i ostaje odvojen od NR', () => {
    expect(STATUS_LABEL.OFF).toBe('SD');
    expect(STATUS_LABEL.OFF).not.toBe(STATUS_LABEL.NOT_WORKING);
  });

  it('OFF se računa kao PREGLEDANO', () => {
    const idx = buildCellIndex(payload([
      { employee_id: EMP, work_date: DAY, attendance_status: 'OFF' },
    ] as GridPayload['cells']));
    expect(isReviewed(idx, EMP, DAY)).toBe(true);
  });

  it('prikazuje se kao NR', () => {
    expect(STATUS_LABEL.NOT_WORKING).toBe('NR');
  });

  it('ostaje razlikovan od GO, BO i slobodnog dana', () => {
    expect(new Set([
      STATUS_LABEL.WORK, STATUS_LABEL.GO, STATUS_LABEL.BO,
      STATUS_LABEL.OFF, STATUS_LABEL.NOT_WORKING,
    ]).size).toBe(5);
  });

  it('računa se kao PREGLEDANO', () => {
    const idx = buildCellIndex(payload([
      { employee_id: EMP, work_date: DAY, attendance_status: 'NOT_WORKING' },
    ] as GridPayload['cells']));
    expect(isReviewed(idx, EMP, DAY)).toBe(true);
  });

  it('prazna ćelija NIJE pregledana — to je i dalje blokada slanja', () => {
    const idx = buildCellIndex(payload([]));
    expect(isReviewed(idx, EMP, DAY)).toBe(false);
  });
});
