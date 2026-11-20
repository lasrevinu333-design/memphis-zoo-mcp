// Inert native-client/source lifetime protocol model. Not archive or SQL admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectPrivateContextCostMode,projectPrivateContextCost,projectPrivateContextCostFailure} from './private-context-cost-observer.mjs';
const source=readFileSync(new URL('./private-context-cost-diagnostic.mjs',import.meta.url),'utf8');
function world(mode={}){
 const binding={archive_digest:'a'.repeat(64)},archive={cleanup(){if(mode.archiveClose)throw Error('PRIVATE ARCHIVE');}};
 const state={reads:0,commands:[],ends:0,samples:0};
 const read=()=>{state.reads++;return{sourceBinding:state.reads>1&&mode.binding?{...binding}:binding,
  selection:{databaseTables:state.reads>1&&mode.selection?['changed']:[]},privateDataMembers:state.reads>1&&mode.members?['changed']:[]};};
 const observed={schema:'custodial.private-current-context-cost.v1',scope:'SIGNED_CURRENT_SCHEMA_CONTEXT_ONLY_NOT_DATA_RESTORE',archive_digest:binding.archive_digest,calls_per_probe:10,
  sizes:{stored_shape_bytes:'100',shape_text_bytes:'2000',stored_manifest_bytes:'100',manifest_text_bytes:'1000',stored_epoch_bytes:'50',certificate_current:true,held_locks:'100',employee_rows:'0',group_original_rows:'0',message_original_rows:'0'},
  timings:{owner_fence:'1.000',catalog_epoch:'2.000',inventory_state:'3.000',target_shape:'4.000',catalog_matches:'5.000',assert_context:'6.000',read_context:'0.100',extract_three_data_fields:'0.200'},
  application_data_imported:false,private_data_imported:false,transaction_authority:false,restore_complete:false,admission_resumed:false};
 class Client{
  async connect(){}
  async query(sql){state.commands.push(sql);
   if(sql==='ROLLBACK'){if(mode.lostRollback&&state.commands.filter(x=>x==='ROLLBACK').length===1)throw Error('PRIVATE LOST ROLLBACK');return{command:'ROLLBACK'};}
   if(sql.startsWith('select current_user'))return{rowCount:1,rows:[{actor:mode.actor??'postgres',session_actor:'postgres',database:'mz_schema_rebuild_123',superuser:false,readonly:'on',context_absent:!mode.context,
    employee_rows:mode.rows?'1':'0',group_original_rows:'0',message_original_rows:'0',controls:'0',releases:'0',registry:'0'}]};
   return{command:'SELECT'};
  }
  async end(){state.ends++;if(mode.close)throw Error('PRIVATE CLOSE');}
 }
 const deps={assert,resolve,fileURLToPath,pg:{Client},materializeVerifiedArchive:()=>archive,readVerifiedPrivateImportSource:read,requireSigningKey:x=>x,
  readVerifiedImmutableArchiveOwnerProfile:()=>({id:'immutable-private-current-postgres',actor:'postgres'}),
  diagnoseVerifiedImmutableFreshContextCost:async()=>{state.samples++;return observed;},readVerifiedCurrent428ForwardQualificationSource:()=>({assertCurrent(){}}),
  selectPrivateContextCostMode,projectPrivateContextCost,projectPrivateContextCostFailure};
 const begin=source.indexOf('const Client=pg.Client'),end=source.indexOf('if(process.argv[1]');
 const run=new Function(...Object.keys(deps),source.slice(begin,end).replace('export async function','async function')+'return observePrivateContextCost;')(...Object.values(deps));
 const env={PRIVATE_CONTEXT_COST_DIAGNOSTIC_ONLY:'true',REHEARSAL_SCOPE:'backup_only',OFFICIAL_LOCAL_STORAGE_PROVIDER:'true',RESTORE_APPLY:'true',RESTORE_DATABASE_ONLY:'true',GITHUB_RUN_ID:'123',
  SUPABASE_DB_URL:'postgresql://postgres:fixture@127.0.0.1:5555/mz_schema_rebuild_123',RESTORE_SOURCE_DIR:'UNIT_ONLY',RESTORE_INTENT_JSON:'{}',RESTORE_INTENT_VERIFY_KEY:'UNIT_KEY',RESTORE_ARCHIVE_VERIFY_KEY:'UNIT_OTHER_KEY'};
 return{state,run:()=>run(env)};
}
test('fresh reader wrapper objects with unchanged original binding and contents complete full rollback/readback/close',async()=>{
 const w=world(),r=await w.run();assert.equal(r.rollback_verified,true);assert.equal(r.readback_connection_closed,true);assert.equal(r.current428_source_qualified,true);
 assert.equal(w.state.reads,2);assert.equal(w.state.samples,1);assert.equal(w.state.ends,1);assert.equal(w.state.commands.filter(x=>x==='ROLLBACK').length,2);
 const i=w.state.commands.indexOf('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(w.state.commands[i+1],'SET LOCAL row_security=off');
});
test('source binding replacement and changed source selection/private members refuse after verified rollback',async()=>{
 for(const mode of [{binding:true},{selection:true},{members:true}]){
  const w=world(mode);await assert.rejects(w.run,e=>{assert.equal(e.context_cost_failure.phase,'ROLLBACK_READBACK');assert.equal(e.context_cost_failure.readback_verified,true);assert.equal(e.context_cost_failure.connection_closed,true);return true;});
  assert.equal(w.state.samples,1);assert.equal(w.state.ends,1);
 }
});
test('native readback, lost rollback, end and archive cleanup failures never publish a success or replay measurements',async()=>{
 for(const mode of [{actor:'other'},{context:true},{rows:true},{lostRollback:true},{close:true},{archiveClose:true}]){
  const w=world(mode);await assert.rejects(w.run,e=>{assert.doesNotMatch(JSON.stringify(e),/PRIVATE/);return true;});assert.equal(w.state.samples,1);assert.equal(w.state.ends,1);
 }
});
