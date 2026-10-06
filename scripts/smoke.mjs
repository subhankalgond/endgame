/* End-to-end smoke test against a running built server (default http://localhost:4000).
   Exercises the real HTTP surface: SPA, admin auth, QR join, gameplay, ranking. */
const BASE = process.env.SMOKE_BASE || 'http://localhost:4000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Smoke-Admin-2026';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : '  -> ' + detail}`);
}

function jar() {
  const store = new Map();
  // Simulate distinct client IPs (in the real event every player is a different phone).
  const ip = `10.${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  return {
    ip,
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    absorb(res) {
      const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const line of raw) {
        const [pair] = line.split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) store.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    },
  };
}

async function call(jarObj, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jarObj ? { cookie: jarObj.header(), 'x-forwarded-for': jarObj.ip } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jarObj?.absorb(res);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const admin = jar();

// 1. static + health
const health = await call(null, '/api/health');
check('health endpoint', health.status === 200 && health.json?.ok === true, `status ${health.status}`);
check('server time is real', Math.abs(health.json.serverTime - Date.now()) < 60_000);

const index = await call(null, '/');
check('SPA index served', index.status === 200 && index.text.includes('id="root"'), `status ${index.status}`);
check(
  'hashed assets referenced',
  /assets\/index-.*\.js/.test(index.text),
  'no script tag found',
);
const favicon = await call(null, '/favicon.svg');
check('favicon served', favicon.status === 200 && favicon.text.includes('<svg'));
const manifest = await call(null, '/manifest.webmanifest');
check('manifest served', manifest.status === 200 && manifest.text.includes('ENDGAME'));
const asset = index.text.match(/assets\/index-[^"]+\.js/);
const assetRes = asset ? await call(null, `/${asset[0]}`) : { status: 0 };
check('JS bundle served', assetRes.status === 200, `status ${assetRes.status}`);
const css = index.text.match(/assets\/index-[^"]+\.css/);
const cssRes = css ? await call(null, `/${css[0]}`) : { status: 0 };
check('CSS bundle served', cssRes.status === 200, `status ${cssRes.status}`);

// 2. security headers
check('CSP header', (health.headers.get('content-security-policy') || '').includes("default-src 'self'"));
check('nosniff header', health.headers.get('x-content-type-options') === 'nosniff');
check('no x-powered-by', !health.headers.has('x-powered-by'));

// 3. admin auth
const badLogin = await call(null, '/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'nope' } });
check('bad admin credentials rejected', badLogin.status === 401, `status ${badLogin.status}`);
const unauth = await call(null, '/api/admin/teams');
check('admin API without session rejected', unauth.status === 401, `status ${unauth.status}`);

const login = await call(admin, '/api/admin/login', {
  method: 'POST',
  body: { username: 'admin', password: ADMIN_PASSWORD },
});
check('admin login', login.status === 200, `status ${login.status}`);
const adminCookie = (admin.header() || '').includes('eg_admin');
check('admin session cookie set', adminCookie, admin.header());

// 4. QR codes
const qr = await call(admin, '/api/admin/qr');
const items = qr.json?.items ?? [];
check('8 QR codes returned', items.length === 8, `got ${items.length}`);
check('QR codes are real PNG data URLs', items.every((i) => i.qr.startsWith('data:image/png;base64,')));
check('QR join URLs unique', new Set(items.map((i) => i.joinUrl)).size === 8);
check('join URL path is /join/team/<token>', items.every((i) => /\/join\/team\/[A-Za-z0-9_-]{30,}$/.test(i.joinUrl)));

const team1Url = items[0].joinUrl;
const token1 = team1Url.split('/join/team/')[1];
const lookup = await call(null, `/api/join/${token1}`);
check('QR token resolves to Team 1', lookup.status === 200 && lookup.json.team.name === 'Team 1', lookup.text);
const stale = await call(null, '/api/join/definitely-not-a-valid-token-12345678');
check('invalid token rejected', stale.status === 404, `status ${stale.status}`);
const wrongTeam = await call(null, `/api/join/${items[7].joinUrl.split('/join/team/')[1]}`);
check('team 8 token resolves to Team 8', wrongTeam.json.team.name === 'Team 8', wrongTeam.text);

// 5. join flow: 4 players on team 1
const players = [jar(), jar(), jar(), jar()];
const joins = [];
for (let i = 0; i < 4; i += 1) {
  const res = await call(players[i], `/api/join/${token1}`, { method: 'POST', body: { name: `Smoke P${i + 1}` } });
  joins.push(res);
}
check('all 4 players joined', joins.every((r) => r.status === 201 || r.status === 200), joins.map((r) => r.status).join(','));
check('players assigned slots 1-4', joins.every((r, i) => r.json.participant.slot === i + 1));
const fourth = joins[3].json;
check('4th join arms the team', fourth.players.filter((p) => p.joined).length === 4);
const leaders = fourth.players.filter((p) => p.isLeader);
check('exactly one leader after 4th join', leaders.length === 1, `got ${leaders.length}`);
const leaderIdx = leaders[0].slot - 1;
const freshSessions = [];
for (let i = 0; i < 4; i += 1) freshSessions.push((await call(players[i], '/api/session')).json);
check(
  'only one participant is flagged leader',
  freshSessions.filter((s) => s.participant.isLeader).length === 1 &&
    freshSessions[leaderIdx].participant.isLeader === true,
  freshSessions.map((s) => s.participant.isLeader).join(','),
);

// duplicate session guard
const again = await call(players[0], `/api/join/${token1}`, { method: 'POST', body: { name: 'Smoke P1' } });
const countRes = await call(admin, '/api/admin/live-status');
check('rejoin does not duplicate player', again.json.players.filter((p) => p.joined).length === 4);

// 6. round start (server timer)
const prepare = await call(admin, '/api/admin/round/prepare', { method: 'POST', body: {} });
check('prepare round', prepare.status === 200, `status ${prepare.status}`);
const startedAtBefore = prepare.json.round.startedAt;
const start = await call(admin, '/api/admin/round/start', {
  method: 'POST',
  body: { startedAt: 1, endsAt: 2, remainingTime: 999 },
});
check('start round', start.status === 200, `status ${start.status}`);
check(
  'client timing fields ignored',
  start.json.round.startedAt !== 1 && start.json.round.endsAt === start.json.round.startedAt + 600_000,
  JSON.stringify(start.json.round),
);
void startedAtBefore;

const roundStatus = await call(players[0], '/api/round/status');
check('participant sees server timer', roundStatus.json.endsAt > Date.now() && roundStatus.json.remainingMs > 500_000);

// 7. puzzles
const session0 = await call(players[0], '/api/session');
const puzzle0 = session0.json.puzzle;
check('participant gets own puzzle only', Boolean(puzzle0?.question) && puzzle0.slot === 1, JSON.stringify(puzzle0));

const wrong = await call(players[0], '/api/puzzle/submit', { method: 'POST', body: { answer: 'not-the-answer' } });
check('wrong answer rejected without token', wrong.json.correct === false && !wrong.json.token, wrong.text);

const answers = ['10', 'echo', 'yes', 'short']; // team 1 default puzzle answers
const solved = [];
for (let i = 0; i < 4; i += 1) {
  const res = await call(players[i], '/api/puzzle/submit', { method: 'POST', body: { answer: answers[i] } });
  solved.push(res);
}
check('all four puzzles solve', solved.every((r) => r.json?.correct === true), solved.map((r) => r.text).join(' | '));
check('reward tokens match spec', JSON.stringify(solved.map((r) => r.json.token)) === JSON.stringify(['7k4', '0a', '8x', '72']));

const sessionLeader = await call(players[leaderIdx], '/api/session');
check('team tokens shared after 4/4 solve', JSON.stringify(sessionLeader.json.progress.teamTokens) === JSON.stringify(['7k4', '0a', '8x', '72']));

const nonLeaderIdx = (leaderIdx + 1) % 4;
const seq = sessionLeader.json.progress.teamTokens;
const teamsRes = await call(admin, '/api/admin/teams');
const correctSeq = teamsRes.json.teams.find((t) => t.id === 1).correctSequence;
check(
  'correct sequence is server configured, not slot order',
  JSON.stringify(correctSeq) !== JSON.stringify(seq),
  JSON.stringify(correctSeq),
);
const forbidden = await call(players[nonLeaderIdx], '/api/team/final-submit', {
  method: 'POST',
  body: { sequence: seq },
});
check('non-leader final submit rejected (403)', forbidden.status === 403, `status ${forbidden.status}`);

const swapped = [correctSeq[1], correctSeq[0], correctSeq[2], correctSeq[3]];
const partial = await call(players[leaderIdx], '/api/team/final-submit', {
  method: 'POST',
  body: { sequence: swapped, endsAt: Date.now() + 999999 },
});
const correctCount = swapped.reduce((acc, t, i) => acc + (t === correctSeq[i] ? 1 : 0), 0);
check(
  'leader feedback is count-only',
  partial.status === 200 &&
    partial.json.correct === correctCount &&
    partial.json.incorrect === 4 - correctCount &&
    !/position\s*[1-4]/i.test(partial.text) &&
    !partial.text.includes('correct_sequence'),
  partial.text,
);

const final = await call(players[leaderIdx], '/api/team/final-submit', { method: 'POST', body: { sequence: correctSeq } });
check('correct sequence completes the team', final.json.completed === true, final.text);

// 7b. full field: teams 2-4 also finish, teams 5-8 join only -> 32 participants
const puzzlesRes = await call(admin, '/api/admin/puzzles');
const allPuzzles = puzzlesRes.json.puzzles;
const answersFor = (teamId) =>
  [1, 2, 3, 4].map((slot) => allPuzzles.find((p) => p.teamId === teamId && p.slot === slot).answer);

const teamJars = { 1: players };
for (const teamId of [2, 3, 4, 5, 6, 7, 8]) {
  const token = items[teamId - 1].joinUrl.split('/join/team/')[1];
  const jars = [jar(), jar(), jar(), jar()];
  teamJars[teamId] = jars;
  for (let i = 0; i < 4; i += 1) {
    const r = await call(jars[i], `/api/join/${token}`, { method: 'POST', body: { name: `S${teamId} P${i + 1}` } });
    if (r.status !== 200 && r.status !== 201) check(`team ${teamId} player ${i + 1} joins`, false, `${r.status} ${r.text}`);
  }
}
const live = await call(admin, '/api/admin/live-status');
check('32 participants joined across 8 teams', live.json.participants === 32, `got ${live.json.participants}`);
check('all 8 teams ready', live.json.readyTeams === 8, `got ${live.json.readyTeams}`);

for (const teamId of [2, 3, 4]) {
  const jars = teamJars[teamId];
  const answers = answersFor(teamId);
  for (let i = 0; i < 4; i += 1) {
    const r = await call(jars[i], '/api/puzzle/submit', { method: 'POST', body: { answer: answers[i] } });
    if (!r.json?.correct) check(`team ${teamId} slot ${i + 1} solves`, false, r.text);
  }
  let leaderJar = null;
  for (let i = 0; i < 4; i += 1) {
    const s = (await call(jars[i], '/api/session')).json;
    if (s.participant.isLeader) leaderJar = jars[i];
  }
  if (!leaderJar) check(`team ${teamId} has a leader`, false, 'no leader');
  const teamCfg = teamsRes.json.teams.find((t) => t.id === teamId);
  const r = await call(leaderJar, '/api/team/final-submit', {
    method: 'POST',
    body: { sequence: teamCfg.correctSequence },
  });
  check(`team ${teamId} completes the round`, r.json?.completed === true, r.text);
  await new Promise((resolve) => setTimeout(resolve, 5));
}

const adminResults = await call(admin, '/api/admin/results');
const team1Row = adminResults.json.results.find((r) => r.teamId === 1);
check('team 1 ranked 1 and qualified', team1Row.rank === 1 && team1Row.status === 'QUALIFIED', JSON.stringify(team1Row));
check('completion time recorded', typeof team1Row.completionTimeMs === 'number' && team1Row.completionTimeMs >= 0);

// 8. end round + standings visibility
const ended = await call(admin, '/api/admin/round/end', { method: 'POST', body: {} });
check('end round', ended.status === 200 && ended.json.round.state === 'ENDED');
const participantResults = await call(players[0], '/api/results');
check('participants can read standings', participantResults.status === 200 && participantResults.json.results.length === 8);
const standings = participantResults.json.results;
const qualified = standings.filter((r) => r.status === 'QUALIFIED');
check('top 4 qualify, bottom 4 eliminated', qualified.length === 4 && standings.slice(0, 4).every((r) => r.status === 'QUALIFIED') && standings.slice(4).every((r) => r.status === 'DISQUALIFIED'), JSON.stringify(standings.map((r) => [r.rank, r.teamName, r.status])));
check('ranks are unique 1..8', JSON.stringify(standings.map((r) => r.rank)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]));
check(
  'qualified teams ranked by completion time',
  qualified.every((r, i) => i === 0 || r.completionTimeMs >= qualified[i - 1].completionTimeMs),
);
check('unqualified teams recorded as incomplete', standings.slice(4).every((r) => !r.completed), JSON.stringify(standings.slice(4)));

// 9. submissions after expiry are locked
const late = await call(players[leaderIdx], '/api/team/final-submit', { method: 'POST', body: { sequence: correctSeq } });
check('post-end final submit rejected', late.status >= 400, `status ${late.status}`);

// 10. audit trail
const logs = await call(admin, '/api/admin/logs');
const events = new Set((logs.json?.logs ?? []).map((l) => l.event));
check(
  'audit log records key events',
  ['participant_joined', 'leader_selected', 'puzzle_solved', 'final_sequence_submitted', 'round_started', 'round_ended'].every((e) =>
    events.has(e),
  ),
  [...events].join(','));

const failures = results.filter((r) => !r.ok);
console.log(`\n${results.length - failures.length}/${results.length} smoke checks passed`);
if (failures.length > 0) {
  console.log('Failed:', failures.map((f) => f.name).join(' | '));
  process.exit(1);
}
