import { useEffect, useState } from 'react';
import { ApiError, api, formatDuration, formatTime } from '../api';
import type { ResultView } from '../types';

interface ResultsResponse {
  round: { state: string; endedAt: number | null };
  results: ResultView[];
}

export default function ResultsPage() {
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<ResultsResponse>('/api/results')
      .then((res) => alive && setData(res))
      .catch((err: ApiError) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="shell">
      <div className="stack stack-wide">
        <div className="brand">
          <div className="brand-name">Endgame</div>
          <div className="brand-sub">Round 1 results — The Mainframe</div>
        </div>

        {error && <div className="notice notice-warn">{error}</div>}
        {!data && !error && <div className="notice">Loading standings…</div>}

        {data && (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Team</th>
                    <th>Puzzles</th>
                    <th>Final result</th>
                    <th>Completion time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((row) => (
                    <tr key={row.teamId}>
                      <td className="num">{row.rank}</td>
                      <td>{row.teamName}</td>
                      <td className="num">
                        {row.puzzlesSolved}/4
                      </td>
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
              Ranked by completion status, then server-recorded completion time. Round ended:{' '}
              {formatTime(data.round.endedAt)}.
            </p>
          </>
        )}

        <a href="/play" className="center" style={{ display: 'block' }}>
          Back to game
        </a>
      </div>
    </div>
  );
}
