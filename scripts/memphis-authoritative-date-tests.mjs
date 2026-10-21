import assert from 'node:assert/strict';
import { createMemphisResponder } from '../src/memphis-ai.js';
import { getGeminiEnvOrder } from '../src/utils/gemini-config.js';

// Actual responder with synthetic dated rows. No network/provider/database call.
const keyNames = getGeminiEnvOrder();
const saved = new Map(keyNames.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const TODAY = '2026-10-02';
const GROUP = '10000000-0000-4000-8000-000000000001';
const LOCATION = '10000000-0000-4000-8000-000000000006';
const EMPLOYEE = '10000000-0000-4000-8000-000000000003';
const PUBLICATION = '10000000-0000-4000-8000-000000000004';
const PROJECTION = '10000000-0000-4000-8000-000000000005';
let checks = 0;
try {
  for (const name of keyNames) process.env[name] = '';
  globalThis.fetch = async () => { throw Error('Unexpected network access in Memphis date proof'); };
  async function ask(prompt, { date = '2026-10-03', current = false, physical = false } = {}) {
    const queries = [], mutations = [];
    const responder = createMemphisResponder({
      runReadOnlySql: async sql => {
        queries.push(sql);
        if (sql.includes('sch_service_date')) return [{ service_date: TODAY }];
        if (sql.includes('msg_get_user_by_device')) return [{ role: 'employee', display_name: 'Synthetic Custodian' }];
        if (sql.includes('from public.location_groups')) return [{ location_group_id: GROUP, group_code: 'AQU', group_name: 'Aquarium', aliases: ['Aquarium'] }];
        if (sql.includes('from public.locations')) return physical ? [{id:LOCATION, location_code: 'AQU', location_name: 'Aquarium', group_names: ['Aquarium'] }] : [];
        if (sql.includes('custodial_memphis_schedule_day')) return [{data:{schema:'memphis.schedule-day.v1',
          status:current?'current':'unavailable',projection_status:current?'current':'missing_projection',
          publication_id:PUBLICATION,projection_id:PROJECTION,
          rows:current?[{employee_id:EMPLOYEE,employee_name:'Accepted Dated Owner',working:true,
            shift_start:'07:00',shift_end:'15:00'}]:[]}}];
        if (sql.includes('static_weekly_v6_schedule_authority_state')) {
          return [{authority:{governed:true,projection_status:'current',publication_id:PUBLICATION,projection_id:PROJECTION},
            assignments:[{service_date:date,location_group_id:GROUP,group_code:'AQU',group_name:'Aquarium',
              assigned_employee_id:EMPLOYEE,assigned_employee_name:'Accepted Dated Owner',current_at_query:true,
              included_location_ids:[LOCATION],
              coverage_start:'07:00',coverage_end:'15:00',segment_number:1}]}];
        }
        return [];
      },
      runRpc: async (name, args) => { mutations.push({ name, args }); return name === 'tool_list_active_employees' ? [] : null; },
    });
    const reply = await responder.generateReply({ deviceId: 'SYNTHETIC_DEVICE', userMessage: prompt, threadId: '10000000-0000-4000-8000-000000000002' });
    assert.ok(mutations.every(({ name }) => ['msg_set_memphis_thread_context', 'msg_upsert_memphis_thread_context', 'tool_list_active_employees'].includes(name)), `No schedule write from an answer: ${mutations.map(x => x.name)}`); checks++;
    return { reply, queries };
  }
  for (const prompt of ['Who has Aquarium on 2026-10-03?', 'Aquarium schedule on 2026-10-03']) {
    const { reply, queries } = await ask(prompt);
    assert.doesNotMatch(reply.text, /Departed Historical Owner/, 'Missing accepted date must not resurrect last-week assignment'); checks++;
    assert.match(reply.text, /2026-10-03/); checks++;
    assert.match(reply.text, /can't verify/i); checks++;
    assert.ok(queries.filter(sql => sql.includes('custodial_memphis_schedule_day')).every(sql => sql.includes("'2026-10-03'")), 'Only requested-date authority may be read'); checks++;
    const accepted = await ask(prompt, { current: true });
    assert.match(accepted.reply.text, /Accepted Dated Owner/); checks++;
    assert.doesNotMatch(accepted.reply.text, /Departed Historical Owner/); checks++;
  }
  for (const date of ['2026-10-01', '2026-10-03']) {
    const { reply, queries } = await ask(`Who has Aquarium on ${date}?`, { date, current: true, physical: true });
    assert.match(reply.text, /Accepted Dated Owner/); checks++;
    assert.doesNotMatch(reply.text, /Current Instant Owner/); checks++;
    assert.ok(!queries.some(sql => sql.includes('sch_get_current_owner')), 'Current owner cannot answer a different service date'); checks++;
  }
  const today = await ask('Who has Aquarium today?', { date: TODAY, physical: true, current: true });
  assert.match(today.reply.text, /Accepted Dated Owner/); checks++;
  assert.ok(!today.queries.some(sql=>sql.includes('sch_get_current_owner')),'Legacy current-owner shortcut must not run');checks++;
  const exactLocation=await ask('Who has AQU today?',{date:TODAY,physical:true,current:true});
  assert.match(exactLocation.reply.text,/Accepted Dated Owner/);checks++;
  const recipe = await ask('Give me a dinner recipe for pretzels');
  assert.doesNotMatch(recipe.reply.text, /Gemini|API|credentials?|token|setup/i, 'Employee fallback must not direct configuration changes'); checks++;
  assert.match(recipe.reply.text, /could not|couldn't|unavailable|not.*answer/i); checks++;
  console.log(JSON.stringify({ status: 'PASS_MEMPHIS_AUTHORITATIVE_DATE_LOCAL', checks, actualResponder: true, syntheticRows: true, network: false,
    notProven: ['live authenticated projection', 'provider general-answer availability', 'independent review'] }));
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
