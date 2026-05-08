import { normalizeLoose } from "./memphis-ai-utils.js";

const LOCATION_CODE_STOP_WORDS = new Set([
  "WHO",
  "WHAT",
  "WHEN",
  "WHERE",
  "WHY",
  "HOW",
  "HAS",
  "HAVE",
  "HAD",
  "THE",
  "AND",
  "ARE",
  "YOU",
  "YOUR",
  "FOR",
  "FROM",
  "WITH",
  "THIS",
  "THAT",
  "THESE",
  "THOSE",
  "TODAY",
  "TOMORROW",
  "YESTERDAY",
  "NEXT",
  "OPEN",
  "OWNER",
  "SCAN",
  "STATE",
  "TICKET",
  "EVENT",
  "AREA",
  "GROUP",
  "COVER",
  "COVERING",
  "SCHEDULE",
  "ASSIGNED",
  "LOCATION",
  "MEMPHIS",
  "ZOO",
  "MCP",
  "API",
  "AI",
  "GEMINI",
  "RENDER",
  "GITHUB",
]);

const LOCATION_KEYWORD_PATTERN = /\b(aquarium|restroom|restrooms|teton|zambezi|expo|pavilion|event center|event centre|memmex|bonobos|komodos|komodo|herpetarium|primate|cat house|cathouse|nocturnal|east admin|education)\b/i;

const SYSTEM_INTENT_PATTERN = /\b(schedule|assigned|assignment|assignments|works|working|scheduled|staff|staffing|shift|shifts|roster|lineup|line up|on today|on tomorrow|on duty|duty|where am i|where are we|where is everyone|where's everyone|who is where|who's where|who is on|who's on|cover|coverage|candidate|backup|absence|absent|off|open segment|uncovered|unassigned|ticket|maintenance|dashboard|attendance|guests|guest|visitors|visitor|scan|owner|location|event|events|upcoming|coming up|employee|workload|load|area|areas|group|groups|restroom|aquarium|zambezi|teton|expo|pavilion|clean|cleans|cleaned)\b/i;

const LOCAL_SCHEDULE_PHRASE_PATTERN = /\b(my day|my shift|my shifts|my area|my areas|what am i doing|where am i|where do i go|where should i go|am i working|do i work|when do i work|when am i in|who do we have|who all do we have|who is here|who's here|who is in|who's in|who is on|who's on|who works|who's working|who is working|who covers|who has|what areas|which areas|what is open|what's open|need coverage|needs coverage|find coverage|fill coverage|coverage for)\b/i;

const LOCAL_SCHEDULE_CONTEXT_PATTERN = /\b(today|tomorrow|yesterday|this week|next week|sunday|monday|tuesday|wednesday|thursday|friday|saturday|morning|afternoon|tonight|tonite|opening|closing|close|open)\b/i;

function originalTokenLooksUppercaseCode(token) {
  return /[A-Z]/.test(token) && token === token.toUpperCase();
}

function normalizedTokenLooksCode(normalized, original) {
  if (normalized.length < 3 || normalized.length > 8) return false;
  if (LOCATION_CODE_STOP_WORDS.has(normalized)) return false;
  if (/\d/.test(normalized)) return true;
  if (originalTokenLooksUppercaseCode(original)) return true;
  return /^[A-Z]{3,5}[XMWR]$/.test(normalized);
}

export function findLocationCode(text = "") {
  const tokens = String(text || "").match(/\b[A-Za-z][A-Za-z0-9-]{1,9}\b/g) || [];

  for (const token of tokens) {
    const normalized = token.replace(/-/g, "").toUpperCase();
    if (normalizedTokenLooksCode(normalized, token)) return normalized;
  }

  return "";
}

export function hasLocationKeyword(text = "") {
  return LOCATION_KEYWORD_PATTERN.test(String(text || ""));
}

export function isSystemSpecificQuestion(text = "", threadContext = {}) {
  const raw = String(text || "").trim();
  if (!raw) return false;

  const loose = normalizeLoose(raw);
  if (!loose) return false;

  if (findLocationCode(raw) || hasLocationKeyword(raw)) return true;
  if (SYSTEM_INTENT_PATTERN.test(raw)) return true;
  if (LOCAL_SCHEDULE_PHRASE_PATTERN.test(raw)) return true;
  if (LOCAL_SCHEDULE_CONTEXT_PATTERN.test(raw) && /\b(who|what|where|when|which|am i|do i|we have|everyone|anybody|someone|somebody)\b/i.test(raw)) return true;

  const lastSubject = String(threadContext?.last_subject_type || "").toLowerCase();
  const hasOperationalContext = ["group", "location", "employee", "summary"].includes(lastSubject);
  const looksLikeFollowUp = /\b(who|what|where|when|why|how|again|there|that|those|them|it|today|tomorrow|next|this|same|shift|area|coverage|open)\b/i.test(raw);

  return Boolean(hasOperationalContext && looksLikeFollowUp && raw.length < 140);
}
