-- Only the existing scheduler control-plane role may use the bounded runtime
-- wrapper. It receives no private table or owner-lifecycle privileges.
BEGIN;
GRANT USAGE ON SCHEMA custodial_leadership_private TO static_weekly_control_plane;
GRANT EXECUTE ON FUNCTION custodial_leadership_private.runtime(text,jsonb) TO static_weekly_control_plane;
COMMIT;
