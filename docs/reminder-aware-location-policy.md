# Reminder-aware location policy

Last updated: 2026-05-29

## Purpose

Some schedule assignments exist only to remind the team about recurring work. They are valid schedule location groups even when their `included_locations` array is empty. Empty reminder-only groups must not be treated as broken NFC scan mappings.

## Reminder-only schedule locations

The following groups are reminder-only schedule assignments, not NFC scan locations:

- `BAMBOO_GIFT_SHOP`
- `EAST_END_BREAK_ROOM`
- `ELEPHANT_TRUNK_GIFT_SHOP`
- `ELEPHANT_TRUNK_RESTROOMS`
- `NORTH_WEST_PASSAGE_GIFT_SHOP`
- `PRIMATE_CANYON`
- `CAT_COUNTRY`

Reminder-only groups may appear on employee schedules with empty `included_locations`. That is expected because they are classified with `also_valid_empty:true` and should be reported as `OK_REMINDER_ONLY_EMPTY` by reminder-aware audits.

Reminder-only groups must not:

- require NFC scans;
- create dashboard overdue status;
- be reported as missing scan-location mappings;
- be inserted into the NFC `locations` inventory as fake scan locations.

Gift shops are Monday reminder-only assignments. Elephant Trunk Restrooms are employee restrooms in/around Elephant Trunk Gift Shop and are also Monday reminder-only assignments; they are not NFC/dashboard tracked public restrooms.

## Primate Canyon and Cat Country

`PRIMATE_CANYON` includes `CAT_COUNTRY` for weekly evening exterior glass work. Michael handles this work using outdoor Windex and a hose. Because there is no routine scan tracking after 6 PM, this remains reminder-only and must not create overdue scan failures.

## Primate Pavillion

`PRIMATE_PAVILLION` is different from Primate Canyon. It is a real daily NFC scan location, is classified with `also_valid_empty:false`, and should remain dashboard tracked. Preserve the current spelling/key `PRIMATE_PAVILLION`; do not rename it as part of reminder-aware auditing.

Reminder-aware audits should report `PRIMATE_PAVILLION` as:

- `OK_SCAN_TRACKED` when it exists and has mapped NFC scan locations;
- `ERROR_SCAN_TRACKED_EMPTY` when it exists but has empty `included_locations`;
- `ERROR_SCAN_TRACKED_EMPTY` when it is absent from the schedule location groups response.

## No fake seeding

Do not seed gift shops, Elephant Trunk employee restrooms, Primate Canyon, or Cat Country into NFC tracking just to silence audits. If an audit complains about these reminder-only groups, fix the audit classification logic instead of adding fake location rows.

## Hermes policy

Hermes should keep write access for now and should not be changed to observe-only mode by this policy. Hermes must use reminder-aware location logic when auditing so that reminder-only empty groups are OK and missing/empty `PRIMATE_PAVILLION` remains an error.
