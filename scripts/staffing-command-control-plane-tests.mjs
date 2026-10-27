import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createStaticWeeklyControlPlane } from '../src/static-weekly-control-plane.js';
const require = createRequire(import.meta.url);
const { prepareValue } = require('pg/lib/utils');

if (process.argv.includes('--audit-absence-permission-only')) {
  const id=n=>`99000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const manager={manager_id:id(1),manager_display_name:'Synthetic delegated manager',credential_id:id(2),
    device_id:'synthetic-test',auth_mode:'trusted_device',access_level:'read_only',read_only:true,
    permissions:{schema:'custodial.manager-permissions.v1',read:true,owner:false,manage_absences:true}};
  let kind='absence',preparer=manager.manager_id;const queries=[];
  const command=()=>({operation_id:id(3),state:'PREPARED',prepared_by_manager_id:preparer,semantic_body:{commandKind:kind}});
  const client={async query(statement,values=[]){queries.push({statement,values});
    if(statement.includes('custodial_action_actor_v1'))return{rows:[{result:{manager_id:manager.manager_id,credential_id:manager.credential_id,device_id:manager.device_id,owner:false}}]};
    if(statement.includes('static_weekly_v10_read_staffing_command'))return{rows:[{result:command()}]};
    if(statement.includes('static_weekly_v10_list_pending_staffing_commands'))return{rows:[{result:{commands:[command(),{...command(),prepared_by_manager_id:id(8)}],limit:50}}]};
    return{rows:[{result:{operation_id:id(3),state:'ACCEPTED'}}]};},release(){},on(){},removeListener(){}};
  const plane=createStaticWeeklyControlPlane({database:{async connect(){return client;}},initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
  const run=fn=>plane.runManagerOperation({manager,permission:'manage_absences',signal:new AbortController().signal,deadlineAt:performance.now()+10000},fn);
  const input={manager,commandKind:'absence',employeeId:id(4),startDate:'2026-10-14',endDate:'2026-10-20',absenceKind:'pto',clientPrepareKey:id(5),expectedRevision:7};
  let checks=0;try{
    await run(()=>plane.beginStaffingCommand(input));checks++;
    assert.equal(queries.find(q=>q.statement.includes('static_weekly_v10_begin_staffing_command')).values[0].endDate,'2026-10-20');checks++;
    const original={manager,operationId:id(3)};
    for(const fn of [()=>plane.prepareStaffingCommand(original),()=>plane.getStaffingCommand(original),
      ()=>plane.getStaffingDeliveryStatus(original),()=>plane.acceptStaffingCommand({...original,previewDigest:'a'.repeat(64),confirmationKey:id(6)}),
      ()=>plane.cancelStaffingPreparation(original)]){await run(fn);checks++;}
    const pending=await run(()=>plane.listPendingStaffingCommands({manager}));assert.equal(pending.commands.length,1);checks++;
    kind='vacate_roster_slot';let before=queries.length;
    await assert.rejects(run(()=>plane.getStaffingCommand(original)),e=>e.code==='static_weekly_named_manager_required');checks++;
    await assert.rejects(run(()=>plane.acceptStaffingCommand({...original,previewDigest:'a'.repeat(64),confirmationKey:id(6)})),e=>e.code==='static_weekly_named_manager_required');checks++;
    assert.equal(queries.slice(before).some(q=>q.statement.includes('static_weekly_v11_accept_staffing_command')),false);checks++;
    kind='absence';preparer=id(8);
    await assert.rejects(run(()=>plane.cancelStaffingPreparation(original)),e=>e.code==='staffing_original_preparer_required');checks++;
    manager.permissions.manage_absences=false;before=queries.length;
    await assert.rejects(run(()=>plane.beginStaffingCommand(input)),e=>e.code==='static_weekly_named_manager_required');checks++;
    assert.equal(queries.length,before);checks++;
    console.log(JSON.stringify({checks,scope:'actual control-plane methods and transaction context with synthetic RPC results; not actual SQL/HTTP/browser'}));
  }finally{await plane.close();}
  process.exit(0);
}

if (process.argv.includes('--vacancy-preview-owned-transaction-only')) {
  const id = n => `99000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const manager = {manager_id:id(1),manager_display_name:'Synthetic current vacancy manager',
    auth_mode:'trusted_device',credential_id:id(2),device_id:'synthetic-vacancy-device',
    access_level:'full_access',read_only:false};
  const input = {manager,sourceId:id(3),slotId:id(4),employeeId:id(5),effectiveStart:'2026-10-12',
    reason:'Synthetic vacancy preview',expectedRevision:19,idempotencyKey:'synthetic-vacancy-original'};
  const cases = [];
  async function run({kind='missing-source',confirm=false,previewDigest}={}) {
    const queries=[],releases=[];let compiles=0;
    const client = {async query(statement,values=[]) {
      queries.push({statement,values});
      if (statement==='rollback'&&kind==='rollback-unavailable')
        throw Object.assign(new Error('synthetic closed SQL connection'),{code:'08006'});
      if (statement.includes('custodial_action_actor_v1')) return {rows:[{result:{...manager,owner:true}}]};
      if (statement.includes('static_weekly_v3_read_manager_snapshot')) return {rows:[{result:{
        authority_revision:19,current_service_date:kind==='changed-day'?'2026-10-13':'2026-10-12',
        current_publication:{publication_id:id(6)}}}]};
      if (statement.includes('static_weekly_v3_read_authority_source')) return {rows:[{result:
        kind==='original-status'?{source_id:id(3),compiler_input:{version:{},slots:[],proximity:[]}}:null}]};
      if (statement.includes('static_weekly_v8_vacate_roster_slot')) return {rows:[{result:{
        revision:20,data:{completion_mode:'mutation_only',original_publication_id:id(6)}}}]};
      return {rows:[]};
    },release(error){releases.push(error);},on(){},removeListener(){}};
    const plane=createStaticWeeklyControlPlane({database:{async connect(){return client;}},
      compilerPreparer:async()=>{compiles++;throw Error('No compile permitted in these denial members');},
      initializeSolver:async()=>{},getSolverReadiness:()=>({available:true})});
    let result,error;
    try {result=await plane.runManagerOperation({manager,signal:new AbortController().signal,
      deadlineAt:performance.now()+10000},()=>confirm?plane.vacateRosterSlot({...input,previewDigest})
        :plane.previewVacancyRosterSlot(input));}catch(cause){error=cause;}finally{await plane.close();}
    return {result,error,queries,releases,compiles};
  }
  for (const [kind,code] of [['missing-source','static_weekly_vacancy_source_unavailable'],
    ['changed-day','static_weekly_vacancy_preview_currentness_changed'],
    ['original-status','static_weekly_vacancy_original_status_required']]) {
    const r=await run({kind});assert.equal(r.result,undefined);assert.equal(r.error?.code,code);
    assert.equal(r.compiles,0);assert.equal(r.queries.filter(q=>q.statement==='rollback').length,1);
    assert.equal(r.queries.some(q=>q.statement==='commit'||q.statement.includes('materialize_projection')),false);
    assert.equal(r.releases.length,1);cases.push(kind+' cannot return an accepted/compiled candidate and rollback settles');
  }
  for (const previewDigest of [undefined,'caller-provided-success']) {
    const r=await run({confirm:true,previewDigest});assert.equal(r.error?.code,'static_weekly_vacancy_reviewed_preview_required');
    assert.equal(r.queries.length,0);assert.equal(r.releases.length,0);cases.push('missing/malformed review refused before database acquisition');
  }
  const broken=await run({kind:'rollback-unavailable'});
  assert.equal(broken.result,undefined);assert.equal(broken.error?.code,'static_weekly_control_plane_database_unavailable');
  assert.equal(broken.queries.some(q=>q.statement==='commit'),false);assert.ok(broken.releases[0] instanceof Error);
  cases.push('failed rollback never returns preview and discards only the broken owned client');
  console.log(JSON.stringify({cases:cases.length,names:cases,scope:'new actual CP source over synthetic RPC/connection failures; no SQL/solver/session/positive-preview proof'}));
  process.exit(0);
}

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
let seasonTargetCount = 0,denyDirectClock=false,typedCancellationDenied=false;
const client = {
  async query(statement, values = []) {
    queries.push({ statement, values });
    if (statement.includes('sch_service_date')) {
      if(denyDirectClock)throw Object.assign(new Error('permission denied for function get_setting_int'),{code:'42501'});
      return { rows: [{ service_date: '2026-09-25' }] };
    }
    if (statement.includes('static_weekly_sch022_preview_staffing_witness')) return { rows: [{ result: { digest: 'c'.repeat(64), target_week_count: seasonTargetCount } }] };
    if (statement.includes('static_weekly_sch022_stage_staffing_command')) return { rows: [{ result: stageResponse }] };
    if (statement.includes('static_weekly_v10_read_staffing_delivery_status')) return { rows: [{ result: deliveryResponse }] };
    if (statement.includes('static_weekly_v10_cancel_staffing_preparation')) return { rows: [{ result: cancelResponse }] };
    if (statement.includes('static_weekly_v11_accept_staffing_command')) return { rows: [{ result: acceptResponse }] };
    if (statement.includes('static_weekly_v10_begin_staffing_command')) {
      if(typedCancellationDenied&&values[0].commandKind==='cancel_absence')throw Object.assign(
        new Error('staffing cancellation cannot rewrite an elapsed service date'),{code:'23514'});
      return { rows: [{ result: response }] };
    }
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

if(process.argv.includes('--typed-begin-only')){
 denyDirectClock=true;
 const currentInput={...input,startDate:'2026-10-12',endDate:'2026-10-12',expectedRevision:6};
 same(await plane.beginStaffingCommand({manager,...currentInput}),response,
  'absence reaches the typed begin boundary even while the raw settings dependency is denied');
 const cancellation={...currentInput,commandKind:'cancel_absence',absenceKind:undefined,
  targetAbsenceId:'70000000-0000-4000-8000-000000000001',startDate:'2026-09-24',endDate:'2026-09-24',
  clientPrepareKey:'60000000-0000-4000-8000-000000000009'};
 same(await plane.beginStaffingCommand({manager,...cancellation}),response,
  'original cancellation identity reaches SQL replay lookup without a guessed client date');
 typedCancellationDenied=true;
 await assert.rejects(()=>plane.beginStaffingCommand({manager,...cancellation,
  clientPrepareKey:'60000000-0000-4000-8000-000000000010'}),error=>error.code==='23514');checks++;
 const beginCalls=queries.filter(row=>row.statement.includes('static_weekly_v10_begin_staffing_command'));
 same(beginCalls.length,3);same(beginCalls.every(row=>row.values.length===4&&row.values[3]===manager.manager_id),true);
 same(queries.some(row=>row.statement.includes('sch_service_date')||row.statement.includes('get_setting_int')),false);
 await plane.close();
 console.log(JSON.stringify({checks,scope:'affected actual JS control-plane calls over synthetic RPC responses; no real SQL permission/PERSISTED proof'}));
}else{
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
const stageCall = queries.find(({ statement }) => statement.includes('static_weekly_sch022_stage_staffing_command'));
same(stageCall.values.length, 7);
same(stageCall.values[0], response.operation_id);
same(typeof stageCall.values[1], 'string', 'jsonb candidates cross as JSON text, not a PostgreSQL array');
same(JSON.parse(prepareValue(stageCall.values[1])), candidates, 'only exact candidate content crosses the database boundary');
const witnessCalls = queries.filter(({ statement }) => statement.includes('static_weekly_sch022_preview_staffing_witness'));
same(witnessCalls.length, 1, 'stage obtains one current seasonal witness');
same(typeof witnessCalls[0].values[0], 'string', 'seasonal witness takes JSONB text');
same(JSON.parse(prepareValue(witnessCalls[0].values[0])), candidates, 'seasonal witness retains exact candidate content');
same(stageCall.values[5], manager.manager_id, 'staging actor comes only from the trusted session');
same(stageCall.values[6], 'c'.repeat(64), 'staged command binds the exact current catalog witness');
seasonTargetCount = 1;
await assert.rejects(() => plane.stageStaffingCommand({ manager, operationId: response.operation_id,
  window: { dates: ['2026-09-28', '2026-10-05'], weeks: ['2026-09-28', '2026-10-05'] },
  candidates, previewDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), publicationVector: { revision: 19 },
}), error => error?.code === 'static_weekly_sch022_witness_required'); checks++;
same(await plane.stageStaffingCommand({ manager, operationId: response.operation_id,
  window: { dates: ['2026-09-28', '2026-10-05'], weeks: ['2026-09-28', '2026-10-05'] },
  candidates, previewDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), publicationVector: { revision: 19 },
  seasonWitnessDigest: 'c'.repeat(64),
}), stageResponse, 'target-bearing internal stage requires the exact retained preview witness');
const allStageCalls = queries.filter(({ statement }) => statement.includes('static_weekly_sch022_stage_staffing_command'));
same(allStageCalls.length, 2, 'missing witness does not stage; valid witness stages');
same(JSON.parse(prepareValue(allStageCalls[1].values[1])), candidates, 'target-bearing retry retains exact candidate JSONB');
const allWitnessCalls = queries.filter(({ statement }) => statement.includes('static_weekly_sch022_preview_staffing_witness'));
same(allWitnessCalls.length, 3, 'ordinary, missing-witness and target-bearing stage each recheck current season');
for (const witnessCall of allWitnessCalls) {
  same(typeof witnessCall.values[0], 'string', 'every seasonal witness uses JSONB text');
  same(JSON.parse(prepareValue(witnessCall.values[0])), candidates, 'every seasonal witness retains exact candidates');
}
seasonTargetCount = 0;
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
}
