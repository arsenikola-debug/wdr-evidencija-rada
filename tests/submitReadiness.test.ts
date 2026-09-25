import { describe, expect, it } from 'vitest';
import { MockWdrApi } from '../src/lib/api/mockApi';
import { WdrApiError } from '../src/lib/api/WdrApi';

const SUB = '66666666-6666-6666-6666-666666666601';
const SHIFT_06_14 = 's1';

/**
 * These run against the mock adapter, which reproduces the server's submission
 * controls. The authoritative versions live in 98_submit_period_test.sql; the
 * point here is that the UI cannot be built against a laxer contract.
 */
/**
 * Rates are enabled for the tests that must reach a successful submit: without a
 * configured rate every monetary line is MISSING_RULE and the period genuinely
 * cannot be sent — which is the correct day-one behaviour, not a test bug.
 */
function withRates(): MockWdrApi {
  return new MockWdrApi({ demoRates: true });
}

async function fillAllExpected(api: MockWdrApi) {
  const grid = await api.getGrid(SUB);
  const preview = await api.getSubmissionPreview(SUB);
  const entries = preview.completeness.missing.map((m) => ({
    employee_id: m.employee_id,
    work_date: m.work_date,
    attendance_status: 'WORK' as const,
    shift_template_id: SHIFT_06_14,
  }));
  await api.bulkUpsert(grid.submission.id, entries, true);
}

describe('submission readiness comes from the server, not the browser', () => {
  it('reports missing expected employee-days', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    const p = await api.getSubmissionPreview(SUB);
    expect(p.completeness.expected_count).toBeGreaterThan(0);
    expect(p.completeness.missing_count).toBeGreaterThan(0);
    expect(p.completeness.missing[0]).toHaveProperty('employee_name');
    expect(p.ready_to_submit).toBe(false);
  });

  it('lists INCOMPLETE_EXPECTED_ENTRIES as a hard error, not a warning', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    const p = await api.getSubmissionPreview(SUB);
    expect(p.hard_errors.map((e) => e.code)).toContain('INCOMPLETE_EXPECTED_ENTRIES');
    expect(p.warnings.map((w) => w.code)).not.toContain('INCOMPLETE_EXPECTED_ENTRIES');
  });

  it('refuses to submit while expected cells are empty', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    await expect(api.submitPeriod(SUB, true)).rejects.toThrow(/INCOMPLETE_EXPECTED_ENTRIES/);
  });

  it('refuses the override without the permission', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    await expect(
      api.submitPeriod(SUB, true, 'Obrazlozenje koje je dovoljno dugo za validaciju.'),
    ).rejects.toThrow(/INCOMPLETE_OVERRIDE_DENIED/);
  });

  it('refuses to submit without review confirmation', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    await expect(api.submitPeriod(SUB, false)).rejects.toThrow(/Potvrda pregleda/);
  });

  it('counts an explicit NOT_WORKING day as reviewed', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    const before = await api.getSubmissionPreview(SUB);
    const first = before.completeness.missing[0];
    await api.bulkUpsert(SUB, [
      { employee_id: first.employee_id, work_date: first.work_date, attendance_status: 'NOT_WORKING' },
    ], true);
    const after = await api.getSubmissionPreview(SUB);
    expect(after.completeness.missing_count).toBe(before.completeness.missing_count - 1);
  });

  it('blocks submission on unacknowledged warnings, then allows it', async () => {
    const api = withRates();
    await api.signIn('op@wdr.local', 'mock1234');
    await fillAllExpected(api);

    const p1 = await api.getSubmissionPreview(SUB);
    expect(p1.completeness.missing_count).toBe(0);
    expect(p1.unacknowledged_warning_count).toBeGreaterThan(0);
    expect(p1.ready_to_submit).toBe(false);
    await expect(api.submitPeriod(SUB, true)).rejects.toThrow(/nepotvrđeno/);

    const open = p1.warnings.filter((w) => !w.acknowledged).map((w) => w.fingerprint);
    expect(await api.acknowledgeWarnings(SUB, open)).toBe(open.length);

    const p2 = await api.getSubmissionPreview(SUB);
    expect(p2.unacknowledged_warning_count).toBe(0);
    expect(p2.ready_to_submit).toBe(true);

    const res = await api.submitPeriod(SUB, true);
    expect(res.status).toBe('SUBMITTED');
    expect(res.incomplete_override).toBe(false);
    expect(res.missing_count).toBe(0);
  });

  it('a stale fingerprint is not accepted as an acknowledgement', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    const fake = 'f'.repeat(64);
    expect(await api.acknowledgeWarnings(SUB, [fake])).toBe(0);
  });

  it('locks the grid for entry after submission', async () => {
    const api = withRates();
    await api.signIn('op@wdr.local', 'mock1234');
    await fillAllExpected(api);
    const p = await api.getSubmissionPreview(SUB);
    await api.acknowledgeWarnings(SUB, p.warnings.map((w) => w.fingerprint));
    await api.submitPeriod(SUB, true);

    const grid = await api.getGrid(SUB);
    expect(grid.submission.status).toBe('SUBMITTED');
    expect(grid.submission.editable).toBe(false);
  });

  it('surfaces a named code the UI can translate', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    try {
      await api.submitPeriod(SUB, true);
      throw new Error('expected a rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(WdrApiError);
      expect((err as WdrApiError).code).toBe('INCOMPLETE_EXPECTED_ENTRIES');
    }
  });

  it('never reports a total while a monetary rule is missing', async () => {
    const api = new MockWdrApi();
    await api.signIn('op@wdr.local', 'mock1234');
    const p = await api.getSubmissionPreview(SUB);
    expect(p.totals.is_complete).toBe(false);
    expect(p.totals.total_calculated_amount).toBeNull();
    expect(p.totals.resolved_subtotal).toBe(0);
  });

  it('refuses to submit while a monetary rule is unresolved', async () => {
    const api = new MockWdrApi();          // no rates configured
    await api.signIn('op@wdr.local', 'mock1234');
    await fillAllExpected(api);
    const p = await api.getSubmissionPreview(SUB);
    await api.acknowledgeWarnings(SUB, p.warnings.map((w) => w.fingerprint));
    await expect(api.submitPeriod(SUB, true)).rejects.toThrow(/pravila obračuna/);
  });
});
