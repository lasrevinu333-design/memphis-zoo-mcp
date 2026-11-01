// Additional completion proof only. This does not import DATA, resume a restore,
// revoke legacy authorities, or replace the original six guarded effects.
export async function verifyRestoredLeadershipGeneration(db, { restoreId, generation, archiveTables = null }) {
  if (!db || typeof db.query !== "function" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restoreId || "")
    || !Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("Original protected restore generation is required.");
  }
  // Catalog discovery never references a possibly absent application relation.
  // The original owning transaction and protected control row remain required.
  const domainResult = await db.query(`with control as materialized (
      select restore_id::text, authority_generation::text, mutations_paused, state
      from custodial_dr.restore_control where singleton for share
    ) select control.*,
      exists(select 1 from pg_catalog.pg_namespace where nspname='custodial_leadership_private') as namespace_present,
      exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='custodial_leadership_private' and c.relname='registrations' and c.relkind='r') as registrations_present,
      exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='custodial_leadership_private' and p.proname='session_view'
          and pg_catalog.oidvectortypes(p.proargtypes)='uuid') as session_view_present
    from control where restore_id=$1::text and authority_generation=$2::text`, [restoreId, generation]);
  const domain = domainResult?.rows?.[0];
  const pausedControl = row => row && row.restore_id === restoreId
    && row.authority_generation === String(generation) && row.mutations_paused === true
    && ["PREPARING", "DATABASE_RESTORED", "STORAGE_RESTORING", "VERIFYING", "PAUSED_RECONCILIATION"].includes(row.state);
  if (domainResult?.rowCount !== 1 || domainResult.rows.length !== 1 || !pausedControl(domain)
    || !['namespace_present','registrations_present','session_view_present'].every(key=>typeof domain[key]==='boolean')) {
    throw new Error("Restored leadership authority remains unverified; completion must stay paused.");
  }
  if (!domain.namespace_present && !domain.registrations_present && !domain.session_view_present) {
    // Production restore supplies only its already signature/checksum-verified
    // table catalog, with original archive identity checked before and after.
    // An omitted current schema, partial domain or caller's absent-table claim
    // cannot retire the registration guard.
    if (!Array.isArray(archiveTables) || archiveTables.length === 0
      || !archiveTables.every(row=>row && typeof row.schema_name==='string' && /^[a-z_][a-z0-9_]*$/.test(row.schema_name)
        && typeof row.table_name==='string' && /^[a-z_][a-z0-9_]*$/.test(row.table_name))
      || archiveTables.some(row=>row.schema_name==='custodial_leadership_private')) {
      throw new Error("Restored leadership authority remains unverified; legacy archive evidence is required.");
    }
    return Object.freeze({schema:"custodial.leadership-restore-generation.v1",restore_id:restoreId,
      authority_generation:generation,registration_count:0,unsafe_generation_count:0,accepted_registration_count:0,
      outcome:"LEGACY_ARCHIVE_WITHOUT_LEADERSHIP_DOMAIN",
      archive_registration_domain:"ABSENT_FROM_VERIFIED_CATALOG_AND_RESTORED_DATABASE"});
  }
  if (!domain.namespace_present || !domain.registrations_present || !domain.session_view_present) {
    throw new Error("Restored leadership authority remains unverified; incomplete registration domain.");
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
