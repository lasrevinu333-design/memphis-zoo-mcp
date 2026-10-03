import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assertCurrentManager219Manifest,assertCurrentManager219MigrationSet,CURRENT_MANAGER_219_MESSAGE_MIGRATION}
  from './fixtures/current-manager-219-source.mjs';
import {assertCurrentManagerMigrationSet,assertCurrentManager217MigrationSet,assertCurrentManager218MigrationSet}
  from './fixtures/current-manager-publication-source.mjs';

export function runCurrentManager219ManifestTests() {
  let checks=0;
  const check=fn=>{fn();checks++;};
  const rows=assertCurrentManager219MigrationSet(),original=JSON.stringify(rows);
  check(()=>assert.equal(rows.length,219));
  check(()=>assert.equal(createHash('sha256').update(readFileSync(new URL('./fixtures/current-manager-publication-source.mjs',import.meta.url))).digest('hex'),
    'fb8ac53c6c6925ce63385bd13b0f68cc27572c0976efa1943bd7cee32eafaad1'));
  for(const [name,mutate] of [
    ['missing',r=>r.pop()],['extra',r=>r.push({file:'20261004010000_unapproved.sql',sha256:'0'.repeat(64)})],
    ['duplicate',r=>r[2]={...r[1]}],['reorder',r=>[r[1],r[2]]=[r[2],r[1]]],
    ['prior bytes',r=>r[0].sha256='0'.repeat(64)],
    ['MESSAGE bytes',r=>r.find(x=>x.file===CURRENT_MANAGER_219_MESSAGE_MIGRATION.file).sha256='0'.repeat(64)],
    ['head bytes',r=>r.at(-1).sha256='0'.repeat(64)],
    ['renamed insertion',r=>r.find(x=>x.file===CURRENT_MANAGER_219_MESSAGE_MIGRATION.file).file='20261003121758_employee_message_source_admission.sql'],
    ['extra field',r=>r[0].accepted=true],['wrong hash type',r=>r[0].sha256=null],
    ['bad path',r=>r[0].file='../outside.sql'],['null row',r=>r[0]=null],
  ])check(()=>{const bad=structuredClone(rows);mutate(bad);assert.throws(()=>assertCurrentManager219Manifest(bad),name);});
  for(const bad of [null,{},'219',218])check(()=>assert.throws(()=>assertCurrentManager219Manifest(bad)));
  for(const validate of [assertCurrentManagerMigrationSet,assertCurrentManager217MigrationSet,assertCurrentManager218MigrationSet])
    check(()=>assert.throws(()=>validate(),/requires all21[678] migrations/));
  // Exercise the old strict helper on an actual symlinked218 tree, not by
  // accepting the new count there or rewriting any retained migration bytes.
  const directory=mkdtempSync(join(tmpdir(),'mz-manager219-predecessor-'));
  try {
    mkdirSync(join(directory,'supabase','migrations'),{recursive:true});
    for(const row of rows.filter(row=>row.file!==CURRENT_MANAGER_219_MESSAGE_MIGRATION.file))
      symlinkSync(fileURLToPath(new URL('../supabase/migrations/'+row.file,import.meta.url)),join(directory,'supabase','migrations',row.file));
    const priorRoot=pathToFileURL(directory+'/');
    check(()=>assert.deepEqual(assertCurrentManager218MigrationSet(priorRoot),rows.filter(row=>row.file!==CURRENT_MANAGER_219_MESSAGE_MIGRATION.file)));
    check(()=>assert.throws(()=>assertCurrentManager219MigrationSet(priorRoot),/requires all219 migrations/));
    check(()=>assert.throws(()=>assertCurrentManager217MigrationSet(priorRoot),/requires all217 migrations/));
    check(()=>assert.throws(()=>assertCurrentManagerMigrationSet(priorRoot),/requires all216 migrations/));
  } finally {rmSync(directory,{recursive:true});}
  check(()=>assert.equal(JSON.stringify(rows),original));
  return {status:'PASS',checks,migrations:219,sql:false,solver:false,publication:false,production:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(runCurrentManager219ManifestTests()));
