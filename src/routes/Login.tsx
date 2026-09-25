import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth/AuthProvider';
import { Banner } from '../components/Bits';
import { messageForCode } from '../features/grid/errors';
import { WdrApiError } from '../lib/api';

export function Login() {
  const { session, signIn, loading, apiKind, error: authError } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState(apiKind === 'mock' ? 'operater@wdr.local' : '');
  const [password, setPassword] = useState(apiKind === 'mock' ? 'mock1234' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/unos';
    return <Navigate to={from} replace />;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>WDR</h1>
        <p className="login-sub">Dnevna evidencija rada</p>

        {(error || authError) && <Banner kind="error">{error || authError}</Banner>}

        <label>
          <span>E-adresa</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <span>Šifra</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Prijava…' : 'Prijavi se'}
        </button>

        {apiKind === 'mock' && (
          <p className="login-hint">Mock režim: bilo koja e-adresa sa @ i šifra od 4+ znaka.</p>
        )}
      </form>
    </div>
  );
}
