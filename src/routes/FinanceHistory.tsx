import { useCallback, useEffect, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatRsd } from '../features/grid/model';
import { WdrApiError } from '../lib/api';
import { useAuth } from '../lib/auth/AuthProvider';

interface HistoryItem {
  transaction_type: 'PERIOD' | 'ADJUSTMENT' | 'COURIER_STOPS' | 'COURIER_STOP_ADJUSTMENT';
  transaction_type_label: string;
  source_type: string;
  snapshot_id: string;
  center_code: string;
  economic_period_start: string;
  economic_period_end: string;
  approved_at: string;
  approved_by: string | null;
  submitted_by: string | null;
  approved_amount: number;
  total_stops?: number | null;
  content_hash?: string | null;
}

const TABS: Array<{ label: string; types: string[] | null }> = [
  { label: 'Sve', types: null },
  { label: 'Obračun perioda', types: ['PERIOD'] },
  { label: 'Stopovi kurira', types: ['COURIER_STOPS'] },
  { label: 'Korekcije stopova', types: ['COURIER_STOP_ADJUSTMENT'] },
  { label: 'Dodatni zahtevi', types: ['ADJUSTMENT'] },
];

/**
 * Jedna istorija Finansija za sve izvore. Drugi sistem istorije se namerno ne
 * pravi — `transaction_type` je jedini kriterijum razdvajanja.
 *
 * Datum transakcije je datum ODOBRENJA. Ekonomska pripadnost je datum rada, pa
 * se prikazuje odvojeno i ne meša sa datumom transakcije.
 */
export function FinanceHistory() {
  const { api } = useAuth();
  const [tab, setTab] = useState(0);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      const res = await api.getFinanceHistory(
        undefined, undefined, undefined,
        TABS[tab].types as Array<
        'PERIOD' | 'ADJUSTMENT' | 'COURIER_STOPS' | 'COURIER_STOP_ADJUSTMENT'> | null,
      );
      setItems(res.items as unknown as HistoryItem[]);
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api, tab]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Istorija obračuna</h1>
          <p className="muted">Odobrenja obračuna i stopova, po vrsti i periodu.</p>
        </div>
      </div>

      <div className="filter-row tabs">
        {TABS.map((t, i) => (
          <button key={t.label} type="button"
            className={i === tab ? 'btn btn-primary' : 'btn btn-quiet'}
            onClick={() => setTab(i)}>{t.label}</button>
        ))}
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!items && !error && <Spinner label="Učitavanje istorije…" />}

      {items && items.length === 0 && (
        <EmptyState title="Nema odobrenja u ovom pregledu."
          hint="Istorija se gradi iz odobrenja Finansija." />
      )}

      {items && items.length > 0 && (
        <table className="list">
          <thead>
            <tr><th>Vrsta</th><th>Odobreno</th><th>Centar</th>
              <th>Ekonomski period</th><th>Stopova</th><th>Odobreni iznos</th>
              <th>Poslao</th><th>Odobrio</th></tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.snapshot_id}>
                <td>
                  <span className={
                    h.transaction_type === 'COURIER_STOPS' ? 'chip chip-transport'
                      : h.transaction_type === 'COURIER_STOP_ADJUSTMENT' ? 'chip chip-warn'
                        : 'chip'}>
                    {h.transaction_type_label}
                  </span>
                </td>
                <td>{h.approved_at.slice(0, 16).replace('T', ' ')}</td>
                <td>{h.center_code}</td>
                <td>{h.economic_period_start} – {h.economic_period_end}</td>
                <td>{h.total_stops ?? '—'}</td>
                <td>{formatRsd(h.approved_amount)}</td>
                <td>{h.submitted_by ?? '—'}</td>
                <td>{h.approved_by ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted small">
        Datum transakcije je datum odobrenja. Ekonomska pripadnost ide po datumu
        rada iz snapshot-a, pa odobrenje koje prelazi mesec ostaje jedna
        transakcija, a u analitici se deli po mesecima. Odobreni iznosi se čitaju
        iz nepromenljivih snapshot-a i ne preračunavaju se tekućim cenama.
      </p>
    </div>
  );
}
