#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  archiveSignatureBinding,
  releaseMigrationRehearsalAttestationBinding,
  restoreIntentBinding,
  signBinding,
  verifyBinding,
} from "./disaster-recovery-crypto.mjs";

import * as originalIntentCaptureCrypto from "./disaster-recovery-crypto.mjs";

// Newly affected creator control/manifest binding only. Full post-config
// issuer Source with inert DB/provider ports; UUID/signing construction cut.
if(process.argv.includes("--reconciliation-creator-manifest-only")){
 const {readFileSync}=await import("node:fs"),{createHash}=await import("node:crypto");
 const {default:pgTypes}=await import("pg-types");
 const {isExplicitLocalRestoreFixtureTarget}=await import("./disaster-recovery-storage.mjs");
 const source=readFileSync(new URL("./create-production-restore-reconciliation.mjs",import.meta.url),"utf8");
 const helpers=source.indexOf("function sha256(value)"),client=source.indexOf("const db = new Client({");
 const intent=source.indexOf("  const intent = {",client);
 const cleanup=source.indexOf("} catch (error) {\n  firstFailure = error;\n  failed = true;\n} finally {",intent);
 const native="const endReconciliationIntentClient = Client.prototype.end;";
 assert.ok(helpers>0&&client>helpers&&intent>client&&cleanup>intent);assert.equal(source.split(native).length,2);
 const actual=native+"\n"+source.slice(helpers,intent)
  +"  pendingEnvelope = captureBoundary({state,manifest,authorityGeneration,resolutions,storageSupportedStateResample});\n"+source.slice(cleanup);
 for(const forbidden of ["signBinding","randomUUID","requireSigningKey"])assert.equal(actual.includes(forbidden),false);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction("Client","createHash","stableJson","isExplicitLocalRestoreFixtureTarget",
  "testStorageBytes","databaseUrl","databaseCaCertPath","statusMode","projectRef","requestedResolutions",
  "captureBoundary","createClient","captureStorageSupportedState","validateStorageOperatorEvidence","console",actual);
 const parseInt8=pgTypes.getTypeParser(20,"text");
 const id="01234567-89ab-cdef-0123-456789abcdef",project="abcdefghijklmnopqrst",archive="a".repeat(64);
 let coercions=0,negative=0,positive=0;
 const boxed=value=>({toString(){coercions++;return value;}});
 async function invoke(change=()=>{}){
  const state={state:"PAUSED_RECONCILIATION",mutations_paused:true,restore_id:id,
   authority_generation:parseInt8("1"),archive_digest:archive,target_project_ref:project};
  const manifest={restore_id:id,authority_generation:parseInt8("1"),archive_digest:archive,database_verified:true,
   authority_invalidated:true,post_restore_verified:true,storage_verified:true,final_manifest_sha256:"c".repeat(64)};
  const input={state,manifest,controlResult:{rowCount:1,rows:[state]},manifestResult:{rowCount:1,rows:[manifest]}};
  change(input);
  const trace=[],logs=[],counts={manifest:0,discrepancies:0,boundary:0,rollback:0,end:0,provider:0};
  let captured,caught=false,error;
  function Client(){trace.push("construct");}
  Client.prototype.connect=async()=>{trace.push("connect");await Promise.resolve();};
  Client.prototype.query=async(sql,args)=>{
   await Promise.resolve();
   if(sql==="begin isolation level repeatable read read only"){trace.push("begin");return {};}
   if(sql==="rollback"){counts.rollback++;trace.push("rollback");return {};}
   if(sql==="select * from custodial_dr.restore_control where singleton=true"){
    trace.push("control");return input.controlResult;
   }
   if(sql==="select * from custodial_dr.restore_manifests where restore_id=$1"){
    assert.deepEqual(args,[state.restore_id]);counts.manifest++;trace.push("manifest");return input.manifestResult;
   }
   if(sql.includes("from custodial_dr.restore_discrepancies")){
    assert.deepEqual(args,[state.restore_id]);counts.discrepancies++;trace.push("discrepancies");return{rowCount:0,rows:[]};
   }
   throw Error("Unapproved recording statement; no SQL port exists");
  };
  Client.prototype.end=async()=>{counts.end++;trace.push("end");await Promise.resolve();};
  const prohibited=()=>{counts.provider++;throw Error("No real Storage/evidence provider fixture");};
  try{
   await run(Client,createHash,originalIntentCaptureCrypto.stableJson,isExplicitLocalRestoreFixtureTarget,
    "","RECORDING_ONLY","",false,project,[],value=>{
     counts.boundary++;trace.push("boundary");captured=value;
     return Object.freeze({fixture:"UNSIGNED_CREATOR_PRE_SIGN_RECORDING"});
    },prohibited,prohibited,prohibited,{log(value){trace.push("emit");logs.push(value);}});
  }catch(observed){caught=true;error=observed;}
  return {input,trace,logs,counts,captured,caught,error};
 }
 for(const generation of ["1",String(Number.MAX_SAFE_INTEGER)]){
  const result=await invoke(x=>{
   x.state.authority_generation=parseInt8(generation);x.manifest.authority_generation=parseInt8(generation);
   assert.equal(typeof x.state.authority_generation,"string");assert.equal(typeof x.manifest.authority_generation,"string");
  });
  assert.equal(result.caught,false);
  assert.deepEqual(result.trace,["construct","connect","begin","control","manifest","discrepancies","boundary","rollback","end","emit"]);
  assert.equal(result.counts.boundary,1);assert.equal(result.counts.provider,0);
  assert.equal(String(result.captured.authorityGeneration),generation);
  assert.equal(result.captured.state,result.input.state);assert.equal(result.captured.manifest,result.input.manifest);
  assert.equal(Object.hasOwn(result.captured.manifest,"target_project_ref"),false,"Manifest has no invented project column");
  assert.deepEqual(result.logs,[JSON.stringify({fixture:"UNSIGNED_CREATOR_PRE_SIGN_RECORDING"})]);positive++;
 }
 const refuse=async(change,atManifest=true)=>{
  const result=await invoke(change);assert.equal(result.caught,true);
  assert.ok(result.error instanceof Error);assert.equal(result.counts.boundary,0);assert.equal(result.counts.discrepancies,0);
  assert.equal(result.counts.provider,0);assert.equal(result.counts.rollback,1);assert.equal(result.counts.end,1);
  assert.equal(result.counts.manifest,atManifest?1:0);assert.deepEqual(result.logs,[]);
  assert.deepEqual(result.trace,["construct","connect","begin","control",...(atManifest?["manifest"]:[]),"rollback","end"]);negative++;
 };
 // Each identity is independent; all native int8 generation comparison stays
 // exact canonical STRING, never coercion/adoption of observed receipt data.
 for(const [field,value] of [
  ["restore_id","22222222-2222-2222-2222-222222222222"],["restore_id",null],["restore_id",boxed(id)],
  ["archive_digest","b".repeat(64)],["archive_digest",null],["archive_digest",boxed(archive)],
  ["authority_generation","2"],["authority_generation",1],["authority_generation",1n],
  ["authority_generation","01"],["authority_generation","1 "],["authority_generation","1\n"],
  ["authority_generation","1e0"],["authority_generation",null],
  ["final_manifest_sha256",null],["final_manifest_sha256","c".repeat(64)+"\n"],
  ["final_manifest_sha256","C".repeat(64)],["final_manifest_sha256",boxed("c".repeat(64))],
  ["database_verified",false],["authority_invalidated","true"],["post_restore_verified",1],
 ]){
  await refuse(x=>{x.manifest[field]=value;});
 }
 for(const field of ["restore_id","authority_generation","archive_digest"])await refuse(x=>{delete x.manifest[field];});
 for(const mode of ["missing","zero-count","duplicate","length-mismatch","string-count","nonarray","hole","null-row"]){
  await refuse(x=>{
   if(mode==="missing")x.manifestResult={rowCount:0,rows:[]};
   if(mode==="zero-count")x.manifestResult.rowCount=0;
   if(mode==="duplicate")x.manifestResult={rowCount:2,rows:[x.manifest,x.manifest]};
   if(mode==="length-mismatch")x.manifestResult.rows=[x.manifest,x.manifest];
   if(mode==="string-count")x.manifestResult.rowCount="1";
   if(mode==="nonarray")x.manifestResult.rows={0:x.manifest,length:1};
   if(mode==="hole")x.manifestResult.rows=Array(1);
   if(mode==="null-row")x.manifestResult.rows=[null];
  });
 }
 for(const mode of ["missing","zero-count","duplicate","length-mismatch","string-count","nonarray","hole"]){
  await refuse(x=>{
   if(mode==="missing")x.controlResult={rowCount:0,rows:[]};
   if(mode==="zero-count")x.controlResult.rowCount=0;
   if(mode==="duplicate")x.controlResult={rowCount:2,rows:[x.state,x.state]};
   if(mode==="length-mismatch")x.controlResult.rows=[x.state,x.state];
   if(mode==="string-count")x.controlResult.rowCount="1";
   if(mode==="nonarray")x.controlResult.rows=null;
   if(mode==="hole")x.controlResult.rows=Array(1);
  },false);
 }
 for(const [field,value] of [
  ["restore_id",boxed(id)],["restore_id","not-uuid"],["restore_id",id.toUpperCase()],
  ["archive_digest",null],["archive_digest",boxed(archive)],["archive_digest",archive+"\n"],
 ])await refuse(x=>{x.state[field]=value;},false);
 {
  const result=await invoke(x=>{x.manifest.storage_verified=false;});
  assert.equal(result.caught,true);assert.match(result.error.message,/unverified Storage manifest requires/);
  assert.equal(result.counts.boundary,0);assert.equal(result.counts.provider,0);
  assert.equal(result.counts.discrepancies,1);assert.equal(result.counts.rollback,1);assert.equal(result.counts.end,1);
  assert.deepEqual(result.logs,[]);
 }
 assert.equal(coercions,0);
 console.log(JSON.stringify({scope:"NEW reconciliation creator original manifest",status:"PASS_POST_CONFIG_SOURCE_RECORDING_ONLY",
  valid_native_int8_typed_boundaries:positive,new_binding_refusals:negative,retained_storage_refusal_controls:1,
  coercions,signatures:0,keys_retrieved:0,SQL:"NOT_RUN",connections:0,resources:0,
  limits:"Full actual post-config issuer Source with inert queries/provider and signing body cut; no valid signature, real readonly snapshot, RLS/owner or reconciliation admission proof."}));
 process.exit(0);
}

if (process.argv.includes("--reconciliation-original-expiry-only")) {
 const {readFileSync}=await import("node:fs"),{types}=await import("node:util");
 const {default:pgTypes}=await import("pg-types");
 const parseBoolean=pgTypes.getTypeParser(16,"text");
 const source=readFileSync(new URL("./apply-production-restore-reconciliation.mjs",import.meta.url),"utf8");
 const captureStart=source.indexOf("const originalReconciliationExpiresAt = intent.expires_at;");
 const captureEnd=source.indexOf("\nfunction sha256",captureStart);
 const requestStart=source.indexOf("const originalReconciliationRequest = Object.freeze({");
 const flowStart=source.indexOf("\ntry {\n  requireOriginalReconciliationClient();",requestStart)+1;
 const businessStart=source.indexOf("  const controlResult = ",flowStart);
 const replayStart=source.indexOf("    await requireOriginalReconciliationPublicationLifetime();",businessStart);
 const replayEnd=source.indexOf("\n  } else {",replayStart);
 const normalStart=source.indexOf("  await requireOriginalReconciliationPublicationLifetime();\n  const resumed =",replayEnd);
 const normalEnd=source.indexOf("\n  }\n  requireOriginalReconciliationNodeLifetime();",normalStart);
 assert.ok(captureStart>0&&captureEnd>captureStart&&requestStart>captureEnd&&flowStart>requestStart
  &&businessStart>flowStart&&replayStart>businessStart&&replayEnd>replayStart&&normalStart>replayEnd&&normalEnd>normalStart);
 // Exact expiry capture/helpers, unchanged one-shot commit, publication writes
 // and lifecycle shell. Existing signed-auth/owner/discrepancy/Storage business
 // validation is NOT executed/stubbed as successful: branch selection and its
 // pre-publication wait are inert DATA recordings ONLY, not native SQL, owner,
 // clock, profile, reconciliation, signature or resume permission.
 const actual=source.slice(captureStart,captureEnd)+source.slice(requestStart,flowStart)+source.slice(flowStart,businessStart)+
  "if (recordingReplay) {\n"+source.slice(replayStart,replayEnd)+"\n} else {\nawait recordingStorage();\n"+
  source.slice(normalStart,normalEnd)+"\n  }"+source.slice(normalEnd+"\n  }".length);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const runFlow=new AsyncFunction("types","intent","expiresAt","Date","Client","db","nativeClientPrototype","nativeQuery",
  "nativeConnect","nativeEnd","recordingReplay","recordingStorage","intentDigest","reconciliationManifestSha256","console","process",actual);
 const stamp="2026-10-17T12:01:00.000Z",deadline=Date.parse(stamp),start=deadline-1000;
 const intentData=()=>({expires_at:stamp,restore_id:"11111111-1111-4111-8111-111111111111",authority_generation:7,
  reconciliation_id:"22222222-2222-4222-8222-222222222222",archive_digest:"a".repeat(64),actor:"UNSIGNED_RECORDING_DATA",
  final_manifest_sha256:"b".repeat(64),discrepancy_snapshot_sha256:"c".repeat(64),resolutions:[],storage_supported_state_resample:null});
 const clockSql="select pg_catalog.clock_timestamp() < $1::pg_catalog.timestamptz as original_intent_current";
 const receipt=value=>({command:"SELECT",rowCount:1,rows:[{original_intent_current:value}]});
 const journey=async(options={})=>{
  const events=[],logs=[],errors=[],clockParameters=[];let now=start,clocks=0,commits=0,rollbacks=0,updates=0;
  const intent=intentData(),original={restore_id:intent.restore_id,authority_generation:7,reconciliation_id:intent.reconciliation_id,archive_digest:intent.archive_digest};
  function Client(){}
  Client.prototype.connect=async function(){events.push("connect");};
  Client.prototype.end=async function(){events.push("end");if(options.expireOnEnd)now=deadline;};
  Client.prototype.query=async function(sql,parameters){
   assert.equal(this,db);
   if(sql===clockSql){
    events.push("clock");clocks++;clockParameters.push([...parameters]);
    assert.deepEqual(parameters,[stamp]);
    if(Object.hasOwn(options,"queryFailure"))throw options.queryFailure;
    const value=receipt(parseBoolean(now<deadline?"t":"f"));
    if(options.mutateIntent)intent.expires_at="2026-10-18T12:01:00.000Z";
    await Promise.resolve();
    if(options.expireOnClockReturn)now=deadline;
    if(options.withdrawOnClockReturn)Client.prototype.query=async()=>{throw Error("late replacement must not run");};
    return Object.hasOwn(options,"clockReceipt")?options.clockReceipt:value;
   }
   if(sql==="commit"){events.push("commit");commits++;if(options.expireOnCommitReturn)now=deadline;
    return {command:"COMMIT",rowCount:null,rows:[]};}
   if(sql==="rollback"){events.push("rollback");rollbacks++;return {command:"ROLLBACK",rowCount:null,rows:[]};}
   if(sql.includes("update custodial_dr.restore_control")){events.push("resumed-control-uncommitted");updates++;
    if(options.expireAfterUpdate)now=deadline;return {rowCount:1,rows:[]};}
   if(sql.includes("insert into custodial_dr.restore_events")){events.push("event-uncommitted");return {rowCount:1,rows:[]};}
   assert.ok(sql.startsWith("select pg_advisory_")||sql==="begin isolation level serializable","Unexpected inert SQL");
   events.push(sql);return {rowCount:1,rows:[]};
  };
  const db=Object.create(Client.prototype),nativeClientPrototype=Client.prototype;
  const nativeQuery=Client.prototype.query,nativeConnect=Client.prototype.connect,nativeEnd=Client.prototype.end;
  const processData={exitCode:0};let failed=false,failure;
  try{await runFlow(types,intent,deadline,{now:()=>now},Client,db,nativeClientPrototype,nativeQuery,nativeConnect,nativeEnd,
   !!options.replay,async()=>{events.push("inert-storage-await");await Promise.resolve();
    if(options.expireInStorage)now=deadline;if(options.mutateIntent)intent.expires_at="2026-10-18T12:01:00.000Z";},
   "d".repeat(64),null,{log(value){events.push("positive-output");logs.push(JSON.parse(value));},
    error(value){events.push("unknown-output");errors.push(JSON.parse(value));}},processData);
  }catch(error){failed=true;failure=error;}
  return {events,logs,errors,clockParameters,clocks,commits,rollbacks,updates,original,processData,failed,failure};
 };
 const preCommitRefused=result=>{assert.equal(result.failed,true);assert.equal(result.commits,0);assert.equal(result.rollbacks,1);
  assert.deepEqual(result.logs,[]);assert.deepEqual(result.errors,[]);assert.ok(result.events.includes("end"));};
 const unknown=result=>{assert.equal(result.failed,false);assert.equal(result.commits,1);assert.equal(result.rollbacks,0);
  assert.deepEqual(result.logs,[]);assert.equal(result.errors.length,1);assert.equal(result.processData.exitCode,1);
  assert.deepEqual(result.errors[0],{ok:false,code:"RESTORE_RECONCILIATION_COMMIT_CONFIRMED_CLEANUP_FAILED",
   outcome:"UNKNOWN",retry_safe:false,read_request:result.original});};
 let passed=0;
 const pendingOnly=process.argv.includes("--reconciliation-expiry-pending-only");
 const pendingNames=["malformed-or-nonboolean-native-result-data-failclosed-no-accessors",
  "original-native-port-withdrawal-after-clock-await-refuses","original-query-failure-primitives-retained-no-commit"];
 const run=async(name,test)=>{if(pendingOnly&&!pendingNames.includes(name))return;
  await test();passed++;console.log(`RECONCILIATION_ORIGINAL_EXPIRY_NEW ${name} PASS`);};
 await run("normal-and-replay-check-original-db-clock-before-commit",async()=>{
  for(const replay of [false,true]){
   const value=await journey({replay,mutateIntent:true});assert.equal(value.failed,false);
   assert.equal(value.clocks,replay?1:2);assert.equal(value.commits,1);assert.equal(value.rollbacks,0);
   assert.equal(value.updates,replay?0:1);assert.equal(value.logs.length,1);assert.deepEqual(value.errors,[]);
   assert.equal(value.events[value.events.indexOf("commit")-1],"clock");
   if(!replay)assert.equal(value.events[value.events.indexOf("resumed-control-uncommitted")-1],"clock");
   assert.ok(value.clockParameters.every(values=>values.length===1&&values[0]===stamp));
   assert.equal(value.events.at(-1),"positive-output");assert.equal(value.events.at(-2),"end");
  }
 });
 await run("storage-await-expiry-refuses-before-resumed-update",async()=>{
  const value=await journey({expireInStorage:true,mutateIntent:true});preCommitRefused(value);assert.equal(value.updates,0);
 });
 await run("expiry-between-uncommitted-update-and-commit-rolls-back",async()=>{
  const value=await journey({expireAfterUpdate:true});preCommitRefused(value);assert.equal(value.updates,1);assert.equal(value.clocks,2);
 });
 await run("matched-replay-expiry-refuses-before-commit",async()=>{
  const value=await journey({replay:true,clockReceipt:receipt(parseBoolean("f"))});preCommitRefused(value);assert.equal(value.updates,0);
 });
 await run("expiry-during-db-clock-return-refuses-before-publication",async()=>{
  const value=await journey({expireOnClockReturn:true});preCommitRefused(value);assert.equal(value.updates,0);
 });
 await run("post-commit-and-cleanup-expiry-retain-exact-original-unknown",async()=>{
  for(const replay of [false,true])for(const option of ["expireOnCommitReturn","expireOnEnd"])
   unknown(await journey({replay,[option]:true,mutateIntent:true}));
 });
 await run("malformed-or-nonboolean-native-result-data-failclosed-no-accessors",async()=>{
  let traps=0;
  const getter=Object.defineProperty(receipt(true),"rows",{get(){traps++;return [];}});
  const rowGetter=Object.defineProperty({},"original_intent_current",{enumerable:true,get(){traps++;return true;}});
  // Native await resolves the recording promise BEFORE shipping validation;
  // permit only its intrinsic then lookup, not descriptor/prototype access.
  // First failed fixture receipt4c8f5d retained; product guards unchanged.
  const proxy=new Proxy(receipt(true),{get(target,key){if(key==="then")return undefined;
   traps++;throw Error("proxy trap");},ownKeys(){traps++;throw Error("proxy trap");}});
  const rowProxy=new Proxy({}, {getPrototypeOf(){traps++;throw Error("row proxy trap");}});
  const rowArray=[];Object.defineProperty(rowArray,"0",{enumerable:true,get(){traps++;return {original_intent_current:true};}});
  for(const value of [null,{},proxy,getter,{...receipt(true),command:"UPDATE"},{...receipt(true),rowCount:"1"},
   {...receipt(true),rows:[]},{...receipt(true),rows:rowArray},{...receipt(true),rows:[rowGetter]},
   {...receipt(true),rows:[rowProxy]},{...receipt(true),rows:[{original_intent_current:true,extra:true}]},
   receipt(false),receipt("true"),receipt(1),receipt(null)]){
   const result=await journey({clockReceipt:value});preCommitRefused(result);assert.equal(result.updates,0);
  }
  assert.equal(traps,0);assert.equal(parseBoolean("t"),true);assert.equal(parseBoolean("f"),false);
 });
 await run("original-native-port-withdrawal-after-clock-await-refuses",async()=>{
  const value=await journey({withdrawOnClockReturn:true});preCommitRefused(value);assert.equal(value.updates,0);
 });
 await run("original-query-failure-primitives-retained-no-commit",async()=>{
  for(const queryFailure of [Object.freeze(Error("original clock read failure")),undefined,null,"original primitive"]){
   const result=await journey({queryFailure});preCommitRefused(result);assert.equal(result.failure,queryFailure);
  }
 });
 console.log(`RECONCILIATION_ORIGINAL_EXPIRY_NEW ${passed} groups PASS; inert Source/pg-boolean-parser only; SQL/auth/signatures/genuine clock NOT_RUN`);
 process.exit(0);
}

async function canonicalRestoreSignatureWireCases(){
 // Public disposable UNIT vector only. No archive construction, real keys,
 // source/target approval, currentness, SQL, signer stub or caller VM needed.
 const {createHmac}=await import('node:crypto'),{readFileSync}=await import('node:fs');
 const crypto=originalIntentCaptureCrypto;
 const key='UNIT-only-canonical-restore-signature-HMAC-key-20261017-task9';
 const keyId='unit-canonical-restore-signature-v1',project='abcdefghijklmnopqrst';
 const intent={restore_id:'11111111-1111-4111-8111-111111111111',authority_generation:7,retry_of_restore_id:null,
  archive_digest:'a'.repeat(64),source_project_ref:project,target_project_ref:project,source_identity_sha256:'b'.repeat(64),
  target_migration_head:'20261017000000',target_release_identity:{release_id:'UNIT_METADATA_ONLY',backend_commit:'c'.repeat(40),
   frontend_commit:'d'.repeat(40),migration_head:'20261017000000',migration_manifest_sha256:'e'.repeat(64)},
  actor:'UNIT_SIGNATURE_WIRE_ONLY',approved_at:'2026-10-17T00:00:00.000Z',expires_at:'2026-10-17T01:00:00.000Z',resume_after_verification:false};
 const reconciliation={reconciliation_id:'22222222-2222-4222-8222-222222222222',restore_id:intent.restore_id,
  authority_generation:7,archive_digest:intent.archive_digest,target_project_ref:project,final_manifest_sha256:'f'.repeat(64),
  discrepancy_snapshot_sha256:'1'.repeat(64),storage_supported_state_resample:null,resolutions:[],actor:intent.actor,
  approved_at:intent.approved_at,expires_at:intent.expires_at};
 const bindings=[crypto.archiveSignatureBinding({archiveDigest:intent.archive_digest,projectRef:project,
  sourceIdentity:{migration_head:intent.target_migration_head,release:intent.target_release_identity}}),
  crypto.restoreIntentBinding(intent),crypto.restoreReconciliationBinding(reconciliation)];
 const signatures=bindings.map(binding=>crypto.signBinding(binding,key));
 const envelope=signature=>({format:'memphis-zoo-production-restore-intent.v1',algorithm:'hmac-sha256',key_id:keyId,intent,signature});
 // Record both requested predecessor observations before asserting refusal;
 // normal capture already rejects final LF on the installed Node runtime.
 const suffix=crypto.verifyBinding(bindings[2],signatures[2]+'z',key);
 let finalLfAccepted=false;
 try{finalLfAccepted=crypto.captureVerifiedOriginalRestoreIntent(envelope(signatures[1]+'\n'),key,keyId).restore_id===intent.restore_id;}
 catch(error){assert.equal(error.code,'original_restore_intent_capture_invalid');}
 if(suffix||finalLfAccepted)console.log(JSON.stringify({case:'NEW shared signature wire predecessor acceptance',
  verifyBinding_nonhex_suffix_accepted:suffix,original_capture_final_LF_accepted:finalLfAccepted,
  actual_disposable_HMAC:true,SQL:false,authority:false}));
 assert.equal(suffix,false,'Shared verifier must refuse a noncanonical HMAC suffix');
 assert.equal(finalLfAccepted,false,'Normal original capture must refuse final LF after exact signature');
 for(let n=0;n<bindings.length;n++){
  const independentlyComputed=createHmac('sha256',key).update(crypto.stableJson(bindings[n])).digest('hex');
  assert.equal(signatures[n],independentlyComputed);assert.equal(signatures[n].length,64);
  assert.match(signatures[n],/^[0-9a-f]{64}$/);assert.match(signatures[n],/[a-f]/);
  assert.equal(crypto.verifyBinding(bindings[n],signatures[n],key),true);
  assert.equal(crypto.verifyBinding(bindings[(n+1)%bindings.length],signatures[n],key),false);
 }
 const captured=crypto.captureVerifiedOriginalRestoreIntent(envelope(signatures[1]),key,keyId);
 assert.deepEqual(captured,intent);assert.notEqual(captured,intent);assert.ok(Object.isFrozen(captured));
 assert.ok(Object.isFrozen(captured.target_release_identity));
 console.log('NEW canonical helper/capture: exact archive/original/reconciliation purpose signatures match independent Node HMAC bytes; normal original capture is detached/frozen (metadata ONLY)');
 let coercions=0,getters=0,traps=0,helperRefusals=0,captureRefusals=0;
 const refusedCapture=value=>assert.throws(()=>crypto.captureVerifiedOriginalRestoreIntent(value,key,keyId),error=>
  error instanceof TypeError&&error.code==='original_restore_intent_capture_invalid'
  &&error.message==='original_restore_intent_capture_invalid'&&!Object.hasOwn(error,'cause'));
 for(let n=0;n<bindings.length;n++){
  const signature=signatures[n];
  const coercible={toString(){coercions++;return signature;},[Symbol.toPrimitive](){coercions++;return signature;}};
  const accessed={};Object.defineProperty(accessed,'toString',{get(){getters++;throw Error('Signature getter must not run');}});
  Object.defineProperty(accessed,Symbol.toPrimitive,{get(){getters++;throw Error('Signature primitive getter must not run');}});
  const proxy=new Proxy(coercible,{get(){traps++;throw Error('Signature proxy must not run');},getPrototypeOf(){traps++;throw Error('Signature proxy must not run');}});
  const revoked=Proxy.revocable(coercible,{});revoked.revoke();
  const invalid=[signature+'z',signature+'\n',signature+'\r\n',signature+' ',signature+'0',signature+'00',' '+signature,
   signature.slice(0,63),signature.slice(0,62),signature.toUpperCase(),'g'.repeat(64),'a'.repeat(63)+'z','',
   null,undefined,false,0,7n,Symbol('UNIT signature'),Buffer.from(signature,'hex'),new String(signature),coercible,
   accessed,proxy,revoked.proxy,[],()=>signature];
  // Invalid wire must be rejected BEFORE HMAC/binding/key traversal too.
  const poisonBinding={};Object.defineProperty(poisonBinding,'original',{enumerable:true,get(){getters++;throw Error('No invalid-wire binding traversal');}});
  const poisonKey={ [Symbol.toPrimitive](){coercions++;throw Error('No invalid-wire key coercion');} };
  for(const value of invalid){
   assert.equal(crypto.verifyBinding(bindings[n],value,key),false);helperRefusals++;
   assert.equal(crypto.verifyBinding(poisonBinding,value,poisonKey),false);helperRefusals++;
   if(n===1){refusedCapture(envelope(value));captureRefusals++;}
  }
  const changed=(signature[0]==='a'?'b':'a')+signature.slice(1);
  assert.equal(crypto.verifyBinding(bindings[n],changed,key),false);helperRefusals++;
 }
 const getterEnvelope=envelope(signatures[1]);
 Object.defineProperty(getterEnvelope,'signature',{enumerable:true,get(){getters++;throw Error('Envelope signature accessor must not run');}});
 refusedCapture(getterEnvelope);captureRefusals++;
 assert.equal(coercions,0);assert.equal(getters,0);assert.equal(traps,0);
 console.log('NEW malformed-wire refusals: suffix/LF/CRLF/space/odd/short/nonhex/uppercase and boxed/accessor/proxy/coercible signatures reject before binding/key coercion; signature field getter remains untouched');
 const source=readFileSync(new URL('./disaster-recovery-crypto.mjs',import.meta.url),'utf8');
 const start=source.indexOf('export function verifyBinding('),end=source.indexOf('export function archiveSignatureBinding(',start);
 const verifier=source.slice(start,end);assert.ok(start>0&&end>start);
 assert.ok(verifier.indexOf('typeof signature')<verifier.indexOf('Buffer.from('));
 assert.doesNotMatch(verifier,/String\(signature|\.trim\(|\.toLowerCase\(/);
 assert.match(verifier,/provided\.length === expected\.length && timingSafeEqual\(provided, expected\)/);
 console.log(JSON.stringify({scope:'NEW shared canonical restore-signature wire',status:'PASS_ACTUAL_DISPOSABLE_HMAC_ONLY',
  canonical_purposes:bindings.length,helper_refusals:helperRefusals,capture_refusals:captureRefusals,coercions,getters,traps,
  caller_bodies_cut:0,old_groups_replayed:0,SQL:'NOT_RUN',archive_construction_or_IO:0,resources:0,
  limits:'Primitive signature-wire and metadata-capture crypto proof only; no source/target approval, expiry/currentness, DB/COMMIT/resume or physical authority.'}));
}

async function signedReconciliationOriginalJoinCases(){
 // Newly authorized disposable HMACs. Evaluate COMPLETE shipping bodies
 // after imports, including configuration, UUID/signing/verification/output.
 // Only the existing DB/provider import boundary has inert recording ports;
 // no actual pg Client prototype, clock, crypto function or signature is faked.
 const {readFileSync}=await import('node:fs'),{resolve}=await import('node:path');
 const {createHash,randomUUID}=await import('node:crypto'),{types}=await import('node:util');
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const Result=require('pg/lib/result'),pgTypes=require('pg').types;
 const storage=await import('./disaster-recovery-storage.mjs');
 const crypto=originalIntentCaptureCrypto;
 const issuer=readFileSync(new URL('./create-production-restore-reconciliation.mjs',import.meta.url),'utf8');
 const consumer=readFileSync(new URL('./apply-production-restore-reconciliation.mjs',import.meta.url),'utf8');
 const body=source=>{const i=source.indexOf('const { Client } = pg;');assert.ok(i>0);return source.slice(i);};
 assert.match(issuer,/signature: signBinding\(restoreReconciliationBinding\(intent\), key\)/);
 assert.match(consumer,/!verifyBinding\(restoreReconciliationBinding\(envelope.intent \|\| \{\}\), envelope.signature, key\)/);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const names=['pg','createHash','randomUUID','readFileSync','resolve','createClient',
  'readOriginalRestoreDatabaseStatus','readVerifiedImmutableFreshDatabaseCommitOutcome',
  'requireSigningKey','restoreReconciliationBinding','signBinding','stableJson','verifyBinding',
  'captureStorageSupportedState','isExplicitLocalRestoreFixtureTarget','validateStorageOperatorEvidence','types','process','console'];
 const programs={issuer:new AsyncFunction(...names,body(issuer)),consumer:new AsyncFunction(...names,body(consumer))};
 const key='UNIT-only-disposable-reconciliation-HMAC-20261017-task9-original-join';
 const keyId='unit-reconciliation-original-join-v1';
 assert.notEqual(key,'UNIT-only-immutable-archive-verification-key-20261016');
 const project='abcdefghijklmnopqrst',id='11111111-1111-4111-8111-111111111111',archive='a'.repeat(64);
 const actor='UNIT_SOURCE_RECORDING_OPERATOR',finalHash='b'.repeat(64);
 const parse=oid=>pgTypes.getTypeParser(oid),generation=parse(20)('7');
 assert.equal(generation,'7');assert.equal(typeof generation,'string');
 const state=()=>({singleton:parse(16)('t'),state:parse(25)('PAUSED_RECONCILIATION'),mutations_paused:parse(16)('t'),
  restore_id:parse(2950)(id),authority_generation:generation,archive_digest:parse(25)(archive),target_project_ref:parse(25)(project)});
 const manifest=()=>({restore_id:parse(2950)(id),authority_generation:generation,archive_digest:parse(25)(archive),
  database_verified:parse(16)('t'),storage_verified:parse(16)('t'),authority_invalidated:parse(16)('t'),
  post_restore_verified:parse(16)('t'),final_manifest_sha256:parse(25)(finalHash)});
 const result=(command,rows=[])=>{const r=new Result();r.addCommandComplete({text:command});r.rows=rows;return r;};
 const hash=value=>createHash('sha256').update(value).digest('hex');
 let providerCalls=0;
 const unavailable=()=>{providerCalls++;throw new Error('Unrequested status/provider port; no external IO is available');};
 async function invoke(role,envelope,options={}){
  const trace=[],stdout=[],stderr=[],queries=[];
  let caught=false,error,publicationReads=0;
  const env={SUPABASE_DB_URL:'postgresql://UNIT_ONLY:UNIT_NOT_A_CREDENTIAL@127.0.0.1/mz_schema_rebuild_signed_reconciliation_source',
   SUPABASE_PROJECT_REF:project};
  if(role==='issuer')Object.assign(env,{RESTORE_RECONCILIATION_NAMED_ACTOR:actor,RESTORE_RECONCILIATION_SIGNING_KEY:key,
   RESTORE_RECONCILIATION_SIGNING_KEY_ID:keyId,RESTORE_RECONCILIATION_TTL_MINUTES:'5',RESTORE_RECONCILIATION_RESOLUTIONS_JSON:'[]'});
  else Object.assign(env,{RESTORE_RECONCILIATION_APPLY:'true',RESTORE_RECONCILIATION_CONFIRM_PROJECT_REF:project,
   RESTORE_RECONCILIATION_VERIFY_KEY:key,RESTORE_RECONCILIATION_VERIFY_KEY_ID:keyId,RESTORE_RECONCILIATION_JSON:JSON.stringify(envelope)});
  const processPort={env,exitCode:undefined};
  const step=async name=>{trace.push(name);await Promise.resolve();if(Object.hasOwn(options,name+'Error'))throw options[name+'Error'];};
  class RecordingClient{
   constructor(config){assert.equal(config.connectionString,env.SUPABASE_DB_URL);trace.push('construct');}
   async connect(){await step('connect');}
   async end(){await step('end');}
   async query(sql,args=[]){
    const s=sql.trim();let phase;
    if(s==='begin isolation level repeatable read read only'&&role==='issuer')phase='begin';
    else if(s==='begin isolation level serializable'&&role==='consumer')phase='begin';
    else if(s.startsWith('select pg_advisory_lock(')&&role==='consumer')phase='lock';
    else if(s.startsWith('select pg_advisory_xact_lock(')&&role==='consumer')phase='fence';
    else if(s.startsWith('select pg_advisory_unlock(')&&role==='consumer')phase='unlock';
    else if(s.startsWith('select * from custodial_dr.restore_control where singleton=true'))phase='control';
    else if(s.startsWith('select * from custodial_dr.restore_manifests where restore_id=$1'))phase='manifest';
    else if(s.startsWith('select category,status,'))phase='discrepancies';
    else if(s.startsWith('select count(*)::int count from custodial_dr.restore_discrepancies')&&role==='consumer')phase='remaining';
    else if(s.startsWith('select count(*)::int count from custodial_dr.application_mutation_leases')&&role==='consumer')phase='leases';
    else if(s==='select pg_catalog.clock_timestamp() < $1::pg_catalog.timestamptz as original_intent_current'&&role==='consumer')phase='lifetime';
    else if(s.startsWith('update custodial_dr.restore_control set')&&role==='consumer')phase='complete';
    else if(s.startsWith('insert into custodial_dr.restore_events')&&role==='consumer')phase='event';
    else if(s==='commit'&&role==='consumer')phase='commit';
    else if(s==='rollback')phase='rollback';
    else throw new Error('Unexpected recording statement; no SQL executor exists');
    queries.push({phase,sql,args});await step(phase);
    if(phase==='control')return result('SELECT 1',[state()]);
    if(phase==='manifest'){assert.deepEqual(args,[id]);return result('SELECT 1',[manifest()]);}
    if(phase==='discrepancies'){assert.deepEqual(args,[id]);return result('SELECT 0');}
    if(phase==='remaining'||phase==='leases')return result('SELECT 1',[{count:parse(23)('0')}]);
    if(phase==='lifetime'){
     publicationReads++;assert.deepEqual(args,[envelope.intent.expires_at]);
     return result('SELECT 1',[{original_intent_current:parse(16)(options.refusePublication?'f':'t')}]);
    }
    if(phase==='complete'||phase==='event')return result(phase==='complete'?'UPDATE 1':'INSERT 0 1');
    return result(phase==='commit'?'COMMIT':phase==='rollback'?'ROLLBACK':'SELECT 1');
   }
  }
  const consolePort={log:s=>{trace.push('emit');stdout.push(s);},error:s=>{trace.push('diagnostic');stderr.push(s);}};
  try{await programs[role]({Client:RecordingClient},createHash,randomUUID,readFileSync,resolve,unavailable,unavailable,unavailable,
   crypto.requireSigningKey,crypto.restoreReconciliationBinding,crypto.signBinding,crypto.stableJson,crypto.verifyBinding,
   storage.captureStorageSupportedState,storage.isExplicitLocalRestoreFixtureTarget,storage.validateStorageOperatorEvidence,
   types,processPort,consolePort);}
  catch(observed){caught=true;error=observed;}
  return {trace,stdout,stderr,queries,caught,error,processPort,publicationReads};
 }
 const issue=await invoke('issuer');assert.equal(issue.caught,false);
 assert.deepEqual(issue.trace,['construct','connect','begin','control','manifest','discrepancies','rollback','end','emit']);
 assert.equal(issue.stdout.length,1);assert.equal(issue.stderr.length,0);
 const originalWire=issue.stdout[0],issued=JSON.parse(originalWire);
 assert.equal(issued.intent.restore_id,id);assert.equal(issued.intent.authority_generation,7);
 assert.equal(typeof issued.intent.authority_generation,'number');assert.equal(issued.intent.archive_digest,archive);
 assert.equal(issued.intent.target_project_ref,project);assert.equal(issued.intent.actor,actor);
 assert.equal(issued.intent.final_manifest_sha256,finalHash);assert.equal(issued.intent.discrepancy_snapshot_sha256,hash(crypto.stableJson([])));
 assert.deepEqual(issued.intent.resolutions,[]);assert.equal(issued.intent.storage_supported_state_resample,null);
 assert.match(issued.intent.reconciliation_id,/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
 assert.match(issued.signature,/^[0-9a-f]{64}$/);assert.equal(issued.key_id,keyId);
 assert.equal(crypto.verifyBinding(crypto.restoreReconciliationBinding(issued.intent),issued.signature,key),true);
 assert.ok(Date.parse(issued.intent.expires_at)>Date.now());
 const count=(r,name)=>r.trace.filter(x=>x===name).length;
 const noEffects=r=>{assert.equal(r.caught,true);assert.equal(r.stdout.length,0);assert.equal(r.stderr.length,0);
  assert.equal(count(r,'complete'),0);assert.equal(count(r,'event'),0);assert.equal(count(r,'commit'),0);};
 const copy=()=>JSON.parse(originalWire);
 // First newly affected vector: noncanonical signature suffix must not be
 // silently decoded as the original HMAC by the actual consumer verifier.
 const suffix=copy();suffix.signature+='z';const suffixResult=await invoke('consumer',suffix);
 if(!suffixResult.caught)console.log(JSON.stringify({case:'NEW actual signed reconciliation noncanonical signature acceptance',
  signature_suffix_accepted:true,actual_HMAC_issuer:true,resumed:JSON.parse(suffixResult.stdout[0]||'null')?.resumed,
  trace:suffixResult.trace,limit:'Disposable HMAC + exact Source recording, NOT native pg/SQL/auth/resume proof'}));
 noEffects(suffixResult);assert.equal(count(suffixResult,'construct'),0);
 const accepted=await invoke('consumer',issued);assert.equal(accepted.caught,false);
 assert.deepEqual(accepted.trace,['construct','connect','lock','begin','fence','control','manifest','discrepancies','remaining','leases',
  'lifetime','complete','event','lifetime','commit','unlock','end','emit']);
 assert.equal(accepted.publicationReads,2);assert.equal(accepted.stderr.length,0);assert.equal(accepted.stdout.length,1);
 assert.deepEqual(JSON.parse(accepted.stdout[0]),{ok:true,idempotent_replay:false,restore_id:id,reconciliation_id:issued.intent.reconciliation_id,resumed:true});
 const event=accepted.queries.find(x=>x.phase==='event');assert.deepEqual(event.args.slice(0,3),[id,7,actor]);
 const evidence=JSON.parse(event.args[3]);assert.equal(evidence.reconciliation_id,issued.intent.reconciliation_id);
 assert.equal(evidence.archive_digest,archive);assert.equal(evidence.intent_sha256,hash(crypto.stableJson(crypto.restoreReconciliationBinding(issued.intent))));
 console.log('NEW disposable signed reconciliation join: full actual issuer configuration/UUID/HMAC/output -> real binding verification -> full consumer original tuple/int8/manifest/clock/one-COMMIT cleanup Source path (NOT SQL)');
 const tamper=[['archive_digest','c'.repeat(64)],['target_project_ref','zyxwvutsrqponmlkjihg'],
  ['restore_id','33333333-3333-4333-8333-333333333333'],['authority_generation',8],
  ['reconciliation_id','44444444-4444-4444-8444-444444444444'],['expires_at',new Date(Date.now()-60000).toISOString()]];
 for(const [field,value]of tamper){const changed=copy();changed.intent[field]=value;
  const r=await invoke('consumer',changed);noEffects(r);assert.equal(count(r,'construct'),0);assert.match(r.error.message,/signature verification failed/);}
 for(const signature of [issued.signature.slice(0,63),issued.signature+'\n',issued.signature.toUpperCase(),
  (issued.signature[0]==='a'?'b':'a')+issued.signature.slice(1)]){
  const changed=copy();changed.signature=signature;const r=await invoke('consumer',changed);noEffects(r);assert.equal(count(r,'construct'),0);
 }
 console.log('NEW actual HMAC mutation refusals: changed digest/project/original IDs/generation/expiry/signature fail before recording Client construction/effects; no verification stub');
 const resigned=[['archive_digest','d'.repeat(64),'control'],['restore_id','55555555-5555-4555-8555-555555555555','control'],
  ['authority_generation',8,'control'],['target_project_ref','zyxwvutsrqponmlkjihg','preconnect'],
  ['expires_at',new Date(Date.now()-60000).toISOString(),'preconnect'],
  ['final_manifest_sha256','e'.repeat(64),'manifest'],['discrepancy_snapshot_sha256','f'.repeat(64),'discrepancies']];
 for(const [field,value,last]of resigned){
  const changed=copy();changed.intent[field]=value;changed.signature=crypto.signBinding(crypto.restoreReconciliationBinding(changed.intent),key);
  assert.equal(crypto.verifyBinding(crypto.restoreReconciliationBinding(changed.intent),changed.signature,key),true);
  const r=await invoke('consumer',changed);noEffects(r);
  if(last==='preconnect')assert.deepEqual(r.trace,[]);
  else{assert.equal(r.trace.at(-4),last);assert.deepEqual(r.trace.slice(-3),['rollback','unlock','end']);}
 }
 console.log('NEW correctly HMAC-signed negative originals: foreign tuple, expired/project intent, final manifest and discrepancy mismatch still refuse before writes; signing alone is not authority');
 const issuerEnd=new Error('UNIT signed issuer end failure'),unpublished=await invoke('issuer',undefined,{endError:issuerEnd});
 assert.equal(unpublished.caught,true);assert.equal(unpublished.error,issuerEnd);assert.equal(unpublished.stdout.length,0);
 assert.deepEqual(unpublished.trace,['construct','connect','begin','control','manifest','discrepancies','rollback','end']);
 const endFailure=new Error('UNIT signed consumer end failure'),closed=await invoke('consumer',issued,{endError:endFailure});
 assert.equal(closed.caught,false);assert.equal(closed.stdout.length,0);assert.equal(closed.stderr.length,1);assert.equal(closed.processPort.exitCode,1);
 assert.equal(count(closed,'commit'),1);assert.equal(count(closed,'rollback'),0);
 assert.deepEqual(closed.trace.slice(-4),['commit','unlock','end','diagnostic']);
 const unknown=JSON.parse(closed.stderr[0]);assert.equal(unknown.outcome,'UNKNOWN');assert.equal(unknown.retry_safe,false);
 assert.deepEqual(unknown.read_request,{restore_id:id,authority_generation:7,reconciliation_id:issued.intent.reconciliation_id,archive_digest:archive});
 const notCurrent=await invoke('consumer',issued,{refusePublication:true});noEffects(notCurrent);
 assert.equal(notCurrent.publicationReads,1);assert.deepEqual(notCurrent.trace.slice(-4),['lifetime','rollback','unlock','end']);
 assert.equal(JSON.stringify(issued),originalWire);assert.equal(providerCalls,0);
 console.log(JSON.stringify({scope:'NEW actual disposable-HMAC reconciliation original join',status:'PASS_CRYPTO_SOURCE_RECORDING_ONLY',
  issuer_signing_body_cut:false,signature_verification_stub:false,actual_node_clock:true,real_pg_clients:0,SQL:'NOT_RUN',
  genuine_current_control_or_resume_authority:false,old_groups_replayed:0,archive_reads_or_writes_in_cases:0,provider_calls:providerCalls,resources:0,
  limits:'Actual local UNIT HMAC/UUIDs and uncut CLI bodies with explicit inert DB import ports; no signed production/real PG/server clock/manager/physical/whole-G31 proof.'}));
}

async function reconciliationIntentCleanupCases(){
 const {readFileSync}=await import("node:fs");
 const source=readFileSync(new URL("./create-production-restore-reconciliation.mjs",import.meta.url),"utf8");
 const native="const endReconciliationIntentClient = Client.prototype.end;";
 const start=source.indexOf("let pendingEnvelope, firstFailure;\n");
 const begin=source.indexOf('  await db.query("begin isolation level repeatable read read only");\n',start);
 const opened=begin+'  await db.query("begin isolation level repeatable read read only");\n'.length;
 const cleanup=source.indexOf("} catch (error) {\n  firstFailure = error;\n  failed = true;\n} finally {",opened);
 assert.equal(source.split(native).length,2);
 assert.ok(start>=0&&begin>start&&cleanup>opened);
 const tail=source.slice(cleanup).trimEnd();assert.ok(tail.endsWith("\n}"));
 // Exact changed lifecycle, with ONLY its validation/SQL/UUID/signature/body
 // replaced by recording DATA. No key, genuine intent, pg or SQL executes.
 const actual=native+"\n"+source.slice(start,opened)+"  pendingEnvelope = await recordingBody();\n"+tail.slice(0,-2);
 for(const forbidden of ["signBinding","randomUUID","requireSigningKey","db.end("])assert.equal(actual.includes(forbidden),false);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction("Client","db","recordingBody","console",actual);
 const cases=[];let getters=0,serializations=0;
 const failure=()=>new Error("Synthetic reconciliation lifecycle failure");
 async function invoke(failures={},options={}){
  const order=[],logs=[],counts={rollback:0,end:0,emit:0};
  let caught=false,error;
  const envelope=options.envelope||Object.freeze({fixture:"UNSIGNED_RECONCILIATION_RECORDING_DATA",unchanged:"bytes"});
  const step=async name=>{order.push(name);await Promise.resolve();if(Object.hasOwn(failures,name))throw failures[name];};
  function Client(){}
  const db={
   async connect(){
    if(options.withdrawAfterCapture)Client.prototype.end=()=>{getters++;throw failure();};
    await step("connect");
   },
   async query(sql){
    assert.ok(sql==="begin isolation level repeatable read read only"||sql==="rollback");
    if(sql==="rollback")counts.rollback++;
    await step(sql==="rollback"?"rollback":"begin");
   },
  };
  Object.defineProperty(db,"end",{get(){getters++;throw failure();}});
  Client.prototype.end=async function(){assert.equal(this,db);counts.end++;await step("end");};
  try{
   await run(Client,db,async()=>{await step("body");return envelope;},
    {log(value){counts.emit++;order.push("emit");logs.push(value);}});
  }catch(observed){caught=true;error=observed;}
  return {order,counts,logs,caught,error,envelope};
 }
 const noOutput=result=>{assert.equal(result.caught,true);assert.equal(result.counts.emit,0);assert.deepEqual(result.logs,[]);};
 const exactErrors=(result,expected,primary)=>{
  assert.ok(result.error instanceof AggregateError);assert.equal(result.error.errors.length,expected.length);
  expected.forEach((value,index)=>assert.equal(result.error.errors[index],value));
  assert.equal(result.error.cause,primary);
 };
 {
  const result=await invoke({}, {withdrawAfterCapture:true});
  assert.equal(result.caught,false);
  assert.deepEqual(result.order,["connect","begin","body","rollback","end","emit"]);
  assert.deepEqual(result.counts,{rollback:1,end:1,emit:1});
  assert.deepEqual(result.logs,[JSON.stringify(result.envelope)]);
  cases.push("success emits once after awaited rollback and captured original end");
 }
 for(const stage of ["rollback","end"]){
  const primary=failure(),result=await invoke({[stage]:primary});
  noOutput(result);assert.equal(result.error,primary);
  assert.deepEqual(result.order,["connect","begin","body","rollback","end"]);
  assert.deepEqual(result.counts,{rollback:1,end:1,emit:0});
  cases.push(stage+" failure refuses output and drains cleanup");
 }
 for(const stage of ["connect","begin","body"]){
  const primary=failure(),result=await invoke({[stage]:primary});
  noOutput(result);assert.equal(result.error,primary);
  assert.equal(result.counts.end,1);assert.equal(result.counts.rollback,stage==="connect"?0:1);
  cases.push(stage+" failure retains primary and drains owned native end");
 }
 {
  const primary=failure(),end=failure(),result=await invoke({connect:primary,end});
  noOutput(result);exactErrors(result,[primary,end],primary);
  assert.deepEqual(result.counts,{rollback:0,end:1,emit:0});
  cases.push("failed connect plus failed end retain both failures");
 }
 {
  const primary=Object.create(null),rollback=Object.create(null),end=Object.create(null);
  for(const error of [primary,rollback,end]){
   Object.defineProperty(error,"message",{get(){getters++;throw failure();}});
   Object.defineProperty(error,"toJSON",{get(){getters++;throw failure();}});
  }
  const result=await invoke({body:primary,rollback,end});
  noOutput(result);exactErrors(result,[primary,rollback,end],primary);
  assert.equal(result.error.message,"Reconciliation intent failed and cleanup did not complete.");
  assert.deepEqual(result.counts,{rollback:1,end:1,emit:0});
  cases.push("body plus rollback/end failures retained without reading error getters");
 }
 {
  const primary=failure(),rollback=failure(),end=failure(),result=await invoke({begin:primary,rollback,end});
  noOutput(result);exactErrors(result,[primary,rollback,end],primary);
  assert.deepEqual(result.order,["connect","begin","rollback","end"]);
  cases.push("failed BEGIN still drains rollback and end, preserving every failure");
 }
 {
  const result=await invoke({body:undefined});noOutput(result);assert.equal(result.error,undefined);
  assert.deepEqual(result.counts,{rollback:1,end:1,emit:0});
  cases.push("falsy thrown primary cannot become success");
 }
 {
  const envelope=Object.create(null),end=failure();
  Object.defineProperty(envelope,"toJSON",{get(){serializations++;throw failure();}});
  const result=await invoke({end},{envelope});noOutput(result);assert.equal(result.error,end);
  assert.equal(serializations,0);
  cases.push("failed cleanup never serializes the pending envelope");
 }
 assert.equal(getters,0);
 console.log(JSON.stringify({scope:"NEW signed reconciliation intent cleanup",status:"PASS_RECORDING_SOURCE_ONLY",
  cases,count:cases.length,caller_getters:getters,failed_cleanup_serializations:serializations,
  SQL:"NOT_RUN",signed_intent:"NOT_RUN",keys_retrieved:0,signatures:0,connections:0,resources:0,
  limits:"Exact signed-branch lifecycle with recording body/ports; no actual signing, validation, SQL, status-mode or recovery authority proof."}));
}

async function restoreIntentCleanupCases(){
 const {readFileSync}=await import("node:fs");
 const source=readFileSync(new URL("./create-production-restore-intent.mjs",import.meta.url),"utf8");
 const native="const endRestoreIntentClient = Client.prototype.end;";
 const lifetime=source.indexOf("const cleanupOriginalArchive = verifiedArchive.cleanup;");
 const body=source.indexOf("  const sourceDir = verifiedArchive.directory;",lifetime);
 const client=source.indexOf('  db = new Client({ connectionString: databaseUrl, application_name: "memphis-zoo-restore-intent" });',body);
 const opened=source.indexOf('  await db.query("begin read only");\n',client)+'  await db.query("begin read only");\n'.length;
 const pending="  pendingEnvelope = envelope;\n",pendingEnd=source.indexOf(pending,opened)+pending.length;
 assert.equal(source.split(native).length,2,"Fixed native prototype capture required");
 assert.ok(lifetime>=0&&body>lifetime&&client>body&&opened>client&&pendingEnd>opened);
 // Extract only the actual lifecycle and DB opening/cleanup Source. Replace
 // archive validation and the entire query/UUID/signing body with RECORDING
 // callbacks, never run original keys, signing, pg.Client or SQL.
 const actual=native+"\n"+source.slice(lifetime,body)+"  await validateOriginal();\n"
  +source.slice(client,opened)+"  pendingEnvelope = await recordingBody(db);\n"+source.slice(pendingEnd);
 assert.equal(actual.includes("signBinding"),false);assert.equal(actual.includes("randomUUID"),false);
 assert.equal(actual.includes("requireSigningKey"),false);
 assert.equal(actual.includes("await db.end"),false);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction("Client","verifiedArchive","databaseUrl","requireOriginalArchiveSource",
  "validateOriginal","recordingBody","console",actual);
 let getterCalls=0,serializations=0;
 const marker=()=>new Error("Synthetic lifecycle failure");
 const cases=[];
 async function invoke(failures={},options={}){
  const order=[],logs=[],counts={rollback:0,end:0,archive:0,construct:0,emit:0};
  let actualClient,caught=false,error;
  const envelope=options.envelope||Object.freeze({fixture:"UNSIGNED_LIFECYCLE_RECORDING_DATA",value:"same bytes"});
  const step=async name=>{order.push(name);await Promise.resolve();
   if(Object.hasOwn(failures,name))throw failures[name];};
  function Client(config){
   counts.construct++;order.push("construct");assert.equal(config.application_name,"memphis-zoo-restore-intent");
   if(Object.hasOwn(failures,"construct"))throw failures.construct;
   actualClient=this;
   this.connect=()=>step("connect");
   this.query=async sql=>{
    assert.ok(sql==="begin read only"||sql==="rollback","Only extracted lifecycle query commands permitted");
    if(sql==="rollback")counts.rollback++;
    await step(sql==="rollback"?"rollback":"begin");
   };
   Object.defineProperty(this,"end",{get(){getterCalls++;throw marker();}});
  }
  Client.prototype.end=async function(){
   assert.equal(this,actualClient);counts.end++;await step("end");
  };
  const archive={cleanup:async function(){
   assert.equal(this,archive);counts.archive++;await step("archive");
  }};
  try{
   await run(Client,archive,"RECORDING_ONLY_NO_CONNECTION",()=>{
    order.push("source");if(Object.hasOwn(failures,"source"))throw failures.source;
   },async()=>{
    await step("validate");
    if(options.withdrawMethods){
     Client.prototype.end=()=>{getterCalls++;throw marker();};
     Object.defineProperty(archive,"cleanup",{get(){getterCalls++;throw marker();}});
    }
   },async db=>{assert.equal(db,actualClient);await step("body");return envelope;},
   {log(value){order.push("emit");counts.emit++;logs.push(value);}});
  }catch(observed){caught=true;error=observed;}
  return {order,logs,counts,caught,error,envelope};
 }
 function noOutput(result){
  assert.equal(result.caught,true);assert.equal(result.counts.emit,0);assert.deepEqual(result.logs,[]);
 }
 function errorsExactly(result,expected,primary){
  assert.ok(result.error instanceof AggregateError);assert.equal(result.error.errors.length,expected.length);
  expected.forEach((error,index)=>assert.equal(result.error.errors[index],error));
  if(primary!==undefined)assert.equal(result.error.cause,primary);
 }
 {
  const result=await invoke({}, {withdrawMethods:true});
  assert.equal(result.caught,false);
  assert.deepEqual(result.order,["validate","construct","source","connect","begin","body","rollback","end","archive","emit"]);
  assert.deepEqual(result.logs,[JSON.stringify(result.envelope)]);
  assert.deepEqual(result.counts,{rollback:1,end:1,archive:1,construct:1,emit:1});
  cases.push("success emits once after all awaited original cleanup; captured methods cannot be replaced");
 }
 for(const stage of ["rollback","end","archive"]){
  const original=marker(),result=await invoke({[stage]:original});
  noOutput(result);assert.equal(result.error,original);
  assert.deepEqual(result.order,["validate","construct","source","connect","begin","body","rollback","end","archive"]);
  assert.deepEqual(result.counts,{rollback:1,end:1,archive:1,construct:1,emit:0});
  cases.push(stage+" failure prevents output and drains remaining cleanup exactly once");
 }
 {
  const primary=marker(),end=marker(),archive=marker();
  const result=await invoke({body:primary,end,archive});
  noOutput(result);errorsExactly(result,[primary,end,archive],primary);
  assert.deepEqual(result.counts,{rollback:1,end:1,archive:1,construct:1,emit:0});
  cases.push("original body failure survives end and archive failures");
 }
 {
  const primary=Object.create(null),rollback=Object.create(null),end=Object.create(null),archive=Object.create(null);
  for(const value of [primary,rollback,end,archive]){
   Object.defineProperty(value,"message",{get(){getterCalls++;throw marker();}});
   Object.defineProperty(value,"toJSON",{get(){getterCalls++;throw marker();}});
  }
  const result=await invoke({body:primary,rollback,end,archive});
  noOutput(result);errorsExactly(result,[primary,rollback,end,archive],primary);
  assert.equal(result.error.message,"Restore intent failed and cleanup did not complete.");
  cases.push("primary plus every cleanup error retained without reading caller error getters");
 }
 for(const stage of ["validate","construct","source","connect","begin"]){
  const primary=marker(),archive=marker(),result=await invoke({[stage]:primary,archive});
  noOutput(result);errorsExactly(result,[primary,archive],primary);
  assert.equal(result.counts.archive,1);
  assert.equal(result.counts.end,["source","connect","begin"].includes(stage)?1:0);
  assert.equal(result.counts.rollback,stage==="begin"?1:0);
  assert.equal(result.counts.construct,stage==="validate"?0:1);
  cases.push(stage+" failure drains only its owned resources and retains archive error");
 }
 {
  const result=await invoke({body:undefined});
  noOutput(result);assert.equal(result.error,undefined);
  assert.deepEqual(result.counts,{rollback:1,end:1,archive:1,construct:1,emit:0});
  cases.push("falsy original thrown value is not mistaken for success");
 }
 {
  const rollback=marker(),envelope=Object.create(null);
  Object.defineProperty(envelope,"toJSON",{get(){serializations++;throw marker();}});
  const result=await invoke({rollback},{envelope});
  noOutput(result);assert.equal(result.error,rollback);assert.equal(serializations,0);
  cases.push("cleanup refusal never serializes or emits the retained envelope");
 }
 assert.equal(getterCalls,0);
 console.log(JSON.stringify({scope:"NEW restore intent cleanup lifecycle",status:"PASS_RECORDING_SOURCE_ONLY",
  cases,count:cases.length,caller_getters:0,failed_cleanup_serializations:serializations,
  SQL:"NOT_RUN",signed_intent:"NOT_RUN",keys_retrieved:0,signatures:0,connections:0,resources:0,
  limits:"Actual extracted lifecycle with recording body/ports only. Original UUID/key/signature/intent construction did not execute; no genuine SQL/archive/signing authority proof."}));
}

async function restoreLocalTargetUriCases(){
 const {readFile}=await import("node:fs/promises");
 const {default:pg}=await import("pg");
 const source=await readFile(new URL("./production-restore.mjs",import.meta.url),"utf8");
 const opening='if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required for restore apply.");\nif (databaseOnly) {\n';
 const closing="} else if (!/^[a-z0-9]{20}$/.test(projectRef)";
 const start=source.indexOf(opening),end=source.indexOf(closing,start);
 assert.ok(start>=0&&end>start,"Actual database-only guard region is required");
 assert.equal(source.indexOf(opening,start+opening.length),-1,"Guard must be unique");
 // Execute the exact shipping guard, not a duplicate policy or the effects-owning CLI.
 const requireLocalTarget=new Function("databaseUrl",source.slice(start+opening.length,end));
 const refusal="Database-only restore is restricted to a loopback mz_schema_rebuild_* database.";
 const user="UNIT_ONLY",password="UNIT_ONLY_NOT_A_SECRET";
 const target=(host="localhost",scheme="postgresql:",port="")=>
  scheme+"//"+user+":"+password+"@"+host+port+"/mz_schema_rebuild_UNIT";
 const accepted=[
  {uri:target(),host:"localhost",database:"mz_schema_rebuild_UNIT",user,password},
  {uri:target("127.0.0.1","postgres:",":5433"),host:"127.0.0.1",port:5433,database:"mz_schema_rebuild_UNIT",user,password},
  {uri:target("localhost","postgresql:",":6543"),host:"localhost",port:6543,database:"mz_schema_rebuild_UNIT",user,password},
  {uri:"postgresql://UNIT%40user:UNIT%3A%2F%3F%23pass@localhost:5432/mz_schema_rebuild_01_a",
   host:"localhost",port:5432,database:"mz_schema_rebuild_01_a",user:"UNIT@user",password:"UNIT:/?#pass"},
 ];
 let constructed=0,ended=0,refused=0;
 for(const expected of accepted){
  requireLocalTarget(expected.uri);
  const client=new pg.Client({connectionString:expected.uri});constructed++;
  try{
   const actual=client.connectionParameters;
   assert.equal(actual.host,expected.host);
   assert.equal(actual.database,expected.database);
   if(expected.port!==undefined)assert.equal(actual.port,expected.port);
   // Boolean checks prevent even failure diagnostics from printing credentials.
   assert.ok(actual.user===expected.user,"Native credential identity differs");
   assert.ok(actual.password===expected.password,"Native credential value differs");
   assert.equal(client._connected,false);
   assert.equal(client.queryQueue.length,0);
  }finally{
   await pg.Client.prototype.end.call(client);ended++;
  }
 }
 const denied=[
  ...[
   "?host=not-a-local-target.invalid","?hostaddr=192.0.2.1","?dbname=other","?database=other",
   "?options=-csearch_path%3Dpublic","?%68ost=not-a-local-target.invalid",
   "?host=localhost&host=not-a-local-target.invalid","?port=6543","?user=other",
   "?password=UNIT_ONLY_OTHER","?sslmode=require","?sslcert=UNIT_ONLY_NOT_READ","?","?&",
   "#fragment","#","?host=localhost#fragment",
  ].map(suffix=>target()+suffix),
  target("localhost","https:"),target("localhost","http:"),target("localhost","file:"),
  target("not-a-local-target.invalid"),target("127.0.0.2"),target("[::1]"),
  target().replace("/mz_schema_rebuild_UNIT","/postgres"),
  target().replace("/mz_schema_rebuild_UNIT","/mz_schema_rebuild_"),
  target().replace("/mz_schema_rebuild_UNIT","/mz_schema_rebuild_UNIT/extra"),
  target().replace("/mz_schema_rebuild_UNIT","/mz_schema_rebuild_UNIT%3Fhost%3Dother"),
  target().replace("/mz_schema_rebuild_UNIT","/mz_schema_rebuild_UNIT%23fragment"),
  "postgresql:///mz_schema_rebuild_UNIT?host=%2Ftmp",
  "postgresql://UNIT_ONLY:UNIT_ONLY_NOT_A_SECRET@localhost:bad/mz_schema_rebuild_UNIT",
  "not a valid URI",
 ];
 for(const uri of denied){
  // Refused inputs never reach pg's parser, including SSL file query options.
  let error;
  try{requireLocalTarget(uri);}catch(observed){error=observed;}
  assert.ok(error instanceof Error,"Unsafe target was admitted");
  assert.equal(error.message,refusal);
  assert.equal(Object.hasOwn(error,"input"),false);
  refused++;
 }
 assert.equal(constructed,ended);
 console.log(JSON.stringify({scope:"NEW database-only restore local target URI",
  accepted:accepted.length,refused,native_clients_constructed:constructed,native_clients_ended:ended,
  connects:0,queries:0,signatures:0,status:"PASS",
  limits:"Actual shipping guard and pg constructor only; synthetic UNIT credentials, no DB/SQL/network or restore authority."}));
}

if(process.argv.includes("--canonical-restore-signature-wire-only")){
 await canonicalRestoreSignatureWireCases();
}else if(process.argv.includes("--signed-reconciliation-original-join-only")){
 await signedReconciliationOriginalJoinCases();
}else if(process.argv.includes("--reconciliation-intent-cleanup-only")){
 await reconciliationIntentCleanupCases();
}else if(process.argv.includes("--restore-intent-cleanup-only")){
 await restoreIntentCleanupCases();
}else if(process.argv.includes("--restore-local-target-uri-only")){
 await restoreLocalTargetUriCases();
}else if(process.argv.includes("--restore-intent-capture-before-only")){
 originalIntentCaptureBeforeCase();
}else if(process.argv.includes("--verified-original-restore-intent-only")){
 verifiedOriginalIntentCaptureCases();
}else{
const archiveKey = "archive-key-fixture-0000000000000000000000001";
const intentKey = "intent-key-fixture-00000000000000000000000002";
const archive = archiveSignatureBinding({
  archiveDigest: "a".repeat(64),
  projectRef: "abcdefghijklmnopqrst",
  sourceIdentity: { migration_head: "20260820125325", release: { release_id: "fixture" } },
});
const signature = signBinding(archive, archiveKey);
assert.equal(verifyBinding(archive, signature, archiveKey), true);
assert.equal(verifyBinding({ ...archive, archive_digest: "b".repeat(64) }, signature, archiveKey), false);
assert.equal(verifyBinding(archive, signature, intentKey), false);

const intent = restoreIntentBinding({ restore_id: "fixture", authority_generation: 7, archive_digest: "a".repeat(64) });
const intentSignature = signBinding(intent, intentKey);
assert.equal(verifyBinding(intent, intentSignature, intentKey), true);
assert.equal(verifyBinding({ ...intent, authority_generation: 8 }, intentSignature, intentKey), false);

const rehearsal = releaseMigrationRehearsalAttestationBinding({
  receipt_sha256: "c".repeat(64),
  repository: "lasrevinu333-design/memphis-zoo-mcp",
  run_id: "100",
});
const rehearsalSignature = signBinding(rehearsal, intentKey);
assert.equal(verifyBinding(rehearsal, rehearsalSignature, intentKey), true);
assert.equal(verifyBinding({ ...rehearsal, run_id: "101" }, rehearsalSignature, intentKey), false);

console.log("DISASTER_RECOVERY_CRYPTO_TESTS_PASS");
}

// NEW original-intent capture vectors; all keys/data are SYNTHETIC unit input.
function originalIntentCaptureFixture(){
 const key='SYNTHETIC_ONLY_RESTORE_INTENT_CAPTURE_KEY_00000000000000000000',keyId='SYNTHETIC.restore-intent.v1';
 const intent={restore_id:'f1000000-0000-4000-8000-000000000001',authority_generation:7,retry_of_restore_id:null,
  archive_digest:'a'.repeat(64),source_project_ref:'abcdefghijklmnopqrst',target_project_ref:'abcdefghijklmnopqrst',
  source_identity_sha256:'b'.repeat(64),target_migration_head:'20261014143050',
  target_release_identity:{release_id:'SYNTHETIC_original_release',backend_commit:'c'.repeat(40),frontend_commit:'d'.repeat(40),
   migration_head:'20261014143050',migration_manifest_sha256:'e'.repeat(64)},
  actor:'SYNTHETIC_Source_Actor',approved_at:'2026-10-14T19:00:00.000Z',expires_at:'2026-10-14T20:00:00.000Z',resume_after_verification:false};
 const envelope={format:'memphis-zoo-production-restore-intent.v1',algorithm:'hmac-sha256',key_id:keyId,intent,
  signature:signBinding(restoreIntentBinding(intent),key)};
 return {key,keyId,intent,envelope};
}
function originalIntentCaptureBeforeCase(){
 const {key,intent,envelope}=originalIntentCaptureFixture(),originalExpiry=intent.expires_at;
 let reads=0;
 Object.defineProperty(envelope.intent,'expires_at',{enumerable:true,configurable:true,
  get(){reads++;return reads===1?originalExpiry:'2026-10-14T23:00:00.000Z';}});
 const verified=verifyBinding(restoreIntentBinding(envelope.intent),envelope.signature,key);
 const captured=JSON.parse(originalIntentCaptureCrypto.stableJson(envelope.intent));
 console.log(JSON.stringify({scope:'SYNTHETIC old verify-then-capture expression',verified,reads,originalExpiry,capturedExpiry:captured.expires_at}));
 assert.equal(verified,true);assert.equal(reads,2);
 assert.equal(captured.expires_at,originalExpiry,'Verified original expiry must not change during capture');
}
function verifiedOriginalIntentCaptureCases(){
 const capture=originalIntentCaptureCrypto.captureVerifiedOriginalRestoreIntent;
 assert.equal(typeof capture,'function');
 let checks=0;
 const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
 const reject=(envelope,key,keyId)=>{
  assert.throws(()=>capture(envelope,key,keyId),error=>error instanceof TypeError
   && error.code==='original_restore_intent_capture_invalid'
   && error.message==='original_restore_intent_capture_invalid'
   && !Object.hasOwn(error,'cause'));
  checks++;
 };
 const mutate=change=>{const f=originalIntentCaptureFixture();change(f);reject(f.envelope,f.key,f.keyId);};
 const f=originalIntentCaptureFixture(),frozen=capture(f.envelope,f.key,f.keyId);
 equal(frozen,f.intent);equal(Object.isFrozen(frozen),true);equal(Object.isFrozen(frozen.target_release_identity),true);
 equal(originalIntentCaptureCrypto.stableJson(restoreIntentBinding(frozen)),originalIntentCaptureCrypto.stableJson(restoreIntentBinding(f.intent)));
 equal(signBinding(restoreIntentBinding(frozen),f.key),f.envelope.signature);
 assert.throws(()=>{frozen.expires_at='changed';},TypeError);checks++;
 assert.throws(()=>{frozen.target_release_identity.release_id='changed';},TypeError);checks++;
 f.intent.expires_at='CALLER_CHANGED_AFTER_CAPTURE';f.intent.target_release_identity.release_id='CALLER_CHANGED';
 equal(frozen.expires_at,'2026-10-14T20:00:00.000Z');equal(frozen.target_release_identity.release_id,'SYNTHETIC_original_release');
 mutate(x=>{x.intent.expires_at='2026-10-14T23:00:00.000Z';});
 mutate(x=>{x.intent.target_release_identity.backend_commit='f'.repeat(40);});
 mutate(x=>{x.envelope.signature='0'.repeat(64);});
 mutate(x=>{x.key='SYNTHETIC_WRONG_RESTORE_KEY_0000000000000000000000000';});
 mutate(x=>{x.keyId='wrong.key.id';});
 mutate(x=>{x.envelope.format='foreign';});
 mutate(x=>{x.envelope.algorithm='foreign';});
 mutate(x=>{delete x.envelope.algorithm;});
 mutate(x=>{x.envelope.extra=true;});
 mutate(x=>{x.envelope.intent=[];});
 mutate(x=>{x.envelope.intent.purpose='foreign';});
 mutate(x=>{x.envelope.intent.format='foreign';});
 for(const bad of [null,undefined,[],new String('primitive-key-required'),12,true]){
  reject(f.envelope,bad,f.keyId);
 }
 for(const bad of ['', 'short', 'x'.repeat(65537)])reject(f.envelope,bad,f.keyId);
 for(const bad of ['', 'x'.repeat(121),new String(f.keyId),{},Symbol('key-id')])reject(f.envelope,f.key,bad);
 for(const value of [undefined,()=>{},Symbol('value'),1n,NaN,Infinity,-Infinity,new Date(),new Map(),new Set(),Buffer.from('not-JSON')]){
  mutate(x=>{x.intent.extra=value;});
 }
 mutate(x=>{Object.setPrototypeOf(x.intent,{custom:true});});
 mutate(x=>{x.intent.extra=Object.create(null);});
 mutate(x=>{x.intent.extra=Object.assign(Object.create({custom:true}),{data:1});});
 mutate(x=>{x.intent.extra=x.intent;});
 mutate(x=>{x.intent.extra=[x.envelope];});
 mutate(x=>{x.intent.extra=Array(2);});
 mutate(x=>{x.intent.extra=[1];x.intent.extra.custom=true;});
 mutate(x=>{x.intent.extra=[1];Object.setPrototypeOf(x.intent.extra,{});});
 mutate(x=>{x.intent[Symbol('own')]='symbol-key';});
 mutate(x=>{Object.defineProperty(x.intent,'hidden',{value:'not-normal-JSON',enumerable:false});});
 mutate(x=>{x.intent.extra='x'.repeat(1048577);});
 mutate(x=>{x.intent.extra=Array.from({length:16385},()=>null);});
 mutate(x=>{let value={};x.intent.extra=value;for(let n=0;n<34;n++)value=value.next={};});
 for(const location of ['envelope','intent','nested','array']){
  let calls=0;const x=originalIntentCaptureFixture();
  const getter=()=>{calls++;throw Error('ATTACKER_GETTER_PRIVATE_MESSAGE');};
  if(location==='envelope')Object.defineProperty(x.envelope,'intent',{get:getter,enumerable:true});
  if(location==='intent')Object.defineProperty(x.intent,'expires_at',{get:getter,enumerable:true});
  if(location==='nested')Object.defineProperty(x.intent.target_release_identity,'backend_commit',{get:getter,enumerable:true});
  if(location==='array'){x.intent.extra=[1];Object.defineProperty(x.intent.extra,'0',{get:getter,enumerable:true});}
  reject(x.envelope,x.key,x.keyId);equal(calls,0);
 }
 for(const location of ['envelope','intent','nested','array']){
  let calls=0;const x=originalIntentCaptureFixture();
  const handler={get(){calls++;throw Error('PRIVATE_PROXY');},ownKeys(){calls++;throw Error('PRIVATE_PROXY');},
   getOwnPropertyDescriptor(){calls++;throw Error('PRIVATE_PROXY');},getPrototypeOf(){calls++;throw Error('PRIVATE_PROXY');}};
  if(location==='envelope')x.envelope=new Proxy(x.envelope,handler);
  if(location==='intent')x.envelope.intent=new Proxy(x.intent,handler);
  if(location==='nested')x.intent.target_release_identity=new Proxy(x.intent.target_release_identity,handler);
  if(location==='array')x.intent.extra=new Proxy([1],handler);
  reject(x.envelope,x.key,x.keyId);equal(calls,0);
 }
 {const x=originalIntentCaptureFixture(),revocable=Proxy.revocable(x.envelope,{});revocable.revoke();reject(revocable.proxy,x.key,x.keyId);}
 for(const location of ['intent','nested','array']){
  let calls=0;const x=originalIntentCaptureFixture(),toJSON=()=>{calls++;return 'SUBSTITUTE';};
  if(location==='intent')x.intent.toJSON=toJSON;
  if(location==='nested')x.intent.target_release_identity.toJSON=toJSON;
  if(location==='array'){x.intent.extra=[1];x.intent.extra.toJSON=toJSON;}
  reject(x.envelope,x.key,x.keyId);equal(calls,0);
 }
 {const x=originalIntentCaptureFixture();x.intent.toJSON='even-data-toJSON-refuses';reject(x.envelope,x.key,x.keyId);}
 {let calls=0;const x=originalIntentCaptureFixture(),key={toString(){calls++;return x.key;}};reject(x.envelope,key,x.keyId);equal(calls,0);}
 {
  const x=originalIntentCaptureFixture(),shared=[null,true,false,0,-0,9007199254740992,'EXACT text\nand UTF8 café',{data:'original'}];
  x.intent.synthetic_data_arrays=[shared,shared];x.envelope.signature=signBinding(restoreIntentBinding(x.intent),x.key);
  const result=capture(x.envelope,x.key,x.keyId);
  equal(originalIntentCaptureCrypto.stableJson(result),originalIntentCaptureCrypto.stableJson(x.intent));
  equal(Object.isFrozen(result.synthetic_data_arrays),true);equal(Object.isFrozen(result.synthetic_data_arrays[0]),true);
  equal(Object.isFrozen(result.synthetic_data_arrays[0][7]),true);
  equal(Object.is(result.synthetic_data_arrays[0][4],-0),true);
  shared[7].data='caller-edited';equal(result.synthetic_data_arrays[0][7].data,'original');equal(result.synthetic_data_arrays[1][7].data,'original');
  assert.throws(()=>{result.synthetic_data_arrays.push('edit');},TypeError);checks++;
  assert.throws(()=>{result.synthetic_data_arrays[0][7].data='edit';},TypeError);checks++;
 }
 {const x=originalIntentCaptureFixture();Object.defineProperty(x.intent,'__proto__',{value:{data:'plain JSON'},enumerable:true});
  x.envelope.signature=signBinding(restoreIntentBinding(x.intent),x.key);const result=capture(x.envelope,x.key,x.keyId);
  equal(Object.getPrototypeOf(result),Object.prototype);equal(Object.hasOwn(result,'__proto__'),true);
  equal(signBinding(restoreIntentBinding(result),x.key),x.envelope.signature);}
 console.log(JSON.stringify({scope:'NEW original restore intent data capture with SYNTHETIC signing keys only',checks,status:'PASS',
  limits:'No actual target/source approval, generation/expiry currentness, Supabase/SQL/private import or authority proof; finite JS numbers preserved, lost prior precision not repaired.'}));
}
