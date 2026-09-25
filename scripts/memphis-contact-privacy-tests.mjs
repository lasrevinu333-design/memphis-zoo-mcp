import assert from 'node:assert/strict';
import { answerInternalContactQuestion } from '../src/ai/memphis-ai-contacts.js';

// Actual formatter/query caller, synthetic SQL rows; no real contact data,
// credentials, database connection, AI request or end-to-end authority claim.
let checks = 0;
const contact = { display_name: 'Synthetic Operations Contact', role_title: 'Custodial Manager', department: 'Operations',
  active: true, phone: '555-0100', notes: 'PRIVATE_INTERNAL_NOTE_FIXTURE' };
for (const role of ['', 'employee', 'custodian', 'guest', 'manager-lookalike']) {
  const answer = await answerInternalContactQuestion(async () => [contact], 'How can I contact the custodial manager?', role);
  assert.match(answer, /Synthetic Operations Contact/); checks++;
  assert.match(answer, /Custodial Manager/); checks++;
  assert.doesNotMatch(answer, /PRIVATE_INTERNAL_NOTE_FIXTURE/); checks++;
  assert.doesNotMatch(answer, /555-0100/); checks++;
}
for (const role of ['manager', 'admin', 'ops', 'ops_manager', 'operations_manager', ' OPS_MANAGER ']) {
  const answer = await answerInternalContactQuestion(async () => [contact], 'How can I contact the custodial manager?', role);
  assert.match(answer, /PRIVATE_INTERNAL_NOTE_FIXTURE/); checks++;
  assert.match(answer, /555-0100/); checks++;
}
const noPhone = await answerInternalContactQuestion(async () => [contact], 'Who is the custodial manager?', 'manager');
assert.doesNotMatch(noPhone, /555-0100/); checks++;
const unrelated = await answerInternalContactQuestion(() => { throw Error('Must not query contacts for a recipe'); }, 'Give me a dinner recipe', 'employee');
assert.equal(unrelated, null); checks++;
console.log(JSON.stringify({status:'PASS_CONTACT_NOTE_DISCLOSURE_LOCAL',checks,actualFormatter:true,syntheticSQL:true,
  notProven:['live role authentication','approved work-phone inventory','employee availability projection','AI/general runtime','independent review']}));
