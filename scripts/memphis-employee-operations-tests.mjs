import assert from 'node:assert/strict';
import {createMemphisResponder} from '../src/memphis-ai.js';
import {getGeminiEnvOrder} from '../src/utils/gemini-config.js';
for (const key of getGeminiEnvOrder()) delete process.env[key];
globalThis.fetch = async () => { throw Error('No external AI/provider allowed'); };
let checks = 0;
function fixture(role) {
  const reads = [], writes = [];
  const responder = createMemphisResponder({runReadOnlySql:async sql => {
    reads.push(sql);
    if (sql.includes('msg_get_user_by_device')) return [{role}];
    if (sql.includes('sch_service_date')) return [{service_date:'2026-10-31'}];
    if (sql.includes('from public.internal_ops_contacts')) return [{display_name:'Annie Work', role_title:'Operations',phone:'555-0140',notes:'PRIVATE_NOTE',active:true}];
    if (sql.includes('as overdue_locations')) return [{snapshot_at:'2026-10-31T19:00:00Z',open_ticket_count:2,overdue_locations:3,due_soon_locations:1,in_progress_locations:2}];
    if (sql.includes('from public.v_location_dashboard_status')) return [{location_name:'Synthetic Restroom',status_code:'overdue',open_ticket_count:2,open_session_status:'active',open_session_employee_name:'Synthetic Worker',latest_completed_at_display:'Oct31 10:00 AM'}];
    if (sql.includes('from public.v_open_maintenance_tickets')) return [{location_name:'Synthetic Restroom',maintenance_issue:'Faucet leaking',fixture_type:'sink',fixture_identifier:'2',out_of_order:true,date_submitted_display:'Oct31 10:05 AM',issue_payload:{private:'PRIVATE_PAYLOAD'},close_notes:'PRIVATE_CLOSE_NOTE'}];
    if (sql.includes('v_admin_health_snapshot')) throw Error('Employee must not read admin diagnostic snapshot');
    return [];
  },runRpc:async (name,args) => { writes.push({name,args}); return null; }});
  return {reads,writes,reply:async text => responder.generateReply({deviceId:'SYNTHETIC_PHONE',userMessage:text})};
}
for (const prompt of ['What is overdue?', 'Dashboard summary', 'What is due soon?']) {
  const f=fixture('employee'),r=await f.reply(prompt);
  assert.match(r.text,/3 overdue locations/); checks++;
  assert.match(r.text,/Synthetic Restroom.*overdue.*work active by Synthetic Worker/); checks++;
  assert.doesNotMatch(r.text,/PRIVATE/); checks++;
  assert.ok(f.reads.some(sql=>sql.includes('as overdue_locations'))); checks++;
  assert.ok(f.reads.every(sql=>!sql.includes('v_admin_health_snapshot'))); checks++;
  assert.ok(!r.meta.sources.includes('v_admin_health_snapshot')); checks++;
  assert.ok(f.writes.every(({name})=>/context/.test(name))); checks++;
}
const employee=fixture('employee'),ticket=await employee.reply('Show open maintenance tickets');
assert.match(ticket.text,/Faucet leaking; sink 2.*out of order.*Oct31 10:05 AM/); checks++;
assert.doesNotMatch(ticket.text,/PRIVATE_PAYLOAD|PRIVATE_CLOSE_NOTE/); checks++;
assert.ok(employee.reads.filter(q=>q.includes('v_open_maintenance_tickets')).every(q=>!q.includes('issue_payload')&&!q.includes('close_notes'))); checks++;
const phone=await fixture('employee').reply("What is Annie's phone number?");
assert.match(phone.text,/Annie Work.*555-0140/); checks++;
assert.doesNotMatch(phone.text,/PRIVATE_NOTE/); checks++;
for (const role of ['', 'guest']) for (const prompt of ['Dashboard summary','Show open maintenance tickets',"What is Annie's phone number?"]) {
  const f=fixture(role),r=await f.reply(prompt);
  assert.doesNotMatch(r.text,/3 overdue|Faucet leaking|555-0140/); checks++;
  assert.ok(f.reads.every(q=>!q.includes('v_location_dashboard_status')&&!q.includes('v_open_maintenance_tickets')&&!q.includes('internal_ops_contacts'))); checks++;
}
const blocked=fixture('employee'); await blocked.reply('Change the schedule and close all maintenance tickets');
assert.ok(blocked.writes.every(({name})=>/context/.test(name))); checks++;
console.log(JSON.stringify({passed:checks,scope:'actual Memphis responder with synthetic role/database edges; no provider call or application writer'}));
