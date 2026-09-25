import type { PreviewLine, PreviewLineKind } from '../../lib/api/types';

/**
 * Raščlanjenje stavki obračuna po VRSTI ISPLATE.
 *
 * Server vraća `totals.by_line_kind` samo na nivou kategorije
 * (PRIMARY / COMPONENT / TRANSPORT), a imena pojedinačnih komponenti postoje
 * isključivo na nivou `lines[]`. Zato se ovde grupišu već IZRAČUNATI serverski
 * iznosi — ništa se ne cenovniči, ne zaokružuje niti izvodi iz stope i količine.
 * To je prikaz, ne obračun.
 *
 * Linija bez pravila (`calculated_amount === null`) se NE računa kao nula: broji
 * se posebno, a kategorija se označi kao nepotpuna.
 */

export interface BreakdownRow {
  key: string;
  lineKind: PreviewLineKind;
  /** Šifra vrste isplate iz baze. Namerno se ne prevodi u tvrdo kodiran naziv. */
  code: string;
  units: number;
  /** Zbir izračunatih iznosa RESOLVED linija. */
  amount: number;
  resolvedLines: number;
  /** Linije koje server nije mogao da obračuna — iznos je nepoznat, ne nula. */
  blockedLines: number;
}

export interface BreakdownGroup {
  lineKind: PreviewLineKind;
  rows: BreakdownRow[];
  amount: number;
  blockedLines: number;
}

const KIND_ORDER: PreviewLineKind[] = ['PRIMARY', 'COMPONENT', 'TRANSPORT'];

export function breakdownByPaymentType(lines: PreviewLine[]): BreakdownGroup[] {
  const rows = new Map<string, BreakdownRow>();

  for (const l of lines) {
    const code = l.payment_type_code ?? '—';
    const key = `${l.line_kind}:${code}`;
    const row =
      rows.get(key) ??
      {
        key,
        lineKind: l.line_kind,
        code,
        units: 0,
        amount: 0,
        resolvedLines: 0,
        blockedLines: 0,
      };

    if (l.status === 'RESOLVED' && l.calculated_amount != null) {
      row.amount += l.calculated_amount;
      row.units += l.units;
      row.resolvedLines += 1;
    } else {
      row.blockedLines += 1;
    }

    rows.set(key, row);
  }

  const groups: BreakdownGroup[] = [];

  for (const kind of KIND_ORDER) {
    const own = [...rows.values()]
      .filter((r) => r.lineKind === kind)
      .sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code));
    if (own.length === 0) continue;
    groups.push({
      lineKind: kind,
      rows: own,
      amount: own.reduce((s, r) => s + r.amount, 0),
      blockedLines: own.reduce((s, r) => s + r.blockedLines, 0),
    });
  }

  // Kategorije koje nisu u poznatom redosledu ne smeju nestati iz prikaza.
  const known = new Set<string>(KIND_ORDER);
  const rest = [...rows.values()].filter((r) => !known.has(r.lineKind));
  for (const r of rest) {
    const g = groups.find((x) => x.lineKind === r.lineKind);
    if (g) {
      g.rows.push(r);
      g.amount += r.amount;
      g.blockedLines += r.blockedLines;
    } else {
      groups.push({
        lineKind: r.lineKind,
        rows: [r],
        amount: r.amount,
        blockedLines: r.blockedLines,
      });
    }
  }

  return groups;
}

/** Nepregledane ćelije grupisane po zaposlenom — duga lista postaje skenirajuća. */
export function groupMissingByEmployee<T extends { employee_id: string; employee_name: string; work_date: string }>(
  missing: T[],
): Array<{ employee_id: string; employee_name: string; dates: string[] }> {
  const map = new Map<string, { employee_id: string; employee_name: string; dates: string[] }>();
  for (const m of missing) {
    const cur =
      map.get(m.employee_id) ??
      { employee_id: m.employee_id, employee_name: m.employee_name, dates: [] };
    cur.dates.push(m.work_date);
    map.set(m.employee_id, cur);
  }
  return [...map.values()]
    .map((e) => ({ ...e, dates: [...e.dates].sort() }))
    .sort((a, b) => b.dates.length - a.dates.length || a.employee_name.localeCompare(b.employee_name));
}
