// Run only against an already-owned disposable replay; never a production URL.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {PLACE_LEGACY_PREVIEW_SQL,buildPlaceReconciliation} from '../src/place-reconciliation.js';
const container=process.argv[2];
assert.match(container??'',/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:30000,maxBuffer:10_000_000});
const inspected=JSON.parse(docker(['inspect',container]))[0];
assert.equal(inspected.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspected.HostConfig.PortBindings??{}).length,0);
assert.equal(inspected.Config.Image,'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed');
const sql=`begin read only;set local role custodial_application_reader;
 select jsonb_build_object('role',current_user,'read_only',current_setting('transaction_read_only'),
 'rows',coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)) from (${PLACE_LEGACY_PREVIEW_SQL})q;
 rollback;`;
const result=JSON.parse(docker(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],sql).trim());
assert.equal(result.role,'custodial_application_reader');assert.equal(result.read_only,'on');assert.ok(Array.isArray(result.rows));
const output=buildPlaceReconciliation(result.rows,{places:[]});
for(const row of output.records){
 assert.ok(['physical_location','location_group','event_venue'].includes(row.legacy_kind));
 assert.equal(row.disposition,'UNMAPPED');assert.equal(row.needs_review,true);assert.equal(row.operational_cutover,false);
 if(row.legacy_kind==='location_group')assert.ok(Array.isArray(row.source_relationships.physical_memberships));
}
assert.equal(output.complete_manifest,false);assert.equal(output.import_available,false);assert.equal(output.consumer_cutover,false);
console.log(JSON.stringify({status:'PASS_ACTUAL_RESTRICTED_PLACE_PREVIEW',rows:result.rows.length,actualRole:result.role,readOnly:true,production:false,scope:'Exact static catalog SELECT and transformation; no import/consumer adoption or atomic-manifest proof'}));
