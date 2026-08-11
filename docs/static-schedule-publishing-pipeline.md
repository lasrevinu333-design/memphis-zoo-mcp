# Static schedule publishing pipeline

Last updated: 2026-06-20

## Purpose

This document describes how static schedule data (employee shift templates, ops manager weekly schedules, and location group assignments) is published into the Memphis Zoo MCP system.

## Pipeline overview

The static schedule publishing pipeline is **not a single connected automated pipeline**. Instead, it consists of several independent components that work together:

### 1. Static data sources

Static schedule data lives in the following database tables:

- `employee_shift_templates` — per-employee weekly shift templates (day-of-week, shift_start, shift_end, notes)
- `ops_manager_weekly_schedules` — ops manager weekly shift assignments
- `location_groups` + `location_group_memberships` + `location_group_aliases` — area/group definitions
- `employee_primary_group_assignments` + `employee_location_group_assignments` — employee-to-area mappings
- `employee_planned_time_off` / `employee_pto` — planned absences

### 2. Daily schedule generation

Daily schedules are generated on-demand by the `sch_generate_daily_schedule` RPC function. This function:

1. Reads the static templates for the target service date's day-of-week
2. Creates `daily_schedule_assignments` rows for each employee/area/segment
3. Creates `daily_work_roster` rows for each scheduled employee
4. Applies absence overrides (PTO, callouts, manual overrides)

The AI system calls this function via `ensureDailySchedule()` when:
- A user asks about a schedule for a date that has no generated assignments yet
- The weekly schedule generator iterates through 7 days and finds missing data

**Note:** As of 2026-06-20, `ensureDailySchedule` uses `force: false` in user-triggered paths to avoid unnecessary regeneration on every question.

### 3. Static schedule restoration

The `restore_static_schedule_owners` SQL function (called from `schedule-api.js`) can restore schedule owner assignments from a previous date. This is used as a fallback when the current date's schedule is missing or corrupted.

### 4. Schedule audit

After generation or restoration, `schedule_audit` validates the generated schedule for completeness and correctness.

## No automated CI/CD pipeline

There is **no automated CI/CD pipeline** that publishes static schedules on a schedule. The static data in the database tables is maintained manually by operations staff. Daily schedule generation happens on-demand when users query the system.

If an automated publishing pipeline is needed in the future, it should:

1. Run `sch_generate_daily_schedule` for the next 7 days on a nightly cron
2. Validate the output with `schedule_audit`
3. Alert operations staff if generation fails or audit finds issues
4. Store the generated schedules for the AI to read without on-demand generation

## Static-weekly authority control plane

The separate static-weekly scheduler authority is not part of the legacy
on-demand generation path above. It reads one release-registered recurring
source and materializes an aligned seven-day horizon through the dedicated
control plane. Stable roster slots remain part of that source, while the
effective incumbent for each service date is read from the append-only
closure-aware roster ledger. A trusted, write-enabled named manager session is
required for every scheduler mutation; startup and writes fail closed if the
trusted-device revocation or manager-association store is unavailable.

## AI integration

The AI system (`memphis-ai.js`) interacts with the static schedule pipeline through:

- `ensureDailySchedule()` — triggers on-demand generation
- `ensureScheduleRange()` — generates schedules for a date range (now limited to today only for user-triggered paths)
- `fetchAreaScheduleRows()` / `fetchDailyRosterRows()` — reads generated schedules
- `fetchStaticEmployeeShift()` — reads static shift templates directly as a fallback

## Reminder-aware policy

Reminder-only locations (gift shops, Primate Canyon, Cat Country, etc.) are classified in `config/location-classification.json` and must not trigger schedule generation or dashboard overdue status. See `docs/reminder-aware-location-policy.md` for details.
