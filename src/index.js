import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Octokit } from "octokit";
import { createClient } from "@supabase/supabase-js";
import { createMessagingRouter } from "./messaging-api.js";
import { createScheduleRouter } from "./schedule-api.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const SCAN_RPC_ALLOWLIST = new Set([
  "tool_get_system_settings",
  "tool_list_active_employees",
  "tool_get_location_scan_state",
  "tool_start_session",
  "tool_finish_session",
  "tool_complete_session",
  "tool_ping_device",
  "tool_record_scan_event"
]);

const RELEASE_ID = "release-2026.04.23.1";
const APP_VERSION = RELEASE_ID;
const SCAN_CONTRACT_VERSION = "scan.v1";
const DASHBOARD_CONTRACT_VERSION = "dashboard.v1";
const MESSAGING_CONTRACT_VERSION = "messaging.v1";
const SCHEDULE_CONTRACT_VERSION = "schedule.v1";
const CANARY_RESTROOM_CODE = "TETM";
const CANARY_EXHIBIT_CODE = "TETX";
const CANARY_DEVICE_ID = "canary-check";
const ATTENDANCE_SOURCE_URL = String(process.env.ND_MEMZOO_ATTENDANCE_URL || "https://nd.memzoo.org").trim();
const ATTENDANCE_TIMEOUT_MS = toSafeInt(process.env.ND_MEMZOO_ATTENDANCE_TIMEOUT_MS, 8000);
const ATTENDANCE_CACHE_MS = toSafeInt(process.env.ND_MEMZOO_ATTENDANCE_CACHE_MS, 60000);
const ATTENDANCE_CF_CLEARANCE = String(process.env.ND_MEMZOO_CF_CLEARANCE || "").trim();
let attendanceCache = { data: null, fetched_at_ms: 0 };

function buildHealthPayload(area, extra = {}) {
  return {
    ok: true,
    app: "memphis-zoo-mcp",
    area,
    version: APP_VERSION,
    release_id: RELEASE_ID,
    contracts: {
      scan: SCAN_CONTRACT_VERSION,
      dashboard: DASHBOARD_CONTRACT_VERSION,
      messaging: MESSAGING_CONTRACT_VERSION,
      schedule: SCHEDULE_CONTRACT_VERSION,
    },
    ...extra,
  };
}

function getAllowedGithubRepos(defaultRepo) {
  const raw = process.env.GITHUB_ALLOWED_REPOS || defaultRepo;
  return Array.from(
    new Set(
      String(raw || "")
        .split(",")
        .map((repoName) => repoName.trim())
        .filter(Boolean)
    )
  );
}

function getGithubConfig(targetRepo) {
  const owner = process.env.GITHUB_OWNER;
  const defaultRepo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !defaultRepo || !token) {
    throw new Error("GitHub is not configured. Check GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN in .env.");
  }

  const allowedRepos = getAllowedGithubRepos(defaultRepo);
  const repo = (targetRepo || defaultRepo).trim();

  if (!allowedRepos.includes(repo)) {
    throw new Error(`Repo "${repo}" is not allowed. Allowed repos: ${allowedRepos.join(", ")}`);
  }

  return { owner, repo, defaultRepo, allowedRepos };
}

function getSupabaseConfig() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !supabaseAdmin) {
    throw new Error("Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
  }
  return supabaseAdmin;
}

function normalizeGithubPath(path) {
  return String(path || "").trim().replace(/^\/+/, "");
}

function getGithubErrorDetail(error) {
  if (error?.status) return `status=${error.status} ${error.message}`;
  return error?.message || "Unknown GitHub error";
}

function sanitizeReadOnlySql(sql) {
  const trimmed = String(sql || "").trim();
  const withoutTrailingSemicolons = trimmed.replace(/;\s*$/, "");
  const normalized = withoutTrailingSemicolons.toLowerCase();
  return { sql: withoutTrailingSemicolons, normalized };
}

function getAdminApiKey() {
  return String(process.env.ADMIN_API_KEY || "").trim();
}

function getDashboardClosePin() {
  return String(process.env.DASHBOARD_CLOSE_PIN || "").trim();
}

function normalizeDashboardCloser(value) {
  const normalized = String(value || "").trim();
  return normalized || "Dashboard PIN";
}

function requireDashboardClosePin(req, res, next) {
  const configuredPin = getDashboardClosePin();
  if (!configuredPin) {
    res.status(503).json({ ok: false, error: "DASHBOARD_CLOSE_PIN is not configured on the server." });
    return;
  }

  const providedPin = String(req.body?.pin || "").trim();
  if (!/^\d{4}$/.test(providedPin)) {
    res.status(400).json({ ok: false, error: "A valid 4-digit PIN is required." });
    return;
  }

  if (providedPin !== configuredPin) {
    res.status(401).json({ ok: false, error: "Invalid dashboard PIN." });
    return;
  }

  next();
}

function setAdminApiCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  res.setHeader("Vary", "Origin");
}

function setPublicDashboardCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function setScanApiCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function setMessagingApiCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function setScheduleApiCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  res.setHeader("Vary", "Origin");
}

function requireAdminApiAuth(req, res, next) {
  const configuredKey = getAdminApiKey();
  if (!configuredKey) {
    res.status(503).json({ ok: false, error: "ADMIN_API_KEY is not configured on the server." });
    return;
  }
  const providedKey = String(req.header("x-admin-key") || "").trim();
  if (!providedKey || providedKey !== configuredKey) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  next();
}

async function runRpc(functionName, args = {}) {
  const client = getSupabaseConfig();
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw new Error(error.message || `RPC failed: ${functionName}`);
  return data;
}

function toSafeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toNullableInt(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sqlLiteral(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseAttendanceMetric(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}:\\s*([\\d,]+)`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  const parsed = Number.parseInt(String(match[1]).replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAttendanceHtml(html) {
  const normalized = String(html || "").replace(/\r/g, "");
  const attendanceBlock = normalized.match(/<h5[^>]*>\s*Attendance\s*<\/h5>[\s\S]{0,2500}?<\/div>\s*<\/div>/i);
  const source = attendanceBlock ? attendanceBlock[0] : normalized;
  const currentMatch = source.match(/<h1[^>]*>\s*([\d,]+)\s*<\/h1>/i);
  if (!currentMatch) throw new Error("Attendance card found but current attendance value was not found.");
  const attendance = Number.parseInt(String(currentMatch[1]).replace(/,/g, ""), 10);
  if (!Number.isFinite(attendance) || attendance < 0) throw new Error("Parsed attendance value is invalid.");
  const text = source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    attendance,
    last_year: parseAttendanceMetric(text, "Last Year"),
    planned: parseAttendanceMetric(text, "Planned"),
    yesterday: parseAttendanceMetric(text, "Yesterday"),
    yesterday_plan: parseAttendanceMetric(text, "Yesterday Plan"),
    parse_method: "html_attendance_card",
  };
}

function normalizeAttendanceRecord(row) {
  if (!row) return null;
  const attendance = toNullableInt(row.attendance);
  const lastYear = toNullableInt(row.last_year);
  const planned = toNullableInt(row.planned);
  const yesterday = toNullableInt(row.yesterday);
  const yesterdayPlan = toNullableInt(row.yesterday_plan);
  if (attendance == null && lastYear == null && planned == null && yesterday == null && yesterdayPlan == null) {
    return null;
  }
  return {
    attendance,
    last_year: lastYear,
    planned,
    yesterday,
    yesterday_plan: yesterdayPlan,
    parse_method: row.parse_method || "stored_state",
    source_url: row.source_url || null,
    source: row.source || null,
    content_type: row.content_type || null,
    fetched_at: row.fetched_at || null,
    updated_at: row.updated_at || null,
    cached: false,
    stale: false,
  };
}

async function loadStoredAttendance() {
  const rows = await runReadOnlySql(`
    select attendance, last_year, planned, yesterday, yesterday_plan, source, fetched_at, updated_at
    from public.current_attendance_state
    where id = 1
    limit 1
  `);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return normalizeAttendanceRecord(rows[0]);
}

async function persistAttendanceState(payload = {}) {
  const attendance = toNullableInt(payload.attendance);
  const lastYear = toNullableInt(payload.last_year);
  const planned = toNullableInt(payload.planned);
  const yesterday = toNullableInt(payload.yesterday);
  const yesterdayPlan = toNullableInt(payload.yesterday_plan);
  const source = payload.source == null ? null : String(payload.source);
  const fetchedAt = payload.fetched_at == null ? null : String(payload.fetched_at);

  if (attendance == null) {
    throw new Error("attendance is required and must be an integer.");
  }

  await runWriteSql(
    "attendance_state_upsert",
    `insert into public.current_attendance_state (
       id, attendance, last_year, planned, yesterday, yesterday_plan, source, fetched_at, updated_at
     ) values (
       1,
       ${sqlLiteral(attendance)},
       ${sqlLiteral(lastYear)},
       ${sqlLiteral(planned)},
       ${sqlLiteral(yesterday)},
       ${sqlLiteral(yesterdayPlan)},
       ${sqlLiteral(source)},
       ${fetchedAt ? `${sqlLiteral(fetchedAt)}::timestamptz` : "null"},
       now()
     )
     on conflict (id) do update set
       attendance = excluded.attendance,
       last_year = excluded.last_year,
       planned = excluded.planned,
       yesterday = excluded.yesterday,
       yesterday_plan = excluded.yesterday_plan,
       source = excluded.source,
       fetched_at = excluded.fetched_at,
       updated_at = now();`
  );

  return await loadStoredAttendance();
}

async function fetchCurrentAttendance(options = {}) {
  const now = Date.now();
  if (!options.force && attendanceCache.data && now - attendanceCache.fetched_at_ms < ATTENDANCE_CACHE_MS) {
    return { ...attendanceCache.data, cached: true, stale: false };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTENDANCE_TIMEOUT_MS);

  try {
    const requestHeaders = {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "accept-encoding": "gzip, deflate, br, zstd",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      priority: "u=0, i",
      "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    };

    if (ATTENDANCE_CF_CLEARANCE) {
      requestHeaders.cookie = `cf_clearance=${ATTENDANCE_CF_CLEARANCE}`;
    }

    const response = await fetch(ATTENDANCE_SOURCE_URL, {
      method: "GET",
      signal: controller.signal,
      headers: requestHeaders,
    });

    if (!response.ok) throw new Error(`Attendance source returned HTTP ${response.status}`);

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const html = await response.text();
    const parsed = parseAttendanceHtml(html);

    const data = {
      ...parsed,
      source_url: ATTENDANCE_SOURCE_URL,
      source: "scrape",
      content_type: contentType,
      fetched_at: new Date().toISOString(),
      cached: false,
      stale: false,
    };

    attendanceCache = { data, fetched_at_ms: now };
    return data;
  } catch (error) {
    if (attendanceCache.data) {
      return {
        ...attendanceCache.data,
        cached: true,
        stale: true,
        warning: error?.message || "Attendance fetch failed.",
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runReadOnlySql(sql) {
  const client = getSupabaseConfig();
  const sanitized = sanitizeReadOnlySql(sql);
  if (!(sanitized.normalized.startsWith("select") || sanitized.normalized.startsWith("with"))) {
    throw new Error("Only read-only SELECT/CTE queries are allowed.");
  }
  const { data, error } = await client.rpc("run_sql_readonly", { p_sql: sanitized.sql });
  if (error) throw new Error(error.message || "run_sql_readonly failed");
  return data;
}

async function runWriteSql(namePrefix, sql) {
  const client = getSupabaseConfig();
  const migrationName = `${namePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await client.rpc("run_sql_migration", {
    p_name: migrationName,
    p_sql: String(sql || "").trim(),
  });
  if (error) throw new Error(error.message || "run_sql_migration failed");
  return data;
}

async function runAdminBundleViaSqlRead(limits = {}) {
  const pLocationLimit = toSafeInt(limits.p_location_limit, 60);
  const pActivityLimit = toSafeInt(limits.p_activity_limit, 20);
  const pTicketLimit = toSafeInt(limits.p_ticket_limit, 100);
  const pExceptionLimit = toSafeInt(limits.p_exception_limit, 25);
  const pDeviceLimit = toSafeInt(limits.p_device_limit, 100);
  const sql = `select public.tool_admin_bundle(${pLocationLimit},${pActivityLimit},${pTicketLimit},${pExceptionLimit},${pDeviceLimit}) as data`;
  const rows = await runReadOnlySql(sql);
  if (Array.isArray(rows) && rows.length > 0) return rows[0]?.data ?? {};
  return {};
}

async function runPublicDashboardSummary() {
  const [snapshotRows, locationRows, ticketRows] = await Promise.all([
    runReadOnlySql(`
      select snapshot_at, operational_day_start, active_sessions, pending_submit_sessions, closed_sessions_today, open_ticket_count,
             overdue_locations, due_soon_locations, in_progress_locations, active_locations, operational_day_start::text as operational_day_start_text
      from public.v_admin_health_snapshot
      order by snapshot_at desc
      limit 1
    `),
    runReadOnlySql(`
      select location_code, location_name, location_type, form_type, latest_employee_name, latest_completed_at,
             latest_completed_at_display, services_performed, open_ticket_count, status_code, status_color, duration_display,
             open_session_status, open_session_employee_name
      from public.v_location_dashboard_status
      order by case status_color when 'red' then 1 when 'yellow' then 2 when 'blue' then 3 when 'green' then 4 when 'black' then 5 else 9 end,
               open_ticket_count desc, location_name
    `),
    runReadOnlySql(`
      select ticket_id, location_code, location_name, maintenance_issue, reported_by, fixture_type, fixture_identifier,
             out_of_order, date_submitted_display, created_at_display
      from public.v_open_maintenance_tickets
      order by date_submitted desc nulls last, created_at desc nulls last, location_code
    `),
  ]);

  const snapshot = Array.isArray(snapshotRows) && snapshotRows.length ? snapshotRows[0] : {};
  const locations = Array.isArray(locationRows) ? locationRows : [];
  const tickets = Array.isArray(ticketRows) ? ticketRows : [];

  return {
    snapshot,
    meta: {
      app: "memphis-zoo-mcp",
      version: APP_VERSION,
      release_id: RELEASE_ID,
      contracts: {
        scan: SCAN_CONTRACT_VERSION,
        dashboard: DASHBOARD_CONTRACT_VERSION,
        messaging: MESSAGING_CONTRACT_VERSION,
        schedule: SCHEDULE_CONTRACT_VERSION,
      },
      generated_at: new Date().toISOString(),
    },
    restrooms: locations.filter((row) => String(row.location_type || row.form_type || "").toLowerCase() === "restroom"),
    exhibits: locations.filter((row) => String(row.location_type || row.form_type || "").toLowerCase() !== "restroom"),
    open_tickets: tickets,
  };
}

async function runCanaryChecks() {
  const checks = {};
  const failures = [];

  async function safeCheck(name, fn) {
    try {
      const result = await fn();
      checks[name] = { ok: true, ...result };
      return true;
    } catch (error) {
      const message = error?.message || String(error);
      checks[name] = { ok: false, error: message };
      failures.push(`${name}: ${message}`);
      return false;
    }
  }

  await safeCheck("restroom_scan_state", async () => {
    const state = await runRpc("tool_get_location_scan_state", {
      p_location_code: CANARY_RESTROOM_CODE,
      p_device_id: CANARY_DEVICE_ID,
    });
    if (!state || state.location_code !== CANARY_RESTROOM_CODE) throw new Error("restroom scan state missing expected location code");
    if (String(state.form_type || state.location_type || "").toLowerCase() !== "restroom") throw new Error(`expected restroom form_type, got ${state.form_type || state.location_type || "unknown"}`);
    return { location_code: state.location_code, form_type: state.form_type || null, location_type: state.location_type || null, suggested_action: state.suggested_action || null };
  });

  await safeCheck("exhibit_scan_state", async () => {
    const state = await runRpc("tool_get_location_scan_state", {
      p_location_code: CANARY_EXHIBIT_CODE,
      p_device_id: CANARY_DEVICE_ID,
    });
    if (!state || state.location_code !== CANARY_EXHIBIT_CODE) throw new Error("exhibit scan state missing expected location code");
    if (String(state.form_type || state.location_type || "").toLowerCase() !== "exhibit") throw new Error(`expected exhibit form_type, got ${state.form_type || state.location_type || "unknown"}`);
    return { location_code: state.location_code, form_type: state.form_type || null, location_type: state.location_type || null, suggested_action: state.suggested_action || null };
  });

  await safeCheck("dashboard_summary", async () => {
    const summary = await runPublicDashboardSummary();
    if (!summary || !summary.meta || summary.meta.version !== APP_VERSION) throw new Error("dashboard summary missing expected meta version");
    if (!Array.isArray(summary.restrooms) || !Array.isArray(summary.exhibits) || !Array.isArray(summary.open_tickets)) throw new Error("dashboard summary missing expected arrays");
    const restroomFound = summary.restrooms.some((row) => row.location_code === CANARY_RESTROOM_CODE);
    const exhibitFound = summary.exhibits.some((row) => row.location_code === CANARY_EXHIBIT_CODE);
    if (!restroomFound) throw new Error(`restroom canary ${CANARY_RESTROOM_CODE} not found in restroom rows`);
    if (!exhibitFound) throw new Error(`exhibit canary ${CANARY_EXHIBIT_CODE} not found in exhibit rows`);
    return { restrooms_count: summary.restrooms.length, exhibits_count: summary.exhibits.length, open_tickets_count: summary.open_tickets.length };
  });

  await safeCheck("open_session_consistency", async () => {
    const rows = await runReadOnlySql(`
      select count(*)::int as inconsistent_count
      from public.v_location_dashboard_status
      where (open_session_status in ('active','pending_submit') and open_session_employee_name is null)
         or (open_session_status is null and open_session_employee_name is not null)
    `);
    const inconsistentCount = Array.isArray(rows) && rows.length ? Number(rows[0].inconsistent_count || 0) : 0;
    if (inconsistentCount !== 0) throw new Error(`found ${inconsistentCount} inconsistent open session rows`);
    return { inconsistent_count: inconsistentCount };
  });

  await safeCheck("ticket_count_consistency", async () => {
    const rows = await runReadOnlySql(`
      select
        (select count(*)::int from public.v_open_maintenance_tickets) as view_count,
        (select count(*)::int from public.maintenance_tickets where status = 'open') as table_count
    `);
    const row = Array.isArray(rows) && rows.length ? rows[0] : {};
    const viewCount = Number(row.view_count || 0);
    const tableCount = Number(row.table_count || 0);
    if (viewCount !== tableCount) throw new Error(`ticket counts differ: view=${viewCount}, table=${tableCount}`);
    return { view_count: viewCount, table_count: tableCount };
  });

  return {
    ok: failures.length === 0,
    checks,
    failure_count: failures.length,
    failures,
  };
}

function createMcpServer() {
  const server = new McpServer({ name: process.env.APP_NAME || "Memphis Zoo MCP", version: APP_VERSION });
  server.tool("ping", { message: z.string().optional() }, async ({ message }) => ({ content: [{ type: "text", text: `MCP server is alive. ${message || ""}`.trim() }] }));
  server.tool("github_debug_config", {}, async () => {
    const defaultRepo = process.env.GITHUB_REPO || null;
    return { content: [{ type: "text", text: JSON.stringify({ owner: process.env.GITHUB_OWNER || null, defaultRepo, allowedRepos: getAllowedGithubRepos(defaultRepo || ""), hasToken: !!process.env.GITHUB_TOKEN, version: APP_VERSION, release_id: RELEASE_ID }, null, 2) }] };
  });
  server.tool("github_list_directory", { repo: z.string().optional(), path: z.string().optional() }, async ({ repo: targetRepo, path }) => {
    try {
      const { owner, repo } = getGithubConfig(targetRepo);
      const normalizedPath = normalizeGithubPath(path || "");
      const response = await octokit.rest.repos.getContent({ owner, repo, path: normalizedPath });
      if (!Array.isArray(response.data)) return { content: [{ type: "text", text: `Path is not a directory: ${owner}/${repo}/${normalizedPath || "<repo-root>"}` }] };
      const items = response.data.map((item) => ({ name: item.name, path: item.path, type: item.type }));
      return { content: [{ type: "text", text: JSON.stringify({ owner, repo, path: normalizedPath || "<repo-root>", items }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to list GitHub directory "${path || "/"}"${targetRepo ? ` in repo "${targetRepo}"` : ""}: ${getGithubErrorDetail(error)}` }] };
    }
  });
  server.tool("github_read_file", { repo: z.string().optional(), path: z.string().min(1) }, async ({ repo: targetRepo, path }) => {
    try {
      const { owner, repo } = getGithubConfig(targetRepo);
      const normalizedPath = normalizeGithubPath(path);
      const response = await octokit.rest.repos.getContent({ owner, repo, path: normalizedPath });
      if (!("content" in response.data) || typeof response.data.content !== "string") return { content: [{ type: "text", text: `Path exists, but it is not a plain file: ${owner}/${repo}/${normalizedPath}` }] };
      const decoded = Buffer.from(response.data.content, "base64").toString("utf8");
      return { content: [{ type: "text", text: decoded }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to read GitHub file "${path}"${targetRepo ? ` in repo "${targetRepo}"` : ""}: ${getGithubErrorDetail(error)}` }] };
    }
  });
  server.tool("github_write_file", { repo: z.string().optional(), path: z.string().min(1), content: z.string(), commit_message: z.string().min(1) }, async ({ repo: targetRepo, path, content, commit_message }) => {
    try {
      const { owner, repo } = getGithubConfig(targetRepo);
      const normalizedPath = normalizeGithubPath(path);
      let sha; let mode = "created";
      try {
        const existing = await octokit.rest.repos.getContent({ owner, repo, path: normalizedPath });
        if (Array.isArray(existing.data)) return { content: [{ type: "text", text: `Cannot write to "${normalizedPath}" because it is a directory in ${owner}/${repo}.` }] };
        if ("sha" in existing.data && typeof existing.data.sha === "string") { sha = existing.data.sha; mode = "updated"; }
      } catch (error) { if (error?.status !== 404) throw error; }
      const encodedContent = Buffer.from(content, "utf8").toString("base64");
      const writeResponse = await octokit.rest.repos.createOrUpdateFileContents({ owner, repo, path: normalizedPath, message: commit_message, content: encodedContent, ...(sha ? { sha } : {}) });
      return { content: [{ type: "text", text: `${mode === "created" ? "Created" : "Updated"} "${normalizedPath}" successfully in ${owner}/${repo}.\nCommit: ${writeResponse.data.commit.sha}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to write GitHub file "${path}"${targetRepo ? ` in repo "${targetRepo}"` : ""}: ${getGithubErrorDetail(error)}` }] };
    }
  });
  server.tool("github_update_file", { repo: z.string().optional(), path: z.string().min(1), content: z.string(), commit_message: z.string().min(1) }, async ({ repo: targetRepo, path, content, commit_message }) => {
    try {
      const { owner, repo } = getGithubConfig(targetRepo);
      const normalizedPath = normalizeGithubPath(path);
      const existing = await octokit.rest.repos.getContent({ owner, repo, path: normalizedPath });
      if (Array.isArray(existing.data) || !("sha" in existing.data) || typeof existing.data.sha !== "string") return { content: [{ type: "text", text: `Cannot update "${normalizedPath}" because it is not a normal file in ${owner}/${repo}.` }] };
      const encodedContent = Buffer.from(content, "utf8").toString("base64");
      const updateResponse = await octokit.rest.repos.createOrUpdateFileContents({ owner, repo, path: normalizedPath, message: commit_message, content: encodedContent, sha: existing.data.sha });
      return { content: [{ type: "text", text: `Updated "${normalizedPath}" successfully in ${owner}/${repo}.\nCommit: ${updateResponse.data.commit.sha}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update GitHub file "${path}"${targetRepo ? ` in repo "${targetRepo}"` : ""}: ${getGithubErrorDetail(error)}` }] };
    }
  });
  server.tool("supabase_sql_read", { sql: z.string().min(1) }, async ({ sql }) => {
    try { const data = await runReadOnlySql(sql); return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }; }
    catch (error) { return { content: [{ type: "text", text: `Supabase read failed: ${error.message}` }] }; }
  });
  server.tool("supabase_migration_apply", { name: z.string().min(1), sql: z.string().min(1) }, async ({ name, sql }) => {
    try {
      const client = getSupabaseConfig();
      const normalized = sql.trim().toLowerCase();
      if (!normalized) return { content: [{ type: "text", text: "Migration SQL cannot be empty." }] };
      if (normalized.startsWith("begin") || normalized.includes("commit")) return { content: [{ type: "text", text: "Do not include BEGIN/COMMIT. Submit the migration body only." }] };
      const { data, error } = await client.rpc("run_sql_migration", { p_name: name, p_sql: sql });
      if (error) return { content: [{ type: "text", text: `Supabase migration failed: ${error.message}` }] };
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, name, result: data }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Supabase migration apply failed: ${error.message}` }] };
    }
  });
  return server;
}

app.use("/admin-api", (req, res, next) => {
  setAdminApiCors(res);
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use("/dashboard-api", (req, res, next) => {
  setPublicDashboardCors(res);
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use("/scan-api", (req, res, next) => {
  setScanApiCors(res);
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use("/messaging-api", (req, res, next) => {
  setMessagingApiCors(res);
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
}, createMessagingRouter({
  runReadOnlySql,
  runRpc,
  buildHealthPayload,
  appVersion: APP_VERSION,
  releaseId: RELEASE_ID,
  contractVersion: MESSAGING_CONTRACT_VERSION
}));

app.use("/schedule-api", (req, res, next) => {
  setScheduleApiCors(res);
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
}, createScheduleRouter({
  runReadOnlySql,
  runRpc,
  buildHealthPayload,
  requireAdminApiAuth,
  appVersion: APP_VERSION,
  releaseId: RELEASE_ID,
  contractVersion: SCHEDULE_CONTRACT_VERSION
}));

app.get("/version", (_req, res) => {
  res.status(200).json(buildHealthPayload("version"));
});

app.get("/admin-api/health", requireAdminApiAuth, (_req, res) => {
  res.status(200).json(buildHealthPayload("admin", { authenticated: true }));
});

app.get("/dashboard-api/health", (_req, res) => {
  res.status(200).json(buildHealthPayload("dashboard"));
});

app.get("/schedule-api/health", (_req, res) => {
  res.status(200).json(buildHealthPayload("schedule", { contract_version: SCHEDULE_CONTRACT_VERSION }));
});

app.get("/dashboard-api/canary", async (_req, res) => {
  try {
    const result = await runCanaryChecks();
    res.status(result.ok ? 200 : 503).json(buildHealthPayload("dashboard_canary", result));
  } catch (error) {
    console.error("dashboard canary failed:", error);
    res.status(500).json({
      ok: false,
      area: "dashboard_canary",
      version: APP_VERSION,
      release_id: RELEASE_ID,
      error: error.message || "Dashboard canary failed"
    });
  }
});

app.get("/dashboard-api/current-attendance", async (_req, res) => {
  try {
    const stored = await loadStoredAttendance();
    if (stored) {
      res.status(200).json({ ok: true, data: stored, meta: { version: APP_VERSION, release_id: RELEASE_ID, mode: "stored" } });
      return;
    }
    const data = await fetchCurrentAttendance();
    res.status(200).json({ ok: true, data, meta: { version: APP_VERSION, release_id: RELEASE_ID, mode: "scrape" } });
  } catch (error) {
    console.error("current attendance fetch failed:", error);
    res.status(502).json({ ok: false, error: error.message || "Current attendance fetch failed", source_url: ATTENDANCE_SOURCE_URL });
  }
});

app.post("/admin-api/attendance-update", requireAdminApiAuth, async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const data = await persistAttendanceState(payload);
    attendanceCache = { data: null, fetched_at_ms: 0 };
    res.status(200).json({ ok: true, data, meta: { version: APP_VERSION, release_id: RELEASE_ID } });
  } catch (error) {
    console.error("attendance update failed:", error);
    res.status(400).json({ ok: false, error: error.message || "Attendance update failed" });
  }
});

app.post("/admin-api/bundle", requireAdminApiAuth, async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const data = await runAdminBundleViaSqlRead(payload);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    console.error("admin bundle failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Admin bundle failed" });
  }
});

app.post("/admin-api/close-ticket", requireAdminApiAuth, async (req, res) => {
  try {
    const ticketId = String(req.body?.ticket_id || "").trim();
    const closedBy = String(req.body?.closed_by || "").trim();
    const closeNotes = req.body?.close_notes == null ? null : String(req.body.close_notes);
    if (!ticketId || !closedBy) {
      res.status(400).json({ ok: false, error: "ticket_id and closed_by are required." });
      return;
    }
    await runWriteSql("admin_close_ticket", `select public.close_maintenance_ticket(${sqlLiteral(ticketId)}::uuid, ${sqlLiteral(closedBy)}, ${sqlLiteral(closeNotes)});`);
    res.status(200).json({ ok: true, ticket_id: ticketId, status: "closed" });
  } catch (error) {
    console.error("close ticket failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Close ticket failed" });
  }
});

app.post("/admin-api/force-close-session", requireAdminApiAuth, async (req, res) => {
  try {
    const sessionUuid = String(req.body?.session_uuid || "").trim();
    const closedBy = String(req.body?.closed_by || "").trim();
    const reason = req.body?.reason == null ? null : String(req.body.reason);
    if (!sessionUuid || !closedBy) {
      res.status(400).json({ ok: false, error: "session_uuid and closed_by are required." });
      return;
    }
    await runWriteSql("admin_force_close_session", `select public.force_close_session(${sqlLiteral(sessionUuid)}, ${sqlLiteral(closedBy)}, ${sqlLiteral(reason)});`);
    res.status(200).json({ ok: true, session_uuid: sessionUuid, status: "closed" });
  } catch (error) {
    console.error("force close session failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Force close session failed" });
  }
});

app.get("/dashboard-api/summary", async (_req, res) => {
  try {
    const data = await runPublicDashboardSummary();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    console.error("dashboard summary failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Dashboard summary failed" });
  }
});

app.post("/dashboard-api/close-ticket", requireDashboardClosePin, async (req, res) => {
  try {
    const ticketId = String(req.body?.ticket_id || "").trim();
    const closedBy = normalizeDashboardCloser(req.body?.closed_by);
    if (!ticketId) {
      res.status(400).json({ ok: false, error: "ticket_id is required." });
      return;
    }
    await runWriteSql("dashboard_close_ticket", `select public.close_maintenance_ticket(${sqlLiteral(ticketId)}::uuid, ${sqlLiteral(closedBy)}, null);`);
    res.status(200).json({ ok: true, ticket_id: ticketId, status: "closed" });
  } catch (error) {
    console.error("dashboard close ticket failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Dashboard close ticket failed" });
  }
});

app.get("/scan-api/health", (_req, res) => {
  res.status(200).json(buildHealthPayload("scan", { available_functions: Array.from(SCAN_RPC_ALLOWLIST) }));
});

app.post("/scan-api/rpc", async (req, res) => {
  try {
    const fn = String(req.body?.fn || "").trim();
    const args = req.body?.args && typeof req.body.args === "object" ? req.body.args : {};
    if (!SCAN_RPC_ALLOWLIST.has(fn)) {
      res.status(400).json({ ok: false, error: `Function not allowed: ${fn}` });
      return;
    }
    const data = await runRpc(fn, args);
    res.status(200).json({ ok: true, data, meta: { version: APP_VERSION, release_id: RELEASE_ID, contract_version: SCAN_CONTRACT_VERSION } });
  } catch (error) {
    console.error("scan rpc failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Scan RPC failed" });
  }
});

app.get("/", (_req, res) => {
  res.status(200).send("Memphis Zoo MCP server is running.");
});

app.get("/mcp", (_req, res) => {
  res.status(405).send("GET not supported on /mcp for this server.");
});

app.options("/mcp", (_req, res) => {
  res.sendStatus(200);
});

app.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

let sseTransport = null;
let sseServer = null;

app.get("/sse", async (_req, res) => {
  try {
    sseServer = createMcpServer();
    sseTransport = new SSEServerTransport("/messages", res);
    await sseServer.connect(sseTransport);
  } catch (error) {
    console.error("SSE connection failed:", error);
    if (!res.headersSent) res.status(500).send("SSE connection failed");
  }
});

app.post("/messages", async (req, res) => {
  try {
    if (!sseTransport) {
      res.status(400).send("No active SSE transport");
      return;
    }
    await sseTransport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error("SSE post message failed:", error);
    if (!res.headersSent) res.status(500).send("SSE post message failed");
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log("Memphis Zoo MCP server initialized.");
  console.log(`App version: ${APP_VERSION}`);
  console.log(`Listening on http://localhost:${port}`);
  console.log("Version endpoint: /version");
  console.log("Dashboard canary endpoint: /dashboard-api/canary");
  console.log("Dashboard attendance endpoint: /dashboard-api/current-attendance");
  console.log("Admin attendance update endpoint: /admin-api/attendance-update");
  console.log("Messaging API endpoint: /messaging-api");
  console.log("Schedule API endpoint: /schedule-api");
  console.log("MCP endpoint: /mcp");
  console.log("Legacy SSE endpoint: /sse");
  console.log("Legacy messages endpoint: /messages");
  console.log("Admin API endpoint: /admin-api");
  console.log("Dashboard API endpoint: /dashboard-api");
  console.log("Scan API endpoint: /scan-api");
});
