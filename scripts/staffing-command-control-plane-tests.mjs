import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStaticWeeklyControlPlane } from '../src/static-weekly-control-plane.js';

let checks = 0;
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const sourceRoot = resolve(new URL('..', import.meta.url).pathname);
const planeSource = readFileSync(resolve(sourceRoot, 'src/static-weekly-control-plane.js'), 'utf8');
const runtimeSource = readFileSync(resolve(sourceRoot, 'src/static-weekly-control-plane-runtime.js'), 'utf8');
const manager = {
  manager_id: '10000000-0000-4000-8000-000000000001',
  manager_display_name: 'Different Authorized Manager',
  auth_mode: 'trusted_device', trusted_device: true, read_only: false,
};
const input = {
  commandKind: 'absence',
  employeeId: '20000000-0000-4000-8000-000000000001',
  startDate: '2026-09-28', endDate: '2026-10-09',
  absenceKind: 'daily_absence',
  clientPrepareKey: '30000000-0000-4000-8000-000000000001',
  expectedRevision: 19,
};
const queries = [];
const response = {
  operation_id: '40000000-0000-4000-8000-000000000001',
  state: 'PREPARING', replayed: false,
};
const statusResponse = { operation_id: response.operation_id, state: 'PREPARING' };
const pendingResponse = { commands: [statusResponse], limit: 50 };
const stageResponse = { operation_id: response.operation_id, state: 'PREPARED', replayed: false };
const deliveryResponse = { operation_id: response.operation_id, targets: [] };
const cancelResponse = { operation_id: response.operation_id, state: 'CANCELLED_BY_SUCCESSOR', cancelled: true };
const acceptResponse = { operation_id: response.operation_id, event: 'ACCEPTED', authority_revision: 20, replayed: false };
const client = {
  async query(statement, values = []) {
    queries.push({ statement, values });
    if (statement.includes('sch_service_date')) return { rows: [{ service_date: '2026-09-25' }] };
    if (statement.includes('static_weekly_v10_stage_staffing_command')) return { rows: [{ result: stageResponse }] };
    if (statement.includes('static_weekly_v10_read_staffing_delivery_status')) return { rows: [{ result: deliveryResponse }] };
    if (statement.includes('static_weekly_v10_cancel_staffing_preparation')) return { rows: [{ result: cancelResponse }] };
    if (statement.includes('static_weekly_v11_accept_staffing_command')) return { rows: [{ result: acceptResponse }] };
    if (statement.includes('static_weekly_v10_begin_staffing_command')) return { rows: [{ result: response }] };
    if (statement.includes('static_weekly_v10_read_staffing_command')) return { rows: [{ result: statusResponse }] };
    if (statement.includes('static_weekly_v10_list_pending_staffing_commands')) return { rows: [{ result: pendingResponse }] };
    return { rows: [] };
  },
  release() {}, on() {}, removeListener() {},
};
const plane = createStaticWeeklyControlPlane({
  database: { async connect() { return client; } },
  compiler: async () => { throw new Error('begin must not compile'); },
  initializeSolver: async () => {}, getSolverReadiness: () => ({ available: true }),
});

same(await plane.beginStaffingCommand({ manager, ...input }), response);
const call = queries.find(({ statement }) => statement.includes('static_weekly_v10_begin_staffing_command'));
assert.ok(call, 'the durable begin RPC must own command creation'); checks++;
same(call.values.length, 4);
same(call.values[0], {
  absenceKind: 'daily_absence', commandKind: 'absence', employeeId: input.employeeId,
  endDate: input.endDate, startDate: input.startDate, targetAbsenceId: null,
});
same(call.values[1], input.clientPrepareKey);
same(call.values[2], input.expectedRevision);
same(call.values[3], manager.manager_id, 'actor comes only from trusted manager session');
assert.equal(JSON.stringify(call.values).includes(manager.manager_display_name), false); checks++;
const elapsedReplayInput={...input,commandKind:'cancel_absence',absenceKind:undefined,
  targetAbsenceId:'70000000-0000-4000-8000-000000000001',startDate:'2026-09-24',endDate:'2026-09-24',
  clientPrepareKey:'70000000-0000-4000-8000-000000000002'};
same(await plane.beginStaffingCommand({manager,...elapsedReplayInput}),response,
  'control plane delegates an elapsed authenticated retry to the database idempotency boundary');
const elapsedCall=queries.filter(({statement})=>statement.includes('static_weekly_v10_begin_staffing_command')).at(-1);
same(elapsedCall.values[0].startDate,'2026-09-24','elapsed replay preserves exact semantic bytes for database lookup');
const candidates = [
  { candidateKind: 'lunch', candidateKey: 'week:2026-09-28', serviceDate: '2026-09-28', payload: { week: 1 } },
  { candidateKind: 'projection', candidateKey: 'week:2026-09-28', serviceDate: '2026-09-28', payload: { week: 1 } },
  { candidateKind: 'lunch', candidateKey: 'week:2026-10-05', serviceDate: '2026-10-05', payload: { week: 2 } },
  { candidateKind: 'projection', candidateKey: 'week:2026-10-05', serviceDate: '2026-10-05', payload: { week: 2 } },
];
same(await plane.stageStaffingCommand({ manager, operationId: response.operation_id,
  window: { dates: ['2026-09-28', '2026-10-05'], weeks: ['2026-09-28', '2026-10-05'] },
  candidates, previewDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), publicationVector: { revision: 19 },
}), stageResponse);
const stageCall = queries.find(({ statement }) => statement.includes('static_weekly_v10_stage_staffing_command'));
same(stageCall.values.length, 6);
same(stageCall.values[0], response.operation_id);
same(stageCall.values[1], candidates, 'only exact candidate content crosses the database boundary');
same(stageCall.values[5], manager.manager_id, 'staging actor comes only from the trusted session');
same(await plane.getStaffingCommand({ manager, operationId: response.operation_id }), statusResponse);
same(await plane.listPendingStaffingCommands({ manager }), pendingResponse);
same(await plane.getStaffingDeliveryStatus({ manager, operationId: response.operation_id }), deliveryResponse);
const confirmationKey='60000000-0000-4000-8000-000000000001';
same(await plane.acceptStaffingCommand({ manager, operationId: response.operation_id,
  previewDigest:'a'.repeat(64),confirmationKey }), acceptResponse);
const acceptCall=queries.find(({statement})=>statement.includes('static_weekly_v11_accept_staffing_command'));
same(acceptCall.values,[response.operation_id,'a'.repeat(64),confirmationKey,manager.manager_id],
  'confirmation binds exact preview, one client confirmation key and authenticated manager');
same(await plane.cancelStaffingPreparation({ manager, operationId: response.operation_id }), cancelResponse);
const readCall = queries.find(({ statement }) => statement.includes('static_weekly_v10_read_staffing_command'));
same(readCall.values, [response.operation_id, manager.manager_id]);
const listCall = queries.find(({ statement }) => statement.includes('static_weekly_v10_list_pending_staffing_commands'));
same(listCall.values, [manager.manager_id, 50, null, null]);

await assert.rejects(
  plane.beginStaffingCommand({ manager, ...input, managerId: '50000000-0000-4000-8000-000000000001' }),
  error => error?.code === 'staffing_command_unknown_field',
); checks++;
await assert.rejects(
  plane.beginStaffingCommand({ manager: { ...manager, read_only: true }, ...input }),
  error => error?.code === 'static_weekly_named_manager_required',
); checks++;
assert.match(planeSource, /createStaffingCommandRequest/, 'control plane uses the canonical request boundary'); checks++;
assert.match(runtimeSource, /\/static-weekly\/staffing-commands[^\n]+requireManagerWrite, namedManager/,
  'HTTP begin route uses current trusted named-manager write middleware'); checks++;
assert.match(runtimeSource, /\/static-weekly\/staffing-commands\/pending[^\n]+requireManagerWrite, namedManager/,
  'pending recovery route uses current trusted named-manager write middleware'); checks++;
assert.match(runtimeSource, /\/static-weekly\/staffing-commands\/:operationId[^\n]+requireManagerWrite, namedManager/,
  'operation recovery route uses current trusted named-manager write middleware'); checks++;
assert.match(runtimeSource, /\/static-weekly\/staffing-commands\/:operationId\/confirm[^\n]+requireManagerWrite, namedManager/,
  'atomic confirmation route uses current trusted named-manager write middleware'); checks++;
assert.doesNotMatch(runtimeSource, /manager_id:\s*req\.body/, 'HTTP body cannot supply manager actor'); checks++;
await plane.close();
console.log(JSON.stringify({ status: 'PASS', checks,
  scope: 'authenticated durable staffing-command begin and private staging boundary; no compiler orchestration, confirm, publication, delivery or phone proof' }));
