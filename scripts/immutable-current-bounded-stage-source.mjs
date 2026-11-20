// Fixed offline composition. The runtime cannot select SQL, schemas or bounds.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const serial=value=>JSON.stringify(value,null,2)+'\n';
const priorPin='fd53fda1891932c4cae89fc1f6f4b1c6116515ad2120aca6c41a1d5302cc84da';
const marker='-- Current postgres bounded staging only; no target DATA insertion.\n';
export function currentBoundedOrdinaryStageSql(){
 assert.equal(arguments.length,0);
 const sql=readFileSync(new URL('../proposals/immutable-current-bounded-ordinary-stage.sql',import.meta.url),'utf8');
 assert.equal(sha(sql),'b624446a7a0dcf540784a69a0cd215a1a374988a3382a991eb5fad50b2b5e7d3');assert.ok(sql.startsWith(marker));return sql;
}
export function extendCurrentBoundedOrdinaryStage(prior){
 assert.equal(arguments.length,1);assert.equal(sha(serial(prior)),priorPin);
 const p=structuredClone(prior),s=p.statements[0];
 assert.ok(s.sql.endsWith('COMMIT;\n'));assert.ok(!s.sql.includes(marker));
 s.sql=s.sql.slice(0,-'COMMIT;\n'.length)+currentBoundedOrdinaryStageSql()+'\nCOMMIT;\n';
 s.sourceSha256=sha(s.sql);assert.deepEqual(removeCurrentBoundedOrdinaryStage(p),prior);return p;
}
export function removeCurrentBoundedOrdinaryStage(program){
 assert.equal(arguments.length,1);const p=structuredClone(program),s=p.statements[0];
 if(!s.sql.includes(marker))return p;
 const addition=currentBoundedOrdinaryStageSql()+'\nCOMMIT;\n';assert.equal(s.sql.split(addition).length,2);
 s.sql=s.sql.replace(addition,'COMMIT;\n');s.sourceSha256=sha(s.sql);
 assert.equal(sha(serial(p)),priorPin,'Entire genuine predecessor program must remain exact');return p;
}
// Historical source-proof normalization only. Neither this byte inverse nor
// its output is a runtime profile, archive capability or target admission.
export function removeCurrentBoundedOrdinaryConsumerSource(source){
 assert.equal(arguments.length,1);assert.equal(typeof source,'string');
 const raw=readFileSync(new URL('../release/installed-source/20261120_bounded_ordinary_consumer_inverse.json',import.meta.url),'utf8');
 assert.equal(sha(raw),'fa2f1fe80f1f1a37823c9843c532741ece24324baef8273b37095185b3ebbeb6');
 const inverse=JSON.parse(raw);assert.equal(inverse.format,'custodial.bounded-ordinary-consumer-source-inverse.v1');
 assert.equal(sha(source),inverse.currentSha256);
 for(const hunk of inverse.hunks){assert.equal(source.split(hunk.after).length,2);source=source.replace(hunk.after,()=>hunk.before);}
 assert.equal(sha(source),inverse.previousSha256);return source;
}
