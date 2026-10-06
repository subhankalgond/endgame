import { beforeAll, describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { adminAgent, boot, joinToken, type Ctx } from './helpers';
import type { renderQr as RenderQr } from '../src/qr';

let ctx: Ctx;
let renderQr: typeof RenderQr;
let publicBase: string;

beforeAll(async () => {
  // src modules are imported dynamically so the test environment is set up first
  ctx = await boot();
  const qrModule = await import('../src/qr.js');
  const configModule = await import('../src/config.js');
  renderQr = qrModule.renderQr;
  publicBase = configModule.config.publicBaseUrl.replace(/\/$/, '');
});

function decode(dataUrl: string): string {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const png = PNG.sync.read(Buffer.from(base64, 'base64'));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!result) throw new Error('QR image could not be decoded by a real scanner');
  return result.data;
}

describe('team QR codes', () => {
  it('decodes every team QR to its own unique join URL', async () => {
    const decoded = new Map<number, string>();

    for (let teamId = 1; teamId <= 8; teamId += 1) {
      const url = `${publicBase}/join/team/${await joinToken(ctx.db, teamId)}`;
      const png = await renderQr(url);
      expect(png.startsWith('data:image/png;base64,')).toBe(true);
      const text = decode(png);
      expect(text).toBe(url);
      decoded.set(teamId, text);
    }

    expect(decoded.size).toBe(8);
    expect(new Set(decoded.values()).size).toBe(8);
  });

  it('encodes only an opaque token - no team id, names or secrets', async () => {
    const url = `${publicBase}/join/team/${await joinToken(ctx.db, 1)}`;
    const text = decode(await renderQr(url));
    expect(text).toMatch(/\/join\/team\/[A-Za-z0-9_-]{30,}$/);
    expect(text).not.toMatch(/team[_-]?1/i);
    expect(text).not.toContain('correct_sequence');
    expect(text).not.toMatch(/admin/i);
  });

  it('serves decodable QR images through the admin API', async () => {
    const admin = await adminAgent(ctx);
    const res = await admin.get('/api/admin/qr');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(8);
    for (const item of res.body.items as { id: number; joinUrl: string; qr: string }[]) {
      expect(decode(item.qr)).toBe(item.joinUrl);
      expect(item.joinUrl.endsWith(await joinToken(ctx.db, item.id))).toBe(true);
    }
  });
});
