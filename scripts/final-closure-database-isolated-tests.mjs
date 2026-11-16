#!/usr/bin/env node
// Execute every original closure assertion in its exact retained source view.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withGpsSessionOwnedSource} from './gps-session-owned-source-view.mjs';
import {withHistoricalFinalClosureSource} from './fixtures/final-closure-historical-source.mjs';
assert.equal(process.argv.length,2,'Only the complete retained closure suite is supported');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
await withHistoricalFinalClosureSource(root,async(fixture,proof)=>{
 console.log(JSON.stringify({status:'EXACT_HISTORICAL304_FINAL_CLOSURE_SELECTED',...proof,SQL_executed:false}));
 await withGpsSessionOwnedSource(fixture,async(entrypoint,successor)=>{
 console.log(JSON.stringify({status:'EXACT_GPS_SESSION_FIXTURE_SUCCESSOR',...successor}));
 const result=spawnSync(process.execPath,[entrypoint],{cwd:fixture,env:{...process.env},stdio:'inherit'});
 assert.equal(result.error,undefined);assert.equal(result.signal,null,'Retained closure suite was interrupted');
 assert.equal(result.status,0,'Complete original closure SQL checks failed; no acceptance');
 });
});
