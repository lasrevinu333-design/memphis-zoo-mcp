# 2026-06-28 schedule note

Cat Country and Primate Canyon were restored to the normal day scan workflow when they appear in the static schedule.

Supabase changes applied:
- Added a restored-scan lunch splitter function.
- Wrapped the standard lunch function so backend schedule generation calls both lunch passes through the same existing function name.
- Re-enabled the Primate Canyon scan location and group membership.

Reaudit result after changes:
- schedule validator: 0 violations
- owner lunch overlap: 0 rows
- non-assigned status rows in generated window: 0 rows
