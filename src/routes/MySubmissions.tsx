import { BaseTypeChip } from '../components/BaseTypeChip';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import type { SubmissionListItem, SubmissionStatus } from '../lib/api/types';
import { Banner, EmptyState, Spinner, StatusBadge } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { formatDay } from '../features/analytics/period';
import { DELETE_DRAFT_CONFIRM, canDeleteOwnDraft } from '../features/entry/drafts';
import { formatPeriod } from '../lib/format/date';
import { WdrApiError } from '../lib/api';

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
  const { api, can, session } = useAuth();
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

  // 0077: brisanje SAMO nikad-poslatog nacrta; server proverava status i prava ponovo.
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  async function deleteDraft(s: SubmissionListItem) {
    if (!window.confirm(DELETE_DRAFT_CONFIRM)) return;
    setDeletingId(s.id);
    setNotice(null);
    try {
      await api.deleteDraftSubmission(s.id);
      setItems(await api.listSubmissions());
      setNotice({ kind: 'success', text: `Nacrt ${s.center_code} · ${formatPeriod(s.period_start, s.period_end)} je obrisan.` });
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setNotice({ kind: 'error', text: messageForCode(code, err instanceof Error ? err.message : undefined) });
    } finally {
      setDeletingId(null);
    }
  }

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
          <Link className="btn btn-primary" to="/unos">
            Unos
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

      {notice && <Banner kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Banner>}

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
                    <strong>{s.center_code}</strong> <BaseTypeChip type={s.base_type} />
                  </td>
                  <td>
                    <span className="period-range">
                      {formatDay(s.period_start)} – {formatDay(s.period_end)}
                    </span>
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
                      {canDeleteOwnDraft(s, session?.profile_id) && can('entry.edit_draft') && (
                        <button type="button" className="btn btn-danger"
                          disabled={deletingId === s.id} onClick={() => void deleteDraft(s)}>
                          {deletingId === s.id ? 'Brisanje…' : 'Obriši nacrt'}
                        </button>
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
