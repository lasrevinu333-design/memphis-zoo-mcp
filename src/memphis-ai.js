const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = String(process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
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

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
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
    "Answer internal system questions about schedules, absences, coverage, upcoming events, scan state, dashboard status, open tickets, employees, and messaging-related operations.",
    "Prefer tool calls for factual answers. Do not invent operational facts.",
    "Understand relative dates like today and tomorrow when answering schedule questions.",
    webEnabled
      ? "External web lookup is allowed on this device when clearly needed for current outside information."
      : "External web lookup is not allowed on this device. If asked for outside or general knowledge unrelated to Memphis Zoo systems, explain that this device is limited to internal system questions.",
    "Keep answers concise, practical, and operationally useful.",
    "If information is missing, say so plainly."
  ].join(" ");
}

function buildGeminiTools() {
  return [{
    functionDeclarations: [
      {
        name: "get_upcoming_events",
        description: "List upcoming Memphis Zoo events, optionally filtered by area and days ahead.",
        parameters: {
          type: "OBJECT",
          properties: {
            days: { type: "INTEGER", description: "How many days ahead to search, default 14." },
            area: { type: "STRING", description: "Optional event area or location group name/code." }
          }
        }
      },
      {
        name: "get_area_schedule",
        description: "Look up who is assigned to an area or location group on a given service date.",
        parameters: {
          type: "OBJECT",
          properties: {
            area: { type: "STRING", description: "Area, location group name, or group code." },
            service_date: { type: "STRING", description: "Optional date in YYYY-MM-DD. Defaults to today service date." }
          },
          required: ["area"]
        }
      },
      {
        name: "get_employee_schedule",
        description: "Look up what areas an employee is assigned to on a given date.",
        parameters: {
          type: "OBJECT",
          properties: {
            employee_name: { type: "STRING", description: "Employee display name or partial name." },
            service_date: { type: "STRING", description: "Optional date in YYYY-MM-DD. Defaults to today service date." }
          },
          required: ["employee_name"]
        }
      },
      {
        name: "get_absence_coverage",
        description: "Find who is absent and who is covering their assigned areas on a given service date.",
        parameters: {
          type: "OBJECT",
          properties: {
            employee_name: { type: "STRING", description: "Optional absent employee name or partial name." },
            service_date: { type: "STRING", description: "Optional date in YYYY-MM-DD. Defaults to today service date." }
          }
        }
      },
      {
        name: "get_current_owner",
        description: "Find who currently owns a specific location according to the schedule system.",
        parameters: {
          type: "OBJECT",
          properties: {
            location_code: { type: "STRING", description: "Location code such as TETM or TETX." },
            at: { type: "STRING", description: "Optional ISO-like timestamp." }
          },
          required: ["location_code"]
        }
      },
      {
        name: "get_open_tickets",
        description: "List open maintenance tickets, optionally filtered by a location code or name.",
        parameters: {
          type: "OBJECT",
          properties: {
            location: { type: "STRING", description: "Optional location code or location name filter." }
          }
        }
      },
      {
        name: "get_dashboard_summary",
        description: "Get a summary of current operational dashboard metrics, attendance, and problem locations.",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "get_scan_state",
        description: "Check the scan system state for a specific location code.",
        parameters: {
          type: "OBJECT",
          properties: {
            location_code: { type: "STRING", description: "Location code to inspect." }
          },
          required: ["location_code"]
        }
      },
      {
        name: "list_active_employees",
        description: "List currently active employees in the system.",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      }
    ]
  }];
}

async function callGeminiGenerate({ apiKey, model, systemInstruction, contents, tools }) {
  const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools,
      generationConfig: { temperature: 0.2 }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
  }
  return payload;
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => typeof part?.text === "string" && part.text.trim()).map((part) => part.text.trim()).join("\n\n").trim();
}

function extractGeminiFunctionCalls(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => part?.functionCall && part.functionCall.name);
}

async function getDefaultServiceDate(runReadOnlySql) {
  const rows = await runReadOnlySql("select public.sch_service_date(now()) as service_date");
  return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
}

async function getRelativeServiceDate(runReadOnlySql, offsetDays = 0) {
  const safeOffset = Number.isFinite(Number(offsetDays)) ? Number(offsetDays) : 0;
  const rows = await runReadOnlySql(`select public.sch_service_date(now() + interval '${safeOffset} day') as service_date`);
  return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
}

function inferRelativeDateOffset(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("tomorrow")) return 1;
  if (lower.includes("yesterday")) return -1;
  return 0;
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
  return assignments.slice(0, 12).map((row) => {
    const employee = row.employee_name || row.assigned_employee_name || "Open";
    const group = row.group_name || row.group_code || "Unknown area";
    const start = row.coverage_start || "—";
    const end = row.coverage_end || "—";
    return `${employee} covers ${group} from ${start} to ${end}.`;
  }).join(" ");
}

function summarizeEmployeeAssignments(assignments = [], employeeName, serviceDate) {
  if (!assignments.length) return `I could not find schedule assignments for ${employeeName} on ${serviceDate}.`;
  return `${employeeName} on ${serviceDate}: ` + assignments.slice(0, 12).map((row) => {
    const group = row.group_name || row.group_code || "Unknown area";
    const start = row.coverage_start || "—";
    const end = row.coverage_end || "—";
    return `${group} from ${start} to ${end}`;
  }).join("; ") + ".";
}

function summarizeTickets(tickets = [], location = "") {
  if (!tickets.length) return location ? `There are no open tickets matching ${location}.` : "There are no open tickets right now.";
  return tickets.slice(0, 8).map((ticket) => `${ticket.location_name || ticket.location_code}: ${ticket.maintenance_issue}.`).join(" ");
}

function summarizeDashboard(snapshot = {}, attention = [], attendance = null) {
  const bits = [];
  if (attendance?.attendance != null) bits.push(`attendance ${attendance.attendance}`);
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

function summarizeAbsenceCoverage(data = {}, employeeName = "") {
  const serviceDate = data.service_date || "the requested day";
  const absentPeople = Array.isArray(data.absent_employees) ? data.absent_employees : [];
  const coverage = Array.isArray(data.coverage_rows) ? data.coverage_rows : [];
  const notes = Array.isArray(data.absence_notes) ? data.absence_notes : [];

  if (employeeName) {
    if (!coverage.length) {
      const notesText = notes.length ? ` Notes: ${notes.join(" | ")}` : "";
      return `I could not find explicit coverage rows for ${employeeName} on ${serviceDate}.${notesText}`.trim();
    }
    return `${employeeName} on ${serviceDate}: ` + coverage.slice(0, 12).map((row) => {
      const group = row.group_name || row.group_code || "Unknown area";
      const filler = row.assigned_employee_name || "Open";
      const start = row.coverage_start || "—";
      const end = row.coverage_end || "—";
      return `${group} is covered by ${filler} from ${start} to ${end}`;
    }).join("; ") + ".";
  }

  if (!absentPeople.length && !notes.length) {
    return `I do not see any absence notes or replacement coverage for ${serviceDate}.`;
  }

  const absentLine = absentPeople.length
    ? `Absent on ${serviceDate}: ${absentPeople.join(", ")}.`
    : `Absence notes exist for ${serviceDate}.`;
  const coverageLine = coverage.length
    ? ` Coverage examples: ${coverage.slice(0, 10).map((row) => `${row.group_name || row.group_code} covered by ${row.assigned_employee_name || "Open"} ${row.coverage_start || "—"}-${row.coverage_end || "—"}`).join("; ")}.`
    : "";
  return `${absentLine}${coverageLine}`.trim();
}

async function guessEmployeeName(runRpc, text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const employees = await runRpc("tool_list_active_employees", {});
  const list = Array.isArray(employees) ? employees : [];
  const lowered = raw.toLowerCase();

  let best = null;
  for (const employee of list) {
    const name = String(employee.display_name || employee.employee_name || "").trim();
    if (!name) continue;
    const nameLower = name.toLowerCase();
    if (lowered.includes(nameLower)) {
      if (!best || name.length > best.length) best = name;
      continue;
    }
    const parts = nameLower.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts.every((part) => lowered.includes(part))) {
      if (!best || name.length > best.length) best = name;
      continue;
    }
    if (parts.length && parts.some((part) => part.length >= 4 && lowered.includes(part))) {
      if (!best || name.length > best.length) best = name;
    }
  }
  return best || "";
}

function extractAbsentNames(notes = []) {
  const found = new Set();
  for (const note of notes) {
    const raw = String(note || "");
    const offMatch = raw.match(/([^\.]+?)\s+off/i);
    if (offMatch) {
      const names = offMatch[1]
        .replace(/^.*?:\s*/, "")
        .split(/,| and /i)
        .map((x) => x.trim())
        .filter(Boolean);
      names.forEach((name) => found.add(name));
    }
  }
  return Array.from(found);
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

    if (name === "get_absence_coverage") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const employeeName = String(args.employee_name || "").trim();
      const employeeRows = employeeName
        ? await runReadOnlySql(`
            select id, display_name
            from public.employees
            where active = true and display_name ilike ${sqlLikeLiteral(employeeName)}
            order by length(display_name), display_name
            limit 1
          `)
        : [];
      const employee = Array.isArray(employeeRows) && employeeRows.length ? employeeRows[0] : null;
      const coverageRows = employee
        ? await runReadOnlySql(`
            select
              lg.group_name,
              lg.group_code,
              to_char(dga.coverage_start, 'HH24:MI') as coverage_start,
              to_char(dga.coverage_end, 'HH24:MI') as coverage_end,
              ae.display_name as assigned_employee_name,
              de.display_name as derived_from_employee_name,
              dga.assignment_type,
              dga.reason_code,
              dga.notes
            from public.daily_group_assignments dga
            join public.location_groups lg on lg.id = dga.location_group_id
            left join public.employees ae on ae.id = dga.assigned_employee_id
            left join public.employees de on de.id = dga.derived_from_employee_id
            where dga.active = true
              and dga.assignment_date = '${esc(serviceDate)}'::date
              and (
                dga.derived_from_employee_id = '${esc(employee.id)}'::uuid
                or dga.notes ilike ${sqlLikeLiteral(employee.display_name)}
              )
            order by lg.group_name, dga.coverage_start asc nulls last
          `)
        : [];
      const noteRows = await runReadOnlySql(`
        select distinct notes
        from public.sch_get_daily_schedule('${esc(serviceDate)}'::date)
        where notes is not null and notes <> '' and notes ilike '%off%'
      `);
      const absenceNotes = (noteRows || []).map((row) => row.notes).filter(Boolean);
      return {
        service_date: serviceDate,
        employee_name: employee?.display_name || employeeName || null,
        absent_employees: extractAbsentNames(absenceNotes),
        absence_notes: absenceNotes,
        coverage_rows: coverageRows || []
      };
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
      const [snapshotRows, badRows, attendanceRows] = await Promise.all([
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
        `),
        runReadOnlySql(`
          select attendance, last_year, planned, yesterday, yesterday_plan, fetched_at, updated_at
          from public.current_attendance_state
          where id = 1
          limit 1
        `)
      ]);
      return {
        snapshot: Array.isArray(snapshotRows) && snapshotRows.length ? snapshotRows[0] : {},
        attention_locations: badRows || [],
        attendance: Array.isArray(attendanceRows) && attendanceRows.length ? attendanceRows[0] : null
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
    const relativeOffset = inferRelativeDateOffset(text);
    const relativeServiceDate = relativeOffset === 0
      ? await getDefaultServiceDate(runReadOnlySql)
      : await getRelativeServiceDate(runReadOnlySql, relativeOffset);

    if (lower.includes("event")) {
      const data = await executeTool("get_upcoming_events", { days: 14 });
      return { text: summarizeEvents(data.events), meta: { fallback: true, mode: "local_events" } };
    }

    if (lower.includes("ticket")) {
      const data = await executeTool("get_open_tickets", { location: findLocationCode(text) || "" });
      return { text: summarizeTickets(data.tickets, findLocationCode(text)), meta: { fallback: true, mode: "local_tickets" } };
    }

    if (lower.includes("absent") || lower.includes("off") || lower.includes("cover") || lower.includes("covering") || lower.includes("fill") || lower.includes("filling")) {
      const employeeName = await guessEmployeeName(runRpc, text);
      const data = await executeTool("get_absence_coverage", {
        employee_name: employeeName,
        service_date: relativeServiceDate
      });
      return {
        text: summarizeAbsenceCoverage(data, employeeName),
        meta: { fallback: true, mode: "local_absence_coverage" }
      };
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
        const stateValue = await executeTool("get_scan_state", { location_code: code });
        return {
          text: `${stateValue.location_name || stateValue.location_code || code} is currently ${stateValue.suggested_action || stateValue.status || "available"}.`,
          meta: { fallback: true, mode: "local_scan" }
        };
      }
    }

    if (lower.includes("schedule") || lower.includes("assigned") || lower.includes("working")) {
      const employeeName = await guessEmployeeName(runRpc, text);
      if (employeeName) {
        const data = await executeTool("get_employee_schedule", {
          employee_name: employeeName,
          service_date: relativeServiceDate
        });
        return {
          text: summarizeEmployeeAssignments(data.assignments, employeeName, data.service_date),
          meta: { fallback: true, mode: "local_employee_schedule" }
        };
      }

      if (/(today|tomorrow|group|teton|expo|zambezi|primate|event center|aquarium|restroom)/i.test(text)) {
        const data = await executeTool("get_area_schedule", {
          area: text,
          service_date: relativeServiceDate
        });
        return {
          text: summarizeAssignments(data.assignments, `I could not find schedule assignments for ${text} on ${data.service_date}.`),
          meta: { fallback: true, mode: "local_area_schedule" }
        };
      }
    }

    if (lower.includes("dashboard") || lower.includes("summary") || lower.includes("status") || lower.includes("metrics") || lower.includes("attendance")) {
      const data = await executeTool("get_dashboard_summary", {});
      return { text: summarizeDashboard(data.snapshot, data.attention_locations, data.attendance), meta: { fallback: true, mode: "local_dashboard" } };
    }

    return {
      text: "Memphis can help with schedules, absences and coverage, events, scan state, dashboard metrics, tickets, and employee assignments. Ask who is absent, who is covering, what events are coming up, what scan state a location is in, or what the dashboard is flagging.",
      meta: { fallback: true, mode: "local_generic" }
    };
  }

  async function generateReply({ deviceId = "", userMessage = "" }) {
    const apiKey = getGeminiApiKey();
    const identity = await fetchDeviceIdentity(runReadOnlySql, deviceId);
    const webEnabled = allowWebSearch({ deviceId, identityRole: identity?.role || "" });

    if (!apiKey) {
      return await generateLocalReply(userMessage);
    }

    const systemInstruction = buildSystemPrompt({ webEnabled });
    const model = DEFAULT_MODEL;
    const tools = buildGeminiTools();
    const contents = [{ role: "user", parts: [{ text: userMessage }] }];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const payload = await callGeminiGenerate({ apiKey, model, systemInstruction, contents, tools });
        const calls = extractGeminiFunctionCalls(payload);
        const text = extractGeminiText(payload);
        if (!calls.length) {
          return {
            text: text || "Memphis could not produce an answer for that yet.",
            meta: { fallback: false, provider: "gemini", model }
          };
        }
        const modelParts = payload?.candidates?.[0]?.content?.parts || [];
        contents.push({ role: "model", parts: modelParts });
        const functionResponseParts = [];
        for (const callPart of calls) {
          const name = callPart.functionCall.name;
          const args = callPart.functionCall.args || {};
          const output = await executeTool(name, args);
          functionResponseParts.push({ functionResponse: { name, response: output } });
        }
        contents.push({ role: "user", parts: functionResponseParts });
      }

      return {
        text: "Memphis hit a tool loop limit before finishing that answer.",
        meta: { fallback: false, provider: "gemini", model, loop_limit: true }
      };
    } catch (error) {
      console.error("memphis gemini path failed:", error);
      const local = await generateLocalReply(userMessage);
      return {
        text: local.text,
        meta: {
          ...(local.meta || {}),
          gemini_error: error?.message || "gemini_failed",
          provider: "gemini",
          model,
          web_enabled: webEnabled
        }
      };
    }
  }

  return { generateReply };
}
