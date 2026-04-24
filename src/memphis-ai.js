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

function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/pavillion/g, "pavilion")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function extractExplicitDate(text) {
  const match = String(text || "").match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match ? match[1] : null;
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

async function fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId) {
  const normalized = String(deviceId || "").trim();
  if (!normalized) return null;
  const rows = await runReadOnlySql(`
    select
      d.device_id,
      d.device_name,
      d.assigned_employee_id,
      e.display_name as assigned_employee_name,
      e.employee_code,
      e.role,
      d.active as device_active,
      coalesce(e.active, false) as employee_active
    from public.devices d
    left join public.employees e on e.id = d.assigned_employee_id
    where d.device_id = '${esc(normalized)}'
    limit 1
  `);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchThreadContext(runReadOnlySql, threadId) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return {};
  const rows = await runReadOnlySql(`select public.msg_get_memphis_thread_context('${esc(normalized)}'::uuid) as data`);
  return Array.isArray(rows) && rows.length && rows[0].data ? rows[0].data : {};
}

async function saveThreadContext(runRpc, threadId, context = {}) {
  const normalized = String(threadId || "").trim();
  if (!normalized) return null;
  return await runRpc("msg_set_memphis_thread_context", {
    p_thread_id: normalized,
    p_last_intent: context.last_intent ?? null,
    p_last_employee_name: context.last_employee_name ?? null,
    p_last_group_name: context.last_group_name ?? null,
    p_last_location_code: context.last_location_code ?? null,
    p_last_service_date: context.last_service_date ?? null,
    p_last_subject_type: context.last_subject_type ?? null,
    p_context_json: context.context_json ?? {}
  });
}

function buildSystemPrompt({ webEnabled }) {
  return [
    "You are Memphis, the operational assistant for Memphis Zoo custodial systems.",
    "Answer internal system questions about scans, locations, employees, schedules, absences, coverage, upcoming events, dashboard status, attendance, and open tickets.",
    "Use live scheduler views and current database facts whenever tools are available.",
    "Understand relative dates like today and tomorrow.",
    "If asked about my schedule on an employee device, resolve the employee assigned to that device.",
    "When the user refers to an area in normal speech, detect the area name inside the sentence.",
    "Explain why an area is open when the data supports it.",
    "Be direct, practical, and clear. No invented facts.",
    webEnabled
      ? "External web lookup is allowed on this device when clearly needed for current outside information."
      : "External web lookup is not allowed on this device. If asked for outside or general knowledge unrelated to Memphis Zoo systems, explain that this device is limited to internal system questions."
  ].join(" ");
}

function buildGeminiTools() {
  return [{
    functionDeclarations: [
      { name: "get_upcoming_events", description: "List upcoming Memphis Zoo events.", parameters: { type: "OBJECT", properties: { days: { type: "INTEGER" }, area: { type: "STRING" } } } },
      { name: "get_area_schedule", description: "Look up who is assigned to an area or location group on a given service date using the live scheduler.", parameters: { type: "OBJECT", properties: { area: { type: "STRING" }, service_date: { type: "STRING" } }, required: ["area"] } },
      { name: "get_employee_schedule", description: "Look up what areas an employee is assigned to on a given date using the live scheduler.", parameters: { type: "OBJECT", properties: { employee_name: { type: "STRING" }, service_date: { type: "STRING" } }, required: ["employee_name"] } },
      { name: "get_my_schedule", description: "Look up what the employee assigned to this device is scheduled to do.", parameters: { type: "OBJECT", properties: { device_id: { type: "STRING" }, service_date: { type: "STRING" } }, required: ["device_id"] } },
      { name: "get_absence_coverage", description: "Find who is absent and who is covering their assigned areas on a given service date.", parameters: { type: "OBJECT", properties: { employee_name: { type: "STRING" }, service_date: { type: "STRING" } } } },
      { name: "get_open_segments", description: "List currently open schedule segments, optionally filtered by area.", parameters: { type: "OBJECT", properties: { service_date: { type: "STRING" }, area: { type: "STRING" } } } },
      { name: "get_employee_load_summary", description: "Summarize employee load for a service date.", parameters: { type: "OBJECT", properties: { service_date: { type: "STRING" }, employee_name: { type: "STRING" } } } },
      { name: "explain_open_segment", description: "Explain why an area segment is open.", parameters: { type: "OBJECT", properties: { service_date: { type: "STRING" }, area: { type: "STRING" } }, required: ["area"] } },
      { name: "get_employee_profile", description: "Look up employee profile details including role, code, device assignment, and primary groups.", parameters: { type: "OBJECT", properties: { employee_name: { type: "STRING" } }, required: ["employee_name"] } },
      { name: "get_location_details", description: "Look up a location or area by code or name including type, form type, workload, and notes.", parameters: { type: "OBJECT", properties: { location: { type: "STRING" } }, required: ["location"] } },
      { name: "get_current_owner", description: "Find who currently owns a specific location according to the schedule system.", parameters: { type: "OBJECT", properties: { location_code: { type: "STRING" }, at: { type: "STRING" } }, required: ["location_code"] } },
      { name: "get_open_tickets", description: "List open maintenance tickets.", parameters: { type: "OBJECT", properties: { location: { type: "STRING" } } } },
      { name: "get_dashboard_summary", description: "Get a summary of current operational dashboard metrics.", parameters: { type: "OBJECT", properties: {} } },
      { name: "get_scan_state", description: "Check the scan system state for a specific location code.", parameters: { type: "OBJECT", properties: { location_code: { type: "STRING" } }, required: ["location_code"] } },
      { name: "list_active_employees", description: "List currently active employees in the system.", parameters: { type: "OBJECT", properties: {} } }
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
      generationConfig: { temperature: 0.3 }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
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
  if (!events.length) return "I don't see any upcoming events in the system right now. Quiet little patch of grass.";
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
  if (!assignments.length) return `I couldn't find schedule assignments for ${employeeName} on ${serviceDate}. Either they're clear, off, or the schedule gods are hiding the page.`;
  return `${employeeName} on ${serviceDate}: ` + assignments.slice(0, 12).map((row) => {
    const group = row.group_name || row.group_code || "Unknown area";
    const start = row.coverage_start || "—";
    const end = row.coverage_end || "—";
    return `${group} from ${start} to ${end}`;
  }).join("; ") + ".";
}

function summarizeTickets(tickets = [], location = "") {
  if (!tickets.length) return location ? `No open tickets matching ${location}. Small mercy.` : "No open tickets right now. The maintenance gremlins are behaving.";
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
  const focus = attention.length ? ` Attention locations: ${attention.slice(0, 8).map((row) => `${row.location_name || row.location_code} (${row.status_code}, ${row.open_ticket_count} tickets)`).join("; ")}.` : "";
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
      return `I couldn't find explicit coverage rows for ${employeeName} on ${serviceDate}.${notesText}`.trim();
    }
    return `${employeeName} on ${serviceDate}: ` + coverage.slice(0, 12).map((row) => {
      const group = row.group_name || row.group_code || "Unknown area";
      const filler = row.assigned_employee_name || "Open";
      const start = row.coverage_start || "—";
      const end = row.coverage_end || "—";
      return `${group} is covered by ${filler} from ${start} to ${end}`;
    }).join("; ") + ".";
  }

  if (!absentPeople.length && !notes.length) return `I don't see any absence notes or replacement coverage for ${serviceDate}. Nice when the board isn't on fire.`;
  const absentLine = absentPeople.length ? `Absent on ${serviceDate}: ${absentPeople.join(", ")}.` : `Absence notes exist for ${serviceDate}.`;
  const coverageLine = coverage.length ? ` Coverage examples: ${coverage.slice(0, 10).map((row) => `${row.group_name || row.group_code} covered by ${row.assigned_employee_name || "Open"} ${row.coverage_start || "—"}-${row.coverage_end || "—"}`).join("; ")}.` : "";
  return `${absentLine}${coverageLine}`.trim();
}

function summarizeEmployeeProfile(profile = null) {
  if (!profile) return "I couldn't find that employee in the system.";
  const parts = [`${profile.display_name} (${profile.employee_code || 'no code'})`];
  if (profile.role) parts.push(`role ${profile.role}`);
  if (profile.device_name) parts.push(`device ${profile.device_name}`);
  if (profile.primary_groups?.length) parts.push(`primary groups: ${profile.primary_groups.join(', ')}`);
  if (profile.secondary_groups?.length) parts.push(`secondary groups: ${profile.secondary_groups.join(', ')}`);
  return parts.join('. ') + '.';
}

function summarizeLocationDetails(data = {}) {
  if (!data?.location) return "I couldn't find that location in the system.";
  const loc = data.location;
  const parts = [`${loc.location_name} (${loc.location_code})`];
  if (loc.location_type) parts.push(`type ${loc.location_type}`);
  if (loc.form_type) parts.push(`form ${loc.form_type}`);
  if (loc.group_names?.length) parts.push(`groups: ${loc.group_names.join(', ')}`);
  if (loc.difficulty_rating != null || loc.priority_rating != null) parts.push(`difficulty ${loc.difficulty_rating ?? 'n/a'}, priority ${loc.priority_rating ?? 'n/a'}`);
  if (loc.workload_notes) parts.push(`workload notes: ${loc.workload_notes}`);
  if (loc.notes) parts.push(`notes: ${loc.notes}`);
  if (data.current_owner?.owner_display_name || data.current_owner?.employee_name) parts.push(`current owner ${data.current_owner.owner_display_name || data.current_owner.employee_name}`);
  return parts.join('. ') + '.';
}

function summarizeLoadSummary(rows = [], serviceDate = "") {
  if (!rows.length) return `I don't see any employee load rows for ${serviceDate || 'that day'}.`;
  return rows.slice(0, 12).map((row) => `${row.employee_name}: ${row.assigned_segments} segments, ${row.assigned_load_points} load points, ${Math.round(Number(row.assigned_minutes || 0))} minutes`).join("; ") + ".";
}

function summarizeOpenSegments(rows = [], serviceDate = "") {
  if (!rows.length) return `I don't see any open segments for ${serviceDate || 'that day'}.`;
  return rows.slice(0, 12).map((row) => `${row.group_name || row.group_code} ${row.coverage_start || '—'}-${row.coverage_end || '—'} (${row.reason_open || 'open'})`).join("; ") + ".";
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
      const names = offMatch[1].replace(/^.*?:\s*/, "").split(/,| and /i).map((x) => x.trim()).filter(Boolean);
      names.forEach((name) => found.add(name));
    }
  }
  return Array.from(found);
}

async function getLiveScheduleRows(runReadOnlySql, serviceDate) {
  return await runReadOnlySql(`select * from public.sch_get_daily_schedule('${esc(serviceDate)}'::date)`);
}

function inferIntent(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/(my schedule|what am i assigned|what am i doing)/i.test(lower)) return "my_schedule";
  if (/(who is off|who'?s off|absent|covering|fill in|filling in|cover)/i.test(lower)) return "absence_coverage";
  if (/(open segments|what is open|who is open|uncovered|unassigned)/i.test(lower)) return "open_segments";
  if (/(load|heaviest day|workload|busy)/i.test(lower)) return "employee_load_summary";
  if (/(who owns|current owner|who has)/i.test(lower)) return "current_owner";
  if (/(tickets|maintenance)/i.test(lower)) return "open_tickets";
  if (/(events|event)/i.test(lower)) return "upcoming_events";
  if (/(dashboard|summary|attendance|overdue)/i.test(lower)) return "dashboard_summary";
  if (/(who is assigned|assigned to|schedule for|who has)/i.test(lower)) return "area_schedule";
  return "generic";
}

async function resolveAreaName(runReadOnlySql, text = "", threadContext = {}) {
  const raw = String(text || "").trim();
  const contextArea = String(threadContext?.last_group_name || "").trim();
  if (!raw && contextArea) return contextArea;
  const rows = await runReadOnlySql(`
    select distinct group_name, group_code
    from public.v_memphis_area_schedule
    where lower('${esc(raw)}') like '%' || lower(group_name) || '%'
       or lower('${esc(raw)}') like '%' || lower(group_code) || '%'
       or group_name ilike ${sqlLikeLiteral(raw)}
       or group_code ilike ${sqlLikeLiteral(raw)}
    order by length(group_name), group_name
    limit 1
  `);
  if (Array.isArray(rows) && rows.length) return rows[0].group_name || rows[0].group_code || contextArea || raw;
  return contextArea || raw;
}

function mergeContextDate(text, threadContext = {}, explicitServiceDate = null) {
  if (explicitServiceDate) return explicitServiceDate;
  const direct = extractExplicitDate(text);
  if (direct) return direct;
  return threadContext?.last_service_date || null;
}

export function createMemphisResponder({ runReadOnlySql, runRpc }) {
  async function executeTool(name, args = {}) {
    if (name === "get_upcoming_events") {
      const days = toSafeInt(args.days, 14, 1, 60);
      const area = String(args.area || "").trim();
      const rows = await runReadOnlySql(`
        select e.event_name, lg.group_name, lg.group_code, e.event_date, to_char(e.start_time, 'HH24:MI:SS') as start_time, to_char(e.end_time, 'HH24:MI:SS') as end_time, e.attendee_count, e.notes
        from public.events_app_events e
        join public.location_groups lg on lg.id = e.location_group_id
        where e.event_date >= current_date
          and e.event_date <= current_date + ${days}
          ${area ? `and (lg.group_name ilike ${sqlLikeLiteral(area)} or lg.group_code ilike ${sqlLikeLiteral(area)} or lower('${esc(area)}') like '%' || lower(lg.group_name) || '%')` : ""}
        order by e.event_date asc, e.start_time asc, e.event_name asc
      `);
      return { events: rows || [] };
    }

    if (name === "get_area_schedule") {
      const area = String(args.area || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_area_schedule
        where service_date = '${esc(serviceDate)}'::date
          and (
            group_name ilike ${sqlLikeLiteral(area)}
            or group_code ilike ${sqlLikeLiteral(area)}
            or lower('${esc(area)}') like '%' || lower(group_name) || '%'
            or lower('${esc(area)}') like '%' || lower(group_code) || '%'
          )
        order by group_name asc, segment_number asc
      `);
      return { service_date: serviceDate, assignments: rows || [] };
    }

    if (name === "get_employee_schedule") {
      const employeeName = String(args.employee_name || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      if (!employeeName) return { service_date: serviceDate, assignments: [] };
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_employee_schedule
        where service_date = '${esc(serviceDate)}'::date
          and employee_name ilike ${sqlLikeLiteral(employeeName)}
        order by group_name asc, segment_number asc
      `);
      return { service_date: serviceDate, assignments: rows || [] };
    }

    if (name === "get_my_schedule") {
      const deviceId = String(args.device_id || "").trim();
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const assignedEmployee = await fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId);
      if (!assignedEmployee?.assigned_employee_name) return { service_date: serviceDate, employee_name: null, assignments: [] };
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_employee_schedule
        where service_date = '${esc(serviceDate)}'::date
          and employee_id = '${esc(assignedEmployee.assigned_employee_id)}'::uuid
        order by group_name asc, segment_number asc
      `);
      return { service_date: serviceDate, employee_name: assignedEmployee.assigned_employee_name, assignments: rows || [] };
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
      const coverageRows = await runReadOnlySql(`
        select *
        from public.v_memphis_absence_coverage
        where service_date = '${esc(serviceDate)}'::date
        ${employee ? `and absent_employee_id = '${esc(employee.id)}'::uuid` : ""}
        order by absent_employee_name asc, group_name asc, segment_number asc
      `);
      const noteRows = await runReadOnlySql(`
        select distinct notes
        from public.v_memphis_open_segments
        where service_date = '${esc(serviceDate)}'::date
          and notes is not null and notes <> '' and notes ilike '%off%'
      `);
      const absenceNotes = (noteRows || []).map((row) => row.notes).filter(Boolean);
      return {
        service_date: serviceDate,
        employee_name: employee?.display_name || employeeName || null,
        absent_employees: Array.from(new Set((coverageRows || []).map((row) => row.absent_employee_name).filter(Boolean))),
        absence_notes: absenceNotes,
        coverage_rows: coverageRows || []
      };
    }

    if (name === "get_open_segments") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const area = String(args.area || "").trim();
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_open_segments
        where service_date = '${esc(serviceDate)}'::date
        ${area ? `and (group_name ilike ${sqlLikeLiteral(area)} or group_code ilike ${sqlLikeLiteral(area)} or lower('${esc(area)}') like '%' || lower(group_name) || '%')` : ""}
        order by group_name asc, segment_number asc
      `);
      return { service_date: serviceDate, open_segments: rows || [] };
    }

    if (name === "get_employee_load_summary") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const employeeName = String(args.employee_name || "").trim();
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_employee_load_summary
        where service_date = '${esc(serviceDate)}'::date
        ${employeeName ? `and employee_name ilike ${sqlLikeLiteral(employeeName)}` : ""}
        order by assigned_load_points desc, assigned_segments desc, employee_name asc
      `);
      return { service_date: serviceDate, load_rows: rows || [] };
    }

    if (name === "explain_open_segment") {
      const serviceDate = normalizeDate(args.service_date) || await getDefaultServiceDate(runReadOnlySql);
      const area = String(args.area || "").trim();
      const rows = await runReadOnlySql(`
        select *
        from public.v_memphis_open_segments
        where service_date = '${esc(serviceDate)}'::date
          and (
            group_name ilike ${sqlLikeLiteral(area)}
            or group_code ilike ${sqlLikeLiteral(area)}
            or lower('${esc(area)}') like '%' || lower(group_name) || '%'
            or lower('${esc(area)}') like '%' || lower(group_code) || '%'
          )
        order by segment_number asc
        limit 5
      `);
      return { service_date: serviceDate, open_segments: rows || [] };
    }

    if (name === "get_employee_profile") {
      const employeeName = String(args.employee_name || "").trim();
      const rows = await runReadOnlySql(`
        with employee_match as (
          select id, display_name, employee_code, role, active
          from public.employees
          where display_name ilike ${sqlLikeLiteral(employeeName)}
          order by length(display_name), display_name
          limit 1
        ), primary_groups as (
          select array_agg(lg.group_name order by lg.group_name) as names
          from public.employee_primary_group_assignments epga
          join employee_match em on em.id = epga.employee_id
          join public.location_groups lg on lg.id = epga.location_group_id
          where epga.active = true
        ), secondary_groups as (
          select array_agg(lg.group_name order by lg.group_name) as names
          from public.employee_location_group_assignments elga
          join employee_match em on em.id = elga.employee_id
          join public.location_groups lg on lg.id = elga.location_group_id
          where elga.active = true
        ), device_assignment as (
          select d.device_name
          from public.devices d
          join employee_match em on em.id = d.assigned_employee_id
          where d.active = true
          order by d.device_name
          limit 1
        )
        select em.display_name, em.employee_code, em.role, em.active,
               coalesce((select names from primary_groups), array[]::text[]) as primary_groups,
               coalesce((select names from secondary_groups), array[]::text[]) as secondary_groups,
               (select device_name from device_assignment) as device_name
        from employee_match em
      `);
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    }

    if (name === "get_location_details") {
      const location = String(args.location || "").trim();
      const locationRows = await runReadOnlySql(`
        with location_match as (
          select l.id, l.location_code, l.location_name, l.location_type, l.form_type, l.active, l.notes, l.difficulty_rating, l.priority_rating, l.workload_notes
          from public.locations l
          where l.active = true
            and (
              l.location_code ilike ${sqlLikeLiteral(location)}
              or l.location_name ilike ${sqlLikeLiteral(location)}
              or lower('${esc(location)}') like '%' || lower(l.location_code) || '%'
              or lower('${esc(location)}') like '%' || lower(l.location_name) || '%'
            )
          order by case when lower(l.location_code)=lower('${esc(location)}') then 0 else 1 end, length(l.location_name), l.location_name
          limit 1
        )
        select lm.*, coalesce(array_agg(distinct lg.group_name) filter (where lg.group_name is not null), array[]::text[]) as group_names
        from location_match lm
        left join public.location_group_memberships lgm on lgm.location_id = lm.id and lgm.active = true
        left join public.location_groups lg on lg.id = lgm.location_group_id and lg.active = true
        group by lm.id, lm.location_code, lm.location_name, lm.location_type, lm.form_type, lm.active, lm.notes, lm.difficulty_rating, lm.priority_rating, lm.workload_notes
      `);
      const loc = Array.isArray(locationRows) && locationRows.length ? locationRows[0] : null;
      if (!loc) return { location: null, current_owner: null };
      const ownerRows = await runReadOnlySql(`select * from public.sch_get_current_owner('${esc(loc.location_code)}', now())`);
      return { location: loc, current_owner: Array.isArray(ownerRows) && ownerRows.length ? ownerRows[0] : null };
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
        select ticket_id, location_code, location_name, maintenance_issue, reported_by, fixture_type, fixture_identifier, out_of_order, date_submitted_display, created_at_display
        from public.v_open_maintenance_tickets
        ${location ? `where location_code ilike ${sqlLikeLiteral(location)} or location_name ilike ${sqlLikeLiteral(location)}` : ""}
        order by date_submitted desc nulls last, created_at desc nulls last
        limit 50
      `);
      return { tickets: rows || [] };
    }

    if (name === "get_dashboard_summary") {
      const [snapshotRows, badRows, attendanceRows] = await Promise.all([
        runReadOnlySql(`select * from public.v_admin_health_snapshot order by snapshot_at desc limit 1`),
        runReadOnlySql(`
          select location_code, location_name, status_code, status_color, open_ticket_count, latest_employee_name, latest_completed_at_display, open_session_status
          from public.v_location_dashboard_status
          where status_code <> 'okay' or open_ticket_count > 0
          order by case status_color when 'red' then 1 when 'yellow' then 2 when 'blue' then 3 else 9 end, open_ticket_count desc, location_name
          limit 15
        `),
        runReadOnlySql(`select attendance, last_year, planned, yesterday, yesterday_plan, fetched_at, updated_at from public.current_attendance_state where id = 1 limit 1`)
      ]);
      return {
        snapshot: Array.isArray(snapshotRows) && snapshotRows.length ? snapshotRows[0] : {},
        attention_locations: badRows || [],
        attendance: Array.isArray(attendanceRows) && attendanceRows.length ? attendanceRows[0] : null
      };
    }

    if (name === "get_scan_state") {
      const locationCode = String(args.location_code || "").trim();
      return await runRpc("tool_get_location_scan_state", { p_location_code: locationCode, p_device_id: DEFAULT_SCAN_DEVICE_ID });
    }

    if (name === "list_active_employees") {
      const data = await runRpc("tool_list_active_employees", {});
      return { employees: Array.isArray(data) ? data : [] };
    }

    throw new Error(`Unknown Memphis tool: ${name}`);
  }

  async function generateLocalReply(userMessage, { deviceId = "", threadId = "" } = {}) {
    const text = String(userMessage || "").trim();
    const lower = text.toLowerCase();
    const threadContext = await fetchThreadContext(runReadOnlySql, threadId);
    const relativeOffset = inferRelativeDateOffset(text);
    const relativeServiceDate = mergeContextDate(text, threadContext, extractExplicitDate(text)) || (relativeOffset === 0 ? await getDefaultServiceDate(runReadOnlySql) : await getRelativeServiceDate(runReadOnlySql, relativeOffset));
    const assignedEmployee = await fetchAssignedEmployeeForDevice(runReadOnlySql, deviceId);
    let nextContext = { context_json: {} };

    if (lower.includes("event")) {
      const area = await resolveAreaName(runReadOnlySql, text, threadContext);
      const data = await executeTool("get_upcoming_events", { days: 14, area });
      nextContext = { last_intent: 'upcoming_events', last_group_name: area || null, last_service_date: relativeServiceDate, last_subject_type: 'group' };
      await saveThreadContext(runRpc, threadId, nextContext);
      return { text: summarizeEvents(data.events), meta: { fallback: true, mode: "local_events" } };
    }

    if (lower.includes("ticket")) {
      const data = await executeTool("get_open_tickets", { location: findLocationCode(text) || text });
      nextContext = { last_intent: 'open_tickets', last_location_code: findLocationCode(text) || null, last_service_date: relativeServiceDate, last_subject_type: 'location' };
      await saveThreadContext(runRpc, threadId, nextContext);
      return { text: summarizeTickets(data.tickets, findLocationCode(text)), meta: { fallback: true, mode: "local_tickets" } };
    }

    if (/(absent|off|cover|covering|fill|filling)/i.test(lower)) {
      const employeeName = await guessEmployeeName(runRpc, text) || threadContext?.last_employee_name || "";
      const data = await executeTool("get_absence_coverage", { employee_name: employeeName, service_date: relativeServiceDate });
      nextContext = { last_intent: 'absence_coverage', last_employee_name: employeeName || null, last_service_date: relativeServiceDate, last_subject_type: 'employee' };
      await saveThreadContext(runRpc, threadId, nextContext);
      return { text: summarizeAbsenceCoverage(data, employeeName), meta: { fallback: true, mode: "local_absence_coverage" } };
    }

    if ((lower.includes("my schedule") || lower === "schedule" || lower.includes("what am i assigned") || lower.includes("what am i doing today")) && assignedEmployee?.assigned_employee_name) {
      const data = await executeTool("get_my_schedule", { device_id: deviceId, service_date: relativeServiceDate });
      nextContext = { last_intent: 'my_schedule', last_employee_name: data.employee_name || assignedEmployee.assigned_employee_name, last_service_date: relativeServiceDate, last_subject_type: 'employee' };
      await saveThreadContext(runRpc, threadId, nextContext);
      return { text: summarizeEmployeeAssignments(data.assignments, data.employee_name || assignedEmployee.assigned_employee_name, data.service_date), meta: { fallback: true, mode: "local_my_schedule" } };
    }

    if (/(open segments|what is open|what's open|uncovered|unassigned)/i.test(lower)) {
      const area = await resolveAreaName(runReadOnlySql, text, threadContext);
      const data = await executeTool("get_open_segments", { service_date: relativeServiceDate, area });
      nextContext = { last_intent: 'open_segments', last_group_name: area || null, last_service_date: relativeServiceDate, last_subject_type: 'group' };
      await saveThreadContext(runRpc, threadId, nextContext);
      return { text: summarizeOpenSegments(data.open_segments, data.service_date), meta: { fallback: true, mode: 'local_open_segments' } };
    }

    if (/(load|workload|heaviest|busy)/i.test(lower)) {
      const employeeName = await guessEmployeeName(runRpc, text) || threadContext?.last_employee_name || "";
      const data = await executeTool("get_employee_load_summary", { service_date: relativeServiceDate, employee_name: employeeName });
      nextContext = { last_intent: 'employee_load_summary', last_employee_name: employeeName || null, last_service_date: relativeServiceDate, last_subject_type: employeeName ? 'employee' : 'summary' };
      await saveThreadContext(runRpc, threadId, nextContext);
      return { text: summarizeLoadSummary(data.load_rows, data.service_date), meta: { fallback: true, mode: 'local_load_summary' } };
    }

    if (/(why is .* open|why is .* uncovered|why open)/i.test(lower)) {
      const area = await resolveAreaName(runReadOnlySql, text, threadContext);
      const data = await executeTool("explain_open_segment", { service_date: relativeServiceDate, area });
      nextContext = { last_intent: 'explain_open_segment', last_group_name: area || null, last_service_date: relativeServiceDate, last_subject_type: 'group' };
      await saveThreadContext(runRpc, threadId, nextContext);
      if (!data.open_segments?.length) return { text: `I do not see an open segment for ${area} on ${relativeServiceDate}.`, meta: { fallback: true, mode: 'local_explain_open' } };
      return { text: summarizeOpenSegments(data.open_segments, data.service_date), meta: { fallback: true, mode: 'local_explain_open' } };
    }

    if (lower.includes("employee") || lower.includes("role") || lower.includes("device")) {
      const employeeName = await guessEmployeeName(runRpc, text) || threadContext?.last_employee_name || "";
      if (employeeName) {
        const profile = await executeTool("get_employee_profile", { employee_name: employeeName });
        nextContext = { last_intent: 'employee_profile', last_employee_name: employeeName, last_service_date: relativeServiceDate, last_subject_type: 'employee' };
        await saveThreadContext(runRpc, threadId, nextContext);
        return { text: summarizeEmployeeProfile(profile), meta: { fallback: true, mode: "local_employee_profile" } };
      }
    }

    if (lower.includes("location") || lower.includes("where is") || lower.includes("what is") || lower.includes("tell me about")) {
      const code = findLocationCode(text) || threadContext?.last_location_code || "";
      const query = code || text || threadContext?.last_group_name || "";
      const data = await executeTool("get_location_details", { location: query });
      if (data?.location) {
        nextContext = { last_intent: 'location_details', last_group_name: data.location.location_name || null, last_location_code: data.location.location_code || null, last_service_date: relativeServiceDate, last_subject_type: 'location' };
        await saveThreadContext(runRpc, threadId, nextContext);
        return { text: summarizeLocationDetails(data), meta: { fallback: true, mode: "local_location_details" } };
      }
    }

    if (lower.includes("owner") || lower.includes("who owns") || lower.includes("who has")) {
      const code = findLocationCode(text) || threadContext?.last_location_code || "";
      if (code) {
        const owner = await executeTool("get_current_owner", { location_code: code });
        nextContext = { last_intent: 'current_owner', last_location_code: code, last_service_date: relativeServiceDate, last_subject_type: 'location' };
        await saveThreadContext(runRpc, threadId, nextContext);
        if (!owner) return { text: `I could not find a current owner for ${code}.`, meta: { fallback: true, mode: "local_owner" } };
        return { text: `${owner.location_name || owner.location_code || code} is currently owned by ${owner.owner_display_name || owner.employee_name || "nobody listed"}.`, meta: { fallback: true, mode: "local_owner" } };
      }
    }

    if (lower.includes("scan") || lower.includes("state")) {
      const code = findLocationCode(text) || threadContext?.last_location_code || "";
      if (code) {
        const stateValue = await executeTool("get_scan_state", { location_code: code });
        nextContext = { last_intent: 'scan_state', last_location_code: code, last_service_date: relativeServiceDate, last_subject_type: 'location' };
        await saveThreadContext(runRpc, threadId, nextContext);
        return { text: `${stateValue.location_name || stateValue.location_code || code} is currently ${stateValue.suggested_action || stateValue.status || "available"}.`, meta: { fallback: true, mode: "local_scan" } };
      }
    }

    if (lower.includes("schedule") || lower.includes("assigned") || lower.includes("working") || lower.includes("aquarium") || lower.includes("restroom") || lower.includes("zambezi") || lower.includes("teton") || lower.includes("expo")) {
      const employeeName = await guessEmployeeName(runRpc, text) || threadContext?.last_employee_name || "";
      if (employeeName) {
        const data = await executeTool("get_employee_schedule", { employee_name: employeeName, service_date: relativeServiceDate });
        nextContext = { last_intent: 'employee_schedule', last_employee_name: employeeName, last_service_date: relativeServiceDate, last_subject_type: 'employee' };
        await saveThreadContext(runRpc, threadId, nextContext);
        return { text: summarizeEmployeeAssignments(data.assignments, employeeName, data.service_date), meta: { fallback: true, mode: "local_employee_schedule" } };
      }
      const area = await resolveAreaName(runReadOnlySql, text, threadContext);
      const data = await executeTool("get_area_schedule", { area, service_date: relativeServiceDate });
      nextContext = { last_intent: 'area_schedule', last_group_name: area || null, last_service_date: relativeServiceDate, last_subject_type: 'group' };
      await saveThreadContext(runRpc, threadId, nextContext);
      return { text: summarizeAssignments(data.assignments, `I couldn't find schedule assignments for ${area || text} on ${data.service_date}.`), meta: { fallback: true, mode: "local_area_schedule" } };
    }

    if (lower.includes("dashboard") || lower.includes("summary") || lower.includes("status") || lower.includes("metrics") || lower.includes("attendance")) {
      const data = await executeTool("get_dashboard_summary", {});
      nextContext = { last_intent: 'dashboard_summary', last_service_date: relativeServiceDate, last_subject_type: 'summary' };
      await saveThreadContext(runRpc, threadId, nextContext);
      return { text: summarizeDashboard(data.snapshot, data.attention_locations, data.attendance), meta: { fallback: true, mode: "local_dashboard" } };
    }

    await saveThreadContext(runRpc, threadId, { last_intent: inferIntent(text), last_service_date: relativeServiceDate, last_subject_type: 'generic' });
    return {
      text: "I can help with scans, locations, employees, live schedules, absences and coverage, open segments, workload, events, dashboard metrics, tickets, and current ownership. Ask me who has Aquarium, who is off, what is open, or what your device is assigned today.",
      meta: { fallback: true, mode: "local_generic" }
    };
  }

  async function generateReply({ deviceId = "", userMessage = "", threadId = "" }) {
    const apiKey = getGeminiApiKey();
    const identity = await fetchDeviceIdentity(runReadOnlySql, deviceId);
    const webEnabled = allowWebSearch({ deviceId, identityRole: identity?.role || "" });

    if (!apiKey) return await generateLocalReply(userMessage, { deviceId, threadId });

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
          await saveThreadContext(runRpc, threadId, { last_intent: inferIntent(userMessage), last_service_date: extractExplicitDate(userMessage) || null, last_subject_type: 'generic' });
          return { text: text || "I couldn't produce a clean answer for that yet.", meta: { fallback: false, provider: "gemini", model } };
        }
        const modelParts = payload?.candidates?.[0]?.content?.parts || [];
        contents.push({ role: "model", parts: modelParts });
        const functionResponseParts = [];
        for (const callPart of calls) {
          const name = callPart.functionCall.name;
          const args = callPart.functionCall.args || {};
          if (name === 'get_my_schedule' && !args.device_id && deviceId) args.device_id = deviceId;
          const output = await executeTool(name, args);
          functionResponseParts.push({ functionResponse: { name, response: output } });
        }
        contents.push({ role: "user", parts: functionResponseParts });
      }
      return { text: "I hit a tool loop limit before finishing that answer. Very glamorous, I know.", meta: { fallback: false, provider: "gemini", model, loop_limit: true } };
    } catch (error) {
      console.error("memphis gemini path failed:", error);
      const local = await generateLocalReply(userMessage, { deviceId, threadId });
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
