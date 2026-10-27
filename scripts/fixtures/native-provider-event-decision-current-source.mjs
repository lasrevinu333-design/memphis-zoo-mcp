import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readMigrationReplayPlan} from '../migration-replay-order.mjs';

// SOURCE ONLY. This is neither a new SQL execution profile nor evidence that
// historical recovery guards apply to the complete current schema.
export const CURRENT_DECISION_CANONICAL_MANIFEST='e5867270c2509b986708caf32109956bedf0703363dcc1d775f1737f502c5c68';
export const CURRENT_DECISION_ORDERED_ROWS='fe4617a721731b9601b399193eaa67c904d4197efe9af506a575d2d01a1696b8';
export const CURRENT_DECISION_SOURCE_PINS=Object.freeze({
 "scripts/fixtures/native-provider-event-decision-native-wire.mjs": "3eb7dabbc20c17a5fa784d1caead5fd9e86c1be3fff4b3a591017a63423e7cb6",
 "scripts/fixtures/native-sql-fixture-output.mjs": "9f84c9e62d33dfeb48be4321db03a757bad96d059233941695feb3399d7d1e06",
 "src/native-provider-api.js": "4cf987c8b601308c9379219e6f1e3e798d9746ba5f996f57fb062bc9e68c24ee",
 "src/native-provider-event-decisions.js": "e4d579a4b11d117ed51c31bd0a54953a43e431fb3cb2d38b16b4477678b26cbf",
 "scripts/fixtures/native-provider-event-decisions-database-cases.mjs": "9d8fe70719950f82c21dcb975edd28c73a666488926d97b947dca33926137634",
 "src/auth/device-credential-auth.js": "ba20ff22b7ab815270311572838d7d9400b5cdc53f80500fe02b43555d6e5aa1",
 "src/device-identity.js": "240170fedc316004e22dfa9501f658d1582cb184bcaa936530d40361b8a66288",
 "src/request-json-parser.js": "68a38a4ec263ff9a80d69082660324d23e84f5328750f346a52a77d016fa28a4",
 "src/native-provider-json.js": "8599daf5faec77242649dd6a863731e32ba4193872efe546029777c87f785294",
 "src/native-provider-events.js": "9f06bc44c02f6e65fc1a638b33c5f7b0707bdca6483fe6838d0837f8936e0359",
 "src/native-lunch-reservation.js": "9d256fb50f7a374a7e85210afdd1fef4869a884c9c9f2a8071530a722914a3b2",
 "src/native-location-reservation.js": "bfba6b5909b628a8307373ea2785da0a8132038026c5360f7a4262ce569cdcf2",
 "scripts/fixtures/current-manager-publication-source.mjs": "fb8ac53c6c6925ce63385bd13b0f68cc27572c0976efa1943bd7cee32eafaad1",
 "scripts/migration-replay-order.mjs": "732d901f92f612e2b9dc4b1d440ad7c9cceb281a995edae82f3d5307f5fe1f40"
});
const sha=value=>createHash('sha256').update(value).digest('hex');
export function currentCanonicalDecisionProfile(rows){
 assert.ok(Array.isArray(rows));assert.equal(rows.length,289,'complete canonical289 Source model');
 for(const row of rows){assert.deepEqual(Object.keys(row).sort(),['file','sha256']);assert.match(row.file,/^\d{14}_[a-zA-Z0-9_]+\.sql$/);assert.match(row.sha256,/^[a-f0-9]{64}$/);}
 assert.equal(new Set(rows.map(row=>row.file)).size,289);
 assert.equal(sha(JSON.stringify(rows)),CURRENT_DECISION_ORDERED_ROWS,'exact full phase-ordered Source bytes');
 const lookup_boundary={file:'20261004000000_native_provider_event_decision_lookup.sql',sha256:'ab4e6eb848bd214f8616fb52f094829786df9a9a81d2eb8d00d247b1f28e52fd',
  predecessor_count:222,predecessor_manifest_sha256:'0dfaf9d66a9be9bc389cfa9f981f400ed2e2e9e123a1ba9dbd2a13a231c1811f',following_migrations:66,
  following_manifest_sha256:'5d092f1ea5d6a301ebd0563a7c567f322ac5bcd3b0057a4b281e27cc2d8e88f7'};
 assert.deepEqual(rows[222],{file:lookup_boundary.file,sha256:lookup_boundary.sha256});
 assert.equal(sha(JSON.stringify(rows.slice(0,222))),lookup_boundary.predecessor_manifest_sha256);
 assert.equal(sha(JSON.stringify(rows.slice(223))),lookup_boundary.following_manifest_sha256);
 return {migration_profile:'CURRENT_CANONICAL_289',manifest_sha256:CURRENT_DECISION_ORDERED_ROWS,canonical_manifest_sha256:CURRENT_DECISION_CANONICAL_MANIFEST,lookup_boundary};
}
export function readCurrentCanonicalDecisionSource(root){
 // The maintained reader verifies all phase order, exact source-file hashes,
 // file kinds and the complete on-disk census; never sort/filter survivors.
 const plan=readMigrationReplayPlan(root);
 assert.equal(plan.schema,'custodial.migration-replay-order.v2');
 assert.equal(plan.manifestSha256,CURRENT_DECISION_CANONICAL_MANIFEST,'exact canonical manifest bytes');
 assert.equal(plan.baseCount,134);assert.equal(plan.forwardCount,155);assert.equal(plan.pairedAlertCount,62);
 const migrations=plan.files.map(file=>({file,sha256:sha(readFileSync(join(root,'supabase/migrations',file)))}));
 const binding=currentCanonicalDecisionProfile(migrations);
 const inputs=Object.entries(CURRENT_DECISION_SOURCE_PINS).map(([file,sha256])=>{assert.equal(sha(readFileSync(join(root,file))),sha256,file);return {file,sha256};});
 return {migrations,...binding,inputs};
}
