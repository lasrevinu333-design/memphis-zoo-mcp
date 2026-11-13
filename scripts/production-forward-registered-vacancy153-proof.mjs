// Read-only Source proof adapter: preserve the exact historical forward model.
import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex'),e=JSON.parse(fs.readFileSync(new URL('../release/production-forward-source/registered-vacancy153-owner-evidence.json',import.meta.url)));
export function reverseRegisteredVacancyOwnerOnly(sql,file){
 if(file!=='20261018151858_registered_never_filled_vacancy_source_recovery.sql')return sql;
 assert.equal(sha(sql),e.forward_sha256);assert.equal(sql.split(e.guard).length,2);let x=sql.replace(e.guard,'');
 for(const c of e.cardinality_changes){assert.equal(x.split(c.after).length,2);x=x.replace(c.after,c.before);}
 assert.equal(sha(x),e.before_forward_sha256);return x;
}
