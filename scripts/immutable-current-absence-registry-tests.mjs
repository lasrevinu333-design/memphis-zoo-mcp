// Offline execution of the shipping registry-selection block. No database/SQL execution.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {currentAbsenceRestoreRecipe} from './immutable-current-absence-restore-source.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const source=readFileSync(new URL('./immutable-private-source-bootstrap.mjs',import.meta.url),'utf8');
const a=source.indexOf(' const originalRows=raw.registryRows.map('),b=source.indexOf(" sourcePhase='SOURCE_STATEMENTS';",a);assert.ok(a>0&&b>a);
const block=source.slice(a,b);const execute=new Function('raw','recipes','postgresProgram','assert','sha',block+'return registrySource;');
const program=JSON.parse(readFileSync(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url)));
const r=currentAbsenceRestoreRecipe();assert.deepEqual(program.recipes.at(-1),r);
const rows=program.recipes.filter(x=>x.identity!=='custodial_coverall.bind_manual_delivery_after_acceptance()').map(x=>({object_kind:'function',object_identity:x.registry_identity,definition_sql:x.before,definition_sha256:x.beforeHash,unrelated:'PRESERVE'}));
// One inert base registry row supplies the bootstrap recipe outside the current program.
const base={identity:'public.unit_base()',registry_identity:'unit_base()',before:'UNIT_BASE',beforeHash:sha('UNIT_BASE'),after:'UNIT_BASE_AFTER',afterHash:sha('UNIT_BASE_AFTER')};
const recipes=[base,...program.recipes];rows.unshift({object_kind:'function',object_identity:base.registry_identity,definition_sql:base.before,definition_sha256:base.beforeHash,unrelated:'PRESERVE'});
const run=rs=>execute({registryRows:rs.map(x=>JSON.stringify(x))},recipes,true,assert,sha);
test('shipping selector binds exact absence original and modifies only approved definition/hash projection',()=>{
 const before=structuredClone(rows),result=run(rows);assert.equal(Object.keys(result).length,29);
 assert.deepEqual(result[r.registry_identity],{definition_sql:r.after,definition_sha256:r.afterHash});assert.deepEqual(rows,before);
 for(const x of recipes.filter(x=>x.identity!=='custodial_coverall.bind_manual_delivery_after_acceptance()')) assert.deepEqual(result[x.registry_identity],{definition_sql:x.after,definition_sha256:x.afterHash});
});
for(const mode of ['missing','duplicate','qualified_alias','wrong_kind','wrong_definition','wrong_digest'])test('shipping registry refuses absence '+mode,()=>{
 const rs=structuredClone(rows),i=rs.findIndex(x=>x.object_identity===r.registry_identity);
 if(mode==='missing')rs.splice(i,1);if(mode==='duplicate')rs.push({...rs[i]});if(mode==='qualified_alias')rs[i].object_identity=r.identity;if(mode==='wrong_kind')rs[i].object_kind='trigger';
 if(mode==='wrong_definition'){rs[i].definition_sql+=' ';rs[i].definition_sha256=sha(rs[i].definition_sql);}if(mode==='wrong_digest')rs[i].definition_sha256='0'.repeat(64);
 assert.throws(()=>run(rs));
});
