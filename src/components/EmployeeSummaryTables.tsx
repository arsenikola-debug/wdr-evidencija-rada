import { formatRsd } from '../features/grid/model';
import type { EmployeeSummaryGroup } from '../features/finance/employeeSummary';

const UNIT_HINT: Record<string, string> = {
  KARNET: 'dana',
  OBUKA: 'dana',
  DNEVNICA: 'dana',
  ISPOMOC: 'dana',
  PREKOVREMENI: 'sati',
  NOCNI_RAD: 'sati',
  STOPOVI: 'stopova',
  PREVOZ: 'dana',
};

/**
 * Zbir po zaposlenom za ceo period, po vrsti naknade (redizajn §7 i §21).
 * Prikazuje isključivo serverski izračunate iznose; stavka bez pravila se
 * ne pretvara u nulu nego se red označava kao nepotpun.
 */
export function EmployeeSummaryTables({
  groups,
  periodLabel,
}: {
  groups: EmployeeSummaryGroup[];
  periodLabel?: string;
}) {
  if (groups.length === 0) {
    return <p className="muted small">Nema obračunatih stavki.</p>;
  }
  return (
    <div className="employee-summary">
      {groups.map((g) => (
        <div key={g.key} className="summary-group">
          <h4>
            {g.label}{' '}
            <span className="muted">
              — {g.rows.length} zaposl. · {g.blockedLines > 0 ? 'nepotpuno' : formatRsd(g.amount)}
              {g.key === 'PREVOZ' ? ' (plaća se prevozniku, nije deo naknade zaposlenom)' : ''}
            </span>
          </h4>
          <div className="table-scroll">
            <table className="list list-compact">
              <thead>
                <tr>
                  <th>Zaposleni</th>
                  {periodLabel && <th>Period</th>}
                  <th className="num">Količina{UNIT_HINT[g.key] ? ` (${UNIT_HINT[g.key]})` : ''}</th>
                  <th className="num">Ukupno za period</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.employeeId} className={r.blockedLines > 0 ? 'row-muted' : ''}>
                    <td>
                      {r.employeeName}
                      {r.employeeCode && <span className="muted small"> · {r.employeeCode}</span>}
                    </td>
                    {periodLabel && <td>{periodLabel}</td>}
                    <td className="num">{r.units === 0 ? '—' : r.units}</td>
                    <td className="num">
                      {r.blockedLines > 0 ? (
                        <span className="chip chip-warn" title="Stavke bez konfigurisanog pravila">
                          nepotpuno ({r.blockedLines} bez pravila)
                        </span>
                      ) : (
                        formatRsd(r.amount)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Ukupno {g.label}</th>
                  {periodLabel && <th />}
                  <th className="num">{g.units === 0 ? '—' : g.units}</th>
                  <th className="num">{g.blockedLines > 0 ? 'nepotpuno' : formatRsd(g.amount)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
