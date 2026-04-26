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

const SYSTEM_INTENT_PATTERN = /\b(schedule|assigned|assignment|works|working|scheduled|staff|staffing|cover|coverage|candidate|backup|absence|absent|off|open segment|uncovered|unassigned|ticket|maintenance|dashboard|attendance|scan|owner|location|event|events|upcoming|coming up|employee|workload|load|area|group|restroom|aquarium|zambezi|teton|expo|pavilion|clean|cleans|cleaned)\b/i;

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

export function isSystemSpecificQuestion(text = "", threadContext = {}) {
  const raw = String(text || "").trim();
  if (!raw) return false;

  const loose = normalizeLoose(raw);
  if (!loose) return false;

  if (findLocationCode(raw)) return true;
  if (SYSTEM_INTENT_PATTERN.test(raw)) return true;

  const lastSubject = String(threadContext?.last_subject_type || "").toLowerCase();
  const hasOperationalContext = ["group", "location", "employee", "summary"].includes(lastSubject);
  const looksLikeFollowUp = /\b(who|what|where|when|why|how|again|there|that|those|them|it|today|tomorrow|next|this|same)\b/i.test(raw);

  return Boolean(hasOperationalContext && looksLikeFollowUp && raw.length < 120);
}
