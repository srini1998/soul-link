# Soul Link: Grudge Protocol

**Two autonomous Claude agents fight turn by turn, and they remember every past fight with each other.**

Nobody controls the fighters. Each one picks its own move and trash talk every turn from its personality, the live fight state, and what it remembers about this specific opponent (stored in SurrealDB). Lose to someone once and the grudge carries into the next match, changing both its moves and its taunts. Taunts are voiced aloud with ElevenLabs.

Built at Daytona HackSprint NYC (with Arize AI, AWS, ElevenLabs, SurrealDB).

**Live backend:** https://8000-6c0b6acf-cf6e-44bf-84e2-425d59658513.daytonaproxy01.net  (interactive API: [/docs](https://8000-6c0b6acf-cf6e-44bf-84e2-425d59658513.daytonaproxy01.net/docs))

## How a turn works

1. **Match start:** memories are fetched from SurrealDB for each fighter, filtered to facts naming this exact pair.
2. **Prompt:** Claude on AWS Bedrock receives the fighter's personality, both HPs, the opponent's last hit, the retrieved memories, and the fighter's own earlier taunts (so it doesn't repeat itself).
3. **Constrained output:** a strict tool schema allows only 5 moves (`LIGHT_ATTACK`, `HEAVY_ATTACK`, `BLOCK`, `SPECIAL`, `DODGE`) plus a taunt of at most 12 words.
4. **Resolve:** the backend applies damage and returns the new state.
5. **Voice:** the browser sends the taunt to ElevenLabs, using that fighter's own voice.
6. **Match end:** a summary of the fight is written back to SurrealDB for next time.

## Sponsor tools

| Tool | What it does here |
|---|---|
| **Daytona** | Hosts the whole backend in one sandbox with a public preview URL (`backend/deploy_daytona.py`). |
| **AWS Bedrock** | Claude Sonnet 5.5 picks every move and writes every taunt. |
| **SurrealDB Agent Memory** | Cross-match grudges. Facts are extracted into entities and actions, then queried per matchup. |
| **Arize AX** | One `AGENT` span per turn with inputs and outputs, the LLM span nested inside, and each match as a session. |
| **ElevenLabs** | Per-fighter voices for taunts, called from the browser. |

## Safeguards

- Moves are limited to 5 by a strict schema.
- A fallback move and taunt is used if the LLM or memory call fails or times out.
- API keys stay server-side, except the ElevenLabs key, which the browser uses for the local demo.
- Matches are capped at 40 turns.
- Taunts must stay PG-13.
- The model is told not to invent stats.
- Every decision is traced in Arize.

## Roster

| id | Name | Archetype |
|---|---|---|
| soul_a | Kaito Blaze | Hot-headed fire swordsman |
| soul_b | Rei Shadowfang | Cold, calculating shadow assassin |
| soul_c | Rin Tempest | Playful speed-type ninja |
| soul_d | Dorn Ironhide | Silent, towering brawler |
| soul_e | Suzu Nightfox | Mischievous kitsune trickster |
| soul_f | Varek Stonewill | Composed, disciplined mentor |

## Running locally

```bash
# backend
cd backend && cp .env.example .env   # fill in keys, or leave blank to run in stub mode
pip install -r requirements.txt && python main.py   # :8000

# frontend (separate terminal)
cd frontend && cp .env.example .env   # set VITE_BACKEND_URL + VITE_ELEVENLABS_API_KEY
npm install && npm run dev   # :5173
```

API shape is in [CONTRACT.md](CONTRACT.md): `POST /match/start` and `POST /match/turn`. More context is in [HANDOFF.md](HANDOFF.md).

## Team

- **Frontend:** [srini1998](https://github.com/srini1998)
- **Backend:** [mkchand02](https://github.com/mkchand02)
