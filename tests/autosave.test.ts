import { describe, expect, it } from 'vitest';
import { enqueue, queueKeys, type SaveQueue } from '../src/features/grid/useAutosave';
import type { BulkEntryInput } from '../src/lib/api/types';

const entry = (over: Partial<BulkEntryInput> = {}): BulkEntryInput => ({
  employee_id: 'e1', work_date: '2026-07-06', attendance_status: 'WORK', ...over,
});

describe('autosave queue', () => {
  it('keeps one row per cell', () => {
    let q: SaveQueue = new Map();
    q = enqueue(q, [entry(), entry({ employee_id: 'e2' })]);
    expect(q.size).toBe(2);
  });

  it('last write per cell wins', () => {
    let q: SaveQueue = new Map();
    q = enqueue(q, [entry({ shift_template_id: 't1' })]);
    q = enqueue(q, [entry({ attendance_status: 'GO', shift_template_id: null })]);
    expect(q.size).toBe(1);
    expect(q.get('e1|2026-07-06')?.attendance_status).toBe('GO');
  });

  it('a later delete replaces an earlier edit of the same cell', () => {
    let q: SaveQueue = new Map();
    q = enqueue(q, [entry()]);
    q = enqueue(q, [{ employee_id: 'e1', work_date: '2026-07-06', delete: true }]);
    expect(q.get('e1|2026-07-06')?.delete).toBe(true);
    expect(q.get('e1|2026-07-06')?.attendance_status).toBeUndefined();
  });

  it('exposes its keys in insertion order', () => {
    let q: SaveQueue = new Map();
    q = enqueue(q, [entry(), entry({ work_date: '2026-07-07' })]);
    expect(queueKeys(q)).toEqual(['e1|2026-07-06', 'e1|2026-07-07']);
  });

  it('does not mutate the queue it is given', () => {
    const q: SaveQueue = new Map();
    const next = enqueue(q, [entry()]);
    expect(q.size).toBe(0);
    expect(next.size).toBe(1);
  });
});
