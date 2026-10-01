import { useEffect, useRef, useState } from 'react';
import { Banner } from './Bits';
import { NewEmployeeForm } from './NewEmployeeForm';
import { messageForCode } from '../features/grid/errors';
import { WdrApiError } from '../lib/api';
import type { IsoDate, PayoutDuplicateMatch, Uuid } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

export interface PickedEmployee {
  id: Uuid;
  full_name: string;
  employee_code: string | null;
}

interface Hit {
  id: Uuid;
  full_name: string;
  employee_code: string | null;
  center_code: string | null;
  active: boolean;
  employed_in_period: boolean | null;
}

const PAGE = 20;

/**
 * Izbor zaposlenog sa pretragom (redizajn §10) — jedan za sve Dodatne isplate
 * i Stopove.
 *
 * scope = 'payout' (K13): pretraga CELE baze kroz kontrolisani RPC
 *   (rpc_payout_employee_search): ime, prezime, redosled, deo imena, fuzzy,
 *   bez dijakritika; rezultat nosi SAMO identifikaciona polja. To nije pravo na
 *   profil — izbor samo dodaje zaposlenog u zahtev.
 * scope = 'own': stara pretraga u opsegu korisnika (app.employee_visible).
 *
 * „Dodaj novog zaposlenog" (§11–§12): PRE forme se radi provera duplikata nad
 * celom bazom; konkretni predlozi se nude uz „Da, koristi ovog". Ništa se ne
 * spaja i ne bira automatski.
 */
export function EmployeePicker({
  excludeIds = [],
  onPick,
  disabled = false,
  allowCreate = true,
  retireDnevnica = false,
  defaultCenterId,
  scope = 'own',
  period,
}: {
  excludeIds?: Uuid[];
  onPick(e: PickedEmployee): void | Promise<void>;
  disabled?: boolean;
  allowCreate?: boolean;
  retireDnevnica?: boolean;
  defaultCenterId?: Uuid;
  scope?: 'own' | 'payout';
  period?: { from: IsoDate; to: IsoDate };
}) {
  const { api, can } = useAuth();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'closed' | 'check' | 'form'>('closed');
  const [nameFirst, setNameFirst] = useState('');
  const [nameLast, setNameLast] = useState('');
  const [dupes, setDupes] = useState<PayoutDuplicateMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  async function search(term: string, offset: number) {
    const my = ++seq.current;
    setLoading(true);
    try {
      if (scope === 'payout') {
        const r = await api.payoutEmployeeSearch(term, {
          from: period?.from ?? null, to: period?.to ?? null, limit: PAGE, offset,
        });
        if (my !== seq.current) return;
        setHits((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
        setHasMore(r.has_more);
      } else {
        const r = await api.getEmployees(term, true, null, PAGE, offset);
        if (my !== seq.current) return;
        const mapped = r.items.map((i) => ({
          id: i.id, full_name: i.full_name, employee_code: i.employee_code,
          center_code: i.current_center_code, active: i.active, employed_in_period: null,
        }));
        setHits((prev) => (offset === 0 ? mapped : [...prev, ...mapped]));
        setHasMore(r.items.length === PAGE);
      }
    } catch (err) {
      if (my !== seq.current) return;
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
      setHits([]);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }

  // Debounce: velika baza se ne pretražuje na svaki pritisak tastera.
  useEffect(() => {
    const term = q.trim();
    setError(null);
    if (term.length < 2) {
      seq.current += 1;
      setHits([]);
      setHasMore(false);
      return;
    }
    const t = setTimeout(() => void search(term, 0), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, q, scope, period?.from, period?.to]);

  const shown = hits.filter((r) => !excludeIds.includes(r.id));

  function pick(e: PickedEmployee) {
    setQ('');
    setStep('closed');
    setDupes(null);
    void onPick(e);
  }

  function startCreate() {
    const parts = q.trim().split(/\s+/).filter(Boolean);
    setNameFirst(parts.length > 1 ? parts[0] : '');
    setNameLast(parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '');
    setDupes(null);
    setStep(scope === 'payout' ? 'check' : 'form');
  }

  async function runWholeBaseCheck() {
    setError(null);
    try {
      const r = await api.payoutEmployeeDuplicateCheck(nameFirst, nameLast, null);
      setDupes(r.matches);
      if (r.matches.length === 0) setStep('form');
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }

  return (
    <div className="employee-picker">
      <div className="filter-row">
        <input
          type="search"
          placeholder={scope === 'payout'
            ? 'Ime i prezime (cela baza, i drugi centri)…'
            : 'Pretraga po imenu i prezimenu ili šifri…'}
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Pretraga zaposlenih"
        />
        {allowCreate && can('employee.create') && (
          <button type="button" className="btn" disabled={disabled} onClick={startCreate}>
            Dodaj novog zaposlenog
          </button>
        )}
      </div>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}

      {q.trim().length >= 2 && (
        <ul className="picker-results" aria-live="polite">
          {loading && hits.length === 0 && <li className="muted small">Pretraga…</li>}
          {!loading && shown.length === 0 && (
            <li className="muted small">
              Nema rezultata{scope === 'payout' ? '' : ' u vašim centrima'}. Ako osoba ne postoji,
              izaberite „Dodaj novog zaposlenog".
            </li>
          )}
          {shown.map((r) => {
            const notInPeriod = r.employed_in_period === false;
            return (
              <li key={r.id}>
                <span>
                  {r.full_name}
                  <span className="muted small">
                    {' '}· {r.employee_code ?? 'bez šifre'} · {r.center_code ?? 'bez centra'}
                    {!r.active ? ' · neaktivan' : ''}
                    {notInPeriod ? ' · nije u radnom odnosu u periodu' : ''}
                  </span>
                </span>
                <button type="button" className="btn btn-small" disabled={disabled || notInPeriod}
                  title={notInPeriod ? 'Zaposleni nije u radnom odnosu ni jednog dana perioda' : undefined}
                  onClick={() => pick({ id: r.id, full_name: r.full_name, employee_code: r.employee_code })}>
                  Dodaj
                </button>
              </li>
            );
          })}
          {hasMore && (
            <li>
              <button type="button" className="btn btn-small btn-quiet" disabled={loading}
                onClick={() => void search(q.trim(), hits.length)}>
                Prikaži još
              </button>
            </li>
          )}
        </ul>
      )}

      {step !== 'closed' && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Novi zaposleni">
          <div className="modal-card">
            <h2>Novi zaposleni</h2>

            {step === 'check' && (
              <>
                <p className="muted small">
                  Pre unosa proveravamo celu bazu da ista osoba ne bi bila uneta dva puta.
                </p>
                <div className="form-grid">
                  <label><span>Ime</span>
                    <input value={nameFirst} onChange={(e) => { setNameFirst(e.target.value); setDupes(null); }} /></label>
                  <label><span>Prezime</span>
                    <input value={nameLast} onChange={(e) => { setNameLast(e.target.value); setDupes(null); }} /></label>
                </div>
                {dupes && dupes.length > 0 && (
                  <Banner kind="warning">
                    {dupes.map((d) => (
                      <div key={d.id} className="dup-suggestion">
                        <span>
                          U bazi postoji <strong>{d.full_name}</strong>
                          {' '}({d.employee_code ?? 'bez šifre'} · {d.center_code ?? 'bez centra'}
                          {d.active ? '' : ' · neaktivan'}). Da li ste možda mislili na ovog zaposlenog?
                        </span>
                        <button type="button" className="btn btn-small"
                          onClick={() => pick({ id: d.id, full_name: d.full_name, employee_code: d.employee_code })}>
                          Da, koristi ovog
                        </button>
                      </div>
                    ))}
                  </Banner>
                )}
                <div className="filter-row">
                  <button type="button" className="btn btn-quiet" onClick={() => setStep('closed')}>Odustani</button>
                  {dupes === null ? (
                    <button type="button" className="btn btn-primary"
                      disabled={nameFirst.trim() === '' || nameLast.trim() === ''}
                      onClick={() => void runWholeBaseCheck()}>
                      Proveri celu bazu
                    </button>
                  ) : (
                    <button type="button" className="btn" onClick={() => setStep('form')}>
                      Ne, nijedan — nastavi sa novim zaposlenim
                    </button>
                  )}
                </div>
              </>
            )}

            {step === 'form' && (
              <NewEmployeeForm
                retireDnevnica={retireDnevnica}
                prefill={{ first_name: nameFirst, last_name: nameLast, center_id: defaultCenterId ?? '' }}
                onCancel={() => setStep('closed')}
                onUseExisting={(e) => pick(e)}
                onCreated={(p) => pick({
                  id: p.employee.id, full_name: p.employee.full_name, employee_code: p.employee.employee_code,
                })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
