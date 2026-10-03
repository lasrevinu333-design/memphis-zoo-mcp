#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const workflowDirectory = resolve(root, ".github", "workflows");
const releaseMigrationState = JSON.parse(readFileSync(resolve(root, "release", "production-migration-state.json"), "utf8"));
const expectedProductionSource = releaseMigrationState.observed_production;
const expectedProductionTarget = releaseMigrationState.target;
const releaseStatePath = resolve(root, "release", "production-migration-state.json");
const approvedActions = new Map([
  ["actions/checkout", ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"]],
  ["actions/setup-node", ["820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"]],
  ["actions/download-artifact", ["d3f86a106a0bac45b974a628896c90dbdf5c8093", "v4.3.0"]],
  ["actions/upload-artifact", ["043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "v7.0.1"]],
]);

const workflowNames = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();
const rehearsalPostgresImage = "supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed";
const postgresPinSources = [
  ...workflowNames.map((name) => resolve(workflowDirectory, name)),
  ...readdirSync(resolve(root, "scripts"))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => resolve(root, "scripts", name)),
];
const postgresImagePins = postgresPinSources.flatMap((path) =>
  [...readFileSync(path, "utf8").matchAll(/supabase\/postgres@sha256:[0-9a-f]{64}/g)]
    .map((match) => match[0]),
);
assert.ok(postgresImagePins.length > 0, "the repository must retain an immutable rehearsal PostgreSQL image pin");
assert.deepEqual(
  [...new Set(postgresImagePins)],
  [rehearsalPostgresImage],
  "every backup, rehearsal, and disposable database path must use the extension-compatible PostgreSQL image",
);

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
assert.match(schedulerGate, /docker pull supabase\/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed[\s\S]*npm run --silent test:static-weekly-scheduler:database/, "the scheduler gate must provision its digest-pinned disposable PostgreSQL image before database suites run");
assert.match(schedulerGate, /closure-toolchain-provenance\.json[\s\S]*actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/, "the scheduler gate must persist hosted-runner and database image provenance");
assert.match(schedulerGate, /npm run --silent test:integrated-backend-authority-suite-order/, "the scheduler gate must run both integrated suite orders on isolated clean databases");
assert.match(schedulerGate, /npm run --silent test:integrated-backend-authority-release-provenance/, "the scheduler gate must run integrated backend release-provenance contracts on pull requests and pushes");
assert.match(schedulerGate, /npm run --silent test:final-closure-database-isolated/, "the universal foundation gate must run the final closure database attacks on a clean disposable database");
assert.match(schedulerGate, /npm run --silent test:release-migration-authorization[\s\S]*npm run --silent test:release-migration-plan-db-isolated/,
  "the universal foundation gate must run both release migration provenance modes and their disposable atomic database plan");
assert.match(schedulerGate, /npm run --silent test:isolated-restore-lease-shim/, "the universal foundation gate must retain pre-migration isolated restore compatibility coverage");
assertExactCommandsInJob(schedulerGate, "validate", [
  "docker pull supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed",
  "npm run --silent test:static-weekly-scheduler:fast",
  "npm run --silent test:static-weekly-scheduler:database",
  "npm run --silent test:integrated-backend-authority-suite-order",
  "npm run --silent test:integrated-backend-authority-release-provenance",
  "npm run --silent test:final-closure-database-isolated",
  "npm run --silent test:ci-workflows",
  "npm run --silent test:release-migration-authorization",
  "npm run --silent test:release-migration-plan-db-isolated",
], "foundation-security-gate.yml:validate");
assert.match(packageManifest, /"test:static-weekly-scheduler:database":\s*"[^"]*static-weekly-schedule-authority-v3-tests\.mjs[^"]*static-weekly-schedule-concurrency-tests\.mjs/, "the database scheduler command must include v3 authority and independent-session concurrency coverage");
assert.match(packageManifest, /"test:integrated-backend-authority-suite-order":\s*"node scripts\/integrated-backend-authority-suite-order-isolated-tests\.mjs"/, "the integrated suite-order command must own isolated database setup for both orders");
assert.match(packageManifest, /"test:final-closure-database-isolated":\s*"node scripts\/final-closure-database-isolated-tests\.mjs"/, "the final closure database command must own its clean disposable database");
assert.equal(parsedPackageManifest.scripts["test:release-migration-plan-db-isolated"],
  "bash scripts/release-migration-plan-database-isolated-tests.sh",
  "the release migration database regression must own one disposable database container");
assert.equal(parsedPackageManifest.scripts["test:release-migration-plan-db"],
  parsedPackageManifest.scripts["test:release-migration-plan-db-isolated"],
  "the raw release migration database command must not bypass the owned disposable wrapper");
const releaseGate = readFileSync(resolve(workflowDirectory, "integrated-release-attestation.yml"), "utf8");
assert.match(releaseGate, /test:integrated-backend-authority-cutover:database/,
  "the manual signed release gate must invoke the database-enabled cutover checker");
assert.match(releaseGate, /custodial_configure_backend_execution_key/,
  "the manual signed release gate must configure its disposable database execution boundary");
assert.match(releaseGate, /custodial_configure_native_route_proof_key/,
  "the manual signed release gate must configure its disposable native route boundary");
assert.ok(
  releaseGate.indexOf("custodial_configure_backend_execution_key") < releaseGate.indexOf("custodial_configure_native_route_proof_key")
    && releaseGate.indexOf("custodial_configure_native_route_proof_key") < releaseGate.indexOf("test:integrated-backend-authority-cutover:database"),
  "both disposable proof boundaries must be configured before the signed database cutover gate",
);
assert.match(parsedPackageManifest.scripts["test:integrated-backend-authority-cutover:database"], / --database$/,
  "the signed release database command must not silently degrade to source-only acceptance");
const productionRepairGate = readFileSync(resolve(workflowDirectory, "custodial-production-repair.yml"), "utf8");
const reviewedNode = "/opt/hostedtoolcache/node/22.23.1/x64/bin/node";
const reviewedEntrypoints = ["scripts/legacy-activation-http-tests.mjs",
  "scripts/release-pair-consumer-regression-tests.mjs", "scripts/run-isolated-release-recorder-tests.mjs"];
const reviewedRegressionCommand = reviewedEntrypoints.map(path => `${reviewedNode} ${path}`).join(" && ");
const reviewedInputPaths = ["package.json", "package-lock.json", "scripts/legacy-activation-http-tests.mjs",
  "scripts/release-pair-consumer-regression-tests.mjs", "scripts/run-isolated-release-recorder-tests.mjs",
  "scripts/production-release-recorder-database-tests.mjs", "scripts/fixtures/exact-frontend-pair.mjs"];
const reviewedInputChecks = reviewedInputPaths.map(path =>
  `          ${createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")}  ${path}`);
const reviewedCleanShell = "        shell: /usr/bin/env -i HOME=/home/runner PATH=/opt/hostedtoolcache/node/22.23.1/x64/bin:/usr/bin:/bin /bin/bash --noprofile --norc -e -o pipefail {0}";
function assertReviewedRegressionGate(source, jobName, label) {
  // Deliberately accept only these canonical column-zero mappings across the
  // ENTIRE document. Reject alternate YAML spellings/tags/aliases/duplicates
  // rather than trying to interpret a security-sensitive subset with regex.
  const rootLines = source.split(/\r?\n/).filter(line => line && !line.startsWith(" ") && !line.startsWith("#"));
  assert.deepEqual(rootLines.map(line => {
    const canonical = line.match(/^(name|on|permissions|concurrency|jobs):(?:[ \t].*)?$/);
    assert.ok(canonical, `${label} rejects noncanonical or unapproved root metadata anywhere`);
    return canonical[1];
  }), ["name", "on", "permissions", "concurrency", "jobs"],
  `${label} requires the complete canonical root mapping with no duplicates or trailing overrides`);
  assertExactCommandsInJob(source, jobName, [reviewedRegressionCommand], label);
  const jobs = workflowJobs(source).filter(job => job.name === jobName);
  assert.equal(jobs.length, 1, `${label} must own exactly one canonical job`);
  const jobsBody = source.slice(source.indexOf("\njobs:\n") + "\njobs:\n".length);
  assert.deepEqual(jobsBody.split(/\r?\n/).filter(line => /^  [^ ]/.test(line)),
    [`  ${jobName}:`], `${label} requires its sole canonical job mapping without aliases or explicit duplicate keys`);
  const job = jobs[0].source;
  // This gate intentionally accepts only the repository's canonical block YAML.
  // New job metadata must receive explicit review, not silently alter execution.
  // Check EVERY exact job-indentation line, including after steps. Looking only
  // for key: silently ignores YAML's standard '? key' / ': value' syntax.
  assert.deepEqual(job.split(/\r?\n/).filter(line => /^    [^ ]/.test(line)),
    ["    runs-on: ubuntu-24.04", `    timeout-minutes: ${jobName === "validate" ? 35 : 45}`, "    steps:"],
    `${label} requires the complete canonical job metadata, with no trailing/explicit/merged/duplicate keys`);
  assert.equal(job.slice(0, job.indexOf("    steps:\n") + "    steps:\n".length),
    `  ${jobName}:\n    runs-on: ubuntu-24.04\n    timeout-minutes: ${jobName === "validate" ? 35 : 45}\n    steps:\n`,
    `${label} must retain its exact unconditional runner/job header`);
  const steps = [...job.matchAll(/^      - [\s\S]*?(?=^      - |^    \S|(?![\s\S]))/gm)]
    .map(match => match[0].trimEnd());
  const owningSteps = steps.filter(step => step.includes(reviewedRegressionCommand));
  assert.deepEqual(steps.slice(0, 3), [
    "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n        with:\n          node-version: '22.23.1'\n          cache: npm",
    "      - name: Install exact dependencies\n        run: npm ci --ignore-scripts",
  ], `${label} requires the exact reviewed preparation; no arbitrary predecessor may mutate execution state`);
  assert.equal(steps[3], owningSteps[0], `${label} must execute reviewed regressions immediately after installation`);
  assert.deepEqual(owningSteps, [[
    "      - name: Reviewed phone, pair, and isolated recorder regressions",
    reviewedCleanShell,
    "        run: |",
    "          set -euo pipefail",
    `          docker pull ${rehearsalPostgresImage}`,
    "          /usr/bin/sha256sum --check --strict <<'REVIEWED_INPUTS'",
    ...reviewedInputChecks,
    "          REVIEWED_INPUTS",
    `          ${reviewedRegressionCommand}`,
  ].join("\n")], `${label} requires the exact dedicated fail-fast step, including image provision; no skip, exit, heredoc or shell wrapper`);
}
assertReviewedRegressionGate(schedulerGate, "validate", "foundation-security-gate.yml:validate");
assertReviewedRegressionGate(productionRepairGate, "backend", "custodial-production-repair.yml:backend");
assert.equal(parsedPackageManifest.scripts["test:reviewed-source-regressions"],
  "node scripts/legacy-activation-http-tests.mjs && node scripts/release-pair-consumer-regression-tests.mjs && node scripts/run-isolated-release-recorder-tests.mjs",
  "reviewed phone/pair/recorder regressions must execute their actual owning tests, with no source-only database substitute");
let reviewedMutationCount = 0;
for (const [source, job] of [[schedulerGate, "validate"], [productionRepairGate, "backend"]]) {
  const targetStepName = "Reviewed phone, pair, and isolated recorder regressions";
  for (const mutant of [
    source.replace(`  ${job}:\n`, `  ${job}:\n    if: \${{ false }}\n`),
    source.replace(`  ${job}:\n`, `  ${job}:\n    continue-on-error: true\n`),
    source.replace(`      - name: ${targetStepName}\n`, `      - name: ${targetStepName}\n        if: \${{ false }}\n`),
    source.replace(`      - name: ${targetStepName}\n`, `      - name: ${targetStepName}\n        continue-on-error: true\n`),
    source.replace(`      - name: ${targetStepName}\n`, `      - name: ${targetStepName}\n        env:\n          NODE_OPTIONS: --require ./skip.cjs\n`),
    source.replace(reviewedRegressionCommand, `exit 0\n          ${reviewedRegressionCommand}`),
    source.replace(reviewedRegressionCommand, `if false; then\n          ${reviewedRegressionCommand}\n          fi`),
    source.replace(reviewedRegressionCommand, `skipped() {\n          ${reviewedRegressionCommand}\n          }`),
    source.replace(reviewedRegressionCommand, `cat <<'NEVER_RUN'\n          ${reviewedRegressionCommand}\n          NEVER_RUN`),
    source.replace(reviewedRegressionCommand, `return 0\n          ${reviewedRegressionCommand}`),
    source.replace(`  ${job}:\n`, `  ${job}: &merged\n`),
    source.replace(reviewedCleanShell, "        shell: bash -c 'exit 0'"),
    source.replace("\njobs:\n", "\nenv:\n  BASH_ENV: /tmp/skip\njobs:\n"),
    ...["env", "defaults"].flatMap(key => [key + ":", '"' + key + '":', "'" + key + "':", key + " :", "!!str " + key + ":"]
      .flatMap(spelling => {
        const value = key === "env" ? "\n  BASH_ENV: /tmp/skip\n" : "\n  run:\n    shell: /bin/true {0}\n";
        return [source + "\n" + spelling + value, source.replace("\njobs:\n", "\n" + spelling + value + "\njobs:\n")];
      })),
    source + "\ndefaults:\n  run:\n    shell: /bin/bash --noprofile --norc -c '/bin/bash \"$1\"; rc=$?; printf \"script-shell=/bin/true\\n\" > .npmrc; exit \"$rc\"' wrapper {0}\n",
    source + "\npermissions:\n  contents: read\n",
    source.replace("\njobs:\n", "\n? defaults\n: {run: {shell: /bin/true}}\njobs:\n"),
    ...[
      '    ? if\n    : "${{ false }}"\n',
      '    ? defaults\n    :\n      run:\n        shell: "/bin/true {0}"\n',
      '    "if": "${{ false }}"\n',
      "    'defaults': {run: {shell: '/bin/true {0}'}}\n",
      '    if : "${{ false }}"\n',
      '    !!str if: "${{ false }}"\n',
      '    <<: {if: false}\n',
      '    ? [if]\n    : false\n',
      '    &condition if: false\n',
      '    if: *condition\n',
      '    timeout-minutes: 35\n',
      '    steps: []\n',
      '    unknown: false\n',
      '    \t? if\n    : false\n',
    ].map(suffix => source + '\n' + suffix),
    source + `\n  ? ${job}\n  : {if: false, runs-on: ubuntu-24.04, steps: []}\n`,
    source.replace("        run: npm ci --ignore-scripts", "        run: npm ci"),
    ...[
      "node -e \"const fs=require('fs');const p=require('./package.json');p.scripts['test:reviewed-source-regressions']='true';fs.writeFileSync('package.json',JSON.stringify(p))\"",
      'mkdir -p "$RUNNER_TEMP/bin"; printf "#!/bin/sh\\nexit 0\\n" > "$RUNNER_TEMP/bin/npm"; chmod +x "$RUNNER_TEMP/bin/npm"; echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"',
      'echo "npm() { return 0; }" > "$RUNNER_TEMP/skip.sh"; echo "BASH_ENV=$RUNNER_TEMP/skip.sh" >> "$GITHUB_ENV"',
      "printf 'process.exit(0);' > scripts/legacy-activation-http-tests.mjs",
    ].map(body => source.replace(`      - name: ${targetStepName}`, `      - name: Unexpected predecessor\n        run: |\n          ${body}\n      - name: ${targetStepName}`)),
    source.replace(reviewedInputChecks[0], reviewedInputChecks[0].replace(/[a-f0-9]/, "0")),
    source.replace("--check --strict", "--check --status || true #"),
  ]) {
    assert.throws(() => assertReviewedRegressionGate(mutant, job, "independent skip/failure mutation"));
    reviewedMutationCount += 1;
  }
  for (const replacement of ["", `# ${reviewedRegressionCommand}`, `${reviewedRegressionCommand} || true`,
    `${reviewedRegressionCommand}\n          ${reviewedRegressionCommand}`]) {
    assert.throws(() => assertReviewedRegressionGate(source.replace(reviewedRegressionCommand, replacement), job, "mutation"));
    reviewedMutationCount += 1;
  }
  assert.throws(() => assertReviewedRegressionGate(source.replace(`docker pull ${rehearsalPostgresImage}`, "# missing image preparation"), job, "mutation"));
  reviewedMutationCount += 1;
}
const currentSystemSource = readFileSync(resolve(root, "scripts/current-system-source-contract-tests.mjs"), "utf8");
const completionSourceImport = "await import('./completion-taxonomy-contract-tests.mjs');";
const completionDatabaseCommand = "node scripts/completion-taxonomy-database-tests.mjs";
const completionStep = [
  "      - name: Current completion taxonomy and full recovery on clean no-auto-grants database",
  "        shell: bash",
  "        run: |",
  "          set -euo pipefail",
  `          ${completionDatabaseCommand}`,
  "",
].join("\n");
function assertCompletionRecoveryWiring(workflow, sourceSuite) {
  const sourceLines = sourceSuite.split("\n").map(line => line.trim())
    .filter(line => line && !line.startsWith("//"));
  assert.ok(sourceLines.every(line => /^await import\('\.\/[a-z0-9-]+\.mjs'\);$/.test(line)
    || /^console\.log\('CURRENT_SYSTEM_SOURCE_CONTRACTS_PASS:/.test(line)),
  "the complete source suite must keep every owning import top-level, without conditional or catch wrappers");
  assert.equal(sourceLines.filter(line => line === completionSourceImport).length, 1,
    "the complete source suite must import the mounted exact-session manager reader once");
  assertExactCommandsInJob(workflow, "backend", [
    "node scripts/current-system-source-contract-tests.mjs",
    completionDatabaseCommand,
  ], "custodial-production-repair.yml:backend completion recovery");
  const job = workflowJobs(workflow).find(({ name }) => name === "backend");
  assert.ok(job, "the complete backend job must exist");
  const stepName = "      - name: Current completion taxonomy and full recovery on clean no-auto-grants database\n";
  const start = job.source.indexOf(stepName);
  assert.ok(start >= 0 && job.source.indexOf(stepName, start + 1) < 0,
    "the clean completion database step must occur exactly once");
  const next = job.source.indexOf("      - ", start + stepName.length);
  assert.equal(job.source.slice(start, next < 0 ? undefined : next), completionStep,
    "the exact completion database step must be unconditional, fail-fast and unwrapped");
  const commands = workflowCommands(workflow, "backend");
  const sourceCommand = commands.find(({ command }) => command === "node scripts/current-system-source-contract-tests.mjs");
  const databaseCommand = commands.find(({ command }) => command === completionDatabaseCommand);
  const nativeCommand = commands.find(({ command }) => command === "node scripts/native-location-dispatch-database-tests.mjs");
  const sharedRebuild = commands.find(({ command }) => command.startsWith("npm run --silent test:empty-db-rebuild | tee "));
  assert.ok(sourceCommand && databaseCommand && nativeCommand && sharedRebuild,
    "source, clean completion, native and shared database stages must all remain executable");
  assert.ok(sourceCommand.stepIndex < databaseCommand.stepIndex &&
    databaseCommand.stepIndex < nativeCommand.stepIndex &&
    nativeCommand.stepIndex < sharedRebuild.stepIndex,
  "the exact completion proof must follow its source contract and precede shared mutable fixtures");
}
assertCompletionRecoveryWiring(productionRepairGate, currentSystemSource);
const sanitationSourceImport = "await import('./moxie-retired-source-inventory-tests.mjs');";
function assertSanitationSourceWiring(workflow, sourceSuite) {
  // Reuse the actual mandatory source-stage and unsuppressed-import checks.
  // The new inventory complements rather than replaces original retirement gates.
  assertCompletionRecoveryWiring(workflow, sourceSuite);
  const lines = sourceSuite.split('\n').map(line => line.trim())
    .filter(line => line && !line.startsWith('//'));
  assert.equal(lines.filter(line => line === sanitationSourceImport).length, 1,
    'the mandatory source stage must execute the retirement inventory exactly once');
}
assertSanitationSourceWiring(productionRepairGate, currentSystemSource);
let sanitationWiringMutationCount = 0;
for (const replacement of ['', `// ${sanitationSourceImport}`,
  `${sanitationSourceImport}\n${sanitationSourceImport}`,
  `if (false) { ${sanitationSourceImport} }`,
  "await import('./moxie-retired-source-inventory-tests.mjs').catch(() => {});"]) {
  assert.throws(() => assertSanitationSourceWiring(productionRepairGate,
    currentSystemSource.replace(sanitationSourceImport, replacement)));
  sanitationWiringMutationCount += 1;
}
console.log('Sanitation owning source gate PASS: ' + sanitationWiringMutationCount + ' omission/suppression mutations rejected');
const eventCountSourceImports = ["await import('./event-count-cross-surface-contract-tests.mjs');",
  "await import('./native-provider-event-decisions-tests.mjs');",
  "await import('./native-provider-event-decisions-database-contract-tests.mjs');",
  "await import('./manager-notification-history-tests.mjs');",
  "await import('./static-weekly-opening-coverage-report-ci-tests.mjs');",
  "await import('./static-weekly-opening-coverage-preview-contract-tests.mjs');",
  "await import('./static-weekly-policy-scope-ci-tests.mjs');",
  "await import('./static-weekly-postgres-key-order-ci-tests.mjs');",
  "await import('./static-weekly-digest-stream-ci-tests.mjs');",
  "await import('./static-weekly-replay-digest-stream-ci-tests.mjs');",
  "await import('./static-weekly-current-manager-fixture-tests.mjs');",
  "await import('./static-weekly-dual-source-sql-stage-contract-tests.mjs');",
  "await import('./static-weekly-recurring-phase-authority-ci-tests.mjs');",
  "await import('./static-weekly-identity-auxiliary-ci-tests.mjs');",
  "await import('./static-weekly-recurring-week-commitment-tests.mjs');",
  "await import('./static-weekly-morning-planning-authority-ci-tests.mjs');",
  "await import('./static-weekly-recurring-morning-solver-ci-tests.mjs');",
  "await import('./static-weekly-recurring-morning-integration-ci-tests.mjs');",
  "await import('./static-weekly-recurring-correction-ci-tests.mjs');",
  "await import('./current-release-recovery-probe-contract-tests.mjs');",
  "await import('./current-release-recovery-replay-contract-tests.mjs');"];
function assertEventCountSourceWiring(workflow, sourceSuite) {
  assertCompletionRecoveryWiring(workflow, sourceSuite);
  const lines = sourceSuite.split('\n').map(line => line.trim())
    .filter(line => line && !line.startsWith('//'));
  for (const statement of eventCountSourceImports) assert.equal(lines.filter(line => line === statement).length, 1,
    'the mandatory source stage must execute the Event count, manager history, opening-coverage and called policy-scope contracts exactly once');
}
assertEventCountSourceWiring(productionRepairGate, currentSystemSource);
let eventCountWiringMutationCount = 0;
for (const eventCountSourceImport of eventCountSourceImports) for (const replacement of ['', `// ${eventCountSourceImport}`,
  `${eventCountSourceImport}\n${eventCountSourceImport}`,
  `if (false) { ${eventCountSourceImport} }`,
  "await import('./event-count-cross-surface-contract-tests.mjs').catch(() => {});"]) {
  assert.throws(() => assertEventCountSourceWiring(productionRepairGate,
    currentSystemSource.replace(eventCountSourceImport, replacement)));
  eventCountWiringMutationCount += 1;
}
console.log('Event count, manager history and opening-coverage source gates PASS: ' + eventCountWiringMutationCount + ' omission/suppression mutations rejected');
// The digest-stream suite must actually execute its owning test in a clean child,
// retain every prior suite, and reject a guarded/import-only fake wrapper.
const digestStreamSourceImport = "await import('./static-weekly-digest-stream-ci-tests.mjs');";
const digestStreamWrapper = readFileSync(resolve(root,'scripts/static-weekly-digest-stream-ci-tests.mjs'),'utf8');
function assertDigestStreamCalledWiring(sourceSuite, wrapper) {
  assertEventCountSourceWiring(productionRepairGate,sourceSuite);
  const imports=sourceSuite.split('\n').map(line=>line.trim()).filter(line=>/^await import\(/.test(line));
  assert.equal(imports.length,45,'preserve all39 prior owning suites plus digest-stream, replay-digest-stream, correction, dual-source SQL-stage and two native-decision contracts');
  assert.equal(imports.filter(line=>line===digestStreamSourceImport).length,1);
  assert.equal(createHash('sha256').update(imports.filter(line=>line!==digestStreamSourceImport&&
    line!=="await import('./native-provider-event-decisions-tests.mjs');"&&
    line!=="await import('./native-provider-event-decisions-database-contract-tests.mjs');"&&
    line!=="await import('./static-weekly-replay-digest-stream-ci-tests.mjs');"&&
    line!=="await import('./static-weekly-dual-source-sql-stage-contract-tests.mjs');"&&
    line!=="await import('./static-weekly-recurring-correction-ci-tests.mjs');").join('\n')+'\n').digest('hex'),
    '1fb01bf2b017ab8473f459ede8516c6bd3011ff0bf99f157181843bfa9f855ab',
    'all39 prior import identities/order must remain exact, not a substituted same-count suite');
  assert.match(sourceSuite,/CURRENT_SYSTEM_SOURCE_CONTRACTS_PASS: 45 explicit owning suites/);
  assert.match(wrapper,/^const output = execFileSync\(process\.execPath, \['--max-old-space-size=128',\n  '--max-semi-space-size=8', '--wasm-max-mem-pages=1536', '--stack-size=4096',\n  fileURLToPath\(new URL\('\.\/static-weekly-digest-stream-tests\.mjs', import\.meta\.url\)\)\],\n  \{encoding:'utf8',timeout:60000,maxBuffer:1024\*1024,\n    env:\{PATH:process\.env\.PATH,LANG:'C\.UTF-8'\}\}\);$/m);
  assert.match(wrapper,/^assert\.equal\(receipt\.status, 'PASS'\);$/m);
  assert.match(wrapper,/^assert\.equal\(receipt\.checks, 1009\);$/m);
  assert.match(wrapper,/^assert\.equal\(receipt\.isolatedProcesses, true\);$/m);
  assert.match(wrapper,/^assert\.deepEqual\(receipt\.results\.map\(result=>result\.mode\), \['portable','string-only','invalid','native','allocation'\]\);$/m);
  assert.match(wrapper,/^assert\.deepEqual\(receipt\.results\.map\(result=>result\.checks\), \[245,245,258,251,10\]\);$/m);
  assert.doesNotMatch(wrapper,/\b(?:if|catch|try)\s*\(|\.catch\s*\(|\.then\s*\(|process\.env\.(?:SKIP|CUSTODIAL)|\|\|\s*true/);
}
assertDigestStreamCalledWiring(currentSystemSource,digestStreamWrapper);
let digestStreamWiringMutationCount=0;
for(const replacement of ['',`// ${digestStreamSourceImport}`,`${digestStreamSourceImport}\n${digestStreamSourceImport}`,
  `if (false) { ${digestStreamSourceImport} }`,"await import('./static-weekly-digest-stream-ci-tests.mjs').catch(() => {});"]){
  assert.throws(()=>assertDigestStreamCalledWiring(currentSystemSource.replace(digestStreamSourceImport,replacement),digestStreamWrapper));digestStreamWiringMutationCount++;
}
for(const sourceMutant of [currentSystemSource.replace("await import('./events-chicago-time-tests.mjs');","await import('./unknown-replacement-tests.mjs');"),
  currentSystemSource.replace("await import('./events-chicago-time-tests.mjs');\nawait import('./messaging-durability-contract-tests.mjs');",
    "await import('./messaging-durability-contract-tests.mjs');\nawait import('./events-chicago-time-tests.mjs');"),
  currentSystemSource.replace('45 explicit owning suites','44 explicit owning suites')]) {
  assert.throws(()=>assertDigestStreamCalledWiring(sourceMutant,digestStreamWrapper));digestStreamWiringMutationCount++;
}
for(const [from,to]of [['const output = execFileSync(','// const output = execFileSync('],
  ['receipt.checks, 1009','receipt.checks, 0'],['timeout:60000','timeout:600000'],
  ["'--max-old-space-size=128'","'--max-old-space-size=256'"],
  ["'./static-weekly-digest-stream-tests.mjs'","'./static-weekly-digest-stream-ci-tests.mjs'"],
  ["[245,245,258,251,10]","[245,245,258,251,0]"],
  ['process.stdout.write(output);','if (false) { process.stdout.write(output); }'],
  ["env:{PATH:process.env.PATH,LANG:'C.UTF-8'}","env:process.env"]]){
  assert.throws(()=>assertDigestStreamCalledWiring(currentSystemSource,digestStreamWrapper.replace(from,to)));digestStreamWiringMutationCount++;
}
console.log('Digest-stream called source gate PASS: '+digestStreamWiringMutationCount+' omission/suppression/limit/receipt mutations rejected');
const replayDigestWrapper = readFileSync(resolve(root,'scripts/static-weekly-replay-digest-stream-ci-tests.mjs'),'utf8');
function assertReplayDigestCalledWiring(wrapper) {
  assert.match(wrapper,/^const output = execFileSync\(process\.execPath, \['--max-old-space-size=128',\n  '--max-semi-space-size=8', '--wasm-max-mem-pages=1536', '--stack-size=4096',\n  fileURLToPath\(new URL\('\.\/static-weekly-replay-digest-stream-tests\.mjs', import\.meta\.url\)\)\],\n  \{encoding:'utf8',timeout:60000,maxBuffer:1024\*1024,\n    env:\{PATH:process\.env\.PATH,LANG:'C\.UTF-8'\}\}\);$/m);
  assert.match(wrapper,/^assert\.equal\(receipt\.status, 'PASS'\);$/m);
  assert.match(wrapper,/^assert\.equal\(receipt\.checks, 186\);$/m);
  assert.match(wrapper,/^assert\.equal\(receipt\.sourceDeltaOnlyReplayDigest, true\);$/m);
  assert.match(wrapper,/^assert\.equal\(receipt\.actualPreviewExecuted, false\);$/m);
  assert.match(wrapper,/^assert\.deepEqual\(receipt\.results\.map\(result=>result\.mode\), \['portable','string-only','incremental','allocation-legacy','allocation-stream'\]\);$/m);
  assert.match(wrapper,/^assert\.deepEqual\(receipt\.results\.map\(result=>result\.checks\), \[59,59,61,3,3\]\);$/m);
  assert.doesNotMatch(wrapper,/\b(?:if|catch|try)\s*\(|\.catch\s*\(|\.then\s*\(|process\.env\.(?:SKIP|CUSTODIAL)|\|\|\s*true/);
}
assertReplayDigestCalledWiring(replayDigestWrapper);
let replayDigestWiringMutationCount=0;
for(const [from,to]of [['const output = execFileSync(','// const output = execFileSync('],
  ['receipt.status, \'PASS\'','receipt.status, \'FAIL\''],['receipt.checks, 186','receipt.checks, 0'],
  ['timeout:60000','timeout:600000'],["'--max-old-space-size=128'","'--max-old-space-size=256'"],
  ["'./static-weekly-replay-digest-stream-tests.mjs'","'./static-weekly-replay-digest-stream-ci-tests.mjs'"],
  ['[59,59,61,3,3]','[59,59,61,3,0]'],['receipt.sourceDeltaOnlyReplayDigest, true','receipt.sourceDeltaOnlyReplayDigest, false'],
  ['receipt.actualPreviewExecuted, false','receipt.actualPreviewExecuted, true'],
  ['process.stdout.write(output);','if (false) { process.stdout.write(output); }'],
  ["env:{PATH:process.env.PATH,LANG:'C.UTF-8'}","env:process.env"]]){
  assert.notEqual(replayDigestWrapper.replace(from,to),replayDigestWrapper);
  assert.throws(()=>assertReplayDigestCalledWiring(replayDigestWrapper.replace(from,to)));replayDigestWiringMutationCount++;
}
console.log('Replay-digest called source gate PASS: '+replayDigestWiringMutationCount+' limit/receipt/suppression mutations rejected');
const recurringCorrectionWrapper = readFileSync(resolve(root,
  'scripts/static-weekly-recurring-correction-ci-tests.mjs'),'utf8');
function assertRecurringCorrectionCalledWiring(wrapper) {
  assert.match(wrapper,/\['static-weekly-recurring-correction-binding-tests\.mjs', 28\]/);
  assert.match(wrapper,/\['static-weekly-recurring-dual-source-contract-tests\.mjs', 34\]/);
  assert.match(wrapper,/\['static-weekly-recurring-correction-control-plane-tests\.mjs', 9\]/);
  assert.match(wrapper,/^for \(const \[name, expected\] of cases\) \{$/m);
  assert.match(wrapper,/^  const output = execFileSync\(process\.execPath,\n    \[fileURLToPath\(new URL\('\.\/' \+ name, import\.meta\.url\)\)\],\n    \{encoding:'utf8', timeout:45000, maxBuffer:1024\*1024,\n      env:\{PATH:process\.env\.PATH, LANG:'C\.UTF-8'\}\}\);$/m);
  assert.match(wrapper,/^  assert\.equal\(receipt\.status, 'PASS'\);$/m);
  assert.match(wrapper,/^  assert\.equal\(receipt\.checks, expected\);$/m);
  assert.match(wrapper,/^assert\.deepEqual\(receipts\.map\(row=>row\.checks\), \[28,34,9\]\);$/m);
  assert.doesNotMatch(wrapper,/\b(?:if|catch|try)\s*\(|\.catch\s*\(|process\.env\.(?:SKIP|CUSTODIAL)|\|\|\s*true/);
}
assertRecurringCorrectionCalledWiring(recurringCorrectionWrapper);
let recurringCorrectionMutationCount=0;
for (const [from,to] of [
  ['const output = execFileSync(', '// const output = execFileSync('],
  ["'static-weekly-recurring-correction-binding-tests.mjs', 28", "'static-weekly-recurring-correction-binding-tests.mjs', 0"],
  ["'static-weekly-recurring-dual-source-contract-tests.mjs', 34", "'static-weekly-recurring-dual-source-contract-tests.mjs', 0"],
  ["'static-weekly-recurring-correction-control-plane-tests.mjs', 9", "'static-weekly-recurring-correction-control-plane-tests.mjs', 0"],
  ['timeout:45000', 'timeout:450000'],
  ["env:{PATH:process.env.PATH, LANG:'C.UTF-8'}", 'env:process.env'],
  ["assert.equal(receipt.status, 'PASS')", "assert.equal(receipt.status, 'SKIP')"],
  ['assert.equal(receipt.checks, expected)', 'assert.equal(receipt.checks, 0)'],
  ['for (const [name, expected] of cases)', 'if (false) for (const [name, expected] of cases)'],
]) {
  assert.throws(()=>assertRecurringCorrectionCalledWiring(recurringCorrectionWrapper.replace(from,to)));
  recurringCorrectionMutationCount++;
}
console.log('Recurring correction called gate PASS: '+recurringCorrectionMutationCount+' execution/receipt/environment mutations rejected');
const capacityAuthorityCommands = [
  'node scripts/nonemployee-coverall-database-tests.mjs',
  'node scripts/nonemployee-coverall-nonempty-lunch-database-tests.mjs',
  'node scripts/nonemployee-coverall-current-source-database-tests.mjs',
  'node scripts/native-target-source-database-tests.mjs',
];
const capacityAuthorityStepName = '      - name: Fresh nonemployee CoverAll, current source, and native target authorities\n';
const capacityAuthorityStep = [capacityAuthorityStepName.trimEnd(), reviewedCleanShell,
  '        run: |', '          set -euo pipefail',
  ...capacityAuthorityCommands.map(command => '          ' + command), '',
].join('\n');
const capacitySourceImports=[
  "await import('./nonemployee-coverall-source-transition-tests.mjs');",
  "await import('./nonemployee-coverall-source-bridge-tests.mjs');",
  "await import('./native-target-source-contract-tests.mjs');",
];
function assertCapacityAuthorityWiring(workflow,sourceSuite=currentSystemSource) {
  // Retain the existing immutable image preparation, unconditional job header
  // and canonical metadata protections, rather than invent a parallel gate.
  assertReviewedRegressionGate(workflow, 'backend', 'current capacity/native authority gate');
  const imports=sourceSuite.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('//'));
  assert.ok(imports.every(line=>/^await import\('\.\/[a-z0-9-]+\.mjs'\);$/.test(line)
    ||/^console\.log\('CURRENT_SYSTEM_SOURCE_CONTRACTS_PASS:/.test(line)),
    'owning source imports remain top-level and unsuppressed');
  for(const statement of capacitySourceImports)assert.equal(imports.filter(line=>line===statement).length,1,
    'owning current-source/bridge/native source contracts execute once, not just their DB fixtures');
  assertExactCommandsInJob(workflow, 'backend', capacityAuthorityCommands, 'current capacity/native authority gate');
  const job=workflowJobs(workflow).find(({name})=>name==='backend');
  const start=job.source.indexOf(capacityAuthorityStepName);
  assert.ok(start>=0&&job.source.indexOf(capacityAuthorityStepName,start+1)<0,'one owning authority step required');
  const next=job.source.indexOf('      - ',start+capacityAuthorityStepName.length);
  assert.equal(job.source.slice(start,next<0?undefined:next),capacityAuthorityStep,
    'authority runners must be exact, unconditional, environment-clean and fail-fast; no skip/retention/wrapper');
  const commands=workflowCommands(workflow,'backend');
  const stages=capacityAuthorityCommands.map(command=>commands.find(item=>item.command===command));
  const source=commands.find(item=>item.command==='node scripts/current-system-source-contract-tests.mjs');
  const native=commands.find(item=>item.command==='node scripts/native-location-dispatch-database-tests.mjs');
  const shared=commands.find(item=>item.command.startsWith('npm run --silent test:empty-db-rebuild | tee '));
  assert.ok(source&&native&&shared&&source.stepIndex<native.stepIndex&&native.stepIndex<stages[0].stepIndex
    &&stages.at(-1).stepIndex<shared.stepIndex,'fresh owning proofs follow source/native checks and precede shared mutable fixtures');
  assert.ok(stages.every((item,i)=>item.stepIndex===stages[0].stepIndex&&(!i||item.lineIndex>stages[i-1].lineIndex)),
    'fresh CoverAll/Event, nonempty typed lunch, current-source bridge and native targets must retain exact sequential order');
}
assertCapacityAuthorityWiring(productionRepairGate);
let capacityWiringMutationCount=0;
for(const command of capacityAuthorityCommands)for(const replacement of [
  '# '+command,command+' || true',command+'; exit 0',
  command+'\n          '+command,'if false; then '+command+'; fi',
  'CAPACITY_KEEP_FAILED_DB_FOR_DIAGNOSTIC=1 '+command,
]){
  assert.throws(()=>assertCapacityAuthorityWiring(productionRepairGate.replace(command,replacement)),
    'missing/duplicate/skip/ignore-error/retention mutations must fail for every owning runner');capacityWiringMutationCount++;
}
for(const [old,replacement] of [
  ['        run: |','        if: ${{ false }}\n        run: |'],
  ['        run: |','        continue-on-error: true\n        run: |'],
  ['          set -euo pipefail','          set +e'],
  [reviewedCleanShell,'        shell: bash'],
  ['          '+capacityAuthorityCommands[0]+'\n          '+capacityAuthorityCommands[1],
   '          '+capacityAuthorityCommands[1]+'\n          '+capacityAuthorityCommands[0]],
]){
  assert.throws(()=>assertCapacityAuthorityWiring(productionRepairGate.replace(capacityAuthorityStep,
    capacityAuthorityStep.replace(old,replacement))),'conditional/env/failfast/order mutation must fail');capacityWiringMutationCount++;
}
assert.throws(()=>assertCapacityAuthorityWiring(productionRepairGate.replace(capacityAuthorityStep,'')
  .replace('      - name: Isolated current weekly event authority\n',capacityAuthorityStep+'      - name: Isolated current weekly event authority\n')),
  'owning proofs may not move behind shared mutable fixtures');capacityWiringMutationCount++;
for(const statement of capacitySourceImports)for(const replacement of ['',`// ${statement}`,
  `${statement}\n${statement}`,`if(false){${statement}}`,`try{${statement}}catch{}`]){
  assert.throws(()=>assertCapacityAuthorityWiring(productionRepairGate,currentSystemSource.replace(statement,replacement)),
    'owning source import removal/duplication/conditional/error suppression must fail');capacityWiringMutationCount++;
}
for(const command of capacityAuthorityCommands){
  const source=readFileSync(resolve(root,command.slice('node '.length)),'utf8');
  assert.match(source,/const container=`mz_schema_rebuild_[a-z_]+_\$\{process\.pid\}`;/,'each owning runner creates its own process-bound fixture');
  assert.match(source,/docker\(\['run','--rm','-d'/,'each owning runner creates a fresh disposable database');
  assert.match(source,/readdirSync\('supabase\/migrations'\)\.filter\([^\n]+\.sort\(\)/,'each owning runner consumes sorted current source migrations');
  assert.ok(source.includes(rehearsalPostgresImage),'each owning runner uses the existing digest-pinned image');
  assert.match(source,/finally\{[\s\S]*?(?:cleanup\(\)|docker\(\['rm','-f',container\]\))/,'each owning runner owns exact finally cleanup');
  assert.doesNotMatch(source,/process\.env\.[A-Z_]*(?:DOCKER_CONTAINER|DATABASE_URL)/,'these fixtures must not adopt a supplied/shared/production database');
}
assert.match(readFileSync(resolve(root,'scripts/nonemployee-coverall-database-tests.mjs'),'utf8'),
  /const eventBrief=verifyCoverAllEventBriefSqlFixture\(/,'fresh CoverAll proof must retain its actual Event SQL fixture, not only PDF mocks');
console.log('CURRENT_CAPACITY_NATIVE_CI_WIRING_PASS:',capacityAuthorityCommands.length,'runners;',capacityWiringMutationCount,'hostile wiring mutations');
const sixPersonStep = [
  '      - name: Exact six-person absence and manual typed capacity compiler proof',
  '        shell: bash', '        run: |', '          set -euo pipefail',
  '          unset STATIC_WEEKLY_TEST_SIX_PACKET STATIC_WEEKLY_ABSENCE_PROOF_CASES',
  '          export CI=true', '          six_person_absence_proof_dir="$(mktemp -d)"',
  '          export STATIC_WEEKLY_ABSENCE_PROOF_OUTPUT="$six_person_absence_proof_dir/results"',
  '          test -f scripts/fixtures/six-person-absence-source.json',
  '          node scripts/six-person-absence-fixture-contract-tests.mjs',
  '          node scripts/six-person-absence-permutation-tests.mjs',
  '          node scripts/six-person-absence-receipt-tests.mjs',
  '          test -s "$STATIC_WEEKLY_ABSENCE_PROOF_OUTPUT/summary.json"', '',
].join('\n');
function assertSixPersonAbsenceWiring(workflow) {
  assertReviewedRegressionGate(workflow,'backend','exact six-person absence proof');
  assert.equal(workflow.split(sixPersonStep).length-1,1,'owning exact-source proof is unconditional, fresh and fail-fast');
  for(const command of ['node scripts/six-person-absence-fixture-contract-tests.mjs','node scripts/six-person-absence-permutation-tests.mjs','node scripts/six-person-absence-receipt-tests.mjs'])
    assert.equal(workflow.split(command).length-1,1,'owning proof cannot duplicate or hide in another step');
  assert.ok(workflow.indexOf(sixPersonStep)>workflow.indexOf(capacityAuthorityStep)
    && workflow.indexOf(sixPersonStep)<workflow.indexOf('      - name: Empty database migration rebuild and database concurrency\n'),
    'exact six-person compiler proof follows typed source proofs and precedes shared mutable fixtures');
}
assertSixPersonAbsenceWiring(productionRepairGate);
let sixPersonMutations=0;
for(const [before,after]of [
 ['        shell: bash','        shell: sh'],['        run: |','        if: ${{ false }}\n        run: |'],
 ['        run: |','        continue-on-error: true\n        run: |'],['          set -euo pipefail','          set +e'],
 ['          export CI=true','          export CI=false'],['          six_person_absence_proof_dir="$(mktemp -d)"','          six_person_absence_proof_dir=/tmp/shared-proof'],
 ['          unset STATIC_WEEKLY_TEST_SIX_PACKET STATIC_WEEKLY_ABSENCE_PROOF_CASES','          export STATIC_WEEKLY_ABSENCE_PROOF_CASES=baseline'],
 ['          test -f scripts/fixtures/six-person-absence-source.json','          true'],
 ['          test -s "$STATIC_WEEKLY_ABSENCE_PROOF_OUTPUT/summary.json"','          true'],
 ['          node scripts/six-person-absence-fixture-contract-tests.mjs','          node scripts/six-person-absence-fixture-contract-tests.mjs || true'],
 ['          node scripts/six-person-absence-permutation-tests.mjs','          node scripts/six-person-absence-permutation-tests.mjs || true'],
 ['          node scripts/six-person-absence-receipt-tests.mjs','          node scripts/six-person-absence-receipt-tests.mjs || true'],
 ['          node scripts/six-person-absence-receipt-tests.mjs','          # node scripts/six-person-absence-receipt-tests.mjs'],
 ['          node scripts/six-person-absence-permutation-tests.mjs','          # node scripts/six-person-absence-permutation-tests.mjs'],
 ['          node scripts/six-person-absence-permutation-tests.mjs','          node scripts/six-person-absence-permutation-tests.mjs\n          node scripts/six-person-absence-permutation-tests.mjs'],
 ['          node scripts/six-person-absence-fixture-contract-tests.mjs\n          node scripts/six-person-absence-permutation-tests.mjs',
  '          node scripts/six-person-absence-permutation-tests.mjs\n          node scripts/six-person-absence-fixture-contract-tests.mjs'],
]) {assert.throws(()=>assertSixPersonAbsenceWiring(productionRepairGate.replace(sixPersonStep,sixPersonStep.replace(before,after))));sixPersonMutations++;}
assert.throws(()=>assertSixPersonAbsenceWiring(productionRepairGate.replace(sixPersonStep,'')));sixPersonMutations++;
const exactSixFixture=readFileSync(resolve(root,'scripts/fixtures/six-person-absence-source.json'));
assert.equal(createHash('sha256').update(exactSixFixture).digest('hex'),'882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469');
const sixProof=readFileSync(resolve(root,'scripts/six-person-absence-permutation-tests.mjs'),'utf8');
assert.match(sixProof,/if\(process\.env\.CI==='true'\)assert\.deepEqual\(requested,Object\.keys\(cases\)/,'CI cannot narrow cases');
assert.match(sixProof,/finally\{await runtime\.shutdown\(\)/,'owning compiler group must close even after proof failure');
assert.match(sixProof,/verifyStaticWeeklyScheduleResult\(input,result\)/,'full solver-free verifier, not heuristic success');
assert.match(sixProof,/loadSixPersonAbsenceSource\(/,'exact committed input is the default fixture');
console.log('EXACT_SIX_PERSON_ABSENCE_CI_WIRING_PASS:',sixPersonMutations,'hostile wiring mutations; exact committed fixture required');
for (const mutation of [
  productionRepairGate.replace(completionDatabaseCommand, `# ${completionDatabaseCommand}`),
  productionRepairGate.replace(completionDatabaseCommand, `${completionDatabaseCommand} || true`),
  productionRepairGate.replace(completionDatabaseCommand, `${completionDatabaseCommand}\n          ${completionDatabaseCommand}`),
  productionRepairGate.replace(completionStep, completionStep.replace("        shell: bash", "        if: ${{ false }}\n        shell: bash")),
  productionRepairGate.replace(completionStep, completionStep.replace("        shell: bash", "        continue-on-error: true\n        shell: bash")),
  productionRepairGate.replace(completionStep, completionStep.replace("          set -euo pipefail", "          set +e")),
  productionRepairGate.replace(completionStep, "").replace(
    "      - name: Empty database migration rebuild and database concurrency\n",
    completionStep + "      - name: Empty database migration rebuild and database concurrency\n"),
]) assert.throws(() => assertCompletionRecoveryWiring(mutation, currentSystemSource),
  "completion database bypass, duplicate or order mutation must fail");
assert.throws(() => assertCompletionRecoveryWiring(productionRepairGate,
  currentSystemSource.replace(completionSourceImport, `// ${completionSourceImport}`)),
"removing the complete source contract must fail");
assert.throws(() => assertCompletionRecoveryWiring(productionRepairGate,
  currentSystemSource.replace(completionSourceImport, `if (false) {\n${completionSourceImport}\n}`)),
"a conditional complete-source import must fail");
assert.match(productionRepairGate,
  /CUSTODIAL_STATIC_TRUTH_TEST_DOCKER_CONTAINER="\$container"[\s\S]*npm run --silent test:static-weekly-operational-truth-db/,
  "the complete repair gate must prove canonical operational truth against its exact rebuilt schema");
const eventAuthoritySteps = workflowRunSteps(workflowJobs(productionRepairGate).find(({ name }) => name === "backend").source)
  .filter((source) => source.includes("npm run --silent test:event-static-authority-db"));
assert.equal(eventAuthoritySteps.length, 1, "the current weekly event authority proof must execute exactly once");
assert.match(eventAuthoritySteps[0], /trap cleanup_event_database EXIT[\s\S]*SCHEMA_REBUILD_KEEP_DATABASE=1 npm run --silent test:empty-db-rebuild/,
  "the event authority proof needs its own clean rebuild and cleanup armed before creation");
assert.match(eventAuthoritySteps[0], /EVENT_STATIC_AUTHORITY_TEST_DOCKER_CONTAINER="\$\{retained\[0\]\}"[\s\S]*EVENT_STATIC_AUTHORITY_TEST_DATABASE=postgres/,
  "the event proof must consume its exact retained disposable database");
assert.equal(parsedPackageManifest.scripts["test:event-static-authority-db"], "node scripts/event-static-authority-database-tests.mjs");
const populatedSchemaPreflight = readFileSync(resolve(workflowDirectory, "custodial-populated-schema-preflight.yml"), "utf8");
assert.match(populatedSchemaPreflight, /test -n "\$SCHEMA_FINGERPRINT_MCP_URL"/,
  "the production schema preflight must reject a missing read-only MCP endpoint");
assert.match(populatedSchemaPreflight, /set -euo pipefail[\s\S]*release:populated-schema:preflight \| tee[\s\S]*test -s \/tmp\/custodial-populated-schema-preflight\.json/,
  "the production schema preflight must preserve command failure and require a non-empty receipt");
const productionBackupRehearsal = readFileSync(resolve(workflowDirectory, "production-backup-migration-rehearsal.yml"), "utf8");
const localProductionBackupRehearsal = readFileSync(resolve(root, "scripts/run-production-backup-migration-rehearsal.sh"), "utf8");
const build52ProductionMigrationApply = readFileSync(resolve(workflowDirectory, "build52-production-migration-apply.yml"), "utf8");
const build52ProductionMigrationApplyJob = workflowJobs(build52ProductionMigrationApply)
  .find(({ name }) => name === "authorize-and-apply");
assert.ok(build52ProductionMigrationApplyJob, "the Build 52 production migration workflow must retain its authorize-and-apply job");
const build52ProductionMigrationRunSteps = workflowRunSteps(build52ProductionMigrationApplyJob.source);
assert.ok(
  Math.max(...build52ProductionMigrationRunSteps.map((source) => source.replace(/^ {10}/gm, "").length)) < 19_000,
  "every Build 52 production migration run expression must retain margin below GitHub's 21,000-character limit",
);
const independentProductionTargetStep = build52ProductionMigrationRunSteps
  .find((source) => source.includes('source: "direct-production-query"'));
assert.ok(independentProductionTargetStep,
  "the production workflow must query and verify the actual post-apply database in a separate step");
assert.match(independentProductionTargetStep, /SUPABASE_DB_URL[\s\S]*new Client\([\s\S]*rejectUnauthorized: true/,
  "the independent verifier must open its own TLS-verified production database connection");
assert.match(independentProductionTargetStep,
  /begin isolation level repeatable read read only[\s\S]*captureSchemaCatalog\(database\)[\s\S]*database\.query\("commit"\)/,
  "the independent verifier must bind its ledger and catalog observations to one read-only snapshot");
assert.match(independentProductionTargetStep,
  /select count\(\*\)::integer as ledger_count,max\(version\)::text as ledger_head from supabase_migrations\.schema_migrations/,
  "the independent verifier must read the actual production migration ledger");
assert.match(independentProductionTargetStep, /captureSchemaCatalog\(database\)[\s\S]*fingerprintSchemaCatalog\(normalizedCatalog\)/,
  "the independent verifier must recapture and fingerprint the actual production catalog");
// Only the observer creates the receipt. The separate jq comparison reads
// committed release state for EXPECTED values, never for observed values.
function extractIndependentObserver(step) {
  // Match the COMPLETE canonical YAML heredoc closing line, never a JavaScript
  // identifier or label whose first four characters happen to be NODE.
  const modules = [...step.matchAll(
    /^ {12}node --input-type=module > "\$post_apply_path" <<'NODE'\r?\n([\s\S]*?)^ {10}NODE\r?$/gm,
  )];
  assert.equal(modules.length, 1,
    "the production observer must remain one explicit complete inline module");
  return modules[0][1];
}
const independentObserverSource = extractIndependentObserver(independentProductionTargetStep);
function assertIndependentObserver(source) {
  assert.doesNotMatch(source,
    /build52-production-migration-result\.json|\bresult_path\b|production-migration-state\.json|target_catalog_fingerprint/,
    "observed production state must come from the actual database, not release expectations or apply output");
}
assertIndependentObserver(independentObserverSource);
for (const forbidden of ["build52-production-migration-result.json", "result_path",
  "production-migration-state.json", "target_catalog_fingerprint"]) {
  assert.throws(() => assertIndependentObserver(independentObserverSource + `\nconst injected = ${JSON.stringify(forbidden)};`),
    /observed production state must come from the actual database/);
}
assert.ok(
  build52ProductionMigrationApply.indexOf("npm run --silent release:migrations:apply")
    < build52ProductionMigrationApply.indexOf('source: "direct-production-query"'),
  "the direct production recapture must occur only after the exact migration application",
);
const productionApplyCommitted = build52ProductionMigrationApply.indexOf('"stage":"production_apply_committed"');
const independentProductionRead = build52ProductionMigrationApply.indexOf('source: "direct-production-query"');
const independentProductionPredicate = build52ProductionMigrationApply.indexOf("and .counts.functions == $state.target.expected_catalog_counts.functions");
const productionTargetVerified = build52ProductionMigrationApply.indexOf('"stage":"production_target_independently_verified"');
assert.ok(
  build52ProductionMigrationApply.indexOf("npm run --silent release:migrations:apply") < productionApplyCommitted
    && productionApplyCommitted < independentProductionRead
    && independentProductionRead < independentProductionPredicate
    && independentProductionPredicate < productionTargetVerified,
  "the workflow receipt must distinguish a committed migration from later independent target verification",
);
assert.match(build52ProductionMigrationApply, /build52-production-post-apply-verification\.json/,
  "the independent production verification receipt must be uploaded even when the workflow fails closed");
const independentTargetPredicateMatch = build52ProductionMigrationApply.match(
  /jq -e \\\n\s+--slurpfile release_state release\/production-migration-state\.json \\\n\s+'([^']*\.source == "direct-production-query"[^']*)' \\\n\s+"\$post_apply_path"/,
);
assert.ok(independentTargetPredicateMatch,
  "the production workflow must retain one exact workflow-owned post-apply acceptance predicate");
const independentTargetPredicate = independentTargetPredicateMatch[1];
const acceptedProductionTarget = {
  format: "memphis-zoo-build52-production-post-apply.v1",
  ok: true,
  source: "direct-production-query",
  ledger_count: expectedProductionTarget.production_ledger_count,
  ledger_head: expectedProductionTarget.source_migration_version,
  counts: {
    functions: expectedProductionTarget.expected_catalog_counts.functions,
    routine_grants: expectedProductionTarget.expected_catalog_counts.routine_grants,
  },
  schema_fingerprint: expectedProductionTarget.canonical_source_schema_fingerprint,
};
for (const expected of [
  ".before_ledger_count == $state.observed_production.production_ledger_count",
  ".before_ledger_head == $state.observed_production.ledger_head",
  ".after_ledger_count == $state.target.production_ledger_count",
  ".after_ledger_head == $state.target.source_migration_version",
  ".applied == ($state.pending_migrations | map({order, version: .source_migration_version, file, sha256}))",
  ".ledger_count == $state.target.production_ledger_count",
  ".ledger_head == $state.target.source_migration_version",
  ".counts.functions == $state.target.expected_catalog_counts.functions",
  ".counts.routine_grants == $state.target.expected_catalog_counts.routine_grants",
  ".schema_fingerprint == $state.target.canonical_source_schema_fingerprint",
]) assert.ok(build52ProductionMigrationApply.includes(expected), `production apply workflow lost exact release-state comparison: ${expected}`);
// Exercise extraction AND contamination validation together. Appending only
// after extraction cannot detect a truncated module, so these complete-step
// fixtures keep each forbidden reference after a valid NODE-prefixed label.
const observerFixtureSeam = "          const { Client } = pg;";
assert.equal(independentProductionTargetStep.split(observerFixtureSeam).length, 2);
let observerBoundaryRejections = 0;
for (const label of ["NODE_SENTINEL: {}", "NODE: {}", "NODE2: {}"]) {
  const prefixStep = independentProductionTargetStep.replace(observerFixtureSeam,
    `          ${label}\n${observerFixtureSeam}`);
  const prefixSource = extractIndependentObserver(prefixStep);
  assert.ok(prefixSource.includes(label));
  assert.ok(prefixSource.includes("process.stdout.write"), "a NODE-prefixed label must not truncate observation");
  assertIndependentObserver(prefixSource);
  for (const forbidden of ["build52-production-migration-result.json", "result_path",
    "production-migration-state.json", "target_catalog_fingerprint"]) {
    const contaminatedStep = prefixStep.replace(observerFixtureSeam,
      `          const observerGuardProbe = ${JSON.stringify(forbidden)};\n${observerFixtureSeam}`);
    assert.throws(() => assertIndependentObserver(extractIndependentObserver(contaminatedStep)),
      /observed production state must come from the actual database/);
    observerBoundaryRejections++;
  }
}
for (const closingLine of ["          NODE_SUFFIX", "         NODE", "          NODE trailing"]) {
  const unterminatedStep = independentProductionTargetStep.replace(/^ {10}NODE$/m, closingLine);
  assert.throws(() => extractIndependentObserver(unterminatedStep), /one explicit complete inline module/);
  observerBoundaryRejections++;
}
assert.throws(() => extractIndependentObserver(`${independentProductionTargetStep}\n${independentProductionTargetStep}`),
  /one explicit complete inline module/);
observerBoundaryRejections++;
console.log(`INDEPENDENT_OBSERVER_FULL_BOUNDARY_REJECTIONS_PASS ${observerBoundaryRejections}`);

const productionTargetFixtureDirectory = mkdtempSync(join(tmpdir(), "custodial-b010-jq-"));
try {
  const inlineVerifierPath = join(productionTargetFixtureDirectory, "post-apply-verifier.mjs");
  writeFileSync(inlineVerifierPath, `${independentObserverSource.replace(/^ {10}/gm, "")}\n`, { mode: 0o600 });
  const syntaxResult = spawnSync(process.execPath, ["--check", inlineVerifierPath], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(syntaxResult.error, undefined,
    `the independent verifier syntax check could not execute: ${syntaxResult.error?.message || "unknown error"}`);
  assert.equal(syntaxResult.status, 0,
    `the independent verifier must parse as an ES module: ${syntaxResult.stderr || syntaxResult.stdout}`);
  const productionTargetFixturePath = join(productionTargetFixtureDirectory, "observed-target.json");
  function workflowAcceptsProductionTarget(overrides = {}) {
    writeFileSync(
      productionTargetFixturePath,
      `${JSON.stringify({ ...acceptedProductionTarget, ...overrides })}\n`,
      { mode: 0o600 },
    );
    const result = spawnSync("jq", ["-e", "--slurpfile", "release_state", releaseStatePath, independentTargetPredicate, productionTargetFixturePath], {
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(result.error, undefined, `jq could not execute the workflow predicate: ${result.error?.message || "unknown error"}`);
    return result.status === 0;
  }
  assert.equal(workflowAcceptsProductionTarget(), true,
    "the exact frozen B-010 production target must pass the workflow-owned predicate");
  for (const [field, overrides] of [
    ["format", { format: "candidate-result.v1" }],
    ["ok", { ok: false }],
    ["source", { source: "candidate-result" }],
    ["ledger_count", { ledger_count: expectedProductionTarget.production_ledger_count - 1 }],
    ["ledger_head", { ledger_head: expectedProductionSource.ledger_head }],
    ["functions", { counts: { functions: expectedProductionSource.catalog_counts.functions, routine_grants: expectedProductionTarget.expected_catalog_counts.routine_grants } }],
    ["routine_grants", { counts: { functions: expectedProductionTarget.expected_catalog_counts.functions, routine_grants: expectedProductionSource.catalog_counts.routine_grants } }],
    ["schema_fingerprint", { schema_fingerprint: expectedProductionSource.catalog_privilege_fingerprint }],
  ]) {
    assert.equal(workflowAcceptsProductionTarget(overrides), false,
      `the workflow-owned production target predicate must fail closed for wrong ${field}`);
  }
} finally {
  rmSync(productionTargetFixtureDirectory, { recursive: true, force: true });
}
const productionBackupSource = readFileSync(resolve(root, "scripts/production-backup.mjs"), "utf8");
const productionBackupPgDumpCommand = readFileSync(resolve(root, "scripts/production-backup-pg-dump-command.mjs"), "utf8");
const isolatedRehearsalBackendDependencies = readFileSync(resolve(root, "scripts/verify-isolated-rehearsal-backend-dependencies.sh"), "utf8");
const rehearsalJsonEndpointWaiter = readFileSync(resolve(root, "scripts/wait-rehearsal-json-endpoint.sh"), "utf8");
const productionSourceRoleCatalog = readFileSync(resolve(root, "supabase/canonical/production-source-role-catalog.sql"), "utf8");
const emptyDatabaseRebuild = readFileSync(resolve(root, "scripts/empty-database-rebuild-check.mjs"), "utf8");
const productionBackupRehearsalJob = workflowJobs(productionBackupRehearsal).find(({ name }) => name === "rehearse");
assert.ok(productionBackupRehearsalJob, "the production-backup rehearsal must retain its rehearse job");
assert.ok(
  Math.max(...workflowRunSteps(productionBackupRehearsalJob.source).map((source) => source.replace(/^ {10}/gm, "").length)) < 19_000,
  "every production-backup rehearsal run expression must retain margin below GitHub's 21,000-character limit",
);
assert.match(productionBackupRehearsal, /RESTORE_DATABASE_ONLY=true[\s\S]*release:observed-production-schema:preflight[\s\S]*release:migrations:apply[\s\S]*release:target-schema:preflight/,
  "the production-backup rehearsal must prove the restored pre-migration state, apply the signed plan, and only then check the target fingerprint");
assert.doesNotMatch(productionBackupRehearsal, /SUPABASE_DB_URL:\s*\$\{\{\s*secrets\.SUPABASE_DB_URL/,
  "the production-backup rehearsal must not read live production while reconstructing the signed archive");
assert.doesNotMatch(productionBackupRehearsal, /\bpg_dump\b/,
  "the production-backup rehearsal must restore its signed archive schema instead of dumping a fresh production schema");
assert.match(productionBackupRehearsal, /memphis-zoo-disaster-recovery\.v4/,
  "the independent rehearsal must require the signed v4 archive");
assert.match(productionBackupRehearsal, /test "\$source_commit" = "\$GITHUB_SHA"/,
  "the independent rehearsal must bind the archived source commit to its workflow target");
assert.match(productionBackupRehearsal, /git rev-parse HEAD\^\{tree\}[\s\S]*"\$source_tree"/,
  "the independent rehearsal must bind the archived source tree to its checkout");
assert.match(productionBackupRehearsal, /inventory\/application-schema\.sql[\s\S]*restore:prepare-isolated[\s\S]*restore:intent[\s\S]*RESTORE_APPLY=true/,
  "the independent rehearsal must restore signed schema/control state before applying signed application data");
assert.match(productionBackupRehearsal, /RESTORE_REHEARSAL_ACCEPT_EMPTY_TARGET=true[\s\S]*restore:reconcile-isolated[\s\S]*custodial_configure_backend_execution_key/,
  "the independent rehearsal must explicitly reconcile its disposable empty target before exercising recovered application writers");
assert.match(productionBackupRehearsal, /restore:reconcile-isolated[\s\S]*verify-isolated-source-lease-state\.mjs[\s\S]*release:observed-production-schema:preflight[\s\S]*release:migrations:apply/,
  "the independent rehearsal must verify the signed-ledger-aware permanent-table/shim distinction before baseline fingerprinting");
assert.match(productionBackupRehearsal, /test:feedback-reader-database[\s\S]*npm start[\s\S]*feedback_first_http_status[\s\S]*feedback_replay_http_status/,
  "the recovered application pair must prove bounded feedback reader authority before exact HTTP write and replay");
assert.equal(
  (productionBackupRehearsal.match(/env -u REHEARSAL_OPS_MANAGER_SESSION_SECRET/g) || []).length,
  2,
  "both recovered production-like runtimes must remove the rehearsal alias before validating the independent manager-session secret",
);
assert.equal(
  (productionBackupRehearsal.match(/bash scripts\/wait-rehearsal-json-endpoint\.sh/g) || []).length,
  3,
  "backend liveness and both static runtime gates must use the bounded reusable JSON waiter",
);
assert.match(rehearsalJsonEndpointWaiter,
  /--fail --silent --show-error --connect-timeout 2 --max-time 5[\s\S]*jq -e "\$predicate"/,
  "the reusable rehearsal waiter must require successful HTTP plus the exact caller-owned JSON predicate");
assert.match(productionBackupRehearsal,
  /bash scripts\/verify-isolated-rehearsal-backend-dependencies\.sh[\s\S]*health\/dependencies[\s\S]*"\$backend_dependencies_file" "\$target_fingerprint"/,
  "the restored backend must use the bounded exact-state dependency verifier");
assert.match(isolatedRehearsalBackendDependencies,
  /status=.*curl --silent --show-error[\s\S]*--output "\$response_file" --write-out '%\{http_code\}'[\s\S]*test "\$status" = '503'/,
  "the restored backend must preserve and require the expected fail-closed dependency response instead of treating HTTP 503 as a transport failure");
assert.doesNotMatch(`${productionBackupRehearsal}\n${isolatedRehearsalBackendDependencies}`, /curl[^\n]*--fail[^\n]*health\/dependencies|curl[^\n]*health\/dependencies[^\n]*--fail/,
  "the rehearsal dependency probe must inspect the intentional HTTP 503 response body rather than discard it with curl --fail");
const targetFingerprintInitialization = productionBackupRehearsal.indexOf("target_fingerprint=\"$(tr -d '\\r\\n' < supabase/canonical/schema-fingerprint.txt)\"");
assert.notEqual(targetFingerprintInitialization, -1,
  "the rehearsal must initialize the exact source-controlled target fingerprint");
assert.ok(
  targetFingerprintInitialization < productionBackupRehearsal.indexOf("bash scripts/verify-isolated-rehearsal-backend-dependencies.sh"),
  "the exact target fingerprint must be initialized before the set -u dependency probe reads it",
);
assert.match(isolatedRehearsalBackendDependencies,
  /\.ok == false[\s\S]*\.process_alive == true[\s\S]*\.database_reachable == true[\s\S]*\.read_authority_ready == true[\s\S]*\.required_schema_present == true[\s\S]*\.release_canary\.configured == false[\s\S]*\.device_credential_secret\.ready == false[\s\S]*\.device_credential_secret\.active_credentials == 0[\s\S]*\.device_credential_secret\.confirmed_credentials == 0[\s\S]*\.device_credential_secret\.unconfirmed_credentials == 0[\s\S]*\.device_credential_secret\.matching_credentials == 0[\s\S]*\.device_credential_secret\.unmarked_credentials == 0[\s\S]*\.device_credential_secret\.mismatched_credentials == 0[\s\S]*\.device_credential_secret\.reason == "no_active_device_credentials"[\s\S]*\.worker\.durable_database_leases == true[\s\S]*\.schema_fingerprint == \$target_fingerprint/,
  "the isolated rehearsal must accept only the exact intentional credential-revocation 503 while proving every other dependency invariant");
assert.match(productionBackupRehearsal,
  /backend_dependencies_http_status\":503[\s\S]*backend_dependency_invariants_ready\":true[\s\S]*backend_device_credentials_intentionally_revoked\":true[\s\S]*backend_device_credential_reason\":\"no_active_device_credentials/,
  "the rehearsal receipt must distinguish intentionally revoked device admission from production dependency readiness");
assert.doesNotMatch(productionBackupRehearsal, /backend_dependencies_ready\":true/,
  "the rehearsal must not claim that the restored backend is production-ready before device credentials are re-enrolled");
assert.match(productionBackupRehearsal, /expires_at>clock_timestamp\(\)[\s\S]*active_mutation_leases[\s\S]*expired_mutation_leases/,
  "the recovered pair must distinguish live mutation leases from expired fail-closed blockers");
assert.match(productionBackupRehearsal, /test "\$active_mutation_leases" = '0'[\s\S]*test "\$expired_mutation_leases" = '0'/,
  "the exact recovered pair must prove that neither active nor expired mutation leases remain");
assert.match(productionBackupRehearsal, /RELEASE_MIGRATION_REHEARSAL=true[\s\S]*RELEASE_MIGRATION_SOURCE_LEDGER_SHA256/,
  "the isolated mutator must bind the complete signed source ledger while production requires separate authorization");
assert.match(productionBackupRehearsal, /cron\.database_name="\$database"/,
  "the production-backup rehearsal must bind pg_cron to its isolated restored database");
assert.match(productionBackupRehearsal, /cron\.launch_active_jobs=off/,
  "the production-backup rehearsal must retain cron catalog evidence without executing archived jobs");
assert.match(productionBackupRehearsal, /-p 127\.0\.0\.1::5432[\s\S]*listen_addresses='\*'[\s\S]*local_db_url="postgresql:\/\/supabase_admin:postgres@127\.0\.0\.1:/,
  "the production-backup rehearsal must expose Postgres only on runner loopback while making the mapped container interface reachable");
assert.match(productionBackupRehearsal, /State\.Health[\s\S]*test "\$healthy" = 'true'[\s\S]*sleep 10[\s\S]*createdb/,
  "the production-backup rehearsal must survive the Supabase image's first-boot restart before creating its database");
assert.match(productionBackupRehearsal, /production-source-role-catalog\.sql[\s\S]*source_roles_reconciled[\s\S]*createdb/,
  "the production-backup rehearsal must reproduce production ownership roles before restoring the accepted source schema");
for (const role of [
  "memphis_zoo_backup",
  "supabase_functions_admin",
  "supabase_privileged_role",
  "supabase_realtime_admin",
  "custodial_application_reader",
  "custodial_readonly_runtime_20260822",
  "static_weekly_control_plane",
  "static_weekly_release_operator",
  "static_weekly_runtime_20260823",
]) {
  assert.match(productionSourceRoleCatalog, new RegExp(`create role ${role}`),
    `the production source role catalog must include ${role}`);
}
assert.match(productionSourceRoleCatalog, /set role postgres;[\s\S]*grant pg_read_all_data to memphis_zoo_backup;[\s\S]*reset role;/,
  "the rehearsal role catalog must preserve the production backup membership grantor without storing credentials");
assert.match(productionSourceRoleCatalog, /grant custodial_application_reader to custodial_readonly_runtime_20260822;/,
  "the rehearsal role catalog must preserve the enrolled application's read-only login edge");
assert.match(productionSourceRoleCatalog, /grant static_weekly_control_plane to static_weekly_runtime_20260823[\s\S]*with inherit false;/,
  "the rehearsal role catalog must preserve the static-weekly NOINHERIT runtime edge");
assert.match(productionSourceRoleCatalog, /alter role static_weekly_runtime_20260823[\s\S]*connection limit 4;/,
  "the rehearsal role catalog must preserve the bounded static-weekly login shell");
assert.doesNotMatch(productionSourceRoleCatalog, /\b(?:create|alter)\s+role[^;]*\bpassword\b/i,
  "the rehearsal role catalog must never contain production password material");
assert.match(emptyDatabaseRebuild, /shared_preload_libraries=pg_cron,pg_net,pg_stat_statements[\s\S]*cron\.launch_active_jobs=off/,
  "the clean-rebuild test must retain cron catalog evidence without letting wall-clock jobs mutate its disposable fixtures");
assert.match(productionBackupRehearsal, /oom_killed=\{\{\.State\.OOMKilled\}\}[\s\S]*docker logs --timestamps --tail 2000[\s\S]*production-backup-migration-rehearsal-postgres\.log/,
  "the production-backup rehearsal must retain bounded Postgres failure evidence instead of retrying blind");
assert.equal((productionBackupRehearsal.match(/202608\d+_[a-z0-9_]+\.sql/g) || []).length, 0,
  "the production-backup rehearsal migration scope must come from signed inventory, never a hard-coded stale list");
assert.match(productionBackupRehearsal, /target_migration_head=.*production-migration-state\.json[\s\S]*target_migration_count=.*production-migration-state\.json[\s\S]*test "\$target_migration_head" != "\$migration_head"/,
  "the restored backup must advance from its archived ledger to the exact source-declared target ledger");
assert.match(productionBackupRehearsal, /custodial_configure_backend_execution_key[\s\S]*custodial_configure_native_route_proof_key[\s\S]*custodial_backend_authority_health/,
  "the production-backup rehearsal must configure both secret boundaries and prove final authority health");
assert.match(productionBackupRehearsal, /set role service_role; truncate public\.sessions/,
  "the production-backup rehearsal must attack direct terminal DML after migration");
assert.match(productionBackupRehearsal,
  /RELEASE_REHEARSAL_ATTESTATION_SIGNING_KEY:[\s\S]*release:migrations:attest-rehearsal[\s\S]*production-backup-migration-rehearsal-attestation\.json/,
  "the exact successful rehearsal receipt must be independently signed and retained with GitHub run provenance");
assert.equal(parsedPackageManifest.scripts["release:migrations:rehearse-local"],
  "bash scripts/run-production-backup-migration-rehearsal.sh",
  "the task-local rehearsal must have one maintained package entry point");
assert.match(localProductionBackupRehearsal,
  /-e POSTGRES_PASSWORD=postgres -e PGPASSWORD=postgres[\s\S]*"\$image" postgres -D \/etc\/postgresql/,
  "the isolated image must retain its Supautils configuration and transport its own local test password to docker-exec clients");
assert.match(localProductionBackupRehearsal,
  /createdb -U supabase_admin -O postgres -T template0 "\$database"/,
  "the isolated database must preserve the observed production postgres owner without elevating the role");
for (const owningRehearsal of [localProductionBackupRehearsal, productionBackupRehearsal]) {
  assert.match(owningRehearsal, /-e POSTGRES_PASSWORD=postgres -e PGPASSWORD=postgres[\s\S]*"\$image" postgres -D \/etc\/postgresql/);
  assert.match(owningRehearsal, /createdb -U supabase_admin -O postgres -T template0 "\$database"/);
  assert.match(owningRehearsal,
    /RESTORE_SOURCE_DIR="\$backup_dir"[\s\S]*restore:verify[\s\S]*restore-isolated-event-owner-schema\.mjs[\s\S]*restore:prepare-isolated/,
    "both owning restore paths must authenticate the unchanged archive before executing scoped event-owner restoration");
  assert.match(owningRehearsal,
    /restore:reconcile-isolated[\s\S]*verify-isolated-source-lease-state\.mjs[\s\S]*release:observed-production-schema:preflight/);
  assert.doesNotMatch(owningRehearsal, /to_regclass\('custodial_dr\.application_mutation_leases'\) is null/,
    "a blanket absence assertion must never reject or delete the signed permanent lease table");
}
for (const required of [
  /RESTORE_DATABASE_ONLY=true[\s\S]*release:observed-production-schema:preflight[\s\S]*release:migrations:apply[\s\S]*release:target-schema:preflight/,
  /test:feedback-reader-database[\s\S]*npm start[\s\S]*feedback_first_http_status[\s\S]*feedback_replay_http_status/,
  /active_mutation_leases[\s\S]*expired_mutation_leases[\s\S]*authority_health[\s\S]*direct_dml_denied/,
  /release:migrations:attest-rehearsal/,
]) {
  assert.match(localProductionBackupRehearsal, required,
    "the task-local runner must preserve the complete isolated restore/migrate/runtime/write/replay attestation path");
}
assert.match(localProductionBackupRehearsal,
  /git rev-parse HEAD[\s\S]*git rev-parse 'HEAD\^\{tree\}'[\s\S]*git status --porcelain/,
  "the task-local rehearsal must bind a clean exact candidate commit and tree before reading its archive");
assert.match(localProductionBackupRehearsal,
  /provenance_kind.*task-local[\s\S]*local_execution_id[\s\S]*archive_local_only.*true[\s\S]*external_uploads.*0/,
  "the local receipt must truthfully distinguish local-only evidence from GitHub provenance");
assert.match(localProductionBackupRehearsal,
  /cleanup\(\)[\s\S]*docker rm -f[\s\S]*memphis-build52-rehearsal\.\*[\s\S]*trap cleanup EXIT INT TERM/,
  "the local rehearsal must own and clean its processes, containers, and decrypted temporary archive");
assert.match(localProductionBackupRehearsal,
  /umask 077[\s\S]*Refusing to overwrite rehearsal output/,
  "the task-local rehearsal must create private evidence and refuse duplicate-run output replacement");
assert.doesNotMatch(localProductionBackupRehearsal, /gh\s+(?:api|run|workflow)|actions\/upload-artifact|api\.github\.com\/.*artifacts/i,
  "the local rehearsal runner must not contain an external upload path");
assert.match(build52ProductionMigrationApply,
  /evidence_mode:[\s\S]*github-actions[\s\S]*task-local/,
  "the production migration workflow must require an explicit evidence mode");
assert.equal((build52ProductionMigrationApply.match(/if: inputs\.evidence_mode == 'github-actions'/g) || []).length, 2,
  "only GitHub evidence mode may download the two private artifacts");
assert.match(build52ProductionMigrationApply,
  /BUILD52_TASK_LOCAL_RELEASE_MIGRATION_AUTHORIZATION_JSON[\s\S]*authorization_sha256[\s\S]*provenance_kind == "task-local"/,
  "task-local evidence mode must consume only a hash-bound short-lived authorization secret");
const productionMigrationArtifactUpload = build52ProductionMigrationApply.slice(
  build52ProductionMigrationApply.lastIndexOf("- uses: actions/upload-artifact"),
);
assert.doesNotMatch(productionMigrationArtifactUpload, /build52-production-migration-authorization\.json/,
  "the short-lived production authorization must never be uploaded as an artifact");
assert.match(build52ProductionMigrationApply,
  /BUILD52_TASK_LOCAL_RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY[\s\S]*BUILD52_TASK_LOCAL_RELEASE_MIGRATION_AUTHORIZATION_VERIFY_KEY_ID/,
  "task-local apply must use dedicated ephemeral verification authority without overwriting the established GitHub evidence signer");
assert.match(productionBackupSource, /BACKUP_PG_DUMP_NETWORK_HOST[\s\S]*productionBackupPgDumpDockerArgs/,
  "the backup source must route Docker network selection through its tested argument builder");
assert.match(productionBackupPgDumpCommand,
  /TASK_LOCAL_PRODUCTION_DATABASE_HOST = "db\.rqquvtjdmugpigbndmne\.supabase\.co"/,
  "host networking must retain the certificate-valid production hostname instead of an IPv6 literal");
assert.match(productionBackupPgDumpCommand,
  /networkHost && \(executionMode !== "task-local" \|\| normalizedHost !== TASK_LOCAL_PRODUCTION_DATABASE_HOST\)[\s\S]*PGSSLMODE=verify-full[\s\S]*PGSSLROOTCERT=\/cert\/prod-ca\.crt/s,
  "Docker host networking must remain limited to task-local access for the exact verified-TLS production hostname");
assert.match(parsedPackageManifest.scripts["test:ci-workflows"], /production-backup-pg-dump-command-tests\.mjs/,
  "the Foundation workflow contract suite must execute the focused pg_dump argument test");
assert.match(parsedPackageManifest.scripts["test:ci-workflows"], /isolated-event-owner-schema-tests\.mjs/,
  "the Foundation workflow contract suite must execute scoped event-owner lexical/reset coverage");

const workflowFixture = (commands) => `name: fixture\njobs:\n  validate:\n    steps:\n      - run: |\n${commands.map((command) => `          ${command}`).join("\n")}\n`;
assert.doesNotThrow(() => assertExactCommandsInJob(
  workflowFixture([
    "docker pull supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed",
    "npm run --silent test:integrated-backend-authority-release-provenance",
  ]),
  "validate",
  [
    "docker pull supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed",
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



const productionReleaseRecorder = readFileSync(resolve(workflowDirectory, "production-release-deployment-record.yml"), "utf8");
assert.match(productionReleaseRecorder, /^on:\n\s+workflow_dispatch:/m,
  "production release identity recording must remain an explicit manual gate");
function assertManualRecorderTrigger(source) {
  const triggerBlock = source.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(triggerBlock, "recorder trigger block must be explicit");
  const triggers = [...triggerBlock.matchAll(/^  ([a-z_]+):/gm)].map(match => match[1]);
  assert.deepEqual(triggers, ["workflow_dispatch"], "recorder must have only its manual trigger");
}
assertManualRecorderTrigger(productionReleaseRecorder);
for (const trigger of ["push", "schedule", "pull_request"]) {
  const mutant = productionReleaseRecorder.replace("  workflow_dispatch:", `  ${trigger}: {}\n  workflow_dispatch:`);
  assert.throws(() => assertManualRecorderTrigger(mutant), /only its manual trigger/);
}
assert.match(productionReleaseRecorder, /mode:[\s\S]*options:[\s\S]*- plan[\s\S]*- apply/,
  "release identity recording must expose separate plan and apply phases");
assert.match(productionReleaseRecorder, /EXPECTED_PLAN_SHA256[\s\S]*\^\[0-9a-f\]\{64\}\$/,
  "apply must require the exact reviewed plan digest");
assert.match(productionReleaseRecorder, /test "\$GITHUB_SHA" = "\$CANDIDATE_COMMIT"[\s\S]*git rev-parse HEAD\^\{tree\}/,
  "release recorder workflow must bind exact commit and tree");
assert.match(productionReleaseRecorder, /MEMPHIS_RELEASE_ATTESTATION_JSON[\s\S]*chmod 0444/,
  "release recorder must materialize the signed release attestation read-only");
assert.match(productionReleaseRecorder, /DISASTER_RECOVERY_RUNTIME_CONFIGURATION_JSON/,
  "release recorder must consume the same recovery configuration used by backups");
assert.match(productionReleaseRecorder, /release:production-deployment:record -- --apply/,
  "apply mode must invoke the guarded recorder and not inline production SQL");
assert.doesNotMatch(productionReleaseRecorder, /service_role|SUPABASE_SERVICE_ROLE_KEY/i,
  "release recorder workflow must not add a service-role-key bypass");

const executionBoundary = spawnSync(process.execPath, [resolve(root, "scripts/reviewed-regression-execution-tests.mjs")],
  { cwd: root, encoding: "utf8", timeout: 45000 });
assert.equal(executionBoundary.status, 0, executionBoundary.stdout + executionBoundary.stderr);
console.log(executionBoundary.stdout.trim());
console.log(JSON.stringify({ ok: true, workflows_checked: workflowNames.length, direct_and_surrounding_mutants: reviewedMutationCount }, null, 2));
