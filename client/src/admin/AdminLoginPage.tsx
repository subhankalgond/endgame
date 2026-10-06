import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    api
      .post('/api/admin/login', { username, password })
      .then(() => navigate('/admin', { replace: true }))
      .catch((err: ApiError) => {
        setBusy(false);
        if (err.status === 401) setError('Invalid credentials.');
        else if (err.status === 429) setError('Too many attempts. Wait a moment and try again.');
        else if (err.status === 0) setError(err.message);
        else setError('Unable to sign in. Please try again.');
      });
  }

  return (
    <div className="page-center">
      <form className="panel stack" style={{ maxWidth: 380 }} onSubmit={submit}>
        <div>
          <div className="brand-name">Endgame</div>
          <div className="brand-sub">Organiser access</div>
        </div>
        <div className="field">
          <label className="label" htmlFor="admin-user">Username</label>
          <input
            id="admin-user"
            className="input"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="admin-pass">Password</label>
          <input
            id="admin-pass"
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="notice notice-error">{error}</div>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="hint" style={{ marginBottom: 0 }}>
          Administrator sessions are HttpOnly cookies and expire automatically.
        </p>
      </form>
    </div>
  );
}
