import {createHash} from 'node:crypto';

// Bounded read-only evidence preview. No name-based joins, import or mutation.
export const PLACE_LEGACY_PREVIEW_SQL=`
select * from (
 select 'physical_location'::text legacy_kind,l.id legacy_id,l.location_code legacy_code,l.location_name display_name,l.active,
  jsonb_build_object('location_type',l.location_type) source_flags,
  '[]'::jsonb aliases,'{}'::jsonb source_relationships
 from public.locations l
 union all
 select 'location_group',g.id,g.group_code,g.group_name,g.active,
  jsonb_build_object('eligible_event_venue',g.eligible_event_venue,'eligible_event_scope',g.eligible_event_scope,
   'eligible_custodial_coverage',g.eligible_custodial_coverage,'eligible_staffing_assignment',g.eligible_staffing_assignment,
   'public_restroom',g.public_restroom,'staff_restroom',g.staff_restroom,'exhibit',g.exhibit,'restaurant',g.restaurant),
  coalesce((select jsonb_agg(jsonb_build_object('alias_id',a.id,'text',a.alias_text,'active',a.active) order by a.id)
   from public.location_group_aliases a where a.location_group_id=g.id),'[]'::jsonb),
  jsonb_build_object('physical_memberships',coalesce((select jsonb_agg(jsonb_build_object('membership_id',m.id,'physical_location_id',m.location_id,'active',m.active) order by m.id)
   from public.location_group_memberships m where m.location_group_id=g.id),'[]'::jsonb))
 from public.location_groups g
 union all
 select 'event_venue',v.id,v.venue_code,v.display_name,v.active,
  jsonb_build_object('event_scope',v.event_scope,'eligible_event_venue',v.eligible_event_venue,'eligible_event_scope',v.eligible_event_scope),
  to_jsonb(v.aliases),jsonb_build_object('location_group_id',v.location_group_id)
 from public.event_venues v
) legacy order by legacy_kind,legacy_id limit 10001`;

export function buildPlaceReconciliation(rows,registry){
 if(!Array.isArray(rows)||!Array.isArray(registry?.places))throw new Error('Invalid catalog preview response.');
 const truncated=rows.length>10000,selected=rows.slice(0,10000);
 const places=registry.places;
 const records=selected.map(row=>{
  const links=row.legacy_kind==='physical_location'?places.filter(p=>p.physical_location_id===row.legacy_id):[];
  return {...row,canonical_place_ids:links.map(p=>p.place_id),
   disposition:links.length===1?'PHYSICAL_ID_LINK_PRESENT':links.length>1?'AMBIGUOUS_ID_LINK':'UNMAPPED',
   needs_review:true,operational_cutover:false};
 });
 return {read_at:new Date().toISOString(),source:'existing authoritative legacy catalogs (read-only)',
  preview_fingerprint:createHash('sha256').update(JSON.stringify({records,registry_places:places})).digest('hex'),
  fingerprint_scope:'bounded preview fields, NOT a complete import or protected-history manifest',
  complete_manifest:false,snapshot_consistency:'separate registry and legacy reads; not an atomic import preview',
  reader_limit_metadata_available:false,
  records,returned:records.length,truncated,canonical_count:places.length,
  missing_legacy_bridge:true,import_available:false,consumer_cutover:false,
  rule:'Identity namespaces are preserved. Explicit physical FK is a link, not proof of imported aliases, consumer adoption, or phone/tag acceptance. Group/venue mappings require a protected bridge; never match by name or choose the first physical member.'};
}
