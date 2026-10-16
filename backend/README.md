# Soul Link: Grudge Protocol — backend

```
pip install -r requirements.txt
cp .env.example .env   # fill in keys; any missing -> that part runs as a stub
python main.py         # :8000
```

- `GET /` — health check; shows whether the LLM and memory are real or stubbed
- `POST /match/start` `{agentA, agentB}` → `{matchId, state}`
- `POST /match/turn` `{matchId}` → `{actor, move, taunt, damageDealt, state, memoryUsed, done, winner}`

Turns alternate A, B, A, ... The match ends at 0 HP or after 40 turns. CORS is open.

Deploy: `DAYTONA_API_KEY=... python deploy_daytona.py` prints `BACKEND_URL`.
Redeploy after changes: `python deploy_daytona.py <SANDBOX_ID>`.
