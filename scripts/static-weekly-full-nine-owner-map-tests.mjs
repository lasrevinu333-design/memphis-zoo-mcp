#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fullPositionOwnerMap } from "../src/static-weekly-recurring-staffing-adaptation.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fullBytes = fs.readFileSync(new URL("../config/custodial-recurring-schedule-20260924.json", import.meta.url));
const full = JSON.parse(fullBytes);
const frozen = JSON.parse(fs.readFileSync(new URL("../config/custodial-full-nine-family-owners-20260926.json", import.meta.url)));
const baseBytes = fs.readFileSync(full.basePacket.path);
assert.equal(frozen.schema, "custodial.full-position-owner-map.v1");
assert.equal(hash(fullBytes), frozen.fullConfigSha256);
assert.equal(hash(baseBytes), frozen.basePacketSha256);
assert.equal(hash(baseBytes), full.basePacket.sha256);
const basePacket = JSON.parse(baseBytes);
assert.equal(frozen.baseSourceId, basePacket.sourceId);
assert.equal(frozen.baseSourceDigest, basePacket.sourceDigest);
assert.deepEqual(frozen.owners, fullPositionOwnerMap(full, basePacket));
assert.deepEqual(Object.keys(frozen.owners), ["0","1","2","3","4","5","6"]);
console.log(JSON.stringify({ status: "PASS", checks: 8, mapSha256: hash(fs.readFileSync(
  new URL("../config/custodial-full-nine-family-owners-20260926.json", import.meta.url))),
  basePacketSha256: frozen.basePacketSha256, localBasePacketRequiredToReprove: true,
  runtimeMapRequiresLocalBasePacket: false, productionWritten: false }));
