import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {selectFreshOnlySourceRows} from './ci-fresh-only-source-successor.mjs';
import {loadCiFreshOnlyReplay} from './ci-fresh-only-replay.mjs';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),read=p=>fs.readFileSync(path.join(repo,p));
const manifest=JSON.parse(read('release/fresh-only-replay/MANIFEST.json')),metaPath='release/fresh-only-replay/SOURCE304_SUCCESSOR.json',meta=JSON.parse(read(metaPath));
const names=fs.readdirSync(path.join(repo,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
assert.equal(names.length,304);
for(const noAutoTableGrants of [false,true]){const actual=loadCiFreshOnlyReplay(repo,manifest.image,names,{noAutoTableGrants});assert.equal(actual.entries.length,304);actual.assertPreserved();}
const selected=selectFreshOnlySourceRows(manifest,names,read);assert.equal(selected.rows.length,304);assert.equal(selected.successor.appended_migration,meta.append.name);
const cases=['actual303plusatomicmeasurement_and304byteclosure'];
const encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');function refuses(label,changes=new Map(),list=names){assert.throws(()=>selectFreshOnlySourceRows(manifest,list,p=>changes.get(p)??read(p)));cases.push(label);}
for(const [key,value]of [['full_vendor_NORMAL',true],['expected_fingerprint_authority','production'],['source_capture_scope','ACTUAL_FRESH304_WITHOUT_PROOF'],['observed_empty_source_fingerprint','f'.repeat(64)],['runtime_admission',true]]){const m=structuredClone(meta);m[key]=value;refuses('refuse_'+key,new Map([[metaPath,encode(m)]]));}
const flip=p=>{const b=Buffer.from(read(p));b[Math.floor(b.length/2)]^=1;return b;};
for(const p of [meta.append.original.path,'release/fresh-only-replay/SOURCE303_REPLAY_ORDER.json','release/fresh-only-replay/source304-main-atomic-append-evidence/MAIN_ATOMIC_POST_APPEND_RAW_CATALOG.json','release/fresh-only-replay/source304-main-atomic-append-evidence/MAIN_ATOMIC_POST_APPEND_RECOVERY_BINDINGS.json','release/fresh-only-replay/source304-main-atomic-append-evidence/REPAIR_ATOMIC_BATCH_main_atomic_twelve_RETURNED.json'])refuses('refuseChanged_'+path.basename(p),new Map([[p,flip(p)]]));
refuses('unknown305append',new Map(),[...names,'20261031225211_unknown.sql']);refuses('renamedActualCliFile',new Map(),[...names.slice(0,-1),'20261031225210_different.sql']);
console.log(JSON.stringify({status:'PASS',checks:cases.length,cases,scope:'Pure source/schema-measurement evidence reader only. Actualcapturerefs retained; no new SQL/constructor/fresh304/runtime/production acceptance.'},null,2));
