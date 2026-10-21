#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as backupWire from "./production-backup-pg-dump-command.mjs";
import {
  productionBackupPgDumpDockerArgs,
  productionBackupDataSchemas,
  productionBackupSnapshotStatements,
  requireProductionBackupDataScope,
  productionBackupRowCount,
  requireProductionBackupPage,
} from "./production-backup-pg-dump-command.mjs";

// NEW post-capture profile/lifecycle join only. Execute shipping recheck and
// outer cleanup fragments, with inert ports; not PostgreSQL/runtime evidence.
if (process.argv.includes("--storage-original-json-profile-only")) {
  const source=readFileSync(new URL("./production-backup.mjs",import.meta.url),"utf8");
  const a=source.indexOf("  // Re-enter the original native text profile"),z=source.indexOf("  const archived = finishRawStorageObjectArchiveRow",a);
  const c=source.indexOf("} catch (error) {\n  backupLifecycleFailed = true;"),d=source.indexOf("await finishBackupArtifacts();",c);
  const p=source.indexOf("const backupNativeTextOutputStatements"),q=source.indexOf("function walkFiles(",p);
  assert.ok(a>0&&z>a&&c>z&&d>c&&p>0&&q>p);
  const profile=new Function(source.slice(p,q)+"\nreturn backupNativeTextOutputStatements;")();
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const execute=new AsyncFunction("ports","const {client,original,object,storageConsistencyProjection,"+
    "backupNativeTextOutputStatements,encodeProductionBackupTextColumnsDataRow,endBackupClient}=ports;"+
    "let backupTransactionMayBeOpen=false,backupLifecycleFailed=false,backupLifecycleFailure;"+
    "const backupCleanupErrors=[];try {\n"+source.slice(a,z)+"\n"+source.slice(c,d)+
    "\nreturn {transaction_may_be_open:backupTransactionMayBeOpen};");
  const expected=JSON.stringify({id:"UNIT-object",created_at:"2026-10-18 00:00:00+00",metadata:'{"precise":0.123456789012345678901234567890}'});
  let checks=0;
  for (const mode of ["normal","begin-unknown","profile-failure","read-failure","end-snapshot-unknown","first-falsy-plus-end-error"]) {
    const seen=[],local=new Set();let open=false,ended=0,injected=false,rollbacks=0;
    const first=mode==="first-falsy-plus-end-error"?0:Object.freeze({UNIT_original_failure:mode});
    const client={async query(sql,args) {
      seen.push(sql);
      const fail=mode==="begin-unknown"&&sql.startsWith("begin ")
        || mode==="profile-failure"&&sql==="set local timezone = 'UTC'"
        || mode==="read-failure"&&sql.startsWith("select ")
        || mode==="end-snapshot-unknown"&&sql==="rollback"
        || mode==="first-falsy-plus-end-error"&&sql.startsWith("select ");
      if (sql.startsWith("begin ")) {open=true;assert.equal(sql,"begin isolation level repeatable read read only");}
      if (sql==="rollback") rollbacks++;
      if (fail&&!injected) {injected=true;throw first;}
      if (sql.startsWith("set local ")) {assert.equal(open,true);local.add(sql);return {};}
      if (sql==="rollback") {open=false;local.clear();return {};}
      if (sql.startsWith("select ")) {
        assert.equal(open,true);assert.ok(local.has("set local row_security = off"));
        assert.deepEqual(args,["UNIT-bucket","UNIT-object"]);assert.ok(sql.includes(" consistency from storage.objects snapshot_row"));
        const complete=profile.every(s=>local.has(s));
        return {rowCount:1,rows:[{consistency:complete?expected:expected.replace("+00","-05")}]};
      }
      return {};
    }};
    const endBackupClient=async()=>{ended++;if(mode==="first-falsy-plus-end-error")throw Error("UNIT_cleanup");};
    let completed=false,failure;
    try {const result=await execute({client,original:{consistency:expected},object:{id:"UNIT-object",bucket_id:"UNIT-bucket",name:"UNIT-object"},
      storageConsistencyProjection:"pg_catalog.json_object(ARRAY['id'], ARRAY['UNIT-object'])::text",
      backupNativeTextOutputStatements:profile,encodeProductionBackupTextColumnsDataRow:backupWire.encodeProductionBackupTextColumnsDataRow,endBackupClient});
      completed=true;assert.equal(result.transaction_may_be_open,false);
    } catch (error) {failure=error;}
    assert.equal(ended,1);assert.equal(open,false);
    if (mode==="normal") {assert.equal(completed,true);assert.equal(rollbacks,1);assert.deepEqual(seen.slice(2,2+profile.length),profile);}
    else {assert.equal(completed,false);assert.equal(injected,true);
      if(mode==="first-falsy-plus-end-error"){assert.ok(failure instanceof AggregateError);assert.equal(failure.cause,first);assert.equal(failure.errors[0],first);}
      else assert.equal(failure,first);
      assert.ok(rollbacks>=1);
    }
    checks++;
  }
  console.log(JSON.stringify({scope:"NEW_STORAGE_POST_CAPTURE_NATIVE_TEXT_PROFILE_AND_OWNED_CLEANUP",checks,
    SQL:false,provider:false,old_groups_replayed:0,resources:0}));
  process.exit(0);
}

// NEW affected Storage producer only: execute the shipping helpers/capture and
// post-download consistency fragments using inert ports. No backup entrypoint,
// credentials, network, archive rewrite, old group or SQL/runtime PASS.
if (process.argv.includes("--storage-original-json-producer-only")) {
  const source = readFileSync(new URL("./production-backup.mjs", import.meta.url), "utf8");
  const {storageObjectArchivePath, validateV4StorageArchiveObjects} = await import("./disaster-recovery-storage.mjs");
  const helpers = source.slice(source.indexOf("function encodeRawStorageInventoryRows("), source.indexOf("function quoteIdentifier("));
  const writes = [], modes = [];
  const ports = new Function("writeFileSync", "chmodSync", helpers +
    "\nreturn {encodeRawStorageInventoryRows,finishRawStorageObjectArchiveRow,writeRawStorageInventory};")(
      (path, bytes, options) => writes.push({path, bytes, options}), (path, mode) => modes.push({path, mode}));
  const metadata = '{"integer":9007199254740993,"precise":0.123456789012345678901234567890}';
  const user = '{ "original" : { "value" : 9223372036854775807 } }';
  const row = '{"id":"UNIT-object","bucket_id":"UNIT-bucket","name":"original.txt","owner_id":null,"owner":null,' +
    '"metadata":' + metadata + ',"user_metadata":' + user + ',"version":"UNIT-version",' +
    '"created_at":"2026-10-18T00:00:00+00:00","updated_at":"2026-10-18T00:00:00+00:00","last_accessed_at":null}';
  const values = JSON.parse(row);
  const template = '{"id":"UNIT-object","bucket_id":"UNIT-bucket","name":"original.txt","metadata":' + metadata +
    ',"user_metadata":' + user + ',"version":"UNIT-version","created_at":"2026-10-18T00:00:00+00:00",' +
    '"updated_at":"2026-10-18T00:00:00+00:00","database_row":' + row + '}';
  const file = storageObjectArchivePath(values.bucket_id, values.name), digest = "a".repeat(64);
  let checks = 0;
  const archived = ports.finishRawStorageObjectArchiveRow(template, {file, size_bytes: 3, sha256: digest});
  if (!process.argv.includes("--storage-original-json-producer-remaining")) {
  assert.equal(values.metadata.integer, 9007199254740992); // Retained original counterexample, never DATA.
  assert.ok(archived.includes('"metadata":' + metadata) && archived.includes('"database_row":' + row));
  assert.ok(archived.includes(user)); validateV4StorageArchiveObjects([JSON.parse(archived)]); checks++;
  const array = ports.encodeRawStorageInventoryRows([row, archived]);
  assert.equal(array, '[\n' + row + ',\n' + archived + '\n]\n'); checks++;
  ports.writeRawStorageInventory("/UNIT/inert/storage-objects.json", [archived]);
  assert.equal(writes[0].bytes, ports.encodeRawStorageInventoryRows([archived]));
  assert.deepEqual(writes[0].options, {mode: 0o600}); assert.equal(modes[0].mode, 0o600); checks++;
  for (const bad of [null, [], {row}, "null", "[]", "{"]) {
    assert.throws(() => ports.encodeRawStorageInventoryRows([bad])); checks++;
  }
  for (const size of [-1, Number.MAX_SAFE_INTEGER + 1, 1n]) {
    assert.throws(() => ports.finishRawStorageObjectArchiveRow(template, {file, size_bytes: size, sha256: digest})); checks++;
  }
  assert.throws(() => ports.finishRawStorageObjectArchiveRow(archived, {file, size_bytes: 3, sha256: digest})); checks++;
  }
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const projectionStart = source.indexOf("function quoteIdentifier(");
  const projectionEnd = source.indexOf("const backupNativeTextOutputStatements", projectionStart);
  assert.ok(projectionStart > 0 && projectionEnd > projectionStart);
  const {types} = await import("node:util");
  const projection = new Function("types", "Buffer", source.slice(projectionStart, projectionEnd) +
    "\nreturn backupTextColumnsProjection;")(types, Buffer);
  const columns = ["id","bucket_id","name","owner_id","owner","metadata","user_metadata","version","created_at","updated_at","last_accessed_at"].map(name => ({name}));
  const state = JSON.stringify(Object.fromEntries(columns.filter(c => c.name !== "last_accessed_at")
    .map(c => [c.name, c.name === "metadata" ? metadata : c.name === "user_metadata" ? user : values[c.name] === null ? null : String(values[c.name])])));
  const captureStart = source.indexOf("  const buckets = await client.query(");
  const captureEnd = source.indexOf("  // Type identities", captureStart);
  const queries = [];
  const capture = new AsyncFunction("p", "const {client,tableCatalog,backupTextColumnsProjection,encodeRawStorageInventoryRows," +
    "encodeProductionBackupTextColumnsDataRow,storageOwnerPrincipalId}=p; const storageBuckets=[],storageObjects=[];" +
    "let storageConsistencyProjection=null;" + source.slice(captureStart, captureEnd) +
    "\nreturn {storageBuckets,storageObjects,storageConsistencyProjection};");
  const {storageOwnerPrincipalId} = await import("./disaster-recovery-storage.mjs");
  const captured = await capture({tableCatalog:[{schema_name:"storage",table_name:"objects",columns}],
    backupTextColumnsProjection:projection, encodeRawStorageInventoryRows:ports.encodeRawStorageInventoryRows,
    encodeProductionBackupTextColumnsDataRow:backupWire.encodeProductionBackupTextColumnsDataRow, storageOwnerPrincipalId,
    client:{async query(sql) { queries.push(sql); return queries.length === 1
      ? {rows:[{row:'{"id":"UNIT-bucket","file_size_limit":9223372036854775807}'}]}
      : {rows:[{row, consistency:state, archive_row:template}]}; }}});
  assert.ok(queries[0].includes("row_to_json(b)::text"));
  assert.ok(queries[1].includes("row_to_json(snapshot_row)::text") && queries[1].includes(")::text archive_row"));
  assert.ok(captured.storageConsistencyProjection.includes('snapshot_row."metadata"::text'));
  assert.ok(!captured.storageConsistencyProjection.includes('snapshot_row."last_accessed_at"'));
  assert.equal(captured.storageObjects[0].archive_row, template); assert.equal(captured.storageObjects[0].consistency, state); checks++;
  const readStart = source.indexOf("  const current = await client.query(", source.indexOf("for (const original of storageObjects)"));
  const readEnd = source.indexOf("  originalObjectManifestText.push(archived);", readStart);
  const recheck = new AsyncFunction("p", "const {client,storageConsistencyProjection,object,original,file,outputPath," +
    "statSync,sha256File,encodeProductionBackupTextColumnsDataRow,finishRawStorageObjectArchiveRow}=p;" +
    "let backupTransactionMayBeOpen=true;" + source.slice(readStart, readEnd) + "\nreturn archived;");
  const run = (after, count=1) => recheck({storageConsistencyProjection:captured.storageConsistencyProjection,
    object:values, original:captured.storageObjects[0], file, outputPath:"/UNIT/inert/original",
    statSync:() => ({size:3}), sha256File:async()=>digest,
    encodeProductionBackupTextColumnsDataRow:backupWire.encodeProductionBackupTextColumnsDataRow,
    finishRawStorageObjectArchiveRow:ports.finishRawStorageObjectArchiveRow,
    client:{async query(sql,args){if(sql==="rollback")return {};assert.ok(sql.includes(" consistency from storage.objects snapshot_row"));
      assert.deepEqual(args,[values.bucket_id,values.name]); return {rowCount:count,rows:[{consistency:after}]};}}});
  assert.equal(await run(state), archived); checks++;
  await assert.rejects(run(state.replace("9007199254740993","9007199254740992")), /changed during backup/); checks++;
  await assert.rejects(run(state.replace("0.123456789012345678901234567890","0.12345678901234568")), /changed during backup/); checks++;
  const sqlNull = JSON.stringify({...JSON.parse(state),metadata:null});
  const jsonNull = JSON.stringify({...JSON.parse(state),metadata:"null"});
  assert.notEqual(sqlNull,jsonNull);
  await assert.rejects(run(sqlNull), /changed during backup/);
  await assert.rejects(run(jsonNull), /changed during backup/); checks++;
  await assert.rejects(run(state,0), /changed or disappeared/); checks++;
  const finishStart = source.indexOf("validateV4StorageArchiveObjects(objectManifest);");
  const finishEnd = source.indexOf("\nconst summary =", finishStart);
  new Function("validateV4StorageArchiveObjects","objectManifest","writeRawStorageInventory","join","backupDir","originalObjectManifestText",
    source.slice(finishStart,finishEnd))(validateV4StorageArchiveObjects,[JSON.parse(archived)],ports.writeRawStorageInventory,
      (...parts)=>parts.join("/"),"/UNIT/inert",[archived]);
  assert.equal(writes.at(-1).bytes, ports.encodeRawStorageInventoryRows([archived])); checks++;
  console.log(JSON.stringify({scope:"NEW_STORAGE_ORIGINAL_JSON_PRODUCER_ONLY",checks,
    SQL:false,provider:false,credentials:false,production:false,whole_G31:false,old_groups_replayed:0}));
  process.exit(0);
}

// NEW isolated producer join only. Run exact private projection/capture
// fragments with inert recorders; never import the backup entrypoint.
if(process.argv.includes('--native-text-columns-producer-only')){
 const part=process.argv.find(arg=>arg.startsWith('--text-producer-case='))?.split('=')[1];
 assert.ok(part===undefined||['projection','capture','snapshot'].includes(part));
 const want=name=>part===undefined||part===name;let cases=0,groups=0;
 const {types}=await import('node:util'),{Writable}=await import('node:stream'),{finished}=await import('node:stream/promises');
 const {createHash}=await import('node:crypto');
 const source=readFileSync(new URL('./production-backup.mjs',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(readFileSync(new URL('./production-backup-pg-dump-command.mjs',import.meta.url))).digest('hex'),
  '1eab2cbf085be4feae2f6db7fb71e93096acbaf8e0ccf5c859e7a10f9ed870ab');
 const helperStart=source.indexOf('function quoteIdentifier(value) {'),helperEnd=source.indexOf('function walkFiles(directory) {',helperStart);
 assert.ok(helperStart>0&&helperEnd>helperStart);
 const {quoteIdentifier,qualified,backupTextColumnsProjection:projection,backupNativeTextOutputStatements:settings}=
  new Function('types','Buffer',source.slice(helperStart,helperEnd)+'\nreturn {quoteIdentifier,qualified,backupTextColumnsProjection,backupNativeTextOutputStatements};')(types,Buffer);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 if(want('projection')){
  const fields=[['simple',"E'simple'",'snapshot_row."simple"::text'],
   ["single'quote","E'single''quote'",'snapshot_row."single\'quote"::text'],
   ['back\\slash',String.raw`E'back\\slash'`,String.raw`snapshot_row."back\slash"::text`],
   ['double"quote',`E'double"quote'`,'snapshot_row."double""quote"::text'],
   ["\\';DROP",String.raw`E'\\'';DROP'`,String.raw`snapshot_row."\';DROP"::text`],
   ['line\n雪',"E'line\n雪'",'snapshot_row."line\n雪"::text']];
  const columns=fields.map(([name],i)=>({name,generated:i===1?'s':'',identity:i===2?'a':'',data_type:'text'}));
  assert.equal(projection(columns),'pg_catalog.json_object(ARRAY['+fields.map(f=>f[1]).join(',')+']::text[], ARRAY['
   +fields.map(f=>f[2]).join(',')+']::text[])::text');cases++;
  assert.equal(projection([{name:'__proto__'},{name:'constructor'},{name:' trailing '},{name:'A'},{name:'a'}]),
   'pg_catalog.json_object(ARRAY[E\'__proto__\',E\'constructor\',E\' trailing \',E\'A\',E\'a\']::text[], ARRAY[snapshot_row."__proto__"::text,snapshot_row."constructor"::text,snapshot_row." trailing "::text,snapshot_row."A"::text,snapshot_row."a"::text]::text[])::text');cases++;
  assert.ok(projection([{name:'x'.repeat(63)}]).includes('x'.repeat(63)));cases++;
  let evaluated=0;
  const accessor=Object.defineProperty({},'name',{get(){evaluated++;throw Error('Do not evaluate catalog getter');}});
  const coercible={toString(){evaluated++;throw Error('Do not coerce catalog value');}};
  for(const columns of [null,{},[],new Proxy([{name:'x'}],{}),[{name:'x'},,{name:'y'}],
   Object.assign([{name:'x'}],{extra:1}),[null],[new Proxy({name:'x'}, {})],[accessor],
   [{name:coercible}],[{name:new String('x')}],[{name:1}],[{name:''}],[{name:'nul\0name'}],
   [{name:'x'.repeat(64)}],[{name:'\ud800'}],[{name:'\udc00'}],[{name:'x'},{name:'x'}]]){
   assert.throws(()=>projection(columns),/Exact ordered backup columns/);cases++;
  }
  assert.equal(evaluated,0);cases++;
  // Independent key-literal and identifier quoting must not depend on
  // standard_conforming_strings or silently drop generated/identity columns.
  assert.ok(!source.slice(helperStart,helperEnd).includes('.filter('));cases++;
  groups++;
 }
 const loopStart=source.indexOf('  for (const catalog of catalogResult.rows) {');
 const loopEnd=source.indexOf('  const buckets = await client.query(',loopStart);
 assert.ok(loopStart>0&&loopEnd>loopStart);
 const capture=new AsyncFunction('ports',`const {catalogResult,client,quoteIdentifier,qualified,backupTextColumnsProjection,
  productionBackupRowCount,join,backupDir,createWriteStream,finished,pageSize,requireProductionBackupPage,
  encodeProductionBackupTextColumnsDataRow,chmodSync,productionBackupTextColumnsDataEncoding}=ports;
  const tableCatalog=[];let databaseRowCount=0;${source.slice(loopStart,loopEnd)}\nreturn {tableCatalog,databaseRowCount};`);
 const columns=[{name:'payload',generated:'',identity:'',data_type:'json'},
  {name:'document',generated:'',identity:'',data_type:'jsonb'},
  {name:'generated_value',generated:'s',identity:'',data_type:'numeric'},
  {name:'identity_value',generated:'',identity:'a',data_type:'bigint'},
  {name:'array_value',generated:'',identity:'',data_type:'text[]'},
  {name:'time_value',generated:'',identity:'',data_type:'timestamp with time zone'}];
 const rawSQLNull=' { "payload" : null, "document" : null, "generated_value" : "9007199254740993.12345678901234567890",'
  +' "identity_value" : "9223372036854775807", "array_value" : "[0:1]={\\"null\\",NULL}", "time_value" : "2026-10-18 01:02:03.123456+00" } ';
 const rawJSONNull=rawSQLNull.replace('"payload" : null','"payload" : "null"').replace('"document" : null','"document" : "null"');
 async function recorded(options={}){
  const {join}=await import('node:path');
  const catalogs=options.catalogs??[{schema_name:'custodial_release_identity',table_name:'unit_original',columns,primary_key:['identity_value']}];
  const records=options.records??[rawSQLNull,rawJSONNull,rawJSONNull],events=[],streams=[],lines=[],queries=[],chmods=[];
  let result,error,failed=false;
  const pageError=Error('UNIT_PAGE_REFUSED'),countError=Error('UNIT_COUNT_REFUSED');
  const client={async query(statement,args){
   events.push('query');queries.push({statement,args});
   if(statement.startsWith('select count(*)::bigint')){
    if(options.countFailure)throw countError;return {rowCount:1,rows:[{row_count:String(options.declaredCount??records.length)}]};
   }
   assert.ok(statement.startsWith('select pg_catalog.json_object(ARRAY['));
   assert.ok(statement.endsWith('limit $1 offset $2) snapshot_row'));
   assert.ok(!statement.includes('row_to_json(')&&!statement.includes('::jsonb'));
   if(options.pageFailure)throw pageError;
   const selected=records.slice(args[1],args[1]+args[0]);
   return {rowCount:selected.length,rows:selected.map(row=>({row}))};
  }};
  const ports={catalogResult:{rows:catalogs},client,quoteIdentifier,qualified,backupTextColumnsProjection:projection,
   productionBackupRowCount,join,backupDir:'/UNIT-inert-no-file-capture',pageSize:2,finished,
   requireProductionBackupPage,encodeProductionBackupTextColumnsDataRow:backupWire.encodeProductionBackupTextColumnsDataRow,
   productionBackupTextColumnsDataEncoding:backupWire.productionBackupTextColumnsDataEncoding,
   chmodSync(path,mode){chmods.push({path,mode});events.push('chmod');},
   createWriteStream(path,flags){assert.deepEqual(flags,{flags:'wx',mode:0o600});events.push('open');
    const stream=new Writable({write(chunk,encoding,callback){lines.push(chunk.toString('utf8'));events.push('write');callback();}});
    stream.on('finish',()=>events.push('finish'));streams.push(stream);return stream;}};
  try{result=await capture(ports);}catch(value){failed=true;error=value;}
  finally{for(const stream of streams)if(!stream.destroyed)stream.destroy();}
  return {failed,error,result,events,streams,lines,queries,chmods,pageError,countError};
 }
 if(want('capture')){
  const found=await recorded();assert.ifError(found.error);assert.equal(found.failed,false);
  assert.deepEqual(found.lines.map(line=>backupWire.decodeProductionBackupTextColumnsDataRow(line.trimEnd())),[rawSQLNull,rawJSONNull,rawJSONNull]);
  assert.notEqual(found.lines[0],found.lines[1]);assert.equal(found.lines[1],found.lines[2]);
  assert.equal(found.result.databaseRowCount,3);assert.equal(found.result.tableCatalog[0].row_count,'3');
  assert.equal(found.result.tableCatalog[0].data_encoding,'postgres-text-columns-line.v2');
  assert.strictEqual(found.result.tableCatalog[0].columns,columns);cases++;
  assert.deepEqual(found.queries.slice(1).map(q=>q.args),[[2,0],[2,2]]);
  assert.ok(found.queries[1].statement.includes('from only "custodial_release_identity"."unit_original" order by "identity_value"'));
  for(const column of columns)assert.ok(found.queries[1].statement.includes(`snapshot_row."${column.name}"::text`));cases++;
  assert.equal(found.streams.length,1);assert.equal(found.streams[0].writableFinished,true);assert.equal(found.streams[0].destroyed,true);
  assert.ok(found.events.indexOf('finish')<found.events.indexOf('chmod'));assert.equal(found.chmods[0].mode,0o600);cases++;
  const allSchemas=await recorded({catalogs:['public','auth','storage','custodial_release_identity'].map(schema_name=>({schema_name,
   table_name:'unit_native',columns,primary_key:[]}))});assert.equal(allSchemas.failed,false);
  assert.equal(allSchemas.result.tableCatalog.length,4);assert.equal(allSchemas.result.databaseRowCount,12);
  assert.ok(allSchemas.queries.filter(q=>q.args).every(q=>q.statement.includes('order by ctid')));cases++;
  const empty=await recorded({records:[]});assert.equal(empty.failed,false);assert.equal(empty.queries.length,1);
  assert.equal(empty.lines.length,0);assert.equal(empty.result.tableCatalog[0].row_count,'0');
  assert.equal(empty.result.tableCatalog[0].data_encoding,'postgres-text-columns-line.v2');assert.equal(empty.streams[0].writableFinished,true);cases++;
  for(const options of [{records:[rawSQLNull],declaredCount:2},{records:['{"payload":{"x":1}}']},
   {records:['{"payload":1}']},{records:['{"payload":null,"payload":"null"}']},{records:['{"payload":"\\ud800"}']},
   {pageFailure:true}]){
   const fail=await recorded(options);assert.equal(fail.failed,true);assert.equal(fail.chmods.length,0);
   assert.equal(fail.streams.length,1);assert.equal(fail.streams[0].destroyed,true);
   if(options.pageFailure)assert.equal(fail.error,fail.pageError);cases++;
  }
  const countFailure=await recorded({countFailure:true});assert.equal(countFailure.error,countFailure.countError);
  assert.equal(countFailure.streams.length,0);cases++;
  const badColumns=await recorded({catalogs:[{schema_name:'public',table_name:'unit_invalid',columns:[{name:'same'},{name:'same'}],primary_key:[]}]});
  assert.equal(badColumns.failed,true);assert.equal(badColumns.queries.length,0);assert.equal(badColumns.streams.length,0);cases++;
  const before=readFileSync('/home/eric/Documents/Codex/2026-10-09/task-9/typed-text-backup-producer-product-20261018-v1/before/scripts/production-backup.mjs','utf8');
  assert.equal(createHash('sha256').update(before).digest('hex'),'600bdc95a9a1a7e2e4f55a2bf8076c382ec644f55e047a5f3bbd92e80f7758a2');
  assert.ok(before.includes('select row_to_json(snapshot_row)::text as row'));
  assert.ok(!source.slice(loopStart,loopEnd).includes('row_to_json('));
  const nativeFailure=readFileSync('/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/json-null-fidelity-v120-Bn0B0w/PRODUCT_RESULT.json');
  assert.equal(createHash('sha256').update(nativeFailure).digest('hex'),'c87f482023c5844bafc5d1483f84babd42d0823b3ef5f2d02cc537baa0903f17');
  assert.ok(JSON.parse(nativeFailure).results.every(r=>r.SQL_null_and_JSON_null_are_distinct&&r.producer_raw_rows_identical));cases++;
  groups++;
 }
 if(want('snapshot')){
  const expected=['set local extra_float_digits = 3',"set local datestyle = 'ISO, YMD'","set local timezone = 'UTC'",
   "set local intervalstyle = 'postgres'","set local bytea_output = 'hex'"];
  assert.deepEqual(settings,expected);assert.ok(Object.isFrozen(settings));cases++;
  const opening=source.indexOf('  await client.connect();'),end=source.indexOf('  const exportedSnapshotResult =',opening);
  assert.ok(opening>0&&end>opening);
  const enter=new AsyncFunction('client','productionBackupSnapshotStatements','backupNativeTextOutputStatements',
   'let backupTransactionMayBeOpen=false;\n'+source.slice(opening,end)+'\nreturn backupTransactionMayBeOpen;');
  const events=[];
  assert.equal(await enter({async connect(){events.push('connect');},async query(statement){events.push(statement);}},productionBackupSnapshotStatements,settings),true);
  assert.deepEqual(events,['connect',...productionBackupSnapshotStatements,...expected]);cases++;
  assert.ok(end<source.indexOf('applicationSchemaSections = await captureApplicationSchema(exportedSnapshot)'));
  for(const marker of ['  const snapshotResult =','  const migrationResult =','  const cronResult =','  const catalogResult =',
   '  const releaseResult =','originalMetadata = await captureProductionBackupOriginalMetadata(client)'])assert.ok(end<source.indexOf(marker));cases++;
  for(const badSetting of expected){const failure=Error('UNIT_FORMAT_SETTING_REFUSED'),events=[];let caught;
   try{await enter({async connect(){events.push('connect');},async query(statement){events.push(statement);if(statement===badSetting)throw failure;}},productionBackupSnapshotStatements,settings);}
   catch(error){caught=error;}assert.equal(caught,failure);assert.equal(events.at(-1),badSetting);
   assert.ok(events.every(e=>e==='connect'||productionBackupSnapshotStatements.includes(e)||expected.includes(e)));cases++;
  }
  assert.deepEqual(productionBackupSnapshotStatements,['begin isolation level repeatable read read only deferrable','set local row_security = off']);cases++;
  assert.equal(source.includes('const schemas = productionBackupDataSchemas;'),true);
  assert.ok(source.includes('requireProductionBackupDataScope(namespaceResult.rows,privateRelationResult.rows,catalogResult.rows)'));cases++;
  groups++;
 }
 console.log(JSON.stringify({selector:'native-text-columns-producer-only',part:part||'all-new',groups,cases,
  proof:'EXACT_PRIVATE_SOURCE_RENDERING_AND_INERT_CAPTURE_RECORDERS',SQL:'NOT_RUN',backup_entrypoint:'NOT_RUN',
  producer_proposal_only:true,producer_mounted:false,restore_v2_mounted:false,old_groups_replayed:0,resources0:true}));process.exit(0);
}

if(process.argv.includes('--native-text-columns-codec-only')){
 const {productionBackupTextColumnsDataEncoding:tag,encodeProductionBackupTextColumnsDataRow:encode,
  decodeProductionBackupTextColumnsDataRow:decode}=backupWire;
 assert.equal(tag,'postgres-text-columns-line.v2');
 assert.equal(backupWire.productionBackupDataEncoding,'postgres-json-text-line.v1');
 const records=['{"payload":null}','{"payload":"null"}',
  ' { "amount" : "90071992547409931234567890.1234567890", "payload" : "{  \\"v\\": 1.00 }" } ',
  JSON.stringify({array:'[0:1]={"null",NULL}',bytes:'\\x00ff',unicode:'z\ud83e\udd81',
   json:'"\\ud800"',whitespace:' a\n\tb ',quoted:'"key": "value"'}),
  '{"__proto__":"original","constructor":"kept"}', '{}'];
 let cases=0;
 for(const raw of records){assert.equal(decode(encode(raw)),raw);cases++;}
 assert.notEqual(encode(records[0]),encode(records[1]));cases++;
 for(const raw of ['{"v":1}','{"v":true}','{"v":[]}','{"v":{}}',
  '{"a":"first","a":"second"}','{"a":null,"\\u0061":"second"}',
  '{"v":"\\ud800"}','{"\\udc00":null}','[]','null']){
  assert.throws(()=>encode(raw));cases++;
 }
 for(const line of ['{}','null','1','"not JSON"','"[]"']){assert.throws(()=>decode(line));cases++;}
 // Legacy data stays legacy; no archive or SQL permission is selected here.
 assert.equal(backupWire.encodeProductionBackupDataRow('{"v":1}'),'"{\\"v\\":1}"');cases++;
 console.log(JSON.stringify({scope:'NEW_NATIVE_TEXT_COLUMNS_CODEC_DATA_ONLY',cases,
  SQL:'NOT_RUN',producer_mounted:false,restore_mounted:false,archive_admission:false,
  old_groups_replayed:0}));process.exit(0);
}

if(process.argv.includes('--original-release-row-only')){
 const {readProductionBackupOriginalRelease}=await import('./production-backup-original-metadata.mjs');
 const root='/home/eric/Documents/Codex/2026-09-13/i-x20/work/autonomous-repair-20260923/overnight-readiness-20261006/restore-runtime-authorized-KM9tAR/auth-complete-original-producer-path-v75/';
 const catalog=JSON.parse(readFileSync(root+'inventory/table-catalog.json'));
 const table=catalog.find(t=>t.schema_name==='public'&&t.table_name==='release_deployment_manifest');
 assert.equal(table.row_count,'1');
 const raw=JSON.parse(readFileSync(root+table.data_file,'utf8').trimEnd());assert.equal(typeof raw,'string');
 const actual=readProductionBackupOriginalRelease({command:'SELECT',rowCount:1,rows:[{original_row:raw}]});
 assert.deepEqual(actual,JSON.parse(raw));assert.equal(actual.recovery_staged,false);
 assert.match(actual.created_at,/\.\d{6}\+00:00$/);assert.match(actual.deployed_at,/\.\d{6}\+00:00$/);
 const old=JSON.parse(readFileSync(root+'backup-summary.json')).source_identity.release;
 assert.notEqual(actual.created_at,old.created_at);assert.equal(Object.hasOwn(old,'recovery_staged'),false);
 for(const reply of [{command:'SELECT',rowCount:0,rows:[]},{command:'SELECT',rowCount:2,rows:[{original_row:raw},{original_row:raw}]},
  {command:'SELECT',rowCount:1,rows:[{original_row:null}]},{command:'SELECT',rowCount:1,rows:[{original_row:'[]'}]}])
  assert.throws(()=>readProductionBackupOriginalRelease(reply));
 const source=readFileSync(new URL('./production-backup.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('select row_to_json(r)::text original_row'));
 assert.ok(source.includes('releaseIdentity = readProductionBackupOriginalRelease(releaseResult);'));
 console.log(JSON.stringify({scope:'NEW_SHIPPING_RELEASE_ROW_CAPTURE_NATIVE_PG_ORIGINAL_FIXTURE',complete_original_row:true,
  microseconds_preserved:true,recovery_staged_preserved:true,malformed_or_ambiguous_refusals:4,SQL:0,old_groups:0}));process.exit(0);
}

if (process.argv.includes("--original-backup-lifecycle-only")) {
  const source=readFileSync(new URL("./production-backup.mjs",import.meta.url),"utf8");
  const start=source.indexOf("const endBackupClient = Client.prototype.end;");
  const snapshotStart=source.indexOf("  for (const statement of productionBackupSnapshotStatements)",start);
  const commitStart=source.indexOf('  await client.query("commit");',snapshotStart);
  const postStart=source.indexOf("  backupTransactionMayBeOpen = false;",commitStart)+"  backupTransactionMayBeOpen = false;".length;
  const artifactDefinition=source.indexOf("finishBackupArtifacts = async () => {",postStart);
  const artifactStart=artifactDefinition+"finishBackupArtifacts = async () => {".length;
  const artifactEnd=source.indexOf("\n};\n} catch (error) {\n  backupLifecycleFailed = true;",artifactStart);
  assert.ok(start>=0&&snapshotStart>start&&commitStart>snapshotStart&&postStart>commitStart
    &&artifactDefinition>postStart&&artifactEnd>artifactStart);
  // EXACT shipping lifecycle. Only snapshot/provider/file bodies and the
  // deferred artifact body become inert callbacks; no actual pg client, SQL,
  // pg_dump, provider, files, signing/key lookup or backup entrypoint runs.
  const shell=source.slice(start,snapshotStart)+
    "  for (const statement of productionBackupSnapshotStatements) await client.query(statement);\n  await snapshotBody();\n"+
    source.slice(commitStart,postStart)+"\nawait postSnapshotBody();\n"+
    source.slice(artifactDefinition,artifactStart)+"\nawait artifactBody();"+source.slice(artifactEnd);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const execute=new AsyncFunction("client","Client","productionBackupSnapshotStatements","snapshotBody","postSnapshotBody","artifactBody",shell);
  let passed=0;
  const run=async(name,test)=>{await test();passed++;console.log(`ORIGINAL_BACKUP_LIFECYCLE_NEW ${name} PASS`);};
  const journey=async(options={})=>{
    const events=[];
    const errors=Object.fromEntries(["connect","begin","snapshot-setting","snapshot","commit","post-snapshot","rollback","end"]
      .map(name=>[name,Error(`RECORDING ${name}`)]));
    const fails=stage=>options.fail?.includes(stage);
    function Client(){}
    Client.prototype.end=async function(){assert.equal(this,client);events.push("native-end");if(fails("end"))throw errors.end;};
    const client={async connect(){events.push("connect");
        if(options.replaceEnd)Client.prototype.end=async()=>{events.push("replacement-end");throw Error("late replacement");};
        if(fails("connect"))throw errors.connect;},
      async query(sql){events.push(sql);
        const stage=sql===productionBackupSnapshotStatements[0]?"begin":sql===productionBackupSnapshotStatements[1]?"snapshot-setting":sql;
        assert.ok(["begin","snapshot-setting","commit","rollback"].includes(stage),"Only existing transaction boundary statements may be recorded");
        if(fails(stage))throw errors[stage];},
      end(){events.push("instance-end-override");throw Error("Must use captured native end");}};
    let failed=false,error;
    try{await execute(client,Client,productionBackupSnapshotStatements,
      async()=>{events.push("snapshot-body");if(fails("snapshot"))throw errors.snapshot;},
      async()=>{events.push("post-snapshot-body");if(Object.hasOwn(options,"bodyFailure"))throw options.bodyFailure;
        if(fails("post-snapshot"))throw errors["post-snapshot"];},
      async()=>{events.push("artifact-continuation");});}
    catch(caught){failed=true;error=caught;}
    return {events,failed,error,errors};
  };
  const opening=["connect",...productionBackupSnapshotStatements];
  const captured=[...opening,"snapshot-body","commit","post-snapshot-body"];
  await run("pinned-predecessor-lifecycle-reproduces-connect-and-post-snapshot-leaks",async()=>{
    // Exact lifecycle fragments read from predecessor 55c0ebfc...; ONLY the
    // snapshot and post-snapshot bodies are replaced by inert awaits. This is
    // a newly reproduced Source counterexample, not old/full backup replay.
    const prior=new AsyncFunction("client","snapshotBody","postSnapshotBody",
      'await client.connect();\ntry {\nawait snapshotBody();\n} catch (error) {\n'+
      '  await client.query("rollback").catch(() => {});\n  await client.end().catch(() => {});\n  throw error;\n}\n'+
      'await postSnapshotBody();\nawait client.end();');
    for(const failAt of ["connect","post-snapshot"]){
      const events=[],failure=Error(`PREDECESSOR ${failAt}`);
      const client={async connect(){events.push("connect");if(failAt==="connect")throw failure;},
        async query(){events.push("rollback");},async end(){events.push("end");}};
      await assert.rejects(()=>prior(client,async()=>{events.push("snapshot");},async()=>{events.push("post-snapshot");throw failure;}),
        error=>error===failure);
      assert.equal(events.includes("end"),false);
      assert.deepEqual(events,failAt==="connect"?["connect"]:["connect","snapshot","post-snapshot"]);
    }
  });
  await run("failed-connect-native-end-once-no-rollback",async()=>{
    const result=await journey({fail:["connect"],replaceEnd:true});assert.equal(result.error,result.errors.connect);
    assert.deepEqual(result.events,["connect","native-end"]);
  });
  await run("begin-setting-and-snapshot-failures-rollback-once-and-end",async()=>{
    for(const stage of ["begin","snapshot-setting","snapshot"]){
      const result=await journey({fail:[stage]});assert.equal(result.error,result.errors[stage]);
      assert.deepEqual(result.events.slice(-2),["rollback","native-end"]);
      assert.equal(result.events.filter(x=>x==="rollback").length,1);
      assert.equal(result.events.includes("post-snapshot-body"),false);
      assert.equal(result.events.includes("artifact-continuation"),false);
    }
  });
  await run("ambiguous-snapshot-commit-retains-error-and-settles-original-transaction",async()=>{
    const result=await journey({fail:["commit"]});assert.equal(result.error,result.errors.commit);
    assert.deepEqual(result.events,[...opening,"snapshot-body","commit","rollback","native-end"]);
  });
  await run("post-snapshot-write-query-provider-failure-native-end-no-rollback-or-seal",async()=>{
    const result=await journey({fail:["post-snapshot"]});assert.equal(result.error,result.errors["post-snapshot"]);
    assert.deepEqual(result.events,[...captured,"native-end"]);
  });
  await run("success-ends-captured-native-client-before-artifact-continuation",async()=>{
    const result=await journey({replaceEnd:true});assert.equal(result.failed,false);
    assert.deepEqual(result.events,[...captured,"native-end","artifact-continuation"]);
    assert.equal(result.events.filter(x=>x==="native-end").length,1);
  });
  await run("end-failure-prevents-artifact-continuation",async()=>{
    const result=await journey({fail:["end"]});assert.equal(result.error,result.errors.end);
    assert.deepEqual(result.events,[...captured,"native-end"]);
  });
  await run("snapshot-body-and-all-cleanup-errors-retained-in-order",async()=>{
    const result=await journey({fail:["snapshot","rollback","end"]});
    assert.ok(result.error instanceof AggregateError);assert.equal(result.error.cause,result.errors.snapshot);
    assert.deepEqual(result.error.errors,[result.errors.snapshot,result.errors.rollback,result.errors.end]);
    assert.deepEqual(result.events,[...opening,"snapshot-body","rollback","native-end"]);
    for(const stage of ["connect","post-snapshot"]){
      const failed=await journey({fail:[stage,"end"]});assert.ok(failed.error instanceof AggregateError);
      assert.equal(failed.error.cause,failed.errors[stage]);assert.deepEqual(failed.error.errors,[failed.errors[stage],failed.errors.end]);
      assert.equal(failed.events.includes("rollback"),false);assert.equal(failed.events.includes("artifact-continuation"),false);
    }
  });
  await run("frozen-and-primitive-primary-failures-not-replaced",async()=>{
    for(const bodyFailure of [Object.freeze(Error("frozen body failure")),undefined,null,"original primitive"]){
      const result=await journey({bodyFailure});assert.equal(result.failed,true);assert.equal(result.error,bodyFailure);
      assert.deepEqual(result.events,[...captured,"native-end"]);
      const failed=await journey({bodyFailure,fail:["end"]});assert.ok(failed.error instanceof AggregateError);
      assert.equal(failed.error.cause,bodyFailure);assert.deepEqual(failed.error.errors,[bodyFailure,failed.errors.end]);
    }
  });
  console.log(`ORIGINAL_BACKUP_LIFECYCLE_NEW ${passed} groups PASS; inert Source only; SQL/provider/backup/signing NOT_RUN`);
  process.exit(0);
}

const fixture = {
  caPath: "/repo/.github/certs/prod-ca-2021.crt",
  databaseHost: "db.example.internal",
  databaseName: "postgres",
  databasePort: "5432",
  databaseUsername: "backup_user",
  exportedSnapshot: "00000003-0000001B-1",
  inventoryDir: "/private/backup/inventory",
  pgDumpImage: "supabase/postgres@sha256:" + "a".repeat(64),
  uid: 1000,
  gid: 1000,
};

// New original-metadata producer only. No connection, real catalog query,
// signing key, pg_dump, Storage/network, backup or old selected group runs.
if (process.argv.includes("--original-metadata-producer-only")) {
  const { createHash } = await import("node:crypto");
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  const { default: pg } = await import("pg");
  const { stableJsonFile } = await import("./disaster-recovery-crypto.mjs");
  const { captureProductionBackupOriginalMetadata: capture } = await import("./production-backup-original-metadata.mjs");
  const producer = readFileSync(new URL("./production-backup.mjs", import.meta.url), "utf8");
  const moduleSource = readFileSync(new URL("./production-backup-original-metadata.mjs", import.meta.url), "utf8");
  const sha = value => createHash("sha256").update(value).digest("hex"), cases = [];
  let queryCalls = 0;
  const port = { query() { queryCalls++; throw Error("Injected query must not run"); } };
  const getter = Object.defineProperty({}, "query", { get() { queryCalls++; throw Error("Getter must not run"); } });
  for (const value of [null, {}, port, getter, new Proxy(port, {})]) await assert.rejects(() => capture(value));
  const native = new pg.Client(), overridden = new pg.Client();
  overridden.query = port.query;
  for (const client of [native, overridden]) {
    await assert.rejects(() => capture(client));
    assert.equal(client._connected, false); assert.equal(client._queryQueue.length, 0);
  }
  assert.equal(queryCalls, 0);
  cases.push("actual entry rejects nonnative/proxy/override/unconnected client before any query");

  // Data-only adapters execute the exact private shipping capture helpers,
  // not the native-client/context boundary. No synthetic port is admitted by
  // captureProductionBackupOriginalMetadata or represented as actual SQL.
  const names = ["NamespaceColumn", "Routine", "Relation"];
  const starts = names.map(name => moduleSource.indexOf("   async function captureOriginal" + name + "Acls(client,query){"));
  assert.ok(starts.every(at => at >= 0));
  const helpers = starts.map((at, i) => moduleSource.slice(at, i + 1 < starts.length ? starts[i + 1] : moduleSource.indexOf("export async function captureProductionBackupOriginalMetadata", at)));
  const q = value => '"' + value.replaceAll('"', '""') + '"';
  const compile = (index) => new Function("assert", "createRequire", "quoteIdentifier", "Buffer", helpers[index].replaceAll("import.meta.url", JSON.stringify(new URL("./production-backup-original-metadata.mjs", import.meta.url).href))
    + "\nreturn captureOriginal" + names[index] + "Acls;")(assert, createRequire, q, Buffer);
  const grant = { grantee: "PUBLIC", grantor: "original_owner", privilege_type: "EXECUTE", is_grantable: false };
  const routine = { kind: "FUNCTION", schema_name: "public", object_name: "fixture", identity: "public.fixture()", owner_name: "original_owner", column_name: null, grants: [grant] };
  const routines = await compile(1)(null, async () => ({ rows: [{ search_path: "pg_catalog", routines: [routine] }] }));
  assert.deepEqual(routines, [routine]); assert.equal(routines[0].owner_name, "original_owner");
  const relation = { kind: "TABLE", schema_name: "auth", object_name: "fixture", identity: '"auth"."fixture"', owner_name: "supabase_auth_admin", column_name: null,
    grants: [{ grantee: "reader", grantor: "supabase_auth_admin", privilege_type: "SELECT", is_grantable: true }] };
  const relations = await compile(2)(null, async () => ({ rows: [{ descriptor: relation }] }));
  assert.deepEqual(relations, [relation]);
  const schemas = productionBackupDataSchemas.map(schema_name => ({ kind: "SCHEMA", schema_name, object_name: schema_name, owner_name: "original_owner", column_name: null, grants: [] }));
  const namespaces = await compile(0)(null, async () => ({ rows: schemas }));
  assert.deepEqual(namespaces.map(x => x.schema_name).sort(), [...productionBackupDataSchemas].sort());
  assert.ok(namespaces.every(x => x.owner_name === "original_owner" && x.identity === q(x.schema_name)));
  await assert.rejects(() => compile(1)(null, async () => ({ rows: [{ search_path: "public", routines: [routine] }] })));
  await assert.rejects(() => compile(1)(null, async () => ({ rows: [{ search_path: "pg_catalog", routines: [{ ...routine, grants: [grant, grant] }] }] })));
  cases.push("new shipping data adapters preserve original owners/PUBLIC/grantor/options and reject drift/duplicates");

  const fieldsStart=moduleSource.indexOf("function fields(value,keys){"),rowsStart=moduleSource.indexOf("function rows(reply){",fieldsStart);
  const metadataStart=moduleSource.indexOf("function requireOriginalPrivateRelationGuardData("),metadataEnd=moduleSource.indexOf("export async function captureProductionBackupOriginalMetadata",metadataStart);
  assert.ok(fieldsStart>0&&rowsStart>fieldsStart&&metadataStart>rowsStart&&metadataEnd>metadataStart);
  const guardIds=["custodial_release_identity.guard_group_original_creation()","custodial_dr.guard_application_mutation()"];
  const checkMetadata=new Function("assert","Buffer","GUARDS",moduleSource.slice(fieldsStart,rowsStart)+moduleSource.slice(metadataStart,metadataEnd)+"\nreturn requireOriginalPrivateRelationGuardData;")(assert,Buffer,guardIds);
  const guard=i=>({owner:"UNIT_original_owner",prosrc:"\nBEGIN\n RETURN NEW;\nEND\n",definition:"CREATE OR REPLACE FUNCTION "+guardIds[i]+"\nAS $function$\nBEGIN\n RETURN NEW;\nEND\n$function$\n"});
  const absent={owner:null,prosrc:null,definition:null},ordinary=[{schema_name:"public",table_name:"UNIT_original"}];
  checkMetadata(ordinary,[absent,guard(1)]);assert.deepEqual(absent,{owner:null,prosrc:null,definition:null});
  const privateRows=[{schema_name:"custodial_release_identity",table_name:"group_original_creations"},
    {schema_name:"custodial_release_identity",table_name:"employee_message_original_outcomes"}];
  checkMetadata([...ordinary,...privateRows],[guard(0),guard(1)]);
  for(const [relations,guards]of [[ordinary,[]],[ordinary,[absent,absent]],[ordinary,[{...absent,prosrc:"unknown"},guard(1)]],
    [[...ordinary,privateRows[0]],[absent,guard(1)]],[[...ordinary,...privateRows],[absent,guard(1)]]])
    assert.throws(()=>checkMetadata(relations,guards));
  cases.push("observed legacy absence preserves original NULL guard DATA while partial tables/guards refuse");

  const writeAt = producer.indexOf('writeJson(join(backupDir, "inventory", "original-relations.json"),');
  const writeEnd = producer.indexOf('\nconst databaseCatalogSha256 =', writeAt);
  assert.ok(writeAt > 0 && writeEnd > writeAt);
  const files = new Map(), modes = [], backupDir = "/SYNTHETIC_PRIVATE_OUTPUT";
  const writerStart = producer.indexOf("function writeJson(path, value) {"), writerEnd = producer.indexOf("\nfunction quoteIdentifier", writerStart);
  const writer = new Function("writeFileSync", "chmodSync", "stableJsonFile", producer.slice(writerStart, writerEnd) + "\nreturn writeJson;")(
    (path, bytes, options) => { files.set(path, bytes); modes.push(options.mode); }, (path, mode) => modes.push(mode), stableJsonFile);
  const metadata = { relations: [{ schema_name: "auth", table_name: "fixture", relation_kind: "r", is_partition: false, owner_name: "supabase_auth_admin", relrowsecurity: true, relforcerowsecurity: true }],
    guards: [{ definition: "SYNTHETIC Source definition", prosrc: "SYNTHETIC Source body", owner: "original_owner" }], acls: { routines, relations, namespaces_columns: namespaces } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const emit = new AsyncFunction("writeJson", "join", "backupDir", "originalMetadata", "sha256File", producer.slice(writeAt, writeEnd)
    + "\nreturn {originalRelationsSha256,originalGuardsSha256,originalAclsSha256};");
  const emitted = await emit(writer, join, backupDir, metadata, async path => sha(files.get(path)));
  assert.equal(files.size, 3); assert.ok(modes.every(mode => mode === 0o600));
  for (const [name, value, field] of [["original-relations.json", metadata.relations, "originalRelationsSha256"], ["original-guards.json", metadata.guards, "originalGuardsSha256"], ["original-acls.json", metadata.acls, "originalAclsSha256"]]) {
    const bytes = files.get(join(backupDir, "inventory", name)); assert.equal(bytes, stableJsonFile(value)); assert.equal(emitted[field], sha(bytes));
  }
  cases.push("actual new producer writeJson/hashes bind exactly three 0600 emitted byte streams");

  const captureAt = producer.indexOf("originalMetadata = await captureProductionBackupOriginalMetadata(client);");
  assert.ok(captureAt > producer.indexOf("select pg_export_snapshot()"));
  assert.ok(captureAt < producer.indexOf('await client.query("commit");', captureAt));
  assert.ok(writeAt > producer.indexOf('await client.query("commit");', captureAt));
  assert.ok(producer.indexOf('await client.query("set local search_path = pg_catalog");') < captureAt);
  for (const [field, name] of [["original_relations_sha256", "originalRelationsSha256"], ["original_guards_sha256", "originalGuardsSha256"], ["original_acls_sha256", "originalAclsSha256"]]) assert.ok(producer.includes(field + ": " + name));
  assert.ok(producer.includes("sourceIdentity: summary.source_identity"));
  assert.ok(!moduleSource.includes("reconcileOriginal")); assert.ok(!moduleSource.includes("source-pins.json"));
  assert.ok(!moduleSource.includes("new Client(")); assert.ok(!moduleSource.includes(".connect("));
  cases.push("same snapshot/precommit capture and existing checksum/signature flow retained without transaction ownership");
  console.log(JSON.stringify({ status: "PASS_NEW_ORIGINAL_METADATA_SOURCE_ADAPTER_ONLY", cases, count: cases.length,
    actual_SQL: "NOT_RUN", positive_native_snapshot_capture: "NOT_RUN", production_backup: "NOT_RUN", signing: "NOT_RUN",
    limits: "Native entry refusal plus exact new private data adapters and producer byte-emission/wiring only; synthetic data/recording ports never assert real snapshot or SQL authority." }));
  process.exit(0);
}

// Only the newly added section-evidence profile; no production entrypoint runs.
if (process.argv.includes("--schema-section-evidence-only")) {
  const { createHash } = await import("node:crypto");
  const { runInNewContext } = await import("node:vm");
  const { join, resolve } = await import("node:path");
  const { archiveSignatureBinding, stableJson } = await import("./disaster-recovery-crypto.mjs");
  const cases = [];
  const source = readFileSync(new URL("./production-backup.mjs", import.meta.url), "utf8");
  const helperSource = readFileSync(new URL("./production-backup-pg-dump-command.mjs", import.meta.url), "utf8");
  const hash = value => createHash("sha256").update(value).digest("hex");
  // Exact frozen predecessor bytes, without depending on task-local artifacts.
  assert.equal(hash(helperSource.slice(0, 6122)), "2a0efe92b7719040c33f0495f03b276bb4ee63a9fbeaa243d1e82650bdee4122",
    "The existing full-schema command helper must remain bytewise unchanged");
  const full = productionBackupPgDumpDockerArgs(fixture);
  const profiles = backupWire.productionBackupSchemaSections;
  assert.deepEqual(profiles, [
    { section: "pre-data", path: "inventory/application-schema-pre-data.sql" },
    { section: "post-data", path: "inventory/application-schema-post-data.sql" },
  ]);
  assert.ok(Object.isFrozen(profiles) && profiles.every(Object.isFrozen));
  for (const profile of profiles) {
    const args = backupWire.productionBackupPgDumpSectionDockerArgs(fixture, profile.section);
    assert.deepEqual(args.slice(0, full.indexOf("--schema-only")), full.slice(0, full.indexOf("--schema-only")));
    assert.deepEqual(args.slice(full.indexOf("--schema-only")), ["--schema-only", `--section=${profile.section}`,
      `--snapshot=${fixture.exportedSnapshot}`, `--file=/backup/${profile.path.slice("inventory/".length)}`]);
    for (const forbidden of ["--clean", "--if-exists", "--no-owner", "--no-acl", "--disable-triggers", "--use-set-session-authorization"])
      assert.equal(args.includes(forbidden), false);
  }
  cases.push("fixed no-clean sections retain exact normal transport/snapshot; old full helper unchanged");
  for (const section of ["data", "pre-data --clean", null, undefined, "", "unknown"])
    assert.throws(() => backupWire.productionBackupPgDumpSectionDockerArgs(fixture, section));
  assert.throws(() => backupWire.productionBackupPgDumpSectionDockerArgs({ ...fixture, networkHost: true }, "pre-data"), /task-local backup access/);
  cases.push("unsupported section and denied transport refuse");

  const captureStart = source.indexOf("async function captureApplicationSchema(");
  const captureEnd = source.indexOf("\nconst client =", captureStart);
  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  const captureSource = source.slice(captureStart, captureEnd);
  const sectionStart = captureSource.indexOf("\n  const sections = [];");
  assert.ok(sectionStart > 0);
  assert.equal(hash(captureSource.slice(0, sectionStart)), "5d4af573a170c41193ef88a8a6524fbca9f4089b8e3ce36ccb9761468d9f38dd",
    "Original full-schema command and validation must remain unchanged");
  async function capture({ failSection, badOutput } = {}) {
    const calls = [], files = new Map(), hashed = [];
    const context = {
      join, resolve, process: { env: {}, getuid: () => fixture.uid, getgid: () => fixture.gid },
      databaseCaCertPath: fixture.caPath, databaseHost: fixture.databaseHost, databaseName: fixture.databaseName,
      databasePort: fixture.databasePort, databaseUsername: fixture.databaseUsername, databasePassword: "synthetic-only",
      backupDir: "/private/backup", applicationSchemaPath: "/private/backup/inventory/application-schema.sql",
      pgDumpNetworkHost: false, backupExecutionMode: "github-actions", pgDumpImage: fixture.pgDumpImage,
      productionBackupPgDumpDockerArgs, productionBackupSchemaSections: profiles,
      productionBackupPgDumpSectionDockerArgs: backupWire.productionBackupPgDumpSectionDockerArgs,
      requireProductionBackupSchemaSections: backupWire.requireProductionBackupSchemaSections,
      async execFileAsync(command, args, options) {
        assert.equal(command, "docker"); assert.equal(options.maxBuffer, 10 * 1024 * 1024);
        assert.deepEqual({ ...options.env }, { PGPASSWORD: "synthetic-only" });
        calls.push(args);
        const sectionArg = args.find(value => value.startsWith("--section="));
        if (sectionArg === `--section=${failSection}`) throw new Error("synthetic section process failure");
        const filename = args.find(value => value.startsWith("--file="));
        const path = filename.replace("--file=/backup/", "/private/backup/inventory/");
        if (sectionArg && badOutput === "missing") return;
        files.set(path, { text: sectionArg ? `-- ${sectionArg}\nCREATE TABLE fixture_owned(id bigint);\n` : "x".repeat(2048),
          regular: !(sectionArg && badOutput === "nonfile"), empty: !!(sectionArg && badOutput === "empty") });
      },
      statSync(path) {
        const file = files.get(path); if (!file) throw new Error("synthetic missing output");
        return { isFile: () => file.regular, size: file.empty ? 0 : Buffer.byteLength(file.text) };
      },
      async sha256File(path) { hashed.push(path); return hash(files.get(path).text); },
    };
    const fn = runInNewContext(captureSource + "\ncaptureApplicationSchema", context, { timeout: 1000 });
    try { return { result: await fn(fixture.exportedSnapshot), calls, files, hashed }; }
    catch (error) { return { error, calls, files, hashed }; }
  }
  const complete = await capture();
  assert.equal(complete.error, undefined);
  assert.equal(complete.calls.length, 3);
  assert.deepEqual(complete.calls[0], full);
  for (const args of complete.calls) assert.ok(args.includes(`--snapshot=${fixture.exportedSnapshot}`));
  assert.deepEqual(complete.hashed, profiles.map(profile => join("/private/backup", profile.path)));
  const expected = profiles.map(profile => ({ ...profile, sha256: hash(complete.files.get(join("/private/backup", profile.path)).text) }));
  assert.deepEqual([...complete.result].map(entry => ({ ...entry })), expected);
  assert.ok(Object.isFrozen(complete.result) && complete.result.every(Object.isFrozen));
  cases.push("actual capture function settles full/pre/post serially and binds both exact fixture output hashes");
  const failed = await capture({ failSection: "post-data" });
  assert.match(failed.error.message, /synthetic section process failure/);
  assert.equal(failed.result, undefined); assert.equal(failed.calls.length, 3); assert.equal(failed.hashed.length, 1);
  cases.push("second-section failure cannot return a complete source binding");
  for (const badOutput of ["missing", "empty", "nonfile"]) {
    const refused = await capture({ badOutput });
    assert.ok(refused.error); assert.equal(refused.result, undefined);
    assert.equal(refused.calls.length, 2); assert.equal(refused.hashed.length, 0);
  }
  cases.push("missing/empty/nonregular section output refuses before hashes or signature inputs");
  for (const bad of [null, [], expected.slice(0, 1), [...expected, expected[0]], [...expected].reverse(),
    [{ ...expected[0], path: "inventory/other.sql" }, expected[1]],
    [{ ...expected[0], section: "data" }, expected[1]],
    [{ ...expected[0], sha256: "not-sha256" }, expected[1]],
    [{ ...expected[0], accepted: true }, expected[1]]])
    assert.throws(() => backupWire.requireProductionBackupSchemaSections(bad));
  cases.push("closed ordered two-section binding rejects incomplete/conflicting/extra authority fields");

  // Structural binding only: no key, HMAC/signature, archive or SQL is used.
  const identity = { application_schema_sha256: "f".repeat(64), application_schema_sections: expected };
  const first = archiveSignatureBinding({ archiveDigest: "e".repeat(64), projectRef: "abcdefghijklmnopqrst", sourceIdentity: identity,
    archiveFormat: "memphis-zoo-disaster-recovery.v4" });
  const changed = archiveSignatureBinding({ archiveDigest: "e".repeat(64), projectRef: "abcdefghijklmnopqrst",
    sourceIdentity: { ...identity, application_schema_sections: [{ ...expected[0], sha256: "0".repeat(64) }, expected[1]] },
    archiveFormat: "memphis-zoo-disaster-recovery.v4" });
  assert.deepEqual(first.source_identity.application_schema_sections, expected);
  assert.notEqual(stableJson(first), stableJson(changed));
  assert.equal(first.format, "memphis-zoo-disaster-recovery.v4");
  cases.push("existing signature binding incorporates evidence hashes without format/authority change");
  assert.ok(source.indexOf("applicationSchemaSections = await captureApplicationSchema(exportedSnapshot)") < source.indexOf("await client.query(\"commit\")"));
  assert.ok(source.indexOf("application_schema_sections: requireProductionBackupSchemaSections(applicationSchemaSections)") < source.indexOf("archiveSignatureBinding({"));
  assert.ok(source.includes("const hashFiles = [...walkFiles(backupDir), join(backupDir, \"backup-summary.json\")].sort();"));
  cases.push("producer awaits both sections under snapshot and inventories files before completed seal");
  console.log(JSON.stringify({ selector: "--schema-section-evidence-only", count: cases.length, cases,
    status: "PASS_BOUNDED_INPROCESS_EVIDENCE_PROFILE", limits: "Synthetic command/output callbacks + actual capture function and signature binding structure only; no pg_dump, subprocess, SQL, file/archive capture, HMAC/signature, key, network or restore execution." }));
  process.exit(0);
}

if (process.argv.includes("--private-original-lossless-wire-only")) {
  const {default:pg}=await import("pg");
  const {runInNewContext}=await import("node:vm");
  const source=readFileSync(new URL("./production-backup.mjs",import.meta.url),"utf8");
  const writeStatement=source.split("\n").find(line=>line.includes("stream.write(")&&line.includes("item.row"));
  assert.ok(writeStatement,"Actual shipping row write statement is required");
  const raw=' \n{"epoch":9007199254740993,"revision":9223372036854775807,"negative":-9223372036854775808,\n'+
    '"json":{"integer":9007199254740993,"fraction":0.12345678901234567890123456789,"duplicate":1,"duplicate":2},'+
    '"text":"line\\nwith\\rUnicode 雪 and quote \\"","bytea":"\\\\x00ff","null":null} \r\n';
  const parser114=pg.types.getTypeParser(114,"text"),parser3802=pg.types.getTypeParser(3802,"text");
  const diagnostic={scope:"installed pg parser counterexample",json_oid114_epoch:parser114(raw).epoch,jsonb_oid3802_epoch:parser3802(raw).epoch,
    exact_expected_epoch_token:"9007199254740993",original_raw_bytes:Buffer.byteLength(raw,"utf8")};
  // Real installed JSON codecs round before the old write statement. This is
  // diagnostic evidence, never data supplied to the new string-wire encoder.
  assert.notEqual(JSON.stringify(parser114(raw)),raw.trim());
  assert.notEqual(String(parser114(raw).epoch),diagnostic.exact_expected_epoch_token);
  assert.notEqual(String(parser3802(raw).epoch),diagnostic.exact_expected_epoch_token);
  function shippingWrite(item) {
    const lines=[];
    runInNewContext(writeStatement,{rows:[item],stream:{write:line=>lines.push(line)},
      encodeProductionBackupDataRow:backupWire.encodeProductionBackupDataRow});
    assert.equal(lines.length,1);return lines[0];
  }
  // Simulate ONLY the actual query result's installed field codec. The changed
  // ::text cast selects text OID25; no PostgreSQL connection/query is executed.
  const sourceUsesText=source.includes("row_to_json(snapshot_row)::text as row");
  const item={row:pg.types.getTypeParser(sourceUsesText?25:114,"text")(raw)};
  const result={rowCount:1,rows:[item]};
  assert.strictEqual(requireProductionBackupPage(result,{offset:0,rowCount:1,pageSize:1000}),result.rows);
  const actualLine=shippingWrite(item),decoded=JSON.parse(actualLine);
  console.log(JSON.stringify({...diagnostic,actual_shipping_query_text_cast:sourceUsesText,
    actual_shipping_line_value_type:typeof decoded,exact_raw_retained:decoded===raw,
    physical_jsonl_lines:actualLine.split("\n").length-1}));
  assert.equal(typeof decoded,"string","Shipping backup must envelope raw PostgreSQL JSON text, not a rounded object");
  assert.equal(decoded,raw,"Exact whitespace, integer/numeric tokens, Unicode, bytea and nested JSON must remain original");
  assert.deepEqual(Buffer.from(decoded,"utf8"),Buffer.from(raw,"utf8"));
  assert.equal(actualLine.endsWith("\n"),true);assert.equal(actualLine.split("\n").length,2);
  const cases=["installed114/3802 actual rounding reproduced; actual shipping text row/string-line exact"];
  assert.equal(backupWire.productionBackupDataEncoding,"postgres-json-text-line.v1");
  for(const value of [raw,'{}','\n{ "empty":"", "array":[], "large":1e400 }\t','{"nested":{"original":[3,2,1]},"escaped":"\\uD800"}']) {
    const line=backupWire.encodeProductionBackupDataRow(value);
    assert.equal(JSON.parse(line),value);assert.deepEqual(Buffer.from(JSON.parse(line)),Buffer.from(value));
  }
  cases.push("raw shape validation never reserializes data or unsafe numbers");
  const validRows=[{row:raw},{row:'{"next":9007199254740995}'},{row:' {"last":null} '}];
  const first={rowCount:2,rows:validRows.slice(0,2)},last={rowCount:1,rows:validRows.slice(2)};
  assert.strictEqual(requireProductionBackupPage(first,{offset:0,rowCount:3,pageSize:2}),first.rows);
  assert.strictEqual(requireProductionBackupPage(last,{offset:2,rowCount:3,pageSize:2}),last.rows);
  assert.strictEqual(first.rows[0],validRows[0]);assert.strictEqual(first.rows[0].row,raw);
  assert.deepEqual([...first.rows,...last.rows].map(shippingWrite).map(line=>JSON.parse(line)),validRows.map(row=>row.row));
  cases.push("multiple complete pages retain original row objects and exact raw text");
  for(const value of [null,undefined,0,{},[],Buffer.from('{}'),'','{bad','[]','null','1','"object?"','{}{}','{"x":NaN}','{"x":1,}']) {
    assert.throws(()=>backupWire.encodeProductionBackupDataRow(value));
    assert.throws(()=>requireProductionBackupPage({rowCount:1,rows:[{row:value}]},{offset:0,rowCount:1,pageSize:1}));
  }
  cases.push("unsupported, malformed and nonobject raw JSON rejected before row write");
  for(const bad of [{rowCount:0,rows:[]},{rowCount:1,rows:[{row:'{}'}]},
    {rowCount:1,rows:[{row:'{}'},{row:'{}'}]},{rowCount:3,rows:[{row:'{}'},{row:'{}'},{row:'{}'}]},
    {rowCount:2,rows:[{row:'{}'},{}]},{rowCount:2,rows:[{row:'{}'},{row:'[]'}]}])
    assert.throws(()=>requireProductionBackupPage(bad,{offset:0,rowCount:3,pageSize:2}));
  assert.throws(()=>requireProductionBackupPage({rowCount:1,rows:[{row:'{}'}]},{offset:3,rowCount:3,pageSize:2}));
  cases.push("short, failed, contradictory and malformed page refuses rather than signed partial data");
  assert.throws(()=>requireProductionBackupPage({rowCount:1,rows:[{row:parser114(raw)}]},{offset:0,rowCount:1,pageSize:1}));
  assert.throws(()=>requireProductionBackupPage({rowCount:1,rows:[{row:parser3802(raw)}]},{offset:0,rowCount:1,pageSize:1}));
  cases.push("already parsed JSON/JSONB object cannot enter lossless text producer");
  assert.ok(sourceUsesText);
  assert.ok(source.includes("data_encoding: productionBackupDataEncoding"));
  assert.ok(source.indexOf("data_encoding: productionBackupDataEncoding")<source.indexOf('writeJson(join(backupDir, "inventory", "table-catalog.json")'));
  assert.ok(source.includes('database_catalog_sha256: databaseCatalogSha256'));
  assert.ok(source.indexOf('database_catalog_sha256: databaseCatalogSha256')<source.indexOf('archiveSignatureBinding({'));
  cases.push("existing signed table catalog binds fixed data_encoding; no archive authority change");
  console.log(JSON.stringify({selector:"--private-original-lossless-wire-only",status:"PASS_INSTALLED_PG_AND_OWNING_WIRE_CASES",cases,
    count:cases.length,encoding:backupWire.productionBackupDataEncoding,
    limits:"Installed pg codecs, actual shipping write statement and actual helpers in-process only; no SQL, backup, signing, encryption or restore execution."}));
  process.exit(0);
}

// Only newly affected capture behavior. No database, key, archive, Docker,
// Storage/network or production entrypoint is invoked by this selector.
if (process.argv.includes("--private-original-capture-only")) {
  const cases=[];
  const run=(name,caseBody)=>{caseBody();cases.push(name);};
  const namespaces=productionBackupDataSchemas.map(schema_name=>({schema_name,usage_allowed:true}));
  const privateRelations=["employee_message_original_outcomes","group_original_creations"]
    .map(table_name=>({table_name,relation_kind:"r",is_partition:false}));
  const catalog=privateRelations.map(row=>({schema_name:"custodial_release_identity",table_name:row.table_name,
    primary_key:["original_key"],columns:[{name:"original_tuple",generated:"",identity:"",data_type:"jsonb"}]}));
  run("fixed private capture scope",()=>{
    assert.deepEqual(productionBackupDataSchemas,["public","auth","storage","custodial_release_identity"]);
    assert.ok(Object.isFrozen(productionBackupDataSchemas));
    assert.equal(productionBackupDataSchemas.includes("custodial_dr"),false);
    requireProductionBackupDataScope(namespaces,privateRelations,catalog);
  });
  run("observed empty private schema preserves the complete ordinary catalog",()=>{
    const ordinary=[{schema_name:"public",table_name:"UNIT_original",primary_key:["id"],
      columns:[{name:"id",generated:"",identity:"",data_type:"bigint"}]}];
    requireProductionBackupDataScope(namespaces,[],ordinary);
    assert.throws(()=>requireProductionBackupDataScope(namespaces,[],[...ordinary,catalog[0]]));
    assert.throws(()=>requireProductionBackupDataScope(namespaces.slice(0,3),[],ordinary));
    assert.throws(()=>requireProductionBackupDataScope(namespaces.map(row=>row.schema_name==="custodial_release_identity"
      ? {...row,usage_allowed:false}:row),[],ordinary));
    for(const unknown of [undefined,null,{}])assert.throws(()=>requireProductionBackupDataScope(namespaces,unknown,ordinary));
    for(const unknown of [undefined,null,{},[]])assert.throws(()=>requireProductionBackupDataScope(namespaces,[],unknown));
  });
  run("same snapshot and error-on-RLS setup",()=>{
    assert.deepEqual(productionBackupSnapshotStatements,[
      "begin isolation level repeatable read read only deferrable","set local row_security = off"]);
    assert.ok(Object.isFrozen(productionBackupSnapshotStatements));
    const args=productionBackupPgDumpDockerArgs(fixture);
    assert.ok(args.includes("--schema-only") && args.includes(`--snapshot=${fixture.exportedSnapshot}`));
    assert.equal(args.includes("--no-owner"),false);
    assert.ok(args.includes("PGOPTIONS=-c default_transaction_read_only=on"));
    assert.ok(args.includes("PGSSLMODE=verify-full"));
  });
  run("missing denied or foreign namespace refuses",()=>{
    assert.throws(()=>requireProductionBackupDataScope(namespaces.slice(0,3),privateRelations,catalog));
    assert.throws(()=>requireProductionBackupDataScope(namespaces.map(row=>row.schema_name==="custodial_release_identity"
      ? {...row,usage_allowed:false}:row),privateRelations,catalog));
    assert.throws(()=>requireProductionBackupDataScope([...namespaces.slice(0,3),{schema_name:"custodial_dr",usage_allowed:true}],privateRelations,catalog));
    assert.throws(()=>requireProductionBackupDataScope([...namespaces.slice(0,3),namespaces[0]],privateRelations,catalog));
  });
  run("incomplete duplicate foreign private catalog refuses",()=>{
    assert.throws(()=>requireProductionBackupDataScope(namespaces,privateRelations,catalog.slice(0,1)));
    assert.throws(()=>requireProductionBackupDataScope(namespaces,privateRelations,[...catalog,catalog[0]]));
    assert.throws(()=>requireProductionBackupDataScope(namespaces,privateRelations,[...catalog,{...catalog[0],table_name:"unexpected"}]));
    assert.throws(()=>requireProductionBackupDataScope(namespaces,privateRelations,[...catalog,{...catalog[0],schema_name:"custodial_dr"}]));
    assert.throws(()=>requireProductionBackupDataScope(namespaces,[],[]));
  });
  run("unsupported private partition and foreign tables refuse",()=>{
    for(const bad of[{relation_kind:"p"},{relation_kind:"f"},{is_partition:true}])
      assert.throws(()=>requireProductionBackupDataScope(namespaces,[{...privateRelations[0],...bad},privateRelations[1]],catalog));
    assert.throws(()=>requireProductionBackupDataScope(namespaces,[privateRelations[0],privateRelations[0]],catalog));
  });
  run("exact count rejects absent denied typed and unsafe results",()=>{
    assert.equal(productionBackupRowCount({rowCount:1,rows:[{row_count:"0"}]}),0);
    assert.equal(productionBackupRowCount({rowCount:1,rows:[{row_count:"3"}]}),3);
    for(const bad of[{rowCount:0,rows:[]},{rowCount:1,rows:[{row_count:0}]},
      {rowCount:1,rows:[{row_count:"03"}]},{rowCount:1,rows:[{row_count:"-1"}]},
      {rowCount:1,rows:[{row_count:"9007199254740992"}]},{rowCount:1,rows:[{row_count:"3"},{row_count:"3"}]}])
      assert.throws(()=>productionBackupRowCount(bad));
  });
  run("complete original pages preserve values without coercion",()=>{
    const rows=[{row:'{"original_tuple":{"title":"  Original  ","members":["second","first"]},"original_encoded":"  protected original bytes  "}'},
      {row:'{"original_tuple":null,"original_encoded":"opaque"}'},{row:'{"original_tuple":{"epoch":"9007199254740993"},"original_encoded":"last"}'}];
    const before=JSON.stringify(rows);
    const first={rowCount:2,rows:rows.slice(0,2)},second={rowCount:1,rows:rows.slice(2)};
    assert.strictEqual(requireProductionBackupPage(first,{offset:0,rowCount:3,pageSize:2}),first.rows);
    assert.strictEqual(requireProductionBackupPage(second,{offset:2,rowCount:3,pageSize:2}),second.rows);
    const lines=[...first.rows,...second.rows].map(item=>JSON.stringify(item.row));
    assert.equal(lines.length,3);assert.equal(JSON.stringify(rows),before);
    assert.deepEqual(lines.map(line=>JSON.parse(line)),rows.map(item=>item.row));
  });
  run("short empty excessive contradictory or malformed pages refuse",()=>{
    for(const bad of[{rowCount:0,rows:[]},{rowCount:1,rows:[{row:'{}'}]},
      {rowCount:1,rows:[{row:'{}'},{row:'{}'}]},{rowCount:3,rows:[{row:'{}'},{row:'{}'},{row:'{}'}]},
      {rowCount:2,rows:[{row:'{}'},{row:null}]},{rowCount:2,rows:[{row:'{}'},{}]}])
      assert.throws(()=>requireProductionBackupPage(bad,{offset:0,rowCount:3,pageSize:2}));
    assert.throws(()=>requireProductionBackupPage({rowCount:1,rows:[{row:'{}'}]},{offset:3,rowCount:3,pageSize:2}));
  });
  run("normal exporter wiring includes private rows before signature",()=>{
    const source=readFileSync(new URL("./production-backup.mjs",import.meta.url),"utf8");
    assert.ok(source.includes("const schemas = productionBackupDataSchemas;"));
    assert.ok(source.indexOf("for (const statement of productionBackupSnapshotStatements)")<source.indexOf("select pg_export_snapshot()"));
    assert.ok(source.includes("requireProductionBackupDataScope(namespaceResult.rows,privateRelationResult.rows,catalogResult.rows)"));
    assert.ok(source.includes("const countedRows = productionBackupRowCount(countResult);"));
    assert.ok(source.includes("requireProductionBackupPage(result,{offset,rowCount:countedRows,pageSize})"));
    assert.equal(source.includes("if (!rows.rowCount) break;"),false);
    assert.ok(source.indexOf("tableCatalog.push(")<source.indexOf("archiveSignatureBinding({"));
  });

  const fs=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{spawnSync}=await import('node:child_process');
  const {createHash}=await import('node:crypto'),{archiveSignatureBinding,signBinding,stableJsonFile}=await import('./disaster-recovery-crypto.mjs');
  const argument=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
  const captured=path=>{const result=JSON.parse(fs.readFileSync(path)),wrapper=JSON.parse(result.content[0].text);
    const found=wrapper.result.match(/(?:^|\n)<untrusted-data-[^>]+>\s*([\s\S]*?)\s*<\/untrusted-data-/);
    assert.ok(found);const rows=JSON.parse(found[1]);assert.equal(rows.length,1);return rows[0];};
  // Metadata replicas never supply native-client/snapshot or restore authority.
  const actualScopePath=argument('--observed-scope-capture'),actualMetadataPath=argument('--observed-metadata-capture');
  assert.equal(!!actualScopePath,!!actualMetadataPath);
  const scope=actualScopePath?captured(actualScopePath).backup_scope:{namespaces,private_relations:[],table_catalog:['public','auth','storage'].map(schema_name=>({schema_name,table_name:'UNIT_records',primary_key:['id'],columns:[{name:'id',generated:'',identity:'',data_type:'bigint'},{name:'value',generated:'',identity:'',data_type:'json'}]}))};
  const guardIds=['custodial_release_identity.guard_group_original_creation()','custodial_dr.guard_application_mutation()'];
  const original=actualMetadataPath?captured(actualMetadataPath).original_metadata:{relations:scope.table_catalog.map(table=>({...table,relation_kind:'r',is_partition:false,owner_name:'UNIT_owner',relrowsecurity:false,relforcerowsecurity:false})),guards:[{definition:null,prosrc:null,owner:null},{owner:'UNIT_owner',prosrc:'\nBEGIN\n RETURN NEW;\nEND\n',definition:'CREATE OR REPLACE FUNCTION '+guardIds[1]+'\nAS $function$\nBEGIN\n RETURN NEW;\nEND\n$function$\n'}]};
  run('empty private producer metadata -> actual restore VERIFY -> encrypted readback agreement',()=>{
    requireProductionBackupDataScope(scope.namespaces,scope.private_relations,scope.table_catalog);
    const moduleSource=fs.readFileSync(new URL('./production-backup-original-metadata.mjs',import.meta.url),'utf8');
    const fieldsStart=moduleSource.indexOf('function fields(value,keys){'),rowsStart=moduleSource.indexOf('function rows(reply){',fieldsStart);
    const guardStart=moduleSource.indexOf('function requireOriginalPrivateRelationGuardData('),guardEnd=moduleSource.indexOf('export async function captureProductionBackupOriginalMetadata',guardStart);
    const validate=new Function('assert','Buffer','GUARDS',moduleSource.slice(fieldsStart,rowsStart)+moduleSource.slice(guardStart,guardEnd)+'\nreturn requireOriginalPrivateRelationGuardData;')(assert,Buffer,guardIds);
    validate(original.relations,original.guards);assert.equal(original.relations.length,scope.table_catalog.length);
    const base=fs.mkdtempSync(join(tmpdir(),'custodial-observed-empty-pipeline-')),archive=join(base,'archive'),readback=join(base,'readback');
    const hash=value=>createHash('sha256').update(value).digest('hex'),entries=new Map(),unitKey='UNIT-empty-private-archive-signing-key-0001',unitId='UNIT-empty-private';
    fs.mkdirSync(archive,{mode:0o700});fs.mkdirSync(join(archive,'database'),{mode:0o700});fs.mkdirSync(join(archive,'inventory'),{mode:0o700});
    const emit=(name,bytes)=>{const value=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);fs.writeFileSync(join(archive,name),value,{mode:0o600});entries.set(name,value);return hash(value);};
    try{
      const tables=scope.table_catalog.map(table=>({...table,row_count:'0',data_file:'database/'+table.schema_name+'.'+table.table_name+'.jsonl',data_encoding:backupWire.productionBackupTextColumnsDataEncoding}));
      for(const table of tables){assert.match(table.data_file,/^database\/(public|auth|storage)\.[A-Za-z0-9_]+\.jsonl$/);emit(table.data_file,Buffer.alloc(0));}
      const identity={migration_head:'20261021111917',migration_ledger_count:1,cron_job_count:0,release:{migration_head:'20261021111917'}};
      for(const[name,field,value]of [['application-schema.sql','application_schema_sha256','-- UNIT schema DATA only; no SQL execution\n'],['migration-ledger.json','migration_ledger_sha256',[{version:'20261021111917',name:'UNIT_original',statements:[]}]],['cron-jobs.json','cron_jobs_sha256',[]],['extensions.json','extensions_sha256',[]],['runtime-contract.json','runtime_contract_sha256',{}],['runtime-configuration.json','runtime_configuration_sha256',{}],['original-relations.json','original_relations_sha256',original.relations],['original-guards.json','original_guards_sha256',original.guards],['original-acls.json','original_acls_sha256',{UNIT_fixture_metadata:true}]])identity[field]=emit('inventory/'+name,typeof value==='string'?value:stableJsonFile(value));
      identity.database_catalog_sha256=emit('inventory/table-catalog.json',stableJsonFile(tables));emit('inventory/storage-buckets.json','[]\n');emit('inventory/storage-objects.json','[]\n');
      const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',consistent_database_snapshot:true,project_ref:'abcdefghijklmnopqrst',backed_up_schemas:['public','auth','storage','custodial_release_identity'],source_identity:identity,table_count:tables.length,database_row_count:0,storage_bucket_count:0,storage_object_count:0};
      emit('backup-summary.json',stableJsonFile(summary));const sums=[...entries].sort(([a],[b])=>a.localeCompare(b)).map(([name,bytes])=>hash(bytes)+'  '+name).join('\n')+'\n';fs.writeFileSync(join(archive,'SHA256SUMS'),sums,{mode:0o600});const digest=hash(sums);
      fs.writeFileSync(join(archive,'archive-signature.json'),stableJsonFile({format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',key_id:unitId,archive_digest:digest,signature:signBinding(archiveSignatureBinding({archiveDigest:digest,projectRef:summary.project_ref,sourceIdentity:identity,archiveFormat:summary.format}),unitKey)}),{mode:0o600});
      const verify=directory=>{const run=spawnSync(process.execPath,[new URL('./production-restore.mjs',import.meta.url).pathname],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,RESTORE_SOURCE_DIR:directory,RESTORE_ARCHIVE_VERIFY_KEY:unitKey,RESTORE_ARCHIVE_VERIFY_KEY_ID:unitId,RESTORE_APPLY:'false'}});assert.equal(run.status,0,run.stderr);const output=JSON.parse(run.stdout);assert.equal(output.archive_verified,true);assert.equal(output.dry_run,true);assert.equal(output.selected_private_tables,0);assert.equal(output.selected_database_tables,tables.filter(table=>table.schema_name!=='storage').length);assert.equal(output.tables,tables.length);assert.equal(output.restore_compatible,false);assert.equal(output.data_import_blocker,'NATIVE_TEXT_RESTORE_REQUIRES_IMMUTABLE_ORIGINAL_ROUTE');return output;};
      const first=verify(archive),pass='UNIT fixture encryption only, never a production key';
      const execute=(name,args)=>{const run=spawnSync(name,args,{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,UNIT_BACKUP_TEST_PASSPHRASE:pass}});assert.equal(run.status,0,run.stderr);};
      execute('tar',['-C',archive,'-czf',join(base,'archive.tar.gz'),'.']);execute('openssl',['enc','-aes-256-cbc','-salt','-pbkdf2','-iter','250000','-in',join(base,'archive.tar.gz'),'-out',join(base,'archive.enc'),'-pass','env:UNIT_BACKUP_TEST_PASSPHRASE']);execute('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-iter','250000','-in',join(base,'archive.enc'),'-out',join(base,'readback.tar.gz'),'-pass','env:UNIT_BACKUP_TEST_PASSPHRASE']);fs.mkdirSync(readback,{mode:0o700});execute('tar',['-C',readback,'-xzf',join(base,'readback.tar.gz')]);
      for(const[name,bytes]of entries)assert.deepEqual(fs.readFileSync(join(readback,name)),bytes);const second=verify(readback);assert.equal(second.archive_digest,first.archive_digest);
      assert.deepEqual(JSON.parse(fs.readFileSync(join(readback,'inventory/original-guards.json'))),original.guards);
      console.log(JSON.stringify({scope:'EMPTY_PRIVATE_COUPLED_VERIFY_AND_UNIT_ENCRYPTED_READBACK',metadata_replica_tables:tables.length,actual_metadata_replica:!!actualScopePath,private_tables:0,actual_native_snapshot_capture:false,production_data_rows:0,SQL:false,real_keys:false,real_backup:false,restore_APPLY:false,restore_fidelity:'NOT_QUALIFIED'}));
    }finally{fs.rmSync(base,{recursive:true,force:true});}
  });
  console.log(JSON.stringify({selector:"--private-original-capture-only",status:"PASS_SOURCE_AND_UNIT_ARCHIVE_PIPELINE",cases,
    count:cases.length,limits:"Synthetic or recorded metadata DATA, actual VERIFY CLI and UNIT encryption readback only; no native snapshot capture, production rows/keys/export, SQL target, restore APPLY or restore-fidelity qualification."}));
  process.exit(0);
}

const defaultArgs = productionBackupPgDumpDockerArgs(fixture);
assert.deepEqual(defaultArgs.slice(0, 4), ["run", "--rm", "--entrypoint", "pg_dump"]);
assert.equal(defaultArgs.includes("--network"), false, "default/GitHub backup must retain Docker's isolated default network");
assert.deepEqual(defaultArgs.slice(defaultArgs.indexOf("PGSSLMODE=verify-full") - 1, defaultArgs.indexOf("PGSSLMODE=verify-full") + 3), [
  "-e", "PGSSLMODE=verify-full", "-e", "PGSSLROOTCERT=/cert/prod-ca.crt",
]);
assert.deepEqual(defaultArgs.slice(defaultArgs.indexOf("--host"), defaultArgs.indexOf("--host") + 8), [
  "--host", fixture.databaseHost,
  "--port", fixture.databasePort,
  "--username", fixture.databaseUsername,
  "--dbname", fixture.databaseName,
]);
assert.equal(defaultArgs.includes("--use-set-session-authorization"), false,
  "ordinary owner serialization must preserve transferred-owner creation privileges; the isolated adapter scopes only event-trigger creation");
assert.ok(defaultArgs.includes(`--snapshot=${fixture.exportedSnapshot}`),
  "owner-preserving serialization must retain the exact exported transaction snapshot");
assert.equal(defaultArgs.includes("--no-owner"), false,
  "owner-preserving backup serialization must never omit the source owners");

const hostNetworkArgs = productionBackupPgDumpDockerArgs({
  ...fixture,
  databaseHost: "db.rqquvtjdmugpigbndmne.supabase.co",
  executionMode: "task-local",
  networkHost: true,
});
assert.deepEqual(hostNetworkArgs.slice(0, 6), ["run", "--rm", "--entrypoint", "pg_dump", "--network", "host"]);
assert.equal(hostNetworkArgs[hostNetworkArgs.indexOf("--host") + 1], "db.rqquvtjdmugpigbndmne.supabase.co",
  "pg_dump retains the certificate hostname even when the host resolves IPv6-only");
assert.ok(hostNetworkArgs.includes("PGSSLMODE=verify-full"));
assert.ok(hostNetworkArgs.includes("PGSSLROOTCERT=/cert/prod-ca.crt"));
assert.equal(hostNetworkArgs.includes("--use-set-session-authorization"), false,
  "local and hosted backups must use the same ordinary owner-preserving serialization");

assert.throws(() => productionBackupPgDumpDockerArgs({ ...fixture, networkHost: true }), /task-local backup access/);
assert.throws(() => productionBackupPgDumpDockerArgs({
  ...fixture,
  executionMode: "task-local",
  networkHost: true,
}), /task-local backup access/);
assert.throws(() => productionBackupPgDumpDockerArgs({
  ...fixture,
  databaseHost: "db.rqquvtjdmugpigbndmne.supabase.co",
  executionMode: "github-actions",
  networkHost: true,
}), /task-local backup access/);
assert.throws(() => productionBackupPgDumpDockerArgs({
  ...fixture,
  databaseHost: "2001:db8::1234",
  executionMode: "task-local",
  networkHost: true,
}), /task-local backup access/, "an IPv6 literal must not bypass verify-full hostname identity");

console.log("PRODUCTION_BACKUP_PG_DUMP_COMMAND_TESTS_PASS");
