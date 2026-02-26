# Still Point

**The app is live at [still-point.vercel.app](https://still-point.vercel.app)**

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
# Edit .env.local with your Neon connection string and a JWT secret

# Push schema to database
npx drizzle-kit push

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Description | How to get it |
|----------|-------------|---------------|
| `POSTGRES_URL` | Neon database connection string | [Neon console](https://console.neon.tech) → project → connection string |
| `JWT_SECRET` | Secret for signing auth tokens | `openssl rand -hex 32` |

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

The app is live at [still-point.vercel.app](https://still-point.vercel.app).

### Neon (database)

Serverless Postgres hosted on [Neon](https://neon.tech). The connection uses `@neondatabase/serverless` with HTTP queries (no persistent connections).

```bash
# Schema changes
npx drizzle-kit push      # push schema to database
npx drizzle-kit studio    # open Drizzle Studio GUI
```

The Neon MCP connector is available in Claude Code for direct SQL access during development.

### GitHub CLI

Used for issue management and repo operations:

```bash
gh issue list                    # view open issues
gh issue create --title "..."    # create issue
gh pr create --title "..."       # create pull request
```

### CodeRabbit

Automated code review on pull requests via [CodeRabbit](https://coderabbit.ai). Reviews are posted as PR comments — no local setup needed.

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
