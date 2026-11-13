import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {currentCanonicalDecisionProfile,readCurrentCanonicalDecisionSource} from './native-provider-event-decision-current-source.mjs';

// Current canonical Source ONLY. Historical219 SQL execution/recovery guards
// are not qualified against this schema and cannot select this profile.
export const CURRENT_MESSAGE_SOURCE_PINS=Object.freeze({
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
 "scripts/native-provider-event-decisions-database-tests.mjs": "06e75cca27e434be66c9f732be76a1dabfbeaa1de1809949ae68226a997ff23c",
 "src/employee-notifications.js": "e2a76f19c8b7c09b1cf95ed9bb0446a7aeee3f18b8edeb23d6d649aaed553c80",
 "scripts/employee-message-source-admission-tests.mjs": "705bdd8d338f04fdd41901d8d1384113579e9e4e36c89462597b48051c881d45",
 "scripts/fixtures/employee-message-prepare-predecessor.json": "54b3ec397e8dc83ea1a9fabf7eca6986e041a516ca36cad61739f0177adff421",
 "scripts/fixtures/employee-message-prepare-predecessor.mjs": "d92a65bf2ed352073e68e72b627a33834136952e98c8c5c6b7a6a84e5329a608",
 "scripts/employee-message-prepare-predecessor-tests.mjs": "f3bc50cfc1ed0ec674a5f898fd2abb0e3b5434818a9c696194ba6aa0992aaf60",
 "scripts/employee-message-source-admission-database-tests.mjs": "119a8056109b8a6fb4d8e77cca1a44d09a2e6958f084999ef1fd9e6b208fb421",
 "scripts/migration-replay-order.mjs": "732d901f92f612e2b9dc4b1d440ad7c9cceb281a995edae82f3d5307f5fe1f40",
 "scripts/fixtures/native-provider-event-decision-current-source.mjs": "da0fbdc17f54951555075f266fd1869258b7442c49fefc518a52b5a482546064"
});
const sha=value=>createHash('sha256').update(value).digest('hex');
export function currentCanonicalMessageProfile(rows){
 const current=currentCanonicalDecisionProfile(rows);
 const message_boundary={file:'20261003121757_employee_message_source_admission.sql',sha256:'20ff06f8c0c5e82814189e1e2969b928ffa48eb1181098a73156962dc9ac1e7f',
  predecessor_count:209,predecessor_manifest_sha256:'f070f410e8c02c35a2d37780e6c2165975e731e50bf63a5bf0bd3ca6341480a9',following_migrations:79,
  following_manifest_sha256:'ff36e204a9169145903e92fa948e9195f51743d9c248ca4fd2f59b386f1a5ace'};
 assert.deepEqual(rows[209],{file:message_boundary.file,sha256:message_boundary.sha256});
 assert.equal(sha(JSON.stringify(rows.slice(0,209))),message_boundary.predecessor_manifest_sha256);
 assert.equal(rows.length-210,message_boundary.following_migrations);
 assert.equal(sha(JSON.stringify(rows.slice(210))),message_boundary.following_manifest_sha256);
 return {...current,message_boundary};
}
export function readCurrentMessageSource(root){
 const current=readCurrentCanonicalDecisionSource(root);
 const profile=currentCanonicalMessageProfile(current.migrations);
 const inputs=Object.entries(CURRENT_MESSAGE_SOURCE_PINS).map(([file,sha256])=>{assert.equal(sha(readFileSync(join(root,file))),sha256,file);return {file,sha256};});
 // Match the old reader's self-observation without a circular self pin.
 const runner='scripts/employee-message-source-admission-replay.mjs';
 inputs.push({file:runner,sha256:sha(readFileSync(join(root,runner)))});
 return {migrations:current.migrations,...profile,inputs};
}
