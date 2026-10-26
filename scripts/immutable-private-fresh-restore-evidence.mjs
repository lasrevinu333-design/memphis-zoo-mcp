// Same-original finished DATA serialization only. No SQL, FINISHED-context,
// metadata-write, COMMIT, retry or resume authority is created by this view.
import {types,isDeepStrictEqual} from 'node:util';
import {readVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {readVerifiedPrivateImportSource} from './disaster-recovery-archive.mjs';
import {restoreCheckEvidence} from './restore-unvalidated-checks.mjs';

const finishedKeys=['database_oid','backend_pid','transaction_id','restore_id','authority_generation',
  'archive_digest','private_rows','transaction_authority','admission_resumed'];
const maxInt64=9223372036854775807n;
const fail=()=>{throw Object.assign(new TypeError('Immutable fresh database evidence is invalid.'),{
  code:'IMMUTABLE_FRESH_DATABASE_EVIDENCE_INVALID'});};
function record(value){
  if(!value||typeof value!=='object'||types.isProxy(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors)){
    const field=descriptors[key];
    if(typeof key!=='string'||!Object.hasOwn(field,'value')||field.enumerable!==true)fail();
  }
  return descriptors;
}
function field(descriptors,key){
  if(!Object.hasOwn(descriptors,key))fail();
  return descriptors[key].value;
}
function closed(value,keys){
  const descriptors=record(value);
  if(!isDeepStrictEqual(Reflect.ownKeys(descriptors).sort(),keys.slice().sort()))fail();
  const copy={};
  for(const key of keys)copy[key]=field(descriptors,key);
  return Object.freeze(copy);
}
function dense(value){
  if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)fail();
  const descriptors=Object.getOwnPropertyDescriptors(value),length=descriptors.length.value;
  if(Reflect.ownKeys(descriptors).length!==length+1)fail();
  const copy=[];
  for(let i=0;i<length;i++){
    const entry=descriptors[String(i)];
    if(!entry||!Object.hasOwn(entry,'value')||entry.enumerable!==true)fail();
    copy.push(entry.value);
  }
  return copy;
}
function decimal(value,positive,max=maxInt64){
  if(typeof value!=='string'||value.length>19
    ||!(positive?/^[1-9][0-9]*(?![\s\S])/:/^(0|[1-9][0-9]*)(?![\s\S])/).test(value))fail();
  const count=BigInt(value);if(count>max)fail();return count;
}
function rows(values){
  const result=[],seen=new Set();
  for(const value of dense(values)){
    const fields=record(value),schema=field(fields,'schema_name'),table=field(fields,'table_name');
    if(typeof schema!=='string'||typeof table!=='string'||!schema.length||!table.length)fail();
    const count=decimal(field(fields,'row_count'),false),identity=JSON.stringify([schema,table]);
    if(seen.has(identity))fail();seen.add(identity);
    result.push({schema,table,count,identity});
  }
  return result;
}

export function buildVerifiedImmutableFreshDatabaseEvidence(options){
  try{
    const args=closed(options,['verifiedArchive','freshIntent','finished']);
    const finished=closed(args.finished,finishedKeys);
    decimal(finished.database_oid,true,4294967295n);
    decimal(finished.transaction_id,true);
    decimal(finished.authority_generation,true);
    const privateRows=decimal(finished.private_rows,false);
    if(!Number.isSafeInteger(finished.backend_pid)||finished.backend_pid<1||finished.backend_pid>2147483647
      ||typeof finished.restore_id!=='string'
      ||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?![\s\S])/.test(finished.restore_id)
      ||typeof finished.archive_digest!=='string'||!/^[0-9a-f]{64}(?![\s\S])/.test(finished.archive_digest)
      ||finished.transaction_authority!==false||finished.admission_resumed!==false)fail();
    for(const value of [args.verifiedArchive,args.freshIntent])
      if(!value||typeof value!=='object'||types.isProxy(value))fail();
    // These are the real private-brand readers. Caller JSON cannot substitute
    // a token, an archive receipt, a catalog, or a finished SQL context.
    const captured=readVerifiedImmutableFreshRestoreIntent(args.freshIntent,args.verifiedArchive);
    const original=readVerifiedPrivateImportSource(args.verifiedArchive),binding=original.sourceBinding;
    if(captured.sourceBinding!==binding||finished.restore_id!==captured.intent.restore_id
      ||!Number.isSafeInteger(captured.intent.authority_generation)||captured.intent.authority_generation<1
      ||finished.authority_generation!==String(captured.intent.authority_generation)
      ||finished.archive_digest!==captured.intent.archive_digest||finished.archive_digest!==binding.archive_digest)fail();
    const catalog=rows(original.selection.databaseTables),members=rows(original.privateDataMembers);
    if(!catalog.length)fail();
    const byIdentity=new Map(catalog.map(row=>[row.identity,row]));
    let expectedPrivate=0n;
    for(const member of members){
      const table=byIdentity.get(member.identity);
      if(member.schema!=='custodial_release_identity'||!table||table.count!==member.count)fail();
      expectedPrivate+=member.count;
    }
    if(members.length!==catalog.filter(row=>row.schema==='custodial_release_identity').length
      ||expectedPrivate!==privateRows)fail();
    const imported=catalog.filter(row=>!(row.schema==='public'&&row.table==='release_deployment_manifest'));
    const total=values=>values.reduce((sum,row)=>sum+row.count,0n).toString();
    const check=restoreCheckEvidence([]);
    const checks=Object.freeze({...check,constraints:Object.freeze(check.constraints),mode:'NOT_SUSPENDED'});
    const common={tables:imported.length,unvalidated_check_constraints:checks,original_data_import:finished,
      consumed_source_tables:catalog.length,consumed_source_rows:total(catalog),preserved_current_release_bootstrap:true};
    const result=Object.freeze({database:Object.freeze({tables:common.tables,rows:total(imported),
      unvalidated_check_constraints:checks,original_data_import:finished,
      consumed_source_tables:common.consumed_source_tables,consumed_source_rows:common.consumed_source_rows,
      preserved_current_release_bootstrap:true}),event:Object.freeze(common)});
    // Bracket synchronous Source IO and serialization with the SAME original
    // binding/token, including a final real intent expiry/currentness check.
    const current=readVerifiedPrivateImportSource(args.verifiedArchive);
    if(current.sourceBinding!==binding||!isDeepStrictEqual(current.selection,original.selection)
      ||!isDeepStrictEqual(current.privateDataMembers,original.privateDataMembers))fail();
    const final=readVerifiedImmutableFreshRestoreIntent(args.freshIntent,args.verifiedArchive);
    if(final!==captured||final.sourceBinding!==binding)fail();
    return result;
  }catch{fail();}
}
