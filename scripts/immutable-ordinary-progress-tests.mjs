import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {removeOrdinaryProgressObservations} from './immutable-ordinary-progress-source-proof.mjs';
import {privateRestoreStageDiagnostic,projectPrivateRestoreDiagnostic,readPrivateRestoreDiagnostics,privateRestoreStreamDiagnostic,privateEvidenceReceipt} from './run-official-local-storage-rehearsal.mjs';
import {immutableFreshDiagnosticFields} from './immutable-private-stage-diagnostic.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const keys=['RESTORE_PRIVATE_DIAGNOSTICS','REHEARSAL_SCOPE','OFFICIAL_LOCAL_STORAGE_PROVIDER','RESTORE_DATABASE_ONLY'];
const wanted=['bounded-v1','backup_only','true','true'];
const ordinary=(n=0)=>({import_relation_schema:'public',ordinary_relation_sha256:sha('UNIT_RELATION:'+n),ordinary_mode:'BOUNDED_STAGE',ordinary_phase:'SOURCE_OPEN'});
const source=name=>readFileSync(new URL('./'+name,import.meta.url),'utf8');
test('every importer and diagnostic predecessor byte survives only the exact observational hunks',()=>{
 for(const [name,pin]of [['immutable-private-data-import.mjs','f272943d343494aeeee0be5905d6f2f8e3e15beecc45d7646d127305aa80707b'],
  ['immutable-private-stage-diagnostic.mjs','17369227abaa714349d9a6361273aa9e2d9c09dc2588874f7b808541752046a8']]){
  const current=source(name),prior=removeOrdinaryProgressObservations(name,current);assert.equal(sha(prior),pin);
  assert.equal(removeOrdinaryProgressObservations(name,prior),prior);
  assert.throws(()=>removeOrdinaryProgressObservations(name,current+' '));
 }
 const program=readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url));
 assert.equal(sha(program),'6f35188dc390ec414f55270dbe6f472ea7887a7c028b777528916e6dff029661');
 assert.ok(program.equals(readFileSync(new URL('../proposals/immutable-private-current-postgres-program-absence-candidate.json',import.meta.url))));
 assert.throws(()=>removeOrdinaryProgressObservations('caller-selected-file',source('immutable-private-data-import.mjs')));
});
test('each exact existing private opt-in remains necessary for ordinary progress',async()=>{
 const {recordImmutableFreshProgress:record}=await import('./immutable-private-stage-diagnostic.mjs?ordinary_optin_test');
 const saved=keys.map(k=>process.env[k]),error=console.error,lines=[];
 try{console.error=line=>lines.push(line);
  for(let omit=0;omit<4;omit++){keys.forEach((k,i)=>process.env[k]=wanted[i]);delete process.env[keys[omit]];record(ordinary());assert.equal(lines.length,0);}
  keys.forEach((k,i)=>process.env[k]=wanted[i]);record(ordinary());assert.equal(lines.length,1);
 }finally{console.error=error;keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
test('closed fields reject getters/proxies and disclose no table names, row values or arbitrary fields',()=>{
 let traps=0;const secret='UNIT_PRIVATE_SENTINEL_NEVER_EXPORT';
 const hostile=new Proxy({},{getOwnPropertyDescriptor(){traps++;throw Error(secret);},ownKeys(){traps++;throw Error(secret);}});
 assert.deepEqual(immutableFreshDiagnosticFields(hostile),{});assert.equal(projectPrivateRestoreDiagnostic(hostile),null);assert.equal(traps,0);
 const fields=immutableFreshDiagnosticFields({...ordinary(),table_name:secret,row:secret,sql:secret});
 assert.deepEqual(Object.keys(fields).sort(),['import_relation_schema','ordinary_mode','ordinary_phase','ordinary_relation_sha256']);
 assert.ok(!JSON.stringify(fields).includes(secret));
 for(const change of [{ordinary_mode:'arbitrary'},{ordinary_phase:'arbitrary'},{ordinary_relation_sha256:secret},{import_relation_schema:secret}]){
  const projected=immutableFreshDiagnosticFields({...ordinary(),...change});assert.equal(Object.hasOwn(projected,'ordinary_phase'),false);assert.equal(Object.hasOwn(projected,'ordinary_mode'),false);assert.equal(Object.hasOwn(projected,'ordinary_relation_sha256'),false);
 }
 const record=privateRestoreStageDiagnostic('stage_fresh_private_database','ENTER',null,ordinary());
 assert.deepEqual(projectPrivateRestoreDiagnostic(record),record);
 for(const extra of [{table_name:secret},{row_count:'2'},{retry_allowed:'true'},{ok:'true'}])assert.equal(projectPrivateRestoreDiagnostic({...record,...extra}),null);
});
test('full finite producer stream retains last5 ordinary checkpoints and the real refusal through both privacy layers',async()=>{
 const {recordImmutableFreshProgress:record}=await import('./immutable-private-stage-diagnostic.mjs?ordinary_finite_stream_test');
 const saved=keys.map(k=>process.env[k]),error=console.error,lines=[],secret='UNIT_PRIVATE_SENTINEL_NEVER_EXPORT';
 try{
  keys.forEach((k,i)=>process.env[k]=wanted[i]);console.error=line=>lines.push(line);
  for(let i=0;i<80;i++)record({fresh_stage:'INITIALIZE_SOURCE',ignored:secret});assert.equal(lines.length,64);
  for(let i=0;i<2050;i++)record({...ordinary(i),table_name:secret,row:secret});assert.equal(lines.length,64+2048);
  assert.ok(lines.slice(64).every(line=>Buffer.byteLength(line)<=384));assert.ok(lines.every(line=>!line.includes(secret)));
  const refused=privateRestoreStageDiagnostic('stage_fresh_private_database','REFUSED',{code:'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'},{fresh_stage:'IMPORT_ORIGINAL_DATA'});
  const raw=Buffer.from(lines.join('\n')+'\n'+JSON.stringify(refused)+'\n'+secret);assert.ok(raw.length<1048576);
  const first=privateRestoreStreamDiagnostic(raw,true),second=privateEvidenceReceipt('017.stderr',Buffer.from(JSON.stringify(first)));
  assert.equal(first.restore_diagnostics.length,70);assert.deepEqual(second.restore_diagnostics,first.restore_diagnostics);
  assert.deepEqual(second.restore_diagnostics.at(-1),refused);
  const latest=second.restore_diagnostics.filter(r=>r.ordinary_phase);assert.equal(latest.length,5);
  assert.deepEqual(latest.map(r=>r.ordinary_relation_sha256),Array.from({length:5},(_,i)=>ordinary(2043+i).ordinary_relation_sha256));
  assert.ok(!JSON.stringify(second).includes(secret));
  const fresh=await import('./immutable-private-stage-diagnostic.mjs?ordinary_console_failure_test');console.error=()=>{throw Error(secret);};assert.doesNotThrow(()=>fresh.recordImmutableFreshProgress(ordinary()));
 }finally{console.error=error;keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
test('original128-record refusal ceiling stays intact and has priority over ordinary progress',()=>{
 const base=privateRestoreStageDiagnostic('stage_fresh_private_database','ENTER',null,{fresh_stage:'IMPORT_ORIGINAL_DATA'});
 const denied=privateRestoreStageDiagnostic('stage_fresh_private_database','REFUSED',{code:'PRIVATE_ORIGINAL_DATA_IMPORT_UNSUPPORTED'});
 const progress=privateRestoreStageDiagnostic('stage_fresh_private_database','ENTER',null,ordinary());
 const encode=records=>Buffer.from(records.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const original=Array.from({length:127},()=>base),withProgress=[];
 for(const record of original)withProgress.push(record,progress);withProgress.push(denied);
 assert.deepEqual(readPrivateRestoreDiagnostics(encode(withProgress)),[...original,denied]);
 assert.deepEqual(readPrivateRestoreDiagnostics(encode([...original,base,denied])),[]);
 assert.deepEqual(readPrivateRestoreDiagnostics(Buffer.alloc(1048577)),[]);
});
