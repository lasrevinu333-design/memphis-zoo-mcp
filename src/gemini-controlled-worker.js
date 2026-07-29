import { randomUUID } from "node:crypto";

const TERMINAL_STATUSES = new Set(["completed", "failed", "rolled_back", "blocked", "cancelled"]);

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback));
}

function cleanEvidence(value) {
  return Array.isArray(value) ? value.slice(0, 500) : [];
}

function cleanResult(value = {}) {
  const status = TERMINAL_STATUSES.has(String(value.status || "")) ? String(value.status) : (value.ok ? "completed" : "failed");
  return {
    status,
    branch_name: String(value.branch_name || "").trim().slice(0, 500) || null,
    changed_files: cleanEvidence(value.changed_files),
    test_evidence: cleanEvidence(value.test_evidence),
    migration_evidence: cleanEvidence(value.migration_evidence),
    deployment_evidence: cleanEvidence(value.deployment_evidence),
    verification_evidence: cleanEvidence(value.verification_evidence),
    rollback_evidence: cleanEvidence(value.rollback_evidence),
    error_code: String(value.error_code || "").trim().slice(0, 80) || null,
    error_message: String(value.error_message || "").trim().slice(0, 1000) || null,
  };
}

async function readJson(response, label) {
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`${label} returned malformed JSON.`); }
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}.`);
  return parsed;
}

export function createGeminiControlledRepairWorker({
  supabase,
  workerUrl = process.env.GEMINI_CONTROLLED_REPAIR_WORKER_URL,
  workerToken = process.env.GEMINI_CONTROLLED_REPAIR_WORKER_TOKEN,
  releaseId = "unknown",
  backendCommit = "unknown",
  fetchImpl = fetch,
  sweepMs = process.env.GEMINI_CONTROLLED_REPAIR_SWEEP_MS,
  leaseSeconds = process.env.GEMINI_CONTROLLED_REPAIR_LEASE_SECONDS,
} = {}) {
  const baseUrl = String(workerUrl || "").trim().replace(/\/+$/, "");
  const token = String(workerToken || "").trim();
  const enabled = Boolean(supabase && /^https:\/\//i.test(baseUrl) && token.length >= 24);
  const workerId = `gemini-controlled-${process.pid}-${randomUUID()}`;
  const intervalMs = boundedInt(sweepMs, 15_000, 5_000, 300_000);
  const requestedLeaseSeconds = boundedInt(leaseSeconds, 300, 60, 1800);
  let inFlight = false;
  let timer = null;

  async function rpc(name, args) {
    const result = await supabase.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  }

  async function heartbeat(available = enabled) {
    if (!supabase) return null;
    return rpc("gemini_console_worker_heartbeat", {
      p_worker_id: workerId,
      p_available: Boolean(available),
      p_capabilities: {
        protocol: "gemini-controlled-repair.v1",
        backup_before_execute: true,
        leased_claims: true,
        terminal_evidence: true,
      },
      p_release_id: releaseId,
      p_backend_commit: backendCommit,
    });
  }

  async function request(path, job, extra = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `${job.repair_job_id}:${path}`,
      },
      body: JSON.stringify({
        protocol: "gemini-controlled-repair.v1",
        repair_job_id: job.repair_job_id,
        proposal_id: job.proposal_id,
        affected_components: job.affected_components || [],
        starting_backend_commit: job.starting_backend_commit,
        starting_frontend_commit: job.starting_frontend_commit,
        starting_schema_fingerprint: job.starting_schema_fingerprint,
        release_id: job.release_id,
        attempt_count: job.attempt_count,
        ...extra,
      }),
      signal: AbortSignal.timeout(25 * 60 * 1000),
    });
    return readJson(response, `Controlled repair ${path}`);
  }

  async function finish(job, result) {
    const normalized = cleanResult(result);
    return rpc("gemini_console_finish_repair_job", {
      p_repair_job_id: job.repair_job_id,
      p_lease_token: job.lease_token,
      p_status: normalized.status,
      p_branch_name: normalized.branch_name,
      p_changed_files: normalized.changed_files,
      p_test_evidence: normalized.test_evidence,
      p_migration_evidence: normalized.migration_evidence,
      p_deployment_evidence: normalized.deployment_evidence,
      p_verification_evidence: normalized.verification_evidence,
      p_rollback_evidence: normalized.rollback_evidence,
      p_error_code: normalized.error_code,
      p_error_message: normalized.error_message,
    });
  }

  async function processJob(job) {
    let backupReference = "";
    try {
      const backup = await request("/v1/repairs/backup", job);
      backupReference = String(backup.backup_reference || "").trim();
      if (!backup.ok || !backupReference) throw new Error("Controlled worker did not return a durable backup reference.");
      await rpc("gemini_console_record_repair_backup", {
        p_repair_job_id: job.repair_job_id,
        p_lease_token: job.lease_token,
        p_backup_reference: backupReference,
        p_backup_evidence: backup.evidence || { verified: true },
      });
      const result = await request("/v1/repairs/execute", job, { backup_reference: backupReference });
      return finish(job, result);
    } catch (error) {
      const failure = {
        p_repair_job_id: job.repair_job_id,
        p_lease_token: job.lease_token,
        p_error_code: "controlled_worker_failed",
        p_error_message: String(error?.message || "Controlled repair failed."),
        p_rollback_evidence: backupReference
          ? [{ kind: "backup_reference_preserved", reference: backupReference, result: "available_for_manual_rollback" }]
          : [{ kind: "repair_not_started", result: "backup_gate_failed" }],
      };
      return rpc("gemini_console_fail_repair_job", failure).catch(() => null);
    }
  }

  async function sweep() {
    if (!enabled) return { ok: false, disabled: true };
    if (inFlight) return { ok: true, skipped: "in_flight" };
    inFlight = true;
    try {
      await heartbeat(true);
      const claimed = await rpc("gemini_console_claim_repair_jobs", {
        p_worker_id: workerId,
        p_limit: 1,
        p_lease_seconds: requestedLeaseSeconds,
      });
      const jobs = Array.isArray(claimed) ? claimed : (claimed ? [claimed] : []);
      for (const job of jobs) await processJob(job);
      return { ok: true, claimed: jobs.length };
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (!enabled || timer) return { enabled, worker_id: workerId };
    void sweep().catch(() => {});
    timer = setInterval(() => void sweep().catch(() => {}), intervalMs);
    timer.unref?.();
    return { enabled, worker_id: workerId };
  }

  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (enabled) await heartbeat(false).catch(() => {});
  }

  return { enabled, workerId, heartbeat, processJob, start, stop, sweep };
}
