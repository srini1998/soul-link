# Soul Link: Grudge Protocol — API contract (v1, frozen)

**Base URL (live, Daytona):** `https://8000-6c0b6acf-cf6e-44bf-84e2-425d59658513.daytonaproxy01.net`
Local dev: `http://localhost:8000`

All requests are `POST` with a JSON body and `Content-Type: application/json`. No auth is needed. CORS is open.
This shape does not change when the backend switches from stub to the real LLM and memory.

## GET /
Health check. → `{"ok": true, "llm": "stub|anthropic|openai", "memory": "stub|surreal", "matches": 0}`

## POST /match/start
Request:
```json
{ "agentA": "soul_a", "agentB": "soul_b" }
```
Response:
```json
{
  "matchId": "928907ed-aef1-40c6-8552-1d24f7ef26fa",
  "state": {
    "agentA": { "id": "soul_a", "name": "Kaito Blaze",    "hp": 100, "maxHp": 100 },
    "agentB": { "id": "soul_b", "name": "Rei Shadowfang", "hp": 100, "maxHp": 100 }
  }
}
```

## POST /match/turn
Request:
```json
{ "matchId": "928907ed-aef1-40c6-8552-1d24f7ef26fa" }
```
Response:
```json
{
  "actor": "agentA",
  "move": "LIGHT_ATTACK",
  "taunt": "Just a warm-up!",
  "damageDealt": 9,
  "state": {
    "agentA": { "id": "soul_a", "name": "Kaito Blaze",    "hp": 100, "maxHp": 100 },
    "agentB": { "id": "soul_b", "name": "Rei Shadowfang", "hp": 91,  "maxHp": 100 }
  },
  "memoryUsed": ["Rei Shadowfang opened with HEAVY_ATTACK last match", "..."],
  "done": false,
  "winner": null
}
```

| field | type | notes |
|---|---|---|
| `actor` | `"agentA" \| "agentB"` | who moved this turn. Strictly alternates, starting with agentA |
| `move` | `"LIGHT_ATTACK" \| "HEAVY_ATTACK" \| "BLOCK" \| "SPECIAL" \| "DODGE"` | always one of these 5 |
| `taunt` | string | one short line (≤160 chars) to send to ElevenLabs |
| `damageDealt` | int ≥ 0 | damage the actor did to the **other** fighter. 0 for BLOCK/DODGE or a dodged hit |
| `state` | object | HP of both fighters **after** this turn |
| `memoryUsed` | string[] | facts pulled from SurrealDB for this turn. May be `[]`. Render as-is |
| `done` | bool | true once a fighter hits 0 HP or after 40 turns |
| `winner` | `"agentA" \| "agentB" \| null` | set when `done` is true. `null` means a draw |

Errors: an unknown `matchId` returns `404 {"detail": "unknown matchId"}`. Calling `/match/turn` after `done` returns the final state with `done: true` again.

**Latency:** the stub answers in under 100 ms. The real turn makes one LLM call plus one memory query, which takes about 1–4 s. Show a "thinking…" state while the request is in flight.
