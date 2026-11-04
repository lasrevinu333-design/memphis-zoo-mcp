import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolveReleaseMigrationSource,bindExistingPostgresForwardSources} from './production-forward-source.mjs';
import {CURRENT_TAIL_STAGES} from './release-migration-current308-refusal.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
const proof=JSON.parse(read('release/production-forward-source/current309-tail-projection.json'));
const defaults=JSON.parse(read('release/production-forward-source/current308-existing-profile.json')).api_defaults;
const root=fileURLToPath(new URL('..',import.meta.url));
const canonical310=read('supabase/migrations/'+CURRENT_TAIL_STAGES[0].file);
const relations=[...canonical310.matchAll(/\('([^']+)',(\d+),'([a-f0-9]{64})','([a-f0-9]{64})',(true|false),ARRAY\[([^\]]*)\]::text\[\]\)/g)].map(m=>({identity:m[1],order:Number(m[2]),old:m[3],next:m[4],update:m[5]==='true',columns:[...m[6].matchAll(/'([^']+)'/g)].map(x=>x[1])}));
assert.equal(relations.length,240);assert.equal(proof.measured_relations.length,240);
for(const e of relations){const a=proof.measured_relations.find(x=>x.object_identity===e.identity);assert.equal(a.restore_order,e.order);for(const k of ['stored_sha256','stored_definition_sha256','live_sha256'])assert.equal(a[k],e.old);assert.deepEqual(a.columns_in_order,e.columns);assert.deepEqual(a.ordinals,e.columns.map((_,i)=>i+1));assert.equal(a.dropped,false);}
const aggregate=rows=>sha([...rows].sort((a,b)=>Buffer.compare(Buffer.from(a.object_kind+'\0'+a.object_identity),Buffer.from(b.object_kind+'\0'+b.object_identity))).map(x=>[x.restore_order,x.object_kind,x.object_identity,x.definition_sha256,x.actual_definition_sha256].join('\n')).join('\n---\n'));
assert.equal(aggregate(proof.inventory_metadata_before),proof.measured_inventory.sha256);
let changed=0;const projected=proof.inventory_metadata_before.map(row=>{let next=row.definition_sha256;
 if(row.object_kind==='relation'){const e=relations.find(x=>x.identity===row.object_identity);assert.equal(next,e.old);if(e.update)next=e.next;}
 if(row.object_kind==='function'&&row.object_identity==='custodial_release_authority_current_relation_definition(text)')next='11e37500c91e07715543c4f15cdcc221b7a1764c32153cc6086ce2a6137214b5';
 if(next!==row.definition_sha256)changed++;return {...row,definition_sha256:next,actual_definition_sha256:next};});
assert.equal(changed,239);assert.equal(aggregate(projected),proof.derived_current310_inventory_sha256);
for(const stage of CURRENT_TAIL_STAGES){const canonical=read('supabase/migrations/'+stage.file),variant=read('release/production-forward-source/'+stage.file);
 assert.equal(sha(canonical),stage.sha256);assert.equal(sha(variant),stage.forward_sha256);
 assert.deepEqual(JSON.parse(variant.split('$existing_defaults$')[1]),defaults);
 const acl=canonical.match(/ IF EXISTS\(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode\(d.defaclacl\) a[\s\S]*?RAISE EXCEPTION 'No API table or sequence defaults required';END IF;/)[0];
 let restored=variant.slice(variant.indexOf('\n')+1).replace(/DO \$production_forward_original_owner\$[\s\S]*?END \$production_forward_original_owner\$;\n/,'');
 restored=restored.replace(/ -- Existing-owner profile:[\s\S]*?RAISE EXCEPTION 'Exact existing existing API defaults differ';END IF;/,acl);
 restored=restored.replaceAll(proof.derived_current310_inventory_sha256,'7896672674d8355bdfb1c79eaf1cec8df290b8279accf6ce83907f01b4777cf0');
 if(stage.order===176)restored=restored.replaceAll(proof.measured_inventory.sha256,'f0b21739e0757ecaa1413f5b6f05b61bba526b550bc1c65cb49b860ad952a068').replaceAll(proof.measured_canary.function_sha256,'a60ddcc37b6affa49becbb5adb76a96a9bcd2dc25b6c7fec6085311346042224');
 assert.equal(restored,canonical,'Only exact owner/profile precondition and derived aggregate adaptations allowed');
 const [bound]=bindExistingPostgresForwardSources(root,[{order:stage.order,file:stage.file,source_migration_version:stage.file.slice(0,14),sha256:stage.sha256}]);assert.equal(resolveReleaseMigrationSource(root,bound).sql,variant);
 for(const mutate of [x=>delete x.forward_source,x=>x.forward_source.profile='supabase_admin',x=>x.forward_source.canonical_sha256='0'.repeat(64),x=>x.forward_source.file='../outside.sql',x=>x.sha256='0'.repeat(64),x=>x.forward_source.sha256='0'.repeat(64)]){const x=structuredClone(bound);mutate(x);assert.throws(()=>resolveReleaseMigrationSource(root,x));}
}
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY',measured_relation_predecessors:240,derived_current310_changed_inventory_rows:239,canonical_mutation_and_readback_logic_preserved:true,derived_postcondition:proof.derived_current310_inventory_sha256,actual_SQL:false,production:false}));
