import express from "express";

const MONTH_LOOKUP = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const PTO_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const PTO_GEMINI_MODEL = String(process.env.SCHEDULE_GEMINI_MODEL || process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const PTO_GEMINI_TIMEOUT_MS = Math.max(1000, Number.parseInt(String(process.env.SCHEDULE_GEMINI_TIMEOUT_MS || process.env.MEMPHIS_GEMINI_TIMEOUT_MS || "12000"), 10) || 12000);
const PTO_GEMINI_MAX_OUTPUT_TOKENS = Math.max(256, Number.parseInt(String(process.env.SCHEDULE_GEMINI_MAX_OUTPUT_TOKENS || "1200"), 10) || 1200);

function getScheduleGeminiApiKey() {
  return String(
    process.env.SCHEDULE_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.MEMPHIS_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    ""
  ).trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PTO_GEMINI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildDate(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (date.getUTCFullYear() !== year || (date.getUTCMonth() + 1) !== month || date.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizePossibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const monthNames = Object.keys(MONTH_LOOKUP).sort((a, b) => b.length - a.length).join("|");
  let match = raw.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\.?(?:,?\\s*(\\d{2,4}))?\\b`, "i"));
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    return buildDate(year, MONTH_LOOKUP[String(match[2]).toLowerCase()], Number(match[1]));
  }

  match = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    return buildDate(year, Number(match[1]), Number(match[2]));
  }

  match = raw.match(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{2,4}))?\\b`, "i"));
  if (match) {
    const year = match[3] ? Number(String(match[3]).length === 2 ? `20${match[3]}` : match[3]) : NaN;
    return buildDate(year, MONTH_LOOKUP[String(match[1]).toLowerCase()], Number(match[2]));
  }

  return "";
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function createScheduleRouter({
  runReadOnlySql,
  runRpc,
  runWriteSql,
  buildHealthPayload,
  requireAdminApiAuth,
  appVersion,
  releaseId,
  contractVersion,
}) {
  const router = express.Router();
  const requireSchedulePin = requireAdminApiAuth;
  const AUTO_GENERATE_WINDOW_DAYS = 7;
  const AUTO_GENERATE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  let autoGenerateState = { lastStartedAt: 0, running: false, lastCompletedAt: 0, lastWindowStart: null, lastResult: [] };

  function fail(res, error, fallback = "Schedule request failed", status = 400) {
    res.status(status).json({ ok: false, error: error?.message || fallback });
  }

  function esc(value) {
    return String(value ?? "").replace(/'/g, "''");
  }

  function requireDate(value, fallback = null) {
    const raw = String(value || fallback || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new Error("service_date must be YYYY-MM-DD.");
    }
    return raw;
  }

  function requireTime(value) {
    const raw = String(value || "").trim();
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
      throw new Error("closing_time must be HH:MM or HH:MM:SS.");
    }
    return raw;
  }

  function optionalTimestampLiteral(value) {
    const raw = String(value || "").trim();
    if (!raw) return "now()";
    if (!/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(raw)) {
      throw new Error("at must be an ISO-like timestamp.");
    }
    return `'${esc(raw)}'::timestamptz`;
  }

  function uuidArrayLiteral(values) {
    if (!Array.isArray(values)) throw new Error("absent_employee_ids must be an array of UUID strings.");
    const cleaned = values.map((x) => String(x || "").trim()).filter(Boolean);
    for (const id of cleaned) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error(`Invalid UUID: ${id}`);
      }
    }
    return `array[${cleaned.map((id) => `'${esc(id)}'::uuid`).join(",")}]::uuid[]`;
  }

  function normalizeUuidList(values) {
    if (!Array.isArray(values)) return [];
    const cleaned = values.map((x) => String(x || "").trim()).filter(Boolean);
    for (const id of cleaned) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error(`Invalid UUID: ${id}`);
      }
    }
    return Array.from(new Set(cleaned));
  }

  async function listPtoRows({ startDate, endDate = startDate } = {}) {
    const rows = await runReadOnlySql(`
      select *
      from (
        select
          p.id,
          p.employee_id,
          e.display_name as employee_name,
          e.employee_code,
          p.start_date,
          p.end_date,
          p.pto_type,
          p.source,
          p.notes,
          p.active,
          p.created_at,
          p.updated_at,
          'employee_planned_time_off'::text as source_table
        from public.employee_planned_time_off p
        join public.employees e on e.id = p.employee_id
        where p.active = true
          and p.start_date <= '${esc(endDate)}'::date
          and p.end_date >= '${esc(startDate)}'::date

        union all

        select
          ep.id,
          ep.employee_id,
          e.display_name as employee_name,
          e.employee_code,
          ep.start_date,
          ep.end_date,
          ep.absence_type as pto_type,
          'employee_pto'::text as source,
          ep.notes,
          ep.active,
          ep.created_at,
          ep.updated_at,
          'employee_pto'::text as source_table
        from public.employee_pto ep
        join public.employees e on e.id = ep.employee_id
        where ep.active = true
          and ep.start_date <= '${esc(endDate)}'::date
          and ep.end_date >= '${esc(startDate)}'::date

        union all

        select
          dao.id,
          dao.employee_id,
          e.display_name as employee_name,
          e.employee_code,
          dao.absence_date as start_date,
          dao.absence_date as end_date,
          dao.absence_type as pto_type,
          'daily_absence_overrides'::text as source,
          dao.notes,
          dao.active,
          dao.created_at,
          dao.updated_at,
          'daily_absence_overrides'::text as source_table
        from public.daily_absence_overrides dao
        join public.employees e on e.id = dao.employee_id
        where dao.active = true
          and dao.absence_date between '${esc(startDate)}'::date and '${esc(endDate)}'::date
      ) pto
      order by start_date asc, employee_name asc, end_date asc, source_table asc
    `);
    return Array.isArray(rows) ? rows : [];
  }

  async function hasPtoTable() {
    const rows = await runReadOnlySql(`
      select
        to_regclass('public.employee_planned_time_off') is not null
        or to_regclass('public.employee_pto') is not null
        or to_regclass('public.daily_absence_overrides') is not null as exists
    `);
    return Boolean(Array.isArray(rows) && rows.length && rows[0].exists);
  }

  async function getPtoAbsentEmployeeIds(serviceDate) {
    const rows = await runReadOnlySql(`
      select distinct employee_id
      from (
        select employee_id
        from public.employee_planned_time_off
        where active = true
          and start_date <= '${esc(serviceDate)}'::date
          and end_date >= '${esc(serviceDate)}'::date

        union

        select employee_id
        from public.employee_pto
        where active = true
          and start_date <= '${esc(serviceDate)}'::date
          and end_date >= '${esc(serviceDate)}'::date

        union

        select employee_id
        from public.daily_absence_overrides
        where active = true
          and absence_date = '${esc(serviceDate)}'::date
      ) absent
      order by employee_id
    `);
    return Array.isArray(rows) ? rows.map((row) => String(row.employee_id || "").trim()).filter(Boolean) : [];
  }

  async function mergeExplicitAndPtoAbsences(serviceDate, explicitIds = []) {
    const explicit = normalizeUuidList(explicitIds);
    const ptoIds = await getPtoAbsentEmployeeIds(serviceDate);
    return {
      explicit,
      pto_ids: ptoIds,
      merged: Array.from(new Set([...explicit, ...ptoIds])),
    };
  }

  const COVERALL_SLOT_CODES = ["COVERALL_01", "COVERALL_02", "COVERALL_03", "COVERALL_04"];

  function normalizeCoverAllSlotCode(value) {
    const raw = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    const numberMatch = raw.match(/(?:COVERALL_?)?(\d{1,2})$/);
    if (numberMatch) {
      const slot = `COVERALL_${String(Number(numberMatch[1])).padStart(2, "0")}`;
      return COVERALL_SLOT_CODES.includes(slot) ? slot : "";
    }
    return COVERALL_SLOT_CODES.includes(raw) ? raw : "";
  }

  function coverAllDisplayName(slotCode) {
    return `CoverAll_${String(slotCode || "").split("_").pop() || "01"}`;
  }

  function coverAllPublicPath(serviceDate, slotCode, lang = "en") {
    return `/schedule-api/coverall/assignment?service_date=${encodeURIComponent(serviceDate)}&slot=${encodeURIComponent(slotCode)}&lang=${encodeURIComponent(lang)}`;
  }

  async function ensureCoverAllSlots() {
    if (typeof runWriteSql !== "function") throw new Error("CoverAll write path is not configured.");
    const valuesSql = COVERALL_SLOT_CODES.map((slotCode) => `(
      '${esc(slotCode)}',
      '${esc(coverAllDisplayName(slotCode))}',
      true,
      'staff',
      'Third-party CoverAll custodial slot. Used for extra event/traffic help or 3+ absence escalation.'
    )`).join(",\n");

    await runWriteSql("coverall_slots_seed", `
      insert into public.employees (employee_code, display_name, active, role, notes)
      values ${valuesSql}
      on conflict (employee_code) do update set
        display_name = excluded.display_name,
        active = true,
        role = 'staff',
        notes = excluded.notes,
        updated_at = now();
    `);

    const rows = await runReadOnlySql(`
      select id as employee_id, display_name, employee_code
      from public.employees
      where employee_code in (${COVERALL_SLOT_CODES.map((slotCode) => `'${esc(slotCode)}'`).join(",")})
      order by employee_code
    `);
    if (!Array.isArray(rows) || rows.length < COVERALL_SLOT_CODES.length) throw new Error("Could not create or find all CoverAll employee slots.");
    return rows;
  }

  async function getCoverAllEmployee() {
    const slots = await ensureCoverAllSlots();
    return slots[0];
  }

  async function getCoverAllSlotByCode(slotCode) {
    const normalized = normalizeCoverAllSlotCode(slotCode);
    if (!normalized) throw new Error("slot must be COVERALL_01, COVERALL_02, COVERALL_03, or COVERALL_04.");
    const slots = await ensureCoverAllSlots();
    const slot = slots.find((row) => String(row.employee_code || "").toUpperCase() === normalized);
    if (!slot) throw new Error(`CoverAll slot not found: ${normalized}`);
    return slot;
  }

  async function listCoverAllSlotsForDate(serviceDate) {
    const slots = await ensureCoverAllSlots();
    const rosterRows = await runReadOnlySql(`
      select r.employee_id, r.active, to_char(r.shift_start, 'HH24:MI:SS') as shift_start,
             to_char(r.shift_end, 'HH24:MI:SS') as shift_end, r.source_type, r.notes
      from public.daily_work_roster r
      where r.service_date = '${esc(serviceDate)}'::date
        and r.employee_id in (${slots.map((slot) => `'${esc(slot.employee_id)}'::uuid`).join(",")})
    `);
    const byEmployee = new Map((Array.isArray(rosterRows) ? rosterRows : []).map((row) => [String(row.employee_id), row]));
    return slots.map((slot) => {
      const roster = byEmployee.get(String(slot.employee_id)) || null;
      const slotCode = String(slot.employee_code || "");
      return {
        slot_code: slotCode,
        employee_id: slot.employee_id,
        employee_name: slot.display_name,
        active_today: Boolean(roster?.active),
        shift_start: roster?.shift_start || null,
        shift_end: roster?.shift_end || null,
        source_type: roster?.source_type || null,
        notes: roster?.notes || null,
        assignment_url_en: coverAllPublicPath(serviceDate, slotCode, "en"),
        assignment_url_es: coverAllPublicPath(serviceDate, slotCode, "es"),
      };
    });
  }

  async function publishCoverAllSlotsForDate(serviceDate, inputSlots = []) {
    if (!Array.isArray(inputSlots)) throw new Error("slots must be an array.");
    const slots = await ensureCoverAllSlots();
    const byCode = new Map(slots.map((slot) => [String(slot.employee_code || "").toUpperCase(), slot]));
    const operations = [];

    for (const input of inputSlots) {
      const slotCode = normalizeCoverAllSlotCode(input?.slot_code || input?.slot || input?.employee_code || input?.number);
      if (!slotCode) throw new Error("Each CoverAll slot must be COVERALL_01 through COVERALL_04.");
      const slot = byCode.get(slotCode);
      if (!slot) throw new Error(`CoverAll slot not found: ${slotCode}`);
      const active = input?.active !== false;
      const shiftStart = requireTime(input?.shift_start || "07:00:00");
      const shiftEnd = requireTime(input?.shift_end || "16:00:00");
      const notes = String(input?.notes || "Extra CoverAll help added from scheduler.").trim();
      operations.push({ slotCode, slot, active, shiftStart, shiftEnd, notes });
    }

    if (!operations.length) throw new Error("At least one CoverAll slot operation is required.");

    const activeOps = operations.filter((op) => op.active);
    const inactiveOps = operations.filter((op) => !op.active);

    let sql = "";
    if (activeOps.length) {
      const valuesSql = activeOps.map((op) => `(
        '${esc(serviceDate)}'::date,
        '${esc(op.slot.employee_id)}'::uuid,
        '${esc(op.shiftStart)}'::time,
        '${esc(op.shiftEnd)}'::time,
        'coverall_manual',
        '${esc(op.notes)}',
        true
      )`).join(",\n");
      sql += `
        insert into public.daily_work_roster (service_date, employee_id, shift_start, shift_end, source_type, notes, active, created_at, updated_at)
        values ${valuesSql}
        on conflict (service_date, employee_id) do update set
          shift_start = excluded.shift_start,
          shift_end = excluded.shift_end,
          source_type = excluded.source_type,
          notes = excluded.notes,
          active = true,
          updated_at = now();
      `;
    }

    if (inactiveOps.length) {
      sql += `
        update public.daily_work_roster
           set active = false,
               updated_at = now(),
               notes = trim(concat_ws(' ', nullif(notes, ''), 'CoverAll slot removed from scheduler.'))
         where service_date = '${esc(serviceDate)}'::date
           and employee_id in (${inactiveOps.map((op) => `'${esc(op.slot.employee_id)}'::uuid`).join(",")});
      `;
    }

    await runWriteSql("coverall_slots_publish", sql);
    const generateResult = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: true });
    const currentSlots = await listCoverAllSlotsForDate(serviceDate);
    return { service_date: serviceDate, slots: currentSlots, generate_result: generateResult };
  }

  function normalizeAssignmentCapture(row = {}, source = "baseline") {
    const locationGroupId = String(row.location_group_id || "").trim();
    const start = String(row.original_coverage_start || row.coverage_start || "").slice(0, 8);
    const end = String(row.original_coverage_end || row.coverage_end || "").slice(0, 8);
    if (!locationGroupId || !start || !end) return null;
    return {
      location_group_id: locationGroupId,
      coverage_start: start,
      coverage_end: end,
      group_name: String(row.group_name || row.location_name || row.group_code || "Area").trim(),
      group_code: String(row.group_code || "").trim(),
      source,
      original_employee_id: String(row.assigned_employee_id || row.employee_id || "").trim(),
      original_employee_name: String(row.assigned_employee_name || row.employee_name || "").trim(),
    };
  }

  async function buildCoverAllPlan(serviceDate, explicitIds = []) {
    const explicit = normalizeUuidList(explicitIds);
    const activeRows = await listPtoRows({ startDate: serviceDate, endDate: serviceDate });
    const nonManualActiveIds = [];
    for (const row of activeRows) {
      const id = String(row.employee_id || "").trim();
      const type = String(row.pto_type || "").toLowerCase();
      if (!id || type === "manual_override") continue;
      if (!nonManualActiveIds.includes(id)) nonManualActiveIds.push(id);
    }

    const orderedAbsentIds = Array.from(new Set([...nonManualActiveIds, ...explicit]));
    if (orderedAbsentIds.length < 3) {
      return { triggered: false, absent_count: orderedAbsentIds.length, ordered_absent_employee_ids: orderedAbsentIds, coverall_employee_ids: [], assignments: [] };
    }

    const coverallAbsentIds = orderedAbsentIds.slice(2);
    const coverallSet = new Set(coverallAbsentIds);
    const captured = new Map();
    const addCapture = (row, source) => {
      const item = normalizeAssignmentCapture(row, source);
      if (!item) return;
      captured.set(`${item.location_group_id}|${item.coverage_start}|${item.coverage_end}`, item);
    };

    const baselineRows = await runReadOnlySql(`
      select *
      from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)
      where assigned_employee_id = any(${uuidArrayLiteral(coverallAbsentIds)})
      order by group_name, coverage_start, coverage_end
    `);
    for (const row of Array.isArray(baselineRows) ? baselineRows : []) addCapture(row, "current_assignment");

    const firstTwoIds = orderedAbsentIds.slice(0, 2);
    if (firstTwoIds.length) {
      try {
        const previewRows = await runReadOnlySql(`select public.sch_absence_preview('${esc(serviceDate)}'::date, ${uuidArrayLiteral(firstTwoIds)}) as data`);
        const preview = Array.isArray(previewRows) && previewRows.length ? previewRows[0].data : null;
        const reassigned = Array.isArray(preview?.reassigned_assignments) ? preview.reassigned_assignments : [];
        for (const row of reassigned) {
          const assignedId = String(row.assigned_employee_id || "").trim();
          if (coverallSet.has(assignedId)) addCapture(row, "would_have_inherited_from_first_two_absences");
        }
      } catch (error) {
        console.warn("CoverAll preview capture failed:", error?.message || error);
      }
    }

    return {
      triggered: true,
      absent_count: orderedAbsentIds.length,
      ordered_absent_employee_ids: orderedAbsentIds,
      coverall_employee_ids: coverallAbsentIds,
      first_two_employee_ids: firstTwoIds,
      assignments: Array.from(captured.values()),
      manager_notification: `Call CoverAll: ${orderedAbsentIds.length} custodial absences for ${serviceDate}. CoverAll should cover the 3rd absence and any later absences.`,
    };
  }

  async function applyCoverAllPlan(serviceDate, plan = {}) {
    if (!plan?.triggered || !Array.isArray(plan.assignments) || !plan.assignments.length) {
      return { ...(plan || {}), applied: false, assigned_count: 0, assigned_assignments: [] };
    }
    if (typeof runWriteSql !== "function") throw new Error("CoverAll write path is not configured.");
    const coverAll = await getCoverAllEmployee();
    const valuesSql = plan.assignments.map((row) => `(
      '${esc(row.location_group_id)}'::uuid,
      '${esc(row.coverage_start)}'::time,
      '${esc(row.coverage_end)}'::time,
      '${esc(row.group_name)}',
      '${esc(row.source)}'
    )`).join(",\n");

    await runWriteSql("coverall_assignment_apply", `
      with target(location_group_id, coverage_start, coverage_end, group_name, coverall_source) as (
        values ${valuesSql}
      ), bounds as (
        select min(coverage_start) as shift_start, max(coverage_end) as shift_end from target
      ), upsert_roster as (
        insert into public.daily_work_roster (service_date, employee_id, shift_start, shift_end, source_type, notes, active, created_at, updated_at)
        select '${esc(serviceDate)}'::date, '${esc(coverAll.employee_id)}'::uuid, b.shift_start, b.shift_end, 'coverall',
               'Call CoverAll: 3+ custodial absences detected. CoverAll fills the 3rd and later absence workload.', true, now(), now()
        from bounds b
        where b.shift_start is not null and b.shift_end is not null
          and not exists (
            select 1 from public.daily_work_roster existing
            where existing.service_date = '${esc(serviceDate)}'::date
              and existing.employee_id = '${esc(coverAll.employee_id)}'::uuid
          )
        returning employee_id
      )
      update public.daily_work_roster dwr
         set shift_start = least(dwr.shift_start, b.shift_start),
             shift_end = greatest(dwr.shift_end, b.shift_end),
             notes = 'Call CoverAll: 3+ custodial absences detected. CoverAll fills the 3rd and later absence workload.',
             active = true,
             updated_at = now()
      from bounds b
      where dwr.service_date = '${esc(serviceDate)}'::date
        and dwr.employee_id = '${esc(coverAll.employee_id)}'::uuid
        and b.shift_start is not null
        and b.shift_end is not null;

      with target(location_group_id, coverage_start, coverage_end, group_name, coverall_source) as (
        values ${valuesSql}
      )
      update public.daily_schedule_assignments dsa
         set assigned_employee_id = '${esc(coverAll.employee_id)}'::uuid,
             owner_type = 'EMPLOYEE',
             status = 'ASSIGNED',
             source_type = 'coverall_escalation',
             notes = trim(concat_ws(' ', nullif(dsa.notes, ''), 'Call CoverAll: assigned due to 3+ custodial absences.')),
             updated_at = now()
      from target t
      where dsa.service_date = '${esc(serviceDate)}'::date
        and dsa.location_group_id = t.location_group_id
        and dsa.coverage_start = t.coverage_start
        and dsa.coverage_end = t.coverage_end;
    `);

    const assignedRows = await runReadOnlySql(`
      select dsa.location_group_id, lg.group_code, lg.group_name,
             to_char(dsa.coverage_start, 'HH24:MI:SS') as coverage_start,
             to_char(dsa.coverage_end, 'HH24:MI:SS') as coverage_end,
             dsa.notes
      from public.daily_schedule_assignments dsa
      join public.location_groups lg on lg.id = dsa.location_group_id
      where dsa.service_date = '${esc(serviceDate)}'::date
        and dsa.assigned_employee_id = '${esc(coverAll.employee_id)}'::uuid
      order by dsa.coverage_start, lg.group_name
    `);

    return {
      ...plan,
      applied: true,
      coverall_employee_id: coverAll.employee_id,
      coverall_employee_name: coverAll.display_name || "CoverAll",
      assigned_count: Array.isArray(assignedRows) ? assignedRows.length : 0,
      assigned_assignments: Array.isArray(assignedRows) ? assignedRows : [],
    };
  }

  async function ensurePtoTable() {
    if (typeof runWriteSql !== "function") throw new Error("PTO write path is not configured.");
    await runWriteSql("pto_schema", `
      create table if not exists public.employee_planned_time_off (
        id uuid primary key default gen_random_uuid(),
        employee_id uuid not null references public.employees(id) on delete cascade,
        start_date date not null,
        end_date date not null,
        pto_type text not null default 'PTO',
        source text not null default 'import',
        notes text null,
        active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint employee_planned_time_off_date_order check (end_date >= start_date),
        constraint employee_planned_time_off_unique unique (employee_id, start_date, end_date, pto_type, source)
      );
      create index if not exists employee_planned_time_off_active_dates_idx on public.employee_planned_time_off (active, start_date, end_date);
      create index if not exists employee_planned_time_off_employee_dates_idx on public.employee_planned_time_off (employee_id, start_date, end_date);
    `);
  }

  async function importPtoRows(inputRows = []) {
    await ensurePtoTable();
    if (!Array.isArray(inputRows) || !inputRows.length) throw new Error("rows must be a non-empty array.");
    const employeeRows = await runReadOnlySql(`
      select id as employee_id, display_name, employee_code
      from public.employees
      where active = true
      order by display_name
    `);
    const normalizeName = (value) => String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const tokenizeName = (value) => normalizeName(value).split(" ").filter(Boolean);
    const firstNameAliases = new Map([
      ["kathy", ["kathryn", "kathy", "katie", "kat"]],
      ["kathryn", ["kathryn", "kathy", "katie", "kat"]],
      ["kinnaye", ["kinnaye", "kinny", "kinaye", "kenny"]],
      ["kinny", ["kinnaye", "kinny", "kinaye", "kenny"]],
      ["daniel", ["daniel", "dan"]],
      ["markiesha", ["markiesha", "markesha", "markeisha"]],
    ]);
    function canonicalReportName(value = "") {
      const text = String(value || "").trim();
      if (!text) return "";
      if (text.includes(",")) {
        const [last, rest] = text.split(",", 2).map((part) => part.trim()).filter(Boolean);
        return [rest, last].filter(Boolean).join(" ").trim();
      }
      return text;
    }
    function nameScore(inputName, employeeName) {
      const rawInput = canonicalReportName(inputName);
      const rawEmployee = String(employeeName || "").trim();
      const a = tokenizeName(rawInput);
      const b = tokenizeName(rawEmployee);
      if (!a.length || !b.length) return -Infinity;
      let score = 0;
      const aFirst = a[0];
      const bFirst = b[0];
      const aLast = a[a.length - 1];
      const bLast = b[b.length - 1];
      if (aLast === bLast) score += 10;
      else if (aLast && bLast && (aLast.startsWith(bLast) || bLast.startsWith(aLast))) score += 7;
      const aAliases = new Set(firstNameAliases.get(aFirst) || [aFirst]);
      const bAliases = new Set(firstNameAliases.get(bFirst) || [bFirst]);
      if (aAliases.has(bFirst) || bAliases.has(aFirst)) score += 8;
      else if (aFirst && bFirst && (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst))) score += 6;
      for (const token of a) if (b.includes(token)) score += 1;
      return score;
    }
    function resolveEmployeeLoose(employeeId, employeeName) {
      if (employeeId && byId.has(employeeId)) return byId.get(employeeId);
      const exact = byName.get(String(employeeName || "").trim().toLowerCase());
      if (exact) return exact;
      let best = null;
      let bestScore = -Infinity;
      for (const row of employeeRows || []) {
        const score = nameScore(employeeName, row.display_name);
        if (score > bestScore) {
          best = row;
          bestScore = score;
        }
      }
      return bestScore >= 12 ? best : null;
    }
    const byId = new Map();
    const byName = new Map();
    for (const row of employeeRows || []) {
      const employeeId = String(row.employee_id || "").trim();
      const displayName = String(row.display_name || "").trim();
      if (employeeId) byId.set(employeeId, row);
      if (displayName) byName.set(displayName.toLowerCase(), row);
    }

    const normalized = [];
    for (const rawRow of inputRows) {
      const employeeId = String(rawRow?.employee_id || "").trim();
      const employeeName = String(rawRow?.employee_name || rawRow?.display_name || "").trim();
      const employee = resolveEmployeeLoose(employeeId, employeeName);
      if (!employee?.employee_id) {
        throw new Error(`Could not resolve PTO employee: ${employeeName || employeeId || "unknown"}`);
      }
      normalized.push({
        employee_id: String(employee.employee_id),
        employee_name: String(employee.display_name || employeeName || "").trim(),
        start_date: requireDate(rawRow?.start_date || rawRow?.service_date),
        end_date: requireDate(rawRow?.end_date || rawRow?.return_date || rawRow?.start_date || rawRow?.service_date),
        pto_type: String(rawRow?.pto_type || rawRow?.type || "PTO").trim() || "PTO",
        source: String(rawRow?.source || "import").trim() || "import",
        notes: rawRow?.notes == null ? null : String(rawRow.notes),
      });
    }

    const valuesSql = normalized.map((row) => `(
      '${esc(row.employee_id)}'::uuid,
      '${esc(row.start_date)}'::date,
      '${esc(row.end_date)}'::date,
      '${esc(row.pto_type)}',
      '${esc(row.source)}',
      ${row.notes == null ? "null" : `'${esc(row.notes)}'`},
      true
    )`).join(",\n");

    await runWriteSql("pto_import", `
      insert into public.employee_planned_time_off (
        employee_id,
        start_date,
        end_date,
        pto_type,
        source,
        notes,
        active
      )
      values ${valuesSql}
      on conflict (employee_id, start_date, end_date, pto_type, source)
      do update set
        notes = excluded.notes,
        active = true,
        updated_at = now();
    `);

    return normalized;
  }

  function parsePtoReportText(reportText = "") {
    const text = String(reportText || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("report_text is required.");
    const rowPattern = /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(\d{4})\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+([^,]+,\s*[^A\d]+?(?:\s+[A-Z])?)\s+(Approved|Submitted|Cancelled|Refused)\b/g;
    const rows = [];
    let match;
    while ((match = rowPattern.exec(text)) !== null) {
      const [, month, day, year, dayOfWeek, employeeName, status] = match;
      const date = new Date(`${month} ${day}, ${year} 12:00:00`);
      if (Number.isNaN(date.getTime())) continue;
      rows.push({
        service_date: date.toISOString().slice(0, 10),
        day_of_week: dayOfWeek,
        employee_name: String(employeeName || "").trim(),
        status: String(status || "").trim(),
        provider: "local-parser",
        provider_used: "local-parser",
        provider_fallback: false,
        warnings: [],
      });
    }
    if (!rows.length) throw new Error("No PTO rows were detected in the report text.");

    const bestByKey = new Map();
    const rank = { approved: 3, submitted: 2, cancelled: 1, refused: 0 };
    for (const row of rows) {
      const key = `${row.service_date}__${row.employee_name.toLowerCase()}`;
      const prior = bestByKey.get(key);
      const currentRank = rank[row.status.toLowerCase()] ?? -1;
      const priorRank = prior ? (rank[String(prior.status || "").toLowerCase()] ?? -1) : -1;
      if (!prior || currentRank > priorRank) bestByKey.set(key, row);
    }

    const kept = Array.from(bestByKey.values()).filter((row) => /^(approved|submitted)$/i.test(row.status));
    const grouped = new Map();
    for (const row of kept) {
      const key = row.employee_name.toLowerCase();
      if (!grouped.has(key)) grouped.set(key, { employee_name: row.employee_name, dates: [], rows: [] });
      grouped.get(key).dates.push(row.service_date);
      grouped.get(key).rows.push(row);
    }

    const importedRows = [];
    for (const group of grouped.values()) {
      const dates = Array.from(new Set(group.dates)).sort();
      let start = dates[0];
      let end = dates[0];
      const pushRange = () => importedRows.push({ employee_name: group.employee_name, start_date: start, end_date: end, pto_type: "PTO", notes: "Imported from PTO report", source: "report", provider: "local-parser", provider_used: "local-parser", provider_fallback: false, warnings: [] });
      for (let i = 1; i < dates.length; i += 1) {
        const prev = new Date(`${end}T12:00:00`);
        prev.setDate(prev.getDate() + 1);
        const expected = prev.toISOString().slice(0, 10);
        if (dates[i] === expected) end = dates[i];
        else { pushRange(); start = dates[i]; end = dates[i]; }
      }
      pushRange();
    }

    return { detected_rows: rows, kept_rows: kept, import_rows: importedRows, provider: "local-parser", providers_used: ["local-parser"], fallback_count: 0 };
  }

  function shouldUseGeminiForPto(localResult = {}) {
    if (!Array.isArray(localResult?.detected_rows) || !localResult.detected_rows.length) return true;
    if (!Array.isArray(localResult?.import_rows) || !localResult.import_rows.length) return true;
    const keptCount = Array.isArray(localResult?.kept_rows) ? localResult.kept_rows.length : 0;
    return keptCount < localResult.detected_rows.length;
  }

  function normalizePtoEmployeeName(value = "") {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.includes(",")) {
      const [last, rest] = text.split(",", 2).map((part) => part.trim()).filter(Boolean);
      return [rest, last].filter(Boolean).join(" ").trim();
    }
    return text;
  }

  function buildPtoGeminiPrompt(reportText = "", localResult = {}) {
    const detectedRows = Array.isArray(localResult?.detected_rows)
      ? localResult.detected_rows.map((row) => ({
          service_date: row.service_date || "",
          day_of_week: row.day_of_week || "",
          employee_name: row.employee_name || "",
          status: row.status || "",
        }))
      : [];

    return [
      "You are extracting employee PTO date ranges from a Memphis Zoo PTO report into strict JSON.",
      "Return JSON only. No markdown. No explanation.",
      "Output shape: {\"rows\":[{...}]}",
      "Each row must include: employee_name, start_date, end_date, pto_type, notes, confidence, review_notes, warnings",
      "Rules:",
      "- employee_name should be the employee's display name in normal order when known, like 'Jane Smith'.",
      "- start_date and end_date must be YYYY-MM-DD.",
      "- collapse consecutive PTO dates for the same employee into one range row.",
      "- include only approved or submitted PTO rows. Ignore cancelled and refused rows.",
      "- pto_type should usually be PTO unless the report clearly says otherwise.",
      "- notes should be short plain text or null.",
      "- confidence must be one of high, medium, low.",
      "- warnings must be an array using only: missing_employee_name, missing_date, ignored_status, ambiguous_range, ambiguous_employee.",
      "- Do not invent dates or employees.",
      "Raw PTO report text:",
      String(reportText || ""),
      "Local parser extraction for reference:",
      JSON.stringify(detectedRows),
    ].join("\n");
  }

  async function tryGeminiParsePtoReportText(reportText = "", localResult = {}) {
    const apiKey = getScheduleGeminiApiKey();
    if (!apiKey) return { ok: false, reason: "gemini_not_configured" };
    const prompt = buildPtoGeminiPrompt(reportText, localResult);
    const response = await fetchWithTimeout(`${PTO_GEMINI_BASE_URL}/${encodeURIComponent(PTO_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: PTO_GEMINI_MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
    const text = (payload?.candidates?.[0]?.content?.parts || [])
      .filter((part) => typeof part?.text === "string" && part.text.trim())
      .map((part) => part.text.trim())
      .join("\n\n");
    const parsed = safeJsonParse(text);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : null;
    if (!rows) throw new Error("Gemini returned invalid JSON PTO rows payload.");
    return { ok: true, provider: "gemini", model: PTO_GEMINI_MODEL, rows };
  }

  function normalizeGeminiPtoRow(raw = {}) {
    const employeeName = normalizePtoEmployeeName(raw.employee_name || raw.name || "");
    const startDate = normalizePossibleDate(raw.start_date || raw.date_start || raw.from || "");
    const endDate = normalizePossibleDate(raw.end_date || raw.date_end || raw.to || raw.start_date || "");
    const warningSet = new Set(
      Array.isArray(raw.warnings)
        ? raw.warnings.map((item) => String(item || "").trim()).filter(Boolean)
        : []
    );
    if (!employeeName) warningSet.add("missing_employee_name");
    if (!startDate || !endDate) warningSet.add("missing_date");
    if (startDate && endDate && endDate < startDate) warningSet.add("ambiguous_range");
    const warnings = Array.from(warningSet).filter((item) => ["missing_employee_name", "missing_date", "ignored_status", "ambiguous_range", "ambiguous_employee"].includes(item));

    return {
      employee_name: employeeName,
      start_date: startDate,
      end_date: endDate || startDate,
      pto_type: String(raw.pto_type || raw.type || "PTO").trim() || "PTO",
      notes: raw.notes == null ? "Imported from PTO report" : String(raw.notes || "").trim() || "Imported from PTO report",
      source: "report",
      confidence: ["high", "medium", "low"].includes(String(raw.confidence || "").toLowerCase()) ? String(raw.confidence).toLowerCase() : (warnings.length ? "medium" : "high"),
      review_notes: raw.review_notes == null ? (warnings.length ? warnings.join(", ") : null) : String(raw.review_notes || "").trim() || null,
      warnings,
      provider: "gemini",
      provider_used: "gemini",
      provider_fallback: false,
      model: PTO_GEMINI_MODEL,
    };
  }

  function chooseBestPtoParse(localResult, geminiRows = []) {
    const normalizedGeminiRows = (Array.isArray(geminiRows) ? geminiRows : [])
      .map((row) => normalizeGeminiPtoRow(row))
      .filter((row) => row.employee_name && row.start_date && row.end_date && row.end_date >= row.start_date);

    if (!normalizedGeminiRows.length) {
      return {
        ...localResult,
        fallback_count: 0,
      };
    }

    const localRows = Array.isArray(localResult?.import_rows) ? localResult.import_rows : [];
    const localWarnings = localRows.reduce((sum, row) => sum + (Array.isArray(row?.warnings) ? row.warnings.length : 0), 0);
    const geminiWarnings = normalizedGeminiRows.reduce((sum, row) => sum + (Array.isArray(row?.warnings) ? row.warnings.length : 0), 0);

    if (!localRows.length || geminiWarnings <= localWarnings) {
      return {
        detected_rows: Array.isArray(localResult?.detected_rows) ? localResult.detected_rows : [],
        kept_rows: normalizedGeminiRows,
        import_rows: normalizedGeminiRows,
        provider: "gemini",
        providers_used: ["local-parser", "gemini"],
        fallback_count: localRows.length,
      };
    }

    return {
      ...localResult,
      providers_used: ["local-parser", "gemini"],
      fallback_count: normalizedGeminiRows.length,
    };
  }

  async function aiParsePtoReportText(reportText = "") {
    const local = parsePtoReportText(reportText);
    if (!shouldUseGeminiForPto(local)) return local;
    try {
      const geminiResult = await tryGeminiParsePtoReportText(reportText, local);
      if (!geminiResult?.ok || !Array.isArray(geminiResult.rows)) return local;
      return chooseBestPtoParse(local, geminiResult.rows);
    } catch {
      return local;
    }
  }

  function toNullableRating(value) {
    if (value == null || value === "") return null;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
      throw new Error("Ratings must be integers from 1 to 10, or blank.");
    }
    return parsed;
  }

  async function getServiceDate() {
    const rows = await runReadOnlySql("select public.sch_service_date(now()) as service_date");
    return Array.isArray(rows) && rows.length ? rows[0].service_date : null;
  }

  async function getDailyGenerationState(serviceDate) {
    const rows = await runReadOnlySql(`
      select
        (select count(*)::int from public.daily_work_roster where service_date = '${esc(serviceDate)}'::date) as roster_count,
        (select count(*)::int from public.daily_schedule_assignments where service_date = '${esc(serviceDate)}'::date) as assignment_count
    `);
    return Array.isArray(rows) && rows.length
      ? {
          roster_count: Number(rows[0].roster_count || 0),
          assignment_count: Number(rows[0].assignment_count || 0),
        }
      : { roster_count: 0, assignment_count: 0 };
  }

  function addDaysToIsoDate(serviceDate, daysToAdd = 0) {
    const base = new Date(`${serviceDate}T12:00:00`);
    if (Number.isNaN(base.getTime())) return serviceDate;
    base.setDate(base.getDate() + Number(daysToAdd || 0));
    return base.toISOString().slice(0, 10);
  }

  async function getScheduleRangeStatus(startDate, days = 7) {
    const totalDays = Math.max(1, Math.min(14, Number.parseInt(String(days || 7), 10) || 7));
    const rows = [];
    for (let offset = 0; offset < totalDays; offset += 1) {
      const serviceDate = addDaysToIsoDate(startDate, offset);
      const state = await getDailyGenerationState(serviceDate);
      rows.push({
        service_date: serviceDate,
        roster_count: state.roster_count,
        assignment_count: state.assignment_count,
        ready: state.roster_count > 0 && state.assignment_count > 0,
      });
    }
    return rows;
  }

  async function ensureScheduleRange(startDate, days = 7, { force = false } = {}) {
    const statuses = await getScheduleRangeStatus(startDate, days);
    const generated = [];
    for (const row of statuses) {
      const shouldGenerate = force || !row.ready;
      if (shouldGenerate) {
        await runRpc("sch_generate_daily_schedule", { p_service_date: row.service_date, p_force: force });
      }
      const after = await getDailyGenerationState(row.service_date);
      generated.push({
        service_date: row.service_date,
        generated: shouldGenerate,
        roster_count: after.roster_count,
        assignment_count: after.assignment_count,
        ready: after.roster_count > 0 && after.assignment_count > 0,
      });
    }
    return generated;
  }

  async function maybeAutoGenerateWindow(anchorDate = null) {
    const now = Date.now();
    if (autoGenerateState.running) return autoGenerateState;
    if (now - autoGenerateState.lastStartedAt < AUTO_GENERATE_COOLDOWN_MS) return autoGenerateState;
    const startDate = requireDate(anchorDate || (await getServiceDate()));
    autoGenerateState = { ...autoGenerateState, running: true, lastStartedAt: now, lastWindowStart: startDate };
    try {
      const generated = await ensureScheduleRange(startDate, AUTO_GENERATE_WINDOW_DAYS, { force: false });
      autoGenerateState = { ...autoGenerateState, running: false, lastCompletedAt: Date.now(), lastResult: generated, lastWindowStart: startDate };
    } catch (error) {
      console.error("schedule auto-generate window failed:", error);
      autoGenerateState = { ...autoGenerateState, running: false };
    }
    return autoGenerateState;
  }

  function summarizeAssignmentDiff(data = {}, { absentEmployeeIds = [] } = {}) {
    const removed = Array.isArray(data?.removed_assignments) ? data.removed_assignments : [];
    const reassigned = Array.isArray(data?.reassigned_assignments) ? data.reassigned_assignments : [];
    const openSegments = Array.isArray(data?.open_segments) ? data.open_segments : [];
    const warnings = Array.isArray(data?.overload_warnings) ? data.overload_warnings : [];
    const absentSet = new Set((Array.isArray(absentEmployeeIds) ? absentEmployeeIds : []).map((x) => String(x || "").trim()).filter(Boolean));
    const groups = new Set();
    const recipientEmployees = new Set();
    const removedEmployees = new Set();
    const collectGroup = (row) => {
      const groupName = String(row?.group_name || row?.area_name || row?.location_name || row?.group_code || "").trim();
      if (groupName) groups.add(groupName);
    };
    const employeeIdFor = (row) => String(row?.employee_id || row?.assigned_employee_id || "").trim();
    const employeeNameFor = (row) => String(row?.employee_name || row?.assigned_employee_name || row?.display_name || "").trim();
    removed.forEach((row) => {
      collectGroup(row);
      const employeeName = employeeNameFor(row);
      if (employeeName) removedEmployees.add(employeeName);
    });
    reassigned.forEach((row) => {
      collectGroup(row);
      const employeeId = employeeIdFor(row);
      const employeeName = employeeNameFor(row);
      if (employeeName && !absentSet.has(employeeId)) recipientEmployees.add(employeeName);
    });
    openSegments.forEach(collectGroup);
    return {
      changed_groups: Array.from(groups),
      changed_employees: Array.from(recipientEmployees),
      removed_employees: Array.from(removedEmployees),
      counts: {
        removed_assignments: removed.length,
        reassigned_assignments: reassigned.length,
        open_segments: openSegments.length,
        warnings: warnings.length,
      },
    };
  }

  function summarizeWeekWindow(windowRows = []) {
    const rows = Array.isArray(windowRows) ? windowRows : [];
    const readyRows = rows.filter((row) => row && row.ready);
    const missingRows = rows.filter((row) => !row || !row.ready);
    const totalAssignments = rows.reduce((sum, row) => sum + Number(row?.assignment_count || 0), 0);
    const totalRoster = rows.reduce((sum, row) => sum + Number(row?.roster_count || 0), 0);
    const missingDates = missingRows.map((row) => String(row?.service_date || "")).filter(Boolean);
    const fullestDay = rows.reduce((best, row) => {
      const score = Number(row?.assignment_count || 0);
      if (!best || score > Number(best?.assignment_count || 0)) return row;
      return best;
    }, null);
    return {
      ready_days: readyRows.length,
      missing_days: missingRows.length,
      total_assignments: totalAssignments,
      total_roster_rows: totalRoster,
      missing_dates: missingDates,
      fullest_day: fullestDay
        ? {
            service_date: fullestDay.service_date,
            assignment_count: Number(fullestDay.assignment_count || 0),
            roster_count: Number(fullestDay.roster_count || 0),
          }
        : null,
    };
  }

  function buildWeekSummaryText({ serviceDate, days, windowRows, autoGeneration }) {
    const summary = summarizeWeekWindow(windowRows);
    const parts = [];
    parts.push(`${summary.ready_days} of ${days} visible days are ready starting ${serviceDate}.`);
    if (summary.missing_days) {
      parts.push(`Missing days: ${summary.missing_dates.slice(0, 6).join(", ")}${summary.missing_dates.length > 6 ? ", ..." : ""}.`);
    } else {
      parts.push("No missing days in the current window.");
    }
    parts.push(`${summary.total_assignments} total assignments and ${summary.total_roster_rows} roster rows are loaded across the window.`);
    if (summary.fullest_day?.service_date) {
      parts.push(`Heaviest visible day is ${summary.fullest_day.service_date} with ${summary.fullest_day.assignment_count} assignments.`);
    }
    if (autoGeneration?.running) parts.push("Automatic week fill is running now.");
    else if (autoGeneration?.last_completed_at) parts.push(`Automatic week fill last checked ${autoGeneration.last_window_start || serviceDate} and generated ${Number(autoGeneration.generated_days || 0)} day(s).`);
    return parts.join(" ");
  }

  function buildAbsenceSummaryText(data = {}, meta = {}, serviceDate = "") {
    const diff = summarizeAssignmentDiff(data || {}, { absentEmployeeIds: data?.effective_absent_employee_ids || [] });
    const parts = [];
    if (meta?.generated_before_preview) parts.push(`Base schedule for ${serviceDate} was auto-generated before previewing absences.`);
    parts.push(`${diff.counts.removed_assignments} assignments would be removed, ${diff.counts.reassigned_assignments} would likely be reassigned, and ${diff.counts.open_segments} segments would remain open.`);
    if (diff.changed_groups.length) parts.push(`Most affected groups: ${diff.changed_groups.slice(0, 6).join(", ")}.`);
    if (diff.changed_employees.length) parts.push(`Likely reassigned employees: ${diff.changed_employees.slice(0, 6).join(", ")}.`);
    if (Array.isArray(data?.overload_warnings) && data.overload_warnings.length) parts.push(`Warnings: ${data.overload_warnings.slice(0, 4).join(" | ")}.`);
    return parts.join(" ");
  }

  async function listLocationGroups() {
    const rows = await runReadOnlySql(`
      select lg.id as location_group_id, lg.group_code, lg.group_name,
             coalesce(array_agg(l.location_name order by l.sort_order nulls last, l.location_name)
               filter (where l.id is not null), array[]::text[]) as included_locations
      from public.location_groups lg
      left join public.location_group_memberships m on m.location_group_id = lg.id and m.active = true
      left join public.locations l on l.id = m.location_id and l.active = true
      where lg.active = true
      group by lg.id, lg.group_code, lg.group_name
      order by lg.group_name
    `);
    return Array.isArray(rows) ? rows : [];
  }

  function matchLocationGroup(locationGroups = [], query = "") {
    const needle = normalizeLoose(query);
    if (!needle) return null;
    let best = null;
    for (const group of locationGroups || []) {
      const names = [group.group_name, group.group_code].concat(group.included_locations || []).filter(Boolean);
      for (const name of names) {
        const normalized = normalizeLoose(name);
        if (!normalized) continue;
        let score = -1;
        if (needle === normalized) score = 1000 + normalized.length;
        else if (needle.includes(normalized)) score = 700 + normalized.length;
        else if (normalized.includes(needle)) score = 500 + needle.length;
        else {
          const needleParts = needle.split(/\s+/).filter(Boolean);
          const nameParts = normalized.split(/\s+/).filter(Boolean);
          const overlap = needleParts.filter((part) => nameParts.includes(part)).length;
          if (overlap) score = (overlap * 80) + normalized.length;
        }
        if (score >= 0 && (!best || score > best.score)) best = { group, score };
      }
    }
    return best?.group || null;
  }

  async function listDayGroups(serviceDate) {
    const rows = await runReadOnlySql(`
      select *
      from public.v_memphis_area_schedule
      where service_date = '${esc(serviceDate)}'::date
      order by group_name asc, segment_number asc
    `);
    return Array.isArray(rows) ? rows : [];
  }

  function summarizeOpenAndOverloadedGroups(rows = []) {
    const grouped = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = String(row.location_group_id || row.group_code || row.group_name || row.location_name || "").trim() || `row-${grouped.size + 1}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          location_group_id: row.location_group_id || null,
          group_name: row.group_name || row.location_name || row.group_code || "Unnamed Group",
          group_code: row.group_code || "",
          open_segments: 0,
          overload_segments: 0,
          total_segments: 0,
          load_points: 0,
          assigned_names: new Set(),
        });
      }
      const entry = grouped.get(key);
      const assignedName = String(row.assigned_employee_name || row.employee_name || "").trim();
      const status = String(row.status || row.owner_type || "").trim().toUpperCase();
      const loadPoints = Number(row.load_points || 0);
      entry.total_segments += 1;
      entry.load_points += loadPoints;
      if (!assignedName || status === "OPEN") entry.open_segments += 1;
      if (loadPoints >= 18) entry.overload_segments += 1;
      if (assignedName) entry.assigned_names.add(assignedName);
    }
    return Array.from(grouped.values()).map((entry) => ({
      ...entry,
      assigned_names: Array.from(entry.assigned_names),
    }));
  }

  function buildSchedulerRecommendationPrompt({ serviceDate, groupSummaries = [], locationGroups = [], userPrompt = "" }) {
    const compactGroups = groupSummaries.map((group) => ({
      group_name: group.group_name,
      group_code: group.group_code,
      open_segments: group.open_segments,
      overload_segments: group.overload_segments,
      total_segments: group.total_segments,
      load_points: group.load_points,
      assigned_names: group.assigned_names,
    }));
    const compactLocations = (locationGroups || []).slice(0, 120).map((group) => ({
      group_name: group.group_name,
      group_code: group.group_code,
      included_locations: group.included_locations || [],
    }));
    return [
      "You are assisting with Memphis Zoo custodial schedule operations.",
      "Return JSON only. No markdown. No explanation.",
      "Output shape: {\"summary\": string, \"recommendations\": [{\"group_name\": string, \"priority\": \"high\"|\"medium\"|\"low\", \"action\": string, \"reason\": string}], \"watchouts\": [string]}",
      "Keep recommendations operational, concise, and grounded in the provided schedule state.",
      "Do not invent employees or groups that are not in the data.",
      `Service date: ${serviceDate}`,
      userPrompt ? `Operator question: ${userPrompt}` : "Operator question: Recommend what needs attention first for this schedule.",
      "Group summary:",
      JSON.stringify(compactGroups),
      "Known location groups:",
      JSON.stringify(compactLocations),
    ].join("\n");
  }

  async function tryGeminiSchedulerRecommendations({ serviceDate, groupSummaries = [], locationGroups = [], userPrompt = "" }) {
    const apiKey = getScheduleGeminiApiKey();
    if (!apiKey) return { ok: false, reason: "gemini_not_configured" };
    const prompt = buildSchedulerRecommendationPrompt({ serviceDate, groupSummaries, locationGroups, userPrompt });
    const response = await fetchWithTimeout(`${PTO_GEMINI_BASE_URL}/${encodeURIComponent(PTO_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: PTO_GEMINI_MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
    const text = (payload?.candidates?.[0]?.content?.parts || [])
      .filter((part) => typeof part?.text === "string" && part.text.trim())
      .map((part) => part.text.trim())
      .join("\n\n");
    const parsed = safeJsonParse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Gemini returned invalid scheduler recommendations JSON.");
    return { ok: true, provider: "gemini", model: PTO_GEMINI_MODEL, data: parsed };
  }

  function buildFallbackSchedulerRecommendations({ serviceDate, groupSummaries = [], userPrompt = "" }) {
    const sorted = [...(groupSummaries || [])].sort((a, b) => {
      const aScore = (a.open_segments * 100) + (a.overload_segments * 20) + a.load_points;
      const bScore = (b.open_segments * 100) + (b.overload_segments * 20) + b.load_points;
      return bScore - aScore;
    });
    const recommendations = sorted
      .filter((group) => group.open_segments > 0 || group.overload_segments > 0)
      .slice(0, 5)
      .map((group) => ({
        group_name: group.group_name,
        priority: group.open_segments > 0 ? "high" : (group.overload_segments > 0 ? "medium" : "low"),
        action: group.open_segments > 0 ? "Fill open segments or reduce coverage expectations for this group first." : "Review whether load can be split across nearby staff.",
        reason: group.open_segments > 0
          ? `${group.open_segments} open segment(s) with ${group.total_segments} total segment(s).`
          : `${group.overload_segments} overloaded segment(s) and ${group.load_points} total load points.`,
      }));
    const watchouts = sorted
      .filter((group) => group.open_segments > 0 || group.overload_segments > 0)
      .slice(0, 4)
      .map((group) => `${group.group_name}: ${group.open_segments} open, ${group.overload_segments} overloaded.`);
    const summary = recommendations.length
      ? `Priority groups for ${serviceDate}: ${recommendations.map((item) => item.group_name).join(", ")}.`
      : `No open or overloaded groups detected for ${serviceDate}.`;
    return {
      provider: "rule-based",
      summary: userPrompt ? `${summary} Request considered: ${userPrompt}` : summary,
      recommendations,
      watchouts,
    };
  }

  async function getAssignedEmployeeForDevice(deviceId) {
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
      where d.device_id = '${esc(deviceId)}'
      limit 1
    `);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  function toCsvValue(value) {
    if (value == null) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function rowsToCsv(rows = [], columns = []) {
    const header = columns.map((column) => toCsvValue(column.label)).join(",");
    const body = rows.map((row) => columns.map((column) => toCsvValue(row[column.key])).join(","));
    return [header, ...body].join("\n") + "\n";
  }

  function groupScheduleRows(rows) {
    const groups = [];
    const byId = new Map();
    for (const row of rows || []) {
      const key = row.location_group_id || row.group_code || row.group_name;
      if (!byId.has(key)) {
        const group = {
          location_group_id: row.location_group_id,
          group_code: row.group_code,
          group_name: row.group_name,
          included_locations: row.included_locations || [],
          segments: [],
        };
        byId.set(key, group);
        groups.push(group);
      }
      byId.get(key).segments.push({
        segment_id: row.segment_id,
        segment_number: row.segment_number,
        owner_type: row.owner_type,
        assigned_employee_id: row.assigned_employee_id,
        assigned_employee_name: row.assigned_employee_name,
        coverage_start: row.coverage_start,
        coverage_end: row.coverage_end,
        status: row.status,
        load_points: row.load_points,
        coverage_purpose: row.coverage_purpose || "area_owner",
        notes: row.notes,
      });
    }
    return groups;
  }

  function htmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function resolveEmployeeIdFromRequest(req) {
    const deviceId = String(req.query.device_id || req.query.device || "").trim();
    const employeeId = String(req.query.employee_id || "").trim();
    const employeeName = String(req.query.employee_name || req.query.name || "").trim();
    const employeeCode = String(req.query.employee_code || req.query.code || "").trim();

    if (deviceId) {
      const assignment = await getAssignedEmployeeForDevice(deviceId);
      if (!assignment || !assignment.device_active) throw new Error("Active device assignment not found.");
      if (!assignment.assigned_employee_id || !assignment.employee_active) {
        throw new Error("This device is not assigned to an active employee.");
      }
      return { employeeId: assignment.assigned_employee_id, assignment };
    }

    if (employeeId) return { employeeId, assignment: null };

    if (!employeeName && !employeeCode) {
      throw new Error("device_id, employee_id, employee_name, or employee_code is required.");
    }

    const predicate = employeeCode
      ? `employee_code ilike '${esc(employeeCode)}'`
      : `display_name ilike '${esc(employeeName)}'`;
    const employeeRows = await runReadOnlySql(`
      select id as employee_id
      from public.employees
      where active = true and ${predicate}
      order by display_name
      limit 1
    `);
    if (!Array.isArray(employeeRows) || !employeeRows.length) throw new Error("Active employee not found.");
    return { employeeId: employeeRows[0].employee_id, assignment: null };
  }

  function renderMyScheduleHtml(data) {
    const employee = data?.employee || {};
    const shift = data?.shift || {};
    const items = Array.isArray(data?.items) ? data.items : [];
    const restroomItems = items.filter((item) => item?.is_public_restroom);
    const otherItems = items.filter((item) => !item?.is_public_restroom);
    const renderItems = (list) => list.length
      ? list.map((item) => `<li>${htmlEscape(item.name)}</li>`).join("")
      : `<li class="muted">None listed</li>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>My Schedule</title>
<style>
  :root { --teal:#0f4d57; --teal2:#0b3b43; --mint:#e8f4ef; --line:#cfe1db; --text:#173238; --muted:#63787d; --warn:#fff3cd; --warnline:#f0d98a; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background:#eef5f3; color:var(--text); }
  .top { background:linear-gradient(135deg,var(--teal),var(--teal2)); color:white; padding:22px 18px 26px; border-bottom-left-radius:24px; border-bottom-right-radius:24px; box-shadow:0 4px 16px rgba(0,0,0,.18); }
  .eyebrow { font-size:13px; opacity:.84; letter-spacing:.03em; text-transform:uppercase; }
  h1 { margin:6px 0 3px; font-size:30px; line-height:1.08; }
  .shift { font-size:17px; opacity:.95; }
  .wrap { max-width:720px; margin:0 auto; padding:16px; }
  .notice { background:var(--warn); border:1px solid var(--warnline); border-radius:16px; padding:12px 14px; margin-bottom:14px; font-weight:650; }
  .card { background:white; border:1px solid var(--line); border-radius:20px; padding:16px; margin:14px 0; box-shadow:0 2px 10px rgba(20,60,70,.07); }
  .card h2 { margin:0 0 10px; font-size:20px; color:var(--teal); }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:8px; }
  li { padding:11px 12px; background:#f8fbfa; border:1px solid #e1ece8; border-radius:13px; font-weight:620; }
  li.muted { color:var(--muted); font-weight:500; }
  .meta { margin-top:14px; color:var(--muted); font-size:13px; text-align:center; }
  .pill { display:inline-block; padding:5px 9px; border-radius:999px; background:rgba(255,255,255,.16); font-size:13px; margin-top:8px; }
</style>
</head>
<body>
  <header class="top">
    <div class="eyebrow">Custodial Scheduler</div>
    <h1>${htmlEscape(employee.display_name || "My Schedule")}</h1>
    <div class="shift">${htmlEscape(shift.start || "")} - ${htmlEscape(shift.end || "")}</div>
    <div class="pill">${htmlEscape(data?.phase || "current")} • ${htmlEscape(data?.as_of_time || "")}</div>
  </header>
  <main class="wrap">
    ${data?.notice ? `<div class="notice">${htmlEscape(data.notice)}</div>` : ""}
    <section class="card">
      <h2>Public Restrooms</h2>
      <ul>${renderItems(restroomItems)}</ul>
    </section>
    <section class="card">
      <h2>Other Assigned Areas</h2>
      <ul>${renderItems(otherItems)}</ul>
    </section>
    <div class="meta">${htmlEscape(data?.service_date || "")} • Employee code: ${htmlEscape(employee.employee_code || "")}</div>
  </main>
</body>
</html>`;
  }

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("schedule", { contract_version: contractVersion }));
  });

  router.get("/audit/day", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const rows = await runReadOnlySql(`
        select public.sch_audit_schedule_day('${esc(serviceDate)}'::date) as data
      `);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      res.status(200).json({
        ok: true,
        data,
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Schedule audit failed");
    }
  });

  router.get("/work-status", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const employeeId = String(req.query.employee_id || "").trim();
      const employeeCode = String(req.query.employee_code || req.query.code || "").trim();
      const employeeName = String(req.query.employee_name || req.query.name || req.query.employee || "").trim();
      let resolvedEmployeeId = employeeId;

      if (resolvedEmployeeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resolvedEmployeeId)) {
        throw new Error("employee_id must be a valid UUID.");
      }

      if (!resolvedEmployeeId && employeeCode) {
        const employeeRows = await runReadOnlySql(`
          select id as employee_id
          from public.employees
          where active = true
            and employee_code ilike '${esc(employeeCode)}'
          order by display_name
          limit 1
        `);
        resolvedEmployeeId = Array.isArray(employeeRows) && employeeRows.length ? employeeRows[0].employee_id : "";
      }

      if (!resolvedEmployeeId && employeeName) {
        const resolvedRows = await runReadOnlySql(`
          select public.sch_resolve_employee_ref('${esc(employeeName)}') as data
        `);
        const resolved = Array.isArray(resolvedRows) && resolvedRows.length ? resolvedRows[0].data : null;
        if (resolved?.ok && resolved.employee_id) resolvedEmployeeId = resolved.employee_id;
      }

      if (!resolvedEmployeeId) throw new Error("employee_id, employee_code, or employee_name is required and must resolve to an active employee.");

      const rows = await runReadOnlySql(`
        select public.sch_get_employee_work_status(
          '${esc(serviceDate)}'::date,
          '${esc(resolvedEmployeeId)}'::uuid
        ) as data
      `);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      res.status(200).json({
        ok: true,
        data,
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Employee work status failed");
    }
  });

  router.get("/today", async (_req, res) => {
    try {
      const serviceDate = await getServiceDate();
      if (!serviceDate) throw new Error("Could not resolve service date.");
      const rows = await runReadOnlySql(`select * from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)`);
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, groups: groupScheduleRows(rows) },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Today schedule failed");
    }
  });

  router.get("/day", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date);
      const rows = await runReadOnlySql(`select * from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)`);
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, groups: groupScheduleRows(rows) },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Schedule day failed");
    }
  });

  router.get("/my-day", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || req.query.device || "").trim();
      if (!deviceId) throw new Error("device_id is required.");
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const assignment = await getAssignedEmployeeForDevice(deviceId);
      if (!assignment || !assignment.device_active) {
        res.status(404).json({ ok: false, error: "Active device assignment not found." });
        return;
      }
      if (!assignment.assigned_employee_id || !assignment.employee_active) {
        res.status(404).json({ ok: false, error: "This device is not assigned to an active employee." });
        return;
      }
      const rows = await runReadOnlySql(`
        select *
        from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)
        where assigned_employee_id = '${esc(assignment.assigned_employee_id)}'::uuid
        order by group_name, segment_number
      `);
      res.status(200).json({
        ok: true,
        data: {
          service_date: serviceDate,
          device_id: assignment.device_id,
          device_name: assignment.device_name,
          employee_id: assignment.assigned_employee_id,
          employee_name: assignment.assigned_employee_name,
          employee_code: assignment.employee_code,
          role: assignment.role,
          groups: groupScheduleRows(rows),
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Personal schedule lookup failed");
    }
  });

  router.get("/my-day-summary", async (req, res) => {
    try {
      const deviceId = String(req.query.device_id || req.query.device || "").trim();
      const employeeId = String(req.query.employee_id || "").trim();
      const employeeName = String(req.query.employee_name || req.query.name || "").trim();
      if (!deviceId && !employeeId && !employeeName) {
        throw new Error("device_id, employee_id, or employee_name is required.");
      }

      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const atSql = optionalTimestampLiteral(req.query.as_of || req.query.at);
      let resolvedEmployeeId = employeeId;
      let assignment = null;

      if (deviceId) {
        assignment = await getAssignedEmployeeForDevice(deviceId);
        if (!assignment || !assignment.device_active) {
          res.status(404).json({ ok: false, error: "Active device assignment not found." });
          return;
        }
        if (!assignment.assigned_employee_id || !assignment.employee_active) {
          res.status(404).json({ ok: false, error: "This device is not assigned to an active employee." });
          return;
        }
        resolvedEmployeeId = assignment.assigned_employee_id;
      } else if (employeeName) {
        const employeeRows = await runReadOnlySql(`
          select id as employee_id
          from public.employees
          where active = true
            and display_name ilike '${esc(employeeName)}'
          order by display_name
          limit 1
        `);
        if (!Array.isArray(employeeRows) || !employeeRows.length) {
          res.status(404).json({ ok: false, error: "Active employee not found." });
          return;
        }
        resolvedEmployeeId = employeeRows[0].employee_id;
      }

      const rows = await runReadOnlySql(`
        select public.sch_employee_my_schedule_page(
          '${esc(serviceDate)}'::date,
          '${esc(resolvedEmployeeId)}'::uuid,
          ${atSql}
        ) as data
      `);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      res.status(200).json({
        ok: true,
        data: {
          ...(data || {}),
          device_id: assignment?.device_id || deviceId || null,
          device_name: assignment?.device_name || null,
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Personal schedule summary failed");
    }
  });

  router.get("/my-schedule", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const atSql = optionalTimestampLiteral(req.query.as_of || req.query.at);
      const { employeeId } = await resolveEmployeeIdFromRequest(req);
      const rows = await runReadOnlySql(`
        select public.sch_employee_my_schedule_page(
          '${esc(serviceDate)}'::date,
          '${esc(employeeId)}'::uuid,
          ${atSql}
        ) as data
      `);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      if (!data?.ok) {
        res.status(404).send(renderMyScheduleHtml(data || { employee: { display_name: "My Schedule" }, items: [], notice: "Schedule not found." }));
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(renderMyScheduleHtml(data));
    } catch (error) {
      res.status(400).send(renderMyScheduleHtml({
        employee: { display_name: "My Schedule" },
        shift: null,
        phase: "error",
        as_of_time: "",
        service_date: "",
        notice: error?.message || "Schedule preview failed.",
        items: [],
      }));
    }
  });

  router.get("/settings/close-time", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const rows = await runReadOnlySql(`select public.sch_get_schedule_close_time('${esc(serviceDate)}'::date) as closing_time`);
      const closingTime = Array.isArray(rows) && rows.length ? rows[0].closing_time : null;
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, closing_time: closingTime },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Close time lookup failed");
    }
  });

  router.post("/settings/close-time", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const closingTime = requireTime(req.body?.closing_time);
      const notes = req.body?.notes == null ? null : String(req.body.notes);
      const data = await runRpc("sch_set_schedule_close_time", {
        p_service_date: serviceDate,
        p_closing_time: closingTime,
        p_notes: notes,
      });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Close time update failed");
    }
  });

  router.get("/employees", async (_req, res) => {
    try {
      const rows = await runReadOnlySql(`
        select id as employee_id, employee_code, display_name, role, active
        from public.employees
        where active = true
        order by display_name
      `);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Employees failed");
    }
  });

  router.get("/employee-aliases", async (req, res) => {
    try {
      const employeeRef = String(req.query.employee || req.query.employee_name || req.query.employee_code || "").trim();
      const includeInactive = String(req.query.include_inactive || "").trim() === "1";
      let employeeFilterSql = "";

      if (employeeRef) {
        const resolvedRows = await runReadOnlySql(`
          select public.sch_resolve_employee_ref('${esc(employeeRef)}') as data
        `);
        const resolved = Array.isArray(resolvedRows) && resolvedRows.length ? resolvedRows[0].data : null;
        if (!resolved?.ok || !resolved.employee_id) {
          res.status(404).json({ ok: false, error: "Employee alias lookup could not resolve that employee." });
          return;
        }
        employeeFilterSql = `and e.id = '${esc(resolved.employee_id)}'::uuid`;
      }

      const rows = await runReadOnlySql(`
        select
          a.id as alias_id,
          a.employee_id,
          e.display_name as employee_name,
          e.employee_code,
          a.alias_text,
          a.active,
          a.notes,
          a.created_at,
          a.updated_at
        from public.employee_aliases a
        join public.employees e on e.id = a.employee_id
        where (${includeInactive ? "true" : "a.active = true"})
          ${employeeFilterSql}
        order by e.display_name, a.alias_text
      `);

      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Employee aliases failed");
    }
  });

  router.post("/employee-aliases", requireSchedulePin, async (req, res) => {
    try {
      const employeeRef = String(req.body?.employee || req.body?.employee_ref || req.body?.employee_name || req.body?.employee_code || "").trim();
      const aliasText = String(req.body?.alias_text || req.body?.alias || "").trim();
      const notes = req.body?.notes == null ? null : String(req.body.notes);

      if (!employeeRef) throw new Error("employee or employee_ref is required.");
      if (!aliasText) throw new Error("alias_text is required.");

      const data = await runRpc("sch_upsert_employee_alias", {
        p_employee_ref: employeeRef,
        p_alias_text: aliasText,
        p_notes: notes,
      });

      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Employee alias upsert failed");
    }
  });

  router.patch("/employee-aliases/:aliasId", requireSchedulePin, async (req, res) => {
    try {
      const aliasId = String(req.params.aliasId || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(aliasId)) {
        throw new Error("aliasId must be a valid UUID.");
      }
      const active = req.body?.active !== false;
      const data = await runRpc("sch_set_employee_alias_active", {
        p_alias_id: aliasId,
        p_active: active,
      });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Employee alias update failed");
    }
  });

  router.get("/shift-templates", async (req, res) => {
    try {
      const employeeRef = String(req.query.employee || req.query.employee_name || req.query.employee_code || "").trim();
      const includeInactive = String(req.query.include_inactive || "").trim() === "1";
      let employeeFilterSql = "";

      if (employeeRef) {
        const resolvedRows = await runReadOnlySql(`
          select public.sch_resolve_employee_ref('${esc(employeeRef)}') as data
        `);
        const resolved = Array.isArray(resolvedRows) && resolvedRows.length ? resolvedRows[0].data : null;
        if (!resolved?.ok || !resolved.employee_id) {
          res.status(404).json({ ok: false, error: "Shift template lookup could not resolve that employee." });
          return;
        }
        employeeFilterSql = `and e.id = '${esc(resolved.employee_id)}'::uuid`;
      }

      const rows = await runReadOnlySql(`
        select
          est.id as template_id,
          est.employee_id,
          e.display_name as employee_name,
          e.employee_code,
          est.day_of_week,
          case est.day_of_week
            when 0 then 'Sunday'
            when 1 then 'Monday'
            when 2 then 'Tuesday'
            when 3 then 'Wednesday'
            when 4 then 'Thursday'
            when 5 then 'Friday'
            when 6 then 'Saturday'
          end as weekday,
          to_char(est.shift_start, 'HH24:MI:SS') as shift_start,
          to_char(est.shift_end, 'HH24:MI:SS') as shift_end,
          case when est.lunch_start is null then null else to_char(est.lunch_start, 'HH24:MI:SS') end as lunch_start,
          case when est.lunch_end is null then null else to_char(est.lunch_end, 'HH24:MI:SS') end as lunch_end,
          est.color_hex,
          est.active,
          est.notes,
          est.updated_at
        from public.employee_shift_templates est
        join public.employees e on e.id = est.employee_id
        where (${includeInactive ? "true" : "est.active = true"})
          ${employeeFilterSql}
        order by e.display_name, est.day_of_week, est.shift_start
      `);

      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Shift templates failed");
    }
  });

  router.patch("/shift-templates/metadata", requireSchedulePin, async (req, res) => {
    try {
      const employeeRef = String(req.body?.employee || req.body?.employee_ref || req.body?.employee_name || req.body?.employee_code || "").trim();
      const dayOfWeek = Number.parseInt(String(req.body?.day_of_week ?? req.body?.weekday_index ?? ""), 10);
      const lunchStart = req.body?.lunch_start == null || req.body?.lunch_start === "" ? null : requireTime(req.body.lunch_start);
      const lunchEnd = req.body?.lunch_end == null || req.body?.lunch_end === "" ? null : requireTime(req.body.lunch_end);
      const colorHex = req.body?.color_hex == null || req.body?.color_hex === "" ? null : String(req.body.color_hex).trim();
      const notes = req.body?.notes == null ? null : String(req.body.notes);

      if (!employeeRef) throw new Error("employee or employee_ref is required.");
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new Error("day_of_week must be 0-6.");

      const data = await runRpc("sch_set_employee_shift_template_metadata", {
        p_employee_ref: employeeRef,
        p_day_of_week: dayOfWeek,
        p_lunch_start: lunchStart,
        p_lunch_end: lunchEnd,
        p_color_hex: colorHex,
        p_notes: notes,
      });

      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Shift template metadata update failed");
    }
  });

  router.get("/pto", async (req, res) => {
    try {
      const startDate = requireDate(req.query.start_date || req.query.service_date || req.query.date || (await getServiceDate()));
      const endDate = requireDate(req.query.end_date || startDate);
      const rows = (await hasPtoTable()) ? await listPtoRows({ startDate, endDate }) : [];
      res.status(200).json({ ok: true, data: { start_date: startDate, end_date: endDate, rows }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "PTO lookup failed");
    }
  });

  router.post("/pto/import", requireSchedulePin, async (req, res) => {
    try {
      const imported = await importPtoRows(req.body?.rows || []);
      res.status(200).json({ ok: true, data: { imported_count: imported.length, rows: imported }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "PTO import failed");
    }
  });

  router.post("/pto/import-report", requireSchedulePin, async (req, res) => {
    try {
      const parsed = parsePtoReportText(req.body?.report_text || "");
      const imported = await importPtoRows(parsed.import_rows || []);
      res.status(200).json({ ok: true, data: { detected_count: parsed.detected_rows.length, kept_count: parsed.kept_rows.length, imported_count: imported.length, rows: imported }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "PTO report import failed");
    }
  });

  router.post("/pto/parse-report", async (req, res) => {
    try {
      const parsed = await aiParsePtoReportText(req.body?.report_text || "");
      res.status(200).json({ ok: true, data: { detected_count: parsed.detected_rows.length, kept_count: parsed.kept_rows.length, rows: parsed.import_rows, provider: parsed.provider, providers_used: parsed.providers_used, fallback_count: parsed.fallback_count }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "PTO report parse failed");
    }
  });

  router.get("/coverall/slots", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const slots = await listCoverAllSlotsForDate(serviceDate);
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, slots },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "CoverAll slot lookup failed");
    }
  });

  router.post("/coverall/slots", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];
      const data = await publishCoverAllSlotsForDate(serviceDate, slots);
      res.status(200).json({
        ok: true,
        data,
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "CoverAll slot publish failed");
    }
  });

  router.get("/coverall/assignment", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const slotCode = normalizeCoverAllSlotCode(req.query.slot || req.query.slot_code || req.query.employee_code || "COVERALL_01");
      const lang = String(req.query.lang || "en").trim().toLowerCase() === "es" ? "es" : "en";
      const slot = await getCoverAllSlotByCode(slotCode);
      const rows = await runReadOnlySql(`
        select public.sch_employee_my_schedule_page(
          '${esc(serviceDate)}'::date,
          '${esc(slot.employee_id)}'::uuid,
          now()
        ) as data
      `);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      const items = Array.isArray(data?.items) ? data.items : [];
      const enUrl = coverAllPublicPath(serviceDate, slot.employee_code, "en");
      const esUrl = coverAllPublicPath(serviceDate, slot.employee_code, "es");
      const t = lang === "es"
        ? { title: "Asignaciones de CoverAll", shift: "Turno", areas: "Áreas asignadas", restrooms: "Baños públicos", other: "Otras áreas", none: "No hay asignaciones publicadas todavía.", language: "English", notice: "Revise sus áreas asignadas. No hay acceso a otras herramientas." }
        : { title: "CoverAll Assignments", shift: "Shift", areas: "Assigned areas", restrooms: "Public restrooms", other: "Other areas", none: "No assignments posted yet.", language: "Español", notice: "Review your assigned areas. No access to other tools is provided." };
      const restroomItems = items.filter((item) => item?.is_public_restroom);
      const otherItems = items.filter((item) => !item?.is_public_restroom);
      const renderItems = (list) => list.length
        ? list.map((item) => `<li>${htmlEscape(item.name || item.group_name || item.location_name || item.group_code || "Area")}</li>`).join("")
        : `<li class="muted">${htmlEscape(t.none)}</li>`;
      const switchUrl = lang === "es" ? enUrl : esUrl;
      const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${htmlEscape(t.title)}</title>
<style>
  :root{--teal:#0f4d57;--teal2:#0b3b43;--mint:#e8f4ef;--line:#cfe1db;--text:#173238;--muted:#63787d;--warn:#fff3cd;--warnline:#f0d98a}
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#eef5f3;color:var(--text)}
  .top{background:linear-gradient(135deg,var(--teal),var(--teal2));color:white;padding:22px 18px 26px;border-bottom-left-radius:24px;border-bottom-right-radius:24px;box-shadow:0 4px 16px rgba(0,0,0,.18)}
  .eyebrow{font-size:13px;opacity:.84;letter-spacing:.03em;text-transform:uppercase}.lang{float:right;color:white;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.24);border-radius:999px;padding:7px 10px;text-decoration:none;font-weight:800;font-size:13px}
  h1{margin:8px 0 3px;font-size:30px;line-height:1.08}.shift{font-size:17px;opacity:.95}.wrap{max-width:720px;margin:0 auto;padding:16px}.notice{background:var(--warn);border:1px solid var(--warnline);border-radius:16px;padding:12px 14px;margin-bottom:14px;font-weight:650}.card{background:white;border:1px solid var(--line);border-radius:20px;padding:16px;margin:14px 0;box-shadow:0 2px 10px rgba(20,60,70,.07)}.card h2{margin:0 0 10px;font-size:20px;color:var(--teal)}ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}li{padding:11px 12px;background:#f8fbfa;border:1px solid #e1ece8;border-radius:13px;font-weight:620}li.muted{color:var(--muted);font-weight:500}.meta{margin-top:14px;color:var(--muted);font-size:13px;text-align:center}.pill{display:inline-block;padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.16);font-size:13px;margin-top:8px}
</style>
</head>
<body>
  <header class="top"><a class="lang" href="${htmlEscape(switchUrl)}">${htmlEscape(t.language)}</a><div class="eyebrow">${htmlEscape(t.title)}</div><h1>${htmlEscape(slot.display_name || slot.employee_code)}</h1><div class="shift">${htmlEscape(t.shift)}: ${htmlEscape(data?.shift?.start || "—")} - ${htmlEscape(data?.shift?.end || "—")}</div><div class="pill">${htmlEscape(serviceDate)}</div></header>
  <main class="wrap"><div class="notice">${htmlEscape(t.notice)}</div><section class="card"><h2>${htmlEscape(t.restrooms)}</h2><ul>${renderItems(restroomItems)}</ul></section><section class="card"><h2>${htmlEscape(t.other)}</h2><ul>${renderItems(otherItems)}</ul></section><div class="meta">${htmlEscape(slot.employee_code)} • ${htmlEscape(serviceDate)}</div></main>
</body>
</html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(html);
    } catch (error) {
      res.status(400).send(`<!doctype html><html><body style="font-family:system-ui;padding:20px"><h1>CoverAll schedule unavailable</h1><p>${htmlEscape(error?.message || "Schedule unavailable")}</p></body></html>`);
    }
  });

  router.get("/location-groups", async (_req, res) => {
    try {
      const rows = await listLocationGroups();
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Location groups failed");
    }
  });

  router.post("/ai/recommendations", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const prompt = String(req.body?.prompt || "").trim();
      const dayRows = await listDayGroups(serviceDate);
      const groupSummaries = summarizeOpenAndOverloadedGroups(dayRows);
      const locationGroups = await listLocationGroups();
      let ai = null;
      try {
        ai = await tryGeminiSchedulerRecommendations({ serviceDate, groupSummaries, locationGroups, userPrompt: prompt });
      } catch {
        ai = null;
      }
      const fallback = buildFallbackSchedulerRecommendations({ serviceDate, groupSummaries, userPrompt: prompt });
      const data = ai?.ok && ai.data
        ? {
            provider: ai.provider,
            model: ai.model,
            summary: String(ai.data.summary || fallback.summary || "").trim() || fallback.summary,
            recommendations: Array.isArray(ai.data.recommendations) ? ai.data.recommendations : fallback.recommendations,
            watchouts: Array.isArray(ai.data.watchouts) ? ai.data.watchouts : fallback.watchouts,
            group_summaries: groupSummaries,
          }
        : {
            ...fallback,
            group_summaries: groupSummaries,
          };
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Scheduler AI recommendations failed");
    }
  });

  router.get("/coverage-templates/export.csv", async (_req, res) => {
    try {
      const rows = await runReadOnlySql(`
        select
          ct.id as coverage_template_id,
          ct.day_of_week,
          case ct.day_of_week
            when 0 then 'Sunday'
            when 1 then 'Monday'
            when 2 then 'Tuesday'
            when 3 then 'Wednesday'
            when 4 then 'Thursday'
            when 5 then 'Friday'
            when 6 then 'Saturday'
          end as weekday,
          lg.group_name,
          lg.group_code,
          ct.segment_number,
          coalesce(e.display_name, '') as assigned_employee,
          ct.owner_type,
          ct.coverage_purpose,
          to_char(ct.coverage_start, 'HH24:MI:SS') as coverage_start,
          to_char(ct.coverage_end, 'HH24:MI:SS') as coverage_end,
          ct.active,
          coalesce(ct.notes, '') as notes
        from public.coverage_templates ct
        join public.location_groups lg on lg.id = ct.location_group_id
        left join public.employees e on e.id = ct.assigned_employee_id
        order by ct.day_of_week, lg.group_name, ct.segment_number, ct.coverage_start
      `);
      const csv = rowsToCsv(rows || [], [
        { key: "coverage_template_id", label: "coverage_template_id" },
        { key: "day_of_week", label: "day_of_week" },
        { key: "weekday", label: "weekday" },
        { key: "group_name", label: "group_name" },
        { key: "group_code", label: "group_code" },
        { key: "segment_number", label: "segment_number" },
        { key: "assigned_employee", label: "assigned_employee" },
        { key: "owner_type", label: "owner_type" },
        { key: "coverage_purpose", label: "coverage_purpose" },
        { key: "coverage_start", label: "coverage_start" },
        { key: "coverage_end", label: "coverage_end" },
        { key: "active", label: "active" },
        { key: "notes", label: "notes" },
      ]);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=coverage-templates.csv");
      res.status(200).send(csv);
    } catch (error) {
      fail(res, error, "Coverage template export failed");
    }
  });

  router.get("/locations/workload-settings", async (_req, res) => {
    try {
      const rows = await runReadOnlySql(`select * from public.sch_list_location_workload_settings()`);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Location workload settings failed");
    }
  });

  router.post("/locations/:locationId/workload-settings", requireSchedulePin, async (req, res) => {
    try {
      const locationId = String(req.params.locationId || "").trim();
      if (!locationId) throw new Error("locationId is required.");
      const difficultyRating = toNullableRating(req.body?.difficulty_rating);
      const priorityRating = toNullableRating(req.body?.priority_rating);
      const workloadNotes = req.body?.workload_notes == null ? null : String(req.body.workload_notes);
      const data = await runRpc("sch_set_location_workload_settings", {
        p_location_id: locationId,
        p_difficulty_rating: difficultyRating,
        p_priority_rating: priorityRating,
        p_workload_notes: workloadNotes,
      });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Update location workload settings failed");
    }
  });

  router.use(async (req, _res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/generation-window") && !req.path.startsWith("/health")) {
      maybeAutoGenerateWindow().catch((error) => console.error("schedule auto-generate trigger failed:", error));
    }
    next();
  });

  router.get("/current-owner", async (req, res) => {
    try {
      const locationCode = String(req.query.location_code || req.query.code || "").trim();
      if (!locationCode) throw new Error("location_code is required.");
      const atSql = optionalTimestampLiteral(req.query.at);
      const rows = await runReadOnlySql(`select * from public.sch_get_current_owner('${esc(locationCode)}', ${atSql})`);
      const data = Array.isArray(rows) && rows.length ? rows[0] : null;
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Current owner lookup failed");
    }
  });

  router.post("/generate-daily", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const force = req.body?.force !== false;
      const data = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: force });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Generate daily schedule failed");
    }
  });

  router.get("/generation-window", async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const days = Math.max(1, Math.min(14, Number.parseInt(String(req.query.days || 7), 10) || 7));
      const triggerAuto = String(req.query.trigger_auto || "").trim() === "1";
      if (triggerAuto) await maybeAutoGenerateWindow(serviceDate);
      const window = await getScheduleRangeStatus(serviceDate, days);
      const ready_days = window.filter((row) => row.ready).length;
      const autoGeneration = { running: autoGenerateState.running, last_started_at: autoGenerateState.lastStartedAt || null, last_completed_at: autoGenerateState.lastCompletedAt || null, last_window_start: autoGenerateState.lastWindowStart || null, generated_days: Array.isArray(autoGenerateState.lastResult) ? autoGenerateState.lastResult.filter((row) => row.generated).length : 0 };
      res.status(200).json({ ok: true, data: { service_date: serviceDate, days, ready_days, missing_days: Math.max(0, days - ready_days), window, auto_generation: autoGeneration, ai_summary: buildWeekSummaryText({ serviceDate, days, windowRows: window, autoGeneration }) }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Schedule window status failed");
    }
  });

  router.post("/generate-range", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const days = Math.max(1, Math.min(14, Number.parseInt(String(req.body?.days || 7), 10) || 7));
      const force = req.body?.force === true;
      const generated_days = await ensureScheduleRange(serviceDate, days, { force });
      res.status(200).json({ ok: true, data: { service_date: serviceDate, days, generated_days }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Generate schedule range failed");
    }
  });

  router.post("/manual-absences/publish", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const explicit = normalizeUuidList(req.body?.absent_employee_ids || []);
      const idsSql = uuidArrayLiteral(explicit);
      let coverallPlan = await buildCoverAllPlan(serviceDate, explicit);

      await runWriteSql("manual_absence_publish", `
        update public.daily_absence_overrides
           set active = false,
               updated_at = now(),
               notes = coalesce(notes, 'Cleared by simplified absence scheduler')
         where absence_date = '${esc(serviceDate)}'::date
           and active = true
           and absence_type = 'manual_override';

        insert into public.daily_absence_overrides (
          id, absence_date, employee_id, absence_type, active, notes, created_at, updated_at
        )
        select gen_random_uuid(), '${esc(serviceDate)}'::date, x.employee_id, 'manual_override', true,
               'Published from simplified absence scheduler', now(), now()
        from (select distinct unnest(${idsSql}) as employee_id) x
        where not exists (
          select 1
          from public.daily_absence_overrides y
          where y.absence_date = '${esc(serviceDate)}'::date
            and y.employee_id = x.employee_id
            and y.active = true
        );
      `);

      const generateResult = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: true });
      coverallPlan = await applyCoverAllPlan(serviceDate, coverallPlan);
      const activeRows = await listPtoRows({ startDate: serviceDate, endDate: serviceDate });
      const manualRows = activeRows.filter((row) => String(row.pto_type || "").toLowerCase() === "manual_override");

      res.status(200).json({
        ok: true,
        data: {
          service_date: serviceDate,
          selected_absent_count: explicit.length,
          manual_absence_count: manualRows.length,
          active_absence_count: activeRows.length,
          active_absences: activeRows,
          generate_result: generateResult,
          coverall: coverallPlan,
          manager_notification: coverallPlan?.manager_notification || null,
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Manual absence publish failed");
    }
  });

  router.post("/manual-absences/return", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const employeeRef = String(
        req.body?.employee_id ||
        req.body?.employee ||
        req.body?.employee_ref ||
        req.body?.employee_name ||
        req.body?.employee_code ||
        ""
      ).trim();

      if (!employeeRef) throw new Error("employee_id, employee_name, employee_code, or employee_ref is required.");

      let employeeId = "";
      let employeeName = "";

      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeRef)) {
        employeeId = employeeRef;
      } else {
        const resolvedRows = await runReadOnlySql(`
          select public.sch_resolve_employee_ref('${esc(employeeRef)}') as data
        `);
        const resolved = Array.isArray(resolvedRows) && resolvedRows.length ? resolvedRows[0].data : null;
        if (resolved?.ok && resolved.employee_id) employeeId = String(resolved.employee_id);
      }

      if (!employeeId) {
        const fallbackRows = await runReadOnlySql(`
          select id as employee_id, display_name as employee_name
          from public.employees
          where active = true
            and (display_name ilike '${esc(employeeRef)}' or employee_code ilike '${esc(employeeRef)}')
          order by display_name
          limit 1
        `);
        if (Array.isArray(fallbackRows) && fallbackRows.length) {
          employeeId = String(fallbackRows[0].employee_id || "");
          employeeName = String(fallbackRows[0].employee_name || "");
        }
      }

      if (!employeeId) throw new Error("Could not resolve employee to return to schedule.");

      if (!employeeName) {
        const employeeRows = await runReadOnlySql(`
          select display_name as employee_name
          from public.employees
          where id = '${esc(employeeId)}'::uuid
          limit 1
        `);
        employeeName = Array.isArray(employeeRows) && employeeRows.length ? String(employeeRows[0].employee_name || "") : "";
      }

      await runWriteSql("manual_absence_return", `
        update public.daily_absence_overrides
           set active = false,
               updated_at = now(),
               notes = trim(concat_ws(' ', nullif(notes, ''), 'Cleared: employee returned to schedule.'))
         where absence_date = '${esc(serviceDate)}'::date
           and employee_id = '${esc(employeeId)}'::uuid
           and absence_type = 'manual_override'
           and active = true;
      `);

      const generateResult = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: true });
      const activeRows = await listPtoRows({ startDate: serviceDate, endDate: serviceDate });
      const stillAbsentRows = activeRows.filter((row) => String(row.employee_id || "") === employeeId);

      res.status(200).json({
        ok: true,
        data: {
          service_date: serviceDate,
          returned_employee_id: employeeId,
          returned_employee_name: employeeName || null,
          still_absent: stillAbsentRows.length > 0,
          still_absent_reasons: stillAbsentRows,
          active_absence_count: activeRows.length,
          active_absences: activeRows,
          generate_result: generateResult,
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Return employee to schedule failed");
    }
  });

  router.post("/absence-preview", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const absenceSet = await mergeExplicitAndPtoAbsences(serviceDate, req.body?.absent_employee_ids || []);
      const absentIdsSql = uuidArrayLiteral(absenceSet.merged);
      const initialState = await getDailyGenerationState(serviceDate);
      let generatedBeforePreview = false;

      if (initialState.assignment_count === 0) {
        await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: true });
        generatedBeforePreview = true;
      }

      const finalState = generatedBeforePreview ? await getDailyGenerationState(serviceDate) : initialState;
      const rows = await runReadOnlySql(`select public.sch_absence_preview('${esc(serviceDate)}'::date, ${absentIdsSql}) as data`);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      const diff = summarizeAssignmentDiff(data || {}, { absentEmployeeIds: absenceSet.merged });
      if (data && typeof data === "object") Object.assign(data, diff, { explicit_absent_employee_ids: absenceSet.explicit, pto_absent_employee_ids: absenceSet.pto_ids, effective_absent_employee_ids: absenceSet.merged });
      const aiSummary = buildAbsenceSummaryText(data || {}, {
        generated_before_preview: generatedBeforePreview,
      }, serviceDate);
      res.status(200).json({
        ok: true,
        data: data && typeof data === "object" ? { ...data, ai_summary: aiSummary } : data,
        meta: {
          version: appVersion,
          release_id: releaseId,
          contract_version: contractVersion,
          generated_before_preview: generatedBeforePreview,
          generation_mode: generatedBeforePreview ? "auto_generated" : "existing",
          generated_roster_rows: finalState.roster_count,
          generated_assignment_rows: finalState.assignment_count,
        },
      });
    } catch (error) {
      fail(res, error, "Absence preview failed");
    }
  });

  router.post("/absence-publish", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const explicitIds = normalizeUuidList(req.body?.absent_employee_ids || []);
      let coverallPlan = await buildCoverAllPlan(serviceDate, explicitIds);
      const absenceSet = await mergeExplicitAndPtoAbsences(serviceDate, explicitIds);
      const data = await runRpc("sch_absence_publish", {
        p_service_date: serviceDate,
        p_absent_employee_ids: absenceSet.merged,
      });
      coverallPlan = await applyCoverAllPlan(serviceDate, coverallPlan);
      if (data && typeof data === "object") {
        const diff = summarizeAssignmentDiff({
          removed_assignments: data.removed_assignments || data.generate_result?.removed_assignments,
          reassigned_assignments: data.reassigned_assignments || data.generate_result?.reassigned_assignments,
          open_segments: data.open_segments || data.generate_result?.open_segments,
          overload_warnings: data.overload_warnings || data.generate_result?.overload_warnings,
        }, { absentEmployeeIds: absenceSet.merged });
        data.generate_result = { ...(data.generate_result || {}), ...diff };
        data.explicit_absent_employee_ids = absenceSet.explicit;
        data.pto_absent_employee_ids = absenceSet.pto_ids;
        data.effective_absent_employee_ids = absenceSet.merged;
        data.coverall = coverallPlan;
        data.manager_notification = coverallPlan?.manager_notification || null;
      }
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Absence publish failed");
    }
  });

  return router;
}
