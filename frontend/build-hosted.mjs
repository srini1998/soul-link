// Build the game for public hosting (served by the backend at /play on Daytona).
// The ElevenLabs key is blanked so it never ships to browsers; voices go through the backend /tts proxy.
import { build } from "vite";

process.env.VITE_ELEVENLABS_API_KEY = "";
process.env.VITE_BACKEND_URL ||= "https://8000-6c0b6acf-cf6e-44bf-84e2-425d59658513.daytonaproxy01.net";
await build({ base: "./", build: { outDir: "dist-hosted", emptyOutDir: true } });
