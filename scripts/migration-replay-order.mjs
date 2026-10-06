import {existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const FILE=/^[0-9]{14}_[a-zA-Z0-9_]+\.sql$/,HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function failure(message){throw Object.assign(new Error(message),{code:'migration_replay_order_invalid'});}
/** Exact full reconstruction order, never a claim that migrations were applied. */
export function readMigrationReplayPlan(root=process.cwd()){
 root=resolve(root);const dir=join(root,'supabase/migrations'),manifestPath=join(root,'supabase/canonical/migration-replay-order.json');
 const present=readdirSync(dir).filter(name=>name.endsWith('.sql')).sort();
 if(!existsSync(manifestPath))failure('The exact migration replay manifest is required.');
 const stat=lstatSync(manifestPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024)failure('Invalid migration replay manifest file.');
 const bytes=readFileSync(manifestPath);let doc;try{doc=JSON.parse(bytes);}catch{failure('Migration replay manifest is not JSON.');}
 if(doc?.schema!=='custodial.migration-replay-order.v1'||!COMMIT.test(doc.base_source_commit||'')||!Array.isArray(doc.phases)||doc.phases.length!==2
  ||doc.phases[0]?.kind!=='verified_main_source_prefix'||doc.phases[1]?.kind!=='forward_source_after_prefix'
  ||doc.production_execution_authorized!==false)failure('Migration replay manifest has an unsupported scope.');
 const ordered=[],seen=new Set();
 for(const phase of doc.phases){
  if(!Array.isArray(phase.files)||!phase.files.length||phase.files.length>1024)failure('Migration phase is empty or oversized.');let previous='';
  for(const item of phase.files){
   if(!item||Object.keys(item).sort().join(',')!=='name,sha256'||!FILE.test(item.name||'')||!HASH.test(item.sha256||'')
    ||seen.has(item.name)||item.name<=previous)failure('Migration phase contains a duplicate, invalid or unordered filename.');
   const file=join(dir,item.name);let st;try{st=lstatSync(file);}catch{failure('A source migration is missing.');}
   if(!st.isFile()||st.isSymbolicLink()||st.size>16*1024*1024||sha(readFileSync(file))!==item.sha256)failure('A source migration differs from its declared bytes: '+item.name);
   previous=item.name;seen.add(item.name);ordered.push(item.name);
  }
 }
 if(present.length!==ordered.length||present.some(name=>!seen.has(name)))failure('The replay manifest omits or adds a migration.');
 return Object.freeze({schema:doc.schema,baseSourceCommit:doc.base_source_commit,files:Object.freeze(ordered),manifestSha256:sha(bytes),baseCount:doc.phases[0].files.length,forwardCount:doc.phases[1].files.length});
}
export function migrationReplayNames(root=process.cwd()){return [...readMigrationReplayPlan(root).files];}
