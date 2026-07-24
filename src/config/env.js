import { getGeminiDiagnostics } from "../utils/gemini-config.js";
import { redactSecrets } from "../utils/redact-secrets.js";

function read(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function readCsv(name, fallback = "") {
  return read(name, fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function present(name) {
  return Boolean(read(name));
}

function firebaseServiceAccountConfigured() {
  const raw = read("FIREBASE_SERVICE_ACCOUNT_JSON") || read("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) return false;
  const candidates = [raw];
  try { candidates.push(Buffer.from(raw, "base64").toString("utf8")); } catch {}
  return candidates.some((candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return Boolean(parsed?.client_email && parsed?.private_key && (parsed?.project_id || read("FIREBASE_PROJECT_ID")));
    } catch {
      return false;
    }
  });
}

export function getRuntimeEnv() {
  const githubRepo = read("GITHUB_REPO");
  const githubAllowedRepos = readCsv("GITHUB_ALLOWED_REPOS", githubRepo);
  const gemini = getGeminiDiagnostics({ preferred: ["MEMPHIS_GEMINI_API_KEY"], model: read("MEMPHIS_GEMINI_MODEL", read("GEMINI_MODEL", "gemini-2.5-flash")) });

  return {
    app: {
      node_env: read("NODE_ENV", "development"),
      port: read("PORT", "3000"),
      app_name: read("APP_NAME", "Memphis Zoo MCP"),
    },
    github: {
      owner: read("GITHUB_OWNER"),
      repo: githubRepo,
      allowed_repos: githubAllowedRepos,
      branch: read("GITHUB_BRANCH", "main"),
      token_present: present("GITHUB_TOKEN") || present("GH_TOKEN"),
    },
    supabase: {
      url_present: present("SUPABASE_URL"),
      service_role_key_present: present("SUPABASE_SERVICE_ROLE_KEY"),
      configured: present("SUPABASE_URL") && present("SUPABASE_SERVICE_ROLE_KEY"),
    },
    ai: {
      gemini_configured: gemini.gemini_configured,
      gemini_key_source: gemini.gemini_key_source,
      model: gemini.memphis_model,
    },
    notifications: {
      firebase_configured: firebaseServiceAccountConfigured(),
      firebase_project_id_present: present("FIREBASE_PROJECT_ID")
        || present("FIREBASE_SERVICE_ACCOUNT_JSON")
        || present("GOOGLE_SERVICE_ACCOUNT_JSON"),
      employee_worker_enabled: read("EMPLOYEE_NOTIFICATION_SWEEP_MS", "15000") !== "0",
    },
  };
}

export function validateRuntimeEnv({ strict = false } = {}) {
  const env = getRuntimeEnv();
  const warnings = [];
  const errors = [];

  if (!env.github.owner) errors.push("GITHUB_OWNER is missing.");
  if (!env.github.repo) errors.push("GITHUB_REPO is missing.");
  if (!env.github.token_present) errors.push("GITHUB_TOKEN or GH_TOKEN is missing.");
  if (!env.supabase.url_present) errors.push("SUPABASE_URL is missing.");
  if (!env.supabase.service_role_key_present) errors.push("SUPABASE_SERVICE_ROLE_KEY is missing.");

  if (!env.ai.gemini_configured) {
    warnings.push("GEMINI_API_KEY or GOOGLE_API_KEY is missing. Memphis AI will use fallback replies.");
  }
  if (!env.notifications.firebase_configured) {
    const message = "FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON is missing. Native manager and employee notifications cannot be delivered.";
    if (strict && env.app.node_env === "production") errors.push(message);
    else warnings.push(message);
  }

  if (!strict && errors.length) {
    warnings.push(...errors.map((error) => `Non-strict env validation: ${error}`));
    errors.length = 0;
  }

  return {
    ok: errors.length === 0,
    strict,
    errors,
    warnings,
    env,
    redacted_env: redactSecrets(env),
  };
}
