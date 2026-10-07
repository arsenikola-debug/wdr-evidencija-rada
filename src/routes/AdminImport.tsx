import { formatDate } from '../lib/format/date';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, EmptyState, Spinner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { WdrApiError } from '../lib/api';
import type {
  BulkAssignResult,
  EmployeeFormReference,
  EmployeeWithoutBaseType,
  ImportCreateInput,
  ImportStagingList,
  ImportStagingRow,
} from '../lib/api/types';
import { useAuth } from '../lib/auth/AuthProvider';

const MATCH_LABEL: Record<string, string> = {
  MATCHED: 'Postoji (jedinstveno isto ime)',
  AMBIGUOUS: 'Više mogućih — ručna odluka',
  POSSIBLE: 'Slično ime — proveriti',
  NEW: 'Novo lice',
};
const RESOLUTION_LABEL: Record<string, string> = {
  PENDING: 'Čeka', LINKED: 'Povezano', CREATED: 'Kreirano', DISMISSED: 'Odbačeno',
};

/** „Prezime Ime" iz izvora → predlog (Admin ga uvek može ispraviti). */
export function splitSourceName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { first: '', last: parts[0] ?? '' };
  return { last: parts[0], first: parts.slice(1).join(' ') };
}

/**
 * Administracija → Uvoz zaposlenih (0068).
 * Izvor nema šifru, datum početka radnog odnosa ni Karnet/Obuka — ti podaci se
 * ovde unose RUČNO. Kreiranje ide kroz postojeći tok sa proverom duplikata.
 * Avgustovski izvedeni podaci (dani, iznos) su samo referenca.
 */
export function AdminImport() {
  const { api } = useAuth();
  const [data, setData] = useState<ImportStagingList | null>(null);
  const [ref, setRef] = useState<EmployeeFormReference | null>(null);
  const [filter, setFilter] = useState<string>('PENDING');
  const [open, setOpen] = useState<ImportStagingRow | null>(null);
  const [form, setForm] = useState<ImportCreateInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 0070: masovna temporalna dodela Karnet/Obuka zaposlenima bez osnovne vrste.
  const [view, setView] = useState<'staging' | 'bulk'>('staging');
  const [noType, setNoType] = useState<EmployeeWithoutBaseType[] | null>(null);
  const [bulkCenter, setBulkCenter] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkType, setBulkType] = useState<'KARNET' | 'OBUKA'>('KARNET');
  const [bulkFrom, setBulkFrom] = useState('2026-08-01');
  const [bulkResult, setBulkResult] = useState<BulkAssignResult | null>(null);

  const fail = useCallback((err: unknown) => {
    const code = err instanceof WdrApiError ? err.code : null;
    setError(messageForCode(code, err instanceof Error ? err.message : undefined));
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await api.adminImportStagingList(null, filter === 'ALL' ? null : [filter]));
    } catch (err) {
      fail(err);
    }
  }, [api, filter, fail]);

  useEffect(() => { void load(); }, [load]);

  const loadNoType = useCallback(async () => {
    try {
      setNoType(await api.adminEmployeesWithoutBaseType(bulkCenter || null));
      setPicked(new Set());
    } catch (err) {
      fail(err);
    }
  }, [api, bulkCenter, fail]);

  useEffect(() => { if (view === 'bulk') void loadNoType(); }, [view, loadNoType]);

  async function assignSelected() {
    if (picked.size === 0) return;
    if (!window.confirm(`Dodeliti ${bulkType} od ${bulkFrom} za ${picked.size} zaposlenih?`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.adminBulkAssignBaseType([...picked], bulkType, bulkFrom);
      setBulkResult(r);
      setNotice(`Dodeljeno: ${r.assigned}. Nije dodeljeno: ${r.failed}.`);
      await loadNoType();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { api.getEmployeeFormReference().then(setRef).catch(() => setRef(null)); }, [api]);

  const primaryTypes = useMemo(
    () => (ref?.payment_types ?? []).filter((p) => p.kind === 'PRIMARY' && (p.code === 'KARNET' || p.code === 'OBUKA')),
    [ref],
  );

  function startCreate(r: ImportStagingRow) {
    const n = splitSourceName(r.source_full_name);
    setOpen(r);
    setForm({
      id: r.id, employee_code: null, first_name: n.first, last_name: n.last,
      employment_start_date: '', center_id: r.center_id ?? '', primary_payment_type_id: '',
      default_shift_template_id: r.shift_template_id, transport_required: Boolean(r.transport_required),
      transport_provider_id: r.transport_provider_id, transport_valid_from: null, confirm_similar: false,
    });
  }

  async function act(p: Promise<unknown>, msg: string) {
    setBusy(true);
    setError(null);
    try {
      await p;
      setNotice(msg);
      setOpen(null);
      setForm(null);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const formError = form && (
    !form.first_name.trim() || !form.last_name.trim() ? 'Ime i prezime su obavezni.'
      : !form.employment_start_date ? 'Datum početka radnog odnosa je obavezan (ne pretpostavlja se).'
        : !form.center_id ? 'Izaberite centar.'
          : !form.primary_payment_type_id ? 'Izaberite Karnet ili Obuka.'
            : form.transport_required && (!form.transport_provider_id || !form.transport_valid_from)
              ? 'Za prevoz su potrebni prevoznik i datum od kog važi.' : null);

  return (
    <div className="page">
      <h1>Uvoz zaposlenih</h1>
      <p className="muted small">
        Jasno nova lica iz „Zaposleni avgust.xlsx" kreirana su uvozom (radni odnos i raspodela od
        01.08.2026, bez Karnet/Obuka). Ovde ostaju samo konfliktni redovi (slično ili više
        mogućih poklapanja, nepotpuno ime) za odluku. Ništa se ne spaja automatski. Karnet/Obuka
        se dodeljuje u pogledu „Bez Karnet/Obuka".
      </p>
      {error && <Banner kind="error" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner kind="success" onClose={() => setNotice(null)}>{notice}</Banner>}

      {data && (
        <p className="small">
          {Object.entries(data.summary).sort().map(([k, v]) => {
            const [m, r] = k.split(':');
            return <span key={k} className="chip">{MATCH_LABEL[m] ?? m} · {RESOLUTION_LABEL[r] ?? r}: {v}</span>;
          })}
        </p>
      )}

      <div className="entry-bar-tabs segmented" role="tablist" aria-label="Pogled">
        <button type="button" className={view === 'staging' ? 'btn seg-active' : 'btn'} onClick={() => setView('staging')}>
          Redovi uvoza
        </button>
        <button type="button" className={view === 'bulk' ? 'btn seg-active' : 'btn'} onClick={() => setView('bulk')}>
          Neopredeljeni (bez Karnet/Obuka)
        </button>
      </div>

      {view === 'bulk' && (
        <section className="control-section">
          <h2>Neopredeljeni zaposleni (bez Karnet/Obuka)</h2>
          <p className="muted small">
            Ovi zaposleni postoje i raspoređeni su u centar, ali se ne pojavljuju u Unosu dok ne
            dobiju osnovnu vrstu. Dodela je temporalna: važi od izabranog datuma; postojeća
            istorija se ne prepisuje.
          </p>
          <div className="report-filters toolbar-unified">
            <label><span>Centar</span>
              <select value={bulkCenter} onChange={(e) => setBulkCenter(e.target.value)}>
                <option value="">svi</option>
                {(ref?.centers ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select></label>
            <label><span>Osnovna vrsta</span>
              <select value={bulkType} onChange={(e) => setBulkType(e.target.value as 'KARNET' | 'OBUKA')}>
                <option value="KARNET">KARNET</option>
                <option value="OBUKA">OBUKA</option>
              </select></label>
            <label><span>Važi od</span>
              <input type="date" value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} /></label>
            <button type="button" className="btn btn-primary" disabled={busy || picked.size === 0 || !bulkFrom}
              onClick={() => void assignSelected()}>
              Dodeli selektovanima ({picked.size})
            </button>
          </div>
          {bulkResult && bulkResult.failed > 0 && (
            <Banner kind="warning">
              {bulkResult.results.filter((r) => !r.ok).map((r) => (
                <div key={r.employee_id}>{r.full_name ?? r.employee_id}: {r.message}</div>
              ))}
            </Banner>
          )}
          {!noType ? <Spinner label="Učitavanje…" /> : noType.length === 0 ? (
            <EmptyState title="Svi zaposleni imaju Karnet/Obuka" />
          ) : (
            <div className="table-scroll">
              <table className="list list-compact">
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" aria-label="Izaberi sve"
                        checked={picked.size === noType.length}
                        onChange={(e) => setPicked(e.target.checked ? new Set(noType.map((x) => x.employee_id)) : new Set())} />
                    </th>
                    <th>Zaposleni</th><th>Šifra</th><th>Centar</th><th>Radni odnos od</th><th>Raspodela od</th>
                  </tr>
                </thead>
                <tbody>
                  {noType.map((x) => (
                    <tr key={x.employee_id}>
                      <td>
                        <input type="checkbox" aria-label={x.full_name} checked={picked.has(x.employee_id)}
                          onChange={(e) => setPicked((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(x.employee_id); else n.delete(x.employee_id);
                            return n;
                          })} />
                      </td>
                      <td>{x.full_name}</td>
                      <td>{x.employee_code ?? '—'}</td>
                      <td>{x.center_code}</td>
                      <td>{formatDate(x.employment_start_date)}</td>
                      <td>{x.assignment_valid_from}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'staging' && (<>
      <div className="entry-bar-tabs segmented" role="tablist">
        {['PENDING', 'LINKED', 'CREATED', 'DISMISSED', 'ALL'].map((k) => (
          <button key={k} type="button" className={filter === k ? 'btn seg-active' : 'btn'} onClick={() => setFilter(k)}>
            {k === 'ALL' ? 'Svi' : RESOLUTION_LABEL[k]}
          </button>
        ))}
      </div>

      {!data ? <Spinner label="Učitavanje…" /> : data.items.length === 0 ? (
        <EmptyState title="Nema redova u ovom statusu" />
      ) : (
        <div className="table-scroll">
          <table className="list list-compact">
            <thead>
              <tr>
                <th>#</th><th>Ime i prezime (izvor)</th><th>Centar</th><th>Prevoz</th><th>Smena</th>
                <th>Poređenje</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>{r.source_row}</td>
                  <td>{r.source_full_name}</td>
                  <td>{r.center_code ?? '—'}{r.source_center_code !== r.center_code && (
                    <span className="muted small"> (izvor {r.source_center_code})</span>)}</td>
                  <td>{r.transport_required ? (r.transport_provider_code ?? `${r.source_transport} (nepoznat)`) : 'ne'}</td>
                  <td>{r.source_main_shift ?? '—'}{r.source_main_shift && !r.shift_template_id && (
                    <span className="muted small"> (bez šablona)</span>)}</td>
                  <td>
                    {MATCH_LABEL[r.match_status]}
                    {r.candidates.length > 0 && (
                      <div className="small muted">
                        {r.candidates.map((c) => `${c.full_name} [${c.employee_code ?? 'bez šifre'}, ${c.center_code ?? '?'}]`).join('; ')}
                      </div>
                    )}
                  </td>
                  <td>{RESOLUTION_LABEL[r.resolution]}{r.resolution_note && <div className="small muted">{r.resolution_note}</div>}</td>
                  <td className="row-actions">
                    {r.resolution === 'PENDING' && (
                      <>
                        {r.candidates.map((c) => (
                          <button key={c.id} type="button" className="btn btn-small" disabled={busy}
                            title="Poveži sa postojećim; podaci zaposlenog se ne menjaju"
                            onClick={() => void act(api.adminImportStagingLink(r.id, c.id, 'Ručno povezano'),
                              `${r.source_full_name} povezan sa ${c.full_name}.`)}>
                            Poveži: {c.employee_code ?? c.full_name}
                          </button>
                        ))}
                        <button type="button" className="btn btn-small" onClick={() => startCreate(r)}>Kreiraj</button>
                        <button type="button" className="btn btn-small btn-quiet" disabled={busy}
                          onClick={() => {
                            const note = window.prompt('Razlog odbacivanja:');
                            if (note) void act(api.adminImportStagingDismiss(r.id, note), 'Red je odbačen.');
                          }}>
                          Odbaci
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </>)}

      {open && form && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Kreiraj zaposlenog iz uvoza">
          <div className="modal-card">
            <h2>Novi zaposleni iz uvoza · red {open.source_row}</h2>
            <p className="muted small">Izvor: {open.source_full_name} · {open.source_center_code}</p>
            <div className="form-grid">
              <label><span>Ime</span>
                <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label>
              <label><span>Prezime</span>
                <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
              <label><span>Šifra zaposlenog (opciono)</span>
                <input value={form.employee_code ?? ''} onChange={(e) => setForm({ ...form, employee_code: e.target.value || null })} /></label>
              <label><span>Datum početka radnog odnosa</span>
                <input type="date" value={form.employment_start_date}
                  onChange={(e) => setForm({ ...form, employment_start_date: e.target.value })} /></label>
              <label><span>Centar</span>
                <select value={form.center_id} onChange={(e) => setForm({ ...form, center_id: e.target.value })}>
                  <option value="">—</option>
                  {(ref?.centers ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select></label>
              <label><span>Osnovna vrsta</span>
                <select value={form.primary_payment_type_id}
                  onChange={(e) => setForm({ ...form, primary_payment_type_id: e.target.value })}>
                  <option value="">—</option>
                  {primaryTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              <label><span>Podrazumevana smena</span>
                <select value={form.default_shift_template_id ?? ''}
                  onChange={(e) => setForm({ ...form, default_shift_template_id: e.target.value || null })}>
                  <option value="">—</option>
                  {(ref?.shift_templates ?? []).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                </select></label>
              <label><span>Prevoz</span>
                <select value={form.transport_required ? 'da' : 'ne'}
                  onChange={(e) => setForm({ ...form, transport_required: e.target.value === 'da' })}>
                  <option value="ne">NE</option><option value="da">DA</option>
                </select></label>
              {form.transport_required && (
                <>
                  <label><span>Prevoznik</span>
                    <select value={form.transport_provider_id ?? ''}
                      onChange={(e) => setForm({ ...form, transport_provider_id: e.target.value || null })}>
                      <option value="">—</option>
                      {(ref?.transport_providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                    </select></label>
                  <label><span>Prevoz važi od</span>
                    <input type="date" value={form.transport_valid_from ?? ''}
                      onChange={(e) => setForm({ ...form, transport_valid_from: e.target.value || null })} /></label>
                </>
              )}
            </div>
            <label className="confirm-row">
              <input type="checkbox" checked={form.confirm_similar}
                onChange={(e) => setForm({ ...form, confirm_similar: e.target.checked })} />
              <span>Potvrđujem da je ovo nova osoba (ako provera pronađe slično ime).</span>
            </label>
            {formError && <Banner kind="warning">{formError}</Banner>}
            <div className="filter-row">
              <button type="button" className="btn btn-quiet" onClick={() => { setOpen(null); setForm(null); }}>Odustani</button>
              <button type="button" className="btn btn-primary" disabled={busy || Boolean(formError)}
                onClick={() => void act(api.adminImportStagingCreate(form), `${form.last_name} ${form.first_name} je kreiran.`)}>
                Kreiraj zaposlenog
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
