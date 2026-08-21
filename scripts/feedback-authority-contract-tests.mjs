import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  authoritativeFeedbackPayload,
  makeFeedbackSubmitAuthority,
  requestedFeedbackHub,
} from "../src/feedback-authority.js";

const employeeId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000002";
const managerId = "30000000-0000-4000-8000-000000000003";

assert.equal(requestedFeedbackHub({ body: { hub_context: " EMPLOYEE " } }), "employee");
assert.equal(requestedFeedbackHub({ body: { hub_context: "invented" } }), "public");

const employeePayload = authoritativeFeedbackPayload({
  body: { hub_context: "employee", device_id: "KIOSK_99", submitted_by: "Impostor", message: "Help" },
  memphisDeviceAuth: { credentialed: true },
  memphisDeviceCredential: { credential_id: credentialId },
  memphisDevice: {
    canonical_device_id: "KIOSK_08",
    assigned_employee_id: employeeId,
    assigned_employee_name: "Karen Robinson",
    assignment_epoch: 7,
  },
});
assert.equal(employeePayload.device_id, "KIOSK_08");
assert.equal(employeePayload.submitted_by, "Karen Robinson");
assert.deepEqual(employeePayload.identity_verification, {
  status: "verified",
  kind: "enrolled_employee_device",
  device_id: "KIOSK_08",
  credential_id: credentialId,
  employee_id: employeeId,
  assignment_epoch: 7,
});
assert.throws(
  () => authoritativeFeedbackPayload({ body: { hub_context: "employee", device_id: "KIOSK_08" } }),
  /Enrolled phone identity is required/,
);
const employeePayloadWithoutEpoch = authoritativeFeedbackPayload({
  body: { hub_context: "employee" },
  memphisDeviceAuth: { credentialed: true },
  memphisDeviceCredential: { credential_id: credentialId },
  memphisDevice: { canonical_device_id: "KIOSK_08" },
});
assert.equal(employeePayloadWithoutEpoch.identity_verification.assignment_epoch, null);

const managerPayload = authoritativeFeedbackPayload({
  body: { hub_context: "manager", submitted_by: "Impostor", device_id: "KIOSK_99" },
  memphisAuth: {
    manager_id: managerId,
    manager_display_name: "Named Manager",
    device_id: "MANAGER_01",
    credential_id: "40000000-0000-4000-8000-000000000004",
  },
});
assert.equal(managerPayload.submitted_by, "Named Manager");
assert.equal(managerPayload.device_id, "MANAGER_01");
assert.equal(managerPayload.identity_verification.manager_id, managerId);

const publicPayload = authoritativeFeedbackPayload({
  body: { hub_context: "unknown", submitted_by: "Claimed Name", device_id: "KIOSK_08" },
});
assert.equal(publicPayload.hub_context, "public");
assert.equal(publicPayload.submitted_by, null);
assert.equal(publicPayload.device_id, null);
assert.deepEqual(publicPayload.identity_verification, { status: "unverified", kind: "public_anonymous" });

let employeeMiddlewareCalls = 0;
let managerMiddlewareCalls = 0;
let nextCalls = 0;
const middleware = makeFeedbackSubmitAuthority({
  requireEmployeeDeviceCredential(req, _res, next) {
    employeeMiddlewareCalls += 1;
    req.memphisDeviceAuth = { credentialed: true };
    req.memphisDeviceCredential = { credential_id: credentialId };
    next();
  },
  requireOpsManagerAuth(_req, _res, next) { managerMiddlewareCalls += 1; next(); },
});
const response = { status() { return this; }, json() { throw new Error("unexpected rejection"); } };
middleware({ body: { hub_context: "employee" } }, response, () => { nextCalls += 1; });
middleware({ body: { hub_context: "manager" } }, response, () => { nextCalls += 1; });
middleware({ body: { hub_context: "public" } }, response, () => { nextCalls += 1; });
assert.equal(employeeMiddlewareCalls, 1);
assert.equal(managerMiddlewareCalls, 1);
assert.equal(nextCalls, 3);

let rejectedStatus = 0;
let rejectedCode = "";
makeFeedbackSubmitAuthority({
  requireEmployeeDeviceCredential(req, _res, next) {
    req.memphisDeviceAuth = { credentialed: false, legacy: true };
    next();
  },
  requireOpsManagerAuth() { throw new Error("manager middleware not expected"); },
})({ body: { hub_context: "employee" } }, {
  status(value) { rejectedStatus = value; return this; },
  json(value) { rejectedCode = value.code; },
}, () => { throw new Error("legacy employee feedback must not continue"); });
assert.equal(rejectedStatus, 401);
assert.equal(rejectedCode, "device_credential_required");

const index = readFileSync(resolve(import.meta.dirname, "../src/index.js"), "utf8");
assert.match(index, /const FEEDBACK_CONTRACT_VERSION = "feedback\.v3\.enrolled-authority"/);
assert.match(index, /app\.post\("\/feedback-api\/submit", publicSubmissionRateLimit\("feedback"\), requireFeedbackSubmitAuthority/);
assert.match(index, /\.\.\.authoritativeFeedbackPayload\(req\)/);
assert.doesNotMatch(
  index.slice(index.indexOf('app.post("/feedback-api/submit"'), index.indexOf('app.get("/guest-api/status"')),
  /\.\.\.\(req\.body/,
  "feedback persistence must not copy caller identity fields directly",
);

console.log("FEEDBACK_AUTHORITY_CONTRACT_PASS");
