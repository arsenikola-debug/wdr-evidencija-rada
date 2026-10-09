import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner } from '../components/Bits';
import { MIN_PASSWORD_LENGTH, passwordFormError } from '../features/auth/passwordPolicy';
import { messageForCode } from '../features/grid/errors';
import { WdrApiError } from '../lib/api';
import { useAuth } from '../lib/auth/AuthProvider';

/**
 * Promena sopstvene lozinke (bez obaveze). Isti serverski put kao prvi login
 * (Edge Function `change_own_password`): proverava trenutnu lozinku, postavlja
 * novu, beleži USER_PASSWORD_CHANGED (bez lozinke) i gasi sve sesije.
 */
export function ChangePassword() {
  const { api, session, signOut } = useAuth();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (current === '') { setError('Unesite trenutnu lozinku.'); return; }
    const problem = passwordFormError(password, confirm, current, session?.email ?? null);
    if (problem) { setError(problem); return; }

    setBusy(true);
    try {
      await api.changePassword(current, password);
      await signOut();
      navigate('/login', {
        replace: true,
        state: { notice: 'Lozinka je promenjena. Prijavite se novom lozinkom.' },
      });
    } catch (err) {
      const code = err instanceof WdrApiError ? err.code : null;
      setError(messageForCode(code, err instanceof Error ? err.message : 'Promena šifre nije uspela.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Promeni šifru</h1>
        <p className="login-sub">Unesite trenutnu i novu šifru za WDR nalog.</p>

        {error && <Banner kind="error">{error}</Banner>}

        <label>
          <span>Trenutna šifra</span>
          <input type="password" value={current} autoComplete="current-password" required
            onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          <span>Nova šifra</span>
          <input type="password" value={password} autoComplete="new-password" required
            minLength={MIN_PASSWORD_LENGTH} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          <span>Ponovite novu šifru</span>
          <input type="password" value={confirm} autoComplete="new-password" required
            minLength={MIN_PASSWORD_LENGTH} onChange={(e) => setConfirm(e.target.value)} />
        </label>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Čuvanje…' : 'Promeni šifru'}
        </button>
        <p className="login-hint">Posle promene bićete odjavljeni sa svih uređaja.</p>
      </form>
    </div>
  );
}
