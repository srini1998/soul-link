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
import re
import uuid
from collections import Counter

import httpx
from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    # override=True: the sandbox was created with placeholder env vars; .env must win
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)
except ImportError:
    pass

MOVES = ["LIGHT_ATTACK", "HEAVY_ATTACK", "BLOCK", "SPECIAL", "DODGE"]

SOULS = {
    "soul_a": {
        "gender": "male",
        "name": "Kaito Blaze",
        "personality": "Hot-headed fire swordsman. Reckless, loves heavy hits, holds grudges forever, "
                       "talks trash constantly. Hates being blocked.",
        "trash_talk": "Loud, cocky arena loudmouth. Hype-man energy, exclamation marks, brags about damage like it's a highlight reel.",
    },
    "soul_b": {
        "gender": "female",
        "name": "Rei Shadowfang",
        "personality": "Cold, calculating shadow assassin. Patient, dodges and counters, studies "
                       "opponents' habits and exploits them. Speaks in short, cutting lines.",
        "trash_talk": "Ice-cold sniper smugness. Short, flat put-downs, smug pauses (...), treats the opponent like a predictable bot.",
    },
    "soul_c": {
        "gender": "female",
        "name": "Rin Tempest",
        "personality": "Playful speed-type ninja. Mocking, overconfident, prefers quick hit-and-run "
                       "pokes over big risks. Never stays still, never admits a hit actually hurt.",
        "trash_talk": "Speedrunner brat. Teasing, sing-song, mocks reaction time and lag, calls hits 'adorable'.",
    },
    "soul_d": {
        "gender": "male",
        "name": "Dorn Ironhide",
        "personality": "Silent, towering brawler. Few words, overwhelming force. Doesn't taunt so "
                       "much as issue short, blunt warnings. Respects strength, nothing else.",
        "trash_talk": "Few words, heavy weight. Two-to-five-word threats and verdicts. 'Sit down.' 'Stay down.'",
    },
    "soul_e": {
        "gender": "female",
        "name": "Suzu Nightfox",
        "personality": "Mischievous kitsune-spirit trickster. Teasing, unpredictable, treats every "
                       "fight like a game she's already won. Loves messing with an opponent's expectations.",
        "trash_talk": "Gremlin troll. Playful, sarcastic, fake-sympathetic ('aww'), loves mind games and 'gotcha' lines.",
    },
    "soul_f": {
        "gender": "male",
        "name": "Varek Stonewill",
        "personality": "Composed, disciplined martial-arts mentor type. Speaks rarely and precisely, "
                       "values honor over showmanship, punishes mistakes rather than rushing in.",
        "trash_talk": "Disappointed sensei. Calm, precise, devastating critiques of the opponent's technique. Never shouts.",
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

try:
    from opentelemetry import trace as _otel
    tracer = _otel.get_tracer("soul-link")  # no-op unless Arize registered a provider above
except ImportError:
    tracer = None

try:
    # FastAPI >=0.14x traces every request natively; in Arize those show as untyped "POST /match/turn" roots
    # wrapping our AGENT spans. Turn it off so each trace starts at the meaningful "turn: <fighter>" span.
    app = FastAPI(title="Soul Link: Grudge Protocol", telemetry={"tracing": False})
except TypeError:  # older FastAPI without native telemetry
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
    """Agent Memory /query returns {"hits": [{"text", "source", "score", "occurredAt", ...}]}.
    Skip bare entity hits (just a name like "Rei Shadowfang") and keep real memories, newest first."""
    hits = data.get("hits", []) if isinstance(data, dict) else []
    seen, found = set(), []
    for h in hits:
        if isinstance(h, dict) and h.get("source") != "entity" and isinstance(h.get("text"), str):
            if h["text"] not in seen:
                seen.add(h["text"])
                found.append((str(h.get("occurredAt") or ""), h["text"]))
    # ISO timestamps sort as strings; undated hits go last, ties keep relevance order
    found.sort(key=lambda t: t[0], reverse=True)
    return [text for _, text in found]


_MATCH_RE = re.compile(r"Match [^:]+: (.+?) \((\w+)\) vs (.+?) \((\w+)\)\. Winner: (.+?)\. "
                       r"Final HP (.+?) (\d+), (.+?) (\d+)\.\s*(.*)", re.S)


def _clip(text: str, limit: int = 120) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    head = text[:limit]
    end = head.rfind(". ")
    if end >= limit // 2:  # prefer ending on a whole sentence
        return head[:end + 1]
    return head[:limit - 1].rsplit(" ", 1)[0].rstrip(" ,.;:") + "…"


def _favorite_move(rest: str, name: str) -> "str | None":
    mv = re.search(re.escape(name) + r" moves: ([A-Z_, ]+)", rest)
    moves = [x.strip() for x in mv.group(1).split(",") if x.strip()] if mv else []
    return Counter(moves).most_common(1)[0][0] if moves else None


def shorten_memory(text: str) -> str:
    """One stored match summary -> one projector-friendly line (~120 chars). Never raises."""
    try:
        if not isinstance(text, str):
            return ""
        g = _MATCH_RE.match(text.strip())
        if not g:
            return _clip(text)
        name_a, _, name_b, _, winner, hp_name_a, hp_a, hp_name_b, hp_b, rest = g.groups()
        hp = {hp_name_a: int(hp_a), hp_name_b: int(hp_b)}
        first = lambda n: n.split()[0]
        if winner in (name_a, name_b):
            loser = name_b if winner == name_a else name_a
            fate = "KO'd" if hp.get(loser, 0) <= 0 else f"at {hp[loser]} HP"
            line = f"{first(winner)} won, {first(loser)} {fate} ({first(winner)} at {hp.get(winner, '?')} HP)."
        else:
            line = f"Draw: {first(name_a)} {hp.get(name_a, '?')} HP, {first(name_b)} {hp.get(name_b, '?')} HP."
        fav_a, fav_b = _favorite_move(rest, name_a), _favorite_move(rest, name_b)
        if fav_a and fav_b:
            line += f" {first(name_a)} leaned on {fav_a}; {first(name_b)} on {fav_b}."
        elif rest and " moves: " not in rest:
            line += " " + rest  # hand-written fact: keep its prose, clipped below
        return _clip(line)
    except Exception:
        try:
            return _clip(str(text))
        except Exception:
            return ""


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
            # SURREAL_SCOPES is unset, so the query isn't narrowed server-side (no `lens`) -
            # without this, retrieval pulls from every matchup in the store, not just this one,
            # and a fighter ends up citing an opponent they aren't even fighting this match.
            # Match on the "(soul_x)" ids (unique, order-independent), not display names.
            tags = (f"({me['id']})", f"({opp['id']})")
            relevant = [f for f in facts if f and all(t in f for t in tags)]
            return relevant[:6]
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
# used when the LLM call fails: arena-style lines so even a fallback turn still talks trash
FALLBACK_TAUNTS = {
    "LIGHT_ATTACK": ["Was that supposed to hurt? Watch this.", "Warm-up's over.", "Tag. You're it."],
    "HEAVY_ATTACK": ["Sit down!", "Stay down this time!", "Another one for the scoreboard!"],
    "BLOCK": ["Nice try... really. It was adorable.", "You call that aim?", "Is that all you've got?"],
    "DODGE": ["Too slow.", "Did you lag, or are you just like that?", "I've seen bots with better reflexes."],
    "SPECIAL": ["Hold still, I'm getting a highlight!", "Respawn and try again!", "Boom. Next!"],
}


DECISION_SCHEMA = {
    "type": "object",
    "properties": {
        "move": {"type": "string", "enum": MOVES},
        "taunt": {"type": "string", "description": "One annoyingly funny trash-talk line, 2-8 words."},
    },
    "required": ["move", "taunt"],
    "additionalProperties": False,
}

RULES = ("Moves: LIGHT_ATTACK (8-12 dmg, reliable), HEAVY_ATTACK (16-24 dmg), "
         "SPECIAL (28-34 dmg, can't be used two turns in a row by you), "
         "BLOCK (opponent's next hit on you deals 30%), DODGE (50% chance opponent's next hit misses). "
         "Pick the move that best fits your personality AND exploits what memory says about this opponent.")


TAUNT_STYLE = (
    "Taunts are Unreal Tournament-style trash talk: SHORT and annoyingly funny. 2 to 8 words, never more. "
    "Petty, smug, absurd. Think 'Respawn and try again.', 'Was that supposed to hurt?', 'Next!', "
    "'Get off my map.', 'I've seen bots aim better.', 'Sit down.' Be funny: ridiculous comparisons "
    "(grandma, toaster, tutorial bot, dial-up), fake politeness, mock lag, mock their last whiff. "
    "Use receipts sparingly: one number or past result max, and only ones that appear in this prompt; "
    "never invent stats. Punctuation is for the voice actor: '!' for hype, '...' for a smug pause. "
    "Never reuse or reword one of your earlier taunts. PG-13: no profanity or slurs; mock the "
    "fighting, not the person. Don't copy the examples verbatim."
)


def build_prompt(m: dict, actor_key: str, memory: list[str]) -> tuple[str, str]:
    me, opp = m[actor_key], m[other(actor_key)]
    soul = SOULS.get(me["id"], {})
    persona = soul.get("personality", "A mysterious fighter.")
    voice = soul.get("trash_talk", "")
    pron = {"male": "he/him", "female": "she/her"}
    my_pron = pron.get(soul.get("gender"), "they/them")
    opp_pron = pron.get(SOULS.get(opp["id"], {}).get("gender"), "they/them")
    recent = [f'{m[h["actor"]]["name"]}: {h["move"]} ({h["dmg"]} dmg)' for h in m["log"][-6:]]
    my_taunts = [h["taunt"] for h in m["log"] if h["actor"] == actor_key][-5:]
    last = m["log"][-1] if m["log"] else None
    if last is None:
        just_now = "Opening move: first impression, make it count."
    elif last["dmg"] > 0:
        just_now = f"{opp['name']} just hit you with {last['move']} for {last['dmg']} damage."
    elif last["move"] in ("BLOCK", "DODGE"):
        just_now = f"{opp['name']} just turtled up with {last['move']}."
    else:
        just_now = f"{opp['name']}'s {last['move']} just whiffed for 0 damage."
    system = (f"You are {me['name']} ({my_pron}) in a turn-based anime 1v1 battle; your opponent "
              f"{opp['name']} uses {opp_pron} pronouns. Personality: {persona} "
              f"Trash-talk voice: {voice} {RULES} {TAUNT_STYLE} Stay in character.")
    user = (f"Your HP: {me['hp']}/{me['maxHp']}. {opp['name']} HP: {opp['hp']}/{opp['maxHp']}.\n"
            f"{just_now}\n"
            f"Recent turns this match: {recent or 'none, this is the opening move'}.\n"
            f"Memories of past fights vs {opp['name']}: {memory or 'none, first time meeting'}.\n"
            f"Your last move: {m['last_move'][actor_key] or 'none'}.\n"
            f"Your taunts so far this match (do NOT repeat or rephrase): {my_taunts or 'none yet'}.\n"
            f"Choose your move and one fresh taunt (max 8 words).")
    return system, user


def llm_decide_sync(system: str, user: str) -> dict:
    if LLM_BACKEND in ("bedrock", "anthropic"):
        import anthropic
        if LLM_BACKEND == "bedrock":
            # classic bedrock-runtime client: the Mantle endpoint 404s on this lab account
            client = anthropic.AnthropicBedrock(
                aws_access_key=os.getenv("AWS_ACCESS_KEY_ID"), aws_secret_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
                aws_session_token=os.getenv("AWS_SESSION_TOKEN") or None, aws_region=AWS_REGION,
                open_telemetry=False)  # SDK's own HTTP spans show up in Arize as untyped "POST" noise
            model = LLM_MODEL or "us.anthropic.claude-sonnet-5-5"
        else:
            client = anthropic.Anthropic(open_telemetry=False)
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
        return move, random.choice(FALLBACK_TAUNTS[move])


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
    """The 3 newest memories as one short line each; this is both the LLM's memory and memoryUsed."""
    try:
        facts = await asyncio.wait_for(asyncio.shield(m["memory"][actor_key]), timeout=15)
    except Exception as e:
        print(f"[surreal] memory unavailable: {e!r}")
        return []
    lines = [shorten_memory(f) for f in facts[:3]]
    return [l for l in lines if l]


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
    if tracer:
        # one AGENT span per turn: what the fighter saw (input) -> what it did (output); LLM span nests inside
        with tracer.start_as_current_span(f"turn: {m[actor]['name']}") as span:
            span.set_attribute("openinference.span.kind", "AGENT")
            span.set_attribute("session.id", m["id"])
            span.set_attribute("input.value", json.dumps({
                "fighter": m[actor]["name"], "turn": m["turn"] + 1,
                "myHp": m[actor]["hp"], "opponentHp": m[other(actor)]["hp"], "memoryUsed": memory}))
            span.set_attribute("input.mime_type", "application/json")
            move, taunt = await decide(m, actor, memory)
            move, dmg = resolve(m, actor, move)
            span.set_attribute("output.value", json.dumps({"move": move, "taunt": taunt, "damageDealt": dmg}))
            span.set_attribute("output.mime_type", "application/json")
    else:
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


# ---------- ElevenLabs TTS proxy (keeps the API key server-side for the hosted game) ----------
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
# Only our 7 designed voices, and only short lines: the proxy can't be used as free general-purpose TTS.
TTS_VOICES = {
    "5akCgQNpbNhGou9n9Tjb",  # Kaito
    "unz9GZ9uU4Pf6SA9zI0h",  # Rei
    "r44MxNe5ogbCxpRHGiSg",  # Rin
    "OLWpgWzSnDVueuYWzHBg",  # Dorn
    "x8Dh8b7GBF5F7E3xz0Dy",  # Suzu
    "PNT1xDzDvvCmsSesAyOE",  # Varek
    "bpAREj3auhoUmnRTK6ju",  # announcer
}


class TtsReq(BaseModel):
    text: str
    voiceId: str
    seed: int | None = None


@app.post("/tts")
async def tts(req: TtsReq):
    if not ELEVENLABS_API_KEY:
        raise HTTPException(503, "tts not configured")
    if req.voiceId not in TTS_VOICES or not req.text.strip() or len(req.text) > 220:
        raise HTTPException(400, "voice or text not allowed")
    body = {"text": req.text, "model_id": "eleven_flash_v2_5",
            "voice_settings": {"stability": 0.55, "similarity_boost": 0.9, "style": 0.45, "use_speaker_boost": True}}
    if req.seed is not None:
        body["seed"] = req.seed
    async with httpx.AsyncClient(timeout=20) as c:
        for wait in (0, 0.7, 1.6):  # retry rate limits on the same model
            if wait:
                await asyncio.sleep(wait)
            r = await c.post(f"https://api.elevenlabs.io/v1/text-to-speech/{req.voiceId}",
                             headers={"xi-api-key": ELEVENLABS_API_KEY}, json=body)
            if r.status_code == 200:
                return Response(content=r.content, media_type="audio/mpeg")
            if r.status_code != 429 and r.status_code < 500:
                break
    raise HTTPException(502, f"tts upstream {r.status_code}")


# ---------- hosted game: the built frontend, served at /play ----------
_STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if os.path.isdir(_STATIC):
    app.mount("/play", StaticFiles(directory=_STATIC, html=True), name="play")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
