import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const id = "b".repeat(64);
const token = "a".repeat(32);
const name = `mz_schema_rebuild_releaseplan_${token}`;
const image = "sha256:" + "c".repeat(64);
const root = "/exact/backend";
const nodeSource = realpathSync(process.execPath);
const nodeSha256 = createHash("sha256").update(readFileSync(nodeSource)).digest("hex");
const nodeVersion = process.versions.node;
const lib64Source = realpathSync("/lib64");
const libSource = realpathSync("/lib/x86_64-linux-gnu");
const temporary = mkdtempSync(`${tmpdir()}/mz-release-fixture-inspect-`);
const ownerSecretFile = `${temporary}/token`;
writeFileSync(ownerSecretFile, token, { mode: 0o400 });
const base = {
  Id: id, Name: `/${name}`, Image: image,
  Config: { Hostname: id.slice(0, 12), Labels: {
    "org.memphiszoo.custodial.releaseplan.owner": token,
    "org.memphiszoo.custodial.releaseplan.purpose": "isolated-test",
  }, Env: [`POSTGRES_DB=${name}`], Cmd: [`cron.database_name=${name}`, "listen_addresses=127.0.0.1"] },
  HostConfig: { NetworkMode: "none", PortBindings: {}, AutoRemove: true },
  Mounts: [
    { Source: root, Destination: "/workspace", RW: false },
    { Source: nodeSource, Destination: "/usr/local/bin/node", RW: false },
    { Source: lib64Source, Destination: "/lib64", RW: false },
    { Source: libSource, Destination: "/lib/x86_64-linux-gnu", RW: false },
    { Source: ownerSecretFile, Destination: "/run/mz-release-fixture-owner-token", RW: false },
  ],
};
const script = resolve(new URL("./release-migration-fixture-inspect.mjs", import.meta.url).pathname);
function inspect(value) {
  return spawnSync(process.execPath, [script, id, name, token, image, root,
    nodeSource, nodeSha256, nodeVersion, lib64Source, libSource, ownerSecretFile], {
    input: JSON.stringify([value]), encoding: "utf8", timeout: 5000,
  });
}
try {
assert.equal(inspect(base).status, 0, "exact owned container must pass");
for (const changed of [
  { Id: "d".repeat(64) },
  { Name: "/unrelated" },
  { Image: "sha256:" + "d".repeat(64) },
  { Config: { ...base.Config, Labels: { ...base.Config.Labels, "org.memphiszoo.custodial.releaseplan.owner": "d".repeat(32) } } },
  { HostConfig: { ...base.HostConfig, NetworkMode: "bridge" } },
  { HostConfig: { ...base.HostConfig, PortBindings: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5432" }] } } },
  { Config: { ...base.Config, Env: ["POSTGRES_DB=other"] } },
  { Config: { ...base.Config, Cmd: ["cron.database_name=other", "listen_addresses=127.0.0.1"] } },
  { Mounts: [{ Source: "/unrelated", Destination: "/workspace", RW: true }, ...base.Mounts.slice(1)] },
  { Mounts: [base.Mounts[0], { Source: "/evil/not-node", Destination: "/usr/local/bin/node", RW: false }, ...base.Mounts.slice(2)] },
  { Mounts: [...base.Mounts.slice(0, 2), { Source: "/evil/lib64", Destination: "/lib64", RW: false }, ...base.Mounts.slice(3)] },
  { Mounts: [...base.Mounts.slice(0, 3), { Source: "/evil/libs", Destination: "/lib/x86_64-linux-gnu", RW: false }, base.Mounts[4]] },
  { Mounts: [...base.Mounts.slice(0, 4), { Source: "/evil/token", Destination: "/run/mz-release-fixture-owner-token", RW: false }] },
]) assert.notEqual(inspect({ ...base, ...changed }).status, 0, "unrelated or unsafe container must fail");
console.log("RELEASE_MIGRATION_FIXTURE_INSPECT_TESTS_PASS");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
