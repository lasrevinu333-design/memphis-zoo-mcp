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
  sha256:'02b16f5e6319ba5c485f76137b21a1d5fd19bc2201ac1bf445f9637eb9bfe337',
  replacements:[['GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,GITHUB_RUN_ID','GITHUB_RUN_ID'],
   ['lifetimeMs===6*60*60*1000','lifetimeMs===4*60*60*1000'],
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
 source=removeCurrent429Qualification(name,source);
 const revision=rehearsalRevisions[name];
 if(revision && sha(source)===revision.sha256){
  for(const [current,previous] of revision.replacements){
   assert.equal(source.split(current).length,2);
   source=source.replace(current,()=>previous);
  }
 }
 return source;
}

export function removeCurrent429Qualification(name,source){
 const vmRaw=readFileSync(new URL('../release/installed-source/current429-secondary-drive-vm-inverse.json',import.meta.url),'utf8');
 assert.equal(sha(vmRaw),'5b28a606028ee9aab6f939eb68a1e12d31e1eaf8baa01a2fc5b2bacba527140a');
 const vm=JSON.parse(vmRaw);
 assert.equal(vm.format,'custodial.current429-secondary-drive-vm-source-inverse.v1');
 source=reverseExactFile(vm.files[name],source);
 const raw=readFileSync(new URL('../release/installed-source/current429-rehearsal-inverse.json',import.meta.url),'utf8');
 assert.equal(sha(raw),'8b403792a86a7148680406a3b4de259d81185a3ba5691c6b310679fc076db60d');
 return reverseExactFile(JSON.parse(raw).files[name],source);
}

function reverseExactFile(revision,source){
 if(!revision||sha(source)!==revision.current_sha256)return source;
 for(const edit of [...revision.reverse_hunks].reverse()){
  assert.equal(source.slice(edit.start,edit.end),edit.current);
  source=source.slice(0,edit.start)+edit.previous+source.slice(edit.end);
 }
 assert.equal(sha(source),revision.previous_sha256);
 return source;
}
