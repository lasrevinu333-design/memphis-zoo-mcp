#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isProxy } from "node:util/types";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { materializeVerifiedArchive, readVerifiedArchiveSourceBinding, readVerifiedRestoreTableSelection,
  openVerifiedRestoreTableData, decodeRestoreTableRowLine, createRestoreRowLineBatchDecoder } from "./disaster-recovery-archive.mjs";
import { stableJson, signBinding, restoreIntentBinding } from "./disaster-recovery-crypto.mjs";
import {
  captureStorageSupportedState,
  validateFreshLocalStorageProviderData,
  validateFreshLocalStorageDeniedResponse,
  captureVerifiedFreshLocalStorageProvider,
  compareVerifiedStorageTableData,
  compareStorageState,
  storageBucketOptions,
  storageObjectArchivePath,
  storageObjectUploadOptions,
  storageOwnerPrincipalId,
  validateV4StorageArchiveObjects,
  validateStorageOperatorEvidence,
} from "./disaster-recovery-storage.mjs";

// Pure DATA validator cases only. These synthetic signatures do not create a
// branded archive, native PG client, provider token, live scope or restore ACK.
if (process.argv.includes("--storage-fresh-local-provider-contract-only")) {
  const key="local-contract-unit-key-"+"a".repeat(48),keyId="unit-local-contract",serviceKey="unit-service-"+"b".repeat(48),jwtSecret="unit-local-jwt-"+"c".repeat(48);
  const hash=v=>createHash("sha256").update(v).digest("hex");
  const now=Date.now(),approved=new Date(now-1000).toISOString(),expires=new Date(now+1800000).toISOString();
  function input(profile="native-text-v4-existing-postgres"){
    const role=profile==="native-text-v4-existing-postgres"?"postgres":"supabase_admin";
    const intent={restore_id:"11111111-1111-4111-8111-111111111111",authority_generation:1,retry_of_restore_id:null,
      archive_digest:"a".repeat(64),source_project_ref:"original-project",target_project_ref:"isolated-project",
      source_identity_sha256:"b".repeat(64),target_migration_head:"20261026065000",target_release_identity:null,
      actor:"synthetic-pure-contract-test",approved_at:approved,expires_at:expires,resume_after_verification:false};
    const originalIntentEnvelope={format:"memphis-zoo-production-restore-intent.v1",algorithm:"hmac-sha256",key_id:keyId,intent,
      signature:signBinding(restoreIntentBinding(intent),key)};
    const binding={purpose:"custodial-immutable-fresh-local-storage-provider",source_profile:profile,
      original_intent_sha256:hash(stableJson(originalIntentEnvelope)),restore_id:intent.restore_id,authority_generation:1,
      archive_digest:intent.archive_digest,source_identity_sha256:intent.source_identity_sha256,
      source_project_ref:intent.source_project_ref,target_project_ref:intent.target_project_ref,approved_at:approved,expires_at:expires,
      host_target:{hostname:"127.0.0.1",port:54329,database_name:"mz_schema_rebuild_contract",database_oid:"16384",session_user:role,database_owner:"postgres"},
      provider:{origin:"http://127.0.0.1:54330",container_id:"c".repeat(64),image_digest:"sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd",
        namespace:"mz_schema_rebuild_contract",config_sha256:"d".repeat(64),service_key_sha256:hash(serviceKey),jwt_secret_sha256:hash(jwtSecret),
        database:{network_alias:"mz_schema_rebuild_contract",port:5432,database_name:"mz_schema_rebuild_contract",database_oid:"16384",role:"supabase_storage_admin"},
        backend:"file",restore_method:"official-file-backend-archived-version-v1",archived_storage_inventory_sha256:"e".repeat(64),
        archived_migrations_74_full_tuple_sha256:"f".repeat(64),file_backend_namespace_sha256:"1".repeat(64)}};
    return {providerEnvelope:{format:"custodial.immutable-fresh-local-storage-provider.v1",algorithm:"hmac-sha256",key_id:keyId,binding,signature:signBinding(binding,key)},
      originalIntentEnvelope,intentVerifyKey:key,intentVerifyKeyId:keyId,serviceKey,jwtSecret,databaseUrl:`postgresql://${role}:unit@127.0.0.1:54329/mz_schema_rebuild_contract`,
      expected:{source_profile:profile,expected_session_user:role,expected_database_owner:"postgres",archive_digest:intent.archive_digest,
        source_project_ref:intent.source_project_ref,source_identity_sha256:intent.source_identity_sha256,archived_storage_inventory_sha256:"e".repeat(64)}};
  }
  let cases=0;
  for(const profile of ["native-text-v4-existing-postgres","immutable-private-fresh-supabase-admin"]){
    assert.equal(validateFreshLocalStorageProviderData(input(profile)).binding.source_profile,profile);cases++;
  }
  const mutations=[
    x=>x.providerEnvelope.binding.provider.origin="http://example.com:54330",
    x=>x.providerEnvelope.binding.provider.origin="http://127.0.0.1:54330/storage/v1",
    x=>x.providerEnvelope.binding.provider.origin="http://user@127.0.0.1:54330",
    x=>x.providerEnvelope.binding.provider.origin="http://127.0.0.1:54330?other=1",
    x=>x.providerEnvelope.binding.provider.database.database_oid="16385",
    x=>x.providerEnvelope.binding.provider.database.role="postgres",
    x=>x.providerEnvelope.binding.host_target.session_user="supabase_admin",
    x=>x.providerEnvelope.binding.host_target.database_owner="supabase_admin",
    x=>x.providerEnvelope.binding.provider.image_digest="sha256:"+"0".repeat(64),
    x=>x.providerEnvelope.binding.provider.restore_method="ordinary-upsert-and-repin",
    x=>x.providerEnvelope.binding.provider.archived_storage_inventory_sha256="0".repeat(64),
    x=>x.providerEnvelope.binding.archive_digest="0".repeat(64),
    x=>x.providerEnvelope.binding.authority_generation=2,
    x=>x.providerEnvelope.binding.restore_id="22222222-2222-4222-8222-222222222222",
    x=>x.providerEnvelope.binding.original_intent_sha256="0".repeat(64),
    x=>x.providerEnvelope.binding.expires_at=new Date(now-1).toISOString(),
    x=>x.providerEnvelope.binding.expires_at=new Date(now+3600000).toISOString(),
    x=>x.providerEnvelope.binding.host_target.port=5432,
    x=>x.providerEnvelope.binding.host_target.extra="unreviewed",
    x=>x.providerEnvelope.binding.provider.extra="unreviewed",
    x=>x.providerEnvelope.binding.provider.service_key_sha256="0".repeat(64),
    x=>x.providerEnvelope.binding.provider.jwt_secret_sha256="0".repeat(64),
    x=>x.jwtSecret="too-short",
    x=>{x.jwtSecret=key;x.providerEnvelope.binding.provider.jwt_secret_sha256=hash(key);},
    x=>x.databaseUrl="postgresql://postgres:unit@remote.example:54329/mz_schema_rebuild_contract",
    x=>x.databaseUrl+="?options=-crole%3Dpostgres",
    x=>x.expected.source_profile="caller-selected-role",
  ];
  for(const mutate of mutations){const x=input();mutate(x);x.providerEnvelope.signature=signBinding(x.providerEnvelope.binding,key);
    assert.throws(()=>validateFreshLocalStorageProviderData(x));cases++;}
  {const x=input();x.providerEnvelope.signature="0".repeat(64);assert.throws(()=>validateFreshLocalStorageProviderData(x));cases++;}
  {const x=input();x.originalIntentEnvelope.intent.actor="tampered";assert.throws(()=>validateFreshLocalStorageProviderData(x));cases++;}
  {const x=input();let invoked=false;Object.defineProperty(x.providerEnvelope.binding,"provider",{enumerable:true,get(){invoked=true;throw Error("getter");}});
    assert.throws(()=>validateFreshLocalStorageProviderData(x));assert.equal(invoked,false);cases++;}
  {const x=input();x.providerEnvelope.binding=new Proxy(x.providerEnvelope.binding,{});assert.throws(()=>validateFreshLocalStorageProviderData(x));cases++;}
  assert.throws(()=>captureVerifiedFreshLocalStorageProvider({...input(),verifiedArchive:{}}));cases++;
  const wire={statusCode:'404',code:'NoSuchKey',error:'not_found',message:'Object not found'};
  const jwtWire={statusCode:'403',code:'AccessDenied',error:'Unauthorized',message:'Invalid Compact JWS'};
  for(const [kind,body]of [['private-object',wire],['invalid-signature',jwtWire]]){
    const raw=Buffer.from(JSON.stringify(body)),actual=validateFreshLocalStorageDeniedResponse(400,raw,kind);
    assert.equal(actual.body_sha256,hash(raw));assert.equal(actual.probe_kind,kind);cases++;
  }
  const counterfeit=[
    [200,Buffer.from(JSON.stringify(wire)),'private-object'],[500,Buffer.from(JSON.stringify(wire)),'private-object'],
    [400,Buffer.from('{}'),'private-object'],[400,Buffer.from('not json'),'private-object'],
    [400,Buffer.from('x'.repeat(4097)),'private-object'],[400,Buffer.from([255]),'private-object'],
    [400,Buffer.from(JSON.stringify({...wire,code:'InternalError'})),'private-object'],
    [400,Buffer.from(JSON.stringify({...wire,statusCode:'403'})),'private-object'],
    [400,Buffer.from(JSON.stringify({...wire,extra:'unmatched'})),'private-object'],
    [400,Buffer.from(JSON.stringify({...wire,message:'read bytes leaked'})),'private-object'],
    [400,Buffer.from(JSON.stringify(jwtWire)),'private-object'],[400,Buffer.from(JSON.stringify(wire)),'invalid-signature'],
    [400,Buffer.from(JSON.stringify({...jwtWire,message:'unrecognized JWT failure'})),'invalid-signature']
  ];
  for(const args of counterfeit){assert.throws(()=>validateFreshLocalStorageDeniedResponse(...args));cases++;}
  console.log(JSON.stringify({status:"PASS",scope:"PURE_CLOSED_LOCAL_PROVIDER_CONTRACT_DATA_ONLY",cases,
    provider_runtime:false,original_archive:false,native_database:false,restore_ack:false}));
  process.exit(0);
}

// Actual consumer with inert discrepancy/resample DATA only: no native SQL,
// provider, current private authority, or new evidence/admission port.
if (process.argv.includes("--storage-exact-reconciliation-hold-only")) {
  const selected = process.argv.find(value => value.startsWith("--storage-exact-hold-case="))?.split("=")[1];
  assert.ok(selected === undefined || ["reproduction", "envelopes", "legacy", "boundary", "preservation"].includes(selected));
  const completed = [];
  const run = (group, name, body) => {
    if (selected && selected !== group) return;
    body(); completed.push(name);
    console.log(JSON.stringify({ case: name, status: "PASS_NEW_SOURCE_CONSUMER_ONLY" }));
  };
  const now = Date.parse("2026-10-18T09:00:00.000Z");
  const observed = new Date(now - 1000).toISOString();
  const state = { bucket_count: 1, object_count: 0,
    bucket_rows: [{ id: "UNIT-only", file_size_limit: 9007199254740992, created_at: "UNIT-current-time" }],
    object_rows: [], object_byte_digests: [] };
  const resample = { format: "memphis-zoo.storage-supported-state-resample.v1", observed_at: observed, state,
    state_sha256: createHash("sha256").update(stableJson(state)).digest("hex") };
  const evidence = { format: "memphis-zoo.storage-operator-reconciliation.v2",
    verification_method: "UNIT only current parsed Storage resample observation.", verified_at: observed,
    platform_managed_disposition: "PRESERVED", owner_access_results: [] };
  const args = details => ({ evidence, discrepancy: { details_json: details },
    manifestUpdatedAt: new Date(now - 5000).toISOString(), finalManifestSha256: "a".repeat(64),
    discrepancySnapshotSha256: "b".repeat(64), supportedStateResample: resample, now });
  const held = value => value instanceof Error && value.code === "STORAGE_EXACT_RECONCILIATION_HELD"
    && value.retry_safe === false && value.message === "Storage reconciliation is held pending a same-original current native exact-table recheck.";
  const reject = (details, extra = {}) => assert.throws(() => validateStorageOperatorEvidence({ ...args(details), ...extra }), held);
  const platform = { scope: "bucket", key: "UNIT-only", field: "created_at", support: "platform_managed",
    expected: "UNIT-original-time", actual: "UNIT-current-time" };
  const exact = status => ({ status, tables: [{ schema_name: "storage", table_name: "buckets", status,
    original_count: "1", current_count: "1", missing_count: status === "MATCH" ? "0" : "1",
    extra_count: status === "MATCH" ? "0" : "1" }] });
  run("reproduction", "original exact DIFFERENT plus empty parsed list cannot be RESOLVED", () => {
    const input = args({ discrepancies: [], exact_table_data: { status: "DIFFERENT", missing_rows: 1, extra_rows: 1 } });
    // This actual invocation RETURNED accepted on the unchanged predecessor.
    let accepted = false;
    try { validateStorageOperatorEvidence(input); accepted = true; } catch (error) { if (!held(error)) throw error; }
    console.log(JSON.stringify({ predecessor_counterexample_accepted: accepted, source_only: true }));
    assert.equal(accepted, false, "Exact native original DATA difference was cleared by parsed equality");
  });
  for (const status of ["DIFFERENT", "UNSUPPORTED", "NOT_APPLICABLE_ORIGINAL_NO_MEMBERS", "MATCH", "UNKNOWN", "", null]) {
    run("envelopes", `stored exact ${String(status)} never acts as a fresh native receipt`, () => {
      reject({ discrepancies: [platform], exact_table_data: exact(status) });
    });
    run("envelopes", `final-quiescent exact ${String(status)} cannot be discarded`, () => {
      reject({ discrepancies: [platform], final_quiescent_resample: { differences: [], exact_table_data: exact(status) } });
    });
  }
  for (const malformed of [undefined, null, false, [], {}, "MATCH", { status: "MATCH" },
    { status: "MATCH", tables: [] }]) {
    run("envelopes", `present malformed exact original field ${String(completed.length)}`, () => {
      reject({ discrepancies: [platform], exact_table_data: malformed });
    });
  }
  run("envelopes", "ACCEPTED_LOSS cannot waive exact immutable original rows", () => {
    reject({ discrepancies: [platform], exact_table_data: exact("DIFFERENT") }, {
      reconciliationDisposition: "ACCEPTED_LOSS", evidence: { ...evidence, platform_managed_disposition: "ACCEPTED_LOSS" } });
  });
  run("envelopes", "later asserted MATCH cannot clear earlier exact difference", () => {
    reject({ discrepancies: [], exact_table_data: exact("DIFFERENT"),
      final_quiescent_resample: { differences: [], exact_table_data: exact("MATCH"), metadata_and_ownership_verified: true } });
  });
  run("envelopes", "top MATCH cannot hide final exact difference", () => {
    reject({ discrepancies: [], exact_table_data: exact("MATCH"),
      final_quiescent_resample: { differences: [], exact_table_data: exact("DIFFERENT") } });
  });
  for (const details of [undefined, null, {}, { discrepancies: [] }, { discrepancies: null },
    { discrepancies: [platform], metadata_and_ownership_verified: true },
    { discrepancies: [platform], final_quiescent_resample: null },
    { discrepancies: [platform], final_quiescent_resample: { differences: [] } },
    { discrepancies: [platform], fresh_exact_status: "MATCH" }]) {
    run("envelopes", `missing or omitted exact provenance ${String(completed.length)}`, () => reject(details));
  }
  run("envelopes", "fresh public evidence assertion does not repair stored exact obligation", () => {
    reject({ discrepancies: [], exact_table_data: exact("DIFFERENT") }, { evidence: {
      ...evidence, exact_table_data: exact("MATCH"), metadata_and_ownership_verified: true, native_verified: true } });
  });
  run("envelopes", "apply binding mode is also held before resolving exact obligation", () => {
    reject({ discrepancies: [platform], exact_table_data: exact("DIFFERENT") }, { requireBindings: true });
  });
  run("envelopes", "matching rounded supported field without exact provenance remains held", () => {
    reject({ discrepancies: [{ scope: "bucket", key: "UNIT-only", field: "file_size_limit", support: "supported",
      expected: 9007199254740992, actual: 9007199254740992 }] });
  });
  run("envelopes", "relabeled original field cannot become platform-managed loss", () => {
    reject({ discrepancies: [{ ...platform, field: "file_size_limit", expected: 9007199254740992 }] }, {
      reconciliationDisposition: "ACCEPTED_LOSS", evidence: { ...evidence, platform_managed_disposition: "ACCEPTED_LOSS" } });
  });
  run("legacy", "genuine legacy platform-only accepted loss retains existing rule", () => {
    const result = validateStorageOperatorEvidence({ ...args({ discrepancies: [platform] }),
      reconciliationDisposition: "ACCEPTED_LOSS", evidence: { ...evidence, platform_managed_disposition: "ACCEPTED_LOSS" } });
    assert.equal(result.platform_managed_disposition, "ACCEPTED_LOSS");
    assert.equal(Object.hasOwn(result, "exact_table_data"), false);
  });
  run("legacy", "unresolved legacy platform difference still cannot be PRESERVED", () => {
    assert.throws(() => validateStorageOperatorEvidence(args({ discrepancies: [platform] })), /explicit signed ACCEPTED_LOSS/);
  });
  run("legacy", "repaired legacy platform field still obeys RESOLVED rule", () => {
    const result = validateStorageOperatorEvidence(args({ discrepancies: [{ ...platform, expected: "UNIT-current-time" }] }));
    assert.equal(result.platform_managed_disposition, "PRESERVED");
  });
  run("legacy", "repaired platform field cannot be relabeled accepted loss", () => {
    assert.throws(() => validateStorageOperatorEvidence({ ...args({ discrepancies: [{ ...platform, expected: "UNIT-current-time" }] }),
      reconciliationDisposition: "ACCEPTED_LOSS", evidence: { ...evidence, platform_managed_disposition: "ACCEPTED_LOSS" } }), /cannot be mislabeled/);
  });
  run("boundary", "accessor details refused without evaluating public Source DATA", () => {
    let calls = 0;
    const input = args(null); input.discrepancy = { get details_json() { calls++; throw "UNIT raw value"; } };
    assert.throws(() => validateStorageOperatorEvidence(input), held); assert.equal(calls, 0);
  });
  run("boundary", "accessor exact status refused without invoking accessor", () => {
    let calls = 0;
    const details = { discrepancies: [platform], get exact_table_data() { calls++; throw "UNIT raw value"; } };
    reject(details); assert.equal(calls, 0);
  });
  run("boundary", "proxy envelope refused without executing traps", () => {
    let calls = 0; reject(new Proxy({}, { ownKeys() { calls++; throw "UNIT raw value"; } })); assert.equal(calls, 0);
  });
  run("boundary", "inherited exact marker or parsed list cannot be adopted", () => {
    reject(Object.create({ exact_table_data: exact("MATCH") }, { discrepancies: { value: [platform], enumerable: true } }));
  });
  run("boundary", "sparse discrepancy list is unavailable not empty", () => reject({ discrepancies: new Array(1) }));
  run("boundary", "coercible or unsupported discrepancy field never waives original data", () => {
    let calls = 0; reject({ discrepancies: [{ ...platform, field: { toString() { calls++; return "created_at"; } } }] });
    assert.equal(calls, 0);
  });
  run("boundary", "fixed held error contains no raw body/cause/actual/expected", () => {
    let failure; try { validateStorageOperatorEvidence(args({ discrepancies: [], exact_table_data: { private_row: "UNIT-private-sentinel" } })); }
    catch (error) { failure = error; }
    assert.ok(held(failure));
    for (const key of ["cause", "actual", "expected"]) assert.equal(Object.hasOwn(failure, key), false);
    assert.equal(JSON.stringify(failure).includes("UNIT-private-sentinel"), false);
    assert.equal(String(failure.stack).includes("UNIT-private-sentinel"), false);
    assert.equal(String(failure).includes("UNIT-private-sentinel"), false);
  });
  run("preservation", "legacy platform-only signed apply binding remains mandatory", () => {
    const input = { ...args({ discrepancies: [platform] }), reconciliationDisposition: "ACCEPTED_LOSS",
      evidence: { ...evidence, platform_managed_disposition: "ACCEPTED_LOSS" } };
    const bound = validateStorageOperatorEvidence(input);
    assert.doesNotThrow(() => validateStorageOperatorEvidence({ ...input, evidence: bound, requireBindings: true }));
    assert.throws(() => validateStorageOperatorEvidence({ ...input, evidence: { ...bound, final_manifest_sha256: "c".repeat(64) },
      requireBindings: true }), /not bound to the exact manifest/);
  });
  const ownerInput = differences => {
    const object = { bucket_id: "UNIT-only", name: "UNIT-object", owner_id: "UNIT-original-owner", owner: "UNIT-original-owner",
      created_at: "UNIT-current-time" };
    const owned = { ...state, object_count: 1, object_rows: [object], object_byte_digests: [{ bucket_id: object.bucket_id,
      name: object.name, owner_principal_id: object.owner_id, sha256: "d".repeat(64), size_bytes: 1 }] };
    return { ...args({ discrepancies: differences }), supportedStateResample: { ...resample, state: owned,
      state_sha256: createHash("sha256").update(stableJson(owned)).digest("hex") }, evidence: { ...evidence,
      owner_access_results: [{ bucket_id: object.bucket_id, name: object.name, owner_principal_id: object.owner_id,
        non_owner_principal_id: "UNIT-non-owner", owner_read_succeeded: true, non_owner_read_denied: true,
        tested_at: observed, evidence_reference: "UNIT only inert owner and non-owner access observation." }] } };
  };
  const access = { scope: "object", key: '["UNIT-only","UNIT-object"]', bucket_id: "UNIT-only", name: "UNIT-object",
    field: "owner_access_boundary", support: "operator_reconciliation" };
  run("preservation", "legacy named owner access is still separately required", () => {
    const input = ownerInput([access]);
    assert.equal(validateStorageOperatorEvidence(input).owner_access_results.length, 1);
    assert.throws(() => validateStorageOperatorEvidence({ ...input, evidence: { ...input.evidence, owner_access_results: [] } }),
      /must name the exact object discrepancy set/);
  });
  run("preservation", "legacy object platform-only loss retains independent owner proof", () => {
    const input = ownerInput([access, { ...access, field: "created_at", support: "platform_managed_or_owner",
      expected: "UNIT-original-time", actual: "UNIT-current-time" }]);
    input.reconciliationDisposition = "ACCEPTED_LOSS";
    input.evidence.platform_managed_disposition = "ACCEPTED_LOSS";
    assert.equal(validateStorageOperatorEvidence(input).platform_managed_disposition, "ACCEPTED_LOSS");
  });
  run("preservation", "owner loss remains nonwaivable even in legacy platform mode", () => {
    const input = ownerInput([{ ...access, field: "owner_id", expected: "UNIT-different-original-owner", actual: "UNIT-original-owner" }]);
    input.reconciliationDisposition = "ACCEPTED_LOSS";
    input.evidence.platform_managed_disposition = "ACCEPTED_LOSS";
    assert.throws(() => validateStorageOperatorEvidence(input), /ownership must be restored/);
  });
  run("preservation", "modern exact obligations remain held even with complete legacy owner proof", () => {
    const input = ownerInput([access]); input.discrepancy.details_json.exact_table_data = exact("DIFFERENT");
    assert.throws(() => validateStorageOperatorEvidence(input), held);
  });
  run("preservation", "omitted modern exact field is not rescued by matching parsed original data", () => {
    reject({ discrepancies: [{ ...platform, field: "user_metadata", support: "supported", expected: { safe: 0.125 }, actual: { safe: 0.125 } }] });
  });
  run("preservation", "missing original membership cannot be waived as platform loss", () => {
    reject({ discrepancies: [{ ...platform, field: "presence", support: "platform_managed", expected: true, actual: false }] }, {
      reconciliationDisposition: "ACCEPTED_LOSS", evidence: { ...evidence, platform_managed_disposition: "ACCEPTED_LOSS" } });
  });
  assert.ok(completed.length > 0);
  console.log(JSON.stringify({ status: "NEW_EXACT_STORAGE_RECONCILIATION_SOURCE_ONLY", cases: completed.length,
    native_SQL: "NOT_RUN", provider: "NOT_RUN", resources: 0 }));
  process.exit(0);
}

// NEW actual sampler export with inert SQL/download ports ONLY. Native type
// observations here are explicit UNIT response DATA, not native/auth/SQL proof.
if(process.argv.includes('--storage-supported-lossless-only')){
  const group=process.argv.find(v=>v.startsWith('--storage-sampler-case='))?.slice('--storage-sampler-case='.length);
  const member=process.argv.find(v=>v.startsWith('--storage-sampler-member='))?.slice('--storage-sampler-member='.length);
  assert.ok(group===undefined||['reproduction','safe','refusal','currentness','failure','boundary'].includes(group));
  const cases=[];const run=async(part,name,body)=>{if((!group||group===part)&&(!member||name.includes(member))){await body();cases.push(part+': '+name);
    console.log(JSON.stringify({case:part+': '+name,status:'PASS_NEW_INERT_SAMPLER_ONLY'}));}};
  const bytes=Buffer.from('UNIT downloaded bytes\0é'),hash=v=>createHash('sha256').update(v).digest('hex');
  const observedAt='2026-10-18T09:00:00.000Z',uuid='11111111-1111-4111-8111-111111111111';
  const base=()=>({buckets:[{id:'unit-bucket',name:'UNIT fixture',public:false,file_size_limit:4096,
    allowed_mime_types:['application/octet-stream','NULL',null,'a,b','quoted"','space a'],owner_id:'UNIT-owner'}],
    objects:[{id:uuid,bucket_id:'unit-bucket',name:'UNIT-only.bin',metadata:{size:bytes.length,mimetype:'application/octet-stream'},
      user_metadata:{safe:9007199254740992,precise:0.125,nested:[null,true,'9007199254740993']},
      owner_id:'UNIT-owner',owner:'UNIT-owner',version:'UNIT-version',created_at:'2026-10-18T01:02:03.123456+00:00',
      updated_at:'2026-10-18T01:02:03.123457+00:00',last_accessed_at:null}]});
  const typeMap={id:['25','text'],name:['25','text'],public:['16','bool'],file_size_limit:['20','int8'],allowed_mime_types:['1009','_text'],
    owner_id:['25','text'],bucket_id:['25','text'],metadata:['3802','jsonb'],user_metadata:['3802','jsonb'],owner:['25','text'],version:['25','text'],
    created_at:['1184','timestamptz'],updated_at:['1184','timestamptz'],last_accessed_at:['1184','timestamptz']};
  const columns=(state,overrides={})=>['buckets','objects'].flatMap((table,t)=>{
    const row=state[table][0]||(t?base().objects[0]:base().buckets[0]);
    return Object.keys(row).map((name,i)=>{const [type_oid,type_name]=name==='id'&&t?['2950','uuid']:(typeMap[name]||['25','text']);
      return {table_name:table,relation_oid:String(31000+t),owner:'10',namespace_owner:'10',ordinal:String(i+1),name,type_oid,type_name,
        type_kind:'b',type_namespace:'pg_catalog',modifier:'-1',input_oid:'100',output_oid:'101',input_source:'UNIT native input observation',
        output_source:'UNIT native output observation',native_io:'true',visible:'true',shape:'true',database_oid:'16000',backend_pid:'4321',
        actor:'UNIT original owner',session_actor:'UNIT original owner',isolation:'repeatable read',snapshot:'100:200:',
        date_style:'ISO, MDY',timezone:'UTC',float_digits:'3',...overrides[table+'.'+name]};});
  });
  const arrayText=value=>'{'+value.map(v=>v===null?'NULL':v===''||/[{},"\\\s]/.test(v)||/^NULL$/i.test(v)
    ?'"'+v.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"':v).join(',')+'}';
  const rows=(state,table,cols,changes={})=>state[table].map((row,i)=>{
    const native={},tokens={};for(const c of cols.filter(c=>c.table_name===table)){
      const value=row[c.name],key=table+':'+i+':'+c.name;
      tokens[c.name]=JSON.stringify(value);
      native[c.name]=value===null?null:['json','jsonb'].includes(c.type_name)?JSON.stringify(value):c.type_name==='_text'?arrayText(value)
        :['timestamp','timestamptz'].includes(c.type_name)?value.replace('T',' ').replace(/\+00:00$/,'+00'):String(value);
      if(Object.hasOwn(changes.tokens||{},key))tokens[c.name]=changes.tokens[key];
      if(Object.hasOwn(changes.native||{},key))native[c.name]=changes.native[key];
    }
    let raw='{'+Object.entries(tokens).map(([key,value])=>JSON.stringify(key)+':'+value).join(',')+'}';
    if(changes.raw)raw=changes.raw(raw,table,i);
    return {row:raw,native_text:JSON.stringify(native)};
  });
  function recording(options={}){
    const initial=options.initial||base(),after=options.after||initial,trace=[],queries=[];
    const firstColumns=columns(initial,options.columns),lastColumns=columns(after,options.finalColumns||options.columns);
    let catalogReads=0,bucketReads=0,objectReads=0,downloads=0,callerEnds=0;
    const failAt=options.failAt,value=Object.hasOwn(options,'throwValue')?options.throwValue:new Error('UNIT first failure with private payload');
    const db={async query(sql){queries.push(sql);let phase,result;
      if(sql.includes('from pg_catalog.pg_class c')){
        phase='catalog:'+ ++catalogReads;const selected=catalogReads<=2?firstColumns:lastColumns;
        let actual=structuredClone(selected);if(options.catalog)actual=options.catalog(actual,catalogReads);
        result={command:'SELECT',rowCount:actual.length,rows:actual.map(c=>({descriptor:JSON.stringify(c)}))};
      }else{
        const table=sql.includes('from "storage"."buckets"')?'buckets':sql.includes('from "storage"."objects"')?'objects':null;
        assert.ok(table,'Only actual fixed Storage/catalog sampler reads');
        assert.ok(sql.includes('pg_catalog.row_to_json(r)::pg_catalog.text row'));assert.ok(sql.includes('pg_catalog.json_object(ARRAY['));
        const read=table==='buckets'?++bucketReads:++objectReads;phase=table+':'+read;
        const resultRows=rows(read===1?initial:after,table,read===1?firstColumns:lastColumns,read===1?options.beforeWire:options.afterWire);
        if(options.rowResult)options.rowResult(resultRows,table,read);
        result={command:'SELECT',rowCount:resultRows.length,rows:resultRows};
      }
      trace.push(phase);if(phase===failAt)throw value;return result;
    },end(){callerEnds++;assert.fail('Sampler does not own connection lifetime');}};
    const downloadObject=async(bucketId,name)=>{downloads++;trace.push('download:'+downloads);
      const row=initial.objects[downloads-1];assert.equal(bucketId,row.bucket_id);assert.equal(name,row.name);
      if(failAt==='download:'+downloads)throw value;
      if(options.onDownload)options.onDownload(db,downloads);
      return bytes;
    };
    return {db,downloadObject,trace,queries,initial,after,options,downloads:()=>downloads,callerEnds:()=>callerEnds};
  }
  const sample=async r=>captureStorageSupportedState({db:r.db,downloadObject:r.downloadObject,observedAt});
  const refuse=async(r,{downloads=0,reason}={})=>{let failed=false,failure;
    try{await sample(r);}catch(error){failed=true;failure=error;}
    assert.equal(failed,true,'No postfailure result');assert.equal(failure.code,'STORAGE_SUPPORTED_STATE_UNAVAILABLE');
    assert.equal(failure.retry_safe,false);assert.equal(r.downloads(),downloads);assert.equal(r.callerEnds(),0);
    if(reason)assert.equal(failure.storage_sample_reason,reason);
    for(const key of ['cause','actual','expected','row','sql','path'])assert.equal(Object.hasOwn(failure,key),false);
    for(const secret of ['private payload','9007199254740993','UNIT-owner'])assert.equal((failure.stack+JSON.stringify(failure)+String(failure)).includes(secret),false);
    return failure;
  };
  await run('reproduction','installed pg114 collapses high integer/fraction but actual raw sampler refuses before bytes',async()=>{
    const raw='{"large":9007199254740993,"precise":0.123456789012345678901234567890}',parse=pg.types.getTypeParser(114),parsed=parse(raw);
    assert.equal(JSON.stringify(parsed),'{"large":9007199254740992,"precise":0.12345678901234568}');
    const seen=[];JSON.parse(raw,(key,value,context)=>{if(key)seen.push(context?.source);return value;});
    assert.deepEqual(seen,['9007199254740993','0.123456789012345678901234567890']);
    const r=recording({beforeWire:{tokens:{'objects:0:user_metadata':raw},native:{'objects:0:user_metadata':raw}}});
    await refuse(r,{reason:'V1_NUMBER_UNREPRESENTABLE'});assert.equal(r.trace.some(v=>v.startsWith('download')),false);
  });
  await run('safe','unchanged v1 fields/digests owner bytes and microsecond strings for representable native state',async()=>{
    const r=recording(),value=await sample(r),{last_accessed_at:_ignored,...object}=r.initial.objects[0];
    const metadata={buckets:r.initial.buckets,objects:[object]};assert.deepEqual(value.state.bucket_rows,r.initial.buckets);assert.deepEqual(value.state.object_rows,[object]);
    assert.equal(value.format,'memphis-zoo.storage-supported-state-resample.v1');assert.equal(value.observed_at,observedAt);
    assert.equal(value.state.metadata_sha256,hash(stableJson(metadata)));assert.equal(value.state_sha256,hash(stableJson(value.state)));
    assert.deepEqual(value.state.object_byte_digests,[{bucket_id:object.bucket_id,name:object.name,owner_principal_id:'UNIT-owner',size_bytes:bytes.length,sha256:hash(bytes)}]);
    assert.deepEqual(r.trace,['catalog:1','buckets:1','objects:1','catalog:2','download:1','catalog:3','buckets:2','objects:2','catalog:4']);
    assert.equal(r.callerEnds(),0);assert.equal(value.state.object_rows[0].created_at,'2026-10-18T01:02:03.123456+00:00');
  });
  await run('safe','last_accessed_at value only may change and empty sets retain explicit native source reads',async()=>{
    const initial=base(),after=structuredClone(initial);after.objects[0].last_accessed_at='2026-10-18T01:02:04.654321+00:00';
    const r=recording({initial,after}),value=await sample(r);assert.equal(Object.hasOwn(value.state.object_rows[0],'last_accessed_at'),false);
    const empty=recording({initial:{buckets:[],objects:[]}}),zero=await sample(empty);assert.equal(zero.state.object_count,0);assert.equal(empty.downloads(),0);
    assert.equal(empty.trace.length,8);assert.equal(r.downloads(),1);
  });
  await run('safe','canonical JSON lexical text and SQL NULL simple fields stay representable',async()=>{
    const initial=base();initial.objects[0].user_metadata={a:1,b:[null,'exact']};initial.objects[0].version=null;
    const r=recording({initial,columns:{'objects.user_metadata':{type_oid:'114',type_name:'json'}}}),value=await sample(r);
    assert.deepEqual(value.state.object_rows[0].user_metadata,initial.objects[0].user_metadata);assert.equal(value.state.object_rows[0].version,null);
  });
  const rawRefusals=[['huge integer','{"n":9007199254740993}','V1_NUMBER_UNREPRESENTABLE'],['precise fraction','{"n":0.123456789012345678901234567890}','V1_NUMBER_UNREPRESENTABLE'],
    ['negative zero','{"n":-0}','V1_NUMBER_UNREPRESENTABLE'],['overflow','{"n":1e999}','V1_NUMBER_UNREPRESENTABLE'],['underflow','{"n":1e-999}','V1_NUMBER_UNREPRESENTABLE'],
    ['noncanonical numeric scale','{"n":1.0}','V1_NUMBER_UNREPRESENTABLE'],['nested duplicate','{"x":{"same":1,"same":2}}','DUPLICATE_KEY'],
    ['escaped duplicate','{"same":1,"\\u0073ame":2}','DUPLICATE_KEY'],['lone Unicode','{"s":"\\ud800"}','V1_UNICODE_UNREPRESENTABLE']];
  for(const [name,raw,reason]of rawRefusals)await run('refusal','late '+name+' is rejected before the FIRST download',async()=>{
    const initial=base();initial.objects.push({...initial.objects[0],id:'22222222-2222-4222-8222-222222222222',name:'UNIT-late.bin'});
    await refuse(recording({initial,beforeWire:{tokens:{'objects:1:user_metadata':raw},native:{'objects:1:user_metadata':raw}}}),{reason});
  });
  for(const mode of ['SQL NULL','JSON null'])await run('refusal','ambiguous '+mode+' JSON column cannot enter v1',async()=>{
    const initial=base();initial.objects[0].user_metadata=null;
    const r=recording({initial,beforeWire:{native:{'objects:0:user_metadata':mode==='SQL NULL'?null:'null'}}});await refuse(r,{reason:'V1_NULL_AMBIGUOUS'});
  });
  for(const [name,config]of [
    ['domain',{columns:{'objects.user_metadata':{type_kind:'d'}}}],['custom IO',{columns:{'objects.user_metadata':{native_io:'false'}}}],
    ['foreign type namespace',{columns:{'objects.user_metadata':{type_namespace:'UNIT_private'}}}],
    ['noncanonical JSON lexical',{columns:{'objects.user_metadata':{type_oid:'114',type_name:'json'}},beforeWire:{tokens:{'objects:0:user_metadata':' {"safe":1} '},native:{'objects:0:user_metadata':' {"safe":1} '}}}],
    ['array lower bound',{beforeWire:{native:{'buckets:0:allowed_mime_types':'[0:0]={application/octet-stream}'}}}],
    ['multidimensional array',{beforeWire:{native:{'buckets:0:allowed_mime_types':'{{application/octet-stream}}'}}}],
    ['missing type provenance',{catalog:columns=>columns.map(({type_kind:_missing,...column})=>column)}],
    ['missing catalog table',{catalog:columns=>columns.filter(c=>c.table_name!=='objects')}],
    ['incomplete visibility',{columns:{'objects.id':{visible:'false'}}}],
    ['native float profile',{initial:(()=>{const value=base();value.objects[0].version=0.5;return value;})(),columns:{'objects.version':{type_oid:'701',type_name:'float8',float_digits:'0'}}}],
  ])await run('refusal',name+' unavailable before bytes',async()=>{await refuse(recording(config));});
  await run('refusal','duplicate alias in a raw row is not silently discarded by JSON.parse',async()=>{
    const r=recording({beforeWire:{raw:(raw,table)=>table==='objects'?raw.replace('"id":','"id":"foreign","\\u0069d":'):raw}});
    await refuse(r,{reason:'DUPLICATE_KEY'});
  });
  for(const [name,change]of [
    ['owner',state=>{state.objects[0].owner_id=state.objects[0].owner='UNIT-foreign';}],
    ['identity',state=>{state.objects[0].id='22222222-2222-4222-8222-222222222222';}],
    ['object key',state=>{state.objects[0].name='UNIT-new-key.bin';}],['metadata',state=>{state.objects[0].metadata.size++;}],
    ['membership',state=>{state.objects=[];}],['extra object',state=>{state.objects.push({...state.objects[0],id:'22222222-2222-4222-8222-222222222222',name:'extra.bin'});}],
    ['bucket value',state=>{state.buckets[0].public=true;}],
  ])await run('currentness','fresh after-byte '+name+' change refuses',async()=>{const initial=base(),after=structuredClone(initial);change(after);
    await refuse(recording({initial,after}),{downloads:1,reason:'METADATA_CHANGED'});});
  await run('currentness','high precision changed after download cannot collapse to initial parsed metadata',async()=>{
    const raw='{"safe":9007199254740993,"precise":0.125,"nested":[null,true,"9007199254740993"]}';
    const r=recording({afterWire:{tokens:{'objects:0:user_metadata':raw},native:{'objects:0:user_metadata':raw}}});
    assert.deepEqual(pg.types.getTypeParser(114)(raw),base().objects[0].user_metadata);
    await refuse(r,{downloads:1,reason:'V1_NUMBER_UNREPRESENTABLE'});
  });
  await run('currentness','identical v1 objects do not hide a native JSON lexical image change',async()=>{
    const raw=' {"size":'+bytes.length+',"mimetype":"application/octet-stream"} ';
    await refuse(recording({afterWire:{tokens:{'objects:0:metadata':raw},native:{'objects:0:metadata':raw}}}),{downloads:1,reason:'METADATA_CHANGED'});
  });
  for(const [name,change]of [['missing identity',state=>{delete state.objects[0].id;}],['duplicate identity',state=>{state.objects.push({...state.objects[0]});}],
    ['orphan bucket',state=>{state.objects[0].bucket_id='UNIT-absent';}],['duplicate bucket',state=>{state.buckets.push({...state.buckets[0]});}],
    ['coercible identity',state=>{state.objects[0].name=12;}],['ambiguous owner',state=>{state.objects[0].owner_id='UNIT-other';}]])await run('refusal',name+' cannot follow a download prefix',async()=>{
    const initial=base();change(initial);await refuse(recording({initial}));
  });
  for(const change of [column=>{column.owner='11';},column=>{column.relation_oid='31002';},column=>{column.type_oid='25';column.type_name='text';}])await run('currentness','catalog/owner/type before-vs-after consistency '+String(change),async()=>{
    const r=recording({catalog:(cols,n)=>{if(n===4)change(cols.find(c=>c.table_name==='objects'&&c.name==='last_accessed_at'));return cols;}});
    await refuse(r,{downloads:1});
  });
  for(const failAt of ['catalog:1','buckets:1','objects:1','catalog:2','download:1','catalog:3','buckets:2','objects:2','catalog:4'])await run('failure','first '+failAt+' failure stops all later work',async()=>{
    const r=recording({failAt});await refuse(r,{downloads:failAt==='download:1'||['catalog:3','buckets:2','objects:2','catalog:4'].includes(failAt)?1:0});assert.equal(r.trace.at(-1),failAt);
  });
  for(const value of [undefined,null,false,0,''])await run('failure','falsy download failure is bounded and cannot publish '+String(value),async()=>{
    const r=recording({failAt:'download:1',throwValue:value}),error=await refuse(r,{downloads:1});
    assert.equal(error.storage_sample_phase,'DOWNLOAD');assert.equal(error.storage_sample_reason,'DOWNLOAD_FAILED');assert.equal(r.trace.at(-1),'download:1');
  });
  await run('failure','query replacement during byte await cannot switch readers or publish a sample',async()=>{
    const r=recording({onDownload:db=>{db.query=()=>assert.fail('Changed reader must never be invoked');}});
    await refuse(r,{downloads:1,reason:'QUERY_PORT_CHANGED'});
  });
  await run('boundary','catalog identifiers and literals are quoted; sampler owns no transaction or writer',async()=>{
    const initial=base();initial.buckets[0]["odd'\\\"column"]='UNIT-only';const r=recording({initial});await sample(r);
    const rawRead=r.queries.find(sql=>sql.includes('from "storage"."buckets"'));
    assert.ok(rawRead.includes("E'odd''\\\\\"column'"));assert.ok(rawRead.includes('r."odd\'\\""column"::pg_catalog.text'));
    assert.ok(r.queries.every(sql=>sql.startsWith('select ')));assert.equal(r.callerEnds(),0);
    assert.equal(r.queries.filter(sql=>sql.includes('row_to_json')).length,4);
  });
  await run('refusal','lone Unicode object KEY is not a representable v1 native JSON value',async()=>{
    const raw='{"\\ud800":1}',r=recording({beforeWire:{tokens:{'objects:0:user_metadata':raw},native:{'objects:0:user_metadata':raw}}});
    await refuse(r,{reason:'V1_UNICODE_UNREPRESENTABLE'});
  });
  await run('refusal','a consistent actual float profile still requires roundtrip output settings',async()=>{
    const initial=base();initial.objects[0].version=0.5;
    const r=recording({initial,columns:{'objects.version':{type_oid:'701',type_name:'float8'}},catalog:cols=>cols.map(c=>({...c,float_digits:'0'}))});
    await refuse(r,{reason:'V1_FLOAT_PROFILE_UNSUPPORTED'});
  });
  await run('safe','supported float profile and empty quoted text-array elements survive actual v1 serialization',async()=>{
    const initial=base();initial.buckets[0].allowed_mime_types=['',null,'NULL','null'];initial.objects[0].version=0.5;
    const r=recording({initial,columns:{'objects.version':{type_oid:'701',type_name:'float8'}}}),value=await sample(r);
    assert.equal(value.state.object_rows[0].version,0.5);assert.deepEqual(value.state.bucket_rows[0].allowed_mime_types,['',null,'NULL','null']);
  });
  await run('refusal','parsed pg JSON cannot substitute for required raw TEXT observations',async()=>{
    const r=recording({rowResult:(rows,table)=>{if(table==='objects')rows[0].row=JSON.parse(rows[0].row);}});
    await refuse(r,{reason:'ROW_LIMIT'});
  });
  await run('currentness','a reordered current object membership cannot be adopted as the selected state',async()=>{
    const initial=base();initial.objects.push({...initial.objects[0],id:'22222222-2222-4222-8222-222222222222',name:'UNIT-second.bin'});
    const after=structuredClone(initial);after.objects.reverse();await refuse(recording({initial,after}),{downloads:2,reason:'METADATA_CHANGED'});
  });
  assert.ok(cases.length>0);console.log(JSON.stringify({selector:'--storage-supported-lossless-only',group:group||'all',count:cases.length,cases,
    status:'PASS_NEW_INERT_SAMPLER_SOURCE_ONLY',native_SQL:'NOT_RUN',provider:'NOT_RUN',type_provenance:'INERT_UNIT_RESPONSES_NOT_NATIVE_PROOF',
    output_format:'memphis-zoo.storage-supported-state-resample.v1',authority:false,old_groups_replayed:0,resources:0}));process.exit(0);
}

// NEW fixed checkpoint caller recordings ONLY. The extracted shipping caller
// uses inert ports here, NOT a native pg.Client, Source receipt, authenticated
// comparison, real transaction, provider, permission or runtime acceptance.
if (process.argv.includes('--storage-exact-checkpoint-caller-only')) {
  const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const storageSnapshotQuery = Client.prototype.query;'),end=source.indexOf('\nlet restorePhase = "connect";',start);
  assert.ok(start>0&&end>start);const wrapperSource=source.slice(start,end);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const compile=new Function('ports',`const {Client,db,types,verifiedArchive,sourceBinding,requireOriginalArchiveSource,
    readVerifiedRestoreTableSelection,compareVerifiedStorageTableData}=ports;${wrapperSource};return readExactOriginalStorageSnapshot;`);
  const chosen=process.argv.find(value=>value.startsWith('--storage-exact-caller-case='))?.slice('--storage-exact-caller-case='.length);
  const member=process.argv.find(value=>value.startsWith('--storage-exact-caller-member='))?.slice('--storage-exact-caller-member='.length);
  assert.ok(chosen===undefined||['snapshot','checkpoint','shape','failure','boundary'].includes(chosen));
  const cases=[];const run=async(group,name,body)=>{if((!chosen||chosen===group)&&(!member||name.includes(member))){await body();cases.push(name);
    console.log(JSON.stringify({case:name,status:'PASS_NEW_INERT_CALLER_COMPONENT_ONLY'}));}};
  const profile=["set local row_security = off","set local search_path = pg_catalog, pg_temp","set local extra_float_digits = 3",
    "set local DateStyle = 'ISO, YMD'","set local TimeZone = 'UTC'","set local IntervalStyle = 'postgres'","set local bytea_output = 'hex'"];
  const binding=Object.freeze({UNIT:'inert Source comparison DATA only'}),archive=Object.freeze({UNIT:'inert archive port only'});
  const selected=Object.freeze({storageTables:Object.freeze(['buckets','objects'].map(name=>Object.freeze({schema_name:'storage',table_name:name,row_count:'1'})))});
  const data=(status='MATCH',selection=selected)=>({sourceBinding:binding,status:selection.storageTables.length?status:'NOT_APPLICABLE_ORIGINAL_NO_MEMBERS',
    tables:selection.storageTables.map((table,index)=>({schema_name:'storage',table_name:table.table_name,
      status:status==='DIFFERENT'&&index===0?'MATCH':status,original_count:'1',current_count:status==='UNSUPPORTED'?null:'1',
      missing_count:status==='UNSUPPORTED'?null:status==='DIFFERENT'&&index===1?'1':'0',
      extra_count:status==='UNSUPPORTED'?null:status==='DIFFERENT'&&index===1?'1':'0',
      ...(status==='UNSUPPORTED'?{reason:'TARGET_SOURCE_CATALOG_OR_FULL_VISIBILITY_UNSUPPORTED'}:{})}))});
  function recording(options={}){
    const events=[],writes=[],comparisons=[],selectionReads=[],withdrawal=new Error('UNIT Source withdrawn'),connection={stream:{destroyed:false}};
    let live=true,selection=options.selection||selected,compareIndex=0,transaction=0,open=false,rollbacks=0;
    const originalFailure=Object.hasOwn(options,'throwValue')?options.throwValue:new Error('UNIT original read failure');
    class InertClient {async query(sql,values){
      events.push({kind:'query',sql,transaction});
      if(sql.startsWith('begin ')){assert.equal(this._txStatus,'I');transaction++;this._txStatus='T';
        if(options.failAt==='BEGIN')throw originalFailure;
        if(options.withdrawAt==='BEGIN')live=false;
        return {command:options.badBegin?'ROLLBACK':'BEGIN',rowCount:null,rows:[]};}
      if(sql==='rollback'){rollbacks++;this._txStatus='I';
        if(options.failAt==='ROLLBACK'||options.alsoFailRollback)throw new Error('UNIT rollback failure');
        if(options.withdrawAt==='ROLLBACK')live=false;
        if(options.changeSelectionAt==='ROLLBACK')selection={...selection};
        return {command:options.badRollback?'COMMIT':'ROLLBACK',rowCount:null,rows:[]};}
      if(profile.includes(sql)){assert.equal(this._txStatus,'T');if(options.failAt===sql)throw originalFailure;
        if(options.withdrawAt===sql)live=false;return {command:'SET',rowCount:null,rows:[]};}
      assert.equal(this._txStatus,'I','No comparison snapshot may cover evidence writes or parsed resampling');
      if(sql.includes('row_to_json('))return {command:'SELECT',rowCount:1,rows:[{row:{UNIT:'parsed row'}}]};
      if(sql.includes('insert into custodial_dr.restore_discrepancies')){open=true;writes.push({kind:'discrepancy',values});return {command:'INSERT',rowCount:1,rows:[]};}
      if(sql.includes('update custodial_dr.restore_manifests')){writes.push({kind:'manifest',values});return {command:'UPDATE',rowCount:1,rows:[]};}
      if(sql.includes("count(*)::int count from custodial_dr.restore_discrepancies"))return {rows:[{count:open?1:0}]};
      assert.fail('Unexpected fixed caller SQL');
    }}
    const db=new InertClient();Object.assign(db,{connection,_connected:true,_ending:false,_ended:false,_queryable:true,_txStatus:'I',
      readyForQuery:true,_activeQuery:undefined,_queryQueue:[]});
    const current=()=>{events.push({kind:'source'});if(!live)throw withdrawal;};
    const read=compile({Client:InertClient,db,types:{isProxy},verifiedArchive:archive,sourceBinding:binding,requireOriginalArchiveSource:current,
      readVerifiedRestoreTableSelection:(value,config)=>{assert.equal(value,archive);assert.deepEqual(config,{databaseOnly:true});
        selectionReads.push({state:db._txStatus,rollbacks});return selection;},
      compareVerifiedStorageTableData:async optionsPassed=>{
        assert.deepEqual(Reflect.ownKeys(optionsPassed).sort(),['db','verifiedArchive']);assert.equal(optionsPassed.db,db);assert.equal(optionsPassed.verifiedArchive,archive);
        assert.equal(db._txStatus,'T');const before=events.filter(e=>e.kind==='query'&&e.transaction===transaction).map(e=>e.sql);
        assert.deepEqual(before,profile);comparisons.push({transaction});events.push({kind:'compare',transaction});
        if(options.failAt==='COMPARE')throw originalFailure;
        if(options.withdrawAt==='COMPARE')live=false;
        if(options.changeSelectionAt==='COMPARE')selection={...selection};
        const value=options.results?options.results[compareIndex++]:data('MATCH',selection);
        return typeof value==='function'?value():value;
      }});
    return {db,read,events,writes,comparisons,selectionReads,current,originalFailure,withdrawal,selection,
      rollbackCount:()=>rollbacks,transactionCount:()=>transaction};
  }
  const caught=async call=>{let failed=false,failure;try{await call();}catch(error){failed=true;failure=error;}
    assert.equal(failed,true,'Expected refusal');return failure;};
  await run('snapshot','fixed native caller snapshot profile/rollback/order and bounded detached summary',async()=>{
    const r=recording(),value=await r.read();assert.equal(value.status,'MATCH');assert.equal(r.rollbackCount(),1);
    assert.equal(r.comparisons.length,1);assert.equal(r.db._txStatus,'I');assert.equal(Object.isFrozen(value),true);
    assert.equal(Object.isFrozen(value.tables),true);assert.equal(Object.isFrozen(value.tables[0]),true);
    assert.deepEqual(Object.keys(value),['status','tables']);assert.equal(JSON.stringify(value).includes('inert Source'),false);
    assert.deepEqual(r.events.filter(e=>e.kind==='query').map(e=>e.sql),['begin isolation level repeatable read read only',...profile,'rollback']);
    assert.equal(r.events.at(-1).kind,'source');
  });
  const postStart=source.indexOf('    requireOriginalArchiveSource();\n    const actualBuckets = await db.query('),postEnd=source.indexOf('\n  }\n  const storageVerified =',postStart);
  const finalStart=source.indexOf('  if (!databaseOnly) {\n    requireOriginalArchiveSource();\n    const finalBuckets ='),finalEnd=source.indexOf('\n  if (cronEvidence)',finalStart);
  assert.ok(postStart>0&&postEnd>postStart&&finalStart>postEnd&&finalEnd>finalStart);
  const postSource=source.slice(postStart,postEnd),finalSource=source.slice(finalStart,finalEnd);
  const unresolvedStart=source.indexOf('  const unresolved = await db.query(',finalEnd),unresolvedEnd=source.indexOf('\n  const finalManifest =',unresolvedStart);
  assert.ok(unresolvedStart>finalEnd&&unresolvedEnd>unresolvedStart);
  const post=new AsyncFunction('ports',`const {db,requireOriginalArchiveSource,readExactOriginalStorageSnapshot,compareStorageState}=ports;
    const buckets=[{}],objects=[{size_bytes:1}],targetBucketsBefore={rowCount:1},targetObjectsBefore={rowCount:1},restoreId='UNIT-original',generation=1;
    let storageEvidence;${postSource};return storageEvidence;`);
  const final=new AsyncFunction('ports','storageEvidence',`const {db,requireOriginalArchiveSource,readExactOriginalStorageSnapshot,compareStorageState}=ports;
    const databaseOnly=false,buckets=[{}],objects=[{}],restoreId='UNIT-original',generation=1,mutationFenceHeld=true,productionSupabase={};
    ${finalSource}${source.slice(unresolvedStart,unresolvedEnd)};return {storageEvidence,resumeEligible,unresolvedCount};`);
  const ports=(r,differences=[])=>({db:r.db,requireOriginalArchiveSource:r.current,readExactOriginalStorageSnapshot:r.read,
    compareStorageState:()=>differences});
  await run('checkpoint','two genuinely separate read invocations are mandatory despite parsed equality',async()=>{
    const r=recording({results:[data(),data()]}),evidence=await post(ports(r)),result=await final(ports(r),evidence);
    assert.equal(evidence.metadata_and_ownership_verified,true);assert.equal(result.resumeEligible,true);
    assert.deepEqual(r.comparisons.map(v=>v.transaction),[1,2]);assert.equal(r.rollbackCount(),2);
    assert.equal(evidence.final_quiescent_resample.exact_table_data.status,'MATCH');assert.equal(r.writes.at(-1).values[1],true);
  });
  for(const status of ['DIFFERENT','UNSUPPORTED','NOT_APPLICABLE_ORIGINAL_NO_MEMBERS'])await run('checkpoint','parsed equality cannot clear exact '+status,async()=>{
    const selection=status.startsWith('NOT_APPLICABLE')?{storageTables:[]}:selected;
    const r=recording({selection,results:[data(status,selection),data(status,selection)]}),evidence=await post(ports(r)),result=await final(ports(r),evidence);
    assert.equal(result.resumeEligible,false);assert.equal(evidence.metadata_and_ownership_verified,false);
    assert.equal(r.writes.filter(v=>v.kind==='discrepancy').length,2);assert.equal(r.writes.at(-1).values[1],false);
  });
  await run('checkpoint','real pg114 equality counterexample stays OPEN on final native mismatch',async()=>{
    const parse=pg.types.getTypeParser(114),a=parse('{"n":9007199254740992}'),b=parse('{"n":9007199254740993}');assert.deepEqual(a,b);
    const r=recording({results:[data(),data('DIFFERENT')]}),evidence=await post(ports(r)),result=await final(ports(r),evidence);
    assert.equal(evidence.exact_table_data.status,'MATCH');assert.equal(evidence.final_quiescent_resample.exact_table_data.status,'DIFFERENT');
    assert.equal(evidence.metadata_and_ownership_verified,false);assert.equal(result.resumeEligible,false);assert.equal(result.unresolvedCount,1);
  });
  await run('checkpoint','existing owner/access/platform discrepancy is retained even with exact MATCH',async()=>{
    const discrepancy={field:'owner_access_boundary',support:'operator_reconciliation',UNIT:'not cleared'},r=recording(),p=ports(r,[discrepancy]);
    const evidence=await post(p),result=await final(p,evidence);assert.equal(result.resumeEligible,false);
    assert.equal(evidence.discrepancies[0],discrepancy);assert.equal(evidence.final_quiescent_resample.differences[0],discrepancy);
  });
  await run('checkpoint','a later MATCH never erases an earlier exact discrepancy',async()=>{
    const r=recording({results:[data('DIFFERENT'),data()]}),evidence=await post(ports(r)),result=await final(ports(r),evidence);
    assert.equal(evidence.metadata_and_ownership_verified,false);assert.equal(result.resumeEligible,false);
    assert.equal(r.writes.filter(v=>v.kind==='discrepancy').length,1);assert.equal(r.writes.at(-1).values[1],false);
  });
  const badResults=[['missing table',()=>{const v=data();v.tables.pop();return v;}],['foreign Source',()=>({...data(),sourceBinding:{}})],
    ['changed original',()=>{const v=data();v.tables[0].original_count='2';return v;}],['noncanonical count',()=>{const v=data();v.tables[0].current_count='01';return v;}],
    ['missing result',()=>undefined],['status contradiction',()=>({...data('DIFFERENT'),status:'MATCH'})],
    ['foreign table',()=>{const v=data();v.tables[0].table_name='foreign';return v;}],['duplicate table',()=>{const v=data();v.tables[1]=v.tables[0];return v;}],
    ['extra receipt authority',()=>({...data(),resume:true})],['accessor',()=>Object.defineProperty(data(),'status',{get(){assert.fail('No accessor evaluation');}})],
    // Await assimilates thenables before the caller receives a value. Permit
    // only that engine lookup, never any result field/descriptor adoption.
    ['proxy',()=>new Proxy(data(),{get(_target,key){if(key==='then')return undefined;assert.fail('No proxy evaluation');}})],
    ['count overflow',()=>{const v=data();v.tables[0].original_count='9223372036854775808';return v;}]];
  for(const [name,result]of badResults)await run('shape','closed exact result refuses '+name,async()=>{
    const r=recording({results:[result]});const error=await caught(()=>post(ports(r)));
    assert.equal(error.code,'STORAGE_EXACT_SNAPSHOT_UNAVAILABLE');assert.equal(r.rollbackCount(),1);assert.equal(r.writes.length,0);
  });
  for(const failAt of ['BEGIN',...profile,'COMPARE'])await run('failure','own failed await drains once: '+failAt,async()=>{
    const r=recording({failAt}),error=await caught(r.read);assert.equal(error,r.originalFailure);assert.equal(r.rollbackCount(),1);
    assert.equal(r.db._txStatus,'I');assert.equal(r.writes.length,0);
  });
  for(const value of [undefined,null,false,0,''])await run('failure','falsy first failure retained: '+String(value),async()=>{
    const r=recording({failAt:'COMPARE',throwValue:value});assert.equal(await caught(r.read),value);assert.equal(r.rollbackCount(),1);
  });
  await run('failure','first falsy failure and rollback failure both retained without success',async()=>{
    const r=recording({failAt:'BEGIN',throwValue:0,alsoFailRollback:true}),error=await caught(r.read);
    assert.ok(error instanceof AggregateError);assert.equal(error.errors[0],0);assert.equal(error.cause,0);assert.equal(r.rollbackCount(),1);
  });
  for(const withdrawAt of ['BEGIN',profile[2],'COMPARE','ROLLBACK'])await run('failure','Source withdrawal at '+withdrawAt+' cannot publish or skip cleanup',async()=>{
    const r=recording({withdrawAt}),error=await caught(r.read);assert.ok(error===r.withdrawal||error instanceof AggregateError);
    assert.equal(r.rollbackCount(),1);assert.equal(r.db._txStatus,'I');assert.equal(r.writes.length,0);
  });
  for(const options of [{failAt:'ROLLBACK'},{badBegin:true},{badRollback:true},{changeSelectionAt:'COMPARE'}])await run('failure','cleanup/receipt/current selection failure '+JSON.stringify(options),async()=>{
    const r=recording(options);await caught(r.read);assert.equal(r.rollbackCount(),1);assert.equal(r.writes.length,0);
  });
  await run('failure','existing transaction or replaced instance query refuses before BEGIN and does not roll back caller work',async()=>{
    for(const change of [r=>{r.db._txStatus='T';},r=>{r.db.query=()=>assert.fail('No query facade');},r=>{r.db._queryQueue.push({});}]){
      const r=recording();change(r);const error=await caught(r.read);assert.equal(error.code,'STORAGE_EXACT_SNAPSHOT_UNAVAILABLE');
      assert.equal(r.rollbackCount(),0);assert.equal(r.transactionCount(),0);
    }
  });
  await run('failure','catalog selection replacement during rollback prevents final publication',async()=>{
    const r=recording({changeSelectionAt:'ROLLBACK'}),error=await caught(r.read);
    assert.ok(error instanceof AggregateError);assert.equal(error.errors[0].code,'STORAGE_EXACT_SNAPSHOT_UNAVAILABLE');
    assert.equal(r.rollbackCount(),1);assert.equal(r.writes.length,0);assert.equal(r.db._txStatus,'I');
  });
  await run('snapshot','catalog currentness is re-read after rollback and immediately before the original result returns',async()=>{
    const r=recording(),value=await r.read();assert.equal(value.status,'MATCH');assert.equal(r.rollbackCount(),1);
    assert.deepEqual(r.selectionReads.slice(-2),[{state:'I',rollbacks:1},{state:'I',rollbacks:1}]);
    assert.equal(Object.hasOwn(value,'sourceBinding'),false);assert.equal(r.db._txStatus,'I');
  });
  await run('checkpoint','final refused or missing exact observation aborts before completion despite prior MATCH',async()=>{
    const original=new Error('UNIT exact observer refused');
    for(const value of [undefined,()=>{throw original;}]){
      const r=recording({results:[data(),value]}),evidence=await post(ports(r));assert.equal(evidence.metadata_and_ownership_verified,true);
      const error=await caught(()=>final(ports(r),evidence));assert.ok(error===original||error.code==='STORAGE_EXACT_SNAPSHOT_UNAVAILABLE');
      assert.equal(r.rollbackCount(),2);assert.equal(r.writes.length,0);assert.equal(r.db._txStatus,'I');
      assert.equal(Object.hasOwn(evidence,'final_quiescent_resample'),false,'No fabricated final result or completion output');
    }
  });
  await run('boundary','shipping import/fixed direct comparator and no generic transaction/profile/effect API',async()=>{
    assert.match(source,/import \{\s+compareStorageState,\s+compareVerifiedStorageTableData,/);
    assert.equal(wrapperSource.includes('export '),false);assert.equal(wrapperSource.includes('commit"'),false);
    assert.equal(wrapperSource.includes('new Client'),false);assert.equal(wrapperSource.includes('db.query('),false);
    assert.equal((source.match(/await readExactOriginalStorageSnapshot\(\)/g)||[]).length,2);
    assert.ok(source.indexOf('return {',source.indexOf('if (freshPrivateDatabase)'))<postStart,'Existing private fresh early return precedes new caller checks');
  });
  assert.ok(cases.length>0);console.log(JSON.stringify({selector:'--storage-exact-checkpoint-caller-only',group:chosen||'all',count:cases.length,cases,
    status:'PASS_NEW_INERT_SOURCE_CALLER_ONLY',native_SQL:'NOT_RUN',provider:'NOT_RUN',Source_authentication:'NOT_PROVEN_BY_RECORDINGS',authority:false,old_groups_replayed:0,resources:0}));
  process.exit(0);
}

// NEW exact original upload DATA -> installed SDK multipart serialization.
// Fetch is explicitly inert UNIT transport: no provider/auth/SQL/native proof.
if(process.argv.includes('--storage-original-upload-only')){
  const {mkdtempSync,mkdirSync,writeFileSync,renameSync,rmSync,readdirSync,readlinkSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
  const {StorageClient}=require('@supabase/storage-js'),pg=require('pg');
  const api=await import('./disaster-recovery-archive.mjs'),wire=await import('./production-backup-pg-dump-command.mjs');
  const {prepareVerifiedStorageUploads}=await import('./disaster-recovery-storage.mjs');
  const {signBinding,archiveSignatureBinding}=await import('./disaster-recovery-crypto.mjs');
  const part=process.argv.find(v=>v.startsWith('--storage-upload-case='))?.split('=')[1];
  const member=process.argv.find(v=>v.startsWith('--storage-upload-member='))?.slice('--storage-upload-member='.length);
  assert.ok(part===undefined||['reproduction','sdk','archive','lifecycle','caller','producer'].includes(part));
  const work=mkdtempSync(join(tmpdir(),'UNIT-storage-upload-')),archives=[],holders=[],cases=[];let ordinal=0;
  const hash=v=>createHash('sha256').update(v).digest('hex'),json=v=>Buffer.from(JSON.stringify(v)+'\n');
  const key='UNIT-only-storage-upload-archive-HMAC-20261018',keyId='unit-storage-upload-v1';
  const rawMetadata=' {"large":9007199254740993,"precise":0.123456789012345678901234567890,"nested":{"value":[9007199254740995,null,"é"]}} ';
  const uuid='11111111-1111-4111-8111-111111111111';
  const run=async(group,name,body)=>{if((!part||group===part)&&(!member||name.includes(member))){
    const start=archives.length,h=holders.length;try{await body();cases.push(group+': '+name);console.log(JSON.stringify({case:group+': '+name,status:'PASS_NEW_UNIT_COMPONENT_ONLY'}));}
    finally{for(const holder of holders.slice(h))holder.close();for(const archive of archives.slice(start))archive.cleanup();}
  }};
  function fixture(settings={}){
    const dir=join(work,'original-'+ordinal++);mkdirSync(join(dir,'inventory'),{recursive:true});mkdirSync(join(dir,'database'));mkdirSync(join(dir,'storage','objects'),{recursive:true});
    const tag=settings.encoding??api.postgresTextColumnsLineEncoding,typed=tag===api.postgresTextColumnsLineEncoding;
    const bucket={id:'unit-bucket',name:'unit-bucket',public:'false',file_size_limit:'9007199254740993',allowed_mime_types:'{application/octet-stream,image/png}',...settings.bucket};
    if(!typed&&settings.bucket?.allowed_mime_types===undefined)bucket.allowed_mime_types=null;
    const rows=(settings.objects||[{}]).map((change,i)=>({id:i?String(i+1).padStart(8,'0')+'-1111-4111-8111-111111111111':uuid,
      bucket_id:bucket.id,name:'folder/UNIT-'+i+'.bin',metadata:'{"mimetype":"application/octet-stream","cacheControl":"3600"}',
      user_metadata:rawMetadata,owner_id:'UNIT-owner.invalid',owner:null,version:'UNIT-version',
      created_at:'2026-10-18 01:02:03.123456+00',updated_at:'2026-10-18 01:02:03.123457+00',last_accessed_at:null,...change}));
    const columns=(names,types)=>names.map((name,i)=>({name,data_type:types[i],generated:'',identity:''}));
    const bc=columns(Object.keys(bucket),['text','text','boolean','bigint','text[]']);
    const oc=columns(Object.keys(rows[0]),['uuid','text','text','jsonb',settings.userType||'jsonb','text','uuid','text',
      'timestamp with time zone','timestamp with time zone','timestamp with time zone']);
    const table=(schema_name,table_name,columns,count)=>({schema_name,table_name,columns,primary_key:['id'],row_count:String(count),
      data_file:'database/'+schema_name+'.'+table_name+'.jsonl',data_encoding:tag});
    const catalog=[table('public','empty',columns(['id'],['bigint']),0),table('auth','empty',columns(['id'],['bigint']),0),
      table('storage','buckets',bc,1),table('storage','objects',oc,rows.length)];
    settings.catalog?.(catalog);
    const legacy=(row,cols)=>'{'+Object.entries(row).map(([name,value])=>{
      const type=cols.find(c=>c.name===name).data_type;
      return JSON.stringify(name)+':'+(value===null?'null':['json','jsonb','boolean','bigint'].includes(type)?value:JSON.stringify(value));
    }).join(',')+'}';
    const encode=(row,cols)=>typed?wire.encodeProductionBackupTextColumnsDataRow(JSON.stringify(row)):JSON.stringify(legacy(row,cols));
    const entries=new Map([['database/public.empty.jsonl',Buffer.alloc(0)],['database/auth.empty.jsonl',Buffer.alloc(0)],
      ['database/storage.buckets.jsonl',Buffer.from(encode(bucket,bc)+'\n')],['database/storage.objects.jsonl',Buffer.from(rows.map(row=>encode(row,oc)).join('\n')+'\n')]]);
    const manifests=rows.map((row,i)=>{
      const bytes=Buffer.from('UNIT verified object bytes '+i+'\0é'),file=storageObjectArchivePath(row.bucket_id,row.name);
      entries.set(file,bytes);const database_row=JSON.parse(legacy(row,oc));
      for(const k of ['created_at','updated_at'])database_row[k]=database_row[k].replace(' ','T').replace('+00','+00:00');
      return {id:row.id,bucket_id:row.bucket_id,name:row.name,file,size_bytes:bytes.length,sha256:hash(bytes),
        metadata:database_row.metadata,user_metadata:database_row.user_metadata,version:row.version,created_at:database_row.created_at,
        updated_at:database_row.updated_at,database_row};
    });
    settings.manifests?.(manifests,entries);
    entries.set('inventory/storage-buckets.json',json([JSON.parse(legacy(bucket,bc))]));
    entries.set('inventory/storage-objects.json',json(manifests));
    entries.set('inventory/table-catalog.json',json(catalog));
    settings.entries?.(entries);
    const sourceIdentity={database_catalog_sha256:hash(entries.get('inventory/table-catalog.json'))};
    const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',project_ref:'unitunitunitunitunit',source_identity:sourceIdentity,
      consistent_database_snapshot:true,backed_up_schemas:['public','auth','storage'],table_count:catalog.length,
      database_row_count:catalog.reduce((sum,table)=>sum+Number(table.row_count),0)};
    entries.set('backup-summary.json',json(summary));
    for(const [name,data]of entries)writeFileSync(join(dir,name),data,{flag:'wx'});
    const sums=Buffer.from([...entries].map(([name,data])=>hash(data)+'  '+name).join('\n')+'\n');writeFileSync(join(dir,'SHA256SUMS'),sums,{flag:'wx'});
    const digest=hash(sums);writeFileSync(join(dir,'archive-signature.json'),json({format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',key_id:keyId,
      archive_digest:digest,signature:signBinding(archiveSignatureBinding({archiveDigest:digest,projectRef:summary.project_ref,sourceIdentity,archiveFormat:summary.format}),key)}),{flag:'wx'});
    const archive=api.materializeVerifiedArchive({sourceDir:dir,archiveVerifyKey:key,archiveVerifyKeyId:keyId});archives.push(archive);
    return {archive,dir,entries,manifests,rows,bucket,catalog};
  }
  const noFds=archive=>assert.deepEqual(readdirSync('/proc/self/fd').flatMap(fd=>{try{return readlinkSync('/proc/self/fd/'+fd).includes(archive.directory)?[fd]:[];}catch{return [];}}),[]);
  const prepare=async f=>{try{const holder=await prepareVerifiedStorageUploads({verifiedArchive:f.archive});holders.push(holder);return holder;}finally{noFds(f.archive);}};
  const rejection=async call=>assert.rejects(call,error=>{assert.equal(error.code,'VERIFIED_STORAGE_UPLOAD_UNAVAILABLE');
    for(const key of ['cause','actual','expected','path','sql'])assert.equal(Object.hasOwn(error,key),false);
    assert.equal(error.stack.includes('9007199254740993'),false);assert.equal(JSON.stringify(error).includes('UNIT-owner'),false);return true;});
  const transport=(calls,respond)=>new StorageClient('https://UNIT-upload.invalid/storage/v1',{},async(url,options)=>{
    const call={url,method:options.method,body:options.body,headers:options.headers};calls.push(call);
    if(respond)return await respond(call,calls.length);
    return new Response(JSON.stringify({Id:uuid,Key:'unit-bucket/folder/UNIT-0.bin',name:'unit-bucket'}),{status:200,headers:{'Content-Type':'application/json'}});
  });
  try{
    await run('producer','new shipping raw backup inventory joins signed v2 Source and installed SDK without rounding',async()=>{
      const source=readFileSync(new URL('./production-backup.mjs',import.meta.url),'utf8');
      const start=source.indexOf('function encodeRawStorageInventoryRows('),end=source.indexOf('function quoteIdentifier(',start);
      assert.ok(start>0&&end>start);
      const producer=new Function(source.slice(start,end)+'\nreturn {encodeRawStorageInventoryRows,finishRawStorageObjectArchiveRow};')();
      const f=fixture({entries:entries=>{
        const typed=JSON.parse(wire.decodeProductionBackupTextColumnsDataRow(entries.get('database/storage.objects.jsonl').toString().trimEnd()));
        const originalRow='{'+Object.entries(typed).map(([name,value])=>JSON.stringify(name)+':'+
          (['metadata','user_metadata'].includes(name)?value:JSON.stringify(
            ['created_at','updated_at'].includes(name)?value.replace(' ','T').replace('+00','+00:00'):value))).join(',')+'}';
        const row=JSON.parse(originalRow),old=JSON.parse(entries.get('inventory/storage-objects.json'))[0];
        const template='{"id":'+JSON.stringify(row.id)+',"bucket_id":'+JSON.stringify(row.bucket_id)+',"name":'+JSON.stringify(row.name)+
          ',"metadata":'+typed.metadata+',"user_metadata":'+typed.user_metadata+',"version":'+JSON.stringify(row.version)+
          ',"created_at":'+JSON.stringify(row.created_at)+',"updated_at":'+JSON.stringify(row.updated_at)+',"database_row":'+originalRow+'}';
        const manifest=producer.finishRawStorageObjectArchiveRow(template,{file:old.file,size_bytes:old.size_bytes,sha256:old.sha256});
        entries.set('inventory/storage-objects.json',Buffer.from(producer.encodeRawStorageInventoryRows([manifest])));
        const bucket='{"id":"unit-bucket","name":"unit-bucket","public":false,"file_size_limit":9007199254740993,'+
          '"allowed_mime_types":["application/octet-stream","image/png"]}';
        entries.set('inventory/storage-buckets.json',Buffer.from(producer.encodeRawStorageInventoryRows([bucket])));
      }});
      assert.ok(f.entries.get('inventory/storage-objects.json').includes(Buffer.from('9007199254740993')));
      assert.ok(f.entries.get('inventory/storage-buckets.json').includes(Buffer.from('9007199254740993')));
      const holder=await prepare(f),object=holder.objects[0],calls=[];
      assert.equal((await transport(calls).from(object.bucket_id).upload(object.name,object.body,object.options)).error,null);
      holder.requireCurrent();assert.equal(calls.length,1);assert.equal(calls[0].body.get('metadata'),rawMetadata);
      assert.equal(holder.buckets[0].options.fileSizeLimit,'9007199254740993');
      const wireBytes=Buffer.from(await new Request(calls[0].url,{method:'POST',body:calls[0].body}).arrayBuffer());
      assert.ok(wireBytes.includes(Buffer.from(rawMetadata)));
      assert.equal(hash(Buffer.from(await object.body.get('').arrayBuffer())),f.manifests[0].sha256);
    });
    await run('reproduction','real installed pg JSON parser and SDK lose predecessor metadata precision',async()=>{
      const parsed=pg.types.getTypeParser(114)('{"user_metadata":'+rawMetadata+'}'),calls=[];
      const options=storageObjectUploadOptions({metadata:{mimetype:'application/octet-stream',cacheControl:'3600'},...parsed});
      const reply=await transport(calls).from('unit-bucket').upload('UNIT.bin',new Blob(['UNIT']),options);assert.equal(reply.error,null);
      const actual=calls[0].body.get('metadata');assert.notEqual(actual,rawMetadata);
      assert.ok(actual.includes('9007199254740992'));assert.ok(actual.includes('0.12345678901234568'));
      assert.equal(storageBucketOptions({public:false,file_size_limit:'9007199254740993'}).fileSizeLimit,9007199254740992);
    });
    await run('sdk','authenticated v2 raw metadata and exact Blob bytes reach actual installed SDK multipart unchanged',async()=>{
      const f=fixture(),holder=await prepare(f),object=holder.objects[0],calls=[];
      assert.equal(hash(readFileSync(new URL('../node_modules/@supabase/storage-js/dist/index.cjs',import.meta.url))),
        'd84b29d02b17e7fea6adbe852750f4962307d56bc3a284e50c7cce3ce7967f0e');
      assert.equal(holder.sourceBinding,api.readVerifiedArchiveSourceBinding(f.archive));assert.equal(Object.isFrozen(holder),true);
      assert.equal(Object.isFrozen(holder.objects),true);assert.equal(Object.isFrozen(object),true);assert.equal(Object.isFrozen(object.options),true);
      assert.equal(Object.hasOwn(object.options,'metadata'),false);holder.requireCurrent();
      const client=transport(calls);assert.equal((await client.from(object.bucket_id).upload(object.name,object.body,object.options)).error,null);
      holder.requireCurrent();assert.equal(calls.length,1);assert.equal(calls[0].body,object.body);
      assert.deepEqual([...object.body.keys()],['metadata','cacheControl','']);assert.equal(object.body.get('metadata'),rawMetadata);
      const request=new Request(calls[0].url,{method:'POST',body:calls[0].body});
      const serialized=Buffer.from(await request.arrayBuffer());assert.ok(serialized.includes(Buffer.from(rawMetadata)));
      assert.equal(hash(Buffer.from(await object.body.get('').arrayBuffer())),f.manifests[0].sha256);
      assert.equal(object.body.get('').type,'application/octet-stream');assert.equal(object.body.get('cacheControl'),'3600');
      assert.equal((await client.createBucket(holder.buckets[0].id,holder.buckets[0].options)).error,null);
      assert.equal(JSON.parse(calls[1].body).file_size_limit,'9007199254740993');
    });
    await run('sdk','nested duplicate JSON keys and whitespace survive v2 JSON-typed Source wire',async()=>{
      const raw='  {"same":9007199254740993,"same":0.123456789012345678901234567890}  ';
      const holder=await prepare(fixture({userType:'json',objects:[{user_metadata:raw}]})),calls=[];
      assert.equal((await transport(calls).from(holder.objects[0].bucket_id).upload(holder.objects[0].name,holder.objects[0].body,holder.objects[0].options)).error,null);
      assert.equal(calls[0].body.get('metadata'),raw);
    });
    await run('sdk','actual SDK multipart preserves CRLF but cannot preserve bare original JSON line endings',async()=>{
      const raw='{\r\n"large":9007199254740993\r\n}',holder=await prepare(fixture({userType:'json',objects:[{user_metadata:raw}]})),calls=[];
      await transport(calls).from(holder.objects[0].bucket_id).upload(holder.objects[0].name,holder.objects[0].body,holder.objects[0].options);
      assert.ok((await new Request(calls[0].url,{method:'POST',body:calls[0].body}).text()).includes(raw));
      const bare=raw.replaceAll('\r\n','\n'),body=new FormData();body.append('metadata',bare);
      const original=await new Request('https://UNIT.invalid',{method:'POST',body}).text();
      assert.equal(original.includes(bare),false);assert.equal(original.includes(raw),true);
      for(const text of [bare,raw.replaceAll('\r\n','\r')]){
        const f=fixture({userType:'json',objects:[{user_metadata:text}]});await rejection(prepare(f));
      }
    });
    await run('sdk','provable legacy JSONB nonnull metadata uses original spans not rounded inventory',async()=>{
      const f=fixture({encoding:api.postgresJsonTextLineEncoding}),holder=await prepare(f),calls=[];
      await transport(calls).from(holder.objects[0].bucket_id).upload(holder.objects[0].name,holder.objects[0].body,holder.objects[0].options);
      assert.equal(calls[0].body.get('metadata'),rawMetadata.trim());assert.equal(holder.buckets[0].options.allowedMimeTypes,null);
    });
    await run('sdk','prepared native file cannot shadow bytes or type and remains accepted by actual installed SDK',async()=>{
      const f=fixture(),holder=await prepare(f),object=holder.objects[0],part=object.body.get(''),calls=[];
      assert.equal(Object.isFrozen(part),true);
      for(const key of ['stream','name','type','arrayBuffer'])assert.throws(()=>Object.defineProperty(part,key,{value:()=>null}),TypeError);
      holder.requireCurrent();assert.equal((await transport(calls).from(object.bucket_id).upload(object.name,object.body,object.options)).error,null);
      assert.ok(Buffer.from(await new Request(calls[0].url,{method:'POST',body:calls[0].body}).arrayBuffer()).includes(f.entries.get(f.manifests[0].file)));
      assert.equal(calls[0].body.get('metadata'),rawMetadata);holder.requireCurrent();
    });
    for(const [name,settings]of [
      ['late SQL NULL user metadata',{objects:[{}, {user_metadata:null}]}],['JSON null user metadata',{objects:[{user_metadata:'null'}]}],
      ['nonobject metadata',{objects:[{user_metadata:'[1,2]'}]}],['unsupported original type',{catalog:c=>{c[3].columns.find(x=>x.name==='user_metadata').data_type='public.unit_domain';}}],
      ['missing original member',{catalog:c=>{c.splice(2,1);}}],['declared extra row',{catalog:c=>{c[3].row_count='2';}}],
      ['extra actual row',{catalog:c=>{c[3].row_count='0';}}],['wrong original identity',{manifests:m=>{m[0].id='22222222-2222-4222-8222-222222222222';m[0].database_row.id=m[0].id;}}],
      ['bad original byte digest',{manifests:m=>{m[0].sha256='0'.repeat(64);}}],['bad original byte count',{manifests:m=>{m[0].size_bytes++;}}],
      ['late byte hash failure',{objects:[{},{}],manifests:m=>{m[1].sha256='0'.repeat(64);}}],
      ['ambiguous manifest alias',{entries:e=>e.set('inventory/storage-objects.json',Buffer.from(e.get('inventory/storage-objects.json').toString().replace('"id":','"id":"foreign","\\u0069d":')))}],
      ['native array bounds not expressible by SDK',{bucket:{allowed_mime_types:'[0:1]={image/png,image/jpeg}'}}],
      ['SDK path normalization',{objects:[{name:'folder//UNIT.bin'}]}],
      ['unsupported legacy JSON lexical profile',{encoding:api.postgresJsonTextLineEncoding,userType:'json'}],
      ['explicit aggregate byte limit',{manifests:m=>{m[0].size_bytes=67108865;}}],
      ['malformed authenticated final row',{objects:[{},{}],entries:e=>{const name='database/storage.objects.jsonl';
        e.set(name,Buffer.from(e.get(name).toString().split('\n')[0]+'\nnot-json\n'));}}],
      ['duplicate decoded DATA column alias',{entries:e=>{const name='database/storage.objects.jsonl';
        const raw=wire.decodeProductionBackupTextColumnsDataRow(e.get(name).toString().trimEnd());
        e.set(name,Buffer.from(JSON.stringify(raw.replace('"id":','"id":"foreign","\\u0069d":'))+'\n'));}}],
    ])await run('archive',name,async()=>{const f=fixture(settings);await rejection(prepare(f));});
    await run('lifecycle','body mutation and closed or withdrawn holders cannot be reused',async()=>{
      for(const mode of ['body','withdraw','close']){const f=fixture(),holder=await prepare(f);
        if(mode==='body')holder.objects[0].body.set('metadata','{"wrong":true}');if(mode==='withdraw')f.archive.cleanup();if(mode==='close')holder.close();
        assert.throws(()=>holder.requireCurrent(),e=>e.code==='VERIFIED_STORAGE_UPLOAD_UNAVAILABLE');
        if(mode==='body')holder.objects[0].body.set('metadata',rawMetadata);
        assert.throws(()=>holder.requireCurrent(),e=>e.code==='VERIFIED_STORAGE_UPLOAD_UNAVAILABLE');holder.close();
      }
    });
    await run('lifecycle','same-byte new inode invalidates DATA and byte members',async()=>{
      for(const member of ['database/storage.objects.jsonl','inventory/storage-objects.json',storageObjectArchivePath('unit-bucket','folder/UNIT-0.bin')]){
        const f=fixture(),holder=await prepare(f),path=join(f.archive.directory,member),bytes=readFileSync(path);
        renameSync(path,path+'.retired');writeFileSync(path,bytes);assert.throws(()=>holder.requireCurrent(),e=>e.code==='VERIFIED_STORAGE_UPLOAD_UNAVAILABLE');
      }
    });
    await run('lifecycle','foreign public archive object never becomes an upload source',async()=>{
      const f=fixture();await rejection(prepareVerifiedStorageUploads({verifiedArchive:{...f.archive}}));
    });
    await run('lifecycle','withdrawal during the genuine asynchronous DATA loan refuses and closes all descriptors',async()=>{
      const f=fixture(),pending=prepare(f);f.archive.cleanup();await rejection(pending);noFds(f.archive);
    });
    await run('caller','real normal upload-loop prefix preflights before SDK effects and retains source on every await',async()=>{
      const source=readFileSync(new URL('./production-restore.mjs',import.meta.url),'utf8'),start=source.indexOf('    requireOriginalArchiveSource();\n    const preparedUploads = await prepareVerifiedStorageUploads('),end=source.indexOf('    const actualBuckets = await db.query(',start);
      assert.ok(start>0&&end>start);const fragment=source.slice(start,end),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
      const execute=new AsyncFunction('verifiedArchive','prepareVerifiedStorageUploads','requireOriginalArchiveSource','supabase','sha256Bytes',fragment);
      for(const mode of ['valid','late-invalid','withdraw-after-prepare','withdraw-after-upload','provider-failure']){
        const f=fixture(mode==='late-invalid'?{objects:[{}, {user_metadata:null}]}:{}),binding=api.readVerifiedArchiveSourceBinding(f.archive),calls=[];
        const client=transport(calls,async call=>{
          if(mode==='provider-failure')throw new Error('UNIT inert provider failure');
          if(call.body instanceof FormData){if(mode==='withdraw-after-upload')f.archive.cleanup();return new Response(JSON.stringify({Id:uuid,Key:'unit-bucket/folder/UNIT-0.bin'}),{headers:{'Content-Type':'application/json'}});}
          if(call.method==='GET')return new Response(f.entries.get(f.manifests[0].file));
          return new Response(JSON.stringify({name:'unit-bucket'}),{headers:{'Content-Type':'application/json'}});
        });
        const actualPrepare=async options=>{const holder=await prepareVerifiedStorageUploads(options);holders.push(holder);
          if(mode==='withdraw-after-prepare')f.archive.cleanup();return holder;};
        const current=()=>assert.equal(api.readVerifiedArchiveSourceBinding(f.archive),binding);
        const call=execute(f.archive,actualPrepare,current,{storage:client},hash);
        if(mode==='valid'){await call;assert.equal(calls.length,3);assert.equal(calls[1].body.get('metadata'),null,'Owner closes and clears its body after use');}
        else{await assert.rejects(call);if(['late-invalid','withdraw-after-prepare'].includes(mode))assert.equal(calls.length,0);
          if(mode==='withdraw-after-upload')assert.equal(calls.length,2);if(mode==='provider-failure')assert.equal(calls.length,1);}
        noFds(f.archive);
      }
    });
    console.log(JSON.stringify({selector:'--storage-original-upload-only',part:part||'all',count:cases.length,cases,
      status:'PASS_NEW_SOURCE_UNIT_ARCHIVE_AND_INSTALLED_SDK_TRANSPORT_ONLY',provider_network:0,SQL:0,native_SQL:'NOT_RUN',provider_metadata_semantics:'NOT_QUALIFIED',authority:false,old_groups_replayed:0,resources:0}));
  }finally{for(const holder of holders)holder.close();for(const archive of archives)archive.cleanup();rmSync(work,{recursive:true,force:true});}
  process.exit(0);
}

// NEW v2 caller/SQL-rendering components only. The extracted ports below are
// deliberately inert: no native session, signed Source, helper admission or
// PostgreSQL NULL/multiset execution is claimed by these recordings.
if (process.argv.includes("--storage-typed-text-comparison-only")) {
  const { Readable, Transform } = await import("node:stream");
  const { postgresJsonTextLineEncoding, postgresTextColumnsLineEncoding } = await import("./disaster-recovery-archive.mjs");
  const source = readFileSync(new URL("./disaster-recovery-storage.mjs", import.meta.url), "utf8");
  const begin = source.indexOf("export async function compareVerifiedStorageTableData(options) {");
  const end = source.indexOf("\nconst SYSTEM_BUCKET_FIELDS", begin);
  assert.ok(begin >= 0 && end > begin);
  const body = source.slice(begin, end);
  const compile = text => new Function("ports", `const {isProxy,stableJson,createHash,pipeline,Transform,StorageTableClient,storageTableQuery,
    storageScalarTypeOids,STORAGE_TABLE_PARAMETER_BYTES,STORAGE_TABLE_PARAMETER_ROWS,readVerifiedArchiveSourceBinding,
    readVerifiedRestoreTableSelection,openVerifiedRestoreTableData,decodeRestoreTableRowLine,
    createRestoreRowLineBatchDecoder,postgresJsonTextLineEncoding,postgresTextColumnsLineEncoding}=ports;
    ${text.replace("export async function", "async function")} return compareVerifiedStorageTableData;`);
  const sqlSource = readFileSync(new URL("../proposals/immutable-private-owner-context.sql", import.meta.url), "utf8");
  assert.equal(createHash("sha256").update(sqlSource).digest("hex"),
    "cdc59dcd238ec2eabf70cdec4e28b41c92c58b2570dc0abfa335704443b180d4");
  const sourceBody = name => {
    const signature = "CREATE FUNCTION custodial_dr." + name + "(";
    assert.equal(sqlSource.split(signature).length, 2);
    const a = sqlSource.indexOf("AS $fn$", sqlSource.indexOf(signature)) + "AS $fn$".length;
    const b = sqlSource.indexOf("$fn$;", a);
    assert.ok(a > 0 && b > a);
    return sqlSource.slice(a, b);
  };
  const helpers = [
    { oid: "1001", name: "immutable_import_text_projection", arguments: "2283", returns: "25", argument_names: ["original_record"] },
    { oid: "1002", name: "immutable_import_text_record", arguments: "2283 25", returns: "2283", argument_names: ["prototype", "original_row_utf8"] },
  ].map(value => ({ ...value, body: sourceBody(value.name), definition: "UNIT_RECORDING_DEFINITION_" + value.name,
    config: ["search_path=pg_catalog", "extra_float_digits=3", "datestyle=ISO, YMD", "timezone=UTC", "intervalstyle=postgres", "bytea_output=hex"],
    source_attributes: "true" }));
  for (const value of helpers) assert.ok(body.includes('"' + createHash("sha256").update(value.body).digest("hex") + '"'),
    "Compiled Source body recipe must match the pinned actual pure helper, including both body newlines");
  const compiled = compile(body);
  let cases = 2;
  const rawRows = [
    '{"id":"UNIT-recording.invalid","json_value":null,"jsonb_value":"null","exact":"9007199254740993.0000000000000000001","array":"[0:1]={NULL,\\\"NULL\\\"}","time":"2026-10-18 00:00:00.123456+00"}',
    '{"id":"UNIT-recording.invalid","json_value":"null","jsonb_value":null,"exact":"9007199254740993.0000000000000000001","array":"[0:1]={NULL,\\\"NULL\\\"}","time":"2026-10-18 00:00:00.123456+00"}',
  ];
  const names = ["id", "json_value", "jsonb_value", "exact", "array", "time"];
  const types = ["text", "json", "jsonb", "numeric", "text[]", "timestamp with time zone"];
  const select = rows => ({ command: "SELECT", rowCount: rows.length, rows });
  const clone = value => structuredClone(value);
  async function recording(settings = {}, callable = compiled) {
    const trace = { queries: [], helperReads: 0, catalogReads: 0, opens: 0, closes: 0, compares: 0, afterFailure: 0 };
    let withdrawn = false, failedNative = false;
    const originals = settings.originals ?? rawRows;
    const table = Object.freeze({ schema_name: "storage", table_name: settings.tableName ?? 'UNIT_recording"table',
      data_file: "database/storage.UNIT_recording.jsonl", data_encoding: settings.encoding ?? postgresTextColumnsLineEncoding,
      row_count: settings.rowCount ?? String(originals.length), primary_key: [],
      columns: names.map((name, i) => ({ name, data_type: types[i], generated: "", identity: "" })) });
    const wire = originals.map(raw => JSON.stringify(raw)).join("\n") + (originals.length ? "\n" : "");
    const binding = Object.freeze({ component_fixture_only: true });
    const selection = Object.freeze({ databaseTables: [table], storageTables: [table] });
    const originalContext = { database_oid: "42", backend_pid: "7", transaction_id: "12", snapshot: "12:13:",
      actor: "UNIT_RECORDING", session_actor: "UNIT_RECORDING", read_only: "on", isolation: "repeatable read",
      replication: "origin", row_security: "off", search_path: "pg_catalog, pg_temp", first_schema: "pg_catalog", timezone: "UTC",
      date_style: "ISO, MDY", interval_style: "postgres", float_digits: "3", bytea_output: "hex" };
    const catalog = names.map((name, i) => ({ relation_oid: "43", kind: "r", persistence: "p", is_partition: "false", inherited: "false",
      dropped: "false", rls_active: "false", ordinal: String(i + 1), name, generated: "", identity: "", data_type: types[i],
      primary_key: [], supported_type: "true" }));
    class RecordingClient {
      constructor() { Object.assign(this, { _connected: true, _ending: false, _ended: false, _queryable: true, _txStatus: "T" }); }
      async query(sql, values) {
        if (failedNative) trace.afterFailure++;
        trace.queries.push({ sql, values: clone(values) });
        if (sql.includes("transaction_read_only")) return select([{ ...originalContext,
          ...(settings.changedContext && trace.helperReads ? { transaction_id: "13" } : {}) }]);
        if (sql.includes("supported_type")) {
          trace.catalogReads++;
          return select(settings.catalogUnsupported ? [] : clone(catalog));
        }
        if (sql.includes("source_attributes")) {
          trace.helperReads++;
          if (settings.nativeHelperError) {
            failedNative = true;
            const error = new pg.DatabaseError("PRIVATE NATIVE SQL AND ROW", 0, "error"); error.code = "42501"; throw error;
          }
          if (settings.withdrawHelper === trace.helperReads) withdrawn = true;
          if (settings.replacePort && trace.helperReads === 1) this.query = () => { throw new Error("MUST NOT BE CALLED"); };
          let result = clone(helpers);
          if (settings.helperRows) result = settings.helperRows(result, trace.helperReads);
          return select(result);
        }
        assert.ok(sql.startsWith("with original_rows as materialized"));
        trace.compares++;
        if (settings.withdrawCompare) withdrawn = true;
        if (settings.nativeCompareError) {
          failedNative = true;
          const error = new pg.DatabaseError("PRIVATE COMPARE SQL AND ROW", 0, "error"); error.code = "55000"; throw error;
        }
        return select([settings.counts ?? { original_count: table.row_count, current_count: table.row_count, missing_count: "0", extra_count: "0" }]);
      }
    }
    const db = new RecordingClient();
    const fn = callable({ isProxy, stableJson, createHash, pipeline, Transform, StorageTableClient: RecordingClient,
      storageTableQuery: RecordingClient.prototype.query, storageScalarTypeOids: ["25", "114", "3802", "1700", "1184"],
      STORAGE_TABLE_PARAMETER_BYTES: 16 * 1024 * 1024, STORAGE_TABLE_PARAMETER_ROWS: 65536,
      readVerifiedArchiveSourceBinding: () => { if (withdrawn) throw new Error("PRIVATE SOURCE WITHDRAWN"); return binding; },
      readVerifiedRestoreTableSelection: () => selection,
      openVerifiedRestoreTableData: () => {
        trace.opens++;
        const verified = settings.eofFailure ? Promise.reject(new Error("PRIVATE HASH/EOF FAILURE"))
          : Promise.resolve({ data_file: settings.foreignEof ? "foreign" : table.data_file, bytes: Buffer.byteLength(wire), sha256: "a".repeat(64) });
        verified.catch(() => {});
        return { table, stream: Readable.from([settings.invalidUtf8 ? Buffer.from([255]) : Buffer.from(wire)]), verified,
          close: async () => { trace.closes++; if (settings.closeFailure) throw new Error("PRIVATE CLOSE FAILURE"); } };
      }, decodeRestoreTableRowLine, createRestoreRowLineBatchDecoder, postgresJsonTextLineEncoding, postgresTextColumnsLineEncoding });
    let value, error;
    try { value = await fn({ db, verifiedArchive: {} }); } catch (caught) { error = caught; }
    assert.equal(trace.closes, trace.opens, "Every owned row loan closes exactly once even on refusal");
    assert.equal(trace.afterFailure, 0, "No later own SQL after first native error");
    return { value, error, trace };
  }
  const success = async (settings = {}) => {
    const result = await recording(settings);
    assert.equal(result.error, undefined);
    assert.ok(Object.isFrozen(result.value) && Object.isFrozen(result.value.tables) && Object.isFrozen(result.value.tables[0]));
    assert.equal(result.value.status, settings.counts ? "DIFFERENT" : "MATCH");
    assert.deepEqual(Object.keys(result.value).sort(), ["sourceBinding", "status", "tables"]);
    assert.equal(result.trace.compares, 1); assert.equal(result.trace.helperReads, 4); cases++;
    return result;
  };
  const refuse = async (settings, phase = "TEXT_HELPER_SOURCE", code) => {
    const result = await recording(settings);
    assert.equal(result.value, undefined); assert.ok(result.error instanceof Error);
    assert.equal(result.error.code, "VERIFIED_STORAGE_TABLE_COMPARISON_UNAVAILABLE");
    assert.equal(result.error.storage_check_phase, phase); assert.equal(result.error.sql_state, code);
    assert.equal(result.error.outcome, "UNKNOWN"); assert.equal(result.error.retry_safe, false);
    assert.doesNotMatch(JSON.stringify(result.error) + result.error.stack, /PRIVATE|9007199254740993|unit_recording|DECLARE/);
    assert.equal(Object.hasOwn(result.error, "cause"), false); cases++;
    return result;
  };
  // This narrow mode covers the genuinely affected older function-source
  // port contract without executing any older selected group's body.
  if (process.argv.includes("--v1-component-port-only")) {
    const legacyPorts = new Function("ports", `const {isProxy,stableJson,pipeline,Transform,StorageTableClient,storageTableQuery,
      storageScalarTypeOids,STORAGE_TABLE_PARAMETER_BYTES,STORAGE_TABLE_PARAMETER_ROWS,readVerifiedArchiveSourceBinding,
      readVerifiedRestoreTableSelection,openVerifiedRestoreTableData,decodeRestoreTableRowLine,
      createRestoreRowLineBatchDecoder,postgresJsonTextLineEncoding}=ports;
      ${body.replace("export async function", "async function")} return compareVerifiedStorageTableData;`);
    const result = await recording({ encoding: postgresJsonTextLineEncoding }, legacyPorts);
    assert.equal(result.error, undefined, "The unchanged old v1 component port need not bind the new v2 constant");
    assert.equal(result.value.status, "MATCH"); assert.equal(result.trace.helperReads, 0); assert.equal(result.trace.compares, 1);
    console.log(JSON.stringify({ selector: "storage-typed-text-comparison-only/v1-component-port-only", cases: 1,
      source_component_only: true, native_SQL: "NOT_RUN", connections: 0, signatures: 0, provider_calls: 0 }));
    process.exit(0);
  }
  const matched = await success();
  const compared = matched.trace.queries.find(query => query.sql.startsWith("with original_rows"));
  assert.deepEqual(compared.values, [rawRows]);
  assert.notEqual(compared.values[0][0], compared.values[0][1], "SQL NULL vs JSON-null text remain distinct original parameters"); cases++;
  assert.match(compared.sql, /immutable_import_text_record\(null::"storage"\."UNIT_recording""table",s\.raw\) r/);
  assert.equal((compared.sql.match(/except all/g) ?? []).length, 2);
  assert.match(compared.sql, /immutable_import_text_projection\(r\)/);
  assert.match(compared.sql, /immutable_import_text_projection\(t\)/);
  assert.doesNotMatch(compared.sql, /json_populate_record|row_to_json|immutable_import_decode_record|immutable_import_row_projection/);
  assert.doesNotMatch(compared.sql, /9007199254740993|2026-10-18|BEGIN|COMMIT|SET |INSERT|UPDATE|DELETE/); cases++;
  // The actual catalog query's predicates, not a caller flag, implement these
  // admission refusals. SQL execution of those predicates remains Main-owned.
  const helperQuery = matched.trace.queries.find(query => query.sql.includes("source_attributes"));
  assert.deepEqual(helperQuery.values, []);
  for (const required of ["p.proowner=", "c.relname='restore_control'", "c.relname='immutable_private_import_context'",
    "l.lanname='plpgsql'", "not p.prosecdef", "p.proparallel='u'", "p.proargdefaults is null", "p.prosqlbody is null",
    "a.grantee<>p.proowner", "a.grantor<>p.proowner", "a.privilege_type<>'EXECUTE'", "a.is_grantable", "current_user=session_user",
    "r.rolname='postgres'", "d.datdba", "p.procost=100", "p.prosupport=0", "p.provariadic=0"]) assert.ok(helperQuery.sql.includes(required), required);
  cases++;
  await success({ originals: [rawRows[0], rawRows[0]] }); // Retained duplicate parameters, not Set semantics.
  await success({ originals: [] }); // No zero-row waiver of helper/catalog/EOF checks.
  await success({ counts: { original_count: "2", current_count: "2", missing_count: "1", extra_count: "1" } });
  await success({ helperRows: rows => rows.map(row => ({ ...row, config: row.config.map(option =>
    option.replace(/^datestyle=/, "DateStyle=").replace(/^timezone=/, "TimeZone=").replace(/^intervalstyle=/, "IntervalStyle=")) })) });
  for (const change of [
    rows => [], rows => rows.slice(0, 1), rows => [...rows, clone(rows[1])], rows => rows.reverse(),
    rows => { rows[0].name = "foreign"; return rows; },
    rows => { rows[0].oid = "01"; return rows; }, rows => { rows[0].oid = "4294967296"; return rows; },
    rows => { rows[1].oid = rows[0].oid; return rows; }, rows => { rows[0].oid = 1001; return rows; },
    rows => { rows[0].body += "\n"; return rows; }, rows => { rows[0].body = null; return rows; },
    rows => { rows[0].source_attributes = "false"; return rows; }, rows => { rows[0].source_attributes = null; return rows; },
    rows => { rows[0].arguments = "25"; return rows; }, rows => { rows[0].returns = "114"; return rows; },
    rows => { rows[0].argument_names = ["caller_record"]; return rows; },
    rows => { rows[0].config[1] = "extra_float_digits=1"; return rows; },
    rows => { rows[0].config[2] = "datestyle=ISO, MDY"; return rows; },
    rows => { rows[0].config.push("role=postgres"); return rows; },
    rows => { rows[0].config.reverse(); return rows; },
    rows => { rows[0].config[0] = "search_path=pg_catalog, public"; return rows; },
    rows => { rows[0].config[3] = "timezone=UTC "; return rows; },
    rows => { rows[0].definition = ""; return rows; },
    rows => { rows[0].unrecognized = true; return rows; },
  ]) {
    const result = await refuse({ helperRows: change });
    assert.equal(result.trace.opens, 0); assert.equal(result.trace.compares, 0);
  }
  let reads = 0;
  const accessorRows = rows => { Object.defineProperty(rows[0], "body", { get() { reads++; throw new Error("PRIVATE ACCESSOR"); }, enumerable: true }); return rows; };
  await refuse({ helperRows: accessorRows });
  await refuse({ helperRows: rows => { rows[0].config = new Proxy([], { get() { reads++; throw new Error("PRIVATE PROXY"); } }); return rows; } });
  assert.equal(reads, 0); cases++;
  for (const after of [2, 3, 4]) {
    const result = await refuse({ helperRows: (rows, n) => { if (n >= after) rows[0].oid = "2001"; return rows; } });
    assert.equal(result.trace.opens, 1); assert.equal(result.trace.compares, after === 2 ? 0 : 1);
  }
  await refuse({ helperRows: (rows, n) => { if (n === 2) rows[0].definition += "_CHANGED"; return rows; } });
  await refuse({ withdrawHelper: 1 }, "SOURCE");
  await refuse({ withdrawCompare: true }, "SOURCE");
  await refuse({ replacePort: true }, "NATIVE_PORT");
  await refuse({ changedContext: true }, "CONTEXT");
  await refuse({ nativeHelperError: true }, "TEXT_HELPER_SOURCE", "42501");
  await refuse({ nativeCompareError: true }, "COMPARE", "55000");
  await refuse({ eofFailure: true, closeFailure: true }, "ORIGINAL_DATA");
  await refuse({ foreignEof: true }, "ORIGINAL_DATA");
  await refuse({ closeFailure: true }, "ORIGINAL_DATA");
  await refuse({ invalidUtf8: true }, "ORIGINAL_DATA");
  for (const raw of [rawRows[0].replace('"json_value":null', '"json_value":123'),
    rawRows[0].replace('"json_value":null', '"json_value":{}'), rawRows[0].replace('"json_value":null', '"json_value":[]'),
    rawRows[0].replace('"json_value":null', '"json_value":true'), rawRows[0].replace('"id":', '"id":"extra","\\u0069d":'),
    rawRows[0].replace('"id":', '"foreign":'), rawRows[0].replace('"id":', '"added":null,"id":'),
    rawRows[0].replace("UNIT-recording.invalid", "\\ud800")]) {
    const result = await refuse({ originals: [raw] }, "ORIGINAL_DATA"); assert.equal(result.trace.compares, 0);
  }
  await refuse({ counts: { original_count: "2", current_count: "1", missing_count: "0", extra_count: "0" } }, "RESULT");
  for (const settings of [{ rowCount: "65537" }, { encoding: "unrecognized" }, { catalogUnsupported: true }]) {
    const result = await recording(settings); assert.equal(result.error, undefined); assert.equal(result.value.status, "UNSUPPORTED");
    assert.equal(result.trace.opens, 0); assert.equal(result.trace.compares, 0); assert.equal(result.trace.helperReads, 0); cases++;
  }
  await assert.rejects(compareVerifiedStorageTableData({ db: new pg.Client(), verifiedArchive: {} }),
    error => error.code === "VERIFIED_STORAGE_TABLE_COMPARISON_UNAVAILABLE" && error.storage_check_phase === "NATIVE_PORT"); cases++;
  assert.throws(() => readVerifiedArchiveSourceBinding({})); cases++;
  // Optional immutable predecessor loan is only used for this NEW changed
  // routing/regression comparison. It is never Source or admission authority.
  const predecessorPath = process.env.STORAGE_TYPED_TEXT_PREDECESSOR;
  let predecessorCounterexample = "NOT_RUN", v1QueryUnchanged = "NOT_RUN";
  if (predecessorPath) {
    const before = readFileSync(predecessorPath, "utf8");
    assert.equal(createHash("sha256").update(before).digest("hex"),
      "b69131e3a41e33579e4e0fb350d034f558540ea543de312b952230703c462b80");
    const a = before.indexOf("export async function compareVerifiedStorageTableData(options) {");
    const b = before.indexOf("\nconst SYSTEM_BUCKET_FIELDS", a);
    const beforeCompiled = compile(before.slice(a, b));
    const old = await recording({}, beforeCompiled);
    assert.equal(old.error, undefined); assert.equal(old.value.status, "UNSUPPORTED");
    assert.equal(old.value.tables[0].reason, "ORIGINAL_POSTGRES_TEXT_ENCODING_REQUIRED");
    assert.equal(old.trace.opens, 0); predecessorCounterexample = "V2_REJECTED_BEFORE_ROW_READER"; cases++;
    const oldV1 = await recording({ encoding: postgresJsonTextLineEncoding }, beforeCompiled);
    const newV1 = await recording({ encoding: postgresJsonTextLineEncoding });
    assert.equal(oldV1.error, undefined); assert.equal(newV1.error, undefined);
    assert.deepEqual(newV1.value, oldV1.value); assert.deepEqual(newV1.trace, oldV1.trace);
    v1QueryUnchanged = true; cases++;
    assert.equal(source.slice(source.indexOf("\nconst SYSTEM_BUCKET_FIELDS")), before.slice(before.indexOf("\nconst SYSTEM_BUCKET_FIELDS")),
      "Every existing provider/byte/state function remains byte-identical"); cases++;
  }
  console.log(JSON.stringify({ selector: "storage-typed-text-comparison-only", cases, predecessorCounterexample, v1QueryUnchanged,
    source_component_only: true, actual_helper_source_pin: "cdc59dcd238ec2eabf70cdec4e28b41c92c58b2570dc0abfa335704443b180d4",
    native_SQL: "NOT_RUN", signatures: 0, connections: 0, provider_calls: 0 }));
  process.exit(0);
}

// NEW predicate-equivalence and redaction recordings only. These ports are
// inert DATA, not a genuine native session, observed settings or archive.
if (process.argv.includes("--storage-context-first-constraint-only")) {
  const { Transform } = await import("node:stream");
  const source = readFileSync(new URL("./disaster-recovery-storage.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export async function compareVerifiedStorageTableData(options) {");
  const end = source.indexOf("\nconst SYSTEM_BUCKET_FIELDS", start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end).replace("export async function", "async function");
  // Exact predecessor compound predicate, not a relaxed reference policy.
  const predecessorPredicate = String.raw`    if (contextKeys.some(key => typeof value[key] !== "string") || value.read_only !== "on"
        || !["repeatable read", "serializable"].includes(value.isolation) || value.replication !== "origin"
        || value.first_schema !== "pg_catalog" || !["1", "2", "3"].includes(value.float_digits)
        || !/^[1-9][0-9]{0,9}(?![\s\S])/.test(value.database_oid) || BigInt(value.database_oid) > 4294967295n
        || !/^[1-9][0-9]{0,9}(?![\s\S])/.test(value.backend_pid) || BigInt(value.backend_pid) > 2147483647n
        || !/^[1-9][0-9]{0,19}(?![\s\S])/.test(value.transaction_id)
        || BigInt(value.transaction_id) > 18446744073709551615n || !value.snapshot || !value.actor || !value.session_actor) unavailable();`;
  const predicateStart = body.indexOf('\n', body.indexOf('const value = closed(values[0], contextKeys);')) + 1;
  const predicateEnd = body.indexOf('\n    const encoded = stableJson(value);', predicateStart);
  assert.ok(predicateStart > 0 && predicateEnd > predicateStart);
  const referenceBody = body.slice(0, predicateStart) + predecessorPredicate + body.slice(predicateEnd);
  const compile = text => new Function("ports", `const {isProxy,stableJson,pipeline,Transform,StorageTableClient,storageTableQuery,
    storageScalarTypeOids,STORAGE_TABLE_PARAMETER_BYTES,STORAGE_TABLE_PARAMETER_ROWS,readVerifiedArchiveSourceBinding,
    readVerifiedRestoreTableSelection,openVerifiedRestoreTableData,decodeRestoreTableRowLine,
    createRestoreRowLineBatchDecoder,postgresJsonTextLineEncoding}=ports;
    ${text} return compareVerifiedStorageTableData;`);
  const subject = compile(body), reference = compile(referenceBody);
  const original = Object.freeze({ database_oid: "42", backend_pid: "7", transaction_id: "12", snapshot: "12:13:",
    actor: "UNIT_RECORDING", session_actor: "UNIT_RECORDING", read_only: "on", isolation: "repeatable read",
    replication: "origin", row_security: "on", search_path: "pg_catalog", first_schema: "pg_catalog", timezone: "UTC",
    date_style: "ISO, MDY", interval_style: "postgres", float_digits: "1", bytea_output: "hex" });
  async function record(factory, values, sqlError) {
    let calls = 0;
    class RecordingClient {
      constructor() { Object.assign(this, { _connected: true, _ending: false, _ended: false, _queryable: true, _txStatus: "T" }); }
      async query(sql) {
        assert.ok(sql.includes("transaction_read_only"));
        calls++;
        if (sqlError) throw sqlError;
        return { command: "SELECT", rowCount: 1, rows: [values[Math.min(calls - 1, values.length - 1)]] };
      }
    }
    const binding = Object.freeze({ recording_only: true });
    const selection = Object.freeze({ databaseTables: [], storageTables: [] });
    const fn = factory({ isProxy, stableJson, pipeline, Transform, StorageTableClient: RecordingClient,
      storageTableQuery: RecordingClient.prototype.query, storageScalarTypeOids: ["25"],
      STORAGE_TABLE_PARAMETER_BYTES: 16 * 1024 * 1024, STORAGE_TABLE_PARAMETER_ROWS: 65536,
      readVerifiedArchiveSourceBinding: () => binding, readVerifiedRestoreTableSelection: () => selection,
      openVerifiedRestoreTableData: () => assert.fail("No table reader in predicate-only recording"),
      decodeRestoreTableRowLine, createRestoreRowLineBatchDecoder, postgresJsonTextLineEncoding: "postgres-json-text-line.v1" });
    try { return { value: await fn({ db: new RecordingClient(), verifiedArchive: {} }), calls }; }
    catch (error) { return { error, calls }; }
  }
  let equivalenceCases = 0, refusals = 0;
  const allowed = ["TEXT_FIELDS", "READ_ONLY", "ISOLATION", "REPLICATION", "FIRST_SCHEMA", "FLOAT_DIGITS",
    "DATABASE_OID", "BACKEND_PID", "TRANSACTION_ID", "SNAPSHOT", "PRINCIPAL", "SAME_CONTEXT"];
  async function check(values, expected, phase = "CONTEXT") {
    const actual = await record(subject, values), prior = await record(reference, values);
    assert.equal(Boolean(actual.error), Boolean(prior.error), "Exact predecessor boolean decision");
    assert.equal(actual.calls, prior.calls, "No changed await/query count");
    if (expected) {
      assert.ok(actual.error); assert.equal(actual.error.storage_context_check, expected);
      assert.equal(actual.error.storage_check_phase, phase); assert.equal(actual.error.sql_state, undefined);
      assert.equal(actual.error.code, "VERIFIED_STORAGE_TABLE_COMPARISON_UNAVAILABLE");
      assert.equal(actual.error.outcome, "UNKNOWN"); assert.equal(actual.error.retry_safe, false);
      assert.ok(allowed.includes(actual.error.storage_context_check)); assert.ok(Object.isFrozen(actual.error));
      assert.deepEqual(Reflect.ownKeys(actual.error).sort(), ["stack", "message", "code", "storage_check_phase",
        "storage_context_check", "outcome", "retry_safe"].sort());
      assert.doesNotMatch(JSON.stringify(actual.error), /UNIT_RECORDING|PRIVATE|12:13:|current_setting|UTC/);
      refusals++;
    } else {
      assert.equal(actual.error, undefined); assert.deepEqual(actual.value, prior.value);
      assert.deepEqual(Object.keys(actual.value).sort(), ["sourceBinding", "status", "tables"]);
    }
    equivalenceCases++;
  }
  // This first case demonstrates the predecessor's absent constraint label.
  await check([{ ...original, read_only: "off" }], "READ_ONLY");
  for (const key of Object.keys(original)) for (const value of [undefined, null, false, 0, {}, []]) {
    await check([{ ...original, [key]: value }], "TEXT_FIELDS");
  }
  const invalid = {
    read_only: ["", "ON", "off"], isolation: ["", "read committed", "REPEATABLE READ"], replication: ["", "replica", "local"],
    first_schema: ["", "pg_temp_1", "public"], float_digits: ["", "0", "4", "01", "3\n"],
    database_oid: ["", "0", "01", "-1", "1.0", "42\n", "4294967296", "99999999999"],
    backend_pid: ["", "0", "01", "-1", "7\n", "2147483648", "99999999999"],
    transaction_id: ["", "0", "01", "-1", "12\n", "18446744073709551616", "999999999999999999999"],
    snapshot: [""], actor: [""], session_actor: [""] };
  const label = { read_only: "READ_ONLY", isolation: "ISOLATION", replication: "REPLICATION", first_schema: "FIRST_SCHEMA",
    float_digits: "FLOAT_DIGITS", database_oid: "DATABASE_OID", backend_pid: "BACKEND_PID", transaction_id: "TRANSACTION_ID",
    snapshot: "SNAPSHOT", actor: "PRINCIPAL", session_actor: "PRINCIPAL" };
  for (const [key, values] of Object.entries(invalid)) for (const value of values) await check([{ ...original, [key]: value }], label[key]);
  // All pairs retain predecessor order: a later invalid text type still wins
  // TEXT_FIELDS, while later valid-text constraints cannot displace an earlier.
  const keys = Object.keys(invalid);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    await check([{ ...original, [keys[i]]: invalid[keys[i]][0], [keys[j]]: invalid[keys[j]][0] }], label[keys[i]]);
  }
  for (const isolation of ["repeatable read", "serializable"]) for (const digits of ["1", "2", "3"]) {
    await check([{ ...original, isolation, float_digits: digits, database_oid: "4294967295", backend_pid: "2147483647",
      transaction_id: "18446744073709551615" }]);
  }
  // No new content policy is invented for otherwise unconstrained text.
  await check([{ ...original, snapshot: " ", actor: " ", session_actor: " ", row_security: "recording-only", search_path: "recording-only" }]);
  for (const [key, value] of Object.entries({ database_oid: "43", backend_pid: "8", transaction_id: "13", snapshot: "13:14:",
    actor: "DIFFERENT_RECORDING", session_actor: "DIFFERENT_RECORDING", isolation: "serializable", float_digits: "2",
    row_security: "off", search_path: "pg_catalog, pg_temp", timezone: "OTHER_RECORDING", date_style: "OTHER_RECORDING",
    interval_style: "OTHER_RECORDING", bytea_output: "OTHER_RECORDING" })) {
    await check([original, { ...original, [key]: value }], "SAME_CONTEXT", "FINAL_CONTEXT");
  }
  await check([original, { ...original, read_only: "off" }], "READ_ONLY", "FINAL_CONTEXT");
  const nativeFailure = Object.assign(new Error("PRIVATE DRIVER"), { code: "42501", storage_context_check: "PRINCIPAL" });
  const nativeResult = await record(subject, [original], nativeFailure);
  assert.equal(nativeResult.error.sql_state, "42501"); assert.equal(nativeResult.error.storage_check_phase, "CONTEXT");
  assert.ok(!Object.hasOwn(nativeResult.error, "storage_context_check"), "No label is invented for a failed query");
  assert.equal(nativeResult.calls, 1);
  console.log(JSON.stringify({ selector: "storage-context-first-constraint-only", equivalenceCases, refusals,
    native_error_spoof_controls: 1, sql: "NOT_RUN", connections: 0, recording_only: true }));
  process.exit(0);
}

// NEW Source-recording controls only: no native connection, SQL, signed
// archive, owner/currentness admission or positive Storage runtime claim.
if (process.argv.includes("--storage-first-native-refusal-only")) {
  const { Readable, Transform } = await import("node:stream");
  const source = readFileSync(new URL("./disaster-recovery-storage.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export async function compareVerifiedStorageTableData(options) {");
  const end = source.indexOf("\nconst SYSTEM_BUCKET_FIELDS", start);
  assert.ok(start >= 0 && end > start);
  const compile = new Function("ports", `const {isProxy,stableJson,pipeline,Transform,StorageTableClient,storageTableQuery,
    storageScalarTypeOids,STORAGE_TABLE_PARAMETER_BYTES,STORAGE_TABLE_PARAMETER_ROWS,readVerifiedArchiveSourceBinding,
    readVerifiedRestoreTableSelection,openVerifiedRestoreTableData,decodeRestoreTableRowLine,
    createRestoreRowLineBatchDecoder,postgresJsonTextLineEncoding}=ports;
    ${source.slice(start, end).replace("export async function", "async function")}
    return compareVerifiedStorageTableData;`);
  const sqlError = code => {
    const error = new pg.DatabaseError("PRIVATE DRIVER TEXT MUST NOT ESCAPE", 0, "error");
    error.code = code; error.detail = "PRIVATE ROW MUST NOT ESCAPE"; error.query = "PRIVATE SQL MUST NOT ESCAPE";
    return error;
  };
  let controls = 0;
  async function recording(mode, thrown = sqlError("42501")) {
    const trace = { queries: 0, opens: 0, closes: 0, afterFailure: 0, failed: false, catalog: 0, final: 0 };
    const original = '{"id":"UNIT-recording.invalid"}';
    const wire = JSON.stringify(original) + "\n";
    const table = { schema_name: "storage", table_name: "unit_recording_only", data_file: "database/storage.unit_recording_only.jsonl",
      row_count: "1", data_encoding: "postgres-json-text-line.v1", primary_key: [],
      columns: [{ name: "id", data_type: "text", generated: "", identity: "" }] };
    const binding = Object.freeze({ recording_only: true });
    const selection = Object.freeze({ databaseTables: [table], storageTables: [table] });
    const context = { database_oid: "42", backend_pid: "7", transaction_id: "12", snapshot: "12:13:",
      actor: "UNIT_RECORDING", session_actor: "UNIT_RECORDING", read_only: "on", isolation: "repeatable read",
      replication: "origin", row_security: "on", search_path: "pg_catalog", first_schema: "pg_catalog", timezone: "UTC",
      date_style: "ISO, MDY", interval_style: "postgres", float_digits: "1", bytea_output: "hex" };
    const catalog = { relation_oid: "43", kind: "r", persistence: "p", is_partition: "false", inherited: "false",
      dropped: "false", rls_active: "false", ordinal: "1", name: "id", generated: "", identity: "", data_type: "text",
      primary_key: [], supported_type: "true" };
    const result = rows => ({ command: "SELECT", rowCount: rows.length, rows });
    const fail = () => { trace.failed = true; throw thrown; };
    class RecordingClient {
      constructor() { Object.assign(this, { _connected: true, _ending: false, _ended: false, _queryable: true, _txStatus: "T" }); }
      async query(sql) {
        trace.queries++; if (trace.failed) trace.afterFailure++;
        if (sql.includes("transaction_read_only")) {
          if (mode === "native-context" || (mode === "native-loan-cleanup" && trace.opens)) fail();
          if (trace.catalog === 2 && ++trace.final === 2 && mode === "native-final") fail();
          return result([{ ...context, ...(mode === "context-shape" ? { read_only: "off" } : {}) }]);
        }
        if (sql.includes("supported_type")) {
          if (mode === "native-catalog") fail();
          trace.catalog++;
          return result([{ ...catalog, ...(mode === "catalog-shape" ? { extra: "refused" } : {}) }]);
        }
        assert.ok(sql.includes("with original_rows"));
        if (mode === "native-compare") fail();
        return result([{ original_count: "1", current_count: mode === "result-shape" ? "bad" : "1", missing_count: "0", extra_count: "0" }]);
      }
    }
    const db = new RecordingClient();
    if (mode === "native-port") db._txStatus = "I";
    const fn = compile({ isProxy, stableJson, pipeline, Transform, StorageTableClient: RecordingClient,
      storageTableQuery: RecordingClient.prototype.query, storageScalarTypeOids: ["25"],
      STORAGE_TABLE_PARAMETER_BYTES: 16 * 1024 * 1024, STORAGE_TABLE_PARAMETER_ROWS: 65536,
      readVerifiedArchiveSourceBinding: () => { if (mode === "source-code-spoof") throw thrown; return binding; },
      readVerifiedRestoreTableSelection: () => selection,
      openVerifiedRestoreTableData: () => {
        trace.opens++;
        return { table, stream: Readable.from([Buffer.from(mode === "data-utf8" ? [0xff] : wire)]),
          verified: Promise.resolve({ data_file: table.data_file, bytes: Buffer.byteLength(wire), sha256: createHash("sha256").update(wire).digest("hex") }),
          close: async () => { trace.closes++; if (mode === "native-loan-cleanup" || mode === "data-close-code-spoof") throw sqlError("XX000"); } };
      }, decodeRestoreTableRowLine, createRestoreRowLineBatchDecoder, postgresJsonTextLineEncoding: "postgres-json-text-line.v1" });
    let error, value;
    try { value = await fn(mode === "input" ? {} : { db, verifiedArchive: {} }); } catch (caught) { error = caught; }
    assert.equal(trace.closes, trace.opens, "Every opened recording loan is closed");
    assert.equal(trace.afterFailure, 0, "No subsequent native call after first native failure");
    return { error, value, trace };
  }
  async function refusal(mode, phase, code, thrown) {
    const { error, value, trace } = await recording(mode, thrown);
    assert.equal(value, undefined); assert.ok(error instanceof Error);
    assert.equal(error.code, "VERIFIED_STORAGE_TABLE_COMPARISON_UNAVAILABLE");
    assert.equal(error.storage_check_phase, phase); assert.equal(error.sql_state, code);
    assert.equal(error.outcome, "UNKNOWN"); assert.equal(error.retry_safe, false); assert.ok(Object.isFrozen(error));
    assert.equal(error.message, "Verified original Storage table comparison is unavailable.");
    assert.deepEqual(Reflect.ownKeys(error).sort(), ["stack", "message", "code", "storage_check_phase", "outcome", "retry_safe",
      ...(mode === "context-shape" ? ["storage_context_check"] : []),
      ...(code === undefined ? [] : ["sql_state"])].sort());
    if (mode === "context-shape") assert.equal(error.storage_context_check, "READ_ONLY");
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /PRIVATE (?:DRIVER|ROW|SQL)/);
    if (["input", "native-port", "source-code-spoof"].includes(mode)) assert.equal(trace.queries, 0);
    controls++; return trace;
  }
  await refusal("input", "INPUT");
  await refusal("native-port", "NATIVE_PORT");
  await refusal("source-code-spoof", "SOURCE");
  await refusal("context-shape", "CONTEXT");
  await refusal("catalog-shape", "CATALOG");
  await refusal("data-utf8", "ORIGINAL_DATA");
  await refusal("data-close-code-spoof", "ORIGINAL_DATA");
  await refusal("native-context", "CONTEXT", "42501");
  await refusal("native-catalog", "CATALOG", "42501");
  await refusal("native-compare", "COMPARE", "42501");
  await refusal("native-final", "FINAL_CONTEXT", "42501");
  await refusal("result-shape", "RESULT");
  const cleaned = await refusal("native-loan-cleanup", "CONTEXT", "42501");
  assert.equal(cleaned.closes, 1, "Cleanup error cannot replace original SQLSTATE/phase");
  let getterReads = 0;
  const accessor = Object.defineProperty(new Error("PRIVATE DRIVER TEXT"), "code", { get() { getterReads++; return "42501"; } });
  const inherited = Object.create({ code: "42501" });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("Proxy must not be inspected"); } });
  for (const error of [accessor, inherited, proxy, sqlError("bad01"), sqlError("425010"), sqlError(42501), null]) {
    await refusal("native-context", "CONTEXT", undefined, error);
  }
  assert.equal(getterReads, 0);
  // Real module + real unconnected native pg.Client refuses without calling
  // connect/query; this is a negative port check, not a native-positive mock.
  await assert.rejects(compareVerifiedStorageTableData({ db: new pg.Client(), verifiedArchive: {} }),
    error => error.code === "VERIFIED_STORAGE_TABLE_COMPARISON_UNAVAILABLE" && error.storage_check_phase === "NATIVE_PORT" && !Object.hasOwn(error, "sql_state"));
  controls++;
  console.log(JSON.stringify({ selector: "storage-first-native-refusal-only", controls, source_recording_only: true,
    sql: "NOT_RUN", connections: 0, signing: false }));
  process.exit(0);
}

// New disposable public-UNIT input only. It asserts no production provenance,
// original app Source installation, owner admission, restore or COMMIT right.
const owningUnitColumns = Object.freeze([
  ["case_key", "text"], ["exact_integer", "bigint"], ["exact_number", "numeric"],
  ["json_original", "json"], ["jsonb_original", "jsonb"],
  ["local_time", "timestamp without time zone"], ["instant_time", "timestamp with time zone"], ["original_label", "text"],
].map(([name, data_type]) => Object.freeze({ name, generated: "", identity: "", data_type })));
const owningUnitRowA = '{"case_key":"UNIT-A.invalid","exact_integer":9007199254740993,"exact_number":9007199254740993.123456789012345678901,"json_original":{"large":9007199254740993,"fraction":0.123456789012345678901},"jsonb_original":{"large":9007199254740993,"fraction":0.123456789012345678901},"local_time":"2026-10-17T12:34:56.123456","instant_time":"2026-10-17T12:34:56.654321+00:00","original_label":"UNIT-exact-original.invalid"}';
const owningUnitRowB = '{"case_key":"UNIT-B.invalid","exact_integer":9223372036854775806,"exact_number":-0.000000000000000000123456789,"json_original":{"large":9007199254740995,"fraction":-0.000000000000000000123456789},"jsonb_original":{"large":9007199254740995,"fraction":-0.000000000000000000123456789},"local_time":"2026-10-17T01:02:03.000001","instant_time":"2026-10-17T01:02:03.999999+00:00","original_label":"UNIT-B.invalid"}';
const owningUnitTable = Object.freeze({ schema_name: "storage", table_name: "unit_storage_original_exact_v1",
  data_file: "database/storage.unit_storage_original_exact_v1.jsonl", row_count: "3", primary_key: Object.freeze([]),
  columns: owningUnitColumns, data_encoding: "postgres-json-text-line.v1" });
const owningTextUnitInput = Object.freeze({
  fixture_id: "UNIT-storage-native-text-original-20261018-v2", project_ref: "unitstoragefixture02",
  public_unit_key: "UNIT-only-immutable-archive-verification-key-20261016", key_id: "unit-immutable-archive-v1",
  source_uri: "https://unit-storage-v2-original.invalid",
  table: Object.freeze({schema_name:"storage",table_name:"unit_storage_original_exact_v2",
    data_file:"database/storage.unit_storage_original_exact_v2.jsonl",row_count:"5",primary_key:Object.freeze([]),
    columns:owningUnitColumns,data_encoding:"postgres-text-columns-line.v2"}),
  create_sql: "create table storage.unit_storage_original_exact_v2 (case_key text,exact_integer bigint,exact_number numeric,json_original json,jsonb_original jsonb,local_time timestamp without time zone,instant_time timestamp with time zone,original_label text)",
  seed_sql: "insert into storage.unit_storage_original_exact_v2 values($1::text,$2::bigint,$3::numeric,$4::json,$5::jsonb,$6::timestamp,$7::timestamptz,$8::text)",
  seed_rows: Object.freeze([["UNIT-A.invalid","9007199254740993","9007199254740993.123456789012345678901"," { \"large\":9007199254740993, \"fraction\":0.123456789012345678901, \"dup\":1, \"dup\":2 } ","{\"large\":9007199254740993,\"fraction\":0.123456789012345678901}","2026-10-17T12:34:56.123456","2026-10-17T12:34:56.654321+00:00","UNIT-exact-original.invalid"],["UNIT-A.invalid","9007199254740993","9007199254740993.123456789012345678901"," { \"large\":9007199254740993, \"fraction\":0.123456789012345678901, \"dup\":1, \"dup\":2 } ","{\"large\":9007199254740993,\"fraction\":0.123456789012345678901}","2026-10-17T12:34:56.123456","2026-10-17T12:34:56.654321+00:00","UNIT-exact-original.invalid"],["UNIT-B.invalid","9223372036854775806","-0.000000000000000000123456789","{\"large\":9007199254740995,\"fraction\":-0.000000000000000000123456789}","{\"large\":9007199254740995,\"fraction\":-0.000000000000000000123456789}","2026-10-17T01:02:03.000001","2026-10-17T01:02:03.999999+00:00","UNIT-B.invalid"],["UNIT-NULL.invalid","7","0.0000000000000000001",null,null,"2026-10-17T01:02:03.123456","2026-10-17T01:02:03.654321+00:00","UNIT-null-distinction.invalid"],["UNIT-NULL.invalid","7","0.0000000000000000001","null","null","2026-10-17T01:02:03.123456","2026-10-17T01:02:03.654321+00:00","UNIT-null-distinction.invalid"]].map(row=>Object.freeze(row))),
  profiles: Object.freeze(["MATCH","INTEGER","NUMERIC_FRACTION","JSON_INTEGER","JSON_FRACTION","JSONB_INTEGER","JSONB_FRACTION","JSON_LEXICAL","LOCAL_MICROSECOND","INSTANT_MICROSECOND","SQL_NULL_JSON","SQL_NULL_JSONB","DUPLICATE_MISSING","DUPLICATE_EXTRA","MISSING_COLUMN","EXTRA_COLUMN","CHANGED_ORIGINAL","MALFORMED_ORIGINAL","MISSING_ORIGINAL_ROW","EXCESS_ORIGINAL_ROW"]),
  source_variant_profiles: Object.freeze({"CHANGED_ORIGINAL":"CHANGED_LABEL","MALFORMED_ORIGINAL":"MALFORMED_INT8","MISSING_ORIGINAL_ROW":"MISSING_ROW","EXCESS_ORIGINAL_ROW":"EXCESS_ROW"}),
});
export const STORAGE_ORIGINAL_UNIT_INPUT = Object.freeze({
  fixture_id: "UNIT-storage-exact-original-20261017-v1", project_ref: "unitstoragefixture01",
  public_unit_key: "UNIT-only-immutable-archive-verification-key-20261016", key_id: "unit-immutable-archive-v1",
  source_uri: "https://unit-storage-original.invalid", table: owningUnitTable,
  raw_rows: Object.freeze([owningUnitRowA, owningUnitRowA, owningUnitRowB]),
  profiles: Object.freeze(["MATCH", "INTEGER", "NUMERIC_FRACTION", "JSON_INTEGER", "JSON_FRACTION", "JSONB_INTEGER",
    "JSONB_FRACTION", "LOCAL_MICROSECOND", "INSTANT_MICROSECOND", "DUPLICATE_MISSING", "DUPLICATE_EXTRA", "MISSING_COLUMN"]),
  create_sql: 'create table storage.unit_storage_original_exact_v1 (case_key text,exact_integer bigint,exact_number numeric,json_original json,jsonb_original jsonb,local_time timestamp without time zone,instant_time timestamp with time zone,original_label text)',
  text_columns_v2: owningTextUnitInput,
});
const owningClient = pg.Client, owningNativeQuery = pg.Client.prototype.query;
const owningHash = value => createHash("sha256").update(value).digest("hex");
const owningRawWire = STORAGE_ORIGINAL_UNIT_INPUT.raw_rows.map(raw => JSON.stringify(raw) + "\n").join("");
const owningSchema = '-- SYNTHETIC UNIT-only Storage comparison fixture, NOT production backup provenance.\n'
  + 'create table public.unit_storage_placeholder_v1 (id text);\ncreate table auth.unit_storage_placeholder_v1 (id text);\n'
  + STORAGE_ORIGINAL_UNIT_INPUT.create_sql + ';\n';
const owningTextSchema = '-- SYNTHETIC UNIT-only native TEXT Storage comparison fixture, NOT production provenance.\n'
  + 'create table public.unit_storage_placeholder_v2 (id text);\ncreate table auth.unit_storage_placeholder_v2 (id text);\n'
  + owningTextUnitInput.create_sql + ';\n';

async function readStorageOwningUnitOriginal(archive) {
  const binding = readVerifiedArchiveSourceBinding(archive);
  const textColumns = binding.source_identity.fixture_id === owningTextUnitInput.fixture_id;
  const input = textColumns ? owningTextUnitInput : STORAGE_ORIGINAL_UNIT_INPUT;
  const selection = readVerifiedRestoreTableSelection(archive, { databaseOnly: true });
  const current = () => {
    assert.strictEqual(readVerifiedArchiveSourceBinding(archive), binding);
    assert.strictEqual(readVerifiedRestoreTableSelection(archive, { databaseOnly: true }), selection);
  };
  assert.equal(binding.project_ref, input.project_ref);
  assert.equal(binding.source_identity.fixture_id, input.fixture_id);
  assert.equal(binding.source_identity.unit_fixture_only, true);
  assert.equal(binding.source_identity.source_uri, input.source_uri);
  assert.equal(binding.source_identity.application_schema_sha256, owningHash(textColumns ? owningTextSchema : owningSchema));
  assert.equal(binding.summary.table_count, 3); assert.equal(binding.summary.database_row_count, textColumns ? 5 : 3);
  assert.deepEqual(binding.summary.backed_up_schemas, ["public", "auth", "storage"]);
  assert.equal(selection.databaseTables.length, 3); assert.equal(selection.privateTables.length, 0);
  assert.equal(selection.storageTables.length, 1);
  assert.equal(stableJson(selection.storageTables[0]), stableJson(input.table));
  const variant = textColumns ? binding.source_identity.storage_v2_variant : "ORIGINAL";
  if (textColumns) {
    assert.equal(binding.source_identity.unit_input_sha256,"9eeac5819158873bafb075282062cde9e210e73b75d4e7242cda47c9da436194");
    assert.equal(binding.source_identity.typed_seed_sha256,owningHash(stableJson(input.seed_rows)));
    assert.ok(["ORIGINAL",...Object.values(input.source_variant_profiles)].includes(variant));
    // These are intentionally incomplete/excess signed UNIT inputs. Only the
    // actual comparator may consume/refuse their count/EOF; no test preflight
    // may convert that missing proof into an apparently verified original.
    if (["MISSING_ROW","EXCESS_ROW"].includes(variant)) {
      current(); return Object.freeze({binding,current,input,variant,textColumns,rawRows:null,raw_verified:false});
    }
  }
  current();
  const data = openVerifiedRestoreTableData(archive, "storage", input.table.table_name);
  const decoder = createRestoreRowLineBatchDecoder(), found = [];
  let settled, first, failed = false, eof;
  try {
    settled = pipeline(data.stream, decoder); settled.catch(() => {});
    for await (const batch of decoder) {
      current();
      for (const line of batch) {
        assert.ok(found.length < (textColumns ? 5 : 3)); found.push(decodeRestoreTableRowLine(line, data.table));
      }
      current();
    }
    current(); await settled; current(); eof = await data.verified; current();
    if (!textColumns) assert.deepEqual(found, STORAGE_ORIGINAL_UNIT_INPUT.raw_rows);
    else assert.equal(found.length,5);
    const wire = textColumns ? found.map(raw=>JSON.stringify(raw)+"\n").join("") : owningRawWire;
    assert.equal(eof.data_file, input.table.data_file); assert.equal(eof.sha256, owningHash(wire));
    assert.equal(eof.bytes, Buffer.byteLength(wire));
  } catch (error) { first = error; failed = true; }
  const cleanup = [];
  data.stream.destroy(); decoder.destroy(); if (settled) await settled.catch(() => {});
  try { await data.close(); } catch (error) { cleanup.push(error); }
  try { current(); } catch (error) { cleanup.push(error); }
  if (cleanup.length) throw new AggregateError(failed ? [first, ...cleanup] : cleanup, "UNIT Storage source cleanup failed", failed ? { cause: first } : undefined);
  if (failed) throw first;
  return Object.freeze({ binding, current, input, variant, textColumns, rawRows: Object.freeze(found), raw_verified:true });
}

// Main alone invokes this native member in its owned unexposed disposable
// target: BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE already active.
// Only this fixed UNIT table is created/changed, inside our savepoint. The
// actual comparison interval switches READ ONLY, never off as a fallback.
// ROLLBACK TO our savepoint restores the prior mode and removes ALL fixture
// DDL/rows before a result returns. No COMMIT, outer rollback, end or archive
// cleanup, fake client, signing/credentials or normal application tables.
// NEW actual native checkpoint caller only. Existing protected runner supplies
// its exclusively owned fresh UNIT database and immutable native-captured v2
// archive. No recording Client/result/Source token or production route here.
// Main-owned actual native sampler join. Only the existing protected runner's
// new, empty, unexposed disposable target may supply this original pg.Client.
// Each complete fixed UNIT schema/row setup and all reads are rolled back;
// download callback is UNIT bytes, NOT a real Storage provider or owner proof.
export async function runStorageSupportedSamplerNativeCase(db, profile) {
  assert.ok(["SAFE_NATIVE","BIGINT_REFUSED","FRACTION_REFUSED"].includes(profile));
  assert.equal(Object.getPrototypeOf(db),owningClient.prototype);
  assert.equal(Object.hasOwn(db,"query"),false);
  assert.equal(owningClient.prototype.query,owningNativeQuery);
  assert.equal(db._connected,true);assert.equal(db._txStatus,"I");
  const raw=(sql,values=[])=>Reflect.apply(owningNativeQuery,db,[sql,values]);
  const before=(await raw(`select current_database() database,pg_backend_pid()::text pid,to_regnamespace('storage') storage,
    to_regclass('storage.buckets') buckets,to_regclass('storage.objects') objects`)).rows[0];
  assert.match(before.database,/^mz_schema_rebuild_held_product_[a-f0-9]{16}$/);
  // The unchanged cached image can carry an empty Storage namespace. Do not
  // drop/reassign it, adopt existing tables, or weaken shipping table guards.
  assert.equal(before.buckets,null);assert.equal(before.objects,null);
  const bytes=Buffer.from("UNIT native sampler bytes\0é"),owner="UNIT-only-owner";
  let began=false,failed=false,first,downloads=0,observation;
  try {
    began=true;await raw("begin isolation level repeatable read");
    if(before.storage===null)await raw("create schema storage");
    await raw(`create table storage.buckets(id text primary key,name text not null,public boolean not null,
      file_size_limit bigint not null,allowed_mime_types text[] not null,owner_id text not null);
      create table storage.objects(id uuid primary key,bucket_id text not null,name text not null,
      metadata jsonb not null,user_metadata jsonb not null,owner_id text not null,owner text not null,
      created_at timestamptz not null,updated_at timestamptz not null,last_accessed_at timestamptz)`);
    const limit=profile==="BIGINT_REFUSED"?"9007199254740993":"4096";
    const metadata=profile==="FRACTION_REFUSED"?'{"precise":0.123456789012345678901234567890}':'{"safe":0.125}';
    assert.equal((await raw("insert into storage.buckets values($1,$2,false,$3::bigint,$4::text[],$5)",
      ["UNIT-only","UNIT original",limit,["application/octet-stream","NULL",null,"a,b"],owner])).rowCount,1);
    assert.equal((await raw(`insert into storage.objects values($1::uuid,$2,$3,$4::jsonb,$5::jsonb,$6,$6,
      '2026-10-18T01:02:03.123456+00:00','2026-10-18T01:02:03.123457+00:00',null)`,
      ["11111111-1111-4111-8111-111111111111","UNIT-only","UNIT-original.bin",
       JSON.stringify({size:bytes.length,mimetype:"application/octet-stream"}),metadata,owner])).rowCount,1);
    await raw("set local transaction_read_only=on");
    const context=(await raw("select current_database() database,pg_backend_pid()::text pid,current_user actor,session_user session_actor,current_setting('transaction_read_only') read_only,current_setting('transaction_isolation') isolation")).rows[0];
    assert.equal(context.database,before.database);assert.equal(context.pid,before.pid);
    assert.equal(context.actor,"supabase_admin");assert.equal(context.session_actor,"supabase_admin");
    assert.equal(context.read_only,"on");assert.equal(context.isolation,"repeatable read");
    let result,error;
    try { result=await captureStorageSupportedState({db,downloadObject:async(bucket,name)=>{
      downloads++;assert.equal(bucket,"UNIT-only");assert.equal(name,"UNIT-original.bin");
      assert.equal(db._txStatus,"T");return bytes;
    },observedAt:"2026-10-18T09:00:00.000Z"}); } catch(value) {error=value;}
    if(profile==="SAFE_NATIVE"){
      if(error)throw error;
      assert.equal(result.format,"memphis-zoo.storage-supported-state-resample.v1");
      assert.equal(result.state.bucket_count,1);assert.equal(result.state.object_count,1);
      assert.equal(result.state.bucket_rows[0].file_size_limit,4096);
      assert.deepEqual(result.state.bucket_rows[0].allowed_mime_types,["application/octet-stream","NULL",null,"a,b"]);
      assert.deepEqual(result.state.object_rows[0].user_metadata,{safe:0.125});
      assert.equal(result.state.object_rows[0].created_at,"2026-10-18T01:02:03.123456+00:00");
      assert.equal(result.state.object_byte_digests[0].sha256,createHash("sha256").update(bytes).digest("hex"));
      assert.equal(result.state_sha256,createHash("sha256").update(stableJson(result.state)).digest("hex"));
      assert.equal(downloads,1);
    }else{
      assert.equal(result,undefined);assert.ok(error);
      assert.equal(error.code,"STORAGE_SUPPORTED_STATE_UNAVAILABLE");
      assert.equal(error.storage_sample_reason,"V1_NUMBER_UNREPRESENTABLE");
      assert.equal(error.retry_safe,false);assert.equal(downloads,0);
      assert.equal(Object.hasOwn(error,"cause"),false);
    }
    observation={profile,actual_native_SQL:true,native_context:context,
      current_source_sampler:true,status:profile==="SAFE_NATIVE"?"SUPPORTED_V1_BYTES_READ":"REFUSED_BEFORE_DOWNLOAD",
      downloads,raw_precision_preserved_by_refusal:profile!=="SAFE_NATIVE",
      provider:false,original_restore_or_effect_authority:false};
  }catch(error){failed=true;first=error;}
  if(began){try{await raw("rollback");}catch(error){if(!failed){failed=true;first=error;}}}
  if(failed)throw first;
  assert.equal(db._txStatus,"I");assert.equal(db.queryQueue.length,0);
  const after=(await raw(`select current_database() database,pg_backend_pid()::text pid,to_regnamespace('storage') storage,
    to_regclass('storage.buckets') buckets,to_regclass('storage.objects') objects`)).rows[0];
  assert.deepEqual(after,before);
  return {...observation,transaction:"ROLLED_BACK",fixture_tables_absent:true,image_namespace_unchanged:true};
}

export async function runStorageExactCheckpointNativeCase(db, verifiedArchive, profile) {
  assert.ok(["MATCH","INTEGER_DIFFERENT"].includes(profile));
  assert.equal(Object.getPrototypeOf(db),owningClient.prototype);
  assert.equal(Object.hasOwn(db,"query"),false);assert.equal(owningClient.prototype.query,owningNativeQuery);
  assert.equal(db._connected,true);assert.equal(db._txStatus,"I");
  const original=await readStorageOwningUnitOriginal(verifiedArchive);
  assert.equal(original.textColumns,true);assert.equal(original.variant,"ORIGINAL");
  const query=async(sql,values=[])=>{original.current();const value=await Reflect.apply(owningNativeQuery,db,[sql,values]);original.current();return value;};
  const before=(await query("select current_database() database_name,current_user actor,session_user session_actor,"+
    "(select pg_get_userbyid(datdba) from pg_database where datname=current_database()) database_owner,"+
    "to_regclass('storage.unit_storage_original_exact_v2')::text unit_relation")).rows[0];
  assert.match(before.database_name,/^mz_schema_rebuild_held_product_[a-f0-9]{16}$/);
  assert.equal(before.database_owner,"postgres");assert.equal(before.actor,"supabase_admin");assert.equal(before.session_actor,before.actor);
  assert.equal(before.unit_relation,"storage.unit_storage_original_exact_v2");
  if(profile==="INTEGER_DIFFERENT"){
    // Change ONE disposable target row, never the immutable original archive.
    const changed=await query("update storage.unit_storage_original_exact_v2 set exact_integer=$1::bigint "+
      "where ctid=(select ctid from storage.unit_storage_original_exact_v2 where case_key='UNIT-A.invalid' order by ctid limit 1)",
      ["9007199254740992"]);
    assert.equal(changed.rowCount,1);
  }
  const code=readFileSync(new URL("./production-restore.mjs",import.meta.url),"utf8");
  const a=code.indexOf("const storageSnapshotQuery = Client.prototype.query;"),z=code.indexOf('\nlet restorePhase = "connect";',a);
  assert.ok(a>0&&z>a);
  const read=new Function("Client","db","types","verifiedArchive","sourceBinding","requireOriginalArchiveSource",
    "readVerifiedRestoreTableSelection","compareVerifiedStorageTableData",
    code.slice(a,z)+"\nreturn readExactOriginalStorageSnapshot;")(owningClient,db,{isProxy},verifiedArchive,
      original.binding,original.current,readVerifiedRestoreTableSelection,compareVerifiedStorageTableData);
  const result=await read();original.current();
  assert.equal(db._txStatus,"I");assert.equal(db.readyForQuery,true);
  assert.equal(db._activeQuery,null);assert.equal(db._queryQueue.length,0);
  assert.deepEqual(Object.keys(result),["status","tables"]);
  assert.equal(result.status,profile==="MATCH"?"MATCH":"DIFFERENT");
  assert.equal(result.tables.length,1);assert.equal(result.tables[0].original_count,"5");
  assert.equal(result.tables[0].missing_count,profile==="MATCH"?"0":"1");
  assert.equal(result.tables[0].extra_count,profile==="MATCH"?"0":"1");
  assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.tables),true);
  return Object.freeze({profile,actual_SQL:true,actual_shipping_caller:true,actual_native_comparator:true,
    status:result.status,tables:result.tables,transaction_after:"I",query_queue_after:0,
    synthetic_UNIT_source_and_target:true,production_provider:false,whole_restore:false,authority:false});
}

export async function runStorageOriginalOwningSqlCase(db, verifiedArchive, profile) {
  assert.ok(STORAGE_ORIGINAL_UNIT_INPUT.profiles.includes(profile) || owningTextUnitInput.profiles.includes(profile), "Select one fixed NEW Storage owning case");
  const native = () => {
    assert.ok(db && typeof db === "object" && !isProxy(db) && Object.getPrototypeOf(db) === owningClient.prototype
      && !Object.hasOwn(db, "query") && owningClient.prototype.query === owningNativeQuery, "Original native pg.Client required");
  };
  native();
  const original = await readStorageOwningUnitOriginal(verifiedArchive);
  const {input,textColumns,variant}=original;
  assert.ok(input.profiles.includes(profile));
  assert.equal(variant,textColumns?(input.source_variant_profiles[profile]||"ORIGINAL"):"ORIGINAL");
  const unitTarget=textColumns?"storage.unit_storage_original_exact_v2":"storage.unit_storage_original_exact_v1";
  const raw = async (sql, values = [], sourceCheck = true) => {
    native(); if (sourceCheck) original.current();
    const result = await Reflect.apply(owningNativeQuery, db, [sql, values]);
    native(); if (sourceCheck) original.current(); return result;
  };
  const stateSql = `select pg_catalog.current_database() database_name,
    (select pg_catalog.pg_get_userbyid(d.datdba) from pg_catalog.pg_database d where d.datname=pg_catalog.current_database()) database_owner,
    pg_catalog.pg_backend_pid()::pg_catalog.text backend_pid,pg_catalog.txid_current()::pg_catalog.text transaction_id,
    pg_catalog.txid_current_snapshot()::pg_catalog.text snapshot,current_user::pg_catalog.text actor,session_user::pg_catalog.text session_actor,
    pg_catalog.current_setting('transaction_read_only') read_only,pg_catalog.current_setting('transaction_isolation') isolation,
    pg_catalog.current_setting('session_replication_role') replication,
    (pg_catalog.current_schemas(true))[1]::pg_catalog.text first_schema,
    (select pg_catalog.pg_get_userbyid(n.nspowner) from pg_catalog.pg_namespace n where n.nspname='storage') storage_owner,
    (select c.oid::pg_catalog.text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='storage' and c.relname='${input.table.table_name}') unit_relation`;
  const state = async (sourceCheck = true) => {
    const result = await raw(stateSql, [], sourceCheck); assert.equal(result.rowCount, 1); assert.equal(result.rows.length, 1);
    return result.rows[0];
  };
  assert.equal(db._connected, true); assert.equal(db._txStatus, "T");
  const before = await state();
  assert.match(before.database_name, /^mz_schema_rebuild_[A-Za-z0-9_]+$/);
  assert.equal(before.database_owner, "postgres"); assert.equal(before.actor, before.session_actor);
  assert.ok(["postgres", "supabase_admin"].includes(before.actor));
  assert.equal(typeof before.storage_owner, "string"); assert.ok(before.storage_owner.length > 0);
  assert.equal(before.read_only, "off"); assert.ok(["repeatable read", "serializable"].includes(before.isolation));
  assert.equal(before.replication, "origin"); assert.equal(before.first_schema, "pg_catalog");
  assert.equal(before.unit_relation, null, "Never adopt/drop preexisting UNIT or unknown work");
  let savepoint = false, failed = false, first, comparison;
  try {
    await raw("savepoint storage_original_owning_case"); savepoint = true;
    await raw(input.create_sql);
    if(textColumns){
      // Fixed independently typed seed parameters, not JSON-value decoding of
      // the expected archive. The archive itself was captured natively first.
      for(const row of input.seed_rows)assert.equal((await raw(input.seed_sql,row)).rowCount,1);
      const baseline=(await raw(`select custodial_dr.immutable_import_text_projection(t) image from ${unitTarget} t order by ctid`)).rows.map(row=>row.image);
      if(variant==="ORIGINAL")assert.deepEqual(baseline,original.rawRows);
      assert.deepEqual((await raw(`select count(*)::text count,
        count(*) filter(where json_original is null)::text json_sql_null,
        count(*) filter(where json_original is not null and json_typeof(json_original)='null')::text json_value_null,
        count(*) filter(where jsonb_original is null)::text jsonb_sql_null,
        count(*) filter(where jsonb_original is not null and jsonb_typeof(jsonb_original)='null')::text jsonb_value_null
        from ${unitTarget}`)).rows,[{count:'5',json_sql_null:'1',json_value_null:'1',jsonb_sql_null:'1',jsonb_value_null:'1'}]);
    }else for (const originalRow of original.rawRows) {
      const inserted = await raw(`insert into storage.unit_storage_original_exact_v1
        select r.* from pg_catalog.json_populate_record(null::storage.unit_storage_original_exact_v1,$1::pg_catalog.json) r`, [originalRow]);
      assert.equal(inserted.rowCount, 1);
    }
    // Select one physical occurrence only; identical duplicates must remain
    // a multiset, not collapse into a key/JSONB equality comparison.
    const oneA = ` where ctid=(select ctid from ${unitTarget} where case_key='UNIT-A.invalid' order by ctid limit 1)`;
    const modifiedJson = (integer, fraction) => `{"large":${integer},"fraction":${fraction}}`;
    const updates = {
      INTEGER: ["exact_integer=$1::pg_catalog.int8", "9007199254740992"],
      NUMERIC_FRACTION: ["exact_number=$1::pg_catalog.numeric", "9007199254740993.123456789012345678902"],
      JSON_INTEGER: ["json_original=$1::pg_catalog.json", modifiedJson("9007199254740992", "0.123456789012345678901")],
      JSON_FRACTION: ["json_original=$1::pg_catalog.json", modifiedJson("9007199254740993", "0.123456789012345678902")],
      JSONB_INTEGER: ["jsonb_original=$1::pg_catalog.jsonb", modifiedJson("9007199254740992", "0.123456789012345678901")],
      JSONB_FRACTION: ["jsonb_original=$1::pg_catalog.jsonb", modifiedJson("9007199254740993", "0.123456789012345678902")],
      LOCAL_MICROSECOND: ["local_time=$1::pg_catalog.timestamp", "2026-10-17T12:34:56.123457"],
      INSTANT_MICROSECOND: ["instant_time=$1::pg_catalog.timestamptz", "2026-10-17T12:34:56.654322+00:00"],
    };
    if(textColumns){
      updates.JSON_INTEGER=["json_original=$1::pg_catalog.json",input.seed_rows[0][3].replace('9007199254740993','9007199254740992')];
      updates.JSON_FRACTION=["json_original=$1::pg_catalog.json",input.seed_rows[0][3].replace('0.123456789012345678901','0.123456789012345678902')];
      updates.JSON_LEXICAL=["json_original=$1::pg_catalog.json",'{"large":9007199254740993,"fraction":0.123456789012345678901,"dup":1,"dup":2}'];
    }
    if (Object.hasOwn(updates, profile)) {
      const [assignment, value] = updates[profile];
      const changed = await raw("update "+unitTarget+" set " + assignment + oneA, [value]);
      assert.equal(changed.rowCount, 1);
    } else if (profile === "DUPLICATE_MISSING") {
      const changed = await raw("delete from "+unitTarget + oneA); assert.equal(changed.rowCount, 1);
    } else if (profile === "DUPLICATE_EXTRA") {
      const changed = textColumns?await raw(input.seed_sql,input.seed_rows[0]):await raw(`insert into storage.unit_storage_original_exact_v1
        select r.* from pg_catalog.json_populate_record(null::storage.unit_storage_original_exact_v1,$1::pg_catalog.json) r`, [original.rawRows[0]]);
      assert.equal(changed.rowCount, 1);
    } else if (profile === "MISSING_COLUMN") {
      await raw("alter table "+unitTarget+" drop column original_label");
    } else if(textColumns&&profile==="EXTRA_COLUMN") {
      await raw("alter table "+unitTarget+" add column UNIT_unexpected text");
    } else if(textColumns&&["SQL_NULL_JSON","SQL_NULL_JSONB"].includes(profile)) {
      const column=profile==="SQL_NULL_JSON"?"json_original":"jsonb_original",type=profile==="SQL_NULL_JSON"?"json":"jsonb";
      assert.equal((await raw(`update ${unitTarget} set ${column}='null'::${type} where ${column} is null`)).rowCount,1);
    } else if(!textColumns||variant==="ORIGINAL")assert.equal(profile, "MATCH");
    const ready = await state();
    assert.equal(ready.database_name, before.database_name); assert.equal(ready.backend_pid, before.backend_pid);
    assert.equal(ready.transaction_id, before.transaction_id); assert.equal(ready.snapshot, before.snapshot);
    assert.match(ready.unit_relation, /^[1-9][0-9]{0,9}(?![\s\S])/);
    await raw("set local transaction_read_only=on");
    const reading = await state(); assert.equal(reading.read_only, "on");
    for (const key of ["database_name", "backend_pid", "transaction_id", "snapshot", "actor", "session_actor", "isolation", "replication", "first_schema"])
      assert.equal(reading[key], before[key]);
    if(textColumns&&["MALFORMED_INT8","MISSING_ROW","EXCESS_ROW"].includes(variant)){
      let refusal;try{await compareVerifiedStorageTableData({db,verifiedArchive});}catch(error){refusal=error;}
      assert.ok(refusal&&!isProxy(refusal));assert.equal(refusal.code,"VERIFIED_STORAGE_TABLE_COMPARISON_UNAVAILABLE");
      assert.equal(refusal.storage_check_phase,variant==="MALFORMED_INT8"?"COMPARE":"ORIGINAL_DATA");
      if(variant==="MALFORMED_INT8")assert.equal(refusal.sql_state,"22P02");
      comparison=Object.freeze({status:"REFUSED",code:refusal.code,storage_check_phase:refusal.storage_check_phase,
        ...(Object.hasOwn(refusal,"sql_state")?{sql_state:refusal.sql_state}:{})});
    }else{
    comparison = await compareVerifiedStorageTableData({ db, verifiedArchive }); original.current();
    assert.strictEqual(comparison.sourceBinding, original.binding); assert.equal(comparison.tables.length, 1);
    assert.ok(Object.isFrozen(comparison) && Object.isFrozen(comparison.tables) && Object.isFrozen(comparison.tables[0]));
    const table = comparison.tables[0]; assert.equal(table.schema_name, "storage");
    assert.equal(table.table_name, input.table.table_name); assert.equal(table.original_count, input.table.row_count);
    if (profile === "MISSING_COLUMN" || textColumns&&profile==="EXTRA_COLUMN") {
      assert.equal(comparison.status, "UNSUPPORTED"); assert.equal(table.status, "UNSUPPORTED");
      assert.equal(table.reason, "TARGET_SOURCE_CATALOG_OR_FULL_VISIBILITY_UNSUPPORTED");
      assert.equal(table.current_count, null); assert.equal(table.missing_count, null); assert.equal(table.extra_count, null);
    } else {
      assert.equal(comparison.status, profile === "MATCH" ? "MATCH" : "DIFFERENT");
      assert.equal(table.status, comparison.status);
      assert.equal(table.current_count, textColumns?(profile==="DUPLICATE_MISSING"?"4":profile==="DUPLICATE_EXTRA"?"6":"5"):
        profile === "DUPLICATE_MISSING" ? "2" : profile === "DUPLICATE_EXTRA" ? "4" : "3");
      assert.equal(table.missing_count, profile === "MATCH" || profile === "DUPLICATE_EXTRA" ? "0" : "1");
      assert.equal(table.extra_count, profile === "MATCH" || profile === "DUPLICATE_MISSING" ? "0" : "1");
    }
    }
  } catch (error) { failed = true; first = error; }
  const cleanup = [];
  if (savepoint) {
    let rolledBack = false;
    try { await raw("rollback to savepoint storage_original_owning_case", [], false); rolledBack = true; }
    catch (error) { cleanup.push(error); }
    if (rolledBack) {
      try { await raw("release savepoint storage_original_owning_case", [], false); } catch (error) { cleanup.push(error); }
      try { assert.deepEqual(await state(false), before); } catch (error) { cleanup.push(error); }
    }
  }
  try { original.current(); } catch (error) { cleanup.push(error); }
  if (cleanup.length) throw new AggregateError(failed ? [first, ...cleanup] : cleanup, "UNIT Storage owning case cleanup failed", failed ? { cause: first } : undefined);
  if (failed) throw first;
  return Object.freeze({ profile, comparison, own_savepoint_rolled_back: true,
    limits: "Disposable UNIT typed-DATA comparison only; not provider/owner auth, production Source/COMMIT/restore/G31 authority" });
}

const storageTestDirect = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if(storageTestDirect&&process.argv.includes('--storage-v2-json-change-input-only')){
  const source=readFileSync(new URL('./disaster-recovery-storage-tests.mjs',import.meta.url),'utf8');
  const start=source.indexOf('    const modifiedJson = (integer, fraction) =>'),end=source.indexOf('    if (Object.hasOwn(updates, profile))',start);
  assert.ok(start>0&&end>start);
  const updates=new Function('textColumns','input',source.slice(start,end)+'\nreturn updates;')(true,owningTextUnitInput);
  const original=owningTextUnitInput.seed_rows[0][3];
  // The predecessor map would also drop duplicate fields/whitespace; that
  // would mask a rounded-number defect with an unrelated lexical change.
  assert.notEqual('{"large":9007199254740992,"fraction":0.123456789012345678901}',original.replace('9007199254740993','9007199254740992'));
  assert.equal(updates.JSON_INTEGER[1],original.replace('9007199254740993','9007199254740992'));
  assert.equal(updates.JSON_FRACTION[1],original.replace('0.123456789012345678901','0.123456789012345678902'));
  assert.equal(updates.JSON_LEXICAL[1],'{"large":9007199254740993,"fraction":0.123456789012345678901,"dup":1,"dup":2}');
  assert.notEqual(updates.JSON_LEXICAL[1],original);
  console.log(JSON.stringify({selector:'storage-v2-json-change-input-only',actual_profile_builder:true,
    isolated_integer_and_fraction_changes:true,lexical_only_profile_separate:true,SQL:'NOT_RUN',resources:0}));
  process.exit(0);
}
if(storageTestDirect&&process.argv.includes('--storage-v2-native-input-only')){
  const argument=process.argv.find(value=>value.startsWith('--storage-v2-input='));assert.ok(argument);
  const bytes=readFileSync(resolve(argument.slice('--storage-v2-input='.length)));
  assert.equal(owningHash(bytes),'9eeac5819158873bafb075282062cde9e210e73b75d4e7242cda47c9da436194');
  const input=JSON.parse(bytes),fixed=STORAGE_ORIGINAL_UNIT_INPUT.text_columns_v2;
  assert.equal(input.data_encoding,fixed.table.data_encoding);assert.equal(input.table_name,fixed.table.table_name);
  for(const key of ['fixture_id','project_ref','source_uri','create_sql','seed_sql','public_unit_key','key_id'])assert.equal(input[key],fixed[key]);
  for(const key of ['seed_rows','profiles','source_variant_profiles'])assert.deepEqual(input[key],fixed[key]);
  assert.ok(Object.isFrozen(fixed)&&Object.isFrozen(fixed.table)&&Object.isFrozen(fixed.seed_rows));
  assert.equal(fixed.seed_rows.length,5);assert.deepEqual(fixed.seed_rows[0],fixed.seed_rows[1]);
  for(const row of fixed.seed_rows){assert.ok(Object.isFrozen(row));assert.equal(row.length,8);
    assert.ok(row.every(value=>value===null||typeof value==='string'));}
  assert.equal(fixed.seed_rows[3][3],null);assert.equal(fixed.seed_rows[4][3],'null');
  assert.equal(fixed.seed_rows[3][4],null);assert.equal(fixed.seed_rows[4][4],'null');
  assert.ok(fixed.seed_rows[0][1].includes('9007199254740993'));
  assert.ok(fixed.seed_rows[0][2].endsWith('123456789012345678901'));
  assert.equal(fixed.profiles.length,20);
  assert.equal(STORAGE_ORIGINAL_UNIT_INPUT.table.data_encoding,'postgres-json-text-line.v1');
  console.log(JSON.stringify({selector:'storage-v2-native-input-only',input_sha256:owningHash(bytes),
    fixed_typed_seed_rows:5,changed_profiles:20,public_UNIT_only:true,
    native_archive_capture:'NOT_RUN_REQUIRES_MAIN_LEASE',native_comparison:'NOT_RUN',old_groups_replayed:0,resources:0}));
  process.exit(0);
}
if (storageTestDirect && process.argv.includes("--storage-owning-sql-fixture-only")) {
  const argument = process.argv.find(value => value.startsWith("--storage-unit-fixture="));
  assert.ok(argument, "Explicit newly owned UNIT fixture path required");
  const directory = resolve(argument.slice("--storage-unit-fixture=".length));
  const before = readFileSync(join(directory, "SHA256SUMS"));
  const archive = materializeVerifiedArchive({ sourceDir: directory,
    archiveVerifyKey: STORAGE_ORIGINAL_UNIT_INPUT.public_unit_key, archiveVerifyKeyId: STORAGE_ORIGINAL_UNIT_INPUT.key_id });
  const snapshot = archive.directory;
  try {
    const original = await readStorageOwningUnitOriginal(archive);
    assert.equal(original.rawRows.length, 3); assert.equal(original.rawRows[0], original.rawRows[1]);
    const parsed = pg.types.getTypeParser(114, "text")(original.rawRows[0]);
    assert.equal(parsed.exact_integer, 9007199254740992);
    assert.ok(original.rawRows[0].includes('"exact_integer":9007199254740993'));
    let foreignQueries = 0;
    await assert.rejects(runStorageOriginalOwningSqlCase({ query() { foreignQueries++; } }, archive, "MATCH"));
    assert.equal(foreignQueries, 0); original.current();
  } finally { archive.cleanup(); }
  assert.equal(existsSync(snapshot), false); assert.deepEqual(readFileSync(join(directory, "SHA256SUMS")), before);
  console.log(JSON.stringify({ case: "NEW populated signed UNIT Storage input", signature: "VERIFIED_PUBLIC_UNIT_HMAC",
    original_rows: 3, exact_duplicate_rows: 2, raw_numeric_time_text_EOF: "VERIFIED", SQL: "NOT_RUN",
    native_profiles: "NOT_RUN_MAIN_ONLY", import_only_callable: "runStorageOriginalOwningSqlCase(db,verifiedArchive,profile)",
    caller_archive_closed: false, own_materialization_closed: true, old_groups: 0, resources: 0 }));
}

// Imports expose only the newly declared native member/data. Historical
// selected/default bodies stay byte-identical and never run on import.
if (storageTestDirect && !process.argv.includes("--storage-owning-sql-fixture-only")) {
async function storageExactOriginalDataCases() {
  const { default: pg } = await import("pg");
  const storage = await import("./disaster-recovery-storage.mjs");
  if (!process.argv.includes("--storage-exact-original-data-refusals-only")) {
  const parser = pg.types.getTypeParser(114, "text");
  const raw = n => `{"id":"UNIT-object","bucket_id":"UNIT-bucket","name":"UNIT-object.bin","owner":null,"owner_id":null,"metadata":{"original_number":${n}}}`;
  const integerTexts = [raw("9007199254740992"), raw("9007199254740993")];
  const fractionTexts = [raw("0.123456789012345678901"), raw("0.123456789012345678902")];
  for (const pair of [integerTexts, fractionTexts]) {
    assert.notEqual(pair[0], pair[1]); assert.deepEqual(parser(pair[0]), parser(pair[1]));
  }
  const capture = async text => {
    const trace = [], bucket = { id: "UNIT-bucket", public: false };
    const result = await captureStorageSupportedState({ observedAt: "2026-10-17T00:00:00.000Z",
      db: { async query(sql) {
        if (sql === "select row_to_json(b) row from storage.buckets b order by b.id") {
          trace.push("bucket"); return { rows: [{ row: bucket }] };
        }
        assert.equal(sql, "select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id");
        trace.push("object"); return { rows: [{ row: parser(text) }] };
      } }, downloadObject: async () => { trace.push("bytes"); return Buffer.from("UNIT exact equal bytes"); } });
    assert.deepEqual(trace, ["bucket", "object", "bytes", "bucket", "object"]); return result;
  };
  const captures = await Promise.all(integerTexts.map(capture));
  assert.deepEqual(captures[0], captures[1]);
  console.log(JSON.stringify({ case: "NEW installed pg OID114 precision counterexample",
    integer_texts_differ: true, integer_parses_equal: true, fraction_texts_differ: true, fraction_parses_equal: true,
    current_capture_states_equal: true, current_capture_hashes_equal: captures[0].state_sha256 === captures[1].state_sha256,
    limits: "Installed parser and actual legacy capture with inert ports only; NOT SQL/provider acceptance" }));
  }
  assert.equal(typeof storage.compareVerifiedStorageTableData, "function", "Exact verified-original SQL comparison export is required");
  let getters = 0, traps = 0, queries = 0;
  const foreign = { async query() { queries++; throw Error("Foreign port must never be queried"); } };
  const proxy = new Proxy({}, { get() { traps++; throw Error("Proxy must not run"); },
    ownKeys() { traps++; throw Error("Proxy must not run"); } });
  const accessed = {};
  Object.defineProperty(accessed, "db", { enumerable: true, get() { getters++; return foreign; } });
  Object.defineProperty(accessed, "verifiedArchive", { enumerable: true, value: {} });
  for (const options of [null, undefined, false, [], {}, { db: foreign, verifiedArchive: {} },
    { db: proxy, verifiedArchive: {} }, { db: foreign, verifiedArchive: proxy }, proxy, accessed,
    { db: foreign, verifiedArchive: {}, sql: "caller SQL is forbidden" }]) {
    await assert.rejects(storage.compareVerifiedStorageTableData(options));
  }
  const db = new pg.Client({ connectionString: "postgresql://UNIT:UNIT@127.0.0.1:1/mz_schema_rebuild_UNIT" });
  try {
    assert.equal(db._connected, false);
    for (const archive of [{}, Object.freeze({}), proxy]) {
      await assert.rejects(storage.compareVerifiedStorageTableData({ db, verifiedArchive: archive }));
    }
    assert.equal(db._connected, false); assert.equal(db._ended, false); assert.equal(db._txStatus, null);
  } finally { await pg.Client.prototype.end.call(db); }
  assert.equal(getters, 0); assert.equal(traps, 0); assert.equal(queries, 0);
  console.log(JSON.stringify({ case: "NEW exact Storage DATA closed-input boundary", status: "PASS_PARSER_AND_REFUSALS_ONLY",
    foreign_queries: queries, getters, traps, native_constructor_only: true, connected: false,
    actual_SQL_comparison: "NOT_RUN", real_verified_archive_positive: "NOT_RUN",
    old_groups_replayed: 0, provider_calls: 0, resources: 0 }));
}
if (process.argv.includes("--storage-exact-original-data-only") || process.argv.includes("--storage-exact-original-data-refusals-only")) {
  await storageExactOriginalDataCases(); process.exit(0);
}

async function storagePostByteCurrentnessCases() {
  const { stableJson } = await import("./disaster-recovery-crypto.mjs");
  const hash = value => createHash("sha256").update(value).digest("hex");
  const bytes = Buffer.from("UNIT downloaded bytes under observed metadata: café\0exact");
  const bucket = { id: "unit-readback-bucket", name: "Unit readback", public: false,
    allowed_mime_types: ["application/octet-stream"], file_size_limit: 4096 };
  const object = { id: "unit-readback-object", bucket_id: bucket.id, name: "exact original café.bin",
    owner_id: "UNIT-original-owner", owner: "UNIT-original-owner", metadata: { size: bytes.length, mimetype: "application/octet-stream" },
    user_metadata: { exact: "9223372036854775807" }, version: "unit-original-version",
    created_at: "2026-10-17T00:00:00+00:00", updated_at: "2026-10-17T00:00:00+00:00", last_accessed_at: null };
  const original = { buckets: [bucket], objects: [object] }, observedAt = "2026-10-17T12:00:00.000Z";
  const metadataRefusal = "Current Storage metadata changed during byte reads; verification remains unresolved.";
  const identityRefusal = "Current Storage identities are malformed or ambiguous; verification remains unresolved.";
  const sample = async ({ initial = original, after = initial, fault, malformedFinal } = {}) => {
    const trace = [], counts = { bucket: 0, object: 0 }, before = stableJson({ initial, after });
    let failed = false, error, value, callerEnds = 0, publishedAfterByteState = initial.objects.length === 0;
    const db = {
      async query(sql) {
        const kind = sql === "select row_to_json(b) row from storage.buckets b order by b.id" ? "bucket"
          : sql === "select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id" ? "object" : null;
        assert.ok(kind, "Only the two fixed metadata reads are allowed; no SQL connection exists");
        counts[kind]++; assert.ok(counts[kind] <= 2, "No retry or replacement sample");
        const phase = `${kind}:${counts[kind] === 1 ? "initial" : "final"}`; trace.push(phase);
        if (fault?.phase === phase) throw fault.value;
        if (counts[kind] === 2) {
          assert.equal(publishedAfterByteState, true);
          if (malformedFinal?.kind === kind) return malformedFinal.value;
        }
        const selected = counts[kind] === 1 ? initial : after;
        return { rows: structuredClone(selected[kind === "bucket" ? "buckets" : "objects"]).map(row => ({ row })) };
      },
      async end() { callerEnds++; throw Error("Capture must not close its caller-owned connection"); },
    };
    let byteReads = 0;
    try {
      value = await captureStorageSupportedState({ db, observedAt, downloadObject: async (bucketId, name) => {
        const row = initial.objects[byteReads++]; trace.push("bytes");
        assert.equal(bucketId, row.bucket_id); assert.equal(name, row.name);
        publishedAfterByteState = true;
        if (fault?.phase === "bytes") throw fault.value;
        return bytes;
      } });
    } catch (caught) { failed = true; error = caught; }
    if (!initial.objects.length) assert.equal(byteReads, 0);
    assert.equal(stableJson({ initial, after }), before, "Recording rows must remain unchanged");
    assert.equal(callerEnds, 0);
    return { failed, error, value, trace, counts, byteReads };
  };
  const fullTrace = ["bucket:initial", "object:initial", "bytes", "bucket:final", "object:final"];
  const changedOwner = structuredClone(original);
  changedOwner.objects[0].owner_id = changedOwner.objects[0].owner = "UNIT-different-current-owner";
  const predecessor = await sample({ after: changedOwner });
  if (!predecessor.failed) console.log(JSON.stringify({ case: "NEW Storage post-byte metadata predecessor",
    trace: predecessor.trace, published_owner: predecessor.value.state.object_rows[0].owner_id,
    successive_current_owner: changedOwner.objects[0].owner_id, published_resample: true,
    limits: "Actual capture function with fresh detached recording-query rows, NOT SQL/provider/auth proof" }));
  assert.equal(predecessor.failed, true, "Changed current owner after byte await must not publish old metadata as a current resample");
  assert.equal(predecessor.error?.message, metadataRefusal); assert.equal(predecessor.value, undefined);
  assert.deepEqual(predecessor.trace, fullTrace);

  const unchanged = await sample(); assert.equal(unchanged.failed, false); assert.deepEqual(unchanged.trace, fullTrace);
  const { last_accessed_at: _access, ...supportedObject } = object;
  const metadata = { buckets: [bucket], objects: [supportedObject] };
  assert.deepEqual(unchanged.value.state.bucket_rows, [bucket]);
  assert.deepEqual(unchanged.value.state.object_rows, [supportedObject]);
  assert.deepEqual(unchanged.value.state.object_byte_digests, [{ bucket_id: object.bucket_id, name: object.name,
    owner_principal_id: object.owner_id, size_bytes: bytes.length, sha256: hash(bytes) }]);
  assert.equal(unchanged.value.state.metadata_sha256, hash(stableJson(metadata)));
  assert.equal(unchanged.value.state_sha256, hash(stableJson(unchanged.value.state)));
  assert.equal(unchanged.value.observed_at, observedAt);
  const accessed = structuredClone(original); accessed.objects[0].last_accessed_at = "2026-10-17T12:00:01+00:00";
  const harmless = await sample({ after: accessed }); assert.equal(harmless.failed, false);
  assert.deepEqual(harmless.trace, fullTrace); assert.deepEqual(harmless.value, unchanged.value);
  const empty = await sample({ initial: { buckets: [bucket], objects: [] } });
  assert.equal(empty.failed, false); assert.equal(empty.value.state.object_count, 0);
  assert.deepEqual(empty.trace, fullTrace.filter(phase => phase !== "bytes"));

  const changes = [
    rows => { rows.objects[0].owner_id = null; },
    rows => { rows.objects[0].metadata.size++; },
    rows => { rows.objects[0].user_metadata.exact = "different"; },
    rows => { rows.objects[0].version = "different-version"; },
    rows => { rows.objects[0].id = "different-db-id"; },
    rows => { rows.objects[0].updated_at = "2026-10-17T12:00:01+00:00"; },
    rows => { rows.objects[0].name = "different-current-name"; },
    rows => { rows.objects[0].bucket_id = "different-current-bucket"; },
    rows => { rows.objects = []; },
    rows => { rows.objects.push({ ...rows.objects[0], id: "additional-object", name: "additional" }); },
    rows => { rows.buckets[0].public = true; },
    rows => { rows.buckets[0].name = "changed-current-bucket-metadata"; },
    rows => { rows.buckets = []; },
    rows => { rows.buckets.push({ ...bucket, id: "additional-bucket" }); },
  ];
  for (const change of changes) {
    const after = structuredClone(original); change(after);
    const result = await sample({ after }); assert.equal(result.failed, true); assert.equal(result.error?.message, metadataRefusal);
    assert.equal(result.value, undefined); assert.deepEqual(result.trace, fullTrace);
  }
  const malformed = [
    rows => { rows.buckets.push({ ...bucket }); }, rows => { rows.objects.push({ ...object }); },
    rows => { rows.buckets[0].id = null; }, rows => { rows.objects[0].name = "bad\0current-name"; },
  ];
  for (const change of malformed) {
    const after = structuredClone(original); change(after);
    const result = await sample({ after }); assert.equal(result.failed, true); assert.equal(result.error?.message, identityRefusal);
    assert.equal(result.value, undefined); assert.deepEqual(result.trace, fullTrace);
  }
  for (const kind of ["bucket", "object"]) {
    const result = await sample({ malformedFinal: { kind, value: { rows: null } } });
    assert.equal(result.failed, true); assert.equal(result.value, undefined); assert.ok(result.error instanceof TypeError);
  }
  const faults = [
    ...["bucket:initial", "object:initial", "bytes", "bucket:final", "object:final"].map(phase => ({ phase, value: Error(`UNIT ${phase} unavailable`) })),
    { phase: "bytes", value: undefined }, { phase: "bucket:final", value: null },
  ];
  for (const fault of faults) {
    const result = await sample({ fault }); assert.equal(result.failed, true); assert.strictEqual(result.error, fault.value);
    assert.equal(result.value, undefined); assert.deepEqual(result.trace, fullTrace.slice(0, fullTrace.indexOf(fault.phase) + 1));
  }
  console.log(JSON.stringify({ case: "NEW Storage post-byte metadata readback", status: "PASS_RECORDING_ONLY",
    changed_owner_predecessor_refused: true, changed_supported_metadata_cases: changes.length,
    malformed_duplicate_final_cases: malformed.length + 2, first_read_download_failure_cases: faults.length,
    unchanged_and_last_access_exception: "EXACT", fixed_query_reads: 4, caller_connection_closed: false,
    SQL: "NOT_RUN", provider_calls: 0, old_groups_replayed: 0, resources: 0,
    limits: "Observed-query consistency only; snapshot/isolation/fences/provider auth remain caller-owned. No later-external-state, ABA, reconciliation or whole-G31 proof." }));
}
if (process.argv.includes("--storage-post-byte-currentness-only")) {
  await storagePostByteCurrentnessCases(); process.exit(0);
}

async function storageExpectedOriginalIdentityCases() {
  const { stableJson } = await import("./disaster-recovery-crypto.mjs");
  const bytes = Buffer.from("UNIT retained original Storage bytes: café\0unchanged");
  const bucket = { id: "unit-original-bucket", name: "Unit original", public: false,
    allowed_mime_types: ["application/octet-stream"], file_size_limit: 4096 };
  const row = { id: "unit-original-object", bucket_id: bucket.id, name: "folder/original café.bin",
    owner_id: null, owner: null, metadata: { size: bytes.length, mimetype: "application/octet-stream" },
    user_metadata: { exact: "9223372036854775807" }, version: "unit-original-version",
    created_at: "2026-10-17T00:00:00+00:00", updated_at: "2026-10-17T00:00:00+00:00", last_accessed_at: null };
  const wrapper = { id: row.id, bucket_id: row.bucket_id, name: row.name,
    file: storageObjectArchivePath(row.bucket_id, row.name), size_bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), metadata: row.metadata,
    user_metadata: row.user_metadata, version: row.version, created_at: row.created_at,
    updated_at: row.updated_at, database_row: row };
  const compare = (archivedBuckets, archivedObjects) => compareStorageState({ archivedBuckets, archivedObjects,
    actualBuckets: [bucket], actualObjects: [row] });
  const attempt = fn => { try { return { value: fn() }; } catch (error) { return { error }; } };
  const refusal = "Archived Storage identities are malformed or ambiguous; verification remains unresolved.";
  const originalAliases = [
    ["duplicate expected bucket", [bucket, { ...bucket }], [wrapper]],
    ["duplicate expected v3 object", [bucket], [row, { ...row }]],
    ["duplicate expected v4 object", [bucket], [wrapper, { ...wrapper }]],
    ["duplicate expected mixed v3/v4 object", [bucket], [row, wrapper]],
    ["boxed expected bucket identity", [{ ...bucket, id: new String(bucket.id) }], [wrapper]],
    ["boxed expected object identity", [bucket], [{ ...row, name: new String(row.name) }]],
  ].map(([name, buckets, objects]) => ({ name, ...attempt(() => compare(buckets, objects)) }));
  if (originalAliases.some(result => !result.error)) console.log(JSON.stringify({
    case: "NEW expected-original Storage alias predecessor",
    actual_results: originalAliases.map(result => ({ name: result.name, difference_count: result.value?.length,
      refused: Boolean(result.error) })), scope: "Real comparison only; no SQL/provider/signature/authority" }));
  for (const result of originalAliases) assert.equal(result.error?.message, refusal, result.name);

  const before = stableJson({ bucket, row, wrapper });
  assert.deepEqual(compare([bucket], [row]), []);
  assert.deepEqual(compare([bucket], [wrapper]), []);
  assert.deepEqual(compareStorageState({ archivedBuckets: [], archivedObjects: [], actualBuckets: [], actualObjects: [] }), []);
  const secondRow = { ...row, id: "unit-second-original-object", name: "another exact original.bin" };
  assert.deepEqual(compareStorageState({ archivedBuckets: [bucket], archivedObjects: [row, { database_row: secondRow }],
    actualBuckets: [bucket], actualObjects: [row, secondRow] }), []);
  const owned = { ...row, owner_id: "UNIT-original-owner", owner: "UNIT-original-owner" };
  const ownerDifference = compareStorageState({ archivedBuckets: [bucket], archivedObjects: [{ ...wrapper, database_row: owned }],
    actualBuckets: [bucket], actualObjects: [owned] });
  assert.equal(ownerDifference.length, 1); assert.equal(ownerDifference[0].field, "owner_access_boundary");
  const missing = compareStorageState({ archivedBuckets: [bucket], archivedObjects: [wrapper], actualBuckets: [], actualObjects: [] });
  assert.equal(missing.length, 2); assert.strictEqual(missing[0].expected_bucket_row, bucket);
  const { last_accessed_at: _access, ...supportedRow } = row;
  assert.deepEqual(missing[1].expected_object_row, supportedRow);
  assert.equal(missing[1].expected_object_sha256, wrapper.sha256);
  assert.equal(missing[1].expected_object_size_bytes, bytes.length);
  assert.equal(stableJson({ bucket, row, wrapper }), before);

  let coercions = 0, getters = 0, traps = 0;
  const coercible = { toString() { coercions++; return bucket.id; },
    [Symbol.toPrimitive]() { coercions++; return bucket.id; } };
  const bucketGetter = { ...bucket };
  Object.defineProperty(bucketGetter, "id", { enumerable: true, get() { getters++; return bucket.id; } });
  const wrapperGetter = { ...wrapper };
  Object.defineProperty(wrapperGetter, "database_row", { enumerable: true, get() { getters++; return row; } });
  const proxy = value => new Proxy(value, { get() { traps++; throw Error("Proxy must not execute"); },
    ownKeys() { traps++; throw Error("Proxy must not execute"); }, getOwnPropertyDescriptor() { traps++; throw Error("Proxy must not execute"); } });
  const inherited = Object.create({ id: bucket.id });
  const indexedGetter = [];
  Object.defineProperty(indexedGetter, "0", { enumerable: true, get() { getters++; return row; } });
  const extraArray = [row]; extraArray.unexpected = row;
  const revoked = Proxy.revocable([row], {}); revoked.revoke();
  const malformed = [
    ...[undefined, null, 0, "", " ", "bad\0id", new String(bucket.id), coercible].map(id => [[{ ...bucket, id }], [wrapper]]),
    ...[undefined, null, 0, "", " ", "bad\0key", new String(row.name), coercible].flatMap(value => [
      [[bucket], [{ ...row, bucket_id: value }]], [[bucket], [{ ...wrapper, database_row: { ...row, name: value } }]],
    ]),
    [[bucketGetter], [row]], [[inherited], [row]], [[proxy(bucket)], [row]],
    [[bucket], [wrapperGetter]], [[bucket], [proxy(wrapper)]], [[bucket], [{ ...wrapper, database_row: proxy(row) }]],
    ...[null, false, 0, "", [], {}].map(database_row => [[bucket], [{ ...wrapper, database_row }]]),
    [[bucket], [null]], [[bucket], [false]], [[bucket], new Array(1)], [[bucket], indexedGetter],
    [[bucket], extraArray], [[bucket], proxy([row])], [[bucket], revoked.proxy],
    [new Array(1), [row]], [proxy([bucket]), [row]], [null, [row]], [[bucket], null],
    [[bucket], [row, { ...wrapper, database_row: { ...row } }]],
  ];
  for (const [buckets, objects] of malformed) assert.equal(attempt(() => compare(buckets, objects)).error?.message, refusal);
  assert.equal(coercions, 0); assert.equal(getters, 0); assert.equal(traps, 0);
  assert.equal(stableJson({ bucket, row, wrapper }), before);
  console.log(JSON.stringify({ case: "NEW expected-original Storage identity", status: "PASS_PURE_COMPARISON_ONLY",
    original_alias_cases: originalAliases.length, malformed_cases: malformed.length,
    canonical_shapes: ["v3 direct", "v4 database_row", "distinct mixed", "empty"],
    original_row_bytes_metadata_and_owner_semantics: "RETAINED", coercions, getters, traps,
    SQL: "NOT_RUN", provider_calls: 0, old_groups_replayed: 0, resources: 0,
    limits: "No signed-archive admission, current owner access, Storage readback, reconciliation or whole-G31 authority" }));
}
if (process.argv.includes("--storage-expected-original-identity-only")) {
  await storageExpectedOriginalIdentityCases(); process.exit(0);
}

async function storageOriginalIdentityCases(){
 const {stableJson}=await import('./disaster-recovery-crypto.mjs');
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const bytes=Buffer.from('UNIT exact original Storage bytes\0UTF8 café');
 const bucket={id:'unit-bucket',name:'Unit exact bucket',public:false,file_size_limit:4096,
  allowed_mime_types:['application/octet-stream'],created_at:'2026-10-17T00:00:00+00:00'};
 const row={id:'unit-object-id',bucket_id:bucket.id,name:'folder/Unit exact café.bin',owner_id:null,owner:null,
  metadata:{mimetype:'application/octet-stream',size:bytes.length,cacheControl:'3600'},user_metadata:{original:'keep exact'},
  version:'unit-version',created_at:bucket.created_at,updated_at:bucket.created_at,last_accessed_at:bucket.created_at};
 const archived={database_row:row,size_bytes:bytes.length,sha256:hash(bytes)};
 const compare=(actualBuckets,actualObjects)=>compareStorageState({archivedBuckets:[bucket],archivedObjects:[archived],actualBuckets,actualObjects});
 const refusal='Current Storage identities are malformed or ambiguous; verification remains unresolved.';
 const attempt=fn=>{try{return {value:fn()};}catch(error){return {error};}};
 const capture=async(bucketRows,objectRows,afterDownload)=>{
  const trace=[];let value,error;
  const db={async query(sql){
   if(sql==='select row_to_json(b) row from storage.buckets b order by b.id'){trace.push('buckets');return {rows:bucketRows.map(row=>({row}))};}
   if(sql==='select row_to_json(o) row from storage.objects o order by o.bucket_id,o.name,o.id'){trace.push('objects');return {rows:objectRows.map(row=>({row}))};}
   throw new Error('Unexpected recording query; no SQL connection exists');
  }};
  try{value=await captureStorageSupportedState({db,observedAt:new Date(now-500).toISOString(),downloadObject:async(bucketId,name)=>{
   trace.push('bytes');assert.equal(typeof bucketId,'string');assert.equal(typeof name,'string');
   if(afterDownload)afterDownload();return bytes;
  }});}catch(observed){error=observed;}
  return {value,error,trace};
 };
 const now=Date.now(),evidence={format:'memphis-zoo.storage-operator-reconciliation.v2',
  verification_method:'UNIT metadata-only recording, no genuine access proof',verified_at:new Date(now-1000).toISOString(),
  platform_managed_disposition:'PRESERVED',owner_access_results:[]};
 const validate=resample=>validateStorageOperatorEvidence({evidence,discrepancy:{details_json:{discrepancies:[]}},
  manifestUpdatedAt:new Date(now-2000).toISOString(),finalManifestSha256:'a'.repeat(64),
  discrepancySnapshotSha256:'b'.repeat(64),supportedStateResample:resample,now});
 const awaitBoundaryCases=async()=>{
  const mutableBucket={...bucket,id:'second-distinct-unit-bucket'};
  const duringBytes=await capture([bucket,mutableBucket],[{...row}],()=>{mutableBucket.id=bucket.id;});
  assert.equal(duringBytes.error?.message,refusal);assert.equal(duringBytes.value,undefined);
  assert.deepEqual(duringBytes.trace,['buckets','objects','bytes']);
  const mutableRow={...row};const changedIdentity=await capture([bucket],[mutableRow],()=>{mutableRow.name='changed-after-selection';});
  assert.equal(changedIdentity.error?.message,refusal);assert.equal(changedIdentity.value,undefined);
  assert.deepEqual(changedIdentity.trace,['buckets','objects','bytes']);
  console.log(JSON.stringify({scope:'NEW current Storage await-boundary identity refusals',cases:2,
   status:'PASS_LOCAL_RECORDING_PORTS_ONLY',SQL:'NOT_RUN',provider_calls:0,old_groups_replayed:0,resources:0}));
 };
 if(process.argv.includes('--storage-original-identity-await-only')){await awaitBoundaryCases();return;}
 const badBucket={...bucket,public:true},badRow={...row,owner_id:'UNIT_foreign_owner',owner:'UNIT_foreign_owner',metadata:{size:0}};
 const duplicateBuckets=attempt(()=>compare([badBucket,bucket],[row]));
 const duplicateObjects=attempt(()=>compare([bucket],[badRow,row]));
 const duplicateCapture=await capture([badBucket,bucket],[badRow,row]);
 const duplicateEvidence=duplicateCapture.value?attempt(()=>validate(duplicateCapture.value)):null;
 if(!duplicateBuckets.error||!duplicateObjects.error||!duplicateCapture.error||duplicateEvidence&&!duplicateEvidence.error)
  console.log(JSON.stringify({case:'NEW current Storage duplicate alias predecessor',
   duplicate_bucket_difference_count:duplicateBuckets.value?.length,duplicate_object_difference_count:duplicateObjects.value?.length,
   duplicate_capture_object_count:duplicateCapture.value?.state.object_count,
   duplicate_capture_byte_reads:duplicateCapture.trace.filter(x=>x==='bytes').length,
   ambiguous_resample_evidence_accepted:Boolean(duplicateEvidence&&!duplicateEvidence.error),
   limits:'Actual pure functions with inert query/byte ports, NOT provider/SQL/owner/reconciliation authority'}));
 for(const result of [duplicateBuckets,duplicateObjects,duplicateCapture])assert.equal(result.error?.message,refusal,'Duplicate current Storage identities must refuse, not collapse');
 assert.deepEqual(duplicateCapture.trace,['buckets','objects']);assert.equal(duplicateCapture.value,undefined);
 const before=stableJson({bucket,row}),canonical=await capture([bucket],[row]);assert.equal(canonical.error,undefined);
 assert.deepEqual(compare([bucket],[row]),[]);assert.deepEqual(canonical.trace,['buckets','objects','bytes']);
 const {last_accessed_at:_access,...expectedRow}=row;
 assert.deepEqual(canonical.value.state.bucket_rows,[bucket]);assert.deepEqual(canonical.value.state.object_rows,[expectedRow]);
 assert.deepEqual(canonical.value.state.object_byte_digests,[{bucket_id:row.bucket_id,name:row.name,owner_principal_id:null,
  size_bytes:bytes.length,sha256:hash(bytes)}]);
 assert.equal(canonical.value.state.metadata_sha256,hash(stableJson({buckets:[bucket],objects:[expectedRow]})));
 assert.equal(canonical.value.state_sha256,hash(stableJson(canonical.value.state)));
 assert.equal(validate(canonical.value).supported_state_resample_sha256,canonical.value.state_sha256);
 assert.equal(stableJson({bucket,row}),before);
 const owned={...row,owner_id:'UNIT_original_owner',owner:'UNIT_original_owner'};
 const ownedDifferences=compareStorageState({archivedBuckets:[bucket],archivedObjects:[{...archived,database_row:owned}],actualBuckets:[bucket],actualObjects:[owned]});
 assert.equal(ownedDifferences.length,1);assert.equal(ownedDifferences[0].field,'owner_access_boundary');
 const ownedCapture=await capture([bucket],[owned]);assert.equal(ownedCapture.error,undefined);
 assert.equal(ownedCapture.value.state.object_byte_digests[0].owner_principal_id,'UNIT_original_owner');
 console.log('NEW current Storage identity boundary: duplicate aliases refuse before byte reads; exact canonical metadata/bytes/owner and owner-access unresolved semantics preserved (recording only)');
 let coercions=0,getters=0,traps=0;
 const coercible={toString(){coercions++;return bucket.id;},[Symbol.toPrimitive](){coercions++;return bucket.id;}};
 const proxy=new Proxy(bucket,{get(){traps++;throw Error('Identity proxy must not run');},ownKeys(){traps++;throw Error('Identity proxy must not run');}});
 const accessed={...bucket};Object.defineProperty(accessed,'id',{get(){getters++;throw Error('Identity getter must not run');},enumerable:true});
 const invalidBuckets=[{id:0},{id:null},{id:undefined},{id:''},{id:'  '},{id:'unit\0bucket'},{id:new String(bucket.id)},{id:coercible},accessed,proxy];
 const invalidObjects=[{...row,bucket_id:0},{...row,bucket_id:null},{...row,bucket_id:''},{...row,bucket_id:'x\0y'},
  {...row,name:undefined},{...row,name:''},{...row,name:'  '},{...row,name:'x\0y'},{...row,name:new String(row.name)},{...row,name:coercible}];
 for(const actual of invalidBuckets){
  assert.equal(attempt(()=>compare([actual],[row])).error?.message,refusal);
  const sampled=await capture([actual],[row]);assert.equal(sampled.error?.message,refusal);assert.equal(sampled.value,undefined);
  assert.equal(sampled.trace.includes('bytes'),false);
 }
 for(const actual of invalidObjects){
  assert.equal(attempt(()=>compare([bucket],[actual])).error?.message,refusal);
  const sampled=await capture([bucket],[actual]);assert.equal(sampled.error?.message,refusal);assert.equal(sampled.value,undefined);
  assert.equal(sampled.trace.includes('bytes'),false);
 }
 for(const [buckets,objects]of [[[bucket,bucket],[row]],[[bucket],[row,row]],[[bucket],[row,{...row}]],
  [[bucket],new Array(1)],[[bucket],{0:row,length:1}]])assert.equal(attempt(()=>compare(buckets,objects)).error?.message,refusal);
 assert.equal(coercions,0);assert.equal(getters,0);assert.equal(traps,0);
 console.log('NEW malformed current identity refusals: nonprimitive/blank/NUL, duplicate dense rows, holes/nonarrays, accessors/proxies reject without coercion or caller execution');
 const altered=change=>{
  const resample=structuredClone(canonical.value);change(resample.state);
  resample.state.bucket_count=resample.state.bucket_rows.length;resample.state.object_count=resample.state.object_rows.length;
  resample.state.metadata_sha256=hash(stableJson({buckets:resample.state.bucket_rows,objects:resample.state.object_rows}));
  resample.state.object_bytes_sha256=hash(stableJson(resample.state.object_byte_digests));resample.state_sha256=hash(stableJson(resample.state));
  return resample;
 };
 for(const change of [state=>state.bucket_rows.unshift({...bucket,public:true}),state=>state.object_rows.unshift({...expectedRow,owner_id:'UNIT_foreign_owner'}),
  state=>state.object_byte_digests.push({...state.object_byte_digests[0]}),state=>{state.bucket_rows[0].id=7;},
  state=>{state.object_rows[0].name='bad\0name';},state=>{state.object_byte_digests[0].bucket_id=null;}]){
  const resample=altered(change),original=stableJson(resample);
  assert.equal(attempt(()=>validate(resample)).error?.message,refusal);assert.equal(stableJson(resample),original);
 }
 await awaitBoundaryCases();
 console.log(JSON.stringify({scope:'NEW current Storage original identity',status:'PASS_LOCAL_FUNCTIONS_AND_RECORDING_PORTS_ONLY',
  coercions,getters,traps,SQL:'NOT_RUN',provider_calls:0,old_groups_replayed:0,resources:0,
  limits:'No real Storage bytes/owner authentication, reconciliation permission, source/target admission or whole-G31 proof. Ambiguous originals are retained, never deduplicated.'}));
}
if(process.argv.includes('--storage-original-identity-only')||process.argv.includes('--storage-original-identity-await-only')){
 await storageOriginalIdentityCases();process.exit(0);
}

// Newly affected reconciliation fixture consumer only. Exact shipping Source
// plus actual pg constructors; provider port below is recording DATA only.
if(process.argv.includes("--create-reconciliation-local-fixture-only")){
 const {readFileSync}=await import("node:fs");
 const {default:pg}=await import("pg");
 const {isExplicitLocalRestoreFixtureTarget}=await import("./disaster-recovery-storage.mjs");
 const source=readFileSync(new URL("./create-production-restore-reconciliation.mjs",import.meta.url),"utf8");
 assert.match(source,/import \{\s*captureStorageSupportedState,\s*isExplicitLocalRestoreFixtureTarget,\s*validateStorageOperatorEvidence,\s*\} from "\.\/disaster-recovery-storage\.mjs";/);
 const guardStart=source.indexOf("\nif (testStorageBytes && !isExplicitLocalRestoreFixtureTarget(databaseUrl)) {");
 const factoryStart=source.indexOf("function makeStorageDownloader() {");
 const factoryEnd=source.indexOf("function discrepancySnapshot(rows)",factoryStart);
 const clientStart=source.indexOf("const db = new Client({");
 const clientEnd=source.indexOf("\nif (statusMode) {",clientStart);
 const normalizationEnd=source.indexOf("\n  return rows;\n}",source.indexOf("function normalizeResolutions(value)"));
 assert.ok(normalizationEnd>=0&&guardStart>normalizationEnd&&factoryStart>guardStart
  &&factoryEnd>factoryStart&&clientStart>factoryEnd&&clientEnd>clientStart,"Original preconnect/factory/Client Source boundaries required");
 const factory=source.slice(factoryStart,factoryEnd);
 const actual=source.slice(guardStart,factoryStart)+factory+source.slice(clientStart,clientEnd);
 assert.equal(actual.includes("signBinding"),false);
 assert.equal(actual.includes("randomUUID"),false);
 const prepare=new Function("databaseUrl","testStorageBytes","storageSecret","projectRef","createClient",
  "Client","isExplicitLocalRestoreFixtureTarget","databaseCaCertPath",
  actual+"\nreturn {db,makeStorageDownloader};");
 const uri=(host="localhost",scheme="postgresql:",port="")=>
  scheme+"//UNIT_ONLY:UNIT_ONLY_NOT_A_SECRET@"+host+port+"/mz_schema_rebuild_UNIT";
 const payload=Buffer.from("UNIT_ORIGINAL_STORAGE_BYTES");
 const fixture=JSON.stringify({"unit-bucket\0unit-object":payload.toString("base64")});
 const project="abcdefghijklmnopqrst",refusal="Storage-byte fixtures require an explicit loopback mz_schema_rebuild_* PostgreSQL target without URI overrides.";
 let accepted=0,denied=0,constructed=0,ended=0,providerControls=0;
 const attempt=(url,bytes,secret)=>{
  const trace={clients:[],provider:0,downloads:0};
  const Client=function(options){
   constructed++;const client=new pg.Client(options);trace.clients.push(client);return client;
  };
  const createClient=(endpoint,key,options)=>{
   trace.provider++;assert.equal(endpoint,"https://"+project+".supabase.co");
   assert.ok(key===secret,"Unexpected recording provider credential");
   assert.deepEqual(options,{auth:{persistSession:false,autoRefreshToken:false}});
   return {storage:{from(bucket){assert.equal(bucket,"unit-bucket");return {async download(name){
    trace.downloads++;assert.equal(name,"unit-object");
    return {error:null,data:{async arrayBuffer(){return Uint8Array.from(payload).buffer;}}};
   }};}}};
  };
  let value,error;
  try{value=prepare(url,bytes,secret,project,createClient,Client,isExplicitLocalRestoreFixtureTarget,"");}
  catch(observed){error=observed;}
  return {trace,value,error};
 };
 const close=async result=>{
  for(const client of result.trace.clients){
   assert.equal(client._connected,false);await pg.Client.prototype.end.call(client);ended++;
  }
 };
 for(const [url,host,port] of [[uri(),"localhost",undefined],[uri("127.0.0.1","postgres:",":5433"),"127.0.0.1",5433]]){
  const result=attempt(url,fixture,"UNIT_ONLY_RECORDING_PROVIDER");
  try{
   assert.equal(result.error,undefined);
   const params=result.value.db.connectionParameters;
   assert.equal(params.host,host);assert.equal(params.database,"mz_schema_rebuild_UNIT");
   if(port!==undefined)assert.equal(params.port,port);
   assert.ok(params.user==="UNIT_ONLY"&&params.password==="UNIT_ONLY_NOT_A_SECRET","Native credential identity differs");
   const bytes=await result.value.makeStorageDownloader()("unit-bucket","unit-object");
   assert.ok(bytes.equals(payload));assert.equal(result.trace.provider,0);assert.equal(result.trace.downloads,0);accepted++;
  }finally{await close(result);}
 }
 for(const url of [
  uri()+"?host=not-a-local-target.invalid",uri()+"?hostaddr=192.0.2.1",uri()+"?dbname=other",
  uri()+"?%68ost=not-a-local-target.invalid",uri()+"?host=localhost&host=not-a-local-target.invalid",
  uri()+"?options=-csearch_path%3Dpublic",uri()+"?sslcert=UNIT_ONLY_MUST_NOT_READ",
  uri()+"?",uri()+"#",uri()+"#fragment",uri("not-a-local-target.invalid"),uri("[::1]"),
  uri("localhost","https:"),uri().replace("/mz_schema_rebuild_UNIT","/postgres"),"not a valid URI",
 ]){
  const result=attempt(url,"UNPARSED_FIXTURE_MUST_NOT_REACH_JSON_OR_PROVIDER","UNIT_ONLY_RECORDING_PROVIDER");
  try{
   assert.equal(result.error?.message,refusal);
   assert.equal(Object.hasOwn(result.error,"input"),false);
   assert.equal(result.trace.clients.length,0,"Invalid fixture target reached native constructor");
   assert.equal(result.trace.provider,0);assert.equal(result.trace.downloads,0);denied++;
  }finally{await close(result);}
 }
 // Empty fixture data keeps the existing genuine-provider branch. Only its
 // recording external port is used; no real SDK provider/auth/network call.
 {
  const result=attempt(uri("not-a-local-target.invalid"),"","UNIT_ONLY_RECORDING_PROVIDER");
  try{
   assert.equal(result.error,undefined);
   const bytes=await result.value.makeStorageDownloader()("unit-bucket","unit-object");
   assert.ok(bytes.equals(payload));assert.equal(result.trace.provider,1);assert.equal(result.trace.downloads,1);providerControls++;
  }finally{await close(result);}
 }
 {
  const result=attempt(uri("not-a-local-target.invalid"),"","");
  try{
   assert.equal(result.error,undefined);
   assert.throws(()=>result.value.makeStorageDownloader(),/required to resample current Storage object bytes/);
   assert.equal(result.trace.provider,0);assert.equal(result.trace.downloads,0);providerControls++;
  }finally{await close(result);}
 }
 assert.equal(constructed,ended);
 console.log(JSON.stringify({scope:"NEW create reconciliation local fixture consumer",status:"PASS_SOURCE_AND_NATIVE_NO_CONNECT",
  accepted,denied,unchanged_provider_controls:providerControls,native_clients_constructed:constructed,native_clients_ended:ended,
  connects:0,queries:0,signatures:0,real_provider_calls:0,
  limits:"Actual released guard/downloader/Client-construction Source plus sealed selector; recording provider only, no signing/auth/SQL/network or recovery authority."}));
 process.exit(0);
}

assert.deepEqual(storageBucketOptions({ public: false, file_size_limit: 4096, allowed_mime_types: ["image/png"] }), {
  public: false,
  fileSizeLimit: 4096,
  allowedMimeTypes: ["image/png"],
});
assert.deepEqual(storageObjectUploadOptions({ database_row: { metadata: { mimetype: "image/png", cacheControl: "3600" }, user_metadata: { ticket: "T-7" } } }), {
  upsert: true,
  contentType: "image/png",
  cacheControl: "3600",
  metadata: { ticket: "T-7" },
});
assert.equal(storageOwnerPrincipalId({ owner_id: "", owner: "employee-1" }), "employee-1",
  "a blank owner_id cannot mask a populated legacy owner");
assert.throws(() => storageOwnerPrincipalId({ owner_id: 123, owner: 123 }),
  /null or strings/i, "owner values cannot be string-coerced from arbitrary signed JSON scalars");
assert.throws(() => storageOwnerPrincipalId({ owner_id: "employee-1", owner: "employee-3" }),
  /one unambiguous principal/i, "conflicting populated owner columns must fail closed");
const v4ArchiveRow = {
  id: "v4-object-id", bucket_id: "private", name: "v4-proof.bin",
  owner_id: "employee-1", owner: "employee-1", metadata: { size: 8 }, user_metadata: null,
  version: "v4-version", created_at: "2026-08-27T00:00:00+00:00", updated_at: "2026-08-27T00:00:00+00:00",
  last_accessed_at: "2026-08-27T00:00:00+00:00",
};
const v4ArchiveObject = {
  id: v4ArchiveRow.id, bucket_id: v4ArchiveRow.bucket_id, name: v4ArchiveRow.name,
  file: storageObjectArchivePath(v4ArchiveRow.bucket_id, v4ArchiveRow.name), size_bytes: 8,
  sha256: createHash("sha256").update("v4-proof").digest("hex"),
  metadata: v4ArchiveRow.metadata, user_metadata: v4ArchiveRow.user_metadata, version: v4ArchiveRow.version,
  created_at: v4ArchiveRow.created_at, updated_at: v4ArchiveRow.updated_at,
  database_row: v4ArchiveRow,
};
assert.doesNotThrow(() => validateV4StorageArchiveObjects([v4ArchiveObject]));
assert.throws(() => validateV4StorageArchiveObjects([{ ...v4ArchiveObject, database_row: undefined }]),
  /complete database_row/i, "a v3-shaped wrapper cannot be relabeled as a restore-compatible v4 object");
const { owner: _missingLegacyOwner, ...rowWithoutOwner } = v4ArchiveRow;
assert.throws(() => validateV4StorageArchiveObjects([{ ...v4ArchiveObject, database_row: rowWithoutOwner }]),
  /exact row or byte identity/i, "v4 must bind both ownership columns, including an explicit null value");
assert.throws(() => validateV4StorageArchiveObjects([{ ...v4ArchiveObject, name: "wrapper-drift.bin" }]),
  /wrapper disagrees/i, "the v4 wrapper cannot disagree with its archived database row");
assert.throws(() => validateV4StorageArchiveObjects([{ ...v4ArchiveObject, file: "backup-summary.json" }]),
  /deterministic producer archive path/i, "a checksummed control file cannot be substituted for Storage object bytes");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, database_row: { ...v4ArchiveRow, owner_id: 123, owner: 123 },
}]), /owner fields must be null or nonblank strings/i, "numeric owner fields cannot become synthetic string principals");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, database_row: { ...v4ArchiveRow, owner_id: "", owner: "employee-1" },
}]), /owner fields must be null or nonblank strings/i, "v4 producer rows must use null rather than blank owner values");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, metadata: [], database_row: { ...v4ArchiveRow, metadata: [] },
}]), /non-producer-shaped row value/i, "Storage metadata must be a JSON object or null");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, version: 7, database_row: { ...v4ArchiveRow, version: 7 },
}]), /non-producer-shaped row value/i, "Storage version cannot be an arbitrary JSON scalar");
assert.throws(() => validateV4StorageArchiveObjects([{
  ...v4ArchiveObject, updated_at: "not-a-date", database_row: { ...v4ArchiveRow, updated_at: "not-a-date" },
}]), /non-producer-shaped row value/i, "Storage timestamps must retain producer timestamp strings");
for (const timestamp of [
  "0", "Aug 27 2026", "2026-08-27", "2026-08-27T00:00:00Z", "2026-02-30T00:00:00+00:00",
  "2026-08-27T00:00:00.0+00:00", "2026-08-27T00:00:00.123400+00:00", "2026-08-27T00:00:00-00:00",
]) {
  assert.throws(() => validateV4StorageArchiveObjects([{
    ...v4ArchiveObject, updated_at: timestamp, database_row: { ...v4ArchiveRow, updated_at: timestamp },
  }]), /PostgreSQL row_to_json timestamp/i,
  `JavaScript-parseable non-producer timestamp ${timestamp} must fail exact v4 admission`);
}
for (const timestamp of [
  "2026-08-27T00:00:00+00:00", "2026-08-27T00:00:00.1+00:00", "2026-08-27T00:00:00.123456-05:00",
]) {
  const row = { ...v4ArchiveRow, updated_at: timestamp };
  assert.doesNotThrow(() => validateV4StorageArchiveObjects([{
    ...v4ArchiveObject, updated_at: timestamp, database_row: row,
  }]), `canonical PostgreSQL row_to_json timestamp ${timestamp} must remain admissible`);
}
assert.throws(() => validateV4StorageArchiveObjects([v4ArchiveObject, v4ArchiveObject]),
  /duplicate object, database id, or archive file identity/i, "duplicate object and file identities must fail admission");

const archivedBucket = { id: "private", name: "private", public: false, file_size_limit: 4096, allowed_mime_types: ["image/png"], created_at: "before" };
const archivedObject = { database_row: { id: "old-id", bucket_id: "private", name: "a.png", owner_id: "employee-1", metadata: { mimetype: "image/png", cacheControl: "3600", size: 4 }, user_metadata: { ticket: "T-7" }, version: "old-version" } };
const differences = compareStorageState({
  archivedBuckets: [archivedBucket],
  archivedObjects: [archivedObject],
  actualBuckets: [{ ...archivedBucket, created_at: "after" }, { id: "target-only" }],
  actualObjects: [{ ...archivedObject.database_row, id: "new-id", owner_id: null, version: "new-version" }, { bucket_id: "target-only", name: "extra.bin" }],
});
assert.ok(differences.some((item) => item.field === "created_at" && item.support === "platform_managed"));
assert.ok(differences.some((item) => item.field === "owner_id" && item.support === "platform_managed_or_owner"));
assert.ok(differences.some((item) => item.field === "target_only" && item.scope === "bucket"));
assert.ok(differences.some((item) => item.field === "target_only" && item.scope === "object"));

const exactOwner = compareStorageState({
  archivedBuckets: [{ id: "private", public: false }],
  archivedObjects: [archivedObject],
  actualBuckets: [{ id: "private", public: false }],
  actualObjects: [archivedObject.database_row],
});
assert.ok(exactOwner.some((item) => item.field === "owner_access_boundary"), "owner equality alone cannot prove owner-scoped Storage access");
assert.ok(exactOwner.every((item) => !String(item.key).includes("\0")), "persisted Storage discrepancy identities cannot contain PostgreSQL-jsonb-incompatible NUL characters");
assert.deepEqual(JSON.parse(exactOwner.find((item) => item.scope === "object").key), ["private", "a.png"]);

// Synthetic default-test SQL response DATA for the current lossless sampler.
// This models catalog/raw/native-text projections; it is not native SQL proof.
function defaultStorageSamplerFixtureDb(state) {
  const types = { public: ['16', 'bool'], metadata: ['3802', 'jsonb'] };
  const columns = ['buckets', 'objects'].flatMap((table, tableIndex) =>
    Object.keys(state[table][0]).map((name, index) => {
      const [type_oid, type_name] = types[name] || ['25', 'text'];
      return { table_name: table, relation_oid: String(31000 + tableIndex), owner: '10', namespace_owner: '10',
        ordinal: String(index + 1), name, type_oid, type_name, type_kind: 'b', type_namespace: 'pg_catalog',
        modifier: '-1', input_oid: '100', output_oid: '101', input_source: 'UNIT native input observation',
        output_source: 'UNIT native output observation', native_io: 'true', visible: 'true', shape: 'true',
        database_oid: '16000', backend_pid: '4321', actor: 'UNIT original owner', session_actor: 'UNIT original owner',
        isolation: 'repeatable read', snapshot: '100:200:', date_style: 'ISO, MDY', timezone: 'UTC', float_digits: '3' };
    }));
  return { async query(sql) {
    if (sql.includes('from pg_catalog.pg_class c'))
      return { command: 'SELECT', rowCount: columns.length, rows: columns.map(column => ({ descriptor: JSON.stringify(column) })) };
    const table = sql.includes('from "storage"."buckets"') ? 'buckets'
      : sql.includes('from "storage"."objects"') ? 'objects' : null;
    if (!table) throw new Error(`Unexpected query ${sql}`);
    const rows = state[table].map(row => ({ row: JSON.stringify(row),
      native_text: JSON.stringify(Object.fromEntries(Object.entries(row).map(([name, value]) =>
        [name, value === null ? null : name === 'metadata' ? JSON.stringify(value) : String(value)]))) }));
    return { command: 'SELECT', rowCount: rows.length, rows };
  } };
}

const bytes = Buffer.from("exact current bytes");
const currentRows = {
  buckets: [{ id: "private", public: false }],
  objects: [{ id: "UNIT-current-object", bucket_id: "private", name: "a.png", owner_id: "employee-1", metadata: { size: bytes.length } }],
};
const db = defaultStorageSamplerFixtureDb(currentRows);
const resample = await captureStorageSupportedState({ db, downloadObject: async () => bytes });
const unownedRows = {
  buckets: currentRows.buckets,
  objects: [{ ...currentRows.objects[0], owner_id: null }],
};
const unownedDb = defaultStorageSamplerFixtureDb(unownedRows);
const unownedResample = await captureStorageSupportedState({ db: unownedDb, downloadObject: async () => bytes });
assert.equal(resample.state.object_byte_digests[0].size_bytes, bytes.length);
assert.match(resample.state.object_byte_digests[0].sha256, /^[0-9a-f]{64}$/);
const manifestUpdatedAt = new Date(Date.now() - 5_000).toISOString();
const verifiedAt = new Date(Date.now() - 1_000).toISOString();
const discrepancy = { details_json: { discrepancies: [{ scope: "object", key: '["private","a.png"]', bucket_id: "private", name: "a.png", field: "owner_access_boundary" }] } };
const operatorEvidence = {
  format: "memphis-zoo.storage-operator-reconciliation.v2",
  verification_method: "Authenticated exact owner and non-owner reads of the named object.",
  verified_at: verifiedAt,
  platform_managed_disposition: "PRESERVED",
  owner_access_results: [{
    bucket_id: "private", name: "a.png", owner_principal_id: "employee-1",
    non_owner_principal_id: "employee-2",
    owner_read_succeeded: true, non_owner_read_denied: true, tested_at: verifiedAt,
    evidence_reference: "Exact owner read succeeded and the named non-owner read was denied by Storage.",
  }],
};
const boundEvidence = validateStorageOperatorEvidence({
  evidence: operatorEvidence,
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
});
assert.equal(boundEvidence.supported_state_resample_sha256, resample.state_sha256);
validateStorageOperatorEvidence({
  evidence: boundEvidence,
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
  requireBindings: true,
});
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...operatorEvidence, verified_at: "2000-01-01T00:00:00.000Z" },
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
}), /current v2 proof/, "stale operator prose cannot reopen Storage admission");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: operatorEvidence,
  discrepancy: { details_json: { discrepancies: [{
    scope: "object", key: '["private","a.png"]', bucket_id: "private", name: "a.png",
    field: "owner_id", expected: "employee-1", actual: null,
  }] } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: unownedResample,
}), /ownership must be restored/i, "a changed or missing owner cannot be described as preserved or bypass named access proof");
assert.doesNotThrow(() => validateStorageOperatorEvidence({
  evidence: operatorEvidence,
  discrepancy: { details_json: { discrepancies: [{
    scope: "object", key: '["private","a.png"]', bucket_id: "private", name: "a.png",
    field: "owner_id", expected: "employee-1", actual: null,
  }] } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
}), "a repaired owner must advance to exact named owner/non-owner proof instead of dead-ending on historical discrepancy state");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...operatorEvidence, owner_access_results: [{
    ...operatorEvidence.owner_access_results[0], non_owner_principal_id: "employee-1",
  }] },
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
}), /current named owner\/non-owner access result/i, "the denied principal must be named and distinct from the owner");
const archivedMissingBytes = Buffer.from("signed archived bytes");
const replacementBytes = Buffer.from("different replacement bytes");
const archivedMissingRow = {
  id: "archived-id", bucket_id: "private", name: "lost.png", owner_id: "employee-1", owner: "employee-1",
  metadata: { size: archivedMissingBytes.length, mimetype: "image/png" }, version: "archived-version",
};
const missingDifferences = compareStorageState({
  archivedBuckets: currentRows.buckets,
  archivedObjects: [{
    database_row: archivedMissingRow,
    sha256: createHash("sha256").update(archivedMissingBytes).digest("hex"),
    size_bytes: archivedMissingBytes.length,
  }],
  actualBuckets: currentRows.buckets,
  actualObjects: [],
});
assert.match(missingDifferences[0].expected_object_sha256, /^[0-9a-f]{64}$/,
  "a missing-object discrepancy must retain the signed archived byte identity");
const replacementRows = {
  buckets: currentRows.buckets,
  objects: [{ ...archivedMissingRow, id: "replacement-id", metadata: { size: replacementBytes.length }, version: "replacement-version" }],
};
const replacementDb = defaultStorageSamplerFixtureDb(replacementRows);
const replacementResample = await captureStorageSupportedState({ db: replacementDb, downloadObject: async () => replacementBytes });
const defaultExactNativeRecheckHeld = error => error.code === 'STORAGE_EXACT_RECONCILIATION_HELD'
  && error.retry_safe === false && error.message === 'Storage reconciliation is held pending a same-original current native exact-table recheck.';
const missingObjectEvidence = {
  ...operatorEvidence,
  owner_access_results: [{ ...operatorEvidence.owner_access_results[0], name: "lost.png" }],
};
assert.throws(() => validateStorageOperatorEvidence({
  evidence: missingObjectEvidence,
  discrepancy: { details_json: { discrepancies: missingDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: replacementResample,
  reconciliationDisposition: "RESOLVED",
}), defaultExactNativeRecheckHeld,
"a same-key replacement remains held for native exact-table recheck before RESOLVED");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...missingObjectEvidence, platform_managed_disposition: "ACCEPTED_LOSS" },
  discrepancy: { details_json: { discrepancies: missingDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: replacementResample,
  reconciliationDisposition: "ACCEPTED_LOSS",
}), defaultExactNativeRecheckHeld, "explicit ACCEPTED_LOSS cannot bypass the native exact-table recheck for replacement DATA");
const wrongOwnerRows = {
  buckets: currentRows.buckets,
  objects: [{ ...replacementRows.objects[0], owner_id: "employee-3", owner: "employee-3" }],
};
const wrongOwnerDb = defaultStorageSamplerFixtureDb(wrongOwnerRows);
const wrongOwnerResample = await captureStorageSupportedState({ db: wrongOwnerDb, downloadObject: async () => replacementBytes });
assert.throws(() => validateStorageOperatorEvidence({
  evidence: {
    ...missingObjectEvidence,
    platform_managed_disposition: "ACCEPTED_LOSS",
    owner_access_results: [{
      ...missingObjectEvidence.owner_access_results[0], owner_principal_id: "employee-3",
    }],
  },
  discrepancy: { details_json: { discrepancies: missingDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: wrongOwnerResample,
  reconciliationDisposition: "ACCEPTED_LOSS",
}), defaultExactNativeRecheckHeld, "ACCEPTED_LOSS cannot bypass native exact recheck for a replacement under the wrong owner");
const wrongLegacyOwnerRows = {
  buckets: currentRows.buckets,
  objects: [{ ...replacementRows.objects[0], owner_id: "employee-1", owner: "employee-3" }],
};
const wrongLegacyOwnerDb = defaultStorageSamplerFixtureDb(wrongLegacyOwnerRows);
let wrongLegacyOwnerDownloads = 0;
await assert.rejects(
  () => captureStorageSupportedState({ db: wrongLegacyOwnerDb, downloadObject: async () => {
    wrongLegacyOwnerDownloads++; return replacementBytes;
  } }),
  error => error.code === 'STORAGE_SUPPORTED_STATE_UNAVAILABLE' && error.retry_safe === false
    && error.storage_sample_phase === 'CURRENTNESS' && error.storage_sample_reason === 'READ_OR_PROFILE_UNAVAILABLE',
  "a replacement whose owner_id matches while legacy owner drifts must fail before access evidence or ACCEPTED_LOSS",
);
assert.equal(wrongLegacyOwnerDownloads, 0, 'ambiguous owner must refuse before the first object download');
const legacyOnlyArchivedRow = { ...archivedMissingRow, owner_id: "", owner: "employee-1" };
const legacyOnlyDifferences = compareStorageState({
  archivedBuckets: currentRows.buckets,
  archivedObjects: [{
    database_row: legacyOnlyArchivedRow,
    sha256: createHash("sha256").update(archivedMissingBytes).digest("hex"),
    size_bytes: archivedMissingBytes.length,
  }],
  actualBuckets: currentRows.buckets,
  actualObjects: [],
});
const legacyOnlyRows = {
  buckets: currentRows.buckets,
  objects: [{ ...legacyOnlyArchivedRow, metadata: { size: replacementBytes.length }, version: "replacement-version" }],
};
const legacyOnlyDb = defaultStorageSamplerFixtureDb(legacyOnlyRows);
const legacyOnlyResample = await captureStorageSupportedState({ db: legacyOnlyDb, downloadObject: async () => replacementBytes });
assert.equal(legacyOnlyResample.state.object_byte_digests[0].owner_principal_id, "employee-1");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...missingObjectEvidence, platform_managed_disposition: "ACCEPTED_LOSS", owner_access_results: [] },
  discrepancy: { details_json: { discrepancies: legacyOnlyDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: legacyOnlyResample,
  reconciliationDisposition: "ACCEPTED_LOSS",
}), defaultExactNativeRecheckHeld,
"a populated legacy owner cannot bypass native exact recheck for replacement DATA even when owner_id is blank");
const exactRestoredRows = { buckets: currentRows.buckets, objects: [archivedMissingRow] };
const exactRestoredDb = defaultStorageSamplerFixtureDb(exactRestoredRows);
const exactRestoredResample = await captureStorageSupportedState({ db: exactRestoredDb, downloadObject: async () => archivedMissingBytes });
assert.throws(() => validateStorageOperatorEvidence({
  evidence: missingObjectEvidence,
  discrepancy: { details_json: { discrepancies: missingDifferences } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: exactRestoredResample,
  reconciliationDisposition: "RESOLVED",
}), defaultExactNativeRecheckHeld, "parsed byte-and-row equality cannot clear a historical presence discrepancy without current native exact-table recheck");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: { ...operatorEvidence, owner_access_results: [] },
  discrepancy: { details_json: { discrepancies: [{
    scope: "object", key: '["private","absent.png"]', bucket_id: "private", name: "absent.png",
    field: "user_metadata", support: "supported", expected: null, actual: { prior: true },
  }] } },
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: resample,
  reconciliationDisposition: "RESOLVED",
}), defaultExactNativeRecheckHeld, "an absent row cannot satisfy historical supported DATA whose expected value happened to be null");
assert.throws(() => validateStorageOperatorEvidence({
  evidence: operatorEvidence,
  discrepancy,
  manifestUpdatedAt,
  finalManifestSha256: "a".repeat(64),
  discrepancySnapshotSha256: "b".repeat(64),
  supportedStateResample: { ...resample, state: { ...resample.state, object_count: 999 } },
}), /current v2 proof/i, "the current supported-state rows and counts must remain bound by their exact digest");

console.log("DISASTER_RECOVERY_STORAGE_TESTS_PASS");
}
