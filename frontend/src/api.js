// Matches CONTRACT.md v1 exactly. Backend is already live on Daytona (see .env) — no mock
// needed in the common case, but MOCK_MODE lets dev continue if that sandbox goes down.
const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
const MOCK_MODE = import.meta.env.VITE_MOCK === "1";

const STUB_CYCLE = ["LIGHT_ATTACK", "HEAVY_ATTACK", "BLOCK", "DODGE", "SPECIAL"];
const STUB_TAUNTS = {
  LIGHT_ATTACK: "Just a warm-up!",
  HEAVY_ATTACK: "Feel the full weight of my grudge!",
  BLOCK: "You think that can break me?",
  DODGE: "Too slow.",
  SPECIAL: "Soul Link... unleashed!",
};
const mockMatches = new Map();

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function startMatch(agentAId, agentBId, nameA, nameB) {
  if (MOCK_MODE) {
    const matchId = crypto.randomUUID();
    const m = {
      turn: 0,
      agentA: { id: agentAId, name: nameA, hp: 100, maxHp: 100 },
      agentB: { id: agentBId, name: nameB, hp: 100, maxHp: 100 },
    };
    mockMatches.set(matchId, m);
    return { matchId, state: { agentA: { ...m.agentA }, agentB: { ...m.agentB } } };
  }
  return post("/match/start", { agentA: agentAId, agentB: agentBId });
}

export async function playTurn(matchId) {
  if (MOCK_MODE) {
    const m = mockMatches.get(matchId);
    const actor = m.turn % 2 === 0 ? "agentA" : "agentB";
    const defender = actor === "agentA" ? "agentB" : "agentA";
    const move = STUB_CYCLE[Math.floor(m.turn / 2) % STUB_CYCLE.length];
    const dmg = move === "BLOCK" || move === "DODGE" ? 0 : 8 + Math.floor(Math.random() * 12);
    m[defender].hp = Math.max(0, m[defender].hp - dmg);
    m.turn += 1;
    const done = m[defender].hp <= 0 || m.turn >= 40;
    return {
      actor,
      move,
      taunt: STUB_TAUNTS[move],
      damageDealt: dmg,
      state: { agentA: { ...m.agentA }, agentB: { ...m.agentB } },
      memoryUsed: [`[mock] ${m[defender].name} opened with HEAVY_ATTACK last match`],
      done,
      winner: done ? (m[defender].hp <= 0 ? actor : null) : null,
    };
  }
  return post("/match/turn", { matchId });
}
