import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import type { AdminTeam } from '../types';

interface TeamsResponse {
  teams: AdminTeam[];
}

export default function AdminTeams() {
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<TeamsResponse>('/api/admin/teams')
      .then((res) => {
        setTeams(res.teams);
        setError(null);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  function update(teamId: number, patch: Partial<AdminTeam>) {
    setTeams((current) => current.map((t) => (t.id === teamId ? { ...t, ...patch } : t)));
  }

  function save(team: AdminTeam) {
    setSaved(null);
    setError(null);
    api
      .put(`/api/admin/teams/${team.id}`, { name: team.name, roster: team.roster })
      .then(() => setSaved(`team-${team.id}`))
      .catch((err: ApiError) => setError(err.message));
  }

  function saveSequence(team: AdminTeam) {
    setSaved(null);
    setError(null);
    api
      .put(`/api/admin/teams/${team.id}/sequence`, { sequence: team.correctSequence })
      .then(() => setSaved(`seq-${team.id}`))
      .catch((err: ApiError) => setError(err.message));
  }

  // One row per joined player, plus a placeholder row for teams still waiting.
  type PlayerSlot = AdminTeam['players'][number];
  const playerRows: { team: AdminTeam; player: PlayerSlot | null }[] = teams.flatMap(
    (team): { team: AdminTeam; player: PlayerSlot | null }[] =>
      team.players.length === 0
        ? [{ team, player: null }]
        : team.players.map((player) => ({ team, player })),
  );

  return (
    <div className="stack stack-wide">
      <div className="row-between">
        <h1 className="title-lg">Teams</h1>
        <span className="badge">8 teams · 4 players each</span>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Players</span>
          <span className="badge badge-quiet">
            {teams.reduce((total, team) => total + team.players.length, 0)} / 32 joined
          </span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Team</th>
                <th>Slot</th>
                <th>Player</th>
                <th>Role</th>
                <th>Puzzle</th>
              </tr>
            </thead>
            <tbody>
              {playerRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="faint">
                    No participants have scanned a team QR code yet.
                  </td>
                </tr>
              ) : (
                playerRows.map(({ team, player }) =>
                  player === null ? (
                    <tr key={`t${team.id}`}>
                      <td>{team.name}</td>
                      <td colSpan={4} className="faint">
                        No players connected yet
                      </td>
                    </tr>
                  ) : (
                    <tr key={`${team.id}-${player.slot}`}>
                      <td>{team.name}</td>
                      <td className="num">P{player.slot}</td>
                      <td>{player.name}</td>
                      <td>
                        <span className={`badge ${player.isLeader ? 'badge-warn' : 'badge-quiet'}`}>
                          {player.isLeader ? 'Leader' : 'Member'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${player.solved ? 'badge-ok' : 'badge-quiet'}`}>
                          {player.solved ? 'Solved' : 'Open'}
                        </span>
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        {teams.map((team) => (
          <div className="team-card" key={team.id}>
            <div className="row-between">
              <h3>Team {team.id}</h3>
              <span className={`badge ${team.players.length === 4 ? 'badge-ok' : 'badge-quiet'}`}>
                {team.players.length}/4 joined
              </span>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label className="label" htmlFor={`team-name-${team.id}`}>Team name</label>
              <input
                id={`team-name-${team.id}`}
                className="input"
                value={team.name}
                maxLength={32}
                onChange={(e) => update(team.id, { name: e.target.value })}
              />
            </div>

            <div className="stack" style={{ marginTop: 10, gap: 8 }}>
              {[0, 1, 2, 3].map((idx) => (
                <div className="field" key={idx}>
                  <label className="label" htmlFor={`roster-${team.id}-${idx}`}>
                    Player {idx + 1} name
                  </label>
                  <input
                    id={`roster-${team.id}-${idx}`}
                    className="input"
                    value={team.roster[idx] ?? ''}
                    maxLength={24}
                    onChange={(e) => {
                      const roster = [...team.roster];
                      roster[idx] = e.target.value;
                      update(team.id, { roster });
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="divider" style={{ margin: '12px 0' }} />
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Correct final sequence (server side only)
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {team.correctSequence.map((token, idx) => (
                <select
                  key={idx}
                  className="select"
                  style={{ width: 92 }}
                  aria-label={`Position ${idx + 1}`}
                  value={token}
                  onChange={(e) => {
                    const next = [...team.correctSequence];
                    next[idx] = e.target.value;
                    update(team.id, { correctSequence: next });
                  }}
                >
                  {team.correctSequence.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              Reward tokens: {team.players.length > 0 ? 'earned by players after solving' : 'set in Puzzles'}.
            </p>

            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm" type="button" onClick={() => save(team)}>
                Save team
              </button>
              <button className="btn btn-sm btn-amber" type="button" onClick={() => saveSequence(team)}>
                Save sequence
              </button>
              {saved === `team-${team.id}` && <span className="badge badge-ok">Saved</span>}
              {saved === `seq-${team.id}` && <span className="badge badge-ok">Sequence saved</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="footer-note">
        Player names entered by participants during check-in can be corrected here; duplicate names on one team are
        rejected by the server.
      </p>
    </div>
  );
}
