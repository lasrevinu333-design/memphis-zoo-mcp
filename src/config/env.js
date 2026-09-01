import { getGeminiDiagnostics } from "../utils/gemini-config.js";
import { redactSecrets } from "../utils/redact-secrets.js";
import { getMcpOAuthConfig } from "../auth/mcp-oauth.js";

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
  const mcpOAuth = getMcpOAuthConfig(process.env);

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
      readonly_database_url_present: present("CUSTODIAL_READONLY_DATABASE_URL"),
      configured: present("SUPABASE_URL") && present("SUPABASE_SERVICE_ROLE_KEY"),
    },
    mcp_oauth: {
      enabled: mcpOAuth.enabled,
      ready: mcpOAuth.ready,
      public_url_present: present("MCP_PUBLIC_URL"),
      publishable_key_present: present("SUPABASE_PUBLISHABLE_KEY") || present("SUPABASE_ANON_KEY"),
      cookie_secret_present: present("MCP_OAUTH_COOKIE_SECRET"),
      allowed_subject_count: mcpOAuth.allowedSubjects.size,
      allowed_client_count: mcpOAuth.allowedClientIds.size,
      scopes: [...mcpOAuth.scopes],
    },
    custodial_authority: {
      backend_proof_secret_present: present("CUSTODIAL_BACKEND_PROOF_SECRET"),
      native_route_proof_secret_present: present("CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET"),
      release_canary_device_present: present("CUSTODIAL_RELEASE_CANARY_DEVICE_ID"),
      device_credential_secret_present: present("DEVICE_CREDENTIAL_SECRET"),
    },
    manager_authority: {
      session_secret_present: present("OPS_MANAGER_SESSION_SECRET"),
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
  const mcpOAuth = getMcpOAuthConfig(process.env);
  const warnings = [];
  const errors = [];

  if (!env.github.owner) errors.push("GITHUB_OWNER is missing.");
  if (!env.github.repo) errors.push("GITHUB_REPO is missing.");
  if (!env.github.token_present) errors.push("GITHUB_TOKEN or GH_TOKEN is missing.");
  if (!env.supabase.url_present) errors.push("SUPABASE_URL is missing.");
  if (!env.supabase.service_role_key_present) errors.push("SUPABASE_SERVICE_ROLE_KEY is missing.");
  if (mcpOAuth.enabled && !mcpOAuth.ready) errors.push(...mcpOAuth.errors);

  if (env.app.node_env === "production") {
    if (!env.custodial_authority.backend_proof_secret_present) errors.push("CUSTODIAL_BACKEND_PROOF_SECRET is missing.");
    if (!env.custodial_authority.native_route_proof_secret_present) errors.push("CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET is missing.");
    if (!env.custodial_authority.device_credential_secret_present) errors.push("DEVICE_CREDENTIAL_SECRET is missing.");
    if (!env.supabase.readonly_database_url_present) errors.push("CUSTODIAL_READONLY_DATABASE_URL is missing.");
    if (!env.manager_authority.session_secret_present) errors.push("OPS_MANAGER_SESSION_SECRET is missing.");
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
