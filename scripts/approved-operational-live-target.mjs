#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Repository-reviewed service target, independently bound to the existing
// exact Render deployment receipt. Never derive the expectation from /version
// or confuse a backup-launcher commit with the separately deployed service.
export function validateApprovedOperationalTarget(target, receiptBytes) {
  assert.ok(target && !Array.isArray(target));
  assert.deepEqual(Object.keys(target).sort(), [
    'schema','scope','approval_kind','repository','service_id','origin',
    'backend_commit_sha','deployment_id','deployment_receipt_sha256',
    'not_launcher_identity','retired_application_http_status',
  ].sort());
  assert.equal(target.schema, 'custodial.operational-live-approved-target.v1');
  assert.equal(target.scope, 'api_only');
  assert.equal(target.approval_kind, 'qualified_exact_source_and_deployment');
  assert.equal(target.repository, 'lasrevinu333-design/memphis-zoo-mcp');
  assert.equal(target.service_id, 'srv-d7fsvg57vvec73bhe2r0');
  assert.equal(target.origin, 'https://memphis-zoo-mcp.onrender.com');
  assert.equal(target.not_launcher_identity, true);
  assert.equal(target.retired_application_http_status, 404);
  assert.match(target.backend_commit_sha, /^[a-f0-9]{40}$/);
  assert.notEqual(target.backend_commit_sha, '0'.repeat(40));
  assert.match(target.deployment_id, /^dep-[a-z0-9]+$/);
  assert.match(target.deployment_receipt_sha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(receiptBytes).digest('hex'), target.deployment_receipt_sha256);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert.equal(receipt.schema, 'custodial.operational-live-api-receipt.v1');
  assert.equal(receipt.service_id, target.service_id);
  assert.equal(receipt.origin, target.origin);
  assert.equal(receipt.deployment?.id, target.deployment_id);
  assert.equal(receipt.deployment?.status, 'live');
  assert.equal(receipt.deployment?.commit?.id, target.backend_commit_sha);
  for (const at of [receipt.observed_at, receipt.deployment.finishedAt]) {
    assert.equal(typeof at, 'string');
    assert.ok(Number.isFinite(Date.parse(at)));
  }
  assert.match(receipt.original_receipt_sha256, /^[a-f0-9]{64}$/);
  return Object.freeze({...target});
}

export function validateOperationalVersion(value, approved) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.equal(value.ok, true);
  // Root runtime identity is authoritative. An old release-manifest field or
  // a SHA elsewhere in the response cannot make a different runtime pass.
  assert.equal(value.backend_commit_sha, approved.backend_commit_sha);
  return true;
}

function readApproved() {
  return validateApprovedOperationalTarget(
    JSON.parse(readFileSync(new URL('../release/operational-live-approved-target.json', import.meta.url), 'utf8')),
    readFileSync(new URL('../release/operational-live-api-receipt.json', import.meta.url)),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const approved = readApproved();
    if (process.argv.length === 2) console.log(approved.backend_commit_sha);
    else {
      assert.equal(process.argv.length, 4);
      assert.equal(process.argv[2], '--verify-response');
      assert.equal(process.argv[3], approved.backend_commit_sha);
      const bytes = readFileSync(0);
      assert.ok(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024);
      validateOperationalVersion(JSON.parse(bytes.toString('utf8')), approved);
    }
  } catch {
    console.error('Approved service identity verification failed.');
    process.exitCode = 1;
  }
}
