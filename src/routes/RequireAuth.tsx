import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth/AuthProvider';
import { EmptyState, Spinner } from '../components/Bits';

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
