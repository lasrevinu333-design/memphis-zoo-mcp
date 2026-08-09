#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

export const MANAGER_INSPECTION_QUERY = `
select
  ci.id,
  ci.operation_id,
  ci.inspector_manager_id,
  ci.inspector_name_snapshot,
  ci.inspection_type,
  ci.overall_score,
  ci.passed,
  ci.follow_up_required,
  ci.session_id,
  ci.location_id,
  ci.employee_id,
  ci.session_started_at,
  ci.session_ended_at,
  ci.inspected_at,
  ci.created_at,
  s.status as session_status,
  s.location_id as current_session_location_id,
  s.employee_id as current_session_employee_id,
  m.display_name as current_manager_name,
  m.active as manager_active,
  m.revoked_at as manager_revoked_at,
  m.is_system_principal
from public.cleaning_inspections ci
left join public.sessions s on s.id=ci.session_id
left join public.ops_manager_managers m on m.manager_id=ci.inspector_manager_id
where ci.created_at >= $1::timestamptz - interval '1 day'
order by ci.created_at desc
limit 100
`;

export const HUMAN_CONFIRMATION_REQUIREMENT =
  "A manager must confirm that the accepted database record represents an inspection they physically performed on the linked post-repair cleaning session; automation cannot independently prove the physical act.";
export const INSPECTION_FRESHNESS_WINDOW_HOURS = 24;
const INSPECTION_FRESHNESS_WINDOW_MS = INSPECTION_FRESHNESS_WINDOW_HOURS * 60 * 60 * 1000;

const GENERIC_OR_TEST_IDENTITY = /(?:^custodial manager$|\btest\b|\bfixture\b|\bdemo\b|\bsample\b|\bmock\b)/i;

function timestamp(value) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function sameId(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

export function evaluateManagerInspectionReadiness(rows, {
  notBefore,
  nowMs = Date.now(),
  futureSkewMinutes = 5,
} = {}) {
  const notBeforeMs = timestamp(notBefore);
  if (!Number.isFinite(notBeforeMs)) throw new Error("notBefore must be a valid timestamp");
  if (!Number.isFinite(futureSkewMinutes) || futureSkewMinutes < 0) {
    throw new Error("futureSkewMinutes must be zero or positive");
  }
  const futureLimitMs = nowMs + futureSkewMinutes * 60_000;
  const candidates = rows.map((row) => {
    const gaps = [];
    const inspectorName = String(row.inspector_name_snapshot || "").trim();
    const inspectedAtMs = timestamp(row.inspected_at);
    const createdAtMs = timestamp(row.created_at);
    const sessionEndedAtMs = timestamp(row.session_ended_at);

    if (!row.id || !row.operation_id) gaps.push("durable inspection identity is missing");
    if (!row.inspector_manager_id) gaps.push("named manager identity is missing");
    if (!inspectorName) gaps.push("manager name snapshot is blank");
    else if (GENERIC_OR_TEST_IDENTITY.test(inspectorName)) gaps.push("manager name is generic or test-like");
    if (!row.current_manager_name) gaps.push("manager directory record is missing");
    if (row.manager_active !== true) gaps.push("manager is not currently active");
    if (row.manager_revoked_at) gaps.push("manager authority is revoked");
    if (row.is_system_principal === true) gaps.push("system principals cannot perform the acceptance inspection");
    if (!row.session_id || !["pending_submit", "closed"].includes(row.session_status)) {
      gaps.push("linked cleaning session is not completed");
    }
    if (!row.session_ended_at) gaps.push("linked cleaning session has no completion timestamp");
    else if (!Number.isFinite(sessionEndedAtMs) || sessionEndedAtMs < notBeforeMs) {
      gaps.push("linked cleaning session predates the acceptance window");
    }
    if (!sameId(row.location_id, row.current_session_location_id)) gaps.push("inspection location does not match the session");
    if (!sameId(row.employee_id, row.current_session_employee_id)) gaps.push("inspection employee does not match the session");
    if (!Number.isFinite(createdAtMs) || createdAtMs < notBeforeMs) gaps.push("inspection record predates the acceptance window");
    if (!Number.isFinite(inspectedAtMs) || inspectedAtMs < notBeforeMs) gaps.push("inspection act predates the acceptance window");
    if (Number.isFinite(inspectedAtMs) && Number.isFinite(sessionEndedAtMs) && inspectedAtMs < sessionEndedAtMs) {
      gaps.push("inspection timestamp predates session completion");
    }
    if (Number.isFinite(inspectedAtMs) && Number.isFinite(sessionEndedAtMs)
      && inspectedAtMs - sessionEndedAtMs > INSPECTION_FRESHNESS_WINDOW_MS) {
      gaps.push("inspection occurred more than 24 hours after session completion");
    }
    if (Number.isFinite(createdAtMs) && Number.isFinite(sessionEndedAtMs)
      && createdAtMs - sessionEndedAtMs > INSPECTION_FRESHNESS_WINDOW_MS) {
      gaps.push("inspection record was created more than 24 hours after session completion");
    }
    if ((Number.isFinite(createdAtMs) && createdAtMs > futureLimitMs)
      || (Number.isFinite(inspectedAtMs) && inspectedAtMs > futureLimitMs)) {
      gaps.push("inspection timestamp is implausibly in the future");
    }

    return {
      inspection_id: row.id || null,
      eligible_database_evidence: gaps.length === 0,
      gaps,
      evidence: {
        operation_id: row.operation_id || null,
        inspector_manager_id: row.inspector_manager_id || null,
        inspector_name: inspectorName || null,
        current_manager_name: row.current_manager_name || null,
        inspection_type: row.inspection_type || null,
        overall_score: row.overall_score == null ? null : Number(row.overall_score),
        passed: row.passed == null ? null : Boolean(row.passed),
        follow_up_required: row.follow_up_required == null ? null : Boolean(row.follow_up_required),
        session_id: row.session_id || null,
        session_status: row.session_status || null,
        location_id: row.location_id || null,
        employee_id: row.employee_id || null,
        session_ended_at: row.session_ended_at || null,
        inspected_at: row.inspected_at || null,
        created_at: row.created_at || null,
      },
    };
  });
  const accepted = candidates.find((candidate) => candidate.eligible_database_evidence) || null;
  return {
    ok: Boolean(accepted),
    scope: "manager_inspection_database_evidence",
    evaluated_at: new Date(nowMs).toISOString(),
    acceptance_window_started_at: new Date(notBeforeMs).toISOString(),
    eligible_inspection_count: candidates.filter((candidate) => candidate.eligible_database_evidence).length,
    candidate_count: candidates.length,
    accepted_inspection: accepted,
    candidates,
    human_confirmation_required: HUMAN_CONFIRMATION_REQUIREMENT,
  };
}

async function main() {
  const databaseUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  const databaseCaCertPath = String(process.env.SUPABASE_DB_CA_CERT_PATH || "").trim();
  const notBefore = String(process.env.MANAGER_INSPECTION_NOT_BEFORE || "").trim();
  const enforce = String(process.env.MANAGER_INSPECTION_ENFORCE || "false").toLowerCase() === "true";
  if (!databaseUrl) throw new Error("SUPABASE_DB_URL or DATABASE_URL is required");
  if (!Number.isFinite(timestamp(notBefore))) throw new Error("MANAGER_INSPECTION_NOT_BEFORE must be a valid timestamp");

  const client = new Client({
    connectionString: databaseUrl,
    application_name: "memphis-zoo-manager-inspection-readiness-monitor",
    ...(databaseCaCertPath ? {
      ssl: { ca: readFileSync(resolve(databaseCaCertPath), "utf8"), rejectUnauthorized: true },
    } : {}),
  });
  await client.connect();
  try {
    await client.query("begin read only");
    await client.query("set local statement_timeout = '10s'");
    const result = await client.query(MANAGER_INSPECTION_QUERY, [notBefore]);
    await client.query("commit");
    const report = evaluateManagerInspectionReadiness(result.rows, { notBefore });
    console.log(JSON.stringify(report, null, 2));
    if (enforce && !report.ok) process.exitCode = 1;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
if (isMain) await main();
