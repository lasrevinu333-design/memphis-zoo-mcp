import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const [containerId, containerName, ownerToken, imageId, projectRoot,
  nodeSource, nodeSha256, nodeVersion, lib64Source, libSource, ownerSecretFile] = process.argv.slice(2);
let input = "";
for await (const chunk of process.stdin) input += chunk;
const [container] = JSON.parse(input);
assert.ok(container && typeof container === "object", "owned Docker inspection must return exactly one container");
assert.equal(container.Id, containerId, "exact container ID");
assert.equal(container.Name, `/${containerName}`, "exact disposable container name");
assert.equal(container.Config.Hostname, containerId.slice(0, 12), "container-local hostname ownership");
assert.equal(container.Image, imageId, "pinned Supabase image identity");
assert.equal(container.Config.Labels["org.memphiszoo.custodial.releaseplan.owner"], ownerToken, "unpredictable ownership label");
assert.equal(container.Config.Labels["org.memphiszoo.custodial.releaseplan.purpose"], "isolated-test");
assert.equal(container.HostConfig.NetworkMode, "none", "disposable fixture must have no network");
assert.deepEqual(container.HostConfig.PortBindings || {}, {}, "disposable fixture must publish no ports");
assert.equal(container.HostConfig.AutoRemove, true, "disposable fixture must auto-remove");
assert.ok(container.Config.Env.includes(`POSTGRES_DB=${containerName}`), "database name must be task-owned");
assert.ok(container.Config.Cmd.includes(`cron.database_name=${containerName}`), "pg_cron must target the exact database");
assert.ok(container.Config.Cmd.includes("listen_addresses=127.0.0.1"), "PostgreSQL must listen only inside container loopback");
const source = container.Mounts.find((mount) => mount.Destination === "/workspace");
assert.equal(source?.Source, projectRoot, "exact source tree must be mounted");
assert.equal(source?.RW, false, "source tree must be read-only");
for (const [destination, expectedSource] of [
  ["/usr/local/bin/node", nodeSource],
  ["/lib64", lib64Source],
  ["/lib/x86_64-linux-gnu", libSource],
  ["/run/mz-release-fixture-owner-token", ownerSecretFile],
]) {
  const mount = container.Mounts.find((item) => item.Destination === destination);
  assert.equal(mount?.Source, expectedSource, `${destination} must bind the checked host source`);
  assert.equal(mount?.RW, false, `${destination} must be mounted read-only`);
}
assert.equal(statSync(nodeSource).isFile(), true, "mounted Node source must be a file");
assert.ok((statSync(nodeSource).mode & 0o111) !== 0, "mounted Node source must be executable");
assert.equal(createHash("sha256").update(readFileSync(nodeSource)).digest("hex"), nodeSha256, "mounted Node hash must match checked binary");
assert.equal(execFileSync(nodeSource, ["--version"], { encoding: "utf8" }).trim(), `v${nodeVersion}`, "mounted Node version must match checked binary");
assert.equal(statSync(lib64Source).isDirectory(), true, "checked loader source must be a directory");
assert.equal(statSync(libSource).isDirectory(), true, "checked library source must be a directory");
assert.equal(statSync(ownerSecretFile).isFile(), true, "ownership secret mount source must be a file");
assert.equal(readFileSync(ownerSecretFile, "utf8"), ownerToken, "ownership secret source must match exact token");
console.log("RELEASE_MIGRATION_FIXTURE_CONTAINER_INSPECT_PASS");
