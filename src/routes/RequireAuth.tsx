import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth/AuthProvider';
import { EmptyState, Spinner } from '../components/Bits';
import { SET_PASSWORD_PATH } from '../features/auth/passwordPolicy';

/**
 * Role-aware gate. The permission list mirrors app.has_perm(), but it only
 * decides what to RENDER — the database enforces every rule again on each call.
 */
export function RequireAuth({
  children,
  permission,
}: {
  children: ReactNode;
  permission?: string;
}) {
  const { loading, session, can } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Provera sesije…" />;
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />;

  // Privremena lozinka: jedini dozvoljen ekran je postavljanje nove. Ovo je samo
  // UX — baza takvom korisniku ionako ne daje ništa (app.profile_id() = NULL).
  if (session.must_change_password && location.pathname !== SET_PASSWORD_PATH) {
    return <Navigate to={SET_PASSWORD_PATH} replace />;
  }

  if (permission && !can(permission)) {
    return (
      <EmptyState
        title="Nemate pravo pristupa ovoj stranici."
        hint={`Potrebna permisija: ${permission}. Obratite se administratoru.`}
      />
    );
  }

  return <>{children}</>;
}
