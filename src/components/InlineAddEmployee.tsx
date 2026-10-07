import { formatDate } from '../lib/format/date';
import { useState } from 'react';
import { Banner } from './Bits';
import { NewEmployeeForm } from './NewEmployeeForm';
import { messageForCode } from '../features/grid/errors';
import { WdrApiError } from '../lib/api';
import type { PayoutDuplicateMatch, Uuid } from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

/**
 * „+ Dodaj zaposlenog" direktno iz Karnet/Obuka Unosa (završni prolaz §2).
 *
 * 1. Ime i prezime → provera duplikata nad CELOM bazom (normalizovano/fuzzy,
 *    isti kontrolisani RPC kao Dodatne isplate; samo identifikaciona polja).
 * 2. Ako osoba postoji — novi zapis se NE pravi:
 *      • u ovom centru: biće u Unosu ako je raspoređena u periodu;
 *      • u drugom centru: premeštaj (temporalni transfer) radi administrator —
 *        operater nema pravo da menja raspodelu tuđeg zaposlenog.
 * 3. Ako ne postoji — postojeći tok kreiranja (zaposleni + raspodela u izabrani
 *    centar + osnovna vrsta = izabrana sekcija, od STVARNOG datuma početka).
 */
export function InlineAddEmployee({
  centerId,
  centerCode,
  baseType,
  onDone,
  onClose,
}: {
  centerId: Uuid;
  centerCode: string;
  baseType: 'KARNET' | 'OBUKA';
  onDone(message: string): void;
  onClose(): void;
}) {
  const { api, can } = useAuth();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [matches, setMatches] = useState<PayoutDuplicateMatch[] | null>(null);
  const [step, setStep] = useState<'check' | 'form'>('check');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      if (can('payout.create') || can('courier_stops.edit')) {
        const r = await api.payoutEmployeeDuplicateCheck(first, last, null);
        setMatches(r.matches);
        if (r.matches.length === 0) setStep('form');
      } else {
        // Bez prava na globalni lookup: standardna provera u opsegu korisnika.
        const r = await api.checkEmployeeDuplicates(null, first, last);
        const m = [...r.exact_name, ...r.similar].map((x) => ({
          id: x.id, full_name: x.full_name, employee_code: x.employee_code, center_code: null,
          active: x.active, match_reason: 'SIMILAR_NAME' as const, score: 0,
        }));
        setMatches(m);
        if (m.length === 0 && !r.outside_scope_match_count) setStep('form');
      }
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Dodaj zaposlenog">
      <div className="modal-card">
        <h2>Dodaj zaposlenog · {centerCode} · {baseType === 'KARNET' ? 'Karnet' : 'Obuka'}</h2>
        {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}

        {step === 'check' && (
          <>
            <p className="muted small">
              Pre unosa proveravamo celu bazu da ista osoba ne bi bila uneta dva puta.
            </p>
            <div className="form-grid">
              <label><span>Ime</span>
                <input value={first} onChange={(e) => { setFirst(e.target.value); setMatches(null); }} /></label>
              <label><span>Prezime</span>
                <input value={last} onChange={(e) => { setLast(e.target.value); setMatches(null); }} /></label>
            </div>

            {matches && matches.length > 0 && (
              <Banner kind="warning">
                {matches.map((m) => {
                  const here = m.center_code === centerCode;
                  return (
                    <div key={m.id} className="dup-suggestion">
                      <span>
                        U bazi postoji <strong>{m.full_name}</strong> ({m.employee_code ?? 'bez šifre'} ·{' '}
                        {m.center_code ?? 'bez centra'}{m.active ? '' : ' · neaktivan'}).{' '}
                        {here
                          ? 'Ako je raspoređen u ovaj centar u izabranom periodu, već je u Unosu.'
                          : 'Raspoređen je u drugi centar — premeštaj radi administrator (Zaposleni → Premeštaj).'}
                      </span>
                      <button type="button" className="btn btn-small"
                        onClick={() => onDone(here
                          ? `${m.full_name} već postoji u centru ${centerCode} — nije napravljen novi zapis.`
                          : `${m.full_name} postoji u centru ${m.center_code ?? '?'} — zatražite premeštaj od administratora. Novi zapis nije napravljen.`)}>
                        To je ta osoba
                      </button>
                    </div>
                  );
                })}
              </Banner>
            )}

            <div className="filter-row">
              <button type="button" className="btn btn-quiet" onClick={onClose}>Odustani</button>
              {matches === null ? (
                <button type="button" className="btn btn-primary"
                  disabled={busy || first.trim() === '' || last.trim() === ''} onClick={() => void check()}>
                  Proveri bazu
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => setStep('form')}>
                  Ne, nijedna — nova osoba
                </button>
              )}
            </div>
          </>
        )}

        {step === 'form' && (
          <NewEmployeeForm
            compact
            lockedCenterId={centerId}
            lockedPrimaryTypeCode={baseType}
            prefill={{ first_name: first, last_name: last }}
            onCancel={onClose}
            onUseExisting={(e) => onDone(`${e.full_name} već postoji — nije napravljen novi zapis.`)}
            onCreated={(p) => onDone(`Zaposleni ${p.employee.full_name} je kreiran i raspoređen u ${centerCode} od ${formatDate(p.employee.employment_start_date)}.`)}
          />
        )}
      </div>
    </div>
  );
}
