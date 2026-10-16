// ids must match the SOULS dict keys in backend/main.py exactly — that's the only link
// between this roster and what the backend actually simulates.
export const CHARACTERS = [
  {
    id: "soul_a",
    name: "Kaito Blaze",
    tagline: "Hot-headed fire swordsman",
    colors: { primary: "#FF6B35", dark: "#3A0F0A", accent: "#C7441B" },
    voiceId: "", // fill in from ElevenLabs Voice Library
    element: "fire",
    stage: "desert",
  },
  {
    id: "soul_b",
    name: "Rei Shadowfang",
    tagline: "Cold, calculating shadow assassin",
    colors: { primary: "#5B8DB8", dark: "#13293D", accent: "#5DCAA5" },
    voiceId: "",
    element: "shadow",
    stage: "blizzard",
  },
  {
    id: "soul_c",
    name: "Rin Tempest",
    tagline: "Playful speed-type ninja",
    colors: { primary: "#7FDBFF", dark: "#1B4F5C", accent: "#C7F3FF" },
    voiceId: "",
    element: "wind",
    stage: "tropical",
  },
  {
    id: "soul_d",
    name: "Dorn Ironhide",
    tagline: "Silent, towering brawler",
    colors: { primary: "#8A6F52", dark: "#2B2118", accent: "#C9A36B" },
    voiceId: "",
    element: "earth",
    stage: "village",
  },
  {
    id: "soul_e",
    name: "Suzu Nightfox",
    tagline: "Mischievous kitsune trickster",
    colors: { primary: "#B968C7", dark: "#3D1F45", accent: "#E6A8F0" },
    voiceId: "",
    element: "trickster",
    stage: "shrine",
  },
  {
    id: "soul_f",
    name: "Varek Stonewill",
    tagline: "Composed, disciplined mentor",
    colors: { primary: "#7A8B6F", dark: "#2E3A28", accent: "#B7C9A8" },
    voiceId: "",
    element: "discipline",
    stage: "dojo",
  },
];

export function getCharacter(id) {
  return CHARACTERS.find((c) => c.id === id);
}
