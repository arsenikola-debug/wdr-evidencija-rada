import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getApi } from '../api';
import type { SessionProfile } from '../api/types';
import type { WdrApi } from '../api/WdrApi';

interface AuthValue {
  api: WdrApi;
  apiKind: 'mock' | 'supabase';
  demoRates: boolean;
  loading: boolean;
  session: SessionProfile | null;
  error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Permission check mirrors app.has_perm(); the database still enforces it. */
  can(permission: string): boolean;
  writableCenters(): SessionProfile['centers'];
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { api, kind, demoRates } = useMemo(() => getApi(), []);
  const [session, setSession] = useState<SessionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.getSession());
      setError(null);
    } catch (err) {
      setSession(null);
      setError(err instanceof Error ? err.message : 'Greška pri čitanju sesije.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      api,
      apiKind: kind,
      demoRates,
      loading,
      session,
      error,
      signIn: async (email, password) => {
        setError(null);
        await api.signIn(email, password);
        await refresh();
      },
      signOut: async () => {
        await api.signOut();
        setSession(null);
      },
      can: (permission) => Boolean(session?.permissions.includes(permission)),
      writableCenters: () => (session?.centers ?? []).filter((c) => c.can_write),
    }),
    [api, kind, demoRates, loading, session, error, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth mora biti unutar <AuthProvider>.');
  return ctx;
}
