import { useEffect, useMemo, useState } from 'react';
import { Banner } from './Bits';
import { messageForCode } from '../features/grid/errors';
import { duplicateSeverity, newEmployeeErrors, type NewEmployeeForm as Form } from '../features/employees/model';
import { WdrApiError } from '../lib/api';
import type {
  EmployeeDuplicateCheck,
  EmployeeFormReference,
  EmployeeProfile,
  Uuid,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

export const EMPTY_EMPLOYEE_FORM: Form = {
  employee_code: '',
  first_name: '',
  last_name: '',
  employment_start_date: '',
  center_id: '',
  primary_payment_type_id: '',
  default_shift_template_id: '',
  transport_required: 'ne',
  transport_provider_id: '',
  transport_valid_from: '',
  notes: '',
};

/**
 * Vođeni unos novog zaposlenog — JEDNA forma za `/zaposleni/novi` i za
 * „Dodaj novog zaposlenog" iz Dodatnih isplata i Stopova (redizajn §11).
 *
 * Provera duplikata je obavezan korak (0057): ista šifra blokira; isto ili
 * slično ime traži izričitu potvrdu, a kada je predlog u dostupnom centru nudi
 * „Da, koristi ovog zaposlenog". Poklapanje u centru van opsega se prijavljuje
 * BEZ imena (K10 / D-E5). Ništa se ne spaja automatski.
 */
export function NewEmployeeForm({
  prefill,
  retireDnevnica = false,
  lockedCenterId,
  lockedPrimaryTypeCode,
  compact = false,
  onCreated,
  onUseExisting,
  onCancel,
}: {
  prefill?: Partial<Form>;
  /** Inline iz Unosa: centar je trenutno izabrani i ne menja se ovde. */
  lockedCenterId?: string;
  /** Inline iz Unosa: osnovna vrsta = izabrana sekcija (KARNET / OBUKA). */
  lockedPrimaryTypeCode?: string;
  /** Inline: bez sekcija koje operateru nisu potrebne za početak rada. */
  compact?: boolean;
  /** Posle cutover-a DNEVNICA nije osnovni tip (K2). */
  retireDnevnica?: boolean;
  onCreated(profile: EmployeeProfile): void;
  onUseExisting?(employee: { id: Uuid; full_name: string; employee_code: string | null }): void;
  onCancel?(): void;
}) {
  const { api } = useAuth();
  const [cfg, setCfg] = useState<EmployeeFormReference | null>(null);
  const [form, setForm] = useState<Form>({ ...EMPTY_EMPLOYEE_FORM, ...prefill });
  const [dupes, setDupes] = useState<EmployeeDuplicateCheck | null>(null);
  const [confirmSimilar, setConfirmSimilar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getEmployeeFormReference().then((r) => {
      setCfg(r);
      setForm((f) => {
        let next = f;
        if (lockedCenterId) next = { ...next, center_id: lockedCenterId };
        else if (!f.center_id && r.centers.length === 1) next = { ...next, center_id: r.centers[0].id };
        if (lockedPrimaryTypeCode) {
          const pt = r.payment_types.find((p) => p.code === lockedPrimaryTypeCode && p.kind === 'PRIMARY');
          if (pt) next = { ...next, primary_payment_type_id: pt.id };
        }
        return next;
      });
    }).catch(() => setCfg(null));
  }, [api, lockedCenterId, lockedPrimaryTypeCode]);

  const primaryTypes = useMemo(
    () => (cfg?.payment_types ?? []).filter(
      (p) => p.kind === 'PRIMARY' && !(retireDnevnica && p.code === 'DNEVNICA'),
    ),
    [cfg, retireDnevnica],
  );
  const shifts = useMemo(() => cfg?.shift_templates ?? [], [cfg]);
  const providers = useMemo(() => cfg?.transport_providers ?? [], [cfg]);
  const formErrors = newEmployeeErrors(form);
  const dupState = duplicateSeverity(dupes);
  const outside = dupes?.outside_scope_match_count ?? 0;

  function set(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch }));
    setDupes(null);
    setConfirmSimilar(false);
  }

  function fail(err: unknown) {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }

  async function runDuplicateCheck() {
    setError(null);
    try {
      setDupes(await api.checkEmployeeDuplicates(
        form.employee_code.trim() === '' ? null : form.employee_code.trim(),
        form.first_name, form.last_name,
      ));
    } catch (err) {
      fail(err);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createEmployee({
        employee_code: form.employee_code.trim() === '' ? null : form.employee_code.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        employment_start_date: form.employment_start_date,
        center_id: form.center_id,
        primary_payment_type_id: form.primary_payment_type_id,
        default_shift_template_id: form.default_shift_template_id || null,
        transport_required: form.transport_required === 'da',
        transport_provider_id: form.transport_provider_id || null,
        transport_valid_from: form.transport_valid_from || null,
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
        confirm_similar: confirmSimilar,
      }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = dupes ? [
    ...dupes.exact_name.map((d) => ({ id: d.id, full_name: d.full_name, employee_code: d.employee_code, note: 'isto ime' })),
    ...dupes.similar.map((d) => ({ id: d.id, full_name: d.full_name, employee_code: d.employee_code, note: `sličnost ${d.similarity}` })),
  ] : [];

  return (
    <div className="new-employee-form">
      {error && <Banner kind="error">{error}</Banner>}

      <h2>Osnovni podaci</h2>
      <div className="form-grid">
        <label><span>Šifra zaposlenog</span>
          <input value={form.employee_code} onChange={(e) => set({ employee_code: e.target.value })} /></label>
        <label><span>Ime</span>
          <input value={form.first_name} onChange={(e) => set({ first_name: e.target.value })} /></label>
        <label><span>Prezime</span>
          <input value={form.last_name} onChange={(e) => set({ last_name: e.target.value })} /></label>
        <label><span>Datum početka radnog odnosa</span>
          <input type="date" value={form.employment_start_date}
            onChange={(e) => set({ employment_start_date: e.target.value })} /></label>
      </div>

      <h2>Raspodela</h2>
      <div className="form-grid">
        <label><span>Centar</span>
          <select value={form.center_id} disabled={Boolean(lockedCenterId)}
            onChange={(e) => set({ center_id: e.target.value })}>
            <option value="">—</option>
            {(cfg?.centers ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select></label>
        <label><span>Osnovna vrsta isplate</span>
          <select value={form.primary_payment_type_id} disabled={Boolean(lockedPrimaryTypeCode)}
            onChange={(e) => set({ primary_payment_type_id: e.target.value })}>
            <option value="">—</option>
            {primaryTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label><span>Podrazumevana smena</span>
          <select value={form.default_shift_template_id}
            onChange={(e) => set({ default_shift_template_id: e.target.value })}>
            <option value="">—</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.code} ({s.shift_start}–{s.shift_end})</option>)}
          </select></label>
      </div>

      {(lockedCenterId || lockedPrimaryTypeCode) && (
        <p className="muted small">
          Centar i osnovna vrsta su preuzeti iz Unosa. Raspodela važi od datuma početka
          radnog odnosa; datum se ne pretpostavlja — unesite stvarni.
        </p>
      )}

      {!compact && <h2>Prevoz</h2>}
      {!compact && (<>
      <div className="form-grid">
        <label><span>Potreban prevoz</span>
          <select value={form.transport_required}
            onChange={(e) => set({ transport_required: e.target.value as Form['transport_required'] })}>
            <option value="ne">NE</option>
            <option value="da">DA</option>
          </select></label>
        {form.transport_required === 'da' && (
          <>
            <label><span>Prevoznik</span>
              <select value={form.transport_provider_id}
                onChange={(e) => set({ transport_provider_id: e.target.value })}>
                <option value="">—</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select></label>
            <label><span>Prevoz važi od</span>
              <input type="date" value={form.transport_valid_from}
                onChange={(e) => set({ transport_valid_from: e.target.value })} /></label>
          </>
        )}
      </div>
      <p className="muted small">
        Odgovor „NE" se takođe evidentira — nepostojanje zapisa nije isto što i odluka da prevoz
        nije potreban.
      </p>

      <label className="full-width"><span>Napomena</span>
        <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      </>)}

      {formErrors.length > 0 && (
        <Banner kind="warning"><ul>{formErrors.map((e) => <li key={e}>{e}</li>)}</ul></Banner>
      )}

      <div className="filter-row">
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Odustani</button>}
        <button type="button" className="btn" disabled={busy || formErrors.length > 0}
          onClick={() => void runDuplicateCheck()}>
          Proveri duplikate
        </button>
        <button type="button" className="btn btn-primary"
          disabled={busy || formErrors.length > 0 || dupes === null || dupState.kind === 'blocked'
            || (dupState.kind === 'warning' && !confirmSimilar)}
          onClick={() => void create()}>
          {busy ? 'Kreiranje…' : 'Kreiraj zaposlenog'}
        </button>
      </div>

      {dupes && dupState.kind === 'blocked' && (
        <Banner kind="error">
          <strong>Šifra zaposlenog već postoji:</strong>{' '}
          {dupes.exact_code?.full_name ?? 'u centru za koji nemate pristup'}
          {dupes.exact_code?.employee_code ? ` (${dupes.exact_code.employee_code})` : ''}.
          Ista osoba se ne uvodi dva puta.
        </Banner>
      )}

      {dupes && dupState.kind === 'warning' && (
        <Banner kind="warning">
          {suggestions.map((d) => (
            <div key={d.id} className="dup-suggestion">
              <span>
                U bazi postoji <strong>{d.full_name}</strong>
                {d.employee_code ? ` (${d.employee_code})` : ''} · {d.note}.
                {' '}Da li ste možda mislili na ovog zaposlenog?
              </span>
              {onUseExisting && (
                <button type="button" className="btn btn-small"
                  onClick={() => onUseExisting({ id: d.id, full_name: d.full_name, employee_code: d.employee_code })}>
                  Da, koristi ovog zaposlenog
                </button>
              )}
            </div>
          ))}
          {outside > 0 && (
            <p>
              U sistemu već postoji zaposleni sa veoma sličnim podacima u drugom centru.
              Proverite podatke pre kreiranja novog zaposlenog.
            </p>
          )}
          <label className="confirm-row">
            <input type="checkbox" checked={confirmSimilar}
              onChange={(e) => setConfirmSimilar(e.target.checked)} />
            <span>
              Ne — proverio sam i potvrđujem da je ovo <strong>nova osoba</strong>.
              Spajanje se nikada ne radi automatski.
            </span>
          </label>
        </Banner>
      )}

      {dupes && dupState.kind === 'clear' && <Banner kind="success">Nema pronađenih duplikata.</Banner>}
    </div>
  );
}
