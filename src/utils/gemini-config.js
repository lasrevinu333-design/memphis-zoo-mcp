const COMMON_GEMINI_KEY_ENV_ORDER = [
  "GEMINI_API_KEY",
  "MEMPHIS_GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_API_KEY",
  "EVENTS_GEMINI_API_KEY",
  "SCHEDULE_GEMINI_API_KEY",
];

function normalizePreferred(preferred = []) {
  return Array.isArray(preferred)
    ? preferred.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
}

function candidateEnvNames(preferred = []) {
  return Array.from(new Set([...normalizePreferred(preferred), ...COMMON_GEMINI_KEY_ENV_ORDER]));
}

export function getGeminiKeySource(preferred = []) {
  for (const name of candidateEnvNames(preferred)) {
    if (String(process.env[name] || "").trim()) return name;
  }
  return null;
}

export function getGeminiApiKey(preferred = []) {
  const source = getGeminiKeySource(preferred);
  return source ? String(process.env[source] || "").trim() : "";
}

export function getGeminiDiagnostics({ preferred = [], model = "" } = {}) {
  const gemini_key_source = getGeminiKeySource(preferred);
  return {
    gemini_configured: Boolean(gemini_key_source),
    gemini_key_source,
    memphis_model: String(model || "").trim() || null,
  };
}

export function getGeminiEnvOrder(preferred = []) {
  return candidateEnvNames(preferred);
}
