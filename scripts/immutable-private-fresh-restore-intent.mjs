// Same-original intent/Source binding only. Not target, DDL, transaction,
// import, retry, commit or resume permission. No keys retained in the token.
import { types, isDeepStrictEqual } from 'node:util';
import { captureVerifiedOriginalRestoreIntent } from './disaster-recovery-crypto.mjs';
import { assertVerifiedArchiveIndependentIntentKey, readVerifiedPrivateImportSource } from './disaster-recovery-archive.mjs';

const originals = new WeakMap();
const envelopeKeys = Object.freeze(['format','algorithm','key_id','intent','signature']);
const intentKeys = Object.freeze(['restore_id','authority_generation','retry_of_restore_id','archive_digest',
  'source_project_ref','target_project_ref','source_identity_sha256','target_migration_head','target_release_identity',
  'actor','approved_at','expires_at','resume_after_verification']);
const releaseKeys = Object.freeze(['release_id','backend_commit','frontend_commit','migration_head','migration_manifest_sha256']);
const failure = () => Object.assign(new TypeError('immutable_fresh_original_intent_invalid'), {code:'immutable_fresh_original_intent_invalid'});
const fail = () => { throw failure(); };

function closed(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
      || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.some(key => typeof key !== 'string') || !isDeepStrictEqual(names.sort(), [...keys].sort())) fail();
  const result = {};
  for (const key of keys) {
    const field = descriptors[key];
    if (!Object.hasOwn(field,'value') || field.enumerable !== true) fail();
    Object.defineProperty(result,key,{value:field.value,enumerable:true});
  }
  return Object.freeze(result);
}

function captureEnvelopeData(value) {
  const outer = closed(value,envelopeKeys), intent = closed(outer.intent,intentKeys);
  const release = closed(intent.target_release_identity,releaseKeys);
  // Fixed graph: all leaves are scalar DATA. No arrays, hooks, recursive
  // caller objects or late caller reads enter verification or retained state.
  for (const [key,entry] of Object.entries(intent)) {
    if (key !== 'target_release_identity' && entry !== null
        && !['string','number','boolean'].includes(typeof entry)) fail();
    if (typeof entry === 'string' && Buffer.byteLength(entry,'utf8') > 1048576) fail();
  }
  for (const entry of Object.values(release)) if (typeof entry !== 'string' || Buffer.byteLength(entry,'utf8') > 1048576) fail();
  const capturedIntent = Object.freeze({...intent,target_release_identity:release});
  for (const key of ['format','algorithm','key_id','signature']) {
    if (typeof outer[key] !== 'string' || Buffer.byteLength(outer[key],'utf8') > 1048576) fail();
  }
  return Object.freeze({...outer,intent:capturedIntent});
}

function originalRelease(binding) {
  const release = binding.source_identity.release;
  if (!release || typeof release !== 'object' || types.isProxy(release)) fail();
  const selected = {};
  for (const key of releaseKeys) {
    const property = Object.getOwnPropertyDescriptor(release,key);
    if (!property || !Object.hasOwn(property,'value') || property.enumerable !== true) fail();
    Object.defineProperty(selected,key,{value:property.value,enumerable:true});
  }
  return Object.freeze(selected);
}

function freezeVerifiedIntentData(verified) {
  // Do not rely on the crypto helper's returned graph being immutable. These
  // are already-verified detached DATA, copied once again into our own fixed
  // graph; scalar fields and the ONLY nested release object cannot change.
  const intent = closed(verified,intentKeys);
  const release = closed(intent.target_release_identity,releaseKeys);
  return Object.freeze({...intent,target_release_identity:release});
}

function requireProducerEnvelope(envelope, keyId) {
  if (envelope.format !== 'memphis-zoo-production-restore-intent.v1' || envelope.algorithm !== 'hmac-sha256'
      || envelope.key_id !== keyId || typeof envelope.signature !== 'string'
      || !/^[0-9a-f]{64}(?![\s\S])/.test(envelope.signature)) fail();
}

function instant(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z(?![\s\S])/.test(value)) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) fail();
  return milliseconds;
}

function requireFreshIntent(intent, binding, now) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;
  const hash = /^[0-9a-f]{64}(?![\s\S])/, commit = /^[0-9a-f]{40}(?![\s\S])/;
  const head = /^[0-9]{14}(?![\s\S])/, project = /^[a-z0-9]{20}(?![\s\S])/;
  if (typeof intent.restore_id !== 'string' || !uuid.test(intent.restore_id)
      || intent.authority_generation !== 1 || intent.retry_of_restore_id !== null || intent.resume_after_verification !== false
      || typeof intent.archive_digest !== 'string' || !hash.test(intent.archive_digest) || intent.archive_digest !== binding.archive_digest
      || typeof intent.source_identity_sha256 !== 'string' || !hash.test(intent.source_identity_sha256)
      || intent.source_identity_sha256 !== binding.source_identity_sha256
      || typeof intent.source_project_ref !== 'string' || !project.test(intent.source_project_ref)
      || intent.source_project_ref !== binding.project_ref || intent.target_project_ref !== binding.project_ref
      || typeof intent.target_migration_head !== 'string' || !head.test(intent.target_migration_head)
      || intent.target_migration_head !== binding.source_identity.migration_head
      || typeof intent.actor !== 'string' || !/^[a-zA-Z0-9 ._@:-]{2,160}(?![\s\S])/.test(intent.actor)
      || intent.actor !== intent.actor.trim() || !intent.actor.length) fail();
  const release = intent.target_release_identity;
  if (typeof release.release_id !== 'string' || !release.release_id.trim() || release.release_id.includes('\0')
      || typeof release.backend_commit !== 'string' || !commit.test(release.backend_commit)
      || typeof release.frontend_commit !== 'string' || !commit.test(release.frontend_commit)
      || typeof release.migration_head !== 'string' || !head.test(release.migration_head)
      || typeof release.migration_manifest_sha256 !== 'string' || !hash.test(release.migration_manifest_sha256)
      || !isDeepStrictEqual(release,originalRelease(binding))) fail();
  const approved = instant(intent.approved_at), expires = instant(intent.expires_at);
  if (!Number.isFinite(now) || approved >= expires || expires <= now || expires > now + 24*60*60*1000) fail();
}

export function captureVerifiedImmutableFreshRestoreIntent(options) {
  try {
    const args = closed(options,['verifiedArchive','originalIntentEnvelope','intentVerifyKey','intentVerifyKeyId']);
    const archive = args.verifiedArchive;
    if (!archive || typeof archive !== 'object' || types.isProxy(archive)
        || typeof args.intentVerifyKey !== 'string' || typeof args.intentVerifyKeyId !== 'string'
        || !/^[a-zA-Z0-9._:-]{1,120}(?![\s\S])/.test(args.intentVerifyKeyId)) fail();
    // The private archive module verifies independence against the key that
    // ACTUALLY authenticated this archive, not a caller's key-id/boolean.
    assertVerifiedArchiveIndependentIntentKey(archive,args.intentVerifyKey);
    const original = readVerifiedPrivateImportSource(archive), binding = original.sourceBinding;
    const envelope = captureEnvelopeData(args.originalIntentEnvelope);
    requireProducerEnvelope(envelope,args.intentVerifyKeyId);
    const verifiedIntent = captureVerifiedOriginalRestoreIntent(envelope,args.intentVerifyKey,args.intentVerifyKeyId);
    const intent = freezeVerifiedIntentData(verifiedIntent);
    if (!isDeepStrictEqual(intent,envelope.intent)) fail();
    requireFreshIntent(intent,binding,Date.now());
    if (readVerifiedPrivateImportSource(archive).sourceBinding !== binding) fail();
    // Source IO is synchronous but can consume time. Never publish an expired
    // token merely because the earlier signature/clock check succeeded.
    requireFreshIntent(intent,binding,Date.now());
    const view = Object.freeze({intent,envelope:Object.freeze({...envelope,intent}),sourceBinding:binding});
    const token = Object.freeze(Object.create(null));
    originals.set(token,{archive,binding,view});
    return token;
  } catch { throw failure(); }
}

export function readVerifiedImmutableFreshRestoreIntent(token, verifiedArchive) {
  try {
    if (!token || typeof token !== 'object' || types.isProxy(token)) fail();
    const original = originals.get(token);
    if (!original || verifiedArchive !== original.archive) fail();
    if (readVerifiedPrivateImportSource(verifiedArchive).sourceBinding !== original.binding) fail();
    requireFreshIntent(original.view.intent,original.binding,Date.now());
    return original.view;
  } catch { throw failure(); }
}
