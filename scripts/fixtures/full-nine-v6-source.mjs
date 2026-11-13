import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {postgresJsonbContentDigest} from '../../src/static-weekly-schedule-program.js';
import {contentDigest} from '../../src/static-weekly-schedule-model.js';

// The original wrapper is NOT included or reverified by hosted loading.
// These independently pinned input identities preserve its complete, unchanged
// compilerInput only; neither historical nor synthetic data is current authority.
export const FULL_NINE_V6_IDENTITIES=Object.freeze({
 originalPacketSha256:'2aab217b29482894b883ce36a3d7a44516d8fc4aa2b329471551b2f4c9a86981',
 originalPacketBytes:2722710,
 fixtureSha256:'a1b43408c9b61ba4bb93ae3d0f78dcab3efdde9ffd4fa7a945005d2ae045ab04',
 fixtureBytes:1332092,
 sourceId:'a00cdf2a-0623-5e2d-bc65-338c1dd67202',
 sourceDigest:'b2b0c7951b427a9f04b7d504d26591eb0e25f514c8e8652b1e6a5628d498abdc',
 compilerInputCompactSha256:'b0c1cc4bcab7892811a1a81db72907421820208c56f1688177df40198a92b01c',
 compilerInputCompactBytes:1331241,
 assignmentsDigest:'e6019fa1b2c5e0e2852a312a5d0af69ff54985c585977c710a8e0a5791be1efd',
});
const P=FULL_NINE_V6_IDENTITIES;
const FIXTURE_URL=new URL('./full-nine-v6-source.json',import.meta.url);
const SCHEMA='custodial.exact-full-nine-v6-source-fixture.v1';
const PROVENANCE=Object.freeze({
 originalPacket:'STATIC-WEEKLY-WEIGHTED-SCHEDULE-PACKET-V6-20260826.json',
 originalPacketSha256:P.originalPacketSha256,
 originalPacketBytes:P.originalPacketBytes,
 originalPacketClassification:'VERIFIED_SERVER_PACKET',
 classification:'HISTORICAL_COMPILER_INPUT_ONLY_NOT_CURRENT_ROSTER_OR_REGISTRATION',
 omitted:'outer roster/routes/proximity/effort/capacity duplicates, task/project/evidence paths, verification/simulation metadata; compilerInput retained losslessly',
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function buffer(bytes){assert.ok(Buffer.isBuffer(bytes),'explicit Buffer bytes required');return bytes;}
function validateInput(input){
 const compact=JSON.stringify(input);
 assert.equal(Buffer.byteLength(compact),P.compilerInputCompactBytes,'exact original compact input length');
 assert.equal(sha(compact),P.compilerInputCompactSha256,'exact original compact input bytes');
 assert.equal(postgresJsonbContentDigest(input),P.sourceDigest,'exact original PostgreSQL input digest');
 assert.equal(input.version.assignments.length,314,'original314 work rows, not historical313 or current323');
 assert.equal(contentDigest(input.version.assignments),P.assignmentsDigest,'exact original work ledger');
}
function originalPacket(bytes){
 buffer(bytes);
 assert.equal(bytes.length,P.originalPacketBytes,'original whole-wrapper byte length');
 assert.equal(sha(bytes),P.originalPacketSha256,'original whole-wrapper byte identity');
 const packet=JSON.parse(bytes);
 assert.equal(packet.sourceId,P.sourceId);assert.equal(packet.sourceDigest,P.sourceDigest);
 assert.equal(packet.publicationAuthority,PROVENANCE.originalPacketClassification);
 validateInput(packet.compilerInput);
 return packet;
}
export function validateFullNineV6FixtureBytes(bytes){
 buffer(bytes);
 assert.equal(bytes.length,P.fixtureBytes,'exact included fixture byte length');
 assert.equal(sha(bytes),P.fixtureSha256,'exact included fixture byte identity');
 const fixture=JSON.parse(bytes);
 assert.deepEqual(Object.keys(fixture).sort(),['schema','historicalSourceOnly','provenance','sourceId','sourceDigest','compilerInputCompactSha256','compilerInput'].sort());
 assert.equal(fixture.schema,SCHEMA);assert.equal(fixture.historicalSourceOnly,true);
 assert.deepEqual(fixture.provenance,PROVENANCE,'exact extraction provenance');
 assert.equal(fixture.sourceId,P.sourceId);assert.equal(fixture.sourceDigest,P.sourceDigest);
 assert.equal(fixture.compilerInputCompactSha256,P.compilerInputCompactSha256);
 validateInput(fixture.compilerInput);
 return fixture;
}
// Mechanical extraction only: verify the complete original before omitting its
// unrelated wrapper. No adapter, incumbent synthesis, normalization or solver.
export function extractFullNineV6SourceFixtureBytes(originalBytes){
 const packet=originalPacket(originalBytes);
 const fixture={schema:SCHEMA,historicalSourceOnly:true,provenance:PROVENANCE,
  sourceId:packet.sourceId,sourceDigest:packet.sourceDigest,
  compilerInputCompactSha256:P.compilerInputCompactSha256,compilerInput:packet.compilerInput};
 const bytes=Buffer.from(JSON.stringify(fixture)+'\n');
 const checked=validateFullNineV6FixtureBytes(bytes);
 assert.deepEqual(checked.compilerInput,packet.compilerInput,'lossless compilerInput values and array order');
 assert.equal(JSON.stringify(checked.compilerInput),JSON.stringify(packet.compilerInput),'original parsed property order retained');
 return bytes;
}
export function loadFullNineV6Source({retainedPacketPath=null}={}){
 assert.ok(retainedPacketPath===null||(typeof retainedPacketPath==='string'&&retainedPacketPath.length>0),'optional original path must be explicit');
 // A missing/invalid committed fixture always fails, even when an original path
 // is supplied. No absolute host path, env discovery, download or fallback.
 const fixture=validateFullNineV6FixtureBytes(fs.readFileSync(FIXTURE_URL));
 if(retainedPacketPath!==null){
  const extracted=extractFullNineV6SourceFixtureBytes(fs.readFileSync(retainedPacketPath));
  assert.equal(sha(extracted),P.fixtureSha256);
  assert.deepEqual(JSON.parse(extracted).compilerInput,fixture.compilerInput);
 }
 return {compilerInput:fixture.compilerInput,sourceId:fixture.sourceId,sourceDigest:fixture.sourceDigest,
  fixtureSha256:P.fixtureSha256,provenance:fixture.provenance,historicalSourceOnly:true,
  originalWrapperVerified:retainedPacketPath!==null};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,4,'only --extract-original <exact retained packet> is supported');
 assert.equal(process.argv[2],'--extract-original');
 const bytes=extractFullNineV6SourceFixtureBytes(fs.readFileSync(process.argv[3]));
 // One fixed NEW fixture only. Never overwrite source or any original packet.
 fs.writeFileSync(FIXTURE_URL,bytes,{flag:'wx',mode:0o644});
 validateFullNineV6FixtureBytes(fs.readFileSync(FIXTURE_URL));
 console.log(JSON.stringify({operation:'LOSSLESS_HISTORICAL_INPUT_EXTRACTION',fixtureSha256:P.fixtureSha256,
  fixtureBytes:bytes.length,originalPacketSha256:P.originalPacketSha256,originalWrapperVerified:true,
  sourceId:P.sourceId,sourceDigest:P.sourceDigest,compilerInputCompactSha256:P.compilerInputCompactSha256,
  assignmentsDigest:P.assignmentsDigest,assignmentCount:314,solver:false,registration:false,publication:false}));
}
