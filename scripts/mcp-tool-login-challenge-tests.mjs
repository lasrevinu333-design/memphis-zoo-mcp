import assert from 'node:assert/strict';
import { configureMcpToolAuth, registerMcpTool } from '../src/mcp/register.js';
const metadata = 'https://memphis-zoo-mcp.onrender.com/.well-known/oauth-protected-resource/mcp';
const base = `Bearer resource_metadata="${metadata}", scope="mcp:read"`;
const cases = [
  ['missing_both', base],
  ['missing_description', `${base}, error="invalid_token"`],
  ['missing_error', `${base}, error_description="Authentication is required."`],
  ['already_complete', `${base}, error="invalid_token", error_description="Authentication is required."`],
];
let passed = 0;
function register(name, challenge) {
  let guarded;
  let calls = 0;
  const server = { registerTool(_name, _definition, handler) { guarded = handler; } };
  configureMcpToolAuth(server, {
    securitySchemes: [{ type: 'noauth' }, { type: 'oauth2', scopes: ['mcp:read', 'mcp:write'] }],
    challenge,
  });
  registerMcpTool(server, name, { description: 'Isolated auth metadata check' }, async () => {
    calls += 1;
    return { content: [{ type: 'text', text: 'authorized fixture' }] };
  });
  return { call: (extra = {}) => guarded({}, extra), calls: () => calls };
}
for (const [label, challenge] of cases) {
  for (const [name, scope] of [['server_tool_manifest', 'mcp:read'], ['supabase_migration_apply', 'mcp:read mcp:write']]) {
    const probe = register(name, challenge);
    const result = await probe.call();
    assert.equal(result.isError, true);
    assert.equal(probe.calls(), 0, `${label}: no unauthorized adapter invocation`);
    const value = result._meta?.['mcp/www_authenticate']?.[0] || '';
    assert.match(value, /(?:^|[,\s])error="(?:invalid_token|insufficient_scope)"/, `${label}: include OAuth error`);
    assert.match(value, /(?:^|[,\s])error_description="[^"]+"/, `${label}: include a useful description`);
    assert.equal((value.match(/\berror="/g) || []).length, 1);
    assert.equal((value.match(/\berror_description="/g) || []).length, 1);
    assert.ok(value.includes(`resource_metadata="${metadata}"`));
    assert.ok(value.includes(`scope="${scope}"`));
    if (challenge.includes('error="invalid_token"')) assert.ok(value.includes('error="invalid_token"'));
    if (challenge.includes('error_description=')) assert.ok(value.includes('error_description="Authentication is required."'));
    passed += 1;
  }
}
for (const [name, scopes] of [['server_tool_manifest', ['mcp:read']], ['supabase_migration_apply', ['mcp:read', 'mcp:write']]]) {
  const probe = register(name, base);
  const result = await probe.call({ authInfo: { scopes } });
  assert.notEqual(result.isError, true);
  assert.equal(probe.calls(), 1);
  passed += 1;
  const noChallenge = register(name, null);
  assert.equal((await noChallenge.call()).isError, true);
  assert.equal(noChallenge.calls(), 0);
  passed += 1;
}
const insufficient = register('supabase_migration_apply', base);
assert.equal((await insufficient.call({ authInfo: { scopes: ['mcp:read'] } })).isError, true);
assert.equal(insufficient.calls(), 0); passed += 1;
const legacy = register('supabase_migration_apply', base);
assert.notEqual((await legacy.call({ authInfo: { scopes: [], extra: { authSource: 'connector_token' } } })).isError, true);
assert.equal(legacy.calls(), 1); passed += 1;
console.log(JSON.stringify({ ok: true, cases: passed, scope: 'tool login error metadata and unchanged handler access checks; synthetic, no provider calls' }));
