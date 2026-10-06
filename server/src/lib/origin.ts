import type { Request } from 'express';

/**
 * The externally visible origin of the current request, honouring reverse
 * proxies (nginx, Render, the Vercel rewrites). Used as the fallback base for
 * team join URLs so QR codes encode the host the admin actually opened -
 * never a hardcoded localhost - and therefore scan correctly from any network.
 */
export function requestOrigin(req: Request): string {
  const host = (req.get('x-forwarded-host') ?? '').split(',')[0].trim() || req.get('host') || '';
  const proto = (req.get('x-forwarded-proto') ?? '').split(',')[0].trim() || req.protocol;
  return `${proto}://${host}`;
}
