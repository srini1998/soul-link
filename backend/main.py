"""Soul Link: Grudge Protocol — backend.

Runs in STUB mode automatically when env keys are missing:
  - no LLM key        -> moves cycle through a fixed list, canned taunts
  - no SurrealDB vars -> memoryUsed returns canned facts, nothing is written
Set the env vars (see .env.example) and the same endpoints go real. Contract never changes.
"""
import asyncio
import json
import os
import random
import uuid

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

MOVES = ["LIGHT_ATTACK", "HEAVY_ATTACK", "BLOCK", "SPECIAL", "DODGE"]

SOULS = {
    "soul_a": {
        "name": "Kaito Blaze",
        "personality": "Hot-headed fire swordsman. Reckless, loves heavy hits, holds grudges forever, "
                       "talks trash constantly. Hates being blocked.",
    },
    "soul_b": {
        "name": "Rei Shadowfang",
        "personality": "Cold, calculating shadow assassin. Patient, dodges and counters, studies "
                       "opponents' habits and exploits them. Speaks in short, cutting lines.",
    },
}

# ---------- config ----------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
LLM_MODEL = os.getenv("LLM_MODEL")  # optional override
# Bedrock wins if AWS creds are present (AWS lab accounts), then Anthropic API, then OpenAI, else stub
LLM_BACKEND = ("bedrock" if os.getenv("AWS_ACCESS_KEY_ID") else "anthropic" if ANTHROPIC_API_KEY
               else "openai" if OPENAI_API_KEY else "stub")

SURREAL_HOST = os.getenv("SURREAL_MEMORY_HOST", "").rstrip("/")
SURREAL_CONTEXT = os.getenv("SURREAL_CONTEXT_ID", "")
SURREAL_KEY = os.getenv("SURREAL_API_KEY", "")
# comma-separated scope paths registered via the SurrealDB CLI
SURREAL_SCOPES = [s.strip() for s in os.getenv("SURREAL_SCOPES", "").split(",") if s.strip()]
SURREAL_ON = bool(SURREAL_HOST and SURREAL_CONTEXT and SURREAL_KEY)

# ---------- optional Arize AX tracing (OpenInference) ----------
if os.getenv("ARIZE_API_KEY") and os.getenv("ARIZE_SPACE_ID"):
    try:
        from arize.otel import register
        tp = register(space_id=os.environ["ARIZE_SPACE_ID"], api_key=os.environ["ARIZE_API_KEY"],
                      project_name=os.getenv("ARIZE_PROJECT", "soul-link-grudge-protocol"))
        if LLM_BACKEND in ("bedrock", "anthropic"):
            from openinference.instrumentation.anthropic import AnthropicInstrumentor
            AnthropicInstrumentor().instrument(tracer_provider=tp)
        elif LLM_BACKEND == "openai":
            from openinference.instrumentation.openai import OpenAIInstrumentor
            OpenAIInstrumentor().instrument(tracer_provider=tp)
        print("[arize] tracing on")
    except Exception as e:  # never let tracing kill the server
        print(f"[arize] tracing disabled: {e}")

app = FastAPI(title="Soul Link: Grudge Protocol")
# Daytona's preview proxy adds its own CORS headers; a second set makes browsers reject responses
if not os.getenv("DISABLE_CORS"):
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MATCHES: dict[str, dict] = {}
_BG: set = set()  # strong refs so background writes are not garbage-collected


class StartReq(BaseModel):
    agentA: str = "soul_a"
    agentB: str = "soul_b"


class TurnReq(BaseModel):
    matchId: str


def fighter(soul_id: str) -> dict:
    soul = SOULS.get(soul_id, {"name": soul_id, "personality": "A mysterious fighter."})
    return {"id": soul_id, "name": soul["name"], "hp": 100, "maxHp": 100}


def public_state(m: dict) -> dict:
    return {"agentA": dict(m["agentA"]), "agentB": dict(m["agentB"])}


# ---------- SurrealDB Agent Memory ----------
def _surreal_headers():
    return {"Authorization": f"Bearer {SURREAL_KEY}", "Content-Type": "application/json"}


def _flatten_memory(data) -> list[str]:
    """Agent Memory /query returns {"hits": [{"text", "source", "score", ...}]}.
    Skip bare entity hits (just a name like "Rei Shadowfang") and keep real memories."""
    hits = data.get("hits", []) if isinstance(data, dict) else []
    out = []
    for h in hits:
        if isinstance(h, dict) and h.get("source") != "entity" and isinstance(h.get("text"), str):
            if h["text"] not in out:
                out.append(h["text"])
    return out


async def memory_query(m: dict, actor_key: str) -> list[str]:
    me, opp = m[actor_key], m[other(actor_key)]
    if not SURREAL_ON:
        return [f"[stub] {opp['name']} opened with HEAVY_ATTACK last match",
                f"[stub] {me['name']} lost the last fight at 12 HP"]
    q = (f"What happened in past fights between {me['name']} ({me['id']}) and "
         f"{opp['name']} ({opp['id']})? What moves does {opp['name']} favor, and who won?")
    body = {"query": q}
    if SURREAL_SCOPES:
        body["lens"] = SURREAL_SCOPES
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{SURREAL_HOST}/api/v1/{SURREAL_CONTEXT}/query", json=body,
                             headers=_surreal_headers())
            r.raise_for_status()
            try:
                facts = _flatten_memory(r.json())
            except ValueError:
                facts = [r.text]
            return [f for f in facts if f][:6]
    except Exception as e:
        print(f"[surreal] query failed: {e!r}")
        return []


async def memory_write(m: dict):
    if not SURREAL_ON:
        return
    a, b = m["agentA"], m["agentB"]
    w = m[m["winner"]]["name"] if m["winner"] else "nobody"
    moves_a = [h["move"] for h in m["log"] if h["actor"] == "agentA"]
    moves_b = [h["move"] for h in m["log"] if h["actor"] == "agentB"]
    taunts = [f'{m[h["actor"]]["name"]}: "{h["taunt"]}"' for h in m["log"][-4:]]
    text = (f"Match {m['id']}: {a['name']} ({a['id']}) vs {b['name']} ({b['id']}). Winner: {w}. "
            f"Final HP {a['name']} {a['hp']}, {b['name']} {b['hp']}. Turns: {len(m['log'])}. "
            f"{a['name']} moves: {', '.join(moves_a)}. {b['name']} moves: {', '.join(moves_b)}. "
            f"Last words: {' | '.join(taunts)}")
    body = {"text": text, "infer": "full"}
    if SURREAL_SCOPES:
        body["scopes"] = SURREAL_SCOPES
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{SURREAL_HOST}/api/v1/{SURREAL_CONTEXT}/facts", json=body,
                             headers=_surreal_headers())
            print(f"[surreal] write {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"[surreal] write failed: {e!r}")


# ---------- LLM decision ----------
STUB_CYCLE = ["LIGHT_ATTACK", "HEAVY_ATTACK", "BLOCK", "DODGE", "SPECIAL"]
STUB_TAUNTS = {
    "LIGHT_ATTACK": "Just a warm-up!",
    "HEAVY_ATTACK": "Feel the full weight of my grudge!",
    "BLOCK": "You think that can break me?",
    "DODGE": "Too slow.",
    "SPECIAL": "Soul Link... unleashed!",
}

DECISION_SCHEMA = {
    "type": "object",
    "properties": {
        "move": {"type": "string", "enum": MOVES},
        "taunt": {"type": "string", "description": "One short in-character line, max 15 words."},
    },
    "required": ["move", "taunt"],
    "additionalProperties": False,
}

RULES = ("Moves: LIGHT_ATTACK (8-12 dmg, reliable), HEAVY_ATTACK (16-24 dmg), "
         "SPECIAL (28-34 dmg, can't be used two turns in a row by you), "
         "BLOCK (opponent's next hit on you deals 30%), DODGE (50% chance opponent's next hit misses). "
         "Pick the move that best fits your personality AND exploits what memory says about this opponent.")


def build_prompt(m: dict, actor_key: str, memory: list[str]) -> tuple[str, str]:
    me, opp = m[actor_key], m[other(actor_key)]
    persona = SOULS.get(me["id"], {}).get("personality", "A mysterious fighter.")
    recent = [f'{m[h["actor"]]["name"]}: {h["move"]}' for h in m["log"][-6:]]
    system = (f"You are {me['name']} in a turn-based anime 1v1 battle. Personality: {persona} "
              f"{RULES} Stay in character.")
    user = (f"Your HP: {me['hp']}/{me['maxHp']}. {opp['name']} HP: {opp['hp']}/{opp['maxHp']}.\n"
            f"Recent turns this match: {recent or 'none, this is the opening move'}.\n"
            f"Memories of past fights vs {opp['name']}: {memory or 'none — first time meeting'}.\n"
            f"Your last move: {m['last_move'][actor_key] or 'none'}.\n"
            f"Choose your move and a taunt. Reference a memory in the taunt if you have one.")
    return system, user


def llm_decide_sync(system: str, user: str) -> dict:
    if LLM_BACKEND in ("bedrock", "anthropic"):
        import anthropic
        if LLM_BACKEND == "bedrock":
            # classic bedrock-runtime client: the Mantle endpoint 404s on this lab account
            client = anthropic.AnthropicBedrock(
                aws_access_key=os.getenv("AWS_ACCESS_KEY_ID"), aws_secret_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
                aws_session_token=os.getenv("AWS_SESSION_TOKEN") or None, aws_region=AWS_REGION)
            model = LLM_MODEL or "us.anthropic.claude-sonnet-5-5"
        else:
            client = anthropic.Anthropic()
            model = LLM_MODEL or "claude-sonnet-5-5"
        resp = client.messages.create(
            model=model,
            max_tokens=4000,
            output_config={"effort": "low"},  # one quick decision per turn; keeps latency down
            system=system + " Always respond by calling the choose_move tool exactly once.",
            messages=[{"role": "user", "content": user}],
            tools=[{"name": "choose_move", "description": "Submit your move for this turn.",
                    "input_schema": DECISION_SCHEMA, "strict": True}],
            tool_choice={"type": "auto"},  # forced tool_choice 400s on current models; strict keeps args valid
        )
        block = next((b for b in resp.content if b.type == "tool_use"), None)
        if block is None:
            raise ValueError(f"no tool call (stop_reason={resp.stop_reason})")
        return dict(block.input)
    from openai import OpenAI
    client = OpenAI()
    resp = client.chat.completions.create(
        model=LLM_MODEL or "gpt-4o-mini",
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_schema",
                         "json_schema": {"name": "choose_move", "strict": True, "schema": DECISION_SCHEMA}},
        max_tokens=200,
    )
    return json.loads(resp.choices[0].message.content)


async def decide(m: dict, actor_key: str, memory: list[str]) -> tuple[str, str]:
    if LLM_BACKEND == "stub":
        move = STUB_CYCLE[m["turn"] // 2 % len(STUB_CYCLE)]
        return move, STUB_TAUNTS[move]
    system, user = build_prompt(m, actor_key, memory)
    try:
        out = await asyncio.wait_for(asyncio.to_thread(llm_decide_sync, system, user), timeout=15)
        move = out.get("move")
        taunt = str(out.get("taunt", "")).strip()[:160] or "..."
        if move not in MOVES:
            raise ValueError(f"bad move {move!r}")
        return move, taunt
    except Exception as e:
        print(f"[llm] fallback: {e}")
        move = random.choice(["LIGHT_ATTACK", "HEAVY_ATTACK", "BLOCK"])
        return move, STUB_TAUNTS[move]


# ---------- game rules ----------
def other(k: str) -> str:
    return "agentB" if k == "agentA" else "agentA"


def resolve(m: dict, actor_key: str, move: str) -> tuple[str, int]:
    """Returns (effective move, damage dealt). Defender's stance = their last move."""
    if move == "SPECIAL" and m["last_move"][actor_key] == "SPECIAL":
        move = "HEAVY_ATTACK"  # cooldown: downgrade
    base = {"LIGHT_ATTACK": (8, 12), "HEAVY_ATTACK": (16, 24), "SPECIAL": (28, 34)}.get(move)
    if not base:
        return move, 0
    dmg = random.randint(*base)
    stance = m["last_move"][other(actor_key)]
    if stance == "BLOCK":
        dmg = round(dmg * 0.3)
    elif stance == "DODGE" and random.random() < 0.5:
        dmg = 0
    return move, dmg


# ---------- endpoints ----------
@app.get("/")
def health():
    return {"ok": True, "llm": LLM_BACKEND,
            "memory": "surreal" if SURREAL_ON else "stub", "matches": len(MATCHES)}


async def get_memory(m: dict, actor_key: str) -> list[str]:
    try:
        return await asyncio.wait_for(asyncio.shield(m["memory"][actor_key]), timeout=15)
    except Exception as e:
        print(f"[surreal] memory unavailable: {e!r}")
        return []


@app.post("/match/start")
async def match_start(req: StartReq):
    mid = str(uuid.uuid4())
    m = {"id": mid, "agentA": fighter(req.agentA), "agentB": fighter(req.agentB), "turn": 0,
         "last_move": {"agentA": None, "agentB": None}, "log": [], "done": False, "winner": None}
    # memory only changes when a match ends, so fetch it once per fighter, in the background (queries take 2-7s)
    m["memory"] = {k: asyncio.create_task(memory_query(m, k)) for k in ("agentA", "agentB")}
    MATCHES[mid] = m
    return {"matchId": mid, "state": public_state(m)}


@app.post("/match/turn")
async def match_turn(req: TurnReq):
    m = MATCHES.get(req.matchId)
    if not m:
        raise HTTPException(404, "unknown matchId")
    actor = "agentA" if m["turn"] % 2 == 0 else "agentB"
    if m["done"]:
        return {"actor": actor, "move": "BLOCK", "taunt": "", "damageDealt": 0,
                "state": public_state(m), "memoryUsed": [], "done": True, "winner": m["winner"]}

    memory = await get_memory(m, actor)
    move, taunt = await decide(m, actor, memory)
    move, dmg = resolve(m, actor, move)

    defender = m[other(actor)]
    defender["hp"] = max(0, defender["hp"] - dmg)
    m["last_move"][actor] = move
    m["log"].append({"actor": actor, "move": move, "taunt": taunt, "dmg": dmg})
    m["turn"] += 1

    if defender["hp"] <= 0 or m["turn"] >= 40:
        m["done"] = True
        a, b = m["agentA"]["hp"], m["agentB"]["hp"]
        m["winner"] = actor if defender["hp"] <= 0 else ("agentA" if a > b else "agentB" if b > a else None)
        t = asyncio.create_task(memory_write(m))
        _BG.add(t)
        t.add_done_callback(_BG.discard)

    return {"actor": actor, "move": move, "taunt": taunt, "damageDealt": dmg,
            "state": public_state(m), "memoryUsed": memory, "done": m["done"], "winner": m["winner"]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
