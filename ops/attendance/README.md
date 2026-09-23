# Existing visitor-count collector

This is the existing desktop nd.memzoo.org visitor-count collector with its obsolete broad admin-key submission replaced by a dedicated visitor-count credential. It does not implement employee timekeeping.

Deploy the reviewed backend and visitor reader migration first. Merge a dedicated random ATTENDANCE_COLLECTOR_TOKEN into the existing backend Render service and this collector's existing private .env; never put the value in Git or an audit packet. The collector token authorizes only POST /collector-api/visitor-attendance. It is not a manager session.

Install this exact file as a recoverable replacement of /home/eric/memphis-zoo-attendance/attendance_pusher.py after comparing and backing up its current bytes. Keep the existing service, profile, SOURCE_URL and REFRESH_SECONDS. Do not create a second collector/browser. Optional ATTENDANCE_PUSH_URL must point to the existing backend collector endpoint. The old ADMIN_API_KEY is no longer used by this program; do not rotate a shared admin credential as part of this repair.

Verify one actual parsed source result, successful POST, matching persisted count and fetched_at, public current-attendance readback, and Home freshness/zero-vs-unavailable display. A test/mock pass is not live-source proof. On failure restore the previous file/config and preserve the original service/profile.
