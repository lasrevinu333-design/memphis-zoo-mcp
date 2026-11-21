// Complete byte inverse for a finite diagnostic. No target or effect port.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
// Reverse only the exact rehearsal revisions before checking the historical byte proof.
const rehearsalRevisions={
 '.github/workflows/production-backup-migration-rehearsal.yml':{
  sha256:'0b0555fb95b7c0ef01ae41dadcb59bb49495bca27785da9b2a72f25deaabaf78',
  replacements:[['&& 350 || 45','&& 205 || 45']],
 },
 'scripts/run-private-backup-only-rehearsal.mjs':{
  sha256:'368ead62624f515daf0e545bf4aa4ebb059eb9b39658a8195fa3eceb50ea73ba',
  replacements:[['lifetimeMs===6*60*60*1000','lifetimeMs===4*60*60*1000'],
   ['currentFullRestore?6*60*60*1000','currentFullRestore?4*60*60*1000']],
 },
 'scripts/immutable-private-data-import.mjs':{
  sha256:'8e0d041aed3b88655aece12b101b515c56ee91ac41a83a8243a34f178f83a43c',
  replacements:[
   ["import {prepareLegacyCompletionGuard,stageLegacyCompletionCheck,reinstateLegacyCompletionCheck,readLegacyCompletionCheckEvidence} from './immutable-fresh-legacy-completion-check.mjs';\n",''],
   ['  await prepareLegacyCompletionGuard(db,verifiedArchive,freshIntent,initialized);\n  current();\n',''],
   ['  await stageLegacyCompletionCheck(db,verifiedArchive,freshIntent);\n',''],
   ['  await reinstateLegacyCompletionCheck(db,verifiedArchive,freshIntent,staged);\n  current();\n',''],
   ['    const legacyCheck=readLegacyCompletionCheckEvidence(verifiedArchive,state.freshIntent);\n',''],
   ['retry_allowed:false,rerun_import_allowed:false,resume_allowed:false,\n      ...(legacyCheck?{legacy_completion_check:legacyCheck}:{})','retry_allowed:false,rerun_import_allowed:false,resume_allowed:false'],
  ],
 },
};
export function removePrivateContextCostObservation(name,source){
 assert.equal(arguments.length,2);assert.equal(typeof name,'string');assert.equal(typeof source,'string');
 const raw=readFileSync(new URL('../release/installed-source/20261120_private_context_cost_source_inverse.json',import.meta.url),'utf8');
 assert.equal(sha(raw),'08ef7a34b072b4e076a3ba4878a28a9d1a6e2cc162bd8cfa6c1a55da4f7ab4c8');const data=JSON.parse(raw);assert.equal(data.format,'custodial.private-context-cost-observer-source-inverse.v1');
 assert.deepEqual(Object.keys(data.files).sort(),['.github/workflows/production-backup-migration-rehearsal.yml','scripts/immutable-private-data-import.mjs','scripts/run-private-backup-only-rehearsal.mjs']);
 const file=data.files[name];assert.ok(file,'Only fixed observation sources may be normalized');
 source=removeRehearsalRevisions(name,source);
 if(sha(source)===file.previousSha256)return source;
 assert.equal(sha(source),file.currentSha256);
 for(const h of file.hunks){if(h.before===''){assert.ok(source.endsWith(h.after));source=source.slice(0,-h.after.length);}else{assert.equal(source.split(h.after).length,2);source=source.replace(h.after,()=>h.before);}}
 assert.equal(sha(source),file.previousSha256);return source;
}

export function removeRehearsalRevisions(name,source){
 const revision=rehearsalRevisions[name];
 if(revision && sha(source)===revision.sha256){
  for(const [current,previous] of revision.replacements){
   assert.equal(source.split(current).length,2);
   source=source.replace(current,()=>previous);
  }
 }
 return source;
}
