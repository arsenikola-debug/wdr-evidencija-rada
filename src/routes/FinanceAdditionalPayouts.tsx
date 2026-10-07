import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import {
  INBOX_TABS,
  type InboxRow,
  type InboxStatus,
  type StopsQueueItem,
  mergeInbox,
  rowsFromPayouts,
  rowsFromStopsHistory,
  rowsFromStopsQueue,
} from '../features/finance/additionalInbox';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { WdrApiError } from '../lib/api';
import { formatDateTime, formatPeriod } from '../lib/format/date';
import { useAuth } from '../lib/auth/AuthProvider';

/**
 * Finansije → „Dodatne isplate": JEDNO mesto za sve dodatne isplate, uključujući
 * Stopove. Prikaz je objedinjen; pozadinski tokovi i detalji ostaju postojeći
 * (dodatne isplate: /finansije/dodatne-isplate/zahtev, Stopovi: /finansije/stopovi-kurira).
 */
export function FinanceAdditionalPayouts() {
  const { api, can } = useAuth();
  const [tab, setTab] = useState<InboxStatus>('SUBMITTED');
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    setRows(null);
    const notes: string[] = [];
    const all: InboxRow[] = [];
    const why = (err: unknown) => {
      const code = err instanceof WdrApiError ? err.code : null;
      return messageForCode(code, err instanceof Error ? err.message : undefined);
    };
    await Promise.all([
      can('payout.approve')
        ? api.payoutFinanceQueue([tab]).then((r) => { all.push(...rowsFromPayouts(r)); })
          .catch((e) => { notes.push(`Dodatne isplate: ${why(e)}`); })
        : Promise.resolve(),
      can('finance.queue.view')
        ? (tab === 'FINANCE_APPROVED'
          ? api.getFinanceHistory(undefined, null, null, ['COURIER_STOPS'])
            .then((h) => { all.push(...rowsFromStopsHistory(h.items)); })
          : api.courierStopFinanceQueue()
            .then((q) => { all.push(...rowsFromStopsQueue(q as StopsQueueItem[])); }))
          .catch((e) => { notes.push(`Stopovi: ${why(e)}`); })
        : Promise.resolve(),
    ]);
    setWarnings(notes);
    setRows(mergeInbox(all, tab));
  }, [api, can, tab]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page">
      <h1>Dodatne isplate</h1>
      <p className="muted small">
        Svi zahtevi za dodatne isplate na jednom mestu — Stopovi, Dnevnice, Ispomoć, Radna subota,
        Prekovremeni i Noćni rad. Otvorite zahtev za pregled i odobrenje.
      </p>
      {warnings.map((w) => <Banner key={w} kind="warning">{w}</Banner>)}

      <div className="entry-bar-tabs segmented" role="tablist" aria-label="Status">
        {INBOX_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={tab === t.key ? 'btn seg-active' : 'btn'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {!rows ? <Spinner label="Učitavanje…" /> : rows.length === 0 ? (
        <EmptyState title={tab === 'SUBMITTED' ? 'Nema zahteva koji čekaju odobrenje' : 'Nema zahteva'} />
      ) : (
        <div className="table-scroll">
          <table className="list list-compact">
            <thead>
              <tr>
                <th>Vrsta</th><th>Centar</th><th>Period</th>
                <th className="num">Zaposlenih</th><th className="num">Iznos</th>
                <th>{tab === 'FINANCE_APPROVED' ? 'Odobreno' : 'Poslato'}</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <span className={r.source === 'STOPS' ? 'chip chip-transport' : 'chip'}>{r.kind}</span>
                    {r.isCorrection && <span className="chip chip-warn"> Korekcija</span>}
                    {r.totalStops !== null && <span className="muted small"> · {r.totalStops} stopova</span>}
                  </td>
                  <td><strong>{r.centerCode}</strong></td>
                  <td>{formatPeriod(r.periodStart, r.periodEnd)}</td>
                  <td className="num">{r.employees ?? '—'}</td>
                  <td className="num">
                    {r.amount === null ? <span className="totals-warning">nepotpuno</span> : `${formatRsd(r.amount)} RSD`}
                  </td>
                  <td>{formatDateTime(r.submittedAt)}</td>
                  <td className="row-actions">
                    <Link className="btn btn-small" to={r.href}>
                      {r.status === 'SUBMITTED' ? 'Pregled i odobrenje' : 'Otvori'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
