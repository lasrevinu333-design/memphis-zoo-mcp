// Disposable restored-database fixture only. Never enrolls a real person/device.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { lstatSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createOpsManagerSession } from '../src/auth/shared-access-auth.js';

const [privateDir, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
assert.ok(privateDir && isAbsolute(privateDir), 'An owned private fixture directory is required.');
const stat = lstatSync(privateDir);
assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
assert.equal(stat.uid, process.getuid());
assert.equal(stat.mode & 0o777, 0o700);
assert.ok(String(process.env.OPS_MANAGER_SESSION_SECRET || '').length >= 32);
const now = new Date();
const managerId = randomUUID();
const credentialId = randomUUID();
const deviceId = `isolated-dependencies-${randomUUID()}`;
const systemKey = `isolated_dependency_reader_${randomUUID()}`;
const manager = { manager_id: managerId, display_name: 'Isolated dependency reader', roles: ['OPS_MANAGER'], active: true, revoked_at: null, system_key: systemKey, is_system_principal: false };
const session = createOpsManagerSession({ credentialId, deviceId, manager, now,
  env: process.env, authMode: 'trusted_device', accessLevel: 'read_only', maximumAccessLevel: 'read_only' });
assert.match(session.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
const expires = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
// All interpolated values below are generated UUID/hex/ISO literals above.
const sql = `BEGIN;
INSERT INTO public.ops_manager_managers(manager_id,display_name,roles,active,revoked_at,system_key,is_system_principal,metadata_json)
VALUES('${managerId}'::uuid,'Isolated dependency reader',ARRAY['OPS_MANAGER']::text[],true,NULL,'${systemKey}',false,'{"isolated_dependency_fixture":true}'::jsonb);
INSERT INTO public.ops_manager_trusted_devices(credential_id,device_id,device_label,token_hash,max_access_level,manager_id,created_at,expires_at,metadata_json)
VALUES('${credentialId}'::uuid,'${deviceId}','Isolated dependency reader','${tokenHash}','read_only','${managerId}'::uuid,'${now.toISOString()}'::timestamptz,'${expires}'::timestamptz,'{"isolated_dependency_fixture":true}'::jsonb);
COMMIT;
`;
writeFileSync(join(privateDir, 'dependency-manager-seed.sql'), sql, { flag: 'wx', mode: 0o600 });
writeFileSync(join(privateDir, 'dependency-manager-authorization.header'), `Authorization: Bearer ${session.token}\n`, { flag: 'wx', mode: 0o600 });
// Intentionally emit no token, rows or credentials. Owning fixture removes files.
