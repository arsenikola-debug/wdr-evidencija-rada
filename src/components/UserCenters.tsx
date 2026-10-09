import {
  type CenterChoice,
  applyModeToAll,
  bulkSelectCenters,
  centersCountLabel,
  centersSummary,
} from '../features/admin/users';
import type { AdminUserRow } from '../lib/api/types';
import { centerLabel, sortCenters } from '../lib/format/sort';
import { SearchableMultiSelect, type MultiOption } from './SearchableMultiSelect';

type CatalogCenter = { code: string; name: string; active: boolean };

/**
 * Ćelija „Centri" u tabeli korisnika: jedan red umesto 40+ (vidi centersSummary).
 * Pojedinačni centri su u tooltip-u i u prikazu izmene korisnika.
 */
export function UserCentersCell({
  user, catalog,
}: {
  user: Pick<AdminUserRow, 'all_centers' | 'centers'>;
  catalog: readonly CatalogCenter[];
}) {
  const s = centersSummary(user, catalog);
  if (s.kind === 'admin') {
    return <span className="users-centers-summary" title="Pravo centers.manage — svi centri, uključujući buduće">{s.label}</span>;
  }
  if (s.kind === 'none') return <span className="muted">—</span>;
  if (s.kind === 'list') {
    return (
      <div className="users-centers-list">
        {s.details.map((d) => <div key={d}>{d}</div>)}
      </div>
    );
  }
  return (
    <span className="users-centers-summary" title={s.details.join('\n')}>
      {s.label}
      {s.kind === 'all_current' && (
        <span className="muted"> ({centersCountLabel(s.details.length)}; novi centri se ne dodaju sami)</span>
      )}
    </span>
  );
}

function centerOptions(catalog: readonly CatalogCenter[], keep: readonly string[]): MultiOption[] {
  // Po NAZIVU centra (sortCenters, 16bbf2c); red opcije: „B6 — Rakovica".
  return sortCenters(catalog)
    .filter((c) => c.active || keep.includes(c.code))
    .map((c) => ({ value: c.code, label: c.code, hint: `— ${c.name}${c.active ? '' : ' (neaktivan)'}` }));
}

/**
 * Izbor centara za kreiranje i izmenu korisnika.
 *
 *  * `adminAll` (izabrane uloge daju centers.manage): ručni izbor se ne traži —
 *    prikazuje se „Svi centri (administrator)". Eksplicitni redovi se ne diraju.
 *  * „Označi sve" (svi aktivni centri) / „Poništi sve"; novododati centri dobijaju
 *    trenutno izabrani režim (`write`), već izabrani zadržavaju svoj.
 *  * `perCenter` (izmena): režim po centru + „Primeni režim na sve izabrane".
 */
export function CenterAccessPicker({
  id, label, catalog, keepCodes = [], selected, onChange, write, onWriteChange,
  perCenter = false, adminAll, existingExplicitCount = 0,
}: {
  id: string;
  label: string;
  catalog: readonly CatalogCenter[];
  keepCodes?: readonly string[];
  selected: readonly CenterChoice[];
  onChange(next: CenterChoice[]): void;
  write: boolean;
  onWriteChange(write: boolean): void;
  perCenter?: boolean;
  adminAll: boolean;
  /** Izmena: broj postojećih eksplicitnih dodela (ostaju, bez efekta dok traje centers.manage). */
  existingExplicitCount?: number;
}) {
  if (adminAll) {
    return (
      <div className="users-centers-admin" role="status">
        <strong>Svi centri (administrator)</strong>
        <p className="muted small">
          Izabrana uloga daje pravo <code>centers.manage</code>: korisnik vidi sve centre, uključujući buduće.
          Ručni izbor centara nije potreban.
          {existingExplicitCount > 0 && ` Postojeće pojedinačne dodele (${centersCountLabel(existingExplicitCount)}) se ne menjaju.`}
        </p>
      </div>
    );
  }

  const options = centerOptions(catalog, keepCodes);
  const activeCount = catalog.filter((c) => c.active).length;
  const codes = selected.map((c) => c.code);
  const setCodes = (next: string[]) =>
    onChange(next.map((code) => selected.find((c) => c.code === code) ?? { code, write }));
  const named = sortCenters(selected.map((c) => ({
    ...c, name: catalog.find((x) => x.code === c.code)?.name ?? c.code,
  })));

  return (
    <div className="users-centers-picker">
      <SearchableMultiSelect
        id={id}
        label={label}
        options={options}
        value={codes}
        onChange={setCodes}
        emptyText="Bez centra"
        searchPlaceholder="Pretraga centra…"
        maxChips={4}
        sort={false}
      />
      <div className="users-centers-actions">
        <button type="button" className="btn btn-small"
          onClick={() => onChange(bulkSelectCenters(selected, catalog, write))}
          disabled={activeCount === 0}>
          Označi sve ({activeCount})
        </button>
        <button type="button" className="btn btn-small btn-quiet"
          onClick={() => onChange([])} disabled={selected.length === 0}>
          Poništi sve
        </button>
        <span className="muted small">Izabrano: {centersCountLabel(selected.length)}</span>
      </div>
      <div className="segmented users-write" role="radiogroup"
        aria-label={perCenter ? 'Režim pristupa za novododate centre' : 'Nivo pristupa centrima'}>
        <span className="muted small">{perCenter ? 'Režim za novododate:' : 'Pristup:'}</span>
        <label><input type="radio" name={`${id}-mode`} checked={write}
          onChange={() => onWriteChange(true)} /> Upis i pregled</label>
        <label><input type="radio" name={`${id}-mode`} checked={!write}
          onChange={() => onWriteChange(false)} /> Samo pregled</label>
        {perCenter && selected.length > 0 && (
          <button type="button" className="btn btn-small btn-quiet"
            onClick={() => onChange(applyModeToAll(selected, write))}>
            Primeni na sve izabrane
          </button>
        )}
      </div>
      {perCenter && selected.length > 0 && (
        <div className="users-centers-detail">
          <table className="list list-compact users-centers">
            <tbody>
              {named.map((c) => (
                <tr key={c.code}>
                  <td>{centerLabel(c)}</td>
                  <td>
                    <label className="users-inline">
                      <input type="checkbox" checked={c.write} onChange={(e) => onChange(
                        selected.map((x) => (x.code === c.code ? { ...x, write: e.target.checked } : x)),
                      )} /> upis
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Upis važi samo uz pravo iz uloge (npr. izmena unosa). „Označi sve" dodeljuje sve <em>trenutne</em> centre —
        novi centri se ne dodaju sami. Pristup svim centrima, uključujući buduće, daje isključivo pravo{' '}
        <code>centers.manage</code> (administratorska uloga).
      </p>
    </div>
  );
}
