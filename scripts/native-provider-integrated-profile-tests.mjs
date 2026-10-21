import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runInThisContext} from 'node:vm';
import {readDecisionSource,decisionMigrationProfile,assertDecisionLookupBoundary,assertCurrentDecisionMigrationManifest} from './native-provider-event-decisions-database-tests.mjs';
const source=readDecisionSource(resolve('.'),{profile:'INTEGRATED_227'}),rows=source.migrations;
let checks=0;const ok=(name,fn)=>{fn();checks++;console.log('PASS',name);};
ok('entire current source bound',()=>assert.equal(rows.length,227));
ok('lookup boundary before retained suffix',()=>assert.equal(assertDecisionLookupBoundary(rows,222,'INTEGRATED_227').following_migrations,4));
ok('old current219 is not relabelled',()=>assert.throws(()=>assertCurrentDecisionMigrationManifest(rows)));
ok('unknown profile rejected',()=>assert.throws(()=>decisionMigrationProfile(rows,'unchecked')));
ok('wrong lookup position rejected',()=>assert.throws(()=>assertDecisionLookupBoundary(rows,226,'INTEGRATED_227')));
const faults=[['missing',r=>r.pop()],['duplicate',r=>{r[0]=r[1];}],['order',r=>{[r[0],r[1]]=[r[1],r[0]];}],['changed bytes',r=>{r[30].sha256='0'.repeat(64);}],['changed name',r=>{r[30].file='20260101000000_unapproved.sql';}],['extra field',r=>{r[10].approved=true;}],['extra row',r=>r.push(r[0])]];
for(const[name,change]of faults)ok('backend rejects '+name,()=>{const altered=structuredClone(rows);change(altered);assert.throws(()=>decisionMigrationProfile(altered,'INTEGRATED_227'));});
ok('exact current credential implementation pin retained',()=>assert.equal(source.inputs.find(r=>r.file==='src/auth/device-credential-auth.js').sha256,'6421105294f101041bdaaab2a6c2597107e87df9d099c1d656d446b64f5af1ea'));
if(process.argv[2]){
 const frontend=resolve(process.argv[2]);
 const body=readFileSync(frontend+'/mobile/scripts/custodial-provider-storage-tests.mjs','utf8').split('// BEGIN exact event-decision migration authority (pure; no JAR/process access).')[1]?.split('// END exact event-decision migration authority.')[0];assert.ok(body);
 const verify=runInThisContext('(function(assert,sha){'+body+';return assertProviderDecisionSqlManifest;})')(assert,x=>createHash('sha256').update(x).digest('hex'));
 ok('Android fixture reader accepts same complete ordered source',()=>assert.equal(verify(rows,'INTEGRATED_227').manifest_sha256,source.manifest_sha256));
 for(const[name,change]of faults)ok('Android fixture reader rejects '+name,()=>{const altered=structuredClone(rows);change(altered);assert.throws(()=>verify(altered,'INTEGRATED_227'));});
 ok('Android fixture reader retains old-profile boundary',()=>assert.throws(()=>verify(rows,'CURRENT_219')));
 ok('Android fixture reader rejects invented profile',()=>assert.throws(()=>verify(rows,'unchecked')));
}
console.log(JSON.stringify({status:'PASS',checks,scope:'Actual backend and optional Android-side source-profile validators; no SQL execution, release signature or deployment claimed.'}));
