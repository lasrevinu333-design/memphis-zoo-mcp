const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = String(process.env.MEMPHIS_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1").trim();
const DEFAULT_SCAN_DEVICE_ID = "memphis-bot";
const MAX_TOOL_ROUNDS = 6;

function esc(value) {
  return String(value || "").replace(/'/g, "''");
}

function sqlLikeLiteral(value) {
  return `'%${String(value || "").replace(/'/g, "''") }%'`;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function toSafeInt(value, fallback, min = 1, max = 90) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getOpenAiApiKey() {
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function allowWebSearch({ deviceId = "", identityRole = "" }) {
  const configuredDevices = String(process.env.MEMPHIS_WEB_SEARCH_DEVICE_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (configuredDevices.length && deviceId && configuredDevices.includes(deviceId)) return true;
  return String(identityRole || "").trim().toLowerCase() === "manager";
}

async function fetchDeviceIdentity(runReadOnlySql, deviceId) {
  const normalized = String(deviceId || "").trim();
  if (!normalized) return null;
  const rows = await runReadOnlySql(`select * from public.msg_get_user_by_device('${esc(normalized)}')`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function buildSystemPrompt({ webEnabled }) {
  return [
    "You are Memphis, the operational assistant for Memphis Zoo custodial systems.",
    "Answer internal system questions about schedules, upcoming events, scan state, dashboard status, open tickets, employees, and messaging-related operations.",
    "Prefer tool calls for factual answers. Do not invent operational facts.",
    webEnabled
      ? "Web search is allowed on this device, but use it only when the user clearly needs outside or current public information."
      : "Web search is not allowed on this device. If asked for outside or general knowledge unrelated to Memphis Zoo systems, explain that this device is limited to internal system questions.",
    "Keep answers concise, practical, and operationally useful.",
    "If information is missing, say so plainly."
  ].join(" ");
}

function buildTools({ webEnabled }) {
  const tools = [
    {
      type: "function",
      name: "get_upcoming_events",
      description: "List upcoming Memphis Zoo events, optionally filtered by area and days ahead.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "How many days ahead to search, default 14." },
          area: { type: "string", description: "Optional event area or location group name/code." }
        },
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "get_area_schedule",
      description: "Look up who is assigned to an area or location group on a given service date.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          area: { type: "string", description: "Area, location group name, or group code." },
          service_date: { type: "string", description: "Optional date in YYYY-MM-DD. Defaults to today service date." }
        },
        required: ["area"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "get_employee_schedule",
      description: "Look up what areas an employee is assigned to on a given date.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          employee_name: { type: "string", description: "Employee display name or partial name." },
          service_date: { type: "string", description: "Optional date in YYYY-MM-DD. Defaults to today service date." }
        },
        required: ["employee_name"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "get_current_owner",
      description: "Find who currently owns a specific location according to the schedule system.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          location_code: { type: "string", description: "Location code such as TETM or TETX." },
          at: { type: "string", description: "Optional ISO-like timestamp." }
        },
        required: ["location_code"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "get_open_tickets",
      description: "List open maintenance tickets, optionally filtered by a location code or name.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "Optional location code or location name filter." }
        },
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "get_dashboard_summary",
      description: "Get a summary of current operational dashboard metrics and problem locations.",
      strict: true,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "get_scan_state",
      description: "Check the scan system state for a specific location code.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          location_code: { type: "string", description: "Location code to inspect." }
        },
        required: ["location_code"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "list_active_employees",
      description: "List currently active employees in the system.",
      strict: true,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  ];

  if (webEnabled) {
    tools.push({ type: "web_search", external_web_access: true });
  }

  return tools;
}

async function createResponse({ apiKey, model, instructions, input, tools, previousResponseId }) {
  const body = {
    model,
    instructions,
    input,
    tools,
    tool_choice: "auto"
  };
  if (String(model || "").startsWith("gpt-5")) {
    body.reasoning = { effort: "low" };
  }
  if (previousResponseId) body.previous_response_id = previousResponseId;

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `OpenAI HTTP ${response.status}`);
  }
  return payload;
}

function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const outputs = Array.isArray(response?.output) ? response.output : [];
  const parts = [];
  for (const item of outputs) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content?.type === "output_text" && content.text) {
          parts.push(String(content.text));
        }
      }
    }
  }
  return parts.join("\n\n").trim();
}

function extractFunctionCalls(response) {
  return (Array.isArray(response?.output) ? response.output : []).filter((item) => item?.type === "function_call");
}

async function getDefaultServiceDate(runReadOnlySql) {
  const rows = await runReadOnlySql("select public.sch_service_date(now()) as service_date");
  return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
}

function findLocationCode(text) {
  const match = String(text || "").match(/\b[A-Z]{3,5}\b/);
  return match ? match[0] : "";
}

function summarizeEvents(events = []) {
  if (!events.length) return "There are no upcoming events in the system right now.";
  return events.slice(0, 6).map((event) => {
    const attendees = event.attendee_count == null ? "attendees not listed" : `${event.attendee_count} attendees`;
    return `${event.event_name} in ${event.group_name || event.group_code} on ${event.event_date} from ${event.start_time} to ${event.end_time}, ${attendees}.`;
  }).join(" ");
}

function summarizeAssignments(assignments = [], emptyText) {
  if (!assignments.length) return emptyText;
  return assignments.slice(0, 10).map((row) => {
    const employee = row.employee_name || "Open";
    const group = row.group_name || row.group_code || "Unknown area";
    const start = row.coverage_start || "—";
    const end = row.coverage_end || "—";
    return `${employee} covers ${group} from ${start} to ${end}.`;
  }).join(" ");
}

function summarizeTickets(tickets = [], location = "") {
  if (!tickets.length) return location ? `There are no open tickets matching ${location}.` : "There are no open tickets right now.";
  return tickets.slice(0, 8).map((ticket) => `${ticket.location_name || ticket.location_code}: ${ticket.maintenance_issue}.`).join(" ");
}

function summarizeDashboard(snapshot = {}, attention = []) {
  const bits = [];
  if (snapshot.open_ticket_count != null) bits.push(`${snapshot.open_ticket_count} open tickets`);
  if (snapshot.overdue_locations != null) bits.push(`${snapshot.overdue_locations} overdue locations`);
  if (snapshot.due_soon_locations != null) bits.push(`${snapshot.due_soon_locations} due soon`);
  if (snapshot.in_progress_locations != null) bits.push(`${snapshot.in_progress_locations} in progress`);
  const summary = bits.length ? `Dashboard snapshot: ${bits.join(", ")}.` : "Dashboard snapshot is available.";
  const focus = attention.length
    ? ` Attention locations: ${attention.slice(0, 8).map((row) => `${row.location_name || row.location_code} (${row.status_code}, ${row.open_ticket_count} tickets)`).join("; ")}.`
    : "";
  return `${summary}${focus}`.trim();
}

export function createMemphisResponder({ runReadOnlySql, runRpc }) {
  async function executeTool(name, args = {}) {
    if (name === "get_upcoming_events") {
      const days = toSafeInt(args.days, 14, 1, 60);
      const area = String(args.area || "").trim();
      const rows = await runReadOnlySql(`
        select
          e.event_name,
          lg.group_name,
          lg.group_code,
          e.event_date,
          to_char(e.start_time, 'HH24:MI:SS') as start_time,
          to_char(e.end_time, 'HH24:MI:SS') as end_time,
          e.attendee_count,
          e.notes
        from public.events_app_events e
        join public.location_groups lg on lg.id = e.location_group_id
        where e.event_date >= current_date
          and e.event_date <= current_date + ${days}
          ${area ? `and (lg.group_name ilike ${sqlLikeLiteral(area)} or lg.group_code ilike ${sqlLikeLiteral(area)})` : ""}
        order by e.event_date asc, e.start_time asc, e.event_name asc
      `);
      return { events: rows || [] };
    }

    if (name === "get_area_schedule") {
      const area = String(args.area || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const rows = await runReadOnlySql(`
        select
          dga.assignment_date,
          lg.group_name,
          lg.group_code,
          e.display_name as employee_name,
          to_char(dga.coverage_start, 'HH24:MI') as coverage_start,
          to_char(dga.coverage_end, 'HH24:MI') as coverage_end,
          dga.assignment_type,
          dga.reason_code,
          dga.notes
        from public.daily_group_assignments dga
        join public.location_groups lg on lg.id = dga.location_group_id
        left join public.employees e on e.id = dga.assigned_employee_id
        where dga.active = true
          and dga.assignment_date = '${esc(serviceDate)}'::date
          and (lg.group_name ilike ${sqlLikeLiteral(area)} or lg.group_code ilike ${sqlLikeLiteral(area)})
        order by dga.coverage_start asc nulls last, e.display_name asc nulls last
      `);
      return { service_date: serviceDate, assignments: rows || [] };
    }

    if (name === "get_employee_schedule") {
      const employeeName = String(args.employee_name || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const rows = await runReadOnlySql(`
        select
          dga.assignment_date,
          e.display_name as employee_name,
          lg.group_name,
          lg.group_code,
          to_char(dga.coverage_start, 'HH24:MI') as coverage_start,
          to_char(dga.coverage_end, 'HH24:MI') as coverage_end,
          dga.assignment_type,
          dga.reason_code,
          dga.notes
        from public.daily_group_assignments dga
        join public.employees e on e.id = dga.assigned_employee_id
        join public.location_groups lg on lg.id = dga.location_group_id
        where dga.active = true
          and dga.assignment_date = '${esc(serviceDate)}'::date
          and e.display_name ilike ${sqlLikeLiteral(employeeName)}
        order by dga.coverage_start asc nulls last, lg.group_name asc
      `);
      return { service_date: serviceDate, assignments: rows || [] };
    }

    if (name === "get_current_owner") {
      const locationCode = String(args.location_code || "").trim();
      const at = String(args.at || "").trim();
      const literal = at ? `'${esc(at)}'::timestamptz` : "now()";
      const rows = await runReadOnlySql(`select * from public.sch_get_current_owner('${esc(locationCode)}', ${literal})`);
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    }

    if (name === "get_open_tickets") {
      const location = String(args.location || "").trim();
      const rows = await runReadOnlySql(`
        select
          ticket_id,
          location_code,
          location_name,
          maintenance_issue,
          reported_by,
          fixture_type,
          fixture_identifier,
          out_of_order,
          date_submitted_display,
          created_at_display
        from public.v_open_maintenance_tickets
        ${location ? `where location_code ilike ${sqlLikeLiteral(location)} or location_name ilike ${sqlLikeLiteral(location)}` : ""}
        order by date_submitted desc nulls last, created_at desc nulls last
        limit 50
      `);
      return { tickets: rows || [] };
    }

    if (name === "get_dashboard_summary") {
      const [snapshotRows, badRows] = await Promise.all([
        runReadOnlySql(`
          select *
          from public.v_admin_health_snapshot
          order by snapshot_at desc
          limit 1
        `),
        runReadOnlySql(`
          select
            location_code,
            location_name,
            status_code,
            status_color,
            open_ticket_count,
            latest_employee_name,
            latest_completed_at_display,
            open_session_status
          from public.v_location_dashboard_status
          where status_code <> 'okay' or open_ticket_count > 0
          order by case status_color when 'red' then 1 when 'yellow' then 2 when 'blue' then 3 else 9 end,
                   open_ticket_count desc,
                   location_name
          limit 15
        `)
      ]);
      return {
        snapshot: Array.isArray(snapshotRows) && snapshotRows.length ? snapshotRows[0] : {},
        attention_locations: badRows || []
      };
    }

    if (name === "get_scan_state") {
      const locationCode = String(args.location_code || "").trim();
      const data = await runRpc("tool_get_location_scan_state", {
        p_location_code: locationCode,
        p_device_id: DEFAULT_SCAN_DEVICE_ID
      });
      return data;
    }

    if (name === "list_active_employees") {
      const data = await runRpc("tool_list_active_employees", {});
      return { employees: Array.isArray(data) ? data : [] };
    }

    throw new Error(`Unknown Memphis tool: ${name}`);
  }

  async function generateLocalReply(userMessage) {
    const text = String(userMessage || "").trim();
    const lower = text.toLowerCase();

    if (lower.includes("event")) {
      const data = await executeTool("get_upcoming_events", { days: 14 });
      return { text: summarizeEvents(data.events), meta: { fallback: true, mode: "local_events" } };
    }

    if (lower.includes("ticket")) {
      const data = await executeTool("get_open_tickets", { location: findLocationCode(text) || "" });
      return { text: summarizeTickets(data.tickets, findLocationCode(text)), meta: { fallback: true, mode: "local_tickets" } };
    }

    if (lower.includes("owner") || lower.includes("who owns") || lower.includes("who has")) {
      const code = findLocationCode(text);
      if (code) {
        const owner = await executeTool("get_current_owner", { location_code: code });
        if (!owner) return { text: `I could not find a current owner for ${code}.`, meta: { fallback: true, mode: "local_owner" } };
        return {
          text: `${owner.location_name || owner.location_code || code} is currently owned by ${owner.owner_display_name || owner.employee_name || "nobody listed"}.`,
          meta: { fallback: true, mode: "local_owner" }
        };
      }
    }

    if (lower.includes("scan") || lower.includes("state")) {
      const code = findLocationCode(text);
      if (code) {
        const state = await executeTool("get_scan_state", { location_code: code });
        return {
          text: `${state.location_name || state.location_code || code} is currently ${state.suggested_action || state.status || "available"}.`,
          meta: { fallback: true, mode: "local_scan" }
        };
      }
    }

    if ((lower.includes("assigned") || lower.includes("schedule")) && /(today|tomorrow|group|teton|expo|zambezi|primate|event center)/i.test(text)) {
      const area = text;
      const data = await executeTool("get_area_schedule", { area });
      return {
        text: summarizeAssignments(data.assignments, `I could not find schedule assignments for ${area} on ${data.service_date}.`),
        meta: { fallback: true, mode: "local_area_schedule" }
      };
    }

    if (lower.includes("dashboard") || lower.includes("summary") || lower.includes("status")) {
      const data = await executeTool("get_dashboard_summary", {});
      return { text: summarizeDashboard(data.snapshot, data.attention_locations), meta: { fallback: true, mode: "local_dashboard" } };
    }

    return {
      text: "Memphis can help with schedules, events, scan state, dashboard status, tickets, and employee assignments. Ask me a system question tied to those areas.",
      meta: { fallback: true, mode: "local_generic" }
    };
  }

  async function generateReply({ deviceId = "", userMessage = "" }) {
    const apiKey = getOpenAiApiKey();
    const identity = await fetchDeviceIdentity(runReadOnlySql, deviceId);
    const webEnabled = allowWebSearch({ deviceId, identityRole: identity?.role || "" });

    if (!apiKey) {
      return await generateLocalReply(userMessage);
    }

    const tools = buildTools({ webEnabled });
    const instructions = buildSystemPrompt({ webEnabled });
    const model = DEFAULT_MODEL;

    try {
      let response = await createResponse({
        apiKey,
        model,
        instructions,
        input: userMessage,
        tools
      });

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const calls = extractFunctionCalls(response);
        if (!calls.length) break;
        const toolOutputs = [];
        for (const call of calls) {
          let parsedArgs = {};
          try {
            parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            parsedArgs = {};
          }
          const output = await executeTool(call.name, parsedArgs);
          toolOutputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(output)
          });
        }
        response = await createResponse({
          apiKey,
          model,
          instructions,
          input: toolOutputs,
          tools,
          previousResponseId: response.id
        });
      }

      const text = extractResponseText(response) || "Memphis could not produce an answer for that yet.";
      return {
        text,
        meta: {
          fallback: false,
          model,
          web_enabled: webEnabled,
          response_id: response?.id || null
        }
      };
    } catch (error) {
      console.error("memphis openai path failed:", error);
      const local = await generateLocalReply(userMessage);
      return {
        text: local.text,
        meta: {
          ...(local.meta || {}),
          openai_error: error?.message || "openai_failed",
          model,
          web_enabled: webEnabled
        }
      };
    }
  }

  return { generateReply };
}
