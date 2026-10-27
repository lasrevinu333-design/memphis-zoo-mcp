#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { deriveRecurringStaffingPattern, fullPositionOwnerMap } from "../src/static-weekly-recurring-staffing-adaptation.js";

const require = createRequire(import.meta.url);
const highs = await require("highs")({});
const root = path.resolve(import.meta.dirname, "..");
const six = JSON.parse(fs.readFileSync(path.join(root, "config/custodial-six-person-static-20260926.json")));
const full = JSON.parse(fs.readFileSync(path.join(root, "config/custodial-recurring-schedule-20260924.json")));
const base = JSON.parse(fs.readFileSync(full.basePacket.path));
const fullOwners = fullPositionOwnerMap(full, base);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "custodial-static-adapt-"));
const options = ["OPTION1", "OPTION2", "OPTION4"];
const result = [];
try {
  const counts = process.env.STATIC_WEEKLY_ADAPTATION_COUNTS
    ? process.env.STATIC_WEEKLY_ADAPTATION_COUNTS.split(",").map(Number) : [7, 8, 9];
  assert.ok(counts.length && counts.every((count) => [7,8,9,98].includes(count)));
  for (const count of counts) {
    const targetSlots = structuredClone(six.slots);
    for (let i = 0; i < (count === 98 ? 3 : count - 6); i += 1) {
      const key = options[i];
      const personId = `12345678-1234-4234-8234-123456789ab${i + 1}`;
      const name = `Synthetic New Hire ${i + 1}`;
      targetSlots[key].vacancy = false;
      targetSlots[key].personId = personId;
      targetSlots[key].name = name;
      targetSlots[key].history = [...(targetSlots[key].history || []),
        { personId, name, start: "2026-09-28", end: null }];
    }
    const currentConfig = count === 98
      ? deriveRecurringStaffingPattern({ currentConfig: six, targetSlots,
        fullOwners, fullConfig: full, highs }).config : six;
    if (count === 98) {
      currentConfig.effectiveDate = "2026-10-05";
      Object.assign(targetSlots, structuredClone(currentConfig.slots));
      targetSlots.OPTION2.vacancy = true;
      targetSlots.OPTION2.personId = null;
      targetSlots.OPTION2.name = null;
      targetSlots.OPTION2.history.at(-1).end = "2026-10-04";
    }
    const adapted = deriveRecurringStaffingPattern({ currentConfig, targetSlots,
      fullOwners, fullConfig: full, highs });
    const configPath = path.join(temporary, `staffed-${count}.json`);
    const outputPath = path.join(temporary, `packet-${count}.json`);
    fs.writeFileSync(configPath, `${JSON.stringify(adapted.config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const generated = spawnSync(process.execPath,
      [path.join(root, "scripts/generate-owner-corrected-static-weekly-schedule.mjs"), outputPath],
      { cwd: root, env: { ...process.env, STATIC_WEEKLY_OWNER_CONFIG_PATH: configPath },
        encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(generated.status, 0, `staffed ${count} compiler: ${generated.stderr || generated.stdout}`);
    const packet = JSON.parse(fs.readFileSync(outputPath));
    const staffed = count === 98 ? 8 : count;
    assert.equal(packet.verification.staffedPositions, staffed);
    assert.equal(packet.verification.vacantPositions, 9 - staffed);
    assert.equal(packet.verification.verifierOk, true);
    assert.equal(packet.verification.productionWritten, false);
    assert.equal(packet.rosterSlots.filter((row) => row.personId).length, staffed);
    assert.equal(packet.rosterSlots.some((row) => row.displayName === "Maurice Stanton" || row.displayName === "Tabitha Masterson"), false);
    if (count === 9) assert.deepEqual(adapted.config.overrides, full.overrides,
      "nine-person candidate must use exact full-staff overrides");
    result.push({ staffed, transition: count === 98 ? "nine-to-eight" : "six-to-target",
      assignments: packet.compilerInput.version.assignments.length,
      sourceDigest: packet.sourceDigest, openWork: packet.verification.shiftEndDerivation.parentChains
        .flatMap((chain) => chain.segments).filter((segment) => segment.kind === "open").length });
  }
  console.log(JSON.stringify({ status: "PASS", candidates: result,
    productionWritten: false, protectedWorkTransition: "NOT IMPLEMENTED" }));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
