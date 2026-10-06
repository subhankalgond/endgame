import type { Server } from 'socket.io';

let io: Server | null = null;

export function attachIo(server: Server): void {
  io = server;
}

export function detachIo(): void {
  io = null;
}

export function emitToTeam(teamId: number, event: string, payload: unknown): void {
  io?.to(`team:${teamId}`).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown): void {
  io?.to('admin').emit(event, payload);
}

export function emitToAll(event: string, payload: unknown): void {
  io?.to('clients').emit(event, payload);
}

/** Push a fresh snapshot request to every connected admin dashboard. */
export function broadcastLive(): void {
  emitToAdmins('live_update', { at: Date.now() });
}

/** A participant's socket dropped (refresh, network change, tab closed). */
export function emitPlayerDisconnected(teamId: number): void {
  emitToTeam(teamId, 'player_disconnected', { teamId, at: Date.now() });
  broadcastLive();
}

export function broadcastTeam(teamId: number, reason: string): void {
  emitToTeam(teamId, 'team_updated', { teamId, reason, at: Date.now() });
  broadcastLive();
}
