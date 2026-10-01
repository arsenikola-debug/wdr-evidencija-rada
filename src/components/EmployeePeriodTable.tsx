import { formatRsd } from '../features/grid/model';
import type { EmployeePeriodRow } from '../features/finance/employeeSummary';

/**
 * Pregled po zaposlenom za ceo period (završni prolaz §5) — isti princip kao
 * Operator Preview: osnovni zbir, prevoz posebno, UKUPNO. Dnevne stavke su u
 * „Detalji" ispod, ne u osnovnom prikazu.
 */
export function EmployeePeriodTable({ rows, periodLabel }: { rows: EmployeePeriodRow[]; periodLabel: string }) {
  if (rows.length === 0) return <p className="muted small">Nema obračunatih stavki.</p>;
  const sum = (f: (r: EmployeePeriodRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const anyBlocked = rows.some((r) => r.blockedLines > 0);
  const anyOther = rows.some((r) => r.otherAmount !== 0);
  return (
    <div className="table-scroll">
      <table className="list list-compact period-table">
        <thead>
          <tr>
            <th>Zaposleni</th>
            <th>Karnet / Obuka</th>
            <th>Period</th>
            <th>Dani</th>
            <th className="num">Osnovno</th>
            {anyOther && <th className="num" title="Stavke po starom modelu (pre aktivacije Dodatnih isplata)">Ostalo</th>}
            <th className="num">Prevoz</th>
            <th className="num">UKUPNO</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className={r.blockedLines > 0 ? 'row-muted' : ''}>
              <td>{r.employeeName}{r.employeeCode && <span className="muted small"> · {r.employeeCode}</span>}</td>
              <td>{r.baseTypes.join(' + ') || '—'}</td>
              <td>{periodLabel}</td>
              <td className="small">
                {Object.entries(r.dayCounts).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}
              </td>
              <td className="num">{formatRsd(r.baseAmount)}</td>
              {anyOther && <td className="num">{r.otherAmount ? formatRsd(r.otherAmount) : '—'}</td>}
              <td className="num">{r.transportAmount ? formatRsd(r.transportAmount) : '—'}</td>
              <td className="num">
                <strong>
                  {r.blockedLines > 0 ? <span className="chip chip-warn">nepotpuno</span> : `${formatRsd(r.total)} RSD`}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="period-total">
            <td colSpan={4}>UKUPNO ({rows.length} zaposl.)</td>
            <td className="num">{formatRsd(sum((r) => r.baseAmount))}</td>
            {anyOther && <td className="num">{formatRsd(sum((r) => r.otherAmount))}</td>}
            <td className="num">{formatRsd(sum((r) => r.transportAmount))}</td>
            <td className="num"><strong>{anyBlocked ? 'nepotpuno' : `${formatRsd(sum((r) => r.total))} RSD`}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
