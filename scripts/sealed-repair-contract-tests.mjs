// Development checks only. This explicit list never discovers/executes new
// files, database/resource drivers, sockets, phone checks or application builds.
import {spawn} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = Object.freeze([
  'attendance-chicago-day-tests.mjs',
  'coverall-cohort-attribution-tests.mjs',
  'coverall-nonphysical-print-tests.mjs',
  'custodial-leadership-messaging-tests.mjs',
  'custodial-record-operation-tests.mjs',
  'event-reminder-source-text-tests.mjs',
  'leadership-nonexpiring-session-tests.mjs',
  'leadership-restore-generation-tests.mjs',
  'manual-period-boundary-tests.mjs',
  'memphis-cohort-actor-tests.mjs',
  'memphis-employee-operations-tests.mjs',
  'native-alert-unicode-preview-tests.mjs',
  'outlook-offsite-mapping-tests.mjs',
  'security-http-boundary-tests.mjs',
  'fixtures/source304-production-target-profile-tests.mjs',
]);
const timeoutMs = 45_000;

async function run(script) {
  const started = Date.now();
  const env = {...process.env};
  // Each script owns its node:test harness. Inheriting a parent test-worker
  // marker can suppress that harness and produce a misleading script PASS.
  delete env.NODE_TEST_CONTEXT;
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, [resolve(root, 'scripts', script)], {
      cwd:root, env, shell:false, stdio:['ignore','inherit','inherit'],
    });
    let reason = null;
    const timer = setTimeout(() => { reason = 'TIMEOUT'; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', error => { reason = error.code || 'SPAWN_ERROR'; });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const result = {script:`scripts/${script}`,status:code === 0 && !reason ? 'PASS' : 'FAIL',
        exitCode:code,signal,reason,durationMs:Date.now()-started};
      console.log(JSON.stringify({sealedRepairScript:result}));
      resolveResult(result);
    });
  });
}

const results = [];
for (const script of scripts) results.push(await run(script));
const failed = results.filter(result => result.status !== 'PASS');
console.log(JSON.stringify({suite:'sealed-repair-contracts',scripts:results.length,
  passed:results.length-failed.length,failed:failed.length,timeoutMsPerScript:timeoutMs,
  scope:'Explicit non-socket development checks; no database, provider, device or release acceptance'}));
if (failed.length) process.exitCode = 1;
