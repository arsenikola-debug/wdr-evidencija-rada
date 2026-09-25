import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import type { SubmissionListItem, SubmissionStatus } from '../lib/api/types';
import { Banner, EmptyState, Spinner, StatusBadge } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatDay } from '../features/analytics/period';

/**
 * Moji unosi — životni ciklus perioda.
 *
 * DRAFT / RETURNED su jedini statusi u kojima se uređuje. Sve ostalo je samo
 * pregled: ovo je UX ogledalo pravila koje sprovode `submission_transitions` i
 * operativno zaključavanje u bazi. Ekran ništa ne otključava.
 *
 * Odobren period se NE otvara ponovo — naknadne izmene idu kroz Korekcije.
 */

type Filter = 'sve' | 'u-radu' | 'poslato' | 'vraceno' | 'odobreno';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'sve', label: 'Sve' },
  { key: 'u-radu', label: 'U izradi' },
  { key: 'poslato', label: 'Poslato' },
  { key: 'vraceno', label: 'Vraćeno' },
  { key: 'odobreno', label: 'Odobreno' },
];

const EDITABLE: SubmissionStatus[] = ['DRAFT', 'RETURNED'];

function matches(status: SubmissionStatus, f: Filter): boolean {
  switch (f) {
    case 'u-radu':
      return status === 'DRAFT' || status === 'READY_FOR_REVIEW';
    case 'poslato':
      return status === 'SUBMITTED';
    case 'vraceno':
      return status === 'RETURNED';
    case 'odobreno':
      return status === 'FINANCE_APPROVED' || status === 'CLOSED';
    default:
      return true;
  }
}

export function MySubmissions() {
  const { api, can } = useAuth();
  const [items, setItems] = useState<SubmissionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('sve');

  const canCreate = can('period.create') || can('entry.edit_draft');
  const canCorrect = can('adjustment.create');

  const load = useCallback(() => {
    let alive = true;
    api
      .listSubmissions()
      .then((r) => {
        if (alive) setItems(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(messageForCode(null, e instanceof Error ? e.message : undefined));
      });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(load, [load]);

  const sorted = useMemo(
    () => [...(items ?? [])].sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [items],
  );
  const visible = sorted.filter((s) => matches(s.status, filter));
  const returnedCount = sorted.filter((s) => s.status === 'RETURNED').length;

  const head = (
    <div className="preview-head">
      <div>
        <h1>Moji unosi</h1>
        <p className="muted">
          Obračunski periodi po centru. Uređuju se samo periodi u izradi i vraćeni na
          ispravku.
        </p>
      </div>
      {canCreate && (
        <div className="page-head-actions">
          <Link className="btn btn-primary" to="/unos/novi">
            Novi unos
          </Link>
        </div>
      )}
    </div>
  );

  if (error) {
    return (
      <div className="page">
        {head}
        <Banner kind="error">{error}</Banner>
      </div>
    );
  }
  if (!items) {
    return (
      <div className="page">
        {head}
        <Spinner label="Učitavanje prijava…" />
      </div>
    );
  }

  return (
    <div className="page">
      {head}

      {returnedCount > 0 && (
        <Banner kind="warning">
          {returnedCount === 1
            ? 'Jedna prijava je vraćena na ispravku.'
            : `${returnedCount} prijava je vraćeno na ispravku.`}{' '}
          Ispravite i pošaljite ponovo istu prijavu — ne otvara se novi period.
        </Banner>
      )}

      <div className="filter-row tabs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={f.key === filter ? 'btn btn-primary' : 'btn btn-quiet'}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="Nema nijednog perioda"
          hint={
            canCreate
              ? 'Otvorite novi obračunski period da biste počeli unos.'
              : 'Obratite se administratoru za otvaranje perioda.'
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Nema perioda u ovom filteru" hint="Promenite filter iznad." />
      ) : (
        <table className="list">
          <thead>
            <tr>
              <th>Centar</th>
              <th>Period</th>
              <th>Status</th>
              <th>Napomena</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const editable = EDITABLE.includes(s.status);
              const approved = s.status === 'FINANCE_APPROVED' || s.status === 'CLOSED';
              return (
                <tr key={s.id} className={s.status === 'RETURNED' ? 'row-error' : ''}>
                  <td>
                    <strong>{s.center_code}</strong>
                  </td>
                  <td>
                    <span className="period-range">
                      {formatDay(s.period_start)} – {formatDay(s.period_end)}
                    </span>
                    <span className="muted small period-label">{s.period_label}</span>
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="muted small">
                    {s.status === 'RETURNED' && s.return_reason
                      ? s.return_reason
                      : approved
                        ? 'Zaključano — izmene idu kroz Korekcije.'
                        : '—'}
                  </td>
                  <td>
                    <div className="row-actions">
                      {editable ? (
                        <Link className="btn" to={`/unos?prijava=${s.id}`}>
                          {s.status === 'RETURNED' ? 'Ispravi' : 'Nastavi unos'}
                        </Link>
                      ) : (
                        <Link className="btn btn-quiet" to={`/unos?prijava=${s.id}`}>
                          Pregled
                        </Link>
                      )}
                      {approved && canCorrect && (
                        <Link className="btn btn-quiet" to="/dodatni-zahtevi">
                          Korekcija
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
