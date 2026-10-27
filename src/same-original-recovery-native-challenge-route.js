import {isDeepStrictEqual, types} from 'node:util';
import {captureAuthenticatedSameOriginalRecoveryNativeStatus,
  isAuthenticatedSameOriginalRecoveryNativeStatusCapture,
  sameOriginalRecoveryNativeStatusPath as originalStatusPath,
  captureAuthenticatedSameOriginalRecoveryNativePreparation,isAuthenticatedSameOriginalRecoveryNativePreparationCapture,
  sameOriginalRecoveryNativePreparationPath} from './native-private-custody-exchange.js';
import {decodeSameOriginalRecoveryNativeStatus,decodeSameOriginalRecoveryNativePreparationRead} from './same-original-recovery-native-challenge-wire.js';
import {parseNativeProviderJson} from './native-provider-json.js';
import {decodeSameOriginalCompletionRead,sameOriginalCompletionReadWire} from './same-original-completion-read-wire.js';
import {captureAuthenticatedSameOriginalCompletionRead,isAuthenticatedSameOriginalCompletionReadCapture,
  inspectAuthenticatedSameOriginalCompletionRead} from './native-private-custody-exchange.js';
import {captureAuthenticatedSameOriginalRecoveryNativeChallenge,
  isAuthenticatedSameOriginalRecoveryNativeChallengeCapture,
  closeAuthenticatedPrivateCustodyExchangeCapture,
  sameOriginalRecoveryNativeChallengePath as path} from './native-private-custody-exchange.js';
import {decodeSameOriginalRecoveryNativeChallenge} from './same-original-recovery-native-challenge-wire.js';
import {validateRecoveryNativeChallengeReceipt, recoveryDeniedEffects} from './same-original-recovery-wire.js';

const maxRequestBytes = 786432, receiveDeadlineMs = 30000;
const contentType = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const bufferGetter = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const lengthGetter = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const offsetGetter = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get;
const capacityGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
function failure(code, status = 403) { throw Object.assign(new Error(code), {code, status}); }
function copyBytes(value) {
  if (types.isProxy(value) || !Buffer.isBuffer(value) || Object.getPrototypeOf(value) !== Buffer.prototype)
    failure('same_original_recovery_native_body_invalid', 400);
  const backing = bufferGetter.call(value), length = lengthGetter.call(value), offset = offsetGetter.call(value);
  const capacity = capacityGetter.call(backing); // Shared/detached backing is not an owned input.
  if (Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || length > maxRequestBytes || offset + length > capacity)
    failure('same_original_recovery_native_body_invalid', 400);
  return Buffer.from(new Uint8Array(backing, offset, length));
}
function snapshotHeaders(value) {
  if (!value || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype)
    failure('same_original_recovery_native_request_changed');
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !field || !Object.hasOwn(field, 'value') || typeof field.value !== 'string')
      failure('same_original_recovery_native_request_changed');
    Object.defineProperty(result, key, {value: field.value, enumerable: true});
  }
  return result;
}
function reply(res, status, code) {
  if (res.destroyed || res.headersSent || res.writableEnded) return;
  res.status(status).json({ok: false, outcome: 'UNKNOWN', retry_safe: false, code, limits: recoveryDeniedEffects});
}
function capabilities(value) {
  const required = ['env', 'store', 'runReadOnlySql', 'registerOriginalChallengeOnce'];
  if (!value || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    failure('same_original_recovery_native_dependencies_required', 503);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => ![...required, 'now'].includes(key)) || required.some(key => !keys.includes(key)))
    failure('same_original_recovery_native_dependencies_required', 503);
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      failure('same_original_recovery_native_dependencies_required', 503);
    result[key] = descriptor.value;
  }
  if (!result.env || typeof result.env !== 'object' || Array.isArray(result.env) || types.isProxy(result.env)
    || !result.store || types.isProxy(result.store) || typeof result.store.findCredential !== 'function'
    || typeof result.runReadOnlySql !== 'function' || typeof result.registerOriginalChallengeOnce !== 'function'
    || (keys.includes('now') && typeof result.now !== 'function'))
    failure('same_original_recovery_native_dependencies_required', 503);
  return result;
}

// Main supplies the transactional registration port and mounts before general
// parsing. It receives the ORIGINAL privately branded capture, not JSON/auth
// flags. Observed capture/receipt metadata grants no preparation/effect rights.
export function installSameOriginalRecoveryNativeChallengeRoute(app, privateDependencies) {
  const {env, store, runReadOnlySql, registerOriginalChallengeOnce, now} = capabilities(privateDependencies);
  if (typeof app?.use !== 'function' || typeof app?.post !== 'function')
    failure('same_original_recovery_native_app_required', 503);
  const clock = now ?? (() => new Date());
  app.use((req, res, next) => {
    let classified = req.path;
    try { classified = decodeURIComponent(classified); } catch { /* Literal equality still refuses. */ }
    if (![req.path, classified].some(value => typeof value === 'string'
      && (value.toLowerCase() === path || value.toLowerCase().startsWith(path + '/')))) return next();
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.originalUrl !== path || req.path !== path || req.url !== path)
      return reply(res, 400, 'same_original_recovery_native_exact_path_required');
    if (req.method !== 'POST') return reply(res, 405, 'same_original_recovery_native_method_invalid');
    const encoding = req.headers?.['content-encoding'];
    if (!contentType.test(req.headers?.['content-type'] ?? '') || (encoding !== undefined && encoding !== 'identity'))
      return reply(res, 415, 'same_original_recovery_native_content_type_invalid');
    const declared = req.headers?.['content-length'];
    if (declared !== undefined && (!/^[0-9]+$/.test(declared) || Number(declared) < 1))
      return reply(res, 400, 'same_original_recovery_native_body_invalid');
    if (declared !== undefined && Number(declared) > maxRequestBytes)
      return reply(res, 413, 'same_original_recovery_native_body_too_large');
    next();
  });
  app.post(path, (req, res) => {
    if (req.readableEnded || req.body !== undefined || req.scanAuthorityRawBody !== undefined)
      return reply(res, 400, 'same_original_recovery_native_parser_order_invalid');
    if (req.aborted) return reply(res, 400, 'same_original_recovery_native_receive_aborted');
    let received = 0, ended = false, settled = false, aborted = false, responseClosed = false, timer;
    let raw = null, rawSnapshot = null, firstCapture = null, lastCapture = null;
    let ownedBody = null, rawInstalled = false, bodyInstalled = false;
    const parts = [];
    function clearParts() { for (const part of parts) part.fill(0); parts.length = 0; received = 0; }
    function stopReceive() { clearTimeout(timer); timer = undefined; req.off('data', onData); req.off('end', onEnd); }
    function cleanup() {
      stopReceive(); req.off('aborted', onAbort); req.off('close', onClose); req.off('error', onError); res.off('close', onResponseClose);
      clearParts(); closeAuthenticatedPrivateCustodyExchangeCapture(firstCapture); closeAuthenticatedPrivateCustodyExchangeCapture(lastCapture);
      raw?.fill(0); rawSnapshot?.fill(0);
      // Refusal/response hooks can install foreign fields even when decoding
      // failed before this route installed anything. Own allocations are wiped
      // independently; only still-owned data properties may be retired here.
      const rawField = Object.getOwnPropertyDescriptor(req, 'scanAuthorityRawBody');
      const bodyField = Object.getOwnPropertyDescriptor(req, 'body');
      if (rawInstalled && rawField && Object.hasOwn(rawField, 'value') && rawField.value === raw)
        delete req.scanAuthorityRawBody;
      if (bodyInstalled && bodyField && Object.hasOwn(bodyField, 'value') && bodyField.value === ownedBody)
        delete req.body;
      rawInstalled = false; bodyInstalled = false;
    }
    function early(status, code) {
      if (settled || ended) return;
      settled = true; cleanup();
      if (!responseClosed) reply(res, status, code);
      else if (!res.destroyed && !res.writableEnded) res.end();
    }
    function onData(chunk) {
      if (settled || ended) return;
      try {
        if (received + lengthGetter.call(chunk) > maxRequestBytes)
          return early(413, 'same_original_recovery_native_body_too_large');
        const part = copyBytes(chunk); received += part.length; parts.push(part);
      } catch { early(400, 'same_original_recovery_native_body_invalid'); }
    }
    function onAbort() { aborted = true; if (!ended) early(400, 'same_original_recovery_native_receive_aborted'); }
    function onClose() { if (!ended) onAbort(); }
    function onError() { onAbort(); }
    function onResponseClose() { responseClosed = true; if (!ended) early(400, 'same_original_recovery_native_receive_aborted'); }
    async function onEnd() {
      if (settled || ended) return;
      ended = true; stopReceive(); raw = Buffer.concat(parts); clearParts();
      let original, headers, headerValues, method, originalUrl, url, requestPath;
      let writerInvoked = false;
      function assertCurrent() {
        if (aborted || req.aborted || responseClosed || res.destroyed || res.writableEnded
          || req.method !== method || req.originalUrl !== originalUrl || req.url !== url || req.path !== requestPath
          || req.headers !== headers || !isDeepStrictEqual(snapshotHeaders(headers), headerValues)
          || req.scanAuthorityRawBody !== raw || req.body !== original)
          failure('same_original_recovery_native_request_changed');
        const bytes = copyBytes(raw);
        try { if (!bytes.equals(rawSnapshot) || !isDeepStrictEqual(decodeSameOriginalRecoveryNativeChallenge(bytes), original))
          failure('same_original_recovery_native_request_changed'); }
        finally { bytes.fill(0); }
      }
      try {
        original = decodeSameOriginalRecoveryNativeChallenge(raw); rawSnapshot = Buffer.from(raw);
        req.scanAuthorityRawBody = raw; rawInstalled = true;
        req.body = original; ownedBody = original; bodyInstalled = true;
        headers = req.headers; headerValues = snapshotHeaders(headers);
        method = req.method; originalUrl = req.originalUrl; url = req.url; requestPath = req.path;
        assertCurrent();
        firstCapture = await captureAuthenticatedSameOriginalRecoveryNativeChallenge(req, {env, store, runReadOnlySql, now: clock()});
        assertCurrent();
        if (!isAuthenticatedSameOriginalRecoveryNativeChallengeCapture(firstCapture))
          failure('same_original_recovery_native_capture_required');
        // Exactly one invocation. A thrown/lost reply can already be committed.
        writerInvoked = true;
        let rawReceipt, writeError;
        try { rawReceipt = await registerOriginalChallengeOnce(firstCapture); }
        catch (error) { writeError = error; }
        assertCurrent();
        lastCapture = await captureAuthenticatedSameOriginalRecoveryNativeChallenge(req, {env, store, runReadOnlySql, now: clock()});
        assertCurrent();
        if (!isAuthenticatedSameOriginalRecoveryNativeChallengeCapture(lastCapture) || !isDeepStrictEqual(firstCapture, lastCapture))
          failure('same_original_recovery_native_capture_changed');
        if (writeError) failure('same_original_recovery_native_outcome_unknown', 503);
        const receipt = validateRecoveryNativeChallengeReceipt(rawReceipt);
        if (receipt.native_challenge_intent_id !== original.native_challenge_intent_id
          || receipt.native_challenge_intent_record_sha256 !== original.native_challenge_intent_record_sha256
          || receipt.original_target_sha256 !== original.original_target_sha256)
          failure('same_original_recovery_native_receipt_conflict');
        res.status(200).json({ok: true, data: receipt});
      } catch (error) {
        if (!responseClosed && !aborted && !req.aborted) reply(res,
          writerInvoked ? 503 : [400, 401, 403].includes(error?.status) ? error.status : 503,
          writerInvoked ? 'same_original_recovery_native_outcome_unknown' : 'same_original_recovery_native_unconfirmed');
      } finally {
        settled = true; cleanup();
        if ((responseClosed || aborted) && !res.destroyed && !res.writableEnded) res.end();
      }
    }
    timer = setTimeout(() => early(408, 'same_original_recovery_native_receive_timeout'), receiveDeadlineMs);
    timer.unref(); req.on('data', onData); req.once('end', onEnd); req.once('aborted', onAbort);
    req.once('close', onClose); req.once('error', onError); res.once('close', onResponseClose);
  });
  return Object.freeze({path, maxRequestBytes, receiveDeadlineMs});
}

const maxStatusRequestBytes = 1050624;
function copyStatusBytes(value,maximum=maxStatusRequestBytes) {
  if (types.isProxy(value) || !Buffer.isBuffer(value) || Object.getPrototypeOf(value) !== Buffer.prototype)
    failure('same_original_recovery_native_body_invalid', 400);
  const backing = bufferGetter.call(value), length = lengthGetter.call(value), offset = offsetGetter.call(value);
  const capacity = capacityGetter.call(backing);
  if (Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || length > maximum || offset + length > capacity)
    failure('same_original_recovery_native_body_invalid', 400);
  return Buffer.from(new Uint8Array(backing, offset, length));
}
function statusCapabilities(value,preparation=false,completion=false) {
  const readerName=completion?'readOriginalCompletionOnce':preparation?'readCurrentManagerPreparationOnce':'readOriginalChallengeStatusOnce';
  const required = ['env', 'store', 'runReadOnlySql', readerName];
  if (!value || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    failure('same_original_recovery_native_dependencies_required', 503);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => ![...required, 'now'].includes(key)) || required.some(key => !keys.includes(key)))
    failure('same_original_recovery_native_dependencies_required', 503);
  const result = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      failure('same_original_recovery_native_dependencies_required', 503);
    result[key] = descriptor.value;
  }
  if (!result.env || typeof result.env !== 'object' || Array.isArray(result.env) || types.isProxy(result.env)
    || !result.store || types.isProxy(result.store) || typeof result.store.findCredential !== 'function'
    || typeof result.runReadOnlySql !== 'function' || typeof result[readerName] !== 'function'
    || (keys.includes('now') && typeof result.now !== 'function'))
    failure('same_original_recovery_native_dependencies_required', 503);
  return result;
}

// Main supplies the fixed read-only port. Only a live authenticated STATUS
// capture may enter it; archived challenge representation alone is not authority.
// Mount this raw parser before general parsing. Observation grants no effects.
export function installSameOriginalRecoveryNativeStatusRoute(app, privateDependencies) {
  return installOriginalNativeReadRoute(app,privateDependencies,false);
}
export function installSameOriginalRecoveryNativePreparationRoute(app,privateDependencies){
  return installOriginalNativeReadRoute(app,privateDependencies,true);
}
export function installSameOriginalCompletionReadRoute(app,privateDependencies){
  return installOriginalNativeReadRoute(app,privateDependencies,false,true);
}
function installOriginalNativeReadRoute(app,privateDependencies,preparation,completion=false){
  const ports=statusCapabilities(privateDependencies,preparation,completion);
  const {env,store,runReadOnlySql,now}=ports;
  const readOriginalChallengeStatusOnce=ports[completion?'readOriginalCompletionOnce':preparation?'readCurrentManagerPreparationOnce':'readOriginalChallengeStatusOnce'];
  const statusPath=completion?sameOriginalCompletionReadWire.path:preparation?sameOriginalRecoveryNativePreparationPath:originalStatusPath;
  const decodeRead=completion?decodeSameOriginalCompletionRead:preparation?decodeSameOriginalRecoveryNativePreparationRead:decodeSameOriginalRecoveryNativeStatus;
  const captureRead=completion?captureAuthenticatedSameOriginalCompletionRead:preparation?captureAuthenticatedSameOriginalRecoveryNativePreparation:captureAuthenticatedSameOriginalRecoveryNativeStatus;
  const isRead=completion?isAuthenticatedSameOriginalCompletionReadCapture:preparation?isAuthenticatedSameOriginalRecoveryNativePreparationCapture:isAuthenticatedSameOriginalRecoveryNativeStatusCapture;
  const maxReadRequestBytes=completion?sameOriginalCompletionReadWire.maxRequestBytes:maxStatusRequestBytes;
  if (typeof app?.use !== 'function' || typeof app?.post !== 'function')
    failure('same_original_recovery_native_app_required', 503);
  const clock = now ?? (() => new Date());
  app.use((req, res, next) => {
    let classified = req.path;
    try { classified = decodeURIComponent(classified); } catch { /* Literal equality still refuses. */ }
    if (![req.path, classified].some(value => typeof value === 'string'
      && (value.toLowerCase() === statusPath || value.toLowerCase().startsWith(statusPath + '/')))) return next();
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.originalUrl !== statusPath || req.path !== statusPath || req.url !== statusPath)
      return reply(res, 400, 'same_original_recovery_native_exact_path_required');
    if (req.method !== 'POST') return reply(res, 405, 'same_original_recovery_native_method_invalid');
    const encoding = req.headers?.['content-encoding'];
    if (!contentType.test(req.headers?.['content-type'] ?? '') || (encoding !== undefined && encoding !== 'identity'))
      return reply(res, 415, 'same_original_recovery_native_content_type_invalid');
    const declared = req.headers?.['content-length'];
    if (declared !== undefined && (!/^[0-9]+$/.test(declared) || Number(declared) < 1))
      return reply(res, 400, 'same_original_recovery_native_body_invalid');
    if (declared !== undefined && Number(declared) > maxReadRequestBytes)
      return reply(res, 413, 'same_original_recovery_native_body_too_large');
    next();
  });
  app.post(statusPath, (req, res) => {
    if (req.readableEnded || req.body !== undefined || req.scanAuthorityRawBody !== undefined)
      return reply(res, 400, 'same_original_recovery_native_parser_order_invalid');
    if (req.aborted) return reply(res, 400, 'same_original_recovery_native_receive_aborted');
    let received = 0, ended = false, settled = false, aborted = false, responseClosed = false, timer;
    let raw = null, rawSnapshot = null, firstCapture = null, lastCapture = null;
    let ownedBody = null, rawInstalled = false, bodyInstalled = false;
    const parts = [];
    function clearParts() { for (const part of parts) part.fill(0); parts.length = 0; received = 0; }
    function stopReceive() { clearTimeout(timer); timer = undefined; req.off('data', onData); req.off('end', onEnd); }
    function cleanup() {
      stopReceive(); req.off('aborted', onAbort); req.off('close', onClose); req.off('error', onError); res.off('close', onResponseClose);
      clearParts(); closeAuthenticatedPrivateCustodyExchangeCapture(firstCapture); closeAuthenticatedPrivateCustodyExchangeCapture(lastCapture);
      raw?.fill(0); rawSnapshot?.fill(0);
      // Refusal/response hooks can install foreign fields even when decoding
      // failed before this route installed anything. Own allocations are wiped
      // independently; only still-owned data properties may be retired here.
      const rawField = Object.getOwnPropertyDescriptor(req, 'scanAuthorityRawBody');
      const bodyField = Object.getOwnPropertyDescriptor(req, 'body');
      if (rawInstalled && rawField && Object.hasOwn(rawField, 'value') && rawField.value === raw)
        delete req.scanAuthorityRawBody;
      if (bodyInstalled && bodyField && Object.hasOwn(bodyField, 'value') && bodyField.value === ownedBody)
        delete req.body;
      rawInstalled = false; bodyInstalled = false;
    }
    function early(status, code) {
      if (settled || ended) return;
      settled = true; cleanup();
      if (!responseClosed) reply(res, status, code);
      else if (!res.destroyed && !res.writableEnded) res.end();
    }
    function onData(chunk) {
      if (settled || ended) return;
      try {
        if (received + lengthGetter.call(chunk) > maxReadRequestBytes)
          return early(413, 'same_original_recovery_native_body_too_large');
        const part = copyStatusBytes(chunk,maxReadRequestBytes); received += part.length; parts.push(part);
      } catch { early(400, 'same_original_recovery_native_body_invalid'); }
    }
    function onAbort() { aborted = true; if (!ended) early(400, 'same_original_recovery_native_receive_aborted'); }
    function onClose() { if (!ended) onAbort(); }
    function onError() { onAbort(); }
    function onResponseClose() { responseClosed = true; if (!ended) early(400, 'same_original_recovery_native_receive_aborted'); }
    async function onEnd() {
      if (settled || ended) return;
      ended = true; stopReceive(); raw = Buffer.concat(parts); clearParts();
      let original, archived, headers, headerValues, method, originalUrl, url, requestPath;
      let readerInvoked = false;
      function assertCurrent() {
        if (aborted || req.aborted || responseClosed || res.destroyed || res.writableEnded
          || req.method !== method || req.originalUrl !== originalUrl || req.url !== url || req.path !== requestPath
          || req.headers !== headers || !isDeepStrictEqual(snapshotHeaders(headers), headerValues)
          || req.scanAuthorityRawBody !== raw || req.body !== original)
          failure('same_original_recovery_native_request_changed');
        const bytes = copyStatusBytes(raw,maxReadRequestBytes);
        try { if (!bytes.equals(rawSnapshot) || !isDeepStrictEqual(decodeRead(bytes), original))
          failure('same_original_recovery_native_request_changed'); }
        finally { bytes.fill(0); }
      }
      try {
        original = decodeRead(raw); rawSnapshot = Buffer.from(raw);
        // The nested ORIGINAL bytes, not a reconstructed challenge or caller pins.
        if(!completion){
          const archivedBytes = Buffer.from(original.original_challenge_body_base64, 'base64');
          try { archived = decodeSameOriginalRecoveryNativeChallenge(archivedBytes); }
          finally { archivedBytes.fill(0); }
        }
        req.scanAuthorityRawBody = raw; rawInstalled = true;
        req.body = original; ownedBody = original; bodyInstalled = true;
        headers = req.headers; headerValues = snapshotHeaders(headers);
        method = req.method; originalUrl = req.originalUrl; url = req.url; requestPath = req.path;
        assertCurrent();
        firstCapture = await captureRead(req, {env, store, runReadOnlySql, now: clock()});
        assertCurrent();
        if (!isRead(firstCapture))
          failure('same_original_recovery_native_capture_required');
        // Exactly one fixed original READ. Missing/lost status stays UNKNOWN; never register or retry.
        readerInvoked = true;
        let rawReceipt, readError;
        try { rawReceipt = await readOriginalChallengeStatusOnce(firstCapture); }
        catch (error) { readError = error; }
        assertCurrent();
        lastCapture = await captureRead(req, {env, store, runReadOnlySql, now: clock()});
        assertCurrent();
        if (!isRead(lastCapture) || !isDeepStrictEqual(firstCapture, lastCapture))
          failure('same_original_recovery_native_capture_changed');
        if (readError) failure('same_original_recovery_native_outcome_unknown', 503);
        if(completion){
          const keys=['schema','state','operation_id','original_generation_id','argument_values_sha256','disposition','result','transaction_authority','limits'];
          if(!rawReceipt||types.isProxy(rawReceipt)||!Object.isFrozen(rawReceipt)
            ||!isDeepStrictEqual(Reflect.ownKeys(rawReceipt).slice().sort(),keys.slice().sort()))
            failure('same_original_recovery_native_receipt_conflict');
          for(const key of keys){const d=Object.getOwnPropertyDescriptor(rawReceipt,key);
            if(!d||!Object.hasOwn(d,'value')||!d.enumerable)failure('same_original_recovery_native_receipt_conflict');}
          const exact=inspectAuthenticatedSameOriginalCompletionRead(firstCapture);
          if(rawReceipt.schema!=='custodial.same-original-completion-SQL-read.v1'
            ||rawReceipt.state!=='CURRENT_EXACT_ORIGINAL_COMPLETION_DISPOSITION_NOT_ACK'
            ||rawReceipt.operation_id!==firstCapture.operation_id
            ||rawReceipt.original_generation_id!==firstCapture.original_generation_id
            ||rawReceipt.argument_values_sha256!==exact.original_completion_arguments_sha256
            ||rawReceipt.transaction_authority!==false||!isDeepStrictEqual(rawReceipt.limits,recoveryDeniedEffects)
            ||!['UNRESOLVED_RETAINED','ACCEPTED_EXACT_ORIGINAL'].includes(rawReceipt.disposition)
            ||rawReceipt.disposition==='UNRESOLVED_RETAINED'&&rawReceipt.result!==null
            ||Buffer.byteLength(JSON.stringify({ok:true,data:rawReceipt}),'utf8')>131072)
            failure('same_original_recovery_native_receipt_conflict');
          // The fixed private store binds any accepted row to these original
          // bytes/principal. This representation still grants NO inventory
          // ACK, resend, finalizer, key removal or phone release.
          assertCurrent();res.status(200).json({ok:true,data:rawReceipt});return;
        }
        if(preparation){
          const keys=['schema','state','purpose_admission_id','original_registration_utf8','original_approval_receipt_utf8',
            'observed_at','current_until','transaction_authority','limits'];
          if(!rawReceipt||types.isProxy(rawReceipt)||!Object.isFrozen(rawReceipt)
            ||!isDeepStrictEqual(Reflect.ownKeys(rawReceipt).slice().sort(),keys.slice().sort()))failure('same_original_recovery_native_receipt_conflict');
          for(const key of keys){const d=Object.getOwnPropertyDescriptor(rawReceipt,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)failure('same_original_recovery_native_receipt_conflict');}
          if(rawReceipt.schema!=='custodial.same-original-current-manager-preparation.v1'
            ||rawReceipt.state!=='CURRENT_MANAGER_PREPARATION_OBSERVED_NO_EFFECT_RIGHTS'
            ||rawReceipt.purpose_admission_id!=='same-original-preparation.v1'||rawReceipt.transaction_authority!==false
            ||!isDeepStrictEqual(rawReceipt.limits,recoveryDeniedEffects)
            ||typeof rawReceipt.original_registration_utf8!=='string'||Buffer.byteLength(rawReceipt.original_registration_utf8,'utf8')>24576
            ||Buffer.byteLength(JSON.stringify({ok:true,data:rawReceipt}),'utf8')>131072)failure('same_original_recovery_native_receipt_conflict');
          const registered=validateRecoveryNativeChallengeReceipt(parseNativeProviderJson(Buffer.from(rawReceipt.original_registration_utf8,'utf8')));
          if(registered.challenge_id!==archived.native_challenge_intent_id
            ||registered.native_challenge_intent_record_sha256!==archived.native_challenge_intent_record_sha256
            ||registered.original_target_sha256!==archived.original_target_sha256)failure('same_original_recovery_native_receipt_conflict');
          // Only the Main-bound private store above produces this immutable
          // representation. It remains an observation, not a native grant.
          res.status(200).json({ok:true,data:rawReceipt});return;
        }
        const receipt = validateRecoveryNativeChallengeReceipt(rawReceipt);
        if (receipt.challenge_id !== archived.native_challenge_intent_id
          || receipt.native_challenge_intent_id !== archived.native_challenge_intent_id
          || receipt.native_challenge_intent_record_sha256 !== archived.native_challenge_intent_record_sha256
          || receipt.original_target_sha256 !== archived.original_target_sha256)
          failure('same_original_recovery_native_receipt_conflict');
        res.status(200).json({ok: true, data: receipt});
      } catch (error) {
        if (!responseClosed && !aborted && !req.aborted) reply(res,
          readerInvoked ? 503 : [400, 401, 403].includes(error?.status) ? error.status : 503,
          readerInvoked ? 'same_original_recovery_native_outcome_unknown' : 'same_original_recovery_native_unconfirmed');
      } finally {
        settled = true; cleanup();
        if ((responseClosed || aborted) && !res.destroyed && !res.writableEnded) res.end();
      }
    }
    timer = setTimeout(() => early(408, 'same_original_recovery_native_receive_timeout'), receiveDeadlineMs);
    timer.unref(); req.on('data', onData); req.once('end', onEnd); req.once('aborted', onAbort);
    req.once('close', onClose); req.once('error', onError); res.once('close', onResponseClose);
  });
  return Object.freeze({path: statusPath, maxRequestBytes: maxReadRequestBytes, receiveDeadlineMs});
}
