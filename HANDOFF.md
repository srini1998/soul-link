# Soul Link — handoff

Daytona HackSprint w/ Arize AI (NYC). This doc is the pickup point if work continues without
the Claude sessions that built most of this (they hit session limits).

## What it is

Turn-based anime 1v1 battle where both fighters are LLM agents. You don't control moves directly
— each fighter picks its own move every turn based on its personality, the live fight state, and
its persistent cross-match memory (SurrealDB) of this specific opponent. Moves are voiced via
ElevenLabs, traced via Arize AX, hosted in a Daytona sandbox.

## Live right now

- **Backend:** `https://8000-6c0b6acf-cf6e-44bf-84e2-425d59658513.daytonaproxy01.net`
  Health check confirms real (not stub) mode: `{"ok":true,"llm":"bedrock","memory":"surreal",...}`
- **Repo:** [srini1998/soul-link](https://github.com/srini1998/soul-link) (public, required for
  Devpost submission) — `mkchand02` has write access.
- **Frontend:** not deployed anywhere public yet — runs locally via `npm --prefix frontend run dev`
  (see Running locally below). If you want a public URL for the demo, host `frontend/` wherever's
  fastest (Vercel/Netlify static deploy works fine, it's a plain Vite app) and point
  `VITE_BACKEND_URL` at the live backend above.

## Roster (locked, ids matter — used across backend/frontend/art)

| id | name | archetype |
|---|---|---|
| soul_a | Kaito Blaze | hot-headed fire swordsman |
| soul_b | Rei Shadowfang | cold, calculating shadow assassin |
| soul_c | Rin Tempest | playful speed-type ninja |
| soul_d | Dorn Ironhide | silent, towering brawler |
| soul_e | Suzu Nightfox | mischievous kitsune trickster |
| soul_f | Varek Stonewill | composed, disciplined mentor |

Personalities live in `backend/main.py`'s `SOULS` dict — that's what actually drives each
fighter's move choice and taunt style.

## Architecture

```
Browser (frontend/, plain Vite + vanilla JS, no framework)
   | REST (CONTRACT.md — frozen, don't change the shape without updating both sides)
   v
Backend (backend/main.py, FastAPI, hosted in ONE Daytona sandbox)
   |-- LLM move/taunt decision -> AWS Bedrock (Anthropic model), traced via Arize AX (OpenInference)
   |-- Memory -> SurrealDB Agent Memory (REST), queried before each move, written when a match ends
   |-- ElevenLabs TTS called CLIENT-SIDE from the browser (frontend/src/voice.js), not the backend
```

Contract: `POST /match/start {agentA, agentB} -> {matchId, state}`,
`POST /match/turn {matchId} -> {actor, move, taunt, damageDealt, state, memoryUsed, done, winner}`.
Full details and field-by-field notes in `CONTRACT.md`.

## What's done

- Full 6-character roster, real personalities driving distinct LLM behavior
- Real LLM (Bedrock) + real persistent memory (SurrealDB) + real voice (ElevenLabs) + Arize tracing, all live
- Battle UI: top HUD with mirrored HP bars (classic fighting-game layout), full-body character
  sprites standing directly in themed stage backdrops (transparent SVGs, no card-box chrome),
  fighters mirrored to face each other
- Per-turn taunts are arena trash-talk style, voiced, react to the last hit, don't repeat, don't
  invent stats that aren't real
- Memory is correctly scoped per-matchup now (`memory_query` in `backend/main.py` filters to facts
  naming both fighters' ids) — earlier bug where a fighter referenced an unrelated opponent's
  history is fixed and verified live

## Known gaps / what's next

- **SurrealDB scopes were never registered via their CLI** — memory filtering happens
  client-side (backend filters the facts after fetching them) instead of server-side (`lens`
  param on the query). Works correctly, just less efficient. Registering real per-matchup scopes
  would be the "proper" fix if there's time, and strengthens the "Best Use of SurrealDB" pitch
  specifically (judging criteria explicitly calls out "retrieval you can trace back to its
  source").
- **No public frontend URL yet** — only runs locally right now. Needed before the live demo/pitch
  unless you're demoing from a laptop directly.
- **Anchor Browser and the dual local+cloud LLM tier were both intentionally cut from scope**
  early on for time — not started, not planned unless there's real time left after the above.
- Devpost submission still needs: team info, demo video (<2 min), and the project description
  covering all sponsor tools used (see table below for that list).

## Sponsor tools used (for the Devpost writeup)

| Tool | What it's doing |
|---|---|
| Daytona | hosts the entire backend in one sandbox (`backend/deploy_daytona.py`) |
| Arize AX | traces every LLM move/taunt decision (space/project in `backend/.env.example`) |
| SurrealDB Agent Memory | each fighter's cross-match memory of specific opponents |
| ElevenLabs | voices every taunt + intro/win lines, client-side from the browser |
| AWS (Bedrock) | the actual LLM calls that decide moves and generate taunts |

## Running locally

```bash
# backend
cd backend && cp .env.example .env   # fill in keys, or leave blank to run in stub mode
pip install -r requirements.txt && python main.py   # :8000

# frontend (separate terminal)
cd frontend && cp .env.example .env   # set VITE_BACKEND_URL + VITE_ELEVENLABS_API_KEY
npm install && npm run dev   # :5173
```

Redeploying the live backend after a change: `python backend/deploy_daytona.py
6c0b6acf-cf6e-44bf-84e2-425d59658513` (reuses the existing sandbox/URL — don't create a new one
unless the old one is actually gone).

## Conventions that kept 3 concurrent contributors from colliding

- Everyone commits straight to `master`, no PR workflow — just `git pull` before every push.
- `backend/.env` and `frontend/.env` are both gitignored and have never been committed (checked
  full git history to confirm) — real keys only ever get shared outside git.
- Character ids (`soul_a`..`soul_f`) are the one piece of shared vocabulary across backend,
  frontend, and art — don't rename them without updating all three.
