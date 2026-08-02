import { getGeminiDiagnostics } from "../utils/gemini-config.js";
import { redactSecrets } from "../utils/redact-secrets.js";
import { parseManagerAttestationPolicy } from "../auth/manager-device-auth-v2-attestation.js";

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

function secretHasMinimumBytes(name, minimum = 32) {
  return Buffer.byteLength(String(process.env[name] ?? ""), "utf8") >= minimum;
}

function truthy(name) {
  return /^(1|true|yes|on)$/i.test(read(name));
}

function managerV2PolicySummary() {
  try {
    const value = parseManagerAttestationPolicy({
      MANAGER_V2_ATTESTATION_POLICY_JSON: read("MANAGER_V2_ATTESTATION_POLICY_JSON"),
    });
    return {
      valid_json: true,
      android_apps: value.androidApps.length,
      ios_apps: value.iosApps.length,
      fingerprint: value.policyFingerprint,
    };
  } catch {
    return { valid_json: false, android_apps: 0, ios_apps: 0, fingerprint: "" };
  }
}

function managerV2DatabaseSummary() {
  const raw = read("SUPABASE_DB_URL", read("DATABASE_URL"));
  if (!raw) return { present: false, valid: false, remote: false };
  try {
    const url = new URL(raw);
    const valid = new Set(["postgres:", "postgresql:"]).has(url.protocol) && Boolean(url.hostname);
    return {
      present: true,
      valid,
      remote: valid && !new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname),
    };
  } catch {
    return { present: true, valid: false, remote: false };
  }
}

export function getRuntimeEnv() {
  const githubRepo = read("GITHUB_REPO");
  const githubAllowedRepos = readCsv("GITHUB_ALLOWED_REPOS", githubRepo);
  const gemini = getGeminiDiagnostics({ preferred: ["MEMPHIS_GEMINI_API_KEY"], model: read("MEMPHIS_GEMINI_MODEL", read("GEMINI_MODEL", "gemini-2.5-flash")) });
  const managerV2Policy = managerV2PolicySummary();
  const managerV2Database = managerV2DatabaseSummary();

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
    manager_device_auth_v2: {
      enabled: truthy("MANAGER_V2_ENABLED"),
      server_secret_configured: secretHasMinimumBytes("MANAGER_V2_SERVER_SECRET"),
      session_secret_configured: [
        "OPS_MANAGER_SESSION_SECRET",
        "GEMINI_ADMIN_SESSION_SECRET",
        "MOXIE_WEB_COOKIE_SECRET",
        "SUPABASE_SERVICE_ROLE_KEY",
      ].some((name) => secretHasMinimumBytes(name)),
      database_url_present: managerV2Database.present,
      database_url_valid: managerV2Database.valid,
      database_ca_required: managerV2Database.remote,
      database_ca_path_present: present("SUPABASE_DB_CA_CERT_PATH"),
      attestation_policy_valid_json: managerV2Policy.valid_json,
      attestation_policy_fingerprint: managerV2Policy.fingerprint,
      android_apps: managerV2Policy.android_apps,
      ios_apps: managerV2Policy.ios_apps,
      google_play_integrity_credentials_present: present("GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON"),
    },
    ai: {
      gemini_configured: gemini.gemini_configured,
      gemini_key_source: gemini.gemini_key_source,
      model: gemini.memphis_model,
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

  if (env.manager_device_auth_v2.enabled) {
    const manager = env.manager_device_auth_v2;
    if (!manager.server_secret_configured) errors.push("MANAGER_V2_SERVER_SECRET must contain at least 32 bytes.");
    if (!manager.session_secret_configured) errors.push("An Ops Manager session secret of at least 32 bytes is required for manager device-auth v2.");
    if (!manager.database_url_present) errors.push("SUPABASE_DB_URL or DATABASE_URL is required for manager device-auth v2.");
    else if (!manager.database_url_valid) errors.push("SUPABASE_DB_URL or DATABASE_URL must be a valid PostgreSQL connection URL for manager device-auth v2.");
    if (manager.database_ca_required && !manager.database_ca_path_present) errors.push("SUPABASE_DB_CA_CERT_PATH is required for remote manager device-auth v2 database connections.");
    if (!manager.attestation_policy_valid_json || (manager.android_apps < 1 && manager.ios_apps < 1)) {
      errors.push("MANAGER_V2_ATTESTATION_POLICY_JSON must configure at least one Android or iOS application.");
    }
    if (manager.android_apps > 0 && !manager.google_play_integrity_credentials_present) {
      errors.push("GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON is required for Android Ops Manager attestation.");
    }
  }

  if (!env.ai.gemini_configured) {
    warnings.push("GEMINI_API_KEY or GOOGLE_API_KEY is missing. Memphis AI will use fallback replies.");
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
