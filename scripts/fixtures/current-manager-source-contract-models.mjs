import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {assertDecisionMigrationManifest} from '../native-provider-event-decisions-database-tests.mjs';
import {assertCurrentManager219Manifest} from './current-manager-219-source.mjs';
import {readCurrentCanonicalDecisionSource} from './native-provider-event-decision-current-source.mjs';
const ROOT=new URL('../../',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
export const MANAGER_CONTRACT_SOURCE_PINS=Object.freeze({
 "scripts/fixtures/current-manager-219-source.mjs": "0960facc0258d6146487778d457a3a5b4b0e41633829a89ff1e5852b5ab01a99",
 "scripts/fixtures/current-manager-publication-source.mjs": "fb8ac53c6c6925ce63385bd13b0f68cc27572c0976efa1943bd7cee32eafaad1",
 "scripts/fixtures/native-provider-event-decision-current-source.mjs": "da0fbdc17f54951555075f266fd1869258b7442c49fefc518a52b5a482546064",
 "scripts/run-isolated-shift-end-tests.mjs": "914e6ec78f73bb5e71ef34e8bb8dd738944b6c4890d835c5abcb2414c5ccca19",
 "scripts/static-weekly-current-roster-publication-tests.mjs": "b2366a3e4160e7a32eb2d23d7a0357de8a83e23247d2c210596c38e63d664e31",
 "scripts/static-weekly-dual-source-current-correction-sql-tests.mjs": "434ac29849d704beab872da3c63220994cab579256a2ca80900df1778463518a",
 "scripts/fixtures/dual-source-registered-correction-sql-source.mjs": "326531e02d6279c15f86436a5c4145a2b03ac56d262a60e8e5479cf7f5d718b4",
 "scripts/fixtures/native-provider-event-decision-historical-source-models.json": "30e660c3f708e1d1ca0f64547eaffcfbbca99059630b314361ae9797dc55cb0d",
 "scripts/fixtures/current-manager-historical-source/20261002110000_event_impact_preview_and_custodial_notes.sql": "269ae9243ab3550a8ebe932d2d3d291d9e054171964451ae1c3907da2d019ea8",
 "scripts/fixtures/current-manager-historical-source/20261002140000_event_supersession_and_chicago_instants.sql": "dbd4b8f5cae0adcb12ad691404734399012d91fc28ba08f4a961f7ea049fe78e",
 "scripts/fixtures/current-manager-historical-source/20261003220000_current_release_authority_completion.sql": "33ca9d153233441b542d62e0f76d1ffa3b07788cf7e9fccd0c4b993b719abb27"
});
export function readCurrentManagerCanonicalSource(){
 const current=readCurrentCanonicalDecisionSource(fileURLToPath(ROOT));
 const manager_inputs=Object.entries(MANAGER_CONTRACT_SOURCE_PINS).map(([file,sha256])=>{assert.equal(sha(readFileSync(new URL(file,ROOT))),sha256,file);return {file,sha256};});
 return {...current,manager_inputs};
}
const ARCHIVED_HISTORICAL_SOURCE=Object.freeze({
 "20261002110000_event_impact_preview_and_custodial_notes.sql": {
  "file": "scripts/fixtures/current-manager-historical-source/20261002110000_event_impact_preview_and_custodial_notes.sql",
  "sha256": "269ae9243ab3550a8ebe932d2d3d291d9e054171964451ae1c3907da2d019ea8"
 },
 "20261002140000_event_supersession_and_chicago_instants.sql": {
  "file": "scripts/fixtures/current-manager-historical-source/20261002140000_event_supersession_and_chicago_instants.sql",
  "sha256": "dbd4b8f5cae0adcb12ad691404734399012d91fc28ba08f4a961f7ea049fe78e"
 },
 "20261003220000_current_release_authority_completion.sql": {
  "file": "scripts/fixtures/current-manager-historical-source/20261003220000_current_release_authority_completion.sql",
  "sha256": "33ca9d153233441b542d62e0f76d1ffa3b07788cf7e9fccd0c4b993b719abb27"
 }
});
export function frozenManagerSourceModel(profile){
 assert.ok(profile==='HISTORICAL_218'||profile==='CURRENT_219','explicit frozen historical Source profile required');
 const bytes=readFileSync(new URL('./native-provider-event-decision-historical-source-models.json',import.meta.url));
 assert.equal(sha(bytes),'30e660c3f708e1d1ca0f64547eaffcfbbca99059630b314361ae9797dc55cb0d');
 const model=JSON.parse(bytes).models[profile];
 assert.equal(model.source_commit,profile==='HISTORICAL_218'?'7cdc15656a00213e0741f31611bab54f3989758b':'53848431fd55b215affeb4663f233acffb506597');
 assert.equal(model.rows_sha256,sha(JSON.stringify(model.rows)));
 if(profile==='HISTORICAL_218')assertDecisionMigrationManifest(model.rows);else assertCurrentManager219Manifest(model.rows);
 return model.rows;
}
// Test-owned known historical Source only. Nothing here seeds SQL, selects a
// runtime stage or creates an accepted business/source-registration record.
export function withFrozenManagerSource(profile,run){
 assert.equal(typeof run,'function');const rows=frozenManagerSourceModel(profile);
 const directory=mkdtempSync(join(tmpdir(),'custodial-manager-source-model-'));
 try{
  const migrations=join(directory,'supabase/migrations');mkdirSync(migrations,{recursive:true});
  for(const row of rows){
   // These three historical files evolved in the current canonical tree.
   // Select fixed archived original inputs by name, never on observed drift.
   const archived=ARCHIVED_HISTORICAL_SOURCE[row.file];
   if(archived)assert.equal(row.sha256,archived.sha256);
   const original=new URL(archived?archived.file:'supabase/migrations/'+row.file,ROOT),metadata=lstatSync(original);
   assert.ok(metadata.isFile()&&!metadata.isSymbolicLink(),'regular exact original Source file required');
   const bytes=readFileSync(original);assert.equal(sha(bytes),row.sha256,row.file);
   writeFileSync(join(migrations,row.file),bytes,{flag:'wx',mode:0o600});
  }
  const value=run(pathToFileURL(directory+'/'),rows);
  assert.ok(!value||typeof value.then!=='function','Source model callback must settle synchronously');return value;
 }finally{rmSync(directory,{recursive:true});}
}
