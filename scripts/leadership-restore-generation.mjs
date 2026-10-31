// Additional completion proof only. This does not import DATA, resume a restore,
// revoke legacy authorities, or replace the original six guarded effects.
export async function verifyRestoredLeadershipGeneration(db, { restoreId, generation }) {
  if (!db || typeof db.query !== "function" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restoreId || "")
    || !Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("Original protected restore generation is required.");
  }
  const result = await db.query(`with control as materialized (
      select restore_id::text, authority_generation::text, mutations_paused, state
      from custodial_dr.restore_control where singleton for share
    ) select control.*,
      (select count(*)::text from custodial_leadership_private.registrations) registration_count,
      (select count(*)::text from custodial_leadership_private.registrations r
        where r.revoked_at is null and r.authority_generation >= $2::bigint) unsafe_generation_count,
      (select count(*)::text from custodial_leadership_private.registrations r
        where custodial_leadership_private.session_view(r.registration_id) is not null) accepted_registration_count
    from control where restore_id=$1::text`, [restoreId, generation]);
  const row = result?.rows?.[0];
  const count = value => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value));
  if (result?.rowCount !== 1 || result.rows.length !== 1 || row.restore_id !== restoreId
    || row.authority_generation !== String(generation) || row.mutations_paused !== true
    || !["PREPARING", "DATABASE_RESTORED", "STORAGE_RESTORING", "VERIFYING", "PAUSED_RECONCILIATION"].includes(row.state)
    || !count(row.registration_count) || row.unsafe_generation_count !== "0" || row.accepted_registration_count !== "0") {
    throw new Error("Restored leadership authority remains unverified; completion must stay paused.");
  }
  return Object.freeze({ schema: "custodial.leadership-restore-generation.v1", restore_id: restoreId,
    authority_generation: generation, registration_count: Number(row.registration_count),
    unsafe_generation_count: 0, accepted_registration_count: 0, outcome: "RESTORED_REGISTRATIONS_DENIED" });
}
