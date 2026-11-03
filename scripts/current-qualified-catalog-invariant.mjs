import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readCurrentQualifiedReplayProfile} from './current-qualified-replay-profile.mjs';
export const qualificationRoot=fileURLToPath(new URL('..',import.meta.url));
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyCurrentFinalCounterpart(){
 const receipt=JSON.parse(fs.readFileSync(path.join(qualificationRoot,'scripts/fixtures/current310-final-uncertainty-counterpart.json'),'utf8'));
 assert.equal(receipt.schema,'custodial.current310-final-uncertainty-counterpart.v1');
 const original=fs.readFileSync(path.join(qualificationRoot,receipt.original.path));
 const counterpart=fs.readFileSync(path.join(qualificationRoot,receipt.counterpart.path));
 assert.equal(digest(original),'d3d209aa96e494723ddc71a20454620bb668da57d383f9317d43facf5f44bca0');
 assert.equal(digest(original),receipt.original.sha256);assert.equal(original.length,receipt.original.bytes);
 assert.equal(digest(counterpart),receipt.counterpart.sha256);assert.equal(counterpart.length,receipt.counterpart.bytes);
 const before='scripts/refresh-schema-fingerprint.mjs',after='scripts/current-qualified-catalog-invariant-check.mjs';
 assert.equal(original.toString().split(before).length-1,2);
 assert.deepEqual(counterpart,Buffer.from(original.toString().replaceAll(before,after)));
 assert.deepEqual(receipt.transformation,{old_literal:before,new_literal:after,exact_occurrences:2,original_line_numbers:[84,99],all_other_bytes_identical:true,behavior_assertions_modified:0});
 return receipt;
}
export function currentQualificationSource(){
 const profile=readCurrentQualifiedReplayProfile().description;assert.equal(profile.migration_count,310);
 const fixed=['src/static-weekly-manager-operation.js','scripts/current-qualified-catalog-invariant.mjs','scripts/current-qualified-catalog-invariant-check.mjs','scripts/current-qualified-final-closure-tests.mjs','scripts/current-qualified-final-uncertainty-database-tests.mjs','scripts/final-uncertainty-closure-database-tests.mjs','scripts/fixtures/current310-final-uncertainty-counterpart.json','scripts/fixtures/event-static-authority-fixture.mjs','scripts/current-qualified-replay-profile.mjs','scripts/current-qualified-sql-ci-fixture.mjs','scripts/current-candidate-owned-pg-stream.mjs','scripts/schema-fingerprint-catalog.mjs','scripts/migration-replay-order.mjs','scripts/source252-fresh-replay-order.mjs','scripts/source291-fresh-canary-order.mjs','scripts/refresh-schema-fingerprint.mjs','supabase/canonical/migration-replay-order.json','supabase/canonical/schema-fingerprint.txt','supabase/canonical/schema-fingerprint-input.json'];
 const files=[...new Set([...fixed,...profile.effective_sql.map(x=>'supabase/migrations/'+x.name),...profile.effective_sql.filter(x=>x.sha256!==x.effective_sha256).map(x=>'release/fresh-only-replay/images/'+x.name)])].sort();
 return {schema:'custodial.current310-catalog-source-binding.v1',profile,files:files.map(file=>{const target=path.join(qualificationRoot,file);assert.equal(fs.realpathSync(target),target);assert.ok(fs.lstatSync(target).isFile());return {file,sha256:digest(fs.readFileSync(target))};}),counterpart:verifyCurrentFinalCounterpart(),production:false,release_admission:false,historical_canonical_equivalence:false};
}
