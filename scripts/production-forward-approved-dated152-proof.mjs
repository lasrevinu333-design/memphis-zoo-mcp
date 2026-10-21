// Source-proof adapter only: retain historical evidence while checking its exact successor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const e=JSON.parse(fs.readFileSync(new URL('../release/production-forward-source/approved-dated152-helper-owner-evidence.json',import.meta.url)));
const sha=x=>createHash('sha256').update(x).digest('hex');
export function reverseApprovedDatedHelperGrantOnly(sql,file){
 if(file!=='20261017225101_approved_static_dated_original_materialization.sql')return sql;
 assert.equal(sha(sql),e.forward_sha256);assert.equal(sql.split(e.guard).length,2);
 let old=sql.replace(e.guard,'');
 for(const r of e.replacements){assert.equal(old.split(r.executed_grant_sha256).length-1,r.occurrences);old=old.split(r.executed_grant_sha256).join(r.canonical_grant_sha256);}
 assert.equal(sha(old),e.before_forward_sha256);return old;
}
