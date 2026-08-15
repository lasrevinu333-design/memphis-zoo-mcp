#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const workflowDirectory = resolve(root, ".github", "workflows");
const approvedActions = new Map([
  ["actions/checkout", ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"]],
  ["actions/setup-node", ["820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"]],
  ["actions/download-artifact", ["d3f86a106a0bac45b974a628896c90dbdf5c8093", "v4.3.0"]],
  ["actions/upload-artifact", ["043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "v7.0.1"]],
]);

const workflowNames = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();

function workflowJobs(source) {
  const jobsStart = source.indexOf("\njobs:\n");
  if (jobsStart === -1) return [];
  const jobsSource = source.slice(jobsStart + "\njobs:\n".length);
  return [...jobsSource.matchAll(/^  ([a-zA-Z0-9_-]+):\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:\n|(?![\s\S]))/gm)]
    .map((match) => ({ name: match[1], source: match[0] }));
}

function workflowRunSteps(jobSource) {
  const lines = jobSource.split(/\r?\n/);
  const runSteps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^( {8}run:| {6}- run:)\s*(.*)$/);
    if (!match) continue;
    const runIndent = match[1].startsWith("      -") ? 6 : 8;
    const value = match[2].trim();
    if (!/^[>|][+-]?$/.test(value)) {
      runSteps.push(value);
      continue;
    }
    const block = [];
    let next = index + 1;
    while (next < lines.length) {
      const line = lines[next];
      const indentation = line.match(/^ */)[0].length;
      if (line.trim() && indentation <= runIndent) break;
      block.push(line);
      next += 1;
    }
    runSteps.push(block.join("\n"));
    index = next - 1;
  }
  return runSteps;
}

function executableLines(script) {
  return script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function workflowCommands(source, jobName) {
  const job = workflowJobs(source).find((candidate) => candidate.name === jobName);
  assert.ok(job, `workflow job ${jobName} must exist`);
  return workflowRunSteps(job.source).flatMap((script, stepIndex) =>
    executableLines(script).map((command, lineIndex) => ({ command, stepIndex, lineIndex })),
  );
}

function assertExactCommandsInJob(source, jobName, requiredCommands, label) {
  const commands = workflowCommands(source, jobName);
  for (const requiredCommand of requiredCommands) {
    const matching = commands.filter(({ command }) => command.includes(requiredCommand));
    assert.equal(matching.length, 1, `${label} must include ${requiredCommand} exactly once`);
    assert.equal(
      matching[0].command,
      requiredCommand,
      `${label} must invoke ${requiredCommand} without bypass operators or wrappers`,
    );
  }
}

for (const name of workflowNames) {
  const source = readFileSync(resolve(workflowDirectory, name), "utf8");
  assert.doesNotMatch(source, /runs-on:\s*ubuntu-latest/, `${name} must pin its runner image`);
  if (source.includes("runs-on: ubuntu-")) {
    assert.match(source, /runs-on:\s*ubuntu-24\.04/, `${name} must use Ubuntu 24.04`);
  }
  if (source.includes("actions/setup-node")) {
    const versions = [...source.matchAll(/node-version:\s*['"]?([^'"\s]+)['"]?/g)].map((match) => match[1]);
    assert.ok(versions.length > 0, `${name} must declare a Node version`);
    assert.deepEqual([...new Set(versions)], ["22.23.1"], `${name} must use Node 22.23.1 exactly`);
  }
  for (const match of source.matchAll(/uses:\s*([^@\s#]+)@([^\s#]+)(?:\s+#\s*(v\d+(?:\.\d+){0,2}))?/g)) {
    const [, action, revision, comment] = match;
    const expected = approvedActions.get(action);
    assert.ok(expected, `${name} uses an unapproved action: ${action}`);
    assert.equal(revision, expected[0], `${name} must pin ${action} to its verified commit`);
    assert.equal(comment, expected[1], `${name} must retain the readable ${expected[1]} comment`);
  }
}

const schedulerGate = readFileSync(resolve(workflowDirectory, "foundation-security-gate.yml"), "utf8");
const packageManifest = readFileSync(resolve(root, "package.json"), "utf8");
const parsedPackageManifest = JSON.parse(packageManifest);
assert.match(schedulerGate, /^on:\n\s+pull_request:\s*\n\s+push:\s*$/m, "the scheduler authority gate must run for every pull request and every pushed branch");
assert.doesNotMatch(schedulerGate, /(?:paths|paths-ignore):/i, "the scheduler authority gate may not skip scheduler source changes by path filtering");
assert.match(schedulerGate, /npm run --silent test:static-weekly-scheduler:fast/, "the scheduler gate must retain portable/compiler/control-plane contracts");
assert.match(schedulerGate, /npm run --silent test:static-weekly-scheduler:database/, "the scheduler gate must run the disposable database authority and independent-session concurrency suites");
assert.match(schedulerGate, /docker pull supabase\/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453[\s\S]*npm run --silent test:static-weekly-scheduler:database/, "the scheduler gate must provision its digest-pinned disposable PostgreSQL image before database suites run");
assert.match(schedulerGate, /closure-toolchain-provenance\.json[\s\S]*actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/, "the scheduler gate must persist hosted-runner and database image provenance");
assert.match(schedulerGate, /npm run --silent test:integrated-backend-authority-suite-order/, "the scheduler gate must run both integrated suite orders on isolated clean databases");
assert.match(schedulerGate, /npm run --silent test:integrated-backend-authority-release-provenance/, "the scheduler gate must run integrated backend release-provenance contracts on pull requests and pushes");
assert.match(schedulerGate, /npm run --silent test:final-closure-database-isolated/, "the universal foundation gate must run the final closure database attacks on a clean disposable database");
assertExactCommandsInJob(schedulerGate, "validate", [
  "docker pull supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
  "npm run --silent test:static-weekly-scheduler:fast",
  "npm run --silent test:static-weekly-scheduler:database",
  "npm run --silent test:integrated-backend-authority-suite-order",
  "npm run --silent test:integrated-backend-authority-release-provenance",
  "npm run --silent test:final-closure-database-isolated",
  "npm run --silent test:ci-workflows",
], "foundation-security-gate.yml:validate");
assert.match(packageManifest, /"test:static-weekly-scheduler:database":\s*"[^"]*static-weekly-schedule-authority-v3-tests\.mjs[^"]*static-weekly-schedule-concurrency-tests\.mjs/, "the database scheduler command must include v3 authority and independent-session concurrency coverage");
assert.match(packageManifest, /"test:integrated-backend-authority-suite-order":\s*"node scripts\/integrated-backend-authority-suite-order-isolated-tests\.mjs"/, "the integrated suite-order command must own isolated database setup for both orders");
assert.match(packageManifest, /"test:final-closure-database-isolated":\s*"node scripts\/final-closure-database-isolated-tests\.mjs"/, "the final closure database command must own its clean disposable database");
const releaseGate = readFileSync(resolve(workflowDirectory, "integrated-release-attestation.yml"), "utf8");
assert.match(releaseGate, /test:integrated-backend-authority-cutover:database/,
  "the manual signed release gate must invoke the database-enabled cutover checker");
assert.match(releaseGate, /custodial_configure_backend_execution_key/,
  "the manual signed release gate must configure its disposable database execution boundary");
assert.ok(
  releaseGate.indexOf("custodial_configure_backend_execution_key") < releaseGate.indexOf("test:integrated-backend-authority-cutover:database"),
  "the disposable execution boundary must be configured before the signed database cutover gate",
);
assert.match(parsedPackageManifest.scripts["test:integrated-backend-authority-cutover:database"], / --database$/,
  "the signed release database command must not silently degrade to source-only acceptance");
const populatedSchemaPreflight = readFileSync(resolve(workflowDirectory, "custodial-populated-schema-preflight.yml"), "utf8");
assert.match(populatedSchemaPreflight, /test -n "\$SCHEMA_FINGERPRINT_MCP_URL"/,
  "the production schema preflight must reject a missing read-only MCP endpoint");
assert.match(populatedSchemaPreflight, /set -euo pipefail[\s\S]*release:populated-schema:preflight \| tee[\s\S]*test -s \/tmp\/custodial-populated-schema-preflight\.json/,
  "the production schema preflight must preserve command failure and require a non-empty receipt");
const productionBackupRehearsal = readFileSync(resolve(workflowDirectory, "production-backup-migration-rehearsal.yml"), "utf8");
assert.match(productionBackupRehearsal, /RESTORE_DATABASE_ONLY=true[\s\S]*release:populated-schema:preflight/,
  "the production-backup rehearsal must restore data before checking the exact live source fingerprint");
assert.match(productionBackupRehearsal, /cron\.database_name="\$database"/,
  "the production-backup rehearsal must bind pg_cron to its isolated restored database");
assert.match(productionBackupRehearsal, /-p 127\.0\.0\.1::5432[\s\S]*listen_addresses='\*'[\s\S]*SUPABASE_DB_URL="postgresql:\/\/supabase_admin:postgres@127\.0\.0\.1:/,
  "the production-backup rehearsal must expose Postgres only on runner loopback while making the mapped container interface reachable");
assert.match(productionBackupRehearsal, /State\.Health[\s\S]*test "\$healthy" = 'true'[\s\S]*sleep 10[\s\S]*createdb/,
  "the production-backup rehearsal must survive the Supabase image's first-boot restart before creating its database");
assert.match(productionBackupRehearsal, /oom_killed=\{\{\.State\.OOMKilled\}\}[\s\S]*docker logs --timestamps --tail 2000[\s\S]*production-backup-migration-rehearsal-postgres\.log/,
  "the production-backup rehearsal must retain bounded Postgres failure evidence instead of retrying blind");
assert.equal((productionBackupRehearsal.match(/202608\d+_[a-z0-9_]+\.sql/g) || []).filter((name, index, values) => values.indexOf(name) === index).length, 23,
  "the production-backup rehearsal must apply the exact 23 pending migrations");
assert.match(productionBackupRehearsal, /custodial_configure_backend_execution_key[\s\S]*custodial_configure_native_route_proof_key[\s\S]*custodial_backend_authority_health/,
  "the production-backup rehearsal must configure both secret boundaries and prove final authority health");
assert.match(productionBackupRehearsal, /set role service_role; truncate public\.sessions/,
  "the production-backup rehearsal must attack direct terminal DML after migration");

const workflowFixture = (commands) => `name: fixture\njobs:\n  validate:\n    steps:\n      - run: |\n${commands.map((command) => `          ${command}`).join("\n")}\n`;
assert.doesNotThrow(() => assertExactCommandsInJob(
  workflowFixture([
    "docker pull supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
    "npm run --silent test:integrated-backend-authority-release-provenance",
  ]),
  "validate",
  [
    "docker pull supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
    "npm run --silent test:integrated-backend-authority-release-provenance",
  ],
  "fixture.yml:validate",
));
assert.throws(() => assertExactCommandsInJob(
  workflowFixture(["npm run --silent test:integrated-backend-authority-release-provenance || true"]),
  "validate",
  ["npm run --silent test:integrated-backend-authority-release-provenance"],
  "fixture.yml:validate",
), /without bypass operators or wrappers/);

console.log(JSON.stringify({ ok: true, workflows_checked: workflowNames.length }, null, 2));
