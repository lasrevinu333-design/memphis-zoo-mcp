// Inert native-client lifecycle model. Native SQL/lock/ACL evidence is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {types,isDeepStrictEqual} from 'node:util';
const sourceText=readFileSync(new URL('./isolated-current-catalog-privileges.mjs',import.meta.url),'utf8');
function world(mode={}){
 const archive=Object.freeze({}),source=Object.freeze({}),postgresOid='20';
 const roles=[{oid:'10',name:'supabase_admin',superuser:true,config:null},{oid:postgresOid,name:'postgres',superuser:false,config:null}];
 const grants=(grantee,privilege)=>({grantee,grantor:'10',privilege,grant_option:false});
 const catalogs=Array.from({length:64},(_,i)=>({oid:String(100+i),name:'pg_unit_'+String(i).padStart(3,'0'),owner:'10',maintain:mode.readyAll===true||mode.preexisting===true&&i===0,
  acl:[grants('0','SELECT'),grants('10','SELECT'),...(mode.readyAll===true||mode.preexisting===true&&i===0?[grants(postgresOid,'MAINTAIN')]:[])]}));
 const baseline={roles:structuredClone(roles),members:[],catalogs:structuredClone(catalogs)};
 const state={db:structuredClone(baseline),commands:[],clients:0,callbacks:0,verifications:0,withdrawn:false,databaseOid:'9'};
 class RecordingClient{
  constructor(){this.id=++state.clients;this.xid=String(this.id*10);this.active=false;this.readonly=false;}
  async connect(){}
  async query(sql){
   state.commands.push(sql);
   if(sql.startsWith('BEGIN')){this.active=true;this.readonly=sql.includes('READ ONLY');this.transaction=structuredClone(state.db);return{command:'BEGIN'};}
   if(sql==='COMMIT'){assert.equal(this.active,true);state.db=structuredClone(this.transaction);this.active=false;
    if(mode.lostCommit&&this.id===1)throw Error('PRIVATE LOST COMMIT');return{command:'COMMIT'};}
   if(sql==='ROLLBACK'){this.active=false;return{command:'ROLLBACK'};}
   assert.equal(this.active,true);
   if(sql.startsWith('select current_user'))return{rowCount:1,rows:[{actor:mode.actor??'supabase_admin',session_actor:mode.actor??'supabase_admin',database:'mz_schema_rebuild_123',database_oid:state.databaseOid,database_owner:'postgres',pid:this.id+500,xid:this.xid,readonly:this.readonly?'on':'off',replication:'origin',cron_execution:'off',server_version:170006,administrator:true}]};
   if(sql.includes('from pg_roles order by oid'))return{rows:structuredClone(this.transaction.roles)};
   if(sql.includes('from pg_auth_members order by'))return{rows:structuredClone(this.transaction.members)};
   if(sql.includes("where n.nspname='pg_catalog' and c.relkind='r' order by c.oid"))return{rows:structuredClone(this.transaction.catalogs)};
   if(sql==='select count(*)::text row_count from public.employees')return{rowCount:1,rows:[{row_count:mode.populated?'1':'0'}]};
   const grant=/^GRANT MAINTAIN ON TABLE pg_catalog\.(pg_unit_[0-9]{3}) TO postgres$/.exec(sql);
   if(grant){assert.equal(this.readonly,false);const c=this.transaction.catalogs.find(c=>c.name===grant[1]);assert.ok(c&&!c.maintain);
    if(!mode.ineffective){c.maintain=true;c.acl.push(grants(postgresOid,'MAINTAIN'));}return{command:'GRANT'};}
   const revoke=/^REVOKE MAINTAIN ON TABLE pg_catalog\.(pg_unit_[0-9]{3}) FROM postgres$/.exec(sql);
   if(revoke){assert.equal(this.readonly,false);if(mode.retireFailure)throw Error('PRIVATE REVOKE ERROR');const c=this.transaction.catalogs.find(c=>c.name===revoke[1]);assert.ok(c&&c.maintain);
    c.acl=c.acl.filter(a=>!(a.grantee===postgresOid&&a.privilege==='MAINTAIN'));c.maintain=false;return{command:'REVOKE'};}
   throw Error('Unexpected model query');
  }
  async end(){if(mode.setupCloseFailure&&this.id===1||mode.readbackCloseFailure&&this.id===3)throw Error('PRIVATE CLOSE');}
 }
 const current=(s,a)=>{assert.equal(s,source);assert.equal(a,archive);if(state.withdrawn)throw Error('PRIVATE SOURCE WITHDRAWN');};
 const exports=new Function('assert','createHash','types','isDeepStrictEqual','pg','assertVerifiedImmutableBootstrapSource','readVerifiedImmutableBootstrapOwnerProfile',
  sourceText.replace(/^import\s[\s\S]*?;\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function')+
  '\nreturn{withIsolatedCurrentCatalogPrivileges,projectIsolatedCatalogPrivilegeStatus};')(
  assert,createHash,types,isDeepStrictEqual,{Client:RecordingClient},current,(s,a)=>{current(s,a);return mode.legacy?{id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'}:{id:'immutable-private-current-postgres',actor:'postgres'};});
 const options={verifiedArchive:archive,source,connectionString:'postgresql://supabase_admin:fixture@127.0.0.1:5555/mz_schema_rebuild_123',runId:'123',verifyTarget:async()=>{state.verifications++;if(mode.foreignTarget)throw Error('PRIVATE FOREIGN TARGET');}};
 const execute=(run=async()=>({unit_data_only:true}))=>exports.withIsolatedCurrentCatalogPrivileges(options,async()=>{state.callbacks++;return run(state);});
 return{state,baseline,options,execute,...exports};
}
test('catalog lease adds only missing MAINTAIN grants and retires exact original ACLs, role attributes and memberships',async()=>{
 const w=world(),r=await w.execute(async state=>{assert.ok(state.db.catalogs.every(c=>c.maintain));return{fixture:true};});
 assert.deepEqual(r.value,{fixture:true});assert.deepEqual(w.state.db,w.baseline);assert.equal(w.state.callbacks,1);assert.equal(w.state.clients,3);
 assert.equal(w.state.verifications,4);assert.equal(r.receipt.requested_catalog_count,64);assert.equal(r.receipt.verified_grant_count,64);
 assert.equal(r.receipt.retirement_verified,true);assert.equal(r.receipt.setup_connection_closed,true);assert.equal(r.receipt.retirement_connection_closed,true);
 assert.equal(w.state.commands.filter(s=>s.startsWith('GRANT ')).length,64);assert.equal(w.state.commands.filter(s=>s.startsWith('REVOKE ')).length,64);
 assert.ok(!w.state.commands.some(s=>/^(?:SET ROLE|ALTER ROLE|ALTER TABLE|DISABLE|TRUNCATE|INSERT|DELETE)/.test(s)));
 assert.deepEqual(w.projectIsolatedCatalogPrivilegeStatus(r.receipt),r.receipt);
});
test('existing MAINTAIN grants are never removed and a fully privileged target needs no added grant',async()=>{
 const w=world({preexisting:true}),r=await w.execute();assert.equal(r.receipt.verified_grant_count,63);assert.deepEqual(w.state.db,w.baseline);
 assert.ok(!w.state.commands.includes('REVOKE MAINTAIN ON TABLE pg_catalog.pg_unit_000 FROM postgres'));
 const ready=world({readyAll:true}),none=await ready.execute();assert.equal(none.receipt.verified_grant_count,0);assert.deepEqual(ready.state.db,ready.baseline);
 assert.equal(ready.state.commands.filter(s=>s.startsWith('GRANT ')).length,0);
});
test('legacy source, foreign target, wrong administrator and populated target cannot enter the callback',async()=>{
 for(const mode of [{legacy:true},{foreignTarget:true},{actor:'postgres'},{populated:true},{ineffective:true}]){
  const w=world(mode);await assert.rejects(()=>w.execute());assert.equal(w.state.callbacks,0);assert.deepEqual(w.state.db,w.baseline);
 }
});
test('only the fixed explicit loopback URI can create a catalog maintenance client',async()=>{
 const base='postgresql://supabase_admin:fixture@127.0.0.1:5555/mz_schema_rebuild_123';
 for(const connectionString of [base.replace('127.0.0.1','example.com'),base.replace('supabase_admin:','postgres:'),base.replace('mz_schema_rebuild_123','production'),
  base+'?host=example.com',base+'?options=-c%20role%3Dpostgres',base+'#fragment',base.replace(':5555/','/'),base.replace(':5555/',':0/')]){
  const w=world();w.options.connectionString=connectionString;await assert.rejects(()=>w.execute());assert.equal(w.state.clients,0);assert.equal(w.state.callbacks,0);
 }
});
test('callback failure retains the closed retirement receipt and cannot replay the restore',async()=>{
 const w=world();let error;try{await w.execute(async()=>{throw Error('PRIVATE ORIGINAL ROW');});}catch(e){error=e;}
 assert.equal(error.code,'ISOLATED_CATALOG_PRIVILEGES_REFUSED');assert.equal(error.catalog_privileges.setup_verified,true);
 assert.equal(error.catalog_privileges.retirement_verified,true);assert.equal(w.state.callbacks,1);assert.deepEqual(w.state.db,w.baseline);
 assert.doesNotMatch(JSON.stringify(error),/PRIVATE ORIGINAL ROW/);
});
test('uncertain setup COMMIT and failed close permit cleanup only, with no callback or retry',async()=>{
 for(const mode of [{lostCommit:true},{setupCloseFailure:true}]){
  const w=world(mode);let error;try{await w.execute();}catch(e){error=e;}
  assert.equal(error.code,'ISOLATED_CATALOG_PRIVILEGES_REFUSED');assert.equal(error.catalog_privileges.retirement_verified,true);
  assert.equal(w.state.callbacks,0);assert.deepEqual(w.state.db,w.baseline);assert.equal(w.state.commands.filter(s=>s.startsWith('GRANT ')).length,64);
 }
});
test('foreign ACL, role, membership or database changes are not adopted or repaired by cleanup',async()=>{
 for(const mutate of [s=>s.db.catalogs[0].acl.push({grantee:'30',grantor:'10',privilege:'SELECT',grant_option:false}),
  s=>s.db.roles[1].superuser=true,s=>s.db.members.push({role_oid:'40',member_oid:'20',grantor_oid:'10',admin_option:true}),s=>s.databaseOid='888']){
  const w=world();let error;try{await w.execute(async state=>{mutate(state);});}catch(e){error=e;}
  assert.equal(error.catalog_privileges.retirement_verified,false);assert.equal(w.state.callbacks,1);assert.equal(w.state.commands.filter(s=>s.startsWith('REVOKE ')).length,0);
 }
});
test('retirement or final readback close failure cannot report a successful retirement',async()=>{
 for(const mode of [{retireFailure:true},{readbackCloseFailure:true}]){
  const w=world(mode);let error;try{await w.execute();}catch(e){error=e;}
  assert.equal(error.catalog_privileges.retirement_verified,false);assert.equal(w.state.callbacks,1);
 }
});
test('source withdrawal cannot authorize another privilege query or restore callback',async()=>{
 const w=world();w.state.withdrawn=true;await assert.rejects(()=>w.execute());assert.equal(w.state.clients,0);assert.equal(w.state.callbacks,0);
 const active=world();let error;try{await active.execute(async state=>{state.withdrawn=true;});}catch(e){error=e;}
 assert.equal(error.catalog_privileges.retirement_verified,false);assert.equal(active.state.callbacks,1);
});
test('closed public catalog status rejects secrets, unbounded counters, proxies, symbols and getters',async()=>{
 const w=world(),r=await w.execute(),p=w.projectIsolatedCatalogPrivilegeStatus;
 for(const change of [{credential:'PRIVATE'},{production_written:true},{requested_catalog_count:65},{verified_grant_count:65},
  {original_catalog_acl_sha256:'PRIVATE'},{[Symbol('PRIVATE')]:true}])assert.equal(p({...r.receipt,...change}),null);
 const value={...r.receipt};let traps=0;Object.defineProperty(value,'requested_catalog_count',{get(){traps++;return 64;}});
 assert.equal(p(value),null);assert.equal(traps,0);assert.equal(p(new Proxy(r.receipt,{})),null);
});
