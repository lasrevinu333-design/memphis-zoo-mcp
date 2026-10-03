// Private recurring-operation custody. The HTTP process is the only owner of
// the detached operation group; a child result is never sufficient to release
// a restore lease until this module proves the entire group absent.
import { fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CLEANUP_POLL_MS = 10;
const CLEANUP_RESERVE_MS = 2_000;
const MAX_INPUT_BYTES = 64 * 1024;

function custodyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function processStat(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const tail = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    return { pid, state: tail[0], groupId: Number(tail[2]), startTicks: tail[19] };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return null;
    throw error;
  }
}

function liveGroupMembers(groupId) {
  const members = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const member = processStat(Number(name));
    if (member?.groupId === groupId && member.state !== "Z" && member.state !== "X") members.push(member);
  }
  return members;
}

function groupExists(groupId) {
  try { process.kill(-groupId, 0); return true; }
  catch (error) { if (error?.code === "ESRCH") return false; throw error; }
}

function assertOriginalLeader(identity) {
  const current = processStat(identity.pid);
  if (current && current.startTicks !== identity.startTicks) throw custodyError(
    "static_weekly_operation_pid_reused", "The owned operation PID was reused; group signaling is refused.");
  if (current && current.groupId !== identity.pid) throw custodyError(
    "static_weekly_operation_group_changed", "The owned operation process-group identity changed.");
}

export function inspectRecurringOperationGroup(identity) {
  if (!Number.isSafeInteger(identity?.pid) || identity.pid <= 1 || !/^\d+$/.test(identity?.startTicks || "")) throw custodyError(
    "static_weekly_operation_identity_invalid", "The operation process identity is invalid.");
  assertOriginalLeader(identity);
  return liveGroupMembers(identity.pid);
}

export async function reapRecurringOperationGroup(identity, {
  deadlineAt,
  now = () => performance.now(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  signalGroup = (groupId) => process.kill(-groupId, "SIGKILL"),
} = {}) {
  if (!Number.isFinite(deadlineAt)) throw custodyError("static_weekly_operation_deadline_invalid", "The operation cleanup deadline is invalid.");
  let members = inspectRecurringOperationGroup(identity);
  if (members.length === 0 && !groupExists(identity.pid)) return { groupAbsent: true, memberCount: 0 };
  // Linux retains a process-group ID while any member exists. The leader's
  // original start identity is checked before every signal, including when
  // the leader has exited but inherited descendants remain.
  assertOriginalLeader(identity);
  try { signalGroup(identity.pid); }
  catch (error) { if (error?.code !== "ESRCH") throw custodyError(
    "static_weekly_operation_reap_unproven", "The exact owned operation group could not be signaled."); }
  do {
    members = inspectRecurringOperationGroup(identity);
    if (members.length === 0 && !groupExists(identity.pid)) return { groupAbsent: true, memberCount: 0 };
    if (now() >= deadlineAt) break;
    await wait(Math.min(CLEANUP_POLL_MS, Math.max(1, deadlineAt - now())));
  } while (true);
  throw custodyError("static_weekly_operation_reap_unproven", "The exact owned operation group was not absent before the original deadline.");
}

export async function runOwnedRecurringOperation({
  childFile,
  childDigest,
  sourceDigest,
  input,
  validateInput,
  validateReceipt,
  deadlineAt,
  signal = null,
  onLaunch,
  onCustody = () => {},
  now = () => performance.now(),
  observeIdentity = processStat,
  launch = (file) => fork(file, [], { detached: true, serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"] }),
  reap = reapRecurringOperationGroup,
} = {}) {
  if (!(childFile instanceof URL) || childFile.protocol !== "file:") throw custodyError(
    "static_weekly_operation_child_invalid", "The operation child must be a local module URL.");
  if (!/^[a-f0-9]{64}$/.test(childDigest || "") || createHash("sha256").update(readFileSync(fileURLToPath(childFile))).digest("hex") !== childDigest) throw custodyError(
    "static_weekly_operation_child_source_changed", "The operation child bytes differ from their pinned source digest.");
  if (!/^[a-f0-9]{64}$/.test(sourceDigest || "")) throw custodyError(
    "static_weekly_operation_source_invalid", "The operation source digest is invalid.");
  if (!Number.isFinite(deadlineAt) || deadlineAt - now() <= CLEANUP_RESERVE_MS) throw custodyError(
    "static_weekly_operation_deadline_invalid", "The original operation deadline has expired.");
  if (signal?.aborted) throw custodyError("static_weekly_operation_aborted", "The operation was aborted before launch.");
  if (typeof onLaunch !== "function") throw custodyError("static_weekly_operation_launch_recorder_missing", "A synchronous provisional launch recorder is required.");
  if (typeof validateInput !== "function" || typeof validateReceipt !== "function") throw custodyError(
    "static_weekly_operation_schema_missing", "Closed operation input and receipt validators are required.");
  const closedInput = validateInput(input);
  const serialized = JSON.stringify(closedInput);
  if (typeof serialized !== "string" || Buffer.byteLength(serialized) > MAX_INPUT_BYTES) throw custodyError(
    "static_weekly_operation_input_invalid", "The closed operation input exceeds its bounded private envelope.");

  const nonce = randomBytes(24).toString("hex");
  const candidate = launch(fileURLToPath(childFile));
  const pid = Number(candidate?.pid);
  const provisional = Object.freeze({ pid, sourceDigest, nonce, state: "provisional" });
  let childExited = false;
  let childClosed = false;
  const closed = new Promise((resolve) => candidate.once("close", () => { childClosed = true; resolve(); }));
  candidate.once("exit", () => { childExited = true; });
  try {
    const acknowledged = onLaunch(provisional);
    if (acknowledged && typeof acknowledged.then === "function") throw new Error("Provisional custody acknowledgement must be synchronous.");
  } catch {
    throw custodyError("static_weekly_operation_launch_unrecorded", "The provisional operation launch could not be recorded; no work was sent.");
  }
  // The detached PGID may not be visible at the instant fork returns. Observe
  // it for a bounded part of the original clock; never guess a group from PID.
  let stat = null;
  const identityObservationDeadline = Math.min(deadlineAt - CLEANUP_RESERVE_MS, now() + 100);
  while (Number.isSafeInteger(pid) && pid > 1 && now() < identityObservationDeadline) {
    stat = observeIdentity(pid);
    if (stat?.groupId === pid && /^\d+$/.test(stat.startTicks || "")) break;
    if (childExited || childClosed) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!stat || stat.groupId !== pid || !/^\d+$/.test(stat.startTicks || "")) {
    // A provisional PID is not signal authority. No work IPC has been sent;
    // the caller keeps its lease and the exact launch/exit facts for recovery.
    if (!childClosed) {
      try { candidate.send?.({ type: "cancel-before-work", nonce, sourceDigest }); }
      catch { /* the channel is not group signal authority */ }
      const remaining = Math.max(0, Math.floor(Math.min(deadlineAt - CLEANUP_RESERVE_MS, now() + 250) - now()));
      if (remaining > 0) await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, remaining))]);
    }
    const error = custodyError("static_weekly_operation_identity_unproven", "The launched operation group could not be identified before its original deadline.");
    error.provisional = provisional;
    error.childExited = childExited;
    error.childClosed = childClosed;
    throw error;
  }
  const identity = Object.freeze({ pid, startTicks: stat.startTicks, sourceDigest, nonce });
  // Custody is published before any work IPC, including the crash-before-ready
  // window. A caller must durably retain this exact identity until absence.
  try {
    const acknowledged = onCustody(identity);
    if (acknowledged && typeof acknowledged.then === "function") throw new Error("Custody acknowledgement must be synchronous.");
  }
  catch {
    await reap(identity, { deadlineAt, now });
    throw custodyError("static_weekly_operation_custody_unrecorded", "The owned operation identity could not be recorded.");
  }

  let timer;
  let onAbort;
  let settled = false;
  let ready = false;
  let acceptedResult = null;
  let terminalError = null;
  try {
    await new Promise((resolve, reject) => {
      const fail = (error) => { if (settled) return; settled = true; reject(error); };
      const finish = () => { if (settled) return; settled = true; resolve(); };
      onAbort = () => fail(custodyError("static_weekly_operation_aborted", "The owned operation was aborted."));
      signal?.addEventListener?.("abort", onAbort, { once: true });
      const remaining = Math.floor(deadlineAt - now() - CLEANUP_RESERVE_MS);
      if (remaining <= 0) return fail(custodyError("static_weekly_operation_deadline", "No time remains for the owned operation and cleanup."));
      timer = setTimeout(() => fail(custodyError("static_weekly_operation_deadline", "The owned operation exceeded its original deadline.")), remaining);
      candidate.on("message", (message) => {
        if (!message || message.nonce !== nonce || message.sourceDigest !== sourceDigest) return fail(custodyError(
          "static_weekly_operation_protocol_invalid", "The owned operation response did not match its source and nonce."));
        if (message.type === "ready") {
          if (ready || acceptedResult !== null) return fail(custodyError("static_weekly_operation_protocol_invalid", "Operation readiness was duplicated or followed a result."));
          ready = true;
          try { candidate.send({ type: "run", nonce, sourceDigest, input: closedInput, remainingMilliseconds: Math.max(1, Math.floor(deadlineAt - now() - CLEANUP_RESERVE_MS)) }); }
          catch { fail(custodyError("static_weekly_operation_send_failed", "The closed operation could not be sent.")); }
          return;
        }
        if (message.type !== "result" || !ready || acceptedResult !== null || !new Set(["ok", "failed", "unknown"]).has(message.status)) return fail(custodyError(
          "static_weekly_operation_protocol_invalid", "The owned operation returned an invalid typed result."));
        if (message.status === "ok" && (!message.receipt || typeof message.receipt !== "object" || Array.isArray(message.receipt))) return fail(custodyError(
          "static_weekly_operation_protocol_invalid", "The owned operation omitted its typed receipt."));
        let closedReceipt = null;
        if (message.status === "ok") {
          try { closedReceipt = validateReceipt(message.receipt); }
          catch { return fail(custodyError("static_weekly_operation_protocol_invalid", "The operation receipt failed its closed schema.")); }
        }
        acceptedResult = { status: message.status, receipt: closedReceipt };
      });
      candidate.once("error", () => fail(custodyError("static_weekly_operation_child_failed", "The owned operation child failed.")));
      candidate.once("exit", () => {
        if (acceptedResult === null) fail(custodyError("static_weekly_operation_child_exited", "The owned operation child exited without a typed result."));
        else finish();
      });
      if (signal?.aborted) onAbort();
      else {
        try { candidate.send({ type: "init", nonce, sourceDigest }); }
        catch { fail(custodyError("static_weekly_operation_send_failed", "The owned operation could not be initialized.")); }
      }
    });
  } catch (error) { terminalError = error; }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
    let cleanupError = null;
    try {
      await reap(identity, { deadlineAt, now });
      if (!childClosed) {
        const remaining = Math.max(0, Math.floor(deadlineAt - now()));
        if (remaining > 0) await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, remaining))]);
        if (!childClosed) throw custodyError("static_weekly_operation_reap_unproven", "The owned child exit and reaping were not observed before the original deadline.");
      }
    }
    catch (error) { cleanupError = error; }
    try { candidate.disconnect?.(); } catch { /* group absence, not channel state, controls the outcome */ }
    if (cleanupError) throw cleanupError;
  }
  if (terminalError) throw terminalError;
  if (acceptedResult?.status !== "ok") throw custodyError(
    acceptedResult?.status === "unknown" ? "static_weekly_operation_outcome_unknown" : "static_weekly_operation_failed",
    "The owned operation did not return an accepted receipt.");
  return { identity, receipt: acceptedResult.receipt, groupAbsent: true };
}
