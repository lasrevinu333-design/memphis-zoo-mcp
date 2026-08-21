const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authenticatedManagerActor(session) {
  const managerId = String(session?.manager_id || "").trim();
  const displayName = String(session?.manager_display_name || "").trim();
  if (!UUID_PATTERN.test(managerId) || !displayName) {
    const error = new Error("An authenticated named manager identity is required.");
    error.status = 403;
    throw error;
  }
  return `manager:${managerId}:${displayName.slice(0, 155)}`;
}

export function assertServerAssignedActor(body) {
  if (Object.prototype.hasOwnProperty.call(body || {}, "closed_by")) {
    const error = new Error("closed_by is assigned from the authenticated manager session.");
    error.status = 422;
    throw error;
  }
}
