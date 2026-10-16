// Raw REST call, verified against ElevenLabs' API reference directly (not guessed):
// POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}, header xi-api-key,
// body {text, model_id}, 200 response is the audio file as bytes.
const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;

let currentAudio = null;

export async function speak(text, voiceId) {
  if (!API_KEY || !voiceId) {
    console.warn("[voice] skipped — missing API key or voiceId for this character");
    return;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
    }),
  });
  if (!res.ok) {
    console.warn(`[voice] ElevenLabs call failed: ${res.status}`);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  currentAudio = new Audio(url);
  currentAudio.play().catch(() => {}); // autoplay can be blocked before first user click
}
