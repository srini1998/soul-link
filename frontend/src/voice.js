// Raw REST call, verified against ElevenLabs' API reference directly (not guessed):
// POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, header xi-api-key,
// body {text, model_id, voice_settings}, 200 response is the audio file as bytes.
const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;

const MODELS = ["eleven_flash_v2_5", "eleven_multilingual_v2"];
const VOICE_SETTINGS = { stability: 0.35, similarity_boost: 0.75, style: 0.4 };
const SAFETY_TIMEOUT_MS = 8000;

// Lines play one after another: each speak() waits for the previous line to end.
let queue = Promise.resolve();

// Resolves when the line finishes playing, or right away if it's skipped/fails.
// Never rejects, so callers (autoplay) can always await it.
export function speak(text, voiceId) {
  const done = queue.then(() => playLine(text, voiceId)).catch(() => {});
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

async function playLine(text, voiceId) {
  if (!API_KEY || !voiceId || !text) {
    console.warn("[voice] skipped — missing API key, voiceId or text");
    return;
  }
  const blob = await fetchAudio(text, voiceId);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  await new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      clearTimeout(timer);
      audio.onended = audio.onerror = audio.onloadedmetadata = null;
      URL.revokeObjectURL(url);
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
