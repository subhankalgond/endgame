import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';

interface JoinInfo {
  team: { name: string };
  serverTime: number;
}

export default function JoinPage() {
  const { teamToken = '' } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<JoinInfo>(`/api/join/${encodeURIComponent(teamToken)}`)
      .then((res) => alive && setInfo(res))
      .catch((err: ApiError) => alive && setLookupError(err.message));
    return () => {
      alive = false;
    };
  }, [teamToken]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Enter your name (2-24 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    api
      .post<JoinInfo & { joined: boolean }>(`/api/join/${encodeURIComponent(teamToken)}`, { name: trimmed })
      .then(() => navigate('/play', { replace: true }))
      .catch((err: ApiError) => {
        setError(
          err.status === 0
            ? 'CONNECTION LOST. Trying to reconnect...'
            : err.status === 409
              ? err.message
              : err.status === 429
                ? 'Too many attempts. Please wait a moment.'
                : 'Unable to join. Please try again.',
        );
        setBusy(false);
      });
  }

  if (lookupError) {
    return (
      <div className="shell">
        <div className="stack">
          <Brand />
          <div className="notice notice-error">
            <strong>SCAN FAILED</strong>
            <p style={{ marginTop: 6, marginBottom: 0 }}>{lookupError}</p>
          </div>
          <p className="hint">
            Ask an event organiser for a new team QR code. Read the <a href="/terms">event terms</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="stack">
        <Brand />
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Scan complete</span>
            <span className="badge badge-quiet">{info ? 'QR verified' : 'Verifying…'}</span>
          </div>
          <div className="title-lg" style={{ marginBottom: 4 }}>
            {info ? info.team.name : 'Team lookup'}
          </div>
          <p className="muted" style={{ fontSize: 14 }}>
            {info ? 'You are joining this team session.' : 'Validating your team QR code…'}
          </p>

          <form onSubmit={submit} className="stack" style={{ maxWidth: 'none', gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="player-name">
                Enter your name
              </label>
              <input
                id="player-name"
                className="input"
                value={name}
                maxLength={24}
                autoComplete="name"
                placeholder="e.g. Riya"
                onChange={(e) => setName(e.target.value)}
                disabled={!info || busy}
              />
            </div>
            {error && <div className="notice notice-error">{error}</div>}
            <button className="btn btn-primary btn-block" type="submit" disabled={!info || busy}>
              {busy ? 'Joining…' : 'Join team'}
            </button>
          </form>
        </div>

        <div className="notice">
          <span className="eyebrow">Data use notice</span>
          <p style={{ margin: '6px 0 0', fontSize: 13 }} className="muted">
            We store your display name, team, answers and timestamps to run Round 1 of ENDGAME, to display team
            progress and to publish the final standings. Nothing else is collected. Your name is visible to your
            teammates and to the event organisers. Read the full{' '}
            <a href="/terms">event terms and fair-play rules</a>.
          </p>
        </div>

        <p className="footer-note">Trust. Communicate. Solve. Survive.</p>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-name">Endgame</div>
      <div className="brand-sub">Round 1 — The Mainframe</div>
      <div className="brand-rule" />
      <div className="tagline">Trust. Communicate. Solve. Survive.</div>
    </div>
  );
}
