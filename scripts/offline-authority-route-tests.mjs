#!/usr/bin/env node

import assert from "node:assert/strict";
import { authorityHttpFailure, rpcFailure, sqlStateHttpStatus } from "../src/offline-authority-http.js";

for (const [state, expected] of [
  ["42501", 403], ["P0002", 404], ["22023", 422], ["23505", 409], ["40001", 503], ["XX000", 500],
]) assert.equal(sqlStateHttpStatus(state), expected, `${state} maps to its truthful HTTP class`);

const conflict = rpcFailure({ code: "23505", message: "same key" }, "authoritative_commit");
assert.equal(conflict.status, 409);
assert.equal(conflict.code, "23505");
const retry = authorityHttpFailure(rpcFailure({ code: "40001", message: "retry" }, "authoritative_commit"), "fallback");
assert.deepEqual(retry, { status: 503, body: { ok: false, error: "retry", code: "40001", retryable: true } });
const invalid = authorityHttpFailure(rpcFailure({ code: "22023", message: "invalid payload" }, "authoritative_commit"), "fallback");
assert.equal(invalid.status, 422);
assert.equal(invalid.body.retryable, false);
console.log("OFFLINE_AUTHORITY_ROUTE_STATUS_PASS");
