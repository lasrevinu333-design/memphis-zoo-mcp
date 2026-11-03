import {isDeepStrictEqual, types} from 'node:util';
import {createHash} from 'node:crypto';
import {parseNativeProviderJson} from './native-provider-json.js';
import {decodeSameOriginalRecoveryNativeChallenge} from './same-original-recovery-native-challenge-wire.js';
import {validateRecoveryNativeChallengeReceipt, recoveryInstantMicros, recoveryDeniedEffects} from './same-original-recovery-wire.js';

const parameterNames = ['p_operation', 'p_device', 'p_credential', 'p_credential_hash', 'p_credential_key_id',
  'p_generation', 'p_chunk_index', 'p_original_write_request', 'p_original_write_body_sha256',
  'p_original_write_attestation_digest', 'p_native_request', 'p_native_request_timestamp',
  'p_native_request_body_sha256', 'p_native_attestation_digest', 'p_original_utf8'];
const bindingNames = ['capture', 'observation_only', 'transaction_authority', 'original_request_utf8',
  'original_target', 'native_challenge_intent_id', 'native_challenge_intent_record_sha256', 'rpc_parameters'];
function fail(code = 'same_original_recovery_native_registration_unknown', status = 503) {
  throw Object.assign(new Error(code), {code, status, outcome: 'UNKNOWN', retry_safe: false, limits: recoveryDeniedEffects});
}
function closed(value, names) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype
    || !isDeepStrictEqual(Reflect.ownKeys(value).slice().sort(), names.slice().sort())) fail();
  const result = {};
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (!field || !Object.hasOwn(field, 'value') || !field.enumerable) fail();
    result[name] = field.value;
  }
  return result;
}

// A separate status-only factory never exposes a writer, even internally to
// the HTTP composition. Its private inspector accepts the status brand, which
// the original challenge writer's inspector deliberately refuses.
export function createSameOriginalRecoveryNativeStatusStore(privateDependencies) {
  const dependencies = closed(privateDependencies, ['db', 'inspectAuthenticatedNativeStatus']);
  const original = createSameOriginalRecoveryNativeChallengeStore({db: dependencies.db,
    inspectAuthenticatedNativeChallenge: dependencies.inspectAuthenticatedNativeStatus});
  return Object.freeze({readOriginalChallengeStatusOnce: original.readOriginalChallengeStatusOnce});
}

// Main supplies the actual private inspector/client. The inspector observes
// one original; only Main's fixed transaction can revalidate/register it.
// This module creates no auth/SQL authority and exposes no captured arguments.
export function createSameOriginalRecoveryNativeChallengeStore(privateDependencies) {
  const dependencies = closed(privateDependencies, ['db', 'inspectAuthenticatedNativeChallenge']);
  const {db, inspectAuthenticatedNativeChallenge: inspect} = dependencies;
  if (!db || types.isProxy(db) || typeof db.rpc !== 'function' || typeof inspect !== 'function')
    fail('same_original_recovery_native_registration_unavailable');
  const attempted = new WeakSet();
  const statusAttempted = new WeakSet();
  const denied = new WeakSet();
  function snapshot(capture) {
    let value;
    try { value = inspect(capture); } catch { fail('same_original_recovery_native_capture_unbound', 403); }
    const binding = closed(value, bindingNames);
    if (!Object.isFrozen(value) || binding.capture !== capture || binding.observation_only !== true
      || binding.transaction_authority !== false || !Object.isFrozen(binding.rpc_parameters))
      fail('same_original_recovery_native_capture_unbound', 403);
    const parameters = closed(binding.rpc_parameters, parameterNames);
    if (parameters.p_chunk_index !== 0 || parameterNames.some(name => name !== 'p_chunk_index'
      && (typeof parameters[name] !== 'string' || !parameters[name].length))
      || typeof binding.original_request_utf8 !== 'string' || !binding.original_request_utf8.length
      || Buffer.byteLength(binding.original_request_utf8, 'utf8') > 786432
      || parameters.p_original_utf8 !== binding.original_request_utf8) fail();
    let original;
    const raw = Buffer.from(binding.original_request_utf8, 'utf8');
    try { original = decodeSameOriginalRecoveryNativeChallenge(raw); }
    catch { fail(); } finally { raw.fill(0); }
    if (!isDeepStrictEqual(original.original_target, binding.original_target)
      || original.native_challenge_intent_id !== binding.native_challenge_intent_id
      || original.native_challenge_intent_record_sha256 !== binding.native_challenge_intent_record_sha256
      || parameters.p_native_request !== original.native_challenge_intent_id) fail();
    // Representation conversion only: exactly original native millisecond UTC,
    // strict civil validation via the shared microsecond parser. No now/renewal.
    const timestamp = parameters.p_native_request_timestamp;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)) fail();
    let requestMicros;
    try { requestMicros = recoveryInstantMicros(timestamp.slice(0, -1) + '000Z'); }
    catch { fail(); }
    return Object.freeze({capture, original, requestMicros, original_request_utf8: binding.original_request_utf8,
      parameters: Object.freeze(parameters)});
  }
  function assertOriginal(capture, original) {
    let current;
    try { current = snapshot(capture); }
    catch { fail(); } // A committed response cannot adopt a closed/successor owner.
    if (current.capture !== original.capture || current.original_request_utf8 !== original.original_request_utf8
      || !isDeepStrictEqual(current.original, original.original)
      || !isDeepStrictEqual(current.parameters, original.parameters)) fail();
  }
  function ownValue(value, key) {
    if (!value || types.isProxy(value) || typeof value !== 'object') return undefined;
    const field = Object.getOwnPropertyDescriptor(value, key);
    return field && Object.hasOwn(field, 'value') ? field.value : undefined;
  }
  function authorityDenied(result, error) {
    return ownValue(ownValue(result, 'error'), 'code') === '42501' || ownValue(error, 'code') === '42501';
  }
  function receiptFrom(result, original) {
    if (!result || types.isProxy(result) || typeof result !== 'object') return null;
    const data = Object.getOwnPropertyDescriptor(result, 'data'), error = Object.getOwnPropertyDescriptor(result, 'error');
    if (!data || !Object.hasOwn(data, 'value') || (error && (!Object.hasOwn(error, 'value') || error.value))
      || typeof data.value !== 'string' || !data.value.length || Buffer.byteLength(data.value, 'utf8') > 24576) return null;
    const response = Buffer.from(data.value, 'utf8');
    try {
      const receipt = validateRecoveryNativeChallengeReceipt(parseNativeProviderJson(response));
      if (receipt.challenge_id !== original.original.native_challenge_intent_id
        || receipt.native_challenge_intent_id !== original.original.native_challenge_intent_id
        || receipt.native_challenge_intent_record_sha256 !== original.original.native_challenge_intent_record_sha256
        || receipt.original_target_sha256 !== original.original.original_target_sha256) return null;
      const registered = recoveryInstantMicros(receipt.registered_at), expires = recoveryInstantMicros(receipt.expires_at);
      if (registered < original.requestMicros - 30000000n || registered > original.requestMicros + 120000000n
        || expires <= registered || expires > registered + 300000000n || expires > original.requestMicros + 300000000n) return null;
      const transcript = ['custodial.same-original-native-challenge-binding.v1', original.original.native_challenge_intent_id,
        original.parameters.p_native_request_body_sha256, original.parameters.p_native_attestation_digest,
        original.original.native_challenge_intent_record_sha256, original.original.original_target_sha256,
        receipt.registered_at, receipt.expires_at].join('\n');
      if (receipt.challenge_sha256 !== createHash('sha256').update(transcript, 'utf8').digest('hex')) return null;
      return receipt;
    } catch { return null; } finally { response.fill(0); }
  }
  // Explicit read-only reconciliation port. Main must supply a currently
  // authenticated private capture of the SAME saved original; copied JSON or
  // a saved receipt is never sufficient. This port cannot register, renew or
  // approve anything, and consumes any writer opportunity on this capture.
  // A new HTTP/native restart transport is intentionally not inferred here.
  async function readOriginalChallengeStatusOnce(capture) {
    if (!capture || typeof capture !== 'object' || types.isProxy(capture))
      fail('same_original_recovery_native_capture_unbound', 403);
    if (denied.has(capture)) fail('same_original_recovery_native_current_authority_denied', 403);
    if (statusAttempted.has(capture)) fail('same_original_recovery_native_status_already_attempted');
    const original = snapshot(capture);
    statusAttempted.add(capture);
    attempted.add(capture);
    let result, readError;
    try { result = await db.rpc('custodial_same_original_preparation_registration_status_v1', original.parameters); }
    catch (error) { readError = error; }
    assertOriginal(capture, original);
    if (authorityDenied(result, readError)) {
      denied.add(capture);
      fail('same_original_recovery_native_current_authority_denied', 403);
    }
    const retained = readError === undefined ? receiptFrom(result, original) : null;
    if (!retained) fail();
    return retained;
  }
  async function registerOriginalChallengeOnce(capture) {
    if (!capture || typeof capture !== 'object' || types.isProxy(capture)) fail('same_original_recovery_native_capture_unbound', 403);
    if (attempted.has(capture)) fail('same_original_recovery_native_registration_already_attempted');
    const original = snapshot(capture);
    // Mark synchronously before dispatch. Neither concurrent callers nor a
    // lost/error reply can invoke a second writer using this same capture.
    attempted.add(capture);
    let result, writeError;
    try { result = await db.rpc('custodial_same_original_preparation_register_v1', original.parameters); }
    catch (error) { writeError = error; }
    assertOriginal(capture, original);
    if (authorityDenied(result, writeError)) {
      denied.add(capture);
      fail('same_original_recovery_native_current_authority_denied', 403);
    }
    const written = writeError === undefined ? receiptFrom(result, original) : null;
    if (written) return written;

    // ONE fixed read of this live original after an uncertain reply. It cannot
    // create a new intent, renew timestamps, call a writer or recover a restart.
    // The original frozen argument object is reused, never today's inspection.
    assertOriginal(capture, original);
    let statusResult, statusError;
    try { statusResult = await db.rpc('custodial_same_original_preparation_registration_status_v1', original.parameters); }
    catch (error) { statusError = error; }
    assertOriginal(capture, original);
    if (authorityDenied(statusResult, statusError)) {
      denied.add(capture);
      fail('same_original_recovery_native_current_authority_denied', 403);
    }
    const retained = statusError === undefined ? receiptFrom(statusResult, original) : null;
    if (!retained) fail();
    return retained; // Original metadata only; not auth, approval, ACK or effect rights.
  }
  return Object.freeze({registerOriginalChallengeOnce, readOriginalChallengeStatusOnce});
}
