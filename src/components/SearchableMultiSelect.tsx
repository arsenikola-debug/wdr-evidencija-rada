import { useEffect, useMemo, useRef, useState } from 'react';
import { foldText } from '../features/admin/users';
import { sortByLabel } from '../lib/format/sort';

export interface MultiOption {
  value: string;
  /** Glavni tekst (npr. šifra centra ili naziv uloge). */
  label: string;
  /** Dopuna u istom redu (npr. „— Rakovica"). */
  hint?: string | null;
  disabled?: boolean;
}

/**
 * Višestruki izbor po WDR UX standardu (isti izgled i pravila kao CenterMultiSelect, 16bbf2c):
 * opcije A–Ž kroz zajednički `lib/format/sort.ts` (ili redosled pozivaoca kada je
 * `sort={false}`, npr. centri već sortirani po NAZIVU uz `sortCenters`); izabrane
 * oznake prate isti redosled, ne redosled klikova.
 *
 * jedna opcija u jednom redu, pretraga bez dijakritike, abecedno sortirano,
 * ceo red klikabilan, kompaktno. Za razliku od filtera izveštaja, prazan izbor
 * NE znači „sve" — tekst praznog stanja zadaje pozivalac.
 */
export function SearchableMultiSelect({
  options,
  value,
  onChange,
  label,
  emptyText = 'Ništa nije izabrano',
  searchPlaceholder = 'Pretraga…',
  disabled = false,
  maxChips = 3,
  sort = true,
  id,
}: {
  options: MultiOption[];
  value: string[];
  onChange(next: string[]): void;
  label: string;
  emptyText?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  maxChips?: number;
  sort?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const sorted = useMemo(() => (sort ? sortByLabel(options, (o) => o.label) : [...options]), [options, sort]);
  // Oznake izabranih u istom (abecednom) redosledu kao opcije.
  const selected = sorted.filter((o) => value.includes(o.value));
  const filtered = filterOptions(sorted, q);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="center-ms" ref={box}>
      <span className="center-ms-label" id={id ? `${id}-label` : undefined}>{label}</span>
      <div
        className="center-ms-control"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-disabled={disabled}
        aria-labelledby={id ? `${id}-label` : undefined}
        tabIndex={disabled ? -1 : 0}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
        }}
      >
        {selected.length === 0 ? (
          <span className="muted">{emptyText}</span>
        ) : (
          <>
            {selected.slice(0, maxChips).map((o) => (
              <span key={o.value} className="chip center-ms-chip" title={o.hint ? `${o.label} ${o.hint}` : o.label}>
                {o.label}
                {!disabled && (
                  <button type="button" aria-label={`Ukloni ${o.label}`}
                    onClick={(e) => { e.stopPropagation(); toggle(o.value); }}>×</button>
                )}
              </span>
            ))}
            {selected.length > maxChips && <span className="chip">+{selected.length - maxChips}</span>}
          </>
        )}
        <span className="center-ms-caret" aria-hidden>▾</span>
      </div>
      {open && !disabled && (
        <div className="center-ms-menu">
          <input
            type="search"
            autoFocus
            placeholder={searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={`Pretraga: ${label}`}
          />
          <ul role="listbox" aria-multiselectable="true">
            {filtered.length === 0 && <li className="muted small">Nema rezultata za „{q}".</li>}
            {filtered.map((o) => {
              const on = value.includes(o.value);
              return (
                <li key={o.value} role="option" aria-selected={on}>
                  <label className={on ? 'center-ms-option is-selected' : 'center-ms-option'}
                    title={o.hint ? `${o.label} ${o.hint}` : o.label}>
                    <input type="checkbox" checked={on} disabled={o.disabled} onChange={() => toggle(o.value)} />
                    <strong className="center-ms-code">{o.label}</strong>
                    {o.hint ? <em className="center-ms-name">{o.hint}</em> : null}
                  </label>
                </li>
              );
            })}
          </ul>
          {options.length > 1 && (
            <div className="filter-row" style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-small btn-quiet"
                onClick={() => onChange([...new Set([...value, ...filtered.filter((o) => !o.disabled).map((o) => o.value)])])}>
                Izaberi prikazane
              </button>
              {value.length > 0 && (
                <button type="button" className="btn btn-small btn-quiet" onClick={() => onChange([])}>
                  Očisti
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function filterOptions<T extends MultiOption>(options: T[], q: string): T[] {
  const t = foldText(q.trim());
  if (!t) return options;
  return options.filter((o) => foldText(o.label).includes(t) || foldText(o.hint ?? '').includes(t));
}
