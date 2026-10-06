# ENDGAME — Round 1: THE MAINFRAME

**Trust. Communicate. Solve. Survive.**

A working full-stack competition system for 32 participants (8 teams × 4 players) playing a
10-minute, server-timed puzzle round on their phones during a college fest.

This is the live game system: QR check-in, waiting rooms, automatic leader selection, private
puzzles, server-validated answers, token reveals, leader-only final submission, position-count
feedback, retries, a server-controlled 10-minute timer, live admin monitoring, ranking and
qualification. Nothing is faked: every number on screen comes from the database.

---

## Stack

| Layer      | Technology                                                          |
| ---------- | ------------------------------------------------------------------- |
| Frontend   | React 18 + TypeScript + Vite, Socket.IO client, react-router         |
| Backend    | Node 24+, Express 4, TypeScript, Zod validation, Socket.IO           |
| Database   | Supabase Postgres (node-pg) — embedded PGlite for local development   |
| QR codes   | `qrcode` (PNG data URLs) — decoded in tests with `jsqr`              |
| Auth       | HttpOnly session cookies, scrypt-hashed admin passwords              |
| Tests      | Vitest + Supertest (39 integration/security tests) + smoke scripts   |

---

## Repository layout

```
client/               React SPA (participant + admin)
  src/pages/          join, gameplay, results, terms
  src/admin/          dashboard, round control, live, teams, puzzles, QR, results, logs
  public/             favicon, icons, manifest
server/               Express API + Socket.IO + Postgres
  src/routes/         participant + admin routes
  src/game.ts         rounds, leader selection, answers, final sequence, ranking
  src/seed.ts         8 teams, the exact Round 1 tokens, 32 default puzzles
  test/               integration, security and QR-decoding tests
scripts/              make-icons.mjs, smoke.mjs, security-check.mjs, secret scan via npm run
.env.example          environment template
```

---

## Quick start (development)

```bash
npm install
cp .env.example server/.env        # edit values
npm run dev                        # API on :4000, Vite dev server on :5173
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` and `/socket.io` to `:4000`, so
cookies and WebSockets behave exactly as in production.

## Production build and run

```bash
npm install
npm run build                       # server/dist + client/dist
NODE_ENV=production \
PORT=4000 \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD \
DATABASE_URL="$SUPABASE_POOLER_URL" \
DIRECT_URL="$SUPABASE_DIRECT_URL" \
PUBLIC_BASE_URL=https://your-domain.example \
FRONTEND_URL=https://your-domain.example \
npm start
```

The server serves the built SPA itself, so one origin (no CORS) is enough in production.

### Environment variables

| Variable            | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`          | `production` enables secure cookies, strict startup checks          |
| `PORT`              | API + static port (default `4000`)                                  |
| `DATABASE_URL`      | Supabase pooler URL (port 6543); `./data/pg` for local development   |
| `DIRECT_URL`        | Optional Supabase session-mode URL (port 5432) used for migrations    |
| `PUBLIC_BASE_URL`   | URL participants open after scanning (used to build join links)     |
| `FRONTEND_URL`      | Allowed browser origin for CORS + Socket.IO                         |
| `BACKEND_URL`       | Backend URL (informational)                                         |
| `ADMIN_USERNAME`    | Administrator username (default `admin`)                            |
| `ADMIN_PASSWORD`    | Administrator password — **required in production**                 |
| `ROUND_DURATION_SEC`| Round length, default `600` (10 minutes)                            |
| `SESSION_TTL_HOURS` | Participant/admin session lifetime, default `12`                    |
| `TRUST_PROXY`       | `1` only behind nginx/caddy so rate limits see real client IPs      |

If `ADMIN_PASSWORD` is empty in development, a one-time password is printed to the console.
`.env` is git-ignored; `.env.example` contains placeholders only.

---

## Database

Schema is created automatically on first boot with idempotent migrations run against
`DATABASE_URL` (using `DIRECT_URL` when set — Supabase recommends session mode for DDL). Tables:

`admins`, `sessions`, `teams` (join token, correct sequence, roster), `team_join_tokens`,
`team_tokens`, `participants`,
`puzzles`, `puzzle_attempts`, `final_submissions`, `rounds`, `team_results`, `audit_logs` —
all with primary keys, foreign keys, unique constraints, CHECK constraints and indexes.

Nothing important lives in the browser: the timer, leader, puzzle assignment, tokens, answers
and ranking are all server-side.

---

## Admin login

1. Open `/admin/login`.
2. Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
3. Session is an HttpOnly, SameSite cookie; `/admin` pages re-verify with the server on load.
   Every admin API returns **401** without a valid session and **403** when a participant tries.

---

## QR codes

* Admin → **QR codes** shows 8 real QR PNGs, one per team, each encoding
  `PUBLIC_BASE_URL/join/team/<secure-random-token>` (24 random bytes, base64url).
* Buttons: **Download**, **Print**, **Copy link**, **Regenerate**, plus **Print all QR codes**
  (a clean printable sheet: team name, QR, "SCAN TO JOIN TEAM N").
* Regenerating a token invalidates the previous QR immediately (covered by tests).
* QR contents carry no team IDs, names or admin data — only the opaque token, validated on the server.

Scanning flow: open link → verify token → show team name → enter name → session created →
waiting room.

---

## Event runbook

1. **Configure** (before doors open): Teams (names, rosters, correct sequences), Puzzles
   (questions, answers, alternatives, reward tokens), QR codes → print sheets.
2. **Check-in**: players scan their team QR and enter names. Waiting room shows
   `n / 4 CONNECTED`. At 4/4 the server picks one leader at random and assigns each player
   puzzle 1–4. No player ever sees a start button.
3. **PREPARE ROUND** → shows `READY`, participants/32 and teams/8.
4. **START ROUND** → server sets `roundStartedAt` / `roundEndsAt = +10:00`; every phone shows
   the server-derived countdown.
5. **Monitor**: Live monitoring updates over WebSocket (players, leader, puzzles solved,
   final attempts, status, clock). Audit log records every event.
6. Puzzles: wrong answers return `Incorrect answer. Try again.` (no answer leak); correct
   answers reveal that team's token to that player only.
7. When all 4 are solved, the leader's **FINAL TEAM ANSWER** screen appears with the four earned
   tokens (never in the correct order). Each submission returns only
   `N positions are correct / M positions are incorrect` — retries allowed, timer never resets.
8. **END ROUND** (or the timer expires): submissions lock, rankings computed, top 4 QUALIFIED,
   bottom 4 DISQUALIFIED. Results page + admin Results show the real table.
9. **RESET ROUND** (confirmation required): clears participants, attempts, submissions,
   leaders, timer and completion — preserves teams, puzzles, QR tokens, admins and audit logs.

### Ranking rules

1. Teams that completed rank above teams that did not.
2. Among completed teams: fastest server-recorded completion time.
3. Tie-breaks: fewer incorrect final-sequence submissions → fewer incorrect puzzle attempts →
   earliest server timestamp.
4. Rank 1–4 qualify (only completed teams can qualify); rank 5–8 are eliminated.

---

## API summary

Participant: `GET/POST /api/join/:teamToken`, `GET /api/session`, `GET /api/round/status`,
`GET /api/team/status`, `GET /api/my-puzzle`, `GET /api/team/progress`,
`POST /api/puzzle/submit`, `GET /api/team/submissions`, `POST /api/team/final-submit`,
`GET /api/results`.

Admin: `POST /api/admin/login|logout`, `GET /api/admin/me`, `GET|PUT /api/admin/teams`,
`PUT /api/admin/teams/:id/sequence`, `GET /api/admin/qr`, `POST /api/admin/qr/regenerate`,
`GET /api/admin/puzzles`, `PUT /api/admin/puzzles/:id`,
`GET /api/admin/round`, `POST /api/admin/round/prepare|start|end|reset`,
`GET /api/admin/live-status`, `GET /api/admin/results`, `GET /api/admin/submissions`,
`GET /api/admin/attempts`, `GET /api/admin/logs`.

Socket.IO events: `player_joined`, `all_players_ready`, `leader_selected`, `round_started`,
`round_ended`, `round_reset`, `puzzle_solved`, `team_progress_updated`, `final_submission`,
`final_feedback`, `team_completed`, `live_update`, `results_updated`.

---

## Security notes

* Server-side authority for team, slot, leader, puzzle, tokens, timer and ranking.
* Leader-only final submission enforced by the API (hiding the button is not the control).
* The correct sequence never reaches participant responses (HTML, JS, storage or payloads).
* scrypt-hashed admin passwords; HttpOnly + SameSite cookies, Secure in production.
* Zod validation, request size limits, per-IP rate limits (join, submissions, admin login, API).
* Helmet headers: CSP, nosniff, referrer policy, permissions policy, frame-ancestors none.
* CORS restricted to `FRONTEND_URL`; parameterized SQL; sanitized error responses; audit logging.

---

## Verification

```bash
npm run lint          # eslint (server + client)
npm run typecheck     # tsc --noEmit (server incl. tests, client)
npm test              # 35 integration/security tests + QR decoding tests
npm run build         # production build (server/dist + client/dist)
npm run audit:secrets # repo secret/debug/placeholder scan
npm audit             # dependency audit
```

End-to-end checks against a running build:

```bash
node scripts/smoke.mjs          # 56 checks: SPA, admin, QR, gameplay, ranking
node scripts/security-check.mjs # 22 checks: rate limits, headers, CORS, sanitized errors
```

---

## Deployment

1. Provision a Node 24+ host with HTTPS (nginx/caddy), set `TRUST_PROXY=1`.
2. `npm ci && npm run build`.
3. Set the environment variables above with `PUBLIC_BASE_URL` / `FRONTEND_URL` set to your domain.
4. `npm start` (or run under pm2/systemd). Set `DATABASE_URL`/`DIRECT_URL` to Supabase in the host environment.
5. Before the event: open `/admin`, set `ADMIN_PASSWORD`, configure puzzles/sequences, print QRs.
6. After the event: export results from the Results page; reset the round if you re-run it.

The delivered repository contains no test accounts, demo players or seeded results — the database
is created empty (teams, puzzles, admin only) on first boot.

---

## Deploying to Vercel + Render

The repo ships with [`vercel.json`](vercel.json) (static frontend + `/api` and `/socket.io` proxied
to the backend) and [`render.yaml`](render.yaml) (API blueprint; the database lives on Supabase).

1. **Render (API + frontend):** Dashboard → *New → Blueprint* → select this repo. After the
   service is created, open **Environment** and set `DATABASE_URL` (Supabase pooler, port 6543)
   and `DIRECT_URL` (Supabase session mode, port 5432) — both are `sync: false` in the blueprint.
   Copy the generated `ADMIN_PASSWORD`, redeploy, then confirm
   `https://<service>.onrender.com/api/health` returns `{"ok":true}`. The Render URL alone serves
   the whole game — QR codes derive from it automatically.
2. **Vercel (frontend):** *New Project → Import repo*. Vercel picks up `vercel.json`
   (`npm run build -w client` → `client/dist`) and deploys.
3. **Cross-link:** replace `YOUR-RENDER-SERVICE.onrender.com` in `vercel.json` with your real
   Render URL (push → Vercel redeploys), then in Render set
   `PUBLIC_BASE_URL` and `FRONTEND_URL` to `https://<project>.vercel.app` and redeploy.
4. **Verify:** the Vercel URL loads the gate page, `/admin/login` works, and Admin → *QR codes*
   shows join URLs beginning with `https://<project>.vercel.app`. Only then print the QR sheet.

Notes:

- The Vercel proxy forwards HTTP but not WebSocket upgrades, so Socket.IO falls back to
  long-polling (the client now starts with `polling` and upgrades where possible); the UI also
  refreshes every 15 s, so game correctness never depends on the socket.
- Render services sleep when idle → the first scan after idle takes ~30 s; keep the instance on a
  plan that does not sleep during the event.
- Single instance — one process runs the round ticker and Socket.IO rooms; that is plenty for
  32 players, and the database (Supabase) survives independently of the instance.
- For bulletproof WebSockets, skip Vercel and serve the SPA from Render (single origin, no proxy).
