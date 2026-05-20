# Memphis Messenger Regression Fixtures

Use these after each deploy to catch routing, context, and wording regressions.

## Daily staffing context

1. `Who works Thursday?`
   - Intent: `daily_staff_schedule`
   - Must answer staffing for Thursday.

2. `What about Wednesday?`
   - Must rewrite as `who is working Wednesday` using prior staffing context.
   - Intent: `daily_staff_schedule`

3. `Only custodians?`
   - Must preserve prior date and filter audience to custodians.

4. `What about ops managers?`
   - Must preserve prior date and switch audience to ops.

## Area ownership

5. `Who has Teton today?`
   - Intent: `area_schedule` or `current_owner`
   - Must name assigned owner without fake per-location station times.

6. `Who has East End Restrooms?`
   - Must return owner/assigned employee.
   - Must not rebalance static ownership in the answer.

7. `What about North West Passage?`
   - Must preserve area schedule/current owner context.

## Employee schedule/status

8. `Where is Tammy assigned today?`
   - Intent: `employee_work_status` or `employee_schedule`
   - Must say assigned areas for the shift, not timed station duty.

9. `What is my schedule?`
   - Must resolve device user first.

10. `What about tomorrow?`
    - Must preserve `my_schedule` context if previous message was self-schedule.

## PTO and absences

11. `Who is PTO on 2026-05-20?`
    - Intent: `absence_coverage`
    - Must read all absence sources and dedupe employees.
    - Sources should include `daily_absence_overrides`, `employee_planned_time_off`, `employee_pto`.

12. `Is Sherita out today?`
    - Must resolve Sherita and answer based on active PTO/absence rows.

13. `Who is covering her?`
    - Must use prior employee context when available.

## Coverage and open segments

14. `Who can cover Aquarium?`
    - Intent: `coverage_candidates`
    - Sources should include `sch_get_coverage_candidates`.

15. `What is open today?`
    - Intent: `open_segments`
    - Sources should include `v_memphis_open_segments`.

## Events, tickets, dashboard

16. `What events are coming up?`
    - Intent: `events`
    - Sources should include `events_app_events`.

17. `Any open tickets at Teton?`
    - Intent: `tickets`
    - Sources should include `v_open_maintenance_tickets`.

18. `How many guests today?`
    - Intent: `dashboard` or `attendance`
    - Sources should include `current_attendance_state`.

## Diagnostics endpoint

POST `/messaging-api/memphis/diagnose` with:

```json
{
  "user_id": "<user_uuid>",
  "device_id": "<device_id>",
  "body": "What about Wednesday?"
}
```

Expected payload fields:

- `original_message`
- `rewritten_message`
- `route.intent`
- `route.confidence`
- `service_date`
- `thread_context`
- `recent_messages`
- `likely_tool`
