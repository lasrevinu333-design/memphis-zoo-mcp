import assert from 'node:assert/strict';
import { answerInternalContactQuestion } from '../src/ai/memphis-ai-contacts.js';

// Actual formatter/query caller, synthetic SQL rows; no real contact data,
// credentials, database connection, AI request or end-to-end authority claim.
let checks = 0;
const contact = { display_name: 'Synthetic Operations Contact', role_title: 'Custodial Manager', department: 'Operations',
  active: true, phone: '555-0100', notes: 'PRIVATE_INTERNAL_NOTE_FIXTURE' };
for (const role of ['', 'custodian', 'guest', 'manager-lookalike']) {
  const answer = await answerInternalContactQuestion(async () => { throw Error('Public role must not read internal directory'); }, 'How can I contact the custodial manager?', role);
  assert.equal(answer, null); checks++;
}
for (const role of ['employee', ' EMPLOYEE ']) {
  const answer = await answerInternalContactQuestion(async sql => {
    assert.doesNotMatch(sql, /\bnotes\b/); checks++;
    assert.match(sql, /where active = true and/); checks++;
    return [contact];
  }, 'How can I contact the custodial manager?', role);
  assert.match(answer, /Synthetic Operations Contact/); checks++;
  assert.match(answer, /Custodial Manager/); checks++;
  assert.doesNotMatch(answer, /PRIVATE_INTERNAL_NOTE_FIXTURE/); checks++;
  assert.match(answer, /555-0100/); checks++;
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
const annie = await answerInternalContactQuestion(async sql => {
  assert.match(sql, /%Annie%/); checks++;
  return [{...contact, display_name:'Annie Synthetic Work Contact'}];
}, "What is Annie's phone number?", 'employee');
assert.match(annie, /Annie Synthetic Work Contact.*555-0100/); checks++;
assert.doesNotMatch(annie, /PRIVATE_INTERNAL_NOTE_FIXTURE/); checks++;
console.log(JSON.stringify({status:'PASS_CONTACT_NOTE_DISCLOSURE_LOCAL',checks,actualFormatter:true,syntheticSQL:true,
  authority:'Eric approved all supplied Custodial directory numbers as internal work contacts',
  notProven:['live role authentication','employee availability projection','AI/general runtime','independent review']}));
