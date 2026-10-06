import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { onConnectionChange, onServerEvent } from '../realtime';
import type { ParticipantPayload } from '../types';

export interface Snapshot {
  payload: ParticipantPayload;
  fetchedAt: number;
}

export interface GameState {
  snapshot: Snapshot | null;
  error: string | null;
  loading: boolean;
  connected: boolean;
  refresh: () => void;
}

/** Server-backed participant state: refreshed on socket events, focus and a slow safety poll. */
export function useGame(): GameState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const alive = useRef(true);

  const refresh = useCallback(() => {
    api
      .get<ParticipantPayload>('/api/session')
      .then((payload) => {
        if (!alive.current) return;
        setSnapshot({ payload, fetchedAt: Date.now() });
        setError(null);
      })
      .catch((err: ApiError) => {
        if (!alive.current) return;
        if (err.status === 0) setError('CONNECTION LOST. Trying to reconnect...');
        else if (err.status === 401) setError('session');
        else setError(err.message);
      })
      .finally(() => alive.current && setLoading(false));
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const offEvent = onServerEvent(() => refresh());
    const offConn = onConnectionChange(setConnected);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const poll = window.setInterval(() => refresh(), 15_000);
    return () => {
      alive.current = false;
      offEvent();
      offConn();
      window.removeEventListener('focus', onFocus);
      window.clearInterval(poll);
    };
  }, [refresh]);

  return { snapshot, error, loading, connected, refresh };
}

/** Remaining round time derived from the server's remainingMs at fetch time. */
export function useCountdown(snapshot: Snapshot | null): { remainingMs: number; expired: boolean; active: boolean } {
  const [, force] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  if (!snapshot) return { remainingMs: 0, expired: false, active: false };
  const { round } = snapshot.payload;
  if (round.state !== 'ACTIVE' || round.endsAt == null) {
    return { remainingMs: 0, expired: round.state === 'ENDED', active: round.state === 'ACTIVE' };
  }
  const elapsed = Date.now() - snapshot.fetchedAt;
  const remainingMs = Math.max(0, round.remainingMs - elapsed);
  return { remainingMs, expired: remainingMs <= 0, active: true };
}
