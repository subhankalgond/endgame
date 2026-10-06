import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError } from '../api';

/** Root gate: participants with a live session go straight to the game. */
export default function GatePage() {
  const [state, setState] = useState<'checking' | 'session' | 'none'>('checking');

  useEffect(() => {
    let alive = true;
    api
      .get('/api/session')
      .then(() => alive && setState('session'))
      .catch((err: ApiError) => alive && setState(err.status === 0 ? 'checking' : 'none'));
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'session') return <Navigate to="/play" replace />;

  return (
    <div className="page-center">
      <div className="brand" style={{ minWidth: 280 }}>
        <div className="brand-name">Endgame</div>
        <div className="brand-sub">Round 1 — The Mainframe</div>
        <div className="brand-rule" />
        <div className="tagline">Trust. Communicate. Solve. Survive.</div>
      </div>
      <p className="muted" style={{ maxWidth: 420 }}>
        {state === 'checking' ? 'Checking your session…' : 'Scan the QR code on your table to join your team.'}
      </p>
      <div className="row" style={{ gap: 16 }}>
        <a href="/terms">Event terms</a>
        <a href="/admin/login">Organiser access</a>
      </div>
    </div>
  );
}
