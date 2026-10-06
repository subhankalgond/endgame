export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiError(0, 'CONNECTION LOST. Trying to reconnect...', 'network');
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const payload = body as { error?: string; code?: string } | null;
    const message =
      payload?.error ??
      (res.status === 401
        ? 'Session not found. Please rejoin with your team QR code.'
        : 'Unable to process the request.');
    throw new ApiError(res.status, message, payload?.code ?? 'error');
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '--:--';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatTime(ts: number | null): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
