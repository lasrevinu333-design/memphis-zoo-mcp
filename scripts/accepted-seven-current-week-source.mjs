// Test-only transport successor for the exact retained activation assertions.
// Current310 is genuinely constructed, never a historical catalog retargeted.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const parentSha='4c78622cd0490ec37e55e8b85c3e673c4d5783e0c24258bd9995b39bc31164c2';
const replacements=[
 ['readApprovedManualWeek()',"readHistoricalApprovedManualWeek()",2],
 ['[303,304].includes','[310].includes',2],
 ['constructorMigrationCount=304','constructorMigrationCount=310',1],
 ['assert.equal(fixture.receipt.selected_replay.migrations,spec.constructorMigrations);assert.equal(fixture.receipt.full_suite_PASS,false);',"assert.equal(fixture.receipt.schema,'custodial.current310-local-ci-borrow.v1');assert.equal(fixture.receipt.source_profile.migration_count,spec.constructorMigrations);assert.equal(fixture.receipt.production,false);assert.equal(fixture.receipt.release_admission,false);",1],
 ["{host:fixture.socketDirectory,database:'postgres',user:'supabase_admin',password:'postgres',max:2,connectionTimeoutMillis:5000}","{...fixture.pgClientConfig,database:'postgres',user:'supabase_admin',password:'postgres',max:2,connectionTimeoutMillis:5000}",1],
];
export function deriveAcceptedSevenCurrentWeekParent(bytes){
 assert.equal(sha(bytes),parentSha,'Exact original complete activation test assertions required');
 const original=bytes.toString('utf8');let source=original;
 for(const [before,after,count]of replacements){assert.equal(source.split(before).length,count+1);source=source.split(before).join(after);}
 let inverse=source;for(const [before,after,count]of [...replacements].reverse()){assert.equal(inverse.split(after).length,count+1);inverse=inverse.split(after).join(before);}
 assert.equal(inverse,original,'Every assertion outside constructor count, owned receipt and SQL transport retained');
 source+="\n"+"\n function readHistoricalApprovedManualWeek(){const ref={path:resolve(B,'scripts/fixtures/approved-manual-week-before-start-correction.json'),sha256:'837fc6f43fc2b5a506a81264bedf449be82def63e3a243a13fbe86e28eeb868b',bytes:156898};const value=JSON.parse(readFixed(ref));assert.equal(value.dataDigest,'eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8');return value;}\n";
 return {source,proof:{schema:'custodial.accepted-seven-current-week-test-parent.v1',original_sha256:parentSha,successor_sha256:sha(source),exact_inverse:true,product_code_changed:false,production:false}};
}
