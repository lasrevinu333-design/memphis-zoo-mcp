import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getGeminiApiKey } from "./utils/gemini-config.js";
import { resolveCanonicalDevice } from "./device-identity.js";
import { consolidateScheduleItems } from "./schedule-display.js";

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

const RESTROOM_REBALANCE_TIME = String(process.env.RESTROOM_REBALANCE_TIME || "09:45:00").trim() || "09:45:00";
const RESTROOM_REBALANCE_IMPLEMENTATION_MODE = "dynamic_route_fit_load_balancing";
const RESTROOM_REBALANCE_SOURCE = "restroom_rebalance_0945";
const RESTROOM_REBALANCE_NOTE = "9:45 restroom rebalance: moved only as needed to spread restroom load evenly while staying near the current route.";
const RESTROOM_REBALANCE_TZ = "America/Chicago";
const RESTROOM_REBALANCE_MAX_WALK_MINUTES = Math.max(4, Number.parseInt(String(process.env.RESTROOM_REBALANCE_MAX_WALK_MINUTES || "12"), 10) || 12);
const RESTROOM_REBALANCE_SEVERE_SPREAD = Math.max(2, Number.parseInt(String(process.env.RESTROOM_REBALANCE_SEVERE_SPREAD || "4"), 10) || 4);
const RESTROOM_REBALANCE_FLEX_HELPER_WALK_MINUTES = Math.max(1, Number.parseInt(String(process.env.RESTROOM_REBALANCE_FLEX_HELPER_WALK_MINUTES || "6"), 10) || 6);

function nonNegativeInt(value, fallback = 0) {
  const raw = value == null || String(value).trim() === "" ? fallback : value;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Number(fallback) || 0);
  return parsed;
}

export function resolveRestroomRebalanceScheduler(env = process.env) {
  const isRenderProduction = String(env.RENDER || "").trim().toLowerCase() === "true"
    && String(env.NODE_ENV || "").trim().toLowerCase() === "production"
    && String(env.IS_PULL_REQUEST || "").trim().toLowerCase() !== "true";
  const configuredValue = String(env.RESTROOM_REBALANCE_SWEEP_MS ?? "").trim();
  const defaultSweepMs = isRenderProduction ? 60000 : 0;
  let sweepMs = defaultSweepMs;
  let source = isRenderProduction ? "render_production_default" : "disabled_by_default";

  if (configuredValue) {
    const parsed = /^\d+$/.test(configuredValue) ? Number.parseInt(configuredValue, 10) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      sweepMs = 0;
      source = "invalid_environment_disabled";
    } else if (parsed > 0 && !isRenderProduction) {
      sweepMs = 0;
      source = "non_render_override_rejected";
    } else {
      sweepMs = parsed;
      source = "environment";
    }
  }

  return {
    enabled: sweepMs > 0,
    sweep_ms: sweepMs,
    owner: sweepMs > 0 ? "render_production" : "disabled",
    source,
  };
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  return (hours % 24) * 60 + minutes;
}

const RESTROOM_REBALANCE_EXCLUDED_EMPLOYEES = String(process.env.RESTROOM_REBALANCE_EXCLUDED_EMPLOYEE_CODES || "")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const RESTROOM_REBALANCE_EXCLUDED_NAMES = String(process.env.RESTROOM_REBALANCE_EXCLUDED_EMPLOYEE_NAMES || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function isRestroomRebalanceRosterEligible(row) {
  const employeeCode = String(row?.employee_code || "").trim().toUpperCase();
  const employeeName = String(row?.employee_name || row?.display_name || "").trim().toLowerCase();
  if (RESTROOM_REBALANCE_EXCLUDED_EMPLOYEES.includes(employeeCode) || RESTROOM_REBALANCE_EXCLUDED_NAMES.includes(employeeName)) return false;
  const start = timeToMinutes(row?.shift_start);
  const end = timeToMinutes(row?.shift_end);
  const rebalance = timeToMinutes(RESTROOM_REBALANCE_TIME);
  if (start == null || end == null || rebalance == null) return false;
  return start <= rebalance && end > rebalance;
}

function getMemphisClockParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: RESTROOM_REBALANCE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number.parseInt(parts.hour || "0", 10) % 24;
  const minute = Number.parseInt(parts.minute || "0", 10);
  const second = Number.parseInt(parts.second || "0", 10);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
    second,
    minutes_since_midnight: hour * 60 + minute,
  };
}

function isRestroomRebalanceDue(now = new Date()) {
  const clock = getMemphisClockParts(now);
  const threshold = timeToMinutes(RESTROOM_REBALANCE_TIME);
  return threshold != null && clock.minutes_since_midnight >= threshold;
}

function isProtectedRestroomSource(sourceType = "") {
  return /manual|override|manager|restroom_rebalance_0945/i.test(String(sourceType || ""));
}

function sqlQuote(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function normalizeRestroomRebalanceCompletionRow(row = {}) {
  if (!row || typeof row !== "object") return null;
  const status = String(row.status || "").trim().toLowerCase();
  if (!status) return null;
  return {
    automation_key: String(row.automation_key || RESTROOM_REBALANCE_SOURCE).trim(),
    service_date: String(row.service_date || "").slice(0, 10),
    status,
    completed: status === "completed",
    result: row.result_json || row.result || null,
    completed_at: row.completed_at || row.updated_at || null,
  };
}

function buildRestroomRebalanceCompletionSelectSql(serviceDate) {
  return `
    select automation_key,
           service_date::text as service_date,
           status,
           result_json,
           updated_at as completed_at
    from public.schedule_automation_runs
    where automation_key = '${sqlQuote(RESTROOM_REBALANCE_SOURCE)}'
      and service_date = '${sqlQuote(serviceDate)}'::date
      and status = 'completed'
    limit 1
  `;
}

function normalizeIdList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
  }
  if (value == null) return [];
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeIdList(parsed);
  } catch (_error) {
    // Fall through to Postgres text-array parsing.
  }
  return Array.from(new Set(text
    .replace(/[{}\"]/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)));
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
  }
  if (value == null) return [];
  if (typeof value === "object") return normalizeTextList(Object.values(value));
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeTextList(parsed);
  } catch (_error) {
    // Fall through to comma/text-array parsing.
  }
  return Array.from(new Set(text
    .replace(/[{}\"]/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)));
}

function normalizeRouteFitRows(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const employeeId = String(row.employee_id || "").trim();
    const locationGroupId = String(row.location_group_id || "").trim();
    if (!employeeId || !locationGroupId) continue;
    const currentGroupCount = Number(row.current_group_count || 0);
    const sameZone = row.same_zone === true || String(row.same_zone || "").toLowerCase() === "true";
    const sameGroup = row.same_group === true || String(row.same_group || "").toLowerCase() === "true";
    const rawWalk = Number(row.walking_minutes);
    const walkingMinutes = Number.isFinite(rawWalk)
      ? rawWalk
      : (currentGroupCount > 0 ? (sameZone ? 4 : 999) : RESTROOM_REBALANCE_FLEX_HELPER_WALK_MINUTES);
    map.set(`${employeeId}|${locationGroupId}`, {
      employee_id: employeeId,
      location_group_id: locationGroupId,
      walking_minutes: walkingMinutes,
      same_zone: sameZone,
      same_group: sameGroup,
      route_anchor_zone_code: String(row.route_anchor_zone_code || "").trim(),
      target_zone_code: String(row.target_zone_code || "").trim(),
      current_group_count: currentGroupCount,
      route_context: String(row.route_context || "").trim(),
    });
  }
  return map;
}

function getRouteFitForRestroomMove(employee = {}, assignment = {}, routeFitMap = new Map()) {
  const employeeId = String(employee?.employee_id || "").trim();
  const groupId = String(assignment?.location_group_id || "").trim();
  const direct = routeFitMap.get(`${employeeId}|${groupId}`);
  if (direct) return direct;

  const employeeZones = normalizeTextList(employee?.zone_codes);
  const targetZone = String(assignment?.zone_code || "").trim();
  const sameZone = Boolean(targetZone && employeeZones.includes(targetZone));
  const currentGroupCount = Number(employee?.current_group_count || 0);
  return {
    employee_id: employeeId,
    location_group_id: groupId,
    walking_minutes: currentGroupCount > 0 ? (sameZone ? 4 : 999) : RESTROOM_REBALANCE_FLEX_HELPER_WALK_MINUTES,
    same_zone: sameZone,
    same_group: false,
    route_anchor_zone_code: String(employee?.route_anchor_zone_code || "").trim(),
    target_zone_code: targetZone,
    current_group_count: currentGroupCount,
    route_context: currentGroupCount > 0 ? (sameZone ? "same_zone_fallback" : "far_or_unknown") : "flex_helper_no_current_route",
  };
}

function canUseRouteFitForRestroomMove(routeFit = {}, beforeSpread = 0) {
  const currentGroupCount = Number(routeFit?.current_group_count || 0);
  if (currentGroupCount <= 0) return true;
  if (routeFit?.same_group || routeFit?.same_zone) return true;
  const walkingMinutes = Number(routeFit?.walking_minutes || 999);
  if (walkingMinutes >= 999) return false;
  if (walkingMinutes <= RESTROOM_REBALANCE_MAX_WALK_MINUTES) return true;
  return Number(beforeSpread || 0) >= RESTROOM_REBALANCE_SEVERE_SPREAD
    && walkingMinutes <= (RESTROOM_REBALANCE_MAX_WALK_MINUTES * 2);
}

function restroomMoveRouteScore(routeFit = {}) {
  const walkingMinutes = Number(routeFit?.walking_minutes || 999);
  const currentGroupCount = Number(routeFit?.current_group_count || 0);
  if (currentGroupCount <= 0) return RESTROOM_REBALANCE_FLEX_HELPER_WALK_MINUTES + 4;
  if (routeFit?.same_group) return 0;
  if (routeFit?.same_zone) return Math.min(walkingMinutes, 4);
  return walkingMinutes + 12;
}

function normalizeRestroomRebalanceRow(row = {}) {
  const assignmentId = String(row.assignment_id || row.id || "").trim();
  const employeeId = String(row.assigned_employee_id || row.employee_id || "").trim();
  if (!assignmentId || !employeeId) return null;
  return {
    assignment_id: assignmentId,
    assigned_employee_id: employeeId,
    assigned_employee_name: String(row.assigned_employee_name || row.employee_name || "").trim(),
    employee_code: String(row.employee_code || "").trim(),
    location_group_id: String(row.location_group_id || "").trim(),
    group_name: String(row.group_name || row.group_code || "Restroom").trim(),
    group_code: String(row.group_code || "").trim(),
    zone_code: String(row.zone_code || "").trim(),
    zone_name: String(row.zone_name || "").trim(),
    segment_number: Number(row.segment_number || 0),
    coverage_start: String(row.coverage_start || "").slice(0, 8),
    coverage_end: String(row.coverage_end || "").slice(0, 8),
    source_type: String(row.source_type || "").trim(),
    load_points: Math.max(1, Number(row.load_points || 1)),
    restricted_employee_ids: normalizeIdList(row.restricted_employee_ids),
  };
}

function loadSpread(loadByEmployee) {
  const values = Array.from(loadByEmployee.values()).map((value) => Number(value || 0));
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function canRosterEmployeeCoverAssignment(employee = {}, assignment = {}) {
  const shiftStart = timeToMinutes(employee.shift_start);
  const shiftEnd = timeToMinutes(employee.shift_end);
  const coverageStart = timeToMinutes(assignment.coverage_start);
  const coverageEnd = timeToMinutes(assignment.coverage_end);
  if (shiftStart == null || shiftEnd == null || coverageStart == null || coverageEnd == null) return false;
  return shiftStart <= coverageStart && shiftEnd >= coverageEnd;
}

function canEmployeeReceiveRestroomAssignment(receiverId, donorId, employee = {}, assignment = {}) {
  const normalizedReceiverId = String(receiverId || "").trim();
  const normalizedDonorId = String(donorId || "").trim();
  if (!normalizedReceiverId) return false;
  if (normalizedReceiverId === normalizedDonorId) return false;
  if (isProtectedRestroomSource(assignment.source_type)) return false;
  if (!canRosterEmployeeCoverAssignment(employee, assignment)) return false;
  const restrictedEmployeeIds = Array.isArray(assignment.restricted_employee_ids)
    ? assignment.restricted_employee_ids
    : [];
  return !restrictedEmployeeIds.includes(normalizedReceiverId);
}

function buildRestroomRebalancePlan(assignments = [], activeRoster = [], routeFitRows = []) {
  const routeFitMap = normalizeRouteFitRows(routeFitRows);
  const employeeMeta = new Map();
  const loadByEmployee = new Map();
  for (const row of Array.isArray(activeRoster) ? activeRoster : []) {
    const employeeId = String(row.employee_id || row.id || "").trim();
    if (!employeeId) continue;
    employeeMeta.set(employeeId, {
      employee_id: employeeId,
      employee_name: String(row.employee_name || row.display_name || "").trim(),
      employee_code: String(row.employee_code || "").trim(),
      shift_start: String(row.shift_start || "").trim(),
      shift_end: String(row.shift_end || "").trim(),
      zone_codes: normalizeTextList(row.zone_codes),
      route_anchor_zone_code: String(row.route_anchor_zone_code || "").trim(),
      current_group_count: Number(row.current_group_count || 0),
    });
    loadByEmployee.set(employeeId, 0);
  }

  if (!loadByEmployee.size) {
    return { applied: false, reason: "no_active_employees", moved_count: 0, moves: [] };
  }

  const activeEmployeeIds = new Set(loadByEmployee.keys());
  const normalizedAssignments = (Array.isArray(assignments) ? assignments : [])
    .map((row) => normalizeRestroomRebalanceRow(row))
    .filter((row) => row && activeEmployeeIds.has(row.assigned_employee_id));

  if (!normalizedAssignments.length) {
    return { applied: false, reason: "no_restroom_assignments", moved_count: 0, moves: [] };
  }

  for (const assignment of normalizedAssignments) {
    loadByEmployee.set(assignment.assigned_employee_id, (loadByEmployee.get(assignment.assigned_employee_id) || 0) + assignment.load_points);
  }

  const initialLoads = new Map(loadByEmployee);
  const totalLoad = Array.from(loadByEmployee.values()).reduce((sum, value) => sum + Number(value || 0), 0);
  const targetLoad = totalLoad / Math.max(1, loadByEmployee.size);
  const movableAssignments = normalizedAssignments.filter((row) => !isProtectedRestroomSource(row.source_type));
  const movedAssignmentIds = new Set();
  const moves = [];
  const maxMoves = movableAssignments.length;

  for (let guard = 0; guard < maxMoves; guard += 1) {
    const sortedLoads = Array.from(loadByEmployee.entries()).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
    const beforeSpread = loadSpread(loadByEmployee);
    if (beforeSpread <= 1) break;

    let bestCandidate = null;

    for (const [donorId, donorLoad] of sortedLoads) {
      const donorAssignments = movableAssignments
        .filter((assignment) => assignment.assigned_employee_id === donorId && !movedAssignmentIds.has(assignment.assignment_id))
        .sort((a, b) => a.load_points - b.load_points || String(a.group_name).localeCompare(String(b.group_name)));

      for (const assignment of donorAssignments) {
        const receiverCandidates = Array.from(loadByEmployee.entries())
          .filter(([receiverId]) => canEmployeeReceiveRestroomAssignment(
            receiverId,
            donorId,
            employeeMeta.get(receiverId) || {},
            assignment,
          ))
          .sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0));

        for (const [receiverId, receiverLoad] of receiverCandidates) {
          const receiverMeta = employeeMeta.get(receiverId) || {};
          const routeFit = getRouteFitForRestroomMove(receiverMeta, assignment, routeFitMap);
          if (!canUseRouteFitForRestroomMove(routeFit, beforeSpread)) continue;

          const after = new Map(loadByEmployee);
          after.set(donorId, Number(donorLoad || 0) - assignment.load_points);
          after.set(receiverId, Number(receiverLoad || 0) + assignment.load_points);
          const afterSpread = loadSpread(after);
          if (afterSpread >= beforeSpread) continue;

          const beforeDistance = Math.abs(Number(donorLoad || 0) - targetLoad) + Math.abs(Number(receiverLoad || 0) - targetLoad);
          const afterDistance = Math.abs((Number(donorLoad || 0) - assignment.load_points) - targetLoad) + Math.abs((Number(receiverLoad || 0) + assignment.load_points) - targetLoad);
          const routeScore = restroomMoveRouteScore(routeFit);
          const candidate = {
            donorId,
            receiverId,
            assignment,
            afterSpread,
            distanceImprovement: beforeDistance - afterDistance,
            routeScore,
            routeFit,
          };
          if (!bestCandidate
            || candidate.afterSpread < bestCandidate.afterSpread
            || (candidate.afterSpread === bestCandidate.afterSpread && candidate.routeScore < bestCandidate.routeScore)
            || (candidate.afterSpread === bestCandidate.afterSpread && candidate.routeScore === bestCandidate.routeScore && candidate.distanceImprovement > bestCandidate.distanceImprovement)
            || (candidate.afterSpread === bestCandidate.afterSpread && candidate.routeScore === bestCandidate.routeScore && candidate.distanceImprovement === bestCandidate.distanceImprovement && assignment.load_points < bestCandidate.assignment.load_points)
            || (candidate.afterSpread === bestCandidate.afterSpread
              && candidate.routeScore === bestCandidate.routeScore
              && candidate.distanceImprovement === bestCandidate.distanceImprovement
              && assignment.load_points === bestCandidate.assignment.load_points
              && String(assignment.group_name).localeCompare(String(bestCandidate.assignment.group_name)) < 0)) {
            bestCandidate = candidate;
          }
        }
      }
    }

    if (!bestCandidate) break;

    const { donorId, receiverId, assignment: chosen } = bestCandidate;
    const routeFit = bestCandidate.routeFit || {};
    const donorLoad = loadByEmployee.get(donorId) || 0;
    const receiverLoad = loadByEmployee.get(receiverId) || 0;
    movedAssignmentIds.add(chosen.assignment_id);
    loadByEmployee.set(donorId, donorLoad - chosen.load_points);
    loadByEmployee.set(receiverId, receiverLoad + chosen.load_points);

    const donorMeta = employeeMeta.get(donorId) || {};
    const receiverMeta = employeeMeta.get(receiverId) || {};
    moves.push({
      assignment_id: chosen.assignment_id,
      from_employee_id: donorId,
      from_employee_name: donorMeta.employee_name || chosen.assigned_employee_name,
      to_employee_id: receiverId,
      to_employee_name: receiverMeta.employee_name || "Employee",
      group_name: chosen.group_name,
      group_code: chosen.group_code,
      segment_number: chosen.segment_number,
      coverage_start: chosen.coverage_start,
      coverage_end: chosen.coverage_end,
      load_points: chosen.load_points,
      route_score: bestCandidate.routeScore,
      walking_minutes: routeFit.walking_minutes,
      same_zone: routeFit.same_zone === true,
      same_group: routeFit.same_group === true,
      route_anchor_zone_code: routeFit.route_anchor_zone_code || null,
      target_zone_code: routeFit.target_zone_code || chosen.zone_code || null,
      route_context: routeFit.route_context || null,
    });
  }

  const loadsObject = Object.fromEntries(Array.from(loadByEmployee.entries()).map(([key, value]) => [key, Number(Number(value || 0).toFixed(2))]));
  const initialLoadsObject = Object.fromEntries(Array.from(initialLoads.entries()).map(([key, value]) => [key, Number(Number(value || 0).toFixed(2))]));

  if (!moves.length) {
    return {
      applied: false,
      reason: loadSpread(initialLoads) <= 1 ? "already_balanced" : "no_safe_restroom_moves",
      moved_count: 0,
      target_load: Number(targetLoad.toFixed(2)),
      initial_loads: initialLoadsObject,
      loads: loadsObject,
      moves: [],
    };
  }

  return {
    applied: true,
    reason: "restrooms_rebalanced",
    moved_count: moves.length,
    target_load: Number(targetLoad.toFixed(2)),
    initial_loads: initialLoadsObject,
    loads: loadsObject,
    moves,
  };
}

function getScheduleGeminiApiKey() {
  return getGeminiApiKey(["SCHEDULE_GEMINI_API_KEY"]);
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
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract the first JSON object from a string that may contain multiple
    const matches = raw.match(/\{[\s\S]*?\}/g);
    if (!matches) return null;
    for (const candidate of matches) {
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    return null;
  }
}

export function createScheduleRouter({
  runReadOnlySql,
  runRpc,
  runCommand,
  buildHealthPayload,
  requireAdminApiAuth,
  requireOpsManagerAuth,
  requireDeviceAccess,
  publicTrafficRateLimit,
  appVersion,
  releaseId,
  contractVersion,
}) {
  const router = express.Router();
  const requireSchedulePin = requireAdminApiAuth;
  const requireManagerRead = requireOpsManagerAuth || requireAdminApiAuth || ((_req, _res, next) => next());
  const requireEmployeeDevice = typeof requireDeviceAccess === "function" ? requireDeviceAccess : ((_req, _res, next) => next());
  const limitPublicCoverAll = typeof publicTrafficRateLimit === "function"
    ? publicTrafficRateLimit("coverall_assignment")
    : ((_req, _res, next) => next());

  function requestHasDeviceIdentity(req) {
    return Boolean(String(req.query?.device_id || req.query?.device || req.header?.("x-device-id") || "").trim());
  }

  function requirePersonalScheduleAccess(req, res, next) {
    if (requestHasDeviceIdentity(req)) {
      requireEmployeeDevice(req, res, next);
      return;
    }
    requireManagerRead(req, res, next);
  }

  const AUTO_GENERATE_WINDOW_DAYS = 7;
  const AUTO_GENERATE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  const restroomRebalanceScheduler = resolveRestroomRebalanceScheduler(process.env);
  const RESTROOM_REBALANCE_SWEEP_MS = restroomRebalanceScheduler.sweep_ms;

  async function assertScheduleReadyForRead(serviceDate) {
    const requested = String(serviceDate || "").trim();
    if (!requested) throw new Error("service_date is required.");
    const readinessRows = await runReadOnlySql(`
      select
        public.sch_service_date(now())::text as current_service_date,
        (select count(*)::int from public.daily_work_roster r where r.service_date = '${esc(requested)}'::date and r.active = true) as roster_count,
        (select count(*)::int from public.daily_schedule_assignments dsa where dsa.service_date = '${esc(requested)}'::date) as assignment_count
    `);
    const readiness = Array.isArray(readinessRows) && readinessRows.length ? readinessRows[0] : {};
    const hasRosterCount = Object.prototype.hasOwnProperty.call(readiness, "roster_count");
    const hasAssignmentCount = Object.prototype.hasOwnProperty.call(readiness, "assignment_count");
    if (!hasRosterCount || !hasAssignmentCount) {
      return { ready: true, compatibility_read: true };
    }
    const currentServiceDate = String(readiness.current_service_date || requested);
    const rosterCount = Number(readiness.roster_count || 0);
    const assignmentCount = Number(readiness.assignment_count || 0);
    if (rosterCount > 0 && assignmentCount > 0) {
      return { ready: true, roster_count: rosterCount, assignment_count: assignmentCount };
    }
    const error = new Error(
      requested < currentServiceDate
        ? `No published schedule exists for historical date ${requested}.`
        : `Schedule for ${requested} is not ready. Use the explicit schedule generation control before opening employee schedules.`
    );
    error.status = requested < currentServiceDate ? 404 : 503;
    error.code = requested < currentServiceDate ? "schedule_not_found" : "schedule_not_ready";
    error.readiness = { service_date: requested, roster_count: rosterCount, assignment_count: assignmentCount };
    throw error;
  }
  async function loadStaticWeeklyEmployeeDay(serviceDate, employeeId, atSql) {
    let rows;
    try {
      rows = await runReadOnlySql(`
        select public.static_weekly_v5_read_employee_day(
          '${esc(serviceDate)}'::date,
          '${esc(employeeId)}'::uuid,
          ${atSql}
        ) as data
      `);
    } catch (error) {
      if (/function\s+public\.static_weekly_v5_read_employee_day[^\n]*does not exist/i.test(String(error?.message || ''))) return null;
      throw error;
    }
    const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
    if (data?.governed === false) return null;
    if (!data || typeof data !== 'object' || data.governed !== true) {
      const error = new Error('The weekly schedule authority returned an invalid employee schedule response.');
      error.status = 503;
      error.code = 'weekly_schedule_read_invalid';
      error.readiness = { service_date: serviceDate, source: data?.source || null };
      throw error;
    }
    if (data.projection_status !== 'current') {
      const error = new Error(data.projection_status === 'stale_staffing_change'
        ? 'The weekly schedule changed and must be rebuilt before employee phones can display it.'
        : 'The published weekly schedule must be generated before employee phones can display it.');
      error.status = 503;
      error.code = 'weekly_schedule_rebuild_required';
      error.readiness = {
        service_date: serviceDate,
        source: data.source,
        projection_status: data.projection_status,
        publication_id: data.publication_id || null,
        projection_id: data.projection_id || null,
      };
      throw error;
    }
    return combineFullDaySchedule(data, data.all_items);
  }
  async function loadFullDayScheduleItems(serviceDate, employeeId) {
    const rows = await runReadOnlySql(`
      select
        x.location_group_id,
        x.group_code,
        x.group_name,
        x.included_locations,
        x.segment_id,
        x.segment_number,
        x.owner_type,
        x.coverage_purpose,
        x.source_type,
        x.notes,
        x.status,
        x.load_points,
        case
          when x.coverage_start is null or btrim(x.coverage_start) = '' then null
          else to_char(x.coverage_start::time, 'HH12:MI AM')
        end as coverage_start,
        case
          when x.coverage_end is null or btrim(x.coverage_end) = '' then null
          when x.coverage_end::time = time '23:59:59' then 'Close'
          else to_char(x.coverage_end::time, 'HH12:MI AM')
        end as coverage_end,
        public.sch_is_public_restroom_group(x.location_group_id) as is_public_restroom,
        (coalesce(x.coverage_purpose, '') = 'reminder') as is_schedule_only_reminder
      from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date) x
      where x.assigned_employee_id = '${esc(employeeId)}'::uuid
        and x.status = 'ASSIGNED'
      order by x.coverage_start::time, x.coverage_end::time, x.segment_number, x.group_name
    `);
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      name: row.group_name || row.group_code || 'Assigned Area',
    }));
  }

  function scheduleItemKey(item = {}) {
    return [
      String(item.group_code || item.name || '').trim().toUpperCase(),
      String(item.coverage_purpose || '').trim().toLowerCase(),
      String(item.coverage_start || '').trim().toUpperCase(),
      String(item.coverage_end || '').trim().toUpperCase(),
    ].join('|');
  }

  function combineFullDaySchedule(pageData, fullDayItems) {
  const page = pageData && typeof pageData === 'object' ? pageData : {};
  const currentItems = Array.isArray(page.current_items)
    ? page.current_items
    : (Array.isArray(page.items) ? page.items : []);
  const currentKeys = new Set(currentItems.map(scheduleItemKey));
  const rawItems = (Array.isArray(fullDayItems) ? fullDayItems : []).map((item) => ({
    ...item,
    is_current: currentKeys.has(scheduleItemKey(item)),
  }));
  const consolidated = consolidateScheduleItems(rawItems);
  const items = consolidated.items;
  const shift = page?.shift && typeof page.shift === 'object' ? page.shift : {};
  const shiftStart = shift.start || shift.shift_start || null;
  const shiftEnd = shift.end || shift.shift_end || null;
  const scheduled = shift.active === false
    ? false
    : Boolean(shift.active === true || (shiftStart && shiftEnd));
  let scheduleStatus = 'scheduled';
  let notice = page.notice || null;
  if (!scheduled) {
    scheduleStatus = 'off';
    notice = 'Not scheduled to work today.';
  } else if (!items.length) {
    scheduleStatus = 'missing_assignments';
    notice = 'Your shift is active, but no assignments were published. Contact an Ops Manager.';
  } else if (page.phase === 'before_shift') {
    scheduleStatus = 'scheduled';
    notice = page.notice || 'Your full-day schedule is shown below.';
  } else if (page.phase === 'after_shift') {
    scheduleStatus = 'completed';
    notice = page.notice || 'Your shift is complete. Today\'s full schedule remains below.';
  } else if (!currentItems.length) {
    scheduleStatus = 'between_assignments';
    notice = 'No assignment is active at this moment. Your full-day schedule is shown below.';
  }
  return {
    ...page,
    employee_name: page?.employee?.display_name || page.employee_name || null,
    items,
    display_items: items,
    display_sections: consolidated.sections,
    raw_items: rawItems,
    current_items: currentItems,
    full_day: true,
    schedule_display_contract: 'schedule-display.v1',
    schedule_status: scheduleStatus,
    notice,
  };
}

  let autoGenerateState = { lastStartedAt: 0, running: false, lastCompletedAt: 0, lastWindowStart: null, lastResult: [] };
  let restroomRebalanceState = { lastStartedAt: 0, running: false, lastCompletedAt: 0, lastServiceDate: null, lastResult: null };

  function fail(res, error, fallback = "Schedule request failed", status = 400) {
    res.status(Number(error?.status) || status).json({
      ok: false,
      code: error?.code || "schedule_request_failed",
      error: error?.message || fallback,
      readiness: error?.readiness || undefined,
    });
  }

  function esc(value) {
    if (value == null) return "null";
    return String(value).replace(/'/g, "''");
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

  function requireUuid(value, fieldName = "id") {
    const raw = String(value || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
      throw new Error(`${fieldName} must be a valid UUID.`);
    }
    return raw;
  }

  function optionalBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (value === true || value === "true" || value === "1" || value === 1) return true;
    if (value === false || value === "false" || value === "0" || value === 0) return false;
    return Boolean(value);
  }


  function isSch2PublishPrivilegeError(error) {
    const message = String(error?.message || error || "");
    return /permission denied for function sch2_publish_solution/i.test(message)
      || /SCH2 publish confirm requires service_role backend execution/i.test(message);
  }

  async function runSch2PublishWithFallback(runId, confirm) {
    try {
      return await runRpc("sch2_publish_solution", { p_run_id: runId, p_confirm: confirm });
    } catch (error) {
      if (!isSch2PublishPrivilegeError(error)) throw error;
      if (!confirm) {
        const rows = await runReadOnlySql(`
          select
            r.id as run_id,
            r.service_date,
            r.audit_summary as audit,
            public.sch2_compare_current_vs_preview(r.id) as diff
          from public.schedule_generation_runs r
          where r.id = '${esc(runId)}'::uuid
          limit 1
        `);
        const row = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!row) throw error;
        return {
          ok: true,
          dry_run: true,
          fallback: "read_only_guarded_sql",
          publish_audit_id: null,
          run_id: runId,
          service_date: row.service_date,
          audit: row.audit,
          diff: row.diff,
        };
      }
      await runCommand("sch2_guarded_publish", { run_id: runId });
      const rows = await runReadOnlySql(`
        select
          r.id as run_id,
          r.service_date,
          r.status,
          r.published_at,
          r.published_by,
          spa.id as publish_audit_id,
          jsonb_array_length(coalesce(spa.published_rows, '[]'::jsonb)) as inserted_rows,
          r.audit_summary as audit,
          spa.diff_summary as diff
        from public.schedule_generation_runs r
        left join public.schedule_publish_audit spa
          on spa.run_id = r.id
         and spa.status = 'published'
        where r.id = '${esc(runId)}'::uuid
        order by spa.published_at desc nulls last
        limit 1
      `);
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!row || row.status !== "published" || !row.publish_audit_id) {
        throw new Error("SCH2 guarded publish fallback did not produce a verified published audit row.");
      }
      return {
        ok: true,
        dry_run: false,
        fallback: "bounded_command",
        publish_audit_id: row.publish_audit_id,
        run_id: row.run_id,
        service_date: row.service_date,
        inserted_rows: row.inserted_rows,
        audit: row.audit,
        diff: row.diff,
        published_at: row.published_at,
        published_by: row.published_by,
      };
    }
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
    const explicit = await filterAbsenceEligibleEmployeeIds(explicitIds);
    const ptoIds = await filterAbsenceEligibleEmployeeIds(await getPtoAbsentEmployeeIds(serviceDate));
    return {
      explicit,
      pto_ids: ptoIds,
      merged: Array.from(new Set([...explicit, ...ptoIds])),
    };
  }

  const COVERALL_SLOT_CODES = ["COVERALL_01", "COVERALL_02", "COVERALL_03", "COVERALL_04"];

  function coverAllEmployeeCodeSqlList() {
    return COVERALL_SLOT_CODES.map((slotCode) => `'${esc(slotCode)}'`).join(",");
  }

  async function filterAbsenceEligibleEmployeeIds(ids = []) {
    const normalized = normalizeUuidList(ids);
    if (!normalized.length) return [];
    const rows = await runReadOnlySql(`
      select id::text as employee_id
      from public.employees
      where active = true
        and id = any(${uuidArrayLiteral(normalized)})
        and coalesce(employee_code, '') not in (${coverAllEmployeeCodeSqlList()})
      order by display_name
    `);
    const eligible = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.employee_id || "").trim()).filter(Boolean));
    return normalized.filter((id) => eligible.has(id));
  }

  function normalizeCoverAllSlotCode(value) {
    const raw = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    const numberMatch = raw.match(/(?:COVERALL_?)?(\d{1,2})$/);
    if (numberMatch) {
      const slot = `COVERALL_${String(Number(numberMatch[1])).padStart(2, "0")}`;
      return COVERALL_SLOT_CODES.includes(slot) ? slot : "";
    }
    return COVERALL_SLOT_CODES.includes(raw) ? raw : "";
  }

  function coverAllPublicPath(serviceDate, slotCode, lang = "en", accessToken = "") {
    const token = String(accessToken || "").trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("A secure CoverAll access token is required.");
    return `/schedule-api/coverall/assignment?service_date=${encodeURIComponent(serviceDate)}&slot=${encodeURIComponent(slotCode)}&lang=${encodeURIComponent(lang)}&access_token=${encodeURIComponent(token)}`;
  }

  async function getCoverAllSlots() {
    const rows = await runReadOnlySql(`
      select id as employee_id, display_name, employee_code
      from public.employees
      where employee_code in (${COVERALL_SLOT_CODES.map((slotCode) => `'${esc(slotCode)}'`).join(",")})
      order by employee_code
    `);
    if (!Array.isArray(rows) || rows.length < COVERALL_SLOT_CODES.length) {
      throw Object.assign(new Error("CoverAll employee slots are not provisioned. Apply the source-controlled migration."), { status: 503 });
    }
    return rows;
  }

  async function getCoverAllEmployee() {
    const slots = await getCoverAllSlots();
    return slots[0];
  }

  async function getCoverAllSlotByCode(slotCode) {
    const normalized = normalizeCoverAllSlotCode(slotCode);
    if (!normalized) throw new Error("slot must be COVERALL_01, COVERALL_02, COVERALL_03, or COVERALL_04.");
    const slots = await getCoverAllSlots();
    const slot = slots.find((row) => String(row.employee_code || "").toUpperCase() === normalized);
    if (!slot) throw new Error(`CoverAll slot not found: ${normalized}`);
    return slot;
  }

  function normalizeCoverAllAccessToken(value) {
    const token = String(value || "").trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
      throw Object.assign(new Error("This CoverAll assignment link is invalid or expired."), { status: 403, code: "coverall_link_invalid" });
    }
    return token;
  }

  function coverAllAccessTokenHash(token) {
    return createHash("sha256").update(normalizeCoverAllAccessToken(token)).digest("hex");
  }

  function coverAllLinkTtlHours(value) {
    const parsed = Number.parseInt(String(value ?? "24"), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
      throw Object.assign(new Error("ttl_hours must be between 1 and 168."), { status: 422 });
    }
    return parsed;
  }

  function setCoverAllAssignmentSecurityHeaders(res) {
    res.setHeader("Cache-Control", "no-store, private, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src https://lasrevinu333-design.github.io data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
  }

  async function authorizeCoverAllAssignmentLink({ serviceDate, slotCode, accessToken }) {
    const tokenHash = coverAllAccessTokenHash(accessToken);
    const rows = await runReadOnlySql(`
      select id, service_date::text as service_date, slot_code, expires_at
      from public.coverall_assignment_links
      where token_hash = '${esc(tokenHash)}'
        and service_date = '${esc(serviceDate)}'::date
        and slot_code = '${esc(slotCode)}'
        and revoked_at is null
        and expires_at > now()
      limit 1
    `);
    if (!Array.isArray(rows) || !rows.length) {
      throw Object.assign(new Error("This CoverAll assignment link is invalid or expired."), { status: 403, code: "coverall_link_invalid" });
    }
    return rows[0];
  }

  async function issueCoverAllAssignmentLink({ serviceDate, slotCode, lang, ttlHours, actor }) {
    const slot = await getCoverAllSlotByCode(slotCode);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = coverAllAccessTokenHash(token);
    const linkId = randomUUID();
    const expiresAt = new Date(Date.now() + coverAllLinkTtlHours(ttlHours) * 60 * 60 * 1000).toISOString();
    const createdBy = String(actor || "authenticated_manager").trim().slice(0, 160) || "authenticated_manager";
    const result = await runCommand("coverall_assignment_link_issue", {
      id: linkId, token_hash: tokenHash, service_date: serviceDate, slot_code: slot.employee_code,
      created_by: createdBy, expires_at: expiresAt,
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row?.id) throw new Error("The secure CoverAll assignment link could not be created.");
    const publicOrigin = String(process.env.SCHEDULE_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://memphis-zoo-mcp.onrender.com").replace(/\/+$/, "");
    const normalizedLang = String(lang || "en").toLowerCase() === "es" ? "es" : "en";
    return {
      link_id: row.id,
      service_date: String(row.service_date || serviceDate).slice(0, 10),
      slot_code: row.slot_code || slot.employee_code,
      expires_at: row.expires_at || expiresAt,
      assignment_url: `${publicOrigin}${coverAllPublicPath(serviceDate, slot.employee_code, normalizedLang, token)}`,
    };
  }

  async function revokeCoverAllAssignmentLinks({ serviceDate, slotCode, actor }) {
    await getCoverAllSlotByCode(slotCode);
    const revokedBy = String(actor || "authenticated_manager").trim().slice(0, 160) || "authenticated_manager";
    const result = await runCommand("coverall_assignment_link_revoke", { service_date: serviceDate, slot_code: slotCode, revoked_by: revokedBy });
    return Array.isArray(result) ? result.length : 0;
  }

  async function listCoverAllSlotsForDate(serviceDate) {
    const slots = await getCoverAllSlots();
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
        secure_link_required: true,
      };
    });
  }

  async function publishCoverAllSlotsForDate(serviceDate, inputSlots = [], { regenerate = true, restoreStatic = true, rebalance = true } = {}) {
    if (!Array.isArray(inputSlots)) throw new Error("slots must be an array.");
    const slots = await getCoverAllSlots();
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

    await runCommand("coverall_slots_publish", {
      service_date: serviceDate,
      operations: operations.map((op) => ({
        employee_id: op.slot.employee_id, active: op.active, shift_start: op.shiftStart,
        shift_end: op.shiftEnd, notes: op.notes,
      })),
    });
    let generateResult = null;
    let staticRestoreResult = null;
    let balanceResult = null;
    let restroomBalanceResult = null;
    let lunchCoverageResult = null;
    let restroomBalanceCompletion = null;
    if (regenerate) {
      generateResult = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: true });
      if (restoreStatic) staticRestoreResult = await restoreStaticOwnersForDate(serviceDate);
    }
    if (rebalance) {
      balanceResult = await rebalanceCoverAllAssignments(serviceDate);
      restroomBalanceResult = await rebalanceRestroomAssignments(serviceDate);
      lunchCoverageResult = await applyLunchCoverageAfterRestroomRebalance(serviceDate);
      restroomBalanceCompletion = await markRestroomRebalanceCompletion(serviceDate, { reason: "coverall_slots_publish", balance: restroomBalanceResult, lunch_coverage: lunchCoverageResult }, "completed");
    }
    const currentSlots = await listCoverAllSlotsForDate(serviceDate);
    return { service_date: serviceDate, slots: currentSlots, generate_result: generateResult, static_restore_result: staticRestoreResult, balance_result: balanceResult, restroom_rebalance_result: restroomBalanceResult, lunch_coverage_result: lunchCoverageResult, restroom_rebalance_completion: restroomBalanceCompletion };
  }

  function buildCoverAllRebalancePlan(assignments = [], activeRoster = [], activeCoverAllIds = []) {
    const employeeMeta = new Map();
    const loadByEmployee = new Map();
    for (const row of Array.isArray(activeRoster) ? activeRoster : []) {
      const employeeId = String(row.employee_id || row.id || "").trim();
      if (!employeeId) continue;
      employeeMeta.set(employeeId, {
        employee_id: employeeId,
        employee_name: String(row.employee_name || row.display_name || "").trim(),
        employee_code: String(row.employee_code || "").trim(),
        shift_start: String(row.shift_start || "").trim(),
        shift_end: String(row.shift_end || "").trim(),
      });
      loadByEmployee.set(employeeId, 0);
    }

    const coverAllEmployeeIds = Array.from(new Set((Array.isArray(activeCoverAllIds) ? activeCoverAllIds : []).map((value) => String(value || "").trim()).filter(Boolean)));
    if (!coverAllEmployeeIds.length) {
      return { applied: false, reason: "no_active_coverall_slots", moved_count: 0, moves: [] };
    }
    if (!loadByEmployee.size) {
      return { applied: false, reason: "no_active_employees", moved_count: 0, moves: [] };
    }

    const activeEmployeeIds = new Set(loadByEmployee.keys());
    const regularEmployeeIds = Array.from(activeEmployeeIds).filter((id) => !coverAllEmployeeIds.includes(id));
    if (!regularEmployeeIds.length) {
      return { applied: false, reason: "no_regular_employees_to_balance_from", moved_count: 0, moves: [] };
    }

    const normalizedAssignments = (Array.isArray(assignments) ? assignments : [])
      .map((row) => ({
        assignment_id: String(row.assignment_id || row.id || "").trim(),
        assigned_employee_id: String(row.assigned_employee_id || "").trim(),
        assigned_employee_name: String(row.assigned_employee_name || row.employee_name || "").trim(),
        group_name: String(row.group_name || row.group_code || "Area").trim(),
        group_code: String(row.group_code || "").trim(),
        segment_number: Number(row.segment_number || 0),
        coverage_start: String(row.coverage_start || "").trim(),
        coverage_end: String(row.coverage_end || "").trim(),
        load_points: Math.max(1, Number(row.load_points || 1)),
        source_type: String(row.source_type || "").trim(),
      }))
      .filter((row) => row.assignment_id && activeEmployeeIds.has(row.assigned_employee_id));

    if (!normalizedAssignments.length) {
      return { applied: false, reason: "no_assignments_to_balance", moved_count: 0, moves: [] };
    }

    for (const assignment of normalizedAssignments) {
      loadByEmployee.set(assignment.assigned_employee_id, (loadByEmployee.get(assignment.assigned_employee_id) || 0) + assignment.load_points);
    }

    const initialLoads = new Map(loadByEmployee);
    const totalLoad = Array.from(loadByEmployee.values()).reduce((sum, value) => sum + Number(value || 0), 0);
    const targetLoad = totalLoad / Math.max(1, loadByEmployee.size);
    const movableAssignments = normalizedAssignments.filter((assignment) => !isProtectedRestroomSource(assignment.source_type));
    if (!movableAssignments.length) {
      return {
        applied: false,
        reason: loadSpread(initialLoads) <= 1 ? "already_balanced" : "no_safe_coverall_moves",
        moved_count: 0,
        target_load: Number(targetLoad.toFixed(2)),
        initial_loads: Object.fromEntries(Array.from(initialLoads.entries()).map(([key, value]) => [key, Number(Number(value || 0).toFixed(2))])),
        loads: Object.fromEntries(Array.from(loadByEmployee.entries()).map(([key, value]) => [key, Number(Number(value || 0).toFixed(2))])),
        moves: [],
      };
    }

    const movedAssignmentIds = new Set();
    const moves = [];
    const maxMoves = movableAssignments.length;

    function employeeExcess(employeeId) {
      return (loadByEmployee.get(employeeId) || 0) - targetLoad;
    }

    for (let guard = 0; guard < maxMoves; guard += 1) {
      const beforeSpread = loadSpread(loadByEmployee);
      if (beforeSpread <= 1) break;

      const donorIds = Array.from(activeEmployeeIds)
        .slice()
        .sort((a, b) => employeeExcess(b) - employeeExcess(a) || String(a).localeCompare(String(b)));
      const receiverIds = coverAllEmployeeIds
        .slice()
        .sort((a, b) => employeeExcess(a) - employeeExcess(b) || String(a).localeCompare(String(b)));

      let bestCandidate = null;

      for (const donorId of donorIds) {
        if (employeeExcess(donorId) <= 0.25) continue;
        const donorAssignments = movableAssignments
          .filter((assignment) => assignment.assigned_employee_id === donorId && !movedAssignmentIds.has(assignment.assignment_id))
          .sort((a, b) => a.load_points - b.load_points || String(a.group_name).localeCompare(String(b.group_name)));
        if (!donorAssignments.length) continue;

        for (const receiverId of receiverIds) {
          if (receiverId === donorId) continue;
          if (employeeExcess(receiverId) >= -0.25) continue;
          const receiverMeta = employeeMeta.get(receiverId) || {};

          for (const assignment of donorAssignments) {
            if (!canRosterEmployeeCoverAssignment(receiverMeta, assignment)) continue;
            const donorLoad = loadByEmployee.get(donorId) || 0;
            const receiverLoad = loadByEmployee.get(receiverId) || 0;
            const after = new Map(loadByEmployee);
            after.set(donorId, donorLoad - assignment.load_points);
            after.set(receiverId, receiverLoad + assignment.load_points);
            const afterSpread = loadSpread(after);
            if (afterSpread >= beforeSpread) continue;

            const beforeDistance = Math.abs(donorLoad - targetLoad) + Math.abs(receiverLoad - targetLoad);
            const afterDistance = Math.abs((donorLoad - assignment.load_points) - targetLoad) + Math.abs((receiverLoad + assignment.load_points) - targetLoad);
            const candidate = {
              donorId,
              receiverId,
              assignment,
              afterSpread,
              distanceImprovement: beforeDistance - afterDistance,
            };

            if (!bestCandidate
              || candidate.afterSpread < bestCandidate.afterSpread
              || (candidate.afterSpread === bestCandidate.afterSpread && candidate.distanceImprovement > bestCandidate.distanceImprovement)
              || (candidate.afterSpread === bestCandidate.afterSpread && candidate.distanceImprovement === bestCandidate.distanceImprovement && assignment.load_points < bestCandidate.assignment.load_points)
              || (candidate.afterSpread === bestCandidate.afterSpread
                && candidate.distanceImprovement === bestCandidate.distanceImprovement
                && assignment.load_points === bestCandidate.assignment.load_points
                && String(assignment.group_name).localeCompare(String(bestCandidate.assignment.group_name)) < 0)) {
              bestCandidate = candidate;
            }
          }
        }
      }

      if (!bestCandidate) break;

      const { donorId, receiverId, assignment: chosen } = bestCandidate;
      const donorLoad = loadByEmployee.get(donorId) || 0;
      const receiverLoad = loadByEmployee.get(receiverId) || 0;
      movedAssignmentIds.add(chosen.assignment_id);
      loadByEmployee.set(donorId, donorLoad - chosen.load_points);
      loadByEmployee.set(receiverId, receiverLoad + chosen.load_points);

      const donorMeta = employeeMeta.get(donorId) || {};
      const receiverMeta = employeeMeta.get(receiverId) || {};
      moves.push({
        assignment_id: chosen.assignment_id,
        from_employee_id: donorId,
        from_employee_name: donorMeta.employee_name || chosen.assigned_employee_name,
        to_employee_id: receiverId,
        to_employee_name: receiverMeta.employee_name || "CoverAll",
        group_name: chosen.group_name,
        group_code: chosen.group_code,
        segment_number: chosen.segment_number,
        coverage_start: chosen.coverage_start,
        coverage_end: chosen.coverage_end,
        load_points: chosen.load_points,
      });
    }

    const loadsObject = Object.fromEntries(Array.from(loadByEmployee.entries()).map(([key, value]) => [key, Number(Number(value || 0).toFixed(2))]));
    const initialLoadsObject = Object.fromEntries(Array.from(initialLoads.entries()).map(([key, value]) => [key, Number(Number(value || 0).toFixed(2))]));

    if (!moves.length) {
      return {
        applied: false,
        reason: loadSpread(initialLoads) <= 1 ? "already_balanced" : "no_safe_coverall_moves",
        moved_count: 0,
        target_load: Number(targetLoad.toFixed(2)),
        initial_loads: initialLoadsObject,
        loads: loadsObject,
        moves: [],
      };
    }

    return {
      applied: true,
      reason: "coverall_rebalanced",
      moved_count: moves.length,
      target_load: Number(targetLoad.toFixed(2)),
      initial_loads: initialLoadsObject,
      loads: loadsObject,
      moves,
    };
  }

  async function rebalanceCoverAllAssignments(serviceDate) {
    const slots = await listCoverAllSlotsForDate(serviceDate);
    const activeCoverAllSlots = slots.filter((slot) => slot.active_today);
    if (!activeCoverAllSlots.length) {
      return { applied: false, reason: "no_active_coverall_slots", moved_count: 0, moves: [] };
    }

    const activeRosterRows = await runReadOnlySql(`
      select r.employee_id, e.display_name as employee_name, e.employee_code,
             to_char(r.shift_start, 'HH24:MI:SS') as shift_start,
             to_char(r.shift_end, 'HH24:MI:SS') as shift_end
      from public.daily_work_roster r
      join public.employees e on e.id = r.employee_id
      where r.service_date = '${esc(serviceDate)}'::date
        and r.active = true
      order by e.display_name
    `);
    const activeRoster = Array.isArray(activeRosterRows) ? activeRosterRows : [];
    const activeCoverAllIds = activeCoverAllSlots.map((slot) => String(slot.employee_id || "")).filter(Boolean);

    const assignmentRows = await runReadOnlySql(`
      select dsa.id as assignment_id, dsa.assigned_employee_id, e.display_name as assigned_employee_name, e.employee_code,
             dsa.location_group_id, lg.group_name, lg.group_code, dsa.segment_number, dsa.source_type,
             to_char(dsa.coverage_start, 'HH24:MI:SS') as coverage_start,
             to_char(dsa.coverage_end, 'HH24:MI:SS') as coverage_end,
             greatest(coalesce(dsa.load_points, 1), 1)::numeric as load_points
      from public.daily_schedule_assignments dsa
      join public.location_groups lg on lg.id = dsa.location_group_id
      join public.employees e on e.id = dsa.assigned_employee_id
      where dsa.service_date = '${esc(serviceDate)}'::date
        and dsa.status = 'ASSIGNED'
        and dsa.assigned_employee_id is not null
        and coalesce(dsa.coverage_purpose, '') <> 'lunch_coverage'
        and (dsa.service_date <> public.sch_service_date(now())::date or dsa.coverage_end > now()::time)
      order by dsa.coverage_start, lg.group_name, dsa.segment_number
    `);
    const assignments = Array.isArray(assignmentRows) ? assignmentRows : [];
    const plan = buildCoverAllRebalancePlan(assignments, activeRoster, activeCoverAllIds);

    if (!plan.applied || !plan.moves?.length) {
      return { service_date: serviceDate, ...plan };
    }

    await runCommand("coverall_load_balance", { service_date: serviceDate, moves: plan.moves });

    return { service_date: serviceDate, ...plan };
  }

  async function listActiveRosterForRestroomRebalance(serviceDate) {
    const rows = await runReadOnlySql(`
      select r.employee_id, e.display_name as employee_name, e.employee_code,
             to_char(r.shift_start, 'HH24:MI:SS') as shift_start,
             to_char(r.shift_end, 'HH24:MI:SS') as shift_end,
             coalesce(route.zone_codes, '[]'::jsonb) as zone_codes,
             route.route_anchor_zone_code,
             coalesce(route.current_group_count, 0)::int as current_group_count
      from public.daily_work_roster r
      join public.employees e on e.id = r.employee_id
      left join lateral (
        with current_groups as (
          select dsa.location_group_id
          from public.daily_schedule_assignments dsa
          where dsa.service_date = r.service_date
            and dsa.assigned_employee_id = r.employee_id
            and dsa.status = 'ASSIGNED'
            and coalesce(dsa.coverage_purpose, '') not in ('lunch_coverage', 'reminder')
            and dsa.coverage_end > '${esc(RESTROOM_REBALANCE_TIME)}'::time
        ), current_zones as (
          select z.zone_code
          from current_groups cg
          join public.v_schedule_location_group_zones z on z.location_group_id = cg.location_group_id
          where z.zone_assignment_active is distinct from false
            and z.zone_code is not null
        )
        select
          (select count(*) from current_groups) as current_group_count,
          (select coalesce(jsonb_agg(distinct zone_code), '[]'::jsonb) from current_zones) as zone_codes,
          (select zone_code from current_zones group by zone_code order by count(*) desc, zone_code asc limit 1) as route_anchor_zone_code
      ) route on true
      where r.service_date = '${esc(serviceDate)}'::date
        and r.active = true
        and r.shift_start <= '${esc(RESTROOM_REBALANCE_TIME)}'::time
        and r.shift_end > '${esc(RESTROOM_REBALANCE_TIME)}'::time
      order by e.display_name
    `);
    return Array.isArray(rows) ? rows.filter(isRestroomRebalanceRosterEligible) : [];
  }

  async function listRestroomAssignmentsForRebalance(serviceDate) {
    const rows = await runReadOnlySql(`
      select dsa.id as assignment_id, dsa.assigned_employee_id, e.display_name as assigned_employee_name, e.employee_code,
             dsa.location_group_id, lg.group_name, lg.group_code, z.zone_code, z.zone_name, dsa.segment_number, dsa.source_type,
             to_char(dsa.coverage_start, 'HH24:MI:SS') as coverage_start,
             to_char(dsa.coverage_end, 'HH24:MI:SS') as coverage_end,
             greatest(coalesce(dsa.load_points, 1), 1)::numeric as load_points,
             coalesce(restricted.restricted_employee_ids, '[]'::jsonb) as restricted_employee_ids
      from public.daily_schedule_assignments dsa
      join public.location_groups lg on lg.id = dsa.location_group_id
      left join lateral (
        select zone_code, zone_name
        from public.v_schedule_location_group_zones
        where location_group_id = dsa.location_group_id
          and zone_assignment_active is distinct from false
        order by zone_code
        limit 1
      ) z on true
      join public.employees e on e.id = dsa.assigned_employee_id
      left join lateral (
        select jsonb_agg(r.employee_id::text order by r.employee_id::text) as restricted_employee_ids
        from public.daily_work_roster r
        join public.employees re on re.id = r.employee_id
        where r.service_date = dsa.service_date
          and r.active = true
          and r.shift_start <= '${esc(RESTROOM_REBALANCE_TIME)}'::time
          and r.shift_end > '${esc(RESTROOM_REBALANCE_TIME)}'::time
          and coalesce(re.employee_code, '') not in ('${RESTROOM_REBALANCE_EXCLUDED_EMPLOYEES.join("','")}')
          and public.sch_is_employee_location_group_restricted(
            r.employee_id,
            dsa.location_group_id,
            extract(dow from dsa.service_date)::integer
          )
      ) restricted on true
      where dsa.service_date = '${esc(serviceDate)}'::date
        and dsa.status = 'ASSIGNED'
        and dsa.assigned_employee_id is not null
        and coalesce(dsa.coverage_purpose, '') <> 'lunch_coverage'
        and dsa.coverage_end > '${esc(RESTROOM_REBALANCE_TIME)}'::time
        and (
          lower(coalesce(lg.group_name, '')) like '%restroom%'
          or lower(coalesce(lg.group_code, '')) like '%restroom%'
          or lower(coalesce(lg.group_name, '')) like '%bathroom%'
          or lower(coalesce(lg.group_code, '')) like '%bathroom%'
          or exists (
            select 1
            from public.location_group_memberships m
            join public.locations l on l.id = m.location_id and l.active = true
            where m.location_group_id = dsa.location_group_id
              and m.active = true
              and (
                lower(coalesce(l.location_type, '')) like '%restroom%'
                or lower(coalesce(l.form_type, '')) like '%restroom%'
                or lower(coalesce(l.location_name, '')) like '%restroom%'
                or lower(coalesce(l.location_name, '')) like '%bathroom%'
              )
          )
        )
      order by dsa.coverage_start, lg.group_name, dsa.segment_number
    `);
    return Array.isArray(rows) ? rows : [];
  }

  async function listRestroomRouteFitRows(serviceDate, assignments = []) {
    const targetGroupIds = Array.from(new Set((Array.isArray(assignments) ? assignments : [])
      .map((row) => String(row.location_group_id || "").trim())
      .filter(Boolean)));
    if (!targetGroupIds.length) return [];
    const valuesSql = targetGroupIds.map((id) => `('${esc(requireUuid(id, "location_group_id"))}'::uuid)`).join(",\n");
    const rows = await runReadOnlySql(`
      with target(location_group_id) as (
        values ${valuesSql}
      ), roster as (
        select r.employee_id
        from public.daily_work_roster r
        where r.service_date = '${esc(serviceDate)}'::date
          and r.active = true
          and r.shift_start <= '${esc(RESTROOM_REBALANCE_TIME)}'::time
          and r.shift_end > '${esc(RESTROOM_REBALANCE_TIME)}'::time
      ), current_groups as (
        select r.employee_id, dsa.location_group_id
        from roster r
        join public.daily_schedule_assignments dsa
          on dsa.service_date = '${esc(serviceDate)}'::date
         and dsa.assigned_employee_id = r.employee_id
         and dsa.status = 'ASSIGNED'
         and coalesce(dsa.coverage_purpose, '') not in ('lunch_coverage', 'reminder')
         and dsa.coverage_end > '${esc(RESTROOM_REBALANCE_TIME)}'::time
      ), target_zones as (
        select t.location_group_id, z.zone_code
        from target t
        left join public.v_schedule_location_group_zones z
          on z.location_group_id = t.location_group_id
         and z.zone_assignment_active is distinct from false
      ), current_zones as (
        select cg.employee_id, cg.location_group_id, z.zone_code
        from current_groups cg
        left join public.v_schedule_location_group_zones z
          on z.location_group_id = cg.location_group_id
         and z.zone_assignment_active is distinct from false
      ), anchors as (
        select employee_id, zone_code as route_anchor_zone_code
        from (
          select employee_id, zone_code, count(*) as zone_count,
                 row_number() over (partition by employee_id order by count(*) desc, zone_code asc) as rn
          from current_zones
          where zone_code is not null
          group by employee_id, zone_code
        ) ranked
        where rn = 1
      ), fit as (
        select
          r.employee_id,
          t.location_group_id,
          count(distinct cg.location_group_id)::int as current_group_count,
          coalesce(bool_or(cg.location_group_id = t.location_group_id), false) as same_group,
          coalesce(bool_or(cz.zone_code is not null and tz.zone_code is not null and cz.zone_code = tz.zone_code), false) as same_zone,
          min(
            case
              when cg.location_group_id = t.location_group_id then 0
              when adj.walking_minutes is not null then adj.walking_minutes
              when cz.zone_code is not null and tz.zone_code is not null and cz.zone_code = tz.zone_code then 4
              else null
            end
          ) as direct_walk_minutes,
          max(a.route_anchor_zone_code) as route_anchor_zone_code,
          max(tz.zone_code) as target_zone_code
        from roster r
        cross join target t
        left join current_groups cg on cg.employee_id = r.employee_id
        left join current_zones cz on cz.employee_id = r.employee_id and cz.location_group_id = cg.location_group_id
        left join target_zones tz on tz.location_group_id = t.location_group_id
        left join public.location_group_adjacency adj
          on adj.active = true
         and (
           (adj.from_location_group_id = cg.location_group_id and adj.to_location_group_id = t.location_group_id)
           or (adj.to_location_group_id = cg.location_group_id and adj.from_location_group_id = t.location_group_id)
         )
        left join anchors a on a.employee_id = r.employee_id
        group by r.employee_id, t.location_group_id
      )
      select
        employee_id,
        location_group_id,
        current_group_count,
        same_group,
        same_zone,
        case
          when current_group_count = 0 then ${RESTROOM_REBALANCE_FLEX_HELPER_WALK_MINUTES}
          when direct_walk_minutes is not null then direct_walk_minutes
          else 999
        end as walking_minutes,
        route_anchor_zone_code,
        target_zone_code,
        case
          when current_group_count = 0 then 'flex_helper_no_current_route'
          when same_group then 'same_group'
          when same_zone then 'same_zone'
          when direct_walk_minutes is not null then 'adjacent_group'
          else 'far_or_unknown'
        end as route_context
      from fit
      order by employee_id, location_group_id
    `);
    return Array.isArray(rows) ? rows : [];
  }

  async function rebalanceRestroomAssignments(serviceDate) {
    if (typeof runCommand !== "function") return { applied: false, reason: "write_path_unavailable", moved_count: 0, moves: [] };

    const activeRoster = await listActiveRosterForRestroomRebalance(serviceDate);
    const assignments = await listRestroomAssignmentsForRebalance(serviceDate);
    const routeFitRows = await listRestroomRouteFitRows(serviceDate, assignments);
    const plan = buildRestroomRebalancePlan(assignments, activeRoster, routeFitRows);

    if (!plan.applied || !plan.moves?.length) {
      return {
        service_date: serviceDate,
        scheduled_time: RESTROOM_REBALANCE_TIME,
        implementation_mode: RESTROOM_REBALANCE_IMPLEMENTATION_MODE,
        ...plan,
      };
    }

    const writeResult = await runCommand("restroom_rebalance_0945", {
      service_date: serviceDate, source: RESTROOM_REBALANCE_SOURCE, note: RESTROOM_REBALANCE_NOTE,
      moves: plan.moves,
    });

    const postRows = Array.isArray(writeResult) ? writeResult : [];
    const postById = new Map((Array.isArray(postRows) ? postRows : []).map((row) => [String(row.assignment_id || ""), row]));
    const appliedMoves = [];
    const skippedMoves = [];
    for (const move of plan.moves) {
      const persisted = postById.get(String(move.assignment_id || ""));
      const applied = persisted
        && String(persisted.assigned_employee_id || "") === String(move.to_employee_id || "")
        && String(persisted.status || "") === "ASSIGNED"
        && String(persisted.owner_type || "") === "EMPLOYEE";
      if (applied) appliedMoves.push(move);
      else skippedMoves.push({ ...move, persisted_row: persisted || null });
    }

    return {
      service_date: serviceDate,
      scheduled_time: RESTROOM_REBALANCE_TIME,
      implementation_mode: RESTROOM_REBALANCE_IMPLEMENTATION_MODE,
      ...plan,
      planned_moved_count: plan.moves.length,
      moved_count: appliedMoves.length,
      moves: appliedMoves,
      skipped_moves: skippedMoves,
      skipped_restricted_moves: skippedMoves.length,
      partial: skippedMoves.length > 0,
      reason: skippedMoves.length
        ? (appliedMoves.length ? "restrooms_rebalanced_partial" : "no_safe_restroom_moves_db_guard")
        : plan.reason,
    };
  }

  async function applyLunchCoverageAfterRestroomRebalance(serviceDate) {
    try {
      return await runRpc("sch_apply_lunch_coverage", { p_service_date: serviceDate });
    } catch (error) {
      return { ok: false, error: error?.message || String(error || "lunch coverage failed") };
    }
  }

  async function ensureScheduleReadyForRestroomRebalance(serviceDate) {
    const state = await getDailyGenerationState(serviceDate);
    if (state.assignment_count > 0 && state.roster_count > 0) return { generated: false, state };
    const generate_result = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: false });
    const static_restore_result = await restoreStaticOwnersForDate(serviceDate);
    const after = await getDailyGenerationState(serviceDate);
    return { generated: true, state: after, generate_result, static_restore_result };
  }

  async function getRestroomRebalanceCompletion(serviceDate) {
    try {
      const rows = await runReadOnlySql(buildRestroomRebalanceCompletionSelectSql(serviceDate));
      return normalizeRestroomRebalanceCompletionRow(Array.isArray(rows) && rows.length ? rows[0] : null);
    } catch (error) {
      if (/schedule_automation_runs|does not exist|relation .* does not exist/i.test(String(error?.message || error || ""))) return null;
      throw error;
    }
  }

  async function markRestroomRebalanceCompletion(serviceDate, result, status = "completed") {
    if (typeof runCommand !== "function") return null;
    await runCommand("restroom_rebalance_completion", { service_date: serviceDate, result, status, automation_key: RESTROOM_REBALANCE_SOURCE });
    return { automation_key: RESTROOM_REBALANCE_SOURCE, service_date: serviceDate, status, completed: status === "completed", result };
  }

  async function maybeAutoRestroomRebalance({ force = false, reason = "scheduled_interval" } = {}) {
    if (restroomRebalanceState.running) return { ...restroomRebalanceState, skipped: true, reason: "already_running" };
    if (!force && !isRestroomRebalanceDue()) return { ...restroomRebalanceState, skipped: true, reason: "before_0945_memphis_time" };

    const serviceDate = requireDate(await getServiceDate());
    if (!force && restroomRebalanceState.lastServiceDate === serviceDate) {
      return { ...restroomRebalanceState, skipped: true, reason: "already_checked_today" };
    }

    if (!force) {
      const persistentCompletion = await getRestroomRebalanceCompletion(serviceDate);
      if (persistentCompletion?.completed) {
        const result = { service_date: serviceDate, reason: "already_completed_persistently", persistent_completion: persistentCompletion };
        restroomRebalanceState = {
          ...restroomRebalanceState,
          running: false,
          lastServiceDate: serviceDate,
          lastCompletedAt: restroomRebalanceState.lastCompletedAt || Date.now(),
          lastResult: result,
        };
        return { ...restroomRebalanceState, skipped: true, reason: "already_completed_persistently" };
      }
    }

    restroomRebalanceState = { ...restroomRebalanceState, running: true, lastStartedAt: Date.now() };
    try {
      const readiness = await ensureScheduleReadyForRestroomRebalance(serviceDate);
      const balance = await rebalanceRestroomAssignments(serviceDate);
      const lunch_coverage = await applyLunchCoverageAfterRestroomRebalance(serviceDate);
      const result = { service_date: serviceDate, reason, readiness, balance, lunch_coverage };
      const persistent_completion = await markRestroomRebalanceCompletion(serviceDate, result, "completed");
      restroomRebalanceState = {
        running: false,
        lastStartedAt: restroomRebalanceState.lastStartedAt,
        lastCompletedAt: Date.now(),
        lastServiceDate: serviceDate,
        lastResult: { ...result, persistent_completion },
      };
      return restroomRebalanceState.lastResult;
    } catch (error) {
      const failure = { ok: false, service_date: serviceDate, reason, error: error?.message || String(error || "restroom rebalance failed") };
      try { await markRestroomRebalanceCompletion(serviceDate, failure, "failed"); } catch {}
      restroomRebalanceState = { ...restroomRebalanceState, running: false, lastResult: failure };
      throw error;
    }
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
    const explicit = await filterAbsenceEligibleEmployeeIds(explicitIds);
    const activeRows = await listPtoRows({ startDate: serviceDate, endDate: serviceDate });
    const nonManualActiveIds = [];
    for (const row of activeRows) {
      const id = String(row.employee_id || "").trim();
      const type = String(row.pto_type || "").toLowerCase();
      if (!id || type === "manual_override") continue;
      nonManualActiveIds.push(id);
    }
    const eligibleNonManualActiveIds = await filterAbsenceEligibleEmployeeIds(nonManualActiveIds);
    const orderedAbsentIds = Array.from(new Set([...eligibleNonManualActiveIds, ...explicit]));
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
    if (typeof runCommand !== "function") throw new Error("CoverAll write path is not configured.");
    const coverAll = await getCoverAllEmployee();
    await runCommand("coverall_assignment_apply", {
      service_date: serviceDate, employee_id: coverAll.employee_id, assignments: plan.assignments,
    });

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

  async function importPtoRows(inputRows = []) {
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

    await runCommand("pto_import", { rows: normalized });

    return normalized;
  }

  function parsePtoReportText(reportText = "") {
    const text = String(reportText || "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("report_text is required.");
    const rowPattern = /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(\d{4})\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+([^,]+,\s*[^\d]+?(?:\s+[A-Z])?)\s+(Approved|Submitted|Cancelled|Refused)\b/g;
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
    const response = await fetchWithTimeout(`${PTO_GEMINI_BASE_URL}/${encodeURIComponent(PTO_GEMINI_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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
    let local;
    let localError = null;
    try {
      local = parsePtoReportText(reportText);
    } catch (error) {
      if (!String(reportText || "").trim()) throw error;
      localError = error;
      local = {
        detected_rows: [],
        kept_rows: [],
        import_rows: [],
        provider: "local-parser",
        providers_used: ["local-parser"],
        fallback_count: 0,
      };
    }
    if (!shouldUseGeminiForPto(local)) return local;
    try {
      const geminiResult = await tryGeminiParsePtoReportText(reportText, local);
      if (!geminiResult?.ok || !Array.isArray(geminiResult.rows)) {
        if (localError) throw localError;
        return local;
      }
      return chooseBestPtoParse(local, geminiResult.rows);
    } catch (error) {
      if (localError) throw localError;
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
    // PostgreSQL DATE values can arrive as JavaScript Date objects depending on
    // the driver's type parser.  The schedule contract requires an ISO service
    // date, so make that wire representation explicit at the database boundary.
    const rows = await runReadOnlySql("select public.sch_service_date(now())::text as service_date");
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

  async function restoreStaticOwnersForDate(serviceDate) {
    if (typeof runCommand !== "function") return { applied: false, reason: "write_path_unavailable" };
    await runCommand("restore_static_schedule_owners", { service_date: serviceDate });
    return { applied: true };
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
      let operational_balance = null;
      if (shouldGenerate) {
        const generate_result = await runRpc("sch_generate_daily_schedule", { p_service_date: row.service_date, p_force: force });
        const static_restore_result = await restoreStaticOwnersForDate(row.service_date);
        const coverall_balance_result = await rebalanceCoverAllAssignments(row.service_date);
        const restroom_rebalance_result = await rebalanceRestroomAssignments(row.service_date);
        const lunch_coverage_result = await applyLunchCoverageAfterRestroomRebalance(row.service_date);
        const restroom_rebalance_completion = await markRestroomRebalanceCompletion(row.service_date, { reason: "generate_range", balance: restroom_rebalance_result, lunch_coverage: lunch_coverage_result }, "completed");
        operational_balance = { generate_result, static_restore_result, coverall_balance_result, restroom_rebalance_result, lunch_coverage_result, restroom_rebalance_completion };
      }
      const after = await getDailyGenerationState(row.service_date);
      generated.push({
        service_date: row.service_date,
        generated: shouldGenerate,
        roster_count: after.roster_count,
        assignment_count: after.assignment_count,
        ready: after.roster_count > 0 && after.assignment_count > 0,
        operational_balance,
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
    const response = await fetchWithTimeout(`${PTO_GEMINI_BASE_URL}/${encodeURIComponent(PTO_GEMINI_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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


  function minutesFromTime(value = "") {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return (hours * 60) + minutes;
  }

  function isRealWorkAssignment(row = {}) {
    const purpose = String(row.coverage_purpose || "").toLowerCase();
    const sourceType = String(row.source_type || "").toLowerCase();
    const status = String(row.status || "").toUpperCase();
    if (status !== "ASSIGNED") return false;
    if (!row.assigned_employee_id) return false;
    if (["lunch_coverage", "reminder"].includes(purpose)) return false;
    if (sourceType.includes("gift_shop") || sourceType.includes("reminder_only")) return false;
    return true;
  }

  function summarizeScheduleAuditIssues(issues = []) {
    const counts = { critical: 0, error: 0, warning: 0, info: 0 };
    for (const issue of issues || []) {
      const severity = String(issue?.severity || "warning").toLowerCase();
      counts[severity] = (counts[severity] || 0) + 1;
    }
    if (counts.critical || counts.error) return `Schedule audit found ${counts.critical} critical and ${counts.error} error issue(s).`;
    if (counts.warning) return `Schedule audit passed hard rules but found ${counts.warning} warning(s) to review.`;
    return "Schedule audit passed: no open coverage, hard-rule, shift-window, or balance warnings detected.";
  }

  function buildScheduleAuditPrompt({ serviceDate, audit = {}, assignments = [], roster = [], userPrompt = "" }) {
    const compactAssignments = (assignments || []).slice(0, 160).map((row) => ({
      group_name: row.group_name,
      group_code: row.group_code,
      employee_name: row.assigned_employee_name,
      coverage_start: row.coverage_start,
      coverage_end: row.coverage_end,
      purpose: row.coverage_purpose,
      source_type: row.source_type,
      load_points: Number(row.load_points || 0),
      is_restroom: Boolean(row.is_restroom),
      status: row.status,
    }));
    const compactRoster = (roster || []).map((row) => ({
      employee_name: row.employee_name,
      shift_start: row.shift_start,
      shift_end: row.shift_end,
      source_type: row.source_type,
    }));
    return [
      "You are the final Memphis Zoo custodial schedule reviewer.",
      "Return JSON only. No markdown. No explanation.",
      "Output shape: {\"summary\": string, \"logic_status\": \"pass\"|\"review\"|\"fail\", \"additional_watchouts\": [string], \"recommended_next_action\": string}",
      "Double-check whether the schedule is balanced, logical, and physically possible in the real world.",
      "Do not invent employees, locations, rules, or fixes. Use only the supplied schedule/audit data.",
      "Treat deterministic hard-rule/open-coverage/shift-window errors as real blockers.",
      "Treat route/load imbalance as review-needed unless the data proves it is impossible.",
      `Service date: ${serviceDate}`,
      userPrompt ? `Operator request: ${userPrompt}` : "Operator request: final schedule sanity check.",
      "Deterministic audit:",
      JSON.stringify(audit),
      "Roster:",
      JSON.stringify(compactRoster),
      "Assignments:",
      JSON.stringify(compactAssignments),
    ].join("\n");
  }

  async function tryGeminiScheduleAudit({ serviceDate, audit = {}, assignments = [], roster = [], userPrompt = "" }) {
    const apiKey = getScheduleGeminiApiKey();
    if (!apiKey) return { ok: false, reason: "gemini_not_configured" };
    const prompt = buildScheduleAuditPrompt({ serviceDate, audit, assignments, roster, userPrompt });
    const response = await fetchWithTimeout(`${PTO_GEMINI_BASE_URL}/${encodeURIComponent(PTO_GEMINI_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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
    if (!parsed || typeof parsed !== "object") throw new Error("Gemini returned invalid schedule audit JSON.");
    return { ok: true, provider: "gemini", model: PTO_GEMINI_MODEL, data: parsed };
  }

  async function auditScheduleForDate(serviceDate, { includeAi = false, userPrompt = "" } = {}) {
    const [assignmentRowsRaw, rosterRowsRaw] = await Promise.all([
      runReadOnlySql(`
        select dsa.id as assignment_id,
               dsa.service_date,
               dsa.location_group_id,
               lg.group_code,
               lg.group_name,
               dsa.segment_number,
               dsa.assigned_employee_id,
               e.display_name as assigned_employee_name,
               e.employee_code,
               to_char(dsa.coverage_start, 'HH24:MI:SS') as coverage_start,
               to_char(dsa.coverage_end, 'HH24:MI:SS') as coverage_end,
               dsa.status,
               dsa.owner_type,
               greatest(coalesce(dsa.load_points, 1), 0)::numeric as load_points,
               coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose,
               coalesce(dsa.source_type, '') as source_type,
               coalesce(dsa.notes, '') as notes,
               to_char(dwr.shift_start, 'HH24:MI:SS') as shift_start,
               to_char(dwr.shift_end, 'HH24:MI:SS') as shift_end,
               dwr.employee_id is not null as active_roster_employee,
               (
                 lower(coalesce(lg.group_name, '')) like '%restroom%'
                 or lower(coalesce(lg.group_code, '')) like '%restroom%'
                 or exists (
                   select 1
                   from public.location_group_memberships m
                   join public.locations l on l.id = m.location_id and l.active = true
                   where m.location_group_id = dsa.location_group_id
                     and m.active = true
                     and (
                       lower(coalesce(l.location_type, '')) like '%restroom%'
                       or lower(coalesce(l.form_type, '')) like '%restroom%'
                       or lower(coalesce(l.location_name, '')) like '%restroom%'
                       or lower(coalesce(l.location_name, '')) like '%bathroom%'
                     )
                 )
               ) as is_restroom
        from public.daily_schedule_assignments dsa
        join public.location_groups lg on lg.id = dsa.location_group_id
        left join public.employees e on e.id = dsa.assigned_employee_id
        left join public.daily_work_roster dwr
          on dwr.service_date = dsa.service_date
         and dwr.employee_id = dsa.assigned_employee_id
         and dwr.active = true
        where dsa.service_date = '${esc(serviceDate)}'::date
        order by dsa.coverage_start, lg.group_name, dsa.segment_number
      `),
      runReadOnlySql(`
        select r.employee_id, e.display_name as employee_name, e.employee_code,
               to_char(r.shift_start, 'HH24:MI:SS') as shift_start,
               to_char(r.shift_end, 'HH24:MI:SS') as shift_end,
               coalesce(r.source_type, '') as source_type,
               coalesce(r.notes, '') as notes
        from public.daily_work_roster r
        join public.employees e on e.id = r.employee_id
        where r.service_date = '${esc(serviceDate)}'::date
          and r.active = true
        order by e.display_name
      `),
    ]);

    const assignments = Array.isArray(assignmentRowsRaw) ? assignmentRowsRaw : [];
    const roster = Array.isArray(rosterRowsRaw) ? rosterRowsRaw : [];
    let hardRuleRows = [];
    try {
      const rows = await runReadOnlySql(`select * from public.sch_validate_operational_schedule_rules('${esc(serviceDate)}'::date, '${esc(serviceDate)}'::date)`);
      hardRuleRows = Array.isArray(rows) ? rows : [];
    } catch (error) {
      hardRuleRows = [{ violation_type: "validator_unavailable", notes: error?.message || "Hard-rule validator failed." }];
    }

    const issues = [];
    for (const row of hardRuleRows) {
      issues.push({
        severity: String(row.violation_type || "").includes("validator_unavailable") ? "warning" : "error",
        type: String(row.violation_type || "hard_rule_violation"),
        message: row.notes || `${row.group_name || row.group_code || "Schedule row"} violates operational schedule rules.`,
        employee_name: row.employee_name || null,
        group_name: row.group_name || null,
        details: row,
      });
    }

    const openRows = assignments.filter((row) => {
      const purpose = String(row.coverage_purpose || "").toLowerCase();
      const status = String(row.status || "").toUpperCase();
      return purpose !== "reminder" && (!row.assigned_employee_id || status === "OPEN");
    });
    for (const row of openRows) {
      issues.push({
        severity: "error",
        type: "open_coverage",
        message: `${row.group_name || row.group_code || "Location"} has open coverage ${row.coverage_start || ""}-${row.coverage_end || ""}.`,
        group_name: row.group_name || null,
        details: row,
      });
    }

    for (const row of assignments.filter(isRealWorkAssignment)) {
      if (!row.active_roster_employee) {
        issues.push({
          severity: "critical",
          type: "assigned_employee_not_on_active_roster",
          message: `${row.assigned_employee_name || "Assigned employee"} is assigned to ${row.group_name || row.group_code || "a location"} but is not active on the daily roster.`,
          employee_name: row.assigned_employee_name || null,
          group_name: row.group_name || null,
          details: row,
        });
        continue;
      }
      const start = minutesFromTime(row.coverage_start);
      const end = minutesFromTime(row.coverage_end);
      const shiftStart = minutesFromTime(row.shift_start);
      const shiftEnd = minutesFromTime(row.shift_end);
      if (start != null && end != null && shiftStart != null && shiftEnd != null && (start < shiftStart || end > shiftEnd)) {
        issues.push({
          severity: "error",
          type: "coverage_outside_shift_window",
          message: `${row.assigned_employee_name || "Employee"} has ${row.group_name || row.group_code || "coverage"} ${row.coverage_start}-${row.coverage_end} outside shift ${row.shift_start}-${row.shift_end}.`,
          employee_name: row.assigned_employee_name || null,
          group_name: row.group_name || null,
          details: row,
        });
      }
    }

    const loadByEmployee = new Map(roster.map((row) => [String(row.employee_id), {
      employee_id: String(row.employee_id),
      employee_name: String(row.employee_name || ""),
      work_load: 0,
      work_segments: 0,
      restroom_segments: 0,
    }]));
    for (const row of assignments.filter(isRealWorkAssignment)) {
      const key = String(row.assigned_employee_id || "");
      if (!key) continue;
      if (!loadByEmployee.has(key)) {
        loadByEmployee.set(key, {
          employee_id: key,
          employee_name: String(row.assigned_employee_name || "Unknown"),
          work_load: 0,
          work_segments: 0,
          restroom_segments: 0,
        });
      }
      const entry = loadByEmployee.get(key);
      entry.work_load += Number(row.load_points || 0);
      entry.work_segments += 1;
      if (row.is_restroom) entry.restroom_segments += 1;
    }
    const employeeLoads = Array.from(loadByEmployee.values()).map((entry) => ({
      ...entry,
      work_load: Number(Number(entry.work_load || 0).toFixed(2)),
    }));
    const nonZeroOrAssigned = employeeLoads.filter((entry) => entry.work_segments > 0 || roster.some((row) => String(row.employee_id) === entry.employee_id));
    const loadValues = nonZeroOrAssigned.map((entry) => Number(entry.work_load || 0));
    const restroomValues = nonZeroOrAssigned.map((entry) => Number(entry.restroom_segments || 0));
    const totalLoad = loadValues.reduce((sum, value) => sum + value, 0);
    const avgLoad = loadValues.length ? totalLoad / loadValues.length : 0;
    const minLoad = loadValues.length ? Math.min(...loadValues) : 0;
    const maxLoad = loadValues.length ? Math.max(...loadValues) : 0;
    const minRestrooms = restroomValues.length ? Math.min(...restroomValues) : 0;
    const maxRestrooms = restroomValues.length ? Math.max(...restroomValues) : 0;
    const loadSpread = maxLoad - minLoad;
    const restroomSpread = maxRestrooms - minRestrooms;

    if (loadValues.length >= 3 && avgLoad > 0 && loadSpread > Math.max(2, avgLoad * 0.75)) {
      issues.push({
        severity: "warning",
        type: "workload_imbalance",
        message: `Workload spread is ${Number(loadSpread.toFixed(2))} points across ${loadValues.length} active employees (avg ${Number(avgLoad.toFixed(2))}).`,
        details: { min_load: Number(minLoad.toFixed(2)), max_load: Number(maxLoad.toFixed(2)), avg_load: Number(avgLoad.toFixed(2)), employee_loads: employeeLoads },
      });
    }
    if (restroomValues.length >= 3 && restroomSpread > 2) {
      issues.push({
        severity: "warning",
        type: "restroom_balance_review",
        message: `Restroom assignment spread is ${restroomSpread} across active employees.`,
        details: { min_restrooms: minRestrooms, max_restrooms: maxRestrooms, employee_loads: employeeLoads },
      });
    }

    const deterministic = {
      provider: "rule-based",
      service_date: serviceDate,
      summary: summarizeScheduleAuditIssues(issues),
      issue_counts: issues.reduce((acc, issue) => {
        const severity = String(issue.severity || "warning").toLowerCase();
        acc[severity] = (acc[severity] || 0) + 1;
        acc.total += 1;
        return acc;
      }, { total: 0, critical: 0, error: 0, warning: 0, info: 0 }),
      balance: {
        employee_count: loadValues.length,
        total_work_load: Number(totalLoad.toFixed(2)),
        avg_work_load: Number(avgLoad.toFixed(2)),
        min_work_load: Number(minLoad.toFixed(2)),
        max_work_load: Number(maxLoad.toFixed(2)),
        work_load_spread: Number(loadSpread.toFixed(2)),
        restroom_spread: restroomSpread,
        employee_loads: employeeLoads.sort((a, b) => Number(b.work_load || 0) - Number(a.work_load || 0)),
      },
      issues,
    };

    let ai = null;
    if (includeAi) {
      try {
        ai = await tryGeminiScheduleAudit({ serviceDate, audit: deterministic, assignments, roster, userPrompt });
      } catch (error) {
        ai = { ok: false, provider: "gemini", reason: error?.message || "gemini_audit_failed" };
      }
    }

    return {
      ...deterministic,
      ai_review: ai?.ok && ai.data
        ? {
            provider: ai.provider,
            model: ai.model,
            summary: String(ai.data.summary || "").trim() || deterministic.summary,
            logic_status: ["pass", "review", "fail"].includes(String(ai.data.logic_status || "").toLowerCase()) ? String(ai.data.logic_status).toLowerCase() : (deterministic.issue_counts.critical || deterministic.issue_counts.error ? "fail" : (deterministic.issue_counts.warning ? "review" : "pass")),
            additional_watchouts: Array.isArray(ai.data.additional_watchouts) ? ai.data.additional_watchouts : [],
            recommended_next_action: String(ai.data.recommended_next_action || "").trim() || (deterministic.issue_counts.total ? "Review the listed audit issues before publishing." : "No action needed."),
          }
        : (includeAi ? { provider: "rule-based", reason: ai?.reason || "gemini_not_used", summary: deterministic.summary, logic_status: deterministic.issue_counts.critical || deterministic.issue_counts.error ? "fail" : (deterministic.issue_counts.warning ? "review" : "pass"), additional_watchouts: [], recommended_next_action: deterministic.issue_counts.total ? "Review the listed audit issues before publishing." : "No action needed." } : null),
    };
  }

  async function getAssignedEmployeeForDevice(deviceId) {
    return resolveCanonicalDevice({ runReadOnlySql, deviceIdentifier: deviceId });
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
        source_type: row.source_type || row.assignment_source_type || null,
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
    const deviceId = String(req.memphisDevice?.canonical_device_id || req.memphisDevice?.device_id || req.query.device_id || req.query.device || "").trim();
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
      : `display_name ilike '${esc(employeeName)}%'`;
    const employeeRows = await runReadOnlySql(`
      select id as employee_id
      from public.employees
      where active = true and ${predicate}
      order by case when display_name ilike '${esc(employeeName)}' then 0 else 1 end, display_name
      limit 1
    `);
    if (!Array.isArray(employeeRows) || !employeeRows.length) throw new Error("Active employee not found.");
    return { employeeId: employeeRows[0].employee_id, assignment: null };
  }

  function renderMyScheduleHtml(data) {
    const employee = data?.employee || {};
    const items = Array.isArray(data?.items) ? data.items : [];
    const KNOWN_RESTROOM_EXHIBIT_BASES = new Set(["teton", "china", "expo", "zambezi", "memmex", "bonobos"]);
    const ALWAYS_LAST_LOCATION_RANKS = [["cat country", 0], ["primate canyon", 1], ["primate pavilion", 2], ["primate pavillion", 2]];
    const normalizePurpose = (value) => String(value || "area_owner").trim().toLowerCase();
    const normalizeLocationName = (value) => String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const isRestroomLocationName = (value) => /\b(restroom|restrooms|bathroom|bathrooms|toilet|toilets)\b/.test(normalizeLocationName(value));
    const stripRestroomSuffix = (value) => normalizeLocationName(value).replace(/\b(restroom|restrooms|bathroom|bathrooms|toilet|toilets)\b/g, "").replace(/\s+/g, " ").trim();
    const alwaysLastLocationRank = (value) => { const normalized = normalizeLocationName(value); for (const [needle, rank] of ALWAYS_LAST_LOCATION_RANKS) { if (normalized.includes(needle)) return rank; } return -1; };
    const isPrivateAdminLocation = (value) => { const normalized = normalizeLocationName(value); return normalized.includes("east admin") || normalized.includes("west admin"); };
    const itemDisplayName = (item = {}) => String(item?.name || item?.location_name || "Assigned Area").trim();
    const buildRestroomPairBases = (list = []) => {
      const bases = new Set();
      const plainBases = new Set();
      const restroomBases = new Set();
      for (const item of list) {
        const name = itemDisplayName(item);
        const base = stripRestroomSuffix(name);
        if (!base) continue;
        if (KNOWN_RESTROOM_EXHIBIT_BASES.has(base)) bases.add(base);
        if (isRestroomLocationName(name)) restroomBases.add(base); else plainBases.add(base);
      }
      for (const base of plainBases) if (restroomBases.has(base)) bases.add(base);
      return bases;
    };
    const itemSortMeta = (name, pairBases) => {
      const base = stripRestroomSuffix(name) || normalizeLocationName(name);
      const lastRank = alwaysLastLocationRank(name);
      if (lastRank >= 0) return { category: 5, base, lastRank, restroomRank: isRestroomLocationName(name) ? 1 : 0, display: String(name || "") };
      if (isPrivateAdminLocation(name)) return { category: 4, base, lastRank: -1, restroomRank: isRestroomLocationName(name) ? 1 : 0, display: String(name || "") };
      if (pairBases.has(base)) return { category: 2, base, lastRank: -1, restroomRank: isRestroomLocationName(name) ? 1 : 0, display: String(name || "") };
      if (isRestroomLocationName(name)) return { category: 1, base, lastRank: -1, restroomRank: 0, display: String(name || "") };
      return { category: 3, base, lastRank: -1, restroomRank: 0, display: String(name || "") };
    };
    const compareScheduleItemNames = (aName, bName, pairBases) => {
      const a = itemSortMeta(aName, pairBases);
      const b = itemSortMeta(bName, pairBases);
      if (a.category !== b.category) return a.category - b.category;
      if (a.category === 5 && a.lastRank !== b.lastRank) return a.lastRank - b.lastRank;
      if (a.base !== b.base) return a.base.localeCompare(b.base);
      if (a.restroomRank !== b.restroomRank) return a.restroomRank - b.restroomRank;
      return a.display.localeCompare(b.display);
    };
    const pairBases = buildRestroomPairBases(items);
    const sortedItems = [...items].sort((a, b) => compareScheduleItemNames(itemDisplayName(a), itemDisplayName(b), pairBases));
    const toMinutes = (value) => {
      const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (!match) return -1;
      let hours = Number(match[1]);
      const minutes = Number(match[2]);
      const meridiem = String(match[3] || "").toUpperCase();
      if (meridiem === "PM" && hours !== 12) hours += 12;
      if (meridiem === "AM" && hours === 12) hours = 0;
      return hours * 60 + minutes;
    };
    const scheduleTitle = (() => {
      const purposes = sortedItems.map((item) => normalizePurpose(item?.coverage_purpose || item?.purpose || item?.kind));
      if (purposes.some((purpose) => purpose === "lunch_coverage")) return "Lunch Coverage";
      if (purposes.some((purpose) => purpose === "late_coverage")) return "Afternoon Call Coverage";
      if (purposes.some((purpose) => purpose === "restroom_upkeep")) return "Restroom Rebalance";
      if (sortedItems.some((item) => toMinutes(item?.coverage_start) >= 585)) return "Restroom Rebalance";
      if (data?.phase === "morning" || purposes.some((purpose) => purpose === "deep_clean")) return "Morning Full Clean Schedule";
      return "Restroom Rebalance";
    })();
    const formatDate = (value) => {
      if (!value) return "Unknown date";
      const date = new Date(`${value}T12:00:00`);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    };
    const locationsHtml = sortedItems.length
      ? `<section class="card"><h2>${htmlEscape(scheduleTitle)}</h2><ul>${sortedItems.map((item) => `<li>${htmlEscape(itemDisplayName(item))}</li>`).join("")}</ul></section>`
      : `<section class="card"><div class="empty">${htmlEscape(data?.notice || "No assignments are currently listed.")}</div></section>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>My Schedule</title>
<style>
  :root { --teal:#0f4d57; --teal2:#0b3b43; --line:#cfe1db; --text:#173238; --muted:#63787d; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background:#eef5f3; color:var(--text); }
  .top { background:linear-gradient(135deg,var(--teal),var(--teal2)); color:white; padding:22px 18px 26px; border-bottom-left-radius:24px; border-bottom-right-radius:24px; box-shadow:0 4px 16px rgba(0,0,0,.18); }
  .eyebrow { font-size:13px; opacity:.84; letter-spacing:.03em; text-transform:uppercase; }
  h1 { margin:6px 0 3px; font-size:30px; line-height:1.08; }
  .date { font-size:17px; opacity:.95; }
  .wrap { max-width:720px; margin:0 auto; padding:16px; }
  .card { background:white; border:1px solid var(--line); border-radius:20px; padding:16px; margin:14px 0; box-shadow:0 2px 10px rgba(20,60,70,.07); }
  .card h2 { margin:0 0 12px; font-size:20px; color:var(--teal); }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:8px; }
  li { padding:12px 14px; background:#f8fbfa; border:1px solid #e1ece8; border-radius:13px; font-weight:700; }
  .empty { color:var(--muted); font-weight:650; text-align:center; padding:8px; }
</style>
</head>
<body>
  <header class="top">
    <div class="eyebrow">Custodial Schedule</div>
    <h1>${htmlEscape(data?.employee_name || employee.display_name || "My Schedule")}</h1>
    <div class="date">${htmlEscape(formatDate(data?.service_date))}</div>
  </header>
  <main class="wrap">
    ${locationsHtml}
  </main>
</body>
</html>`;
  }

  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("schedule", { contract_version: contractVersion }));
  });

  router.get("/audit/day", requireManagerRead, async (req, res) => {
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

  router.get("/work-status", requireManagerRead, async (req, res) => {
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

  router.get("/today", requireManagerRead, async (_req, res) => {
    try {
      const serviceDate = await getServiceDate();
      if (!serviceDate) throw new Error("Could not resolve service date.");
      await assertScheduleReadyForRead(serviceDate);
      const rows = await runReadOnlySql(`select * from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)`);
      const rosterRows = await runReadOnlySql(`
        select r.employee_id, e.display_name as employee_name, e.employee_code,
               to_char(r.shift_start, 'HH24:MI:SS') as shift_start,
               to_char(r.shift_end, 'HH24:MI:SS') as shift_end,
               r.active, r.source_type, r.notes
        from public.daily_work_roster r
        join public.employees e on e.id = r.employee_id
        where r.service_date = '${esc(serviceDate)}'::date
          and r.active = true
        order by r.shift_start asc, e.display_name asc
      `);
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, roster: rosterRows || [], groups: groupScheduleRows(rows) },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Today schedule failed");
    }
  });

  router.get("/day", requireManagerRead, async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date);
      await assertScheduleReadyForRead(serviceDate);
      const rows = await runReadOnlySql(`select * from public.sch_get_daily_schedule_with_purpose('${esc(serviceDate)}'::date)`);
      const rosterRows = await runReadOnlySql(`
        select r.employee_id, e.display_name as employee_name, e.employee_code,
               to_char(r.shift_start, 'HH24:MI:SS') as shift_start,
               to_char(r.shift_end, 'HH24:MI:SS') as shift_end,
               r.active, r.source_type, r.notes
        from public.daily_work_roster r
        join public.employees e on e.id = r.employee_id
        where r.service_date = '${esc(serviceDate)}'::date
          and r.active = true
        order by r.shift_start asc, e.display_name asc
      `);
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, roster: rosterRows || [], groups: groupScheduleRows(rows) },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Schedule day failed");
    }
  });

  router.get("/my-day", requireEmployeeDevice, async (req, res) => {
    try {
      const deviceId = String(req.memphisDevice?.canonical_device_id || req.memphisDevice?.device_id || req.query.device_id || req.query.device || "").trim();
      if (!deviceId) throw new Error("device_id is required.");
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      await assertScheduleReadyForRead(serviceDate);
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
          requested_device_id: assignment.requested_device_id || deviceId,
          device_id: assignment.canonical_device_id || assignment.device_id,
          canonical_device_id: assignment.canonical_device_id || assignment.device_id,
          matched_by: assignment.matched_by || "canonical",
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

  router.get("/my-day-summary", requirePersonalScheduleAccess, async (req, res) => {
    try {
      const deviceId = String(req.memphisDevice?.canonical_device_id || req.memphisDevice?.device_id || req.query.device_id || req.query.device || "").trim();
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
            and display_name ilike '${esc(employeeName)}%'
          order by case when display_name ilike '${esc(employeeName)}' then 0 else 1 end, display_name
          limit 1
        `);
        if (!Array.isArray(employeeRows) || !employeeRows.length) {
          res.status(404).json({ ok: false, error: "Active employee not found." });
          return;
        }
        resolvedEmployeeId = employeeRows[0].employee_id;
      }

      let data = await loadStaticWeeklyEmployeeDay(serviceDate, resolvedEmployeeId, atSql);
      if (!data) {
        await assertScheduleReadyForRead(serviceDate);
        const [pageRows, fullDayItems] = await Promise.all([
          runReadOnlySql(`
            select public.sch_employee_my_schedule_page(
              '${esc(serviceDate)}'::date,
              '${esc(resolvedEmployeeId)}'::uuid,
              ${atSql}
            ) as data
          `),
          loadFullDayScheduleItems(serviceDate, resolvedEmployeeId),
        ]);
        const pageData = Array.isArray(pageRows) && pageRows.length ? pageRows[0].data : null;
        data = combineFullDaySchedule(pageData, fullDayItems);
      }
      res.status(200).json({
        ok: true,
        data: {
          ...data,
          requested_device_id: assignment?.requested_device_id || deviceId || null,
          device_id: assignment?.canonical_device_id || assignment?.device_id || deviceId || null,
          canonical_device_id: assignment?.canonical_device_id || assignment?.device_id || null,
          matched_by: assignment?.matched_by || null,
          device_name: assignment?.device_name || null,
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Personal schedule summary failed");
    }
  });

  router.get("/my-schedule", requirePersonalScheduleAccess, async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const atSql = optionalTimestampLiteral(req.query.as_of || req.query.at);
      const { employeeId } = await resolveEmployeeIdFromRequest(req);
      let data = await loadStaticWeeklyEmployeeDay(serviceDate, employeeId, atSql);
      if (!data) {
        await assertScheduleReadyForRead(serviceDate);
        const [pageRows, fullDayItems] = await Promise.all([
          runReadOnlySql(`
            select public.sch_employee_my_schedule_page(
              '${esc(serviceDate)}'::date,
              '${esc(employeeId)}'::uuid,
              ${atSql}
            ) as data
          `),
          loadFullDayScheduleItems(serviceDate, employeeId),
        ]);
        const pageData = Array.isArray(pageRows) && pageRows.length ? pageRows[0].data : null;
        data = combineFullDaySchedule(pageData, fullDayItems);
      }
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

  router.get("/settings/close-time", requireManagerRead, async (req, res) => {
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

  router.get("/employees", requireManagerRead, async (_req, res) => {
    try {
      const rows = await runReadOnlySql(`
        select
          id as employee_id,
          employee_code,
          display_name,
          role,
          active,
          coalesce(employee_code, '') not in (${coverAllEmployeeCodeSqlList()}) as absence_eligible
        from public.employees
        where active = true
        order by display_name
      `);
      res.status(200).json({ ok: true, data: rows || [], meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Employees failed");
    }
  });

  router.get("/employee-aliases", requireManagerRead, async (req, res) => {
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

  router.get("/shift-templates", requireManagerRead, async (req, res) => {
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

  router.get("/pto", requireManagerRead, async (req, res) => {
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

  router.post("/pto/parse-report", requireSchedulePin, async (req, res) => {
    try {
      const parsed = await aiParsePtoReportText(req.body?.report_text || "");
      res.status(200).json({ ok: true, data: { detected_count: parsed.detected_rows.length, kept_count: parsed.kept_rows.length, rows: parsed.import_rows, provider: parsed.provider, providers_used: parsed.providers_used, fallback_count: parsed.fallback_count }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "PTO report parse failed");
    }
  });

  router.get("/coverall/slots", requireManagerRead, async (req, res) => {
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

  router.post("/coverall/links", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const slotCode = normalizeCoverAllSlotCode(req.body?.slot || req.body?.slot_code || req.body?.employee_code);
      if (!slotCode) throw Object.assign(new Error("slot_code must be COVERALL_01 through COVERALL_04."), { status: 422 });
      const actor = String(req.memphisAuth?.manager_display_name || req.memphisAuth?.manager_id || "authenticated_manager");
      const data = await issueCoverAllAssignmentLink({
        serviceDate,
        slotCode,
        lang: req.body?.lang,
        ttlHours: req.body?.ttl_hours,
        actor,
      });
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Secure CoverAll assignment link creation failed");
    }
  });

  router.post("/coverall/links/revoke", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const slotCode = normalizeCoverAllSlotCode(req.body?.slot || req.body?.slot_code || req.body?.employee_code);
      if (!slotCode) throw Object.assign(new Error("slot_code must be COVERALL_01 through COVERALL_04."), { status: 422 });
      const actor = String(req.memphisAuth?.manager_display_name || req.memphisAuth?.manager_id || "authenticated_manager");
      const revokedCount = await revokeCoverAllAssignmentLinks({ serviceDate, slotCode, actor });
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ ok: true, data: { service_date: serviceDate, slot_code: slotCode, revoked_count: revokedCount }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Secure CoverAll assignment link revocation failed");
    }
  });

  router.get("/coverall/assignment", limitPublicCoverAll, async (req, res) => {
    setCoverAllAssignmentSecurityHeaders(res);
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const slotCode = normalizeCoverAllSlotCode(req.query.slot || req.query.slot_code || req.query.employee_code || "COVERALL_01");
      if (!slotCode) throw Object.assign(new Error("This CoverAll assignment link is invalid or expired."), { status: 403, code: "coverall_link_invalid" });
      const lang = String(req.query.lang || "en").trim().toLowerCase() === "es" ? "es" : "en";
      const accessToken = normalizeCoverAllAccessToken(req.query.access_token || req.query.token);
      await authorizeCoverAllAssignmentLink({ serviceDate, slotCode, accessToken });
      const slot = await getCoverAllSlotByCode(slotCode);
      const shiftRows = await runReadOnlySql(`
        select to_char(shift_start, 'HH24:MI') as shift_start, to_char(shift_end, 'HH24:MI') as shift_end
        from public.daily_work_roster
        where service_date = '${esc(serviceDate)}'::date
          and employee_id = '${esc(slot.employee_id)}'::uuid
          and active = true
        limit 1
      `);
      const assignmentRows = await runReadOnlySql(`
        select
          dsa.id as assignment_id,
          lg.group_name,
          lg.group_code,
          to_char(dsa.coverage_start, 'HH24:MI') as coverage_start,
          to_char(dsa.coverage_end, 'HH24:MI') as coverage_end,
          dsa.notes,
          coalesce(array_agg(l.location_name order by l.sort_order nulls last, l.location_name)
            filter (where l.id is not null), array[]::text[]) as included_locations
        from public.daily_schedule_assignments dsa
        join public.location_groups lg on lg.id = dsa.location_group_id
        left join public.location_group_memberships m on m.location_group_id = lg.id and m.active = true
        left join public.locations l on l.id = m.location_id and l.active = true
        where dsa.service_date = '${esc(serviceDate)}'::date
          and dsa.assigned_employee_id = '${esc(slot.employee_id)}'::uuid
          and dsa.status = 'ASSIGNED'
        group by dsa.id, lg.group_name, lg.group_code, dsa.coverage_start, dsa.coverage_end, dsa.notes
        order by dsa.coverage_start, lg.group_name, dsa.segment_number
      `);
      const shiftRow = Array.isArray(shiftRows) && shiftRows.length ? shiftRows[0] : null;
      const data = { shift: { start: shiftRow?.shift_start || "—", end: shiftRow?.shift_end || "—" } };
      const items = (Array.isArray(assignmentRows) ? assignmentRows : []).map((row) => {
        const included = Array.isArray(row.included_locations) ? row.included_locations : [];
        const groupText = [row.group_name, row.group_code].join(" " ).toLowerCase();
        return {
          name: `${row.coverage_start || "—"}-${row.coverage_end || "—"} • ${row.group_name || row.group_code || "Area"}`,
          group_name: row.group_name,
          group_code: row.group_code,
          location_name: included.join(", "),
          is_public_restroom: groupText.includes("restroom") || groupText.includes("bathroom") || groupText.includes("toilet"),
        };
      });
      const publicOrigin = String(process.env.SCHEDULE_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://memphis-zoo-mcp.onrender.com").replace(/\/+$/, "");
      const enUrl = `${publicOrigin}${coverAllPublicPath(serviceDate, slot.employee_code, "en", accessToken)}`;
      const esUrl = `${publicOrigin}${coverAllPublicPath(serviceDate, slot.employee_code, "es", accessToken)}`;
      const t = lang === "es"
        ? { title: "Asignaciones de CoverAll", shift: "Turno", areas: "Áreas asignadas", restrooms: "Baños públicos", other: "Exhibiciones", none: "No hay asignaciones publicadas todavía.", language: "English", notice: "Revise sus áreas asignadas. No hay acceso a otras herramientas." }
        : { title: "CoverAll Assignments", shift: "Shift", areas: "Assigned areas", restrooms: "Public restrooms", other: "Exhibits", none: "No assignments posted yet.", language: "Español", notice: "Review your assigned areas. No access to other tools is provided." };
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
  :root{--bg:#071018;--panel:rgba(10,16,24,.62);--panel2:rgba(9,14,21,.78);--card:rgba(255,255,255,.07);--text:#f8fafc;--muted:rgba(248,250,252,.72);--line:rgba(255,255,255,.14);--lime:#84c341;--lime2:#d7f2b0;--warn:#f4cf7a;--shadow:0 18px 44px rgba(0,0,0,.32)}
  *{box-sizing:border-box}html{font-size:18px}body{margin:0;min-height:100vh;font-family:Arial,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text);background:#10161d;background-image:linear-gradient(rgba(4,10,20,.58),rgba(4,10,20,.68)),url('https://lasrevinu333-design.github.io/Engine/Background1_optimized.webp');background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:fixed}
  .top{position:relative;max-width:860px;margin:14px auto 0;padding:18px 18px 20px;border:1px solid var(--line);border-radius:24px;background:var(--panel);box-shadow:var(--shadow);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);overflow:hidden}
  .top:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,0) 42%);pointer-events:none}.top>*{position:relative}.eyebrow{color:var(--lime2);font-size:.68rem;font-weight:800;letter-spacing:.2em;text-transform:uppercase}.lang{float:right;color:#071018;background:linear-gradient(180deg,#d7f2b0,#9fcd5e);border:0;border-radius:999px;padding:9px 13px;text-decoration:none;font-weight:900;font-size:.78rem;box-shadow:0 8px 18px rgba(0,0,0,.18)}
  h1{margin:10px 0 4px;font-size:clamp(1.75rem,7vw,2.8rem);line-height:.98;font-weight:900;letter-spacing:-.05em}.shift{font-size:1rem;color:var(--muted);font-weight:700}.wrap{max-width:860px;margin:0 auto;padding:14px}.notice{border:1px solid rgba(132,195,65,.32);border-radius:18px;padding:13px 14px;margin:14px 0;background:rgba(132,195,65,.14);color:#efffdc;font-weight:800;box-shadow:0 8px 22px rgba(0,0,0,.16)}.card{border:1px solid var(--line);border-radius:22px;padding:15px;margin:14px 0;background:var(--panel2);box-shadow:var(--shadow);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.card h2{margin:0 0 10px;font-size:1.08rem;color:var(--lime2);font-weight:900;letter-spacing:-.02em}ul{list-style:none;padding:0;margin:0;display:grid;gap:9px}li{padding:13px 13px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.10);border-radius:16px;font-weight:850;line-height:1.3}li:before{content:"✓";display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-right:9px;border-radius:999px;background:rgba(132,195,65,.18);color:var(--lime2);font-weight:900}li.muted{color:var(--muted);font-weight:700}li.muted:before{content:"•"}.meta{margin:14px 0 22px;color:var(--muted);font-size:.78rem;text-align:center;font-weight:800}.pill{display:inline-flex;align-items:center;padding:7px 11px;border-radius:999px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.12);font-size:.78rem;margin-top:10px;font-weight:900;color:#efffdc}
  @media(max-width:640px){body{background-attachment:scroll}.top{margin:10px 10px 0;border-radius:22px}.wrap{padding:10px}.lang{float:none;display:inline-flex;margin-bottom:10px}.card{padding:13px}.notice{font-size:.9rem}}
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
      const status = Number(error?.status) || 400;
      const safeMessage = status === 403 ? "This CoverAll assignment link is invalid or expired." : "The CoverAll schedule is temporarily unavailable.";
      res.status(status).send(`<!doctype html><html><body style="font-family:system-ui;padding:20px"><h1>CoverAll schedule unavailable</h1><p>${htmlEscape(safeMessage)}</p></body></html>`);
    }
  });

  router.get("/location-groups", requireManagerRead, async (_req, res) => {
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

  router.get("/audit", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const includeAi = String(req.query.ai || req.query.include_ai || "1").trim() !== "0";
      const prompt = String(req.query.prompt || "").trim();
      const data = await auditScheduleForDate(serviceDate, { includeAi, userPrompt: prompt || "Double-check that the schedule is balanced, logical, and physically possible." });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Schedule audit failed");
    }
  });

  router.post("/ai/audit", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const prompt = String(req.body?.prompt || "").trim();
      const includeAi = req.body?.ai !== false && req.body?.include_ai !== false;
      const data = await auditScheduleForDate(serviceDate, { includeAi, userPrompt: prompt || "Double-check that the schedule is balanced, logical, and physically possible." });
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Schedule AI audit failed");
    }
  });

  router.get("/coverage-templates/export.csv", requireManagerRead, async (_req, res) => {
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

  router.get("/locations/workload-settings", requireManagerRead, async (_req, res) => {
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

  router.use((_req, _res, next) => {
    // Schedule reads are intentionally read-only. Use explicit generate endpoints to create or rebuild schedules.
    next();
  });

  router.get("/current-owner", requireManagerRead, async (req, res) => {
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
      const static_restore_result = await restoreStaticOwnersForDate(serviceDate);
      const coverall_balance_result = await rebalanceCoverAllAssignments(serviceDate);
      const restroom_rebalance_result = await rebalanceRestroomAssignments(serviceDate);
      const lunch_coverage_result = await applyLunchCoverageAfterRestroomRebalance(serviceDate);
      const restroom_rebalance_completion = await markRestroomRebalanceCompletion(serviceDate, { reason: "generate_daily", balance: restroom_rebalance_result, lunch_coverage: lunch_coverage_result }, "completed");
      const schedule_audit = await auditScheduleForDate(serviceDate, { includeAi: true, userPrompt: "Final check after daily schedule generation, CoverAll balancing, and restroom rebalance: balanced, logical, and physically possible." });
      res.status(200).json({ ok: true, data: { generate_result: data, static_restore_result, coverall_balance_result, restroom_rebalance_result, lunch_coverage_result, restroom_rebalance_completion, schedule_audit }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Generate daily schedule failed");
    }
  });

  router.post("/sch2/preview", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const force = optionalBoolean(req.body?.force, false);
      const preview = await runRpc("sch2_generate_preview", { p_service_date: serviceDate, p_force: force });
      const runId = preview?.run_id || preview?.data?.run_id;
      const audit = runId
        ? await runRpc("sch2_audit_solution", { p_run_id: runId })
        : (preview?.audit || null);
      const diffRows = runId
        ? await runReadOnlySql(`select public.sch2_compare_current_vs_preview('${esc(runId)}'::uuid) as data`)
        : [];
      const diff = Array.isArray(diffRows) && diffRows.length ? diffRows[0].data : (preview?.diff || null);
      const violationRows = runId
        ? await runReadOnlySql(`
            select violation_type, severity, detail, location_group_id, assigned_employee_id
            from public.v_sch2_constraint_violations
            where run_id = '${esc(runId)}'::uuid
            order by severity desc, violation_type asc, detail asc
            limit 200
          `)
        : [];
      res.status(200).json({
        ok: true,
        data: { service_date: serviceDate, force, preview, run_id: runId || null, audit, diff, violations: violationRows || [] },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "SCH2 preview generation failed");
    }
  });

  router.post("/sch2/publish", requireSchedulePin, async (req, res) => {
    try {
      const runId = requireUuid(req.body?.run_id || req.body?.id, "run_id");
      const confirm = optionalBoolean(req.body?.confirm, false);
      const data = await runSch2PublishWithFallback(runId, confirm);
      res.status(200).json({
        ok: true,
        data: { run_id: runId, confirm, publish_result: data },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "SCH2 publish failed");
    }
  });

  router.post("/sch2/rollback", requireSchedulePin, async (req, res) => {
    try {
      const publishAuditId = requireUuid(req.body?.publish_audit_id || req.body?.audit_id || req.body?.id, "publish_audit_id");
      const data = await runRpc("sch2_rollback_publish", { p_publish_audit_id: publishAuditId });
      res.status(200).json({
        ok: true,
        data: { publish_audit_id: publishAuditId, rollback_result: data },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "SCH2 rollback failed");
    }
  });

  router.get("/sch2/runs", requireManagerRead, async (req, res) => {
    try {
      const serviceDate = req.query.service_date || req.query.date ? requireDate(req.query.service_date || req.query.date) : "";
      const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit || 10), 10) || 10));
      const rows = await runReadOnlySql(`
        select id, service_date, generator_version, input_hash, status, mode, force,
               hard_violation_count, open_required_count, score_total, audit_summary,
               diff_summary, created_at, updated_at, published_at, published_by
        from public.schedule_generation_runs
        where (${serviceDate ? `'${esc(serviceDate)}'::date` : "null::date"} is null or service_date = '${esc(serviceDate || "1900-01-01")}'::date)
        order by created_at desc
        limit ${limit}
      `);
      res.status(200).json({ ok: true, data: { runs: rows || [] }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "SCH2 run listing failed");
    }
  });

  router.get("/sch2/explain", requireManagerRead, async (req, res) => {
    try {
      const runId = requireUuid(req.query.run_id || req.query.id, "run_id");
      const workItemId = requireUuid(req.query.work_item_id || req.query.item_id, "work_item_id");
      const rows = await runReadOnlySql(`select public.sch2_explain_assignment('${esc(runId)}'::uuid, '${esc(workItemId)}'::uuid) as data`);
      const data = Array.isArray(rows) && rows.length ? rows[0].data : null;
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "SCH2 assignment explanation failed");
    }
  });

  router.get("/generation-window", requireManagerRead, async (req, res) => {
    try {
      const serviceDate = requireDate(req.query.service_date || req.query.date || (await getServiceDate()));
      const days = Math.max(1, Math.min(14, Number.parseInt(String(req.query.days || 7), 10) || 7));
      const triggerAutoRequested = String(req.query.trigger_auto || "").trim() === "1";
      const window = await getScheduleRangeStatus(serviceDate, days);
      const ready_days = window.filter((row) => row.ready).length;
      const autoGeneration = {
        running: autoGenerateState.running,
        last_started_at: autoGenerateState.lastStartedAt || null,
        last_completed_at: autoGenerateState.lastCompletedAt || null,
        last_window_start: autoGenerateState.lastWindowStart || null,
        generated_days: Array.isArray(autoGenerateState.lastResult) ? autoGenerateState.lastResult.filter((row) => row.generated).length : 0,
        trigger_auto_requested: triggerAutoRequested,
        trigger_auto_ignored: triggerAutoRequested,
        generation_endpoint: "/schedule-api/generate-range",
      };
      res.status(200).json({ ok: true, data: { service_date: serviceDate, days, ready_days, missing_days: Math.max(0, days - ready_days), window, auto_generation: autoGeneration, ai_summary: buildWeekSummaryText({ serviceDate, days, windowRows: window, autoGeneration }) }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Schedule window status failed");
    }
  });

  router.post("/generate-range", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const days = Math.max(1, Math.min(14, Number.parseInt(String(req.body?.days || 7), 10) || 7));
      const force = req.body?.force !== false;
      const generated_days = await ensureScheduleRange(serviceDate, days, { force });
      const schedule_audits = [];
      for (const row of generated_days || []) {
        schedule_audits.push(await auditScheduleForDate(row.service_date, { includeAi: false, userPrompt: "Range generation deterministic schedule sanity check." }));
      }
      res.status(200).json({ ok: true, data: { service_date: serviceDate, days, generated_days, schedule_audits }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Generate schedule range failed");
    }
  });

  router.post("/manual-absences/publish", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const explicit = normalizeUuidList(req.body?.absent_employee_ids || []);
      const requestedCoverAllSlots = Array.isArray(req.body?.coverall_slots) ? req.body.coverall_slots : [];
      let coverallPlan = await buildCoverAllPlan(serviceDate, explicit);

      await runCommand("manual_absence_publish", { service_date: serviceDate, employee_ids: explicit });

      const generateResult = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: true });
      const staticRestoreResult = await restoreStaticOwnersForDate(serviceDate);
      let coverallManual = null;
      if (requestedCoverAllSlots.length) {
        coverallManual = await publishCoverAllSlotsForDate(serviceDate, requestedCoverAllSlots, { regenerate: false, restoreStatic: false, rebalance: false });
      }
      coverallPlan = await applyCoverAllPlan(serviceDate, coverallPlan);
      const coverallBalanceResult = requestedCoverAllSlots.length || coverallPlan?.triggered
        ? await rebalanceCoverAllAssignments(serviceDate)
        : null;
      const restroomRebalanceResult = await rebalanceRestroomAssignments(serviceDate);
      const lunchCoverageResult = await applyLunchCoverageAfterRestroomRebalance(serviceDate);
      const restroomRebalanceCompletion = await markRestroomRebalanceCompletion(serviceDate, { reason: "manual_absence_publish", balance: restroomRebalanceResult, lunch_coverage: lunchCoverageResult }, "completed");
      const activeRows = await listPtoRows({ startDate: serviceDate, endDate: serviceDate });
      const manualRows = activeRows.filter((row) => String(row.pto_type || "").toLowerCase() === "manual_override");
      const scheduleAudit = await auditScheduleForDate(serviceDate, { includeAi: true, userPrompt: "Final check after manual absence publish and CoverAll rebalance: balanced, logical, and physically possible." });

      res.status(200).json({
        ok: true,
        data: {
          service_date: serviceDate,
          selected_absent_count: explicit.length,
          manual_absence_count: manualRows.length,
          active_absence_count: activeRows.length,
          active_absences: activeRows,
          generate_result: generateResult,
          static_restore_result: staticRestoreResult,
          schedule_audit: scheduleAudit,
          coverall: coverallPlan,
          coverall_manual: coverallManual,
          coverall_balance_result: coverallBalanceResult,
          restroom_rebalance_result: restroomRebalanceResult,
          lunch_coverage_result: lunchCoverageResult,
          restroom_rebalance_completion: restroomRebalanceCompletion,
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

      await runCommand("manual_absence_return", { service_date: serviceDate, employee_id: employeeId });

      const generateResult = await runRpc("sch_generate_daily_schedule", { p_service_date: serviceDate, p_force: true });
      const staticRestoreResult = await restoreStaticOwnersForDate(serviceDate);
      const coverallBalanceResult = await rebalanceCoverAllAssignments(serviceDate);
      const restroomRebalanceResult = await rebalanceRestroomAssignments(serviceDate);
      const lunchCoverageResult = await applyLunchCoverageAfterRestroomRebalance(serviceDate);
      const restroomRebalanceCompletion = await markRestroomRebalanceCompletion(serviceDate, { reason: "manual_absence_return", balance: restroomRebalanceResult, lunch_coverage: lunchCoverageResult }, "completed");
      const activeRows = await listPtoRows({ startDate: serviceDate, endDate: serviceDate });
      const stillAbsentRows = activeRows.filter((row) => String(row.employee_id || "") === employeeId);
      const scheduleAudit = await auditScheduleForDate(serviceDate, { includeAi: true, userPrompt: "Final check after returning employee to schedule: balanced, logical, and physically possible." });

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
          static_restore_result: staticRestoreResult,
          coverall_balance_result: coverallBalanceResult,
          restroom_rebalance_result: restroomRebalanceResult,
          lunch_coverage_result: lunchCoverageResult,
          restroom_rebalance_completion: restroomRebalanceCompletion,
          schedule_audit: scheduleAudit,
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
      const staticRestoreResult = await restoreStaticOwnersForDate(serviceDate);
      coverallPlan = await applyCoverAllPlan(serviceDate, coverallPlan);
      const coverallBalanceResult = coverallPlan?.triggered
        ? await rebalanceCoverAllAssignments(serviceDate)
        : null;
      const restroomRebalanceResult = await rebalanceRestroomAssignments(serviceDate);
      const lunchCoverageResult = await applyLunchCoverageAfterRestroomRebalance(serviceDate);
      const restroomRebalanceCompletion = await markRestroomRebalanceCompletion(serviceDate, { reason: "absence_publish", balance: restroomRebalanceResult, lunch_coverage: lunchCoverageResult }, "completed");
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
        data.coverall_balance_result = coverallBalanceResult;
        data.restroom_rebalance_result = restroomRebalanceResult;
        data.lunch_coverage_result = lunchCoverageResult;
        data.restroom_rebalance_completion = restroomRebalanceCompletion;
        data.manager_notification = coverallPlan?.manager_notification || null;
      }
      const scheduleAudit = await auditScheduleForDate(serviceDate, { includeAi: true, userPrompt: "Final check after absence publish: balanced, logical, and physically possible." });
      if (data && typeof data === "object") data.schedule_audit = scheduleAudit;
      res.status(200).json({ ok: true, data, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Absence publish failed");
    }
  });

  router.post("/restroom-rebalance/run", requireSchedulePin, async (req, res) => {
    try {
      const serviceDate = requireDate(req.body?.service_date || req.body?.date || (await getServiceDate()));
      const readiness = await ensureScheduleReadyForRestroomRebalance(serviceDate);
      const balance = await rebalanceRestroomAssignments(serviceDate);
      const lunch_coverage = await applyLunchCoverageAfterRestroomRebalance(serviceDate);
      const result = { service_date: serviceDate, reason: "manual_endpoint", readiness, balance, lunch_coverage };
      const persistent_completion = await markRestroomRebalanceCompletion(serviceDate, result, "completed");
      restroomRebalanceState = {
        running: false,
        lastStartedAt: Date.now(),
        lastCompletedAt: Date.now(),
        lastServiceDate: serviceDate,
        lastResult: { ...result, persistent_completion },
      };
      res.status(200).json({ ok: true, data: { service_date: serviceDate, readiness, balance, lunch_coverage, implementation_mode: RESTROOM_REBALANCE_IMPLEMENTATION_MODE, persistent_completion, state: restroomRebalanceState }, meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
    } catch (error) {
      fail(res, error, "Restroom rebalance failed");
    }
  });

  router.get("/restroom-rebalance/status", requireSchedulePin, async (_req, res) => {
    try {
      const serviceDate = requireDate(await getServiceDate());
      const persistent_completion = await getRestroomRebalanceCompletion(serviceDate);
      res.status(200).json({
        ok: true,
        data: {
          scheduled_time: RESTROOM_REBALANCE_TIME,
          timezone: RESTROOM_REBALANCE_TZ,
          service_date: serviceDate,
          due_now: isRestroomRebalanceDue(),
          implementation_mode: RESTROOM_REBALANCE_IMPLEMENTATION_MODE,
          scheduler: restroomRebalanceScheduler,
          state: restroomRebalanceState,
          persistent_completion,
        },
        meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion },
      });
    } catch (error) {
      fail(res, error, "Restroom rebalance status failed");
    }
  });

  if (RESTROOM_REBALANCE_SWEEP_MS > 0 && typeof runCommand === "function") {
    setInterval(() => {
      maybeAutoRestroomRebalance({ reason: "scheduled_interval" })
        .catch((error) => console.error("9:45 restroom rebalance failed:", error));
    }, RESTROOM_REBALANCE_SWEEP_MS).unref?.();
  }

  return router;
}
