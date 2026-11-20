// Fixed offline composition only. No runtime caller chooses SQL or a cohort.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const priorPin='ba07026628726ae35f12522520c31a19bd1883cdbae9326fa711b9f551a0297a';
const proposalPin='0e3f38dbf8c908518c71e9303c903c716f51b8445639d0c08418fafeb3cdefd2';
const serial=value=>JSON.stringify(value,null,2)+'\n';
const once=(source,from,to)=>{assert.equal(source.split(from).length,2);return source.replace(from,()=>to);};
const oldFence='c.active_table_oid = TG_RELID';
const newFence='(c.active_table_oid = TG_RELID OR custodial_dr.immutable_import_active_cohort_relation(TG_RELID))';
const matcherAnchor=" IF ctx.phase NOT IN('INSERTING_ORDINARY','INSERTING_ORDINARY_SET') OR table_oid IS DISTINCT FROM ctx.active_table_oid\n";
const matcherBranch=" IF ctx.phase='INSERTING_ORDINARY_SET' AND custodial_dr.immutable_import_active_cohort_relation(table_oid) IS TRUE THEN\n  RETURN custodial_dr.immutable_import_matches_cohort_staged(table_oid,original_row);\n END IF;\n";
const marker='-- Only two fixed original table cohorts; no constraint timing or trigger change.\n';
export function currentCyclicCohortSql(){
 assert.equal(arguments.length,0);
 const raw=readFileSync(new URL('../proposals/immutable-original-cyclic-cohort-restore.sql',import.meta.url),'utf8');
 assert.equal(sha(raw),proposalPin);
 const header='-- UNQUALIFIED LOCAL PROPOSAL. Not included in the shipping program yet.\n';
 assert.ok(raw.startsWith(header+marker));return raw.slice(header.length);
}
export function extendCurrentCyclicStatementFence(definition){
 assert.equal(arguments.length,1);
 assert.ok(definition.startsWith('CREATE OR REPLACE FUNCTION custodial_dr.guard_application_mutation()\n'));
 return once(definition,oldFence,newFence);
}
export function extendCurrentCyclicCohorts(prior){
 assert.equal(arguments.length,1);assert.equal(sha(serial(prior)),priorPin);
 const p=structuredClone(prior),s=p.statements[0];
 s.sql=once(s.sql,oldFence,newFence);
 s.sql=once(s.sql,matcherAnchor,matcherBranch+matcherAnchor);
 assert.ok(s.sql.endsWith('COMMIT;\n'));
 s.sql=s.sql.slice(0,-'COMMIT;\n'.length)+currentCyclicCohortSql()+'\nCOMMIT;\n';s.sourceSha256=sha(s.sql);
 assert.deepEqual(removeCurrentCyclicCohorts(p),prior);return p;
}
export function removeCurrentCyclicCohorts(program){
 assert.equal(arguments.length,1);const p=structuredClone(program),s=p.statements[0];
 if(!s.sql.includes(marker))return p;
 s.sql=once(s.sql,currentCyclicCohortSql()+'\nCOMMIT;\n','COMMIT;\n');
 s.sql=once(s.sql,matcherBranch+matcherAnchor,matcherAnchor);s.sql=once(s.sql,newFence,oldFence);s.sourceSha256=sha(s.sql);
 assert.equal(sha(serial(p)),priorPin,'entire genuine program before fixed cyclic cohorts required');return p;
}
