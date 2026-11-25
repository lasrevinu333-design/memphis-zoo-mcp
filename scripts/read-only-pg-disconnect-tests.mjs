import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { createReadOnlyPool, runReadOnlySnapshot, runReadOnlySql } from '../src/supabase/read.js';
import { observeProductionSchemaIdentity } from '../src/production-schema-identity.js';
import { APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY } from './schema-fingerprint-catalog.mjs';

const restrictedAuthority = {
  same_session_identity: true, transaction_read_only: true, dedicated_reader_member: true,
  exclusive_reader_membership: true, direct_object_grants_absent: true, owned_objects_absent: true,
  reader_role_restricted: true,
};

test('catalog capture binds the private ACL privilege in one restricted transaction', async () => {
  for (const failLate of [false, true]) {
    const calls = [], releases = [];
    const pool = { async connect() {
      return {
        async query(sql, parameters) {
          calls.push({ sql, parameters });
          if (sql.includes('with login_role')) return { rows: [restrictedAuthority] };
          if (sql.includes(APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY)) {
            return { rows: [{ schema_name: 'custodial_coverall', owner_name: 'migration_owner' }] };
          }
          if (sql.includes('has_schema_privilege')) {
            assert.match(sql, /has_schema_privilege\(d.defaclrole,owned.oid,\$1::text\)/);
            assert.deepEqual(parameters, ['CREATE']);
            if (failLate) throw new Error('fixture lost the connection during ACL capture');
          }
          return { rows: [] };
        },
        release(error) { releases.push(error); },
      };
    } };
    if (failLate) await assert.rejects(observeProductionSchemaIdentity({ pool }), /during ACL capture/);
    else assert.match((await observeProductionSchemaIdentity({ pool })).fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(calls.filter(({ sql }) => sql === 'begin isolation level repeatable read read only').length, 1);
    assert.equal(calls.filter(({ sql }) => sql.includes('has_schema_privilege')).length, 1);
    assert.equal(calls.at(-1).sql, failLate ? 'rollback' : 'commit');
    assert.equal(Boolean(releases[0]), failLate);
  }
});

function int32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
}

function frame(type, data) {
  return Buffer.concat([Buffer.from(type), int32(data.length + 4), data]);
}

for (const phase of ['idle', 'checked out']) {
  test(`pg socket loss while ${phase} discards the connection without crashing`, { timeout: 5000 }, async () => {
    let socket;
    const server = net.createServer(connection => {
      socket = connection;
      connection.once('data', () => {
        connection.write(Buffer.concat([frame('R', int32(0)), frame('Z', Buffer.from('I'))]));
        if (phase === 'checked out') connection.once('data', () => connection.end());
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const pool = createReadOnlyPool({
      connectionString: `postgres://fixture:fixture@127.0.0.1:${server.address().port}/fixture?sslmode=disable`,
    });
    try {
      // A promise registered with events.once(pool, ...) would itself handle
      // the idle 'error' event. Wait only on the remove callback here.
      // The real error event must be owned by the application.
      const removed = new Promise(resolve => pool.once('remove', resolve));
      if (phase === 'idle') {
        const client = await pool.connect();
        client.release();
        socket.end();
      } else {
        await assert.rejects(runReadOnlySql({ pool, sql: 'select 1' }), /Connection terminated/);
      }
      await removed;
      assert.equal(pool.totalCount, 0);
    } finally {
      socket?.destroy();
      await pool.end();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test('a connection error on commit discards the original client and the next reader succeeds', async () => {
  class Client extends EventEmitter {
    constructor(error) { super(); this.error = error; this.commands = []; this.releases = []; }
    async query(sql) {
      this.commands.push(sql);
      if (sql === 'commit' && this.error) this.emit('error', this.error);
      const rows = sql.includes('with login_role') ? [restrictedAuthority] : [{ fixture: 1 }];
      return { rows };
    }
    release(error) { this.releases.push(error); }
  }
  const disconnect = new Error('Synthetic connection lost after commit');
  const original = new Client(disconnect), replacement = new Client();
  const candidates = [original, replacement];
  const pool = { connect: async () => candidates.shift() };
  await assert.rejects(runReadOnlySql({ pool, sql: 'select 1 as fixture' }), disconnect);
  assert.deepEqual(original.releases, [disconnect]);
  assert.deepEqual(original.commands.slice(-2), ['commit', 'rollback']);
  assert.equal(original.listenerCount('error'), 0);
  assert.deepEqual((await runReadOnlySql({ pool, sql: 'select 1 as fixture' })).rows, [{ fixture: 1 }]);
  assert.deepEqual(replacement.releases, [undefined]);
  assert.equal(replacement.commands[0], 'begin isolation level repeatable read read only');
  assert.ok(replacement.commands.includes('set local row_security = on'));
});

test('dashboard sections share one restricted repeatable-read transaction and a failure rolls it back', async () => {
  for (const failing of [false, true]) {
    let checkouts = 0, revision = 1, snapshot = null;
    const commands = [], releases = [];
    const client = {
      async query(sql) {
        commands.push(sql);
        if (sql === 'begin isolation level repeatable read read only') snapshot = revision;
        if (sql.includes('with login_role')) return { rows: [restrictedAuthority] };
        if (sql.includes('fixture_first')) {
          revision++;
          return { rows: [{ revision: snapshot }] };
        }
        if (sql.includes('fixture_second')) {
          if (failing) throw new Error('Synthetic snapshot section failure');
          return { rows: [{ revision: snapshot }] };
        }
        return { rows: [] };
      },
      release(reason) { releases.push(reason); },
    };
    const pool = { connect: async () => { checkouts++; return client; } };
    const promise = runReadOnlySnapshot(['select fixture_first', 'select fixture_second'], { pool });
    if (failing) await assert.rejects(promise, /Synthetic snapshot section failure/);
    else assert.deepEqual(await promise, [[{ revision: 1 }], [{ revision: 1 }]]);
    assert.equal(checkouts, 1);
    assert.equal(releases.length, 1);
    assert.equal(commands.at(-1), failing ? 'rollback' : 'commit');
    assert.ok(commands.includes('set local row_security = on'));
  }
});
