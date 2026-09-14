#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const container = String(process.env.MESSAGING_DURABILITY_TEST_DOCKER_CONTAINER || "").trim();
const database = String(process.env.MESSAGING_DURABILITY_TEST_DATABASE || "postgres").trim();
if (!/^mz_schema_rebuild_[a-zA-Z0-9_]+$/.test(container)
    || !/^(postgres|mz_schema_rebuild_[a-zA-Z0-9_]+)$/.test(database)) {
  throw new Error("An owned disposable schema-rebuild database is required.");
}

function q(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

async function sql(statement) {
  const { stdout } = await execFileAsync("docker", [
    "exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-At",
    "-U", "supabase_admin", "-d", database, "-c", statement,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

async function json(statement) {
  return JSON.parse(await sql(statement));
}

async function rejectsSql(statement, pattern) {
  await assert.rejects(sql(statement), pattern);
}

const senderId = randomUUID();
const recipientId = randomUUID();
const threadId = randomUUID();
const fiveClientId = `messaging-durability-five-${randomUUID()}`;
const fiveOtherClientId = `messaging-durability-other-${randomUUID()}`;
const sixClientId = `messaging-durability-six-${randomUUID()}`;
const notificationA = `notification-a:${randomUUID()}`;
const notificationB = `notification-b:${randomUUID()}`;

await sql(`
  insert into public.msg_users(id,display_name,role,is_active)
  values
    (${q(senderId)}::uuid,'Messaging Durability Sender','employee',true),
    (${q(recipientId)}::uuid,'Messaging Durability Recipient','employee',true);
  insert into public.msg_threads(id,thread_type,title,created_by_user_id,is_active)
  values (${q(threadId)}::uuid,'direct','Messaging durability test',${q(senderId)}::uuid,true);
  insert into public.msg_thread_participants(thread_id,user_id)
  values (${q(threadId)}::uuid,${q(senderId)}::uuid),(${q(threadId)}::uuid,${q(recipientId)}::uuid);
`);

function fiveSend({ body, metadata }) {
  return json(`
    select row_to_json(m)::text
    from public.msg_send_message(
      ${q(threadId)}::uuid,
      ${q(senderId)}::uuid,
      ${q(body)},
      'text',
      ${q(JSON.stringify(metadata))}::jsonb
    ) m;
  `);
}

function sixSend({ body, metadata, clientMessageId }) {
  return json(`
    select row_to_json(m)::text
    from public.msg_send_message(
      ${q(threadId)}::uuid,
      ${q(senderId)}::uuid,
      ${q(body)},
      'text',
      ${q(JSON.stringify(metadata))}::jsonb,
      ${q(clientMessageId)}
    ) m;
  `);
}

const firstFive = await fiveSend({
  body: "five-argument immutable metadata",
  metadata: {
    client_message_id: fiveClientId,
    instance_key: notificationA,
    channel: "messaging-durability",
  },
});
assert.equal(firstFive.metadata_json.notification_instance_key, notificationA);
assert.equal(Object.hasOwn(firstFive.metadata_json, "instance_key"), false,
  "notification aliases are not persisted beside the canonical key");

const exactFive = await fiveSend({
  body: "five-argument immutable metadata",
  metadata: {
    client_message_id: fiveClientId,
    notification_instance_key: notificationA,
    channel: "messaging-durability",
  },
});
assert.equal(exactFive.id, firstFive.id, "an exact five-argument replay returns the original row");

await rejectsSql(`
  select public.msg_send_message(
    ${q(threadId)}::uuid,${q(senderId)}::uuid,'five-argument immutable metadata','text',
    jsonb_build_object(
      'client_message_id',${q(fiveClientId)},
      'notification_instance_key',${q(notificationA)},
      'channel','changed-metadata'
    )
  );
`, /client_message_id belongs to a different message payload/i);

const secondFive = await fiveSend({
  body: "notification payload B",
  metadata: {
    client_message_id: fiveOtherClientId,
    notification_key: notificationB,
    channel: "messaging-durability",
  },
});
assert.equal(secondFive.metadata_json.notification_instance_key, notificationB);

await rejectsSql(`
  select public.msg_send_message(
    ${q(threadId)}::uuid,${q(senderId)}::uuid,'notification payload B','text',
    jsonb_build_object(
      'client_message_id','new-client-id-for-existing-notification',
      'notification_instance_key',${q(notificationB)},
      'channel','messaging-durability'
    )
  );
`, /notification instance key belongs to a different message payload/i);

await rejectsSql(`
  select public.msg_send_message(
    ${q(threadId)}::uuid,${q(senderId)}::uuid,'five-argument immutable metadata','text',
    jsonb_build_object(
      'client_message_id',${q(fiveClientId)},
      'notification_instance_key',${q(notificationB)},
      'channel','messaging-durability'
    )
  );
`, /client_message_id belongs to a different message payload/i);

const firstSix = await sixSend({
  body: "six-argument immutable metadata",
  metadata: { channel: "messaging-durability", reminder_key: `reminder:${notificationA}` },
  clientMessageId: sixClientId,
});
const exactSix = await sixSend({
  body: "six-argument immutable metadata",
  metadata: { channel: "messaging-durability", notification_instance_key: `reminder:${notificationA}` },
  clientMessageId: sixClientId,
});
assert.equal(exactSix.id, firstSix.id, "an exact six-argument replay returns the original row");

await rejectsSql(`
  select public.msg_send_message(
    ${q(threadId)}::uuid,${q(senderId)}::uuid,'six-argument immutable metadata','text',
    jsonb_build_object('channel','changed-metadata','notification_instance_key',${q(`reminder:${notificationA}`)}),
    ${q(sixClientId)}
  );
`, /client_message_id belongs to a different message payload/i);

await rejectsSql(`
  select public.msg_send_message(
    ${q(threadId)}::uuid,${q(senderId)}::uuid,repeat('f',2001),'text',
    jsonb_build_object('client_message_id','five-too-long')
  );
`, /Message body cannot exceed 2000 characters/i);
await rejectsSql(`
  select public.msg_send_message(
    ${q(threadId)}::uuid,${q(senderId)}::uuid,repeat('s',2001),'text','{}'::jsonb,'six-too-long'
  );
`, /Message body cannot exceed 2000 characters/i);

console.log("MESSAGING_DURABILITY_DATABASE_TESTS_PASS");
