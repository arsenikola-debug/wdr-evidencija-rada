import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner } from '../components/Bits';
import { useAuth } from '../lib/auth/AuthProvider';

export function ChangePassword() {
  const { api, signOut } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Nova šifra mora imati najmanje 8 znakova.');
      return;
    }

    if (password !== confirm) {
      setError('Unete šifre se ne poklapaju.');
      return;
    }

    setBusy(true);

    try {
      await api.updatePassword(password);
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promena šifre nije uspela.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Promeni šifru</h1>
        <p className="login-sub">Unesite novu šifru za WDR nalog.</p>

        {error && <Banner kind="error">{error}</Banner>}

        <label>
          <span>Nova šifra</span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label>
          <span>Ponovite novu šifru</span>
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            required
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Čuvanje…' : 'Promeni šifru'}
        </button>
      </form>
    </div>
  );
}
