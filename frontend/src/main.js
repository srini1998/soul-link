import "./style.css";
import { CHARACTERS, getCharacter } from "./characters.js";
import { startMatch, playTurn } from "./api.js";
import { speak, announce } from "./voice.js";
import { startMusic, stopMusic, isMusicOn } from "./music.js";
import { CHARACTER_ART } from "./art/index.js";

// Renders a character's portrait SVG into `el`, cropped to fill it (preserveAspectRatio set
// programmatically since the source SVGs only declare width="100%"). Falls back to the old
// color-swatch gradient if art for an id is ever missing.
function paintPortrait(el, c, fit = "slice") {
  const markup = CHARACTER_ART[c.id];
  if (!markup) {
    el.style.background = `linear-gradient(135deg, ${c.colors.primary}, ${c.colors.dark})`;
    return;
  }
  el.innerHTML = markup;
  const svg = el.querySelector("svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", `xMidYMax ${fit}`);
  svg.style.display = "block";
}

const app = document.getElementById("app");

const musicBtn = document.createElement("button");
musicBtn.className = "music-toggle";
const syncMusicBtn = () => (musicBtn.textContent = isMusicOn() ? "♪ MUSIC: ON" : "♪ MUSIC: OFF");
musicBtn.onclick = () => { isMusicOn() ? stopMusic() : startMusic(); syncMusicBtn(); };
syncMusicBtn();
document.body.appendChild(musicBtn);

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
  // client-side announcer bookkeeping (see processTurnFx); reset whenever lastTurn is null
  fx: { seen: null, fresh: false, turns: 0, firstBlood: false, streak: { agentA: 0, agentB: 0 }, banner: null },
};

const ATTACKS = ["LIGHT_ATTACK", "HEAVY_ATTACK", "SPECIAL"];
const MOVE_CALLOUT = {
  LIGHT_ATTACK: "LIGHT ATTACK!",
  HEAVY_ATTACK: "HEAVY ATTACK!",
  SPECIAL: "SPECIAL!",
  BLOCK: "BLOCK!",
  DODGE: "DODGE!",
};
const STREAK_BANNERS = { 2: "DOUBLE HIT!", 3: "MULTI HIT!", 4: "RAMPAGE!", 5: "UNSTOPPABLE!" };

// Called from renderBattle on every render; does work only once per new turn object, so the
// "Thinking..." re-render doesn't replay callouts. Streaks count only the actor's own turns.
function processTurnFx() {
  const fx = state.fx;
  const t = state.lastTurn;
  if (!t) {
    state.fx = { seen: null, fresh: false, turns: 0, firstBlood: false, streak: { agentA: 0, agentB: 0 }, banner: null };
    return;
  }
  if (fx.seen === t) {
    fx.fresh = false;
    return;
  }
  fx.seen = t;
  fx.fresh = true;
  fx.turns += 1;
  fx.banner = null;
  const hit = t.damageDealt > 0;
  fx.streak[t.actor] = hit ? fx.streak[t.actor] + 1 : 0;
  if (fx.turns === 1 && t.memoryUsed && t.memoryUsed.length) fx.banner = "GRUDGE MATCH!";
  if (hit && fx.streak[t.actor] >= 2) fx.banner = STREAK_BANNERS[fx.streak[t.actor]] || "GODLIKE!";
  if (t.move === "SPECIAL" && t.damageDealt >= 28) fx.banner = "MASSIVE!";
  if (hit && !fx.firstBlood) {
    fx.firstBlood = true;
    fx.banner = "FIRST BLOOD!";
  }
}

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
    const slot = state.pickA === c.id ? "P1" : state.pickB === c.id ? "P2" : null;
    if (slot) card.dataset.slot = slot;
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    const portrait = document.createElement("div");
    portrait.className = "portrait";
    paintPortrait(portrait, c, "meet"); // full body on the select screen, not a cropped torso
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
      state.koShown = false;
      state.splatter = null;
      state.splatterShown = false;
      state.screen = "battle";
      render();
      startMusic(); // Start click is a user gesture, so the browser lets audio begin
      syncMusicBtn();
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

// Blood burst from the K.O.'d fighter: droplets fly out and arc down, splats stay on the floor.
// Random spread is generated once per match (stored in state) so re-renders don't reshuffle it.
function bloodSplatter(loserKey) {
  if (!state.splatter || state.splatter.key !== loserKey) {
    const r = (a, b) => a + Math.random() * (b - a);
    state.splatter = {
      key: loserKey,
      drops: Array.from({ length: 26 }, () => ({
        dx: r(-190, 190), dy: r(-170, -20), size: r(5, 15), delay: r(0, 0.25), dur: r(0.7, 1.2),
      })),
      splats: Array.from({ length: 9 }, () => ({ x: r(-150, 150), w: r(14, 46), delay: r(0.7, 1.3) })),
    };
  }
  const box = document.createElement("div");
  box.className = `blood blood-${loserKey}`;
  for (const d of state.splatter.drops) {
    const drop = document.createElement("span");
    drop.className = "blood-drop";
    drop.style.cssText = `--dx:${d.dx}px;--dy:${d.dy}px;--s:${d.size}px;animation-delay:${d.delay}s;animation-duration:${d.dur}s`;
    box.appendChild(drop);
  }
  for (const sp of state.splatter.splats) {
    const splat = document.createElement("span");
    splat.className = "blood-splat";
    splat.style.cssText = `--x:${sp.x}px;--w:${sp.w}px;animation-delay:${sp.delay}s`;
    box.appendChild(splat);
  }
  if (state.koShown && state.splatterShown) box.classList.add("blood-static");
  state.splatterShown = true;
  return box;
}

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

// Top HUD strip: both HP bars side by side above the arena, classic fighting-game layout.
// agentB's fill is anchored to the right (margin-left: auto) so it depletes "inward" toward
// the VS badge, mirroring agentA's — the standard two-bars-pointing-at-each-other look.
function hudSide(key) {
  const agent = state.match[key];
  const c = getCharacter(agent.id);
  const side = document.createElement("div");
  side.className = `hud-side hud-${key}`;
  const nameRow = document.createElement("div");
  nameRow.className = "hud-name";
  nameRow.textContent = agent.name;
  const track = document.createElement("div");
  track.className = "hud-hp-track";
  const fill = document.createElement("div");
  const pct = Math.max(0, (agent.hp / agent.maxHp) * 100);
  fill.className = "hud-hp-fill" + (pct < 30 ? " low" : "");
  fill.style.width = `${pct}%`;
  fill.style.setProperty("--fill-color", c.colors.primary);
  track.appendChild(fill);
  const value = document.createElement("div");
  value.className = "hud-hp-value";
  value.textContent = `${Math.max(0, agent.hp)}/${agent.maxHp}`;
  side.append(nameRow, track, value);
  return side;
}

function fighterBlock(key) {
  const agent = state.match[key];
  const c = getCharacter(agent.id);
  const div = document.createElement("div");
  div.className = `fighter fighter-${key}`;
  const end = state.lastTurn?.done ? state.lastTurn : null;
  if (end && end.winner && end.winner !== key) {
    // K.O.: the loser topples to the ground. Animate once, then stay lying down on later re-renders.
    div.classList.add("ko");
    if (state.koShown) div.classList.add("ko-static");
    state.koShown = true;
  }
  if (state.lastTurn && state.lastTurn.actor !== key && state.lastTurn.damageDealt > 0) {
    div.classList.add("hit");
    div.style.setProperty("--shake", state.lastTurn.move === "HEAVY_ATTACK" ? "10px" : "6px");
  }
  let burst = null;
  if (state.lastTurn && state.lastTurn.actor === key) {
    // one class per move type so each gets its own choreography (see style.css) — applied to
    // the whole fighter block so it works on whatever art is in .portrait, old or full-body.
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
  const portrait = document.createElement("div");
  portrait.className = "portrait";
  paintPortrait(portrait, c);
  div.appendChild(portrait);
  if (burst) div.appendChild(burst);
  const t = state.lastTurn;
  if (t && state.fx.fresh) {
    if (t.actor === key) {
      const callout = document.createElement("div");
      callout.className = `callout callout-${key}`;
      callout.textContent = MOVE_CALLOUT[t.move] || `${t.move.replace(/_/g, " ")}!`;
      div.appendChild(callout);
    } else if (ATTACKS.includes(t.move)) {
      const dmg = document.createElement("div");
      dmg.className = "dmg-float" + (t.damageDealt > 0 ? "" : " miss");
      dmg.textContent = t.damageDealt > 0 ? `-${t.damageDealt}` : "MISS";
      div.appendChild(dmg);
    }
  }
  return div;
}

function renderBattle() {
  processTurnFx();
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

  // Classic fighting-game HUD: both HP bars pinned at the top, pointing at each other,
  // with a VS badge between them — not tucked under each character's own card.
  const hud = document.createElement("div");
  hud.className = "battle-hud";
  const vsBadge = document.createElement("div");
  vsBadge.className = "hud-vs";
  vsBadge.textContent = "VS";
  hud.append(hudSide("agentA"), vsBadge, hudSide("agentB"));
  wrap.appendChild(hud);

  const arena = document.createElement("div");
  arena.className = "arena";
  // Stage follows agentA, same convention classic fighters use for whoever's "home" slot.
  arena.appendChild(stageBackground(getCharacter(state.match.agentA.id).stage));
  arena.append(fighterBlock("agentA"), fighterBlock("agentB"));
  if (state.lastTurn?.done && state.lastTurn.winner) {
    arena.appendChild(bloodSplatter(state.lastTurn.winner === "agentA" ? "agentB" : "agentA"));
  }
  if (state.lastTurn?.done) {
    const w = state.lastTurn.winner;
    const v = document.createElement("div");
    v.className = "victory";
    const title = document.createElement("div");
    title.className = "victory-title";
    title.textContent = w ? `${state.match[w].name} wins` : "Draw";
    v.appendChild(title);
    if (w && state.match[w].hp >= state.match[w].maxHp) {
      const sub = document.createElement("div");
      sub.className = "victory-sub";
      sub.textContent = "Flawless victory";
      v.appendChild(sub);
    }
    arena.appendChild(v);
  }
  if (state.fx.fresh && state.fx.banner) {
    const banner = document.createElement("div");
    banner.className = "announcer";
    banner.textContent = state.fx.banner;
    arena.appendChild(banner);
  }
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
    who.textContent = `${state.match[state.lastTurn.actor].name.toUpperCase()}:`;
    taunt.append(`"${state.lastTurn.taunt}"`);
  } else {
    taunt.textContent = "The fight is about to begin.";
  }
  wrap.appendChild(taunt);

  const memory = document.createElement("div");
  memory.className = "memory";
  const h3 = document.createElement("h3");
  h3.textContent = "GRUDGES";
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

  const matchOver = !!state.lastTurn?.done;

  if (state.error) {
    const err = document.createElement("p");
    err.className = "error";
    err.style.color = "#ff6b6b";
    err.textContent = `Turn failed: ${state.error}`;
    wrap.appendChild(err);
  }

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
    const winnerKey = state.lastTurn.winner; // null = draw (40-turn limit)
    const result = document.createElement("p");
    result.className = "status";
    result.textContent = winnerKey ? `${state.match[winnerKey].name} wins.` : "DRAW.";
    wrap.appendChild(result);
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
  let spoken = Promise.resolve();
  let res = null;
  try {
    res = await playTurn(state.matchId);
    state.match = res.state;
    state.lastTurn = res;
    state.error = null;
    if (res.done) state.autoplay = false;
  } catch (e) {
    state.error = e.message;
    state.autoplay = false;
  } finally {
    state.busy = false;
    render(); // computes this turn's announcer banner (state.fx)
  }
  if (res) {
    // Voice order: announcer callout (MASSIVE!, FIRST BLOOD!...) -> fighter's taunt -> winner call.
    if (state.fx?.fresh && state.fx.banner) announce(state.fx.banner);
    const actorChar = getCharacter(state.match[res.actor].id);
    spoken = speak(res.taunt, actorChar.voiceId);
    if (res.done && !state.wonSpoken) {
      state.wonSpoken = true;
      const w = res.winner ? state.match[res.winner] : null;
      if (w) {
        announce(`${w.name} wins!${w.hp >= w.maxHp ? " Flawless victory!" : ""}`);
        const winner = getCharacter(w.id);
        spoken = speak(winner.lines.win, winner.voiceId);
      } else {
        spoken = announce("Draw! Nobody wins!");
      }
    }
  }
  if (state.autoplay && !state.lastTurn?.done) {
    // Let the taunt finish before the next turn so voices aren't chopped.
    await spoken;
    await new Promise((r) => setTimeout(r, 400));
    if (state.autoplay && !state.busy && !state.lastTurn?.done && state.matchId) runTurn();
  }
}

render();
