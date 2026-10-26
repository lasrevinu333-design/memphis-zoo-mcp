// The accepted operation is immutable history. A later (same-transaction)
// future-authority invalidation is CURRENT status, never a rewritten receipt.
export function withRecurringDependencyStatus(accepted, state) {
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  if (!accepted || !integer(accepted.revision) || !state || !integer(state.authorityRevision)
    || state.authorityRevision < accepted.revision || !integer(state.processedChangeCount)
    || !Array.isArray(state.invalidations) || !Array.isArray(state.blockedPublications)
    || state.affectedPhonesUpdated !== false) {
    throw new Error('Invalid recurring dependency reconciliation result; transaction cannot commit.');
  }
  for (const blocked of state.blockedPublications) {
    if (!blocked || blocked.state !== 'BLOCKED_RECURRING_AUTHORITY'
      || !/^[0-9a-f-]{36}$/.test(blocked.publicationId) || !/^[0-9a-f-]{36}$/.test(blocked.invalidationId)
      || !integer(blocked.authorityRevision) || blocked.authorityRevision > state.authorityRevision
      || !/^\d{4}-\d{2}-\d{2}$/.test(blocked.effectiveStart)
      || (blocked.effectiveEnd !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(blocked.effectiveEnd)
        || blocked.effectiveEnd <= blocked.effectiveStart))) {
      throw new Error('Invalid blocked recurring range; transaction cannot commit.');
    }
  }
  if (!state.processedChangeCount && !state.blockedPublications.length) return accepted;
  // A publication-wide false-current claim is unsafe even if this response
  // does not include its week. Refresh reads use the precise service-day range.
  const projection = accepted.data?.current_projection;
  const blockedProjection = projection && state.blockedPublications.some(row => row.publicationId === projection.publication_id);
  return {
    ...accepted,
    revision: state.authorityRevision,
    accepted_operation_receipt: accepted,
    data: {
      ...accepted.data,
      ...(blockedProjection ? { current_projection: null, projection_status: 'blocked_recurring_authority' } : {}),
      recurring_dependency_reconciliation: state,
    },
  };
}
