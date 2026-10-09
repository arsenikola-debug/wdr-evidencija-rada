import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Banner } from '../components/Bits';
import { MIN_PASSWORD_LENGTH, passwordFormError } from '../features/auth/passwordPolicy';
import { messageForCode } from '../features/grid/errors';
import { WdrApiError } from '../lib/api';
import { useAuth } from '../lib/auth/AuthProvider';

/**
 * Obavezna promena privremene lozinke (prvi login / posle admin reseta).
 *
 * Dok je `must_change_password = true`, RequireAuth sve rute vodi ovde, a baza
 * korisniku ne daje ništa (app.profile_id() = NULL) — ni direktnim API pozivom.
 * Edge Function proverava trenutnu (privremenu) lozinku, postavlja novu, briše
 * zastavicu (samo service_role) i gasi sve sesije → nova prijava.
 *
 * Privremena lozinka unesena na prijavi uzima se iz memorije (jednom); polje se
 * prikazuje samo ako je nema (npr. posle osvežavanja stranice).
 */
export function SetPassword() {
  const { api, session, signOut, takeLoginPassword } = useAuth();
  const navigate = useNavigate();
  const [remembered] = useState<string | null>(() => takeLoginPassword());
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session && !session.must_change_password) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const currentPassword = remembered ?? current;
    if (currentPassword === '') { setError('Unesite privremenu lozinku koju ste dobili od administratora.'); return; }
    const problem = passwordFormError(password, confirm, currentPassword, session?.email ?? null);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await api.changePassword(currentPassword, password);
      await signOut();
      navigate('/login', {
        replace: true,
        state: { notice: 'Lozinka je postavljena. Prijavite se svojim emailom i novom lozinkom.' },
      });
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
        <p className="login-sub">Postavite novu lozinku</p>
        <Banner kind="info">
          Prijavili ste se privremenom lozinkom. Pre nastavka postavite svoju lozinku — administrator je ne vidi.
        </Banner>
        {error && <Banner kind="error">{error}</Banner>}
        {remembered === null && (
          <label>
            <span>Privremena lozinka</span>
            <input type="password" value={current} autoComplete="current-password" required
              onChange={(e) => setCurrent(e.target.value)} />
          </label>
        )}
        <label>
          <span>Nova lozinka</span>
          <input type="password" value={password} autoComplete="new-password" required
            minLength={MIN_PASSWORD_LENGTH} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          <span>Ponovite novu lozinku</span>
          <input type="password" value={confirm} autoComplete="new-password" required
            minLength={MIN_PASSWORD_LENGTH} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Čuvanje…' : 'Postavi lozinku'}
        </button>
        <p className="login-hint">Najmanje {MIN_PASSWORD_LENGTH} znakova, različita od privremene, bez vašeg emaila.</p>
        <button type="button" className="btn btn-quiet btn-block" onClick={() => void signOut()}>Odjavi se</button>
      </form>
    </div>
  );
}
