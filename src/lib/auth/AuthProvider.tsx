import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /**
   * Lozinka upravo unesena na prijavi — SAMO u memoriji (ref), samo dok traje
   * obavezna promena privremene lozinke, i čita se jednom. Nikad u storage/URL.
   */
  takeLoginPassword(): string | null;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { api, kind, demoRates } = useMemo(() => getApi(), []);
  const [session, setSession] = useState<SessionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loginPassword = useRef<string | null>(null);

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

  // Privremena lozinka se drži samo dok je promena obavezna.
  useEffect(() => {
    if (!session || !session.must_change_password) loginPassword.current = null;
  }, [session]);

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
        loginPassword.current = password;
        await refresh();
      },
      signOut: async () => {
        loginPassword.current = null;
        await api.signOut();
        setSession(null);
      },
      takeLoginPassword: () => {
        const p = loginPassword.current;
        loginPassword.current = null;
        return p;
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
