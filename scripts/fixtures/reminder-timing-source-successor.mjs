import {restoreBasecampCiProofSource} from './basecamp-ci-input-successor.mjs';
// Exact test-only projection. It does not execute SQL or admit a native release.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,sep} from 'node:path';
const sha=x=>createHash('sha256').update(x).digest('hex');
const bytes=readFileSync(new URL('./reminder-timing-source-successor.json',import.meta.url));
assert.equal(sha(bytes),'9ca3192daa6c4095298b3a18d67f7ebae96edb84e4e41c7c6969eee80936385a');
const document=JSON.parse(bytes);
assert.equal(document.schema,'custodial.reminder-timing-source-successor.v1');
assert.equal(document.historical_pins_rewritten,false);assert.equal(document.production_admission,false);
const rows=new Map(document.modified.map(r=>[r.path,r]));assert.equal(rows.size,document.modified.length);
export function restoreReminderHistoricalSource(path,source){
 source=restoreBasecampCiProofSource(path,source);
 const row=rows.get(path);if(!row||sha(source)!==row.current_sha256)return source;
 for(const h of row.hunks){assert.equal(source.split(h.current).length,2,'unique complete timing successor hunk');source=source.replace(h.current,()=>h.prior);}
 assert.equal(sha(source),row.prior_sha256,'exact whole timing predecessor: '+path);return source;
}
export function verifyReminderTimingSourceInputs(root){
 root=resolve(root);
 for(const row of [...document.modified,...document.added]){
  const file=resolve(root,row.path),rel=relative(root,file);assert.ok(rel&&!rel.startsWith('..'+sep)&&!rel.startsWith(sep));
  for(let p=file;p!==root;p=dirname(p))assert.equal(lstatSync(p).isSymbolicLink(),false,'no reminder source symlink');
  assert.ok(lstatSync(file).isFile());assert.equal(sha(readFileSync(file)),row.current_sha256,'exact current reminder input: '+row.path);
 }
 return {modified:document.modified.length,added:document.added.length,historical_pins_rewritten:false,SQL_executed:false};
}
export function historicalMigrationNames(root,names){
 // Preserve the 315-file/311-canonical historical proof and separately bind
 // the forward overlay; never claim the historical constructor executed it.
 // The qualified off-day repair is a forward source overlay as well. Bind
 // its exact bytes before retaining the historical315/311 fixture selection;
 // this does not execute or qualify a319-migration database construction.
 const overlay=[...document.added.filter(r=>r.path.startsWith('supabase/migrations/')),
  {path:'supabase/migrations/20261115094558_manual_off_day_phone_targets.sql',current_sha256:'148cb9730bf5c0966793c97a529d180a03d575940eb196e1fd4dc26e7610a69a'},
  {path:'supabase/migrations/20261115133604_native_alert_generation_pending.sql',current_sha256:'79dc01a924668455a4438e11fc644a290e7caad8f39bdacf211548b363c99e8b'}];
 for(const row of overlay){const file=resolve(root,row.path);assert.equal(lstatSync(file).isSymbolicLink(),false);assert.equal(sha(readFileSync(file)),row.current_sha256);}
 const extra=new Set(overlay.map(r=>r.path.slice('supabase/migrations/'.length)));
 assert.ok([...extra].every(n=>names.includes(n)),'all exact forward overlay members required');
 return names.filter(n=>!extra.has(n));
}
