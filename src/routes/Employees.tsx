import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { duplicateSeverity, newEmployeeErrors, type NewEmployeeForm } from '../features/employees/model';
import { WdrApiError } from '../lib/api';
import type {
  EmployeeDuplicateCheck,
  EmployeeFormReference,
  EmployeeList,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const EMPTY: NewEmployeeForm = {
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
 * `/zaposleni` i `/zaposleni/novi`.
 *
 * Jedna komponenta drži listu i vođeni unos, jer dele isti referentni podatak
 * (centri, vrste isplata, smene, prevoznici) i istu proveru duplikata.
 */
export function Employees({ mode }: { mode: 'list' | 'new' }) {
  const { api, can } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<EmployeeList | null>(null);
  const [cfg, setCfg] = useState<EmployeeFormReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [centerFilter, setCenterFilter] = useState('');
  const [centerOptions, setCenterOptions] = useState<EmployeeFormReference['centers']>([]);

  const [form, setForm] = useState<NewEmployeeForm>(EMPTY);
  const [dupes, setDupes] = useState<EmployeeDuplicateCheck | null>(null);
  const [confirmSimilar, setConfirmSimilar] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const active = activeFilter === 'all' ? null : activeFilter === 'active';
      setData(await api.getEmployees(
        search.trim() === '' ? null : search.trim(),
        active,
        centerFilter === '' ? null : centerFilter,
      ));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    }
  }, [api, search, activeFilter, centerFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mode !== 'new') return;
    // Referentni podaci za vođeni unos; bez njih se forma ne popunjava naslepo.
    void (async () => {
      try {
        setCfg(await api.getEmployeeFormReference());
      } catch {
        setCfg(null);
      }
    })();
  }, [api, mode]);

  useEffect(() => {
    // Filter po centru se puni iz konfiguracije kada je dostupna; bez admin
    // prava lista ostaje prazna, a filter se ne prikazuje.
    void (async () => {
      try {
        setCenterOptions((await api.getEmployeeFormReference()).centers);
      } catch {
        setCenterOptions([]);
      }
    })();
  }, [api]);

  const primaryTypes = useMemo(
    () => (cfg?.payment_types ?? []).filter((p) => p.kind === 'PRIMARY'),
    [cfg],
  );
  const shifts = useMemo(() => cfg?.shift_templates ?? [], [cfg]);
  const providers = useMemo(
    () => cfg?.transport_providers ?? [],
    [cfg],
  );

  const formErrors = newEmployeeErrors(form);
  const dupState = duplicateSeverity(dupes);

  function set(patch: Partial<NewEmployeeForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setDupes(null);
    setConfirmSimilar(false);
  }

  async function runDuplicateCheck() {
    setNotice(null);
    try {
      setDupes(await api.checkEmployeeDuplicates(
        form.employee_code.trim() === '' ? null : form.employee_code.trim(),
        form.first_name,
        form.last_name,
      ));
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setNotice({
        kind: 'error',
        text: messageForCode(code, err instanceof Error ? err.message : undefined),
      });
    }
  }

  async function create() {
    setBusy(true);
    setNotice(null);
    try {
      const created = await api.createEmployee({
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
      });
      navigate(`/zaposleni/${created.employee.id}`);
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setNotice({
        kind: 'error',
        text: messageForCode(code, err instanceof Error ? err.message : undefined),
      });
    } finally {
      setBusy(false);
    }
  }

  // ======================================================== NOVI ZAPOSLENI ==
  if (mode === 'new') {
    return (
      <div className="page">
        <div className="preview-head">
          <div>
            <h1>Novi zaposleni</h1>
            <p className="muted">
              Zaposleni, prva raspodela po centru i evidencija prevoza nastaju zajedno.
              Ako bilo koji deo ne prođe, ne nastaje ništa.
            </p>
          </div>
          <Link className="btn btn-quiet" to="/zaposleni">← Zaposleni</Link>
        </div>

        {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

        <section className="control-section">
          <h2>Osnovni podaci</h2>
          <div className="form-grid">
            <label><span>Šifra zaposlenog</span>
              <input value={form.employee_code}
                onChange={(e) => set({ employee_code: e.target.value })} /></label>
            <label><span>Ime</span>
              <input value={form.first_name}
                onChange={(e) => set({ first_name: e.target.value })} /></label>
            <label><span>Prezime</span>
              <input value={form.last_name}
                onChange={(e) => set({ last_name: e.target.value })} /></label>
            <label><span>Datum početka radnog odnosa</span>
              <input type="date" value={form.employment_start_date}
                onChange={(e) => set({ employment_start_date: e.target.value })} /></label>
          </div>

          <h2>Raspodela</h2>
          <div className="form-grid">
            <label><span>Centar</span>
              <select value={form.center_id} onChange={(e) => set({ center_id: e.target.value })}>
                <option value="">—</option>
                {(cfg?.centers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
                ))}
              </select></label>
            <label><span>Osnovna vrsta isplate</span>
              <select value={form.primary_payment_type_id}
                onChange={(e) => set({ primary_payment_type_id: e.target.value })}>
                <option value="">—</option>
                {primaryTypes.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select></label>
            <label><span>Podrazumevana smena</span>
              <select value={form.default_shift_template_id}
                onChange={(e) => set({ default_shift_template_id: e.target.value })}>
                <option value="">—</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} ({s.shift_start}–{s.shift_end})
                  </option>
                ))}
              </select></label>
          </div>

          <h2>Prevoz</h2>
          <div className="form-grid">
            <label><span>Potreban prevoz</span>
              <select value={form.transport_required}
                onChange={(e) => set({
                  transport_required: e.target.value as NewEmployeeForm['transport_required'],
                })}>
                <option value="ne">NE</option>
                <option value="da">DA</option>
              </select></label>
            {form.transport_required === 'da' && (
              <>
                <label><span>Prevoznik</span>
                  <select value={form.transport_provider_id}
                    onChange={(e) => set({ transport_provider_id: e.target.value })}>
                    <option value="">—</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                    ))}
                  </select></label>
                <label><span>Prevoz važi od</span>
                  <input type="date" value={form.transport_valid_from}
                    onChange={(e) => set({ transport_valid_from: e.target.value })} /></label>
              </>
            )}
          </div>
          <p className="muted small">
            Odgovor „NE" se takođe evidentira — nepostojanje zapisa nije isto što i
            odluka da prevoz nije potreban.
          </p>

          <label className="full-width"><span>Napomena</span>
            <textarea rows={2} value={form.notes}
              onChange={(e) => set({ notes: e.target.value })} /></label>

          {formErrors.length > 0 && (
            <Banner kind="warning">
              <ul>{formErrors.map((e) => <li key={e}>{e}</li>)}</ul>
            </Banner>
          )}

          <div className="filter-row">
            <button
              type="button"
              className="btn"
              disabled={busy || formErrors.length > 0}
              onClick={() => void runDuplicateCheck()}
            >
              Proveri duplikate
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || formErrors.length > 0 || dupes === null
                || dupState.kind === 'blocked'
                || (dupState.kind === 'warning' && !confirmSimilar)}
              onClick={() => void create()}
            >
              {busy ? 'Kreiranje…' : 'Kreiraj zaposlenog'}
            </button>
          </div>

          {dupes && dupState.kind === 'blocked' && (
            <Banner kind="error">
              <strong>Šifra zaposlenog već postoji:</strong>{' '}
              {dupes.exact_code?.full_name} ({dupes.exact_code?.employee_code}).
              Ista osoba se ne uvodi dva puta.
            </Banner>
          )}

          {dupes && dupState.kind === 'warning' && (
            <Banner kind="warning">
              <strong>Postoji zaposleni sa istim ili sličnim imenom.</strong>
              <ul>
                {dupes.exact_name.map((d) => (
                  <li key={d.id}>
                    {d.full_name} ({d.employee_code ?? 'bez šifre'}) · od{' '}
                    {d.employment_start_date} · {d.active ? 'aktivan' : 'neaktivan'}
                  </li>
                ))}
                {dupes.similar.map((d) => (
                  <li key={d.id}>
                    {d.full_name} ({d.employee_code ?? 'bez šifre'}) · sličnost{' '}
                    {d.similarity}
                  </li>
                ))}
              </ul>
              <label className="confirm-row">
                <input type="checkbox" checked={confirmSimilar}
                  onChange={(e) => setConfirmSimilar(e.target.checked)} />
                <span>
                  Proverio sam listu i potvrđujem da je ovo <strong>nova osoba</strong>.
                  Spajanje se nikada ne radi automatski.
                </span>
              </label>
            </Banner>
          )}

          {dupes && dupState.kind === 'clear' && (
            <Banner kind="success">Nema pronađenih duplikata.</Banner>
          )}
        </section>
      </div>
    );
  }

  // ================================================================ LISTA ==
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!data) return <Spinner label="Čitanje zaposlenih…" />;

  return (
    <div className="page">
      <div className="preview-head">
        <div>
          <h1>Zaposleni</h1>
          <p className="muted">
            Zaposleni se ne briše. Prestanak rada je datum, a istorija ostaje dostupna.
          </p>
        </div>
        {can('employee.create') && (
          <Link className="btn btn-primary" to="/zaposleni/novi">Novi zaposleni</Link>
        )}
      </div>

      <div className="form-grid">
        <label><span>Pretraga (ime ili šifra)</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label><span>Status</span>
          <select value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
            <option value="active">Aktivni</option>
            <option value="inactive">Neaktivni</option>
            <option value="all">Svi</option>
          </select></label>
        {centerOptions.length > 0 && (
          <label><span>Centar</span>
            <select value={centerFilter} onChange={(e) => setCenterFilter(e.target.value)}>
              <option value="">Svi centri</option>
              {centerOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
              ))}
            </select></label>
        )}
      </div>

      {data.items.length === 0 ? (
        <EmptyState title="Nema zaposlenih po ovim kriterijumima" />
      ) : (
        <>
          <table className="list">
            <thead>
              <tr>
                <th>Šifra</th><th>Ime i prezime</th><th>Centar</th><th>Osnovna naknada</th>
                <th>Smena</th><th>Prevoz</th><th>Radni odnos</th><th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} className={e.active ? '' : 'row-muted'}>
                  <td>{e.employee_code ?? '—'}</td>
                  <td><strong>{e.full_name}</strong></td>
                  <td>{e.current_center_code ?? '—'}</td>
                  <td>{e.primary_payment_type_code ?? '—'}</td>
                  <td>{e.default_shift_code ?? '—'}</td>
                  <td>
                    {e.transport_required === null
                      ? '—'
                      : e.transport_required
                        ? `DA · ${e.transport_provider_code ?? 'bez prevoznika'}`
                        : 'NE'}
                  </td>
                  <td>
                    {e.employment_start_date}
                    {e.employment_end_date ? ` – ${e.employment_end_date}` : ''}
                  </td>
                  <td>
                    <Link className="btn btn-quiet" to={`/zaposleni/${e.id}`}>Otvori</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Prikazano {data.items.length} od {data.total}.
          </p>
        </>
      )}
    </div>
  );
}
