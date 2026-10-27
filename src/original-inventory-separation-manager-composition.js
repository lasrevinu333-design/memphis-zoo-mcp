import {types} from 'node:util';
import {createSameOriginalRecoveryManagerAuthenticator} from './auth/same-original-recovery-manager-auth.js';
import {createOriginalInventorySeparationStore} from './original-inventory-separation-store.js';
import {installOriginalInventorySeparationRoutes} from './original-inventory-separation-routes.js';

const dependencyKeys = ['db', 'env', 'securityStore', 'trustedDeviceStore'];
function unavailable(detail) {
  throw Object.assign(new TypeError('original_inventory_separation_dependency_missing:' + detail), {
    code: 'original_inventory_separation_composition_unavailable', status: 503, retry_safe: false,
  });
}
function dependencies(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) unavailable('closed_dependencies');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== dependencyKeys.length || keys.some(key => !dependencyKeys.includes(key)))
    unavailable('closed_dependencies');
  const result = {};
  for (const key of dependencyKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable
      || !descriptor.value || typeof descriptor.value !== 'object'
      || types.isProxy(descriptor.value) || Array.isArray(descriptor.value)) unavailable(key);
    result[key] = descriptor.value;
  }
  for (const [key, methods] of [
    ['trustedDeviceStore', ['find']],
    ['securityStore', ['getManager', 'getDeviceSecurityConfig', 'findDeviceSecuritySession']],
    ['db', ['rpc']],
  ]) for (const method of methods) {
    if (typeof result[key][method] !== 'function') unavailable(key + '.' + method);
  }
  return result;
}

// Main mounts this on the top-level app before general parsing and supplies
// authoritative stores/private client. No default environment, alternate auth,
// caller issuer, RPC selector, role or new authority is accepted here.
export function installOriginalInventorySeparationManagerComposition(app, privateDependencies) {
  const {env, trustedDeviceStore, securityStore, db} = dependencies(privateDependencies);
  if (typeof app?.use !== 'function' || typeof app?.get !== 'function' || typeof app?.post !== 'function')
    unavailable('app.use/get/post');
  const auth = createSameOriginalRecoveryManagerAuthenticator({env, trustedDeviceStore, securityStore});
  const store = createOriginalInventorySeparationStore({db, inspectAuthenticatedIssuer: auth.inspectAuthenticatedIssuer});
  const installed = installOriginalInventorySeparationRoutes(app, {
    authenticateCurrentManager: auth.authenticateCurrentManager,
    inspectAuthenticatedIssuer: auth.inspectAuthenticatedIssuer,
    readVerifiedInventory: store.readVerifiedInventory,
    issueOriginalInventoryApprovalOnce: store.issueOriginalInventoryApprovalOnce,
    readOriginalInventoryApproval: store.readOriginalInventoryApproval,
  });
  // Do not return the auth factory/WeakMap inspector, issuer or private ports.
  return Object.freeze({paths: installed.paths,
    maxRequestBytes: installed.maxRequestBytes, receiveDeadlineMs: installed.receiveDeadlineMs});
}
