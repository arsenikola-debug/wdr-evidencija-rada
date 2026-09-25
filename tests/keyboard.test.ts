import { describe, expect, it } from 'vitest';
import { mapKey } from '../src/features/grid/keyboard';

describe('keyboard mapping', () => {
  it('maps arrows, with and without Shift', () => {
    expect(mapKey({ key: 'ArrowDown' })).toEqual({ type: 'move', dr: 1, dc: 0, extend: false });
    expect(mapKey({ key: 'ArrowRight', shiftKey: true })).toEqual({ type: 'move', dr: 0, dc: 1, extend: true });
  });

  it('maps Enter down and Shift+Enter up', () => {
    expect(mapKey({ key: 'Enter' })).toEqual({ type: 'move', dr: 1, dc: 0, extend: false });
    expect(mapKey({ key: 'Enter', shiftKey: true })).toEqual({ type: 'move', dr: -1, dc: 0, extend: false });
  });

  it('maps Tab both ways', () => {
    expect(mapKey({ key: 'Tab' })).toEqual({ type: 'tab', back: false });
    expect(mapKey({ key: 'Tab', shiftKey: true })).toEqual({ type: 'tab', back: true });
  });

  it('maps Serbian status letters', () => {
    expect(mapKey({ key: 'g' })).toEqual({ type: 'status', code: 'GO' });
    expect(mapKey({ key: 'B' })).toEqual({ type: 'status', code: 'BO' });
    expect(mapKey({ key: 's' })).toEqual({ type: 'status', code: 'OFF' });
    expect(mapKey({ key: 'n' })).toEqual({ type: 'status', code: 'NOT_WORKING' });
    expect(mapKey({ key: 'r' })).toEqual({ type: 'status', code: 'WORK' });
  });

  it('maps digits to shift templates, zero-based', () => {
    expect(mapKey({ key: '1' })).toEqual({ type: 'shiftIndex', index: 0 });
    expect(mapKey({ key: '9' })).toEqual({ type: 'shiftIndex', index: 8 });
    expect(mapKey({ key: '0' })).toBeNull();
  });

  it('maps copy previous day and week', () => {
    expect(mapKey({ key: 'd', ctrlKey: true })).toEqual({ type: 'copyPrevDay' });
    expect(mapKey({ key: 'D', ctrlKey: true, shiftKey: true })).toEqual({ type: 'copyPrevWeek' });
  });

  it('supports Cmd on macOS the same way', () => {
    expect(mapKey({ key: 'a', metaKey: true })).toEqual({ type: 'selectAll' });
    expect(mapKey({ key: 's', metaKey: true })).toEqual({ type: 'flush' });
  });

  it('maps clear and escape', () => {
    expect(mapKey({ key: 'Delete' })).toEqual({ type: 'clear' });
    expect(mapKey({ key: 'Backspace' })).toEqual({ type: 'clear' });
    expect(mapKey({ key: 'Escape' })).toEqual({ type: 'escape' });
  });

  it('ignores keys with no meaning in the grid', () => {
    expect(mapKey({ key: 'F5' })).toBeNull();
    expect(mapKey({ key: 'x', ctrlKey: true })).toBeNull();
  });
});
