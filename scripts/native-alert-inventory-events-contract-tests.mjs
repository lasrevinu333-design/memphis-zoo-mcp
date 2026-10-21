import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Source-derived function bodies and exact finite splice simulation, NOT a SQL
// executor, catalog capture or caller-privilege proof. Real SQL remains required.
const read=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const FILE='20261004161015_native_alert_provider_inventory_events.sql';
const pins={
 '20261003010000_native_location_lifecycle.sql':'e0512cb5dcc284b18a92b666c495ada7cf956c2f4cce2b3753e7acbd066b0211',
 '20261003150000_native_provider_interval_protocol.sql':'cb94f7cd6dd949407a936a2c6915bd0ef0972fb79a1cf89b2e480d628c50b194',
 '20261003194000_native_lunch_delivery.sql':'22ef0f716accbd8c2222a117ba876a04631163399ec5619418ddc2e0835f156b',
 '20261004150151_native_alert_two_stage_preparation.sql':'ac72bda04ba89560117b04e8939f3d17b2eb65b0002b107c36f96436a02600eb',
 '20261004150425_native_alert_finalization.sql':'ff3cd8d783543702ca4e74d8ab6bd1d690c3c00b826ccbcec336adc2117b6699',
};
let checks=0;const check=fn=>{fn();checks++;};
for(const [file,hash] of Object.entries(pins))check(()=>assert.equal(sha(read(file)),hash,'exact predecessor '+file));
function body(source,name){
 const declarations=[...source.matchAll(new RegExp('create (?:or replace )?function public\\.'+name+'\\(','g'))];
 assert.equal(declarations.length,1,'one exact source declaration');
 const match=source.slice(declarations[0].index).match(/as \$fn\$([\s\S]*?)\$fn\$;/);
 assert.ok(match);return match[1];
}
function patchBlock(source,name){
 const blocks=[...source.matchAll(/do \$patch\$([\s\S]*?)end \$patch\$;/g)]
  .map(x=>x[1]).filter(x=>x.includes("pg_get_functiondef('public."+name+'('));
 assert.equal(blocks.length,1,'one owning function patch');return blocks[0];
}
function replaceOne(source,before,after){assert.equal(source.split(before).length,2,'exact single predecessor seam');return source.replace(before,after);}
function literalPatches(source,block,want){
 const matches=[...block.matchAll(/old:=\$old\$([\s\S]*?)\$old\$;\s*replacement:=\$new\$([\s\S]*?)\$new\$;/g)];
 assert.equal(matches.length,want,'all expected literal source splices must execute');
 for(const [,before,after] of matches)source=replaceOne(source,before,after);return source;
}
const lunch=read('20261003194000_native_lunch_delivery.sql');
const names={events:'custodial_native_provider_events_at',inventory:'custodial_native_location_inventory_at',rows:'custodial_native_location_inventory_rows'};
const predecessors={
 events:literalPatches(body(read('20261003150000_native_provider_interval_protocol.sql'),names.events),patchBlock(lunch,names.events),2),
 inventory:body(read('20261003010000_native_location_lifecycle.sql'),names.inventory),
 rows:literalPatches(body(read('20261003010000_native_location_lifecycle.sql'),names.rows),patchBlock(lunch,names.rows),1),
};
const hashes={events:'574bb2f8e29c0d0475bba4ab164bcd42a380921f1b15e5d214d68cc9e184ab25',
 inventory:'5a8aa85da05e5ec99a5b19b99e68689f112ba046a1236908fa6d962a192e7d91',
 rows:'92887ab72a6869aa115231154f2aefb47107c8a01934f5a32416cf224279f4c2'};
const current=read(FILE);
for(const [key,hash] of Object.entries(hashes)){
 check(()=>assert.equal(sha(predecessors[key]),hash));
 check(()=>assert.ok(current.includes("'"+hash+"'"),'migration enforces same source-derived body'));
 check(()=>assert.notEqual(sha(predecessors[key]+' '),hash,'unrelated body drift cannot retain authority'));
}
check(()=>assert.ok(current.indexOf('do $predecessors$')<current.indexOf('alter table public.employee_native_provider_events')));
check(()=>assert.match(current,/static_weekly_digest_text\(actual\) is distinct from target.body_sha256/));

function compose(source){
 const inventory=literalPatches(predecessors.inventory,patchBlock(source,names.inventory),2);
 const block=patchBlock(source,names.events);
 const patches=[...block.matchAll(/old:=\$old\$([\s\S]*?)\$old\$;\s*replacement:=(?:\$new\$([\s\S]*?)\$new\$|old\|\|E'((?:[^']|'')*)');/g)];
 assert.equal(patches.length,6,'five literal patches and one exact appended lock');
 let events=predecessors.events,appended=0;
 for(const [,old,literal,escaped] of patches){
  let next=literal;
  if(escaped!==undefined){assert.ok(escaped.startsWith('\\n'));assert.ok(!escaped.slice(2).includes('\\'));next=old+'\n'+escaped.slice(2).replaceAll("''","'");appended++;}
  events=replaceOne(events,old,next);
 }
 assert.equal(appended,1);
 assert.equal(events.split('r.prepared_at').length-1,6);assert.equal(events.split('r.native_valid_until').length-1,3);
 events=events.replaceAll('r.prepared_at','reservation_started').replaceAll('r.native_valid_until','valid_cutoff');
 events=replaceOne(events,'else reservation_started end','else r.prepared_at end');
 events=replaceOne(events,'else valid_cutoff end','else r.native_valid_until end');
 assert.equal(events.split('r.prepared_at').length-1,1);assert.equal(events.split('r.native_valid_until').length-1,1);
 return {events,inventory};
}
const composed=compose(current);
check(()=>assert.match(composed.events,/if public\.custodial_native_alert_event_binding\(alert.job_id,e,c.credential_id,at_time\) is not true/));
check(()=>assert.match(composed.events,/admitted<reservation_started or admitted_last>=valid_cutoff or admitted>at_time or observed>at_time/));
check(()=>assert.match(composed.events,/observed is null or observed<reservation_started or observed_last>=valid_cutoff/));
check(()=>assert.match(composed.events,/if prior.original_event<>e then code:='native_provider_event_conflict';else replayed:=true/));
check(()=>assert.match(composed.events,/received.original_event->'admission_bounds'<>e->'admission_bounds'/));
check(()=>assert.match(composed.events,/and payload->>'schema'='custodial.native-location-payload.v2' then\s+perform public.custodial_native_location_project_ack/));
check(()=>assert.match(composed.events,/g.generation_id,\(e->>'receipt_job_id'\)::uuid,c.credential_id/));
check(()=>assert.match(composed.inventory,/cardinality\(ids\)>4096/));
check(()=>assert.match(composed.inventory,/count_rows=32 then has_more:=true/));
check(()=>assert.match(composed.inventory,/order by x.reservation_at,x.job_id limit 33/));
check(()=>assert.match(composed.inventory,/custodial_native_provider_original_tuple\(job.job_id\)=p_body->'cursor'/));
check(()=>assert.match(composed.inventory,/if bound is null then raise exception 'original bounded native ceiling unavailable'/));
const rows=body(current,names.rows),legacy=rows.split('\n union all\n')[0]+';\n';
check(()=>assert.equal(legacy,predecessors.rows,'entire Location/Lunch inventory branch remains byte-exact'));
check(()=>assert.match(rows,/a\.valid_until>p_at[\s\S]*custodial_native_alert_source_live\(a.job_id,p_at\) is true/));
check(()=>assert.match(rows,/n.job_id=a.job_id and n.action='acknowledged'/));
check(()=>assert.doesNotMatch(rows,/union all[\s\S]*from public.employee_native_alert_preparations\s/));

function originalReceiptBoundary(source){
 const binding=body(source,'custodial_native_alert_event_binding');
 assert.doesNotMatch(binding,/a\.valid_until\s*<=\s*p_at|custodial_native_alert_source_live\(|provider_outcome/,
  'original receipt reconciliation is not a fresh inventory/send window');
 for(const needle of ["a.finalized_at>p_at","g.revoked_at is not null","a.payload->>'receipt_job_id' is distinct from p_job::text",
  "g.device_id::text is distinct from prep.expected->>'device_uuid'","a.payload->>'content_sha256' is distinct from a.content_sha256",
  "p_event->>field is distinct from a.payload->>field","legacy.native_payload is not null"])
  assert.ok(binding.includes(needle),needle);
 return binding;
}
const binding=originalReceiptBoundary(current);checks++;
// Retained draft's actual refusal predicate, copied literally. This reproduces
// the SOURCE mismatch; it is not represented as a PostgreSQL execution.
check(()=>assert.throws(()=>originalReceiptBoundary(current.replace(' return true;\nexception when data_exception',
 ' if a.valid_until<=p_at then return false;end if;\n return true;\nexception when data_exception'))));
for(const needle of ["g.revoked_at is not null","a.payload->>'receipt_job_id' is distinct from p_job::text",
 "p_event->>field is distinct from a.payload->>field","legacy.native_payload is not null"])
 check(()=>assert.throws(()=>originalReceiptBoundary(current.replace(needle,'removed_guard'))));
for(const match of patchBlock(current,names.events).matchAll(/old:=\$old\$([\s\S]*?)\$old\$;/g))
 check(()=>{const changed=current.replace(match[0],match[0].replace('$old$;','__changed__ $old$;'));
  assert.notEqual(changed,current);assert.throws(()=>compose(changed),undefined,'an altered splice cannot silently partially apply');});

// Admission intervals remain the existing half-open payload window. Late
// receipt time is not a future effect grant. The SQL assertions above bind the
// actual unchanged formula; these finite values illustrate both boundaries.
const originalInterval=(start,end,earliest,latest,received)=>earliest>=start&&latest<end&&earliest<=received;
for(const [args,expected] of [
 [[100,200,100,100,100],true],[[100,200,100,199,1000],true],[[100,200,199,199,1000],true],
 [[100,200,99,100,1000],false],[[100,200,100,200,1000],false],[[100,200,200,200,1000],false],[[100,200,150,151,149],false],
])check(()=>assert.equal(originalInterval(...args),expected));
check(()=>assert.doesNotMatch(current,/grant execute|grant (?:select|insert|update|delete)|disable row level security/));
check(()=>assert.match(current,/from public,anon,authenticated,service_role,static_weekly_control_plane,[\s\S]*static_weekly_release_operator,custodial_application_reader,static_weekly_runtime_20260823/));
console.log(JSON.stringify({status:'NATIVE_ALERT_INVENTORY_EVENTS_SOURCE_PASS',checks,
 migration_sha256:sha(current),source_bodies:Object.fromEntries(Object.entries(composed).map(([key,value])=>[key,sha(value)])),
 sql:false,recovery_complete:false,provider_activation:false,scope:'exact predecessor/splice and durable receipt interval source boundary only'}));
