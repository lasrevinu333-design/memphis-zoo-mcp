# Existing visitor-count collector

This is the existing desktop nd.memzoo.org visitor-count collector with its obsolete broad admin-key submission replaced by a dedicated visitor-count credential. It does not implement employee timekeeping.

Deploy the reviewed backend and visitor reader migration first. Merge a dedicated random ATTENDANCE_COLLECTOR_TOKEN into the existing backend Render service and this collector's existing private .env; never put the value in Git or an audit packet. The collector token authorizes only POST /collector-api/visitor-attendance. It is not a manager session.

Install this exact file as a recoverable replacement of /home/eric/memphis-zoo-attendance/attendance_pusher.py after comparing and backing up its current bytes. Keep the existing service, profile, SOURCE_URL and REFRESH_SECONDS. Do not create a second collector/browser. Optional ATTENDANCE_PUSH_URL must point to the existing backend collector endpoint. The old ADMIN_API_KEY is no longer used by this program; do not rotate a shared admin credential as part of this repair.

Verify one actual parsed source result, successful POST, matching persisted count and fetched_at, public current-attendance readback, and Home freshness/zero-vs-unavailable display. A test/mock pass is not live-source proof. On failure restore the previous file/config and preserve the original service/profile.

Observation identity includes the exact source instant, including PostgreSQL microseconds. The saved reader selects these timestamps as text; the shared normalizer canonicalizes UTC without discarding fractional digits. Do not replace this with `Date.parse(Date)` or millisecond-only equality. Date-valued callers retain their existing millisecond precision, but cannot invent missing microseconds.

Both the collector and manager path enforce a current observation (no older than one hour or more than 60 seconds ahead), and the shared SQL command enforces the same window using database statement time. A previously poisoned far-future/nonfinite stored version may be replaced by a valid current observation; normal ordering and equal-version semantic replay still apply. This guard does not constrain raw historical backup restoration. Future stored rows are stale and cannot suppress refresh. Newer lower counts and genuine zero remain valid.

The public HTML fallback validates each complete present metric as a bounded PostgreSQL nonnegative integer. Correctly grouped thousands separators are allowed; malformed, fractional, signed, exponential or overflowing values fail the refresh. Missing optional metrics remain null, not zero. A failed refresh may return an existing cache only with stale=true.

Focused proofs: `npm run test:visitor-attendance`, `npm run test:visitor-attendance-db`, and `ATTENDANCE_NO_AUTOMATIC_GRANTS=1 npm run test:visitor-attendance-db`. The database runner uses an existing pinned image, no network/ports, an owned private-parent Unix socket and synthetic data; it closes clients and removes its owned container/socket on completion. The latter mode removes automatic table/sequence defaults throughout clean replay without changing explicit grants or migration bytes. Neither test claims live deployment or independent audit approval.
