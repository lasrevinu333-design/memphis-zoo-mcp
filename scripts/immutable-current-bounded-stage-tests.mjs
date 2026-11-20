import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createInterface} from 'node:readline';
import * as archiveApi from './disaster-recovery-archive.mjs';
import {recordImmutableFreshFailure,recordImmutableFreshProgress} from './immutable-private-stage-diagnostic.mjs';
import {currentBoundedOrdinaryStageSql,extendCurrentBoundedOrdinaryStage,removeCurrentBoundedOrdinaryStage,removeCurrentBoundedOrdinaryConsumerSource} from './immutable-current-bounded-stage-source.mjs';
import {removeCurrentCatalogStability} from './immutable-current-catalog-stability-source.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url)));
const text=readFileSync(new URL('./immutable-private-data-import.mjs',import.meta.url),'utf8');
const closed=text.slice(text.indexOf('function closed(value,keys) {'),text.indexOf('// Actual pg.Result has additional own fields/prototype;'));
const start=text.indexOf('async function inactiveOriginalForeignKeys('),end=text.indexOf('// Shipping fresh-target composition',start);
assert.ok(start>0&&end>start);
// Recorded ports qualify the actual source consumer/real codecs, not native
// owner admission. Native SQL fidelity is separately exercised in PostgreSQL.
const build=new Function('ports','types','isDeepStrictEqual','recordImmutableFreshFailure','recordImmutableFreshProgress','createHash',`const {sameSource,fail,openVerifiedRestoreTableData,
 decodeRestoreTableRowLine,createRestoreRowUtf8Guard,createRestoreRowLineBatchDecoder,readVerifiedImmutableArchiveOwnerProfile,
 pipeline,createInterface}=ports;const selfOrdinaryConsumers=new WeakMap();${closed}\n${text.slice(start,end)}\nreturn {planVerifiedOrdinaryTables,consumeVerifiedOrdinaryTable};`);
const raw=n=>JSON.stringify({id:String(9007199254740993n+BigInt(n)),payload:'{ "dup":1,"dup":2,"value":0.1234567890123456789 }',nullable:n%2?'Ω\\x\n':null});
const guard=()=>({oid:'501',name:'custodial_disaster_restore_mutation_fence',function_oid:'500',type:62,enabled:'O',internal:false,
 argument_count:0,arguments_hex:'',when_expression:null,columns:'',constraint_oid:'0',deferrable:false,initially_deferred:false,parent_oid:'0',old_table:null,new_table:null});
function fixture(options={}){
 const raws=options.raws??[raw(1),raw(2),raw(3)];
 const table={schema_name:options.schema??'public',table_name:'unit_bounded_originals',row_count:String(options.count??raws.length),
  columns:[{name:'id',data_type:'bigint',generated:'',identity:''},{name:'payload',data_type:'json',generated:'',identity:''},
   {name:'nullable',data_type:'text',generated:'',identity:''}],primary_key:[],data_file:'database/unit.jsonl',
  data_encoding:options.encoding??'postgres-text-columns-line.v2'};
 const original={selection:{databaseTables:[table]}},archive={},effects=[];let live=true,eof=false,closedCount=0,order;
 const sameSource=()=>{if(!live)throw Error('UNIT_SOURCE_WITHDRAWN');};
 const context=async()=>{sameSource();if(options.contextFailure&&eof)throw Error('UNIT_CONTEXT_WITHDRAWN');};
 const bytes=Buffer.from(raws.map(r=>JSON.stringify(r)+'\n').join(''));
 const chunks=options.chunkSize?Array.from({length:Math.ceil(bytes.length/options.chunkSize)},(_,i)=>bytes.subarray(i*options.chunkSize,(i+1)*options.chunkSize)):[bytes];
 const api=build({sameSource,fail:()=>{throw Error('UNIT_BOUNDED_REFUSED');},pipeline,createInterface,
  decodeRestoreTableRowLine:archiveApi.decodeRestoreTableRowLine,createRestoreRowUtf8Guard:archiveApi.createRestoreRowUtf8Guard,
  createRestoreRowLineBatchDecoder:archiveApi.createRestoreRowLineBatchDecoder,
  readVerifiedImmutableArchiveOwnerProfile:()=>options.owner??{id:'immutable-private-current-postgres',actor:'postgres'},
  openVerifiedRestoreTableData:()=>{
   const stream=Readable.from(chunks),verified=new Promise((resolve,reject)=>stream.once('end',()=>{
    eof=true;if(options.eofFailure)reject(Error('UNIT_BAD_EOF'));else resolve({data_file:table.data_file,bytes:bytes.length,sha256:'a'.repeat(64)});
   }));verified.catch(()=>{});
   return {table,stream,verified,async close(){closedCount++;if(options.closeFailure)throw Error('UNIT_CLOSE_FAILED');}};
  }},types,isDeepStrictEqual,recordImmutableFreshFailure,recordImmutableFreshProgress,createHash);
 const sql=async statement=>statement.includes('as foreign_keys')?{rowCount:1,rows:[{schema_name:table.schema_name,table_name:table.table_name,
  relation_oid:'100',relation_kind:'r',persistence:'p',is_partition:false,foreign_keys:[]}]}:
  {rowCount:1,rows:[{schema_name:table.schema_name,table_name:table.table_name,relation_oid:'100',guard_oid:'500',insert_triggers:options.triggers??[guard()]}]};
 return {effects,table,raws,get closed(){return closedCount;},get eof(){return eof;},
  async plan(){order=await api.planVerifiedOrdinaryTables(archive,original,sql,context);return order[0];},
  async consume(){return api.consumeVerifiedOrdinaryTable(archive,original,order[0],async(statement,args)=>{
   sameSource();effects.push({statement,args:structuredClone(args)});
   if(statement.includes('insert_staged_immutable_ordinary_table'))assert.equal(eof,true);
   if(options.withdrawAtStage&&statement.includes('stage_immutable_ordinary_row'))live=false;
   if(options.lostResult)throw Error('UNIT_LOST_RESULT');
  },context);}};
}
test('whole fd53 predecessor and all51 guard definitions survive exactly',()=>{
 const prior=removeCurrentBoundedOrdinaryStage(program);assert.equal(sha(JSON.stringify(prior,null,2)+'\n'),'fd53fda1891932c4cae89fc1f6f4b1c6116515ad2120aca6c41a1d5302cc84da');
 const bounded=removeCurrentCatalogStability(program);
 assert.deepEqual(extendCurrentBoundedOrdinaryStage(prior),bounded);assert.deepEqual(program.recipes,prior.recipes);
 assert.equal(program.statements.length,13);assert.equal(bounded.statements[0].sql.split(currentBoundedOrdinaryStageSql()).length,2);
 for(let i=1;i<13;i++)assert.deepEqual(program.statements[i],prior.statements[i]);
});
test('mutated predecessor or successor cannot pass the exact inverse',()=>{
 for(const mutate of [p=>p.recipes[0].after+=' ',p=>p.statements[0].sql=p.statements[0].sql.replace('after_last IS DISTINCT FROM prior_last+batch_count','false'),p=>p.statements[1].sql+=' ']){
  const p=structuredClone(program);mutate(p);assert.throws(()=>removeCurrentBoundedOrdinaryStage(p));
 }
 assert.throws(()=>currentBoundedOrdinaryStageSql('caller'));
});
test('the existing primary key bounds batch lookups and final insertion still requires an exact ordinal set',()=>{
 const sql=program.statements[0].sql;
 const definition=name=>{
  const start=sql.indexOf('CREATE FUNCTION custodial_dr.'+name+'(');
  const end=sql.indexOf('END $fn$;',start);
  assert.ok(start>=0&&end>start);
  return sql.slice(start,end);
 };
 const stage=definition('stage_immutable_ordinary_rows');
 assert.equal(stage.split('ORDER BY s.ordinal DESC LIMIT 1').length,3);
 assert.match(stage,/first_ordinal<>prior_last\+1/);
 assert.match(stage,/written<>batch_count OR after_last IS DISTINCT FROM prior_last\+batch_count/);
 assert.equal(stage.split('custodial_dr.immutable_import_assert_context()').length,3);
 const insert=definition('insert_staged_immutable_ordinary_table');
 assert.ok(insert.indexOf('OR staged_last<>observed')>0);
 assert.ok(insert.indexOf('OR staged_last<>observed')<insert.indexOf('UPDATE custodial_dr.immutable_private_import_context'));
 assert.match(insert,/Immutable staged original changed/);
 assert.match(insert,/Immutable staged typed original changed/);
 assert.match(insert,/Immutable ordinary set readback differs/);
 assert.match(insert,/WHEN 'postgres-text-columns-line\.v2' THEN\s+decode_function:='immutable_import_text_record'; projection_function:='immutable_import_text_projection'/);
 assert.match(insert,/WHEN 'postgres-json-text-line\.v1' THEN\s+decode_function:='immutable_import_decode_record'; projection_function:='immutable_import_row_projection'/);
 assert.match(insert,/bool_or\(s\.original_row_sha256 IS DISTINCT FROM encode/);
 assert.match(insert,/custodial_dr\.%I\(r\) IS DISTINCT FROM s\.typed_original_text/);
 assert.equal(insert.split('OVERRIDING SYSTEM VALUE').length,2);
 assert.equal(insert.split('EXCEPT ALL').length,3);
});
test('entire actual preceding importer survives the six exact source hunks',()=>{
 const prior=removeCurrentBoundedOrdinaryConsumerSource(text);
 assert.equal(sha(prior),'df00d51d2fbb966f09d7228d1c3947595ddaca7123e7e2d598ba086b17afede9');
 assert.throws(()=>removeCurrentBoundedOrdinaryConsumerSource(text.replace('pendingBytes+bytes>65536','false')));
 assert.throws(()=>removeCurrentBoundedOrdinaryConsumerSource(text+' '));
});
for(const schema of ['public','auth','storage','custodial_employment','custodial_coverall','custodial_leadership_private'])test('safe current typed set stages exact raw originals in '+schema,async()=>{
 const f=fixture({schema});assert.notEqual(await f.plan(),f.table);assert.equal(await f.consume(),3);
 assert.equal(f.effects.length,2);assert.ok(f.effects[0].statement.includes('stage_immutable_ordinary_rows('));
 assert.deepEqual(f.effects[0].args,[schema,f.table.table_name,'1',f.raws]);assert.ok(f.effects[1].statement.includes('insert_staged_immutable_ordinary_table'));
 assert.equal(f.closed,1);assert.equal(f.eof,true);
});
for(const triggers of [[],[guard()]])test('only the unchanged safe INSERT profile selects a bounded set',async()=>{
 const f=fixture({triggers});assert.notEqual(await f.plan(),f.table);assert.equal(await f.consume(),3);assert.equal(f.effects.length,2);
});
test('business INSERT triggers retain exact DIRECT row effects',async()=>{
 const f=fixture({triggers:[{...guard(),name:'business_effect'}]});assert.equal(await f.plan(),f.table);assert.equal(await f.consume(),3);
 assert.equal(f.effects.length,3);assert.ok(f.effects.every(e=>e.statement.includes('insert_immutable_ordinary_row(')));
 assert.deepEqual(f.effects.map(e=>e.args[2]),f.raws);
});
test('legacy typed archive retains scalar staging with no current helper call',async()=>{
 const f=fixture({owner:{id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'}});await f.plan();assert.equal(await f.consume(),3);
 assert.equal(f.effects.length,4);assert.ok(f.effects.slice(0,3).every(e=>e.statement.includes('stage_immutable_ordinary_row(')));
});
test('legacy JSON archive retains scalar staging and exact raw JSON',async()=>{
 const f=fixture({encoding:'postgres-json-text-line.v1'});await f.plan();assert.equal(await f.consume(),3);assert.equal(f.effects.length,4);
 assert.deepEqual(f.effects.slice(0,3).map(e=>e.args[2]),f.raws);
});
test('large typed originals preserve ordinals across64KiB batches and UTF8 splits',async()=>{
 const raws=Array.from({length:1400},(_,i)=>raw(i)),f=fixture({raws,chunkSize:32767});await f.plan();assert.equal(await f.consume(),raws.length);
 const staged=f.effects.filter(e=>e.statement.includes('stage_immutable_ordinary_rows('));assert.ok(staged.length>2);
 let ordinal=1;for(const e of staged){assert.equal(e.args[2],String(ordinal));assert.ok(e.args[3].reduce((n,r)=>n+Buffer.byteLength(r),0)<=65536);ordinal+=e.args[3].length;}
 assert.deepEqual(staged.flatMap(e=>e.args[3]),raws);assert.equal(ordinal,1401);
});
test('a single over64KiB row uses the original scalar helper without dropping adjacent rows',async()=>{
 const large=JSON.stringify({id:'7',payload:JSON.stringify('Ω'.repeat(40000)),nullable:null});const f=fixture({raws:[raw(1),large,raw(3)]});
 await f.plan();assert.equal(await f.consume(),3);const staged=f.effects.slice(0,-1);assert.equal(staged.length,3);
 assert.deepEqual(staged.map(e=>e.statement.includes('stage_immutable_ordinary_rows(')?e.args[3]:[e.args[2]]).flat(),f.raws);
 assert.ok(staged[1].statement.includes('stage_immutable_ordinary_row('));assert.equal(staged[2].args[2],'3');
});
for(const options of [{count:2},{count:4},{eofFailure:true},{contextFailure:true},{withdrawAtStage:true},{lostResult:true}])test('refusal retains EOF/context gates and cannot replay '+JSON.stringify(options),async()=>{
 const f=fixture(options);await f.plan();await assert.rejects(f.consume());assert.equal(f.closed,1);
 assert.ok(f.effects.every(e=>!e.statement.includes('insert_staged_immutable_ordinary_table')));const count=f.effects.length;
 await assert.rejects(f.consume());assert.equal(f.effects.length,count);
});
test('close refusal consumes the selected token and cannot replay a final INSERT',async()=>{
 const f=fixture({closeFailure:true});await f.plan();await assert.rejects(f.consume());assert.equal(f.closed,1);
 assert.equal(f.effects.filter(e=>e.statement.includes('insert_staged_immutable_ordinary_table')).length,1);
 const count=f.effects.length;await assert.rejects(f.consume());assert.equal(f.effects.length,count);
});
test('actual consumer reports only closed relation hashes and phases; observer failure never changes cleanup',async()=>{
 const keys=['RESTORE_PRIVATE_DIAGNOSTICS','REHEARSAL_SCOPE','OFFICIAL_LOCAL_STORAGE_PROVIDER','RESTORE_DATABASE_ONLY'];
 const saved=keys.map(k=>process.env[k]),values=['bounded-v1','backup_only','true','true'],error=console.error,lines=[];
 try{
  keys.forEach((k,i)=>process.env[k]=values[i]);console.error=line=>lines.push(line);
  const f=fixture();await f.plan();assert.equal(await f.consume(),3);assert.equal(f.closed,1);
  const records=lines.map(line=>JSON.parse(line));
  assert.deepEqual(records.map(r=>r.ordinary_phase),['SOURCE_OPEN','FIRST_SQL','SOURCE_EOF','INSERT_SET','BODY_COMPLETE']);
  for(const r of records){assert.equal(r.ordinary_mode,'BOUNDED_STAGE');assert.equal(r.ordinary_relation_sha256,sha(JSON.stringify(['public',f.table.table_name])));
   assert.equal(r.private_payload_exported,false);assert.ok(!JSON.stringify(r).includes(f.raws[0])&&!JSON.stringify(r).includes(f.table.table_name));}
  console.error=()=>{throw Error('UNIT_OBSERVER_FAILURE');};const next=fixture();await next.plan();assert.equal(await next.consume(),3);assert.equal(next.closed,1);
  const closing=fixture({closeFailure:true});await closing.plan();await assert.rejects(closing.consume());assert.equal(closing.closed,1);
 }finally{console.error=error;keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
