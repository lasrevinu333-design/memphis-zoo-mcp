import assert from 'node:assert/strict';
import { createMemphisResponder } from '../src/memphis-ai.js';
import { getGeminiEnvOrder } from '../src/utils/gemini-config.js';

// Actual responder with synthetic dated rows. No network/provider/database call.
const keyNames = getGeminiEnvOrder();
const saved = new Map(keyNames.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const TODAY = '2026-10-02';
const GROUP = '10000000-0000-4000-8000-000000000001';
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
        if (sql.includes('from public.locations')) return physical ? [{ location_code: 'AQU', location_name: 'Aquarium', group_names: ['Aquarium'] }] : [];
        if (sql.includes('sch_get_current_owner')) return [{ owner_display_name: 'Current Instant Owner', coverage_start: '07:00', coverage_end: '15:00' }];
        if (sql.includes('public.v_memphis_area_schedule')) {
          const queriedDate = sql.match(/service_date\s*=\s*'([^']+)'/)?.[1];
          if (queriedDate === date && !current) return [];
          return [{ service_date: queriedDate, location_group_id: GROUP, group_code: 'AQU', group_name: 'Aquarium',
            employee_name: queriedDate === date ? 'Accepted Dated Owner' : 'Departed Historical Owner',
            coverage_start: '07:00', coverage_end: '15:00', segment_number: 1 }];
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
    assert.match(reply.text, /do not see|could not|couldn't/i); checks++;
    assert.ok(queries.filter(sql => sql.includes('public.v_memphis_area_schedule')).every(sql => sql.includes("'2026-10-03'")), 'Only requested-date schedule rows may be read'); checks++;
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
  const today = await ask('Who has Aquarium today?', { date: TODAY, physical: true });
  assert.match(today.reply.text, /Current Instant Owner/); checks++;
  const recipe = await ask('Give me a dinner recipe for pretzels');
  assert.doesNotMatch(recipe.reply.text, /Gemini|API|credentials?|token|setup/i, 'Employee fallback must not direct configuration changes'); checks++;
  assert.match(recipe.reply.text, /could not|couldn't|unavailable|not.*answer/i); checks++;
  console.log(JSON.stringify({ status: 'PASS_MEMPHIS_AUTHORITATIVE_DATE_LOCAL', checks, actualResponder: true, syntheticRows: true, network: false,
    notProven: ['live authenticated projection', 'provider general-answer availability', 'independent review'] }));
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
