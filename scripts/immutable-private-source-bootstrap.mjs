// Program Source preparation for the existing immutable-original importer.
// No database, install, transaction, import or resume authority is returned.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {readVerifiedPrivateImportSource,readVerifiedImmutableBootstrapInventory,
 collectVerifiedRestoreBootstrapRows,postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding} from './disaster-recovery-archive.mjs';
import {loadImmutableMessageSourceRecipes} from './immutable-private-message-source.mjs';
import {loadImmutableDomainSourceRecipes} from './immutable-private-domain-source.mjs';

const plans=new WeakMap(),sha=value=>createHash('sha256').update(value).digest('hex');
// Immutable expected DATA only, keyed by this module's original Source token.
// Never cache currentness, target observations or either Source assertion.
const sourceRowExpectations=new WeakMap();
const basePath=fileURLToPath(new URL('../proposals/immutable-private-owner-context.sql',import.meta.url));
const baseSha='f0c870ea6691552b47daa8eb962645512b74cdd8d26078cef05a42f52116fc55';
const authoritySourcePins=Object.freeze([
 Object.freeze({sourcePath:'proposals/immutable-original-authority-reconciliation.sql',sourceSha256:'e60545804e8c76d94769c6b80426e3dcb86f0bdf47527cd42b5735eb7eff600a'}),
 Object.freeze({sourcePath:'proposals/immutable-original-authority-target-shape.sql',sourceSha256:'265185d8860131d5472db2a70f036332758b4b2f577b48582980f36ff7eacc3e'}),
]);
const guardIds=['custodial_release_identity.guard_group_original_creation()','custodial_dr.guard_application_mutation()'];
const guardBodySha=['29708f9ca161950f4e3b4b71b2e7dd85b2f31a6031407a353635713678a3386f',
 'aba484a103212b76c82f119ece6279c917fce4b0806e07381ef4fce527a9bc95'];
const sourceOrder=['immutable-private-owner-context.sql','immutable-original-event-restore.sql',
 'immutable-original-employee-restore.sql','immutable-original-messenger-restore.sql',
 'immutable-original-message-guards-restore.sql','immutable-original-message-effects-restore.sql',
 'immutable-original-message-audit-restore.sql','immutable-original-message-receipts-restore.sql',
 'immutable-original-device-boundary-restore.sql','immutable-original-manager-push-restore.sql'].map(name=>'proposals/'+name)
 .concat(authoritySourcePins.map(row=>row.sourcePath),'proposals/immutable-original-employee-push-authority-restore.sql');
const inventoryKeys=['application-schema.sql','migration-ledger.json','cron-jobs.json','extensions.json',
 'table-catalog.json','original-relations.json','original-guards.json','original-acls.json'].map(name=>'inventory/'+name);
// Only fixed Source phases may cross this boundary. Never inspect, format or
// attach the caught value: assertion operands can contain original private DATA.
const bootstrapSourceErrorPhases=new Set(['ARCHIVE_ADMISSION','ORIGINAL_INVENTORY','PROGRAM_SOURCE','ORIGINAL_ROWS',
 'ORIGINAL_RELEASE','SOURCE_RECIPES','ORIGINAL_REGISTRY','SOURCE_STATEMENTS','FINAL_CURRENTNESS',
 'SOURCE_HANDLE','ARCHIVE_CURRENTNESS','PROGRAM_CURRENTNESS','INVENTORY_CURRENTNESS']);
function bootstrapSourceUnavailable(phase){
 const error=new Error('Immutable bootstrap Source is unavailable.');
 Object.defineProperties(error,{
  name:{value:'Error',writable:false,configurable:false},
  message:{value:'Immutable bootstrap Source is unavailable.',writable:false,configurable:false},
  stack:{value:'Error: Immutable bootstrap Source is unavailable.',writable:false,configurable:false},
  code:{value:'IMMUTABLE_BOOTSTRAP_SOURCE_UNAVAILABLE',enumerable:true,writable:false,configurable:false},
  source_phase:{value:bootstrapSourceErrorPhases.has(phase)?phase:'FINAL_CURRENTNESS',enumerable:true,writable:false,configurable:false}
 });
 return Object.freeze(error);
}
const closed=(value,keys)=>{
 assert.ok(value&&typeof value==='object'&&!types.isProxy(value)&&Object.getPrototypeOf(value)===Object.prototype);
 assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort());
 for(const key of keys)assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
};
const bodyOf=definition=>{
 const tag='AS $function$';assert.equal(definition.split(tag).length,2);assert.ok(definition.endsWith('$function$\n'));
 return definition.slice(definition.indexOf(tag)+tag.length,-'$function$\n'.length);
};
const replaceOnce=(source,old,next)=>{
 assert.equal(source.split(old).length,2);return source.replace(old,()=>next);
};
function readBaseSource(){
 const fd=openSync(basePath,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=fstatSync(fd);assert.ok(before.isFile()&&before.nlink===1&&before.size>0&&before.size<=1024*1024);
  const bytes=readFileSync(fd),after=fstatSync(fd);
  const identity=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.nlink];
  assert.deepEqual(identity(after),identity(before));assert.equal(bytes.length,before.size);assert.equal(sha(bytes),baseSha);
  const named=openSync(basePath,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{assert.deepEqual(identity(fstatSync(named)),identity(before));}finally{closeSync(named);}
  return {sql:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),identity:identity(before)};
 }finally{closeSync(fd);}
}
function readAuthoritySources(){
 return authoritySourcePins.map(pin=>{
  const path=fileURLToPath(new URL('../'+pin.sourcePath,import.meta.url));
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const identity=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.nlink];
   const before=fstatSync(fd);assert.ok(before.isFile()&&before.nlink===1&&before.size>0&&before.size<=1024*1024);
   const bytes=readFileSync(fd);assert.deepEqual(identity(fstatSync(fd)),identity(before));
   assert.equal(bytes.length,before.size);assert.equal(sha(bytes),pin.sourceSha256);
   const named=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{assert.deepEqual(identity(fstatSync(named)),identity(before));}finally{closeSync(named);}
   return {...pin,sql:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),identity:identity(before)};
  }finally{closeSync(fd);}
 });
}
function baseRecipes(originalGuards){
 assert.ok(Array.isArray(originalGuards));assert.equal(originalGuards.length,2);
 for(let i=0;i<2;i++){
  const g=originalGuards[i];closed(g,['definition','owner','prosrc']);assert.equal(g.owner,'supabase_admin');
  assert.equal(typeof g.prosrc,'string');assert.equal(sha(g.prosrc),guardBodySha[i]);
  assert.equal(typeof g.definition,'string');assert.ok(g.definition.startsWith('CREATE OR REPLACE FUNCTION '+guardIds[i]+'\n'));
  assert.ok(g.definition.endsWith('AS $function$'+g.prosrc+'$function$\n'));
 }
 let group=replaceOnce(originalGuards[0].definition,'    or not exists(select 1 from public.msg_threads t where t.id=NEW.group_uuid',
  '    or (not exists(select 1 from public.msg_threads t where t.id=NEW.group_uuid');
 group=replaceOnce(group,'      and t.original_group_creation=NEW.original_tuple) then',
  '      and t.original_group_creation=NEW.original_tuple)\n    and not custodial_dr.immutable_import_matches_private_record(TG_RELID,NEW)) then');
 const normal='  perform custodial_dr.acquire_application_mutation_fence();';
 const ordinary="  if TG_OP = 'INSERT' and TG_LEVEL = 'STATEMENT' and TG_WHEN = 'BEFORE'\n"
  +"    and current_user = session_user\n"
  +"    and (select oid from pg_catalog.pg_roles where rolname = session_user)\n"
  +"      = (select relowner from pg_catalog.pg_class where oid = 'custodial_dr.restore_control'::regclass)\n"
  +"    and exists (select 1 from custodial_dr.immutable_private_import_context c\n"
  +"      where c.database_oid = (select oid from pg_catalog.pg_database where datname = current_database())\n"
  +"        and c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current()\n"
  +"        and c.phase in ('INSERTING_ORDINARY','INSERTING_ORDINARY_SET') and c.active_table_oid = TG_RELID\n"
  +"        and c.active_row_sha256 ~ '^[a-f0-9]{64}$') then\n"
  +"    perform custodial_dr.immutable_import_assert_context();\n    return null;\n  end if;\n"+normal;
 const authority="  IF TG_WHEN='BEFORE' AND TG_LEVEL='STATEMENT' AND TG_NARGS=0\n"
  +"   AND TG_NAME='custodial_disaster_restore_mutation_fence'\n"
  +"   AND TG_OP IN('UPDATE','DELETE')\n"
  +"   AND custodial_dr.immutable_original_authority_guard_matches(TG_RELID,TG_OP)\n"
  +"  THEN RETURN NULL; END IF;\n";
 const after=[group,replaceOnce(originalGuards[1].definition,normal,ordinary.replace(normal,authority+normal))];
 return originalGuards.map((g,i)=>Object.freeze({identity:guardIds[i],registry_identity:guardIds[i],
  before:g.definition,after:after[i],beforeHash:sha(g.definition),afterHash:sha(after[i]),
  beforeBodyHash:guardBodySha[i],afterBodyHash:sha(bodyOf(after[i]))}));
}
function requireArchive(archive,original){
 const current=readVerifiedPrivateImportSource(archive);
 assert.equal(current.sourceBinding,original.sourceBinding);
 assert.deepEqual(current.selection,original.selection);assert.deepEqual(current.privateDataMembers,original.privateDataMembers);
}
// Caller objects, archived SQL and these strings cannot authorize target
// writes. The later fixed installer must obtain this Source itself and retain
// actual original owner/fresh-target/fence/currentness checks across every IO.
export async function prepareVerifiedImmutableBootstrapSource(verifiedArchive){
 let sourcePhase='ARCHIVE_ADMISSION';
 try{
 const original=readVerifiedPrivateImportSource(verifiedArchive);requireArchive(verifiedArchive,original);
 sourcePhase='ORIGINAL_INVENTORY';
 const observed=readVerifiedImmutableBootstrapInventory(verifiedArchive);requireArchive(verifiedArchive,original);
 closed(observed,['sourceBinding','inventory']);assert.equal(observed.sourceBinding,original.sourceBinding);
 closed(observed.inventory,inventoryKeys);
 sourcePhase='PROGRAM_SOURCE';
 const base=readBaseSource(),domain=loadImmutableDomainSourceRecipes(),messages=loadImmutableMessageSourceRecipes(),authority=readAuthoritySources();
 domain.assertCurrent();messages.assertCurrent();requireArchive(verifiedArchive,original);
 sourcePhase='ORIGINAL_ROWS';
 const raw=await collectVerifiedRestoreBootstrapRows(verifiedArchive);
 requireArchive(verifiedArchive,original);domain.assertCurrent();messages.assertCurrent();
 assert.equal(raw.sourceBinding,original.sourceBinding);
 assert.deepEqual(readVerifiedImmutableBootstrapInventory(verifiedArchive).inventory,observed.inventory);
 const parse=name=>JSON.parse(observed.inventory['inventory/'+name]);
 const catalog=parse('table-catalog.json'),identity=original.sourceBinding.source_identity;
 assert.deepEqual(catalog,original.selection.databaseTables);
 const ledger=parse('migration-ledger.json');assert.ok(Array.isArray(ledger)&&ledger.length>0);
 assert.equal(ledger.length,identity.migration_ledger_count);assert.equal(ledger.at(-1).version,identity.migration_head);
 sourcePhase='ORIGINAL_RELEASE';
 assert.equal(raw.releaseRows.length,1);assert.ok(raw.registryRows.length>0);
 const releaseTable=catalog.filter(table=>table.schema_name==='public'&&table.table_name==='release_deployment_manifest');
 assert.equal(releaseTable.length,1);
 if(releaseTable[0].data_encoding===postgresTextColumnsLineEncoding){
  // This is Source preparation ONLY. Native text is not ordinary JSON DATA:
  // do not coerce boolean/time/JSON fields in JS to manufacture equality.
  // The initializer must compare the COMPLETE actual decoded native record
  // to signed release metadata before its first bootstrap DATA insertion.
  const textRow=JSON.parse(raw.releaseRows[0]);closed(textRow,Object.keys(identity.release));
  for(const column of releaseTable[0].columns){
   assert.ok(textRow[column.name]===null||typeof textRow[column.name]==='string');
   if(column.data_type==='text')assert.equal(textRow[column.name],identity.release[column.name]);
  }
 }else{
  assert.equal(releaseTable[0].data_encoding,postgresJsonTextLineEncoding);
  assert.deepEqual(JSON.parse(raw.releaseRows[0]),identity.release);
 }
 sourcePhase='SOURCE_RECIPES';
 const allRecipes=[...baseRecipes(parse('original-guards.json')),...domain.recipes,...messages.recipes];
 assert.equal(allRecipes.length,25);assert.equal(new Set(allRecipes.map(r=>r.identity)).size,25);
 const recipes=allRecipes.map(recipe=>{
  closed(recipe,['identity','registry_identity','before','after','beforeHash','afterHash','beforeBodyHash','afterBodyHash']);
  assert.match(recipe.identity,/^(public|custodial_dr|custodial_release_identity)\.[a-z_][a-z0-9_]*\(\)$/);
  for(const key of ['before','after'])assert.equal(typeof recipe[key],'string');
  for(const key of ['beforeHash','afterHash','beforeBodyHash','afterBodyHash'])assert.match(recipe[key],/^[a-f0-9]{64}$/);
  assert.equal(sha(recipe.before),recipe.beforeHash);assert.equal(sha(recipe.after),recipe.afterHash);
  assert.equal(sha(bodyOf(recipe.before)),recipe.beforeBodyHash);assert.equal(sha(bodyOf(recipe.after)),recipe.afterBodyHash);
  return Object.freeze({...recipe});
 });
 sourcePhase='ORIGINAL_REGISTRY';
 const originalRows=raw.registryRows.map(text=>{const row=JSON.parse(text);assert.equal(sha(row.definition_sql),row.definition_sha256);return row;});
 const registrySource=Object.create(null);
 for(const recipe of recipes){
  const aliases=recipe.registry_identity===recipe.identity&&recipe.identity.startsWith('public.')
   ?[recipe.identity,recipe.identity.slice(7)]:[recipe.registry_identity];
  const found=originalRows.filter(row=>row.object_kind==='function'&&aliases.includes(row.object_identity));
  if(recipe.identity==='custodial_dr.guard_application_mutation()'){assert.equal(found.length,0);continue;}
  assert.equal(found.length,1);assert.equal(found[0].definition_sql,recipe.before);assert.equal(found[0].definition_sha256,recipe.beforeHash);
  assert.ok(!Object.hasOwn(registrySource,found[0].object_identity));
  registrySource[found[0].object_identity]=Object.freeze({definition_sql:recipe.after,definition_sha256:recipe.afterHash});
 }
 assert.equal(Object.keys(registrySource).length,24);
 sourcePhase='SOURCE_STATEMENTS';
 const statements=[Object.freeze({sourcePath:sourceOrder[0],sourceSha256:baseSha,sql:base.sql}),...domain.statements,...messages.statements,
  ...authority.map(({sourcePath,sourceSha256,sql})=>Object.freeze({sourcePath,sourceSha256,sql}))];
 assert.equal(statements.length,sourceOrder.length);assert.equal(new Set(statements.map(s=>s.sourcePath)).size,sourceOrder.length);
 const ordered=sourceOrder.map(sourcePath=>{
  const statement=statements.find(s=>s.sourcePath===sourcePath);assert.ok(statement);
  closed(statement,['sourcePath','sourceSha256','sql']);assert.equal(sha(statement.sql),statement.sourceSha256);
  return Object.freeze({...statement});
 });
 const result=Object.freeze({schema:'custodial.immutable-private-source-bootstrap.v1',sourceBinding:original.sourceBinding,
  inventory:observed.inventory,releaseRows:raw.releaseRows,registryRows:raw.registryRows,memberProofs:raw.memberProofs,
  recipes:Object.freeze(recipes),registrySource:Object.freeze(registrySource),statements:Object.freeze(ordered),
  target_authority:false,transaction_authority:false,import_authority:false,resume_allowed:false});
 plans.set(result,{archive:verifiedArchive,original,inventory:observed.inventory,baseIdentity:base.identity,domain,messages,
  authorityIdentities:authority.map(row=>row.identity)});
 sourcePhase='FINAL_CURRENTNESS';
 assertVerifiedImmutableBootstrapSource(result,verifiedArchive);return result;
 }catch{throw bootstrapSourceUnavailable(sourcePhase);}
}

export function assertVerifiedImmutableBootstrapSource(source,verifiedArchive){
 let sourcePhase='SOURCE_HANDLE';
 try{
 if(!source||typeof source!=='object'||types.isProxy(source)||!plans.has(source))throw new Error('Original bootstrap Source is unavailable.');
 sourcePhase='ARCHIVE_CURRENTNESS';
 const record=plans.get(source);assert.equal(verifiedArchive,record.archive);requireArchive(verifiedArchive,record.original);
 sourcePhase='PROGRAM_CURRENTNESS';
 assert.deepEqual(readBaseSource().identity,record.baseIdentity);record.domain.assertCurrent();record.messages.assertCurrent();
 assert.deepEqual(readAuthoritySources().map(row=>row.identity),record.authorityIdentities);
 sourcePhase='INVENTORY_CURRENTNESS';
 const observed=readVerifiedImmutableBootstrapInventory(verifiedArchive);
 assert.equal(observed.sourceBinding,record.original.sourceBinding);assert.deepEqual(observed.inventory,record.inventory);
 sourcePhase='FINAL_CURRENTNESS';
 requireArchive(verifiedArchive,record.original);
 // Intentionally no admission result, database operation or caller capability.
 }catch{throw bootstrapSourceUnavailable(sourcePhase);}
}

// Fixed signed ACL DATA only. Revocation-only reconciliation still requires
// the actual original owner, fresh target and held global transaction fence.
export function readVerifiedImmutableBootstrapAcls(source,verifiedArchive){
 assertVerifiedImmutableBootstrapSource(source,verifiedArchive);
 const record=plans.get(source),value=JSON.parse(record.inventory['inventory/original-acls.json']);
 closed(value,['routines','relations','namespaces_columns']);
 for(const key of ['routines','relations','namespaces_columns'])assert.ok(Array.isArray(value[key]));
 const queue=[value];while(queue.length){const item=queue.pop();if(item&&typeof item==='object'){
  queue.push(...Object.values(item));Object.freeze(item);
 }}
 assertVerifiedImmutableBootstrapSource(source,verifiedArchive);return value;
}

// Fixed expected-row DATA, not a caller catalog, write capability or target
// observation. Original JSON strings remain raw; only the already-admitted
// two definition fields may be transformed, later inside PostgreSQL.
export function readVerifiedImmutableBootstrapSourceRows(source,verifiedArchive){
 assertVerifiedImmutableBootstrapSource(source,verifiedArchive);
 const cached=sourceRowExpectations.get(source);
 if(cached){assertVerifiedImmutableBootstrapSource(source,verifiedArchive);return cached;}
 const record=plans.get(source),relations=JSON.parse(record.inventory['inventory/original-relations.json']);
 assert.ok(Array.isArray(relations));
 const tables=[
  ['release_deployment_manifest',source.releaseRows,Object.freeze({})],
  ['custodial_release_authority_restore_inventory',source.registryRows,source.registrySource],
 ].map(([table_name,originalRows,replacements])=>{
  const matches=relations.filter(row=>row.schema_name==='public'&&row.table_name===table_name);
  assert.equal(matches.length,1);
  const relation=matches[0];closed(relation,['schema_name','table_name','relation_kind','is_partition','owner_name','relrowsecurity','relforcerowsecurity']);
  assert.equal(relation.relation_kind,'r');assert.equal(relation.is_partition,false);
  assert.equal(relation.owner_name,'supabase_admin');
  assert.equal(typeof relation.relrowsecurity,'boolean');assert.equal(typeof relation.relforcerowsecurity,'boolean');
  assert.ok(Object.isFrozen(originalRows)&&originalRows.length>0&&originalRows.every(row=>typeof row==='string'));
  assert.ok(Object.isFrozen(replacements));
  return Object.freeze({schema_name:'public',table_name,owner_name:relation.owner_name,originalRows,replacements});
 });
 const expected=Object.freeze({sourceBinding:record.original.sourceBinding,tables:Object.freeze(tables),metadata_only:true});
 assertVerifiedImmutableBootstrapSource(source,verifiedArchive);
 sourceRowExpectations.set(source,expected);return expected;
}
