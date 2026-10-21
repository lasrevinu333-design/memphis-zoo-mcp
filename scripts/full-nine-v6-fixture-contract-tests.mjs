import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {FULL_NINE_V6_IDENTITIES as P,validateFullNineV6FixtureBytes,
 extractFullNineV6SourceFixtureBytes,loadFullNineV6Source} from './fixtures/full-nine-v6-source.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixtureUrl=new URL('./fixtures/full-nine-v6-source.json',import.meta.url);

export function runFullNineV6FixtureContractTests({retainedPacketPath=null}={}){
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
 const bytes=fs.readFileSync(fixtureUrl),fixture=JSON.parse(bytes);
 check('included exact fixture identity and lossless input hashes',()=>{
  assert.equal(sha(bytes),'a1b43408c9b61ba4bb93ae3d0f78dcab3efdde9ffd4fa7a945005d2ae045ab04');
  assert.equal(P.originalPacketSha256,'2aab217b29482894b883ce36a3d7a44516d8fc4aa2b329471551b2f4c9a86981');
  assert.equal(P.compilerInputCompactSha256,'b0c1cc4bcab7892811a1a81db72907421820208c56f1688177df40198a92b01c');
  assert.deepEqual(validateFullNineV6FixtureBytes(bytes),fixture);
 });
 check('clean checkout loader reads only its included module-relative fixture',()=>{
  const read=fs.readFileSync,calls=[];
  try{fs.readFileSync=(file,...args)=>{assert.equal(String(file),String(fixtureUrl));calls.push(String(file));return read(file,...args);};
   const loaded=loadFullNineV6Source();assert.equal(calls.length,1);assert.equal(loaded.originalWrapperVerified,false);
   assert.equal(loaded.historicalSourceOnly,true);assert.equal(loaded.sourceId,P.sourceId);assert.equal(loaded.sourceDigest,P.sourceDigest);
   assert.deepEqual(loaded.compilerInput,fixture.compilerInput);
  }finally{fs.readFileSync=read;}
 });
 check('independent loads return unshared input and provenance',()=>{
  const first=loadFullNineV6Source();first.compilerInput.version.assignments.pop();first.provenance.classification='forged';
  assert.deepEqual(loadFullNineV6Source().compilerInput,fixture.compilerInput);assert.deepEqual(loadFullNineV6Source().provenance,fixture.provenance);
 });
 for(const [name,change]of[
  ['missing work313',f=>f.compilerInput.version.assignments.pop()],
  ['extra work323',f=>f.compilerInput.version.assignments.push(...structuredClone(f.compilerInput.version.assignments.slice(0,9)))],
  ['reordered work',f=>f.compilerInput.version.assignments.reverse()],
  ['altered split member',f=>f.compilerInput.version.assignments[0].includedLocations.pop()],
  ['altered original effort',f=>f.compilerInput.version.assignments[0].serviceEffortMinutes++],
  ['synthetic incumbent',f=>f.compilerInput.slots[0].incumbencies.push({personId:'synthetic',effectiveStart:'2026-09-28',effectiveEnd:null})],
  ['changed proximity',f=>f.compilerInput.proximity[0].minutes++],
  ['reordered slots',f=>f.compilerInput.slots.reverse()],
  ['source identity',f=>f.sourceId='00000000-0000-4000-8000-000000000001'],
  ['source digest',f=>f.sourceDigest='0'.repeat(64)],
  ['caller recomputed compact digest',f=>{f.compilerInput.version.assignments.pop();f.compilerInputCompactSha256=sha(JSON.stringify(f.compilerInput));}],
  ['unknown provenance',f=>f.provenance.newAuthority=true],
  ['wrong original wrapper pin',f=>f.provenance.originalPacketSha256='0'.repeat(64)],
  ['current authority mislabel',f=>f.provenance.classification='CURRENT_AUTHORITY'],
  ['historical flag removed',f=>delete f.historicalSourceOnly],
  ['historical flag false',f=>f.historicalSourceOnly=false],
  ['unknown schema',f=>f.schema+='-unknown'],
  ['extra original wrapper metadata',f=>f.verification={verifierOk:true}],
  ['omitted input field',f=>delete f.compilerInput.exceptions],
 ])check('reject included-byte mutation: '+name,()=>{const changed=structuredClone(fixture);change(changed);
  assert.throws(()=>validateFullNineV6FixtureBytes(Buffer.from(JSON.stringify(changed)+'\n')));});
 for(const [name,altered]of[
  ['truncation',bytes.subarray(0,bytes.length-1)],['trailing byte',Buffer.concat([bytes,Buffer.from(' ')])],
  ['same-size invalid JSON',Buffer.concat([Buffer.from('!'),bytes.subarray(1)])],['empty',Buffer.alloc(0)],
  ['non-Buffer caller object',fixture],['non-Buffer string',bytes.toString()],
 ])check('reject '+name,()=>assert.throws(()=>validateFullNineV6FixtureBytes(altered)));
 for(const [name,failed]of[['missing fixture',null],['invalid fixture',Buffer.from('{}')]])
  check(name+' cannot fall back to original or local data',()=>{
   const read=fs.readFileSync;let calls=0;
   try{fs.readFileSync=file=>{assert.equal(String(file),String(fixtureUrl));calls++;if(failed===null)throw Object.assign(new Error('synthetic fixture absent'),{code:'ENOENT'});return failed;};
    assert.throws(()=>loadFullNineV6Source({retainedPacketPath:'explicit-original-must-not-be-read'}));assert.equal(calls,1);
   }finally{fs.readFileSync=read;}
  });
 for(const value of ['',false,0,{},[]])check('reject nonexplicit original path '+JSON.stringify(value),()=>assert.throws(()=>loadFullNineV6Source({retainedPacketPath:value})));
 check('missing optional original fails, never weakens included success',()=>{
  const read=fs.readFileSync;let reads=0;
  try{fs.readFileSync=(file,...args)=>{reads++;if(String(file)===String(fixtureUrl))return read(file,...args);throw Object.assign(new Error('synthetic original absent'),{code:'ENOENT'});};
   assert.throws(()=>loadFullNineV6Source({retainedPacketPath:'explicit-missing-original'}));assert.equal(reads,2);
  }finally{fs.readFileSync=read;}
 });
 check('compact input is not accepted as omitted whole wrapper',()=>assert.throws(()=>extractFullNineV6SourceFixtureBytes(Buffer.from(JSON.stringify(fixture.compilerInput)))));
 check('included extraction is not accepted as original wrapper',()=>assert.throws(()=>extractFullNineV6SourceFixtureBytes(bytes)));
 check('same-size forged original wrapper fails immutable whole-file hash',()=>assert.throws(()=>extractFullNineV6SourceFixtureBytes(Buffer.alloc(P.originalPacketBytes))));
 check('source loader has no host path/env/download/solver fallback and extraction refuses overwrite',()=>{
  const source=fs.readFileSync(new URL('./fixtures/full-nine-v6-source.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\/home\/|process\.env|fetch\(|https?:|child_process|initializeStaticWeeklySolverEngine|adaptRegisteredRecurringSource/);
  assert.match(source,/fs\.writeFileSync\(FIXTURE_URL,bytes,\{flag:'wx'/);
  assert.match(source,/assert\.equal\(sha\(bytes\),P\.originalPacketSha256/);
  assert.match(source,/assert\.equal\(postgresJsonbContentDigest\(input\),P\.sourceDigest/);
  assert.match(source,/assert\.equal\(contentDigest\(input\.version\.assignments\),P\.assignmentsDigest/);
 });
 const mandatoryChecks=checks;let originalComparisonChecks=0;
 assert.equal(mandatoryChecks,40,'all mandatory hosted fixture checks executed');
 // Optional local provenance reproof is explicit and separately counted; it is
 // not a skipped hosted transition test, and never creates fixture/source bytes.
 if(retainedPacketPath!==null){
  const original=fs.readFileSync(retainedPacketPath);
  check('explicit original whole-file extraction equals every included byte',()=>{
   assert.equal(sha(original),P.originalPacketSha256);assert.deepEqual(extractFullNineV6SourceFixtureBytes(original),bytes);
   assert.equal(JSON.stringify(JSON.parse(original).compilerInput),JSON.stringify(fixture.compilerInput));
  });originalComparisonChecks++;
  check('explicit original loader reports wrapper check only when actually performed',()=>{
   const loaded=loadFullNineV6Source({retainedPacketPath});assert.equal(loaded.originalWrapperVerified,true);
   assert.deepEqual(loaded.compilerInput,fixture.compilerInput);
  });originalComparisonChecks++;
  check('same-size one-byte original mutation is rejected before extraction',()=>{
   const changed=Buffer.from(original);changed[changed.length-2]^=1;
   assert.throws(()=>extractFullNineV6SourceFixtureBytes(changed),/original whole-wrapper byte identity/);
  });originalComparisonChecks++;
 }
 const receipt={schema:'custodial.full-nine-v6-fixture-contract-receipt.v1',checks,mandatoryChecks,originalComparisonChecks,
  fixtureSha256:P.fixtureSha256,sourceDigest:P.sourceDigest,assignmentCount:314,
  hostedVerifiesOmittedOriginalWrapper:false,originalWrapperCompared:retainedPacketPath!==null,
  solver:false,workerIpc:false,sql:false,network:false,registration:false,publication:false};
 console.log(JSON.stringify(receipt));return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.ok(process.argv.length===2||(process.argv.length===4&&process.argv[2]==='--original'));
 runFullNineV6FixtureContractTests({retainedPacketPath:process.argv[3]||null});
}
