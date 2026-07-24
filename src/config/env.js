import { getGeminiDiagnostics } from "../utils/gemini-config.js";
import { redactSecrets } from "../utils/redact-secrets.js";
import {
  getMcpConnectorToken,
  isMcpFullNoAuthEnabled,
  isMcpReadOnlyNoAuthEnabled,
} from "../auth/mcp-connector-auth.js";

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
    mcp: {
      connector_token_present: Boolean(getMcpConnectorToken(process.env)),
      allow_full_noauth: isMcpFullNoAuthEnabled(process.env),
      allow_readonly_noauth: isMcpReadOnlyNoAuthEnabled(process.env),
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
  };
}

export function validateRuntimeEnv({ strict = false } = {}) {
  const env = getRuntimeEnv();
  const warnings = [];
  const errors = [];
  const productionLike = env.app.node_env.toLowerCase() === "production"
    || /^(1|true|yes|on)$/i.test(read("RENDER", read("IS_RENDER")));

  if (!env.github.owner) errors.push("GITHUB_OWNER is missing.");
  if (!env.github.repo) errors.push("GITHUB_REPO is missing.");
  if (!env.github.token_present) errors.push("GITHUB_TOKEN or GH_TOKEN is missing.");
  if (!env.supabase.url_present) errors.push("SUPABASE_URL is missing.");
  if (!env.supabase.service_role_key_present) errors.push("SUPABASE_SERVICE_ROLE_KEY is missing.");

  if (env.mcp.allow_full_noauth) {
    const message = "MCP_ALLOW_FULL_NOAUTH exposes GitHub mutation and Supabase migration tools without authentication.";
    if (strict || productionLike) errors.push(message);
    else warnings.push(message);
  }

  if (
    !env.mcp.connector_token_present
    && !env.mcp.allow_full_noauth
    && !env.mcp.allow_readonly_noauth
  ) {
    const message = "MCP has no connector token and both tokenless access modes are disabled.";
    if (strict) errors.push(message);
    else warnings.push(message);
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
