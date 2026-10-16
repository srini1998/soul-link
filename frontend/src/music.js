// Original arena-techno loop synthesized live with Web Audio (no audio files, royalty-free).
// 140 BPM, A minor: four-on-the-floor kick, clap, hats, acid bassline, minor stabs, dark pad.
// Ducks under voice lines (voice.js dispatches "voice:start" / "voice:end" on window).

const BPM = 140;
const STEP = 60 / BPM / 4; // 16th note
const VOLUME = 0.22;
const DUCKED = 0.08;

let ctx = null;
let master = null;
let nextTime = 0;
let step = 0;
let timer = null;
let playing = false;
let noiseBuf = null;

// A minor riff: semitone offsets from A1 (55 Hz), null = rest. Two bars of 16ths.
const BASS = [0, null, 0, 12, null, 0, 10, null, 0, null, 7, null, 0, 12, 10, 7,
              0, null, 0, 12, null, 0, 15, null, 3, null, 3, 15, 5, null, 7, 10];
const STABS = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]]; // Am, F, G, Em (relative to A3)

function hz(semisFromA1) { return 55 * Math.pow(2, semisFromA1 / 12); }

function makeNoise() {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function kick(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(1.0, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.32);
}

function noiseHit(t, { freq, type, dur, vol }) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

function bass(t, semis, accent) {
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(hz(semis), t);
  f.type = "lowpass"; f.Q.value = 14;
  f.frequency.setValueAtTime(accent ? 2600 : 1400, t);
  f.frequency.exponentialRampToValueAtTime(220, t + STEP * 0.95);
  g.gain.setValueAtTime(accent ? 0.42 : 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 0.98);
  o.connect(f).connect(g).connect(master);
  o.start(t); o.stop(t + STEP);
}

function stab(t, chord) {
  for (const n of chord) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "square";
    o.frequency.value = hz(n + 24);
    f.type = "lowpass"; f.frequency.value = 1800;
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(f).connect(g).connect(master);
    o.start(t); o.stop(t + 0.24);
  }
}

function pad(t, chord, dur) {
  for (const n of chord) {
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth"; o.detune.value = det;
      o.frequency.value = hz(n + 24);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.6);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
      o.connect(f).connect(g).connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
}

function scheduleStep(i, t) {
  const s16 = i % 16, bar = Math.floor(i / 16) % 4;
  if (s16 % 4 === 0) kick(t);
  if (s16 === 4 || s16 === 12) noiseHit(t, { freq: 1500, type: "bandpass", dur: 0.16, vol: 0.5 });
  if (s16 % 2 === 1) noiseHit(t, { freq: 8000, type: "highpass", dur: 0.04, vol: 0.18 });
  if (s16 === 14) noiseHit(t, { freq: 7000, type: "highpass", dur: 0.12, vol: 0.14 }); // open hat
  const b = BASS[i % 32];
  if (b !== null) bass(t, b, s16 % 4 === 2);
  if (s16 === 0) pad(t, STABS[bar], STEP * 16);
  if (s16 === 6 || s16 === 10) stab(t, STABS[bar]);
}

function tick() {
  while (nextTime < ctx.currentTime + 0.12) {
    scheduleStep(step, nextTime);
    nextTime += STEP;
    step = (step + 1) % 64;
  }
}

function setVol(v, secs = 0.25) {
  if (!master) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(v, ctx.currentTime, secs / 3);
}

export function startMusic() {
  if (playing) return;
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = makeNoise();
    window.addEventListener("voice:start", () => playing && setVol(DUCKED, 0.15));
    window.addEventListener("voice:end", () => playing && setVol(VOLUME, 0.6));
  }
  ctx.resume();
  playing = true;
  nextTime = ctx.currentTime + 0.05;
  timer = setInterval(tick, 25);
  setVol(VOLUME, 0.8);
}

export function stopMusic() {
  if (!playing) return;
  playing = false;
  setVol(0, 0.3);
  setTimeout(() => { if (!playing) clearInterval(timer); }, 400);
}

export function isMusicOn() { return playing; }
