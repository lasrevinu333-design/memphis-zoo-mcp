import { fork } from "node:child_process";
import { runOwnedRecurringOperation } from "./static-weekly-recurring-operation-owner.js";
import { recurringOperationSourceManifest } from "./static-weekly-recurring-operation-source.js";
import { assertClosedRecurringOperationInput, assertClosedRecurringOperationReceipt } from "./static-weekly-recurring-operation-envelope.js";

const CHILD_PATH = "src/static-weekly-recurring-operation-child.js";
const childFile = new URL("./static-weekly-recurring-operation-child.js", import.meta.url);

export function createRecurringOperationRunner({
  run = runOwnedRecurringOperation,
  sourceManifest = recurringOperationSourceManifest,
} = {}) {
  return async function runRecurring({ kind, manager, body, signal, deadlineAt, onLaunch, onCustody }) {
    const input = assertClosedRecurringOperationInput({ kind, manager: {
      manager_id: manager?.manager_id, manager_display_name: manager?.manager_display_name,
    }, body });
    const source = sourceManifest();
    const child = source.files?.find((row) => row.path === CHILD_PATH);
    if (!child || !/^[a-f0-9]{64}$/.test(child.sha256)) throw Object.assign(
      new Error("The private recurring operation child is not bound to its complete source."),
      { code: "static_weekly_operation_source_invalid" });
    const result = await run({ childFile, childDigest: child.sha256, sourceDigest: source.digest,
      input, validateInput: assertClosedRecurringOperationInput,
      validateReceipt: receipt => assertClosedRecurringOperationReceipt(receipt, input),
      launch: (file) => fork(file, [], { detached: true, serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env, STATIC_WEEKLY_RECURRING_OPERATION_CHILD: "1" } }),
      signal, deadlineAt, onLaunch, onCustody });
    if (result?.groupAbsent !== true) throw Object.assign(new Error("The recurring operation group absence was not proved."),
      { code: "static_weekly_operation_reap_unproven" });
    return result.receipt.data;
  };
}
