import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ADMIN_ENTRY_PERMISSIONS,
  ADMIN_PAGE_PATH,
  type AdminGroup,
  type AdminSectionKey,
  canEnterAdmin,
  moduleHref,
} from '../features/admin/adminNavigation';
import { useAuth } from '../lib/auth/AuthProvider';
import { EmptyState } from './Bits';

/**
 * Ulaz u /administracija: dovoljno je pravo na BAR JEDAN administrativni modul.
 * Ide UNUTAR RequireAuth (sesija, prijava, obavezna promena lozinke). Ne daje
 * nijedno novo pravo — landing prikazuje samo module koje korisnik već sme da otvori,
 * a svaka direktna ruta zadržava svoj RequireAuth.
 */
export function AdminEntryGate({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  if (!canEnterAdmin(can)) {
    return (
      <EmptyState
        title="Nemate pravo pristupa ovoj stranici."
        hint={`Potrebno je pravo na bar jedan administrativni modul (${ADMIN_ENTRY_PERMISSIONS.join(', ')}). Obratite se administratoru.`}
      />
    );
  }
  return <>{children}</>;
}

/**
 * Landing Administracije: grupe kao kartice, unutar svake samo moduli koje
 * korisnik sme da vidi (filtrirano pre poziva — visibleAdminGroups).
 */
export function AdminLanding({ groups }: { groups: readonly AdminGroup[] }) {
  return (
    <div className="admin-groups" role="list" aria-label="Grupe administracije">
      {groups.map((g) => (
        <section key={g.key} className="admin-group-card" role="listitem" aria-labelledby={`admin-group-${g.key}`}>
          <h2 id={`admin-group-${g.key}`}>{g.title}</h2>
          <p className="muted small">{g.description}</p>
          <ul className="admin-module-list">
            {g.modules.map((m) => (
              <li key={m.key}>
                <Link to={moduleHref(m)} className="admin-module-link" data-module={m.key}>
                  <strong>{m.label}</strong>
                  <span>{m.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Unutar grupe: putanja nazad + sekundarna navigacija (2–4 modula, prelama se
 * u više redova na uskom ekranu — nema dugačke trake koja klizi).
 */
export function AdminSectionNav({ group, active }: { group: AdminGroup; active: AdminSectionKey }) {
  return (
    <>
      <nav className="admin-breadcrumb" aria-label="Putanja">
        <Link to={ADMIN_PAGE_PATH}>Administracija</Link>
        <span aria-hidden="true"> / </span>
        <span>{group.title}</span>
      </nav>
      <nav className="admin-subnav" aria-label={`Moduli: ${group.title}`}>
        {group.modules.map((m) => {
          const current = m.kind === 'section' && m.key === active;
          return (
            <Link key={m.key} to={moduleHref(m)}
              className={current ? 'btn btn-primary' : 'btn btn-quiet'}
              aria-current={current ? 'page' : undefined}
              data-module={m.key}>
              {m.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
