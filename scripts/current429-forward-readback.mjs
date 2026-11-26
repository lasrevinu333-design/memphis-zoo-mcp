import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stableJson} from './disaster-recovery-crypto.mjs';

const expectedRoutineGrants=Object.freeze({
  custodial_feedback_create_current_employee:'service_role',
  custodial_assign_employee_device_at_epoch:'service_role',
  static_weekly_initial_fill_slots:'static_weekly_control_plane',
  msg_set_memphis_thread_context_for_turn:'service_role',
});
const recoveryBefore=[
  '6fa48fcc808225665b61e9e7e286e06cc466cb160576bd26522ca0ee3b375170',
  '7956b0b208e62458fdd54bf96578c06fc490d583e5fcf06aa66baa2cbe8957d9',
];
const recoveryAfter=[
  'bcd6226b779ad70162bbdf08ec78706914a6d9f577fcc6f63cd8eff958d1ea92',
  'd159cb1178773a72ac25d1fa49272d5f4a7338cb775f886976c2c1af081160f8',
];

export function assertCurrent429CatalogDelta(source,target) {
  const added=row=>row.schema_name==='public'&&Object.hasOwn(expectedRoutineGrants,row.function_name);
  assert.ok(!source.functions.some(added)&&!source.routine_grants.some(added));
  const routines=target.functions.filter(added);
  const grants=target.routine_grants.filter(added);
  assert.deepEqual(routines.map(row=>row.function_name).sort(),Object.keys(expectedRoutineGrants).sort());
  assert.ok(routines.every(row=>row.owner_name==='migration_owner'&&/\bSECURITY DEFINER\b/.test(row.definition)));
  assert.deepEqual(grants.map(row=>row.function_name).sort(),Object.keys(expectedRoutineGrants).sort());
  assert.ok(grants.every(row=>row.grantee===expectedRoutineGrants[row.function_name]
    &&row.grantor==='migration_owner'&&row.privilege_type==='EXECUTE'&&row.is_grantable===false
    &&routines.some(routine=>routine.function_name===row.function_name&&routine.identity_arguments===row.identity_arguments)));
  assert.deepEqual({...target,functions:target.functions.filter(row=>!added(row)),
    routine_grants:target.routine_grants.filter(row=>!added(row))},source,'Only the four reviewed routines and grants may change');
}

export async function readCurrent429Registry(query, phase) {
  assert.ok(['before','after'].includes(phase));
  const result=await query(`with inventory as (
    select i.*, case i.restore_order
      when 100308 then pg_get_functiondef('public.evaluate_location_proximity_v2(text,text,numeric,numeric,numeric,text,text,text,timestamptz)'::regprocedure)
      when 850002 then public.custodial_release_authority_current_view_definition('public.v_location_dashboard_status')
    end as current_definition
    from public.custodial_release_authority_restore_inventory i
  ) select count(*)::int as count,
    public.static_weekly_digest_text(coalesce(string_agg(to_jsonb(inventory)::text,E'\\n' order by restore_order)
      filter(where restore_order not in (100308,850002)),'')) as unchanged_sha256,
    jsonb_agg(definition_sha256 order by restore_order) filter(where restore_order in (100308,850002)) as bound_hashes,
    bool_and(definition_sha256=public.static_weekly_digest_text(definition_sql))
      filter(where restore_order in (100308,850002)) as stored_hashes_exact,
    bool_and(definition_sql=current_definition) filter(where restore_order in (100308,850002)) as current_definitions,
    (select count(*)::int from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
      and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') as always_guard,
    (select coalesce(jsonb_agg(jsonb_build_array(evtname,evtevent,evtenabled,
      public.static_weekly_digest_text(pg_get_functiondef(evtfoid))) order by evtname),'[]'::jsonb)
      from pg_event_trigger where evtname in ('custodial_dr_guard_application_ddl','custodial_dr_install_application_mutation_fences')) as event_guards
    from inventory`);
  assert.equal(result.rowCount,1);
  const row=result.rows[0];
  assert.equal(row.count,7820);
  assert.match(row.unchanged_sha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(row.bound_hashes,phase==='before'?recoveryBefore:recoveryAfter);
  assert.equal(row.stored_hashes_exact,true);
  assert.equal(row.current_definitions,phase==='after');
  assert.equal(row.always_guard,1);
  assert.deepEqual(row.event_guards.map(g=>[g[0],g[2]]),[
    ['custodial_dr_guard_application_ddl','O'],['custodial_dr_install_application_mutation_fences','O'],
  ]);
  assert.ok(row.event_guards.every(g=>/^[0-9a-f]{64}$/.test(g[3])));
  return {other_inventory_sha256:row.unchanged_sha256,event_guard_sha256:createHash('sha256').update(stableJson(row.event_guards)).digest('hex')};
}

