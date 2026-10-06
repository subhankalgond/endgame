import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, formatClock, formatDuration } from '../api';
import type { ParticipantPayload, SubmissionView } from '../types';
import { useCountdown, useGame } from './useGame';

interface FinalFeedback {
  correct: number;
  incorrect: number;
  submissionNumber: number;
  completed: boolean;
}

export default function PlayPage() {
  const { snapshot, error, loading, connected, refresh } = useGame();
  const countdown = useCountdown(snapshot);

  if (loading) return <div className="page-center muted">Loading your session…</div>;

  if (error === 'session' || (!snapshot && error)) {
    return (
      <div className="shell">
        <div className="stack">
          <Brand />
          <div className="notice notice-error">
            <strong>{error === 'session' ? 'SESSION NOT FOUND' : 'CONNECTION LOST'}</strong>
            <p style={{ margin: '6px 0 0' }}>
              {error === 'session'
                ? 'Scan your team QR code again to rejoin. Your team and progress are preserved.'
                : 'Trying to reconnect…'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;
  const payload = snapshot.payload;

  return (
    <div className="shell">
      <div className="stack">
        <Brand />
        <ConnectionBar connected={connected} error={error} />
        <Header payload={payload} countdownMs={countdown.remainingMs} countdown={countdown} />
        <GameBody
          payload={payload}
          countdown={countdown}
          refresh={refresh}
          onLocalEvent={refresh}
        />
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-name">Endgame</div>
      <div className="brand-sub">Round 1 — The Mainframe</div>
    </div>
  );
}

function ConnectionBar({ connected, error }: { connected: boolean; error: string | null }) {
  if (connected && !error) {
    return (
      <div className="conn-bar">
        <span className="dot dot-on" />
        Connected — progress is stored on the server
      </div>
    );
  }
  return (
    <div className="conn-bar conn-bar-down">
      <span className="dot dot-wait" />
      {error
        ? 'Connection lost — trying to reconnect… your progress is preserved'
        : 'Live updates reconnecting — your progress is safe and the game keeps running'}
    </div>
  );
}

function Header({ payload, countdownMs, countdown }: { payload: ParticipantPayload; countdownMs: number; countdown: { active: boolean; expired: boolean } }) {
  const expired = countdown.expired;
  const critical = countdownMs <= 60_000;
  const warn = countdownMs <= 180_000;
  return (
    <>
      <div className="panel" style={{ paddingBottom: 12 }}>
        <div className="row-between">
          <div>
            <div className="eyebrow">{payload.team.name}</div>
            <div className="title-md">
              {payload.participant.name} <span className="faint">· P{payload.participant.slot}</span>
            </div>
          </div>
          <span className={`badge ${payload.participant.isLeader ? 'badge-warn' : ''}`}>
            {payload.participant.isLeader ? 'Team leader' : 'Team member'}
          </span>
        </div>
      </div>

      {payload.round.state === 'ACTIVE' || payload.round.state === 'ENDED' ? (
        <div className={`timer ${critical ? 'timer-crit' : warn ? 'timer-warn' : ''}`}>
          <div>
            <div className="eyebrow">{expired ? "Time's up" : 'Time left'}</div>
            <div className="timer-value">{expired ? '00:00' : formatClock(countdownMs)}</div>
          </div>
          <div className="mono faint" style={{ fontSize: 11, textAlign: 'right' }}>
            server
            <br />
            controlled
          </div>
        </div>
      ) : null}
      {countdown.active ? null : payload.round.state === 'READY' ? (
        <div className="notice notice-warn">All players connected — waiting for the round to start.</div>
      ) : null}
    </>
  );
}

function GameBody({
  payload,
  countdown,
  refresh,
  onLocalEvent,
}: {
  payload: ParticipantPayload;
  countdown: { active: boolean; expired: boolean; remainingMs: number };
  refresh: () => void;
  onLocalEvent: () => void;
}) {
  // Four slots always exist; the team is armed only when all four are actually joined.
  const armed = payload.players.filter((player) => player.joined).length === 4;
  const [roleSeen, setRoleSeen] = useState(() => {
    try {
      return sessionStorage.getItem(`eg_role_${payload.team.id}_${payload.participant.slot}`) === '1';
    } catch {
      return false;
    }
  });

  function acknowledgeRole() {
    try {
      sessionStorage.setItem(`eg_role_${payload.team.id}_${payload.participant.slot}`, '1');
    } catch {
      /* storage unavailable: role screen simply shows again */
    }
    setRoleSeen(true);
  }

  if (payload.state === 'QUALIFIED' || payload.state === 'DISQUALIFIED') {
    return <EndScreen payload={payload} />;
  }

  if (armed && !roleSeen && payload.state !== 'COMPLETED') {
    return (
      <>
        <RoleCard payload={payload} onAcknowledge={acknowledgeRole} />
      </>
    );
  }

  if (payload.state === 'WAITING_FOR_PLAYERS') {
    return <WaitingRoom payload={payload} countdown={countdown} />;
  }

  if (payload.round.state === 'ENDED') {
    return <ExpiredScreen payload={payload} />;
  }

  if (payload.state === 'READY') {
    return <WaitingRoom payload={payload} countdown={countdown} />;
  }

  if (payload.state === 'COMPLETED') {
    return <CompletedScreen payload={payload} />;
  }

  if (payload.state === 'TEAM_PUZZLES') {
    if (payload.puzzle && !payload.puzzle.solved) {
      return <PuzzleScreen payload={payload} onSubmit={onLocalEvent} />;
    }
    return <SolvedScreen payload={payload} />;
  }

  if (payload.state === 'FINAL_SEQUENCE') {
    if (payload.puzzle && !payload.puzzle.solved) {
      return <PuzzleScreen payload={payload} onSubmit={onLocalEvent} />;
    }
    if (payload.participant.isLeader) {
      return <LeaderFinal payload={payload} refresh={refresh} />;
    }
    return <MemberWait payload={payload} />;
  }

  return <WaitingRoom payload={payload} countdown={countdown} />;
}

function RoleCard({ payload, onAcknowledge }: { payload: ParticipantPayload; onAcknowledge: () => void }) {
  const leader = payload.participant.isLeader;
  return (
    <div className="role-card">
      <div className="eyebrow">All players connected</div>
      <div className="role-title">{leader ? 'You are the team leader' : 'You are a team member'}</div>
      <p className="muted" style={{ marginTop: 12 }}>
        {leader
          ? 'Only you can submit the final four-token sequence for your team.'
          : 'Solve your puzzle, share your token with the team, and support your leader.'}
      </p>
      <button className={`btn btn-block ${leader ? 'btn-amber' : ''}`} onClick={onAcknowledge}>
        Continue
      </button>
    </div>
  );
}

function WaitingRoom({
  payload,
  countdown,
}: {
  payload: ParticipantPayload;
  countdown: { active: boolean; remainingMs: number };
}) {
  const joined = payload.players.filter((p) => p.joined).length;
  const missing = 4 - joined;
  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Waiting room</span>
          <span className={`badge ${joined === 4 ? 'badge-ok' : 'badge-warn'}`}>
            {joined} / 4 connected
          </span>
        </div>
        <div className="roster">
          {payload.players.map((player) => (
            <div className="roster-row" key={player.slot}>
              <span className="roster-slot">P{player.slot}</span>
              <span className={`roster-name ${player.joined ? '' : 'roster-empty'}`}>
                {player.joined ? player.name : 'Waiting for player…'}
              </span>
              <span className={`badge ${player.joined ? 'badge-ok' : 'badge-quiet'}`}>
                <span className={`dot ${player.joined ? 'dot-on' : 'dot-wait'}`} />
                {player.joined ? 'Connected' : 'Waiting'}
              </span>
            </div>
          ))}
        </div>
        <div className="progress-track" style={{ marginTop: 12 }}>
          <div className="progress-fill" style={{ width: `${(joined / 4) * 100}%` }} />
        </div>
        <p className="count-line" style={{ marginTop: 12 }}>
          {joined === 4
            ? 'All players connected. Prepare yourselves…'
            : `Waiting for ${missing} more player${missing === 1 ? '' : 's'}…`}
        </p>
        {joined === 4 && payload.round.state !== 'ACTIVE' ? (
          <div className="notice notice-ok" style={{ marginTop: 12 }}>
            <strong>TEAM READY — ALL 4 PLAYERS CONNECTED</strong>
            <p className="hint" style={{ margin: '8px 0 0' }}>
              Round 1 starts automatically: a few seconds after your team (or any team) fills up, the timer
              begins for everyone. Keep this screen open — puzzles appear here the moment it starts.
            </p>
          </div>
        ) : null}
        <p className="hint">
          The round starts from the server. There is no start button — stay on this screen.
        </p>
      </div>

      {countdown.active ? (
        <div className="notice notice-warn">
          The round is already running. Connect your remaining teammates as fast as possible.
        </div>
      ) : null}
    </>
  );
}

function PuzzleScreen({ payload, onSubmit }: { payload: ParticipantPayload; onSubmit: () => void }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = answer.trim();
    if (!value) {
      setMessage({ kind: 'error', text: 'Enter an answer.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    api
      .post<{ correct: boolean; token?: string }>('/api/puzzle/submit', { answer: value })
      .then((res) => {
        if (res.correct) {
          setAnswer('');
          onSubmit();
        } else {
          setMessage({ kind: 'error', text: 'Incorrect answer. Try again.' });
          setBusy(false);
        }
      })
      .catch((err: ApiError) => {
        setBusy(false);
        if (err.status === 410) setMessage({ kind: 'error', text: "TIME'S UP. Round 1 has ended." });
        else if (err.status === 0) setMessage({ kind: 'error', text: 'CONNECTION LOST. Trying to reconnect…' });
        else if (err.status === 409) setMessage({ kind: 'error', text: err.message });
        else if (err.status === 429) setMessage({ kind: 'error', text: 'Slow down a little, then try again.' });
        else setMessage({ kind: 'error', text: 'Unable to submit. Please try again.' });
      });
  }

  if (!payload.puzzle) {
    return (
      <div className="panel">
        <div className="notice">Your puzzle is being assigned by the server. This screen will update.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="eyebrow">Your puzzle</span>
        <span className="badge badge-quiet">{payload.puzzle.difficulty}</span>
      </div>
      <div className="puzzle-q">{payload.puzzle.question}</div>
      <form onSubmit={submit} className="stack" style={{ maxWidth: 'none', marginTop: 14, gap: 10 }}>
        <div className="field">
          <label className="label" htmlFor="answer">
            Your answer
          </label>
          <input
            id="answer"
            className="input"
            value={answer}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            placeholder="Type your answer"
            onChange={(e) => setAnswer(e.target.value)}
            disabled={busy}
          />
        </div>
        {message && (
          <div className={`notice ${message.kind === 'ok' ? 'notice-ok' : 'notice-error'}`}>{message.text}</div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit answer'}
        </button>
      </form>
      <p className="hint" style={{ marginTop: 10 }}>
        Only your own puzzle is shown. Talk to your team — someone else holds the other three pieces.
      </p>
    </div>
  );
}

function SolvedScreen({ payload }: { payload: ParticipantPayload }) {
  const token = payload.puzzle?.token ?? '—';
  return (
    <>
      <div className="token-card">
        <div className="eyebrow">Puzzle solved</div>
        <div className="title-md" style={{ marginTop: 6 }}>
          Your team token is
        </div>
        <div className="token-value">{token}</div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Communicate this token to your team. Do not submit anything else.
        </p>
      </div>
      <TeamProgress payload={payload} />
    </>
  );
}

function TeamProgress({ payload }: { payload: ParticipantPayload }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="eyebrow">Team progress</span>
        <span className="badge badge-quiet">
          {payload.progress.solvedCount} / 4 solved
        </span>
      </div>
      <div className="roster">
        {payload.players.map((player) => (
          <div className="roster-row" key={player.slot}>
            <span className="roster-slot">P{player.slot}</span>
            <span className={`roster-name ${player.joined ? '' : 'roster-empty'}`}>
              {player.joined ? player.name : 'Not joined'}
              {player.isLeader ? <span className="faint"> · leader</span> : null}
            </span>
            <span className={`badge ${player.solved ? 'badge-ok' : 'badge-quiet'}`}>
              {player.solved ? 'Solved' : 'Open'}
            </span>
          </div>
        ))}
      </div>
      <div className="progress-track" style={{ marginTop: 12 }}>
        <div className="progress-fill" style={{ width: `${(payload.progress.solvedCount / 4) * 100}%` }} />
      </div>
      {payload.progress.allSolved ? (
        <div className="notice notice-ok" style={{ marginTop: 12 }}>
          <strong>TEAM TOKENS READY</strong>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            {(payload.progress.teamTokens ?? []).map((t) => (
              <span className="badge" key={t} style={{ fontSize: 14 }}>
                {t}
              </span>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            Agree on the correct order. Only the leader can submit.
          </p>
        </div>
      ) : (
        <p className="hint" style={{ marginTop: 10 }}>
          Keep solving — the final sequence unlocks when all four puzzles are correct.
        </p>
      )}
    </div>
  );
}

function MemberWait({ payload }: { payload: ParticipantPayload }) {
  return (
    <>
      <TeamProgress payload={payload} />
      <div className="panel center">
        <div className="eyebrow">Final answer</div>
        <div className="title-md" style={{ marginTop: 6 }}>
          Waiting for team leader
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Only the server-selected leader can submit the sequence. Discuss the order with your team now.
        </p>
      </div>
    </>
  );
}

function LeaderFinal({ payload, refresh }: { payload: ParticipantPayload; refresh: () => void }) {
  const tokens = useMemo(() => payload.progress.teamTokens ?? [], [payload.progress.teamTokens]);
  const [order, setOrder] = useState<string[]>(tokens);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FinalFeedback | null>(null);
  const [history, setHistory] = useState<SubmissionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string>('');

  useEffect(() => {
    if (tokens.length === 4 && order.length !== 4) setOrder(tokens);
  }, [tokens, order.length]);

  useEffect(() => {
    const key = `${payload.team.id}:${payload.progress.solvedCount}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    api
      .get<{ submissions: SubmissionView[] }>('/api/team/submissions')
      .then((res) => setHistory(res.submissions))
      .catch(() => undefined);
  }, [payload.team.id, payload.progress.solvedCount]);

  if (order.length !== 4) {
    return (
      <div className="panel">
        <div className="notice">Waiting for your team’s four tokens…</div>
      </div>
    );
  }

  function move(index: number, delta: number) {
    setOrder((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    api
      .post<FinalFeedback>('/api/team/final-submit', { sequence: order })
      .then((res) => {
        setFeedback(res);
        setHistory((h) => [
          ...h,
          {
            submissionNumber: res.submissionNumber,
            correct: res.correct,
            incorrect: res.incorrect,
            completed: res.completed,
            createdAt: Date.now(),
            elapsedMs: 0,
          },
        ]);
        setBusy(false);
        refresh();
      })
      .catch((err: ApiError) => {
        setBusy(false);
        if (err.status === 410) setError("TIME'S UP. Round 1 has ended.");
        else if (err.status === 403) setError(err.message);
        else if (err.status === 0) setError('CONNECTION LOST. Trying to reconnect…');
        else if (err.status === 429) setError('Slow down a little, then try again.');
        else setError('Unable to submit. Please try again.');
      });
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow">Final team answer</span>
          <span className="badge badge-warn">Leader only</span>
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          Arrange the four tokens in the order you believe is correct, then submit.
        </p>
        <div className="seq-list">
          {order.map((token, index) => (
            <div className="seq-item" key={token}>
              <span className="seq-index">{index + 1}</span>
              <span className="seq-token">{token}</span>
              <button
                type="button"
                className="seq-move"
                aria-label={`Move ${token} up`}
                onClick={() => move(index, -1)}
                disabled={index === 0 || busy}
              >
                ↑
              </button>
              <button
                type="button"
                className="seq-move"
                aria-label={`Move ${token} down`}
                onClick={() => move(index, 1)}
                disabled={index === order.length - 1 || busy}
              >
                ↓
              </button>
            </div>
          ))}
        </div>
        {error && <div className="notice notice-error" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit final answer'}
        </button>
        <p className="hint" style={{ marginTop: 10 }}>
          The timer keeps running through retries. You can adjust and submit again.
        </p>
      </div>

      {feedback && !feedback.completed ? (
        <div className="feedback">
          <div className="feedback-line feedback-good">{feedback.correct} positions are correct</div>
          <div className="feedback-line feedback-bad" style={{ marginTop: 4 }}>
            {feedback.incorrect} positions are incorrect
          </div>
          <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            The system will not reveal which positions matched. Discuss and try again.
          </p>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Submission log</span>
            <span className="badge badge-quiet">{history.length} attempts</span>
          </div>
          <div className="attempt-log">
            {history.map((entry) => (
              <div className="attempt-row" key={`${entry.submissionNumber}-${entry.createdAt}`}>
                <span>#{entry.submissionNumber}</span>
                <span>
                  {entry.correct} correct · {entry.incorrect} incorrect
                </span>
                <span>{entry.completed ? 'CORRECT' : 'RETRY'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ExpiredScreen({ payload }: { payload: ParticipantPayload }) {
  return (
    <div className="panel center">
      <div className="eyebrow" style={{ color: 'var(--accent)' }}>
        Round 1 has ended
      </div>
      <div className="role-title" style={{ color: 'var(--accent)' }}>
        Time&apos;s up
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Final answers are locked. Standings are being calculated from server records.
      </p>
      <Link className="btn btn-block" to="/results">
        View results
      </Link>
      {payload.progress.solvedCount < 4 ? (
        <p className="hint" style={{ marginTop: 10 }}>
          Your team solved {payload.progress.solvedCount} of 4 puzzles.
        </p>
      ) : null}
    </div>
  );
}

function CompletedScreen({ payload }: { payload: ParticipantPayload }) {
  return (
    <>
      <div className="token-card" style={{ borderColor: 'var(--amber)', background: 'rgba(209,139,44,0.1)' }}>
        <div className="eyebrow">Final sequence correct</div>
        <div className="role-title" style={{ color: 'var(--amber)' }}>
          Mainframe unlocked
        </div>
        <div className="title-md" style={{ marginTop: 10 }}>
          Team qualified
        </div>
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
          Completion time: {formatDuration(payload.result?.completionTimeMs ?? null)}
        </p>
      </div>
      <div className="panel center">
        <p className="hint">Standings for all eight teams are published when Round 1 ends.</p>
        <Link className="btn btn-block" to="/results">
          View results
        </Link>
      </div>
    </>
  );
}

function EndScreen({ payload }: { payload: ParticipantPayload }) {
  const qualified = payload.state === 'QUALIFIED';
  return (
    <>
      <div className={`token-card`} style={{ borderColor: qualified ? 'var(--green)' : 'var(--accent)' }}>
        <div className="eyebrow">Round 1 result</div>
        <div className="role-title" style={{ color: qualified ? '#a9cda5' : '#f0b7ac' }}>
          {qualified ? 'Qualified' : 'Eliminated'}
        </div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          {qualified
            ? 'Your team advances to the next round.'
            : 'Your team did not finish inside the top four.'}
        </p>
        {payload.result?.completionTimeMs != null ? (
          <p className="mono" style={{ marginTop: 8, marginBottom: 0 }}>
            Completion time: {formatDuration(payload.result.completionTimeMs)}
          </p>
        ) : null}
        {payload.result?.rank ? (
          <p className="mono" style={{ marginTop: 4, marginBottom: 0 }}>
            Rank: {payload.result.rank} of 8
          </p>
        ) : null}
      </div>
      <Link className="btn btn-block" to="/results">
        Full standings
      </Link>
    </>
  );
}
