#!/usr/bin/env node

import assert from "node:assert/strict";
import { productionBackupPgDumpDockerArgs } from "./production-backup-pg-dump-command.mjs";

const fixture = {
  caPath: "/repo/.github/certs/prod-ca-2021.crt",
  databaseHost: "db.example.internal",
  databaseName: "postgres",
  databasePort: "5432",
  databaseUsername: "backup_user",
  exportedSnapshot: "00000003-0000001B-1",
  inventoryDir: "/private/backup/inventory",
  pgDumpImage: "supabase/postgres@sha256:" + "a".repeat(64),
  uid: 1000,
  gid: 1000,
};

const defaultArgs = productionBackupPgDumpDockerArgs(fixture);
assert.deepEqual(defaultArgs.slice(0, 4), ["run", "--rm", "--entrypoint", "pg_dump"]);
assert.equal(defaultArgs.includes("--network"), false, "default/GitHub backup must retain Docker's isolated default network");
assert.deepEqual(defaultArgs.slice(defaultArgs.indexOf("PGSSLMODE=verify-full") - 1, defaultArgs.indexOf("PGSSLMODE=verify-full") + 3), [
  "-e", "PGSSLMODE=verify-full", "-e", "PGSSLROOTCERT=/cert/prod-ca.crt",
]);
assert.deepEqual(defaultArgs.slice(defaultArgs.indexOf("--host"), defaultArgs.indexOf("--host") + 8), [
  "--host", fixture.databaseHost,
  "--port", fixture.databasePort,
  "--username", fixture.databaseUsername,
  "--dbname", fixture.databaseName,
]);

const hostNetworkArgs = productionBackupPgDumpDockerArgs({
  ...fixture,
  databaseHost: "db.rqquvtjdmugpigbndmne.supabase.co",
  executionMode: "task-local",
  networkHost: true,
});
assert.deepEqual(hostNetworkArgs.slice(0, 6), ["run", "--rm", "--entrypoint", "pg_dump", "--network", "host"]);
assert.equal(hostNetworkArgs[hostNetworkArgs.indexOf("--host") + 1], "db.rqquvtjdmugpigbndmne.supabase.co",
  "pg_dump retains the certificate hostname even when the host resolves IPv6-only");
assert.ok(hostNetworkArgs.includes("PGSSLMODE=verify-full"));
assert.ok(hostNetworkArgs.includes("PGSSLROOTCERT=/cert/prod-ca.crt"));

assert.throws(() => productionBackupPgDumpDockerArgs({ ...fixture, networkHost: true }), /task-local backup access/);
assert.throws(() => productionBackupPgDumpDockerArgs({
  ...fixture,
  executionMode: "task-local",
  networkHost: true,
}), /task-local backup access/);
assert.throws(() => productionBackupPgDumpDockerArgs({
  ...fixture,
  databaseHost: "db.rqquvtjdmugpigbndmne.supabase.co",
  executionMode: "github-actions",
  networkHost: true,
}), /task-local backup access/);
assert.throws(() => productionBackupPgDumpDockerArgs({
  ...fixture,
  databaseHost: "2001:db8::1234",
  executionMode: "task-local",
  networkHost: true,
}), /task-local backup access/, "an IPv6 literal must not bypass verify-full hostname identity");

console.log("PRODUCTION_BACKUP_PG_DUMP_COMMAND_TESTS_PASS");
