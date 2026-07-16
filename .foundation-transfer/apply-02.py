nt="Password changed. Use it next time you sign in.";msg.style.color="#7dff9e";document.getElementById("pwform").reset();}\n    else{msg.textContent=d.error||"Could not change password.";msg.style.color="#ff8fa3";}',
    '    if(r.ok&&d?.changed===true){msg.textContent="Password changed. Use it next time you sign in.";msg.style.color="#7dff9e";document.getElementById("pwform").reset();}\n    else{msg.textContent=d.error||d.note||"No password was changed.";msg.style.color="#ff8fa3";}',
)
replace_once(
    "src/routes/moxie.js",
    '      res.json({ ok: true, auth_required: false, note: "Moxie sign-in is disabled in operations-first mode." });',
    '      res.status(409).json({ ok: false, changed: false, auth_required: false, error: "Moxie sign-in is disabled on this release, so there is no active password to rotate." });',
)

# Update the existing source-contract test to enforce the read-only boundary and
# the canonical rolling-window migration.
test_path = ROOT / "scripts/scheduler-alerts-gps-foundation-tests.mjs"
test_text = test_path.read_text(encoding="utf-8")
replacements = [
    ("const migration = read('sql/2026-07-14_scheduler_notifications_gps_foundation.sql');", "const migration = read('sql/2026-07-14_scheduler_notifications_gps_foundation.sql');\nconst foundationRepair = read('supabase/migrations/20260716150000_foundation_repair_v1.sql');"),
    ("assert.match(scheduleSource, /ensureScheduleReadyForRead/);", "assert.match(scheduleSource, /assertScheduleReadyForRead/);\nconst readinessHelper = scheduleSource.match(/async function assertScheduleReadyForRead[\\s\\S]*?\\n  }\\n  async function loadFullDayScheduleItems/)?.[0] || \"\";\nassert.doesNotMatch(readinessHelper, /runRpc|runWriteSql|sch_ensure_daily_schedule/);"),
    ("assert.match(scheduleSource, /sch_ensure_daily_schedule/);", "assert.match(foundationRepair, /sch_ensure_schedule_window/);\nassert.match(foundationRepair, /scheduled_rolling_window_readiness/);"),
    ("'schedule_readiness_self_heal',", "'schedule_readiness_read_only_guard',"),
]
for old, new in replacements:
    if test_text.count(old) != 1:
        raise SystemExit(f"scheduler foundation test target missing or duplicated: {old}")
    test_text = test_text.replace(old, new, 1)
test_path.write_text(test_text, encoding="utf-8")

# Assemble the canonical migration from readable transfer pieces.
migration = (ROOT / ".foundation-transfer/migration-00.sql").read_text(encoding="utf-8") + (ROOT / ".foundation-transfer/migration-01.sql").read_text(encoding="utf-8")
migration_path = ROOT / "supabase/migrations/20260716150000_foundation_repair_v1.sql"
migration_path.parent.mkdir(parents=True, exist_ok=True)
migration_path.write_text(migration, encoding="utf-8")

expected = {
    "src/schedule-api.js": "30285acf000de808d2156c5ea355c98bac0fcd5566a407e3eda34d976b27f72f",
    "src/routes/moxie.js": "c032e48c0430867a9a4c703180e023e4ce69536f777bbafcbb2fbc33e2ce4e0f",
    "scripts/scheduler-alerts-gps-foundation-tests.mjs": "78ded5641a8d11a5e681e71a405013f10932fe480e579b6d643ef39f545d52f1",
    "supabase/migrations/20260716150000_foundation_repair_v1.sql": "a0909574afb156a02cd025a743e8409cbb4b81ff845d5b9f6f1d82e965345c19",
}
for relative, digest in expected.items():
    actual = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
    if actual != digest:
        raise SystemExit(f"{relative}: sha256 mismatch {actual} != {digest}")

print("BACKEND_FOUNDATION_REPAIR_APPLY_PASS")
