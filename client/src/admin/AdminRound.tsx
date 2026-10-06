import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, formatClock } from '../api';
import { onServerEvent } from '../realtime';
import { stateBadge, useLiveStatus } from './AdminDashboard';

interface RoundInfo {
  round: {
    state: string;
    startedAt: number | null;
    endsAt: number | null;
    durationSec: number;
    remainingMs: number;
    serverTime: number;
  };
  readyTeams?: number;
  participants?: number;
  expected?: { participants: number; teams: number };
}

export default function AdminRound() {
  const { data: live } = useLiveStatus(3000);
  const [info, setInfo] = useState<RoundInfo | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<RoundInfo>('/api/admin/round')
      .then((res) => {
        setInfo(res);
        setMessage(null);
      })
      .catch((err: ApiError) => setMessage({ kind: 'error', text: err.message }));
  }, []);

  useEffect(() => {
    load();
    const off = onServerEvent(load);
    const id = window.setInterval(load, 1000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [load]);

  function action(name: string, path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(name);
    api
      .post<RoundInfo>(path, body)
      .then((res) => {
        setInfo(res);
        setMessage({ kind: 'ok', text: `${name} executed.` });
      })
      .catch((err: ApiError) => setMessage({ kind: 'error', text: err.message }))
      .finally(() => setBusy(null));
  }

  const state = info?.round.state ?? '—';
  const readyTeams = info?.readyTeams ?? live?.readyTeams ?? 0;
  const participants = info?.participants ?? live?.participants ?? 0;

  return (
    <div className="stack stack-wide">
      <div className="row-between">
        <h1 className="title-lg">Round control</h1>
        <span className={`badge ${state === 'ACTIVE' ? 'badge-live' : ''}`}>{state}</span>
      </div>

      <div className="grid-4">
        <div className="stat">
          <div className="stat-label">Participants</div>
          <div className="stat-value">
            {participants} / {info?.expected?.participants ?? 32}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Teams ready</div>
          <div className="stat-value">
            {readyTeams} / {info?.expected?.teams ?? 8}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Clock</div>
          <div className="stat-value">
            {state === 'ACTIVE' ? formatClock(info?.round.remainingMs ?? 0) : '--:--'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Duration</div>
          <div className="stat-value">{Math.round((info?.round.durationSec ?? 600) / 60)}:00</div>
          <div className="stat-sub">server-side timer</div>
        </div>
      </div>

      {message && (
        <div className={`notice ${message.kind === 'ok' ? 'notice-ok' : 'notice-error'}`}>{message.text}</div>
      )}

      {(state === 'WAITING' || state === 'READY') && readyTeams > 0 ? (
        <div className="notice notice-warn">
          <strong>{readyTeams}/8 teams ready</strong> — those players are waiting on their game screens. The
          round starts automatically a few seconds after the first team fills up; “Start round” below starts
          it right now.
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Controls</span>
          <span className="badge badge-quiet">All actions are server controlled</span>
        </div>
        <div className="btn-row">
          <button
            className="btn"
            type="button"
            disabled={busy !== null || state === 'ACTIVE' || state === 'READY'}
            onClick={() => action('Prepare', '/api/admin/round/prepare', {})}
          >
            Prepare round
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy !== null || state === 'ACTIVE' || state === 'ENDED'}
            onClick={() =>
              action(
                'Start',
                '/api/admin/round/start',
                {},
                `Start Round 1 now?\n${participants}/32 participants and ${readyTeams}/8 teams are ready. The 10:00 timer begins immediately.`,
              )
            }
          >
            Start round
          </button>
          <button
            className="btn btn-amber"
            type="button"
            disabled={busy !== null || state !== 'ACTIVE'}
            onClick={() =>
              action('End', '/api/admin/round/end', {}, 'End Round 1 now?\nAll answers lock and standings are calculated.')
            }
          >
            End round
          </button>
          <button
            className="btn btn-danger"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              action(
                'Reset',
                '/api/admin/round/reset',
                { confirm: true },
                'RESET ROUND?\nThis clears participant progress, puzzle attempts, final submissions, leader assignments, the timer and team completion status.\n\nTeam, puzzle and QR configuration is preserved.',
              )
            }
          >
            Reset round
          </button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          PREPARE marks the event ready. START sets roundStartedAt and roundEndsAt on the server. END locks all
          submissions and computes the ranking. RESET requires confirmation and never deletes configuration.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Team readiness</span>
        </div>
        <div className="roster">
          {(live?.teams ?? []).map((team) => (
            <div className="roster-row" key={team.id}>
              <span className="roster-slot">T{team.id}</span>
              <span className="roster-name">{team.name}</span>
              <span className="mono faint" style={{ fontSize: 12 }}>
                {team.players}/4 · {team.solved}/4 solved
              </span>
              <span className={stateBadge(team.status)}>{team.status.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
