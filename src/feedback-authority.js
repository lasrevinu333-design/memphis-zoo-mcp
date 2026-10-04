function normalized(value) {
  return String(value ?? "").trim();
}

export function requestedFeedbackHub(req) {
  const raw = normalized(req?.body?.hub_context ?? req?.body?.hub ?? "public").toLowerCase();
  if (raw === "employee" || raw === "manager") return raw;
  return "public";
}

export function makeFeedbackSubmitAuthority({ requireEmployeeDeviceCredential, requireOpsManagerWrite, authenticatePresentedOpsAccessRequest } = {}) {
  if (typeof requireEmployeeDeviceCredential !== "function") throw new TypeError("Employee device middleware is required.");
  if (typeof requireOpsManagerWrite !== "function") throw new TypeError("Manager write middleware is required.");
  if (typeof authenticatePresentedOpsAccessRequest !== "function") throw new TypeError("Presented manager credential detection is required.");
  return function requireFeedbackSubmitAuthority(req, res, next) {
    const hub = requestedFeedbackHub(req);
    // A selector cannot downgrade a presented manager credential into an
    // anonymous or employee mutation. The existing write guard revalidates
    // its current named-manager association, revocation and access level.
    if (hub === "manager" || authenticatePresentedOpsAccessRequest(req).presented) {
      return requireOpsManagerWrite(req, res, authorizeSelectedHub);
    }
    return authorizeSelectedHub();

    function authorizeSelectedHub() {
      if (hub === "employee") {
        return requireEmployeeDeviceCredential(req, res, () => {
          if (req.memphisDeviceAuth?.credentialed !== true || !req.memphisDeviceCredential?.credential_id) {
            res.status(401).json({
              ok: false,
              code: "device_credential_required",
              error: "This phone must finish enrollment before feedback can be sent.",
            });
            return;
          }
          next();
        });
      }
      next();
    }
  };
}

export function authoritativeFeedbackPayload(req) {
  const source = req?.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const hub = requestedFeedbackHub(req);
  if (hub === "employee") {
    if (req?.memphisDeviceAuth?.credentialed !== true || !req?.memphisDeviceCredential?.credential_id) {
      throw Object.assign(new Error("Enrolled phone identity is required for employee feedback."), { status: 401 });
    }
    const device = req.memphisDevice || {};
    const canonicalDeviceId = normalized(device.canonical_device_id || device.device_id).toUpperCase();
    const assignmentEpochText = normalized(device.assignment_epoch);
    const assignmentEpoch = Number(assignmentEpochText);
    if (!canonicalDeviceId) throw Object.assign(new Error("Enrolled phone identity is unavailable."), { status: 401 });
    const expectedEmployeeId=normalized(source.expected_employee_id).toLowerCase();
    if(expectedEmployeeId && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(expectedEmployeeId)
      || expectedEmployeeId!==normalized(device.assigned_employee_id||device.employee_id).toLowerCase())) {
      throw Object.assign(new Error("Saved feedback belongs to a previous employee assignment and needs review."),
        {status:409,code:"feedback_employee_assignment_changed"});
    }
    return {
      ...source,
      hub_context: "employee",
      device_id: canonicalDeviceId,
      submitted_by: normalized(device.assigned_employee_name || device.employee_name || device.display_name) || null,
      identity_verification: {
        status: "verified",
        kind: "enrolled_employee_device",
        device_id: canonicalDeviceId,
        credential_id: normalized(req.memphisDeviceCredential.credential_id).toLowerCase(),
        employee_id: normalized(device.assigned_employee_id || device.employee_id).toLowerCase() || null,
        assignment_epoch: assignmentEpochText && Number.isSafeInteger(assignmentEpoch) && assignmentEpoch >= 1
          ? assignmentEpoch
          : null,
      },
    };
  }
  if (hub === "manager") {
    const managerId = normalized(req?.memphisAuth?.manager_id).toLowerCase();
    const managerName = normalized(req?.memphisAuth?.manager_display_name);
    if (!managerId || !managerName) {
      throw Object.assign(new Error("Current named manager access is required for manager feedback."), { status: 401 });
    }
    for (const [field, actual] of [["expected_manager_id", managerId],
      ["expected_credential_id", normalized(req.memphisAuth.credential_id).toLowerCase()]]) {
      const expected = normalized(source[field]).toLowerCase();
      if (expected && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(expected) || expected !== actual)) {
        throw Object.assign(new Error("Saved feedback belongs to a different manager authority and remains pending."),
          { status: 409, code: "feedback_manager_authority_changed" });
      }
    }
    return {
      ...source,
      hub_context: "manager",
      device_id: normalized(req.memphisAuth.device_id).toUpperCase() || null,
      submitted_by: managerName,
      identity_verification: {
        status: "verified",
        kind: "named_manager_session",
        manager_id: managerId,
        device_id: normalized(req.memphisAuth.device_id).toUpperCase() || null,
        credential_id: normalized(req.memphisAuth.credential_id).toLowerCase() || null,
      },
    };
  }
  return {
    ...source,
    hub_context: "public",
    device_id: null,
    submitted_by: null,
    identity_verification: {
      status: "unverified",
      kind: "public_anonymous",
    },
  };
}
