import type {
  ControlFindingRow,
  ControlFindingStatus,
  ControlRule,
  ControlRunResponse,
  ControlSeverity,
} from '../../lib/api/types';

/**
 * Presentation logic for the Control Center.
 *
 * Wording is deliberately neutral: a finding is an odstupanje that deserves a
 * look, never an accusation. Nothing here decides anything — the scan runs in
 * PostgreSQL and only ever writes findings.
 */

export const SEVERITY_LABEL: Record<ControlSeverity, string> = {
  CRITICAL: 'Kritično',
  HIGH: 'Visok prioritet',
  WARNING: 'Upozorenje',
  INFO: 'Informacija',
};

export const STATUS_LABEL: Record<ControlFindingStatus, string> = {
  OPEN: 'Otvoreno',
  ACKNOWLEDGED: 'Potvrđeno',
  RESOLVED: 'Rešeno',
  DISMISSED: 'Odbačeno',
};

export const RULE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Aktivno',
  DISABLED: 'Isključeno',
  // Podržano, ali prag nije potvrđen — pravilo se NE aktivira sa izmišljenom vrednošću.
  NOT_CONFIGURED: 'Prag nije potvrđen',
};

/** Order for display: the most material first, never alphabetical. */
export const SEVERITY_ORDER: ControlSeverity[] = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'];

export function severityRank(s: ControlSeverity): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

export function sortFindings(rows: ControlFindingRow[]): ControlFindingRow[] {
  return [...rows].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return b.last_seen_at.localeCompare(a.last_seen_at);
  });
}

export interface SummaryCard {
  key: string;
  label: string;
  value: number | string;
  emphasis: 'high' | 'warning' | 'neutral';
}

export function summaryCards(run: ControlRunResponse | null): SummaryCard[] {
  const s = run?.summary;
  return [
    { key: 'open', label: 'Otvorene kontrole', value: s?.open ?? 0, emphasis: 'neutral' },
    { key: 'high', label: 'Visok prioritet',
      value: (s?.critical ?? 0) + (s?.high ?? 0), emphasis: 'high' },
    { key: 'warning', label: 'Upozorenja', value: s?.warning ?? 0, emphasis: 'warning' },
    { key: 'ack', label: 'Potvrđeno', value: s?.acknowledged ?? 0, emphasis: 'neutral' },
    {
      key: 'last',
      label: 'Poslednja kontrola',
      value: run?.run?.completed_at
        ? new Date(run.run.completed_at).toLocaleString('sr-Latn-RS')
        : 'nije pokrenuta',
      emphasis: 'neutral',
    },
  ];
}

/**
 * Which rules did not run, and why.
 *
 * A rule without a confirmed threshold is not a defect — it is a decision that
 * has not been made yet, and the UI should say exactly that.
 */
export function inactiveRules(rules: ControlRule[]): Array<{ rule: ControlRule; reason: string }> {
  return rules
    .filter((r) => r.status !== 'ACTIVE')
    .map((r) => ({
      rule: r,
      reason: r.status === 'NOT_CONFIGURED'
        ? 'Prag nije potvrđen — kontrola se ne aktivira sa pretpostavljenom vrednošću.'
        : 'Kontrola je isključena u administraciji.',
    }));
}

/** A decision that closes a finding must be explained. */
export function statusChangeErrors(
  status: ControlFindingStatus, comment: string,
): string[] {
  if ((status === 'RESOLVED' || status === 'DISMISSED') && comment.trim().length < 10) {
    return ['Obrazloženje je obavezno (najmanje 10 znakova).'];
  }
  return [];
}

/** How a comparison should read, without inventing a percentage. */
export function comparisonText(row: Pick<ControlFindingRow,
  'current_value' | 'comparison_value' | 'threshold_value' | 'variance_pct'
  | 'classification'>): string {
  if (row.classification === 'NEW_COST_BASE') {
    return 'nova osnova (prethodno bez troška) — procenat se ne računa';
  }
  if (row.classification === 'NO_CURRENT_COST') {
    return 'nema troška u tekućem periodu';
  }
  if (row.variance_pct !== null && row.variance_pct !== undefined) {
    const sign = row.variance_pct > 0 ? '+' : '−';
    return `${sign}${Math.abs(row.variance_pct)}%`
      + (row.threshold_value !== null ? ` (prag ${row.threshold_value}%)` : '');
  }
  if (row.threshold_value !== null && row.threshold_value !== undefined) {
    return `limit ${row.threshold_value}`;
  }
  return '—';
}

export function hasActiveRules(rules: ControlRule[]): boolean {
  return rules.some((r) => r.status === 'ACTIVE');
}
