import { centerLabel, sortCenters } from '../lib/format/sort';
import { formatDate } from '../lib/format/date';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { NewEmployeeForm } from '../components/NewEmployeeForm';
import { WdrApiError } from '../lib/api';
import type {
  EmployeeFormReference,
  EmployeeList,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';


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
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [centerFilter, setCenterFilter] = useState('');
  const [centerOptions, setCenterOptions] = useState<EmployeeFormReference['centers']>([]);


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

  // ======================================================== NOVI ZAPOSLENI ==
  // Ista forma se koristi i iz Dodatnih isplata i Stopova (components/NewEmployeeForm).
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
        <section className="control-section">
          <NewEmployeeForm
            onCreated={(created) => navigate(`/zaposleni/${created.employee.id}`)}
            onUseExisting={(e) => navigate(`/zaposleni/${e.id}`)}
          />
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
              {sortCenters(centerOptions).map((c) => (
                <option key={c.id} value={c.id}>{centerLabel(c)}</option>
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
                    {formatDate(e.employment_start_date)}
                    {e.employment_end_date ? ` – ${formatDate(e.employment_end_date)}` : ''}
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
