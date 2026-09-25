import { describe, expect, it } from 'vitest';
import {
  RULE_STATUS_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  comparisonText,
  hasActiveRules,
  inactiveRules,
  severityRank,
  sortFindings,
  statusChangeErrors,
  summaryCards,
} from '../src/features/controls/model';
import type {
  ControlFindingRow,
  ControlRule,
  ControlRunResponse,
} from '../src/lib/api/types';

const rule = (over: Partial<ControlRule>): ControlRule => ({
  rule_code: 'COST_VARIANCE_CENTER', name: 'Odstupanje troška', description: '',
  entity_type: 'CENTER', basis: 'ECONOMIC_WORK_DATE', requires_threshold: true,
  threshold_unit: 'PERCENT', default_severity: 'WARNING', enabled: false,
  threshold_value: null, severity: 'WARNING', valid_from: '2026-01-01',
  config_version: 1, notes: null, status: 'NOT_CONFIGURED', ...over,
});

const finding = (over: Partial<ControlFindingRow>): ControlFindingRow => ({
  id: 'f1', rule_code: 'COST_VARIANCE_CENTER', rule_name: 'Odstupanje troška',
  severity: 'WARNING', status: 'OPEN', entity_type: 'CENTER',
  employee_id: null, employee_name: null, center_code: 'B6', provider_code: null,
  related_date: null, period_from: '2026-07-01', period_to: '2026-07-31',
  iso_week: null, current_value: 100, comparison_value: 80, threshold_value: 20,
  variance_pct: 25, classification: 'COMPARABLE', message: 'Odstupanje',
  seen_count: 1, created_at: '2026-08-01T10:00:00Z', last_seen_at: '2026-08-01T10:00:00Z',
  ...over,
});

describe('terminologija', () => {
  it('koristi neutralne poslovne pojmove', () => {
    expect(SEVERITY_LABEL.HIGH).toBe('Visok prioritet');
    expect(STATUS_LABEL.DISMISSED).toBe('Odbačeno');
    // Nikad „prevara" ili „zloupotreba".
    const all = [...Object.values(SEVERITY_LABEL), ...Object.values(STATUS_LABEL)].join(' ');
    expect(all.toLowerCase()).not.toContain('prevar');
    expect(all.toLowerCase()).not.toContain('zloupotreb');
  });

  it('objašnjava zašto pravilo nije aktivno', () => {
    expect(RULE_STATUS_LABEL.NOT_CONFIGURED).toBe('Prag nije potvrđen');
  });
});

describe('redosled nalaza', () => {
  it('kritično ide pre visokog, pa upozorenja', () => {
    expect(severityRank('CRITICAL')).toBeLessThan(severityRank('HIGH'));
    expect(severityRank('HIGH')).toBeLessThan(severityRank('WARNING'));
  });

  it('sortira po prioritetu, pa po vremenu', () => {
    const out = sortFindings([
      finding({ id: 'a', severity: 'WARNING' }),
      finding({ id: 'b', severity: 'CRITICAL' }),
      finding({ id: 'c', severity: 'HIGH' }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('zbirne kartice', () => {
  it('bez pokrenute kontrole kažu da nije pokrenuta', () => {
    const cards = summaryCards(null);
    expect(cards.find((c) => c.key === 'last')?.value).toBe('nije pokrenuta');
    expect(cards.find((c) => c.key === 'open')?.value).toBe(0);
  });

  it('kritično i visoko se prikazuju zajedno kao visok prioritet', () => {
    const run = {
      run: null,
      summary: { open: 5, acknowledged: 1, resolved: 0, dismissed: 0,
                 critical: 1, high: 2, warning: 2, info: 0 },
      rules: [],
    } as unknown as ControlRunResponse;
    expect(summaryCards(run).find((c) => c.key === 'high')?.value).toBe(3);
  });
});

describe('neaktivna pravila', () => {
  it('razlikuje „prag nije potvrđen" od „isključeno"', () => {
    const out = inactiveRules([
      rule({ status: 'NOT_CONFIGURED' }),
      rule({ rule_code: 'X', status: 'DISABLED' }),
      rule({ rule_code: 'Y', status: 'ACTIVE' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].reason).toContain('Prag nije potvrđen');
    expect(out[1].reason).toContain('isključena');
  });

  it('zna da li ima ijedne aktivne kontrole', () => {
    expect(hasActiveRules([rule({ status: 'NOT_CONFIGURED' })])).toBe(false);
    expect(hasActiveRules([rule({ status: 'ACTIVE' })])).toBe(true);
  });
});

describe('odluka o nalazu', () => {
  it('rešavanje i odbacivanje traže obrazloženje', () => {
    expect(statusChangeErrors('RESOLVED', 'kratko')).toHaveLength(1);
    expect(statusChangeErrors('DISMISSED', '')).toHaveLength(1);
    expect(statusChangeErrors('RESOLVED', 'Provereno sa rukovodiocem centra.')).toEqual([]);
  });

  it('potvrda ne traži obrazloženje', () => {
    expect(statusChangeErrors('ACKNOWLEDGED', '')).toEqual([]);
  });
});

describe('prikaz poređenja', () => {
  it('procenat sa pragom', () => {
    expect(comparisonText(finding({}))).toBe('+25% (prag 20%)');
  });

  it('nova osnova ne dobija izmišljen procenat', () => {
    expect(comparisonText(finding({ classification: 'NEW_COST_BASE', variance_pct: null })))
      .toContain('nova osnova');
  });

  it('pad na nulu je imenovan', () => {
    expect(comparisonText(finding({ classification: 'NO_CURRENT_COST', variance_pct: -100 })))
      .toContain('nema troška');
  });

  it('limit bez procenta (npr. sati po nedelji)', () => {
    expect(comparisonText(finding({
      classification: 'NOT_APPLICABLE', variance_pct: null, threshold_value: 10,
    }))).toBe('limit 10');
  });

  it('bez poređenja prikazuje crticu', () => {
    expect(comparisonText(finding({
      classification: 'NOT_APPLICABLE', variance_pct: null, threshold_value: null,
    }))).toBe('—');
  });
});
