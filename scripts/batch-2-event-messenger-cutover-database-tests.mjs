#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const container = String(process.env.BATCH2_TEST_DOCKER_CONTAINER || '').trim();
const database = String(process.env.BATCH2_TEST_DATABASE || 'postgres').trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)
    || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error('A disposable schema-rebuild database is required.');
}

async function sql(statement) {
  const { stdout } = await execFileAsync('docker', [
    'exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-At',
    '-U', 'supabase_admin', '-d', database, '-c', statement,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

async function rejectsSql(statement, pattern) {
  await assert.rejects(sql(statement), pattern);
}

const userA = '00000000-0000-4000-8000-00000000b201';
const userB = '00000000-0000-4000-8000-00000000b202';
const admin = '00000000-0000-4000-8000-00000000b203';
const memphisBot = '00000000-0000-4000-8000-00000000b204';
const directThread = '00000000-0000-4000-8000-00000000b210';
const globalThread = '00000000-0000-4000-8000-00000000b211';
const opUser = '00000000-0000-4000-8000-00000000b220';
const opGlobal = '00000000-0000-4000-8000-00000000b221';
const oldMessage = '00000000-0000-4000-8000-00000000b230';

await sql(`
  insert into public.msg_users(id,display_name,role,is_active)
  values
    ('${userA}'::uuid,'Batch 2 Manager A','manager',true),
    ('${userB}'::uuid,'Batch 2 Manager B','manager',true),
    ('${admin}'::uuid,'Batch 2 Database Admin','admin',true),
    ('${memphisBot}'::uuid,'Memphis','bot',true);

  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values
    ('${directThread}'::uuid,'direct','Batch 2 Direct','${userA}'::uuid,true),
    ('${globalThread}'::uuid,'group','Batch 2 Global','${userA}'::uuid,true);

  insert into public.msg_thread_participants(thread_id,user_id)
  values
    ('${directThread}'::uuid,'${userA}'::uuid),
    ('${directThread}'::uuid,'${userB}'::uuid),
    ('${globalThread}'::uuid,'${userA}'::uuid),
    ('${globalThread}'::uuid,'${userB}'::uuid);

  insert into public.msg_messages(
    id,thread_id,sender_user_id,message_type,body,metadata_json,sent_at,created_at
  ) values (
    '${oldMessage}'::uuid,'${directThread}'::uuid,'${userB}'::uuid,
    'text','old history','{}'::jsonb,now()-interval '1 minute',now()-interval '1 minute'
  );
`);

const firstDelete = JSON.parse(await sql(
  `select public.msg_delete_thread('${directThread}'::uuid,'${userA}'::uuid,'${opUser}'::uuid)::text;`
));
assert.equal(firstDelete.deleted, true);
assert.equal(firstDelete.deletion_scope, 'user');
assert.equal(firstDelete.replayed, false);
assert.equal(await sql(`select is_active from public.msg_threads where id='${directThread}'::uuid;`), 't');
assert.equal(await sql(`select is_deleted from public.msg_messages where id='${oldMessage}'::uuid;`), 'f');
assert.equal(await sql(`
  select count(*) from public.msg_thread_visibility
  where thread_id='${directThread}'::uuid and user_id='${userA}'::uuid and device_identifier is null;
`), '1');

const replay = JSON.parse(await sql(
  `select public.msg_delete_thread('${directThread}'::uuid,'${userA}'::uuid,'${opUser}'::uuid)::text;`
));
assert.equal(replay.replayed, true);
await rejectsSql(
  `select public.msg_delete_thread('${globalThread}'::uuid,'${userA}'::uuid,'${opUser}'::uuid);`,
  /already used for another target/i
);
await rejectsSql(
  `select public.msg_delete_message('${oldMessage}'::uuid,'${userA}'::uuid);`,
  /Individual-message deletion is retired/i
);

await sql(`
  select public.msg_send_message(
    '${directThread}'::uuid,'${userB}'::uuid,'new history only','text','{}'::jsonb,'batch2-new-message'
  );
`);
assert.equal(await sql(`
  select count(*)
  from public.msg_messages m
  where m.thread_id='${directThread}'::uuid
    and coalesce(m.sent_at,m.created_at) > (
      select hidden_before from public.msg_thread_visibility
      where thread_id='${directThread}'::uuid
        and user_id='${userA}'::uuid
        and device_identifier is null
    );
`), '1');

await rejectsSql(`
  select public.msg_send_message(
    '${directThread}'::uuid,'${userB}'::uuid,'event must not enter chat','bot_response',
    '{"source":"events_app"}'::jsonb,'batch2-event-message'
  );
`, /native-only/i);

const globalDelete = JSON.parse(await sql(
  `select public.msg_admin_tombstone_thread('${globalThread}'::uuid,'${admin}'::uuid,'${opGlobal}'::uuid)::text;`
));
assert.equal(globalDelete.deleted, true);
assert.equal(globalDelete.deletion_scope, 'global');
assert.ok(globalDelete.purge_after);
assert.equal(await sql(`select is_active from public.msg_threads where id='${globalThread}'::uuid;`), 'f');

const memphisThread = JSON.parse(await sql(
  `select row_to_json(t)::text from public.msg_get_or_create_memphis_thread('${userA}'::uuid) t;`
));
const memphisDeleteOp = '00000000-0000-4000-8000-00000000b222';
const memphisDelete = JSON.parse(await sql(
  `select public.msg_delete_thread('${memphisThread.id}'::uuid,'${userA}'::uuid,'${memphisDeleteOp}'::uuid)::text;`
));
assert.equal(memphisDelete.memphis_generation_ended, true);
const freshMemphisThread = JSON.parse(await sql(
  `select row_to_json(t)::text from public.msg_get_or_create_memphis_thread('${userA}'::uuid) t;`
));
assert.notEqual(freshMemphisThread.id, memphisThread.id);

console.log('BATCH_2_EVENT_MESSENGER_CUTOVER_DATABASE_PASS');
