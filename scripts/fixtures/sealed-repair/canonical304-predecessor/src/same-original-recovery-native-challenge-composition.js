import {types} from 'node:util';
import {inspectAuthenticatedSameOriginalRecoveryNativeChallenge,inspectAuthenticatedSameOriginalRecoveryNativeStatus,inspectAuthenticatedSameOriginalRecoveryNativePreparation} from './native-private-custody-exchange.js';
import {createSameOriginalRecoveryNativeChallengeStore,createSameOriginalRecoveryNativeStatusStore} from './same-original-recovery-native-challenge-store.js';
import {installSameOriginalRecoveryNativeChallengeRoute,installSameOriginalRecoveryNativeStatusRoute,installSameOriginalRecoveryNativePreparationRoute,installSameOriginalCompletionReadRoute} from './same-original-recovery-native-challenge-route.js';
import {createSameOriginalRecoveryNativePreparationStore} from './same-original-recovery-native-preparation-store.js';
import {createSameOriginalCompletionReadStore} from './same-original-completion-read-store.js';
import {installNativeOriginalInventoryRequestRoute,installNativeOriginalInventoryStatusRoute,installNativeOriginalInventorySeparationApprovalStatusRoute} from './native-original-inventory-request-route.js';
import {installNativeOriginalInventoryManifestChunkRoute,installNativeOriginalInventoryManifestChunkStatusRoute} from './native-original-inventory-manifest-chunk-route.js';

const keys = ['env', 'store', 'runReadOnlySql', 'db'];
function unavailable(detail) {
  throw Object.assign(new TypeError('same_original_recovery_native_composition_missing:' + detail), {
    code: 'same_original_recovery_native_composition_unavailable', status: 503, retry_safe: false,
  });
}
function method(object, name, detail) {
  for (let owner = object; owner !== null; owner = Object.getPrototypeOf(owner)) {
    if (types.isProxy(owner)) unavailable(detail);
    const field = Object.getOwnPropertyDescriptor(owner, name);
    if (field) {
      if (!Object.hasOwn(field, 'value') || typeof field.value !== 'function' || types.isProxy(field.value)) unavailable(detail);
      return;
    }
  }
  unavailable(detail);
}
function dependencies(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) unavailable('closed_dependencies');
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(name => !keys.includes(name))) unavailable('closed_dependencies');
  const result = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, 'value') || !field.enumerable || !field.value
      || types.isProxy(field.value) || (key === 'runReadOnlySql' ? typeof field.value !== 'function'
        : typeof field.value !== 'object' || Array.isArray(field.value))) unavailable(key);
    result[key] = field.value;
  }
  method(result.store, 'findCredential', 'store.findCredential');
  method(result.db, 'rpc', 'db.rpc');
  return result;
}

// Main supplies authoritative stores/read-only SQL/private client and mounts
// before general parsing. No caller inspector/auth/registration/role/path/clock
// can replace the direct source-owned private binding below.
export function installSameOriginalRecoveryNativeChallengeComposition(app, privateDependencies) {
  const {env, store, runReadOnlySql, db} = dependencies(privateDependencies);
  if (!app || types.isProxy(app)) unavailable('app.use/post');
  method(app, 'use', 'app.use'); method(app, 'post', 'app.post');
  const registration = createSameOriginalRecoveryNativeChallengeStore({db,
    inspectAuthenticatedNativeChallenge: inspectAuthenticatedSameOriginalRecoveryNativeChallenge});
  const installed = installSameOriginalRecoveryNativeChallengeRoute(app, {env, store, runReadOnlySql,
    registerOriginalChallengeOnce: registration.registerOriginalChallengeOnce});
  const status = createSameOriginalRecoveryNativeStatusStore({db,
    inspectAuthenticatedNativeStatus: inspectAuthenticatedSameOriginalRecoveryNativeStatus});
  installSameOriginalRecoveryNativeStatusRoute(app, {env, store, runReadOnlySql,
    readOriginalChallengeStatusOnce: status.readOriginalChallengeStatusOnce});
  const preparation=createSameOriginalRecoveryNativePreparationStore({db,
    inspectAuthenticatedNativePreparationRead:inspectAuthenticatedSameOriginalRecoveryNativePreparation});
  installSameOriginalRecoveryNativePreparationRoute(app,{env,store,runReadOnlySql,
    readCurrentManagerPreparationOnce:preparation.readCurrentManagerPreparationOnce});
  const originalCompletion=createSameOriginalCompletionReadStore({db});
  installSameOriginalCompletionReadRoute(app,{env,store,runReadOnlySql,
    readOriginalCompletionOnce:originalCompletion.readOriginalCompletionOnce});
  installNativeOriginalInventoryRequestRoute(app,{env,store,runReadOnlySql,db});
  installNativeOriginalInventoryStatusRoute(app,{env,store,runReadOnlySql,db});
  installNativeOriginalInventorySeparationApprovalStatusRoute(app,{env,store,runReadOnlySql,db});
  installNativeOriginalInventoryManifestChunkRoute(app,{env,store,runReadOnlySql,db});
  installNativeOriginalInventoryManifestChunkStatusRoute(app,{env,store,runReadOnlySql,db});
  return Object.freeze({path: installed.path, maxRequestBytes: installed.maxRequestBytes,
    receiveDeadlineMs: installed.receiveDeadlineMs});
}
