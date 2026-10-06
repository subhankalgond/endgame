import { formatClock, formatTime } from '../api';
import { stateBadge, useLiveStatus } from './AdminDashboard';

export default function AdminLive() {
  const { data, error } = useLiveStatus(2000);

  const timeLeft = data && data.round.state === 'ACTIVE' && data.round.ends_at ? Math.max(0, data.round.ends_at - data.serverTime) : 0;

  return (
    <div className="stack stack-wide">
      <div className="row-between">
        <h1 className="title-lg">Live monitoring</h1>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${data?.round.state === 'ACTIVE' ? 'badge-live' : ''}`}>
            {data?.round.state ?? '—'}
          </span>
          <span className="badge badge-quiet mono">
            {data && data.round.state === 'ACTIVE' ? formatClock(timeLeft) : '--:--'}
          </span>
        </div>
      </div>

      <p className="hint">
        Updates arrive over WebSocket — no manual refresh needed. Last update:{' '}
        {data ? formatTime(data.serverTime) : '—'}
      </p>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="grid-2">
        {(data?.teams ?? []).map((team) => (
          <div className="team-card" key={team.id}>
            <div className="row-between">
              <h3>{team.name}</h3>
              <span className={stateBadge(team.status)}>{team.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Connected</span>
              <span className="kv-v">{team.players}/4</span>
            </div>
            <div className="kv">
              <span className="kv-k">Leader</span>
              <span className="kv-v">
                {team.leaderName ? `P${team.leaderSlot} · ${team.leaderName}` : 'Not selected'}
              </span>
            </div>
            <div className="kv">
              <span className="kv-k">Puzzles solved</span>
              <span className="kv-v">{team.solved}/4</span>
            </div>
            <div className="kv">
              <span className="kv-k">Final submission</span>
              <span className="kv-v">
                {team.finalAttempts === 0
                  ? 'Not yet'
                  : `${team.finalAttempts} attempt${team.finalAttempts === 1 ? '' : 's'}${
                      team.lastFeedback ? ` · ${team.lastFeedback.correct} correct` : ''
                    }`}
              </span>
            </div>
            <div className="kv">
              <span className="kv-k">Completion</span>
              <span className="kv-v">
                {team.completionTimeMs != null ? formatClock(team.completionTimeMs) : '—'}
              </span>
            </div>
            <div className="kv">
              <span className="kv-k">Round clock</span>
              <span className="kv-v">
                {data && data.round.state === 'ACTIVE' && data.round.ends_at
                  ? formatClock(Math.max(0, data.round.ends_at - data.serverTime))
                  : '--:--'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
