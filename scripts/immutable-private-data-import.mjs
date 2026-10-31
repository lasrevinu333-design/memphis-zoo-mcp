import {types,isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {pipeline} from 'node:stream/promises';
import pg from 'pg';
import {Socket} from 'node:net';
import {TLSSocket} from 'node:tls';
import {readVerifiedPrivateImportSource,openVerifiedRestoreTableData,decodeRestoreTableRowLine,createRestoreRowUtf8Guard,
  createRestoreRowLineBatchDecoder,postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding,readVerifiedImmutableBootstrapInventory,
  assertRestoreRowMutationFidelity,assertVerifiedLegacyRestoreDataCurrent} from './disaster-recovery-archive.mjs';
import {deriveOriginalAuthEnumDescriptors} from './immutable-original-enum-source.mjs';
import {splitSchemaStatements} from './isolated-event-owner-schema.mjs';
import {prepareVerifiedImmutableBootstrapSource,readVerifiedImmutableBootstrapSourceRows} from './immutable-private-source-bootstrap.mjs';
import {captureVerifiedOriginalRestoreIntent} from './disaster-recovery-crypto.mjs';
import {initializeVerifiedImmutableFreshSource} from './immutable-private-source-initializer.mjs';
import {captureVerifiedImmutableFreshRestoreIntent,readVerifiedImmutableFreshRestoreIntent} from './immutable-private-fresh-restore-intent.mjs';
import {prepareVerifiedImmutableFreshRestoreControl} from './immutable-private-fresh-restore-control.mjs';
import {recordVerifiedImmutableFreshDatabaseEvidence} from './immutable-private-fresh-restore-record.mjs';
import {readVerifiedImmutableFreshCommitRecord,readVerifiedImmutableFreshAuthorityPreparation} from './immutable-private-fresh-restore-commit-context.mjs';
import {capturePreRestoreState} from './disaster-recovery-state.mjs';

const Client=pg.Client,query=Client.prototype.query,attempted=new WeakSet(),privateFailures=new WeakMap();
const identities=['employee_message_original_outcomes','group_original_creations'];
const witnessKeys=['database_oid','backend_pid','transaction_id','restore_id','authority_generation','archive_digest'];
const freshClients=new WeakSet(),freshArchives=new WeakSet();
const freshStaged=new WeakMap();
const freshAuthorityPreparations=new WeakSet(),authorityClientPrototype=Client.prototype,
  authorityConnectionPrototype=pg.Connection.prototype,authorityConnectionQuery=pg.Connection.prototype.query;
const authorityConnection=pg.Connection,nativePromise=globalThis.Promise;
const originalNativePrototypes=[...new Set([authorityClientPrototype,authorityConnectionPrototype,Socket.prototype,TLSSocket.prototype]
  .flatMap(value=>{const parents=[];for(let current=value;current;current=Object.getPrototypeOf(current))parents.push(current);return parents;}))]
  .map(value=>({value,parent:Object.getPrototypeOf(value),descriptors:Object.getOwnPropertyDescriptors(value)}));
const freshAuthorityAttempts=new WeakSet();
function nativeData(object,key){
  if(!object||typeof object!=='object'||types.isProxy(object))fail();
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();
  return descriptor.value;
}
// Capture actual original transport objects, not just a PID/xid that can be
// copied into a receipt. No caller port/callback can supply this ancestry.
function captureFreshNativePort(db){
  if(!db||types.isProxy(db)||Object.getOwnPropertyDescriptor(pg,'Client')?.value!==Client
    ||Object.getOwnPropertyDescriptor(pg,'Connection')?.value!==authorityConnection
    ||Object.getPrototypeOf(db)!==authorityClientPrototype)fail();
  for(const pinned of originalNativePrototypes){
    if(Object.getPrototypeOf(pinned.value)!==pinned.parent)fail();
    const fields=Object.getOwnPropertyDescriptors(pinned.value),keys=Reflect.ownKeys(pinned.descriptors);
    if(Reflect.ownKeys(fields).length!==keys.length)fail();
    for(const key of keys){const a=pinned.descriptors[key],b=fields[key];
      if(!b||a.value!==b.value||a.get!==b.get||a.set!==b.set||a.writable!==b.writable
        ||a.enumerable!==b.enumerable||a.configurable!==b.configurable)fail();
    }
  }
  for(const key of Reflect.ownKeys(originalNativePrototypes.find(p=>p.value===authorityClientPrototype).descriptors))
    if(Object.hasOwn(db,key))fail();
  const connection=nativeData(db,'connection');
  if(!connection||types.isProxy(connection)||Object.getPrototypeOf(connection)!==authorityConnectionPrototype)fail();
  for(const key of Reflect.ownKeys(originalNativePrototypes.find(p=>p.value===authorityConnectionPrototype).descriptors))
    if(Object.hasOwn(connection,key))fail();
  const stream=nativeData(connection,'stream');
  if(!stream||types.isProxy(stream)||![Socket.prototype,TLSSocket.prototype].includes(Object.getPrototypeOf(stream)))fail();
  for(const key of ['connect','write','end','destroy','on','emit','readyState','destroyed','readable','writable'])
    if(Object.hasOwn(stream,key))fail();
  for(const [key,expected] of [['_connected',true],['_connecting',false],['_ending',false],['_ended',false],
    ['_queryable',true],['_connectionError',false],['readyForQuery',true]])
    if(nativeData(db,key)!==expected)fail(undefined,'IMMUTABLE_NATIVE_CLIENT_'+key.replace(/^_/,'').toUpperCase());
  const activeQuery=nativeData(db,'_activeQuery');
  if(activeQuery!==null&&activeQuery!==undefined)fail(undefined,'IMMUTABLE_NATIVE_ACTIVE_QUERY');
  if(!['I','T'].includes(nativeData(db,'_txStatus')))fail(undefined,'IMMUTABLE_NATIVE_TRANSACTION_STATE');
  if(globalThis.Promise!==nativePromise||nativeData(db,'_Promise')!==nativePromise)fail(undefined,'IMMUTABLE_NATIVE_PROMISE');
  // Installed pg 8.22 Connection.sync() sets this flag during an ordinary
  // extended-query Sync too. Termination is guarded by the ACTUAL Client
  // ending/ended flags and live ready/socket/queue identity above/below.
  if(typeof nativeData(connection,'_ending')!=='boolean')fail(undefined,'IMMUTABLE_NATIVE_CONNECTION_STATE');
  if(nativeData(stream,'connecting')!==false||stream.destroyed!==false||stream.readyState!=='open')
    fail(undefined,'IMMUTABLE_NATIVE_STREAM_UNAVAILABLE');
  const queue=nativeData(db,'_queryQueue');
  if(!Array.isArray(queue)||types.isProxy(queue)||Object.getPrototypeOf(queue)!==Array.prototype
    ||Reflect.ownKeys(queue).length!==1||queue.length!==0)fail();
  const processID=nativeData(db,'processID');
  if(!Number.isInteger(processID)||processID<1||processID>2147483647)fail();
  return Object.freeze({connection,stream,processID});
}
function sameFreshNativePort(db,original){
  const current=captureFreshNativePort(db);
  if(!original||current.connection!==original.connection||current.stream!==original.stream||current.processID!==original.processID)fail();
}
function fail(cause,code='PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED') {
  const error=Object.assign(new Error(code),{code,outcome:'UNKNOWN',retry_safe:false});
  if(cause){privateFailures.set(error,cause);
    const field=Object.getOwnPropertyDescriptor(cause,'code');
    if(field&&Object.hasOwn(field,'value')&&typeof field.value==='string'&&/^[0-9A-Z]{5}$/.test(field.value))error.sql_state=field.value;
    // Fixed shipping guard vocabulary only. Never expose raw PG detail,
    // values, SQL or cause; this diagnostic cannot create retry authority.
    const message=Object.getOwnPropertyDescriptor(cause,'message');
    if(error.sql_state==='55000'&&message&&Object.hasOwn(message,'value')&&[
      'Immutable import original global fence unavailable','Immutable import Source inventory epoch unavailable',
      'Immutable import Source inventory context changed','Immutable import Source inventory original changed',
      'Immutable import original context changed','Immutable import full target catalog mismatch',
      'Immutable private guard kind unsupported','IMMUTABLE_MIXED_GENERATED_ONLY_INSERT_UNSUPPORTED',
      'IMMUTABLE_MIXED_INSERT_GUARD_UNSUPPORTED','Immutable import current Source registry unavailable or stale',
    ].includes(message.value))error.import_refusal=message.value;
  }
  throw error; // No raw PG detail/body/cause on the observable failure.
}
function closed(value,keys) {
  if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype
    ||Reflect.ownKeys(value).some(key=>typeof key!=='string')
    ||!isDeepStrictEqual(Reflect.ownKeys(value).sort(),keys.slice().sort()))fail();
  const copy={};for(const key of keys){const field=Object.getOwnPropertyDescriptor(value,key);
    if(!field||!Object.hasOwn(field,'value'))fail();copy[key]=field.value;}return copy;
}
// Actual pg.Result has additional own fields/prototype; never read a caller
// getter/proxy while admitting its single closed JSON witness projection.
function contextWitness(result) {
  if(!result||typeof result!=='object'||types.isProxy(result))fail();
  const count=Object.getOwnPropertyDescriptor(result,'rowCount'),rows=Object.getOwnPropertyDescriptor(result,'rows');
  if(!count||!Object.hasOwn(count,'value')||count.value!==1||!rows||!Object.hasOwn(rows,'value'))fail();
  const values=rows.value;
  if(!values||types.isProxy(values)||!Array.isArray(values)||Object.getPrototypeOf(values)!==Array.prototype
    ||Object.getOwnPropertyDescriptor(values,'length').value!==1
    ||Reflect.ownKeys(values).some(key=>typeof key!=='string')
    ||!isDeepStrictEqual(Reflect.ownKeys(values).sort(),['0','length']))fail();
  const entry=Object.getOwnPropertyDescriptor(values,'0');
  if(!entry||!Object.hasOwn(entry,'value'))fail();
  const value=closed(closed(entry.value,['context']).context,witnessKeys);
  if(typeof value.database_oid!=='string'||!/^[1-9][0-9]{0,9}(?![\s\S])/.test(value.database_oid)
    ||BigInt(value.database_oid)>4294967295n
    ||!Number.isSafeInteger(value.backend_pid)||value.backend_pid<1||value.backend_pid>2147483647
    ||typeof value.transaction_id!=='string'||typeof value.restore_id!=='string'
    ||typeof value.authority_generation!=='string'||typeof value.archive_digest!=='string')fail();
  return value;
}
function sameSource(archive,original) {
  let current;try{current=readVerifiedPrivateImportSource(archive);}catch(error){fail(error);}
  if(current.sourceBinding!==original.sourceBinding||!isDeepStrictEqual(current.selection,original.selection)
    ||!isDeepStrictEqual(current.privateDataMembers,original.privateDataMembers))fail();
}

// A v1 JSON row is not an injective encoding of every PostgreSQL value.
// Bind its formatted catalog types to the authenticated pg_dump declarations
// under the dump's EMPTY search_path (implicit pg_catalog first), rather than
// treating a domain/custom type named public.text/json as a built-in. This is
// detached syntax DATA only; neither this map nor a successful scan is cached
// as currentness, target permission, an import token or a retry receipt.
function legacyOriginalColumnSources(tables,schemaSql) {
  const key=table=>JSON.stringify([table.schema_name,table.table_name]);
  const wanted=new Map(tables.filter(table=>table.row_count!=='0').map(table=>[key(table),table]));
  const found=new Set(),word=(token,value)=>token?.kind==='identifier'&&!token.quoted&&token.value===value;
  const tokensEqual=(a,b)=>a.length===b.length&&a.every((t,i)=>t.kind===b[i].kind&&t.value===b[i].value&&t.quoted===b[i].quoted);
  let emptyPath=false;
  for(const statement of splitSchemaStatements(schemaSql).statements){
    const t=statement.tokens;
    if(word(t[0],'select')){
      if(!(t.length===12&&word(t[1],'pg_catalog')&&t[2]?.value==='.'&&word(t[3],'set_config')
        &&t[4]?.value==='('&&t[5]?.kind==='literal'&&t[5].value==='search_path'&&t[6]?.value===','
        &&t[7]?.kind==='literal'&&t[7].value===''&&t[8]?.value===','&&word(t[9],'false')&&t[10]?.value===')'
        &&t[11]?.value===';'&&!emptyPath))fail();
      emptyPath=true;continue;
    }
    const ddl=word(t[0],'create')&&word(t[1],'or')&&word(t[2],'replace')?t.slice(2):t;
    if(['do','call','execute','reset','discard'].some(value=>word(t[0],value))
      ||word(t[0],'set')&&(word(t[1],'schema')||t.some(token=>word(token,'search_path')))
      ||word(t[0],'create')&&word(t[1],'cast')
      ||['create','alter','drop','replace'].some(value=>word(ddl[0],value))
        &&['type','domain','table','function'].some(value=>word(ddl[1],value))&&ddl[2]?.value==='pg_catalog')fail();
    // Canonical --clean pg_dump may drop old constraints/tables BEFORE their
    // sole archived declarations. It is not a later type/column override.
    if(word(t[0],'drop')&&word(t[1],'table')){
      if(!(word(t[2],'if')&&word(t[3],'exists')&&t[4]?.kind==='identifier'&&t[5]?.value==='.'
        &&t[6]?.kind==='identifier'&&t[7]?.value===';'&&t.length===8)
        ||found.has(JSON.stringify([t[4].value,t[6].value])))fail();
    }
    if(word(t[0],'alter')&&word(t[1],'table')){
      let at=2;
      if(word(t[at],'if')){if(!word(t[at+1],'exists'))fail();at+=2;}
      if(word(t[at],'only'))at++;
      if(t[at]?.kind!=='identifier'||t[at+1]?.value!=='.'||t[at+2]?.kind!=='identifier')fail();
      const change=t.slice(at+3),constraintDrop=change.length===7&&word(change[0],'drop')&&word(change[1],'constraint')
        &&word(change[2],'if')&&word(change[3],'exists')&&change[4]?.kind==='identifier';
      // Depending on pg_dump version DROP CONSTRAINT has just its semicolon,
      // or an explicit RESTRICT. Neither may remove/change a column/type.
      const cleanDrop=word(change[0],'drop')&&word(change[1],'constraint')&&word(change[2],'if')&&word(change[3],'exists')
        &&change[4]?.kind==='identifier'&&((change.length===6&&change[5]?.value===';')
          ||(constraintDrop&&word(change[5],'restrict')&&change[6]?.value===';'));
      if(wanted.has(JSON.stringify([t[at].value,t[at+2].value]))&&!cleanDrop
        &&change.some(token=>['type','rename','drop','inherit','of'].some(value=>word(token,value))))fail();
    }
    if(!(word(t[0],'create')&&word(t[1],'table')))continue;
    if(!emptyPath||t[2]?.kind!=='identifier'||t[3]?.value!=='.'||t[4]?.kind!=='identifier'||t[5]?.value!=='(')fail();
    const identity=JSON.stringify([t[2].value,t[4].value]),table=wanted.get(identity);
    if(!table)continue;
    if(found.has(identity))fail();found.add(identity);
    const columns=[];let start=6,depth=0,end=-1;
    for(let i=6;i<t.length;i++){
      if(t[i].value==='('||t[i].value==='[')depth++;
      else if(t[i].value===')'&&depth===0){end=i;break;}
      else if(t[i].value===')'||t[i].value===']')depth--;
      if(depth===0&&t[i].value===','){columns.push(t.slice(start,i));start=i+1;}
    }
    if(end<0)fail();columns.push(t.slice(start,end));
    const declared=[];
    for(const part of columns){
      if(['constraint','check','primary','unique','foreign','exclude'].some(value=>word(part[0],value)))continue;
      if(part[0]?.kind!=='identifier')fail();
      let last=part.length,nesting=0;
      for(let i=1;i<part.length;i++){
        if(nesting===0&&['default','collate','not','null','constraint','generated','primary','unique','references','check'].some(value=>word(part[i],value))){last=i;break;}
        if(part[i].value==='('||part[i].value==='[')nesting++;
        if(part[i].value===')'||part[i].value===']')nesting--;
      }
      declared.push({name:part[0].value,type:part.slice(1,last)});
    }
    if(declared.length!==table.columns.length)fail();
    for(let i=0;i<declared.length;i++){
      const column=table.columns[i];
      if(declared[i].name!==column.name||typeof column.data_type!=='string')fail();
      const parsed=splitSchemaStatements('SELECT '+column.data_type+';').statements;
      if(parsed.length!==1||!word(parsed[0].tokens[0],'select')
        ||!tokensEqual(declared[i].type,parsed[0].tokens.slice(1,-1)))fail();
    }
  }
  if(!emptyPath||found.size!==wanted.size)fail();
}

async function requireLegacyOriginalDataFidelity(verifiedArchive,original,current) {
  const legacy=original.selection.databaseTables.filter(table=>table.data_encoding!==postgresTextColumnsLineEncoding);
  if(!legacy.length)return; // v2 retains its existing typed-reader/stage path.
  try{
    current();
    if(legacy.some(table=>table.row_count!=='0')){
      const metadata=readVerifiedImmutableBootstrapInventory(verifiedArchive);
      if(metadata.sourceBinding!==original.sourceBinding)fail();
      legacyOriginalColumnSources(legacy,metadata.inventory['inventory/application-schema.sql']);
      current();
    }
    for(const table of legacy){
      current();
      const data=openVerifiedRestoreTableData(verifiedArchive,table.schema_name,table.table_name);
      let guard,input,settled,count=0n,failed=false,failure;
      try{
        if(!isDeepStrictEqual(data.table,table))fail();
        guard=createRestoreRowUtf8Guard();input=createRestoreRowLineBatchDecoder();
        settled=pipeline(data.stream,guard,input);settled.catch(()=>{});
        for await(const batch of input){
          current();
          for(const line of batch){
            if(count>=BigInt(table.row_count))fail();
            assertRestoreRowMutationFidelity(line,table);count++;
          }
          current();
        }
        current();await settled;current();
        const eof=await data.verified;current();
        if(count.toString()!==table.row_count||eof.data_file!==table.data_file
          ||!Number.isSafeInteger(eof.bytes)||eof.bytes<0||typeof eof.sha256!=='string'
          ||!/^[a-f0-9]{64}(?![\s\S])/.test(eof.sha256))fail();
      }catch(error){failed=true;failure=error;}
      finally{
        const cleanup=[];
        for(const stream of [input,data.stream,guard])try{stream?.destroy();}catch(error){cleanup.push(error);}
        try{current();}catch(error){cleanup.push(error);}
        if(settled)await settled.catch(()=>{});
        try{current();}catch(error){cleanup.push(error);}
        try{await data.close();}catch(error){cleanup.push(error);}
        try{current();}catch(error){cleanup.push(error);}
        if(cleanup.length){if(!failed){failed=true;failure=cleanup.shift();}
          failure=new AggregateError([failure,...cleanup],'Original DATA preflight cleanup failed');}
      }
      if(failed)throw failure;
    }
    current();assertVerifiedLegacyRestoreDataCurrent(verifiedArchive);current();
  }catch(error){fail(error,'IMMUTABLE_LEGACY_DATA_FIDELITY_UNPROVEN');}
}

// Closed, one-consumption routing DATA from this invocation's validated FK
// catalog (and exact INSERT-trigger profile for non-self multi-row sets).
// Never a target/constraint authority or cached currentness verdict;
// the original source/context still brackets every actual IO/effect below.
const selfOrdinaryConsumers=new WeakMap();

// Prove only a structurally cyclic FK inactive, using EVERY authenticated raw
// original. SQL classifies actual typed argument NULLs (including JSON types),
// never a JS-null guess, first-row sample, deduplicated set or caller verdict.
async function inactiveOriginalForeignKeys(verifiedArchive,original,table,foreignKeys,sql,assertContext){
  const current=async()=>{sameSource(verifiedArchive,original);await assertContext();sameSource(verifiedArchive,original);};
  await current();
  const data=openVerifiedRestoreTableData(verifiedArchive,table.schema_name,table.table_name);
  let guard,input,settled,failed=false,failure,count=0n;
  const active=new Map(foreignKeys.map(fk=>[fk.constraint_oid,0n]));
  const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})(?![\s\S])/.test(value)&&BigInt(value)<=9223372036854775807n;
  const quote=value=>'"'+value.replaceAll('"','""')+'"';
  try{
    if(!isDeepStrictEqual(data.table,table)||!decimal(table.row_count)||table.row_count==='0')fail();
    guard=createRestoreRowUtf8Guard();input=createRestoreRowLineBatchDecoder();
    settled=pipeline(data.stream,guard,input);settled.catch(()=>{});
    const parts=foreignKeys.map((fk,index)=>{
      const nulls='pg_catalog.num_nulls('+fk.columns.map(column=>'(o.image).'+quote(column.name)).join(',')+')';
      return 'select $'+(index+2)+'::text constraint_oid,count(*)::text row_count,'
        +'count(*) filter(where '+nulls+'=0)::text active_rows,'
        +'count(*) filter(where '+nulls+'>0 and '+nulls+'<'+fk.columns.length+')::text partial_rows from original_rows o';
    });
    // begin() already established THIS same backend's immutable catalog and
    // actual context. Only v2 uses its context-bound typed decoder here.
    const textColumns=table.data_encoding===postgresTextColumnsLineEncoding;
    const statement='with original_rows as materialized(select r as image from pg_catalog.unnest($1::text[]) w(raw) '
      +'cross join lateral '+(textColumns?'custodial_dr.immutable_import_decode_record':'pg_catalog.json_populate_record')
      +'(null::'+quote(table.schema_name)+'.'+quote(table.table_name)
      +',w.raw'+(textColumns?'':'::json')+') r) '+parts.join(' union all ');
    for await(const batch of input){
      await current();
      if(!Array.isArray(batch)||types.isProxy(batch)||!Object.isFrozen(batch)||!batch.length
        ||Reflect.ownKeys(batch).length!==batch.length+1)fail();
      const rows=[];
      for(const line of batch){
        if(count>=BigInt(table.row_count))fail();
        rows.push(decodeRestoreTableRowLine(line,table));count++;
      }
      sameSource(verifiedArchive,original);
      const result=await sql(statement,[rows,...foreignKeys.map(fk=>fk.constraint_oid)]);
      await current();
      if(!result||!Array.isArray(result.rows)||types.isProxy(result.rows)
        ||result.rowCount!==foreignKeys.length||result.rows.length!==foreignKeys.length)fail();
      const seen=new Set();
      for(const value of result.rows){
        const row=closed(value,['constraint_oid','row_count','active_rows','partial_rows']);
        const fk=foreignKeys.find(fk=>fk.constraint_oid===row.constraint_oid);
        if(!fk||seen.has(row.constraint_oid)||!decimal(row.row_count)||!decimal(row.active_rows)||!decimal(row.partial_rows)
          ||row.row_count!==String(rows.length)||BigInt(row.active_rows)+BigInt(row.partial_rows)>BigInt(row.row_count)
          ||fk.match_type==='f'&&row.partial_rows!=='0')fail();
        seen.add(row.constraint_oid);active.set(row.constraint_oid,active.get(row.constraint_oid)+BigInt(row.active_rows));
      }
    }
    sameSource(verifiedArchive,original);await settled;sameSource(verifiedArchive,original);
    const eof=await data.verified;sameSource(verifiedArchive,original);
    if(eof.data_file!==table.data_file||!Number.isSafeInteger(eof.bytes)||eof.bytes<0
      ||typeof eof.sha256!=='string'||!/^[a-f0-9]{64}$/.test(eof.sha256)||String(count)!==table.row_count)fail();
    await current();
    return new Set([...active].filter(([,count])=>count===0n).map(([oid])=>oid));
  }catch(error){failed=true;failure=error;throw error;}
  finally{
    const cleanup=[];
    for(const stream of [input,data.stream,guard])try{stream?.destroy();}catch(error){cleanup.push(error);}
    try{sameSource(verifiedArchive,original);}catch(error){cleanup.push(error);}
    if(settled)await settled.catch(()=>{});
    try{await current();}catch(error){cleanup.push(error);}
    try{await data.close();}catch(error){cleanup.push(error);}
    try{await current();}catch(error){cleanup.push(error);}
    if(cleanup.length){
      if(failed)throw new AggregateError([failure,...cleanup],'Original FK source cleanup failed',{cause:failure});
      if(cleanup.length===1)throw cleanup[0];
      throw new AggregateError(cleanup,'Original FK source cleanup failed');
    }
  }
}

// The owner context has already locked and pinned ALL selected relations and
// their constraint definitions. Catalog order is not an INSERT dependency
// order. Observe actual target FKs without deferring/disabling their guards.
async function planVerifiedOrdinaryTables(verifiedArchive,original,sql,assertContext) {
  sameSource(verifiedArchive,original);await assertContext();sameSource(verifiedArchive,original);
  const selected=original.selection.databaseTables;
  const identity=(schema,table)=>JSON.stringify([schema,table]);
  const originals=new Map(selected.map(table=>[identity(table.schema_name,table.table_name),table]));
  if(originals.size!==selected.length||!selected.length)fail();
  const result=await sql(`select s.schema_name,s.table_name,c.oid::text as relation_oid,
    c.relkind::text as relation_kind,c.relpersistence::text as persistence,c.relispartition as is_partition,
    case when c.oid is null then null else coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('constraint_oid',k.oid::text,
        'parent_schema_name',pn.nspname,'parent_table_name',p.relname,'parent_relation_oid',p.oid::text,
        'validated',k.convalidated,'deferrable',k.condeferrable,'initially_deferred',k.condeferred,
        'match_type',k.confmatchtype::text,'columns',case when pg_catalog.cardinality(k.conkey)=pg_catalog.cardinality(k.confkey)
          and pg_catalog.array_lower(k.conkey,1)=1 and pg_catalog.array_lower(k.confkey,1)=1 then (
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,
            'data_type',pg_catalog.format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated::text,'identity',a.attidentity::text,
            'parent_name',pa.attname,'parent_data_type',pg_catalog.format_type(pa.atttypid,pa.atttypmod),
            'parent_generated',pa.attgenerated::text,'parent_identity',pa.attidentity::text) order by keys.ordinality)
          from pg_catalog.unnest(k.conkey) with ordinality keys(child_num,ordinality)
          left join pg_catalog.pg_attribute a on a.attrelid=k.conrelid and a.attnum=keys.child_num and a.attnum>0 and not a.attisdropped
          left join pg_catalog.pg_attribute pa on pa.attrelid=k.confrelid and pa.attnum=k.confkey[keys.ordinality::integer]
            and pa.attnum>0 and not pa.attisdropped) else null end) order by k.oid)
      from pg_catalog.pg_constraint k
      left join pg_catalog.pg_class p on p.oid=k.confrelid
      left join pg_catalog.pg_namespace pn on pn.oid=p.relnamespace
      where k.conrelid=c.oid and k.contype='f'),'[]'::jsonb) end as foreign_keys
    from pg_catalog.jsonb_to_recordset($1::jsonb) as s(schema_name text,table_name text)
    left join pg_catalog.pg_namespace n on n.nspname=s.schema_name
    left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=s.table_name
    order by s.schema_name,s.table_name`,[JSON.stringify(selected.map(({schema_name,table_name})=>({schema_name,table_name})))]);
  sameSource(verifiedArchive,original);
  if(!result||!Array.isArray(result.rows)||types.isProxy(result.rows)||result.rowCount!==selected.length||result.rows.length!==selected.length)fail();
  const relations=new Map(),oids=new Set(),constraintOids=new Set();
  const oid=value=>typeof value==='string'&&/^[1-9][0-9]*$/.test(value)&&BigInt(value)<=4294967295n;
  for(const value of result.rows){
    const row=closed(value,['schema_name','table_name','relation_oid','relation_kind','persistence','is_partition','foreign_keys']);
    const key=identity(row.schema_name,row.table_name);
    if(!originals.has(key)||relations.has(key)||!oid(row.relation_oid)||oids.has(row.relation_oid)
      ||row.relation_kind!=='r'||row.persistence!=='p'||row.is_partition!==false
      ||!Array.isArray(row.foreign_keys)||types.isProxy(row.foreign_keys))fail();
    const dependencies=[];
    for(const value of row.foreign_keys){
      const fk=closed(value,['constraint_oid','parent_schema_name','parent_table_name','parent_relation_oid','validated','deferrable','initially_deferred','match_type','columns']);
      if(!oid(fk.constraint_oid)||constraintOids.has(fk.constraint_oid)||!oid(fk.parent_relation_oid)
        ||fk.validated!==true||typeof fk.deferrable!=='boolean'||typeof fk.initially_deferred!=='boolean'
        ||(!fk.deferrable&&fk.initially_deferred)||typeof fk.parent_schema_name!=='string'||typeof fk.parent_table_name!=='string')fail();
      const parent=originals.get(identity(fk.parent_schema_name,fk.parent_table_name)),child=originals.get(key);
      if(!parent||!['s','f'].includes(fk.match_type)||!Array.isArray(fk.columns)||types.isProxy(fk.columns)||!fk.columns.length
        ||Reflect.ownKeys(fk.columns).length!==fk.columns.length+1)fail();
      const childNames=new Set(),parentNames=new Set();
      fk.columns=Object.freeze(fk.columns.map(value=>{
        const column=closed(value,['name','data_type','generated','identity','parent_name','parent_data_type','parent_generated','parent_identity']);
        const a=child.columns.find(c=>c.name===column.name),p=parent.columns.find(c=>c.name===column.parent_name);
        if(!a||!p||childNames.has(column.name)||parentNames.has(column.parent_name)
          ||a.data_type!==column.data_type||a.generated!==column.generated||a.identity!==column.identity
          ||p.data_type!==column.parent_data_type||p.generated!==column.parent_generated||p.identity!==column.parent_identity)fail();
        childNames.add(column.name);parentNames.add(column.parent_name);return Object.freeze(column);
      }));
      constraintOids.add(fk.constraint_oid);dependencies.push(Object.freeze(fk));
    }
    oids.add(row.relation_oid);relations.set(key,Object.freeze({oid:row.relation_oid,dependencies:Object.freeze(dependencies)}));
  }
  // Finish graph validation before any ordinary row is inserted. A selected
  // private parent is staged, not yet inserted; it is NOT an available parent.
  const parents=new Map(),children=new Map(),selfTables=new Set(),edges=[];
  for(const key of originals.keys()){parents.set(key,new Set());children.set(key,new Set());}
  for(const [child,row] of relations)for(const fk of row.dependencies){
    const parent=identity(fk.parent_schema_name,fk.parent_table_name),parentRow=relations.get(parent);
    if(!parentRow||parentRow.oid!==fk.parent_relation_oid
      ||originals.get(child).schema_name==='custodial_release_identity'||fk.parent_schema_name==='custodial_release_identity')fail();
    // Exact authenticated zero rows need no INSERT ordering, not weaker
    // catalog/parent validation. Keep the table for normal EOF/count checks.
    if(originals.get(child).row_count==='0')continue;
    if(parent===child){
      const table=originals.get(child);
      if(!['public','auth','storage','custodial_employment','custodial_coverall','custodial_leadership_private'].includes(table.schema_name)
        ||table.schema_name==='public'&&table.table_name==='release_deployment_manifest')fail();
      selfTables.add(child);continue; // Only the fixed staged single-statement path below.
    }
    parents.get(child).add(parent);children.get(parent).add(child);edges.push({child,parent,fk});
  }
  // Only structurally cyclic cross-table edges need extra Source reads. Keep
  // every edge unless ALL authenticated originals prove its FK inactive.
  const reaches=(start,end)=>{
    const pending=[start],visited=new Set();
    while(pending.length){const key=pending.pop();if(key===end)return true;
      if(!visited.has(key)){visited.add(key);pending.push(...parents.get(key));}}
    return false;
  };
  const candidates=new Map(),inactive=new Set();
  for(const {child,parent,fk} of edges)if(reaches(parent,child)){
    if(!candidates.has(child))candidates.set(child,[]);candidates.get(child).push(fk);
  }
  for(const [child,fks] of candidates){
    const observed=await inactiveOriginalForeignKeys(verifiedArchive,original,originals.get(child),fks,sql,assertContext);
    sameSource(verifiedArchive,original);for(const oid of observed)inactive.add(oid);
  }
  for(const key of originals.keys()){parents.set(key,new Set());children.set(key,new Set());}
  for(const {child,parent,fk} of edges)if(!inactive.has(fk.constraint_oid)){
    parents.get(child).add(parent);children.get(parent).add(child);
  }
  await assertContext();sameSource(verifiedArchive,original);
  const ready=[...parents.keys()].filter(key=>parents.get(key).size===0).sort(),ordered=[];
  while(ready.length){
    const key=ready.shift();ordered.push(originals.get(key));
    for(const child of children.get(key)){parents.get(child).delete(key);if(parents.get(child).size===0){ready.push(child);ready.sort();}}
  }
  // Active cross-table cycles remain unsupported, including deferrable cycles.
  // Never SET CONSTRAINTS, sort row IDs or silently omit a selected table.
  if(ordered.length!==selected.length)fail();
  // Reuse the existing EOF-gated staged consumer only when batching cannot
  // change noninternal INSERT-trigger business effects. Self-FK routing is
  // unchanged. Fixed bootstrap metadata is always consumed without DATA SQL.
  const setTables=new Set(),setCandidates=ordered.filter(table=>
    ['public','auth','storage'].includes(table.schema_name)&&BigInt(table.row_count)>1n
    &&!selfTables.has(identity(table.schema_name,table.table_name))
    &&!(table.schema_name==='public'&&['release_deployment_manifest','custodial_release_authority_restore_inventory'].includes(table.table_name)));
  if(setCandidates.length){
    sameSource(verifiedArchive,original);await assertContext();sameSource(verifiedArchive,original);
    const profiles=await sql(`select s.schema_name,s.table_name,c.oid::text as relation_oid,
      pg_catalog.to_regprocedure('custodial_dr.guard_application_mutation()')::oid::text as guard_oid,
      case when c.oid is null or c.relhasrules then null else coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'oid',t.oid::text,'name',t.tgname::text,'function_oid',t.tgfoid::text,'type',t.tgtype::integer,
        'enabled',t.tgenabled::text,'internal',t.tgisinternal,'argument_count',t.tgnargs::integer,
        'arguments_hex',pg_catalog.encode(t.tgargs,'hex'),'when_expression',t.tgqual::text,'columns',t.tgattr::text,
        'constraint_oid',t.tgconstraint::text,'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred,
        'parent_oid',t.tgparentid::text,'old_table',t.tgoldtable,'new_table',t.tgnewtable) order by t.oid)
        from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal and (t.tgtype & 4)<>0),'[]'::jsonb) end as insert_triggers
      from pg_catalog.jsonb_to_recordset($1::jsonb) as s(schema_name text,table_name text)
      left join pg_catalog.pg_namespace n on n.nspname=s.schema_name
      left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=s.table_name
      order by s.schema_name,s.table_name`,[JSON.stringify(setCandidates.map(({schema_name,table_name})=>({schema_name,table_name})))]);
    sameSource(verifiedArchive,original);await assertContext();sameSource(verifiedArchive,original);
    if(!profiles||!Array.isArray(profiles.rows)||types.isProxy(profiles.rows)
      ||profiles.rowCount!==setCandidates.length||profiles.rows.length!==setCandidates.length)fail();
    const wanted=new Set(setCandidates.map(table=>identity(table.schema_name,table.table_name))),seen=new Set();
    const profileOid=value=>typeof value==='string'&&/^[1-9][0-9]{0,9}(?![\s\S])/.test(value)&&BigInt(value)<=4294967295n;
    let guardOid,guardSeen=false;
    for(const value of profiles.rows){
      const row=closed(value,['schema_name','table_name','relation_oid','guard_oid','insert_triggers']);
      const key=identity(row.schema_name,row.table_name);
      if(!wanted.has(key)||seen.has(key)||row.relation_oid!==relations.get(key).oid)fail();
      seen.add(key);
      if(!guardSeen){guardOid=row.guard_oid;guardSeen=true;}
      else if(guardOid!==row.guard_oid)fail();
      // Unknown/absent profiles (including rewrite rules) retain DIRECT;
      // never turn catalog DATA into caller-controlled batching permission.
      if(!profileOid(row.guard_oid)||!Array.isArray(row.insert_triggers)||types.isProxy(row.insert_triggers)
        ||Object.getPrototypeOf(row.insert_triggers)!==Array.prototype
        ||Reflect.ownKeys(row.insert_triggers).length!==row.insert_triggers.length+1||row.insert_triggers.length>1)continue;
      let safe=true;
      if(row.insert_triggers.length){
        try{
          const field=Object.getOwnPropertyDescriptor(row.insert_triggers,'0');
          if(!field||!Object.hasOwn(field,'value')){safe=false;}else{
            const trigger=closed(field.value,['oid','name','function_oid','type','enabled','internal','argument_count',
              'arguments_hex','when_expression','columns','constraint_oid','deferrable','initially_deferred','parent_oid','old_table','new_table']);
            safe=profileOid(trigger.oid)&&trigger.name==='custodial_disaster_restore_mutation_fence'
              &&trigger.function_oid===row.guard_oid&&trigger.type===62&&trigger.enabled==='O'&&trigger.internal===false
              &&trigger.argument_count===0&&trigger.arguments_hex===''&&trigger.when_expression===null&&trigger.columns===''
              &&trigger.constraint_oid==='0'&&trigger.deferrable===false&&trigger.initially_deferred===false
              &&trigger.parent_oid==='0'&&trigger.old_table===null&&trigger.new_table===null;
          }
        }catch{safe=false;}
      }
      if(safe)setTables.add(key);
    }
  }
  return Object.freeze(ordered.filter(table=>table.schema_name!=='custodial_release_identity').map(table=>{
    const key=identity(table.schema_name,table.table_name);
    if(!selfTables.has(key)&&!setTables.has(key))return table;
    const selected=Object.freeze({schema_name:table.schema_name,table_name:table.table_name});
    selfOrdinaryConsumers.set(selected,Object.freeze({verifiedArchive,original,table}));return selected;
  }));
}

// Internal DATA consumer, not a target admission or alternate client port.
// The only shipping caller supplies its original pg.Client/context below.
async function consumeVerifiedOrdinaryTable(verifiedArchive,original,selected,mutate,assertContext) {
  const staged=selfOrdinaryConsumers.get(selected);
  if(staged){
    selfOrdinaryConsumers.delete(selected); // Includes failed/ambiguous consumption; no retry.
    if(staged.verifiedArchive!==verifiedArchive||staged.original!==original)fail();
    selected=staged.table;
  }
  sameSource(verifiedArchive,original);
  if(!original.selection.databaseTables.includes(selected)||selected.schema_name==='custodial_release_identity')fail();
  const data=openVerifiedRestoreTableData(verifiedArchive,selected.schema_name,selected.table_name);
  let guard,input,batchInput,settled,count=0,firstFailure,sourceOnlyEmpty=false;
  try {
    if(!isDeepStrictEqual(data.table,selected))fail();
    const table=data.table;
    const declaredRows=BigInt(table.row_count); // Exact canonical count from the verified original selection above.
    const columns=table.columns.filter(column=>!column.generated).map(column=>column.name);
    // Fixed current-target SOURCE metadata, initialized/pinned independently
    // by the owning SQL context. Still consume every signed original byte;
    // archived metadata is DATA, never permission to replace target authority.
    const bootstrap=table.schema_name==='public'&&(table.table_name==='release_deployment_manifest'
      ||table.table_name==='custodial_release_authority_restore_inventory');
    sourceOnlyEmpty=!bootstrap&&declaredRows===0n;
    if(sourceOnlyEmpty&&staged)fail(); // An empty original never stages or inserts a set.
    if(!bootstrap&&!columns.length&&table.row_count!=='0')fail();
    guard=createRestoreRowUtf8Guard();
    if(bootstrap){
      batchInput=createRestoreRowLineBatchDecoder();input=batchInput;
      settled=pipeline(data.stream,guard,batchInput);settled.catch(()=>{});
    }else{
      settled=pipeline(data.stream,guard);settled.catch(()=>{});
      input=createInterface({input:guard,crlfDelay:Infinity});
    }
    // Fixed metadata is verified source DATA only: no per-row SQL effect or
    // admission occurs. Bind context before reading and again after complete
    // authenticated EOF. Do not recompute the entire target/registry twice
    // per metadata row; a changed context still refuses before consumption
    // returns. Ordinary and staged mutation fences remain per-row below.
    if(bootstrap){await assertContext();sameSource(verifiedArchive,original);}
    // The fixed owner-context entry owns generated/identity projection and
    // exact typed readback; no dynamic DML or caller SQL selector here.
    sameSource(verifiedArchive,original);
    if(bootstrap){
      // Only the fixed no-effect metadata tables use batch yields. Each
      // actual yield is source-checked; decoding/counting within a batch is
      // synchronous and neither grants permission nor executes target SQL.
      for await(const batch of input){
        sameSource(verifiedArchive,original);
        if(types.isProxy(batch)||!Array.isArray(batch)||!Object.isFrozen(batch))fail();
        for(const line of batch){
          if(declaredRows===0n)fail();
          decodeRestoreTableRowLine(line,table);
          if(BigInt(count)>=declaredRows)fail();
          count++;
        }
        sameSource(verifiedArchive,original);
      }
    }else{
    for await(const line of input){
      sameSource(verifiedArchive,original);
      if(declaredRows===0n)fail(); // Even one line refuses BEFORE decoding or any row SQL.
      const raw=decodeRestoreTableRowLine(line,table);
      if(BigInt(count)>=declaredRows)fail(); // Refuse BEFORE any excess row reaches the fixed INSERT.
      if(!bootstrap){
        if(staged)await mutate('select custodial_dr.stage_immutable_ordinary_row($1::text,$2::text,$3::text,$4::jsonb) as context',[table.schema_name,table.table_name,raw]);
        else await mutate('select custodial_dr.insert_immutable_ordinary_row($1::text,$2::text,$3::text,$4::jsonb) as context',[table.schema_name,table.table_name,raw]);
        sameSource(verifiedArchive,original);
      }
      count++;
    }
    }
    sameSource(verifiedArchive,original);await settled;sameSource(verifiedArchive,original);
    const eof=await data.verified;sameSource(verifiedArchive,original);
    // verified is the authenticated reader's private consumed-byte SHA/EOF,
    // not a public checksum projection or a caller zero-count assertion.
    if(eof.data_file!==table.data_file||!Number.isSafeInteger(eof.bytes)||eof.bytes<0
      ||typeof eof.sha256!=='string'||!/^[a-f0-9]{64}$/.test(eof.sha256)||String(count)!==table.row_count)fail();
    // A verified empty ordinary original has no target effect or admission.
    // Its source lifetime remains live through EOF/close; the shared original
    // witness is checked after ALL ordinary EOFs, before guarded finish.
    if(!sourceOnlyEmpty){await assertContext();sameSource(verifiedArchive,original);}
    if(staged&&!bootstrap){
      // Complete authenticated original EOF/digest/count and current context
      // precede the ONE table INSERT. A lost result is UNKNOWN, never replayed.
      await mutate('select custodial_dr.insert_staged_immutable_ordinary_table($1::text,$2::text,$3::jsonb) as context',[table.schema_name,table.table_name]);
      sameSource(verifiedArchive,original);
    }
    return count;
  }catch(error){firstFailure=error;throw error;}
  finally{if(batchInput)batchInput.destroy();else if(input)input.close();data.stream.destroy();guard?.destroy();
    if(sourceOnlyEmpty||batchInput){
      // Lost source custody refuses success, but MUST NOT skip either cleanup
      // await. Preserve the primary refusal and any literal close failures.
      const cleanupFailures=[];
      try{sameSource(verifiedArchive,original);}catch(error){cleanupFailures.push(error);}
      if(settled)await settled.catch(()=>{});
      try{sameSource(verifiedArchive,original);}catch(error){cleanupFailures.push(error);}
      try{await data.close();}catch(error){cleanupFailures.push(error);}
      try{sameSource(verifiedArchive,original);}catch(error){cleanupFailures.push(error);}
      if(cleanupFailures.length){
        if(firstFailure)throw new AggregateError([firstFailure,...cleanupFailures],'Mixed original source cleanup failed',{cause:firstFailure});
        if(cleanupFailures.length===1)throw cleanupFailures[0];
        throw new AggregateError(cleanupFailures,'Mixed original source cleanup failed');
      }
    }else{
      if(settled)await settled.catch(()=>{});
      try{await data.close();}catch(cleanup){if(firstFailure)throw new AggregateError([firstFailure,cleanup],'Mixed original source cleanup failed',{cause:firstFailure});throw cleanup;}
      if(!firstFailure)sameSource(verifiedArchive,original);
    }}
}

// Shipping fresh-target composition, not an alternate importer or a recovery
// authority factory. Authenticate the original intent BEFORE initializer DDL;
// all effects stay in the caller's original exclusive transaction. The normal
// CLI's pre-connect private APPLY hold remains until that route is qualified.
export async function stageVerifiedImmutableFreshData(options) {
  const {db,verifiedArchive,originalIntentEnvelope,intentVerifyKey,intentVerifyKeyId}=closed(options,
    ['db','verifiedArchive','originalIntentEnvelope','intentVerifyKey','intentVerifyKeyId']);
  const native=()=>{
    if(!db||types.isProxy(db)||Object.getPrototypeOf(db)!==Client.prototype
      ||Object.hasOwn(db,'query')||Client.prototype.query!==query)fail();
  };
  native();
  const originalNativePort=captureFreshNativePort(db);
  if(nativeData(db,'_txStatus')!=='T')fail();
  if(!verifiedArchive||typeof verifiedArchive!=='object'||types.isProxy(verifiedArchive)
    ||freshClients.has(db)||freshArchives.has(verifiedArchive))fail();
  freshClients.add(db);freshArchives.add(verifiedArchive);
  let original,freshIntent;
  try{
    original=readVerifiedPrivateImportSource(verifiedArchive);
    freshIntent=captureVerifiedImmutableFreshRestoreIntent({verifiedArchive,originalIntentEnvelope,intentVerifyKey,intentVerifyKeyId});
  }catch(error){fail(error);}
  // Carry the importer's supported private-table/encoding boundary BEFORE
  // any new initializer DDL, not merely before the later DATA staging call.
  if(!isDeepStrictEqual(original.selection.privateTables.map(table=>table.table_name).sort(),identities)
    ||original.privateDataMembers.length!==identities.length
    ||original.privateDataMembers.some(member=>![postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding].includes(member.data_encoding)))fail();
  const expectedPrivateRows=original.privateDataMembers.reduce((total,member)=>total+BigInt(member.row_count),0n).toString();
  const current=()=>{
    native();sameFreshNativePort(db,originalNativePort);sameSource(verifiedArchive,original);
    const captured=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
    if(captured.sourceBinding!==original.sourceBinding)fail();
    return captured;
  };
  current();
  await requireLegacyOriginalDataFidelity(verifiedArchive,original,current);
  current();
  if(original.selection.databaseTables.some(table=>table.data_encoding!==postgresTextColumnsLineEncoding))
    try{assertVerifiedLegacyRestoreDataCurrent(verifiedArchive);}catch(error){fail(error,'IMMUTABLE_LEGACY_DATA_FIDELITY_UNPROVEN');}
  const initialized=await initializeVerifiedImmutableFreshSource({db,verifiedArchive});
  current();
  if(initialized.schema!=='custodial.immutable-private-source-initialized.v1'
    ||initialized.initialized_source_only!==true||initialized.transaction_authority!==false
    ||initialized.restore_complete!==false||initialized.admission_resumed!==false
    ||initialized.guard_recipes!==25||initialized.source_statements!==13||initialized.authority_scope_functions!==6)fail();
  const prepared=await prepareVerifiedImmutableFreshRestoreControl({db,verifiedArchive,freshIntent});
  const captured=current(),intent=captured.intent;
  const expected=Object.freeze({database_oid:initialized.database_oid,backend_pid:initialized.backend_pid,
    transaction_id:initialized.transaction_id,restore_id:intent.restore_id,
    authority_generation:String(intent.authority_generation),archive_digest:original.sourceBinding.archive_digest});
  if(!isDeepStrictEqual(closed(prepared,witnessKeys),expected))fail();
  // Save the first target state under this SAME authenticated original and
  // native transaction before archive DATA can replace ordinary authority.
  // These protected rows are reconciliation DATA, never effect admission.
  await capturePreRestoreState(db,{restoreId:intent.restore_id,generation:intent.authority_generation});
  current();
  // Never recapture caller objects after the initializer/control awaits. The
  // private intent token supplies the same detached signed original envelope.
  const imported=await stageVerifiedImmutablePrivateData({db,verifiedArchive,
    originalIntentEnvelope:captured.envelope,intentVerifyKey,intentVerifyKeyId});
  current();
  const staged=closed(imported,[...witnessKeys,'private_rows','transaction_authority','admission_resumed']);
  for(const key of witnessKeys)if(!isDeepStrictEqual(staged[key],expected[key]))fail();
  if(staged.private_rows!==expectedPrivateRows||staged.transaction_authority!==false||staged.admission_resumed!==false)fail();
  // Private live state comes ONLY from the actual successful original stage.
  // The returned DATA (or a JSON copy of it) never creates commit authority.
  const request=Object.freeze({restoreId:intent.restore_id,generation:String(intent.authority_generation),
    archiveDigest:original.sourceBinding.archive_digest,targetProjectRef:intent.target_project_ref});
  freshStaged.set(db,{verifiedArchive,freshIntent,original,request,originalNativePort,
    imported:Object.freeze({...staged}),phase:'STAGED'});
  return Object.freeze({schema:'custodial.immutable-private-fresh-data-staged.v1',...expected,
    private_rows:staged.private_rows,source_initialized:true,transaction_authority:false,
    restore_complete:false,admission_resumed:false});
}

// One original fresh DATA transaction decision. The caller still owns its
// connection/cleanup and rollback on a pre-COMMIT failure. No BEGIN, reconnect,
// replay, automatic reconciliation or service resumption occurs here.
export async function commitVerifiedImmutableFreshData(options){
  const {db,verifiedArchive}=closed(options,['db','verifiedArchive']);
  const native=()=>{
    if(!db||types.isProxy(db)||Object.getPrototypeOf(db)!==Client.prototype
      ||Object.hasOwn(db,'query')||Client.prototype.query!==query)fail();
  };
  const state=freshStaged.get(db);
  if(!state||state.verifiedArchive!==verifiedArchive||state.phase!=='STAGED')fail();
  state.phase='COMMITTING'; // Consume before the first await; never retry.
  let commitAttempted=false;
  const request=state.request; // Original readonly request survives expiry/withdrawal.
  const current=()=>{
    native();sameFreshNativePort(db,state.originalNativePort);sameSource(verifiedArchive,state.original);
    const captured=readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive);
    if(captured.sourceBinding!==state.original.sourceBinding)fail();return captured;
  };
  try{
    current();
    await recordVerifiedImmutableFreshDatabaseEvidence({db,verifiedArchive,freshIntent:state.freshIntent});
    current();
    const recorded=await readVerifiedImmutableFreshCommitRecord({db,verifiedArchive,freshIntent:state.freshIntent});
    current();
    if(!isDeepStrictEqual(closed(recorded,[...witnessKeys,'private_rows','transaction_authority','admission_resumed']),state.imported))fail();
    commitAttempted=true;
    const result=await Reflect.apply(query,db,['COMMIT']);
    // In an aborted transaction PostgreSQL may answer ROLLBACK to COMMIT.
    // Only the original native COMMIT tag acknowledges this decision.
    if(!result||typeof result!=='object'||types.isProxy(result))fail();
    const properties=Object.getOwnPropertyDescriptors(result);
    if(!properties.command||!Object.hasOwn(properties.command,'value')||properties.command.value!=='COMMIT'
      ||!properties.rowCount||!Object.hasOwn(properties.rowCount,'value')||properties.rowCount.value!==null
      ||!properties.rows||!Object.hasOwn(properties.rows,'value')
      ||types.isProxy(properties.rows.value)||!Array.isArray(properties.rows.value)
      ||Object.getPrototypeOf(properties.rows.value)!==Array.prototype
      ||Reflect.ownKeys(properties.rows.value).length!==1||properties.rows.value.length!==0)fail();
    current(); // Source/intent withdrawal during the await remains UNKNOWN.
    state.phase='COMMIT_ACKNOWLEDGED';
    return Object.freeze({schema:'custodial.immutable-private-fresh-database-commit.v1',requested_original:request,
      commit_status:'ACKNOWLEDGED',database_phase_recorded:true,complete_restore:false,
      retry_allowed:false,rerun_import_allowed:false,resume_allowed:false});
  }catch{
    state.phase=commitAttempted?'COMMIT_OUTCOME_UNKNOWN':'COMMIT_NOT_ADMITTED';
    // A later ROLLBACK reply cannot undo or resolve an earlier lost COMMIT.
    // Recovery uses the exact requested original with the fixed readonly reader,
    // not a public stage receipt, new generation, new import or resend.
    throw Object.assign(new Error(commitAttempted?'IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN':'IMMUTABLE_PRIVATE_DATA_COMMIT_NOT_ADMITTED'),{
      code:commitAttempted?'IMMUTABLE_PRIVATE_DATA_COMMIT_OUTCOME_UNKNOWN':'IMMUTABLE_PRIVATE_DATA_COMMIT_NOT_ADMITTED',
      outcome:'UNKNOWN',retry_safe:false,commit_attempted:commitAttempted,...(request?{requested_original:request}:{})});
  }
}

// Read back committed original DATA in a NEW caller-owned snapshot. The
// public COMMIT reply, fixed status metadata and a copied finished witness
// cannot enter this path: only this module's actual acknowledged native
// decision retains the private archive/intent/old-transaction ancestry.
// This API performs no BEGIN/COMMIT/DDL/DML and grants no later effect.
export async function inspectCommittedImmutableFreshData(options) {
  const {db,verifiedArchive}=closed(options,['db','verifiedArchive']);
  const state=freshStaged.get(db);
  let readPhase='PRIVATE_ORIGINAL_ADMISSION';
  const disposition={private_state:'NOT_RUN',ordinary_state:'NOT_RUN',storage_status:'NOT_RUN',unresolved_table_ids:[]};
  const unavailable=cause=>{
    const failure=Object.assign(new Error('IMMUTABLE_FRESH_POST_DATABASE_READ_UNAVAILABLE'),{
    code:'IMMUTABLE_FRESH_POST_DATABASE_READ_UNAVAILABLE',outcome:'UNKNOWN',retry_safe:false,
    commit_status:state?.phase==='COMMIT_ACKNOWLEDGED'?'ACKNOWLEDGED':'NOT_ESTABLISHED',
    read_phase:readPhase,complete_restore:false,resume_allowed:false,rerun_import_allowed:false});
    failure.data_readback_disposition=Object.freeze({...disposition,
      unresolved_table_ids:Object.freeze(disposition.unresolved_table_ids.slice())});
    if(cause&&typeof cause==='object'&&!types.isProxy(cause)){
      privateFailures.set(failure,cause); // Private only: never raw SQL/DATA.
      for(const key of ['sql_state','code']){
        const field=Object.getOwnPropertyDescriptor(cause,key);
        if(field&&Object.hasOwn(field,'value')&&typeof field.value==='string'&&/^[0-9A-Z]{5}$/.test(field.value)){
          failure.sql_state=field.value;break;
        }
      }
      const step=Object.getOwnPropertyDescriptor(cause,'check_phase');
      if(step&&Object.hasOwn(step,'value')&&['INPUT','NATIVE_FENCE','ORIGINAL_CONTEXT','SOURCE_EPOCH',
        'CURRENT_CONTROL','DATABASE_MARKERS','FINAL_FENCE'].includes(step.value))failure.reader_check_phase=step.value;
      const storageStep=Object.getOwnPropertyDescriptor(cause,'storage_check_phase');
      if(storageStep&&Object.hasOwn(storageStep,'value')&&['INPUT','NATIVE_PORT','SOURCE','CONTEXT','CATALOG',
        'ORIGINAL_DATA','COMPARE','FINAL_CONTEXT','RESULT'].includes(storageStep.value))failure.storage_check_phase=storageStep.value;
      const contextCheck=Object.getOwnPropertyDescriptor(cause,'storage_context_check');
      if(contextCheck&&Object.hasOwn(contextCheck,'value')&&['TEXT_FIELDS','READ_ONLY','ISOLATION','REPLICATION',
        'FIRST_SCHEMA','FLOAT_DIGITS','DATABASE_OID','BACKEND_PID','TRANSACTION_ID','SNAPSHOT','PRINCIPAL',
        'SAME_CONTEXT'].includes(contextCheck.value))failure.storage_context_check=contextCheck.value;
    }
    throw failure;
  };
  if(!state||state.verifiedArchive!==verifiedArchive||state.phase!=='COMMIT_ACKNOWLEDGED'
    ||state.inspectionInFlight===true||freshAuthorityAttempts.has(state))unavailable();
  const current=()=>{
    if(!db||types.isProxy(db)||Object.getPrototypeOf(db)!==Client.prototype
      ||Object.hasOwn(db,'query')||Client.prototype.query!==query
      ||freshStaged.get(db)!==state||state.phase!=='COMMIT_ACKNOWLEDGED')unavailable();
    sameFreshNativePort(db,state.originalNativePort);sameSource(verifiedArchive,state.original);
    if(readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive).sourceBinding!==state.original.sourceBinding)unavailable();
  };
  state.originalDataReadback=null;
  state.inspectionInFlight=true;
  try {
    readPhase='SOURCE_CURRENTNESS';
    current();
    const {readVerifiedImmutableFreshPostDatabaseContext}=await import('./immutable-private-fresh-restore-commit-context.mjs');
    current();
    const context=async()=>{
      current();
      const value=await readVerifiedImmutableFreshPostDatabaseContext({db,verifiedArchive,
        freshIntent:state.freshIntent,finished:state.imported});
      current();
      const observed=closed(value,[...witnessKeys,'original_transaction_id','private_rows','transaction_authority','admission_resumed']);
      for(const key of witnessKeys.filter(key=>key!=='transaction_id')){
        if(!isDeepStrictEqual(observed[key],state.imported[key]))unavailable();
      }
      if(observed.original_transaction_id!==state.imported.transaction_id
        ||observed.transaction_id===observed.original_transaction_id
        ||typeof observed.transaction_id!=='string'||!/^[1-9][0-9]{0,18}(?![\s\S])/.test(observed.transaction_id)
        ||BigInt(observed.transaction_id)>9223372036854775807n
        ||observed.private_rows!==state.imported.private_rows
        ||observed.transaction_authority!==false||observed.admission_resumed!==false)unavailable();
      return Object.freeze(observed);
    };
    readPhase='INITIAL_CONTEXT';
    const before=await context();
    let originalTextHelpers;
    const textHelpersCurrent=async()=>{
      current();const first=await context();current();
      if(!isDeepStrictEqual(first,before))unavailable();
      const reply=await Reflect.apply(query,db,[immutableTextHelperSourceSql]);current();
      const last=await context();current();
      if(!isDeepStrictEqual(last,before))unavailable();
      const values=nativeData(reply,'rows');
      if(nativeData(reply,'command')!=='SELECT'||nativeData(reply,'rowCount')!==nativeData(values,'length'))unavailable();
      originalTextHelpers=immutableTextHelperSource(values,originalTextHelpers);
    };
    // Only this privately admitted SAME original's genuine signed table tags
    // choose the pure DATA profile. V1-only workflows have no new query.
    const hasTextColumns=state.original.selection.databaseTables.some(table=>table.data_encoding===postgresTextColumnsLineEncoding);
    if(hasTextColumns){readPhase='TEXT_HELPER_SOURCE';await textHelpersCurrent();current();}
    // This function is appended by the separately owned private-ledger
    // comparison lane. No alternate callback, expected rows or public fixture
    // port is accepted by this live original owner.
    readPhase='PRIVATE_DATA';
    const privateData=await compareVerifiedImmutablePrivateTableData({db,verifiedArchive});
    current();
    const privateResult=closed(privateData,['state','tables']);
    if(!['MATCH','DIFFERENT','UNSUPPORTED'].includes(privateResult.state))unavailable();
    disposition.private_state=privateResult.state;
    if(privateResult.state!=='MATCH'){
      disposition.unresolved_table_ids=privateResult.tables.filter(table=>table.state!=='MATCH')
        .map(table=>`${table.schema_name}.${table.table_name}`);
      unavailable(); // Never query another reader in a possibly aborted transaction.
    }
    readPhase='ORDINARY_DATA';
    const ordinaryData=await compareVerifiedImmutableOrdinaryTableData({db,verifiedArchive});
    current();
    const ordinaryResult=closed(ordinaryData,['state','tables']);
    if(!['MATCH','DIFFERENT','UNSUPPORTED','CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK','SOURCE_TRANSFORMATION_VERIFIED'].includes(ordinaryResult.state))unavailable();
    disposition.ordinary_state=ordinaryResult.state;
    if(!['MATCH','CURRENT_TARGET_SOURCE_REQUIRES_OWNER_CHECK','SOURCE_TRANSFORMATION_VERIFIED'].includes(ordinaryResult.state)){
      disposition.unresolved_table_ids=ordinaryResult.tables.filter(table=>['UNSUPPORTED','DIFFERENT'].includes(table.state))
        .map(table=>`${table.schema_name}.${table.table_name}`);
      unavailable();
    }
    const {compareVerifiedStorageTableData}=await import('./disaster-recovery-storage.mjs');
    current();
    readPhase='STORAGE_DATA';
    const storageData=await compareVerifiedStorageTableData({db,verifiedArchive});
    readPhase='STORAGE_RESULT';
    current();
    const storageResult=closed(storageData,['sourceBinding','status','tables']);
    if(storageResult.sourceBinding!==state.original.sourceBinding
      ||!['MATCH','DIFFERENT','UNSUPPORTED','NOT_APPLICABLE_ORIGINAL_NO_MEMBERS'].includes(storageResult.status))unavailable();
    disposition.storage_status=storageResult.status;
    if(!['MATCH','NOT_APPLICABLE_ORIGINAL_NO_MEMBERS'].includes(storageResult.status)){
      disposition.unresolved_table_ids=storageResult.tables.filter(table=>table.status!=='MATCH')
        .map(table=>`${table.schema_name}.${table.table_name}`);
      unavailable();
    }
    readPhase='FINAL_CONTEXT';
    const after=await context();
    if(!isDeepStrictEqual(after,before))unavailable();
    if(hasTextColumns){readPhase='TEXT_HELPER_SOURCE';await textHelpersCurrent();current();}
    readPhase='RESULT';
    // Only this completed actual native/Source/EOF workflow creates the
    // private readback ancestry. Its returned DATA cannot recreate it.
    current();
    state.originalDataReadback=Object.freeze({original:state.original,freshIntent:state.freshIntent,
      imported:state.imported,port:state.originalNativePort,context:before});
    return Object.freeze({requested_original:state.request,current_context:before,
      private_data:privateData,ordinary_data:ordinaryData,
      storage_data:Object.freeze({status:storageResult.status,tables:storageResult.tables}),
      commit_status:'ACKNOWLEDGED',comparison_only:true,complete_restore:false,
      resume_allowed:false,retry_allowed:false,rerun_import_allowed:false});
  } catch (error) {
    // The earlier acknowledged native decision is NOT made unknown by a
    // failed READ. Retain its original private state and all paused DATA.
    unavailable(error);
  } finally {state.inspectionInFlight=false;}
}

// Stage and finish ONLY inside the caller's already-owned DATA transaction.
// No BEGIN/COMMIT, grant, pause/renew/resume, SQL selector or client fallback.
// Normal production caller remains BLOCKED until Main qualifies/admits the
// exact owner context AND its supported full-archive import path.
export async function stageVerifiedImmutablePrivateData(options) {
  const {db,verifiedArchive,originalIntentEnvelope,intentVerifyKey,intentVerifyKeyId}=closed(options,
    ['db','verifiedArchive','originalIntentEnvelope','intentVerifyKey','intentVerifyKeyId']);
  if(!db||types.isProxy(db)||Object.getPrototypeOf(db)!==Client.prototype||Object.hasOwn(db,'query'))fail();
  if(!verifiedArchive||typeof verifiedArchive!=='object'||types.isProxy(verifiedArchive)||attempted.has(verifiedArchive))fail();
  attempted.add(verifiedArchive); // Includes unavailable/context/lost-result refusal; NEVER blind retry.
  let original;try{original=readVerifiedPrivateImportSource(verifiedArchive);}catch(error){fail(error);}
  // Capture DATA first and verify those SAME detached bytes. The actual
  // producer's five-field envelope includes algorithm; no second caller read
  // can replace actor/target/expiry between verification and consumption.
  let intent;try{intent=captureVerifiedOriginalRestoreIntent(originalIntentEnvelope,intentVerifyKey,intentVerifyKeyId);}catch(error){fail(error);}
  const binding=original.sourceBinding;
  if(intent.archive_digest!==binding.archive_digest||intent.source_project_ref!==binding.project_ref
    ||intent.target_project_ref!==binding.project_ref||intent.source_identity_sha256!==binding.source_identity_sha256
    ||!Number.isSafeInteger(intent.authority_generation)||intent.authority_generation<1
    ||typeof intent.actor!=='string'||!intent.actor.trim()
    ||!Number.isFinite(Date.parse(intent.expires_at))||Date.parse(intent.expires_at)<=Date.now()
    ||Date.parse(intent.expires_at)>Date.now()+24*60*60*1000)fail();
  const privateNames=original.selection.privateTables.map(table=>table.table_name).sort();
  if(!isDeepStrictEqual(privateNames,identities)||original.privateDataMembers.some(member=>![postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding].includes(member.data_encoding)))fail();
  const preflightPort=captureFreshNativePort(db);
  const preflightCurrent=()=>{
    sameFreshNativePort(db,preflightPort);sameSource(verifiedArchive,original);
    if(Date.parse(intent.expires_at)<=Date.now())fail();
  };
  preflightCurrent();
  await requireLegacyOriginalDataFidelity(verifiedArchive,original,preflightCurrent);
  preflightCurrent();
  if(original.selection.databaseTables.some(table=>table.data_encoding!==postgresTextColumnsLineEncoding))
    try{assertVerifiedLegacyRestoreDataCurrent(verifiedArchive);}catch(error){fail(error,'IMMUTABLE_LEGACY_DATA_FIDELITY_UNPROVEN');}
  // SOURCE counts do not establish target freshness. The owner-context entry
  // must lock/check the actual target and refuse unsupported INSERT guards.
  const manifest=Object.freeze({schema:'custodial.immutable-private-import-manifest.v1',archive_digest:binding.archive_digest,
    source_identity_sha256:binding.source_identity_sha256,source_project_ref:binding.project_ref,target_project_ref:intent.target_project_ref,
    actor:intent.actor,expires_at:intent.expires_at,target_migration_head:intent.target_migration_head,
    target_release_identity:intent.target_release_identity,catalog:original.selection.databaseTables,private_data_members:original.privateDataMembers});
  async function sql(text,args=[]) {
    sameSource(verifiedArchive,original);
    let result;try{result=await Reflect.apply(query,db,[text,args]);}catch(error){fail(error);}
    sameSource(verifiedArchive,original);return result;
  }
  const initial=await sql('select custodial_dr.begin_immutable_private_import($1::uuid,$2::bigint,$3::text,$4::jsonb) as context',
    [intent.restore_id,String(intent.authority_generation),binding.archive_digest,JSON.stringify(manifest)]);
  const witness=Object.freeze(contextWitness(initial));
  if(witness.restore_id!==intent.restore_id||witness.authority_generation!==String(intent.authority_generation)
    ||witness.archive_digest!==binding.archive_digest)fail();
  async function assertContext(){
    const current=await sql("select jsonb_build_object('database_oid',c.database_oid,'backend_pid',c.backend_pid,'transaction_id',c.transaction_id::text,'restore_id',c.restore_id,'authority_generation',c.authority_generation::text,'archive_digest',c.archive_digest) as context from custodial_dr.immutable_import_assert_context() c");
    if(!isDeepStrictEqual(contextWitness(current),witness))fail();
  }
  // Private closure: only this invocation's frozen original begin witness is
  // serialized. Each fixed SQL command checks it before effects, retains its
  // server post-effect full assertion, and must return the SAME witness.
  async function mutate(text,args) {
    const result=await sql(text,[...args,JSON.stringify(witness)]);
    if(!isDeepStrictEqual(contextWitness(result),witness))fail();
  }
  const ordinaryOrder=await planVerifiedOrdinaryTables(verifiedArchive,original,sql,assertContext);
  let total=0;
  for(const selected of original.selection.privateTables) {
    sameSource(verifiedArchive,original);
    const data=openVerifiedRestoreTableData(verifiedArchive,selected.schema_name,selected.table_name);
    const guard=createRestoreRowUtf8Guard(),settled=pipeline(data.stream,guard);settled.catch(()=>{});
    const input=createInterface({input:guard,crlfDelay:Infinity});let count=0,firstFailure;
    try {
      if(selected.schema_name!=='custodial_release_identity'||!isDeepStrictEqual(data.table,selected))fail();
      const members=original.privateDataMembers.filter(member=>member.schema_name===selected.schema_name&&member.table_name===selected.table_name);
      if(members.length!==1)fail();
      const expected=members[0];
      if(expected.data_file!==selected.data_file||expected.row_count!==selected.row_count||expected.data_encoding!==selected.data_encoding)fail();
      const declaredRows=BigInt(expected.row_count); // Canonical authenticated member count, never caller staging metadata.
      for await(const line of input){sameSource(verifiedArchive,original);const raw=decodeRestoreTableRowLine(line,data.table);
        if(BigInt(count)>=declaredRows)fail(); // Refuse BEFORE excess DATA reaches the fixed staging call.
        await mutate('select custodial_dr.stage_immutable_private_row($1::text,$2::text,$3::text,$4::jsonb) as context',[data.table.schema_name,data.table.table_name,raw]);count++;}
      await settled;sameSource(verifiedArchive,original);
      const eof=await data.verified;sameSource(verifiedArchive,original);
      if(eof.sha256!==expected.sha256||String(eof.bytes)!==expected.bytes||eof.data_file!==expected.data_file||String(count)!==expected.row_count)fail();
      total+=count;
    }catch(error){firstFailure=error;throw error;}
    finally{input.close();data.stream.destroy();guard.destroy();await settled.catch(()=>{});
      try{await data.close();}catch(cleanup){if(firstFailure)throw new AggregateError([firstFailure,cleanup],'Immutable private source cleanup failed',{cause:firstFailure});throw cleanup;}}
  }
  for(const selected of ordinaryOrder)
    await consumeVerifiedOrdinaryTable(verifiedArchive,original,selected,mutate,assertContext);
  // All ORIGINAL EOF/digests/counts precede the only guarded finish/inserts.
  sameSource(verifiedArchive,original);
  await assertContext();sameSource(verifiedArchive,original);
  const finished=await sql('select custodial_dr.finish_immutable_private_import() as result');
  if(finished.rowCount!==1)fail();
  const result=closed(finished.rows[0].result,[...witnessKeys,'private_rows','transaction_authority','admission_resumed']);
  for(const name of witnessKeys)if(!isDeepStrictEqual(result[name],witness[name]))fail();
  if(result.private_rows!==String(total)||result.transaction_authority!==false||result.admission_resumed!==false)fail();
  return Object.freeze(result); // NOT a COMMIT, restart/resend authority or effect receipt.
}

// Prepare DATA only from this module's actual original acknowledged decision.
// No caller receipt/intent/finished value, effect capability or phase upgrade.
export async function prepareCommittedImmutableFreshAuthority(options){
  let db,state,claimed=false;
  const unavailable=cause=>{
    const code='IMMUTABLE_FRESH_AUTHORITY_PREPARATION_UNAVAILABLE';
    const error=Object.assign(new Error(code),{code,outcome:'UNKNOWN',retry_safe:false,
      effect_allowed:false,complete_restore:false,resume_allowed:false,rerun_import_allowed:false});
    if(cause&&typeof cause==='object'&&!types.isProxy(cause)){
      privateFailures.set(error,cause);
      for(const key of ['sql_state','code']){
        const field=Object.getOwnPropertyDescriptor(cause,key);
        if(field&&Object.hasOwn(field,'value')&&typeof field.value==='string'&&/^[0-9A-Z]{5}$/.test(field.value)){
          error.sql_state=field.value;break;
        }
      }
      const step=Object.getOwnPropertyDescriptor(cause,'check_phase');
      if(step&&Object.hasOwn(step,'value')&&['INPUT','NATIVE_FENCE','ORIGINAL_CONTEXT','SOURCE_EPOCH',
        'CURRENT_CONTROL','DATABASE_MARKERS','FINAL_FENCE'].includes(step.value))error.reader_check_phase=step.value;
    }
    throw error;
  };
  try{
    const input=closed(options,['db','verifiedArchive']);db=input.db;
    const verifiedArchive=input.verifiedArchive;
    const native=()=>{
      if(!db||typeof db!=='object'||types.isProxy(db)||Client.prototype!==authorityClientPrototype
        ||Object.getPrototypeOf(db)!==authorityClientPrototype||Object.hasOwn(db,'query')
        ||Client.prototype.query!==query)unavailable();
    };
    native();state=freshStaged.get(db);
    if(!state||state.verifiedArchive!==verifiedArchive||state.phase!=='COMMIT_ACKNOWLEDGED'
      ||state.inspectionInFlight===true||freshAuthorityPreparations.has(db))unavailable();
    const original=state.original,freshIntent=state.freshIntent,imported=state.imported,request=state.request;
    const data=(object,key)=>{
      if(!object||typeof object!=='object'||types.isProxy(object))unavailable();
      const field=Object.getOwnPropertyDescriptor(object,key);
      if(!field||!Object.hasOwn(field,'value'))unavailable();return field.value;
    };
    const connection=data(db,'connection');
    if(!connection||typeof connection!=='object'||types.isProxy(connection)
      ||Object.getPrototypeOf(connection)!==authorityConnectionPrototype||Object.hasOwn(connection,'query')
      ||authorityConnectionPrototype.query!==authorityConnectionQuery)unavailable();
    const stream=data(connection,'stream');
    if(!stream||typeof stream!=='object'||types.isProxy(stream))unavailable();
    const sameConnection=()=>{
      native();
      if(data(db,'connection')!==connection||Object.getPrototypeOf(connection)!==authorityConnectionPrototype
        ||Object.hasOwn(connection,'query')||authorityConnectionPrototype.query!==authorityConnectionQuery
        ||data(connection,'stream')!==stream||data(db,'processID')!==imported.backend_pid
        ||data(db,'_connected')!==true||data(db,'_queryable')!==true
        ||data(db,'_ending')!==false||data(db,'_ended')!==false)unavailable();
    };
    sameConnection();
    sameFreshNativePort(db,state.originalNativePort);
    state.inspectionInFlight=true;freshAuthorityPreparations.add(db);claimed=true;
    const captured=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
    const current=()=>{
      sameConnection();
      if(freshStaged.get(db)!==state||state.phase!=='COMMIT_ACKNOWLEDGED'||state.verifiedArchive!==verifiedArchive
        ||state.original!==original||state.freshIntent!==freshIntent||state.imported!==imported||state.request!==request
        ||state.inspectionInFlight!==true||!freshAuthorityPreparations.has(db))unavailable();
      sameSource(verifiedArchive,original);
      const live=readVerifiedImmutableFreshRestoreIntent(freshIntent,verifiedArchive);
      if(live!==captured||live.sourceBinding!==original.sourceBinding
        ||request.restoreId!==live.intent.restore_id||request.generation!==String(live.intent.authority_generation)
        ||request.archiveDigest!==original.sourceBinding.archive_digest||request.targetProjectRef!==live.intent.target_project_ref)unavailable();
    };
    current();
    const value=await readVerifiedImmutableFreshAuthorityPreparation({db,verifiedArchive,freshIntent,finished:imported});
    current();
    const observed=closed(value,[...witnessKeys,'original_transaction_id','private_rows','transaction_authority','admission_resumed']);
    for(const key of witnessKeys.filter(key=>key!=='transaction_id')){
      if(!isDeepStrictEqual(observed[key],imported[key]))unavailable();
    }
    if(observed.original_transaction_id!==imported.transaction_id
      ||observed.transaction_id===observed.original_transaction_id
      ||typeof observed.transaction_id!=='string'||!/^[1-9][0-9]{0,18}(?![\s\S])/.test(observed.transaction_id)
      ||BigInt(observed.transaction_id)>9223372036854775807n||observed.private_rows!==imported.private_rows
      ||observed.transaction_authority!==false||observed.admission_resumed!==false)unavailable();
    current();
    return Object.freeze({requested_original:request,current_context:Object.freeze(observed),preparation_only:true,
      effect_allowed:false,transaction_authority:false,admission_resumed:false,complete_restore:false,
      resume_allowed:false,retry_allowed:false,rerun_import_allowed:false});
  }catch(error){unavailable(error);}
  finally{if(claimed){freshAuthorityPreparations.delete(db);state.inspectionInFlight=false;}}
}

// Consume only this module's acknowledged original + genuine complete DATA
// readback. This private join opens its own fixed transaction and locks DATA
// BEFORE the first SELECT freezes its snapshot. The caller owns cleanup and
// the separate one-shot COMMIT decision; no supplied
// receipt, witness, callback, SQL selector or reconstructed PID is authority.
export async function reconcileCommittedImmutableFreshAuthority(options){
  const {db,verifiedArchive}=closed(options,['db','verifiedArchive']);
  const state=freshStaged.get(db),readback=state?.originalDataReadback;
  const unavailable=cause=>{
    const error=Object.assign(new Error('IMMUTABLE_FRESH_AUTHORITY_OUTCOME_UNKNOWN'),{
      code:'IMMUTABLE_FRESH_AUTHORITY_OUTCOME_UNKNOWN',outcome:'UNKNOWN',retry_safe:false,
      retry_allowed:false,rerun_import_allowed:false,resume_allowed:false,complete_restore:false});
    if(cause&&typeof cause==='object'&&!types.isProxy(cause)){
      privateFailures.set(error,cause);
      const code=Object.getOwnPropertyDescriptor(cause,'code');
      if(code&&Object.hasOwn(code,'value')&&typeof code.value==='string'&&/^[0-9A-Z]{5}$/.test(code.value))error.sql_state=code.value;
      // An operator must be able to distinguish a refused DATA comparison
      // from an unavailable transaction without exposing native SQL/details.
      // These are fixed shipping messages, never a caller's arbitrary text;
      // the diagnostic conveys NO retry, effect or completion authority.
      const message=Object.getOwnPropertyDescriptor(cause,'message');
      const refusals=[
        'Original authority mutation witness differs','Original authority attempt unavailable or consumed',
        'Original authority owner transaction unavailable','Original authority fixed target unavailable',
        'Original authority reviewed application guard unavailable','Original authority fixed columns unavailable',
        'Original authority ancestry is ambiguous','Original authority committed ancestry differs',
        'Original authority sealed Source differs','Original authority Source inventory differs',
        'Original authority private originals differ','Original authority DATABASE evidence differs',
        'Original authority expired during validation','Original authority DATA selector unavailable',
        'Original authority DATA relation unavailable','Original authority Source changed before DATA comparison',
        'Original authority current DATA differs','Original authority Source changed after DATA comparison',
        'Original authority pre-effect context changed','Original authority arm differs',
        'Original authority effect count differs','Original authority post-effect context changed',
        'Original authority close-statement differs','Original authority final context changed',
        'Original authority active statement differs',
        'Immutable import original global fence unavailable',
      ];
      if(error.sql_state==='55000'&&message&&Object.hasOwn(message,'value')&&refusals.includes(message.value))
        error.authority_refusal=message.value;
    }
    throw error;
  };
  if(!state||state.verifiedArchive!==verifiedArchive||state.phase!=='COMMIT_ACKNOWLEDGED'
    ||state.inspectionInFlight===true||freshAuthorityAttempts.has(state)||!readback
    ||readback.original!==state.original||readback.freshIntent!==state.freshIntent
    ||readback.imported!==state.imported||readback.port!==state.originalNativePort)unavailable();
  freshAuthorityAttempts.add(state); // Before the first await, even refusal.
  state.inspectionInFlight=true;state.authorityPhase='ATTEMPTED';
  let captured,transactionOpened=false;
  const current=()=>{
    sameFreshNativePort(db,state.originalNativePort);
    if(nativeData(db,'_txStatus')!==(transactionOpened?'T':'I')||freshStaged.get(db)!==state||state.phase!=='COMMIT_ACKNOWLEDGED'
      ||state.verifiedArchive!==verifiedArchive||state.originalDataReadback!==readback
      ||state.inspectionInFlight!==true||!freshAuthorityAttempts.has(state))unavailable();
    sameSource(verifiedArchive,state.original);
    if(readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive)!==captured
      ||captured.sourceBinding!==state.original.sourceBinding)unavailable();
  };
  try{
    captured=readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive);
    current();
    const queryOwned=async(sql,args=[])=>{
      current();const result=await Reflect.apply(query,db,[sql,args]);current();return result;
    };
    // No SELECT/data-modifying statement may precede these relation locks:
    // a later lock cannot make a REPEATABLE READ's older snapshot current.
    // The relation selectors are ONLY this private verified original catalog.
    const names=new Set(),relations=[];
    for(const table of state.original.selection.databaseTables){
      const {schema_name:schema,table_name:name}=table;
      if(!['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private'].includes(schema)||typeof name!=='string'
        ||!name.length||name.includes('\0')||Buffer.byteLength(name,'utf8')>63)unavailable();
      const identity=JSON.stringify([schema,name]);if(names.has(identity))unavailable();names.add(identity);
      const quote=value=>'"'+value.replaceAll('"','""')+'"';
      relations.push('ONLY '+quote(schema)+'.'+quote(name));
    }
    if(!relations.length)unavailable();relations.sort();
    // BEGIN is the sole exceptional transition from native idle to T.
    const begun=await Reflect.apply(query,db,['BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE']);
    transactionOpened=true;current();if(nativeData(begun,'command')!=='BEGIN')unavailable();
    await queryOwned('SET LOCAL extra_float_digits = 3');
    await queryOwned('SET LOCAL search_path = pg_catalog, pg_temp');
    await queryOwned('SET LOCAL row_security = off');
    await queryOwned('LOCK TABLE ONLY auth.sessions, ONLY public.device_auth_credentials, ONLY public.device_auth_enrollment_codes, ONLY public.ops_manager_enrollment_codes, ONLY public.ops_manager_push_devices, ONLY public.ops_manager_trusted_devices IN ACCESS EXCLUSIVE MODE');
    await queryOwned('LOCK TABLE '+relations.join(', ')+' IN SHARE MODE');
    await queryOwned('LOCK TABLE custodial_dr.restore_control,custodial_dr.restore_manifests,custodial_dr.restore_events,custodial_dr.immutable_private_import_context,custodial_dr.immutable_private_import_rows,custodial_dr.immutable_ordinary_import_rows IN SHARE MODE');
    await queryOwned("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('memphis-zoo-application-mutation-admission',0))");
    await queryOwned("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('memphis-zoo-application-mutation-fence',0))");
    const value=await readVerifiedImmutableFreshAuthorityPreparation({db,verifiedArchive,
      freshIntent:state.freshIntent,finished:state.imported});
    current();
    const observed=closed(value,[...witnessKeys,'original_transaction_id','private_rows','transaction_authority','admission_resumed']);
    for(const key of witnessKeys.filter(key=>key!=='transaction_id'))
      if(!isDeepStrictEqual(observed[key],state.imported[key]))unavailable();
    if(observed.original_transaction_id!==state.imported.transaction_id
      ||observed.transaction_id===observed.original_transaction_id||typeof observed.transaction_id!=='string'
      ||!/^[1-9][0-9]{0,18}(?![\s\S])/.test(observed.transaction_id)||BigInt(observed.transaction_id)>9223372036854775807n
      ||observed.private_rows!==state.imported.private_rows||observed.transaction_authority!==false
      ||observed.admission_resumed!==false)unavailable();
    // The fixed SQL routine rechecks all staged ORIGINAL DATA under current
    // relation/type/owner locks BEFORE it creates the one six-statement scope.
    // Its current transaction IDs are private observations, never caller input.
    const result=await Reflect.apply(query,db,[
      'select custodial_dr.reconcile_committed_immutable_original_authority($1::oid,$2::integer,$3::bigint,$4::uuid,$5::bigint,$6::text,$7::bigint) as context',
      [observed.database_oid,observed.backend_pid,observed.transaction_id,observed.restore_id,
        observed.authority_generation,observed.archive_digest,observed.original_transaction_id]]);
    current();
    if(nativeData(result,'command')!=='SELECT'||nativeData(result,'rowCount')!==1)unavailable();
    const rows=nativeData(result,'rows');
    if(!Array.isArray(rows)||types.isProxy(rows)||Object.getPrototypeOf(rows)!==Array.prototype
      ||Reflect.ownKeys(rows).length!==2||nativeData(rows,'length')!==1)unavailable();
    const completion=closed(closed(nativeData(rows,'0'),['context']).context,
      [...witnessKeys,'original_transaction_id','state','revocations']);
    for(const key of [...witnessKeys,'original_transaction_id'])if(completion[key]!==observed[key])unavailable();
    if(completion.state!=='CONSUMED_PAUSED')unavailable();
    const counts=closed(completion.revocations,['employee_credentials','employee_enrollment','manager_credentials',
      'manager_enrollment','manager_push','auth_sessions']);
    for(const count of Object.values(counts))if(typeof count!=='string'
      ||!/^(0|[1-9][0-9]{0,18})(?![\s\S])/.test(count)||BigInt(count)>9223372036854775807n)unavailable();
    current();
    state.authorityCompletion=Object.freeze({...completion,revocations:Object.freeze(counts)});
    state.authorityPhase='STAGED_CONSUMED';
    return Object.freeze({schema:'custodial.immutable-private-fresh-authority-staged.v1',
      requested_original:state.request,completion:state.authorityCompletion,commit_status:'NOT_YET_COMMITTED',
      complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false});
  }catch(error){state.authorityPhase='OUTCOME_UNKNOWN';unavailable(error);}
  finally{state.inspectionInFlight=false;}
}

// The normal caller's ONE authority transaction decision. Unknown COMMIT is
// never another effect attempt; recovery uses the fixed historical reader.
export async function commitVerifiedImmutableFreshAuthority(options){
  const {db,verifiedArchive}=closed(options,['db','verifiedArchive']),state=freshStaged.get(db);
  if(!state||state.verifiedArchive!==verifiedArchive||state.phase!=='COMMIT_ACKNOWLEDGED'
    ||state.authorityPhase!=='STAGED_CONSUMED'||!state.authorityCompletion||state.inspectionInFlight===true)fail();
  state.authorityPhase='COMMITTING';
  const completion=state.authorityCompletion;
  const requested=Object.freeze({...state.request,databaseOid:completion.database_oid,
    effectBackendPid:completion.backend_pid,effectTransactionId:completion.transaction_id,
    originalTransactionId:completion.original_transaction_id});
  const current=()=>{
    sameFreshNativePort(db,state.originalNativePort);sameSource(verifiedArchive,state.original);
    if(freshStaged.get(db)!==state||state.authorityPhase!=='COMMITTING'||state.authorityCompletion!==completion)fail();
    if(readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive).sourceBinding!==state.original.sourceBinding)fail();
  };
  let attempted=false;
  try{
    current();if(nativeData(db,'_txStatus')!=='T')fail();
    const checked=await Reflect.apply(query,db,[`select s.result as completion,
      pg_catalog.txid_current()::text as transaction_id,pg_catalog.pg_backend_pid() as backend_pid,
      s.original_snapshot is not distinct from custodial_dr.immutable_original_authority_snapshot($4::bigint) as original_current
      from custodial_dr.immutable_original_authority_scopes s
      where s.database_oid=$1::oid and s.backend_pid=$2::integer and s.transaction_id=$3::bigint
       and s.phase='CONSUMED' and s.completed_step=6 and s.active_table_oid is null`,
      [completion.database_oid,completion.backend_pid,completion.transaction_id,completion.original_transaction_id]]);
    current();
    if(nativeData(checked,'command')!=='SELECT'||nativeData(checked,'rowCount')!==1)fail();
    const observedRows=nativeData(checked,'rows');
    if(!Array.isArray(observedRows)||types.isProxy(observedRows)||Object.getPrototypeOf(observedRows)!==Array.prototype
      ||Reflect.ownKeys(observedRows).length!==2||nativeData(observedRows,'length')!==1)fail();
    const observed=closed(nativeData(observedRows,'0'),['completion','transaction_id','backend_pid','original_current']);
    if(observed.transaction_id!==completion.transaction_id||observed.backend_pid!==completion.backend_pid
      ||observed.original_current!==true||!isDeepStrictEqual(observed.completion,completion))fail();
    attempted=true;
    const result=await Reflect.apply(query,db,['COMMIT']);
    if(nativeData(result,'command')!=='COMMIT'||nativeData(result,'rowCount')!==null)fail();
    const rows=nativeData(result,'rows');
    if(!Array.isArray(rows)||types.isProxy(rows)||Object.getPrototypeOf(rows)!==Array.prototype
      ||Reflect.ownKeys(rows).length!==1||rows.length!==0)fail();
    current();if(nativeData(db,'_txStatus')!=='I')fail();
    state.authorityPhase='COMMIT_ACKNOWLEDGED';
    return Object.freeze({schema:'custodial.immutable-private-fresh-authority-commit.v1',requested_original:requested,
      commit_status:'ACKNOWLEDGED',complete_restore:false,retry_allowed:false,rerun_import_allowed:false,resume_allowed:false});
  }catch(error){
    state.authorityPhase=attempted?'COMMIT_OUTCOME_UNKNOWN':'COMMIT_NOT_ADMITTED';
    throw Object.assign(new Error('IMMUTABLE_FRESH_AUTHORITY_COMMIT_OUTCOME_UNKNOWN'),{
      code:'IMMUTABLE_FRESH_AUTHORITY_COMMIT_OUTCOME_UNKNOWN',outcome:'UNKNOWN',commit_attempted:attempted,
      requested_original:requested,retry_safe:false,retry_allowed:false,rerun_import_allowed:false,
      resume_allowed:false,complete_restore:false});
  }
}

// The descriptor exists only during ONE privately admitted post-authority
// inspection. Neither comparator options nor public status DATA can create it.
const committedAuthorityDataReads=new WeakMap();
const committedAuthorityPostReadbacks=new WeakMap(),freshPostAuthorityFenceAttempts=new WeakSet();
const committedAuthorityOrdinaryReads=new WeakSet();
const committedAuthoritySourceSha256='e60545804e8c76d94769c6b80426e3dcb86f0bdf47527cd42b5735eb7eff600a';
const committedAuthorityTargets=Object.freeze([
  ['public','device_auth_credentials','credential_id','employee_credentials',"(o.image).revoked_at is null",['revoked_at','revoked_reason']],
  ['public','device_auth_enrollment_codes','enrollment_id','employee_enrollment',"(o.image).revoked_at is null",['revoked_at']],
  ['public','ops_manager_trusted_devices','credential_id','manager_credentials',"(o.image).revoked_at is null",['revoked_at','revoked_reason']],
  ['public','ops_manager_enrollment_codes','id','manager_enrollment',"(o.image).status='active'",['status','revoked_at','revoked_reason']],
  ['public','ops_manager_push_devices','push_device_id','manager_push',"coalesce((o.image).enabled,true)=true or (o.image).revoked_at is null",['enabled','revoked_at','updated_at']],
  ['auth','sessions','id','auth_sessions','true',[]],
].map(([schema,table,primaryKey,counter,predicate,changed])=>Object.freeze({schema,table,primaryKey,counter,predicate,changed:Object.freeze(changed)})));
function currentCommittedAuthorityData(db,verifiedArchive,descriptor){
  const state=descriptor.state,completion=descriptor.completion,readback=descriptor.readback;
  if(committedAuthorityDataReads.get(db)!==descriptor||freshStaged.get(db)!==state
    ||state.phase!=='COMMIT_ACKNOWLEDGED'||state.authorityPhase!=='COMMIT_ACKNOWLEDGED'
    ||state.inspectionInFlight!==true||!freshAuthorityAttempts.has(state)||state.verifiedArchive!==verifiedArchive
    ||state.authorityCompletion!==completion||state.originalDataReadback!==readback
    ||readback.original!==state.original||readback.freshIntent!==state.freshIntent||readback.imported!==state.imported
    ||readback.port!==state.originalNativePort)fail();
  sameFreshNativePort(db,state.originalNativePort);if(nativeData(db,'_txStatus')!=='T')fail();
  sameSource(verifiedArchive,state.original);
  const captured=readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive);
  if(captured!==descriptor.captured||captured.sourceBinding!==state.original.sourceBinding)fail();
  const source=readVerifiedImmutableBootstrapSourceRows(descriptor.source,verifiedArchive);
  if(source.sourceBinding!==state.original.sourceBinding||source.metadata_only!==true)fail();
}
const committedAuthorityFrameSql=`select pg_catalog.jsonb_build_object(
 'database_oid',(select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()),
 'backend_pid',pg_catalog.pg_backend_pid(),'transaction_id',pg_catalog.pg_current_xact_id_if_assigned()::text,
 'snapshot',pg_catalog.txid_current_snapshot()::text,'read_only',pg_catalog.current_setting('transaction_read_only'),
 'isolation',pg_catalog.current_setting('transaction_isolation'),'replication',pg_catalog.current_setting('session_replication_role'),
 'row_security',pg_catalog.current_setting('row_security'),'search_path',pg_catalog.current_setting('search_path'),
 'first_schema',(pg_catalog.current_schemas(true))[1]::text,'actor',current_user,'session_actor',session_user,
 'control_owner',(select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid='custodial_dr.restore_control'::regclass),
 'held_fences',(select count(*)::int from pg_catalog.unnest(array['memphis-zoo-application-mutation-admission','memphis-zoo-application-mutation-fence']) f(name)
   where exists(select 1 from pg_catalog.pg_locks l where l.locktype='advisory' and l.pid=pg_catalog.pg_backend_pid()
     and l.database=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database()) and l.granted and l.mode='ExclusiveLock'
     and l.classid=((pg_catalog.hashtextextended(f.name,0)>>32)&4294967295)::oid
     and l.objid=(pg_catalog.hashtextextended(f.name,0)&4294967295)::oid and l.objsubid=1)),
 'control',(select pg_catalog.row_to_json(c)::text from custodial_dr.restore_control c where singleton),
 'manifest',(select pg_catalog.row_to_json(m)::text from custodial_dr.restore_manifests m where m.restore_id=$4::uuid),
 'completion',s.result,'effect_transaction_started_at',s.original_snapshot->>'effect_transaction_started_at',
 'finite_effect_time',pg_catalog.jsonb_typeof(s.original_snapshot->'effect_transaction_started_at')='string'
   and pg_catalog.isfinite((s.original_snapshot->>'effect_transaction_started_at')::timestamptz)) context
 from ONLY custodial_dr.immutable_original_authority_scopes s
 where s.database_oid=$1::oid and s.backend_pid=$2::integer and s.transaction_id=$3::bigint and s.restore_id=$4::uuid
   and s.authority_generation=$5::bigint and s.archive_digest=$6::text and s.original_transaction_id=$7::bigint
   and s.phase='CONSUMED' and s.completed_step=6 and s.active_table_oid is null
   and s.owner_oid=(select oid from pg_catalog.pg_roles where rolname=current_user)`;
function committedAuthorityScopeArgs(completion){
  return [completion.database_oid,completion.backend_pid,completion.transaction_id,completion.restore_id,
    completion.authority_generation,completion.archive_digest,completion.original_transaction_id];
}
const committedAuthorityReadOnlySql=`select pg_catalog.jsonb_build_object(
 'database_oid',(select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()),
 'backend_pid',pg_catalog.pg_backend_pid(),'transaction_id',pg_catalog.txid_current()::text,
 'actor',current_user,'session_actor',session_user,'read_only',pg_catalog.current_setting('transaction_read_only'),
 'isolation',pg_catalog.current_setting('transaction_isolation'),'replication',pg_catalog.current_setting('session_replication_role'),
 'row_security',pg_catalog.current_setting('row_security'),'search_path',pg_catalog.current_setting('search_path'),
 'first_schema',(pg_catalog.current_schemas(true))[1]::text) context`;
function captureCommittedAuthorityReadOnly(value,completion){
  const observed=closed(value,['database_oid','backend_pid','transaction_id','actor','session_actor','read_only','isolation',
    'replication','row_security','search_path','first_schema']);
  if(observed.database_oid!==completion.database_oid||observed.backend_pid!==completion.backend_pid
    ||typeof observed.transaction_id!=='string'||!/^[1-9][0-9]{0,18}(?![\s\S])/.test(observed.transaction_id)
    ||BigInt(observed.transaction_id)>9223372036854775807n
    ||[completion.transaction_id,completion.original_transaction_id].includes(observed.transaction_id)
    ||observed.actor!=='supabase_admin'||observed.session_actor!==observed.actor||observed.read_only!=='on'
    ||observed.isolation!=='repeatable read'||observed.replication!=='origin'||observed.row_security!=='off'
    ||observed.search_path!=='pg_catalog, pg_temp'||observed.first_schema!=='pg_catalog')fail();
  return Object.freeze(observed);
}
function committedAuthoritySingleContext(reply){
  if(nativeData(reply,'command')!=='SELECT'||nativeData(reply,'rowCount')!==1)fail();
  const values=nativeData(reply,'rows');
  if(!Array.isArray(values)||types.isProxy(values)||Object.getPrototypeOf(values)!==Array.prototype
    ||Reflect.ownKeys(values).length!==2||nativeData(values,'length')!==1)fail();
  return closed(nativeData(values,'0'),['context']).context;
}
function captureCommittedAuthorityFrame(value,completion,expectedPid){
  const frame=closed(value,['database_oid','backend_pid','transaction_id','snapshot','read_only','isolation','replication',
    'row_security','search_path','first_schema','actor','session_actor','control_owner','held_fences','control','manifest',
    'completion','effect_transaction_started_at','finite_effect_time']);
  const retained=closed(frame.completion,[...witnessKeys,'original_transaction_id','state','revocations']);
  closed(retained.revocations,committedAuthorityTargets.map(target=>target.counter));
  if(frame.database_oid!==completion.database_oid||frame.backend_pid!==expectedPid
    ||typeof frame.transaction_id!=='string'||!/^[1-9][0-9]{0,18}(?![\s\S])/.test(frame.transaction_id)
    ||BigInt(frame.transaction_id)>9223372036854775807n
    ||[completion.transaction_id,completion.original_transaction_id].includes(frame.transaction_id)
    ||typeof frame.snapshot!=='string'||!/^[0-9]+:[0-9]+:[0-9,]*(?![\s\S])/.test(frame.snapshot)
    ||frame.read_only!=='on'||frame.isolation!=='repeatable read'||frame.replication!=='origin'
    ||frame.row_security!=='off'||frame.search_path!=='pg_catalog, pg_temp'||frame.first_schema!=='pg_catalog'
    ||frame.actor!=='supabase_admin'||frame.session_actor!==frame.actor||frame.control_owner!==frame.actor
    ||frame.held_fences!==2||typeof frame.control!=='string'||typeof frame.manifest!=='string'
    ||!isDeepStrictEqual(frame.completion,completion)||frame.finite_effect_time!==true
    ||typeof frame.effect_transaction_started_at!=='string'||!frame.effect_transaction_started_at.length)fail();
  return Object.freeze(frame);
}
async function readCommittedAuthorityFrame(db,verifiedArchive,descriptor){
  currentCommittedAuthorityData(db,verifiedArchive,descriptor);
  const reply=await Reflect.apply(query,db,[committedAuthorityFrameSql,committedAuthorityScopeArgs(descriptor.completion)]);
  currentCommittedAuthorityData(db,verifiedArchive,descriptor);
  const frame=captureCommittedAuthorityFrame(committedAuthoritySingleContext(reply),descriptor.completion,descriptor.port.processID);
  if(descriptor.frame&&!isDeepStrictEqual(frame,descriptor.frame))fail();
  return frame;
}
function committedAuthorityImageSql(definition,encoding=postgresJsonTextLineEncoding){
  if(!committedAuthorityTargets.includes(definition))fail();
  if(![postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding].includes(encoding))fail();
  const textColumns=encoding===postgresTextColumnsLineEncoding;
  // Post-COMMIT inspection has no same-xid import context. The actual signed
  // table tag chooses only pure DATA decoding/projection, never admission.
  const decode=textColumns?'custodial_dr.immutable_import_text_record':'pg_catalog.json_populate_record';
  const project=textColumns?'custodial_dr.immutable_import_text_projection':'pg_catalog.row_to_json';
  const {schema,table,primaryKey,predicate,changed}=definition,target='"'+schema+'"."'+table+'"';
  const deleting=schema==='auth',clocked=changed.includes('revoked_at');
  const patch=changed.flatMap(field=>["'"+field+"'",field==='revoked_at'?'NULL':field==='revoked_reason'?'$2::text'
    :field==='updated_at'?'$3::timestamptz':field==='status'?"'revoked'::text":'false']).join(',');
  // clock_timestamp() is a Source-owned non-deterministic assigned field,
  // not a retained historical timestamp. Only that changed field is projected
  // to a constant NULL on BOTH sides and independently required finite/non-null
  // on actual affected keys. Never borrow it as an expected-row oracle. All
  // untouched fields and push's retained native transaction time remain exact.
  // All calls have the SAME three bound parameters, including a target whose
  // fixed operation needs no reason/time. Explicit types also close $2's gap
  // in the push-only $3 expression; do not depend on a recording port's parser.
  return `with arguments as materialized (select $2::text reason,$3::timestamptz effect_transaction_started_at),
    original as materialized (
      select r image from pg_catalog.unnest($1::text[]) raw(original_json)
      cross join lateral ${decode}(null::${target},raw.original_json${textColumns?'':'::json'}) r
    ), classified as materialized (select o.image,(${predicate}) changed from original o),
    expected_rows as materialized (
      select ${project}(${deleting?'o.image':`case when o.changed then pg_catalog.json_populate_record(o.image,pg_catalog.json_build_object(${patch})) else o.image end`})::text collate "C" row_data
      from classified o ${deleting?'where false':''}
    ), current_rows as materialized (
      select ${project}(${deleting?'t':"case when o.changed then pg_catalog.json_populate_record(t,'{\"revoked_at\":null}'::json) else t end"})::text collate "C" row_data
      from only ${target} t ${deleting?'':`left join classified o on t.${primaryKey}=(o.image).${primaryKey}`}
    ), missing as (select row_data from expected_rows except all select row_data from current_rows),
    extra as (select row_data from current_rows except all select row_data from expected_rows)
    select (select count(*)::text from original) original_rows,
      (select count(distinct (o.image).${primaryKey})::text from original o) original_keys,
      (select count(*)::text from classified where changed) transformed_rows,
      (select count(*)::text from expected_rows) expected_rows,
      (select count(*)::text from only ${target}) current_rows,
      (select count(*)::text from missing) missing_rows,(select count(*)::text from extra) extra_rows,
      ${clocked?`coalesce((select pg_catalog.bool_and(t.revoked_at is not null and pg_catalog.isfinite(t.revoked_at))
        from only ${target} t join classified o on t.${primaryKey}=(o.image).${primaryKey} where o.changed),true)`:'true'} clock_fields_valid`;
}

// Inspect only THIS module's same-native, twice-ACKNOWLEDGED invocation. It
// neither reconstructs a restart capability nor opens/completes any transaction.
export async function inspectCommittedImmutableFreshAuthorityData(options){
  let state,descriptor,claimed=false,readPhase='PRIVATE_ANCESTRY';
  const unavailable=cause=>{
    const failure=Object.assign(new Error('IMMUTABLE_FRESH_POST_AUTHORITY_READ_UNAVAILABLE'),{
      code:'IMMUTABLE_FRESH_POST_AUTHORITY_READ_UNAVAILABLE',outcome:'UNKNOWN',retry_safe:false,
      complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,
      inventory_acknowledged:false,effects:false,read_phase:readPhase});
    if(cause&&typeof cause==='object'&&!types.isProxy(cause))privateFailures.set(failure,cause);
    throw failure;
  };
  let db;
  try{
    const input=closed(options,['db','verifiedArchive']);db=input.db;const verifiedArchive=input.verifiedArchive;
    if(!db||types.isProxy(db))unavailable();
    state=freshStaged.get(db);
    if(!state||state.phase!=='COMMIT_ACKNOWLEDGED'||state.authorityPhase!=='COMMIT_ACKNOWLEDGED'
      ||state.verifiedArchive!==verifiedArchive||state.inspectionInFlight===true||!freshAuthorityAttempts.has(state)
      ||!state.authorityCompletion||!state.originalDataReadback||committedAuthorityDataReads.has(db)
      ||freshPostAuthorityFenceAttempts.has(state))unavailable();
    committedAuthorityPostReadbacks.delete(state);
    sameFreshNativePort(db,state.originalNativePort);if(nativeData(db,'_txStatus')!=='T')unavailable();
    const readback=state.originalDataReadback,completion=state.authorityCompletion;
    if(readback.original!==state.original||readback.freshIntent!==state.freshIntent||readback.imported!==state.imported
      ||readback.port!==state.originalNativePort)unavailable();
    const witness=closed(completion,[...witnessKeys,'original_transaction_id','state','revocations']);
    if(witness.state!=='CONSUMED_PAUSED'||witness.original_transaction_id!==state.imported.transaction_id
      ||witness.transaction_id===witness.original_transaction_id)unavailable();
    for(const key of witnessKeys.filter(key=>key!=='transaction_id'))if(witness[key]!==state.imported[key])unavailable();
    const counts=closed(witness.revocations,committedAuthorityTargets.map(target=>target.counter));
    for(const count of Object.values(counts))if(typeof count!=='string'||!/^(0|[1-9][0-9]{0,18})(?![\s\S])/.test(count)
      ||BigInt(count)>9223372036854775807n)unavailable();
    for(const target of committedAuthorityTargets)if(state.original.selection.databaseTables
      .filter(table=>table.schema_name===target.schema&&table.table_name===target.table).length!==1)unavailable();
    const captured=readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive);
    if(captured.sourceBinding!==state.original.sourceBinding)unavailable();
    state.inspectionInFlight=true;claimed=true;
    // The descriptor is private from birth; its Source and frame are populated
    // only after actual original validation, never by a public setter/receipt.
    descriptor={state,completion,readback,captured,port:state.originalNativePort,source:null,frame:null};
    const beforeSource=()=>{
      sameFreshNativePort(db,state.originalNativePort);sameSource(verifiedArchive,state.original);
      if(freshStaged.get(db)!==state||state.phase!=='COMMIT_ACKNOWLEDGED'||state.authorityPhase!=='COMMIT_ACKNOWLEDGED'
        ||state.authorityCompletion!==completion||state.originalDataReadback!==readback||state.inspectionInFlight!==true
        ||!freshAuthorityAttempts.has(state)||readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive)!==captured)unavailable();
    };
    readPhase='READ_ONLY_SNAPSHOT';beforeSource();
    const initialReply=await Reflect.apply(query,db,[committedAuthorityReadOnlySql]);beforeSource();
    const initial=captureCommittedAuthorityReadOnly(committedAuthoritySingleContext(initialReply),completion);
    readPhase='CURRENT_SOURCE';beforeSource();descriptor.source=await prepareVerifiedImmutableBootstrapSource(verifiedArchive);beforeSource();
    const recipes=descriptor.source.statements.filter(row=>row.sourcePath==='proposals/immutable-original-authority-reconciliation.sql');
    if(recipes.length!==1||recipes[0].sourceSha256!==committedAuthoritySourceSha256)unavailable();
    committedAuthorityDataReads.set(db,descriptor);
    const current=()=>currentCommittedAuthorityData(db,verifiedArchive,descriptor);
    current();
    const {readVerifiedImmutableFreshPostDatabaseContext}=await import('./immutable-private-fresh-restore-commit-context.mjs');current();
    readPhase='ORIGINAL_CONTEXT';
    const before=await readVerifiedImmutableFreshPostDatabaseContext({db,verifiedArchive,freshIntent:state.freshIntent,finished:state.imported});current();
    if(before.transaction_id!==initial.transaction_id)unavailable();
    const request=Object.freeze({...state.request,databaseOid:completion.database_oid,effectBackendPid:completion.backend_pid,
      effectTransactionId:completion.transaction_id,originalTransactionId:completion.original_transaction_id});
    const {readVerifiedImmutableFreshAuthorityCommitOutcome}=await import('./immutable-private-fresh-restore-recovery.mjs');current();
    const observe=async()=>{
      current();const value=await readVerifiedImmutableFreshAuthorityCommitOutcome({db,request});current();
      const checked=closed(value,['schema','requested_original','observation','outcome','database_status','authority_status','metadata_only',
        'retry_safe','retry_allowed','resume_allowed','rerun_import_allowed','complete_restore']);
      if(checked.schema!=='custodial.immutable-private-fresh-authority-commit-outcome.v1'||!isDeepStrictEqual(checked.requested_original,request)
        ||checked.observation!=='CURRENT_FIXED_READ'||checked.outcome!=='AUTHORITY_COMPLETION_OBSERVED'||checked.metadata_only!==true
        ||['retry_safe','retry_allowed','resume_allowed','rerun_import_allowed','complete_restore'].some(key=>checked[key]!==false))unavailable();
      const status=closed(checked.authority_status,['state','database_oid','effect_backend_pid','effect_transaction_id','original_transaction_id',
        'restore_id','authority_generation','archive_digest','revocations']);
      if(status.state!=='OBSERVED_COMMITTED_CONSUMED'||status.database_oid!==completion.database_oid||status.effect_backend_pid!==completion.backend_pid
        ||status.effect_transaction_id!==completion.transaction_id||status.original_transaction_id!==completion.original_transaction_id
        ||status.restore_id!==completion.restore_id||status.authority_generation!==completion.authority_generation
        ||status.archive_digest!==completion.archive_digest||!isDeepStrictEqual(status.revocations,completion.revocations))unavailable();
      return value;
    };
    readPhase='COMMITTED_SCOPE';const originalObservation=await observe();current();
    // FIRST verify the fixed committed Source reader; only THEN read its same
    // exact immutable tuple's native timestamp. No current-row clock oracle.
    readPhase='SCOPE_TIMESTAMP';descriptor.frame=await readCommittedAuthorityFrame(db,verifiedArchive,descriptor);current();
    if(descriptor.frame.transaction_id!==before.transaction_id)unavailable();
    Object.freeze(descriptor);
    let originalTextHelpers;
    const textHelpersCurrent=async()=>{
      current();await readCommittedAuthorityFrame(db,verifiedArchive,descriptor);current();
      const reply=await Reflect.apply(query,db,[immutableTextHelperSourceSql]);current();
      await readCommittedAuthorityFrame(db,verifiedArchive,descriptor);current();
      const values=nativeData(reply,'rows');
      if(nativeData(reply,'command')!=='SELECT'||nativeData(reply,'rowCount')!==nativeData(values,'length'))unavailable();
      originalTextHelpers=immutableTextHelperSource(values,originalTextHelpers);
    };
    const hasTextColumns=state.original.selection.databaseTables.some(table=>table.data_encoding===postgresTextColumnsLineEncoding);
    if(hasTextColumns){readPhase='TEXT_HELPER_SOURCE';await textHelpersCurrent();current();}
    readPhase='PRIVATE_DATA';const privateData=await compareVerifiedImmutablePrivateTableData({db,verifiedArchive});current();
    committedAuthorityOrdinaryReads.add(descriptor);
    readPhase='ORDINARY_DATA';const ordinaryData=await compareVerifiedImmutableOrdinaryTableData({db,verifiedArchive});current();
    const {compareVerifiedStorageTableData}=await import('./disaster-recovery-storage.mjs');current();
    readPhase='STORAGE_DATA';const storageData=await compareVerifiedStorageTableData({db,verifiedArchive});current();
    readPhase='FINAL_SCOPE';await readCommittedAuthorityFrame(db,verifiedArchive,descriptor);current();
    const finalObservation=await observe();current();
    if(!isDeepStrictEqual(finalObservation,originalObservation))unavailable();
    readPhase='FINAL_CONTEXT';
    const after=await readVerifiedImmutableFreshPostDatabaseContext({db,verifiedArchive,freshIntent:state.freshIntent,finished:state.imported});current();
    if(!isDeepStrictEqual(before,after))unavailable();
    if(hasTextColumns){readPhase='TEXT_HELPER_SOURCE';await textHelpersCurrent();current();}
    const privateResult=closed(privateData,['state','tables']),ordinaryResult=closed(ordinaryData,['state','tables']);
    const storageResult=closed(storageData,['sourceBinding','status','tables']);
    if(!['MATCH','DIFFERENT','UNSUPPORTED'].includes(privateResult.state)
      ||!['MATCH','DIFFERENT','UNSUPPORTED','SOURCE_TRANSFORMATION_VERIFIED'].includes(ordinaryResult.state)
      ||storageResult.sourceBinding!==state.original.sourceBinding
      ||!['MATCH','DIFFERENT','UNSUPPORTED','NOT_APPLICABLE_ORIGINAL_NO_MEMBERS'].includes(storageResult.status))unavailable();
    const outcomes=[privateResult.state,ordinaryResult.state,storageResult.status];
    const result=outcomes.includes('UNSUPPORTED')?'UNSUPPORTED':outcomes.includes('DIFFERENT')?'DIFFERENT'
      :outcomes.includes('SOURCE_TRANSFORMATION_VERIFIED')?'SOURCE_TRANSFORMATION_VERIFIED':'MATCH';
    if(['MATCH','SOURCE_TRANSFORMATION_VERIFIED'].includes(result)){
      // Retain ONLY the private descriptor of this actual full native read.
      // Its public metadata result remains non-authoritative and unchanged.
      committedAuthorityPostReadbacks.set(state,Object.freeze({descriptor,frame:descriptor.frame}));
    }
    return Object.freeze({schema:'custodial.immutable-private-post-authority-data-readback.v1',state:result,requested_original:state.request,
      private_data:privateData,ordinary_data:ordinaryData,storage_data:Object.freeze({status:storageResult.status,tables:storageResult.tables}),
      comparison_only:true,metadata_only:true,retry_safe:false,complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,
      inventory_acknowledged:false,effects:false});
  }catch(error){unavailable(error);}
  finally{if(claimed){committedAuthorityOrdinaryReads.delete(descriptor);committedAuthorityDataReads.delete(db);state.inspectionInFlight=false;}}
}

// This is a private same-invocation transition, not an ACK/readback token.
// Keep the existing global writer fence across the caller's RO rollback
// BEFORE its remaining restore phases. It can only consume the actual full
// successful post-authority read in that STILL OPEN exact native snapshot.
export async function holdVerifiedImmutableFreshPostAuthorityFence(options) {
  let state,descriptor,db,claimed=false;
  const unavailable=cause=>{
    const failure=Object.assign(new Error('IMMUTABLE_FRESH_POST_AUTHORITY_CONTINUATION_UNAVAILABLE'),{
      code:'IMMUTABLE_FRESH_POST_AUTHORITY_CONTINUATION_UNAVAILABLE',outcome:'UNKNOWN',retry_safe:false,
      complete_restore:false,resume_allowed:false,retry_allowed:false,rerun_import_allowed:false,
      inventory_acknowledged:false,effects:false});
    if(cause&&typeof cause==='object'&&!types.isProxy(cause))privateFailures.set(failure,cause);
    throw failure;
  };
  try {
    const input=closed(options,['db','verifiedArchive']);db=input.db;
    const verifiedArchive=input.verifiedArchive;
    if(!db||types.isProxy(db))unavailable();
    state=freshStaged.get(db);
    const observed=state&&committedAuthorityPostReadbacks.get(state);
    if(!state||!observed||freshPostAuthorityFenceAttempts.has(state)
      ||state.phase!=='COMMIT_ACKNOWLEDGED'||state.authorityPhase!=='COMMIT_ACKNOWLEDGED'
      ||state.verifiedArchive!==verifiedArchive||state.inspectionInFlight===true
      ||committedAuthorityDataReads.has(db)||!freshAuthorityAttempts.has(state))unavailable();
    descriptor=observed.descriptor;
    if(descriptor.state!==state||descriptor.port!==state.originalNativePort
      ||descriptor.readback!==state.originalDataReadback||descriptor.completion!==state.authorityCompletion
      ||descriptor.frame!==observed.frame)unavailable();
    sameFreshNativePort(db,state.originalNativePort);
    if(nativeData(db,'_txStatus')!=='T')unavailable();
    sameSource(verifiedArchive,state.original);
    if(readVerifiedImmutableFreshRestoreIntent(state.freshIntent,verifiedArchive)!==descriptor.captured)unavailable();
    // Consume BEFORE the first await. Failed/unknown calls cannot reacquire
    // this transition by resubmitting lookup DATA or another public result.
    freshPostAuthorityFenceAttempts.add(state);
    committedAuthorityPostReadbacks.delete(state);
    state.inspectionInFlight=true;claimed=true;
    committedAuthorityDataReads.set(db,descriptor);
    await readCommittedAuthorityFrame(db,verifiedArchive,descriptor);
    currentCommittedAuthorityData(db,verifiedArchive,descriptor);
    // This same native backend already holds both xact writer/admission
    // fences. Session ownership carries the global fence across RO rollback;
    // no settings, role, grant, DATA, BEGIN/COMMIT or resume change occurs.
    const reply=await Reflect.apply(query,db,[
      "select pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended('memphis-zoo-application-mutation-fence',0))"
    ]);
    currentCommittedAuthorityData(db,verifiedArchive,descriptor);
    const rows=nativeData(reply,'rows');
    if(nativeData(reply,'command')!=='SELECT'||nativeData(reply,'rowCount')!==1
      ||!Array.isArray(rows)||types.isProxy(rows)||Object.getPrototypeOf(rows)!==Array.prototype||rows.length!==1
      ||Reflect.ownKeys(rows).length!==2)unavailable();
    const row=closed(nativeData(rows,'0'),['pg_advisory_lock']);
    if(row.pg_advisory_lock!=='')unavailable();
    await readCommittedAuthorityFrame(db,verifiedArchive,descriptor);
    currentCommittedAuthorityData(db,verifiedArchive,descriptor);
    // No public receipt, capability flag, expected row or new identity.
    // Caller owns exact unlock/end lifecycle; on ANY unreturned/unknown
    // acquisition it must retain pause and close the ORIGINAL connection.
  }catch(error){unavailable(error);}
  finally {
    if(claimed){
      committedAuthorityOrdinaryReads.delete(descriptor);
      committedAuthorityDataReads.delete(db);
      state.inspectionInFlight=false;
    }
  }
}

// The SAME fixed two pure DATA recipes already used by Storage readback.
// Exact f0c870ea6691552b47daa8eb962645512b74cdd8d26078cef05a42f52116fc55
// Source bodies, not names/observed target definitions as an expected oracle.
const immutableTextHelperSourceSql = `select p.oid::pg_catalog.text oid,p.proname::pg_catalog.text name,
      p.proargtypes::pg_catalog.text arguments,p.prorettype::pg_catalog.text "returns",
      p.proargnames argument_names,p.prosrc body,pg_catalog.pg_get_functiondef(p.oid) definition,p.proconfig config,
      (p.prokind='f' and l.lanname='plpgsql' and l.lanispl and l.lanpltrusted
       and not p.prosecdef and not p.proleakproof and not p.proisstrict and not p.proretset
       and p.provolatile='v' and p.proparallel='u' and p.procost=100 and p.prorows=0
       and p.provariadic=0 and p.prosupport=0 and p.pronargdefaults=0 and p.proargdefaults is null
       and p.proallargtypes is null and p.proargmodes is null and p.protrftypes is null and p.prosqlbody is null
       and p.pronargs=case p.proname when 'immutable_import_text_record' then 2 else 1 end
       and current_user=session_user
       and p.proowner=(select r.oid from pg_catalog.pg_roles r where r.rolname=current_user)
       and p.proowner=(select c.relowner from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
         where ns.nspname='custodial_dr' and c.relname='restore_control' and c.relkind='r')
       and p.proowner=(select c.relowner from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
         where ns.nspname='custodial_dr' and c.relname='immutable_private_import_context' and c.relkind='r')
       and n.nspowner=(select r.oid from pg_catalog.pg_roles r where r.rolname='postgres')
       and (select d.datdba from pg_catalog.pg_database d where d.datname=pg_catalog.current_database())=n.nspowner
       and (select pg_catalog.count(*) from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))=1
       and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
         where a.grantee<>p.proowner or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable)
      )::pg_catalog.text source_attributes
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_language l on l.oid=p.prolang
    where n.nspname='custodial_dr' and p.proname in ('immutable_import_text_projection','immutable_import_text_record')
    order by p.proname collate pg_catalog."C",p.oid`;
function immutableTextHelperSource(values,previous){
  const dense=value=>{
    if(!value||types.isProxy(value)||!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype
      ||Reflect.ownKeys(value).length!==value.length+1)fail();
    return Array.from({length:value.length},(_,i)=>nativeData(value,String(i)));
  };
  const keys=['oid','name','arguments','returns','argument_names','body','definition','config','source_attributes'];
  const expected=[
    ['immutable_import_text_projection','2283','25',['original_record'],
      '814c1bfe130b62bbd6ffbd278b6b7b1b23546d4942a2dccbec29083d1a65c3b8'],
    ['immutable_import_text_record','2283 25','2283',['prototype','original_row_utf8'],
      '030a130aa642d5517aa4acc154de267c16034d94a6ead01b299f7653fdff1fcb'],
  ];
  const config=['search_path=pg_catalog','extra_float_digits=3','datestyle=ISO, YMD',
    'timezone=UTC','intervalstyle=postgres','bytea_output=hex'];
  const actual=dense(values).map(value=>closed(value,keys));
  if(actual.length!==expected.length)fail(); // Includes all unexpected overloads.
  for(let i=0;i<expected.length;i++){
    const value=actual[i],[name,args,returns,argNames,bodySha]=expected[i];
    if(typeof value.oid!=='string'||!/^[1-9][0-9]{0,9}(?![\s\S])/.test(value.oid)||BigInt(value.oid)>4294967295n
      ||value.name!==name||value.arguments!==args||value.returns!==returns||value.source_attributes!=='true'
      ||typeof value.body!=='string'||createHash('sha256').update(value.body,'utf8').digest('hex')!==bodySha
      ||typeof value.definition!=='string'||!value.definition)fail();
    value.argument_names=Object.freeze(dense(value.argument_names));
    if(!isDeepStrictEqual(value.argument_names,argNames))fail();
    value.config=Object.freeze(dense(value.config));
    // Only native GUC identifier case is insensitive, as in the sealed
    // Storage check. Values/count/order and the retained receipt stay exact.
    if(value.config.length!==config.length||value.config.some((option,index)=>{
      if(typeof option!=='string'||!/^[A-Za-z_]+=/.test(option))return true;
      const equals=option.indexOf('=');
      return option.slice(0,equals).toLowerCase()+option.slice(equals)!==config[index];
    }))fail();
    Object.freeze(value);
  }
  if(actual[0].oid===actual[1].oid||(previous!==undefined&&!isDeepStrictEqual(actual,previous)))fail();
  // Detached, immutable comparison DATA local to one read invocation only.
  // Not a currentness cache, public receipt, ctx row or effect capability.
  return Object.freeze(actual);
}

// Read-only DATA comparison, never a restore/COMMIT/admission capability. The
// only relation selectors and row loans below come from the verified archive.
// Bounded text[] comparison currently supports <=16 MiB signed file bytes,
// <=8 MiB decoded raw JSON and <=65536 rows TOTAL across these two ledgers.
// Larger originals remain UNSUPPORTED; none are truncated or treated as empty.
export async function compareVerifiedImmutablePrivateTableData(options) {
  const names=['employee_message_original_outcomes','group_original_creations'];
  const schema='custodial_release_identity',loans=[];
  let originalQueryFailure;
  const unknown=()=>Object.freeze({state:'UNSUPPORTED',tables:Object.freeze(names.map(table_name=>Object.freeze({
    schema_name:schema,table_name,state:'UNSUPPORTED',original_rows:null,current_rows:null,missing_rows:null,extra_rows:null,
  })))});
  const refuse=()=>{throw new Error('Immutable private original readback unavailable');};
  const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
  const oid=value=>typeof value==='string'&&/^[1-9][0-9]{0,9}$/.test(value)&&BigInt(value)<=4294967295n;
  const own=(value,key)=>{
    if(!value||typeof value!=='object'||types.isProxy(value))refuse();
    const field=Object.getOwnPropertyDescriptor(value,key);
    if(!field||!Object.hasOwn(field,'value'))refuse();return field.value;
  };
  const dense=value=>{
    if(!Array.isArray(value)||types.isProxy(value)||Reflect.ownKeys(value).length!==value.length+1)refuse();
    for(let i=0;i<value.length;i++)own(value,String(i));return value;
  };
  const rows=reply=>{
    if(own(reply,'command')!=='SELECT')refuse();
    const values=dense(own(reply,'rows'));
    if(own(reply,'rowCount')!==values.length)refuse();return values;
  };
  const contextSql=`select pg_catalog.jsonb_build_object(
    'database_oid',(select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()),
    'database_name',pg_catalog.current_database(),'backend_pid',pg_catalog.pg_backend_pid(),
    'actor',current_user,'session_actor',session_user,
    'transaction_id',pg_catalog.pg_current_xact_id_if_assigned()::text,
    'virtual_xid',(select virtualtransaction::text from pg_catalog.pg_locks
      where pid=pg_catalog.pg_backend_pid() and locktype='virtualxid' and granted),
    'snapshot_id',pg_catalog.txid_current_snapshot()::text,
    'transaction_started_at',pg_catalog.transaction_timestamp()::text,
    'read_only',pg_catalog.current_setting('transaction_read_only'),
    'isolation',pg_catalog.current_setting('transaction_isolation'),
    'row_security',pg_catalog.current_setting('row_security'),
    'search_path',pg_catalog.current_setting('search_path'),
    'first_schema',(pg_catalog.current_schemas(true))[1]::pg_catalog.text,
    'float_digits',pg_catalog.current_setting('extra_float_digits')) context`;
  const catalogSql=`select n.nspname schema_name,c.relname table_name,c.oid::text relation_oid,
    c.relkind::text relation_kind,c.relpersistence::text persistence,c.relispartition is_partition,
    pg_catalog.pg_get_userbyid(c.relowner) owner_name,
    (select count(*)::text from pg_catalog.pg_inherits where inhparent=c.oid or inhrelid=c.oid) inheritance_count,
    (select count(*)::text from pg_catalog.pg_attribute where attrelid=c.oid and attnum>0 and attisdropped) dropped_count,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name',a.attname,'data_type',pg_catalog.format_type(a.atttypid,a.atttypmod),
      'generated',a.attgenerated,'identity',a.attidentity) order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb) columns,
    coalesce((select pg_catalog.jsonb_agg(a.attname order by k.ordinality) from pg_catalog.pg_index i
      cross join lateral pg_catalog.unnest(i.indkey) with ordinality k(attnum,ordinality)
      join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
      where i.indrelid=c.oid and i.indisprimary and i.indisvalid),'[]'::jsonb) primary_key
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='custodial_release_identity' and c.relkind in ('r','p','f','v','m') order by c.relname`;
  try {
    const {db,verifiedArchive}=closed(options,['db','verifiedArchive']);
    const native=()=>{
      if(!db||types.isProxy(db)||Object.getPrototypeOf(db)!==Client.prototype
        ||Object.hasOwn(db,'query')||Client.prototype.query!==query)refuse();
    };
    native();const original=readVerifiedPrivateImportSource(verifiedArchive);
    const source=()=>{native();sameSource(verifiedArchive,original);};
    const nativeRead=async(sql,params=[])=>{
      // Only this actual native-query catch can observe an SQLSTATE. Source,
      // decoder and cleanup errors cannot supply one. Stop own later queries
      // even if the first native failure has no inspectable SQLSTATE.
      if(originalQueryFailure)throw originalQueryFailure;
      try{return await Reflect.apply(query,db,[sql,params]);}
      catch(error){
        const redacted=Object.assign(new Error('IMMUTABLE_PRIVATE_DATA_READBACK_SQL_FAILED'),{
          code:'IMMUTABLE_PRIVATE_DATA_READBACK_SQL_FAILED',outcome:'UNKNOWN',retry_safe:false,
        });
        if(error&&typeof error==='object'&&!types.isProxy(error)){
          const field=Object.getOwnPropertyDescriptor(error,'code');
          if(field&&Object.hasOwn(field,'value')&&typeof field.value==='string'&&/^[0-9A-Z]{5}$/.test(field.value))
            redacted.sql_state=field.value;
        }
        originalQueryFailure=Object.freeze(redacted);throw originalQueryFailure;
      }
    };
    const selected=dense(original.selection.privateTables),members=dense(original.privateDataMembers);
    if(selected.length!==2||members.length!==2)refuse();
    const tables=names.map(name=>{
      const matches=selected.filter(t=>t.schema_name===schema&&t.table_name===name);
      const pins=members.filter(t=>t.schema_name===schema&&t.table_name===name);
      if(matches.length!==1||pins.length!==1)refuse();
      const table=matches[0],pin=pins[0];
      if(![postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding].includes(table.data_encoding)||pin.data_encoding!==table.data_encoding
        ||table.data_file!==`database/${schema}.${name}.jsonl`||pin.data_file!==table.data_file
        ||pin.row_count!==table.row_count||!decimal(table.row_count)||!decimal(pin.bytes)
        ||!(/^[a-f0-9]{64}$/).test(pin.sha256)||BigInt(table.row_count)>65536n)refuse();
      dense(table.columns);dense(table.primary_key);
      // The two supported originals have no generated/identity values. Do not
      // project such values away if a future Source/catalog changes that fact.
      if(!table.columns.length||!table.primary_key.length||table.columns.some(c=>{
        const value=closed(c,['name','data_type','generated','identity']);
        return typeof value.name!=='string'||!value.name||typeof value.data_type!=='string'||!value.data_type
          ||value.generated!==''||value.identity!=='';
      })||new Set(table.columns.map(c=>c.name)).size!==table.columns.length
        ||new Set(table.primary_key).size!==table.primary_key.length
        ||table.primary_key.some(key=>!table.columns.some(c=>c.name===key)))refuse();
      return {table,pin};
    });
    if(tables.reduce((n,{pin})=>n+BigInt(pin.bytes),0n)>16777216n
      ||tables.reduce((n,{table})=>n+BigInt(table.row_count),0n)>65536n)refuse();
    let originalContext;
    const context=async()=>{
      source();const reply=await nativeRead(contextSql);source();
      const observed=rows(reply);if(observed.length!==1)refuse();
      const value=closed(closed(observed[0],['context']).context,['database_oid','database_name','backend_pid',
        'actor','session_actor','transaction_id','virtual_xid','snapshot_id','transaction_started_at',
        'read_only','isolation','row_security','search_path','first_schema','float_digits']);
      if(!oid(value.database_oid)||typeof value.database_name!=='string'||!value.database_name
        ||!Number.isInteger(value.backend_pid)||value.backend_pid<=0||value.backend_pid>2147483647
        ||typeof value.actor!=='string'||!value.actor||value.actor!==value.session_actor
        ||(value.transaction_id!==null&&(!decimal(value.transaction_id)||value.transaction_id==='0'))
        ||typeof value.virtual_xid!=='string'||!(/^[1-9][0-9]*\/[1-9][0-9]*$/).test(value.virtual_xid)
        ||typeof value.snapshot_id!=='string'||!(/^[0-9]+:[0-9]+:[0-9,]*$/).test(value.snapshot_id)
        ||typeof value.transaction_started_at!=='string'||!value.transaction_started_at
        ||value.read_only!=='on'||!['repeatable read','serializable'].includes(value.isolation)
        ||value.row_security!=='off'||!['pg_catalog','pg_catalog, pg_temp'].includes(value.search_path)
        ||value.first_schema!=='pg_catalog'||!['1','2','3'].includes(value.float_digits))refuse();
      if(originalContext&&!isDeepStrictEqual(value,originalContext))refuse();
      originalContext??=Object.freeze(value);
    };
    const boundary=async()=>{source();await context();source();};
    const read=async(sql,params=[])=>{
      await boundary();source();const reply=await nativeRead(sql,params);source();
      await boundary();source();return rows(reply);
    };
    let originalTextHelpers;
    const textHelpersCurrent=async()=>{
      const values=await read(immutableTextHelperSourceSql);source();
      originalTextHelpers=immutableTextHelperSource(values,originalTextHelpers);
    };
    await boundary();
    const originalCatalog=await read(catalogSql);
    if(originalCatalog.length!==2)refuse();
    for(let i=0;i<tables.length;i++){
      const {table}=tables[i],actual=closed(originalCatalog[i],['schema_name','table_name','relation_oid','relation_kind',
        'persistence','is_partition','owner_name','inheritance_count','dropped_count','columns','primary_key']);
      if(actual.schema_name!==schema||actual.table_name!==table.table_name||!oid(actual.relation_oid)
        ||actual.relation_kind!=='r'||actual.persistence!=='p'||actual.is_partition!==false
        ||typeof actual.owner_name!=='string'||!actual.owner_name||actual.inheritance_count!=='0'||actual.dropped_count!=='0'
        ||!isDeepStrictEqual(actual.columns,table.columns)||!isDeepStrictEqual(actual.primary_key,table.primary_key))refuse();
    }
    if(originalCatalog[0].relation_oid===originalCatalog[1].relation_oid)refuse();
    let rawBytes=0;
    const summaries=[];
    for(const {table,pin} of tables){
      await boundary();source();
      if(table.data_encoding===postgresTextColumnsLineEncoding){await textHelpersCurrent();source();}
      const data=openVerifiedRestoreTableData(verifiedArchive,schema,table.table_name);
      const rawRows=[];loans.push(rawRows);
      let input,guard,settled,failure;const cleanup=[];
      try {
        if(!isDeepStrictEqual(data.table,table))refuse();
        guard=createRestoreRowUtf8Guard();settled=pipeline(data.stream,guard);settled.catch(()=>{});
        input=createInterface({input:guard,crlfDelay:Infinity});
        const iterator=input[Symbol.asyncIterator]();
        while(true){
          await boundary();source();const next=await iterator.next();source();await boundary();source();
          if(next.done)break;
          if(BigInt(rawRows.length)>=BigInt(pin.row_count))refuse();
          const raw=decodeRestoreTableRowLine(next.value,data.table);
          rawBytes+=Buffer.byteLength(raw,'utf8');if(rawBytes>8388608)refuse();rawRows.push(raw);
        }
        await boundary();source();await settled;source();await boundary();source();
        await boundary();source();const eof=await data.verified;source();await boundary();source();
        if(eof.data_file!==pin.data_file||eof.sha256!==pin.sha256||String(eof.bytes)!==pin.bytes
          ||String(rawRows.length)!==pin.row_count)refuse();
      } catch(error){failure=error;}
      finally {
        // A failed snapshot/source guard never prevents closing original FDs.
        // Even cleanup awaits are bracketed; failures can only deny a match.
        const check=async()=>{try{source();await boundary();source();}catch(error){cleanup.push(error);}};
        input?.close();data.stream.destroy();guard?.destroy();
        if(settled){await check();try{await settled;}catch(error){if(error!==failure)cleanup.push(error);}await check();}
        await check();try{await data.close();}catch(error){cleanup.push(error);}await check();
      }
      if(failure||cleanup.length)refuse();
      const target=`"custodial_release_identity"."${table.table_name}"`;
      // This is an independent read-only snapshot, NOT the original import
      // transaction. v2 uses pure native text helpers, not ctx decode APIs.
      const textColumns=table.data_encoding===postgresTextColumnsLineEncoding;
      const decode=textColumns?'custodial_dr.immutable_import_text_record':'pg_catalog.json_populate_record';
      const project=textColumns?'custodial_dr.immutable_import_text_projection':'pg_catalog.to_jsonb';
      if(textColumns){await textHelpersCurrent();source();}
      const result=await read(`with original_rows as materialized (
          select ${project}(r)${textColumns?' collate "C"':''} row_data from pg_catalog.unnest($1::text[]) raw(original_json)
          cross join lateral ${decode}(null::${target},raw.original_json${textColumns?'':'::json'}) r
        ), current_rows as materialized (select ${project}(t)${textColumns?' collate "C"':''} row_data from only ${target} t),
        missing as (select row_data from original_rows except all select row_data from current_rows),
        extra as (select row_data from current_rows except all select row_data from original_rows)
        select (select count(*)::text from original_rows) original_rows,
          (select count(*)::text from current_rows) current_rows,
          (select count(*)::text from missing) missing_rows,(select count(*)::text from extra) extra_rows`,[rawRows]);
      if(textColumns){await textHelpersCurrent();source();}
      if(result.length!==1)refuse();
      const counts=closed(result[0],['original_rows','current_rows','missing_rows','extra_rows']);
      if(!Object.values(counts).every(decimal)||counts.original_rows!==pin.row_count
        ||BigInt(counts.missing_rows)>BigInt(counts.original_rows)||BigInt(counts.extra_rows)>BigInt(counts.current_rows)
        ||BigInt(counts.original_rows)-BigInt(counts.missing_rows)!==BigInt(counts.current_rows)-BigInt(counts.extra_rows))refuse();
      const state=counts.missing_rows==='0'&&counts.extra_rows==='0'?'MATCH':'DIFFERENT';
      summaries.push(Object.freeze({schema_name:schema,table_name:table.table_name,state,...counts}));
      rawRows.length=0;
    }
    const finalCatalog=await read(catalogSql);
    if(!isDeepStrictEqual(finalCatalog,originalCatalog))refuse();
    await boundary();source();
    if(originalTextHelpers!==undefined){await textHelpersCurrent();source();}
    return Object.freeze({state:summaries.every(table=>table.state==='MATCH')?'MATCH':'DIFFERENT',tables:Object.freeze(summaries)});
  } catch {
    // No raw original data, SQL detail or session identity leaves this reader.
    // Incomplete/expired/unavailable evidence is never an absence/rollback proof.
    if(originalQueryFailure?.sql_state)throw originalQueryFailure;
    return unknown();
  } finally {for(const rows of loans)rows.length=0;} // Strings are not claimed wipeable.
}

// Ordinary original DATA only, in the caller's existing read-only snapshot.
// Source-owned rows require exact authenticated original/program comparison;
// a Source transformation is never labelled original DATA MATCH.
// Bounded total support: 4096 declared tables, 65536 rows, 16 MiB source wire,
// 8 MiB decoded raw JSON. Unsupported shapes/limits are not empty-work proof.
export async function compareVerifiedImmutableOrdinaryTableData(options) {
  const sourceVerified='SOURCE_TRANSFORMATION_VERIFIED';
  const bootstrap=new Set(['public.release_deployment_manifest','public.custodial_release_authority_restore_inventory']);
  let selected=[],originalQueryFailure,bootstrapSource;const loans=[];
  const summary=(table,state='UNSUPPORTED',original_rows=null,counts={current_rows:null,missing_rows:null,extra_rows:null})=>Object.freeze({
    schema_name:table.schema_name,table_name:table.table_name,state,original_rows,...counts,
  });
  const unknown=()=>Object.freeze({state:'UNSUPPORTED',tables:Object.freeze(selected.map(table=>summary(table)))});
  const refuse=()=>{throw new Error('Immutable ordinary original readback unavailable');};
  const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
  const oid=value=>typeof value==='string'&&/^[1-9][0-9]{0,9}$/.test(value)&&BigInt(value)<=4294967295n;
  const name=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value,'utf8')<=63&&!/[\x00-\x1f\x7f]/.test(value);
  const own=(value,key)=>{
    if(!value||typeof value!=='object'||types.isProxy(value))refuse();
    const field=Object.getOwnPropertyDescriptor(value,key);if(!field||!Object.hasOwn(field,'value'))refuse();return field.value;
  };
  const dense=value=>{
    if(!Array.isArray(value)||types.isProxy(value)||Reflect.ownKeys(value).length!==value.length+1)refuse();
    for(let i=0;i<value.length;i++)own(value,String(i));return value;
  };
  const rows=reply=>{
    if(own(reply,'command')!=='SELECT')refuse();const values=dense(own(reply,'rows'));
    if(own(reply,'rowCount')!==values.length)refuse();return values;
  };
  const key=table=>JSON.stringify([table.schema_name,table.table_name]);
  const quote=value=>'"'+value.replaceAll('"','""')+'"';
  const contextSql=`select pg_catalog.jsonb_build_object(
    'database_oid',(select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()),
    'database_name',pg_catalog.current_database(),'backend_pid',pg_catalog.pg_backend_pid(),
    'actor',current_user,'session_actor',session_user,
    'transaction_id',pg_catalog.pg_current_xact_id_if_assigned()::text,
    'virtual_xid',(select virtualtransaction::text from pg_catalog.pg_locks
      where pid=pg_catalog.pg_backend_pid() and locktype='virtualxid' and granted),
    'snapshot_id',pg_catalog.txid_current_snapshot()::text,
    'transaction_started_at',pg_catalog.transaction_timestamp()::text,
    'read_only',pg_catalog.current_setting('transaction_read_only'),
    'isolation',pg_catalog.current_setting('transaction_isolation'),
    'row_security',pg_catalog.current_setting('row_security'),'search_path',pg_catalog.current_setting('search_path'),
    'first_schema',(pg_catalog.current_schemas(true))[1]::pg_catalog.text,
    'timezone',pg_catalog.current_setting('TimeZone'),'date_style',pg_catalog.current_setting('DateStyle'),
    'interval_style',pg_catalog.current_setting('IntervalStyle'),'float_digits',pg_catalog.current_setting('extra_float_digits')) context`;
  const catalogSql=`select n.nspname schema_name,c.relname table_name,c.oid::text relation_oid,
    c.relkind::text relation_kind,c.relpersistence::text persistence,c.relispartition is_partition,
    pg_catalog.pg_get_userbyid(c.relowner) owner_name,
    (select count(*)::text from pg_catalog.pg_inherits where inhparent=c.oid or inhrelid=c.oid) inheritance_count,
    (select count(*)::text from pg_catalog.pg_attribute where attrelid=c.oid and attnum>0 and attisdropped) dropped_count,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name',a.attname,'data_type',pg_catalog.format_type(a.atttypid,a.atttypmod),
      'generated',a.attgenerated,'identity',a.attidentity) order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb) columns,
    coalesce((select pg_catalog.jsonb_agg(a.attname order by k.ordinality) from pg_catalog.pg_index i
      cross join lateral pg_catalog.unnest(i.indkey) with ordinality k(attnum,ordinality)
      join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
      where i.indrelid=c.oid and i.indisprimary and i.indisvalid),'[]'::jsonb) primary_key,
    coalesce((select pg_catalog.bool_and((tn.nspname='pg_catalog' and en.nspname='pg_catalog'
      and ti.pronamespace=tn.oid and tout.pronamespace=tn.oid and ei.pronamespace=en.oid and eo.pronamespace=en.oid
      and ((t.typtype='b' and e.typtype='b' and e.typname in ('bool','bytea','char','name','int8','int2','int4','text','oid','json','float4','float8',
        'bpchar','varchar','date','time','timestamp','timestamptz','interval','timetz','bit','varbit','numeric',
        'uuid','jsonb','inet','cidr','macaddr','macaddr8'))
      or (t.oid=e.oid and t.typtype='b' and e.typtype='b' and e.oid='pg_catalog.xid8'::pg_catalog.regtype
        and e.typinput=pg_catalog.to_regprocedure('pg_catalog.xid8in(pg_catalog.cstring)')
        and e.typoutput=pg_catalog.to_regprocedure('pg_catalog.xid8out(pg_catalog.xid8)')
        and ei.prolang=(select oid from pg_catalog.pg_language where lanname='internal')
        and eo.prolang=ei.prolang)
      or (t.oid=e.oid and t.typtype='r' and e.typtype='r' and e.oid='pg_catalog.tstzrange'::pg_catalog.regtype
        and e.typinput=pg_catalog.to_regprocedure('pg_catalog.range_in(pg_catalog.cstring,pg_catalog.oid,pg_catalog.int4)')
        and e.typoutput=pg_catalog.to_regprocedure('pg_catalog.range_out(pg_catalog.anyrange)')
        and ei.prolang=(select oid from pg_catalog.pg_language where lanname='internal') and eo.prolang=ei.prolang
        and exists(select 1 from pg_catalog.pg_range r
          join pg_catalog.pg_type st on st.oid=r.rngsubtype
          join pg_catalog.pg_namespace sn on sn.oid=st.typnamespace
          join pg_catalog.pg_proc si on si.oid=st.typinput join pg_catalog.pg_proc so on so.oid=st.typoutput
          join pg_catalog.pg_opclass oc on oc.oid=r.rngsubopc
          join pg_catalog.pg_namespace onsp on onsp.oid=oc.opcnamespace
          join pg_catalog.pg_am am on am.oid=oc.opcmethod
          where r.rngtypid=e.oid and r.rngsubtype='pg_catalog.timestamptz'::pg_catalog.regtype
            and r.rngcanonical=0 and r.rngcollation=0
            and r.rngsubdiff=pg_catalog.to_regprocedure('pg_catalog.tstzrange_subdiff(pg_catalog.timestamptz,pg_catalog.timestamptz)')
            and st.typtype='b' and sn.nspname='pg_catalog' and si.pronamespace=sn.oid and so.pronamespace=sn.oid
            and st.typinput=pg_catalog.to_regprocedure('pg_catalog.timestamptz_in(pg_catalog.cstring,pg_catalog.oid,pg_catalog.int4)')
            and st.typoutput=pg_catalog.to_regprocedure('pg_catalog.timestamptz_out(pg_catalog.timestamptz)')
            and si.prolang=ei.prolang and so.prolang=si.prolang
            and onsp.nspname='pg_catalog' and oc.opcname='timestamptz_ops' and oc.opcintype=st.oid and am.amname='btree'))))
      or (e.typtype='e' and e.typcategory='E' and e.typisdefined and t.typisdefined
        and e.typbasetype=0 and e.typrelid=0 and e.typelem=0 and e.typcollation=0
        and e.typlen=4 and e.typbyval and e.typdefault is null and e.typdefaultbin is null
        and tn.oid=en.oid and t.typowner=e.typowner and t.typbasetype=0 and t.typrelid=0
        and ti.pronamespace='pg_catalog'::pg_catalog.regnamespace and tout.pronamespace=ti.pronamespace
        and ei.pronamespace=ti.pronamespace and eo.pronamespace=ti.pronamespace
        and ei.oid=pg_catalog.to_regprocedure('pg_catalog.enum_in(pg_catalog.cstring,pg_catalog.oid)')
        and eo.oid=pg_catalog.to_regprocedure('pg_catalog.enum_out(pg_catalog.anyenum)')
        and ei.prosrc='enum_in' and eo.prosrc='enum_out'
        and ei.prorettype='pg_catalog.anyenum'::pg_catalog.regtype and eo.prorettype='pg_catalog.cstring'::pg_catalog.regtype
        and ti.prolang=(select oid from pg_catalog.pg_language where lanname='internal')
        and tout.prolang=ti.prolang and ei.prolang=ti.prolang and eo.prolang=ti.prolang
        and ti.proowner='supabase_admin'::pg_catalog.regrole and ti.proowner=en.nspowner and tout.proowner=ti.proowner
        and ei.proowner=ti.proowner and eo.proowner=ti.proowner
        and ti.prokind='f' and tout.prokind='f' and ei.prokind='f' and eo.prokind='f'
        and not ti.prosecdef and not tout.prosecdef and not ei.prosecdef and not eo.prosecdef
        and not ti.proretset and not tout.proretset and not ei.proretset and not eo.proretset
        and ti.proconfig is null and tout.proconfig is null and ei.proconfig is null and eo.proconfig is null
        and ti.probin is null and tout.probin is null and ei.probin is null and eo.probin is null
        and ((t.oid=e.oid and t.typtype='e' and t.typelem=0 and ti.oid=ei.oid and tout.oid=eo.oid)
          or (t.typtype='b' and t.typcategory='A' and t.typelem=e.oid and e.typarray=t.oid
            and t.typinput=pg_catalog.to_regprocedure('pg_catalog.array_in(pg_catalog.cstring,pg_catalog.oid,pg_catalog.int4)')
            and t.typoutput=pg_catalog.to_regprocedure('pg_catalog.array_out(pg_catalog.anyarray)')
            and ti.prosrc='array_in' and tout.prosrc='array_out'
            and ti.prorettype='pg_catalog.anyarray'::pg_catalog.regtype and tout.prorettype='pg_catalog.cstring'::pg_catalog.regtype))
        and not exists(select 1 from pg_catalog.pg_cast cast_row
          where cast_row.castsource in(t.oid,e.oid) or cast_row.casttarget in(t.oid,e.oid))
        and exists(select 1 from pg_catalog.jsonb_to_recordset($1::jsonb)
          d(kind text,schema_name text,type_name text,namespace_owner text,owner_name text,labels jsonb)
          where d.kind='e' and d.schema_name=en.nspname and d.type_name=e.typname
            and (select rolname from pg_catalog.pg_roles where oid=en.nspowner)=d.namespace_owner
            and (select rolname from pg_catalog.pg_roles where oid=e.typowner)=d.owner_name
            and d.labels=(select pg_catalog.jsonb_agg(label.enumlabel order by label.enumsortorder)
              from pg_catalog.pg_enum label where label.enumtypid=e.oid)
            and exists(select 1 from pg_catalog.jsonb_to_recordset($2::jsonb)
              b(schema_name text,table_name text,column_name text,type_name text,data_type text,is_array boolean)
              where b.schema_name=n.nspname and b.table_name=c.relname and b.column_name=a.attname
                and b.type_name=d.type_name and b.is_array=(t.oid<>e.oid)
                and b.data_type=pg_catalog.format_type(a.atttypid,a.atttypmod)))))
      from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid=a.atttypid
      join pg_catalog.pg_namespace tn on tn.oid=t.typnamespace
      join pg_catalog.pg_type e on e.oid=case when t.typcategory='A' then t.typelem else t.oid end
      join pg_catalog.pg_namespace en on en.oid=e.typnamespace
      join pg_catalog.pg_proc ti on ti.oid=t.typinput join pg_catalog.pg_proc tout on tout.oid=t.typoutput
      join pg_catalog.pg_proc ei on ei.oid=e.typinput join pg_catalog.pg_proc eo on eo.oid=e.typoutput
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),false) supported_io
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','custodial_employment','custodial_coverall','custodial_leadership_private') and c.relkind in ('r','p','f') order by n.nspname,c.relname`;
  try {
    const {db,verifiedArchive}=closed(options,['db','verifiedArchive']);
    const native=()=>{if(!db||types.isProxy(db)||Object.getPrototypeOf(db)!==Client.prototype
      ||Object.hasOwn(db,'query')||Client.prototype.query!==query)refuse();};
    native();const original=readVerifiedPrivateImportSource(verifiedArchive);
    const authorityData=committedAuthorityDataReads.get(db);
    if(authorityData){
      if(!authorityData.frame||!committedAuthorityOrdinaryReads.has(authorityData))refuse();
      committedAuthorityOrdinaryReads.delete(authorityData); // Only the private synchronous caller can hand this one loan.
      currentCommittedAuthorityData(db,verifiedArchive,authorityData);
      if(authorityData.state.original.sourceBinding!==original.sourceBinding)refuse();
    }
    // Retain every declared original in an UNSUPPORTED result even when the
    // new schema/type prerequisite refuses before the first target query.
    const declared=dense(original.selection.databaseTables).filter(table=>['public','auth','custodial_employment','custodial_coverall','custodial_leadership_private'].includes(table.schema_name));
    selected=declared.slice();
    const inventory=readVerifiedImmutableBootstrapInventory(verifiedArchive);
    if(inventory.sourceBinding!==original.sourceBinding)refuse();
    const enumSchema=inventory.inventory['inventory/application-schema.sql'];
    const originalEnums=deriveOriginalAuthEnumDescriptors(enumSchema);
    const source=()=>{
      native();sameSource(verifiedArchive,original);
      if(authorityData)currentCommittedAuthorityData(db,verifiedArchive,authorityData);
      // This newly consumed original dependency remains the SAME authenticated
      // schema through every existing synchronous Source/actual-await boundary.
      const current=readVerifiedImmutableBootstrapInventory(verifiedArchive);
      if(current.sourceBinding!==original.sourceBinding
        ||current.inventory['inventory/application-schema.sql']!==enumSchema)refuse();
    };
    const nativeRead=async(sql,params=[])=>{
      // Never promote a similarly coded Source/decoder/cleanup error into
      // native SQL provenance, and never replace the first failed query.
      if(originalQueryFailure)throw originalQueryFailure;
      try{return await Reflect.apply(query,db,[sql,params]);}
      catch(error){
        const redacted=Object.assign(new Error('IMMUTABLE_ORDINARY_DATA_READBACK_SQL_FAILED'),{
          code:'IMMUTABLE_ORDINARY_DATA_READBACK_SQL_FAILED',outcome:'UNKNOWN',retry_safe:false,
        });
        if(error&&typeof error==='object'&&!types.isProxy(error)){
          const field=Object.getOwnPropertyDescriptor(error,'code');
          if(field&&Object.hasOwn(field,'value')&&typeof field.value==='string'&&/^[0-9A-Z]{5}$/.test(field.value))
            redacted.sql_state=field.value;
        }
        originalQueryFailure=Object.freeze(redacted);throw originalQueryFailure;
      }
    };
    // Publish no caller-controlled IDs: this list is from the private verified
    // catalog. Retain every declared original, even when its shape is unsupported.
    const keys=new Set();let declaredRows=0n;
    if(!declared.length||declared.length>4096)refuse();
    for(const table of selected){
      if(!name(table.table_name)||keys.has(key(table))||!decimal(table.row_count)
        ||table.data_file!==`database/${table.schema_name}.${table.table_name}.jsonl`
        ||![postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding].includes(table.data_encoding))refuse();
      keys.add(key(table));declaredRows+=BigInt(table.row_count);
      dense(table.columns);dense(table.primary_key);
      if(!table.columns.length||table.columns.some(column=>{
        const c=closed(column,['name','data_type','generated','identity']);
        return !name(c.name)||typeof c.data_type!=='string'||!c.data_type||!['','s'].includes(c.generated)||!['','a','d'].includes(c.identity);
      })||new Set(table.columns.map(c=>c.name)).size!==table.columns.length
        ||new Set(table.primary_key).size!==table.primary_key.length
        ||table.primary_key.some(column=>!table.columns.some(c=>c.name===column)))refuse();
    }
    if(!selected.some(t=>t.schema_name==='auth')||[...bootstrap].some(id=>!selected.some(t=>`${t.schema_name}.${t.table_name}`===id))
      ||declaredRows>65536n)refuse();
    const enumColumns=[];
    for(const table of selected)for(const column of table.columns){
      if(!column.data_type.startsWith('auth.'))continue;
      const descriptor=originalEnums.find(entry=>column.data_type===`auth.${entry.type_name}`
        ||column.data_type===`auth.${entry.type_name}[]`);
      if(!descriptor)refuse();
      enumColumns.push(Object.freeze({schema_name:table.schema_name,table_name:table.table_name,column_name:column.name,
        type_name:descriptor.type_name,data_type:column.data_type,is_array:column.data_type.endsWith('[]')}));
    }
    // Only closed derived metadata is serialized. Original row JSON strings
    // never pass through JSON.parse/stringify or JS numeric/date conversion.
    const enumParameters=Object.freeze([JSON.stringify(originalEnums),JSON.stringify(enumColumns)]);
    let originalContext;
    const context=async()=>{
      source();const reply=await nativeRead(contextSql);source();const observed=rows(reply);
      if(observed.length!==1)refuse();
      const value=closed(closed(observed[0],['context']).context,['database_oid','database_name','backend_pid','actor','session_actor',
        'transaction_id','virtual_xid','snapshot_id','transaction_started_at','read_only','isolation','row_security','search_path','first_schema',
        'timezone','date_style','interval_style','float_digits']);
      if(!oid(value.database_oid)||!name(value.database_name)||!Number.isInteger(value.backend_pid)||value.backend_pid<=0||value.backend_pid>2147483647
        ||!name(value.actor)||value.actor!==value.session_actor
        ||(value.transaction_id!==null&&(!decimal(value.transaction_id)||value.transaction_id==='0'))
        ||typeof value.virtual_xid!=='string'||!(/^[1-9][0-9]*\/[1-9][0-9]*$/).test(value.virtual_xid)
        ||typeof value.snapshot_id!=='string'||!(/^[0-9]+:[0-9]+:[0-9,]*$/).test(value.snapshot_id)
        ||typeof value.transaction_started_at!=='string'||!value.transaction_started_at
        ||value.read_only!=='on'||value.isolation!=='repeatable read'||value.row_security!=='off'
        ||!['pg_catalog','pg_catalog, pg_temp'].includes(value.search_path)||value.first_schema!=='pg_catalog'
        ||['timezone','date_style','interval_style','float_digits'].some(k=>typeof value[k]!=='string'||!value[k])
        ||!['1','2','3'].includes(value.float_digits))refuse();
      if(originalContext&&!isDeepStrictEqual(value,originalContext))refuse();originalContext??=Object.freeze(value);
      if(authorityData){await readCommittedAuthorityFrame(db,verifiedArchive,authorityData);source();}
    };
    const boundary=async()=>{source();await context();source();};
    const read=async(sql,params=[])=>{
      await boundary();source();const result=await nativeRead(sql,params);source();await boundary();source();return rows(result);
    };
    let originalTextHelpers;
    const textHelpersCurrent=async()=>{
      const values=await read(immutableTextHelperSourceSql);source();
      originalTextHelpers=immutableTextHelperSource(values,originalTextHelpers);
    };
    const catalog=await read(catalogSql,enumParameters),byId=new Map();
    for(const row of catalog){
      const c=closed(row,['schema_name','table_name','relation_oid','relation_kind','persistence','is_partition','owner_name',
        'inheritance_count','dropped_count','columns','primary_key','supported_io']);
      if(!['public','auth','custodial_employment','custodial_coverall','custodial_leadership_private'].includes(c.schema_name)||!name(c.table_name)||byId.has(key(c))||!oid(c.relation_oid))refuse();
      byId.set(key(c),c);
    }
    if(new Set(catalog.map(c=>c.relation_oid)).size!==catalog.length)refuse();
    const scopeExact=byId.size===keys.size&&[...keys].every(id=>byId.has(id));
    let encodedBytes=0,rawBytes=0;const summaries=[];
    for(const table of selected){
      await boundary();source();
      if(table.data_encoding===postgresTextColumnsLineEncoding&&table.row_count!=='0'){await textHelpersCurrent();source();}
      const data=openVerifiedRestoreTableData(verifiedArchive,table.schema_name,table.table_name);
      const originalRows=[];loans.push(originalRows);
      const isBootstrap=bootstrap.has(`${table.schema_name}.${table.table_name}`),actual=byId.get(key(table));
      const supported=scopeExact&&actual?.relation_kind==='r'&&actual.persistence==='p'&&actual.is_partition===false
        &&name(actual.owner_name)&&actual.inheritance_count==='0'&&actual.dropped_count==='0'&&actual.supported_io===true
        &&isDeepStrictEqual(actual.columns,table.columns)&&isDeepStrictEqual(actual.primary_key,table.primary_key);
      // Read-only composite population keeps ALL supplied generated/identity
      // DATA. No INSERT/default/generated expression is executed or projected
      // away; those exact flags still match the verified column metadata above.
      let guard,decoder,settled,failure,count=0,fileBytes=0;const cleanup=[];
      const observe=chunk=>{
        fileBytes+=chunk.length;encodedBytes+=chunk.length;
        if(encodedBytes>16777216)guard.destroy(new Error('Ordinary original wire resource bound exceeded'));
      };
      try {
        if(!isDeepStrictEqual(data.table,table))refuse();
        guard=createRestoreRowUtf8Guard();guard.on('data',observe);decoder=createRestoreRowLineBatchDecoder();
        settled=pipeline(data.stream,guard,decoder);settled.catch(()=>{});
        const iterator=decoder[Symbol.asyncIterator]();
        while(true){
          // This is owned archive I/O, not a database command or an exposed
          // result. Keep SAME private native/Source ancestry around every
          // actual await. The unchanged read() below freshly checks the full
          // original server frame before AND after every subsequent SQL read;
          // a transaction/owner/epoch change during I/O therefore refuses
          // before DATA comparison or any positive result can be consumed.
          source();const next=await iterator.next();source();
          if(next.done)break;dense(next.value);
          // No await, SQL or caller callback inside an authenticated chunk's
          // synchronous line loop. Local Source ancestry is checked for each
          // actual batch yield; read() still owns the fresh server boundaries.
          for(const line of next.value){
            if(BigInt(count)>=BigInt(table.row_count))refuse();
            const raw=decodeRestoreTableRowLine(line,data.table);count++;
            rawBytes+=Buffer.byteLength(raw,'utf8');if(rawBytes>8388608)refuse();
            if(supported)originalRows.push(raw);
          }
          source();
        }
        source();await settled;source();
        source();const eof=await data.verified;source();
        // This genuine archive reader has ALREADY compared its private signed
        // checksum/file pin. No public checksum map or caller hash is consulted.
        if(eof.data_file!==table.data_file||!(/^[a-f0-9]{64}$/).test(eof.sha256)
          ||!Number.isSafeInteger(eof.bytes)||eof.bytes!==fileBytes||String(count)!==table.row_count)refuse();
      } catch(error){failure=error;}
      finally {
        const check=async()=>{try{source();}catch(error){cleanup.push(error);}};
        data.stream.destroy();guard?.destroy();decoder?.destroy();
        if(settled){await check();try{await settled;}catch(error){if(error!==failure)cleanup.push(error);}await check();}
        await check();try{await data.close();}catch(error){cleanup.push(error);}await check();guard?.off('data',observe);
      }
      if(failure||cleanup.length)refuse();
      const authorityTarget=authorityData&&committedAuthorityTargets.find(row=>row.schema===table.schema_name&&row.table===table.table_name);
      if(authorityTarget){
        if(!supported){summaries.push(summary(table,'UNSUPPORTED',String(count)));continue;}
        // No caller-selected relation/column/expected-row model. All six are
        // fixed current Source, admitted only by the live private descriptor.
        const required=authorityTarget.changed.map(name=>({name,data_type:name==='enabled'?'boolean'
          :['revoked_at','updated_at'].includes(name)?'timestamp with time zone':'text'}));
        required.push({name:authorityTarget.primaryKey,data_type:'uuid'});
        if(!isDeepStrictEqual(table.primary_key,[authorityTarget.primaryKey])
          ||required.some(field=>!table.columns.some(column=>column.name===field.name&&column.data_type===field.data_type
            &&column.generated===''&&column.identity==='')))refuse();
        source();
        if(table.data_encoding===postgresTextColumnsLineEncoding){await textHelpersCurrent();source();}
        const compared=await read(committedAuthorityImageSql(authorityTarget,table.data_encoding),[originalRows,
          'disaster_restore_generation_'+authorityData.completion.authority_generation,authorityData.frame.effect_transaction_started_at]);
        if(table.data_encoding===postgresTextColumnsLineEncoding){await textHelpersCurrent();source();}
        source();if(compared.length!==1)refuse();
        const counts=closed(compared[0],['original_rows','original_keys','transformed_rows','expected_rows','current_rows','missing_rows','extra_rows','clock_fields_valid']);
        if(!Object.entries(counts).filter(([key])=>key!=='clock_fields_valid').every(([,value])=>decimal(value))
          ||typeof counts.clock_fields_valid!=='boolean'||counts.original_rows!==table.row_count||counts.original_keys!==counts.original_rows
          ||counts.transformed_rows!==authorityData.completion.revocations[authorityTarget.counter]
          ||counts.expected_rows!==(authorityTarget.schema==='auth'?'0':counts.original_rows)
          ||BigInt(counts.transformed_rows)>BigInt(counts.original_rows)||BigInt(counts.missing_rows)>BigInt(counts.expected_rows)
          ||BigInt(counts.extra_rows)>BigInt(counts.current_rows)
          ||BigInt(counts.expected_rows)-BigInt(counts.missing_rows)!==BigInt(counts.current_rows)-BigInt(counts.extra_rows))refuse();
        const state=counts.missing_rows==='0'&&counts.extra_rows==='0'&&counts.clock_fields_valid
          ?(counts.transformed_rows==='0'?'MATCH':sourceVerified):'DIFFERENT';
        summaries.push(summary(table,state,counts.original_rows,{current_rows:counts.current_rows,missing_rows:counts.missing_rows,
          extra_rows:counts.extra_rows,expected_rows:counts.expected_rows,source_transformed_rows:counts.transformed_rows,
          clock_fields_valid:counts.clock_fields_valid,transformation:'COMMITTED_IMMUTABLE_AUTHORITY',metadata_only:true}));
        originalRows.length=0;continue;
      }
      if(isBootstrap){
        if(!supported){summaries.push(summary(table,'UNSUPPORTED',String(count)));continue;}
        if(!bootstrapSource){
          await boundary();source();
          const prepared=await prepareVerifiedImmutableBootstrapSource(verifiedArchive);
          source();await boundary();source();
          bootstrapSource=prepared;
        }
        const expectedCurrent=()=>{
          source();
          const expected=readVerifiedImmutableBootstrapSourceRows(bootstrapSource,verifiedArchive);
          if(expected.sourceBinding!==original.sourceBinding||expected.metadata_only!==true)refuse();
          source();return expected;
        };
        const expected=expectedCurrent();
        const matches=expected.tables.filter(row=>row.schema_name===table.schema_name&&row.table_name===table.table_name);
        if(matches.length!==1)refuse();
        const expectation=matches[0];
        if(expectation.owner_name!==actual.owner_name||actual.owner_name!==originalContext.actor
          ||!isDeepStrictEqual(expectation.originalRows,originalRows))refuse();
        // SAME fixed image transformation as the initializer, applied to raw
        // original JSON only in PostgreSQL. Target rows never define expected
        // Source, and every untouched key/value remains in the complete image.
        const target=table.table_name==='custodial_release_authority_restore_inventory'
          ?'"public"."custodial_release_authority_restore_inventory"':'"public"."release_deployment_manifest"';
        const textColumns=table.data_encoding===postgresTextColumnsLineEncoding;
        const registry=table.table_name==='custodial_release_authority_restore_inventory';
        // Only the fixed TEXT definition columns may be patched. Decode the
        // complete native row FIRST; unmentioned JSON/null/array values remain
        // typed Datums, never a jsonb copy of the whole original row.
        if(textColumns&&registry&&['object_kind','object_identity','definition_sql','definition_sha256'].some(name=>
          !table.columns.some(column=>column.name===name&&column.data_type==='text'&&column.generated===''&&column.identity==='')))refuse();
        expectedCurrent();
        if(textColumns){await textHelpersCurrent();expectedCurrent();}
        const compared=await read(textColumns?`with original as materialized (
            select r image from pg_catalog.unnest($1::text[]) raw(original_json)
            cross join lateral custodial_dr.immutable_import_text_record(null::${target},raw.original_json) r
          ), source_recipe as materialized (select $2::jsonb replacements), expected as materialized (
            select o.image,${registry?`case when (o.image).object_kind='function' and source_recipe.replacements ? ((o.image).object_identity)
              then pg_catalog.json_populate_record(o.image,pg_catalog.json_build_object(
                'definition_sql',source_recipe.replacements->((o.image).object_identity)->>'definition_sql',
                'definition_sha256',source_recipe.replacements->((o.image).object_identity)->>'definition_sha256'))
              else o.image end`:'o.image'} expected_image from original o cross join source_recipe
          ), expected_rows as materialized (
            select custodial_dr.immutable_import_text_projection(e.expected_image) collate "C" row_data from expected e
          ), current_rows as materialized (
            select custodial_dr.immutable_import_text_projection(t) collate "C" row_data from only ${target} t
          ), missing as (select row_data from expected_rows except all select row_data from current_rows),
          extra as (select row_data from current_rows except all select row_data from expected_rows)
          select (select count(*)::text from original) original_rows,(select count(*)::text from expected_rows) expected_rows,
            (select count(*)::text from current_rows) current_rows,(select count(*)::text from missing) missing_rows,
            (select count(*)::text from extra) extra_rows,
            (select count(*)::text from expected where custodial_dr.immutable_import_text_projection(image) collate "C"
              is distinct from custodial_dr.immutable_import_text_projection(expected_image) collate "C") transformed_rows`
          :`with original as materialized (
            select original_json::json image from pg_catalog.unnest($1::text[]) raw(original_json)
          ), expected as materialized (
            select image,case when image->>'object_kind'='function' and $2::jsonb ? (image->>'object_identity')
              then jsonb_set(jsonb_set(image::jsonb,'{definition_sql}',$2::jsonb->(image->>'object_identity')->'definition_sql'),
                '{definition_sha256}',$2::jsonb->(image->>'object_identity')->'definition_sha256')::json
              else image end expected_image from original
          ), expected_rows as materialized (
            select pg_catalog.row_to_json(r)::text collate "C" row_data from expected e
            cross join lateral pg_catalog.json_populate_record(null::${target},e.expected_image) r
          ), current_rows as materialized (
            select pg_catalog.row_to_json(t)::text collate "C" row_data from only ${target} t
          ), missing as (select row_data from expected_rows except all select row_data from current_rows),
          extra as (select row_data from current_rows except all select row_data from expected_rows)
          select (select count(*)::text from original) original_rows,(select count(*)::text from expected_rows) expected_rows,
            (select count(*)::text from current_rows) current_rows,(select count(*)::text from missing) missing_rows,
            (select count(*)::text from extra) extra_rows,
            (select count(*)::text from expected where image::jsonb is distinct from expected_image::jsonb) transformed_rows`,
          [originalRows,JSON.stringify(expectation.replacements)]);
        expectedCurrent();
        if(textColumns){await textHelpersCurrent();expectedCurrent();}
        if(compared.length!==1)refuse();
        const counts=closed(compared[0],['original_rows','expected_rows','current_rows','missing_rows','extra_rows','transformed_rows']);
        if(!Object.values(counts).every(decimal)||counts.original_rows!==table.row_count||counts.expected_rows!==counts.original_rows
          ||BigInt(counts.transformed_rows)>BigInt(counts.original_rows)||BigInt(counts.missing_rows)>BigInt(counts.expected_rows)
          ||BigInt(counts.extra_rows)>BigInt(counts.current_rows)
          ||BigInt(counts.expected_rows)-BigInt(counts.missing_rows)!==BigInt(counts.current_rows)-BigInt(counts.extra_rows))refuse();
        const state=counts.missing_rows==='0'&&counts.extra_rows==='0'
          ?(counts.transformed_rows==='0'?'MATCH':sourceVerified):'DIFFERENT';
        summaries.push(summary(table,state,counts.original_rows,{current_rows:counts.current_rows,missing_rows:counts.missing_rows,
          extra_rows:counts.extra_rows,source_transformed_rows:counts.transformed_rows,metadata_only:true}));
        originalRows.length=0;continue;
      }
      if(!supported){summaries.push(summary(table,'UNSUPPORTED',String(count)));continue;}
      const target=quote(table.schema_name)+'.'+quote(table.table_name);
      if(table.row_count==='0'){
        // Authenticated row count AND genuine signed file EOF above prove an
        // empty original multiset, never an empty target. Count EVERY actual
        // target row under the same native read()/frame/catalog guards. All
        // current rows are necessarily extras, so no typed DATA decoder or
        // Source helper is invoked (or trusted) on this exact zero-row path.
        if(count!==0||originalRows.length!==0)refuse();
        const compared=await read(`select pg_catalog.count(*)::text current_rows from only ${target}`);
        if(compared.length!==1)refuse();
        const counts=closed(compared[0],['current_rows']);if(!decimal(counts.current_rows))refuse();
        summaries.push(summary(table,counts.current_rows==='0'?'MATCH':'DIFFERENT','0',{
          current_rows:counts.current_rows,missing_rows:'0',extra_rows:counts.current_rows}));
        continue;
      }
      const textColumns=table.data_encoding===postgresTextColumnsLineEncoding;
      const decode=textColumns?'custodial_dr.immutable_import_text_record':'pg_catalog.json_populate_record';
      const project=textColumns?'custodial_dr.immutable_import_text_projection':'pg_catalog.row_to_json';
      if(textColumns){await textHelpersCurrent();source();}
      const compared=await read(`with original_rows as materialized (
          select ${project}(r)::text collate "C" row_data from pg_catalog.unnest($1::text[]) raw(original_json)
          cross join lateral ${decode}(null::${target},raw.original_json${textColumns?'':'::json'}) r
        ), current_rows as materialized (select ${project}(t)::text collate "C" row_data from only ${target} t),
        missing as (select row_data from original_rows except all select row_data from current_rows),
        extra as (select row_data from current_rows except all select row_data from original_rows)
        select (select count(*)::text from original_rows) original_rows,(select count(*)::text from current_rows) current_rows,
          (select count(*)::text from missing) missing_rows,(select count(*)::text from extra) extra_rows`,[originalRows]);
      if(textColumns){await textHelpersCurrent();source();}
      if(compared.length!==1)refuse();const counts=closed(compared[0],['original_rows','current_rows','missing_rows','extra_rows']);
      if(!Object.values(counts).every(decimal)||counts.original_rows!==table.row_count||BigInt(counts.missing_rows)>BigInt(counts.original_rows)
        ||BigInt(counts.extra_rows)>BigInt(counts.current_rows)
        ||BigInt(counts.original_rows)-BigInt(counts.missing_rows)!==BigInt(counts.current_rows)-BigInt(counts.extra_rows))refuse();
      const {original_rows,...currentCounts}=counts;
      summaries.push(summary(table,counts.missing_rows==='0'&&counts.extra_rows==='0'?'MATCH':'DIFFERENT',original_rows,currentCounts));
      originalRows.length=0;
    }
    const finalCatalog=await read(catalogSql,enumParameters);if(!isDeepStrictEqual(finalCatalog,catalog))refuse();await boundary();source();
    if(bootstrapSource){
      const expected=readVerifiedImmutableBootstrapSourceRows(bootstrapSource,verifiedArchive);
      if(expected.sourceBinding!==original.sourceBinding)refuse();source();
    }
    if(originalTextHelpers!==undefined){await textHelpersCurrent();source();}
    const state=summaries.some(t=>t.state==='UNSUPPORTED')?'UNSUPPORTED':summaries.some(t=>t.state==='DIFFERENT')?'DIFFERENT'
      :summaries.some(t=>t.state===sourceVerified)?sourceVerified:'MATCH';
    return Object.freeze({state,tables:Object.freeze(summaries)});
  } catch {
    // No raw row/SQL/session detail or missing-as-empty proof is exposed.
    if(originalQueryFailure?.sql_state)throw originalQueryFailure;
    return unknown();
  } finally {for(const rows of loans)rows.length=0;} // Strings are not claimed wipeable.
}
