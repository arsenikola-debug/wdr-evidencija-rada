import { useEffect, useMemo, useRef, useState } from 'react';

export interface CenterOption {
  id: string;
  code: string;
  name?: string | null;
}

/**
 * Izbor centara sa pretragom i višestrukim izborom (Admin → Izveštaji isplata).
 * Prazan izbor = SVI centri (isto značenje kao ranije, kada nijedan checkbox nije
 * bio označen). Izabrani se vide kao kompaktne oznake (do 3, zatim „+N").
 */
export function CenterMultiSelect({
  centers,
  value,
  onChange,
  label = 'Centri',
}: {
  centers: CenterOption[];
  value: string[];
  onChange(ids: string[]): void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const byId = useMemo(() => new Map(centers.map((c) => [c.id, c])), [centers]);
  const selected = value.map((id) => byId.get(id)).filter((c): c is CenterOption => Boolean(c));
  const filtered = filterCenters(centers, q);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="center-ms" ref={box}>
      <span className="center-ms-label">{label}</span>
      <div
        className="center-ms-control"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
      >
        {selected.length === 0 ? (
          <span className="muted">Svi centri</span>
        ) : (
          <>
            {selected.slice(0, 3).map((c) => (
              <span key={c.id} className="chip center-ms-chip">
                {c.code}
                <button type="button" aria-label={`Ukloni ${c.code}`}
                  onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>×</button>
              </span>
            ))}
            {selected.length > 3 && <span className="chip">+{selected.length - 3}</span>}
          </>
        )}
        <span className="center-ms-caret" aria-hidden>▾</span>
      </div>
      {selected.length > 0 && (
        <button type="button" className="btn btn-small btn-quiet center-ms-clear" onClick={() => onChange([])}>
          Očisti
        </button>
      )}
      {open && (
        <div className="center-ms-menu">
          <input
            type="search"
            autoFocus
            placeholder="Pretraga centra…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Pretraga centra"
          />
          <ul role="listbox" aria-multiselectable="true">
            {filtered.length === 0 && <li className="muted small">Nema centra za „{q}".</li>}
            {filtered.map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={value.includes(c.id)} onChange={() => toggle(c.id)} />
                  <strong>{c.code}</strong>{c.name ? <span className="muted"> · {c.name}</span> : null}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Pretraga po šifri ili nazivu, bez obzira na dijakritiku i velika/mala slova. */
export function filterCenters<T extends CenterOption>(centers: T[], q: string): T[] {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'dj');
  const t = norm(q.trim());
  if (!t) return centers;
  return centers.filter((c) => norm(c.code).includes(t) || norm(c.name ?? '').includes(t));
}
