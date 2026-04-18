import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { Octokit } from "octokit";
import { createClient } from "@supabase/supabase-js";

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
    throw new Error(`Repo \"${repo}\" is not allowed. Allowed repos: ${allowedRepos.join(", ")}`);
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

function getAttendanceSourceUrl() {
  return String(process.env.ATTENDANCE_SOURCE_URL || "https://nd.memzoo.org/").trim();
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

function sqlLiteral(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function stripTags(text) {
  return decodeHtml(String(text || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseIntegerText(text) {
  const cleaned = String(text || "").replace(/[^\d-]/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAttendancePayload(currentValue, nearbyText, sourceUrl) {
  const lastYearMatch = nearbyText.match(/Last Year:\s*([\d,]+)/i);
  const plannedMatch = nearbyText.match(/Planned:\s*([\d,]+)/i);
  const yesterdayMatch = nearbyText.match(/Yesterday:\s*([\d,]+)/i);
  const yesterdayPlanMatch = nearbyText.match(/Yesterday Plan:\s*([\d,]+)/i);
  return {
    ok: true,
    source_url: sourceUrl,
    value: currentValue,
    display: currentValue.toLocaleString("en-US"),
    last_year: parseIntegerText(lastYearMatch?.[1] || ""),
    planned: parseIntegerText(plannedMatch?.[1] || ""),
    yesterday: parseIntegerText(yesterdayMatch?.[1] || ""),
    yesterday_plan: parseIntegerText(yesterdayPlanMatch?.[1] || ""),
    fetched_at: new Date().toISOString(),
  };
}

function parseAttendanceFromHtml(html) {
  const source = String(html || "").replace(/\r/g, "");
  const sourceUrl = getAttendanceSourceUrl();

  const headerIndex = source.search(/<h5[^>]*>\s*Attendance\s*<\/h5>/i);
  if (headerIndex >= 0) {
    const nearbyHtml = source.slice(headerIndex, headerIndex + 4000);
    const nearbyText = stripTags(nearbyHtml);
    const valueMatch = nearbyHtml.match(/<h1[^>]*>\s*([\d,]+)\s*<\/h1>/i) || nearbyText.match(/Attendance\s+([\d,]+)/i);
    const currentValue = parseIntegerText(valueMatch?.[1] || "");
    if (currentValue != null) {
      return buildAttendancePayload(currentValue, nearbyText, sourceUrl);
    }
  }

  const fullText = stripTags(source);
  const looseSectionMatch = fullText.match(/Attendance\s+([\d,]+)[\s\S]{0,300}?Last Year:\s*([\d,]+)[\s\S]{0,200}?Planned:\s*([\d,]+)[\s\S]{0,300}?Yesterday:\s*([\d,]+)[\s\S]{0,200}?Yesterday Plan:\s*([\d,]+)/i);
  if (looseSectionMatch) {
    const currentValue = parseIntegerText(looseSectionMatch[1]);
    if (currentValue != null) {
      return {
        ok: true,
        source_url: sourceUrl,
        value: currentValue,
        display: currentValue.toLocaleString("en-US"),
        last_year: parseIntegerText(looseSectionMatch[2]),
        planned: parseIntegerText(looseSectionMatch[3]),
        yesterday: parseIntegerText(looseSectionMatch[4]),
        yesterday_plan: parseIntegerText(looseSectionMatch[5]),
        fetched_at: new Date().toISOString(),
      };
    }
  }

  throw new Error("Attendance value not found in source HTML.");
}

async function fetchExternalAttendanceSummary() {
  const url = getAttendanceSourceUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Memphis-Zoo-MCP/0.3.7; +dashboard attendance fetch)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
      },
    });
    if (!response.ok) {
      throw new Error(`Attendance source HTTP ${response.status}`);
    }
    const html = await response.text();
    return parseAttendanceFromHtml(html);
  } catch (error) {
    return {
      ok: false,
      source_url: url,
      value: null,
      display: "--",
      error: error?.name === "AbortError" ? "Attendance source request timed out." : (error?.message || "Attendance fetch failed."),
      fetched_at: new Date().toISOString(),
    };
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
  const { data, error } = await client.rpc("run_sql_migration", { p_name: migrationName, p_sql: String(sql || "").trim() });
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
  const [snapshotRows, locationRows, ticketRows, attendance] = await Promise.all([
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
      order by case status_color when 'red' then 1 when 'yellow' then 2 when 'blue' then 3 when 'black' then 4 when 'green' then 5 else 9 end,
               open_ticket_count desc, location_name
    `),
    runReadOnlySql(`
      select ticket_id, location_code, location_name, maintenance_issue, reported_by, fixture_type, fixture_identifier,
             out_of_order, date_submitted_display, created_at_display
      from public.v_open_maintenance_tickets
      order by date_submitted desc nulls last, created_at desc nulls last, location_code
    `),
    fetchExternalAttendanceSummary(),
  ]);

  const snapshot = Array.isArray(snapshotRows) && snapshotRows.length ? snapshotRows[0] : {};
  const locations = Array.isArray(locationRows) ? locationRows : [];
  const tickets = Array.isArray(ticketRows) ? ticketRows : [];

  return {
    snapshot,
    attendance,
    restrooms: locations.filter((row) => String(row.location_type || row.form_type || "").toLowerCase() === "restroom"),
    exhibits: locations.filter((row) => String(row.location_type || row.form_type || "").toLowerCase() !== "restroom"),
    open_tickets: tickets,
  };
}

function createMcpServer() {
  const server = new McpServer({ name: process.env.APP_NAME || "Memphis Zoo MCP", version: "0.3.8" });

  server.tool("ping", { message: z.string().optional() }, async ({ message }) => ({ content: [{ type: "text", text: `MCP server is alive. ${message || ""}`.trim() }] }));

  server.tool("github_debug_config", {}, async () => {
    const defaultRepo = process.env.GITHUB_REPO || null;
    return { content: [{ type: "text", text: JSON.stringify({ owner: process.env.GITHUB_OWNER || null, defaultRepo, allowedRepos: getAllowedGithubRepos(defaultRepo || ""), hasToken: !!process.env.GITHUB_TOKEN }, null, 2) }] };
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
      return { content: [{ type: "text", text: `Failed to list GitHub directory \"${path || "/"}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}` }] };
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
      return { content: [{ type: "text", text: `Failed to read GitHub file \"${path}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}` }] };
    }
  });

  server.tool("github_write_file", { repo: z.string().optional(), path: z.string().min(1), content: z.string(), commit_message: z.string().min(1) }, async ({ repo: targetRepo, path, content, commit_message }) => {
    try {
      const { owner, repo } = getGithubConfig(targetRepo);
      const normalizedPath = normalizeGithubPath(path);
      let sha; let mode = "created";
      try {
        const existing = await octokit.rest.repos.getContent({ owner, repo, path: normalizedPath });
        if (Array.isArray(existing.data)) return { content: [{ type: "text", text: `Cannot write to \"${normalizedPath}\" because it is a directory in ${owner}/${repo}.` }] };
        if ("sha" in existing.data && typeof existing.data.sha === "string") { sha = existing.data.sha; mode = "updated"; }
      } catch (error) { if (error?.status !== 404) throw error; }
      const encodedContent = Buffer.from(content, "utf8").toString("base64");
      const writeResponse = await octokit.rest.repos.createOrUpdateFileContents({ owner, repo, path: normalizedPath, message: commit_message, content: encodedContent, ...(sha ? { sha } : {}) });
      return { content: [{ type: "text", text: `${mode === "created" ? "Created" : "Updated"} \"${normalizedPath}\" successfully in ${owner}/${repo}.\nCommit: ${writeResponse.data.commit.sha}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to write GitHub file \"${path}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}` }] };
    }
  });

  server.tool("github_update_file", { repo: z.string().optional(), path: z.string().min(1), content: z.string(), commit_message: z.string().min(1) }, async ({ repo: targetRepo, path, content, commit_message }) => {
    try {
      const { owner, repo } = getGithubConfig(targetRepo);
      const normalizedPath = normalizeGithubPath(path);
      const existing = await octokit.rest.repos.getContent({ owner, repo, path: normalizedPath });
      if (Array.isArray(existing.data) || !("sha" in existing.data) || typeof existing.data.sha !== "string") return { content: [{ type: "text", text: `Cannot update \"${normalizedPath}\" because it is not a normal file in ${owner}/${repo}.` }] };
      const encodedContent = Buffer.from(content, "utf8").toString("base64");
      const updateResponse = await octokit.rest.repos.createOrUpdateFileContents({ owner, repo, path: normalizedPath, message: commit_message, content: encodedContent, sha: existing.data.sha });
      return { content: [{ type: "text", text: `Updated \"${normalizedPath}\" successfully in ${owner}/${repo}.\nCommit: ${updateResponse.data.commit.sha}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Failed to update GitHub file \"${path}\"${targetRepo ? ` in repo \"${targetRepo}\"` : ""}: ${getGithubErrorDetail(error)}` }] };
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

app.use("/admin-api", (req, res, next) => { setAdminApiCors(res); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/dashboard-api", (req, res, next) => { setPublicDashboardCors(res); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });
app.use("/scan-api", (req, res, next) => { setScanApiCors(res); if (req.method === "OPTIONS") { res.sendStatus(200); return; } next(); });

app.get("/admin-api/health", requireAdminApiAuth, (_req, res) => { res.status(200).json({ ok: true, authenticated: true }); });

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
    if (!ticketId || !closedBy) { res.status(400).json({ ok: false, error: "ticket_id and closed_by are required." }); return; }
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
    if (!sessionUuid || !closedBy) { res.status(400).json({ ok: false, error: "session_uuid and closed_by are required." }); return; }
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

app.post("/dashboard-api/close-ticket", async (req, res) => {
  try {
    const ticketId = String(req.body?.ticket_id || "").trim();
    if (!ticketId) { res.status(400).json({ ok: false, error: "ticket_id is required." }); return; }
    await runWriteSql("dashboard_close_ticket", `select public.close_maintenance_ticket(${sqlLiteral(ticketId)}::uuid, 'Dashboard', null);`);
    res.status(200).json({ ok: true, ticket_id: ticketId, status: "closed" });
  } catch (error) {
    console.error("dashboard close ticket failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Dashboard close ticket failed" });
  }
});

app.get("/scan-api/health", async (_req, res) => { res.status(200).json({ ok: true, available_functions: Array.from(SCAN_RPC_ALLOWLIST) }); });

app.post("/scan-api/rpc", async (req, res) => {
  try {
    const fn = String(req.body?.fn || "").trim();
    const args = req.body?.args && typeof req.body.args === "object" ? req.body.args : {};
    if (!SCAN_RPC_ALLOWLIST.has(fn)) { res.status(400).json({ ok: false, error: `Function not allowed: ${fn}` }); return; }
    const data = await runRpc(fn, args);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    console.error("scan rpc failed:", error);
    res.status(500).json({ ok: false, error: error.message || "Scan RPC failed" });
  }
});

app.get("/", (_req, res) => { res.status(200).send("Memphis Zoo MCP server is running."); });
app.get("/mcp", (_req, res) => { res.status(405).send("GET not supported on /mcp for this server."); });
app.options("/mcp", (_req, res) => { res.sendStatus(200); });

app.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); });
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
    if (!sseTransport) { res.status(400).send("No active SSE transport"); return; }
    await sseTransport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error("SSE post message failed:", error);
    if (!res.headersSent) res.status(500).send("SSE post message failed");
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log("Memphis Zoo MCP server initialized.");
  console.log(`App name: ${process.env.APP_NAME || "Memphis Zoo MCP"}`);
  console.log(`Listening on http://localhost:${port}`);
  console.log("MCP endpoint: /mcp");
  console.log("Legacy SSE endpoint: /sse");
  console.log("Legacy messages endpoint: /messages");
  console.log("Admin API endpoint: /admin-api");
  console.log("Dashboard API endpoint: /dashboard-api");
  console.log("Scan API endpoint: /scan-api");
});