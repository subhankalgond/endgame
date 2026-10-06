import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { db } from './db';
import { attachIo, emitPlayerDisconnected } from './realtime';
import { lookupSession } from './lib/session';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    // Realtime transport. Every connection is authenticated against a
    // server-side session cookie (SameSite=Lax, so cross-site handshakes carry
    // no credentials and are rejected below); the HTTP API itself keeps a
    // strict origin allow-list. Reflecting the origin here lets the socket work
    // on localhost, Vercel and Render without host-specific configuration.
    cors: {
      origin: (_origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
        cb(null, true),
      credentials: true,
    },
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: 8_000,
  });

  io.use(async (socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);

    const adminToken = cookies.eg_admin;
    if (adminToken) {
      const session = await lookupSession('admin', adminToken);
      if (session?.admin_id) {
        socket.data.role = 'admin';
        socket.data.adminId = session.admin_id;
        next();
        return;
      }
    }

    const participantToken = cookies.eg_session;
    if (participantToken) {
      const session = await lookupSession('participant', participantToken);
      if (session?.participant_id) {
        const participant = await db
          .prepare('SELECT id, team_id FROM participants WHERE id = ?')
          .get(session.participant_id) as { id: string; team_id: number } | undefined;
        if (participant) {
          socket.data.role = 'participant';
          socket.data.participantId = participant.id;
          socket.data.teamId = participant.team_id;
        }
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    socket.join('clients');
    if (socket.data.role === 'admin') {
      socket.join('admin');
    } else if (socket.data.role === 'participant') {
      socket.join(`team:${socket.data.teamId}`);
      socket.on('disconnect', () => emitPlayerDisconnected(socket.data.teamId));
    }

    // Clients may request an immediate refresh after a reconnect.
    socket.on('sync', () => {
      if (socket.data.role === 'admin') socket.emit('live_update', { at: Date.now(), requested: true });
      if (socket.data.role === 'participant') {
        socket.emit('team_updated', { teamId: socket.data.teamId, reason: 'sync', at: Date.now() });
      }
    });
  });

  attachIo(io);
  return io;
}
