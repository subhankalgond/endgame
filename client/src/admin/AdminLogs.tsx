import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, formatTime } from '../api';
import type { AuditLogView } from '../types';

interface LogsResponse {
  logs: AuditLogView[];
}

interface SubmissionsResponse {
  submissions: {
    teamName: string;
    leader: string;
    submissionNumber: number;
    sequence: string[];
    correct: number;
    incorrect: number;
    completed: boolean;
    createdAt: number;
    elapsedMs: number;
  }[];
}

interface AttemptsResponse {
  attempts: { team: string; player: string; answer: string; correct: boolean; attempt: number; createdAt: number }[];
}

export default function AdminLogs() {
  const [logs, setLogs] = useState<AuditLogView[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionsResponse['submissions']>([]);
  const [attempts, setAttempts] = useState<AttemptsResponse['attempts']>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<LogsResponse>('/api/admin/logs'),
      api.get<SubmissionsResponse>('/api/admin/submissions'),
      api.get<AttemptsResponse>('/api/admin/attempts'),
    ])
      .then(([logRes, subRes, attRes]) => {
        setLogs(logRes.logs);
        setSubmissions(subRes.submissions);
        setAttempts(attRes.attempts);
        setError(null);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="stack stack-wide">
      <div className="row-between">
        <h1 className="title-lg">Audit log</h1>
        <button className="btn btn-sm" type="button" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Final submissions</span>
          <span className="badge badge-quiet">{submissions.length} records</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Team</th>
                <th>Leader</th>
                <th>#</th>
                <th>Sequence</th>
                <th>Correct</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={7} className="faint">
                    No final submissions yet.
                  </td>
                </tr>
              )}
              {submissions.map((row) => (
                <tr key={`${row.teamName}-${row.submissionNumber}-${row.createdAt}`}>
                  <td className="num">{formatTime(row.createdAt)}</td>
                  <td>{row.teamName}</td>
                  <td>{row.leader}</td>
                  <td className="num">{row.submissionNumber}</td>
                  <td className="num">{row.sequence.join(' → ')}</td>
                  <td className="num">
                    {row.correct} correct · {row.incorrect} incorrect
                  </td>
                  <td>
                    <span className={`badge ${row.completed ? 'badge-ok' : 'badge-quiet'}`}>
                      {row.completed ? 'Correct' : 'Retry'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Puzzle attempts</span>
          <span className="badge badge-quiet">{attempts.length} records</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Team</th>
                <th>Player</th>
                <th>Attempt</th>
                <th>Answer</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {attempts.length === 0 && (
                <tr>
                  <td colSpan={6} className="faint">
                    No puzzle attempts yet.
                  </td>
                </tr>
              )}
              {attempts.map((row, idx) => (
                <tr key={`${row.player}-${row.attempt}-${row.createdAt}-${idx}`}>
                  <td className="num">{formatTime(row.createdAt)}</td>
                  <td>{row.team}</td>
                  <td>{row.player}</td>
                  <td className="num">{row.attempt}</td>
                  <td className="mono">{row.answer}</td>
                  <td>
                    <span className={`badge ${row.correct ? 'badge-ok' : 'badge-live'}`}>
                      {row.correct ? 'Correct' : 'Incorrect'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">System events</span>
          <span className="badge badge-quiet">{logs.length} records</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Actor</th>
                <th>Team</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id}>
                  <td className="num">{formatTime(row.createdAt)}</td>
                  <td className="mono">{row.event}</td>
                  <td>{row.actorType}</td>
                  <td className="num">{row.teamId ?? '—'}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {JSON.stringify(row.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
