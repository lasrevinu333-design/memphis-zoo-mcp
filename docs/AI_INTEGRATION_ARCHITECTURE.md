# Memphis AI Integration Architecture

## Purpose

Memphis AI should become a reliable operations assistant, not a pile of regex branches wearing a chatbot hat.

The system should answer questions from managers and employees using structured app data first, then use generative AI for explanation, summarization, natural language parsing, and flexible follow-up handling.

## Current direction

`src/memphis-ai.js` is being reduced into smaller modules under `src/ai/`.

The main responder should eventually act as a thin orchestrator:

1. Load device/thread context.
2. Classify the user request.
3. Resolve referenced employees, locations, groups, dates, and time windows.
4. Call the correct deterministic data tool.
5. Use AI only where it improves interpretation, summarization, or fallback conversation.
6. Save updated thread context.
7. Return a response with metadata for debugging.

## Current modules

### Existing schedule and operations modules

- `memphis-ai-utils.js`
- `memphis-ai-intent.js`
- `memphis-ai-weekly.js`
- `memphis-ai-daily.js`
- `memphis-ai-contacts.js`
- `memphis-ai-employee-week.js`
- `memphis-ai-ops-schedule.js`

### Newly split modules

- `memphis-ai-weather.js`
  - Weather intent detection
  - Memphis/default weather location handling
  - Weather API fetch
  - Weather response summary

- `memphis-ai-work-status.js`
  - Employee work status summary
  - Weekday display helper

- `memphis-ai-employee-resolver.js`
  - Name normalization
  - Fuzzy employee scoring
  - Database-backed employee alias resolution
  - Employee name guessing

- `memphis-ai-thread-context.js`
  - Thread context merge
  - Thread context fetch/save
  - Recent message fetch
  - Recent message formatting

## Source of truth rules

### Employee work status

Use database function:

```sql
public.sch_get_employee_work_status(p_service_date date, p_employee_id uuid)
```

This is the source of truth for:

- working assigned
- working unassigned
- off static schedule
- off PTO
- off sick
- callout
- inactive employee

Memphis AI should not guess this from assignments alone.

### Employee name resolution

Use:

```sql
public.sch_resolve_employee_ref(p_text text)
```

Aliases live in:

```sql
public.employee_aliases
```

This allows `Markeisha`, `Keisha`, `Kinny`, and other real-world spellings/nicknames to work without code changes.

### Schedule sanity

Use:

```sql
public.sch_audit_schedule_day(p_service_date date)
```

This checks:

- assigned while absent
- PTO without absence override
- working without assignments
- assigned outside roster/shift
- open segments

## AI use cases to expand

### 1. Intent classification

Replace hard-coded branching with a structured classifier that returns intent names such as:

- `employee_work_status`
- `employee_regular_schedule`
- `absence_pto`
- `area_assignment`
- `coverage_candidate`
- `open_segments`
- `schedule_audit`
- `event_lookup`
- `ticket_lookup`
- `attendance_summary`
- `dashboard_summary`
- `general_conversation`

The classifier can be deterministic first, with Gemini fallback for ambiguous questions.

### 2. Entity extraction

Extract structured references from user text:

- employee reference
- location or group reference
- service date
- weekday
- time window
- ticket/issue terms
- event terms

AI should help when phrasing is messy, but database resolvers should remain the source of truth.

### 3. Explanation and summarization

Use AI to turn structured results into manager-friendly summaries:

- why an area is open
- what changed because of PTO
- what should be fixed first
- which coverage candidate makes sense and why
- concise shift handoff summaries

### 4. Event parsing

The events input console currently has a deterministic parser. It should use AI as a second-pass parser for messy event text, while keeping deterministic validation and warnings.

### 5. Schedule anomaly reasoning

Memphis should be able to answer:

- Why is this schedule weird?
- Who is overloaded?
- Who is assigned outside their shift?
- What happens if Kathy calls out tomorrow?
- What should I fix before opening?

Use `sch_audit_schedule_day` and schedule views as the data base.

## Recommended next code split

1. `memphis-ai-router.js`
   - Intent routing and dispatch.

2. `memphis-ai-tools.js`
   - Tool execution functions currently inside `executeTool()`.

3. `memphis-ai-summarizers.js`
   - Dashboard, ticket, location, assignment, attendance, absence summaries.

4. `memphis-ai-area-resolver.js`
   - Area/group/location resolution helpers.

5. `memphis-ai-gemini.js`
   - Gemini prompt construction, API calls, model config, and fallback handling.

6. `memphis-ai-debug.js`
   - Response metadata and debug traces for manager UI.

## Response metadata target

Each Memphis response should eventually include metadata like:

```json
{
  "intent": "employee_work_status",
  "mode": "local_employee_work_status",
  "service_date": "2026-05-16",
  "employee": "Markiesha Warren",
  "data_source": "sch_get_employee_work_status",
  "fallback": false,
  "warnings": []
}
```

This will make failures visible instead of mysterious.

## Stability rules

- Do not let Gemini invent operational facts.
- Use SQL views/functions for actual system state.
- Keep deterministic fallbacks for critical operations.
- Save thread context only after successful intent resolution where possible.
- Keep modules small enough that GitHub/MCP tooling can patch them safely.
- Prefer adding modules first, then delegating functions one at a time.

## Current status

The split has started. Weather, work-status, employee resolver, and thread context modules exist and are exported. `memphis-ai.js` still contains many wrappers and internal branches, but some of them now delegate to shared modules.

The next safest work is to continue extracting:

- tool execution
- area/location resolution
- summarizers
- Gemini conversation path
