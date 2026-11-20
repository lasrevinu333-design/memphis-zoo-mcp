// Inert native-client lifecycle model only; no database or grants are created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {types,isDeepStrictEqual} from 'node:util';
const moduleSource=readFileSync(new URL('./isolated-current-vendor-privileges.mjs',import.meta.url),'utf8');
function world(mode={}){
 const archive=Object.freeze({}),source=Object.freeze({inventory:{'inventory/table-catalog.json':JSON.stringify([{schema_name:'auth',table_name:'fixture_auth',row_count:'0'},{schema_name:'storage',table_name:'fixture_storage',row_count:'1'}])}}),roles=['postgres','supabase_auth_admin','supabase_storage_admin'].map((name,i)=>({oid:String(i+10),name,superuser:false,inherits:true}));
 const baseline=[{role_name:'anon',member_name:'postgres',grantor_name:'supabase_admin',admin_option:true,inherit_option:true,set_option:true}];
 const state={roles:structuredClone(roles),members:structuredClone(baseline),commands:[],clients:0,callbacks:0,verifications:0,withdrawn:false,databaseOid:'9',commits:0};
 if(mode.preexisting)state.members.push({role_name:'supabase_auth_admin',member_name:'postgres',grantor_name:'supabase_admin',admin_option:false,inherit_option:true,set_option:false});
 class RecordingClient{
  constructor(){this.id=++state.clients;this.active=false;this.readonly=false;this.xid=String(this.id*10);}
  async connect(){}
  async query(sql,args=[]){
   state.commands.push(sql);
   if(sql.startsWith('BEGIN')){this.active=true;this.readonly=sql.includes('READ ONLY');this.saved=structuredClone(state.members);return{command:'BEGIN'};}
   if(sql==='COMMIT'){state.commits++;this.active=false;if(mode.lostCommit&&this.id===1)throw Error('PRIVATE LOST ACK');return{command:'COMMIT'};}
   if(sql==='ROLLBACK'){if(this.active&&!this.readonly)state.members=structuredClone(this.saved);this.active=false;return{command:'ROLLBACK'};}
   assert.equal(this.active,true);
   if(sql.startsWith('select current_user'))return{rowCount:1,rows:[{actor:mode.actor??'supabase_admin',session_actor:mode.actor??'supabase_admin',database:'mz_schema_rebuild_123',database_oid:state.databaseOid,database_owner:'postgres',pid:this.id+500,xid:this.xid,readonly:this.readonly?'on':'off',replication:'origin',cron_execution:'off',server_version:170006,administrator:true}]};
   if(sql.includes('from pg_catalog.pg_roles where rolname in'))return{rows:structuredClone(state.roles)};
   if(sql.includes('from pg_catalog.pg_auth_members'))return{rows:structuredClone(state.members).sort((a,b)=>a.role_name.localeCompare(b.role_name))};
   if(sql==='select count(*)::text row_count from public.employees')return{rowCount:1,rows:[{row_count:mode.populated?'1':'0'}]};
   if(sql.includes('from pg_catalog.jsonb_to_recordset($1::jsonb)'))return{rows:['auth','storage'].filter(s=>JSON.parse(args[0]).some(t=>t.schema_name===s)).map(schema_name=>({schema_name,tables:1,invalid:0,available:Boolean(mode.readyAll||mode.storageReady&&schema_name==='storage'||!mode.ineffective&&state.members.some(m=>m.role_name===(schema_name==='auth'?'supabase_auth_admin':'supabase_storage_admin')))}))};
   const grant=/^GRANT (supabase_auth_admin|supabase_storage_admin) TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET FALSE$/.exec(sql);
   if(grant){state.members.push({role_name:grant[1],member_name:'postgres',grantor_name:'supabase_admin',admin_option:false,inherit_option:true,set_option:false});return{command:'GRANT ROLE'};}
   const revoke=/^REVOKE (supabase_auth_admin|supabase_storage_admin) FROM postgres$/.exec(sql);
   if(revoke){state.members=state.members.filter(r=>r.role_name!==revoke[1]);return{command:'REVOKE ROLE'};}
   throw Error('Unexpected model SQL');
  }
  async end(){if(mode.closeFailure&&this.id===1||mode.readbackCloseFailure&&this.id===3)throw Error('PRIVATE CLOSE');}
 }
 const current=(s,a)=>{assert.equal(s,source);assert.equal(a,archive);if(state.withdrawn)throw Error('PRIVATE SOURCE WITHDRAWN');};
 const exports=new Function('assert','createHash','types','isDeepStrictEqual','pg','assertVerifiedImmutableBootstrapSource','readVerifiedImmutableBootstrapOwnerProfile',
  moduleSource.replace(/^import\s[\s\S]*?;\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function')+
  '\nreturn {withIsolatedCurrentVendorPrivileges,projectIsolatedVendorPrivilegeStatus};')(
  assert,createHash,types,isDeepStrictEqual,{Client:RecordingClient},current,(s,a)=>{current(s,a);return mode.legacy?{id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'}:{id:'immutable-private-current-postgres',actor:'postgres'};});
 const options={verifiedArchive:archive,source,connectionString:'postgresql://supabase_admin:fixture@127.0.0.1:5555/mz_schema_rebuild_123',runId:'123',verifyTarget:async()=>{state.verifications++;if(mode.foreignTarget)throw Error('PRIVATE FOREIGN CID');}};
 const execute=(run=async()=>({DATA_model_only:true}))=>exports.withIsolatedCurrentVendorPrivileges(options,async()=>{state.callbacks++;return run(state);});
 return{state,baseline,roles,options,execute,...exports};
}
test('isolated vendor support retains the original actor and restores the exact original privilege vector',async()=>{
 const w=world();const r=await w.execute(async state=>{assert.equal(state.members.length,3);assert.ok(state.members.filter(m=>m.role_name.startsWith('supabase_')).every(m=>!m.admin_option&&!m.set_option&&m.inherit_option));return{fixture:true};});
 assert.deepEqual(r.value,{fixture:true});assert.equal(w.state.callbacks,1);assert.deepEqual(w.state.members,w.baseline);assert.deepEqual(w.state.roles,w.roles);
 assert.equal(w.state.clients,3);assert.equal(w.state.verifications,4);assert.equal(r.receipt.retirement_verified,true);assert.equal(r.receipt.setup_connection_closed,true);assert.equal(r.receipt.retirement_connection_closed,true);
 assert.deepEqual(w.projectIsolatedVendorPrivilegeStatus(r.receipt),r.receipt);
 assert.equal(w.state.commands.filter(s=>s.startsWith('GRANT ')).length,2);assert.equal(w.state.commands.filter(s=>s.startsWith('REVOKE ')).length,2);
 assert.ok(!w.state.commands.some(s=>/^(?:SET ROLE|ALTER ROLE|ALTER TABLE|DISABLE|TRUNCATE|INSERT|DELETE)/.test(s)));
});
test('actual native privilege probes choose only the vendor roles that are necessary',async()=>{
 const authOnly=world({storageReady:true}),r=await authOnly.execute();assert.deepEqual(r.receipt.granted_roles,['supabase_auth_admin']);assert.deepEqual(authOnly.state.members,authOnly.baseline);
 const ready=world({readyAll:true}),unchanged=await ready.execute();assert.deepEqual(unchanged.receipt.granted_roles,[]);assert.equal(unchanged.receipt.retirement_verified,true);assert.equal(ready.state.commands.filter(s=>s.startsWith('GRANT ')).length,0);
 const denied=world({ineffective:true});let error;try{await denied.execute();}catch(e){error=e;}assert.equal(denied.state.callbacks,0);assert.equal(error.vendor_privileges.retirement_verified,true);assert.deepEqual(denied.state.members,denied.baseline);
});
test('wrong source, target, administrator and pre-existing membership refuse before a grant or callback',async()=>{
 for(const mode of [{legacy:true},{foreignTarget:true},{actor:'postgres'},{populated:true},{preexisting:true}]){
  const w=world(mode);await assert.rejects(()=>w.execute());assert.equal(w.state.callbacks,0);assert.equal(w.state.commands.filter(s=>s.startsWith('GRANT ')).length,0);
 }
 for(const connectionString of ['postgresql://supabase_admin:fixture@example.com/mz_schema_rebuild_123','postgresql://postgres:fixture@127.0.0.1/mz_schema_rebuild_123','postgresql://supabase_admin:fixture@127.0.0.1/production']){
  const w=world();w.options.connectionString=connectionString;await assert.rejects(()=>w.execute());assert.equal(w.state.clients,0);assert.equal(w.state.callbacks,0);
 }
});
test('callback failure still retires exact owned grants and never replays the original restore',async()=>{
 const w=world();let failure;try{await w.execute(async()=>{throw Error('PRIVATE ORIGINAL ROW');});}catch(error){failure=error;}
 assert.equal(failure.code,'ISOLATED_VENDOR_PRIVILEGES_REFUSED');assert.equal(failure.vendor_privileges.retirement_verified,true);
 assert.equal(w.state.callbacks,1);assert.deepEqual(w.state.members,w.baseline);assert.doesNotMatch(JSON.stringify(failure),/PRIVATE ORIGINAL ROW/);
});
test('lost setup commit acknowledgment reconciles only cleanup and cannot start or retry the restore',async()=>{
 const w=world({lostCommit:true});let failure;try{await w.execute();}catch(error){failure=error;}
 assert.equal(w.state.callbacks,0);assert.equal(w.state.commands.filter(s=>s.startsWith('GRANT ')).length,2);
 assert.equal(failure.vendor_privileges.setup_verified,false);assert.equal(failure.vendor_privileges.retirement_verified,true);assert.deepEqual(w.state.members,w.baseline);
});
test('foreign privilege or role drift cannot be adopted or repaired by cleanup commands',async()=>{
 for(const mutation of [state=>state.members.push({role_name:'foreign_role',member_name:'postgres',grantor_name:'supabase_admin',admin_option:false,inherit_option:true,set_option:false}),state=>state.roles[0].superuser=true]){
  const w=world();let failure;try{await w.execute(async state=>{mutation(state);});}catch(error){failure=error;}
  assert.equal(failure.vendor_privileges.retirement_verified,false);assert.equal(w.state.commands.filter(s=>s.startsWith('REVOKE ')).length,0);assert.equal(w.state.callbacks,1);
 }
});
test('database replacement and lost setup-close acknowledgment refuse success without a callback replay',async()=>{
 const replaced=world();let error;try{await replaced.execute(async state=>{state.databaseOid='777';});}catch(e){error=e;}
 assert.equal(error.vendor_privileges.retirement_verified,false);assert.equal(replaced.state.commands.filter(s=>s.startsWith('REVOKE ')).length,0);
 const closed=world({closeFailure:true});try{await closed.execute();}catch(e){error=e;}
 assert.equal(closed.state.callbacks,0);assert.equal(error.vendor_privileges.setup_connection_closed,false);assert.equal(error.vendor_privileges.retirement_verified,true);assert.deepEqual(closed.state.members,closed.baseline);
});
test('withdrawn original Source cannot authorize privilege effects or continued restore work',async()=>{
 const w=world();w.state.withdrawn=true;await assert.rejects(()=>w.execute());assert.equal(w.state.clients,0);
 const changed=world();let failure;try{await changed.execute(async state=>{state.withdrawn=true;});}catch(error){failure=error;}
 assert.equal(changed.state.callbacks,1);assert.equal(failure.vendor_privileges.retirement_verified,false);
 // The owning factory must destroy this exact private target; no new Source
 // assertion or success is fabricated by these connection-free tests.
});
test('a failed final read-only connection close cannot be reported as retired or closed',async()=>{
 const w=world({readbackCloseFailure:true});let failure;try{await w.execute();}catch(error){failure=error;}
 assert.equal(failure.vendor_privileges.retirement_verified,false);assert.equal(failure.vendor_privileges.retirement_connection_closed,false);
 assert.equal(w.state.callbacks,1);assert.deepEqual(w.state.members,w.baseline);
});
test('public status projection rejects credentials, getters, extra fields and proxy arrays',async()=>{
 const w=world(),r=await w.execute(),p=w.projectIsolatedVendorPrivilegeStatus;
 assert.equal(p({...r.receipt,credential:'PRIVATE'}),null);assert.equal(p({...r.receipt,production_written:true}),null);
 assert.equal(p({...r.receipt,[Symbol('PRIVATE')]:true}),null);
 let traps=0;const value={...r.receipt};Object.defineProperty(value,'granted_roles',{get(){traps++;return[];}});assert.equal(p(value),null);assert.equal(traps,0);
 const revoked=Proxy.revocable([],{});revoked.revoke();assert.equal(p({...r.receipt,granted_roles:revoked.proxy}),null);
});
