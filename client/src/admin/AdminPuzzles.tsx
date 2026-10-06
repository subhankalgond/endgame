import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import type { PuzzleView } from '../types';

interface PuzzlesResponse {
  puzzles: PuzzleView[];
}

export default function AdminPuzzles() {
  const [puzzles, setPuzzles] = useState<PuzzleView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [filter, setFilter] = useState<number>(0);

  const load = useCallback(() => {
    api
      .get<PuzzlesResponse>('/api/admin/puzzles')
      .then((res) => {
        setPuzzles(res.puzzles);
        setError(null);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  function update(id: number, patch: Partial<PuzzleView>) {
    setPuzzles((current) => current.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function save(puzzle: PuzzleView) {
    setSaved(null);
    setError(null);
    api
      .put(`/api/admin/puzzles/${puzzle.id}`, {
        question: puzzle.question,
        answer: puzzle.answer,
        altAnswers: puzzle.altAnswers,
        rewardToken: puzzle.rewardToken,
        difficulty: puzzle.difficulty,
        explanation: puzzle.explanation,
      })
      .then(() => setSaved(puzzle.id))
      .catch((err: ApiError) => setError(err.message));
  }

  const visible = filter === 0 ? puzzles : puzzles.filter((p) => p.teamId === filter);

  return (
    <div className="stack stack-wide">
      <div className="row-between">
        <h1 className="title-lg">Puzzles</h1>
        <div className="row" style={{ gap: 8 }}>
          <label className="label" htmlFor="team-filter">Team</label>
          <select
            id="team-filter"
            className="select"
            style={{ width: 140 }}
            value={filter}
            onChange={(e) => setFilter(Number(e.target.value))}
          >
            <option value={0}>All teams</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((id) => (
              <option key={id} value={id}>
                Team {id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="grid-2">
        {visible.map((puzzle) => (
          <div className="team-card" key={puzzle.id}>
            <div className="row-between">
              <h3>
                {puzzle.teamName} · Player {puzzle.slot}
              </h3>
              <span className="badge badge-quiet">{puzzle.difficulty}</span>
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label className="label" htmlFor={`q-${puzzle.id}`}>Question</label>
              <textarea
                id={`q-${puzzle.id}`}
                className="textarea"
                value={puzzle.question}
                maxLength={500}
                onChange={(e) => update(puzzle.id, { question: e.target.value })}
              />
            </div>

            <div className="field" style={{ marginTop: 8 }}>
              <label className="label" htmlFor={`a-${puzzle.id}`}>Accepted answer</label>
              <input
                id={`a-${puzzle.id}`}
                className="input"
                value={puzzle.answer}
                maxLength={200}
                onChange={(e) => update(puzzle.id, { answer: e.target.value })}
              />
            </div>

            <div className="field" style={{ marginTop: 8 }}>
              <label className="label" htmlFor={`alt-${puzzle.id}`}>Alternative answers (comma separated)</label>
              <input
                id={`alt-${puzzle.id}`}
                className="input"
                value={puzzle.altAnswers.join(', ')}
                maxLength={400}
                onChange={(e) =>
                  update(puzzle.id, {
                    altAnswers: e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>

            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <div className="field grow">
                <label className="label" htmlFor={`t-${puzzle.id}`}>Reward token</label>
                <input
                  id={`t-${puzzle.id}`}
                  className="input mono"
                  value={puzzle.rewardToken}
                  maxLength={16}
                  onChange={(e) => update(puzzle.id, { rewardToken: e.target.value })}
                />
              </div>
              <div className="field grow">
                <label className="label" htmlFor={`d-${puzzle.id}`}>Difficulty</label>
                <select
                  id={`d-${puzzle.id}`}
                  className="select"
                  value={puzzle.difficulty}
                  onChange={(e) => update(puzzle.id, { difficulty: e.target.value })}
                >
                  <option value="easy">easy</option>
                  <option value="medium-easy">medium-easy</option>
                  <option value="medium">medium</option>
                </select>
              </div>
            </div>

            <div className="field" style={{ marginTop: 8 }}>
              <label className="label" htmlFor={`e-${puzzle.id}`}>Explanation (admin only, never shown to players)</label>
              <input
                id={`e-${puzzle.id}`}
                className="input"
                value={puzzle.explanation}
                maxLength={500}
                onChange={(e) => update(puzzle.id, { explanation: e.target.value })}
              />
            </div>

            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm" type="button" onClick={() => save(puzzle)}>
                Save puzzle
              </button>
              {saved === puzzle.id && <span className="badge badge-ok">Saved</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="footer-note">Answers are validated server-side with trim and case-insensitive comparison.</p>
    </div>
  );
}
