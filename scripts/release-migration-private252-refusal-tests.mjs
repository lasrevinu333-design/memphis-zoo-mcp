import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
import {readPrivateCustodySource252Reference,readPrivateCustodySource252Refusal,runTargetCaptureStep,PRIVATE_CUSTODY_SOURCE252_FILE,PRIVATE_CUSTODY_SOURCE252_SHA256,PRIVATE_CUSTODY_SOURCE252_REFERENCE_SHA256} from './release-migration-target-refusal.mjs';
let checks=0;const test=async(name,fn)=>{await fn();checks++;};const sha=s=>createHash('sha256').update(s).digest('hex');
const ref=readPrivateCustodySource252Reference(),path=new URL('../supabase/migrations/'+PRIVATE_CUSTODY_SOURCE252_FILE,import.meta.url),canonical=fs.readFileSync(path,'utf8');
const rows=()=>ref.rows.map(([object_kind,object_identity,restore_order,definition_sha256])=>({object_kind,object_identity,restore_order,definition_sha256,actual_definition_sha256:definition_sha256,definition_bytes:'64'}));
const key=r=>JSON.stringify([r.object_kind,r.object_identity]);const known=new Set(rows().map(key));
const migration={order:119,file:PRIVATE_CUSTODY_SOURCE252_FILE,sha256:PRIVATE_CUSTODY_SOURCE252_SHA256};
function fixture({mutate=()=>{},count=null,deny=false}={}){let aborted=false;const calls=[],observed=rows();mutate(observed);return{calls,abort(){aborted=true;},async query(sql,args){
 calls.push({sql,args});if(sql==='rollback to savepoint custodial_target_migration_step'){aborted=false;return{rows:[]};}
 assert.equal(aborted,false,'metadata follows rollback to savepoint');if(sql==='savepoint custodial_target_migration_step'||sql.startsWith('set local search_path'))return{rows:[]};
 assert.ok(sql.startsWith('select ')||sql.startsWith('with wanted'),'SELECT-only Source/catalog metadata');
 if(deny){aborted=true;throw Object.assign(Error('UNIT private DB error not exportable'),{code:'42501'});}
 assert.ok(!sql.includes('events_app_events')&&!sql.includes('device_auth_credentials')&&!/\bfrom\s+auth\./.test(sql),'no operational DATA queries');
 if(sql.includes('inventory_count,'))return{rows:[{inventory_count:count??String(observed.length),inventory_sha256:ref.inventory_sha256,selfhash_mismatches:'0',duplicate_identity_groups:'0',duplicate_order_groups:'0'}]};
 if(sql.includes('group by object_kind order by'))return{rows:[{object_kind:'UNIT_SOURCE_ONLY',rows:'6884'}]};
 if(sql.includes('unqualified_same_public_oid')){assert.ok(sql.includes("to_regprocedure('public.custodial_release_canary_authority_surface()') and p.pronamespace='public'::regnamespace"));return{rows:[{public_oid:'4242',public_schema:true,unqualified_same_public_oid:true,definition_sql:'UNIT source canary',definition_sha256:ref.canary_sha256}]};}
 if(sql.includes('new_routine_names_absent'))return{rows:[{inventory_owner:'postgres',tgenabled:'A',operations_absent:true,chunks_absent:true,new_routine_names_absent:true}]};
 if(sql.includes('limit 8193'))return{rows:observed};
 if(sql.startsWith('with wanted')){assert.equal(args.length,1);const wanted=JSON.parse(args[0]);assert.ok(wanted.every(x=>known.has(key(x))));assert.ok(sql.includes("else 'public.'||object_identity end end function_identity"));assert.ok(sql.includes('original_spelling_same_function_oid'));assert.ok(sql.includes('to_regprocedure(w.object_identity)=p.oid'));return{rows:wanted.map(x=>({...x,UNIT:'fixed changed-key metadata only'}))};}
 assert.fail('unexpected diagnostic SQL');
}};}
await test('exact canonical119 source binds the complete unchanged guard',()=>{
 assert.equal(sha(canonical),PRIVATE_CUSTODY_SOURCE252_SHA256);assert.equal(sha(fs.readFileSync(new URL('../release/production-forward-source/private-custody-source252-reference.json',import.meta.url))),PRIVATE_CUSTODY_SOURCE252_REFERENCE_SHA256);
 for(const p of ['<>6884',ref.inventory_sha256,ref.canary_sha256,"definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(definition_sql)"])assert.ok(canonical.includes(p));
});
await test('reference is exact independently retained NOAUTO6884 Source tuple digest, never normal48ba',()=>{
 assert.equal(ref.count,6884);assert.equal(known.size,6884);assert.equal(ref.raw_capture_sha256,'37f0382ee69fb5b63096962b294c516233bb9df5d2884ae21bcb54eada6e7614');assert.equal(ref.derivation_capture_sha256,'1ba47cc405ee5423235ec8a29b91175816fef07a8004c6e4beb90f1430e92d2d');
 const sorted=rows().sort((a,b)=>Buffer.compare(Buffer.from(a.object_kind),Buffer.from(b.object_kind))||Buffer.compare(Buffer.from(a.object_identity),Buffer.from(b.object_identity)));
 assert.equal(sha(sorted.map(r=>r.restore_order+'\n'+r.object_kind+'\n'+r.object_identity+'\n'+r.definition_sha256).join('\n---\n')),ref.inventory_sha256);
 assert.equal(ref.release_admission,false);assert.equal(ref.actual_production,false);
});
await test('same6884 metadata produces zero differences without querying bodies or business DATA',async()=>{
 const db=fixture(),out=await readPrivateCustodySource252Refusal(db);assert.deepEqual(out.difference_counts,{missing:0,extra:0,changed:0});assert.deepEqual(out.current_catalog_metadata,[]);assert.equal(db.calls.length,5);assert.equal(out.operational_rows_selected,false);assert.equal(out.unknown_routine_bodies_exported,false);
});
for(const [name,mutate]of [
 ['changed stored hash',r=>{r[0].definition_sha256='0'.repeat(64);r[0].actual_definition_sha256='0'.repeat(64);}],
 ['wrong selfhash',r=>r[0].actual_definition_sha256='f'.repeat(64)],
 ['changed restore order',r=>r[0].restore_order='1'],
 ['duplicate existing identity',r=>r.push({...r[0]})],
 ['missing existing identity',r=>r.shift()],
 ['unknown extra identity',r=>r.push({...r[0],object_kind:'function',object_identity:'public.UNKNOWN_UNIT_SECRET_FUNCTION()'})],
])await test('bounded exact difference classified: '+name,async()=>{
 const db=fixture({mutate}),out=await readPrivateCustodySource252Refusal(db);assert.ok(out.difference_counts.changed+out.difference_counts.missing+out.difference_counts.extra>0);
 if(name==='unknown extra identity'){assert.equal(out.extra.length,1);assert.equal(out.current_catalog_metadata.length,0);assert.ok(!db.calls.some(x=>x.sql.startsWith('with wanted')));}
 if(name==='duplicate existing identity'){assert.equal(out.changed[0].observed.length,2);assert.equal(out.changed.length,1);}
});
await test('overflow exports only count/summary/fixed canary+guard; no unbounded tuple fetch',async()=>{
 const db=fixture({count:'8193'}),out=await readPrivateCustodySource252Refusal(db);assert.equal(out.inventory_metadata_omitted,true);assert.equal(out.metadata_limit,8192);assert.ok(!db.calls.some(x=>x.sql.includes('limit 8193')));assert.equal(Object.hasOwn(out,'changed'),false);
});
await test('119 selector is exact and preserves original SQL refusal and private message',async()=>{
 const db=fixture();let receipt;const sentinel='UNIT119_SECRET_BUSINESS_VALUE_MUST_NOT_EXPORT',error=Object.assign(Error(sentinel),{code:'P0001'});
 await assert.rejects(runTargetCaptureStep({db,migration,targetCapture:true,run:async()=>{db.abort();throw error;},onRefusal:r=>receipt=r}),e=>e===error);
 assert.equal(receipt.metadata_source_file,PRIVATE_CUSTODY_SOURCE252_FILE);assert.equal(receipt.metadata_source_sha256,PRIVATE_CUSTODY_SOURCE252_SHA256);assert.equal(receipt.private_source252.reference.inventory_sha256,ref.inventory_sha256);assert.equal(receipt.reason_code,'TARGET_MIGRATION_SQL_REFUSAL');assert.ok(!JSON.stringify(receipt).includes(sentinel));assert.equal(db.calls[1].sql,'rollback to savepoint custodial_target_migration_step');assert.ok(!db.calls.some(x=>/commit|release savepoint/.test(x.sql)));
});
for(const field of ['order','sha256'])await test('wrong119 tuple cannot select metadata '+field,async()=>{
 const db=fixture();let receipt;const error=Object.assign(Error('UNIT original'),{code:'P0001'});
 await assert.rejects(runTargetCaptureStep({db,migration:{...migration,[field]:field==='order'?120:'0'.repeat(64)},targetCapture:true,run:async()=>{db.abort();throw error;},onRefusal:r=>receipt=r}),e=>e===error);
 assert.equal(receipt.metadata_read_failed,true);assert.equal(receipt.code,'ERR_ASSERTION');assert.ok(!db.calls.some(x=>x.sql.startsWith('select ')||x.sql.startsWith('with wanted')));
});
await test('metadata refusal recovers its abort but preserves original failed migration',async()=>{
 const db=fixture({deny:true});let receipt;const error=Object.assign(Error('UNIT original119'),{code:'P0001'});
 await assert.rejects(runTargetCaptureStep({db,migration,targetCapture:true,run:async()=>{db.abort();throw error;},onRefusal:r=>receipt=r}),e=>e===error);
 assert.equal(receipt.metadata_read_failed,true);assert.equal(receipt.code,'42501');assert.equal(db.calls.filter(x=>x.sql==='rollback to savepoint custodial_target_migration_step').length,2);
});
await test('normal production/full119 path still invokes no savepoint/metadata SQL',async()=>{
 const db=fixture();assert.equal(await runTargetCaptureStep({db,migration,targetCapture:false,run:async()=>19,onRefusal:()=>assert.fail()}),19);assert.deepEqual(db.calls,[]);
});
console.log(JSON.stringify({status:'PASS_SOURCE_RECORDING_CLIENT_ONLY',checks,reference_rows:6884,actual_SQL:false,actual119_metadata:false,production:false}));
