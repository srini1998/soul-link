// Raw REST call, verified against ElevenLabs' API reference directly (not guessed):
// POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, header xi-api-key,
// body {text, model_id, voice_settings}, 200 response is the audio file as bytes.
const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;

const MODELS = ["eleven_flash_v2_5", "eleven_multilingual_v2"];
// Lower stability + higher style = more dramatic, UT-announcer delivery.
const VOICE_SETTINGS = { stability: 0.3, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true };
// Gritty arena announcer for callouts (FIRST BLOOD!, GODLIKE!). ElevenLabs premade: Harry - Fierce Warrior.
export const ANNOUNCER_VOICE = "SOYHLrjzK2X1ezoPC6cr";
const cache = new Map(); // announcer lines repeat: fetch each once (also eases ElevenLabs rate limits)
const SAFETY_TIMEOUT_MS = 8000;

// Lines play one after another: each speak() waits for the previous line to end.
let queue = Promise.resolve();

// Resolves when the line finishes playing, or right away if it's skipped/fails.
// Never rejects, so callers (autoplay) can always await it.
export function speak(text, voiceId, { broadcast = false, cacheable = false } = {}) {
  const done = queue.then(() => playLine(text, voiceId, broadcast, cacheable)).catch(() => {});
  queue = done;
  return done;
}

async function fetchAudio(text, voiceId) {
  for (const model_id of MODELS) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id, voice_settings: VOICE_SETTINGS }),
    });
    if (res.ok) return res.blob();
    console.warn(`[voice] ElevenLabs ${model_id} failed: ${res.status}`);
  }
  return null;
}

// Announcer callout: cached, played through a "radio broadcast" filter for that arena-PA sound.
export function announce(text) {
  return speak(text, ANNOUNCER_VOICE, { broadcast: true, cacheable: true });
}

let fxCtx = null;
function broadcastChain(audio) {
  try {
    fxCtx = fxCtx || new (window.AudioContext || window.webkitAudioContext)();
    const src = fxCtx.createMediaElementSource(audio);
    const hp = fxCtx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 280;
    const peak = fxCtx.createBiquadFilter(); peak.type = "peaking"; peak.frequency.value = 2400; peak.gain.value = 7;
    const shaper = fxCtx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    const gain = fxCtx.createGain(); gain.gain.value = 0.9;
    src.connect(hp).connect(peak).connect(shaper).connect(gain).connect(fxCtx.destination);
    fxCtx.resume();
  } catch (e) {
    /* plain playback if Web Audio isn't available */
  }
}

async function playLine(text, voiceId, broadcast = false, cacheable = false) {
  if (!API_KEY || !voiceId || !text) {
    console.warn("[voice] skipped — missing API key, voiceId or text");
    return;
  }
  const key = `${voiceId}|${text}`;
  let blob = cacheable ? cache.get(key) : null;
  if (!blob) {
    blob = await fetchAudio(text, voiceId);
    if (!blob) return;
    if (cacheable) cache.set(key, blob);
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  if (broadcast) broadcastChain(audio);
  window.dispatchEvent(new Event("voice:start")); // music.js ducks under voice
  await new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      clearTimeout(timer);
      audio.onended = audio.onerror = audio.onloadedmetadata = null;
      URL.revokeObjectURL(url);
      window.dispatchEvent(new Event("voice:end"));
      resolve();
    };
    audio.onended = finish;
    audio.onerror = finish;
    // Safety net so a stuck clip never hangs autoplay; re-armed once the real duration is known.
    timer = setTimeout(finish, SAFETY_TIMEOUT_MS);
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) {
        clearTimeout(timer);
        timer = setTimeout(finish, audio.duration * 1000 + 1500);
      }
    };
    audio.play().catch(finish); // autoplay can be blocked before first user click
  });
}
