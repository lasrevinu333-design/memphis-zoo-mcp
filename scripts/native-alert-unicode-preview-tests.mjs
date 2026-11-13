import assert from 'node:assert/strict';
import {buildNativeAlertCandidate} from '../src/native-alert-two-stage.js';
import {deliverNativeMessageJob} from '../src/native-message-dispatch.js';
import {messageFixture} from './fixtures/native-message-dispatch-fixture.mjs';
import {nativeAlertUtf8Prefix} from '../src/native-alert-text.js';

let checks = 0;
for (const [source, expected] of [
  ['é'.repeat(501), 'é'.repeat(500)],
  ['A'.repeat(1000), 'A'.repeat(1000)],
  ['😀'.repeat(249)+'é😀', '😀'.repeat(249)+'é'],
  ['漢'.repeat(334), '漢'.repeat(333)],
]) {
  const f = messageFixture();
  f.prepared.source_projection.payload.body = source;
  const before = structuredClone(f.prepared);
  const candidate = buildNativeAlertCandidate(f.prepared, {});
  assert.equal(candidate.body, expected); checks++;
  assert.ok(Buffer.byteLength(candidate.body) <= 1000); checks++;
  assert.deepEqual(f.prepared, before, 'prepared source must remain immutable'); checks++;
  assert.equal(candidate.source_revision, f.prepared.source_revision); checks++;
  const result = await deliverNativeMessageJob(f);
  assert.equal(result.native_message, true); checks++;
  assert.equal(f.requests[0].body.message.data.body, expected); checks++;
  assert.equal(f.requests[0].body.message.data.source_revision, f.prepared.source_revision); checks++;
  const again = await deliverNativeMessageJob(f);
  assert.equal(again.replayed, true); checks++;
  assert.equal(f.requests.length, 1, 'durable replay must not send again'); checks++;
}
const titled = messageFixture();
titled.prepared.source_projection.payload.title = 'é'.repeat(91);
const titledBefore = structuredClone(titled.prepared);
const titleCandidate = buildNativeAlertCandidate(titled.prepared, {});
assert.equal(titleCandidate.title, 'é'.repeat(90)); checks++;
assert.deepEqual(titled.prepared, titledBefore); checks++;
assert.equal(nativeAlertUtf8Prefix('unchanged', 1000), 'unchanged'); checks++;
assert.equal(nativeAlertUtf8Prefix('text', 0), ''); checks++;
assert.throws(() => nativeAlertUtf8Prefix('\uD800', 1000), /native_alert_text_invalid/); checks++;
assert.throws(() => nativeAlertUtf8Prefix('text', -1), /native_alert_text_invalid/); checks++;
console.log(JSON.stringify({passed:checks, scope:'actual candidate and dispatcher, synthetic SQL/provider only'}));
