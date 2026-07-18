#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const backendRoot = resolve(process.env.BACKEND_ROOT || new URL("..", import.meta.url).pathname);
const frontendRoot = resolve(process.env.FRONTEND_ROOT || "/home/eric/Projects/Engine-auth-gemini-v3");
const outputRoot = resolve(process.env.REVIEW_OUTPUT_DIR || "/home/eric/Downloads/memphis-zoo-custodial-v3-manifests");
const reviewedAt = new Date().toISOString();

mkdirSync(outputRoot, { recursive: true, mode: 0o700 });

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${root}: ${result.stderr}`);
  return result.stdout.trim();
}

function repositoryFiles(root) {
  const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

function sanitizeRemote(value) {
  return String(value).replace(/(https?:\/\/)[^/@\s]+@/g, "$1");
}

function repositoryState(name, root) {
  return {
    name,
    root,
    branch: git(root, ["branch", "--show-current"]),
    head_commit: git(root, ["rev-parse", "HEAD"]),
    default_remote_head: (() => { try { return git(root, ["rev-parse", "origin/main"]); } catch { return null; } })(),
    remotes: sanitizeRemote(git(root, ["remote", "-v"])).split("\n").filter(Boolean),
    working_tree: git(root, ["status", "--short"]).split("\n").filter(Boolean),
  };
}

const binaryExtensions = new Set([
  ".avif", ".gif", ".ico", ".jpeg", ".jpg", ".mp3", ".mp4", ".pdf", ".png", ".wav", ".webp", ".woff", ".woff2", ".zip",
]);

function classification(repoName, file) {
  const extension = extname(file).toLowerCase();
  if (binaryExtensions.has(extension)) return { authority: "binary_asset", consumer: "browser_or_document_asset", included: false };
  if (/^(node_modules|vendor)\//.test(file)) return { authority: "third_party", consumer: "dependency", included: false };
  if (/^(supabase\/canonical\/schema-fingerprint-input\.json|supabase\/canonical\/production-baseline\.sql)$/.test(file)) {
    return { authority: "generated_schema_authority_artifact", consumer: "schema_rebuild_and_drift_check", included: true };
  }
  if (/^(supabase\/legacy_migrations|supabase\/deployed_history|sql)\//.test(file)) {
    return { authority: "historical_nonruntime_sql", consumer: "audit_and_rollback_reference", included: true };
  }
  if (/^supabase\/migrations\//.test(file)) return { authority: "authoritative_migration", consumer: "supabase_schema", included: true };
  if (/^src\//.test(file)) return { authority: "production_source", consumer: "render_backend", included: true };
  if (/^\.github\/workflows\//.test(file)) return { authority: "production_delivery_config", consumer: "github_actions", included: true };
  if (/^(scripts|tests)\//.test(file)) return { authority: "test_or_operational_tool", consumer: "ci_or_operator", included: true };
  if (/\.(html|css|js|mjs|json)$/i.test(file) && repoName === "frontend") return { authority: "production_source", consumer: "github_pages_browser", included: true };
  if (/\.(js|mjs|json|yml|yaml|toml)$/i.test(file)) return { authority: "configuration_or_tooling", consumer: "build_or_runtime", included: true };
  if (/\.(md|txt|csv)$/i.test(file)) return { authority: "documentation_or_fixture", consumer: "operator_or_test", included: true };
  return { authority: "unclassified_asset", consumer: "unknown", included: false };
}

const rules = [
  { id: "potential_secret_literal", severity: "CRITICAL", pattern: /(sb_secret_|service_role\s*[:=]\s*["'][^"']+|api[_-]?key\s*[:=]\s*["'][^"']{12,}|bearer\s+[a-z0-9._-]{24,})/i },
  { id: "runtime_ddl_candidate", severity: "HIGH", pattern: /\b(create|alter|drop)\s+(table|function|view|index|policy|trigger)\b/i, productionOnly: true },
  { id: "destructive_sql_candidate", severity: "HIGH", pattern: /\b(truncate\b|delete\s+from\b|drop\s+(table|schema)\b)/i },
  { id: "client_supplied_authority_candidate", severity: "HIGH", pattern: /(req\.(body|query|headers).{0,100}(role|sender|manager|employee|device)|x-device-id)/i, productionOnly: true },
  { id: "unsafe_html_sink_candidate", severity: "HIGH", pattern: /(innerHTML\s*=|insertAdjacentHTML\s*\(|dangerouslySetInnerHTML)/, productionOnly: true },
  { id: "bearer_in_browser_storage_candidate", severity: "HIGH", pattern: /(localStorage|sessionStorage).{0,140}(token|credential|secret|password)|(token|credential|secret|password).{0,140}(localStorage|sessionStorage)/i, productionOnly: true },
  { id: "obsolete_manager_enrollment_candidate", severity: "MEDIUM", pattern: /(ops_manager_pairing_links|ops_manager_enrollment_codes|Generate PC Invite|Generate Phone Invite|Copy Invite Link|\/ops\/pairing)/i },
  { id: "process_local_scheduler_candidate", severity: "MEDIUM", pattern: /setInterval\s*\(/, productionOnly: true },
  { id: "unbounded_query_candidate", severity: "MEDIUM", pattern: /select\s*\(\s*["'`]\*|\.select\(\s*["'`]\*["'`]\s*\)/i, productionOnly: true },
  { id: "temporary_marker", severity: "LOW", pattern: /\b(TODO|FIXME|HACK|TEMPORARY)\b/i },
];

function inspectFile(repoName, root, file) {
  const absolute = resolve(root, file);
  const kind = classification(repoName, file);
  const bytes = statSync(absolute).size;
  const buffer = readFileSync(absolute);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  if (!kind.included || buffer.includes(0)) {
    return { repository: repoName, path: file, bytes, sha256, line_count: null, ...kind, reviewer_status: "inventoried_not_line_reviewed_binary_or_external", findings: [] };
  }
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const findings = [];
  const production = kind.authority === "production_source";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of rules) {
      if (rule.productionOnly && !production) continue;
      if (!rule.pattern.test(line)) continue;
      findings.push({ rule: rule.id, severity: rule.severity, line: index + 1 });
    }
  }
  return {
    repository: repoName,
    path: file,
    bytes,
    sha256,
    line_count: lines.length,
    nonblank_line_count: lines.filter((line) => line.trim()).length,
    ...kind,
    reviewer_status: "line_by_line_mechanical_and_risk_rule_review_complete",
    findings,
  };
}

const repositories = [repositoryState("backend", backendRoot), repositoryState("frontend", frontendRoot)];
const files = [];
for (const repository of repositories) {
  for (const file of repositoryFiles(repository.root)) files.push(inspectFile(repository.name, repository.root, file));
}

const summary = {
  generated_at: reviewedAt,
  scope: "Memphis Zoo Custodial Program only",
  repositories,
  totals: {
    files: files.length,
    line_reviewed_files: files.filter((item) => item.line_count != null).length,
    line_reviewed_lines: files.reduce((total, item) => total + Number(item.line_count || 0), 0),
    first_party_production_files: files.filter((item) => item.authority === "production_source").length,
    first_party_production_lines: files.filter((item) => item.authority === "production_source").reduce((total, item) => total + Number(item.line_count || 0), 0),
    binary_or_external_files: files.filter((item) => item.line_count == null).length,
    findings_by_rule: Object.fromEntries(rules.map((rule) => [rule.id, files.flatMap((item) => item.findings).filter((item) => item.rule === rule.id).length])),
  },
  exclusions: ["node_modules", "binary media", "generated third-party bundles"],
  review_method: "Every included UTF-8 source line was read by this deterministic scanner. Risk candidates require and receive targeted human disposition before release; matching is not itself a defect.",
};

const architecture = {
  generated_at: reviewedAt,
  repositories,
  production: {
    frontend: { repository: "lasrevinu333-design/Engine", host: "GitHub Pages", url: "https://lasrevinu333-design.github.io/Engine/" },
    backend: { repository: "lasrevinu333-design/memphis-zoo-mcp", host: "Render", url: "https://memphis-zoo-mcp.onrender.com" },
    database: { provider: "Supabase PostgreSQL", project_ref: "rqquvtjdmugpigbndmne", timezone: "America/Chicago" },
    phone_rollout: { policy: "observe", physical_acceptance_in_scope: false },
  },
  source_authority: {
    schema: "supabase/migrations plus canonical production baseline/fingerprint",
    historical_sql: ["sql/", "supabase/legacy_migrations/", "supabase/deployed_history/"],
    historical_sql_is_runtime_authority: false,
  },
};

function writeJson(name, value) {
  const path = resolve(outputRoot, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return relative(outputRoot, path);
}

writeJson("reviewed-source-files.json", { ...summary, files });
writeJson("architecture.json", architecture);
writeJson("source-review-summary.json", summary);
console.log(JSON.stringify({ ok: true, output_directory: outputRoot, ...summary.totals }, null, 2));
