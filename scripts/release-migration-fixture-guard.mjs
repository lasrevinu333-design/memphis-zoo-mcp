import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const OWNER_FILE = "/run/mz-release-fixture-owner-token";

export function assertOwnedReleaseFixture({ databaseUrl, containerId, ownerToken, hostname, readOwnerFile = () => readFileSync(OWNER_FILE, "utf8") }) {
  assert.match(ownerToken || "", /^[a-f0-9]{32}$/, "fixture owner token must be unpredictable hex");
  assert.match(containerId || "", /^[a-f0-9]{64}$/, "fixture container ID must be exact");
  assert.equal(hostname, containerId.slice(0, 12), "fixture must run inside its exact owned container");
  assert.equal(readOwnerFile(), ownerToken, "fixture requires the wrapper's mounted ownership secret");
  const databaseName = `mz_schema_rebuild_releaseplan_${ownerToken}`;
  const url = new URL(databaseUrl || "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "fixture URL must use PostgreSQL");
  assert.equal(url.hostname, "127.0.0.1", "fixture URL must use exact container loopback");
  assert.equal(url.port, "5432", "fixture URL must use the container's PostgreSQL port");
  assert.equal(url.pathname, `/${databaseName}`, "fixture URL must name its exact disposable database");
  assert.equal(url.username, "supabase_admin", "fixture URL must use the disposable admin role");
  assert.equal(url.password, "postgres", "fixture URL must use the disposable admin password");
  assert.equal(url.search, "", "fixture URL must not use query-string host hints");
  assert.equal(url.hash, "", "fixture URL must not use fragments");
  return databaseName;
}

export function canonicalReleaseFixtureConnection(databaseName) {
  assert.match(databaseName || "", /^mz_schema_rebuild_releaseplan_[a-f0-9]{32}$/, "canonical disposable database required");
  return Object.freeze({
    clientConfig: Object.freeze({
      host: "127.0.0.1",
      port: 5432,
      database: databaseName,
      user: "supabase_admin",
      password: "postgres",
      ssl: false,
    }),
    databaseUrl: `postgresql://supabase_admin:postgres@127.0.0.1:5432/${databaseName}`,
  });
}
