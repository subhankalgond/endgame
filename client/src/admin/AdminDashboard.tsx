import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, formatClock, formatTime } from '../api';
import type { LiveStatus } from '../types';
import { onServerEvent } from '../realtime';

export function useLiveStatus(pollMs = 5000): { data: LiveStatus | null; error: string | null; refresh: () => void } {
  const [data, setData] = useState<LiveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .get<LiveStatus>('/api/admin/live-status')
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    const off = onServerEvent(() => refresh());
    const id = window.setInterval(refresh, pollMs);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [refresh, pollMs]);

  return { data, error, refresh };
}

export function stateBadge(state: string): string {
  switch (state) {
    case 'COMPLETED':
    case 'QUALIFIED':
      return 'badge badge-ok';
    case 'FINAL_SEQUENCE':
      return 'badge badge-warn';
    case 'TEAM_PUZZLES':
      return 'badge badge-live';
    case 'WAITING_FOR_PLAYERS':
      return 'badge badge-quiet';
    default:
      return 'badge';
  }
}

export default function AdminDashboard() {
  const { data, error } = useLiveStatus();
  const [round, setRound] = useState<{
    state: string;
    startedAt: number | null;
    endsAt: number | null;
    durationSec: number;
    remainingMs: number;
    serverTime: number;
  } | null>(null);

  const loadRound = useCallback(() => {
    api
      .get<{ round: typeof round }>('/api/admin/round')
      .then((res) => setRound(res.round))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadRound();
    const off = onServerEvent(loadRound);
    const id = window.setInterval(loadRound, 1000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [loadRound]);

  const inProgress = data?.teams.filter((t) => t.status === 'TEAM_PUZZLES' || t.status === 'FINAL_SEQUENCE').length ?? 0;
  const completed = data?.teams.filter((t) => t.status === 'COMPLETED').length ?? 0;

  return (
    <div className="stack stack-wide">
      <div className="row-between">
        <h1 className="title-lg">Dashboard</h1>
        <span className={`badge ${round?.state === 'ACTIVE' ? 'badge-live' : ''}`}>
          Round {round?.state ?? '—'}
        </span>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {round && round.state !== 'ACTIVE' && (data?.readyTeams ?? 0) > 0 ? (
        <div className="notice notice-warn">
          <strong>{data?.readyTeams}/8 teams ready</strong> — ready teams are waiting on their game screens.
          The round starts automatically a few seconds after the first team fills up; “Start round” under
          Round control starts it right now.
        </div>
      ) : null}

      <div className="grid-4">
        <div className="stat">
          <div className="stat-label">Participants</div>
          <div className="stat-value">{data ? `${data.participants} / 32` : '—'}</div>
          <div className="stat-sub">joined through team QR codes</div>
        </div>
        <div className="stat">
          <div className="stat-label">Teams ready</div>
          <div className="stat-value">{data ? `${data.readyTeams} / 8` : '—'}</div>
          <div className="stat-sub">all four players connected</div>
        </div>
        <div className="stat">
          <div className="stat-label">In progress</div>
          <div className="stat-value">{data ? inProgress : '—'}</div>
          <div className="stat-sub">teams playing right now</div>
        </div>
        <div className="stat">
          <div className="stat-label">Completed</div>
          <div className="stat-value">{data ? completed : '—'}</div>
          <div className="stat-sub">mainframe unlocked</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Round clock</span>
          <span className="badge">{round ? round.state : '—'}</span>
        </div>
        <div className="row-between">
          <div className="timer-value">
            {round?.state === 'ACTIVE' ? formatClock(round.remainingMs) : '--:--'}
          </div>
          <div className="mono faint" style={{ fontSize: 12, textAlign: 'right' }}>
            started {formatTime(round?.startedAt ?? null)}
            <br />
            ends {formatTime(round?.endsAt ?? null)}
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Use Round control to prepare, start, end or reset the round.
        </p>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Team</th>
              <th>Players</th>
              <th>Leader</th>
              <th>Puzzles</th>
              <th>Final</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.teams ?? []).map((team) => (
              <tr key={team.id}>
                <td>{team.name}</td>
                <td className="num">{team.players}/4</td>
                <td>{team.leaderName ? `P${team.leaderSlot} ${team.leaderName}` : '—'}</td>
                <td className="num">{team.solved}/4</td>
                <td className="num">
                  {team.finalAttempts > 0
                    ? `${team.finalAttempts} attempt${team.finalAttempts === 1 ? '' : 's'}`
                    : 'Not yet'}
                </td>
                <td>
                  <span className={stateBadge(team.status)}>{team.status.replace(/_/g, ' ')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
