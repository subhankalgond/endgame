import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, formatDuration, formatTime } from '../api';
import type { ResultView } from '../types';
import { onServerEvent } from '../realtime';

interface ResultsResponse {
  round: { state: string; endedAt: number | null };
  results: ResultView[];
}

export default function AdminResults() {
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<ResultsResponse>('/api/admin/results')
      .then((res) => {
        setData(res);
        setMessage(null);
      })
      .catch((err: ApiError) => setMessage(err.message));
  }, []);

  useEffect(() => {
    load();
    const off = onServerEvent(() => load());
    return () => {
      off();
    };
  }, [load]);

  function recompute() {
    api
      .post<{ results: ResultView[] }>('/api/admin/rankings/recompute', {})
      .then(() => load())
      .catch((err: ApiError) => setMessage(err.message));
  }

  return (
    <div className="stack stack-wide">
      <div className="row-between">
        <h1 className="title-lg">Results</h1>
        <div className="btn-row">
          <button className="btn btn-sm" type="button" onClick={load}>
            Refresh
          </button>
          <button className="btn btn-sm" type="button" onClick={recompute}>
            Recompute rankings
          </button>
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <span className="badge">Round {data?.round.state ?? '—'}</span>
        <span className="badge badge-quiet">Ended {formatTime(data?.round.endedAt ?? null)}</span>
        <span className="badge badge-quiet">Top 4 qualify</span>
      </div>

      {message && <div className="notice notice-error">{message}</div>}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Team</th>
              <th>Puzzles</th>
              <th>Final attempts</th>
              <th>Final result</th>
              <th>Completion time</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.results ?? []).map((row) => (
              <tr key={row.teamId}>
                <td className="num">{row.rank}</td>
                <td>{row.teamName}</td>
                <td className="num">{row.puzzlesSolved}/4</td>
                <td className="num">{row.finalAttempts}</td>
                <td>{row.completed ? 'Correct' : 'Incomplete'}</td>
                <td className="num">{formatDuration(row.completionTimeMs)}</td>
                <td>
                  <span className={`badge ${row.status === 'QUALIFIED' ? 'badge-ok' : 'badge-live'}`}>
                    {row.status === 'QUALIFIED' ? 'Qualified' : 'Eliminated'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="footer-note">
        Ranking: completion status first, then server-recorded completion time, then fewer incorrect final
        submissions, then fewer incorrect puzzle attempts, then earliest server timestamp. Live standings update as
        teams finish; the final table is locked when the round ends.
      </p>
    </div>
  );
}
