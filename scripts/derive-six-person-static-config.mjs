#!/usr/bin/env node
// Candidate only. Rebalances the hash-checked six-person handout under the
// later owner workload rules without publishing or changing the phone.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const basePath = path.join(root, "config/custodial-recurring-schedule-20260924.json");
const handoutPath = path.join(root, "config/custodial-six-person-handout-20260926.json");
const outputPath = process.argv[2];
if (!outputPath) throw new Error("Usage: derive-six-person-static-config.mjs <new-config-path>");
if (fs.existsSync(outputPath)) throw new Error(`Refusing to replace candidate config: ${outputPath}`);
const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
const handout = JSON.parse(fs.readFileSync(handoutPath, "utf8"));
assert.equal(handout.sourceSha256, "a1f1dbb6826ba09ff3a81332632c0ba433ed6770e9fb48efc009382eccdfdeb1");
assert.equal(Object.keys(handout.days).length, 7);
const highs = await require("highs")({});
const result = structuredClone(base);
// Retain the accepted eligibility schema; this is a new source instance,
// not an unreviewed schema migration.
result.schema = base.schema;
result.preserveBaseDays = [];
result.overrides = {};
result.sourceHandout = { path: "config/custodial-six-person-handout-20260926.json", pdfSha256: handout.sourceSha256, precedence: "areas are a geographic seed; later fixed lunches, restrictions and workload policy control" };
result.correctionNotes = [
  "Six actual incumbents; the three stable unfilled positions receive no recurring cleaning areas.",
  "Corrected September 22 temporary handout is the area seed; later owner-fixed lunches and current weighted fairness control conflicts.",
  "No automatic daily reshuffle. Dated absences and manual CoverAll are separate manager commands.",
  "Uncoverable handoffs are explicit OPEN work, not fabricated employees or service completions."
];
const checks = [];
for (let day = 0; day < 7; day += 1) {
  result.overrides[String(day)] = {};
  for (const phase of ["morning", "equalized"]) {
    const seed = handout.days[String(day)][phase];
    const owners = Object.keys(seed).sort();
    assert.ok(owners.length >= 3 && owners.length <= 5);
    for (const owner of owners) {
      assert.equal(result.slots[owner]?.vacancy, undefined, `${owner} is not an available employee`);
      assert.ok(result.slots[owner].workDays.includes(day), `${owner} off on ${day}`);
    }
    const sourceOwner = new Map();
    for (const [owner, families] of Object.entries(seed)) for (const family of families) {
      assert.ok(!sourceOwner.has(family), `duplicate ${day}/${phase}/${family}`);
      assert.ok(Number.isFinite(result.weights[family]), `missing weight ${family}`);
      sourceOwner.set(family, owner);
    }
    const families = [...sourceOwner.keys()].sort();
    const restroom = new Set(result.publicRestroomFamilies);
    const vars = new Map();
    const all = [];
    for (let f = 0; f < families.length; f += 1) for (let o = 0; o < owners.length; o += 1) {
      const family = families[f]; const owner = owners[o];
      if (result.slots[owner].hardForbiddenFamilies?.includes(family)) continue;
      if (result.mondayOnlyFamilies.includes(family) && sourceOwner.get(family) !== owner) continue;
      const name = `x_${f}_${o}`;
      vars.set(`${family}\u0000${owner}`, name);
      all.push(name);
    }
    const expr = (terms) => terms.length ? terms.map(([coefficient, name]) => `${coefficient < 0 ? "-" : "+"} ${Math.abs(coefficient)} ${name}`).join(" ").replace(/^\+ /, "") : "0";
    const load = (owner) => families.flatMap((family) => {
      const name = vars.get(`${family}\u0000${owner}`);
      return name ? [[result.weights[family] * 2, name]] : [];
    });
    const sites = (owner) => families.flatMap((family) => {
      const name = vars.get(`${family}\u0000${owner}`);
      return name && restroom.has(family) ? [[1, name]] : [];
    });
    const constraints = [];
    families.forEach((family, index) => {
      const options = owners.map((owner) => vars.get(`${family}\u0000${owner}`)).filter(Boolean);
      assert.ok(options.length, `no eligible worker for ${day}/${phase}/${family}`);
      constraints.push(` cover_${index}: ${expr(options.map((name) => [1, name]))} = 1`);
    });
    for (let a = 0; a < owners.length; a += 1) for (let b = 0; b < owners.length; b += 1) if (a !== b) {
      const left = owners[a], right = owners[b];
      const siteTerms = [...sites(left), ...sites(right).map(([n, v]) => [-n, v])];
      constraints.push(` sites_${a}_${b}: ${expr(siteTerms)} <= 1`);
      if (phase === "equalized") {
        const loadTerms = [...load(left), ...load(right).map(([n, v]) => [-n, v])];
        constraints.push(` balance_${a}_${b}: ${expr(loadTerms)} <= 3`);
      }
    }
    if (phase === "morning") {
      const groups = new Map();
      for (const owner of owners) {
        const start = result.slots[owner].shift[0];
        groups.set(start, [...(groups.get(start) || []), owner]);
      }
      const starts = [...groups.keys()].sort();
      for (let i = 1; i < starts.length; i += 1) {
        const early = groups.get(starts[i - 1]); const late = groups.get(starts[i]);
        const terms = [
          ...early.flatMap((owner) => load(owner).map(([n, v]) => [-n * late.length, v])),
          ...late.flatMap((owner) => load(owner).map(([n, v]) => [n * early.length, v])),
        ];
        constraints.push(` ladder_${i}: ${expr(terms)} <= 0`);
      }
    }
    const primary = [];
    const primaryCost = new Map();
    for (let f = 0; f < families.length; f += 1) for (let o = 0; o < owners.length; o += 1) {
      const family = families[f], owner = owners[o], name = vars.get(`${family}\u0000${owner}`);
      if (!name) continue;
      // The primary objective is deliberately integer-valued. A sum of small
      // owner-index coefficients is NOT a unique tie-break: different swaps
      // can have the same sum while changing the source identity.
      const moved = sourceOwner.get(family) !== owner;
      const normal = result.slots[owner].normalAssignmentFamilies || [];
      const cost = (moved ? 100 : 0) + (moved && normal.length && !normal.includes(family) ? 2 : 0);
      primaryCost.set(name, cost);
      if (cost) primary.push([cost, name]);
    }
    const fixed = [];
    const solve = (objective, extra = []) => highs.solve(
      `Minimize\n obj: ${expr(objective)}\nSubject To\n${[...constraints, ...fixed, ...extra].join("\n")}\nBinary\n ${all.join(" ")}\nEnd`,
      { time_limit: 30, mip_rel_gap: 0 },
    );
    const selectedVars = (solved) => families.map((family) => {
      const selected = owners.map((owner) => vars.get(`${family}\u0000${owner}`)).filter((name) =>
        name && solved.Columns[name]?.Primal > 0.5);
      assert.equal(selected.length, 1, `${day}/${phase}/${family} must have exactly one owner`);
      return selected[0];
    });
    let solved = solve(primary);
    assert.equal(solved.Status, "Optimal", `no balanced six-person plan for ${day}/${phase}: ${solved.Status}`);
    const optimum = selectedVars(solved).reduce((sum, name) => sum + primaryCost.get(name), 0);
    fixed.push(` primary_opt: ${expr(primary)} = ${optimum}`);
    // Exact lexicographic owner-vector selection in small integer-radix
    // chunks. Fix each chunk optimum before solving the next one; this avoids
    // precision loss from one enormous exponential coefficient.
    for (let offset = 0; offset < families.length; offset += 10) {
      const chunk = families.slice(offset, offset + 10);
      const objective = chunk.flatMap((family, index) => owners.flatMap((owner, ownerIndex) => {
        const name = vars.get(`${family}\u0000${owner}`);
        const coefficient = ownerIndex * (owners.length ** (chunk.length - index - 1));
        return name && coefficient ? [[coefficient, name]] : [];
      }));
      solved = solve(objective);
      assert.equal(solved.Status, "Optimal", `lexicographic selection failed for ${day}/${phase}/${offset}: ${solved.Status}`);
      const selected = selectedVars(solved);
      const value = objective.reduce((sum, [cost, name]) => sum + (solved.Columns[name]?.Primal > 0.5 ? cost : 0), 0);
      assert.ok(Number.isSafeInteger(value));
      fixed.push(` lex_${offset}: ${expr(objective)} = ${value}`);
      assert.equal(selected.length, families.length);
    }
    const exact = selectedVars(solved);
    const alternate = solve(primary, [` no_alternate: ${expr(exact.map((name) => [1, name]))} <= ${families.length - 1}`]);
    assert.equal(alternate.Status, "Infeasible", `non-unique or unproven plan for ${day}/${phase}: ${alternate.Status}`);
    const chosen = Object.fromEntries(owners.map((owner) => [owner, []]));
    for (const family of families) {
      const selected = owners.filter((owner) => {
        const name = vars.get(`${family}\u0000${owner}`);
        return name && solved.Columns[name]?.Primal > 0.5;
      });
      assert.equal(selected.length, 1, `${day}/${phase}/${family} must have exactly one owner`);
      chosen[selected[0]].push(family);
    }
    assert.ok(owners.every((owner) => chosen[owner].length), `empty real shift ${day}/${phase}`);
    result.overrides[String(day)][phase] = chosen;
    checks.push({ day, phase, owners: owners.map((owner) => ({
      owner, weightedLoad: chosen[owner].reduce((n, family) => n + result.weights[family], 0),
      restroomSites: chosen[owner].filter((family) => restroom.has(family)).length,
      movedIn: chosen[owner].filter((family) => sourceOwner.get(family) !== owner),
      movedOut: seed[owner].filter((family) => !chosen[owner].includes(family)),
    })) });
  }
}
// The old normal geography listed each worker's smaller nine-position area.
// The owner has now selected a six-person static pattern. Expand only those
// source-specific normal lists to the exact areas this new pattern assigns;
// never alter Alijah's separate hard Herpetarium prohibition.
for (const [owner, slot] of Object.entries(result.slots)) if (slot.vacancy !== true && slot.normalAssignmentFamilies) {
  const assigned = Object.values(result.overrides).flatMap((day) => [
    ...(day.morning[owner] || []), ...(day.equalized[owner] || []),
  ]);
  slot.normalAssignmentFamilies = [...new Set([...slot.normalAssignmentFamilies, ...assigned])].sort();
}
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ outputPath, checks }, null, 2)}\n`);
