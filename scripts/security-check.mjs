/* Security verification against a running server (default http://localhost:4000).
   Run with NODE_ENV=production so production limits and headers apply. */
const BASE = process.env.SMOKE_BASE || 'http://localhost:4000';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
}

async function raw(path, init = {}) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

// 1. rate limiting on team join (30/min per IP outside tests)
let sawJoinLimit = false;
for (let i = 0; i < 40 && !sawJoinLimit; i += 1) {
  const res = await fetch(`${BASE}/api/join/not-a-valid-token-1234567890`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Probe' }),
  });
  if (res.status === 429) sawJoinLimit = true;
}
check('team join endpoint rate limited', sawJoinLimit, '40 requests without a 429');

// 2. rate limiting on admin login (15 / 5 min)
let sawLoginLimit = false;
for (let i = 0; i < 20 && !sawLoginLimit; i += 1) {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: `guess-${i}` }),
  });
  if (res.status === 429) sawLoginLimit = true;
}
check('admin login rate limited', sawLoginLimit, '20 attempts without a 429');

// 3. security headers
const health = await raw('/api/health');
check('content-security-policy present', (health.headers.get('content-security-policy') || '').includes("default-src 'self'"));
check('x-content-type-options nosniff', health.headers.get('x-content-type-options') === 'nosniff');
check('referrer-policy set', Boolean(health.headers.get('referrer-policy')));
check('permissions-policy set', Boolean(health.headers.get('permissions-policy')));
check('x-frame-options/frame-ancestors', (health.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"));
check('no x-powered-by', !health.headers.has('x-powered-by'));

// 4. CORS: unknown origin is not allowed, configured origin is
const evil = await raw('/api/health', { headers: { Origin: 'https://evil.example' } });
check('unknown origin gets no CORS allowance', !evil.headers.has('access-control-allow-origin'), evil.headers.get('access-control-allow-origin') ?? 'none');
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:4000';
const good = await raw('/api/health', { headers: { Origin: allowedOrigin } });
check('configured origin allowed', good.headers.get('access-control-allow-origin') === allowedOrigin, good.headers.get('access-control-allow-origin') ?? 'none');

// 5. malformed and oversized input
const malformed = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{"username":',
});
check('malformed JSON rejected safely', malformed.status === 400, `status ${malformed.status}`);
const malformedText = await malformed.text();
check('malformed JSON leaks nothing', !/stack|SyntaxError|\/[a-z]+\/[a-z]+\.(ts|js)/i.test(malformedText), malformedText);

const huge = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'x'.repeat(200000), password: 'y' }),
});
check('oversized body rejected', huge.status === 400 || huge.status === 413, `status ${huge.status}`);
const hugeText = await huge.text();
check('oversized body leaks nothing', !/stack|at Object|\/var\/|C:\\\\/i.test(hugeText), hugeText.slice(0, 200));

// 6. unauthorized admin call returns a safe body
const unauth = await raw('/api/admin/teams');
check('admin API returns 401', unauth.status === 401, `status ${unauth.status}`);
check('admin 401 body is safe', !/scrypt|hash|password|stack/i.test(unauth.text), unauth.text);

// 7. sensitive files are not served
for (const path of ['/.env', '/.env.example', '/../.env', '/package.json', '/api/admin/qr']) {
  const res = await raw(path);
  const exposed = res.status === 200 && (res.text.includes('DATABASE_URL') || res.text.includes('password_hash'));
  check(`not exposed: ${path}`, !exposed, `status ${res.status}`);
}

// 8. internal server errors are sanitized
const notFound = await raw('/api/does-not-exist-at-all');
check('unknown API route returns safe 404', notFound.status === 404 && !/stack|Error:/.test(notFound.text), notFound.text);

const failures = results.filter((r) => !r.ok);
console.log(`\n${results.length - failures.length}/${results.length} security checks passed`);
if (failures.length > 0) {
  console.log('Failed:', failures.map((f) => f.name).join(' | '));
  process.exit(1);
}
