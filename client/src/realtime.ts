import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
const listeners = new Set<(event: string) => void>();
const statusListeners = new Set<(connected: boolean) => void>();
let connected = false;

const TRACKED = [
  'team_updated',
  'player_joined',
  'all_players_ready',
  'leader_selected',
  'round_started',
  'round_ended',
  'round_reset',
  'round_state',
  'puzzle_solved',
  'team_progress_updated',
  'final_submission',
  'final_feedback',
  'team_completed',
  'live_update',
  'results_updated',
];

export function isSocketConnected(): boolean {
  return connected;
}

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    withCredentials: true,
    // Start with HTTP long-polling so the connection works through the
    // Vercel -> Render proxy, then upgrade to WebSocket where available.
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });

  for (const event of TRACKED) {
    socket.on(event, () => {
      for (const listener of listeners) listener(event);
    });
  }

  socket.on('connect', () => {
    connected = true;
    socket?.emit('sync');
    for (const listener of statusListeners) listener(true);
  });
  socket.on('disconnect', () => {
    connected = false;
    for (const listener of statusListeners) listener(false);
  });

  return socket;
}

export function onServerEvent(listener: (event: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onConnectionChange(listener: (connected: boolean) => void): () => void {
  statusListeners.add(listener);
  listener(connected);
  return () => statusListeners.delete(listener);
}
