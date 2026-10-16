// ids must match the SOULS dict keys in backend/main.py exactly — that's the only link
// between this roster and what the backend actually simulates.
export const CHARACTERS = [
  {
    id: "soul_a",
    name: "Kaito Blaze",
    tagline: "Hot-headed fire swordsman",
    colors: { primary: "#FF6B35", dark: "#3A0F0A", accent: "#C7441B" },
    voiceId: "TX3LPaxmHKxFdv7VOQHJ", // ElevenLabs: Liam - Energetic (cocky loudmouth)
    element: "fire",
    stage: "desert",
    lines: {
      intro: "Let's turn up the heat.",
      win: "Burn bright, fade fast. Remember my name.",
      special: "Soul Link... unleashed!",
    },
  },
  {
    id: "soul_b",
    name: "Rei Shadowfang",
    tagline: "Cold, calculating shadow assassin",
    colors: { primary: "#5B8DB8", dark: "#13293D", accent: "#5DCAA5" },
    voiceId: "pFZP5JQG7iQjIQuC4Bku", // ElevenLabs: Lily - Velvety Actress (smug sniper)
    element: "shadow",
    stage: "blizzard",
    lines: {
      intro: "Make your move. I'm already watching.",
      win: "Predictable. As always.",
      special: "You won't see this one coming.",
    },
  },
  {
    id: "soul_c",
    name: "Rin Tempest",
    tagline: "Playful speed-type ninja",
    colors: { primary: "#7FDBFF", dark: "#1B4F5C", accent: "#C7F3FF" },
    voiceId: "FGY2WhTYpPnrIDTdsKH5", // ElevenLabs: Laura - Enthusiast, Quirky Attitude
    element: "wind",
    stage: "tropical",
    lines: {
      intro: "Catch me if you can~",
      win: "Too slow, too slow!",
      special: "Here comes the gust!",
    },
  },
  {
    id: "soul_d",
    name: "Dorn Ironhide",
    tagline: "Silent, towering brawler",
    colors: { primary: "#8A6F52", dark: "#2B2118", accent: "#C9A36B" },
    voiceId: "pNInz6obpgDQGcFmaJgB", // ElevenLabs: Adam - Dominant, Firm (heavy brute)
    element: "earth",
    stage: "village",
    lines: {
      intro: "...Don't blink.",
      win: "Strength speaks.",
      special: "Immovable.",
    },
  },
  {
    id: "soul_e",
    name: "Suzu Nightfox",
    tagline: "Mischievous kitsune trickster",
    colors: { primary: "#B968C7", dark: "#3D1F45", accent: "#E6A8F0" },
    voiceId: "N2lVS1w4EtoT3dr4eOWO", // ElevenLabs: Callum - Husky Trickster
    element: "trickster",
    stage: "shrine",
    lines: {
      intro: "Ooh, this'll be fun~",
      win: "Tricked you again!",
      special: "Guess which way I'll go!",
    },
  },
  {
    id: "soul_f",
    name: "Varek Stonewill",
    tagline: "Composed, disciplined mentor",
    colors: { primary: "#7A8B6F", dark: "#2E3A28", accent: "#B7C9A8" },
    voiceId: "onwK4e9ZLuTAKqWW03F9", // ElevenLabs: Daniel - Steady Broadcaster (cold sensei)
    element: "discipline",
    stage: "dojo",
    lines: {
      intro: "Show me your resolve.",
      win: "Discipline prevails.",
      special: "One strike. That is enough.",
    },
  },
];

export function getCharacter(id) {
  return CHARACTERS.find((c) => c.id === id);
}
