const DEFAULT_SECRET_KEYS = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "CUSTODIAL_READONLY_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "JWT_SECRET",
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PRIVATE_KEY",
];

const SECRET_VALUE_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
];

function mask(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (text.length <= 8) return "[redacted]";
  return `${text.slice(0, 3)}...[redacted]...${text.slice(-3)}`;
}

function keyLooksSecret(key) {
  const normalized = String(key || "").toUpperCase();
  return DEFAULT_SECRET_KEYS.some((secretKey) => normalized.includes(secretKey));
}

function redactSecretValue(value) {
  if (value == null) return value;

  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return mask(value);
  }

  return "[redacted]";
}

export function redactSecrets(value, seen = new WeakSet()) {
  if (value == null) return value;

  if (typeof value === "string") {
    return SECRET_VALUE_PATTERNS.reduce(
      (current, pattern) => current.replace(pattern, "[redacted]"),
      value
    );
  }

  if (typeof value !== "object") return value;

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen));
  }

  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = keyLooksSecret(key) ? redactSecretValue(item) : redactSecrets(item, seen);
  }
  return redacted;
}

export function redactError(error) {
  return redactSecrets({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
    status: error?.status || null,
    code: error?.code || null,
  });
}
