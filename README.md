# Soul Link

Anime 1v1 fighting game (Street Fighter-ish) where both characters are autonomous LLM agents.
Players coach rather than directly input moves — each agent decides its own combos in real time
based on its personality, live opponent read, and persistent cross-match memory.

Built for Daytona HackSprint w/ Arize AI — NYC, October 2026.

## Team

- **Frontend (fight stage, UI, HUD, voice playback):** srini1998 (this repo's owner)
- **Backend (agents, memory, sandboxing, tracing):** [mkchand02](https://github.com/mkchand02)

## Architecture

```
Browser (any device)
   |  WebSocket / HTTP
   v
Backend (hosted inside a Daytona sandbox)
   |-- Reflex tier: small local model (Ollama) -> fast per-tick move selection (LIGHT/HEAVY/BLOCK/SPECIAL/DODGE)
   |-- Strategy tier: cloud LLM -> personality, taunts, scouting decisions, memory writes (called less often)
   |-- SurrealDB Agent Memory -> each fighter's history/grudges/nemesis bonuses, queried before + written after fights
   |-- Arize AX -> traces every agent decision (reasoning, latency, token cost); exposed to frontend as a live "Focus Meter"
   |-- Anchor Browser -> lets an agent scout its opponent (cloud browser) between rounds
```

Frontend renders the fight (character art + hit effects + HUD) and plays each taunt line via
ElevenLabs. It never talks to Daytona, SurrealDB, Arize, or Anchor Browser directly — all of that
is backend-only, both for simplicity and because those API keys must never be exposed to a browser.

## Sponsor tools in play

| Tool | Owner | What it's used for |
|---|---|---|
| Daytona | backend | hosts the agent backend (and, if time allows, per-match sandboxes) |
| Arize AX | backend | traces/evals every agent decision |
| SurrealDB Agent Memory | backend | typed, time-aware memory of past matches per agent |
| Anchor Browser | backend | agent scouts its opponent via a cloud browser between rounds |
| ElevenLabs | frontend | voices each agent's taunts/special-move callouts |
| AWS | backend/infra | hosting |

## Repo layout

```
frontend/   fight stage UI, HUD, ElevenLabs playback
backend/    agents, Daytona hosting, SurrealDB, Arize, Anchor Browser
```

## Env vars

Secrets never go in frontend code that ships to the browser — only `ELEVENLABS_API_KEY` (and the
backend's base URL) belong on the frontend side. Everything else is backend-only. See
`frontend/.env.example` and `backend/.env.example`.
