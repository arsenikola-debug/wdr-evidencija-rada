import { describe, expect, it } from 'vitest';
import { decidePeriodReuse } from '../src/features/periods/reuse';
import { MockWdrApi } from '../src/lib/api/mockApi';
import { WdrApiError } from '../src/lib/api/WdrApi';
import type { SubmissionStatus } from '../src/lib/api/types';

/**
 * Pravilo koje ovi testovi čuvaju: ponovni izbor istog centra i raspona u
 * „Novi unos" nije uvek nastavak rada. Poslata i odobrena prijava se NE
 * otvaraju kao nov unos — ekran bi inače rekao „otvorena je postojeća" nad
 * periodom koji operater ne sme da menja.
 */

const CENTER_B6 = '10000000-0000-0000-0000-0000000000b6';

describe('decidePeriodReuse — rad se nastavlja samo nad otvorenom prijavom', () => {
  it('DRAFT se nastavlja', () => {
    const d = decidePeriodReuse('DRAFT');
    expect(d.kind).toBe('reuse');
    expect(d.kind === 'reuse' && d.message).toContain('nastavite rad');
  });

  it('RETURNED se nastavlja kao ispravka iste prijave', () => {
    const d = decidePeriodReuse('RETURNED');
    expect(d.kind).toBe('reuse');
    expect(d.kind === 'reuse' && d.message).toContain('ispravku iste prijave');
  });

  it('READY_FOR_REVIEW se može otvoriti', () => {
    expect(decidePeriodReuse('READY_FOR_REVIEW').kind).toBe('reuse');
  });

  it('SUBMITTED se ne otvara kao nov unos', () => {
    const d = decidePeriodReuse('SUBMITTED');
    expect(d.kind).toBe('blocked');
    expect(d.kind === 'blocked' && d.code).toBe('PERIOD_ALREADY_SUBMITTED');
    expect(d.kind === 'blocked' && d.message).not.toContain('otvorena je postojeća');
  });

  it('FINANCE_APPROVED je zaključan i upućuje na Korekcije', () => {
    const d = decidePeriodReuse('FINANCE_APPROVED');
    expect(d.kind).toBe('blocked');
    expect(d.kind === 'blocked' && d.code).toBe('PERIOD_LOCKED_APPROVED');
    expect(d.kind === 'blocked' && d.message).toContain('Korekcije');
  });

  it('CLOSED je takođe zaključan', () => {
    const d = decidePeriodReuse('CLOSED');
    expect(d.kind).toBe('blocked');
    expect(d.kind === 'blocked' && d.code).toBe('PERIOD_LOCKED_APPROVED');
  });

  it('nepoznat status se ne tumači kao slobodno', () => {
    const d = decidePeriodReuse('NESTO_NOVO' as SubmissionStatus);
    expect(d.kind).toBe('blocked');
    expect(d.kind === 'blocked' && d.code).toBe('PERIOD_STATUS_UNKNOWN');
  });

  it('nijedna poruka ne kaže „otvorena je postojeća" za zaključan period', () => {
    for (const st of ['SUBMITTED', 'FINANCE_APPROVED', 'CLOSED'] as SubmissionStatus[]) {
      const d = decidePeriodReuse(st);
      expect(d.kind).toBe('blocked');
    }
  });
});

async function signedInMock(demoRates = false): Promise<MockWdrApi> {
  const api = new MockWdrApi({ role: 'operator', demoRates });
  await api.signIn('operater@wdr.local', 'mock1234');
  return api;
}

describe('MockWdrApi.createPeriodSubmission', () => {
  it('otvara nov raspon i vraća created=true', async () => {
    const api = await signedInMock();
    const res = await api.createPeriodSubmission(CENTER_B6, '2026-10-01', '2026-10-07');
    expect(res.created).toBe(true);
    expect(res.status).toBe('DRAFT');
    expect(res.center_code).toBe('B6');
  });

  it('isti raspon u DRAFT-u vraća postojeću prijavu, bez duplikata', async () => {
    const api = await signedInMock();
    const first = await api.createPeriodSubmission(CENTER_B6, '2026-10-01', '2026-10-07');
    const again = await api.createPeriodSubmission(CENTER_B6, '2026-10-01', '2026-10-07');
    expect(again.created).toBe(false);
    expect(again.submission_id).toBe(first.submission_id);

    const list = await api.listSubmissions();
    const matching = list.filter(
      (s) => s.period_start === '2026-10-01' && s.period_end === '2026-10-07',
    );
    expect(matching).toHaveLength(1);
  });

  it('poslata prijava se ne otvara kao nov unos', async () => {
    // demoRates: bez konfigurisanih stopa obračun ima blokirajuće stavke, pa se
    // period ne može poslati ni u pravom sistemu.
    const api = await signedInMock(true);
    const seeded = (await api.listSubmissions())[0];

    // Prijava se šalje tek kada je kompletna, pa se prvo popune svi očekivani
    // dani. Koristi se GO, jer odsustvo ne traži unetu smenu.
    const grid = await api.getGrid(seeded.id);
    const expectedDates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
    // Zasejane ćelije se preskaču: jedna od njih nosi ispomoć drugog centra i
    // ne sme da se pregazi odsustvom.
    const taken = new Set(grid.cells.map((c) => `${c.employee_id}|${c.work_date}`));
    await api.bulkUpsert(
      seeded.id,
      grid.employees.flatMap((e) =>
        expectedDates
          .filter((d) => !taken.has(`${e.employee_id}|${d}`))
          .map((d) => ({
            employee_id: e.employee_id,
            work_date: d,
            attendance_status: 'GO' as const,
          })),
      ),
      true,
    );
    // Upozorenja se potvrđuju pre slanja, kao i u pravom toku.
    const preview = await api.getSubmissionPreview(seeded.id);
    const open = preview.warnings.filter((w) => !w.acknowledged).map((w) => w.fingerprint);
    if (open.length > 0) await api.acknowledgeWarnings(seeded.id, open);

    const sent = await api.submitPeriod(seeded.id, true);
    expect(sent.incomplete_override).toBe(false);

    await expect(
      api.createPeriodSubmission(CENTER_B6, seeded.period_start, seeded.period_end),
    ).rejects.toMatchObject({ code: 'PERIOD_ALREADY_SUBMITTED' });
  });

  it('preklapanje sa DRUGIM rasponom daje PERIOD_OVERLAPS_EXISTING', async () => {
    const api = await signedInMock();
    await api.createPeriodSubmission(CENTER_B6, '2026-10-01', '2026-10-07');

    await expect(
      api.createPeriodSubmission(CENTER_B6, '2026-10-05', '2026-10-12'),
    ).rejects.toMatchObject({ code: 'PERIOD_OVERLAPS_EXISTING' });
  });

  it('obrnut raspon i predugačak raspon imaju svoje kodove', async () => {
    const api = await signedInMock();

    await expect(
      api.createPeriodSubmission(CENTER_B6, '2026-11-10', '2026-11-01'),
    ).rejects.toMatchObject({ code: 'PERIOD_RANGE_INVALID' });

    await expect(
      api.createPeriodSubmission(CENTER_B6, '2026-11-01', '2027-02-01'),
    ).rejects.toMatchObject({ code: 'PERIOD_RANGE_TOO_LONG' });
  });

  it('centar bez prava pisanja se odbija', async () => {
    const api = await signedInMock();
    await expect(
      api.createPeriodSubmission(
        '10000000-0000-0000-0000-0000000000b2',
        '2026-12-01',
        '2026-12-07',
      ),
    ).rejects.toBeInstanceOf(WdrApiError);
  });
});
