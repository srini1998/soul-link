import "./style.css";
import { CHARACTERS, getCharacter } from "./characters.js";
import { startMatch, playTurn } from "./api.js";
import { speak } from "./voice.js";
import { CHARACTER_ART } from "./art/index.js";

// Renders a character's portrait SVG into `el`, cropped to fill it (preserveAspectRatio set
// programmatically since the source SVGs only declare width="100%"). Falls back to the old
// color-swatch gradient if art for an id is ever missing.
function paintPortrait(el, c) {
  const markup = CHARACTER_ART[c.id];
  if (!markup) {
    el.style.background = `linear-gradient(135deg, ${c.colors.primary}, ${c.colors.dark})`;
    return;
  }
  el.innerHTML = markup;
  const svg = el.querySelector("svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.style.display = "block";
}

const app = document.getElementById("app");

const state = {
  screen: "select", // "select" | "battle"
  pickA: null,
  pickB: null,
  matchId: null,
  match: null, // { agentA, agentB }
  lastTurn: null, // { actor, move, taunt, memoryUsed }
  busy: false,
  autoplay: false,
  error: null,
  wonSpoken: false,
};

function render() {
  app.innerHTML = "";
  if (state.screen === "select") app.appendChild(renderSelect());
  else app.appendChild(renderBattle());
}

function renderSelect() {
  const wrap = document.createElement("div");

  const h1 = document.createElement("h1");
  h1.textContent = "Soul Link";
  const sub = document.createElement("p");
  sub.className = "subtitle";
  sub.textContent = "Pick two fighters.";
  wrap.append(h1, sub);

  const roster = document.createElement("div");
  roster.className = "roster";
  for (const c of CHARACTERS) {
    const card = document.createElement("div");
    card.className = "card";
    card.style.setProperty("--accent", c.colors.primary);
    if (state.pickA === c.id || state.pickB === c.id) card.classList.add("selected");
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    const portrait = document.createElement("div");
    portrait.className = "portrait";
    paintPortrait(portrait, c);
    swatch.appendChild(portrait);
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = c.name;
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = c.tagline;
    card.append(swatch, name, tag);
    card.onclick = () => {
      if (state.pickA === c.id) state.pickA = null;
      else if (state.pickB === c.id) state.pickB = null;
      else if (!state.pickA) state.pickA = c.id;
      else if (!state.pickB && c.id !== state.pickA) state.pickB = c.id;
      render();
    };
    roster.appendChild(card);
  }
  wrap.appendChild(roster);

  const pickRow = document.createElement("div");
  pickRow.className = "pick-row";
  pickRow.innerHTML = `<span>Fighter 1:</span> ${
    state.pickA ? getCharacter(state.pickA).name : "—"
  } &nbsp; <span>Fighter 2:</span> ${state.pickB ? getCharacter(state.pickB).name : "—"}`;
  wrap.appendChild(pickRow);

  const startBtn = document.createElement("button");
  startBtn.className = "primary";
  startBtn.textContent = "Start match";
  startBtn.disabled = !(state.pickA && state.pickB);
  startBtn.onclick = async () => {
    const a = getCharacter(state.pickA);
    const b = getCharacter(state.pickB);
    startBtn.disabled = true;
    startBtn.textContent = "Starting...";
    try {
      const res = await startMatch(a.id, b.id, a.name, b.name);
      state.matchId = res.matchId;
      state.match = res.state;
      state.lastTurn = null;
      state.wonSpoken = false;
      state.screen = "battle";
      render();
      speak(a.lines.intro, a.voiceId); // no-op until a voiceId is filled in
    } catch (e) {
      state.error = e.message;
      render();
    }
  };
  wrap.appendChild(startBtn);

  if (state.error) {
    const err = document.createElement("p");
    err.className = "status";
    err.style.color = "#e24b4a";
    err.textContent = state.error;
    wrap.appendChild(err);
  }

  return wrap;
}

const STAGE_LANDMARKS = {
  desert: 3,
  blizzard: 3,
  tropical: 3,
  village: 4,
  shrine: 3,
  dojo: 3,
};

function stageBackground(theme) {
  const stage = document.createElement("div");
  stage.className = "stage-bg";
  stage.dataset.stage = theme;
  const sky = document.createElement("div");
  sky.className = "stage-sky";
  const orb = document.createElement("div");
  orb.className = "stage-orb";
  const ground = document.createElement("div");
  ground.className = "stage-ground";
  stage.append(sky, orb, ground);
  const count = STAGE_LANDMARKS[theme] || 3;
  for (let i = 0; i < count; i++) {
    const land = document.createElement("div");
    land.className = `stage-landmark land-${i + 1}`;
    stage.appendChild(land);
  }
  const particles = document.createElement("div");
  particles.className = "stage-particles";
  for (let i = 0; i < 10; i++) {
    const mote = document.createElement("span");
    mote.className = "mote";
    particles.appendChild(mote);
  }
  stage.appendChild(particles);
  return stage;
}

function fighterBlock(key) {
  const agent = state.match[key];
  const c = getCharacter(agent.id);
  const div = document.createElement("div");
  div.className = "fighter";
  if (state.lastTurn && state.lastTurn.actor !== key && state.lastTurn.damageDealt > 0) {
    div.classList.add("hit");
    div.style.setProperty("--shake", state.lastTurn.move === "HEAVY_ATTACK" ? "10px" : "6px");
  }
  let burst = null;
  if (state.lastTurn && state.lastTurn.actor === key) {
    // one class per move type so each gets its own choreography (see style.css) — applied to
    // the whole fighter block so it works on whatever art is in .swatch, placeholder or real.
    const move = state.lastTurn.move;
    div.classList.add(`move-${move.toLowerCase()}`);
    div.style.setProperty("--dir", key === "agentA" ? "1" : "-1");
    if (move === "LIGHT_ATTACK" || move === "HEAVY_ATTACK" || move === "SPECIAL") {
      // element-flavored particle effect, unique per character (fire flicker, shadow smoke,
      // wind streak, earth chunks, trickster sparkle, discipline ring) — color from c.colors.
      burst = document.createElement("div");
      burst.className = `burst elem-${c.element}${move === "SPECIAL" ? " burst-big" : ""}`;
      burst.style.setProperty("--elem-color", c.colors.primary);
      burst.style.setProperty("--elem-accent", c.colors.accent);
    }
  }
  const swatch = document.createElement("div");
  swatch.className = "swatch";
  const portrait = document.createElement("div");
  portrait.className = "portrait";
  paintPortrait(portrait, c);
  swatch.appendChild(portrait);
  if (burst) swatch.appendChild(burst);
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = agent.name;
  const hpRow = document.createElement("div");
  hpRow.className = "hpbar-row";
  const hpLabel = document.createElement("span");
  hpLabel.textContent = "HP";
  const hpValue = document.createElement("span");
  hpValue.className = "hp-value";
  hpValue.textContent = `${Math.max(0, agent.hp)}/${agent.maxHp}`;
  hpRow.append(hpLabel, hpValue);
  const hpbar = document.createElement("div");
  hpbar.className = "hpbar";
  const fill = document.createElement("div");
  const pct = Math.max(0, (agent.hp / agent.maxHp) * 100);
  fill.className = "hpbar-fill" + (pct < 30 ? " low" : "");
  fill.style.width = `${pct}%`;
  hpbar.appendChild(fill);
  div.append(swatch, name, hpRow, hpbar);
  return div;
}

function renderBattle() {
  const wrap = document.createElement("div");

  const h1 = document.createElement("h1");
  h1.textContent = "Soul Link";
  wrap.appendChild(h1);

  const status = document.createElement("p");
  status.className = "status";
  status.textContent = state.busy
    ? "Thinking..."
    : state.match.agentA.hp <= 0 || state.match.agentB.hp <= 0
    ? "Match over."
    : "";
  wrap.appendChild(status);

  const arena = document.createElement("div");
  arena.className = "arena";
  // Stage follows agentA, same convention classic fighters use for whoever's "home" slot.
  arena.appendChild(stageBackground(getCharacter(state.match.agentA.id).stage));
  const vs = document.createElement("div");
  vs.className = "vs";
  vs.textContent = "VS";
  arena.append(fighterBlock("agentA"), vs, fighterBlock("agentB"));
  wrap.appendChild(arena);

  const taunt = document.createElement("div");
  taunt.className = "taunt";
  if (state.lastTurn) taunt.classList.add(`impact-${state.lastTurn.move.toLowerCase()}`);
  taunt.style.setProperty(
    "--accent",
    state.lastTurn ? getCharacter(state.match[state.lastTurn.actor].id).colors.primary : "#ff6b35"
  );
  if (state.lastTurn) {
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = `${state.match[state.lastTurn.actor].name}:`;
    taunt.appendChild(who);
    taunt.append(`"${state.lastTurn.taunt}" (${state.lastTurn.move})`);
  } else {
    taunt.textContent = "The fight is about to begin.";
  }
  wrap.appendChild(taunt);

  const memory = document.createElement("div");
  memory.className = "memory";
  const h3 = document.createElement("h3");
  h3.textContent = "Memory";
  memory.appendChild(h3);
  const facts = state.lastTurn?.memoryUsed || [];
  if (facts.length === 0) {
    const p = document.createElement("p");
    p.style.margin = "0";
    p.textContent = "No prior history between these two — yet.";
    memory.appendChild(p);
  } else {
    const ul = document.createElement("ul");
    for (const f of facts) {
      const li = document.createElement("li");
      li.textContent = f;
      ul.appendChild(li);
    }
    memory.appendChild(ul);
  }
  wrap.appendChild(memory);

  const matchOver = state.match.agentA.hp <= 0 || state.match.agentB.hp <= 0;

  if (!matchOver) {
    const nextBtn = document.createElement("button");
    nextBtn.className = "primary";
    nextBtn.textContent = state.busy ? "..." : "Next turn";
    nextBtn.disabled = state.busy;
    nextBtn.onclick = () => runTurn();
    wrap.appendChild(nextBtn);

    const autoLabel = document.createElement("label");
    autoLabel.style.marginLeft = "12px";
    autoLabel.style.fontSize = "13px";
    autoLabel.style.color = "#a89c8a";
    const autoCheck = document.createElement("input");
    autoCheck.type = "checkbox";
    autoCheck.checked = state.autoplay;
    autoCheck.style.marginRight = "6px";
    autoCheck.onchange = () => {
      state.autoplay = autoCheck.checked;
      if (state.autoplay && !state.busy) runTurn();
    };
    autoLabel.append(autoCheck, "Auto-play");
    wrap.appendChild(autoLabel);
  } else {
    const winnerKey = state.match.agentA.hp <= 0 ? "agentB" : "agentA";
    const result = document.createElement("p");
    result.className = "status";
    result.textContent = `${state.match[winnerKey].name} wins.`;
    wrap.appendChild(result);
    if (!state.wonSpoken) {
      state.wonSpoken = true;
      const winner = getCharacter(state.match[winnerKey].id);
      speak(winner.lines.win, winner.voiceId);
    }
  }

  const backBtn = document.createElement("button");
  backBtn.className = "ghost";
  backBtn.textContent = "New match";
  backBtn.onclick = () => {
    state.screen = "select";
    state.matchId = null;
    state.match = null;
    state.lastTurn = null;
    state.autoplay = false;
    render();
  };
  wrap.appendChild(backBtn);

  return wrap;
}

async function runTurn() {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    const res = await playTurn(state.matchId);
    state.match = res.state;
    state.lastTurn = res;
    const actorChar = getCharacter(state.match[res.actor].id);
    speak(res.taunt, actorChar.voiceId); // no-op if voiceId is unset
  } catch (e) {
    state.error = e.message;
    state.autoplay = false;
  } finally {
    state.busy = false;
    render();
    if (state.autoplay && state.match.agentA.hp > 0 && state.match.agentB.hp > 0) {
      setTimeout(runTurn, 600);
    }
  }
}

render();
