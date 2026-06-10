# Memphis Scheduler Open-Owner Repair Implementation Plan

> **For Hermes:** Use `subagent-driven-development` for review-gated execution. Do not touch live production data until local tests and independent review pass.

**Goal:** Stop the scheduler from turning normal Memphis Zoo work areas into `OPEN` rows, repair the affected service-day ownership, and verify employee My Schedule/device views, Michael late coverage, lunch coverage, 9:45 rebalance, and known exceptions from a single daily-assignment source of truth.

**Architecture:** Keep `daily_schedule_assignments` as the employee/device source of truth. Preserve the existing DB restricted-assignment guard, but prevent automation from proposing restricted moves before the guard has to intervene. Treat `OPEN` normal coverage as a critical audit failure except for explicitly approved non-normal exceptions.

**Tech stack:** Node.js ESM backend in `memphis-zoo-mcp/src/schedule-api.js`; Supabase/Postgres functions/triggers; static frontend checks in `/home/eric/Projects/memphis-zoo/Engine`; regression scripts run with Node.

---

## Live evidence captured before planning

- Local time: `2026-06-09 21:57:47 America/Chicago`.
- DB `current_date`: `2026-06-10`; scheduler service date from `public.sch_service_date(now())`: `2026-06-09`.
- Git status before plan: `memphis-zoo-mcp` clean on `main...origin/main`; `Engine` clean on `main...origin/main`.
- Today/service-date `OPEN` rows found by read-only SQL:
  - `WEST_ADMIN`, `06:00-10:00`, `deep_clean`, `source_type=restroom_rebalance_0945:restricted_guard`.
  - `CHINA`, `08:30-12:00`, `deep_clean`, `source_type=restroom_rebalance_0945:restricted_guard`.
  - `EVENT_CENTER`, `08:30-12:00`, `deep_clean`, `source_type=restroom_rebalance_0945:restricted_guard`.
- Notes prove the sequence: 9:45 rebalance moved rows to Kathy Phelps, then the restricted-assignment DB guard opened them because Kathy is restricted for those groups.
- Root-cause candidate in code: `buildRestroomRebalancePlan()` checks active roster and shift coverage only. It does **not** know receiver/location restrictions. `rebalanceRestroomAssignments()` then blindly writes the move; the DB trigger prevents the invalid assignment by making the row `OPEN`.
- Private builder/reviewer lanes both confirmed the root cause and returned `REQUEST_CHANGES` before implementation. Their blockers are now part of this plan:
  - live `sch_employee_my_schedule_page(...)` is template-backed, not daily-assignment-backed, so `/my-day-summary` and `/my-schedule` can miss repaired/rebalanced daily rows;
  - live proof showed Michael has active daily `late_coverage` rows at/after 3:00 PM, but `sch_employee_my_schedule_page(..., Michael, 16:00)` returned `items: []`;
  - current operational validation gave false green while `PRIMATE_CANYON` had daily `deep_clean` and `lunch_coverage` rows even though it should be response-only/no-clean daytime coverage.

## Non-negotiable contracts

1. **Every normal active work area must have an owner.** `OPEN` is not acceptable for `deep_clean`, `area_owner`, `restroom_upkeep`, or other normal coverage rows.
2. **Known exceptions stay exceptions, not accidental opens.** Examples: Herpetarium has no Wednesday cleaning row; Monday gift shops are 8:00 AM reminders only; Primate Canyon/Cat Country are `No Clean / Calls to Location Only` response-only; Michael is broad afternoon-call coverage, not a normal morning/restroom/lunch balancing employee.
3. **Hard restrictions win.** A restricted employee/location pairing must never be assigned except explicit documented exceptions such as Alijah/Herpetarium Monday husband-not-working allowance.
4. **Automation cannot rely on the trigger to clean up bad choices.** The trigger remains the write-boundary safety net, but generator/rebalance code must avoid restricted moves up front.
5. **Employee My Schedule/device pages use daily assignments.** Do not regress to template-only summaries. Normal staff see only their own primary/9:45/lunch rows. Michael remains the afternoon-call exception. `/my-day`, `/my-day-summary`, and `/my-schedule` must all agree on daily assignments after generation, 9:45 rebalance, lunch split/reapply, and repair.
6. **No live writes until gates pass.** Production DB repair happens only after local tests and independent review pass.

---

## Phase 0 — Safety freeze and source-of-truth confirmation

**Objective:** Ensure all later changes are scoped to the true live scheduler path and will not accidentally mutate production.

**Files / systems:**
- Inspect only: `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/src/schedule-api.js`
- Inspect only: `/home/eric/Projects/memphis-zoo/Engine/employee-schedule.html`
- Inspect only: live Supabase read-only SQL via Memphis Zoo MCP

**Steps:**
1. Confirm repo status for `memphis-zoo-mcp` and `Engine`.
2. Confirm scheduler service date with `public.sch_service_date(now())`, not raw `current_date`.
3. Capture current/service-date open rows and 7-day future open rows.
4. Capture relevant live function definitions: `sch_is_employee_location_group_restricted`, `sch_guard_restricted_daily_assignment`, `sch_get_coverage_candidates`, `sch_employee_my_schedule_page`, `sch_audit_schedule_day`.
5. Map the live source path:
   - 9:45 automation: `listActiveRosterForRestroomRebalance()` -> `listRestroomAssignmentsForRebalance()` -> `buildRestroomRebalancePlan()` -> `rebalanceRestroomAssignments()`.
   - My Schedule/device: `/schedule-api/my-day`, `/schedule-api/my-day-summary`, `/schedule-api/my-schedule`, `sch_employee_my_schedule_page(...)`, `Engine/employee-schedule.html`.

**Gate 0 pass criteria:**
- We can name the exact scheduler codepath that created `restroom_rebalance_0945:restricted_guard` rows.
- We can name the affected service-date rows and show they are normal coverage, not approved exceptions.
- No production writes have run.

---

## Phase 1 — Regression tests first

### Task 1.1: Add restricted-receiver 9:45 rebalance unit regression

**Objective:** Prove the current 9:45 planner must not move an assignment to a restricted receiver.

**Modify:**
- `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/scripts/schedule-ai-tests.mjs`
- `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/src/schedule-api.js` only if needed to expose/import extracted helper text in the VM test harness.

**Test shape:**
1. Add a fixture where:
   - donor has high load and owns a restroom/normal row;
   - restricted receiver has the lowest load and a valid shift window;
   - alternate receiver has a valid shift window and is not restricted.
2. Include restriction data on the assignment row, preferably `restricted_employee_ids: [restrictedReceiverId]`, derived later from SQL.
3. Assert:
   - planner does **not** move to the restricted receiver;
   - planner either moves to the alternate valid receiver or skips with `no_safe_restroom_moves` if no valid unrestricted receiver exists;
   - no planned move carries `to_employee_id` in `restricted_employee_ids`.

**Expected before code fix:** FAIL or missing restriction support.

### Task 1.2: Add SQL-shape regression for restriction data in 9:45 assignment query

**Objective:** Prevent future drift where the unit planner supports restrictions but the live SQL never supplies them.

**Modify:**
- `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/scripts/schedule-ai-tests.mjs`

**Checks:**
- Slice `async function listRestroomAssignmentsForRebalance` from `src/schedule-api.js`.
- Assert the SQL references `public.sch_is_employee_location_group_restricted`; do **not** replace it with raw soft preference tables because the function contains hard exception logic such as Alijah/Herpetarium.
- Assert the SQL selects `location_group_id` and a `restricted_employee_ids` JSON/array value containing active rebalance-roster employee UUID text values restricted for that location group.
- Assert lunch rows remain excluded.
- Assert protected/manual/manager rows still cannot be moved.
- Slice `async function rebalanceRestroomAssignments` and assert the write update also has a DB-side restriction guard, a stale-plan guard (`dsa.assigned_employee_id = moved.from_employee_id`), a same-service-date guard, a non-lunch guard, a full-shift guard, and a non-manual/override/manager guard.

### Task 1.3: Add normal-open-owner audit regression/probe

**Objective:** Make accidental `OPEN` normal coverage a hard failing condition.

**Create:**
- `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/scripts/sql/check-scheduler-open-owner-contract.sql`

**Probe requirements:**
- Input/default window should use `public.sch_service_date(now())::date` through at least `+ 14 days`.
- Return rows for any `daily_schedule_assignments` where:
  - `status='OPEN'` or `assigned_employee_id is null` or `owner_type='OPEN'`;
  - purpose is normal work (`deep_clean`, `area_owner`, `restroom_upkeep`, `late_coverage` if it represents active call coverage, etc.);
  - group is not an approved no-row/reminder/response-only exception.
- Include columns: `service_date`, `group_code`, `group_name`, `coverage_start`, `coverage_end`, `coverage_purpose`, `source_type`, `notes`, and violation reason.

### Task 1.4: Add My Schedule/device source-of-truth regressions

**Objective:** Ensure employee-facing views remain daily-assignment-backed and do not reintroduce template-only drift.

**Modify / run:**
- `/home/eric/Projects/memphis-zoo/Engine/scripts/employee-schedule-section-tests.mjs`
- Mandatory backend/API or SQL regressions for `/my-day-summary`, `/my-schedule`, and `sch_employee_my_schedule_page(...)`; frontend fixture tests alone are not sufficient because they cannot prove the source-of-truth.

**Cases:**
- Normal employee: sees only own primary/9:45/lunch rows.
- Empty headings hidden.
- No `None listed` placeholders.
- Michael: sees afternoon-call/late-coverage when active, but normal staff do not see Michael's all-location rows.
- 9:45 affected employee: section changes after rebalance without showing unrelated employees.
- Daily repaired/rebalanced rows appear for the new owner and disappear from the old owner.
- `sch_employee_my_schedule_page(..., Michael, 16:00)` includes active daily `late_coverage` rows when Michael is on afternoon-call coverage.

### Task 1.5: Add lunch and exceptions regression probes

**Objective:** Prevent the open-owner fix from breaking lunch/exception rules.

**Checks:**
- `sch_apply_lunch_coverage` remains idempotent after rebalance.
- No uncovered lunch overlaps.
- No duplicate lunch windows.
- No same-lunch/overlapping-lunch coverer.
- Herpetarium Wednesday rows absent.
- Gift shops are Monday 8:00 reminder-only and do not enter 9:45/lunch.
- Primate Canyon/Cat Country remain response-only/no-clean, not normal open work.
- Alijah/Herpetarium restriction still guarded.

### Task 1.6: Add exception-validator hardening regression/probe

**Objective:** Replace false-green validation with a daily-assignment exception probe that catches response-only/reminder/no-row drift.

**Create / modify:**
- `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/scripts/sql/check-scheduler-exception-contract.sql`
- A static or SQL regression in `scripts/schedule-ai-tests.mjs` that ensures this probe exists and covers the named exception groups.

**Probe requirements:**
- Fail if `PRIMATE_CANYON` or `CAT_COUNTRY` has daily `deep_clean`, `area_owner`, `restroom_upkeep`, or `lunch_coverage` rows. These groups are response-only/no-clean daytime coverage; they should not be treated like normal owned cleaning work.
- Fail if gift shop groups have anything other than Monday 8:00 AM reminder-only rows ending before/at 9:45 AM.
- Fail if Herpetarium has Wednesday daily rows.
- Preserve explicit, reviewed exceptions only by group code and purpose; do not rely on free-text notes.
- Treat current `PRIMATE_CANYON` daily `deep_clean`/`lunch_coverage` rows as known debt that must be named in final verification if not repaired in this pass.

**Gate 1 pass criteria:**
- At least the new restricted-receiver test fails before the code patch for the expected reason.
- Existing schedule tests still run enough to establish the baseline failure mode.

---

## Phase 2 — Smallest backend code fix

### Task 2.1: Feed restriction metadata to the 9:45 planner

**Modify:**
- `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/src/schedule-api.js`

**Implementation outline:**
1. In `listRestroomAssignmentsForRebalance(serviceDate)`, add a derived field per assignment named `restricted_employee_ids`.
2. Build it from the active 9:45 roster and `public.sch_is_employee_location_group_restricted(roster.employee_id, dsa.location_group_id, extract(dow from dsa.service_date)::integer)`.
3. Keep the query read-only and still scoped to assigned, non-lunch, post-9:45 restroom-related rows.
4. Emit a JSONB/text array of employee UUID text values so the JS normalizer can parse reliably.
5. Explicit 9:45 spanning-row decision: the current code includes rows with `coverage_start < 09:45` and `coverage_end > 09:45` (for example `WEST_ADMIN 06:00-10:00`). For this repair, keep that behavior to avoid a larger scheduler rewrite, but ensure any receiver is unrestricted and full-shift valid. If later product behavior requires only post-9:45 ownership, split spanning rows before moving them; do **not** silently change this now.

### Task 2.2: Normalize and enforce restriction metadata in JS planner

**Modify:**
- `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/src/schedule-api.js`

**Implementation outline:**
1. Extend `normalizeRestroomRebalanceRow(row)` to include `restricted_employee_ids` as a Set/array of string IDs.
2. Add a helper like `canEmployeeReceiveRestroomAssignment(receiverId, employeeMeta, assignment)` that requires:
   - receiver is not the donor;
   - receiver shift fully covers assignment start/end;
   - receiver is not in `assignment.restricted_employee_ids`;
   - assignment is not protected/manual/manager override.
3. Replace the receiver filter in `buildRestroomRebalancePlan()` with that helper.
4. Preserve minimal movement / load-spread behavior. Do not introduce route-wide reshuffling.

### Task 2.3: Add DB write guard condition to the move update

**Modify:**
- `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp/src/schedule-api.js`

**Implementation outline:**
- In the `restroom_rebalance_0945` update, add a `WHERE` guard so moved rows update only when `not public.sch_is_employee_location_group_restricted(moved.to_employee_id, dsa.location_group_id, extract(dow from dsa.service_date)::integer)`.
- After the write, re-read moved assignment IDs and compare how many actually updated.
- If any planned move was skipped by the DB guard, report `partial`/`skipped_restricted_moves` in the result rather than claiming full rebalance success.
- The trigger remains a final safety net, but the normal path should never create `restricted_guard` opens.

**Exact guard shape:**
- Include `from_employee_id` in the `moved(...)` CTE.
- Join to `daily_schedule_assignments` by assignment ID and require:
  - `dsa.service_date = serviceDate`;
  - `dsa.status = 'ASSIGNED'`;
  - `dsa.owner_type = 'EMPLOYEE'`;
  - `dsa.assigned_employee_id = moved.from_employee_id` so stale plans cannot overwrite manager/automation changes;
  - `coalesce(dsa.coverage_purpose, '') <> 'lunch_coverage'`;
  - `coalesce(dsa.source_type, '')` is not manual/override/manager;
  - receiver has an active roster row on that service date and `shift_start <= dsa.coverage_start` and `shift_end >= dsa.coverage_end`;
  - `not public.sch_is_employee_location_group_restricted(moved.to_employee_id, dsa.location_group_id, extract(dow from dsa.service_date)::integer)`.
- Re-read planned assignment IDs after the update because `runWriteSql` may not return updated rows. Compute applied/skipped moves from actual persisted rows.

### Task 2.4: Preserve lunch reapply ordering

**Modify only if needed:**
- `ensureScheduleReadyForRestroomRebalance()` / the route that calls `applyLunchCoverageAfterRestroomRebalance()`.

**Rule:**
- After any 9:45 move, lunch coverage must be re-applied/verified idempotently.
- Do not rebalance `lunch_coverage` rows.

### Task 2.5: Fix My Schedule source-of-truth

**Modify:**
- New SQL migration or backend route replacement for `public.sch_employee_my_schedule_page(...)`.
- Existing routes `/my-day-summary` and `/my-schedule` in `src/schedule-api.js` only if the DB function is not the chosen single source.

**Implementation outline:**
1. Replace template-backed `coverage_templates` reads with daily rows from `daily_schedule_assignments` / `sch_get_daily_schedule_with_purpose(p_service_date)`.
2. Keep employee filtering strict: normal employees see only their own assigned rows for that service date. Do not expose all-location/Michael rows to normal staff.
3. Include daily rows for `deep_clean`, `area_owner`, `restroom_upkeep`, `lunch_coverage`, and `late_coverage` when assigned to the employee and active for the relevant phase/time.
4. Preserve simple item output consumed by `renderMyScheduleHtml`: item `name`, `group_code`, `coverage_purpose`, and restroom/reminder flags where needed.
5. Keep empty sections hidden and avoid raw backend row clutter.
6. Positive Michael rule: when Michael has active daily `late_coverage` rows, his My Schedule must show them under Afternoon Call Coverage.
7. 9:45 rule: repaired/rebalanced daily assignment rows must appear for the new owner and disappear from the previous owner.

**Gate:** Backend SQL/API tests must prove this before live repair. Frontend fixture tests are presentation-only and cannot satisfy this gate alone.

**Gate 2 pass criteria:**
- `npm run test:schedule-ai` passes.
- Node syntax check passes: `node --check src/schedule-api.js`.
- No unrelated files changed except test/SQL probe/plan/code intended for this fix.

---

## Phase 3 — Current service-day data repair, still local/review-gated before live write

**Objective:** Prepare the exact live repair for affected service-date rows after the code is safe.

**Affected rows from live evidence:**
- `WEST_ADMIN`, `2026-06-09`, `06:00-10:00`, currently `OPEN` due restricted Kathy move.
- `CHINA`, `2026-06-09`, `08:30-12:00`, currently `OPEN` due restricted Kathy move.
- `EVENT_CENTER`, `2026-06-09`, `08:30-12:00`, currently `OPEN` due restricted Kathy move.

**Candidate rules:**
- `WEST_ADMIN`: restore to Kinnaye Peete when active because West Admin/East Admin/Education are her hard/core route areas.
- `CHINA`: choose the best eligible active employee from `sch_get_coverage_candidates`; avoid Kathy because restricted; respect shift coverage and current workload. Tuesday evidence suggests Markiesha Warren is eligible and top candidate, with Tammy as China-prefer backup.
- `EVENT_CENTER`: Daniel Morgan is preferred/default when active, but he is off for the affected day; choose best eligible active employee, avoiding Kathy restriction. Tuesday evidence suggests Markiesha Warren is eligible and top candidate.

**Repair script requirements:**
- Use one explicit SQL migration or admin write statement with row identity guarded by `service_date`, exact `location_group_id`/group code, exact `coverage_start`, exact `coverage_end`, `source_type like '%restricted_guard%'`, `status='OPEN'`, `owner_type='OPEN'`, and `assigned_employee_id is null`.
- Resolve employee IDs by stable names/codes inside the SQL.
- Before updating, assert each chosen employee is active on the service date and shift covers the coverage window.
- Before updating, assert `not sch_is_employee_location_group_restricted(chosen_employee_id, location_group_id, dow)`.
- Before updating, assert the chosen employee lunch window does not overlap the target row or that lunch coverage is re-applied and validated immediately after.
- The dry-run preview must include the exact row IDs, old source/notes, selected new owner, active-shift proof, restriction proof, and lunch-overlap proof.
- The write must abort unless exactly 3 intended rows update, and the update should use `returning` so the repaired rows can be verified immediately.
- Set `assigned_employee_id`, `owner_type='EMPLOYEE'`, `status='ASSIGNED'`, and append an audit note like `Repaired open owner after restricted 9:45 move; assigned to <name> after eligibility check.`
- Do **not** rewrite unrelated historical open rows unless explicitly included in the reviewed repair set.

**Gate 3 pass criteria before live repair:**
- Independent reviewer approves exact row scope and candidate owners.
- Dry-run/read-only preview returns exactly 3 rows for current service-date repair and zero rows outside the intended group/time/source/status predicates.
- The post-repair read-only checks must prove those same 3 rows are no longer open, no chosen owner is restricted/off-shift, and My Schedule reflects the repaired daily rows.

---

## Phase 4 — Independent review lanes

**Objective:** Have private assistants inspect the scope before code/live changes.

**Builder lane ask:**
- Inspect `schedule-api.js`, `schedule-ai-tests.mjs`, live SQL evidence, and this plan.
- Produce exact recommended code/test patch shape.
- Identify whether any existing helper can be reused.
- Do not write live data.

**Reviewer lane ask:**
- Check the plan for system-risk issues:
  - open-owner contract;
  - restrictions vs soft preferences;
  - lunch reapply;
  - My Schedule source-of-truth;
  - Michael exception;
  - exceptions/no-clean/reminders;
  - deploy verification boundary.
- Return PASS/REQUEST_CHANGES with specific blockers.

**Gate 4 pass criteria:**
- Builder and reviewer agree the fix should be limited to 9:45 restriction-aware moves + open-owner validator/repair.
- Any reviewer blockers are resolved before implementation.

---

## Phase 5 — Local verification matrix

Run from `/home/eric/Projects/memphis-zoo/memphis-zoo-mcp` unless noted.

**Commands:**
```bash
node --check src/schedule-api.js
npm run test:schedule-ai
npm run smoke
```

Run from `/home/eric/Projects/memphis-zoo/Engine` if frontend tests are touched:
```bash
node scripts/employee-schedule-section-tests.mjs
```

**Read-only SQL verification:**
- `check-scheduler-open-owner-contract.sql` returns zero current/future normal open rows after repair.
- `sch_validate_alijah_herpetarium_rule(...)` returns zero violations.
- `sch_validate_operational_schedule_rules(...)` returns zero violations or only approved/understood exceptions.
- Lunch uncovered overlap count is zero.
- Duplicate lunch coverage window count is zero.
- Current service-date audit no longer shows `WEST_ADMIN`, `CHINA`, or `EVENT_CENTER` as `OPEN`.

**Gate 5 pass criteria:**
- All local Node tests pass.
- Read-only SQL probes are clean or documented with explicit approved exception rows.

---

## Phase 6 — Deploy / live verification only after gates pass

**Objective:** Ship the backend code safely and prove production behavior without overclaiming.

**Steps:**
1. Review `git diff --stat` and full diff.
2. Stage only files belonging to this repair.
3. Commit with a scoped message, e.g. `fix: keep restroom rebalance from assigning restricted owners`.
4. Push to the configured remote.
5. Verify deployment health/version from the live Render endpoint.
6. Run read-only live SQL probes again.
7. If approved by gates, run the exact 3-row current service-date repair statement.
8. Re-run live probes and user-facing schedule endpoints:
   - service-date open-owner check is zero for normal rows;
   - `/schedule-api/my-day` / `/my-schedule` representative employees show correct ownership;
   - Michael still shows only intended afternoon-call coverage;
   - normal staff do not see all-location/Michael rows;
   - lunch rows remain valid.

**Final report shape:**
- Root cause: 9:45 planner ignored restricted receiver eligibility; DB guard protected the restriction by opening rows.
- Code fix status: committed/pushed/deployed or local-only.
- Data repair status: exact affected rows and new owner names.
- Verification counts: open normal rows, restricted violations, uncovered lunch overlaps, duplicate lunch windows, tests run.
- Any remaining exception rows named plainly.

---

## Abort / pause conditions

Stop before live writes if any of these happen:
- The dry-run repair scope is not exactly the intended rows.
- A candidate owner is restricted, absent, off-shift, or same-lunch invalid for a lunch row.
- Tests show My Schedule/device source-of-truth would regress.
- The independent reviewer flags a critical blocker.
- Production deploy status cannot be verified and live mutation would be unsafe.
