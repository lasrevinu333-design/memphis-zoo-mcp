import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname, parse } from "node:path";
import { fileURLToPath } from "node:url";

// Fixed shipping Source inputs only. These are not application DATA, an
// installer, target observations, or authority to activate a restore.
const SOURCES = Object.freeze([
  Object.freeze({ sourcePath: "proposals/immutable-original-event-restore.sql", bytes: 18373,
    sourceSha256: "d690bcffd46e16bb38f14a806abd8707f3b4ff55d9f5f5ffd27a4e408f0b5618" }),
  Object.freeze({ sourcePath: "proposals/immutable-original-employee-restore.sql", bytes: 4272,
    sourceSha256: "fa780776df06ed725f6eb23097fc490c2a88e8eea52407e7d873c58eecdee1b4" }),
  Object.freeze({ sourcePath: "proposals/immutable-original-messenger-restore.sql", bytes: 23565,
    sourceSha256: "8819fcabe7f3bfb155ba1a3c52f5916ac516499878e46fde0a961b2ab42247eb" }),
  Object.freeze({ sourcePath: "proposals/immutable-original-device-boundary-restore.sql", bytes: 8793,
    sourceSha256: "3661d44b43cdef0e1985b57899679377aa82e05a971b1e26022f9ac25f40ac93" }),
  Object.freeze({ sourcePath: "proposals/immutable-original-manager-push-restore.sql", bytes: 22426,
    sourceSha256: "2a9dd3a1050d0f7e7714abdd8feeb4259eea54287c68ffacd787b9072a9f7f9d" }),
  Object.freeze({ sourcePath: "proposals/immutable-original-employee-push-authority-restore.sql", bytes: 18144,
    sourceSha256: "2b8c5dad21a56d6132688a998ab3ae3df78584686c8b2f4fdd7baf7bbafd527d" }),
]);
const sha = value => createHash("sha256").update(value).digest("hex");

function fileIdentity(stat) {
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n, "Domain Source must be a regular single-link file");
  return Object.freeze([stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.nlink,
    stat.size, stat.mtimeNs, stat.ctimeNs]);
}

function parentIdentities(path) {
  const parents = [];
  for (let current = dirname(path); ; current = dirname(current)) {
    const stat = lstatSync(current, { bigint: true });
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "Domain Source parent must not be a symlink");
    // Directory timestamps change for unrelated entries; only the original
    // directory's ownership, mode and identity are relevant to this pathname.
    parents.push(Object.freeze([current, stat.dev, stat.ino, stat.mode, stat.uid, stat.gid]));
    if (current === parse(current).root) break;
  }
  return Object.freeze(parents);
}

function readSource(spec) {
  assert.ok(Number.isInteger(constants.O_NOFOLLOW), "No-follow Source reads are required");
  const path = fileURLToPath(new URL("../" + spec.sourcePath, import.meta.url));
  const parents = parentIdentities(path);
  const before = fileIdentity(lstatSync(path, { bigint: true }));
  assert.equal(before[6], BigInt(spec.bytes), "Domain Source byte count differs");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes, primaryError;
  try {
    assert.deepEqual(fileIdentity(fstatSync(fd, { bigint: true })), before);
    bytes = Buffer.alloc(spec.bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      assert.ok(count > 0, "Domain Source ended early");
      offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, bytes.length), 0, "Domain Source has excess bytes");
    assert.equal(sha(bytes), spec.sourceSha256, "Domain Source digest differs");
    const sql = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    assert.ok(Buffer.from(sql, "utf8").equals(bytes), "Domain Source UTF8 must be exact");
    assert.deepEqual(fileIdentity(fstatSync(fd, { bigint: true })), before);
    assert.deepEqual(fileIdentity(lstatSync(path, { bigint: true })), before);
    assert.deepEqual(parentIdentities(path), parents);
    return Object.freeze({ sql, identity: before, parents });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    bytes?.fill(0);
    try { closeSync(fd); } catch (error) { if (!primaryError) throw error; }
  }
}

function literalBetween(source, tag) {
  const parts = source.split(tag);
  assert.equal(parts.length, 3, "Expected one fixed Source dollar literal");
  return parts[1];
}

function replaceOnce(source, needle, replacement) {
  assert.ok(needle.length > 0);
  const index = source.indexOf(needle);
  assert.ok(index >= 0 && source.indexOf(needle, index + needle.length) === -1,
    "Expected one fixed Source replacement point");
  // Concatenation is intentional: replacement text's $ sequences are literal.
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

function bodyOf(definition) {
  const tag = "AS $function$";
  assert.equal(definition.split(tag).length, 2);
  assert.ok(definition.endsWith("$function$\n"));
  return definition.slice(definition.indexOf(tag) + tag.length, -"$function$\n".length);
}

function closed(profile, keys) {
  assert.ok(profile && Object.getPrototypeOf(profile) === Object.prototype);
  assert.deepEqual(Object.keys(profile).sort(), [...keys].sort());
  for (const key of keys) {
    if (key === "trigger_type") assert.ok(Number.isInteger(profile[key]));
    else assert.equal(typeof profile[key], "string");
    if (key.endsWith("_sha256")) assert.match(profile[key], /^[0-9a-f]{64}$/);
  }
}

// Fixed proposal consumer for the one manager-push original-row adapter.
// The proposal bytes and corresponding native INSERT-guard profile are pinned
// together; neither a caller profile nor an observed target supplies authority.
function managerPushOriginalRecipe(sql) {
  const p = JSON.parse(literalBetween(sql, "$original_manager_push_profile$"));
  closed(p, ["identity", "registry_identity", "before_definition", "before_definition_sha256",
    "before_prosrc_sha256", "restore_branch", "after_prosrc_sha256", "after_definition_sha256"]);
  assert.equal(p.identity, "public.ops_manager_notification_validate_owner()");
  assert.equal(p.registry_identity, "ops_manager_notification_validate_owner()");
  assert.ok(p.before_definition.startsWith("CREATE OR REPLACE FUNCTION " + p.identity + "\n"));
  assert.equal(sha(p.before_definition), p.before_definition_sha256);
  assert.equal(p.before_definition_sha256, "c51dd11eb1a98774e84e7e22bebc807f2f31baae91e2803d68092349fe7a5212");
  assert.equal(sha(bodyOf(p.before_definition)), p.before_prosrc_sha256);
  assert.ok(p.restore_branch.length > 0);
  const after = replaceOnce(p.before_definition, "\nbegin\n", "\nbegin\n" + p.restore_branch);
  assert.equal(sha(after), p.after_definition_sha256);
  assert.equal(sha(bodyOf(after)), p.after_prosrc_sha256);
  assert.equal(replaceOnce(after, p.restore_branch, ""), p.before_definition);
  return Object.freeze({ identity: p.identity, registry_identity: p.registry_identity,
    before: p.before_definition, after, beforeBodyHash: p.before_prosrc_sha256,
    afterBodyHash: p.after_prosrc_sha256 });
}

// Fixed named credential AFTER-ROW adapter. The private six-effect scope,
// not a caller profile or an old receipt, owns the exceptional transition.
function employeePushAuthorityRecipe(sql) {
  const p = JSON.parse(literalBetween(sql, "$original_employee_push_authority_profile$"));
  closed(p, ["identity", "registry_identity", "before_definition", "before_definition_sha256",
    "before_prosrc_sha256", "restore_branch", "after_prosrc_sha256", "after_definition_sha256"]);
  assert.equal(p.identity, "public.mz_reconcile_employee_push_credential_state()");
  assert.equal(p.registry_identity, "mz_reconcile_employee_push_credential_state()");
  assert.ok(p.before_definition.startsWith("CREATE OR REPLACE FUNCTION " + p.identity + "\n"));
  assert.equal(sha(p.before_definition), p.before_definition_sha256);
  assert.equal(p.before_definition_sha256, "f7b9cde8f63ef75c44cccf284795d7e9bafd6137b2bc9aee10de0533b7f0149d");
  assert.equal(sha(bodyOf(p.before_definition)), p.before_prosrc_sha256);
  assert.ok(p.restore_branch.length > 0);
  const after = replaceOnce(p.before_definition, "\nbegin\n", "\nbegin\n" + p.restore_branch);
  assert.equal(sha(after), p.after_definition_sha256);
  assert.equal(sha(bodyOf(after)), p.after_prosrc_sha256);
  assert.equal(replaceOnce(after, p.restore_branch, ""), p.before_definition);
  return Object.freeze({ identity: p.identity, registry_identity: p.registry_identity,
    before: p.before_definition, after, beforeBodyHash: p.before_prosrc_sha256,
    afterBodyHash: p.after_prosrc_sha256 });
}

export function loadImmutableDomainSourceRecipes() {
  assert.equal(arguments.length, 0, "Domain Source loader takes no arguments");
  const snapshots = SOURCES.map(readSource);
  const recipes = [], identities = new Set();
  const add = (identity, registry_identity, before, after, beforeBodyHash, afterBodyHash) => {
    assert.match(identity, /^public\.[a-z_][a-z0-9_]*\(\)$/);
    assert.match(registry_identity, /^(?:public\.)?[a-z_][a-z0-9_]*\(\)$/);
    assert.ok(!identities.has(identity));
    assert.ok(before.startsWith("CREATE OR REPLACE FUNCTION " + identity + "\n"));
    assert.ok(after.startsWith("CREATE OR REPLACE FUNCTION " + identity + "\n"));
    assert.equal(sha(bodyOf(before)), beforeBodyHash);
    assert.equal(sha(bodyOf(after)), afterBodyHash);
    identities.add(identity);
    recipes.push(Object.freeze({ identity, registry_identity, before, after,
      beforeHash: sha(before), afterHash: sha(after), beforeBodyHash, afterBodyHash }));
  };

  const eventSql = snapshots[0].sql;
  const eventBranch = literalBetween(eventSql, "$original_event_branch$");
  assert.ok(eventBranch.length > 0);
  const events = JSON.parse(literalBetween(eventSql, "$original_event_profiles$"));
  assert.ok(Array.isArray(events));
  assert.deepEqual(events.map(p => p.identity), [
    "public.app_event_place_admission_guard()", "public.app_event_supersession_guard()",
    "public.events_app_events_set_end_date()", "public.events_app_validate_scope_venue()", "public.events_app_isolate_needs_review()",
  ]);
  for (const p of events) {
    closed(p, ["identity", "before_definition", "before_definition_sha256", "before_prosrc_sha256", "after_prosrc_sha256", "after_definition_sha256"]);
    assert.equal(sha(p.before_definition), p.before_definition_sha256);
    const after = replaceOnce(p.before_definition, "\nbegin\n", "\nbegin\n" + eventBranch);
    assert.equal(sha(after), p.after_definition_sha256);
    assert.equal(replaceOnce(after, eventBranch, ""), p.before_definition);
    add(p.identity, p.identity, p.before_definition, after, p.before_prosrc_sha256, p.after_prosrc_sha256);
  }

  const employeeSql = snapshots[1].sql;
  const employeeIdentity = "public.static_weekly_v15_advance_recurring_generation()";
  const employeeHeader = "CREATE OR REPLACE FUNCTION " + employeeIdentity + "\n";
  assert.equal(employeeSql.split(employeeHeader).length, 2);
  assert.equal(employeeSql.split("\n$function$;").length, 2);
  const employeeStart = employeeSql.indexOf(employeeHeader);
  const employeeEnd = employeeSql.indexOf("\n$function$;", employeeStart);
  assert.ok(employeeEnd > employeeStart);
  const employeeAfter = employeeSql.slice(employeeStart, employeeEnd + "\n$function$".length) + "\n";
  const employeeBegin = "AS $function$\nbegin\n";
  const employeeContinuation = "  if tg_table_name='employees' then\n";
  assert.equal(employeeAfter.split(employeeBegin).length, 2);
  assert.equal(employeeAfter.split(employeeContinuation).length, 2);
  const employeeBodyStart = employeeAfter.indexOf(employeeBegin) + employeeBegin.length;
  const employeeResume = employeeAfter.indexOf(employeeContinuation, employeeBodyStart);
  assert.ok(employeeResume > employeeBodyStart);
  const employeeBranch = employeeAfter.slice(employeeBodyStart, employeeResume);
  const employeeBefore = employeeAfter.slice(0, employeeBodyStart) + employeeAfter.slice(employeeResume);
  assert.equal(sha(employeeBefore), "4a94f5e0cc6f6dcdd8e9547036266f05964306a04e4eb7621f8b70b811bd635c");
  assert.equal(replaceOnce(employeeBefore, employeeBegin, employeeBegin + employeeBranch), employeeAfter);
  add(employeeIdentity, employeeIdentity, employeeBefore, employeeAfter, sha(bodyOf(employeeBefore)), sha(bodyOf(employeeAfter)));

  const messengerProfiles = JSON.parse(literalBetween(snapshots[2].sql, "$original_messenger_profiles$"));
  const messengerExpected = [
    ["msg_enforce_canonical_active_pair_participants()", "msg_thread_participants", "trg_msg_enforce_canonical_active_pair_participants", 29],
    ["msg_enforce_canonical_active_pair_thread()", "msg_threads", "trg_msg_enforce_canonical_active_pair_thread", 21],
    ["public.msg_preserve_original_group_creation()", "msg_threads", "trg_msg_preserve_original_group_creation", 23],
    ["msg_reject_retired_ops_manager_shared_participation()", "msg_thread_participants", "trg_msg_reject_retired_ops_manager_shared_participation", 31],
    ["msg_reject_retired_ops_manager_shared_thread_mutation()", "msg_threads", "trg_msg_reject_retired_ops_manager_shared_thread_mutation", 31],
  ];
  assert.ok(Array.isArray(messengerProfiles));
  assert.equal(messengerProfiles.length, messengerExpected.length);
  for (const [index, p] of messengerProfiles.entries()) {
    closed(p, ["identity", "lookup_identity", "table_name", "trigger_name", "trigger_type", "before_definition",
      "before_definition_sha256", "before_prosrc_sha256", "before_grant_definition", "before_grant_sha256",
      "restore_branch", "after_prosrc_sha256", "after_definition_sha256"]);
    const [registryIdentity, table, trigger, type] = messengerExpected[index];
    const identity = registryIdentity.startsWith("public.") ? registryIdentity : "public." + registryIdentity;
    assert.equal(p.identity, registryIdentity); assert.equal(p.lookup_identity, identity);
    assert.equal(p.table_name, table); assert.equal(p.trigger_name, trigger); assert.equal(p.trigger_type, type);
    assert.equal(sha(p.before_definition), p.before_definition_sha256);
    assert.equal(sha(p.before_grant_definition), p.before_grant_sha256);
    assert.ok(p.restore_branch.length > 0);
    const after = replaceOnce(p.before_definition, "\nbegin\n", "\nbegin\n" + p.restore_branch);
    assert.equal(sha(after), p.after_definition_sha256);
    assert.equal(replaceOnce(after, p.restore_branch, ""), p.before_definition);
    add(identity, registryIdentity, p.before_definition, after, p.before_prosrc_sha256, p.after_prosrc_sha256);
  }

  const deviceSql = snapshots[3].sql;
  const deviceLiteral = literalBetween(deviceSql, "$original_device_definition$");
  assert.ok(deviceLiteral.startsWith("\nCREATE OR REPLACE FUNCTION "));
  const deviceBefore = deviceLiteral.slice(1);
  assert.equal(sha(deviceBefore), "011cc5921cefe8714f52b821b915686359ac5edb873abd33fec8696cc050f19a");
  const deviceBranch = literalBetween(deviceSql, "$original_device_restore_branch$");
  assert.ok(deviceBranch.length > 0);
  const deviceAfter = replaceOnce(deviceBefore, "\nbegin\n", "\nbegin\n" + deviceBranch);
  assert.equal(sha(deviceAfter), "14bde0e8c994bf8b0cb325fe39c6f60dd8531944a8cc766faf921ec2540449be");
  assert.equal(replaceOnce(deviceAfter, deviceBranch, ""), deviceBefore);
  add("public.custodial_record_offline_authority_activation_boundary()", "custodial_record_offline_authority_activation_boundary()",
    deviceBefore, deviceAfter, "78ca52bb75851e47e110a3674c744210fec37c0b9c000c2416d3ddf9e785bf05", "d97b5d02b929cd6c744fb73953458fedefeebd09d2026a0fbf28196007476fa2");
  // The new named AFTER-ROW proposal must be sealed and pinned before this
  // coupled consumer draft may execute; missing Source fails closed.
  assert.equal(snapshots.length, 6, "Original employee-push authority Source profile is not yet sealed");
  const managerPush = managerPushOriginalRecipe(snapshots[4].sql);
  add(managerPush.identity, managerPush.registry_identity, managerPush.before, managerPush.after,
    managerPush.beforeBodyHash, managerPush.afterBodyHash);
  const employeePush = employeePushAuthorityRecipe(snapshots[5].sql);
  add(employeePush.identity, employeePush.registry_identity, employeePush.before, employeePush.after,
    employeePush.beforeBodyHash, employeePush.afterBodyHash);
  assert.equal(recipes.length, 14);

  const statements = Object.freeze(SOURCES.map((spec, index) => Object.freeze({
    sourcePath: spec.sourcePath, sourceSha256: spec.sourceSha256, sql: snapshots[index].sql,
  })));
  function assertCurrent() {
    assert.equal(arguments.length, 0, "Domain Source currentness check takes no arguments");
    for (const [index, spec] of SOURCES.entries()) {
      const current = readSource(spec);
      assert.deepEqual(current.identity, snapshots[index].identity, "Original domain Source file identity changed");
      assert.deepEqual(current.parents, snapshots[index].parents, "Original domain Source path identity changed");
      assert.equal(current.sql, snapshots[index].sql, "Original domain Source bytes changed");
    }
  }
  assertCurrent();
  return Object.freeze({ recipes: Object.freeze(recipes), statements, assertCurrent: Object.freeze(assertCurrent) });
}
