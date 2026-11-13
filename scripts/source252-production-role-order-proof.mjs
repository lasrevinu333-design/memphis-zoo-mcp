// Source-lineage proof only. Never called by a production database client.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function reverseSource252ProductionRoleOrderOnly(sql) {
  const blocks=sql.match(/  -- BEGIN FINITE PRODUCTION SOURCE252 ROLE ORDER\n[\s\S]*?  -- END FINITE PRODUCTION SOURCE252 ROLE ORDER\n/g)||[];
  assert.equal(blocks.length,1);
  const original=sql.replace(blocks[0],'')
    .replace('\n role_order_profile jsonb; role_order_item jsonb; exception_index integer; repair_index integer;','')
    .replace('the declared finite metadata replacements.','the two declared metadata replacements.')
    .replace('-- Only the declared finite recovery records change. Current routine bodies,','-- Only these two obsolete recovery records change. Current routine bodies,')
    .replace('finite exact preimage repair changed','two-record exact preimage repair changed');
  assert.equal(sha(original),'4a961ebc7aefdfd99d04044fef0d7ceebc0f095783ff525491332244f329ce2a');
  return original;
}

// Isolated target preparation only: prove the unchanged historical plan after
// reversing exactly the pinned step119 candidate. Normal release preflight
// still requires a new actual target capture for the new plan digest.
export function source252RoleOrderPredecessorPlan(plan) {
  const result=structuredClone(plan),item=result.find(x=>x.order===119);
  assert.equal(item.file,'20261010193211_native_private_custody_chunk_retention.sql');
  assert.equal(item.sha256,'fffd25207dc1f7c1953bafe2dc23d4867c79724c4ed4f19995e36d3a71c95653');
  assert.equal(item.forward_source.sha256,item.sha256);
  assert.equal(item.forward_source.canonical_sha256,'28275c65a49b26a21ee0f37538a0f9c337a45c5fb41f0fa701d2ffdf555f863b');
  item.sha256='4a961ebc7aefdfd99d04044fef0d7ceebc0f095783ff525491332244f329ce2a';
  item.forward_source.sha256=item.sha256;
  return result;
}
