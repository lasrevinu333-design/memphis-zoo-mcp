// Explicit backup_only qualification: unmodified official Storage API, same
// signed original DB, archived FileBackend versions. Never a production target.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, mkdirSync, mkdtempSync, rmSync, statSync, lstatSync, realpathSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { isProxy } from 'node:util/types';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createServer, createConnection, isIP } from 'node:net';

export const IMAGE = 'public.ecr.aws/supabase/storage-api@sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd';
const MIRROR_IMAGE = 'docker.io/supabase/storage-api@sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd';
const PG_IMAGE = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const CAP = 1024 * 1024, WORK_MS = 900000;
// Exact source contract: official528 compiled loader metadata, plus the
// authenticated native74 tail. This selects a supported startup boundary;
// it never deletes/renames/skips verification of any restored migration row.
const OFFICIAL_528_PREFIX63=Object.freeze([{"id":0,"name":"create-migrations-table","hash":"e18db593bcde2aca2a408c4d1100f6abba2195df"},{"id":1,"name":"initialmigration","hash":"6ab16121fbaa08bbd11b712d05f358f9b555d777"},{"id":2,"name":"storage-schema","hash":"f6a1fa2c93cbcd16d4e487b362e45fca157a8dbd"},{"id":3,"name":"pathtoken-column","hash":"2cb1b0004b817b29d5b0a971af16bafeede4b70d"},{"id":4,"name":"add-migrations-rls","hash":"427c5b63fe1c5937495d9c635c263ee7a5905058"},{"id":5,"name":"add-size-functions","hash":"79e081a1455b63666c1294a440f8ad4b1e6a7f84"},{"id":6,"name":"change-column-name-in-get-size","hash":"ded78e2f1b5d7e616117897e6443a925965b30d2"},{"id":7,"name":"add-rls-to-buckets","hash":"e7e7f86adbc51049f341dfe8d30256c1abca17aa"},{"id":8,"name":"add-public-to-buckets","hash":"fd670db39ed65f9d08b01db09d6202503ca2bab3"},{"id":9,"name":"fix-search-function","hash":"af597a1b590c70519b464a4ab3be54490712796b"},{"id":10,"name":"search-files-search-function","hash":"b595f05e92f7e91211af1bbfe9c6a13bb3391e16"},{"id":11,"name":"add-trigger-to-auto-update-updated_at-column","hash":"7425bdb14366d1739fa8a18c83100636d74dcaa2"},{"id":12,"name":"add-automatic-avif-detection-flag","hash":"8e92e1266eb29518b6a4c5313ab8f29dd0d08df9"},{"id":13,"name":"add-bucket-custom-limits","hash":"cce962054138135cd9a8c4bcd531598684b25e7d"},{"id":14,"name":"use-bytes-for-max-size","hash":"941c41b346f9802b411f06f30e972ad4744dad27"},{"id":15,"name":"add-can-insert-object-function","hash":"934146bc38ead475f4ef4b555c524ee5d66799e5"},{"id":16,"name":"add-version","hash":"76debf38d3fd07dcfc747ca49096457d95b1221b"},{"id":17,"name":"drop-owner-foreign-key","hash":"f1cbb288f1b7a4c1eb8c38504b80ae2a0153d101"},{"id":18,"name":"add_owner_id_column_deprecate_owner","hash":"e7a511b379110b08e2f214be852c35414749fe66"},{"id":19,"name":"alter-default-value-objects-id","hash":"02e5e22a78626187e00d173dc45f58fa66a4f043"},{"id":20,"name":"list-objects-with-delimiter","hash":"cd694ae708e51ba82bf012bba00caf4f3b6393b7"},{"id":21,"name":"s3-multipart-uploads","hash":"8c804d4a566c40cd1e4cc5b3725a664a9303657f"},{"id":22,"name":"s3-multipart-uploads-big-ints","hash":"9737dc258d2397953c9953d9b86920b8be0cdb73"},{"id":23,"name":"optimize-search-function","hash":"9d7e604cddc4b56a5422dc68c9313f4a1b6f132c"},{"id":24,"name":"operation-function","hash":"8312e37c2bf9e76bbe841aa5fda889206d2bf8aa"},{"id":25,"name":"custom-metadata","hash":"d974c6057c3db1c1f847afa0e291e6165693b990"},{"id":26,"name":"objects-prefixes","hash":"215cabcb7f78121892a5a2037a09fedf9a1ae322"},{"id":27,"name":"search-v2","hash":"859ba38092ac96eb3964d83bf53ccc0b141663a6"},{"id":28,"name":"object-bucket-name-sorting","hash":"c73a2b5b5d4041e39705814fd3a1b95502d38ce4"},{"id":29,"name":"create-prefixes","hash":"ad2c1207f76703d11a9f9007f821620017a66c21"},{"id":30,"name":"update-object-levels","hash":"2be814ff05c8252fdfdc7cfb4b7f5c7e17f0bed6"},{"id":31,"name":"objects-level-index","hash":"b40367c14c3440ec75f19bbce2d71e914ddd3da0"},{"id":32,"name":"backward-compatible-index-on-objects","hash":"e0c37182b0f7aee3efd823298fb3c76f1042c0f7"},{"id":33,"name":"backward-compatible-index-on-prefixes","hash":"b480e99ed951e0900f033ec4eb34b5bdcb4e3d49"},{"id":34,"name":"optimize-search-function-v1","hash":"ca80a3dc7bfef894df17108785ce29a7fc8ee456"},{"id":35,"name":"add-insert-trigger-prefixes","hash":"458fe0ffd07ec53f5e3ce9df51bfdf4861929ccc"},{"id":36,"name":"optimise-existing-functions","hash":"6ae5fca6af5c55abe95369cd4f93985d1814ca8f"},{"id":37,"name":"add-bucket-name-length-trigger","hash":"3944135b4e3e8b22d6d4cbb568fe3b0b51df15c1"},{"id":38,"name":"iceberg-catalog-flag-on-buckets","hash":"02716b81ceec9705aed84aa1501657095b32e5c5"},{"id":39,"name":"add-search-v2-sort-support","hash":"6706c5f2928846abee18461279799ad12b279b78"},{"id":40,"name":"fix-prefix-race-conditions-optimized","hash":"7ad69982ae2d372b21f48fc4829ae9752c518f6b"},{"id":41,"name":"add-object-level-update-trigger","hash":"07fcf1a22165849b7a029deed059ffcde08d1ae0"},{"id":42,"name":"rollback-prefix-triggers","hash":"771479077764adc09e2ea2043eb627503c034cd4"},{"id":43,"name":"fix-object-level","hash":"84b35d6caca9d937478ad8a797491f38b8c2979f"},{"id":44,"name":"vector-bucket-type","hash":"99c20c0ffd52bb1ff1f32fb992f3b351e3ef8fb3"},{"id":45,"name":"vector-buckets","hash":"049e27196d77a7cb76497a85afae669d8b230953"},{"id":46,"name":"buckets-objects-grants","hash":"fedeb96d60fefd8e02ab3ded9fbde05632f84aed"},{"id":47,"name":"iceberg-table-metadata","hash":"649df56855c24d8b36dd4cc1aeb8251aa9ad42c2"},{"id":48,"name":"iceberg-catalog-ids","hash":"e0e8b460c609b9999ccd0df9ad14294613eed939"},{"id":49,"name":"buckets-objects-grants-postgres","hash":"072b1195d0d5a2f888af6b2302a1938dd94b8b3d"},{"id":50,"name":"search-v2-optimised","hash":"6323ac4f850aa14e7387eb32102869578b5bd478"},{"id":51,"name":"index-backward-compatible-search","hash":"2ee395d433f76e38bcd3856debaf6e0e5b674011"},{"id":52,"name":"drop-not-used-indexes-and-functions","hash":"5cc44c8696749ac11dd0dc37f2a3802075f3a171"},{"id":53,"name":"drop-index-lower-name","hash":"d0cb18777d9e2a98ebe0bc5cc7a42e57ebe41854"},{"id":54,"name":"drop-index-object-level","hash":"6289e048b1472da17c31a7eba1ded625a6457e67"},{"id":55,"name":"prevent-direct-deletes","hash":"262a4798d5e0f2e7c8970232e03ce8be695d5819"},{"id":56,"name":"fix-optimized-search-function","hash":"b823ed1e418101032fa01374edc9a436e54e3ed4"},{"id":57,"name":"s3-multipart-uploads-metadata","hash":"f127886e00d1b374fadbc7c6b31e09336aad5287"},{"id":58,"name":"operation-ergonomics","hash":"00ca5d483b3fe0d522133d9002ccc5df98365120"},{"id":59,"name":"drop-unused-functions","hash":"38456f13e39691c2bbb4b5151d0d1cdbabd4a8c4"},{"id":60,"name":"optimize-existing-functions-again","hash":"db35e1c91a9201e59f4fef8d972c2f277d68b157"},{"id":61,"name":"mark-filename-immutable","hash":"fe0096517ae9d60aaec1d110172ba9036dc66bb7"},{"id":62,"name":"object-versioning-core","hash":"0b855f00ff3be0bfca91efee02a9858912491a9a"}].map(row=>Object.freeze(row)));
const AUTHENTICATED_NATIVE74_TAIL=Object.freeze([{"id":63,"name":"fix-search-name-relative-to-prefix","hash":"c7485e417624f795ce8bb2da21927f48e088904d"},{"id":64,"name":"fix-search-by-timestamp-sqli","hash":"0af424ecd388a39bb1645184b222185a12149675"},{"id":65,"name":"objects-key-version-index","hash":"da319c4b89ba800ce795d1b699f3a70675138058"},{"id":66,"name":"objects-current-version-index","hash":"191466c93aa2c46a00e36505577c5fcab8d7cb4b"},{"id":67,"name":"objects-null-version-index","hash":"15bfe8c35b66642b6c78ba60060fa8793bd2207a"},{"id":68,"name":"bucket-lifecycle-configuration","hash":"3c08f6f889922f399519722a932b51007c11bebc"},{"id":69,"name":"validate-bucket-lifecycle-constraints","hash":"4febacaaaa0e61e2b783bef081fe03a287e65eb3"},{"id":70,"name":"list-objects-with-versions","hash":"5c17c3777616cd8d7b18b82835525fa3205af57b"},{"id":71,"name":"objects-delete-marker-index","hash":"6d14858e66c66f8d6accf8a2630aefd1527fddba"},{"id":72,"name":"drop-bucketid-objname-index","hash":"302beb09e1b469d7d4db19566f2389d280b64aa3"},{"id":73,"name":"revoke-grants-to-unused-operations","hash":"ba9244051be09f22f714fc0170a2539f8b5f0e68"}].map(row=>Object.freeze(row)));
export function supportedOfficialStartupMigration(rows,profile){
  insist(Array.isArray(rows),'Authenticated migration rows required.');
  let expected;
  if(profile==='native-text-v4-fresh-supabase-admin')expected=[...OFFICIAL_528_PREFIX63,...AUTHENTICATED_NATIVE74_TAIL];
  else throw new Error('Closed authenticated migration profile required.');
  insist(rows.length===expected.length && rows.every((row,index)=>row && stable({id:row.id,name:row.name,hash:row.hash})===stable(expected[index])),
    'Authenticated names/IDs/hashes differ from exact official prefix/source tail.');
  return 'object-versioning-core';
}
export function resourceProfile(profile){
  if(profile==='native-text-v4-fresh-supabase-admin')return Object.freeze({work_ms:900000,node_heap_mib:256,cpus:1,cleanup_ms:45000});
  if(profile==='immutable-private-fresh-supabase-admin' || profile==='immutable-private-fresh-postgres')return Object.freeze({work_ms:1800000,node_heap_mib:384,cpus:1,cleanup_ms:45000});
  throw new Error('Only authenticated closed archive profiles select resource bounds.');
}
// Exact DATA contract only; host derives ownerProfile from the branded archive.
// A caller-provided profile never substitutes for that source authentication.
export function storageWorkerActor(sourceProfile,ownerProfile){
  if(sourceProfile==='native-text-v4-fresh-supabase-admin'){
    insist(ownerProfile===undefined,'Native Storage profile cannot carry private owner selection.');return 'supabase_admin';
  }
  insist(ownerProfile && Object.keys(ownerProfile).sort().join(',')==='actor,id','Exact authenticated owner profile required.');
  if(sourceProfile==='immutable-private-fresh-supabase-admin'){
    insist(ownerProfile.id==='immutable-private-legacy-supabase-admin' && ownerProfile.actor==='supabase_admin','Legacy private owner mismatch.');return 'supabase_admin';
  }
  if(sourceProfile==='immutable-private-fresh-postgres'){
    insist(ownerProfile.id==='immutable-private-current-postgres' && ownerProfile.actor==='postgres','Current private owner mismatch.');return 'postgres';
  }
  throw new Error('Closed authenticated Storage owner profile required.');
}
// Docker's declared container ports are not host publication. A running,
// unpublished endpoint may report Ports={} or {'5432/tcp':null}. Accept only
// those two representations, with independent configuration and network proof.
// This helper emits detached booleans only, also safe for public diagnostics.
export function privatePgPortIsolation(value,networkName){
  const own=(object,key)=>{if(!object||typeof object!=='object'||isProxy(object))return undefined;
    const d=Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
  const record=value=>value!==null&&typeof value==='object'&&!isProxy(value)&&!Array.isArray(value)
    && [Object.prototype,null].includes(Object.getPrototypeOf(value));
  const empty=value=>record(value)&&Reflect.ownKeys(value).length===0;
  const exactPort=value=>record(value)&&Reflect.ownKeys(value).length===1&&Object.hasOwn(value,'5432/tcp');
  const config=own(value,'Config'),host=own(value,'HostConfig'),settings=own(value,'NetworkSettings');
  const exposed=own(config,'ExposedPorts'),bindings=own(host,'PortBindings'),ports=own(settings,'Ports');
  return Object.freeze({declared_postgres_port_exact:exactPort(exposed)&&empty(own(exposed,'5432/tcp')),
    host_port_bindings_absent:bindings===null||empty(bindings),publish_all_ports_disabled:own(host,'PublishAllPorts')===false,
    runtime_ports_unpublished:empty(ports)||exactPort(ports)&&own(ports,'5432/tcp')===null,
    network_mode_matches:typeof networkName==='string'&&networkName.length>0&&own(host,'NetworkMode')===networkName});
}
export function assertPrivatePgOwnerProfile(value,ownerProfile){
  const sourceProfile=ownerProfile?.id==='immutable-private-current-postgres'?'immutable-private-fresh-postgres':'immutable-private-fresh-supabase-admin';
  const actor=storageWorkerActor(sourceProfile,ownerProfile),labels=value.Config?.Labels;
  insist(labels?.['custodial.private-owner-profile']===ownerProfile.id && labels?.['custodial.private-owner-actor']===actor
    && /^[a-f0-9]{32}$/.test(labels?.['custodial.private-backup-rehearsal']),'Private PG source owner labels differ.');
  const networks=Object.keys(value.NetworkSettings?.Networks||{}),name=value.Name;
  insist(typeof name==='string' && /^\/mz_schema_rebuild_[A-Za-z0-9_]+$/.test(name)
    && networks.length===1 && networks[0]===name.slice(1)+'_private_'+labels['custodial.private-backup-rehearsal'],
    'Private PG must retain the exact sole parent-owned network.');
  insist(Object.values(privatePgPortIsolation(value,networks[0])).every(v=>v===true),
    'Private original must retain its declared PG port, owned network mode and no host publication.');
  return true;
}
// Borrowed private network identity is derived from the owned PG inspection,
// never an environment/network selector. The parent retains network ownership.
export function assertPrivatePgNetwork(value,{networkId,networkName,owner,pgid,pgName,address}){
  insist(/^[a-f0-9]{32}$/.test(owner) && networkName===pgName+'_private_'+owner
    && value.Id===networkId && value.Name===networkName && value.Internal===true
    && value.Labels?.['custodial.private-backup-rehearsal']===owner,'Exact parent-owned internal PG network required.');
  const pg=value.Containers?.[pgid];
  insist(pg && pg.Name===pgName && typeof pg.IPv4Address==='string' && pg.IPv4Address.split('/')[0]===address
    && isIP(address)===4,'Owned PG endpoint changed in private network.');
  return true;
}
export function assertPrivateNetworkMembers(value,identity,providerId=null){
  assertPrivatePgNetwork(value,identity);
  const expected=providerId===null?[identity.pgid]:[identity.pgid,providerId];
  insist(stable(Object.keys(value.Containers).sort())===stable(expected.sort()),'Foreign member in private provider network.');
  return true;
}
export function assertPinnedPgResources(value,cid,name,profile){
  insist(['native-text-v4-fresh-supabase-admin','immutable-private-fresh-supabase-admin','immutable-private-fresh-postgres'].includes(profile),'Closed PG resource profile required.');
  const memory=(profile==='native-text-v4-fresh-supabase-admin'?2:1)*1024**3;
  insist(value.Id===cid && value.Name==='/'+name && value.Config.Image===PG_IMAGE
    && value.HostConfig.Memory===memory && value.HostConfig.MemorySwap===memory
    && value.HostConfig.NanoCpus===1e9 && value.HostConfig.PidsLimit===256,'Provider-only PG resource pin refused.');
  if(profile==='native-text-v4-fresh-supabase-admin')insist(value.HostConfig.Tmpfs?.['/var/lib/postgresql/data']==='rw,size=2g','Exact native PG tmpfs2GiB required.');
  return true;
}
export function validatePinnedOfficialImage(value){
  insist(/^sha256:[a-f0-9]{64}$/.test(value.id) && Array.isArray(value.repo_digests) && value.repo_digests.includes(IMAGE)
    && (value.user===null || value.user===''),'Pinned registry reference and official default-root image required.');
  return value.id;
}
export function validatePinnedOfficialMirror(value){
  insist(/^sha256:[a-f0-9]{64}$/.test(value.id) && Array.isArray(value.repo_digests)
    && value.repo_digests.some(ref=>ref===MIRROR_IMAGE || ref===MIRROR_IMAGE.slice('docker.io/'.length))
    && (value.user===null || value.user===''),'Exact official DockerHub mirror identity required.');
  return value.id;
}
export async function closeOwnedRelay(relay,sockets,deadline){
  const owned=[...sockets],socketClosed=owned.map(socket=>new Promise(yes=>{socket.once('close',yes);socket.destroy();}));
  await new Promise((yes,no)=>{const timer=setTimeout(()=>no(new Error('Owned relay closure deadline exceeded.')),Math.max(1,Math.min(1000,deadline-Date.now())));
    const listenerClosed=new Promise((done,fail)=>relay.close(e=>e?fail(e):done()));
    Promise.all([listenerClosed,...socketClosed]).then(()=>{clearTimeout(timer);yes();},e=>{clearTimeout(timer);no(e);});});
  insist(!relay.listening && sockets.size===0,'Owned relay remains after actual socket close events.');
}
let stopping=false;const liveGroups=new Set();
function stop(){stopping=true;for(const pid of liveGroups)try{process.kill(-pid,'SIGKILL');}catch{}}
const inspectFormat='{"Id":{{json .Id}},"ImageId":{{json .Image}},"Name":{{json .Name}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}},"ExposedPorts":{{json (index .Config "ExposedPorts")}}},"HostConfig":{"PortBindings":{{json .HostConfig.PortBindings}},"PublishAllPorts":{{json .HostConfig.PublishAllPorts}},"NetworkMode":{{json .HostConfig.NetworkMode}},"Memory":{{json .HostConfig.Memory}},"MemorySwap":{{json .HostConfig.MemorySwap}},"Tmpfs":{{json .HostConfig.Tmpfs}},"NanoCpus":{{json .HostConfig.NanoCpus}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"PidsLimit":{{json .HostConfig.PidsLimit}}},"State":{{json .State}},"NetworkSettings":{"Ports":{{json .NetworkSettings.Ports}},"Networks":{{json .NetworkSettings.Networks}}}}';
const hash = value => createHash('sha256').update(value).digest('hex');
export const stable = value => JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
const insist = (value,message) => { if(!value) throw new Error(message); };
const pause = ms => new Promise(r=>setTimeout(r,ms));
const sign = (value,key) => createHmac('sha256',key).update(stable(value)).digest('hex');
function durable(path,value,mode=0o600){const fd=openSync(path,'wx',mode);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}}
function ticks(pid){return readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[19];}
export function hostMemoryAvailability(text,requiredBytes){
  insist(Number.isSafeInteger(requiredBytes)&&requiredBytes>0,'Fixed memory floor required.');
  const m=typeof text==='string'?/^MemAvailable:\s+(\d+) kB$/m.exec(text):null;
  const observed=m?Number(m[1])*1024:null;
  const available=Number.isSafeInteger(observed)&&observed>=0?observed:null;
  return Object.freeze({required_bytes:requiredBytes,available_bytes:available,floor_met:available!==null&&available>=requiredBytes});
}
function memoryFloor(bytes,observe=null){
  const memory=hostMemoryAvailability(readFileSync('/proc/meminfo','utf8'),bytes);
  if(observe)observe(memory);insist(memory.floor_met,'Insufficient available memory.');
}
const hostStartupPhases=new Set(['SELECT_MODE','IMPORT_ARCHIVE','IMPORT_STORAGE','IMPORT_POSTGRES_CLIENT',
  'CHECK_MEMORY_FLOOR','PARSE_ORIGINAL_INTENT','IMPORT_CRYPTO','CAPTURE_ORIGINAL_INTENT','CREATE_CUSTODY','HOST_STARTUP_READY']);
export function hostStartupDiagnostic(phase,memory,error=null){
  const own=(object,key)=>{if(!object||typeof object!=='object'||isProxy(object))return undefined;
    const d=Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
  const codes=['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_DLOPEN_FAILED','ENOMEM','EACCES','EPERM','ENOSPC','EMFILE','ENFILE','ENOENT','EEXIST',
    'original_restore_intent_capture_invalid'];
  const code=own(error,'code'),required=own(memory,'required_bytes'),available=own(memory,'available_bytes');
  const knownMemory=required===4*1024**3;
  const safeAvailable=Number.isSafeInteger(available)&&available>=0?available:null;
  return Object.freeze({schema:'custodial.official-storage-host-startup.v1',ok:phase==='HOST_STARTUP_READY'&&error===null,
    phase:hostStartupPhases.has(phase)?phase:'HOST_STARTUP_REFUSED',
    ...(codes.includes(code)?{code}:{}),required_memory_bytes:knownMemory?required:null,
    available_memory_bytes:knownMemory?safeAvailable:null,memory_floor_met:knownMemory&&safeAvailable!==null&&safeAvailable>=required,
    private_payload_exported:false,production_action_performed:false});
}
const hostPhases=new Set(['INITIALIZE_HOST','ADMIT_ARCHIVE','BIND_ARCHIVE_SOURCE','VERIFY_INTENT_SOURCE','READ_ARCHIVED_MIGRATIONS',
  'VERIFY_TARGET_AND_TYPE_MIGRATIONS','PREPARE_ARCHIVED_OBJECTS','BIND_WORKER_INPUT','VERIFY_OWNED_POSTGRES','BOUND_OWNED_POSTGRES',
  'READ_CREDENTIAL_BASELINE','INITIALIZE_EPHEMERAL_CREDENTIAL','VERIFY_CREDENTIAL_INVARIANCE','PREPARE_PROVIDER_CONFIG',
  'VERIFY_PROVIDER_NETWORK','PIN_PROVIDER_IMAGES','CREATE_PROVIDER','VERIFY_PROVIDER','BIND_OWNED_RELAY','VERIFY_CURRENT_TARGET',
  'BIND_PROVIDER_ENVELOPE','RESTORE_ORIGINAL_DATA','VERIFY_RESTORE_OUTPUT','VERIFY_FINAL_CATALOG','VERIFY_PROVIDER_COMPLETE',
  'CLEANUP_RELAY','CLEANUP_CLIENTS','CLEANUP_PROVIDER','CLEANUP_ARCHIVE','CLEANUP_PRIVATE_INPUTS','WRITE_FINAL_RECEIPT',
  'EXPORT_FINAL_EVIDENCE','CLEANUP_PRIVATE_EVIDENCE','HOST_FINISHED']);
export function hostStageDiagnostic(phase,event,error=null){
  const native=privateRestoreFailureDiagnostic(error,'database_connection'),startup=hostStartupDiagnostic('SELECT_MODE',null,error);
  return Object.freeze({schema:'custodial.official-storage-host-stage.v1',phase:hostPhases.has(phase)?phase:'HOST_FAILURE',
    event:['ENTER','REFUSED','NATIVE_CLIENT_ERROR','FINISHED'].includes(event)?event:'REFUSED',
    ...(native.sql_state?{sql_state:native.sql_state}:native.node_code?{node_code:native.node_code}:startup.code?{code:startup.code}:{}),
    private_payload_exported:false,production_action_performed:false});
}
// An idle pg error is an EventEmitter event, not a rejected query promise.
// Latch it without throwing from its callback. Every later native operation
// fails closed, and the host callback cancels owned work without abandoning wait.
export function nativeClientFailureGuard(onFailure=()=>{},beforeOperation=()=>{}){
  let failure=null;
  const check=()=>{if(failure)throw failure;beforeOperation();};
  return Object.freeze({check,observe(client){client.on('error',error=>{
    if(failure)return;
    const diagnostic=privateRestoreFailureDiagnostic(error,'database_connection');
    failure=Object.assign(new Error('Owned native client failed; continuation refused.'),
      {code:diagnostic.sql_state??diagnostic.node_code??'OWNED_NATIVE_CLIENT_FAILURE'});
    try{onFailure(error,failure);}catch{} // Failure reporting must never become an unhandled emitter error.
  });return client;},async run(operation){check();const value=await operation();check();return value;}});
}
// Connect, query and close are one tracked lifetime. No client is held idle
// across archive/file IO, Docker work, image pulls or the restore subprocess.
export async function withOwnedNativeClient(Client,options,guard,tracked,work){
  guard.check();const client=guard.observe(new Client(options));tracked.add(client);
  let result,failure;
  try{await guard.run(()=>client.connect());
    const db=Object.freeze({query:(...args)=>guard.run(()=>client.query(...args))});
    result=await guard.run(()=>work(db));
  }catch(error){failure=error;}
  finally{try{await client.end();tracked.delete(client);}catch(error){failure??=error;}}
  if(failure)throw failure;guard.check();return result;
}
// The startup receipt exists before provider custody, but only under verified
// owned directories. It never accepts a caller path/name or raw failure text.
export function ownedHostStartupRecorder(tmp){
  insist(typeof tmp==='string'&&tmp===resolve(tmp)&&realpathSync(tmp)===tmp,'Canonical runner temporary directory required.');
  const checked=(path,privateMode)=>{const s=lstatSync(path);
    insist(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(!privateMode||(s.mode&0o077)===0),'Owned startup receipt directory required.');return s;};
  const rootIdentity=checked(tmp,false),base=resolve(tmp,'official-local-storage-provider-evidence');
  try{mkdirSync(base,{mode:0o700});}catch(error){if(error?.code!=='EEXIST')throw error;}
  const baseIdentity=checked(base,true),directory=mkdtempSync(resolve(base,'startup-')),identity=checked(directory,true);
  const same=(path,prior,privateMode)=>{const current=checked(path,privateMode);
    insist(current.dev===prior.dev&&current.ino===prior.ino,'Startup receipt directory changed.');};
  const current=()=>{same(tmp,rootIdentity,false);same(base,baseIdentity,true);same(directory,identity,true);};let sequence=0;
  return Object.freeze({tmp,record(phase,memory,error=null){
    current();durable(resolve(directory,'HOST_STARTUP.json'),hostStartupDiagnostic(phase,memory,error));
  },stage(phase,event,error=null){
    current();insist(sequence<128,'Host stage receipt bound exceeded.');
    durable(resolve(directory,'HOST_STAGE_'+String(++sequence).padStart(3,'0')+'.json'),hostStageDiagnostic(phase,event,error));
  }});
}
export function selectedMode(env){
  insist(env.REHEARSAL_SCOPE==='backup_only' && env.OFFICIAL_LOCAL_STORAGE_PROVIDER==='true','Explicit backup_only provider opt-in required.');
  insist(env.RESTORE_APPLY==='true' && env.RESTORE_DATABASE_ONLY==='true','Original whole database-only APPLY required.');
  const u=new URL(env.SUPABASE_DB_URL);
  insist(['postgres:','postgresql:'].includes(u.protocol) && u.hostname==='127.0.0.1' && !u.search && !u.hash
    && /^mz_schema_rebuild_[A-Za-z0-9_]+$/.test(u.pathname.slice(1)),'Owned loopback database required.');
  return u;
}
export function storageResult(result,archive,intent){
  insist(result.ok===true && result.restore_id===intent.restore_id && result.authority_generation===intent.authority_generation
    && result.database_only===true && result.mutations_paused===true && result.state==='PAUSED_RECONCILIATION'
    && result.database_tables===Number(archive.summary.table_count) && String(result.database_rows)===String(archive.summary.database_row_count),
    'Normal original restore result did not match the authenticated source.');
  const s=result.storage;
  insist(s?.provider_verified===true && s.object_bytes_verified===true && s.metadata_and_ownership_verified===true
    && s.scope==='OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL' && s.production_provider_verified===false
    && Array.isArray(s.owner_access_probes) && s.owner_access_probes.length===Number(archive.summary.storage_object_count)
    && s.owner_access_probes.every(p=>p.status==='VERIFIED_CURRENT_RESTORED_ROLE_BOUNDARY'),
    'Official local provider and exact original metadata verification required.');
  return result;
}

// One original process group per invocation. Actual wait is durable before
// absence/cleanup assertions; no secret-bearing argv or environment is logged.
function runner(root,getDeadline,cleanupBudget,privacy){let sequence=0;return async function run(argv,{env=process.env,seconds=60,cleanup=false,input=null,logSecrets=null,abortSignal=null}={}){
  if(logSecrets!==null)insist(Array.isArray(logSecrets) && argv[0]==='docker' && argv[1]==='logs' && argv[2]==='--timestamps' && argv[3]==='--tail' && argv[4]==='120' && /^[a-f0-9]{64}$/.test(argv[5]) && argv.length===6,'Only fixed owned provider logs admit redacted transport.');
  insist(!abortSignal?.aborted,'Owned inspector cancelled before child birth.');
  if(cleanup)cleanupBudget.deadline??=Date.now()+45000;
  insist(cleanup?Date.now()<cleanupBudget.deadline:!stopping && Date.now()<getDeadline(),'Original work/cleanup deadline exhausted before child birth.');
  if(!cleanup)memoryFloor(2*1024**3);
  const number=String(++sequence).padStart(3,'0'),prefix=resolve(root,number),started=Date.now();
  durable(prefix+'.INTENT.json',{original:true,program:argv[0],argument_sha256:hash(stable(argv.slice(1))),started,seconds});
  let child,owner,code,signal,error,cancelInspector;const chunks=[[],[]],sizes=[0,0];
  try{
    child=spawn(argv[0],argv.slice(1),{env,detached:true,stdio:[input===null?'ignore':'pipe','pipe','pipe']});liveGroups.add(child.pid);
    const completion=new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(c,s)=>done([c,s]));});completion.catch(()=>{});
    if(abortSignal){cancelInspector=()=>{error??=new Error('Owned inspector cancelled for relay cleanup.');
      if(child.exitCode===null && child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}};
      abortSignal.addEventListener('abort',cancelInspector,{once:true});if(abortSignal.aborted)cancelInspector();}
    owner={pid:child.pid,pgid:child.pid,proc_start_ticks:ticks(child.pid)};durable(prefix+'.OWNER.json',owner);
    if(input!==null){insist(typeof input==='string' && Buffer.byteLength(input,'utf8')<=4096,'Fixed private stdin bound exceeded.');child.stdin.on('error',()=>{error??=new Error('Private original stdin refused.');});child.stdin.end(input);}
    for(const [i,stream] of [child.stdout,child.stderr].entries())stream.on('data',chunk=>{
      sizes[i]+=chunk.length;if(sizes[i]>CAP){error=new Error('Original stream exceeded finite bound.');try{process.kill(-child.pid,'SIGKILL');}catch{}}
      else chunks[i].push(chunk);
    });
    const limit=Math.min(seconds*1000,Math.max(1,(cleanup?cleanupBudget.deadline:getDeadline())-Date.now()-2000));
    const timer=setTimeout(()=>{error=new Error('Original child deadline exhausted.');try{process.kill(-child.pid,'SIGKILL');}catch{}},limit);
    try{[code,signal]=await completion;}finally{clearTimeout(timer);}
    durable(prefix+'.ACTUAL_WAIT.json',{...owner,code,signal,elapsed_ms:Date.now()-started});liveGroups.delete(child.pid);
    const drained=await Promise.race([Promise.all([child.stdout,child.stderr].map(stream=>stream.readableEnded?Promise.resolve():new Promise(r=>stream.once('end',r)))).then(()=>true),pause(2000).then(()=>false)]);
    if(!drained){try{process.kill(-child.pid,'SIGKILL');}catch{};child.stdout.destroy();child.stderr.destroy();error??=new Error('Original stream drain deadline exceeded.');}
    for(const [i,suffix] of ['stdout','stderr'].entries()){
      const raw=Buffer.concat(chunks[i]),saved=privacy.privateData?Buffer.from(JSON.stringify(privateRestoreStreamDiagnostic(raw))+'\n')
        :logSecrets===null?raw:Buffer.from(redactProviderLogs(raw.toString('utf8'),logSecrets));
      if(privacy.privateData || logSecrets!==null)durable(prefix+'.'+suffix+'.REDACTION.json',{original_bytes:raw.length,original_sha256:hash(raw),saved_bytes:saved.length,saved_sha256:hash(saved),raw_vendor_bytes_persisted:false,...(privacy.privateData?{private_payload_bytes_persisted:false}:{} )});
      writeFileSync(prefix+'.'+suffix,saved,{mode:0o600,flag:'wx'});
    }
    try{process.kill(-child.pid,0);throw new Error('Original group remains after wait.');}catch(e){if(e.code!=='ESRCH')throw e;}
    insist(!existsSync(`/proc/${child.pid}`),'Original PID remains after wait.');
    if(error)throw error;insist(code===0,'Original child refused; private streams retained.');
    return logSecrets===null?Buffer.concat(chunks[0]).toString('utf8'):privacy.privateData
      ?JSON.stringify(privateRestoreStreamDiagnostic(Buffer.concat(chunks[0]))):redactProviderLogs(Buffer.concat(chunks[0]).toString('utf8'),logSecrets);
  }catch(e){
    if(child?.pid && code===undefined){try{process.kill(-child.pid,'SIGKILL');}catch{}
      await new Promise(r=>child.exitCode!==null||child.signalCode!==null?r():child.once('exit',r));
      if(!existsSync(prefix+'.ACTUAL_WAIT.json'))durable(prefix+'.ACTUAL_WAIT.json',{...owner,code:child.exitCode,signal:child.signalCode,setup_failure:true});}
    liveGroups.delete(child?.pid);throw e;
  }finally{if(cancelInspector)abortSignal.removeEventListener('abort',cancelInspector);}
};}

export function redactProviderLogs(text,secrets){
  for(const secret of secrets.filter(v=>typeof v==='string' && v.length>=4).sort((a,b)=>b.length-a.length))text=text.split(secret).join('[REDACTED]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,'[REDACTED_DATABASE_URL]')
    .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,'[REDACTED_JWT]');
}
// Private failure channels never copy arbitrary driver/vendor text, properties
// or stack operands. These DATA diagnostics grant no retry/restore authority.
export function privateRestoreStreamDiagnostic(raw){
  insist(Buffer.isBuffer(raw),'Owned byte stream required.');
  return Object.freeze({classification:'PRIVATE_SUBPROCESS_STREAM_WITHHELD',bytes:raw.length,sha256:hash(raw),private_payload_exported:false});
}
export function privateRestoreFailureDiagnostic(error,phase){
  const phases=['connect_gate','capture_before_catalog','require_locator','require_backend','construct_backend','construct_locator',
    'verify_empty_namespace','read_verified_object','official_archived_version_upload','verify_post_bootstrap_migrations',
    'official_entrypoint_start','official_entrypoint_exit','database_connection','archive_lifecycle','archive_cleanup'];
  const sqlStates=['0A000','08000','08001','08003','08004','08006','08007','08P01','22001','22003','22007','22023','22P02',
    '23502','23503','23505','23514','25000','25006','25P02','28000','28P01','3D000','3F000','40001',
    '40P01','42501','42601','42703','42883','42P01','53000','53100','53200','53300','53400','54000','54001','54011',
    '55000','57014','57P01','57P02','57P03','58000','58030','P0001','XX000'];
  const nodeCodes=['ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ERR_STREAM_PREMATURE_CLOSE'];
  const descriptor=error && typeof error==='object' && !isProxy(error)?Object.getOwnPropertyDescriptor(error,'code'):undefined;
  const code=descriptor && Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
  return Object.freeze({phase:phases.includes(phase)?phase:'PRIVATE_FAILURE',classification:'PRIVATE_RESTORE_FAILURE',
    ...(sqlStates.includes(code)?{sql_state:code}:nodeCodes.includes(code)?{node_code:code}:{}),private_payload_exported:false});
}
const privateEvidenceFields=Object.freeze({
  'FINAL.json':['ok','provider_verified','production_provider_verified','service_born','service_CID_or_name_fresh_absent','network_fresh_absent','borrowed_network_retained_verified','relay_closed_or_never_born','cleanup_checked','error'],
  'PROVIDER_VERIFIED.json':['provider_verified','production_provider_verified','archive_digest','original_intent_sha256','container_id','database_oid','archived_migrations_74_full_tuple_sha256','actual_archived_migration_count','buckets','objects'],
  'WORKER_INPUT_REDACTED.json':['input_sha256','worker_sha256','original_intent_sha256','archive_digest','database_oid','migrations_full_tuple_sha256','secrets_retained'],
  'ARCHIVED_STORAGE_MIGRATIONS_FULL_TUPLES.json':['source_profile','count','sha256','authenticated_source_metadata_only'],
  'STORAGE_CATALOG_BEFORE_PROVIDER.json':['sha256'],
  'STORAGE_CATALOG_AFTER_PROVIDER.json':['sha256'],
  'STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE.json':['database_oid','owned_container_id','only_ephemeral_password_initialized','plaintext_or_verifier_exported'],
  'PROVIDER_LOG_CAPTURE_REFUSED.json':['fixed_owned_container','original_exception_preserved','raw_logs_exported'],
  'PROVIDER_STARTUP_FAILURE.json':[],
  'PINNED_OFFICIAL_IMAGE_METADATA.json':['config_image_id','default_root'],
  'PINNED_OFFICIAL_MIRROR_METADATA.json':['config_image_id','default_root'],
  'OWNED_LOOPBACK_RELAY_BOUND.json':['container_id','config_image_id','network_id','external_network_attached','payloads_logged'],
  'OWNED_LOOPBACK_RELAY_CLOSED.json':['listener_closed','owned_sockets_remaining','before_container_removal'],
});
export function privateEvidenceFile(name){
  return Object.hasOwn(privateEvidenceFields,name) || /^[0-9]{3}\.(?:INTENT\.json|OWNER\.json|ACTUAL_WAIT\.json|stdout|stderr|(?:stdout|stderr)\.REDACTION\.json)$/.test(name);
}
export function privateEvidenceReceipt(name,raw){
  if(!privateEvidenceFile(name))return null;
  const value=JSON.parse(raw.toString('utf8'));
  if(name==='PROVIDER_STARTUP_FAILURE.json')return privateRestoreFailureDiagnostic({code:value.sql_state??value.node_code},value.phase);
  const fields=privateEvidenceFields[name]??(name.endsWith('.INTENT.json')?['argument_sha256','started','seconds']
    :name.endsWith('.OWNER.json')?['pid','pgid','proc_start_ticks']
    :name.endsWith('.ACTUAL_WAIT.json')?['pid','pgid','proc_start_ticks','code','signal','elapsed_ms','setup_failure']
    :name.endsWith('.REDACTION.json')?['original_bytes','original_sha256','saved_bytes','saved_sha256','raw_vendor_bytes_persisted','private_payload_bytes_persisted']
    :['bytes','sha256']);
  const result={classification:'PRIVATE_RESTORE_METADATA_RECEIPT',private_payload_exported:false};
  for(const key of fields){
    const v=value[key];
    if(typeof v==='boolean' || Number.isSafeInteger(v)&&v>=0 || v===null)result[key]=v;
    else if(typeof v==='string' && ((/(?:sha256|digest)$/.test(key)||['container_id','owned_container_id','fixed_owned_container','network_id'].includes(key))&&/^[a-f0-9]{64}$/.test(v)
      || key==='config_image_id'&&/^sha256:[a-f0-9]{64}$/.test(v)
      || ['database_oid','proc_start_ticks'].includes(key)&&/^[1-9][0-9]{0,19}$/.test(v)
      || key==='signal'&&['SIGTERM','SIGKILL','SIGINT'].includes(v)
      || key==='error'&&v==='OWNING_REHEARSAL_REFUSED'
      || key==='source_profile'&&['immutable-private-fresh-supabase-admin','immutable-private-fresh-postgres'].includes(v)))result[key]=v;
  }
  if(name==='STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE.json')result.catalog_invariance_verified=Boolean(value.before && value.after
    && typeof value.before==='object' && typeof value.after==='object' && !Array.isArray(value.before) && !Array.isArray(value.after)
    && stable(value.before)===stable(value.after));
  if(name==='STORAGE_CATALOG_BEFORE_PROVIDER.json'||name==='STORAGE_CATALOG_AFTER_PROVIDER.json'){
    result.catalog_counts=Object.fromEntries(['schema','relations','columns','constraints','indexes','routines','views','sequences','triggers','policies','types','enums','default_acls','roles','role_settings','memberships']
      .map(key=>[key,Array.isArray(value.catalog?.[key])?value.catalog[key].length:0]));
  }
  return Object.freeze(result);
}
export function safeStartupFailure(error,phase,privateData=false){
  if(privateData)return privateRestoreFailureDiagnostic(error,phase);
  const label=value=>typeof value==='string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)?value:null;
  const locations=String(error?.stack||'').split('\n').flatMap(line=>{const m=/((?:\/app\/dist\/|\/custody\/)[A-Za-z0-9_./-]+\.(?:js|mjs)):(\d+):(\d+)\)?$/.exec(line);return m?[{source:m[1],line:Number(m[2]),column:Number(m[3])}]:[];}).slice(0,8);
  return {phase,name:label(error?.name),code:typeof error?.code==='string' && /^[0-9A-Z]{5}$/.test(error.code)?error.code:label(error?.code),syscall:label(error?.syscall),source_locations:locations,message_or_environment_exported:false};
}
async function originalRows(archive,tableName,api){
  const data=api.openVerifiedRestoreTableData(archive,'storage',tableName),rows=[];
  try{
    for await(const line of createInterface({input:data.stream,crlfDelay:Infinity})){
      insist(rows.length<65536,'Archived row bound exceeded.');
      rows.push(JSON.parse(api.decodeRestoreTableRowLine(line,data.table)));
    }
    await data.verified;insist(String(rows.length)===data.table.row_count,'Archived row count mismatch.');return rows;
  }finally{await data.close();}
}

// Executed by the pinned official image before its unchanged entrypoint. This
// code writes only FILE bytes; all metadata is restored by the normal CLI.
// Fixed catalog-only observation, shared byte-for-byte by gate and host.
// No pg_authid, password fields, operational rows, or caller-selected SQL.
export const STORAGE_CREDENTIAL_NONSECRET_SQL = `select jsonb_build_object(
    'role',(select jsonb_build_object('oid',oid,'name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'connection_limit',rolconnlimit,'valid_until',rolvaliduntil,'bypassrls',rolbypassrls,'config',rolconfig) from pg_roles where rolname='supabase_storage_admin'),
    'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by roleid,member,grantor),'[]'::jsonb) from pg_auth_members m),
    'schemas',(select coalesce(jsonb_agg(jsonb_build_array(oid,nspname,nspowner,nspacl) order by oid),'[]'::jsonb) from pg_namespace),
    'relations',(select coalesce(jsonb_agg(jsonb_build_array(oid,relowner,relacl) order by oid),'[]'::jsonb) from pg_class),
    'columns',(select coalesce(jsonb_agg(jsonb_build_array(attrelid,attnum,attacl) order by attrelid,attnum),'[]'::jsonb) from pg_attribute where attacl is not null),
    'routines',(select coalesce(jsonb_agg(jsonb_build_array(oid,proowner,proacl) order by oid),'[]'::jsonb) from pg_proc),
    'defaults',(select coalesce(jsonb_agg(to_jsonb(d) order by oid),'[]'::jsonb) from pg_default_acl d),
    'databases',(select coalesce(jsonb_agg(jsonb_build_array(oid,datdba,datacl) order by oid),'[]'::jsonb) from pg_database),
    'role_settings',(select coalesce(jsonb_agg(to_jsonb(d) order by setdatabase,setrole),'[]'::jsonb) from pg_db_role_setting d)
    ) snapshot`;
export const STORAGE_CATALOG_SQL = `with ns as (select oid from pg_namespace where nspname='storage'),
rr as (select oid from pg_roles where rolname in ('postgres','supabase_admin','supabase_storage_admin','anon','authenticated','service_role','authenticator')
 union select nspowner from pg_namespace where oid in(select oid from ns)
 union select relowner from pg_class where relnamespace in(select oid from ns)
 union select proowner from pg_proc where pronamespace in(select oid from ns))
select jsonb_build_object(
 'schema',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname) from pg_namespace where oid in(select oid from ns)),
 'relations',(select jsonb_agg(jsonb_build_object('name',relname,'kind',relkind,'owner',pg_get_userbyid(relowner),'acl',relacl::text,'options',reloptions,'rls',relrowsecurity,'force_rls',relforcerowsecurity,'persistence',relpersistence,'replica_identity',relreplident) order by relname) from pg_class where relnamespace in(select oid from ns)),
 'columns',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'collation',a.attcollation::regcollation::text,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relnamespace in(select oid from ns) and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',x.conname,'type',x.contype,'deferrable',x.condeferrable,'deferred',x.condeferred,'validated',x.convalidated,'definition',pg_get_constraintdef(x.oid,false)) order by c.relname,x.conname) from pg_constraint x left join pg_class c on c.oid=x.conrelid where x.connamespace in(select oid from ns)),
 'indexes',(select jsonb_agg(jsonb_build_object('relation',t.relname,'name',c.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary) order by t.relname,c.relname) from pg_index i join pg_class c on c.oid=i.indexrelid join pg_class t on t.oid=i.indrelid where t.relnamespace in(select oid from ns)),
 'routines',(select jsonb_agg(jsonb_build_object('name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef,'language',l.lanname,'kind',p.prokind,'arguments',p.proargtypes::text,'return_type',format_type(p.prorettype,null),'definition',case when p.prokind in ('f','p') then pg_get_functiondef(p.oid) else p.prosrc end) order by p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace in(select oid from ns)),
 'views',(select jsonb_agg(jsonb_build_object('name',relname,'definition',pg_get_viewdef(oid,false)) order by relname) from pg_class where relnamespace in(select oid from ns) and relkind in ('v','m')),
 'sequences',(select jsonb_agg(jsonb_build_object('name',c.relname,'type',format_type(q.seqtypid,null),'start',q.seqstart::text,'increment',q.seqincrement::text,'max',q.seqmax::text,'min',q.seqmin::text,'cache',q.seqcache::text,'cycle',q.seqcycle) order by c.relname) from pg_sequence q join pg_class c on c.oid=q.seqrelid where c.relnamespace in(select oid from ns)),
 'triggers',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',t.tgname,'enabled',t.tgenabled,'internal',t.tgisinternal,'definition',pg_get_triggerdef(t.oid,false)) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace in(select oid from ns)),
 'policies',(select jsonb_agg(jsonb_build_object('relation',c.relname,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(case when x=0 then 'PUBLIC' else pg_get_userbyid(x) end order by x) from unnest(p.polroles) x),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace in(select oid from ns)),
 'types',(select jsonb_agg(jsonb_build_object('name',typname,'kind',typtype,'owner',pg_get_userbyid(typowner),'acl',typacl::text,'base',format_type(typbasetype,typtypmod),'not_null',typnotnull,'default',typdefault) order by typname) from pg_type where typnamespace in(select oid from ns)),
 'enums',(select jsonb_agg(jsonb_build_object('type',t.typname,'label',e.enumlabel,'sort',e.enumsortorder) order by t.typname,e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typnamespace in(select oid from ns)),
 'default_acls',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(defaclrole),'schema',case when defaclnamespace=0 then 'GLOBAL' else 'storage' end,'kind',defaclobjtype,'acl',defaclacl::text) order by defaclrole,defaclnamespace,defaclobjtype) from pg_default_acl where defaclnamespace in(select oid from ns) or defaclnamespace=0 and defaclrole in(select oid from rr)),
 'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'create_role',rolcreaterole,'create_db',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass_rls',rolbypassrls,'connection_limit',rolconnlimit,'valid_until',rolvaliduntil::text) order by rolname) from pg_roles where oid in(select oid from rr)),
 'role_settings',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(setrole),'database',case when setdatabase=0 then 'GLOBAL' else current_database() end,'settings',setconfig) order by setrole,setdatabase) from pg_db_role_setting where setrole in(select oid from rr) and setdatabase in(0,(select oid from pg_database where datname=current_database()))),
 'memberships',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by roleid,member,grantor) from pg_auth_members where roleid in(select oid from rr) or member in(select oid from rr))
) catalog`;
async function storageCatalog(db){const r=await db.query(STORAGE_CATALOG_SQL);insist(r.rowCount===1 && r.rows[0].catalog?.schema?.length===1,'Storage catalog unavailable.');
 const text=stable(r.rows[0].catalog);insist(Buffer.byteLength(text)<=16*1024**2,'Storage catalog bound exceeded.');return {catalog:r.rows[0].catalog,sha256:hash(text)};}

async function containerGate(){
  const require=createRequire('/app/package.json'),{Client}=require('pg');
  const input=JSON.parse(readFileSync('/custody/input.json','utf8'));let phase='connect_gate';
  const expectedActor=storageWorkerActor(input.source_profile,input.owner_profile);
  insist(new URL(process.env.CUSTODIAL_GATE_DATABASE_URL).username===expectedActor,'Worker gate actor differs from original owner profile.');
  let gateChild=null;const nativeGuard=nativeClientFailureGuard(()=>{if(gateChild)gateChild.kill('SIGTERM');});
  try{
  await withOwnedNativeClient(Client,{connectionString:process.env.CUSTODIAL_GATE_DATABASE_URL,application_name:'owned-storage-pre-server',connectionTimeoutMillis:5000,query_timeout:10000},nativeGuard,new Set(),async db=>{
    const deadline=Date.now()+resourceProfile(input.source_profile).work_ms;
    for(;;){
      insist(Date.now()<deadline,'Pre-server original boundary deadline exceeded.');
      const context=await db.query(`select current_database() database_name,(select oid::text from pg_database where datname=current_database()) database_oid,
        (select pg_get_userbyid(datdba) from pg_database where datname=current_database()) database_owner,
        session_user::text session_user,current_user::text current_user`);
      insist(context.rowCount===1 && context.rows[0].session_user===expectedActor && context.rows[0].current_user===expectedActor
        && stable(context.rows[0])===stable(input.database),'Provider DB identity changed.');
      try{
        const c=await db.query(`select restore_id::text,authority_generation::text,archive_digest,source_project_ref,target_project_ref,state,mutations_paused
          from custodial_dr.restore_control where singleton=true`);
        const v=c.rows[0],i=input.intent;
        if(c.rowCount===1 && v.restore_id===i.restore_id && v.authority_generation===String(i.authority_generation)
          && v.archive_digest===i.archive_digest && v.source_project_ref===i.source_project_ref && v.target_project_ref===i.target_project_ref
          && v.state==='STORAGE_RESTORING' && v.mutations_paused===true){
          const r=await db.query('select row_to_json(m) row from storage.migrations m order by id');
          insist(r.rowCount===input.migration_count && hash(stable(r.rows.map(x=>x.row)))===input.migrations_sha256,'Archived migration full tuple identity mismatch.');break;
        }
      }catch(e){if(!['42P01','42703'].includes(e.code))throw e;}
      await pause(200);
    }
    phase='capture_before_catalog';const before=await storageCatalog(db);durable('/audit/STORAGE_CATALOG_BEFORE_PROVIDER.json',before,0o644);
    phase='require_locator';const {TenantLocation}=require('/app/dist/storage/locator.js');
    phase='require_backend';const {FileBackend}=require('/app/dist/storage/backend/file.js');
    phase='construct_backend';const backend=new FileBackend();phase='construct_locator';const locator=new TenantLocation(process.env.GLOBAL_S3_BUCKET);
    phase='verify_empty_namespace';insist(readdirSync(process.env.STORAGE_FILE_BACKEND_PATH).length===0,'FILE namespace was not empty.');
    for(const object of input.objects){
      nativeGuard.check();phase='read_verified_object';const bytes=readFileSync('/custody/'+object.file);
      insist(bytes.length===object.size_bytes && hash(bytes)===object.sha256,'Verified original object changed.');
      const key=locator.getKeyLocation({tenantId:process.env.TENANT_ID,bucketId:object.bucket_id,objectName:object.name});
      phase='official_archived_version_upload';await nativeGuard.run(()=>backend.uploadObject(process.env.GLOBAL_S3_BUCKET,key,object.version??undefined,Readable.from(bytes),object.contentType,object.cacheControl,undefined,bytes.length));
    }
    phase='verify_post_bootstrap_migrations';const r=await db.query('select row_to_json(m) row from storage.migrations m order by id');
    insist(hash(stable(r.rows.map(x=>x.row)))===input.migrations_sha256,'Bootstrap changed archived migration metadata.');
  });
  nativeGuard.check();phase='official_entrypoint_start';const child=gateChild=spawn('docker-entrypoint.sh',['node','dist/start/server.js'],{stdio:'inherit',env:process.env});
  for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>child.kill(s));
  const code=await new Promise((r,j)=>{child.once('error',j);child.once('exit',(c,s)=>r(c??(s?1:0)));});
  nativeGuard.check();if(code!==0)durable('/audit/PROVIDER_STARTUP_FAILURE.json',{phase:'official_entrypoint_exit',exit:code,message_or_environment_exported:false},0o644);process.exitCode=code;
  }catch(error){try{durable('/audit/PROVIDER_STARTUP_FAILURE.json',safeStartupFailure(error,phase,Boolean(input.owner_profile)),0o644);}catch{}throw error;}
}

async function host(){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const startup=ownedHostStartupRecorder(process.env.RUNNER_TEMP),tmp=startup.tmp;
  let startupPhase='SELECT_MODE',startupMemory=null,u,api,storage,Client,original,intent,custody;
  try{
    u=selectedMode(process.env);
    startupPhase='IMPORT_ARCHIVE';api=await import(pathToFileURL(resolve(root,'scripts/disaster-recovery-archive.mjs')));
    startupPhase='IMPORT_STORAGE';storage=await import(pathToFileURL(resolve(root,'scripts/disaster-recovery-storage.mjs')));
    startupPhase='IMPORT_POSTGRES_CLIENT';({Client}=await import('pg'));
    startupPhase='CHECK_MEMORY_FLOOR';memoryFloor(4*1024**3,value=>{startupMemory=value;});
    startupPhase='PARSE_ORIGINAL_INTENT';original=JSON.parse(process.env.RESTORE_INTENT_JSON);
    startupPhase='IMPORT_CRYPTO';const crypto=await import(pathToFileURL(resolve(root,'scripts/disaster-recovery-crypto.mjs')));
    startupPhase='CAPTURE_ORIGINAL_INTENT';intent=crypto.captureVerifiedOriginalRestoreIntent(original,process.env.RESTORE_INTENT_VERIFY_KEY,process.env.RESTORE_INTENT_VERIFY_KEY_ID);
    startupPhase='CREATE_CUSTODY';custody=mkdtempSync(resolve(tmp,'official-storage-'));
    startup.record('HOST_STARTUP_READY',startupMemory);
  }catch(error){try{startup.record(startupPhase,startupMemory,error);}catch{}throw error;}
  const started=Date.now();let deadline=started+WORK_MS;const cleanupBudget={deadline:null},privacy={privateData:false};const runOwned=runner(custody,()=>deadline,cleanupBudget,privacy);
  const namespace='mz_schema_rebuild_storage_'+randomBytes(10).toString('hex');let alias=namespace+'_db',network=namespace+'_net',privateNetwork=null,borrowedNetworkRetained=false;
  let archive,cid=null,pgid=null,networkBorn=false,networkId=null,connected=false,failure,output,cleanupFailure=null,serviceAbsent=false,networkAbsent=false,relay=null,relayClosed=true,relayClosing=false,verifiedImageId=null;const relaySockets=new Set(),relayPending=new Set(),relayInspectionController=new AbortController(),nativeClients=new Set();
  let hostPhase='INITIALIZE_HOST',hostCleaning=false;
  const report=(event,error=null)=>{try{startup.stage(hostPhase,event,error);}catch{}};
  const nativeGuard=nativeClientFailureGuard((error,refusal)=>{
    failure??=refusal;report('NATIVE_CLIENT_ERROR',error);
    if(!hostCleaning){stop();relayInspectionController.abort();for(const socket of relaySockets)socket.destroy();}
  },()=>insist(!stopping && Date.now()<deadline,'Host native work deadline or cancellation refused.'));
  const mark=phase=>{hostPhase=phase;if(hostCleaning)report('ENTER');else{nativeGuard.check();startup.stage(phase,'ENTER');}};
  const run=async(argv,options={})=>{
    if(!options.cleanup)nativeGuard.check();const value=await runOwned(argv,options);
    if(!options.cleanup)nativeGuard.check();return value;
  };
  try{
  try{
    mark('ADMIT_ARCHIVE');
    archive=api.materializeVerifiedArchive({sourceDir:process.env.RESTORE_SOURCE_DIR,archiveVerifyKey:process.env.RESTORE_ARCHIVE_VERIFY_KEY,
      archiveVerifyKeyId:process.env.RESTORE_ARCHIVE_VERIFY_KEY_ID,supportedFormats:['memphis-zoo-disaster-recovery.v4'],
      requiredEntries:['backup-summary.json','inventory/table-catalog.json','inventory/storage-buckets.json','inventory/storage-objects.json']});
    mark('BIND_ARCHIVE_SOURCE');api.assertVerifiedArchiveIndependentIntentKey(archive,process.env.RESTORE_INTENT_VERIFY_KEY);
    const a=storage.freshLocalStorageArchiveBinding(archive),s=a.sourceBinding;
    privacy.privateData=Boolean(a.owner_profile);
    const budget=resourceProfile(a.source_profile);deadline=started+budget.work_ms;
    mark('VERIFY_INTENT_SOURCE');insist(intent.archive_digest===s.archive_digest && intent.source_identity_sha256===s.source_identity_sha256 && intent.source_project_ref===s.project_ref,'Original intent source mismatch.');
    if(a.source_profile==='native-text-v4-fresh-supabase-admin')insist(a.bucket_count===3 && a.object_count===1,'Production G31 original requires authenticated three buckets and one object.');
    else insist(storageWorkerActor(a.source_profile,a.owner_profile)===a.expected_session_user && a.bucket_count>0 && a.object_count>0 && a.bucket_count<=65536 && a.object_count<=65536,'Private original requires bounded genuine nonempty Storage.');
    if(a.owner_profile)insist(u.username===a.expected_session_user,'Selected connection differs from authenticated source owner.');
    else u.username=a.expected_session_user;const databaseUrl=u.href;
    const withDatabase=work=>withOwnedNativeClient(Client,{connectionString:databaseUrl,connectionTimeoutMillis:5000,query_timeout:10000},nativeGuard,nativeClients,work);
    const readIdentity=async db=>{const identity=await db.query(`select current_database() database_name,(select oid::text from pg_database where datname=current_database()) database_oid,
      (select pg_get_userbyid(datdba) from pg_database where datname=current_database()) database_owner,session_user::text session_user,current_user::text current_user`);
      const current=identity.rows[0];insist(identity.rowCount===1 && current.database_owner===a.expected_database_owner && current.session_user===a.expected_session_user && current.current_user===current.session_user,'Source profile/DB owner mismatch.');return current;};
    mark('READ_ARCHIVED_MIGRATIONS');const rows=await originalRows(archive,'migrations',api),typed=[];
    mark('VERIFY_TARGET_AND_TYPE_MIGRATIONS');const id=await withDatabase(async db=>{
      const current=await readIdentity(db);
      for(const row of rows){const r=await db.query('select row_to_json(x) row from json_populate_record(null::storage.migrations,$1::json) x',[JSON.stringify(row)]);typed.push(r.rows[0].row);}return current;
    });
    const requireSameIdentity=async db=>insist(stable(await readIdentity(db))===stable(id),'Fresh native target identity changed.');
    typed.sort((x,y)=>x.id-y.id);const migrationCount=typed.length;insist(migrationCount>0 && migrationCount<=1024 && new Set(typed.map(x=>x.id)).size===migrationCount && typeof typed.at(-1).name==='string','Authenticated full migration identity required.');
    if(a.source_profile==='native-text-v4-fresh-supabase-admin')insist(migrationCount===74,'Production original exact74 migration rows required.');
    durable(resolve(custody,'ARCHIVED_STORAGE_MIGRATIONS_FULL_TUPLES.json'),{source_profile:a.source_profile,rows:typed,count:migrationCount,sha256:hash(stable(typed)),authenticated_source_metadata_only:true});
    mark('PREPARE_ARCHIVED_OBJECTS');const migrationsHash=hash(stable(typed)),objectsRows=await originalRows(archive,'objects',api),inventory=api.readVerifiedStorageUploadInventory(archive),objects=[];
    const mount=resolve(custody,'provider-input');mkdirSync(mount,{mode:0o700});
    const audit=resolve(custody,'provider-audit');mkdirSync(audit,{mode:0o700});
    for(const o of inventory.objectRecords){
      const native=objectsRows.find(x=>x.id===o.object_id);insist(native && native.bucket_id===o.bucket_id && native.name===o.name,'Original object membership mismatch.');
      const meta=typeof native.metadata==='string'?JSON.parse(native.metadata):native.metadata;
      const blob=api.readVerifiedStorageUploadBlob(archive,o.object_id),bytes=Buffer.from(await blob.blob.arrayBuffer()),file=o.sha256;
      insist(hash(bytes)===o.sha256 && bytes.length===o.size_bytes,'Original object byte mismatch.');writeFileSync(resolve(mount,file),bytes,{mode:0o400,flag:'wx'});
      const contentType=meta.mimetype,cacheControl=String(meta.cacheControl??meta.cache_control);
      insist(typeof contentType==='string' && contentType.length>0 && cacheControl!=='undefined' && !/[\r\n]/.test(contentType+cacheControl),'Exact original object metadata required.');
      objects.push({...o,file,version:native.version,contentType,cacheControl});
    }
    mark('BIND_WORKER_INPUT');const input={source_profile:a.source_profile,...(a.owner_profile?{owner_profile:a.owner_profile}:{}),database:{database_name:id.database_name,database_oid:id.database_oid,database_owner:id.database_owner,session_user:id.session_user,current_user:id.current_user},intent,migration_count:migrationCount,migrations_sha256:migrationsHash,objects};
    durable(resolve(custody,'WORKER_INPUT_REDACTED.json'),{input_sha256:hash(stable(input)),worker_sha256:hash(readFileSync(fileURLToPath(import.meta.url))),
      original_intent_sha256:hash(stable(original)),archive_digest:s.archive_digest,database_oid:id.database_oid,migrations_full_tuple_sha256:migrationsHash,
      objects:objects.map(o=>({sha256:o.sha256,size_bytes:o.size_bytes,version_sha256:hash(String(o.version))})),secrets_retained:false});
    durable(resolve(mount,'input.json'),input);writeFileSync(resolve(mount,'worker.mjs'),readFileSync(fileURLToPath(import.meta.url)),{mode:0o400,flag:'wx'});
    mark('VERIFY_OWNED_POSTGRES');const pgName='mz_schema_rebuild_'+process.env.GITHUB_RUN_ID;
    const pg=JSON.parse(await run(['docker','inspect','--format',inspectFormat,pgName]));insist(pg.Name==='/'+pgName && pg.Config.Image===PG_IMAGE && /^[a-f0-9]{64}$/.test(pg.Id),'Existing owned PG identity mismatch.');pgid=pg.Id;
    if(a.owner_profile){
      assertPrivatePgOwnerProfile(pg,a.owner_profile);
      const names=Object.keys(pg.NetworkSettings.Networks);insist(names.length===1,'Private PG must retain its sole parent-owned network.');
      network=names[0];const endpoint=pg.NetworkSettings.Networks[network];
      networkId=endpoint.NetworkID;alias=pgName;
      insist((endpoint.Aliases||[]).includes(pgName) || (endpoint.DNSNames||[]).includes(pgName),'Existing private PG name must be its verified DNS alias.');
      privateNetwork=Object.freeze({networkId,networkName:network,owner:pg.Config.Labels['custodial.private-backup-rehearsal'],pgid,pgName,address:endpoint.IPAddress});
      assertPrivateNetworkMembers(JSON.parse(await run(['docker','network','inspect',networkId]))[0],privateNetwork);
    }
    mark('BOUND_OWNED_POSTGRES');const pgMemory=a.source_profile==='native-text-v4-fresh-supabase-admin'?'2g':'1g';
    if(pgMemory==='2g')memoryFloor(4*1024**3);
    await run(['docker','update','--memory',pgMemory,'--memory-swap',pgMemory,'--cpus','1','--pids-limit','256',pgid]);
    const boundedPg=JSON.parse(await run(['docker','inspect','--format',inspectFormat,pgid]));
    assertPinnedPgResources(boundedPg,pgid,pgName,a.source_profile);
    const pgPorts=boundedPg.NetworkSettings.Ports['5432/tcp'];
    if(a.source_profile==='native-text-v4-fresh-supabase-admin')
      insist(pgPorts?.length===1 && pgPorts[0].HostIp==='127.0.0.1' && Number(pgPorts[0].HostPort)===Number(u.port),'Exact owned PG loopback port mismatch.');
    else assertPrivatePgOwnerProfile(boundedPg,a.owner_profile);
    // Archive roles intentionally exclude passwords. Initialize only this
    // disposable existing role's credential, never LOGIN/grants/HBA or actor.
    const bootstrap=decodeURIComponent(u.password);
    insist(/^(?:postgres|[a-f0-9]{64})$/.test(bootstrap),'Fixed disposable bootstrap credential shape required.');
    mark('READ_CREDENTIAL_BASELINE');const beforeCredential=await withDatabase(async db=>{await requireSameIdentity(db);return (await db.query(STORAGE_CREDENTIAL_NONSECRET_SQL)).rows[0].snapshot;});
    insist(beforeCredential.role?.login===true,'Existing login Storage role required; no attribute changes admitted.');
    const credentialSQL="\\set VERBOSITY terse\nset log_statement='none';\nset log_min_error_statement='panic';\n"+
      "do $credential$ begin if current_setting('log_statement')<>'none' then raise exception 'Credential logging refused'; end if; end $credential$;\n"+
      "alter role supabase_storage_admin password '"+bootstrap.replaceAll("'","''")+"';\n";
    mark('INITIALIZE_EPHEMERAL_CREDENTIAL');await run(['docker','exec','-i',pgid,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',id.database_name],{input:credentialSQL});
    mark('VERIFY_CREDENTIAL_INVARIANCE');const afterCredential=await withDatabase(async db=>{await requireSameIdentity(db);return (await db.query(STORAGE_CREDENTIAL_NONSECRET_SQL)).rows[0].snapshot;});
    insist(stable(beforeCredential)===stable(afterCredential),'Password-only setup changed nonsecret role/membership/ACL/owner metadata.');
    durable(resolve(custody,'STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE.json'),{role:'supabase_storage_admin',before:beforeCredential,after:afterCredential,
      database_oid:id.database_oid,owned_container_id:pgid,only_ephemeral_password_initialized:true,plaintext_or_verifier_exported:false});

    mark('PREPARE_PROVIDER_CONFIG');const secret=randomBytes(32).toString('hex'),now=Math.floor(Date.now()/1000),jwt=(role)=>{
      const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:'supabase',iat:now,exp:Math.min(Math.floor(Date.parse(intent.expires_at)/1000),now+Math.ceil(budget.work_ms/1000)+30)})).toString('base64url');
      return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');};
    const serviceKey=jwt('service_role'),internal=new URL(databaseUrl);internal.hostname=alias;internal.port='5432';internal.username='supabase_storage_admin';
    const gateUrl=new URL(internal);gateUrl.username=a.expected_session_user;
    const config={DATABASE_URL:internal.href,CUSTODIAL_GATE_DATABASE_URL:gateUrl.href,AUTH_JWT_SECRET:secret,SERVICE_KEY:serviceKey,ANON_KEY:jwt('anon'),TENANT_ID:s.project_ref,PROJECT_REF:s.project_ref,
      GLOBAL_S3_BUCKET:'stub',STORAGE_BACKEND:'file',STORAGE_FILE_BACKEND_PATH:'/owned-files',STORAGE_FILE_ETAG_ALGORITHM:'md5',
      DB_INSTALL_ROLES:'false',DB_ALLOW_MIGRATION_REFRESH:'false',DB_MIGRATIONS_FREEZE_AT:a.source_profile==='native-text-v4-fresh-supabase-admin'?supportedOfficialStartupMigration(typed,a.source_profile):typed.at(-1).name,
      DATABASE_MAX_CONNECTIONS:'8',PG_QUEUE_ENABLE:'false',IMAGE_TRANSFORMATION_ENABLED:'false',PORT:'5000'};
    const envFile=resolve(custody,'provider.env');writeFileSync(envFile,Object.entries(config).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600,flag:'wx'});
    mark('VERIFY_PROVIDER_NETWORK');
    if(!privateNetwork){
      networkId=(await run(['docker','network','create','--internal','--label','custodial.owner='+namespace,network])).trim();networkBorn=true;
      insist(/^[a-f0-9]{64}$/.test(networkId),'Owned network identity missing.');
      await run(['docker','network','connect','--alias',alias,network,pgid]);connected=true;
    }else assertPrivateNetworkMembers(JSON.parse(await run(['docker','network','inspect',networkId]))[0],privateNetwork);
    mark('PIN_PROVIDER_IMAGES');
    await run(['docker','pull',MIRROR_IMAGE],{seconds:120});
    const mirrorMetadata=JSON.parse(await run(['docker','image','inspect','--format','{"id":{{json .Id}},"repo_digests":{{json .RepoDigests}},"user":{{json (index .Config "User")}}}',MIRROR_IMAGE]));
    const mirrorImageId=validatePinnedOfficialMirror(mirrorMetadata);
    durable(resolve(custody,'PINNED_OFFICIAL_MIRROR_METADATA.json'),{registry_reference:MIRROR_IMAGE,config_image_id:mirrorImageId,repo_digests:mirrorMetadata.repo_digests,default_root:true});
    await run(['docker','pull',IMAGE],{seconds:120});
    const imageMetadata=JSON.parse(await run(['docker','image','inspect','--format','{"id":{{json .Id}},"repo_digests":{{json .RepoDigests}},"user":{{json (index .Config "User")}}}',IMAGE]));
    verifiedImageId=validatePinnedOfficialImage(imageMetadata);
    insist(verifiedImageId===mirrorImageId,'Official mirror and original ECR config identities differ.');
    durable(resolve(custody,'PINNED_OFFICIAL_IMAGE_METADATA.json'),{registry_reference:IMAGE,config_image_id:verifiedImageId,repo_digests:imageMetadata.repo_digests,default_root:true});
    mark('CREATE_PROVIDER');cid=(await run(['docker','create','--name',namespace,'--label','custodial.owner='+namespace,'--network',network,
      '--cpus','1','--memory','512m','--pids-limit','128','--read-only','--tmpfs','/tmp:rw,size=32m','--tmpfs','/owned-files:rw,size=128m',
      '--env-file',envFile,'--mount',`type=bind,src=${mount},dst=/custody,readonly`,
      '--mount',`type=bind,src=${audit},dst=/audit`,'--entrypoint','node',IMAGE,'/custody/worker.mjs','--container-gate'])).trim();
    insist(/^[a-f0-9]{64}$/.test(cid),'Owned service CID missing.');await run(['docker','start',cid]);
    mark('VERIFY_PROVIDER');const inspect=JSON.parse(await run(['docker','inspect','--format',inspectFormat,cid]));
    insist(inspect.Id===cid && inspect.ImageId===verifiedImageId && inspect.Name==='/'+namespace && inspect.Config.Image===IMAGE && inspect.Config.Labels['custodial.owner']===namespace
      && inspect.HostConfig.Memory===512*1024**2 && inspect.HostConfig.NanoCpus===1e9 && inspect.HostConfig.ReadonlyRootfs===true,'Owned service identity/configuration mismatch.');
    const endpoint=inspect.NetworkSettings.Networks[network];
    insist(Object.keys(inspect.NetworkSettings.Networks).length===1 && endpoint?.NetworkID===networkId
      && isIP(endpoint.IPAddress)===4 && inspect.State.Running===true
      && Object.values(inspect.NetworkSettings.Ports||{}).every(v=>v===null),'Exact sole-internal service endpoint required.');
    const relayNetwork=JSON.parse(await run(['docker','network','inspect',network]))[0];
    if(privateNetwork)assertPrivateNetworkMembers(relayNetwork,privateNetwork,cid);
    else insist(relayNetwork.Id===networkId && relayNetwork.Name===network && relayNetwork.Internal===true
      && relayNetwork.Labels['custodial.owner']===namespace && Object.keys(relayNetwork.Containers||{}).length===2
      && Object.hasOwn(relayNetwork.Containers,cid) && Object.hasOwn(relayNetwork.Containers,pgid),'Exact owned internal relay network required.');
    const destination=endpoint.IPAddress;
    const inspectRelay=argv=>{insist(!relayClosing,'Relay inspection refused after cleanup starts.');
      return run(argv,privateNetwork?{seconds:10,abortSignal:relayInspectionController.signal}:{});};
    const assertRelayTarget=async()=>{const v=JSON.parse(await inspectRelay(['docker','inspect','--format',inspectFormat,cid]));
      insist(v.Id===cid && v.ImageId===verifiedImageId && v.Name==='/'+namespace && v.Config.Image===IMAGE && v.Config.Labels['custodial.owner']===namespace
        && v.State.Running===true && Object.keys(v.NetworkSettings.Networks).length===1
        && v.NetworkSettings.Networks[network]?.NetworkID===networkId && v.NetworkSettings.Networks[network]?.IPAddress===destination
        && Object.values(v.NetworkSettings.Ports||{}).every(p=>p===null),'Owned relay target identity changed.');
      if(privateNetwork){
        const pg=JSON.parse(await inspectRelay(['docker','inspect','--format',inspectFormat,pgid]));
        assertPrivatePgOwnerProfile(pg,a.owner_profile);
        insist(pg.Id===pgid && pg.Name==='/'+privateNetwork.pgName && pg.Config.Image===PG_IMAGE && pg.State.Running===true
          && stable(Object.keys(pg.NetworkSettings.Networks))===stable([network])
          && pg.NetworkSettings.Networks[network].NetworkID===networkId && pg.NetworkSettings.Networks[network].IPAddress===privateNetwork.address,'Private PG attachment changed.');
        assertPrivateNetworkMembers(JSON.parse(await inspectRelay(['docker','network','inspect',networkId]))[0],privateNetwork,cid);
      }
    };
    mark('BIND_OWNED_RELAY');relayClosed=false;
    relay=createServer(client=>{
      if(stopping || relayClosing || Date.now()>=deadline || relaySockets.size>=64){client.destroy();return;}
      const connect=()=>{
        if(client.destroyed || stopping || relayClosing){client.destroy();return;}
        const upstream=createConnection({host:destination,port:5000});
        for(const socket of [client,upstream]){relaySockets.add(socket);socket.setTimeout(10000);
          socket.on('timeout',()=>socket.destroy());socket.on('error',()=>{client.destroy();upstream.destroy();});
          socket.on('close',()=>{relaySockets.delete(socket);if(socket===client)upstream.destroy();else client.destroy();});}
        client.pipe(upstream);upstream.pipe(client);client.resume();
      };
      if(!privateNetwork){connect();return;}
      client.pause();relaySockets.add(client);client.on('error',()=>client.destroy());client.on('close',()=>relaySockets.delete(client));
      const pending=assertRelayTarget().then(connect).catch(()=>client.destroy()).finally(()=>relayPending.delete(pending));relayPending.add(pending);
    });
    await new Promise((yes,no)=>{relay.once('error',no);relay.listen({host:'127.0.0.1',port:0,exclusive:true},yes);});
    relay.on('error',()=>{stopping=true;for(const socket of relaySockets)socket.destroy();});
    const listener=relay.address();insist(listener.address==='127.0.0.1' && listener.port>0 && listener.port<=65535,'Owned loopback listener refused.');
    const relayBinding={origin:'http://127.0.0.1:'+listener.port,container_id:cid,container_name:namespace,image:IMAGE,config_image_id:verifiedImageId,
      network_id:networkId,network_name:network,destination_address:destination,destination_port:5000,external_network_attached:false,payloads_logged:false};
    durable(resolve(custody,'OWNED_LOOPBACK_RELAY_BOUND.json'),relayBinding);
    await assertRelayTarget();
    mark('VERIFY_CURRENT_TARGET');await withDatabase(requireSameIdentity);
    mark('BIND_PROVIDER_ENVELOPE');const binding={purpose:'custodial-immutable-fresh-local-storage-provider',source_profile:a.source_profile,...(a.owner_profile?{owner_profile:a.owner_profile}:{}),original_intent_sha256:hash(stable(original)),
      ...Object.fromEntries(['restore_id','authority_generation','archive_digest','source_identity_sha256','source_project_ref','target_project_ref'].map(k=>[k,intent[k]])),
      approved_at:new Date().toISOString(),expires_at:intent.expires_at,
      host_target:{hostname:'127.0.0.1',port:Number(u.port),database_name:id.database_name,database_oid:id.database_oid,session_user:a.expected_session_user,database_owner:id.database_owner},
      provider:{origin:relayBinding.origin,container_id:cid,image_digest:IMAGE.split('@')[1],namespace,
        config_sha256:hash(stable({environment:config,relay:relayBinding})),service_key_sha256:hash(serviceKey),jwt_secret_sha256:hash(secret),database:{network_alias:alias,port:5432,database_name:id.database_name,database_oid:id.database_oid,role:'supabase_storage_admin'},
        backend:'file',restore_method:'official-file-backend-archived-version-v1',archived_storage_inventory_sha256:a.archived_storage_inventory_sha256,
        archived_migrations_74_full_tuple_sha256:migrationsHash,file_backend_namespace_sha256:hash(stable({namespace,empty:true,objects:objects.map(o=>({file:o.file,sha256:o.sha256,size_bytes:o.size_bytes,version:o.version}))}))}};
    const envelope={format:'custodial.immutable-fresh-local-storage-provider.v1',algorithm:'hmac-sha256',key_id:process.env.RESTORE_INTENT_VERIFY_KEY_ID,binding,signature:sign(binding,process.env.RESTORE_INTENT_VERIFY_KEY)};
    storage.validateFreshLocalStorageProviderData({providerEnvelope:envelope,originalIntentEnvelope:original,intentVerifyKey:process.env.RESTORE_INTENT_VERIFY_KEY,
      intentVerifyKeyId:process.env.RESTORE_INTENT_VERIFY_KEY_ID,serviceKey,jwtSecret:secret,databaseUrl,
      expected:{source_profile:a.source_profile,...(a.owner_profile?{owner_profile:a.owner_profile}:{}),expected_session_user:a.expected_session_user,expected_database_owner:a.expected_database_owner,
        archive_digest:s.archive_digest,source_project_ref:s.project_ref,source_identity_sha256:s.source_identity_sha256,archived_storage_inventory_sha256:a.archived_storage_inventory_sha256}});
    const allowed=/^Cpus_allowed_list:\s+([0-9]+)/m.exec(readFileSync('/proc/self/status','utf8'));insist(allowed,'CPU affinity unavailable.');
    mark('RESTORE_ORIGINAL_DATA');const stdout=await run(['taskset','-c',allowed[1],process.execPath,'--max-old-space-size='+budget.node_heap_mib,resolve(root,'scripts/production-restore.mjs')],{seconds:budget.work_ms/1000,
      env:{...process.env,SUPABASE_DB_URL:databaseUrl,RESTORE_FRESH_STORAGE_PROVIDER_JSON:JSON.stringify(envelope),RESTORE_FRESH_STORAGE_SERVICE_KEY:serviceKey,RESTORE_FRESH_STORAGE_JWT_SECRET:secret}});
    mark('VERIFY_RESTORE_OUTPUT');output=storageResult(JSON.parse(stdout),s,intent);
    await assertRelayTarget();
    mark('VERIFY_FINAL_CATALOG');const before=JSON.parse(readFileSync(resolve(audit,'STORAGE_CATALOG_BEFORE_PROVIDER.json'),'utf8'));
    const {after,actual}=await withDatabase(async db=>{await requireSameIdentity(db);return {after:await storageCatalog(db),actual:await db.query('select row_to_json(m) row from storage.migrations m order by id')};});
    insist(hash(stable(before.catalog))===before.sha256 && before.sha256===after.sha256 && stable(before.catalog)===stable(after.catalog),'Official provider changed Storage catalog/ACL/role metadata.');
    durable(resolve(custody,'STORAGE_CATALOG_AFTER_PROVIDER.json'),after);
    insist(actual.rowCount===migrationCount && hash(stable(actual.rows.map(x=>x.row)))===migrationsHash,'Official startup changed archived migration metadata.');
    mark('VERIFY_PROVIDER_COMPLETE');durable(resolve(custody,'PROVIDER_VERIFIED.json'),{provider_verified:true,production_provider_verified:false,archive_digest:s.archive_digest,original_intent_sha256:hash(stable(original)),
      namespace,container_id:cid,image:IMAGE,database_oid:id.database_oid,archived_migrations_74_full_tuple_sha256:migrationsHash,actual_archived_migration_count:migrationCount,resource_profile:budget,buckets:a.bucket_count,objects:a.object_count});
  }catch(e){failure??=e;report('REFUSED',e);}
  finally{
    hostCleaning=true;mark('CLEANUP_RELAY');cleanupBudget.deadline??=Date.now()+45000;relayClosing=true;relayInspectionController.abort();
    try{if(relay){
      await closeOwnedRelay(relay,relaySockets,cleanupBudget.deadline);relayClosed=true;
      await Promise.allSettled([...relayPending]);
      durable(resolve(custody,'OWNED_LOOPBACK_RELAY_CLOSED.json'),{listener_closed:true,owned_sockets_remaining:0,before_container_removal:true});}}
    catch(e){cleanupFailure=e;failure??=e;}
    mark('CLEANUP_CLIENTS');for(const client of nativeClients)try{await client.end();}catch(e){cleanupFailure??=e;failure??=e;}nativeClients.clear();
    mark('CLEANUP_PROVIDER');
    try{
      if(!cid){const candidates=(await run(['docker','ps','-aq','--no-trunc','--filter','name=^/'+namespace+'$'],{cleanup:true})).trim().split('\n').filter(Boolean);insist(candidates.length<=1,'Ambiguous cleanup name.');cid=candidates[0]??null;}
      if(cid){const v=JSON.parse(await run(['docker','inspect','--format',inspectFormat,cid],{cleanup:true}));insist(v.Id===cid && v.ImageId===verifiedImageId && v.Config.Labels['custodial.owner']===namespace && v.Config.Image===IMAGE,'Cleanup identity mismatch.');
        if(failure)try{
          const envPath=resolve(custody,'provider.env'),values=existsSync(envPath)?readFileSync(envPath,'utf8').split('\n').filter(line=>/^(?:DATABASE_URL|CUSTODIAL_GATE_DATABASE_URL|AUTH_JWT_SECRET|SERVICE_KEY|ANON_KEY)=/.test(line)).map(line=>line.slice(line.indexOf('=')+1)):[];
          await run(['docker','logs','--timestamps','--tail','120',cid],{cleanup:true,seconds:10,logSecrets:values});
        }catch{durable(resolve(custody,'PROVIDER_LOG_CAPTURE_REFUSED.json'),{fixed_owned_container:cid,original_exception_preserved:true,raw_logs_exported:false});}
        await run(['docker','rm','-f',cid],{cleanup:true});
        // A missing exact CID is established by successful empty filtered lists.
        insist(!(await run(['docker','ps','-aq','--filter','id='+cid],{cleanup:true})).trim(),'Owned service remains.');serviceAbsent=true;}else serviceAbsent=true;
      if(privateNetwork){
        assertPrivateNetworkMembers(JSON.parse(await run(['docker','network','inspect',networkId],{cleanup:true}))[0],privateNetwork);
        borrowedNetworkRetained=true;
      }else{
      const networks=(await run(['docker','network','ls','-q','--filter','label=custodial.owner='+namespace],{cleanup:true})).trim().split('\n').filter(Boolean);
      insist(networks.length<=1,'Ambiguous owned network.');
      if(networks.length){const n=JSON.parse(await run(['docker','network','inspect',network],{cleanup:true}))[0];
        if(pgid && Object.hasOwn(n.Containers||{},pgid))await run(['docker','network','disconnect',network,pgid],{cleanup:true});
        const after=JSON.parse(await run(['docker','network','inspect',network],{cleanup:true}))[0];
        insist(Object.keys(after.Containers||{}).length===0,'Foreign network member prevents cleanup.');insist(n.Labels['custodial.owner']===namespace && Object.keys(after.Containers||{}).length===0,'Foreign network member prevents cleanup.');await run(['docker','network','rm',network],{cleanup:true});}
      insist(!(await run(['docker','network','ls','--no-trunc','-q','--filter','name=^'+network+'$'],{cleanup:true})).trim(),'Owned network name remains.');
      if(networkId)insist(!(await run(['docker','network','ls','--no-trunc','-q','--filter','id='+networkId],{cleanup:true})).trim(),'Owned network ID remains.');networkAbsent=true;
      }
    }catch(e){cleanupFailure=e;failure??=e;}
    mark('CLEANUP_ARCHIVE');try{archive?.cleanup();}catch(e){failure??=e;}
    // Private source bytes/local keys live only in this owned directory.
    mark('CLEANUP_PRIVATE_INPUTS');try{rmSync(resolve(custody,'provider-input'),{recursive:true,force:true});rmSync(resolve(custody,'provider.env'),{force:true});}catch(e){failure??=e;}
    mark('WRITE_FINAL_RECEIPT');durable(resolve(custody,'FINAL.json'),{ok:!failure,provider_verified:!failure,production_provider_verified:false,resource_namespace:namespace,
      service_born:cid!==null,service_CID_or_name_fresh_absent:serviceAbsent,network_fresh_absent:networkAbsent,...(privateNetwork?{borrowed_network_retained_verified:borrowedNetworkRetained}:{}),relay_closed_or_never_born:relayClosed,cleanup_checked:cleanupFailure===null && relayClosed && serviceAbsent && (privateNetwork?borrowedNetworkRetained:networkAbsent),scope:'OFFICIAL_LOCAL_FILE_BACKEND_SAME_ORIGINAL',error:failure?'OWNING_REHEARSAL_REFUSED':null});
    mark('EXPORT_FINAL_EVIDENCE');const evidence=resolve(tmp,'official-local-storage-provider-evidence',namespace);mkdirSync(evidence,{recursive:true,mode:0o700});
    if(privacy.privateData){
      for(const name of readdirSync(custody))if(privateEvidenceFile(name))durable(resolve(evidence,name),privateEvidenceReceipt(name,readFileSync(resolve(custody,name))));
    }else{
    for(const name of readdirSync(custody))if(/^(?:[0-9]{3}\.(?:INTENT\.json|OWNER\.json|ACTUAL_WAIT\.json|stdout|stderr|(?:stdout|stderr)\.REDACTION\.json)|FINAL\.json|PROVIDER_VERIFIED\.json|ARCHIVED_STORAGE_MIGRATIONS_FULL_TUPLES\.json|PROVIDER_LOG_CAPTURE_REFUSED\.json|WORKER_INPUT_REDACTED\.json|STORAGE_CATALOG_AFTER_PROVIDER\.json|OWNED_LOOPBACK_RELAY_(?:BOUND|CLOSED)\.json|PINNED_OFFICIAL_(?:IMAGE|MIRROR)_METADATA\.json|STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE\.json)$/.test(name))copyFileSync(resolve(custody,name),resolve(evidence,name));
    }
    for(const name of ['STORAGE_CATALOG_BEFORE_PROVIDER.json','PROVIDER_STARTUP_FAILURE.json']){
      const file=resolve(custody,'provider-audit',name);if(existsSync(file)){
        if(privacy.privateData)durable(resolve(evidence,name),privateEvidenceReceipt(name,readFileSync(file)));
        else copyFileSync(file,resolve(evidence,name));
      }
    }
    mark('CLEANUP_PRIVATE_EVIDENCE');if(privacy.privateData)for(const name of ['STORAGE_CATALOG_AFTER_PROVIDER.json','STORAGE_ROLE_CREDENTIAL_NONSECRET_INVARIANCE.json','ARCHIVED_STORAGE_MIGRATIONS_FULL_TUPLES.json'])rmSync(resolve(custody,name),{force:true});
    rmSync(resolve(custody,'provider-audit'),{recursive:true,force:true});
  }
  if(failure)throw failure;hostPhase='HOST_FINISHED';startup.stage(hostPhase,'FINISHED');process.stdout.write(JSON.stringify(output)+'\n');
  }catch(error){report('REFUSED',error);throw error;}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv.slice(2);insist(mode.length===0 || mode.length===1 && mode[0]==='--container-gate','Unsupported lifecycle mode.');
  if(!mode.length)for(const signal of ['SIGTERM','SIGINT'])process.on(signal,stop);
  (mode.length?containerGate():host()).catch(()=>{process.stderr.write('Official local Storage original refused; private bounded receipts retained.\n');process.exitCode=1;});
}
