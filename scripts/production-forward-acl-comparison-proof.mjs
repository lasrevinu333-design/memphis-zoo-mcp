// Pure Source reverse proof. No SQL client, role, authorization or runtime API.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function reverseNamedAclComparisonOnly(sql,file){
 const e=JSON.parse(readFileSync(new URL('../release/production-forward-source/private-custody-acl-comparison-evidence.json',import.meta.url)));
 assert.equal(e.schema,'custodial.private-custody-named-acl-comparison-c.v1');
 const item=e.migrations.find(x=>x.file===file);assert.ok(item);assert.equal(sha(sql),item.after_sha256);
 const count=(text,part)=>text.split(part).length-1;
 assert.equal(count(sql,e.actual_after),item.actual_aggregate_count);assert.equal(count(sql,e.expected_after),item.expected_aggregate_count);
 const original=sql.replaceAll(e.actual_after,e.actual_before).replaceAll(e.expected_after,e.expected_before);
 assert.equal(sha(original),item.before_sha256,'Only the pinned comparison-order change may bridge historical profile provenance');
 return original;
}
