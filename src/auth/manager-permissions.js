// Server-side policy. Call only with a manager freshly read from the protected registry.
// A display name, requested role, or browser-supplied permission is never authority.
export const OWNER_SYSTEM_KEY = 'eric_custodial_manager';
export const MANAGER_PERMISSION_SCHEMA = 'custodial.manager-permissions.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_ROLES = Object.freeze(['OPS_MANAGER', 'CUSTODIAL_MANAGER', 'DIRECTOR', 'SECURITY_ADMIN']);
const MANAGER_ROLES = new Set(OWNER_ROLES);

export function isActiveNamedManager(manager) {
  return Boolean(manager && UUID.test(String(manager.manager_id || ''))
    && String(manager.display_name || '').trim()
    && manager.active === true && !manager.revoked_at
    && manager.is_system_principal === false
    && Array.isArray(manager.roles) && manager.roles.some(role => MANAGER_ROLES.has(role)));
}

export function isCustodialOwner(manager) {
  return isActiveNamedManager(manager) && manager.system_key === OWNER_SYSTEM_KEY;
}

export function projectManagerSession(session, manager, { maximumAccessLevel = 'full_access', credentialBound = true } = {}) {
  const active = isActiveNamedManager(manager);
  const owner = active && isCustodialOwner(manager);
  // Never widen an already issued read-only owner credential. A fresh verified
  // Map sign-in issues full owner authority; old limited tokens remain limited.
  const full = Boolean(owner && credentialBound && session?.access_level === 'full_access'
    && maximumAccessLevel === 'full_access');
  const delegate = Boolean(active && !owner && credentialBound);
  return {
    ...session,
    manager_id: String(manager?.manager_id || ''),
    manager_display_name: String(manager?.display_name || ''),
    manager_system_key: manager?.system_key || null,
    roles: full ? [...OWNER_ROLES] : ['OPS_MANAGER'],
    access_level: full ? 'full_access' : 'read_only',
    read_only: !full,
    permissions: {
      schema: MANAGER_PERMISSION_SCHEMA,
      read: active,
      owner: full,
      close_scan_tickets: full || delegate,
      manage_absences: full || delegate,
      absence_coverage_required: delegate,
    },
  };
}

// This helper is not authentication. The HTTP middleware must first verify the
// signature AND current credential, named-manager association and registry row.
export function hasManagerPermission(session, action) {
  const permission = session?.permissions;
  if (permission?.schema !== MANAGER_PERMISSION_SCHEMA || permission.read !== true) return false;
  if (action === 'read') return true;
  if (action === 'write') return permission.owner === true && session.read_only === false;
  if (!['close_scan_tickets', 'manage_absences'].includes(action)) return false;
  return permission[action] === true;
}
