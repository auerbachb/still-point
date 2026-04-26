# Still Point

**The app is live at [still-point.me](https://still-point.me)**

Practice focus by watching the clock without thinking for fixed blocks of time.

Start at 60 seconds. Add 10 seconds each day. Track when your mind wanders. Review the thoughts that felt urgent later — most of them weren't.

## How it works

1. **Watch the timer** — blocks fill one by one as seconds pass
2. **Tap "I'm thinking"** when you notice your mind wandering — the timer pauses
3. **Capture the thought** (optional) — write down what pulled your attention, then return
4. **Complete the session** — see your stats, add an end-of-session note
5. **Come back tomorrow** — duration increases by 10 seconds per day

Sessions over 2 minutes use minute-sized blocks with a final minute of 10-second blocks. A 60-second progress bar tracks within each minute.

## Stack

| Layer | Tool |
|-------|------|
| Framework | [Next.js 15](https://nextjs.org) (App Router, TypeScript) |
| Database | [Neon](https://neon.tech) Serverless Postgres |
| ORM | [Drizzle](https://orm.drizzle.team) |
| Auth | Custom JWT via [jose](https://github.com/panva/jose) + [bcryptjs](https://github.com/dcodeIO/bcrypt.js) |
| Hosting | [Vercel](https://vercel.com) |
| Styling | Inline styles (no CSS framework) |
| Fonts | Newsreader (serif) + JetBrains Mono (monospace) via `next/font/google` |
| Audio | Web Audio API (synthesized tick, chime, and completion sounds) |

## Local development

```bash
# Clone
git clone https://github.com/auerbachb/still-point.git
cd still-point

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local:
# - POSTGRES_URL_TEST = Neon non-production/test DB URL
# - POSTGRES_URL = same value as POSTGRES_URL_TEST for local dev
# - JWT_SECRET = a local secret

# Push schema to database
npx drizzle-kit push

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Building

Production builds use the standard Next.js build path (without `--turbopack`) for stability:

```bash
npm run build
```

To verify clean build repeatability locally (same check used by CI):

```bash
npm run build:verify -- 3
```

Turbopack builds are kept as an explicit opt-in while Next 15.5 build support remains beta:

```bash
npm run build:turbo
```

## Environment variables

| Variable | Description | How to get it |
|----------|-------------|---------------|
| `POSTGRES_URL` | Runtime DB connection string used by the app (`src/db/index.ts`, `drizzle.config.ts`). In local dev, point at non-production Neon. | [Neon console](https://console.neon.tech) → project/branch → connection string |
| `POSTGRES_URL_TEST` | **Not read by the app** — optional team alias for the non-production URL when documenting or mirroring Vercel Preview envs. | Same as non-prod `POSTGRES_URL` |
| `JWT_SECRET` | Secret for signing auth tokens (`src/lib/auth.ts`, `src/middleware.ts`) | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | Public absolute URL used when generating password reset links. Defaults to `https://still-point.me` when unset. | Deployment URL such as `https://still-point.me` or local `http://127.0.0.1:3000` |
| `EMAIL_FROM` | Sender address for password reset email. Required with `RESEND_API_KEY` for password reset email delivery. | Verified sender/domain in the email provider |
| `RESEND_API_KEY` | Server-only Resend API key for password reset email delivery. Never expose to the client. | Resend dashboard → API Keys |
| `DAILY_API_KEY` | [Daily.co](https://www.daily.co/) REST API key — buddy video rooms and meeting tokens (`src/lib/daily.ts`). Server-only; never expose to the client. | Daily dashboard → Developers → API key |
| `BUDDY_REQUIRE_FRIENDSHIP` | Optional. When exactly `true`, buddy join paths enforce an existing friendship (`src/lib/buddySession.ts`). | Any string other than `true` leaves checks off |

Never commit credentials. Keep actual values only in local/Vercel environment settings. For a **Production / Preview / Local** map, see [Environment matrix (runbook)](#environment-matrix-runbook) below.

## Password reset behavior

Password reset requests always return the same success message whether or not an account exists, so the endpoint does not reveal registered email addresses. When an account exists, the server stores a single-use hashed reset token that expires after one hour and emails a signed reset link to `/reset-password?token=...`.

The reset request endpoint applies a lightweight per-process rate limit by email plus IP address. Keep platform/WAF throttling enabled in production for stronger abuse protection across serverless instances.

## Database environment topology

To keep production data isolated, use a dedicated non-production Neon project instead of branching directly from production.

- `still-point-prod` project: production data only (used by Vercel Production)
- `still-point-nonprod` project: development/test data only
  - `dev` branch: local development
  - `preview` branch (or `test`): Vercel Preview deployments + integration testing

This avoids writing test data into production and avoids cloning production data into development branches.

## Seed data (non-production)

Use the seeded fixtures script against non-production Neon only.

1. Point local runtime and Drizzle CLI at non-production:
   - `.env.local` `POSTGRES_URL=<nonprod dev branch URL>`
   - optional alias: `.env.local` `POSTGRES_URL_TEST=<same URL>`
2. Apply schema:
   - `npx drizzle-kit push`
3. Seed deterministic fixtures:
   - `SEED_CONFIRM=still-point-nonprod npm run db:seed`
4. Run locally:
   - `npm run dev`

What the script currently creates:
- 3 users (`ava_seed`, `leo_seed`, `maya_seed`)
- 3 sessions (2 completed, 1 incomplete)
- 4 thoughts (including one end-of-session note)
- 1 friendship edge (`ava_seed` ↔ `leo_seed`)

Safety guard:
- the script refuses to run unless `SEED_CONFIRM=still-point-nonprod`
- it also refuses to run with `NODE_ENV=production`
- it refuses unless `POSTGRES_URL` points at a Neon host (`*.neon.tech`)
- all inserts run in a single database transaction (rollback on failure)

## Environment matrix (runbook)

Single place for **which Neon**, **which Vercel scopes**, and **third-party keys**. Values are never pasted into the repo — use placeholders such as `postgresql://…` and `daily_…` in tickets only when needed.

### Neon vs Vercel vs local

| Environment | Purpose | Required for app runtime | Where it is configured | Notes |
|---------------|---------|---------------------------|-------------------------|-------|
| **Production** | Public app + prod data | `POSTGRES_URL`, `JWT_SECRET` | **Vercel** → Project → Settings → Environment Variables → **Production**. **Neon** → `still-point-prod` (or your prod project) connection string for `POSTGRES_URL`. | Buddy video also needs `DAILY_API_KEY` in Production if buddy sits use Daily in prod. |
| **Preview** | PR / branch deploys, non-prod data | `POSTGRES_URL`, `JWT_SECRET` | **Vercel** → same project → variables scoped to **Preview**. **Neon** → non-production project/branch URL for `POSTGRES_URL` (see topology above). | Optionally set `POSTGRES_URL_TEST` to the same non-prod URL for humans/docs only. `DAILY_API_KEY` for buddy video on preview deploys. |
| **Local** | Developer machine | `POSTGRES_URL`, `JWT_SECRET` | **Local** → `.env.local` (from [`.env.example`](./.env.example)); **Neon** → `dev` branch (or your non-prod default). **Drizzle CLI** reads `.env.local` / `.env` via [`drizzle.config.ts`](./drizzle.config.ts) for `POSTGRES_URL`. | `npm run dev` does not load secrets from Vercel; copy values locally only. |

Third-party keys in use today:

| Service | Variable | Used for |
|---------|----------|----------|
| Resend (optional) | `EMAIL_FROM`, `RESEND_API_KEY` | Send password reset links (`src/lib/email.ts`). If unset, links are logged server-side for development only. |
| Daily.co | `DAILY_API_KEY` | Create/delete rooms, issue meeting tokens for buddy video (`src/lib/daily.ts`, `src/app/api/buddy/sessions/[id]/start`, `…/meeting-token`). |
| YouTube (optional) | `STILLPOINT_HOMEPAGE_YOUTUBE_VIDEO_ID` | **Marketing only:** 11-character video id for the landing-page demo embed. Unset or empty → no embed (#166). |

### `vercel.json`

[`vercel.json`](./vercel.json) defines `ignoreCommand`: when the git diff against the parent commit is **empty** for the repo (excluding `ios/` and `.claude/`), the command exits **0** and Vercel **skips** creating a new Preview deployment. If there **are** changes in those paths, the command exits **1** and the deployment **runs**. So “no preview” can simply mean “nothing relevant changed,” not necessarily a misconfiguration.

### Common failure modes

| Symptom | Likely cause | What to check |
|---------|----------------|---------------|
| `POSTGRES_URL is not set` at runtime | Missing or wrong Vercel scope | Production vs Preview vs Development scopes in Vercel; local `.env.local` present and loaded |
| Preview writes / reads **production** data | `POSTGRES_URL` on Preview points at prod Neon | Vercel → Env → **Preview** `POSTGRES_URL` = non-prod branch only |
| `JWT_SECRET not set` / 500 on auth | Secret missing in that environment | Same scope as the deployment (Preview PRs use Preview vars) |
| Buddy start: “Video is not configured…” / `DAILY_API_KEY` in error text | Daily key missing for that deploy | Vercel env for the **same** environment as the deployment; redeploy after adding |
| Meeting token 503, logs mention Daily | Invalid or revoked key, or Daily API outage | Rotate key in Daily dashboard; confirm no leading/truncate whitespace in Vercel |
| Buddy join allowed without friendship when you expected otherwise | Flag off by default | Set `BUDDY_REQUIRE_FRIENDSHIP` to the literal string `true` in the target Vercel scope (and locally if testing) |
| `drizzle-kit push` connects to wrong DB | CLI uses `POSTGRES_URL` from `.env.local` / `.env` only | Not from Vercel; align local file with intended Neon branch |

## Tooling

### Vercel (hosting + deployment)

Production deploys via the Vercel CLI:

```bash
npx vercel login
npx vercel --prod --yes
```

Environment variables are managed through the CLI:

```bash
npx vercel env ls                          # list vars
echo "value" | npx vercel env add NAME production  # add var
npx vercel env rm NAME production          # remove var
```

Preview deployments should point to non-production DB credentials:

```bash
# map preview runtime DB URL to Neon non-production branch/project
echo "your_test_db_url" | npx vercel env add POSTGRES_URL preview

# optional canonical alias in preview envs
echo "your_test_db_url" | npx vercel env add POSTGRES_URL_TEST preview
```

Production should continue to use the production Neon URL for `POSTGRES_URL`.

The app is live at [still-point.me](https://still-point.me).

## Release operations

All iOS release and App Store submission work must reference:

- [iOS release / TestFlight runbook](ios/RELEASING.md)
- [iOS App Store submission and delegation runbook](docs/operations/ios-app-store-submission.md)

Use these files as the source of truth when creating GitHub issues, delegating release tasks, or asking AI coding agents to prepare release work. The TestFlight upload path is automated through GitHub Actions; the App Store submission runbook identifies which App Store Connect steps are automatable through Apple's API and which still require an Account Holder/Admin or human release decision.

### Neon (database)

Serverless Postgres hosted on [Neon](https://neon.tech). The connection uses `@neondatabase/serverless` with HTTP queries (no persistent connections).

```bash
# Schema changes
npx drizzle-kit push      # push schema to database
npx drizzle-kit studio    # open Drizzle Studio GUI
```

The Neon MCP connector is available in Claude Code for direct SQL access during development.

**Operations:** production restore expectations (RPO/RTO) and a Neon console checklist live in [docs/operations/neon-disaster-recovery.md](docs/operations/neon-disaster-recovery.md).

### GitHub CLI

Used for issue management and repo operations:

```bash
gh issue list                    # view open issues
gh issue create --title "..."    # create issue
gh pr create --title "..."       # create pull request
```

### CodeRabbit

Automated code review on pull requests via [CodeRabbit](https://coderabbit.ai). Reviews are posted as PR comments — no local setup needed.

## E2E policy and runbooks

Cross-cutting web + iOS E2E standards (retries, deterministic waits, secrets/env guardrails, artifact policy, flake triage rubric, tags/lanes, visual+perf scope, merge gates, and reproducibility) are documented in:

- [docs/testing/e2e-policy.md](docs/testing/e2e-policy.md)
- [ios/E2E_RUNBOOK.md](ios/E2E_RUNBOOK.md)

## Merge gates (current)

As of this audit, GitHub branch protection and rulesets are not configured with required status checks on `main`. In practice, the team uses Vercel + PR review signals as the merge gate.

What should be green before merge:

- `Vercel` — preview deployment completed successfully
- `Vercel Agent Review` — Vercel's automated review completed
- `Vercel Preview Comments` — preview comment bot completed
- `CodeRabbit` — review completed with no blocking findings

Notes:

- The GitHub Actions workflow `Build & Upload to TestFlight` is **release-only** (tag trigger `ios-v*`) and is not a pull-request merge gate.
- For strict enforcement, add these check names under GitHub branch protection required checks for `main`.

## Project structure

```
src/
  app/
    page.tsx                 # SPA shell — manages views and auth state
    layout.tsx               # fonts, global styles, metadata
    globals.css              # keyframes (fadeIn, breathe, pulse)
    api/
      auth/                  # signup, login, logout, me
      sessions/              # CRUD for meditation sessions
      thoughts/              # batch insert + list thoughts
      board/                 # public leaderboard
      settings/              # toggle public visibility
  components/
    AuthScreen.tsx           # login/signup form
    HomeView.tsx             # day counter, begin button, FAQ
    SessionView.tsx          # timer orchestrator + auto-hide controls
    BlockTimer.tsx           # visual block grid + countdown + 60s bar
    MindStateBar.tsx         # green/amber timeline bar
    ThoughtCapture.tsx       # thought input during thinking state
    CompletionScreen.tsx     # stats + session note input
    HistoryView.tsx          # session history with bar charts
    ThoughtJournal.tsx       # all captured thoughts by day
    PublicBoard.tsx          # practitioners leaderboard
    SettingsView.tsx         # account + public toggle
  db/
    schema.ts                # Drizzle schema (users, sessions, thoughts)
    index.ts                 # database connection
  lib/
    auth.ts                  # JWT + bcrypt helpers
    api.ts                   # typed fetch wrapper
    audio.ts                 # Web Audio API sound synthesis
    constants.ts             # BASE_DURATION, INCREMENT, BLOCK_DURATION
  middleware.ts              # route protection
```

## Database schema

| Table | Purpose | Key fields |
|-------|---------|------------|
| **users** | Accounts with progressive day counter | email, username, currentDay, isPublic |
| **sessions** | One per completed or abandoned sitting | dayNumber, duration, clearPercent, thoughtCount, mindStateLog, sessionDate |
| **thoughts** | Captured during sessions or as end-of-session notes | sessionId, dayNumber, timeInSession, text |

Thoughts with `timeInSession >= 0` were captured mid-session. Thoughts with `timeInSession = -1` are end-of-session journal notes.

## License

MIT
