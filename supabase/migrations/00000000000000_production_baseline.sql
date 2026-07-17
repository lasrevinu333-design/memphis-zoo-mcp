-- Sanitized schema-only baseline captured from the deployed Memphis Zoo database.

-- Captured at 2026-07-17T15:47:05.699Z. Contains no table data or credential values.

begin;

set local check_function_bodies = off;

set local client_min_messages = warning;

create schema if not exists public;

create schema if not exists extensions;

create schema if not exists vault;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end
$$;

create extension if not exists "pg_cron" with schema "pg_catalog";

create extension if not exists "pg_net" with schema "public";

create extension if not exists "pg_stat_statements" with schema "extensions";

create extension if not exists "pgcrypto" with schema "extensions";

create extension if not exists "supabase_vault" with schema "vault";

create extension if not exists "uuid-ossp" with schema "extensions";

create table "public"."ai_provider_access_audit" (
  "id" uuid default gen_random_uuid() not null,
  "provider" text not null,
  "purpose" text not null,
  "allowed" boolean not null,
  "input_sha256" text not null,
  "redaction_count" integer default 0 not null,
  "redaction_json" jsonb default '{}'::jsonb not null,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."annie_chat_state" (
  "id" text default 'default'::text not null,
  "history" jsonb default '[]'::jsonb not null,
  "saved_chats" jsonb default '[]'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."annie_contacts" (
  "id" text not null,
  "name" text default ''::text not null,
  "phone" text default ''::text not null,
  "email" text default ''::text not null,
  "notes" text default ''::text not null,
  "source" text default 'manual'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."annie_deliverables" (
  "id" text not null,
  "filename" text not null,
  "content" bytea,
  "mime_type" text default 'application/octet-stream'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."annie_log_notes" (
  "id" text not null,
  "content" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."annie_log_reminders" (
  "id" text not null,
  "content" text not null,
  "due" text default ''::text not null,
  "fingerprint" text default ''::text not null,
  "done" boolean default false not null,
  "done_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."annie_log_suggested_reminders" (
  "id" text not null,
  "content" text not null,
  "due" text default ''::text not null,
  "fingerprint" text default ''::text not null,
  "status" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."annie_suggested_contacts" (
  "id" text not null,
  "name" text default ''::text not null,
  "phone" text default ''::text not null,
  "email" text default ''::text not null,
  "notes" text default ''::text not null,
  "status" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."completion_responses" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "location_id" uuid not null,
  "submitted_by_employee_id" uuid,
  "device_id" uuid,
  "response_json" jsonb default '{}'::jsonb not null,
  "submitted_at" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now() not null,
  "client_completion_id" text
);

create table "public"."coverage_templates" (
  "id" uuid default gen_random_uuid() not null,
  "location_group_id" uuid not null,
  "day_of_week" integer not null,
  "segment_number" integer default 1 not null,
  "assigned_employee_id" uuid,
  "owner_type" text default 'EMPLOYEE'::text not null,
  "coverage_start" time without time zone not null,
  "coverage_end" time without time zone not null,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "coverage_purpose" text default 'area_owner'::text not null
);

create table "public"."current_attendance_state" (
  "id" integer default 1 not null,
  "attendance" integer,
  "last_year" integer,
  "planned" integer,
  "yesterday" integer,
  "yesterday_plan" integer,
  "source" text,
  "fetched_at" timestamp with time zone,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."daily_absence_overrides" (
  "id" uuid default gen_random_uuid() not null,
  "absence_date" date not null,
  "employee_id" uuid not null,
  "absence_type" text default 'callout'::text not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."daily_group_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "assignment_date" date not null,
  "location_group_id" uuid not null,
  "assigned_employee_id" uuid,
  "derived_from_employee_id" uuid,
  "assignment_type" text not null,
  "reason_code" text,
  "coverage_start" time without time zone not null,
  "coverage_end" time without time zone not null,
  "is_coverall" boolean default false not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."daily_schedule_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "service_date" date not null,
  "location_group_id" uuid not null,
  "segment_number" integer default 1 not null,
  "assigned_employee_id" uuid,
  "owner_type" text default 'EMPLOYEE'::text not null,
  "coverage_start" time without time zone not null,
  "coverage_end" time without time zone not null,
  "status" text default 'ASSIGNED'::text not null,
  "load_points" numeric(10,2) default 0 not null,
  "notes" text,
  "source_type" text default 'generated'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "coverage_purpose" text default 'area_owner'::text not null
);

create table "public"."daily_work_roster" (
  "id" uuid default gen_random_uuid() not null,
  "service_date" date not null,
  "employee_id" uuid not null,
  "shift_start" time without time zone not null,
  "shift_end" time without time zone not null,
  "source_type" text default 'template'::text not null,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."demo_scan_mock_runs" (
  "id" uuid default gen_random_uuid() not null,
  "status" text default 'active'::text not null,
  "started_at" timestamp with time zone default now() not null,
  "stopped_at" timestamp with time zone,
  "last_advanced_at" timestamp with time zone,
  "employee_count" integer default 0 not null,
  "cycle_number" integer default 0 not null,
  "notes" text,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."device_aliases" (
  "alias_identifier" text not null,
  "canonical_device_id" uuid not null,
  "active" boolean default true not null,
  "source" text default 'migration'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."device_auth_credentials" (
  "credential_id" uuid not null,
  "device_id" uuid not null,
  "token_hash" text not null,
  "device_label" text,
  "user_agent_hash" text,
  "created_ip_hash" text,
  "last_user_agent_hash" text,
  "last_ip_hash" text,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "confirmed_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone not null,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text
);

create table "public"."device_auth_enrollment_codes" (
  "enrollment_id" uuid default gen_random_uuid() not null,
  "device_id" uuid not null,
  "code_hash" text not null,
  "created_by" text not null,
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone not null,
  "consumed_at" timestamp with time zone,
  "consumed_by_credential_id" uuid,
  "revoked_at" timestamp with time zone,
  "failed_attempts" integer default 0 not null,
  "last_failed_at" timestamp with time zone,
  "metadata_json" jsonb default '{}'::jsonb not null
);

create table "public"."device_auth_events" (
  "id" uuid default gen_random_uuid() not null,
  "device_id" uuid,
  "credential_id" uuid,
  "event_type" text not null,
  "success" boolean not null,
  "reason" text,
  "presented_identifier" text,
  "ip_hash" text,
  "user_agent_hash" text,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."device_auth_policy" (
  "singleton" boolean default true not null,
  "mode" text default 'enroll'::text not null,
  "updated_by" text default 'foundation_migration'::text not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."device_location_proximity_status" (
  "device_id" uuid not null,
  "location_id" uuid not null,
  "session_uuid" text default ''::text not null,
  "presented_identifier" text,
  "result" text not null,
  "badge_color" text not null,
  "distance_m" numeric,
  "allowed_radius_m" numeric not null,
  "accuracy_m" numeric,
  "client_latitude" numeric,
  "client_longitude" numeric,
  "target_latitude" numeric,
  "target_longitude" numeric,
  "coordinate_source" text,
  "evaluated_at" timestamp with time zone default now() not null,
  "correlation_id" text,
  "metadata_json" jsonb default '{}'::jsonb not null
);

create table "public"."device_notification_acknowledgements" (
  "id" uuid default gen_random_uuid() not null,
  "device_identifier" text not null,
  "notification_key" text not null,
  "notification_type" text default 'notification'::text not null,
  "displayed_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "opened_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."device_sync_status" (
  "device_id" uuid not null,
  "presented_identifier" text,
  "queue_count" integer default 0 not null,
  "oldest_item_at" timestamp with time zone,
  "retry_count" integer default 0 not null,
  "last_server_ack_at" timestamp with time zone,
  "frontend_version" text,
  "last_error" text,
  "correlation_id" text,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."devices" (
  "id" uuid default gen_random_uuid() not null,
  "device_id" text not null,
  "device_name" text not null,
  "active" boolean default true not null,
  "assigned_employee_id" uuid,
  "notes" text,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_aliases" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "alias_text" text not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_area_familiarity" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "location_group_id" uuid not null,
  "familiarity_score" integer default 5 not null,
  "is_primary" boolean default false not null,
  "is_backup" boolean default false not null,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_area_preferences" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "location_group_id" uuid not null,
  "preference_type" text not null,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_backup_group_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "location_group_id" uuid not null,
  "backup_priority" integer default 1 not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_group_proximity" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "location_group_id" uuid not null,
  "proximity_score" integer default 3 not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_location_group_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "location_group_id" uuid not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_planned_time_off" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "start_date" date not null,
  "end_date" date not null,
  "pto_type" text default 'PTO'::text not null,
  "source" text default 'import'::text not null,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_primary_group_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "location_group_id" uuid not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_pto" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "start_date" date not null,
  "end_date" date not null,
  "absence_type" text default 'pto'::text not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employee_shift_overrides" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "shift_date" date not null,
  "shift_start" time without time zone not null,
  "shift_end" time without time zone not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "lunch_start" time without time zone,
  "lunch_end" time without time zone,
  "color_hex" text
);

create table "public"."employee_shift_templates" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "day_of_week" integer not null,
  "shift_start" time without time zone not null,
  "shift_end" time without time zone not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "lunch_start" time without time zone,
  "lunch_end" time without time zone,
  "color_hex" text
);

create table "public"."employee_zone_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid not null,
  "zone_id" uuid not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."employees" (
  "id" uuid default gen_random_uuid() not null,
  "employee_code" text,
  "display_name" text not null,
  "active" boolean default true not null,
  "role" text default 'staff'::text not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."event_area_aliases" (
  "id" uuid default gen_random_uuid() not null,
  "location_group_id" uuid not null,
  "alias_text" text not null,
  "normalized_alias" text generated always as (lower(regexp_replace(alias_text, '[^a-zA-Z0-9]+'::text, ' '::text, 'g'::text))) stored,
  "confidence_weight" integer default 100 not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."events_app_events" (
  "id" uuid default gen_random_uuid() not null,
  "event_name" text not null,
  "location_group_id" uuid not null,
  "event_date" date not null,
  "start_time" time without time zone not null,
  "end_time" time without time zone,
  "attendee_count" integer,
  "notes" text,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "end_date" date not null
);

create table "public"."events_app_notification_log" (
  "id" uuid default gen_random_uuid() not null,
  "event_id" uuid not null,
  "employee_id" uuid not null,
  "msg_user_id" uuid,
  "thread_id" uuid,
  "notification_kind" text not null,
  "scheduled_for_local" timestamp without time zone not null,
  "sent_at" timestamp with time zone default now() not null,
  "status" text default 'sent'::text not null,
  "response_message_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."foundation_removal_archive" (
  "archive_id" uuid default gen_random_uuid() not null,
  "removal_batch" text not null,
  "source_table" text not null,
  "source_id" text,
  "row_json" jsonb not null,
  "archived_at" timestamp with time zone default now() not null,
  "archived_by" text default 'approved_foundation_repair'::text not null
);

create table "public"."guest_cleanliness_reports" (
  "id" uuid default gen_random_uuid() not null,
  "location_code" text not null,
  "location_name" text,
  "issue_type" text not null,
  "severity" text not null,
  "notes" text,
  "status" text default 'open'::text not null,
  "source" text default 'guest_qr'::text not null,
  "submitted_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone,
  "notification_status" text default 'pending'::text not null,
  "notified_employee_user_id" uuid,
  "notified_ops_count" integer default 0 not null,
  "metadata_json" jsonb default '{}'::jsonb not null
);

create table "public"."internal_ops_contacts" (
  "id" uuid default gen_random_uuid() not null,
  "display_name" text not null,
  "role_title" text not null,
  "department" text,
  "phone" text,
  "notes" text,
  "active" boolean default true not null,
  "sort_order" integer default 100 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."legacy_application_write_rollups" (
  "operation_family" text not null,
  "source_row_count" bigint not null,
  "statement_count" bigint not null,
  "total_sql_bytes" bigint not null,
  "latest_sql_sha256" text,
  "first_applied_at" timestamp with time zone not null,
  "last_applied_at" timestamp with time zone not null,
  "last_applied_by" text,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_coverage_templates" (
  "id" uuid default gen_random_uuid() not null,
  "location_id" uuid not null,
  "day_of_week" integer not null,
  "segment_number" integer default 1 not null,
  "assigned_employee_id" uuid,
  "owner_type" text default 'EMPLOYEE'::text not null,
  "coverage_start" time without time zone not null,
  "coverage_end" time without time zone not null,
  "coverage_purpose" text default 'area_owner'::text not null,
  "source_location_group_id" uuid,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_group_adjacency" (
  "id" uuid default gen_random_uuid() not null,
  "from_location_group_id" uuid not null,
  "to_location_group_id" uuid not null,
  "proximity_score" integer default 5 not null,
  "walking_minutes" integer,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_group_aliases" (
  "id" uuid default gen_random_uuid() not null,
  "location_group_id" uuid not null,
  "alias_text" text not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_group_memberships" (
  "id" uuid default gen_random_uuid() not null,
  "location_id" uuid not null,
  "location_group_id" uuid not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_group_proximity_settings" (
  "id" uuid default gen_random_uuid() not null,
  "location_group_id" uuid not null,
  "working_cluster" text not null,
  "route_x" numeric not null,
  "route_y" numeric not null,
  "cluster_weight_multiplier" numeric default 1.0 not null,
  "isolation_penalty_points" numeric default 0 not null,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "latitude" numeric,
  "longitude" numeric,
  "coordinate_source" text,
  "coordinate_confidence" text
);

create table "public"."location_group_scoring" (
  "id" uuid default gen_random_uuid() not null,
  "location_group_id" uuid not null,
  "difficulty_rating" integer default 3 not null,
  "importance_rating" integer default 3 not null,
  "estimated_minutes" integer default 30 not null,
  "cleaning_priority" integer default 3 not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_group_workload_settings" (
  "id" uuid default gen_random_uuid() not null,
  "location_group_id" uuid not null,
  "manual_load_points" numeric,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_group_zone_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "location_group_id" uuid not null,
  "zone_id" uuid not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_groups" (
  "id" uuid default gen_random_uuid() not null,
  "group_code" text not null,
  "group_name" text not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_proximity_settings" (
  "id" uuid default gen_random_uuid() not null,
  "location_id" uuid not null,
  "latitude" numeric,
  "longitude" numeric,
  "coordinate_source" text,
  "coordinate_confidence" text,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."location_zone_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "location_id" uuid not null,
  "zone_id" uuid not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."locations" (
  "id" uuid default gen_random_uuid() not null,
  "location_code" text not null,
  "location_name" text not null,
  "location_type" text not null,
  "active" boolean default true not null,
  "sort_order" integer,
  "nfc_url" text,
  "form_type" text,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "scan_router_url" text,
  "form_url" text,
  "difficulty_rating" integer,
  "priority_rating" integer,
  "workload_notes" text
);

create table "public"."maintenance_tickets" (
  "id" uuid default gen_random_uuid() not null,
  "completion_response_id" uuid,
  "session_id" uuid,
  "location_id" uuid,
  "reported_by_employee_id" uuid,
  "device_id" uuid,
  "issue_source" text default 'completion_form'::text not null,
  "status" text default 'open'::text not null,
  "issue_summary" text not null,
  "issue_category" text,
  "fixture_type" text,
  "fixture_identifier" text,
  "out_of_order" boolean default false not null,
  "issue_payload" jsonb default '{}'::jsonb not null,
  "location_code_snapshot" text,
  "location_name_snapshot" text,
  "reporter_name_snapshot" text,
  "reported_at" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now() not null,
  "closed_at" timestamp with time zone,
  "closed_by" text,
  "close_notes" text,
  "closed_via" text
);

create table "public"."migration_log" (
  "id" uuid default gen_random_uuid() not null,
  "migration_name" text not null,
  "sql_text" text not null,
  "applied_at" timestamp with time zone default now() not null,
  "applied_by" text,
  "notes" text
);

create table "public"."migration_log_summary" (
  "migration_name" text not null,
  "statement_count" bigint default 0 not null,
  "total_sql_bytes" bigint default 0 not null,
  "latest_sql_sha256" text not null,
  "first_applied_at" timestamp with time zone,
  "last_applied_at" timestamp with time zone,
  "last_applied_by" text,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."moxie_access_audit" (
  "id" uuid default gen_random_uuid() not null,
  "action" text not null,
  "actor_identity" text default 'moxie'::text not null,
  "data_domain" text not null,
  "access_mode" text not null,
  "details_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."moxie_auth_credentials" (
  "credential_key" text not null,
  "password_salt" text not null,
  "password_hash" text not null,
  "password_version" integer default 1 not null,
  "updated_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."msg_broadcast_recipients" (
  "id" uuid default gen_random_uuid() not null,
  "broadcast_id" uuid not null,
  "user_id" uuid not null,
  "delivered_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "displayed_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone
);

create table "public"."msg_broadcasts" (
  "id" uuid default gen_random_uuid() not null,
  "thread_id" uuid,
  "created_by_user_id" uuid not null,
  "title" text,
  "body" text not null,
  "target_type" text default 'all_hands'::text not null,
  "target_json" jsonb default '{}'::jsonb not null,
  "sent_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."msg_device_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "device_identifier" text not null,
  "msg_user_id" uuid not null,
  "is_active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."msg_hidden_threads_by_device" (
  "id" uuid default gen_random_uuid() not null,
  "thread_id" uuid not null,
  "device_identifier" text not null,
  "hidden_at" timestamp with time zone default now() not null
);

create table "public"."msg_memphis_thread_context" (
  "thread_id" uuid not null,
  "last_intent" text,
  "last_employee_name" text,
  "last_group_name" text,
  "last_location_code" text,
  "last_service_date" date,
  "last_subject_type" text,
  "context_json" jsonb default '{}'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."msg_message_deletions" (
  "id" uuid default gen_random_uuid() not null,
  "message_id" uuid not null,
  "user_id" uuid not null,
  "deleted_at" timestamp with time zone default now() not null
);

create table "public"."msg_messages" (
  "id" uuid default gen_random_uuid() not null,
  "thread_id" uuid not null,
  "sender_user_id" uuid not null,
  "message_type" text default 'text'::text not null,
  "body" text not null,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "sent_at" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now() not null,
  "is_deleted" boolean default false not null,
  "client_message_id" text
);

create table "public"."msg_receipts" (
  "id" uuid default gen_random_uuid() not null,
  "message_id" uuid not null,
  "user_id" uuid not null,
  "delivered_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "displayed_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "queued_at" timestamp with time zone default now(),
  "delivery_device_identifier" text,
  "last_delivery_attempt_at" timestamp with time zone,
  "delivery_attempts" integer default 0 not null
);

create table "public"."msg_thread_participants" (
  "id" uuid default gen_random_uuid() not null,
  "thread_id" uuid not null,
  "user_id" uuid not null,
  "joined_at" timestamp with time zone default now() not null,
  "left_at" timestamp with time zone
);

create table "public"."msg_thread_visibility" (
  "id" uuid default gen_random_uuid() not null,
  "thread_id" uuid not null,
  "user_id" uuid not null,
  "device_identifier" text,
  "hidden_before" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."msg_threads" (
  "id" uuid default gen_random_uuid() not null,
  "thread_type" text not null,
  "title" text,
  "created_by_user_id" uuid not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "last_message_at" timestamp with time zone
);

create table "public"."msg_users" (
  "id" uuid default gen_random_uuid() not null,
  "employee_id" uuid,
  "display_name" text not null,
  "role" text not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "user_id" uuid generated always as (id) stored,
  "active" boolean generated always as (is_active) stored
);

create table "public"."operating_hours" (
  "id" uuid default gen_random_uuid() not null,
  "operating_date" date not null,
  "opening_time" time without time zone,
  "closing_time" time without time zone not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."ops_manager_auth_events" (
  "id" uuid default gen_random_uuid() not null,
  "credential_id" uuid,
  "device_id" text,
  "event_type" text not null,
  "success" boolean not null,
  "ip_hash" text,
  "user_agent_hash" text,
  "detail_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."ops_manager_trusted_devices" (
  "credential_id" uuid not null,
  "device_id" text not null,
  "device_label" text not null,
  "token_hash" text not null,
  "max_access_level" text default 'full_access'::text not null,
  "user_agent_hash" text,
  "created_ip_hash" text,
  "last_user_agent_hash" text,
  "last_ip_hash" text,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone not null,
  "revoked_at" timestamp with time zone,
  "revoked_reason" text
);

create table "public"."ops_manager_weekly_schedules" (
  "id" uuid default gen_random_uuid() not null,
  "contact_id" uuid,
  "display_name" text not null,
  "day_of_week" integer not null,
  "shift_start" time without time zone not null,
  "shift_end" time without time zone not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."release_deployment_manifest" (
  "release_id" text not null,
  "backend_commit" text not null,
  "frontend_commit" text not null,
  "migration_head" text not null,
  "migration_manifest_sha256" text not null,
  "environment_contract_version" text not null,
  "status" text default 'validated'::text not null,
  "details_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "deployed_at" timestamp with time zone
);

create table "public"."release_validation_runs" (
  "id" uuid default gen_random_uuid() not null,
  "release_id" text not null,
  "area" text not null,
  "status" text not null,
  "details_json" jsonb default '{}'::jsonb not null,
  "validated_at" timestamp with time zone default now() not null
);

create table "public"."scan_alert_notification_log" (
  "id" uuid default gen_random_uuid() not null,
  "location_id" uuid,
  "location_code" text not null,
  "location_name" text,
  "alert_type" text not null,
  "status_bucket" text not null,
  "assigned_employee_id" uuid,
  "msg_user_id" uuid,
  "msg_device_identifier" text,
  "coverage_purpose" text,
  "alert_message" text not null,
  "msg_thread_id" uuid,
  "msg_message_id" uuid,
  "alert_context" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "cleared_at" timestamp with time zone,
  "active" boolean default true not null,
  "escalated_at" timestamp with time zone,
  "escalation_msg_user_id" uuid,
  "escalation_msg_device_identifier" text,
  "escalation_msg_thread_id" uuid,
  "escalation_msg_message_id" uuid,
  "escalation_message" text
);

create table "public"."scan_events" (
  "id" uuid default gen_random_uuid() not null,
  "scanned_at" timestamp with time zone default now() not null,
  "location_id" uuid,
  "location_code" text,
  "device_id" uuid,
  "device_identifier" text,
  "session_id" uuid,
  "event_type" text not null,
  "result" text,
  "notes" text,
  "payload_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "client_event_id" text
);

create table "public"."schedule_assignment_archive" (
  "archive_id" uuid default gen_random_uuid() not null,
  "assignment_id" uuid,
  "service_date" date,
  "assignment_json" jsonb not null,
  "archive_reason" text not null,
  "archived_at" timestamp with time zone default now() not null
);

create table "public"."schedule_automation_runs" (
  "automation_key" text not null,
  "service_date" date not null,
  "status" text default 'completed'::text not null,
  "result_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."schedule_candidate_scores" (
  "id" uuid default gen_random_uuid() not null,
  "run_id" uuid not null,
  "work_item_id" uuid not null,
  "employee_id" uuid not null,
  "eligible" boolean default false not null,
  "hard_reject_reasons" text[] default ARRAY[]::text[] not null,
  "proximity_score" numeric default 0 not null,
  "route_fit_score" numeric default 0 not null,
  "workload_score" numeric default 0 not null,
  "total_score" numeric default 0 not null,
  "explanation" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."schedule_generation_runs" (
  "id" uuid default gen_random_uuid() not null,
  "service_date" date not null,
  "generator_version" text default 'sch2-preview-2026-06-11'::text not null,
  "input_hash" text not null,
  "status" text default 'building'::text not null,
  "mode" text default 'preview'::text not null,
  "force" boolean default false not null,
  "hard_violation_count" integer default 0 not null,
  "open_required_count" integer default 0 not null,
  "score_total" numeric default 0 not null,
  "audit_summary" jsonb default '{}'::jsonb not null,
  "diff_summary" jsonb default '{}'::jsonb not null,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "published_at" timestamp with time zone,
  "published_by" text
);

create table "public"."schedule_manual_locks" (
  "id" uuid default gen_random_uuid() not null,
  "service_date" date not null,
  "location_group_id" uuid not null,
  "segment_number" integer default 1 not null,
  "coverage_start" time without time zone,
  "coverage_end" time without time zone,
  "coverage_purpose" text,
  "assigned_employee_id" uuid,
  "reason" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."schedule_operational_notes" (
  "rule_code" text not null,
  "category" text not null,
  "rule_text" text not null,
  "enforcement_target" text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."schedule_publish_audit" (
  "id" uuid default gen_random_uuid() not null,
  "run_id" uuid not null,
  "service_date" date not null,
  "previous_rows" jsonb default '[]'::jsonb not null,
  "published_rows" jsonb default '[]'::jsonb not null,
  "diff_summary" jsonb default '{}'::jsonb not null,
  "published_by" text,
  "status" text default 'dry_run'::text not null,
  "error_message" text,
  "published_at" timestamp with time zone default now() not null,
  "rolled_back_at" timestamp with time zone,
  "rollback_rows" jsonb default '[]'::jsonb not null
);

create table "public"."schedule_solution_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "run_id" uuid not null,
  "work_item_id" uuid not null,
  "service_date" date not null,
  "location_group_id" uuid not null,
  "segment_number" integer default 1 not null,
  "assigned_employee_id" uuid,
  "owner_type" text default 'OPEN'::text not null,
  "coverage_start" time without time zone not null,
  "coverage_end" time without time zone not null,
  "coverage_purpose" text default 'area_owner'::text not null,
  "status" text default 'OPEN'::text not null,
  "source_type" text default 'sch2_preview'::text not null,
  "source_daily_assignment_id" uuid,
  "load_points" numeric default 0 not null,
  "assignment_reason" text,
  "score_total" numeric default 0 not null,
  "score_breakdown" jsonb default '{}'::jsonb not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."schedule_work_items" (
  "id" uuid default gen_random_uuid() not null,
  "run_id" uuid not null,
  "service_date" date not null,
  "work_item_key" text not null,
  "source_daily_assignment_id" uuid,
  "location_group_id" uuid not null,
  "segment_number" integer default 1 not null,
  "coverage_start" time without time zone not null,
  "coverage_end" time without time zone not null,
  "coverage_purpose" text default 'area_owner'::text not null,
  "required" boolean default true not null,
  "may_be_open" boolean default false not null,
  "scan_required" boolean default true not null,
  "is_public_restroom" boolean default false not null,
  "route_zone" text,
  "bundle_key" text,
  "load_points" numeric default 0 not null,
  "original_assigned_employee_id" uuid,
  "original_owner_type" text,
  "original_status" text,
  "original_source_type" text,
  "notes" text,
  "hard_rule_tags" text[] default ARRAY[]::text[] not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."scheduler_scoring_settings" (
  "id" uuid default gen_random_uuid() not null,
  "setting_code" text not null,
  "proximity_weight" numeric default 0.50 not null,
  "difficulty_weight" numeric default 0.25 not null,
  "priority_weight" numeric default 0.25 not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."session_events" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "event_type" text not null,
  "actor_type" text not null,
  "actor_ref" text,
  "details_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."sessions" (
  "id" uuid default gen_random_uuid() not null,
  "session_uuid" text not null,
  "location_id" uuid not null,
  "employee_id" uuid not null,
  "device_id" uuid not null,
  "status" text default 'active'::text not null,
  "started_at" timestamp with time zone default now() not null,
  "ended_at" timestamp with time zone,
  "duration_minutes" integer,
  "duration_display" text,
  "completion_source" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "client_session_id" text
);

create table "public"."system_feedback_items" (
  "id" uuid default gen_random_uuid() not null,
  "category" text default 'other'::text not null,
  "priority" text default 'normal'::text not null,
  "message" text not null,
  "submitted_by" text,
  "hub_context" text default 'unknown'::text not null,
  "device_id" text,
  "page_url" text,
  "status" text default 'new'::text not null,
  "summary" text,
  "notification_status" text default 'pending'::text not null,
  "notified_ops_count" integer default 0 not null,
  "metadata_json" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "last_feedback_reminder_at" timestamp with time zone,
  "feedback_reminder_count" integer default 0 not null,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by" text
);

create table "public"."system_logs" (
  "id" uuid default gen_random_uuid() not null,
  "level" text not null,
  "source" text not null,
  "message" text not null,
  "session_id" uuid,
  "location_id" uuid,
  "device_id" uuid,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."system_settings" (
  "setting_key" text not null,
  "setting_value" jsonb not null,
  "description" text,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."working_cluster_adjacency" (
  "id" uuid default gen_random_uuid() not null,
  "from_cluster" text not null,
  "to_cluster" text not null,
  "adjacency_level" integer not null,
  "notes" text,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."zones" (
  "id" uuid default gen_random_uuid() not null,
  "zone_code" text not null,
  "zone_name" text not null,
  "active" boolean default true not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

alter table only "public"."ai_provider_access_audit" add constraint "ai_provider_access_audit_pkey" PRIMARY KEY (id);

alter table only "public"."annie_chat_state" add constraint "annie_chat_state_pkey" PRIMARY KEY (id);

alter table only "public"."annie_contacts" add constraint "annie_contacts_pkey" PRIMARY KEY (id);

alter table only "public"."annie_deliverables" add constraint "annie_deliverables_pkey" PRIMARY KEY (id);

alter table only "public"."annie_log_notes" add constraint "annie_log_notes_pkey" PRIMARY KEY (id);

alter table only "public"."annie_log_reminders" add constraint "annie_log_reminders_pkey" PRIMARY KEY (id);

alter table only "public"."annie_log_suggested_reminders" add constraint "annie_log_suggested_reminders_pkey" PRIMARY KEY (id);

alter table only "public"."annie_suggested_contacts" add constraint "annie_suggested_contacts_pkey" PRIMARY KEY (id);

alter table only "public"."completion_responses" add constraint "completion_responses_pkey" PRIMARY KEY (id);

alter table only "public"."completion_responses" add constraint "completion_responses_session_id_key" UNIQUE (session_id);

alter table only "public"."coverage_templates" add constraint "coverage_templates_location_group_id_day_of_week_segment_nu_key" UNIQUE (location_group_id, day_of_week, segment_number);

alter table only "public"."coverage_templates" add constraint "coverage_templates_pkey" PRIMARY KEY (id);

alter table only "public"."current_attendance_state" add constraint "current_attendance_state_pkey" PRIMARY KEY (id);

alter table only "public"."daily_absence_overrides" add constraint "daily_absence_overrides_pkey" PRIMARY KEY (id);

alter table only "public"."daily_absence_overrides" add constraint "uq_daily_absence_override" UNIQUE (absence_date, employee_id);

alter table only "public"."daily_group_assignments" add constraint "daily_group_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."daily_schedule_assignments" add constraint "daily_schedule_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."daily_schedule_assignments" add constraint "daily_schedule_assignments_service_date_location_group_id_s_key" UNIQUE (service_date, location_group_id, segment_number);

alter table only "public"."daily_work_roster" add constraint "daily_work_roster_pkey" PRIMARY KEY (id);

alter table only "public"."daily_work_roster" add constraint "daily_work_roster_service_date_employee_id_key" UNIQUE (service_date, employee_id);

alter table only "public"."demo_scan_mock_runs" add constraint "demo_scan_mock_runs_pkey" PRIMARY KEY (id);

alter table only "public"."device_aliases" add constraint "device_aliases_pkey" PRIMARY KEY (alias_identifier);

alter table only "public"."device_auth_credentials" add constraint "device_auth_credentials_pkey" PRIMARY KEY (credential_id);

alter table only "public"."device_auth_credentials" add constraint "device_auth_credentials_token_hash_key" UNIQUE (token_hash);

alter table only "public"."device_auth_enrollment_codes" add constraint "device_auth_enrollment_codes_pkey" PRIMARY KEY (enrollment_id);

alter table only "public"."device_auth_events" add constraint "device_auth_events_pkey" PRIMARY KEY (id);

alter table only "public"."device_auth_policy" add constraint "device_auth_policy_pkey" PRIMARY KEY (singleton);

alter table only "public"."device_location_proximity_status" add constraint "device_location_proximity_status_pkey" PRIMARY KEY (device_id, location_id, session_uuid);

alter table only "public"."device_notification_acknowledgements" add constraint "device_notification_ack_unique" UNIQUE (device_identifier, notification_key);

alter table only "public"."device_notification_acknowledgements" add constraint "device_notification_acknowledgements_pkey" PRIMARY KEY (id);

alter table only "public"."device_sync_status" add constraint "device_sync_status_pkey" PRIMARY KEY (device_id);

alter table only "public"."devices" add constraint "devices_device_id_key" UNIQUE (device_id);

alter table only "public"."devices" add constraint "devices_pkey" PRIMARY KEY (id);

alter table only "public"."employee_aliases" add constraint "employee_aliases_pkey" PRIMARY KEY (id);

alter table only "public"."employee_area_familiarity" add constraint "employee_area_familiarity_pkey" PRIMARY KEY (id);

alter table only "public"."employee_area_familiarity" add constraint "employee_area_familiarity_unique" UNIQUE (employee_id, location_group_id);

alter table only "public"."employee_area_preferences" add constraint "employee_area_preferences_pkey" PRIMARY KEY (id);

alter table only "public"."employee_area_preferences" add constraint "employee_area_preferences_unique" UNIQUE (employee_id, location_group_id, preference_type);

alter table only "public"."employee_backup_group_assignments" add constraint "employee_backup_group_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."employee_backup_group_assignments" add constraint "uq_employee_backup_group" UNIQUE (employee_id, location_group_id, backup_priority);

alter table only "public"."employee_group_proximity" add constraint "employee_group_proximity_pkey" PRIMARY KEY (id);

alter table only "public"."employee_group_proximity" add constraint "uq_employee_group_proximity" UNIQUE (employee_id, location_group_id);

alter table only "public"."employee_location_group_assignments" add constraint "employee_location_group_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."employee_location_group_assignments" add constraint "uq_employee_location_group_assignment" UNIQUE (employee_id);

alter table only "public"."employee_planned_time_off" add constraint "employee_planned_time_off_pkey" PRIMARY KEY (id);

alter table only "public"."employee_planned_time_off" add constraint "employee_planned_time_off_unique" UNIQUE (employee_id, start_date, end_date, pto_type, source);

alter table only "public"."employee_primary_group_assignments" add constraint "employee_primary_group_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."employee_primary_group_assignments" add constraint "uq_employee_primary_group" UNIQUE (location_group_id);

alter table only "public"."employee_pto" add constraint "employee_pto_pkey" PRIMARY KEY (id);

alter table only "public"."employee_shift_overrides" add constraint "employee_shift_overrides_pkey" PRIMARY KEY (id);

alter table only "public"."employee_shift_overrides" add constraint "uq_employee_shift_override" UNIQUE (employee_id, shift_date);

alter table only "public"."employee_shift_templates" add constraint "employee_shift_templates_pkey" PRIMARY KEY (id);

alter table only "public"."employee_shift_templates" add constraint "uq_employee_shift_template" UNIQUE (employee_id, day_of_week);

alter table only "public"."employee_zone_assignments" add constraint "employee_zone_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."employee_zone_assignments" add constraint "uq_employee_zone_assignment" UNIQUE (employee_id);

alter table only "public"."employees" add constraint "employees_employee_code_key" UNIQUE (employee_code);

alter table only "public"."employees" add constraint "employees_pkey" PRIMARY KEY (id);

alter table only "public"."event_area_aliases" add constraint "event_area_aliases_location_group_id_normalized_alias_key" UNIQUE (location_group_id, normalized_alias);

alter table only "public"."event_area_aliases" add constraint "event_area_aliases_pkey" PRIMARY KEY (id);

alter table only "public"."events_app_events" add constraint "events_app_events_pkey" PRIMARY KEY (id);

alter table only "public"."events_app_notification_log" add constraint "events_app_notification_log_pkey" PRIMARY KEY (id);

alter table only "public"."foundation_removal_archive" add constraint "foundation_removal_archive_pkey" PRIMARY KEY (archive_id);

alter table only "public"."guest_cleanliness_reports" add constraint "guest_cleanliness_reports_pkey" PRIMARY KEY (id);

alter table only "public"."internal_ops_contacts" add constraint "internal_ops_contacts_display_name_key" UNIQUE (display_name);

alter table only "public"."internal_ops_contacts" add constraint "internal_ops_contacts_pkey" PRIMARY KEY (id);

alter table only "public"."legacy_application_write_rollups" add constraint "legacy_application_write_rollups_pkey" PRIMARY KEY (operation_family);

alter table only "public"."location_coverage_templates" add constraint "location_coverage_templates_pkey" PRIMARY KEY (id);

alter table only "public"."location_coverage_templates" add constraint "uq_location_coverage_template" UNIQUE (location_id, day_of_week, segment_number);

alter table only "public"."location_group_adjacency" add constraint "location_group_adjacency_pkey" PRIMARY KEY (id);

alter table only "public"."location_group_adjacency" add constraint "location_group_adjacency_unique" UNIQUE (from_location_group_id, to_location_group_id);

alter table only "public"."location_group_aliases" add constraint "location_group_aliases_location_group_id_alias_text_key" UNIQUE (location_group_id, alias_text);

alter table only "public"."location_group_aliases" add constraint "location_group_aliases_pkey" PRIMARY KEY (id);

alter table only "public"."location_group_memberships" add constraint "location_group_memberships_pkey" PRIMARY KEY (id);

alter table only "public"."location_group_memberships" add constraint "uq_location_group_membership" UNIQUE (location_id);

alter table only "public"."location_group_proximity_settings" add constraint "location_group_proximity_settings_pkey" PRIMARY KEY (id);

alter table only "public"."location_group_proximity_settings" add constraint "uq_location_group_proximity_settings" UNIQUE (location_group_id);

alter table only "public"."location_group_scoring" add constraint "location_group_scoring_location_group_id_key" UNIQUE (location_group_id);

alter table only "public"."location_group_scoring" add constraint "location_group_scoring_pkey" PRIMARY KEY (id);

alter table only "public"."location_group_workload_settings" add constraint "location_group_workload_settings_pkey" PRIMARY KEY (id);

alter table only "public"."location_group_workload_settings" add constraint "uq_location_group_workload_settings" UNIQUE (location_group_id);

alter table only "public"."location_group_zone_assignments" add constraint "location_group_zone_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."location_group_zone_assignments" add constraint "uq_location_group_zone_assignment" UNIQUE (location_group_id);

alter table only "public"."location_groups" add constraint "location_groups_group_code_key" UNIQUE (group_code);

alter table only "public"."location_groups" add constraint "location_groups_pkey" PRIMARY KEY (id);

alter table only "public"."location_proximity_settings" add constraint "location_proximity_settings_pkey" PRIMARY KEY (id);

alter table only "public"."location_proximity_settings" add constraint "uq_location_proximity_settings" UNIQUE (location_id);

alter table only "public"."location_zone_assignments" add constraint "location_zone_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."location_zone_assignments" add constraint "uq_location_zone_assignment" UNIQUE (location_id);

alter table only "public"."locations" add constraint "locations_location_code_key" UNIQUE (location_code);

alter table only "public"."locations" add constraint "locations_pkey" PRIMARY KEY (id);

alter table only "public"."maintenance_tickets" add constraint "maintenance_tickets_pkey" PRIMARY KEY (id);

alter table only "public"."migration_log" add constraint "migration_log_migration_name_key" UNIQUE (migration_name);

alter table only "public"."migration_log" add constraint "migration_log_pkey" PRIMARY KEY (id);

alter table only "public"."migration_log_summary" add constraint "migration_log_summary_pkey" PRIMARY KEY (migration_name);

alter table only "public"."moxie_access_audit" add constraint "moxie_access_audit_pkey" PRIMARY KEY (id);

alter table only "public"."moxie_auth_credentials" add constraint "moxie_auth_credentials_pkey" PRIMARY KEY (credential_key);

alter table only "public"."msg_broadcast_recipients" add constraint "msg_broadcast_recipients_broadcast_id_user_id_key" UNIQUE (broadcast_id, user_id);

alter table only "public"."msg_broadcast_recipients" add constraint "msg_broadcast_recipients_pkey" PRIMARY KEY (id);

alter table only "public"."msg_broadcasts" add constraint "msg_broadcasts_pkey" PRIMARY KEY (id);

alter table only "public"."msg_device_assignments" add constraint "msg_device_assignments_device_identifier_key" UNIQUE (device_identifier);

alter table only "public"."msg_device_assignments" add constraint "msg_device_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."msg_hidden_threads_by_device" add constraint "msg_hidden_threads_by_device_pkey" PRIMARY KEY (id);

alter table only "public"."msg_hidden_threads_by_device" add constraint "msg_hidden_threads_by_device_thread_id_device_identifier_key" UNIQUE (thread_id, device_identifier);

alter table only "public"."msg_memphis_thread_context" add constraint "msg_memphis_thread_context_pkey" PRIMARY KEY (thread_id);

alter table only "public"."msg_message_deletions" add constraint "msg_message_deletions_message_id_user_id_key" UNIQUE (message_id, user_id);

alter table only "public"."msg_message_deletions" add constraint "msg_message_deletions_pkey" PRIMARY KEY (id);

alter table only "public"."msg_messages" add constraint "msg_messages_pkey" PRIMARY KEY (id);

alter table only "public"."msg_receipts" add constraint "msg_receipts_message_id_user_id_key" UNIQUE (message_id, user_id);

alter table only "public"."msg_receipts" add constraint "msg_receipts_pkey" PRIMARY KEY (id);

alter table only "public"."msg_thread_participants" add constraint "msg_thread_participants_pkey" PRIMARY KEY (id);

alter table only "public"."msg_thread_participants" add constraint "msg_thread_participants_thread_id_user_id_key" UNIQUE (thread_id, user_id);

alter table only "public"."msg_thread_visibility" add constraint "msg_thread_visibility_pkey" PRIMARY KEY (id);

alter table only "public"."msg_thread_visibility" add constraint "msg_thread_visibility_thread_id_user_id_device_identifier_key" UNIQUE (thread_id, user_id, device_identifier);

alter table only "public"."msg_threads" add constraint "msg_threads_pkey" PRIMARY KEY (id);

alter table only "public"."msg_users" add constraint "msg_users_display_name_unique" UNIQUE (display_name);

alter table only "public"."msg_users" add constraint "msg_users_employee_unique" UNIQUE (employee_id);

alter table only "public"."msg_users" add constraint "msg_users_pkey" PRIMARY KEY (id);

alter table only "public"."operating_hours" add constraint "operating_hours_operating_date_key" UNIQUE (operating_date);

alter table only "public"."operating_hours" add constraint "operating_hours_pkey" PRIMARY KEY (id);

alter table only "public"."ops_manager_auth_events" add constraint "ops_manager_auth_events_pkey" PRIMARY KEY (id);

alter table only "public"."ops_manager_trusted_devices" add constraint "ops_manager_trusted_devices_pkey" PRIMARY KEY (credential_id);

alter table only "public"."ops_manager_weekly_schedules" add constraint "ops_manager_weekly_schedules_display_name_day_of_week_key" UNIQUE (display_name, day_of_week);

alter table only "public"."ops_manager_weekly_schedules" add constraint "ops_manager_weekly_schedules_pkey" PRIMARY KEY (id);

alter table only "public"."release_deployment_manifest" add constraint "release_deployment_manifest_pkey" PRIMARY KEY (release_id);

alter table only "public"."release_validation_runs" add constraint "release_validation_runs_pkey" PRIMARY KEY (id);

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_pkey" PRIMARY KEY (id);

alter table only "public"."scan_events" add constraint "scan_events_pkey" PRIMARY KEY (id);

alter table only "public"."schedule_assignment_archive" add constraint "schedule_assignment_archive_pkey" PRIMARY KEY (archive_id);

alter table only "public"."schedule_automation_runs" add constraint "schedule_automation_runs_pkey" PRIMARY KEY (automation_key, service_date);

alter table only "public"."schedule_candidate_scores" add constraint "schedule_candidate_scores_pkey" PRIMARY KEY (id);

alter table only "public"."schedule_candidate_scores" add constraint "schedule_candidate_scores_work_item_id_employee_id_key" UNIQUE (work_item_id, employee_id);

alter table only "public"."schedule_generation_runs" add constraint "schedule_generation_runs_pkey" PRIMARY KEY (id);

alter table only "public"."schedule_manual_locks" add constraint "schedule_manual_locks_pkey" PRIMARY KEY (id);

alter table only "public"."schedule_operational_notes" add constraint "schedule_operational_notes_pkey" PRIMARY KEY (rule_code);

alter table only "public"."schedule_publish_audit" add constraint "schedule_publish_audit_pkey" PRIMARY KEY (id);

alter table only "public"."schedule_solution_assignments" add constraint "schedule_solution_assignments_pkey" PRIMARY KEY (id);

alter table only "public"."schedule_solution_assignments" add constraint "schedule_solution_assignments_run_id_work_item_id_key" UNIQUE (run_id, work_item_id);

alter table only "public"."schedule_work_items" add constraint "schedule_work_items_pkey" PRIMARY KEY (id);

alter table only "public"."schedule_work_items" add constraint "schedule_work_items_run_id_work_item_key_key" UNIQUE (run_id, work_item_key);

alter table only "public"."scheduler_scoring_settings" add constraint "scheduler_scoring_settings_pkey" PRIMARY KEY (id);

alter table only "public"."scheduler_scoring_settings" add constraint "scheduler_scoring_settings_setting_code_key" UNIQUE (setting_code);

alter table only "public"."session_events" add constraint "session_events_pkey" PRIMARY KEY (id);

alter table only "public"."sessions" add constraint "sessions_pkey" PRIMARY KEY (id);

alter table only "public"."sessions" add constraint "sessions_session_uuid_key" UNIQUE (session_uuid);

alter table only "public"."system_feedback_items" add constraint "system_feedback_items_pkey" PRIMARY KEY (id);

alter table only "public"."system_logs" add constraint "system_logs_pkey" PRIMARY KEY (id);

alter table only "public"."system_settings" add constraint "system_settings_pkey" PRIMARY KEY (setting_key);

alter table only "public"."working_cluster_adjacency" add constraint "uq_working_cluster_adjacency" UNIQUE (from_cluster, to_cluster);

alter table only "public"."working_cluster_adjacency" add constraint "working_cluster_adjacency_pkey" PRIMARY KEY (id);

alter table only "public"."zones" add constraint "zones_pkey" PRIMARY KEY (id);

alter table only "public"."zones" add constraint "zones_zone_code_key" UNIQUE (zone_code);

CREATE INDEX idx_ai_provider_access_audit_created ON public.ai_provider_access_audit USING btree (created_at DESC);

CREATE INDEX idx_ai_provider_access_audit_purpose ON public.ai_provider_access_audit USING btree (purpose, created_at DESC);

CREATE INDEX idx_annie_contacts_name ON public.annie_contacts USING btree (name);

CREATE INDEX idx_annie_log_notes_created_at ON public.annie_log_notes USING btree (created_at DESC);

CREATE INDEX idx_annie_log_reminders_done ON public.annie_log_reminders USING btree (done, created_at DESC);

CREATE INDEX idx_annie_log_reminders_fingerprint ON public.annie_log_reminders USING btree (fingerprint);

CREATE INDEX idx_annie_log_suggested_status ON public.annie_log_suggested_reminders USING btree (status, created_at DESC);

CREATE INDEX idx_annie_suggested_contacts_status ON public.annie_suggested_contacts USING btree (status, created_at DESC);

CREATE INDEX idx_completion_responses_demo_client_completion_id ON public.completion_responses USING btree (client_completion_id) WHERE (client_completion_id ~~ 'demo-completion:%'::text);

CREATE INDEX idx_completion_responses_device_id_fkey ON public.completion_responses USING btree (device_id);

CREATE INDEX idx_completion_responses_location ON public.completion_responses USING btree (location_id);

CREATE INDEX idx_completion_responses_submitted_at ON public.completion_responses USING btree (submitted_at DESC);

CREATE INDEX idx_completion_responses_submitted_by_employee_id_fkey ON public.completion_responses USING btree (submitted_by_employee_id);

CREATE UNIQUE INDEX uq_completion_responses_client_completion_id ON public.completion_responses USING btree (client_completion_id) WHERE (client_completion_id IS NOT NULL);

CREATE INDEX idx_coverage_templates_day ON public.coverage_templates USING btree (day_of_week, location_group_id);

CREATE INDEX idx_coverage_templates_employee_day_purpose_active ON public.coverage_templates USING btree (assigned_employee_id, day_of_week, coverage_purpose, location_group_id) WHERE (active = true);

CREATE INDEX idx_daily_absence_overrides_date ON public.daily_absence_overrides USING btree (absence_date);

CREATE INDEX idx_daily_absence_overrides_employee ON public.daily_absence_overrides USING btree (employee_id);

CREATE INDEX idx_daily_group_assignments_date ON public.daily_group_assignments USING btree (assignment_date);

CREATE INDEX idx_daily_group_assignments_derived_from_employee_id_fkey ON public.daily_group_assignments USING btree (derived_from_employee_id);

CREATE INDEX idx_daily_group_assignments_employee ON public.daily_group_assignments USING btree (assigned_employee_id);

CREATE INDEX idx_daily_group_assignments_group ON public.daily_group_assignments USING btree (location_group_id);

CREATE INDEX idx_daily_schedule_assignments_assigned_employee_id_fkey ON public.daily_schedule_assignments USING btree (assigned_employee_id);

CREATE INDEX idx_daily_schedule_assignments_date ON public.daily_schedule_assignments USING btree (service_date, location_group_id);

CREATE INDEX idx_daily_schedule_assignments_location_group_id_fkey ON public.daily_schedule_assignments USING btree (location_group_id);

CREATE UNIQUE INDEX ux_daily_schedule_assignment_exact_employee_window ON public.daily_schedule_assignments USING btree (service_date, assigned_employee_id, location_group_id, coverage_start, coverage_end, COALESCE(coverage_purpose, ''::text), COALESCE(owner_type, ''::text), status) WHERE (assigned_employee_id IS NOT NULL);

CREATE INDEX idx_daily_work_roster_date ON public.daily_work_roster USING btree (service_date, employee_id);

CREATE INDEX idx_daily_work_roster_employee_id_fkey ON public.daily_work_roster USING btree (employee_id);

CREATE INDEX idx_demo_scan_mock_runs_status_started ON public.demo_scan_mock_runs USING btree (status, started_at DESC);

CREATE INDEX idx_device_aliases_canonical_device_id_fkey ON public.device_aliases USING btree (canonical_device_id);

CREATE INDEX idx_device_auth_credentials_active_expiry ON public.device_auth_credentials USING btree (expires_at) WHERE (revoked_at IS NULL);

CREATE INDEX idx_device_auth_credentials_last_used ON public.device_auth_credentials USING btree (last_used_at DESC NULLS LAST);

CREATE UNIQUE INDEX idx_device_auth_credentials_one_active_per_device ON public.device_auth_credentials USING btree (device_id) WHERE (revoked_at IS NULL);

CREATE INDEX idx_device_auth_enrollment_codes_consumed_by_credential_id_fkey ON public.device_auth_enrollment_codes USING btree (consumed_by_credential_id);

CREATE INDEX idx_device_auth_enrollment_expiry ON public.device_auth_enrollment_codes USING btree (expires_at) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));

CREATE UNIQUE INDEX idx_device_auth_enrollment_one_active_per_device ON public.device_auth_enrollment_codes USING btree (device_id) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX idx_device_auth_events_credential_recent ON public.device_auth_events USING btree (credential_id, created_at DESC) WHERE (credential_id IS NOT NULL);

CREATE INDEX idx_device_auth_events_device_recent ON public.device_auth_events USING btree (device_id, created_at DESC) WHERE (device_id IS NOT NULL);

CREATE INDEX idx_device_auth_events_recent ON public.device_auth_events USING btree (created_at DESC);

CREATE INDEX idx_device_location_proximity_status_evaluated ON public.device_location_proximity_status USING btree (evaluated_at DESC);

CREATE INDEX idx_device_location_proximity_status_location_id_fkey ON public.device_location_proximity_status USING btree (location_id);

CREATE INDEX idx_device_notification_ack_recent ON public.device_notification_acknowledgements USING btree (device_identifier, updated_at DESC);

CREATE INDEX idx_device_notification_ack_type ON public.device_notification_acknowledgements USING btree (notification_type, acknowledged_at, dismissed_at);

CREATE INDEX idx_device_sync_status_attention ON public.device_sync_status USING btree (queue_count, oldest_item_at) WHERE (queue_count > 0);

CREATE INDEX idx_device_sync_status_updated_at ON public.device_sync_status USING btree (updated_at DESC);

CREATE INDEX idx_devices_active ON public.devices USING btree (active);

CREATE INDEX idx_devices_assigned_employee ON public.devices USING btree (assigned_employee_id);

CREATE INDEX idx_employee_aliases_alias_lower_active ON public.employee_aliases USING btree (lower(btrim(alias_text))) WHERE (active = true);

CREATE UNIQUE INDEX uq_employee_aliases_employee_alias_lower ON public.employee_aliases USING btree (employee_id, lower(btrim(alias_text)));

CREATE INDEX idx_employee_area_familiarity_location_group_id_fkey ON public.employee_area_familiarity USING btree (location_group_id);

CREATE INDEX idx_employee_area_preferences_location_group_id_fkey ON public.employee_area_preferences USING btree (location_group_id);

CREATE INDEX idx_employee_backup_group_assignments_active ON public.employee_backup_group_assignments USING btree (active);

CREATE INDEX idx_employee_backup_group_assignments_employee ON public.employee_backup_group_assignments USING btree (employee_id);

CREATE INDEX idx_employee_backup_group_assignments_group ON public.employee_backup_group_assignments USING btree (location_group_id);

CREATE INDEX idx_employee_group_proximity_employee ON public.employee_group_proximity USING btree (employee_id);

CREATE INDEX idx_employee_group_proximity_group ON public.employee_group_proximity USING btree (location_group_id);

CREATE INDEX idx_employee_location_group_assignments_active ON public.employee_location_group_assignments USING btree (active);

CREATE INDEX idx_employee_location_group_assignments_group ON public.employee_location_group_assignments USING btree (location_group_id);

CREATE INDEX employee_planned_time_off_active_dates_idx ON public.employee_planned_time_off USING btree (active, start_date, end_date);

CREATE INDEX employee_planned_time_off_employee_dates_idx ON public.employee_planned_time_off USING btree (employee_id, start_date, end_date);

CREATE INDEX idx_employee_primary_group_assignments_active ON public.employee_primary_group_assignments USING btree (active);

CREATE INDEX idx_employee_primary_group_assignments_employee ON public.employee_primary_group_assignments USING btree (employee_id);

CREATE INDEX idx_employee_pto_dates ON public.employee_pto USING btree (start_date, end_date);

CREATE INDEX idx_employee_pto_employee ON public.employee_pto USING btree (employee_id);

CREATE INDEX idx_employee_shift_overrides_date ON public.employee_shift_overrides USING btree (shift_date);

CREATE INDEX idx_employee_shift_overrides_employee ON public.employee_shift_overrides USING btree (employee_id);

CREATE INDEX idx_employee_shift_templates_active ON public.employee_shift_templates USING btree (active);

CREATE INDEX idx_employee_shift_templates_employee ON public.employee_shift_templates USING btree (employee_id);

CREATE INDEX idx_employee_zone_assignments_active ON public.employee_zone_assignments USING btree (active);

CREATE INDEX idx_employee_zone_assignments_zone ON public.employee_zone_assignments USING btree (zone_id);

CREATE INDEX idx_employees_active ON public.employees USING btree (active);

CREATE INDEX idx_employees_display_name ON public.employees USING btree (display_name);

CREATE INDEX event_area_aliases_active_normalized_idx ON public.event_area_aliases USING btree (normalized_alias) WHERE (active = true);

CREATE INDEX event_area_aliases_location_group_idx ON public.event_area_aliases USING btree (location_group_id) WHERE (active = true);

CREATE INDEX idx_events_app_events_date_window ON public.events_app_events USING btree (event_date, end_date, start_time);

CREATE INDEX idx_events_app_events_event_date ON public.events_app_events USING btree (event_date, start_time);

CREATE INDEX idx_events_app_events_location_date_window ON public.events_app_events USING btree (location_group_id, event_date, end_date, start_time);

CREATE INDEX idx_events_app_events_location_group ON public.events_app_events USING btree (location_group_id, event_date);

CREATE INDEX idx_events_app_notification_log_employee ON public.events_app_notification_log USING btree (employee_id, sent_at DESC);

CREATE INDEX idx_events_app_notification_log_event ON public.events_app_notification_log USING btree (event_id, sent_at DESC);

CREATE INDEX idx_events_app_notification_log_msg_user_id_fkey ON public.events_app_notification_log USING btree (msg_user_id);

CREATE INDEX idx_events_app_notification_log_response_message_id_fkey ON public.events_app_notification_log USING btree (response_message_id);

CREATE INDEX idx_events_app_notification_log_thread_id_fkey ON public.events_app_notification_log USING btree (thread_id);

CREATE UNIQUE INDEX uq_events_app_notification_log_once ON public.events_app_notification_log USING btree (event_id, employee_id, notification_kind);

CREATE UNIQUE INDEX ux_event_notification_one_active_instance ON public.events_app_notification_log USING btree (event_id, employee_id) WHERE (status = ANY (ARRAY['sent'::text, 'sending'::text]));

CREATE INDEX idx_guest_cleanliness_reports_location_code ON public.guest_cleanliness_reports USING btree (location_code);

CREATE INDEX idx_guest_cleanliness_reports_status ON public.guest_cleanliness_reports USING btree (status);

CREATE INDEX idx_guest_cleanliness_reports_submitted_at ON public.guest_cleanliness_reports USING btree (submitted_at DESC);

CREATE INDEX internal_ops_contacts_active_idx ON public.internal_ops_contacts USING btree (active, sort_order, display_name);

CREATE INDEX idx_location_coverage_templates_assigned_employee_id_fkey ON public.location_coverage_templates USING btree (assigned_employee_id);

CREATE INDEX idx_location_coverage_templates_lookup ON public.location_coverage_templates USING btree (location_id, day_of_week, active, coverage_start, coverage_end);

CREATE INDEX idx_location_coverage_templates_source_location_group_id_fkey ON public.location_coverage_templates USING btree (source_location_group_id);

CREATE INDEX idx_location_group_adjacency_to_location_group_id_fkey ON public.location_group_adjacency USING btree (to_location_group_id);

CREATE INDEX location_group_aliases_lookup_idx ON public.location_group_aliases USING btree (active, alias_text);

CREATE INDEX idx_location_group_memberships_active ON public.location_group_memberships USING btree (active);

CREATE INDEX idx_location_group_memberships_group ON public.location_group_memberships USING btree (location_group_id);

CREATE INDEX idx_location_group_proximity_cluster ON public.location_group_proximity_settings USING btree (working_cluster) WHERE (active = true);

CREATE INDEX idx_location_group_zone_assignments_zone_id_fkey ON public.location_group_zone_assignments USING btree (zone_id);

CREATE INDEX idx_location_groups_active ON public.location_groups USING btree (active);

CREATE INDEX idx_location_zone_assignments_active ON public.location_zone_assignments USING btree (active);

CREATE INDEX idx_location_zone_assignments_zone ON public.location_zone_assignments USING btree (zone_id);

CREATE INDEX idx_locations_active ON public.locations USING btree (active);

CREATE INDEX idx_locations_sort_order ON public.locations USING btree (sort_order);

CREATE INDEX idx_locations_type ON public.locations USING btree (location_type);

CREATE INDEX idx_maintenance_tickets_completion_response_id_fkey ON public.maintenance_tickets USING btree (completion_response_id);

CREATE INDEX idx_maintenance_tickets_device_id_fkey ON public.maintenance_tickets USING btree (device_id);

CREATE INDEX idx_maintenance_tickets_location_status ON public.maintenance_tickets USING btree (location_id, status, reported_at DESC);

CREATE INDEX idx_maintenance_tickets_reported_by_employee_id_fkey ON public.maintenance_tickets USING btree (reported_by_employee_id);

CREATE INDEX idx_maintenance_tickets_session_id ON public.maintenance_tickets USING btree (session_id);

CREATE INDEX idx_maintenance_tickets_status_reported_at ON public.maintenance_tickets USING btree (status, reported_at DESC);

CREATE INDEX idx_migration_log_applied_at ON public.migration_log USING btree (applied_at DESC);

CREATE INDEX idx_migration_log_name_applied ON public.migration_log USING btree (migration_name, applied_at DESC);

CREATE INDEX idx_moxie_access_audit_created_at ON public.moxie_access_audit USING btree (created_at DESC);

CREATE INDEX idx_moxie_access_audit_domain ON public.moxie_access_audit USING btree (data_domain, created_at DESC);

CREATE INDEX idx_msg_broadcast_recipients_user_read ON public.msg_broadcast_recipients USING btree (user_id, read_at);

CREATE INDEX idx_msg_broadcasts_created_by_user_id_fkey ON public.msg_broadcasts USING btree (created_by_user_id);

CREATE INDEX idx_msg_broadcasts_sent_at ON public.msg_broadcasts USING btree (sent_at DESC);

CREATE INDEX idx_msg_broadcasts_thread_id_fkey ON public.msg_broadcasts USING btree (thread_id);

CREATE INDEX idx_msg_device_assignments_user ON public.msg_device_assignments USING btree (msg_user_id, is_active);

CREATE INDEX idx_msg_hidden_threads_by_device_device ON public.msg_hidden_threads_by_device USING btree (device_identifier, hidden_at);

CREATE INDEX idx_msg_message_deletions_message ON public.msg_message_deletions USING btree (message_id);

CREATE INDEX idx_msg_message_deletions_user ON public.msg_message_deletions USING btree (user_id);

CREATE INDEX idx_msg_messages_thread_sent_at ON public.msg_messages USING btree (thread_id, sent_at DESC);

CREATE UNIQUE INDEX uq_msg_messages_client_message_id ON public.msg_messages USING btree (client_message_id) WHERE (client_message_id IS NOT NULL);

CREATE UNIQUE INDEX uq_msg_messages_sender_client_message ON public.msg_messages USING btree (sender_user_id, client_message_id) WHERE (client_message_id IS NOT NULL);

CREATE UNIQUE INDEX ux_msg_event_one_visible_per_thread ON public.msg_messages USING btree (thread_id, ((metadata_json ->> 'event_id'::text))) WHERE ((is_deleted = false) AND (COALESCE((metadata_json ->> 'source'::text), ''::text) = 'events_app'::text) AND (NULLIF((metadata_json ->> 'event_id'::text), ''::text) IS NOT NULL));

CREATE INDEX idx_msg_receipts_delivery_lifecycle ON public.msg_receipts USING btree (user_id, delivered_at, displayed_at, read_at, acknowledged_at);

CREATE INDEX idx_msg_receipts_delivery_pending ON public.msg_receipts USING btree (user_id, queued_at) WHERE (delivered_at IS NULL);

CREATE INDEX idx_msg_receipts_user_unread ON public.msg_receipts USING btree (user_id, read_at, delivered_at);

CREATE INDEX idx_msg_thread_participants_user_thread ON public.msg_thread_participants USING btree (user_id, thread_id);

CREATE INDEX idx_msg_thread_visibility_thread_user_device ON public.msg_thread_visibility USING btree (thread_id, user_id, device_identifier);

CREATE INDEX idx_msg_thread_visibility_user_id_fkey ON public.msg_thread_visibility USING btree (user_id);

CREATE INDEX idx_msg_threads_created_by_user_id_fkey ON public.msg_threads USING btree (created_by_user_id);

CREATE INDEX idx_msg_threads_type_active_last ON public.msg_threads USING btree (thread_type, is_active, last_message_at DESC);

CREATE INDEX idx_msg_users_active ON public.msg_users USING btree (active);

CREATE INDEX idx_msg_users_role_active ON public.msg_users USING btree (role, is_active);

CREATE INDEX idx_msg_users_user_id ON public.msg_users USING btree (user_id);

CREATE INDEX idx_operating_hours_date ON public.operating_hours USING btree (operating_date);

CREATE INDEX idx_ops_manager_auth_events_credential ON public.ops_manager_auth_events USING btree (credential_id, created_at DESC) WHERE (credential_id IS NOT NULL);

CREATE INDEX idx_ops_manager_auth_events_device ON public.ops_manager_auth_events USING btree (device_id, created_at DESC) WHERE (device_id IS NOT NULL);

CREATE INDEX idx_ops_manager_auth_events_recent ON public.ops_manager_auth_events USING btree (created_at DESC);

CREATE INDEX idx_ops_manager_trusted_devices_active_device ON public.ops_manager_trusted_devices USING btree (device_id, expires_at DESC) WHERE (revoked_at IS NULL);

CREATE INDEX idx_ops_manager_trusted_devices_last_used ON public.ops_manager_trusted_devices USING btree (last_used_at DESC NULLS LAST);

CREATE INDEX idx_ops_manager_weekly_schedules_contact_id_fkey ON public.ops_manager_weekly_schedules USING btree (contact_id);

CREATE INDEX ops_manager_weekly_schedules_day_idx ON public.ops_manager_weekly_schedules USING btree (active, day_of_week, shift_start, display_name);

CREATE INDEX idx_release_validation_runs_area ON public.release_validation_runs USING btree (area, status, validated_at DESC);

CREATE INDEX idx_release_validation_runs_release_time ON public.release_validation_runs USING btree (release_id, validated_at DESC);

CREATE INDEX idx_scan_alert_notification_log_assigned_employee_id_fkey ON public.scan_alert_notification_log USING btree (assigned_employee_id);

CREATE INDEX idx_scan_alert_notification_log_escalation_msg_message_id_fkey ON public.scan_alert_notification_log USING btree (escalation_msg_message_id);

CREATE INDEX idx_scan_alert_notification_log_escalation_msg_thread_id_fkey ON public.scan_alert_notification_log USING btree (escalation_msg_thread_id);

CREATE INDEX idx_scan_alert_notification_log_escalation_msg_user_id_fkey ON public.scan_alert_notification_log USING btree (escalation_msg_user_id);

CREATE INDEX idx_scan_alert_notification_log_location_id_fkey ON public.scan_alert_notification_log USING btree (location_id);

CREATE INDEX idx_scan_alert_notification_log_lookup ON public.scan_alert_notification_log USING btree (location_code, alert_type, assigned_employee_id, active, created_at DESC);

CREATE INDEX idx_scan_alert_notification_log_msg_message_id_fkey ON public.scan_alert_notification_log USING btree (msg_message_id);

CREATE INDEX idx_scan_alert_notification_log_msg_thread_id_fkey ON public.scan_alert_notification_log USING btree (msg_thread_id);

CREATE INDEX idx_scan_alert_notification_log_msg_user_id_fkey ON public.scan_alert_notification_log USING btree (msg_user_id);

CREATE INDEX idx_scan_events_demo_client_event_id ON public.scan_events USING btree (client_event_id) WHERE (client_event_id ~~ 'demo-scan-event:%'::text);

CREATE INDEX idx_scan_events_device_id_fkey ON public.scan_events USING btree (device_id);

CREATE INDEX idx_scan_events_device_identifier ON public.scan_events USING btree (device_identifier);

CREATE INDEX idx_scan_events_event_type ON public.scan_events USING btree (event_type);

CREATE INDEX idx_scan_events_location_code ON public.scan_events USING btree (location_code);

CREATE INDEX idx_scan_events_location_code_scanned ON public.scan_events USING btree (location_code, scanned_at DESC);

CREATE INDEX idx_scan_events_location_id_fkey ON public.scan_events USING btree (location_id);

CREATE INDEX idx_scan_events_scanned_at ON public.scan_events USING btree (scanned_at DESC);

CREATE INDEX idx_scan_events_session_id_fkey ON public.scan_events USING btree (session_id);

CREATE UNIQUE INDEX uq_scan_events_client_event_id ON public.scan_events USING btree (client_event_id) WHERE (client_event_id IS NOT NULL);

CREATE INDEX idx_schedule_automation_runs_service_date ON public.schedule_automation_runs USING btree (service_date DESC);

CREATE INDEX idx_schedule_candidate_scores_employee_id_fkey ON public.schedule_candidate_scores USING btree (employee_id);

CREATE INDEX idx_schedule_candidate_scores_run_item ON public.schedule_candidate_scores USING btree (run_id, work_item_id, eligible, total_score DESC);

CREATE INDEX idx_schedule_generation_runs_input_hash ON public.schedule_generation_runs USING btree (service_date, input_hash);

CREATE INDEX idx_schedule_generation_runs_service_date ON public.schedule_generation_runs USING btree (service_date, created_at DESC);

CREATE INDEX idx_schedule_manual_locks_active ON public.schedule_manual_locks USING btree (service_date, location_group_id, active);

CREATE INDEX idx_schedule_manual_locks_assigned_employee_id_fkey ON public.schedule_manual_locks USING btree (assigned_employee_id);

CREATE INDEX idx_schedule_manual_locks_location_group_id_fkey ON public.schedule_manual_locks USING btree (location_group_id);

CREATE INDEX idx_schedule_publish_audit_run ON public.schedule_publish_audit USING btree (run_id, published_at DESC);

CREATE INDEX idx_schedule_publish_audit_service_date ON public.schedule_publish_audit USING btree (service_date, published_at DESC);

CREATE INDEX idx_schedule_solution_assignments_assigned_employee_id_fkey ON public.schedule_solution_assignments USING btree (assigned_employee_id);

CREATE INDEX idx_schedule_solution_assignments_employee ON public.schedule_solution_assignments USING btree (run_id, assigned_employee_id);

CREATE INDEX idx_schedule_solution_assignments_location_group_id_fkey ON public.schedule_solution_assignments USING btree (location_group_id);

CREATE INDEX idx_schedule_solution_assignments_run ON public.schedule_solution_assignments USING btree (run_id, service_date, coverage_start);

CREATE INDEX idx_schedule_solution_assignments_work_item_id_fkey ON public.schedule_solution_assignments USING btree (work_item_id);

CREATE INDEX idx_schedule_work_items_group ON public.schedule_work_items USING btree (location_group_id);

CREATE INDEX idx_schedule_work_items_run ON public.schedule_work_items USING btree (run_id, service_date, coverage_start);

CREATE INDEX idx_session_events_created_at ON public.session_events USING btree (created_at DESC);

CREATE INDEX idx_session_events_session ON public.session_events USING btree (session_id);

CREATE INDEX idx_session_events_type ON public.session_events USING btree (event_type);

CREATE INDEX idx_sessions_demo_client_session_id ON public.sessions USING btree (client_session_id) WHERE (client_session_id ~~ 'demo-scan:%'::text);

CREATE INDEX idx_sessions_device ON public.sessions USING btree (device_id);

CREATE INDEX idx_sessions_device_status_started ON public.sessions USING btree (device_id, status, started_at DESC);

CREATE INDEX idx_sessions_employee ON public.sessions USING btree (employee_id);

CREATE INDEX idx_sessions_employee_status_started ON public.sessions USING btree (employee_id, status, started_at DESC);

CREATE INDEX idx_sessions_location ON public.sessions USING btree (location_id);

CREATE INDEX idx_sessions_location_status_started ON public.sessions USING btree (location_id, status, started_at DESC);

CREATE INDEX idx_sessions_started_at ON public.sessions USING btree (started_at DESC);

CREATE INDEX idx_sessions_status ON public.sessions USING btree (status);

CREATE UNIQUE INDEX uq_sessions_client_session_id ON public.sessions USING btree (client_session_id) WHERE (client_session_id IS NOT NULL);

CREATE UNIQUE INDEX uq_sessions_open_device ON public.sessions USING btree (device_id) WHERE (status = ANY (ARRAY['active'::text, 'pending_submit'::text]));

CREATE UNIQUE INDEX uq_sessions_open_employee ON public.sessions USING btree (employee_id) WHERE (status = ANY (ARRAY['active'::text, 'pending_submit'::text]));

CREATE UNIQUE INDEX uq_sessions_open_location ON public.sessions USING btree (location_id) WHERE (status = ANY (ARRAY['active'::text, 'pending_submit'::text]));

CREATE INDEX idx_system_feedback_items_created_at ON public.system_feedback_items USING btree (created_at DESC);

CREATE INDEX idx_system_feedback_items_hub_context ON public.system_feedback_items USING btree (hub_context);

CREATE INDEX idx_system_feedback_items_priority ON public.system_feedback_items USING btree (priority);

CREATE INDEX idx_system_feedback_items_reminder_due ON public.system_feedback_items USING btree (status, last_feedback_reminder_at);

CREATE INDEX idx_system_feedback_items_status ON public.system_feedback_items USING btree (status);

CREATE INDEX idx_system_logs_created_at ON public.system_logs USING btree (created_at DESC);

CREATE INDEX idx_system_logs_device_id_fkey ON public.system_logs USING btree (device_id);

CREATE INDEX idx_system_logs_level ON public.system_logs USING btree (level);

CREATE INDEX idx_system_logs_location_id_fkey ON public.system_logs USING btree (location_id);

CREATE INDEX idx_system_logs_session_id_fkey ON public.system_logs USING btree (session_id);

CREATE INDEX idx_zones_active ON public.zones USING btree (active);

CREATE OR REPLACE FUNCTION public.ack_device_notification(p_device_identifier text, p_notification_key text, p_notification_type text DEFAULT 'notification'::text, p_action text DEFAULT 'dismissed'::text, p_metadata_json jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
  v_key text := nullif(btrim(coalesce(p_notification_key,'')), '');
  v_type text := left(lower(coalesce(nullif(btrim(p_notification_type),''), 'notification')), 80);
  v_action text := lower(coalesce(nullif(btrim(p_action),''), 'dismissed'));
  v_row public.device_notification_acknowledgements%rowtype;
begin
  if v_requested is null or length(v_requested) > 200 then
    raise exception 'device_identifier is required and must be at most 200 characters';
  end if;
  if v_key is null or length(v_key) > 500 then
    raise exception 'notification_key is required and must be at most 500 characters';
  end if;
  if v_action not in ('displayed','dismissed','opened','acknowledged') then
    raise exception 'unsupported notification action: %', v_action;
  end if;
  if jsonb_typeof(coalesce(p_metadata_json,'{}'::jsonb)) <> 'object' then
    raise exception 'metadata_json must be an object';
  end if;

  select d.device_id into v_device
  from public.devices d
  where d.active = true and upper(btrim(d.device_id)) = upper(v_requested)
  limit 1;

  if v_device is null then
    select d.device_id into v_device
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active = true
    where da.active = true and upper(btrim(da.alias_identifier)) = upper(v_requested)
    limit 1;
  end if;

  if v_device is null then raise exception 'Active device not found: %', v_requested; end if;

  insert into public.device_notification_acknowledgements(
    device_identifier, notification_key, notification_type,
    displayed_at, dismissed_at, opened_at, acknowledged_at,
    metadata_json, updated_at
  ) values (
    v_device, v_key, v_type,
    case when v_action='displayed' then now() else null end,
    case when v_action='dismissed' then now() else null end,
    case when v_action='opened' then now() else null end,
    case when v_action in ('dismissed','opened','acknowledged') then now() else null end,
    coalesce(p_metadata_json,'{}'::jsonb) || jsonb_build_object('presented_device_identifier',v_requested),
    now()
  )
  on conflict(device_identifier, notification_key) do update
  set notification_type = excluded.notification_type,
      displayed_at = coalesce(public.device_notification_acknowledgements.displayed_at, excluded.displayed_at),
      dismissed_at = coalesce(public.device_notification_acknowledgements.dismissed_at, excluded.dismissed_at),
      opened_at = coalesce(public.device_notification_acknowledgements.opened_at, excluded.opened_at),
      acknowledged_at = coalesce(public.device_notification_acknowledgements.acknowledged_at, excluded.acknowledged_at),
      metadata_json = coalesce(public.device_notification_acknowledgements.metadata_json,'{}'::jsonb) || excluded.metadata_json,
      updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'device_identifier', v_row.device_identifier,
    'notification_key', v_row.notification_key,
    'notification_type', v_row.notification_type,
    'displayed_at', v_row.displayed_at,
    'dismissed_at', v_row.dismissed_at,
    'opened_at', v_row.opened_at,
    'acknowledged_at', v_row.acknowledged_at
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.admin_health_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'snapshot', to_jsonb(v),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(eq) order by eq.event_at desc nulls last) from public.v_exception_queue eq), '[]'::jsonb)
  )
  from public.v_admin_health_snapshot v;
$function$;

CREATE OR REPLACE FUNCTION public.can_employee_start_session(p_employee_name text)
 RETURNS TABLE(employee_name text, can_start boolean, reason text, open_session_uuid text, open_location_name text, open_status text)
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  return query
  with emp as (
    select e.id, e.display_name
    from public.employees e
    where e.display_name = p_employee_name
      and e.active = true
    limit 1
  ),
  latest_open as (
    select
      s.session_uuid,
      l.location_name,
      s.status
    from public.sessions s
    join emp on emp.id = s.employee_id
    join public.locations l on l.id = s.location_id
    where s.status in ('active', 'pending_submit')
    order by s.started_at desc
    limit 1
  )
  select
    p_employee_name,
    case
      when not exists (select 1 from emp) then false
      when exists (select 1 from latest_open) then false
      else true
    end as can_start,
    case
      when not exists (select 1 from emp) then 'employee_not_found'
      when exists (select 1 from latest_open) then 'employee_has_open_session'
      else 'ok'
    end as reason,
    (select session_uuid from latest_open),
    (select location_name from latest_open),
    (select status from latest_open);
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_event_notification(p_event_id uuid, p_employee_id uuid, p_msg_user_id uuid, p_notification_kind text, p_scheduled_for_local text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_kind text := nullif(btrim(coalesce(p_notification_kind, '')), '');
  v_scheduled timestamp;
  v_existing public.events_app_notification_log%rowtype;
begin
  if p_event_id is null or p_employee_id is null or p_msg_user_id is null then
    raise exception 'event_id, employee_id, and msg_user_id are required';
  end if;
  if v_kind is null or length(v_kind) > 120 then
    raise exception 'notification_kind is required and must be at most 120 characters';
  end if;
  begin
    v_scheduled := p_scheduled_for_local::timestamp;
  exception when others then
    raise exception 'scheduled_for_local is invalid';
  end;

  perform pg_advisory_xact_lock(hashtextextended('event-reminder:' || p_event_id::text || ':' || p_employee_id::text, 0));

  select log.* into v_existing
  from public.events_app_notification_log log
  where log.event_id = p_event_id
    and log.employee_id = p_employee_id
    and log.status in ('sent', 'sending')
    and (log.status = 'sent' or log.updated_at > now() - interval '10 minutes')
  order by case when log.status = 'sent' then 0 else 1 end, log.updated_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'claimed', false,
      'reason', case when v_existing.status = 'sent' then 'event_already_notified' else 'event_notification_in_flight' end,
      'notification_kind', v_existing.notification_kind,
      'response_message_id', v_existing.response_message_id,
      'status', v_existing.status
    );
  end if;

  insert into public.events_app_notification_log(
    event_id, employee_id, msg_user_id, notification_kind, scheduled_for_local,
    sent_at, status, notes, created_at, updated_at
  ) values (
    p_event_id, p_employee_id, p_msg_user_id, v_kind, v_scheduled,
    now(), 'sending', 'Claimed before message delivery', now(), now()
  )
  on conflict (event_id, employee_id, notification_kind) do update set
    msg_user_id = excluded.msg_user_id,
    scheduled_for_local = excluded.scheduled_for_local,
    sent_at = now(),
    status = 'sending',
    response_message_id = null,
    notes = 'Retry claimed before message delivery',
    updated_at = now()
  where public.events_app_notification_log.status = 'error'
     or (public.events_app_notification_log.status = 'sending'
         and public.events_app_notification_log.updated_at <= now() - interval '10 minutes')
  returning * into v_existing;

  if not found then
    select log.* into v_existing
    from public.events_app_notification_log log
    where log.event_id = p_event_id
      and log.employee_id = p_employee_id
      and log.notification_kind = v_kind
    limit 1;
    return jsonb_build_object(
      'claimed', false,
      'reason', 'notification_already_claimed',
      'response_message_id', v_existing.response_message_id,
      'status', v_existing.status
    );
  end if;

  return jsonb_build_object(
    'claimed', true,
    'reason', 'claim_created',
    'notification_kind', v_kind,
    'log_id', v_existing.id,
    'status', v_existing.status
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.close_maintenance_ticket(p_ticket_id uuid, p_closed_by text, p_close_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_ticket public.maintenance_tickets%rowtype;
  v_closed_by text;
  v_closed_via text;
begin
  v_closed_by := coalesce(nullif(trim(p_closed_by), ''), 'unknown');
  v_closed_via := case
    when v_closed_by = 'Dashboard' then 'dashboard_public'
    else 'admin_api'
  end;

  update public.maintenance_tickets mt
  set
    status = 'closed',
    closed_at = now(),
    closed_by = v_closed_by,
    close_notes = p_close_notes,
    closed_via = v_closed_via
  where mt.id = p_ticket_id
    and mt.status = 'open'
  returning * into v_ticket;

  if v_ticket.id is null then
    raise exception 'Open maintenance ticket not found: %', p_ticket_id;
  end if;

  insert into public.system_logs (
    level,
    source,
    message,
    session_id,
    location_id,
    device_id
  )
  values (
    'INFO',
    'maintenance_ticket_close',
    format(
      'Maintenance ticket %s closed via %s by %s%s',
      v_ticket.id,
      v_closed_via,
      v_closed_by,
      case
        when p_close_notes is null or btrim(p_close_notes) = '' then ''
        else format(' (notes: %s)', left(p_close_notes, 300))
      end
    ),
    v_ticket.session_id,
    v_ticket.location_id,
    v_ticket.device_id
  );

  return jsonb_build_object(
    'ticket_id', v_ticket.id,
    'status', v_ticket.status,
    'closed_at', v_ticket.closed_at,
    'closed_by', v_ticket.closed_by,
    'closed_via', v_ticket.closed_via
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_maintenance_tickets_from_response(p_completion_response_id uuid, p_session_id uuid, p_location_id uuid, p_reported_by_employee_id uuid, p_device_id uuid, p_reported_at timestamp with time zone, p_response_json jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_issue_array jsonb;
  v_item jsonb;
  v_issue_summary text;
  v_issue_category text;
  v_fixture_type text;
  v_fixture_identifier text;
  v_out_of_order boolean;
  v_location_code text;
  v_location_name text;
  v_reporter_name text;
  v_count integer := 0;
  v_top_level_out_of_order boolean := (
    lower(coalesce(
      p_response_json->>'out_of_order',
      p_response_json->>'outOfOrder',
      p_response_json->>'place_out_of_order',
      p_response_json->>'placeOutOfOrder',
      p_response_json->>'out_of_order_signed',
      p_response_json->>'outOfOrderSigned',
      'false'
    )) in ('true','t','1','yes','y','on')
  );
  v_top_level_fixture_identifier text := coalesce(
    p_response_json->>'fixture_identifier',
    p_response_json->>'fixtureIdentifier',
    p_response_json->>'out_of_order_details',
    p_response_json->>'outOfOrderDetails',
    p_response_json->>'stall',
    p_response_json->>'stall_number',
    p_response_json->>'stallNumber',
    p_response_json->>'urinal',
    p_response_json->>'urinal_number',
    p_response_json->>'urinalNumber'
  );
  v_top_level_notes text := coalesce(
    p_response_json->>'maintenance_notes',
    p_response_json->>'maintenanceNotes',
    p_response_json->>'notes',
    p_response_json->>'note',
    p_response_json->>'issue_notes',
    p_response_json->>'issueNotes'
  );
begin
  select l.location_code, l.location_name
    into v_location_code, v_location_name
  from public.locations l
  where l.id = p_location_id
  limit 1;

  select e.display_name
    into v_reporter_name
  from public.employees e
  where e.id = p_reported_by_employee_id
  limit 1;

  delete from public.maintenance_tickets mt
  where mt.completion_response_id = p_completion_response_id
    and mt.issue_source = 'completion_form'
    and mt.status = 'open';

  v_issue_array := case
    when jsonb_typeof(p_response_json->'maintenance_issues') = 'array' then p_response_json->'maintenance_issues'
    when jsonb_typeof(p_response_json->'maintenanceIssues') = 'array' then p_response_json->'maintenanceIssues'
    when jsonb_typeof(p_response_json->'maintenance_issue_checks') = 'array' then p_response_json->'maintenance_issue_checks'
    when jsonb_typeof(p_response_json->'maintenanceIssueChecks') = 'array' then p_response_json->'maintenanceIssueChecks'
    when jsonb_typeof(p_response_json->'checked_maintenance_issues') = 'array' then p_response_json->'checked_maintenance_issues'
    when jsonb_typeof(p_response_json->'checkedMaintenanceIssues') = 'array' then p_response_json->'checkedMaintenanceIssues'
    when jsonb_typeof(p_response_json->'maintenance_issues_found') = 'array' then p_response_json->'maintenance_issues_found'
    when jsonb_typeof(p_response_json->'maintenanceIssuesFound') = 'array' then p_response_json->'maintenanceIssuesFound'
    when jsonb_typeof(p_response_json->'maintenance_issue_found') = 'array' then p_response_json->'maintenance_issue_found'
    when jsonb_typeof(p_response_json->'issues') = 'array' then p_response_json->'issues'
    when jsonb_typeof(p_response_json->'maintenance') = 'array' then p_response_json->'maintenance'
    else null
  end;

  if v_issue_array is null then
    if (
      lower(coalesce(
        p_response_json->>'has_maintenance_issue',
        p_response_json->>'hasMaintenanceIssue',
        p_response_json->>'maintenance_issue',
        p_response_json->>'maintenanceIssue',
        'false'
      )) in ('true','t','1','yes','y','on')
    ) or v_top_level_notes is not null then
      v_issue_array := jsonb_build_array(
        jsonb_build_object(
          'label', coalesce(v_top_level_notes, 'Maintenance issue reported'),
          'fixture_identifier', v_top_level_fixture_identifier,
          'out_of_order', v_top_level_out_of_order,
          'raw_response', p_response_json
        )
      );
    end if;
  end if;

  if v_issue_array is null or jsonb_array_length(v_issue_array) = 0 then
    return 0;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(v_issue_array)
  loop
    if jsonb_typeof(v_item) = 'string' then
      v_issue_summary := trim(both '"' from v_item::text);
      if lower(v_issue_summary) in ('other maintenance issue found', 'other') and v_top_level_notes is not null then
        v_issue_summary := 'Other maintenance issue: ' || v_top_level_notes;
      end if;
      v_issue_category := trim(both '"' from v_item::text);
      v_fixture_type := case
        when lower(v_issue_summary) like '%toilet%' then 'toilet'
        when lower(v_issue_summary) like '%urinal%' then 'urinal'
        else null
      end;
      v_fixture_identifier := v_top_level_fixture_identifier;
      v_out_of_order := v_top_level_out_of_order;
    else
      v_issue_summary := coalesce(
        v_item->>'label',
        v_item->>'issue',
        v_item->>'issue_label',
        v_item->>'issueLabel',
        v_item->>'name',
        v_item->>'value',
        v_item->>'description',
        v_item->>'maintenance_issue',
        v_item->>'maintenanceIssue',
        'Maintenance issue reported'
      );
      if lower(v_issue_summary) in ('other maintenance issue found', 'other') and v_top_level_notes is not null then
        v_issue_summary := 'Other maintenance issue: ' || v_top_level_notes;
      end if;
      v_issue_category := coalesce(
        v_item->>'category',
        v_item->>'issue_category',
        v_item->>'issueCategory',
        v_issue_summary
      );
      v_fixture_type := coalesce(
        v_item->>'fixture_type',
        v_item->>'fixtureType',
        case
          when lower(v_issue_summary) like '%toilet%' then 'toilet'
          when lower(v_issue_summary) like '%urinal%' then 'urinal'
          else null
        end
      );
      v_fixture_identifier := coalesce(
        v_item->>'fixture_identifier',
        v_item->>'fixtureIdentifier',
        v_item->>'stall',
        v_item->>'stall_number',
        v_item->>'stallNumber',
        v_item->>'urinal',
        v_item->>'urinal_number',
        v_item->>'urinalNumber',
        v_top_level_fixture_identifier
      );
      v_out_of_order := (
        lower(coalesce(
          v_item->>'out_of_order',
          v_item->>'outOfOrder',
          v_item->>'place_out_of_order',
          v_item->>'placeOutOfOrder',
          v_item->>'out_of_order_signed',
          v_item->>'outOfOrderSigned',
          case when v_top_level_out_of_order then 'true' else 'false' end
        )) in ('true','t','1','yes','y','on')
      );
    end if;

    insert into public.maintenance_tickets (
      completion_response_id,
      session_id,
      location_id,
      reported_by_employee_id,
      device_id,
      issue_source,
      status,
      issue_summary,
      issue_category,
      fixture_type,
      fixture_identifier,
      out_of_order,
      issue_payload,
      location_code_snapshot,
      location_name_snapshot,
      reporter_name_snapshot,
      reported_at
    )
    values (
      p_completion_response_id,
      p_session_id,
      p_location_id,
      p_reported_by_employee_id,
      p_device_id,
      'completion_form',
      'open',
      left(coalesce(v_issue_summary, 'Maintenance issue reported'), 500),
      left(v_issue_category, 200),
      left(v_fixture_type, 100),
      left(v_fixture_identifier, 100),
      coalesce(v_out_of_order, false),
      jsonb_build_object(
        'raw_item', v_item,
        'top_level_note', v_top_level_notes,
        'top_level_fixture_identifier', v_top_level_fixture_identifier,
        'top_level_out_of_order', v_top_level_out_of_order
      ),
      v_location_code,
      v_location_name,
      v_reporter_name,
      coalesce(p_reported_at, now())
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_cleanup(p_run_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(deleted_tickets integer, deleted_completion_responses integer, deleted_scan_events integer, deleted_session_events integer, deleted_sessions integer, deleted_runs integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_tickets integer := 0;
  v_completions integer := 0;
  v_scans integer := 0;
  v_session_events integer := 0;
  v_sessions integer := 0;
  v_runs integer := 0;
begin
  delete from public.maintenance_tickets mt
  where (
      mt.issue_payload ->> 'demo_mock' = 'true'
      or mt.issue_payload ? 'mock_run_id'
      or exists (
        select 1 from public.sessions s
        where s.id = mt.session_id
          and s.client_session_id like 'demo-scan:%'
      )
      or exists (
        select 1 from public.completion_responses cr
        where cr.id = mt.completion_response_id
          and cr.client_completion_id like 'demo-completion:%'
      )
    )
    and (
      p_run_id is null
      or mt.issue_payload ->> 'mock_run_id' = p_run_id::text
      or exists (
        select 1 from public.sessions s
        where s.id = mt.session_id
          and s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
      )
      or exists (
        select 1 from public.completion_responses cr
        where cr.id = mt.completion_response_id
          and cr.client_completion_id like ('demo-completion:' || p_run_id::text || ':%')
      )
    );
  get diagnostics v_tickets = row_count;

  delete from public.completion_responses cr
  where (
      cr.client_completion_id like 'demo-completion:%'
      or cr.response_json ->> 'demo_mock' = 'true'
      or cr.response_json ? 'mock_run_id'
    )
    and (
      p_run_id is null
      or cr.client_completion_id like ('demo-completion:' || p_run_id::text || ':%')
      or cr.response_json ->> 'mock_run_id' = p_run_id::text
    );
  get diagnostics v_completions = row_count;

  delete from public.scan_events se
  where (
      se.client_event_id like 'demo-scan-event:%'
      or se.payload_json ->> 'demo_mock' = 'true'
      or se.payload_json ? 'mock_run_id'
    )
    and (
      p_run_id is null
      or se.client_event_id like ('demo-scan-event:' || p_run_id::text || ':%')
      or se.payload_json ->> 'mock_run_id' = p_run_id::text
    );
  get diagnostics v_scans = row_count;

  delete from public.session_events ev
  where (
      ev.details_json ->> 'demo_mock' = 'true'
      or ev.details_json ? 'mock_run_id'
      or exists (
        select 1 from public.sessions s
        where s.id = ev.session_id
          and s.client_session_id like 'demo-scan:%'
      )
    )
    and (
      p_run_id is null
      or ev.details_json ->> 'mock_run_id' = p_run_id::text
      or exists (
        select 1 from public.sessions s
        where s.id = ev.session_id
          and s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
      )
    );
  get diagnostics v_session_events = row_count;

  delete from public.sessions s
  where s.client_session_id like 'demo-scan:%'
    and (
      p_run_id is null
      or s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    );
  get diagnostics v_sessions = row_count;

  delete from public.demo_scan_mock_runs r
  where p_run_id is null or r.id = p_run_id;
  get diagnostics v_runs = row_count;

  deleted_tickets := v_tickets;
  deleted_completion_responses := v_completions;
  deleted_scan_events := v_scans;
  deleted_session_events := v_session_events;
  deleted_sessions := v_sessions;
  deleted_runs := v_runs;
  return next;
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_complete_open_sessions(p_run_id uuid, p_force boolean DEFAULT false, p_duration_minutes integer DEFAULT 35)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_changed integer := 0;
begin
  update public.sessions s
  set
    status = 'pending_submit',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)::text || ' min'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'active'
    and (p_force or s.started_at <= now() - make_interval(mins => p_duration_minutes));

  update public.sessions s
  set
    status = 'closed',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::integer)::text || ' min'),
    completion_source = coalesce(s.completion_source, 'kiosk_form'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'pending_submit'
    and s.client_session_id like '%:shift:%';
  get diagnostics v_changed = row_count;

  insert into public.completion_responses (
    session_id,
    location_id,
    submitted_by_employee_id,
    device_id,
    response_json,
    submitted_at,
    created_at,
    client_completion_id
  )
  select
    s.id,
    s.location_id,
    s.employee_id,
    s.device_id,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'mode', 'shift_schedule',
      'services_performed', to_jsonb(array['trash_removed', 'surfaces_checked', 'supplies_checked']::text[]),
      'notes', 'Demo shift-schedule cleaning completed.',
      'cleaning_notes', 'Demo shift-schedule cleaning completed.'
    ),
    coalesce(s.ended_at, now()),
    coalesce(s.ended_at, now()),
    'demo-completion:' || p_run_id::text || ':shift:session:' || s.id::text
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.client_session_id like '%:shift:%'
    and s.status = 'closed'
    and not exists (select 1 from public.completion_responses cr where cr.session_id = s.id);

  insert into public.scan_events (
    scanned_at,
    location_id,
    location_code,
    device_id,
    device_identifier,
    session_id,
    event_type,
    result,
    notes,
    payload_json,
    created_at,
    client_event_id
  )
  select
    coalesce(s.ended_at, now()),
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_finish',
    'demo_shift_session_finished',
    'Demo shift-schedule session finished.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', p_run_id::text, 'mode', 'shift_schedule', 'phase', 'finish'),
    coalesce(s.ended_at, now()),
    'demo-scan-event:' || p_run_id::text || ':shift:session:' || s.id::text || ':finish'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  left join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.client_session_id like '%:shift:%'
    and s.status = 'closed'
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || p_run_id::text || ':shift:session:' || s.id::text || ':finish'
    );

  return v_changed;
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_demo_duration_minutes(p_seed text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select 15 + (get_byte(decode(substr(md5(coalesce(p_seed, 'demo')), 1, 2), 'hex'), 0) % 6);
$function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_status(p_run_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(run_id uuid, run_status text, started_at timestamp with time zone, stopped_at timestamp with time zone, last_advanced_at timestamp with time zone, cycle_number integer, employee_count integer, demo_sessions integer, open_demo_sessions integer, demo_completion_responses integer, demo_scan_events integer, demo_session_events integer, demo_tickets integer, dashboard_counts jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
begin
  select r.id
  into v_run_id
  from public.demo_scan_mock_runs r
  where p_run_id is null or r.id = p_run_id
  order by case when r.status = 'active' then 0 else 1 end, r.started_at desc
  limit 1;

  if v_run_id is null then
    return;
  end if;

  return query
  with dashboard as (
    select jsonb_object_agg(status_code || '/' || status_color, location_count order by status_code || '/' || status_color) as counts
    from (
      select status_code, status_color, count(*)::integer as location_count
      from public.v_location_dashboard_status
      group by status_code, status_color
    ) x
  )
  select
    r.id,
    r.status,
    r.started_at,
    r.stopped_at,
    r.last_advanced_at,
    r.cycle_number,
    r.employee_count,
    (select count(*)::integer from public.sessions s where s.client_session_id like ('demo-scan:' || v_run_id::text || ':%')),
    (select count(*)::integer from public.sessions s where s.client_session_id like ('demo-scan:' || v_run_id::text || ':%') and s.status in ('active', 'pending_submit')),
    (select count(*)::integer from public.completion_responses cr where cr.client_completion_id like ('demo-completion:' || v_run_id::text || ':%') or cr.response_json ->> 'mock_run_id' = v_run_id::text),
    (select count(*)::integer from public.scan_events se where se.client_event_id like ('demo-scan-event:' || v_run_id::text || ':%') or se.payload_json ->> 'mock_run_id' = v_run_id::text),
    (select count(*)::integer from public.session_events ev where ev.details_json ->> 'mock_run_id' = v_run_id::text),
    (select count(*)::integer from public.maintenance_tickets mt where mt.issue_payload ->> 'mock_run_id' = v_run_id::text),
    coalesce(dashboard.counts, '{}'::jsonb)
  from public.demo_scan_mock_runs r
  cross join dashboard
  where r.id = v_run_id;
end $function$;

CREATE OR REPLACE FUNCTION public.device_auth_consume_enrollment_code(p_device_id uuid, p_code_hash text, p_credential_id uuid, p_token_hash text, p_device_label text, p_expires_at timestamp with time zone, p_user_agent_hash text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text, p_metadata_json jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_code public.device_auth_enrollment_codes%rowtype;
  v_credential public.device_auth_credentials%rowtype;
  v_failed_attempts integer;
begin
  if p_device_id is null or p_credential_id is null then raise exception 'device_id and credential_id are required'; end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'valid code_hash is required'; end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'valid token_hash is required'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'future expires_at is required'; end if;

  select * into v_code
  from public.device_auth_enrollment_codes
  where device_id = p_device_id
    and consumed_at is null
    and revoked_at is null
  order by created_at desc
  limit 1
  for update;

  if v_code.enrollment_id is null or v_code.expires_at <= now() then
    if v_code.enrollment_id is not null then
      update public.device_auth_enrollment_codes
      set revoked_at = coalesce(revoked_at, now()),
          metadata_json = metadata_json || jsonb_build_object('revoked_reason','expired')
      where enrollment_id = v_code.enrollment_id;
    end if;
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  if v_code.failed_attempts >= 10 then
    update public.device_auth_enrollment_codes
    set revoked_at = coalesce(revoked_at, now()),
        metadata_json = metadata_json || jsonb_build_object('revoked_reason','attempt_limit')
    where enrollment_id = v_code.enrollment_id;
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  if v_code.code_hash <> p_code_hash then
    v_failed_attempts := least(v_code.failed_attempts + 1, 10);
    update public.device_auth_enrollment_codes
    set failed_attempts = v_failed_attempts,
        last_failed_at = now(),
        revoked_at = case when v_failed_attempts >= 10 then now() else revoked_at end,
        metadata_json = case
          when v_failed_attempts >= 10 then metadata_json || jsonb_build_object('revoked_reason','attempt_limit')
          else metadata_json
        end
    where enrollment_id = v_code.enrollment_id;

    insert into public.device_auth_events(
      device_id, credential_id, event_type, success, reason,
      ip_hash, user_agent_hash, metadata_json
    ) values (
      p_device_id, null, 'device_enrollment_failed', false, 'invalid_code',
      p_ip_hash, p_user_agent_hash,
      jsonb_build_object('enrollment_id',v_code.enrollment_id,'failed_attempts',v_failed_attempts)
    );
    return jsonb_build_object('ok',false,'reason','invalid_or_expired');
  end if;

  update public.device_auth_credentials
  set revoked_at = now(), revoked_reason = 're_enrolled'
  where device_id = p_device_id and revoked_at is null;

  insert into public.device_auth_credentials(
    credential_id, device_id, token_hash, device_label,
    user_agent_hash, created_ip_hash, last_user_agent_hash, last_ip_hash,
    metadata_json, confirmed_at, last_used_at, expires_at
  ) values (
    p_credential_id, p_device_id, p_token_hash,
    nullif(left(btrim(coalesce(p_device_label,'')),160),''),
    p_user_agent_hash, p_ip_hash, p_user_agent_hash, p_ip_hash,
    coalesce(p_metadata_json,'{}'::jsonb), null, null, p_expires_at
  ) returning * into v_credential;

  update public.device_auth_enrollment_codes
  set consumed_at = now(), consumed_by_credential_id = v_credential.credential_id
  where enrollment_id = v_code.enrollment_id;

  insert into public.device_auth_events(
    device_id, credential_id, event_type, success, reason,
    ip_hash, user_agent_hash, metadata_json
  ) values (
    p_device_id, v_credential.credential_id, 'device_enrolled', true, null,
    p_ip_hash, p_user_agent_hash,
    coalesce(p_metadata_json,'{}'::jsonb) || jsonb_build_object('enrollment_id',v_code.enrollment_id)
  );

  return jsonb_build_object(
    'ok', true,
    'credential_id', v_credential.credential_id,
    'device_id', v_credential.device_id,
    'device_label', v_credential.device_label,
    'created_at', v_credential.created_at,
    'confirmed_at', v_credential.confirmed_at,
    'expires_at', v_credential.expires_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.device_auth_evaluate_and_enforce()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_active_devices integer;
  v_confirmed_devices integer;
  v_mode text;
  v_changed boolean := false;
begin
  select count(*) into v_active_devices
  from public.devices d
  where d.active=true and d.device_id ~ '^KIOSK_(0[2-9]|10)$';

  select count(distinct c.device_id) into v_confirmed_devices
  from public.device_auth_credentials c
  join public.devices d on d.id=c.device_id
  where d.active=true
    and d.device_id ~ '^KIOSK_(0[2-9]|10)$'
    and c.confirmed_at is not null
    and c.revoked_at is null
    and c.expires_at>now();

  select trim(both '"' from s.setting_value::text) into v_mode
  from public.system_settings s
  where s.setting_key='device_auth_rollout_mode';

  if v_mode='enroll' and v_active_devices=9 and v_confirmed_devices=v_active_devices then
    update public.system_settings
    set setting_value='"enforce"'::jsonb,
        description='Cryptographic device credentials are required for every employee kiosk. Enabled automatically after 9/9 confirmed enrollment.',
        updated_at=now()
    where setting_key='device_auth_rollout_mode';

    insert into public.release_validation_runs(release_id,area,status,details_json)
    values(
      'release-2026.07.16.foundation-stable.1',
      'device_credential_automatic_enforcement',
      'pass',
      jsonb_build_object(
        'active_employee_devices',v_active_devices,
        'confirmed_devices',v_confirmed_devices,
        'previous_mode',v_mode,
        'new_mode','enforce',
        'enabled_at',now()
      )
    );
    v_mode := 'enforce';
    v_changed := true;
  end if;

  return jsonb_build_object(
    'active_employee_devices',v_active_devices,
    'confirmed_devices',v_confirmed_devices,
    'mode',v_mode,
    'changed',v_changed
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.device_auth_issue_enrollment_code(p_device_id uuid, p_code_hash text, p_created_by text, p_expires_at timestamp with time zone, p_metadata_json jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(enrollment_id uuid, device_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_row public.device_auth_enrollment_codes%rowtype;
begin
  if p_device_id is null then raise exception 'device_id is required'; end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then raise exception 'valid code_hash is required'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'future expires_at is required'; end if;
  if not exists(select 1 from public.devices d where d.id = p_device_id and d.active = true) then
    raise exception 'active device not found';
  end if;

  update public.device_auth_enrollment_codes
  set revoked_at = now(),
      metadata_json = metadata_json || jsonb_build_object('revoked_reason','replaced')
  where device_id = p_device_id
    and consumed_at is null
    and revoked_at is null;

  insert into public.device_auth_enrollment_codes(
    device_id, code_hash, created_by, expires_at, metadata_json
  ) values (
    p_device_id, p_code_hash,
    coalesce(nullif(left(btrim(coalesce(p_created_by,'')),160),''),'ops_manager'),
    p_expires_at, coalesce(p_metadata_json,'{}'::jsonb)
  )
  returning * into v_row;

  return query select v_row.enrollment_id, v_row.device_id, v_row.expires_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.device_heartbeat(p_device_id text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_device_pk uuid;
  v_device_name text;
  v_now timestamptz := now();
begin
  select d.id, d.device_name
    into v_device_pk, v_device_name
  from public.devices d
  where d.device_id = p_device_id
  limit 1;

  if v_device_pk is null then
    raise exception 'Device not found: %', p_device_id;
  end if;

  update public.devices
  set
    last_seen_at = v_now,
    notes = coalesce(p_notes, notes),
    updated_at = now()
  where id = v_device_pk;

  insert into public.system_logs (
    level,
    source,
    message,
    device_id
  )
  values (
    'INFO',
    'device_heartbeat',
    'Device heartbeat received',
    v_device_pk
  );

  return jsonb_build_object(
    'device_id', p_device_id,
    'device_name', v_device_name,
    'last_seen_at', v_now,
    'ok', true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_session_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
                                                                                                                                                                        begin
                                                                                                                                                                          if tg_op = 'UPDATE' and old.status is distinct from new.status then
                                                                                                                                                                              if old.status = 'active' and new.status not in ('pending_submit', 'cancelled') then
                                                                                                                                                                                    raise exception 'Invalid session transition: active -> %', new.status;
                                                                                                                                                                                        end if;

                                                                                                                                                                                            if old.status = 'pending_submit' and new.status not in ('closed', 'cancelled') then
                                                                                                                                                                                                  raise exception 'Invalid session transition: pending_submit -> %', new.status;
                                                                                                                                                                                                      end if;

                                                                                                                                                                                                          if old.status = 'closed' and new.status <> 'closed' then
                                                                                                                                                                                                                raise exception 'Closed sessions cannot transition to %', new.status;
                                                                                                                                                                                                                    end if;

                                                                                                                                                                                                                        if old.status = 'cancelled' and new.status <> 'cancelled' then
                                                                                                                                                                                                                              raise exception 'Cancelled sessions cannot transition to %', new.status;
                                                                                                                                                                                                                                  end if;
                                                                                                                                                                                                                                    end if;

                                                                                                                                                                                                                                      return new;
                                                                                                                                                                                                                                      end;
                                                                                                                                                                                                                                      $function$;

CREATE OR REPLACE FUNCTION public.events_app_events_set_end_date()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.end_date is null then
    new.end_date := new.event_date;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.events_app_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_event_notification(p_event_id uuid, p_employee_id uuid, p_notification_kind text, p_status text, p_thread_id uuid DEFAULT NULL::uuid, p_response_message_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_row public.events_app_notification_log%rowtype;
begin
  if v_status not in ('sent', 'error') then
    raise exception 'status must be sent or error';
  end if;

  update public.events_app_notification_log log
  set status = v_status,
      thread_id = p_thread_id,
      response_message_id = p_response_message_id,
      sent_at = case when v_status = 'sent' then now() else log.sent_at end,
      notes = left(coalesce(p_notes, log.notes, ''), 4000),
      updated_at = now()
  where log.event_id = p_event_id
    and log.employee_id = p_employee_id
    and log.notification_kind = p_notification_kind
  returning * into v_row;

  if not found then
    raise exception 'Event notification claim was not found';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'response_message_id', v_row.response_message_id,
    'updated_at', v_row.updated_at
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.force_close_session(p_session_uuid text, p_closed_by text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_session_id uuid;
  v_location_id uuid;
  v_device_pk uuid;
  v_started_at timestamptz;
  v_ended_at timestamptz := now();
  v_duration_minutes integer;
  v_duration_display text;
  v_status text;
begin
  select s.id, s.location_id, s.device_id, s.started_at, s.status
    into v_session_id, v_location_id, v_device_pk, v_started_at, v_status
  from public.sessions s
  where s.session_uuid = p_session_uuid
    and s.status in ('active', 'pending_submit')
  limit 1;

  if v_session_id is null then
    raise exception 'Open session not found for session_uuid: %', p_session_uuid;
  end if;

  v_duration_minutes := greatest(0, round(extract(epoch from (v_ended_at - v_started_at)) / 60.0));
  v_duration_display := v_duration_minutes::text || ' min';

  update public.sessions
  set
    status = 'closed',
    ended_at = coalesce(ended_at, v_ended_at),
    duration_minutes = coalesce(duration_minutes, v_duration_minutes),
    duration_display = coalesce(duration_display, v_duration_display),
    completion_source = coalesce(completion_source, 'admin_force_close'),
    updated_at = now()
  where id = v_session_id;

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json
  )
  values (
    v_session_id,
    'session_force_closed',
    'admin',
    coalesce(nullif(trim(p_closed_by), ''), 'unknown'),
    jsonb_build_object(
      'reason', p_reason,
      'previous_status', v_status,
      'forced_at', v_ended_at
    )
  );

  insert into public.system_logs (
    level,
    source,
    message,
    session_id,
    location_id,
    device_id
  )
  values (
    'WARN',
    'force_close_session',
    'Session force-closed by admin',
    v_session_id,
    v_location_id,
    v_device_pk
  );

  return jsonb_build_object(
    'session_uuid', p_session_uuid,
    'status', 'closed',
    'closed_at', v_ended_at,
    'closed_by', coalesce(nullif(trim(p_closed_by), ''), 'unknown'),
    'reason', p_reason
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_last_cleaned(p_location text)
 RETURNS TABLE(location_code text, location_name text, cleaned_by text, started_at timestamp with time zone, ended_at timestamp with time zone, duration_minutes integer, duration_display text, device_id text, status text)
 LANGUAGE sql
 STABLE
AS $function$
  select
    v.location_code,
    v.location_name,
    v.cleaned_by,
    v.started_at,
    v.ended_at,
    v.duration_minutes,
    v.duration_display,
    v.device_id,
    v.status
  from public.v_last_cleaned_by_location v
  where v.rn = 1
    and (
      v.location_name ilike p_location
      or v.location_code ilike p_location
      or v.location_name ilike '%' || p_location || '%'
      or v.location_code ilike '%' || p_location || '%'
    )
  order by v.location_name
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_setting(p_setting_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select ss.setting_value
  from public.system_settings ss
  where ss.setting_key = p_setting_key
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_setting_int(p_setting_key text, p_default integer DEFAULT 0)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (
      select case
        when jsonb_typeof(ss.setting_value) = 'number' then (ss.setting_value #>> '{}')::integer
        when jsonb_typeof(ss.setting_value) = 'string'
          and (ss.setting_value #>> '{}') ~ '^-?\d+$'
          then (ss.setting_value #>> '{}')::integer
        else null
      end
      from public.system_settings ss
      where ss.setting_key = p_setting_key
      limit 1
    ),
    p_default
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_approved_device(p_device_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1
    from public.devices d
    where d.device_id = p_device_id
      and d.active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.list_active_devices()
 RETURNS TABLE(device_id text, device_name text, active boolean, assigned_employee_name text, last_seen_at timestamp with time zone, notes text)
 LANGUAGE sql
 STABLE
AS $function$
  select
    d.device_id,
    d.device_name,
    d.active,
    e.display_name as assigned_employee_name,
    d.last_seen_at,
    d.notes
  from public.devices d
  left join public.employees e on e.id = d.assigned_employee_id
  where d.active = true
  order by d.device_id;
$function$;

CREATE OR REPLACE FUNCTION public.list_active_employees()
 RETURNS TABLE(employee_code text, display_name text, role text, active boolean)
 LANGUAGE sql
 STABLE
AS $function$
  select
    e.employee_code,
    e.display_name,
    e.role,
    e.active
  from public.employees e
  where e.active = true
  order by e.display_name;
$function$;

CREATE OR REPLACE FUNCTION public.list_device_notification_acknowledgements(p_device_identifier text, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
  v_limit integer := greatest(1, least(coalesce(p_limit,500), 2000));
  v_result jsonb;
begin
  if v_requested is null or length(v_requested) > 200 then
    raise exception 'device_identifier is required and must be at most 200 characters';
  end if;

  select d.device_id into v_device
  from public.devices d
  where d.active = true and upper(btrim(d.device_id)) = upper(v_requested)
  limit 1;

  if v_device is null then
    select d.device_id into v_device
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active = true
    where da.active = true and upper(btrim(da.alias_identifier)) = upper(v_requested)
    limit 1;
  end if;

  if v_device is null then raise exception 'Active device not found: %', v_requested; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
    into v_result
  from (
    select notification_key, notification_type, displayed_at, dismissed_at,
           opened_at, acknowledged_at, updated_at
    from public.device_notification_acknowledgements
    where device_identifier = v_device
      and acknowledged_at is not null
    order by updated_at desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'device_identifier', v_device,
    'acknowledgements', v_result
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.list_open_sessions()
 RETURNS TABLE(session_uuid text, location_code text, location_name text, employee_name text, device_id text, status text, started_at timestamp with time zone, ended_at timestamp with time zone, duration_minutes integer, duration_display text)
 LANGUAGE sql
 STABLE
AS $function$
  select
    s.session_uuid,
    l.location_code,
    l.location_name,
    e.display_name as employee_name,
    d.device_id,
    s.status,
    s.started_at,
    s.ended_at,
    s.duration_minutes,
    s.duration_display
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.devices d on d.id = s.device_id
  where s.status in ('active', 'pending_submit')
  order by s.started_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.msg_acknowledge_message(p_message_id uuid, p_user_id uuid, p_device_identifier text)
 RETURNS msg_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),displayed_at=coalesce(displayed_at,now()),read_at=coalesce(read_at,now()),acknowledged_at=coalesce(acknowledged_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')),'')
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if; return v_receipt;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_cleanup_deleted_messages()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_deleted_count integer := 0;
begin
  with eligible as (
    select m.id
    from public.msg_messages m
    join public.msg_threads t on t.id = m.thread_id
    where m.is_deleted = false
      and (
        m.sent_at < now() - interval '14 days'
        or not exists (
          select 1
          from public.msg_thread_participants tp
          where tp.thread_id = m.thread_id
            and tp.left_at is null
            and not exists (
              select 1
              from public.msg_message_deletions md
              where md.message_id = m.id
                and md.user_id = tp.user_id
            )
        )
      )
  ), deleted_receipts as (
    delete from public.msg_receipts r
    where r.message_id in (select id from eligible)
  ), deleted_marks as (
    delete from public.msg_message_deletions md
    where md.message_id in (select id from eligible)
  ), deleted_messages as (
    delete from public.msg_messages m
    where m.id in (select id from eligible)
    returning m.id
  )
  select count(*) into v_deleted_count from deleted_messages;

  update public.msg_threads t
  set last_message_at = latest.last_message_at,
      updated_at = now()
  from (
    select th.id as thread_id,
           max(m.sent_at) as last_message_at
    from public.msg_threads th
    left join public.msg_messages m on m.thread_id = th.id and m.is_deleted = false
    group by th.id
  ) latest
  where latest.thread_id = t.id;

  return v_deleted_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_create_group_thread(p_created_by_user_id uuid, p_title text, p_member_user_ids uuid[])
 RETURNS msg_threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_thread public.msg_threads%rowtype;
  v_member_id uuid;
  v_title text;
  v_member_ids uuid[];
begin
  if p_created_by_user_id is null then
    raise exception 'created_by_user_id is required.';
  end if;
  if not exists (select 1 from public.msg_users where id = p_created_by_user_id and is_active = true) then
    raise exception 'Creator not found or inactive.';
  end if;

  v_member_ids := array(
    select distinct x
    from unnest(coalesce(p_member_user_ids, array[]::uuid[])) as x
    where x is not null
      and x <> p_created_by_user_id
  );

  if coalesce(array_length(v_member_ids, 1), 0) < 2 then
    raise exception 'Group thread requires at least two additional members.';
  end if;

  if exists (
    select 1
    from unnest(v_member_ids) as x
    where not exists (select 1 from public.msg_users mu where mu.id = x and mu.is_active = true)
  ) then
    raise exception 'One or more selected members are invalid or inactive.';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');

  insert into public.msg_threads (thread_type, title, created_by_user_id, is_active)
  values ('group', case when v_title is null then null else left(v_title, 120) end, p_created_by_user_id, true)
  returning * into v_thread;

  insert into public.msg_thread_participants (thread_id, user_id)
  values (v_thread.id, p_created_by_user_id);

  foreach v_member_id in array v_member_ids
  loop
    insert into public.msg_thread_participants (thread_id, user_id)
    values (v_thread.id, v_member_id)
    on conflict (thread_id, user_id) do nothing;
  end loop;

  return v_thread;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_delete_message(p_message_id uuid, p_request_user_id uuid)
 RETURNS msg_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_message public.msg_messages%rowtype;
  v_request_role text;
begin
  if p_message_id is null or p_request_user_id is null then
    raise exception 'message_id and request_user_id are required.';
  end if;

  select role into v_request_role
  from public.msg_users
  where id = p_request_user_id
    and is_active = true
  limit 1;

  if v_request_role is null then
    raise exception 'Requesting user not found or inactive.';
  end if;

  select * into v_message
  from public.msg_messages
  where id = p_message_id
  limit 1;

  if v_message.id is null then
    raise exception 'Message not found.';
  end if;

  if v_message.sender_user_id <> p_request_user_id and v_request_role not in ('manager','admin') then
    raise exception 'Only the sender or a manager/admin can delete this message.';
  end if;

  update public.msg_messages
  set is_deleted = true,
      body = '[deleted]',
      metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object('deleted_by', p_request_user_id, 'deleted_at', now())
  where id = p_message_id
  returning * into v_message;

  return v_message;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_delete_thread_permanently(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_deleted_threads integer := 0;
  v_deleted_messages integer := 0;
  v_deleted_receipts integer := 0;
  v_deleted_message_deletions integer := 0;
  v_deleted_hidden_rows integer := 0;
  v_deleted_participants integer := 0;
begin
  if p_thread_id is null then
    raise exception 'p_thread_id is required';
  end if;

  with target_messages as (
    select id
    from public.msg_messages
    where thread_id = p_thread_id
  ),
  del_receipts as (
    delete from public.msg_receipts r
    where r.message_id in (select id from target_messages)
    returning 1
  ),
  del_message_deletions as (
    delete from public.msg_message_deletions d
    where d.message_id in (select id from target_messages)
    returning 1
  ),
  del_messages as (
    delete from public.msg_messages m
    where m.thread_id = p_thread_id
    returning 1
  ),
  del_hidden as (
    delete from public.msg_hidden_threads_by_device h
    where h.thread_id = p_thread_id
    returning 1
  ),
  del_participants as (
    delete from public.msg_thread_participants p
    where p.thread_id = p_thread_id
    returning 1
  ),
  del_thread as (
    delete from public.msg_threads t
    where t.id = p_thread_id
    returning 1
  )
  select
    (select count(*) from del_thread),
    (select count(*) from del_messages),
    (select count(*) from del_receipts),
    (select count(*) from del_message_deletions),
    (select count(*) from del_hidden),
    (select count(*) from del_participants)
  into
    v_deleted_threads,
    v_deleted_messages,
    v_deleted_receipts,
    v_deleted_message_deletions,
    v_deleted_hidden_rows,
    v_deleted_participants;

  return jsonb_build_object(
    'thread_id', p_thread_id,
    'deleted_threads', v_deleted_threads,
    'deleted_messages', v_deleted_messages,
    'deleted_receipts', v_deleted_receipts,
    'deleted_message_deletions', v_deleted_message_deletions,
    'deleted_hidden_rows', v_deleted_hidden_rows,
    'deleted_participants', v_deleted_participants
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_get_memphis_thread_context(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (
      select jsonb_build_object(
        'last_intent', last_intent,
        'last_employee_name', last_employee_name,
        'last_group_name', last_group_name,
        'last_location_code', last_location_code,
        'last_service_date', last_service_date,
        'last_subject_type', last_subject_type,
        'context_json', context_json,
        'updated_at', updated_at
      )
      from public.msg_memphis_thread_context
      where thread_id = p_thread_id
    ),
    '{}'::jsonb
  );
$function$;

CREATE OR REPLACE FUNCTION public.msg_get_memphis_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select mu.id
  from public.msg_users mu
  where mu.display_name = 'Memphis'
    and mu.role = 'bot'
    and mu.is_active = true
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.msg_get_or_create_direct_thread(p_user_a uuid, p_user_b uuid)
 RETURNS msg_threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_thread public.msg_threads%rowtype;
begin
  if p_user_a is null or p_user_b is null then
    raise exception 'Both users are required.';
  end if;
  if p_user_a = p_user_b then
    raise exception 'Direct thread requires two different users.';
  end if;
  if not exists (select 1 from public.msg_users where id = p_user_a and is_active = true) then
    raise exception 'User A not found or inactive.';
  end if;
  if not exists (select 1 from public.msg_users where id = p_user_b and is_active = true) then
    raise exception 'User B not found or inactive.';
  end if;

  select t.* into v_thread
  from public.msg_threads t
  join public.msg_thread_participants p1 on p1.thread_id = t.id and p1.user_id = p_user_a and p1.left_at is null
  join public.msg_thread_participants p2 on p2.thread_id = t.id and p2.user_id = p_user_b and p2.left_at is null
  where t.thread_type = 'direct'
    and t.is_active = true
    and 2 = (
      select count(*)
      from public.msg_thread_participants px
      where px.thread_id = t.id and px.left_at is null
    )
  order by t.created_at asc
  limit 1;

  if v_thread.id is not null then
    return v_thread;
  end if;

  insert into public.msg_threads (thread_type, title, created_by_user_id, is_active)
  values ('direct', null, p_user_a, true)
  returning * into v_thread;

  insert into public.msg_thread_participants (thread_id, user_id)
  values (v_thread.id, p_user_a), (v_thread.id, p_user_b);

  return v_thread;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_get_user_by_device(p_device_identifier text)
 RETURNS TABLE(msg_user_id uuid, display_name text, role text, device_identifier text, is_active boolean)
 LANGUAGE sql
 STABLE
AS $function$
  select mu.id as msg_user_id,
         mu.display_name,
         mu.role,
         mda.device_identifier,
         mda.is_active
  from public.msg_device_assignments mda
  join public.msg_users mu on mu.id = mda.msg_user_id
  where mda.device_identifier = btrim(coalesce(p_device_identifier, ''))
    and mda.is_active = true
    and mu.is_active = true
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.msg_hide_thread_for_device(p_thread_id uuid, p_device_identifier text)
 RETURNS msg_hidden_threads_by_device
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_row public.msg_hidden_threads_by_device%rowtype;
  v_device text;
begin
  v_device := btrim(coalesce(p_device_identifier, ''));
  if p_thread_id is null or v_device = '' then
    raise exception 'thread_id and device_identifier are required.';
  end if;

  insert into public.msg_hidden_threads_by_device (thread_id, device_identifier, hidden_at)
  values (p_thread_id, v_device, now())
  on conflict (thread_id, device_identifier) do update
  set hidden_at = excluded.hidden_at
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_is_runtime_identity(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select exists (
    select 1
    from public.msg_users mu
    left join public.employees e on e.id = mu.employee_id
    where mu.id = p_user_id
      and mu.is_active = true
      and (
        (mu.role = 'bot' and lower(btrim(mu.display_name)) = 'memphis')
        or (mu.role = 'employee' and e.id is not null and e.active = true)
        or (
          mu.role = 'manager'
          and mu.employee_id is null
          and lower(btrim(mu.display_name)) = 'ops manager'
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.msg_is_runtime_user(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select exists (
    select 1
    from public.msg_users mu
    left join public.employees e on e.id = mu.employee_id
    where mu.id = p_user_id
      and mu.is_active = true
      and (
        (mu.role = 'bot' and lower(btrim(mu.display_name)) = 'memphis')
        or (
          mu.role in ('manager','ops','ops_manager','operations_manager')
          and mu.employee_id is null
        )
        or (
          mu.role = 'employee'
          and e.id is not null
          and e.active = true
          and coalesce(e.employee_code, '') ~ '^EMP[0-9]+'
          and exists (
            select 1
            from public.msg_device_assignments mda
            where mda.msg_user_id = mu.id
              and mda.is_active = true
          )
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.msg_list_thread_messages(p_thread_id uuid, p_user_id uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, thread_id uuid, sender_user_id uuid, sender_display_name text, sender_role text, message_type text, body text, metadata_json jsonb, sent_at timestamp with time zone, created_at timestamp with time zone, is_deleted boolean, delivered_at timestamp with time zone, read_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  with visibility as (
    select max(v.hidden_before) as hidden_before
    from public.msg_thread_visibility v
    where v.thread_id = p_thread_id
      and v.user_id = p_user_id
  )
  select *
  from (
    select
      m.id,
      m.thread_id,
      m.sender_user_id,
      mu.display_name as sender_display_name,
      mu.role as sender_role,
      m.message_type,
      m.body,
      m.metadata_json,
      m.sent_at,
      m.created_at,
      m.is_deleted,
      r.delivered_at,
      r.read_at
    from public.msg_messages m
    join public.msg_users mu on mu.id = m.sender_user_id
    left join public.msg_receipts r on r.message_id = m.id and r.user_id = p_user_id
    cross join visibility v
    where m.thread_id = p_thread_id
      and m.is_deleted = false
      and (v.hidden_before is null or m.sent_at > v.hidden_before)
      and (
        p_before is null
        or m.sent_at < p_before
      )
      and exists (
        select 1
        from public.msg_thread_participants tp
        where tp.thread_id = p_thread_id
          and tp.user_id = p_user_id
          and tp.left_at is null
      )
    order by m.sent_at desc, m.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x
  order by x.sent_at asc, x.created_at asc;
$function$;

CREATE OR REPLACE FUNCTION public.msg_list_threads(p_user_id uuid)
 RETURNS TABLE(thread_id uuid, thread_type text, thread_title text, last_message_at timestamp with time zone, updated_at timestamp with time zone, last_message_id uuid, last_message_body text, last_message_type text, last_sender_name text, unread_count integer)
 LANGUAGE sql
 STABLE
AS $function$
  with visibility as (
    select thread_id, max(hidden_before) as hidden_before
    from public.msg_thread_visibility
    where user_id = p_user_id
    group by thread_id
  )
  select
    t.id as thread_id,
    t.thread_type,
    coalesce(
      nullif(
        case
          when t.thread_type = 'group' and coalesce(nullif(t.title, ''), '') = 'Group Chat' then null
          else t.title
        end,
        ''
      ),
      case
        when t.thread_type = 'direct' then direct_name.display_name
        when t.thread_type = 'bot' then 'Memphis'
        when t.thread_type = 'group' then (
          case
            when group_info.participant_count > 0 and group_info.participant_count = totals.total_other_users then 'Everyone'
            else coalesce(group_info.display_names, 'Group Chat')
          end
        )
        else 'Broadcast'
      end
    ) as thread_title,
    latest.last_message_at,
    t.updated_at,
    latest.last_message_id,
    latest.last_message_body,
    latest.last_message_type,
    latest.last_sender_name,
    coalesce(unread.unread_count, 0)::int as unread_count
  from public.msg_threads t
  join public.msg_thread_participants tp on tp.thread_id = t.id and tp.user_id = p_user_id and tp.left_at is null
  left join visibility vis on vis.thread_id = t.id
  left join lateral (
    select mu.display_name
    from public.msg_thread_participants tp2
    join public.msg_users mu on mu.id = tp2.user_id
    where tp2.thread_id = t.id
      and tp2.user_id <> p_user_id
      and tp2.left_at is null
    order by mu.display_name
    limit 1
  ) direct_name on true
  left join lateral (
    select
      string_agg(mu.display_name, ', ' order by mu.display_name) as display_names,
      count(*)::int as participant_count
    from public.msg_thread_participants tp3
    join public.msg_users mu on mu.id = tp3.user_id
    where tp3.thread_id = t.id
      and tp3.left_at is null
      and tp3.user_id <> p_user_id
      and mu.is_active = true
      and mu.role <> 'bot'
  ) group_info on true
  left join lateral (
    select count(*)::int as total_other_users
    from public.msg_users mu_all
    where mu_all.is_active = true
      and mu_all.role <> 'bot'
      and mu_all.id <> p_user_id
  ) totals on true
  left join lateral (
    select
      m.id as last_message_id,
      m.body as last_message_body,
      m.message_type as last_message_type,
      m.sent_at as last_message_at,
      sender.display_name as last_sender_name
    from public.msg_messages m
    join public.msg_users sender on sender.id = m.sender_user_id
    where m.thread_id = t.id
      and m.is_deleted = false
      and (vis.hidden_before is null or m.sent_at > vis.hidden_before)
    order by m.sent_at desc, m.created_at desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*) as unread_count
    from public.msg_receipts r
    join public.msg_messages m2 on m2.id = r.message_id
    where r.user_id = p_user_id
      and r.read_at is null
      and m2.thread_id = t.id
      and m2.is_deleted = false
      and (vis.hidden_before is null or m2.sent_at > vis.hidden_before)
  ) unread on true
  where t.is_active = true
  order by coalesce(latest.last_message_at, t.updated_at, t.created_at) desc, t.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.msg_mark_message_delivered(p_message_id uuid, p_user_id uuid, p_device_identifier text)
 RETURNS msg_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')),''),last_delivery_attempt_at=now(),delivery_attempts=delivery_attempts+1
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if; return v_receipt;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_mark_message_displayed(p_message_id uuid, p_user_id uuid, p_device_identifier text)
 RETURNS msg_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare v_receipt public.msg_receipts%rowtype;
begin
  update public.msg_receipts set delivered_at=coalesce(delivered_at,now()),displayed_at=coalesce(displayed_at,now()),delivery_device_identifier=nullif(btrim(coalesce(p_device_identifier,'')),''),last_delivery_attempt_at=now(),delivery_attempts=delivery_attempts+1
  where message_id=p_message_id and user_id=p_user_id returning * into v_receipt;
  if not found then raise exception 'Message receipt not found.'; end if; return v_receipt;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_mark_messages_delivered(p_thread_id uuid, p_user_id uuid, p_message_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id
    and (coalesce(array_length(p_message_ids, 1), 0) = 0 or m.id = any(p_message_ids));
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

CREATE OR REPLACE FUNCTION public.msg_mark_messages_displayed(p_thread_id uuid, p_user_id uuid, p_message_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now()),
      displayed_at = coalesce(r.displayed_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id
    and (coalesce(array_length(p_message_ids, 1), 0) = 0 or m.id = any(p_message_ids));
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

CREATE OR REPLACE FUNCTION public.msg_mark_thread_read(p_thread_id uuid, p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then raise exception 'thread_id and user_id are required.'; end if;
  update public.msg_receipts r
  set delivered_at = coalesce(r.delivered_at, now()),
      displayed_at = coalesce(r.displayed_at, now()),
      read_at = coalesce(r.read_at, now())
  from public.msg_messages m
  where r.message_id = m.id
    and r.user_id = p_user_id
    and m.thread_id = p_thread_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

CREATE OR REPLACE FUNCTION public.msg_purge_fully_hidden_threads()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_deleted_threads integer := 0;
  v_deleted_messages integer := 0;
  v_deleted_hides integer := 0;
  v_deleted_participants integer := 0;
  v_deleted_receipts integer := 0;
  v_deleted_message_deletions integer := 0;
begin
  with participant_device_counts as (
    select
      tp.thread_id,
      count(distinct da.device_identifier) filter (where da.is_active = true) as participant_device_count
    from public.msg_thread_participants tp
    left join public.msg_device_assignments da
      on da.msg_user_id = tp.user_id
    where tp.left_at is null
    group by tp.thread_id
  ),
  hidden_device_counts as (
    select
      h.thread_id,
      count(distinct h.device_identifier) as hidden_device_count
    from public.msg_hidden_threads_by_device h
    group by h.thread_id
  ),
  doomed as (
    select t.id
    from public.msg_threads t
    join participant_device_counts pdc on pdc.thread_id = t.id
    join hidden_device_counts hdc on hdc.thread_id = t.id
    where pdc.participant_device_count > 0
      and hdc.hidden_device_count >= pdc.participant_device_count
  ),
  del_receipts as (
    delete from public.msg_receipts r
    where r.message_id in (select m.id from public.msg_messages m where m.thread_id in (select id from doomed))
    returning 1
  ),
  del_msg_deletions as (
    delete from public.msg_message_deletions d
    where d.message_id in (select m.id from public.msg_messages m where m.thread_id in (select id from doomed))
    returning 1
  ),
  del_messages as (
    delete from public.msg_messages m
    where m.thread_id in (select id from doomed)
    returning 1
  ),
  del_hides as (
    delete from public.msg_hidden_threads_by_device h
    where h.thread_id in (select id from doomed)
    returning 1
  ),
  del_participants as (
    delete from public.msg_thread_participants p
    where p.thread_id in (select id from doomed)
    returning 1
  ),
  del_threads as (
    delete from public.msg_threads t
    where t.id in (select id from doomed)
    returning 1
  )
  select
    (select count(*) from del_threads),
    (select count(*) from del_messages),
    (select count(*) from del_hides),
    (select count(*) from del_participants),
    (select count(*) from del_receipts),
    (select count(*) from del_msg_deletions)
  into
    v_deleted_threads,
    v_deleted_messages,
    v_deleted_hides,
    v_deleted_participants,
    v_deleted_receipts,
    v_deleted_message_deletions;

  return jsonb_build_object(
    'deleted_threads', v_deleted_threads,
    'deleted_messages', v_deleted_messages,
    'deleted_hidden_rows', v_deleted_hides,
    'deleted_participants', v_deleted_participants,
    'deleted_receipts', v_deleted_receipts,
    'deleted_message_deletions', v_deleted_message_deletions
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_purge_messages_older_than_14_days()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_deleted_messages integer := 0;
  v_deleted_threads integer := 0;
  v_deleted_receipts integer := 0;
  v_deleted_message_deletions integer := 0;
  v_deleted_hides integer := 0;
  v_deleted_participants integer := 0;
begin
  with old_messages as (
    select id, thread_id
    from public.msg_messages
    where coalesce(sent_at, created_at) < now() - interval '14 days'
  ),
  del_receipts as (
    delete from public.msg_receipts r
    where r.message_id in (select id from old_messages)
    returning 1
  ),
  del_msg_deletions as (
    delete from public.msg_message_deletions d
    where d.message_id in (select id from old_messages)
    returning 1
  ),
  del_messages as (
    delete from public.msg_messages m
    where m.id in (select id from old_messages)
    returning thread_id
  ),
  empty_threads as (
    select t.id
    from public.msg_threads t
    left join public.msg_messages m on m.thread_id = t.id
    group by t.id
    having count(m.id) = 0
  ),
  del_hides as (
    delete from public.msg_hidden_threads_by_device h
    where h.thread_id in (select id from empty_threads)
    returning 1
  ),
  del_participants as (
    delete from public.msg_thread_participants p
    where p.thread_id in (select id from empty_threads)
    returning 1
  ),
  del_threads as (
    delete from public.msg_threads t
    where t.id in (select id from empty_threads)
    returning 1
  )
  select
    (select count(*) from del_messages),
    (select count(*) from del_threads),
    (select count(*) from del_receipts),
    (select count(*) from del_msg_deletions),
    (select count(*) from del_hides),
    (select count(*) from del_participants)
  into
    v_deleted_messages,
    v_deleted_threads,
    v_deleted_receipts,
    v_deleted_message_deletions,
    v_deleted_hides,
    v_deleted_participants;

  return jsonb_build_object(
    'deleted_messages', v_deleted_messages,
    'deleted_threads', v_deleted_threads,
    'deleted_receipts', v_deleted_receipts,
    'deleted_message_deletions', v_deleted_message_deletions,
    'deleted_hidden_rows', v_deleted_hides,
    'deleted_participants', v_deleted_participants
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_send_message(p_thread_id uuid, p_sender_user_id uuid, p_body text, p_message_type text DEFAULT 'text'::text, p_metadata_json jsonb DEFAULT '{}'::jsonb)
 RETURNS msg_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_message public.msg_messages%rowtype;
  v_metadata jsonb := coalesce(p_metadata_json, '{}'::jsonb);
  v_client_message_id text := nullif(btrim(coalesce(p_metadata_json->>'client_message_id', '')), '');
  v_source text := lower(btrim(coalesce(p_metadata_json->>'source', '')));
  v_event_id text := nullif(btrim(coalesce(p_metadata_json->>'event_id', '')), '');
  v_dedupe_key text := nullif(btrim(coalesce(
    p_metadata_json->>'notification_instance_key',
    p_metadata_json->>'instance_key',
    p_metadata_json->>'notification_key',
    p_metadata_json->>'alert_key',
    p_metadata_json->>'reminder_key',
    ''
  )), '');
begin
  if p_thread_id is null then raise exception 'thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Message body is required.'; end if;
  if length(p_body) > 2000 then raise exception 'Message body cannot exceed 2000 characters.'; end if;
  if v_client_message_id is not null and length(v_client_message_id) > 200 then
    raise exception 'client_message_id cannot exceed 200 characters.';
  end if;
  if not exists (
    select 1 from public.msg_thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_sender_user_id
      and tp.left_at is null
  ) then
    raise exception 'Sender is not an active participant in this thread.';
  end if;

  if v_dedupe_key is null and v_source = 'events_app' and v_event_id is not null then
    v_dedupe_key := 'event:' || v_event_id;
  end if;

  if v_dedupe_key is not null then
    if length(v_dedupe_key) > 500 then raise exception 'notification instance key cannot exceed 500 characters'; end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'message-notification:' || p_thread_id::text || ':' || p_sender_user_id::text || ':' || v_dedupe_key,
      0
    ));
    select * into v_message
    from public.msg_messages m
    where m.thread_id = p_thread_id
      and m.sender_user_id = p_sender_user_id
      and m.is_deleted = false
      and (
        m.metadata_json->>'notification_instance_key' = v_dedupe_key
        or (v_source = 'events_app' and v_event_id is not null
            and coalesce(m.metadata_json->>'source','') = 'events_app'
            and m.metadata_json->>'event_id' = v_event_id)
      )
    order by m.sent_at
    limit 1;
    if found then return v_message; end if;
    v_metadata := v_metadata || jsonb_build_object('notification_instance_key', v_dedupe_key);
  end if;

  if v_client_message_id is not null then
    select * into v_message
    from public.msg_messages m
    where m.sender_user_id = p_sender_user_id
      and m.client_message_id = v_client_message_id
    limit 1;
    if found then return v_message; end if;
  end if;

  insert into public.msg_messages(
    thread_id, sender_user_id, message_type, body, metadata_json, client_message_id
  ) values (
    p_thread_id,
    p_sender_user_id,
    coalesce(nullif(btrim(p_message_type), ''), 'text'),
    btrim(p_body),
    v_metadata,
    v_client_message_id
  ) returning * into v_message;

  insert into public.msg_receipts(message_id, user_id, delivered_at, displayed_at, read_at, acknowledged_at)
  select v_message.id, tp.user_id, null, null, null, null
  from public.msg_thread_participants tp
  where tp.thread_id = p_thread_id
    and tp.left_at is null
    and tp.user_id <> p_sender_user_id
  on conflict (message_id, user_id) do nothing;

  update public.msg_threads
  set last_message_at = v_message.sent_at, updated_at = now()
  where id = p_thread_id;

  return v_message;
exception
  when unique_violation then
    if v_client_message_id is not null then
      select * into v_message
      from public.msg_messages m
      where m.sender_user_id = p_sender_user_id
        and m.client_message_id = v_client_message_id
      limit 1;
      if found then return v_message; end if;
    end if;
    if v_dedupe_key is not null then
      select * into v_message
      from public.msg_messages m
      where m.thread_id = p_thread_id
        and m.sender_user_id = p_sender_user_id
        and m.metadata_json->>'notification_instance_key' = v_dedupe_key
      limit 1;
      if found then return v_message; end if;
    end if;
    raise;
end
$function$;

CREATE OR REPLACE FUNCTION public.msg_send_message(p_thread_id uuid, p_sender_user_id uuid, p_body text, p_message_type text, p_metadata_json jsonb, p_client_message_id text)
 RETURNS msg_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare v_message public.msg_messages%rowtype;
begin
  if p_thread_id is null then raise exception 'thread_id is required.'; end if;
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'Message body is required.'; end if;
  if length(p_body)>4000 then raise exception 'Message body cannot exceed 4000 characters.'; end if;
  if not exists(select 1 from public.msg_thread_participants tp where tp.thread_id=p_thread_id and tp.user_id=p_sender_user_id and tp.left_at is null) then raise exception 'Sender is not an active participant in this thread.'; end if;
  if nullif(btrim(coalesce(p_client_message_id,'')),'') is not null then
    select * into v_message from public.msg_messages where client_message_id=btrim(p_client_message_id) limit 1;
    if found then
      if v_message.thread_id<>p_thread_id or v_message.sender_user_id<>p_sender_user_id then raise exception 'client_message_id belongs to another message.'; end if;
      return v_message;
    end if;
  end if;
  insert into public.msg_messages(thread_id,sender_user_id,message_type,body,metadata_json,client_message_id)
  values(p_thread_id,p_sender_user_id,coalesce(nullif(btrim(p_message_type),''),'text'),btrim(p_body),coalesce(p_metadata_json,'{}'::jsonb),nullif(btrim(coalesce(p_client_message_id,'')),'')) returning * into v_message;
  insert into public.msg_receipts(message_id,user_id,queued_at,delivered_at,displayed_at,read_at)
  select v_message.id,tp.user_id,now(),null,null,null from public.msg_thread_participants tp
  where tp.thread_id=p_thread_id and tp.left_at is null and tp.user_id<>p_sender_user_id
  on conflict(message_id,user_id) do nothing;
  update public.msg_threads set last_message_at=v_message.sent_at,updated_at=now() where id=p_thread_id;
  return v_message;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_set_memphis_thread_context(p_thread_id uuid, p_last_intent text DEFAULT NULL::text, p_last_employee_name text DEFAULT NULL::text, p_last_group_name text DEFAULT NULL::text, p_last_location_code text DEFAULT NULL::text, p_last_service_date date DEFAULT NULL::date, p_last_subject_type text DEFAULT NULL::text, p_context_json jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_row public.msg_memphis_thread_context%rowtype;
begin
  if p_thread_id is null then
    raise exception 'p_thread_id is required';
  end if;

  insert into public.msg_memphis_thread_context (
    thread_id, last_intent, last_employee_name, last_group_name, last_location_code,
    last_service_date, last_subject_type, context_json, updated_at
  )
  values (
    p_thread_id, p_last_intent, p_last_employee_name, p_last_group_name, p_last_location_code,
    p_last_service_date, p_last_subject_type, coalesce(p_context_json, '{}'::jsonb), now()
  )
  on conflict (thread_id)
  do update set
    last_intent = coalesce(excluded.last_intent, public.msg_memphis_thread_context.last_intent),
    last_employee_name = coalesce(excluded.last_employee_name, public.msg_memphis_thread_context.last_employee_name),
    last_group_name = coalesce(excluded.last_group_name, public.msg_memphis_thread_context.last_group_name),
    last_location_code = coalesce(excluded.last_location_code, public.msg_memphis_thread_context.last_location_code),
    last_service_date = coalesce(excluded.last_service_date, public.msg_memphis_thread_context.last_service_date),
    last_subject_type = coalesce(excluded.last_subject_type, public.msg_memphis_thread_context.last_subject_type),
    context_json = coalesce(excluded.context_json, public.msg_memphis_thread_context.context_json),
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'thread_id', v_row.thread_id,
    'last_intent', v_row.last_intent,
    'last_employee_name', v_row.last_employee_name,
    'last_group_name', v_row.last_group_name,
    'last_location_code', v_row.last_location_code,
    'last_service_date', v_row.last_service_date,
    'last_subject_type', v_row.last_subject_type,
    'context_json', v_row.context_json,
    'updated_at', v_row.updated_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_unhide_thread_for_device(p_thread_id uuid, p_device_identifier text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_count integer := 0;
  v_device text;
begin
  v_device := btrim(coalesce(p_device_identifier, ''));
  if p_thread_id is null or v_device = '' then
    return 0;
  end if;

  delete from public.msg_hidden_threads_by_device
  where thread_id = p_thread_id
    and device_identifier = v_device;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_daily_schedule_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.assigned_employee_id is not null and exists (
    select 1 from public.daily_schedule_assignments existing
    where existing.service_date = new.service_date
      and existing.assigned_employee_id = new.assigned_employee_id
      and existing.location_group_id = new.location_group_id
      and existing.coverage_start = new.coverage_start
      and existing.coverage_end = new.coverage_end
      and coalesce(existing.coverage_purpose, '') = coalesce(new.coverage_purpose, '')
      and coalesce(existing.owner_type, '') = coalesce(new.owner_type, '')
      and existing.status = new.status
  ) then
    return null;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.purge_closed_scan_history_before(p_cutoff timestamp with time zone, p_requested_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_session_events_deleted integer := 0;
  v_scan_events_deleted integer := 0;
  v_system_logs_deleted integer := 0;
  v_completion_deleted integer := 0;
  v_sessions_deleted integer := 0;
  v_nullified_open_tickets integer := 0;
begin
  if p_cutoff is null then
    raise exception 'Cutoff timestamp is required';
  end if;

  with target_sessions as (
    select s.id
    from public.sessions s
    where s.status = 'closed'
      and coalesce(s.ended_at, s.started_at, s.created_at) < p_cutoff
  ), nullified_tickets as (
    update public.maintenance_tickets mt
    set
      session_id = null,
      completion_response_id = null
    where mt.status = 'open'
      and (
        mt.session_id in (select id from target_sessions)
        or mt.completion_response_id in (
          select cr.id
          from public.completion_responses cr
          where cr.session_id in (select id from target_sessions)
        )
      )
    returning mt.id
  )
  select count(*) into v_nullified_open_tickets from nullified_tickets;

  with target_sessions as (
    select s.id
    from public.sessions s
    where s.status = 'closed'
      and coalesce(s.ended_at, s.started_at, s.created_at) < p_cutoff
  ), deleted_rows as (
    delete from public.session_events se
    where se.session_id in (select id from target_sessions)
    returning se.id
  )
  select count(*) into v_session_events_deleted from deleted_rows;

  with target_sessions as (
    select s.id
    from public.sessions s
    where s.status = 'closed'
      and coalesce(s.ended_at, s.started_at, s.created_at) < p_cutoff
  ), deleted_rows as (
    delete from public.scan_events se
    where se.session_id in (select id from target_sessions)
       or (se.session_id is null and coalesce(se.scanned_at, se.created_at) < p_cutoff)
    returning se.id
  )
  select count(*) into v_scan_events_deleted from deleted_rows;

  with target_sessions as (
    select s.id
    from public.sessions s
    where s.status = 'closed'
      and coalesce(s.ended_at, s.started_at, s.created_at) < p_cutoff
  ), deleted_rows as (
    delete from public.system_logs sl
    where sl.session_id in (select id from target_sessions)
       or (sl.session_id is null and sl.created_at < p_cutoff)
    returning sl.id
  )
  select count(*) into v_system_logs_deleted from deleted_rows;

  with target_sessions as (
    select s.id
    from public.sessions s
    where s.status = 'closed'
      and coalesce(s.ended_at, s.started_at, s.created_at) < p_cutoff
  ), deleted_rows as (
    delete from public.completion_responses cr
    where cr.session_id in (select id from target_sessions)
    returning cr.id
  )
  select count(*) into v_completion_deleted from deleted_rows;

  with deleted_rows as (
    delete from public.sessions s
    where s.status = 'closed'
      and coalesce(s.ended_at, s.started_at, s.created_at) < p_cutoff
    returning s.id
  )
  select count(*) into v_sessions_deleted from deleted_rows;

  return jsonb_build_object(
    'requested_by', coalesce(p_requested_by, 'unknown'),
    'cutoff', p_cutoff,
    'nullified_open_tickets', v_nullified_open_tickets,
    'deleted_session_events', v_session_events_deleted,
    'deleted_scan_events', v_scan_events_deleted,
    'deleted_system_logs', v_system_logs_deleted,
    'deleted_completion_responses', v_completion_deleted,
    'deleted_sessions', v_sessions_deleted
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_scan_event(p_location_code text, p_device_identifier text, p_event_type text, p_result text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payload_json jsonb DEFAULT '{}'::jsonb, p_client_event_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_location_id uuid;
  v_device_pk uuid;
  v_event_id uuid;
begin
  if p_client_event_id is not null then
    select se.id
      into v_event_id
    from public.scan_events se
    where se.client_event_id = p_client_event_id
    limit 1;

    if v_event_id is not null then
      return jsonb_build_object(
        'ok', true,
        'scan_event_id', v_event_id,
        'location_code', p_location_code,
        'device_identifier', p_device_identifier,
        'event_type', p_event_type,
        'result', p_result,
        'replayed', true
      );
    end if;
  end if;

  select l.id
    into v_location_id
  from public.locations l
  where l.location_code = p_location_code
  limit 1;

  select d.id
    into v_device_pk
  from public.devices d
  where d.device_id = p_device_identifier
  limit 1;

  insert into public.scan_events (
    location_id,
    location_code,
    device_id,
    device_identifier,
    event_type,
    result,
    notes,
    payload_json,
    client_event_id
  )
  values (
    v_location_id,
    p_location_code,
    v_device_pk,
    p_device_identifier,
    p_event_type,
    p_result,
    p_notes,
    coalesce(p_payload_json, '{}'::jsonb),
    p_client_event_id
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'scan_event_id', v_event_id,
    'location_code', p_location_code,
    'device_identifier', p_device_identifier,
    'event_type', p_event_type,
    'result', p_result,
    'replayed', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_scan_location_code(p_input text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  with wanted as (
    select upper(regexp_replace(btrim(coalesce(p_input, '')), '[^A-Z0-9]+', '', 'g')) as normalized
  ), candidates as (
    -- Exact active location code match wins first.
    select
      l.location_code,
      0 as source_rank,
      0 as member_rank
    from public.locations l
    join wanted w on upper(regexp_replace(btrim(l.location_code), '[^A-Z0-9]+', '', 'g')) = w.normalized
    where l.active = true

    union all

    -- Legacy/Teton aliases.
    select
      case w.normalized
        when 'TETON' then 'TETX'
        when 'TETONRR' then 'TETM'
        when 'TETONRESTROOMS' then 'TETM'
        else null
      end as location_code,
      1 as source_rank,
      0 as member_rank
    from wanted w

    union all

    -- Group-level tags: prefer the primary exhibit/building code when present,
    -- otherwise prefer the men's restroom code, then women's, then anything active.
    select
      l.location_code,
      2 as source_rank,
      case
        when lower(coalesce(l.form_type, l.location_type, '')) = 'exhibit' then 0
        when upper(btrim(l.location_code)) ~ 'X$' then 0
        when upper(btrim(l.location_code)) ~ 'M$' then 1
        when upper(btrim(l.location_code)) ~ 'W$' then 2
        else 3
      end as member_rank
    from public.location_groups lg
    join public.location_group_memberships lgm
      on lgm.location_group_id = lg.id
     and lgm.active = true
    join public.locations l
      on l.id = lgm.location_id
     and l.active = true
    join wanted w
      on upper(regexp_replace(btrim(coalesce(lg.group_code, lg.group_name, '')), '[^A-Z0-9]+', '', 'g')) = w.normalized
    where lg.active = true
  )
  select c.location_code
  from candidates c
  where c.location_code is not null
  order by c.source_rank, c.member_rank, c.location_code
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.run_application_write(p_name text, p_sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_sql text := btrim(coalesce(p_sql, ''));
  v_lower text;
  v_result jsonb;
begin
  if v_name is null then
    raise exception 'Application write name is required';
  end if;
  if v_sql = '' then
    raise exception 'Application write SQL is required';
  end if;
  if length(v_sql) > 1000000 then
    raise exception 'Application write SQL exceeds 1 MB';
  end if;
  v_lower := lower(v_sql);
  if v_lower ~ '^\s*(begin|commit|rollback|savepoint|prepare|vacuum|reindex|cluster|copy|alter\s+system|create\s+extension|drop\s+database|drop\s+schema)' then
    raise exception 'Transaction, maintenance, extension, and destructive database-control statements are not accepted by run_application_write';
  end if;

  if v_lower ~ '^\s*(insert|update|delete|select|with)\b'
     and v_lower like '% returning %'
     and position(';' in regexp_replace(v_sql, ';\s*$', '')) = 0 then
    execute format(
      'with _application_rows as (%s) select coalesce(jsonb_agg(to_jsonb(_application_rows)), ''[]''::jsonb) from _application_rows',
      regexp_replace(v_sql, ';\s*$', '')
    ) into v_result;
  else
    execute v_sql;
    v_result := jsonb_build_object('ok', true, 'name', v_name, 'executed_at', now());
  end if;
  return coalesce(v_result, '[]'::jsonb);
end
$function$;

CREATE OR REPLACE FUNCTION public.run_sql_migration(p_name text, p_sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
 SET statement_timeout TO '180s'
AS $function$
declare
  v_trimmed text;
  v_executable text;
  v_lowered text;
  v_result jsonb;
  v_sha text;
  v_bytes integer;
begin
  v_trimmed := trim(coalesce(p_sql, ''));
  v_executable := regexp_replace(v_trimmed, ';\s*$', '');
  v_lowered := lower(v_executable);

  if coalesce(trim(p_name), '') = '' then raise exception 'Migration name is required'; end if;
  if v_trimmed = '' then raise exception 'Migration SQL is required'; end if;
  if v_lowered like 'begin%' or position(('com' || 'mit') in v_lowered) > 0 then
    raise exception 'Do not include transaction wrappers in p_sql. Submit the migration body only.';
  end if;
  if exists (select 1 from public.migration_log_summary where migration_name = p_name) then
    raise exception 'Migration "%" has already been applied', p_name;
  end if;

  if v_lowered ~ '^\s*(insert|update|delete)\s'
     and v_lowered like '% returning %'
     and position(';' in v_executable) = 0 then
    execute format('with _migration_rows as (%s) select coalesce(jsonb_agg(to_jsonb(_migration_rows)), ''[]''::jsonb) from _migration_rows', v_executable)
      into v_result;
  else
    execute v_trimmed;
    v_result := jsonb_build_object('ok', true, 'migration_name', p_name, 'applied_at', now());
  end if;

  v_sha := encode(extensions.digest(convert_to(p_sql, 'UTF8'), 'sha256'), 'hex');
  v_bytes := octet_length(p_sql);

  insert into public.migration_log_summary(
    migration_name, statement_count, total_sql_bytes, latest_sql_sha256,
    first_applied_at, last_applied_at, last_applied_by, updated_at
  ) values (
    p_name, 1, v_bytes, v_sha, now(), now(), current_user, now()
  );

  insert into public.migration_log(migration_name, sql_text, applied_by, notes)
  values (
    p_name,
    format('sha256:%s bytes:%s', v_sha, v_bytes),
    current_user,
    'Compact migration evidence; full SQL belongs in canonical source control.'
  );

  return v_result || jsonb_build_object('sql_sha256', v_sha, 'sql_bytes', v_bytes);
end
$function$;

CREATE OR REPLACE FUNCTION public.run_sql_readonly(p_sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
 SET statement_timeout TO '30s'
AS $function$
declare
  result jsonb;
begin
  if p_sql is null or btrim(p_sql) = '' then
    raise exception 'SQL cannot be empty';
  end if;

  if lower(ltrim(p_sql)) not like 'select%' then
    raise exception 'Only SELECT statements are allowed';
  end if;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t',
    p_sql
  ) into result;

  return coalesce(result, '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_sql_write(p_sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_sql text:=btrim(coalesce(p_sql,''));
  v_lower text;
  v_result jsonb;
  v_count bigint:=0;
begin
  if v_sql='' then raise exception 'SQL cannot be empty'; end if;
  v_sql:=regexp_replace(v_sql,';\s*$','');
  if position(';' in v_sql)>0 then raise exception 'Only one application data statement is allowed'; end if;
  v_lower:=lower(ltrim(v_sql));
  if v_lower !~ '^(insert|update|delete|with|select)\s' then raise exception 'Application write executor does not accept DDL'; end if;
  if v_lower ~ '(^|\s)(create|alter|drop|truncate|grant|revoke|comment|vacuum|reindex|cluster)\s' then raise exception 'Application write executor does not accept DDL'; end if;
  if v_lower ~ '^(insert|update|delete|with)\s' and v_lower like '% returning %' then
    execute format('with _rows as (%s) select coalesce(jsonb_agg(to_jsonb(_rows)), ''[]''::jsonb) from _rows',v_sql) into v_result;
    return coalesce(v_result,'[]'::jsonb);
  end if;
  execute v_sql;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'row_count',v_count);
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_sql_write(p_sql text, p_context text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_sql text := btrim(coalesce(p_sql, ''));
  v_body text;
  v_lower text;
  v_result jsonb;
  v_row_count bigint := 0;
begin
  if v_sql = '' then
    raise exception 'SQL cannot be empty';
  end if;

  v_body := regexp_replace(v_sql, ';\s*$', '');
  v_lower := lower(ltrim(v_body));

  if v_lower !~ '^(select|with|insert|update|delete)\s' then
    raise exception 'run_sql_write accepts data statements only';
  end if;

  if v_lower ~ '(^|;\s*)(create|alter|drop|truncate|grant|revoke|comment|vacuum|reindex|cluster|copy|do|call)\s' then
    raise exception 'Schema, privilege, and maintenance statements require a named migration';
  end if;

  if position(';' in v_body) = 0 then
    if v_lower ~ '^(select|with)\s' then
      begin
        execute format(
          'select coalesce(jsonb_agg(to_jsonb(_rows)), ''[]''::jsonb) from (%s) _rows',
          v_body
        ) into v_result;
        return coalesce(v_result, '[]'::jsonb);
      exception
        when syntax_error_or_access_rule_violation or feature_not_supported then
          null;
      end;
    elsif v_lower ~ '^(insert|update|delete)\s' and v_lower ~ '\sreturning\s' then
      execute format(
        'with _rows as (%s) select coalesce(jsonb_agg(to_jsonb(_rows)), ''[]''::jsonb) from _rows',
        v_body
      ) into v_result;
      return coalesce(v_result, '[]'::jsonb);
    end if;
  end if;

  execute v_sql;
  get diagnostics v_row_count = row_count;
  return jsonb_build_object(
    'ok', true,
    'context', nullif(btrim(coalesce(p_context, '')), ''),
    'affected_rows', v_row_count,
    'executed_at', clock_timestamp()
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.sch2_audit_solution(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_hard integer := 0;
  v_open integer := 0;
  v_workload integer := 0;
  v_route integer := 0;
  v_score numeric := 0;
  v_work_items integer := 0;
  v_solutions integer := 0;
  v_result jsonb;
begin
  select count(*)::integer into v_hard
  from public.v_sch2_constraint_violations
  where run_id = p_run_id
    and severity = 'hard';

  select count(*)::integer into v_open
  from public.schedule_solution_assignments sa
  join public.schedule_work_items wi on wi.id = sa.work_item_id
  where sa.run_id = p_run_id
    and wi.required = true
    and (sa.status <> 'ASSIGNED' or sa.assigned_employee_id is null);

  select count(*)::integer into v_workload
  from public.v_sch2_workload_audit
  where run_id = p_run_id
    and violation_type is not null;

  select count(*)::integer into v_route
  from public.v_sch2_route_audit
  where run_id = p_run_id
    and route_spread_violation = true;

  select coalesce(sum(score_total), 0)::numeric into v_score
  from public.schedule_solution_assignments
  where run_id = p_run_id;

  select count(*)::integer into v_work_items
  from public.schedule_work_items
  where run_id = p_run_id;

  select count(*)::integer into v_solutions
  from public.schedule_solution_assignments
  where run_id = p_run_id;

  v_result := jsonb_build_object(
    'ok', v_hard = 0 and v_open = 0 and v_work_items > 0 and v_solutions = v_work_items,
    'run_id', p_run_id,
    'hard_violation_count', v_hard,
    'open_required_count', v_open,
    'workload_warning_count', v_workload,
    'route_warning_count', v_route,
    'score_total', v_score,
    'work_item_count', v_work_items,
    'solution_assignment_count', v_solutions
  );

  update public.schedule_generation_runs
     set hard_violation_count = v_hard,
         open_required_count = v_open,
         score_total = v_score,
         audit_summary = v_result,
         status = case
          when v_work_items = 0 then 'preview_blocked'
          when v_solutions <> v_work_items then 'preview_blocked'
          when v_hard = 0 and v_open = 0 then 'preview_ready'
          else 'preview_blocked'
        end,
         updated_at = now()
   where id = p_run_id;

  -- H27: Raise if work_item_count and solution_count don't match.
  if v_work_items > 0 and v_solutions <> v_work_items then
    raise exception 'SCH2 audit count mismatch for run %: work_items=%, solution_assignments=%',
      p_run_id, v_work_items, v_solutions;
  end if;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch2_compare_current_vs_preview(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'run_id', p_run_id,
    'diff_count', count(*) filter (where diff_type <> 'same'),
    'changed_count', count(*) filter (where diff_type = 'changed'),
    'preview_only_count', count(*) filter (where diff_type = 'preview_only'),
    'current_only_count', count(*) filter (where diff_type = 'current_only'),
    'diffs', coalesce(jsonb_agg(to_jsonb(d) order by coverage_start, location_group_id::text) filter (where diff_type <> 'same'), '[]'::jsonb)
  )
  from public.v_sch2_publish_diff d
  where d.run_id = p_run_id;
$function$;

CREATE OR REPLACE FUNCTION public.sch2_explain_assignment(p_run_id uuid, p_work_item_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'run_id', p_run_id,
    'work_item', to_jsonb(wi),
    'solution', to_jsonb(sa),
    'candidates', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.eligible desc, c.total_score desc)
      from public.schedule_candidate_scores c
      where c.run_id = p_run_id
        and c.work_item_id = p_work_item_id
    ), '[]'::jsonb),
    'violations', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.violation_type)
      from public.v_sch2_constraint_violations v
      where v.run_id = p_run_id
        and v.work_item_id = p_work_item_id
    ), '[]'::jsonb)
  )
  from public.schedule_work_items wi
  left join public.schedule_solution_assignments sa on sa.work_item_id = wi.id and sa.run_id = wi.run_id
  where wi.run_id = p_run_id
    and wi.id = p_work_item_id;
$function$;

CREATE OR REPLACE FUNCTION public.sch2_input_hash(p_service_date date)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  with payload as (
    select jsonb_build_object(
      'service_date', p_service_date,
      'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', dsa.id,
          'location_group_id', dsa.location_group_id,
          'segment_number', dsa.segment_number,
          'assigned_employee_id', dsa.assigned_employee_id,
          'owner_type', dsa.owner_type,
          'coverage_start', dsa.coverage_start,
          'coverage_end', dsa.coverage_end,
          'coverage_purpose', dsa.coverage_purpose,
          'status', dsa.status,
          'load_points', dsa.load_points,
          'source_type', dsa.source_type,
          'notes', dsa.notes
        ) order by dsa.location_group_id, dsa.coverage_start, dsa.segment_number, dsa.id)
        from public.daily_schedule_assignments dsa
        where dsa.service_date = p_service_date
      ), '[]'::jsonb),
      'roster', coalesce((
        select jsonb_agg(jsonb_build_object(
          'employee_id', r.employee_id,
          'shift_start', r.shift_start,
          'shift_end', r.shift_end,
          'active', r.active,
          'notes', r.notes
        ) order by r.employee_id)
        from public.daily_work_roster r
        where r.service_date = p_service_date
      ), '[]'::jsonb),
      'absences', coalesce((
        select jsonb_agg(jsonb_build_object(
          'employee_id', a.employee_id,
          'absence_type', a.absence_type,
          'active', a.active,
          'notes', a.notes
        ) order by a.employee_id, a.absence_type)
        from public.daily_absence_overrides a
        where a.absence_date = p_service_date
      ), '[]'::jsonb),
      'manual_locks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'location_group_id', l.location_group_id,
          'segment_number', l.segment_number,
          'coverage_start', l.coverage_start,
          'coverage_end', l.coverage_end,
          'coverage_purpose', l.coverage_purpose,
          'assigned_employee_id', l.assigned_employee_id,
          'active', l.active,
          'reason', l.reason
        ) order by l.location_group_id, l.coverage_start, l.segment_number)
        from public.schedule_manual_locks l
        where l.service_date = p_service_date
      ), '[]'::jsonb)
    ) as data
  )
  select md5(data::text) from payload;
$function$;

CREATE OR REPLACE FUNCTION public.sch2_rollback_publish(p_publish_audit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_audit public.schedule_publish_audit%rowtype;
  v_restored integer := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'postgres' then
    raise exception 'SCH2 rollback requires service_role backend execution';
  end if;

  perform pg_advisory_xact_lock(hashtext('memphis_sch2_publish'));

  select * into v_audit
  from public.schedule_publish_audit
  where id = p_publish_audit_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'publish audit row not found', 'publish_audit_id', p_publish_audit_id);
  end if;

  if v_audit.status <> 'published' then
    return jsonb_build_object('ok', false, 'error', 'publish audit row is not in published status', 'publish_audit_id', p_publish_audit_id, 'status', v_audit.status);
  end if;

  delete from public.daily_schedule_assignments
   where service_date = v_audit.service_date;

  insert into public.daily_schedule_assignments (
    id,
    service_date,
    location_group_id,
    segment_number,
    assigned_employee_id,
    owner_type,
    coverage_start,
    coverage_end,
    status,
    load_points,
    notes,
    source_type,
    created_at,
    updated_at,
    coverage_purpose
  )
  select
    coalesce(x.id, gen_random_uuid()),
    coalesce(x.service_date, v_audit.service_date),
    x.location_group_id,
    coalesce(x.segment_number, 1),
    x.assigned_employee_id,
    coalesce(x.owner_type, case when x.assigned_employee_id is null then 'OPEN' else 'EMPLOYEE' end),
    x.coverage_start,
    x.coverage_end,
    coalesce(x.status, case when x.assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end),
    coalesce(x.load_points, 0),
    x.notes,
    coalesce(x.source_type, 'sch2_rollback'),
    coalesce(x.created_at, now()),
    now(),
    coalesce(x.coverage_purpose, 'area_owner')
  from jsonb_to_recordset(v_audit.previous_rows) as x(
    id uuid,
    service_date date,
    location_group_id uuid,
    segment_number integer,
    assigned_employee_id uuid,
    owner_type text,
    coverage_start time,
    coverage_end time,
    status text,
    load_points numeric,
    notes text,
    source_type text,
    created_at timestamptz,
    updated_at timestamptz,
    coverage_purpose text
  );

  get diagnostics v_restored = row_count;

  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_audit.service_date;

  update public.schedule_publish_audit
     set status = 'rolled_back',
         rolled_back_at = now(),
         rollback_rows = v_rows
   where id = p_publish_audit_id;

  update public.schedule_generation_runs
     set status = 'rolled_back', updated_at = now()
   where id = v_audit.run_id;

  return jsonb_build_object(
    'ok', true,
    'publish_audit_id', p_publish_audit_id,
    'run_id', v_audit.run_id,
    'service_date', v_audit.service_date,
    'restored_rows', v_restored
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_alijah_herpetarium_monday_exception_allowed(p_employee_id uuid, p_location_group_id uuid, p_day_of_week integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce((
    select
      p_day_of_week = 1
      and lg.group_code = 'HERPETARIUM'
      and exists (
        select 1
        from public.employee_area_preferences allow_pref
        where allow_pref.employee_id = p_employee_id
          and allow_pref.location_group_id = p_location_group_id
          and allow_pref.active = true
          and lower(coalesce(allow_pref.preference_type, '')) in ('allow','allowed','prefer','preferred')
          and allow_pref.notes ilike '%monday%'
          and allow_pref.notes ilike '%husband not working%'
      )
    from public.location_groups lg
    where lg.id = p_location_group_id
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.sch_apply_default_coverage_purpose()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_group_code text;
  v_employee_name text;
  v_template_purpose text;
begin
  select lg.group_code into v_group_code
  from public.location_groups lg
  where lg.id = new.location_group_id;

  if new.assigned_employee_id is not null then
    select e.display_name into v_employee_name
    from public.employees e
    where e.id = new.assigned_employee_id;
  end if;

  select ct.coverage_purpose into v_template_purpose
  from public.coverage_templates ct
  where ct.location_group_id = new.location_group_id
    and ct.day_of_week = extract(dow from new.service_date)::integer
    and ct.segment_number = new.segment_number
  limit 1;

  if new.coverage_purpose is null or new.coverage_purpose = 'area_owner' then
    new.coverage_purpose := coalesce(
      v_template_purpose,
      case
        when v_group_code in ('ELEPHANT_TRUNK_GIFT_SHOP','ELEPHANT_TRUNK_RESTROOMS','BAMBOO_GIFT_SHOP','NORTH_WEST_PASSAGE_GIFT_SHOP') then 'reminder'
        when v_employee_name = 'Michael McWright' then 'late_coverage'
        when new.coverage_start < time '09:45' then 'deep_clean'
        else coalesce(new.coverage_purpose, 'area_owner')
      end
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_clear_scan_alerts_for_location(p_location_code text, p_clear_reason text DEFAULT 'scan_event'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_count integer := 0;
begin
  update public.scan_alert_notification_log
     set active = false,
         cleared_at = now(),
         alert_context = coalesce(alert_context, '{}'::jsonb) || jsonb_build_object('clear_reason', p_clear_reason, 'cleared_at', now())
   where upper(location_code) = upper(p_location_code)
     and active = true;

  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'location_code', p_location_code, 'cleared_count', v_count);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_extract_color_hex(p_notes text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_match text[];
begin
  v_match := regexp_match(coalesce(p_notes, ''), '#([0-9A-Fa-f]{6})');
  if v_match is null then
    return null;
  end if;
  return '#' || upper(v_match[1]);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_get_coverage_candidates(p_service_date date, p_location_group_id uuid, p_coverage_start time without time zone, p_coverage_end time without time zone)
 RETURNS TABLE(employee_id uuid, employee_name text, employee_code text, shift_start text, shift_end text, assigned_segments integer, assigned_load_points numeric, assigned_minutes numeric, familiarity_score integer, is_primary boolean, is_backup boolean, preference_type text, best_proximity_score integer, walking_minutes integer, has_overlap boolean, recommendation_score numeric, explanation text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
with target_group as (
  select exists(
    select 1
    from public.location_group_memberships lgm
    join public.locations l on l.id = lgm.location_id and l.active = true
    where lgm.location_group_id = p_location_group_id
      and lgm.active = true
      and lower(coalesce(l.form_type, l.location_type, '')) = 'restroom'
  ) as is_restroom
),
active_roster as (
  select
    dwr.employee_id,
    dwr.shift_start,
    dwr.shift_end,
    p_coverage_start as overlap_start,
    p_coverage_end as overlap_end,
    (extract(epoch from (p_coverage_end - p_coverage_start)) / 60.0)::numeric as overlap_minutes
  from public.daily_work_roster dwr
  where dwr.service_date = p_service_date
    and dwr.active = true
    and dwr.shift_start <= p_coverage_start
    and dwr.shift_end >= p_coverage_end
),
load_summary as (
  select v.employee_id, v.assigned_segments, v.assigned_load_points, v.assigned_minutes
  from public.v_memphis_employee_load_summary v
  where v.service_date = p_service_date
),
overlap_check as (
  select
    ar.employee_id,
    exists(
      select 1
      from public.daily_schedule_assignments dsa
      where dsa.service_date = p_service_date
        and dsa.assigned_employee_id = ar.employee_id
        and dsa.status = 'ASSIGNED'
        and dsa.coverage_start < p_coverage_end
        and dsa.coverage_end > p_coverage_start
    ) as has_overlap
  from active_roster ar
),
familiarity_explicit as (
  select eaf.employee_id, eaf.familiarity_score, eaf.is_primary, eaf.is_backup
  from public.employee_area_familiarity eaf
  where eaf.location_group_id = p_location_group_id
    and eaf.active = true
),
familiarity_legacy_primary as (
  select epga.employee_id, 9 as familiarity_score, true as is_primary, false as is_backup
  from public.employee_primary_group_assignments epga
  where epga.location_group_id = p_location_group_id
    and epga.active = true
),
familiarity_legacy_backup as (
  select ebga.employee_id, 7 as familiarity_score, false as is_primary, true as is_backup
  from public.employee_backup_group_assignments ebga
  where ebga.location_group_id = p_location_group_id
    and ebga.active = true
),
familiarity as (
  select x.employee_id, max(x.familiarity_score)::int as familiarity_score,
         bool_or(x.is_primary) as is_primary, bool_or(x.is_backup) as is_backup
  from (
    select * from familiarity_explicit
    union all
    select * from familiarity_legacy_primary
    union all
    select * from familiarity_legacy_backup
  ) x
  group by x.employee_id
),
preferences as (
  select
    eap.employee_id,
    string_agg(eap.preference_type, ',' order by eap.preference_type) as preference_type,
    bool_or(eap.preference_type = 'restricted') as is_restricted,
    bool_or(eap.preference_type = 'avoid') as is_avoid,
    bool_or(eap.preference_type = 'prefer') as is_prefer
  from public.employee_area_preferences eap
  where eap.location_group_id = p_location_group_id
    and eap.active = true
  group by eap.employee_id
),
current_groups as (
  select distinct dsa.assigned_employee_id as employee_id, dsa.location_group_id
  from public.daily_schedule_assignments dsa
  where dsa.service_date = p_service_date
    and dsa.status = 'ASSIGNED'
    and dsa.assigned_employee_id is not null
),
proximity_explicit as (
  select cg.employee_id, max(lga.proximity_score) as best_proximity_score,
         min(lga.walking_minutes) as walking_minutes
  from current_groups cg
  join public.location_group_adjacency lga
    on lga.from_location_group_id = cg.location_group_id
   and lga.to_location_group_id = p_location_group_id
   and lga.active = true
  group by cg.employee_id
),
proximity_legacy as (
  select egp.employee_id, max(egp.proximity_score)::int as best_proximity_score,
         null::integer as walking_minutes
  from public.employee_group_proximity egp
  where egp.location_group_id = p_location_group_id
    and egp.active = true
  group by egp.employee_id
),
proximity as (
  select x.employee_id, max(x.best_proximity_score)::int as best_proximity_score,
         min(x.walking_minutes) as walking_minutes
  from (
    select * from proximity_explicit
    union all
    select * from proximity_legacy
  ) x
  group by x.employee_id
),
ranked as (
  select
    e.id as employee_id,
    e.display_name as employee_name,
    e.employee_code,
    to_char(ar.shift_start, 'HH24:MI') as shift_start,
    to_char(ar.shift_end, 'HH24:MI') as shift_end,
    coalesce(ls.assigned_segments, 0)::int as assigned_segments,
    coalesce(ls.assigned_load_points, 0)::numeric as assigned_load_points,
    coalesce(ls.assigned_minutes, 0)::numeric as assigned_minutes,
    coalesce(f.familiarity_score, 5)::int as familiarity_score,
    coalesce(f.is_primary, false) as is_primary,
    coalesce(f.is_backup, false) as is_backup,
    p.preference_type,
    coalesce(pr.best_proximity_score, 5)::int as best_proximity_score,
    pr.walking_minutes,
    oc.has_overlap,
    (
      (coalesce(f.familiarity_score, 5) * 6)
      + (case when coalesce(f.is_primary, false) then 12 else 0 end)
      + (case when coalesce(f.is_backup, false) then 6 else 0 end)
      + (coalesce(pr.best_proximity_score, 5) * 2)
      + (case when coalesce(p.is_prefer, false) then 6 else 0 end)
      + (least(coalesce(ar.overlap_minutes, 0), 180) * 0.05)
      - (case when coalesce(p.is_avoid, false) then 10 else 0 end)
      - (case when coalesce(p.is_restricted, false) then 100 else 0 end)
      - (coalesce(ls.assigned_load_points, 0) * 1.5)
      - (coalesce(ls.assigned_segments, 0) * 1.25)
      - (case when oc.has_overlap then 8 else 0 end)
    )::numeric as recommendation_score,
    trim(both ' ' from concat_ws('. ',
      case when oc.has_overlap then 'Already covering other concurrent areas' else 'No concurrent areas at that exact window' end,
      'Full-window shift coverage verified',
      'Familiarity ' || coalesce(f.familiarity_score, 5),
      case when coalesce(f.is_primary, false) then 'Primary area' when coalesce(f.is_backup, false) then 'Backup area' else null end,
      case when p.preference_type is not null then 'Preference ' || p.preference_type else null end,
      'Current load ' || coalesce(ls.assigned_load_points, 0) || ' points across ' || coalesce(ls.assigned_segments, 0) || ' segments',
      'Coverage window ' || round(coalesce(ar.overlap_minutes, 0), 0) || ' minutes',
      case when pr.best_proximity_score is not null then 'Proximity ' || pr.best_proximity_score else null end,
      case when pr.walking_minutes is not null then 'Walk ' || pr.walking_minutes || ' min' else null end
    )) as explanation
  from active_roster ar
  join public.employees e on e.id = ar.employee_id and e.active = true
  left join load_summary ls on ls.employee_id = ar.employee_id
  left join overlap_check oc on oc.employee_id = ar.employee_id
  left join familiarity f on f.employee_id = ar.employee_id
  left join preferences p on p.employee_id = ar.employee_id
  left join proximity pr on pr.employee_id = ar.employee_id
)
select *
from ranked
where coalesce(preference_type, '') not like '%restricted%'
order by recommendation_score desc, employee_name asc;
$function$;

CREATE OR REPLACE FUNCTION public.sch_get_or_create_scan_alert_thread(p_msg_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_thread_id uuid;
  v_system_user_id uuid;
  v_user_name text;
begin
  if p_msg_user_id is null then
    raise exception 'p_msg_user_id is required';
  end if;

  select id into v_system_user_id
  from public.msg_users
  where display_name = 'Memphis'
    and is_active = true
  limit 1;

  if v_system_user_id is null then
    select id into v_system_user_id
    from public.msg_users
    where role = 'manager'
      and is_active = true
    order by created_at
    limit 1;
  end if;

  select display_name into v_user_name
  from public.msg_users
  where id = p_msg_user_id;

  select t.id into v_thread_id
  from public.msg_threads t
  join public.msg_thread_participants tp_user on tp_user.thread_id = t.id and tp_user.user_id = p_msg_user_id and tp_user.left_at is null
  join public.msg_thread_participants tp_system on tp_system.thread_id = t.id and tp_system.user_id = v_system_user_id and tp_system.left_at is null
  where t.thread_type = 'direct'
    and t.title = 'Scan Alerts'
    and t.is_active = true
  order by t.updated_at desc
  limit 1;

  if v_thread_id is null then
    v_thread_id := gen_random_uuid();

    insert into public.msg_threads (id, thread_type, title, created_by_user_id, is_active, created_at, updated_at, last_message_at)
    values (v_thread_id, 'direct', 'Scan Alerts', v_system_user_id, true, now(), now(), now());

    insert into public.msg_thread_participants (id, thread_id, user_id, joined_at, left_at)
    values
      (gen_random_uuid(), v_thread_id, v_system_user_id, now(), null),
      (gen_random_uuid(), v_thread_id, p_msg_user_id, now(), null)
    on conflict (thread_id, user_id) do update set left_at = null;
  end if;

  return v_thread_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_get_schedule_close_time(p_service_date date)
 RETURNS time without time zone
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (
      select oh.closing_time
      from public.operating_hours oh
      where oh.operating_date = p_service_date
        and oh.active = true
      order by oh.updated_at desc
      limit 1
    ),
    time '06:00 PM'
  );
$function$;

CREATE OR REPLACE FUNCTION public.sch_group_difficulty_points(p_location_group_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (
      select manual_load_points
      from public.location_group_workload_settings lgws
      where lgws.location_group_id = p_location_group_id
        and lgws.active = true
        and lgws.manual_load_points is not null
      limit 1
    ),
    (
      select coalesce(sum(coalesce(l.difficulty_rating, 1)), 0)::numeric
      from public.location_group_memberships lgm
      join public.locations l on l.id = lgm.location_id and l.active = true
      where lgm.location_group_id = p_location_group_id
        and lgm.active = true
    ),
    0
  )::numeric;
$function$;

CREATE OR REPLACE FUNCTION public.sch_group_load_points(p_location_group_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (
      select lgws.manual_load_points
      from public.location_group_workload_settings lgws
      where lgws.location_group_id = p_location_group_id
        and lgws.active = true
        and lgws.manual_load_points is not null
      limit 1
    ),
    (
      select coalesce(sum(coalesce(l.difficulty_rating, 1) * coalesce(l.priority_rating, 1)), 0)::numeric
      from public.location_group_memberships lgm
      join public.locations l on l.id = lgm.location_id and l.active = true
      where lgm.location_group_id = p_location_group_id
        and lgm.active = true
    ),
    0
  )::numeric;
$function$;

CREATE OR REPLACE FUNCTION public.sch_group_priority_points(p_location_group_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (
      select manual_load_points
      from public.location_group_workload_settings lgws
      where lgws.location_group_id = p_location_group_id
        and lgws.active = true
        and lgws.manual_load_points is not null
      limit 1
    ),
    (
      select coalesce(sum(coalesce(l.priority_rating, 1)), 0)::numeric
      from public.location_group_memberships lgm
      join public.locations l on l.id = lgm.location_id and l.active = true
      where lgm.location_group_id = p_location_group_id
        and lgm.active = true
    ),
    0
  )::numeric;
$function$;

CREATE OR REPLACE FUNCTION public.sch_group_route_spread_penalty(p_location_group_ids uuid[])
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  with groups as (
    select distinct unnest(coalesce(p_location_group_ids, array[]::uuid[])) as location_group_id
  ), points as (
    select lgps.route_x, lgps.route_y, lgps.working_cluster
    from groups g
    join public.location_group_proximity_settings lgps
      on lgps.location_group_id = g.location_group_id
     and lgps.active = true
  ), bounds as (
    select
      count(*) as point_count,
      count(distinct working_cluster) as cluster_count,
      coalesce(max(route_x) - min(route_x), 0) as x_span,
      coalesce(max(route_y) - min(route_y), 0) as y_span
    from points
  )
  select case
    when point_count <= 1 then 0
    else round((x_span * 0.75) + (y_span * 0.25) + greatest(cluster_count - 1, 0) * 8, 2)
  end::numeric
  from bounds;
$function$;

CREATE OR REPLACE FUNCTION public.sch_guard_operational_coverage_template()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_group_code text;
begin
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  if v_group_code like '%GIFT_SHOP' then
    if new.day_of_week = 1
       and coalesce(new.coverage_purpose, '') = 'reminder'
       and new.coverage_start >= time '08:00'
       and new.coverage_start <= time '08:30'
       and new.coverage_end <= time '09:45' then
      return new;
    end if;

    new.active := false;
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.notes := trim(concat_ws(' | ', nullif(new.notes, ''), 'Disabled by operational guard: gift shops are Monday morning reminder-only side work, not scan-system/lunch/after-9:45 work.'));
    return new;
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.sch_guard_operational_daily_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_group_code text;
  v_day integer;
  v_employee_name text;
begin
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  if v_group_code is null then
    raise exception 'Unknown location_group_id %', new.location_group_id;
  end if;

  v_day := extract(dow from new.service_date)::integer;

  if v_group_code like '%GIFT_SHOP' and not (
    v_day = 1
    and coalesce(new.coverage_purpose, '') = 'reminder'
    and new.coverage_start >= time '08:00'
    and new.coverage_start <= time '08:30'
    and new.coverage_end <= time '09:45'
  ) then
    select display_name into v_employee_name
    from public.employees
    where id = new.assigned_employee_id;

    raise exception 'Gift shop guard: blocked assignment for employee "%" (id %) to "%" on service_date %. Gift shops are Monday morning reminder-only side work; this assignment does not meet the reminder-only criteria.',
      coalesce(v_employee_name, 'UNKNOWN'), coalesce(new.assigned_employee_id::text, 'NULL'), v_group_code, new.service_date;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_is_public_restroom_group(p_location_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1
    from public.location_group_memberships m
    join public.locations l on l.id = m.location_id and l.active = true
    where m.location_group_id = p_location_group_id
      and m.active = true
      and lower(coalesce(l.form_type, l.location_type, '')) = 'restroom'
      and not (
        l.location_name ilike '%East Admin%'
        or l.location_name ilike '%West Admin%'
        or l.location_name ilike '%Elephant Trunk%'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.sch_list_location_workload_settings()
 RETURNS TABLE(location_id uuid, location_code text, location_name text, location_type text, difficulty_rating integer, priority_rating integer, workload_weight numeric, workload_notes text, group_codes text[])
 LANGUAGE sql
 STABLE
AS $function$
  select
    l.id as location_id,
    l.location_code,
    l.location_name,
    coalesce(l.form_type, l.location_type) as location_type,
    l.difficulty_rating,
    l.priority_rating,
    (coalesce(l.difficulty_rating, 1) * coalesce(l.priority_rating, 1))::numeric as workload_weight,
    l.workload_notes,
    coalesce(array_agg(lg.group_code order by lg.group_code) filter (where lg.id is not null), array[]::text[]) as group_codes
  from public.locations l
  left join public.location_group_memberships lgm on lgm.location_id = l.id and lgm.active = true
  left join public.location_groups lg on lg.id = lgm.location_group_id and lg.active = true
  where l.active = true
  group by l.id, l.location_code, l.location_name, l.form_type, l.location_type, l.difficulty_rating, l.priority_rating, l.workload_notes
  order by l.location_name;
$function$;

CREATE OR REPLACE FUNCTION public.sch_lunch_window_for_employee(p_service_date date, p_employee_id uuid)
 RETURNS TABLE(lunch_start time without time zone, lunch_end time without time zone)
 LANGUAGE sql
 STABLE
AS $function$
  with override_row as (
    select eso.lunch_start, eso.lunch_end
    from public.employee_shift_overrides eso
    where eso.shift_date = p_service_date
      and eso.employee_id = p_employee_id
      and coalesce(eso.active, true) = true
      and eso.lunch_start is not null
      and eso.lunch_end is not null
    order by eso.updated_at desc nulls last, eso.created_at desc nulls last
    limit 1
  ), template_row as (
    select est.lunch_start, est.lunch_end
    from public.employee_shift_templates est
    where est.employee_id = p_employee_id
      and est.day_of_week = extract(dow from p_service_date)::integer
      and est.active = true
      and est.lunch_start is not null
      and est.lunch_end is not null
    limit 1
  )
  select coalesce(o.lunch_start, t.lunch_start) as lunch_start,
         coalesce(o.lunch_end, t.lunch_end) as lunch_end
  from template_row t
  full join override_row o on true
  where coalesce(o.lunch_start, t.lunch_start) is not null
    and coalesce(o.lunch_end, t.lunch_end) is not null
    and coalesce(o.lunch_start, t.lunch_start) < coalesce(o.lunch_end, t.lunch_end);
$function$;

CREATE OR REPLACE FUNCTION public.sch_normalize_restored_scan_lunch_load_points(p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_updated integer := 0;
begin
  with target_rows as (
    select d.id,
           d.service_date,
           d.location_group_id,
           d.load_points,
           extract(epoch from (d.coverage_end - d.coverage_start)) / 60.0 as minutes
    from public.daily_schedule_assignments d
    join public.location_groups lg on lg.id = d.location_group_id
    where d.service_date = p_service_date
      and lg.group_code in ('CAT_COUNTRY','PRIMATE_CANYON')
      and (
        d.source_type like '%lunch_split_before%'
        or d.source_type like '%lunch_split_after%'
        or d.source_type like '%restored_scan_lunch_coverage%'
      )
      and d.coverage_end > d.coverage_start
  ), block_totals as (
    select service_date,
           location_group_id,
           max(coalesce(load_points, 0))::numeric as original_load_points,
           sum(minutes)::numeric as total_minutes
    from target_rows
    group by service_date, location_group_id
  ), recalculated as (
    select tr.id,
           case
             when bt.original_load_points <= 0 or bt.total_minutes <= 0 then 0::numeric
             else round((bt.original_load_points * tr.minutes::numeric / bt.total_minutes), 2)
           end as new_load_points
    from target_rows tr
    join block_totals bt on bt.service_date = tr.service_date and bt.location_group_id = tr.location_group_id
  ), updated as (
    update public.daily_schedule_assignments d
       set load_points = r.new_load_points,
           updated_at = now()
      from recalculated r
     where d.id = r.id
       and coalesce(d.load_points, -999999) <> r.new_load_points
     returning d.id
  )
  select count(*) into v_updated from updated;

  return jsonb_build_object('service_date', p_service_date, 'updated_rows', v_updated);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_normalize_score(p_value numeric, p_min numeric, p_max numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_value is null then 0
    when p_max is null or p_min is null or p_max <= p_min then 0
    else round(((p_value - p_min) / nullif(p_max - p_min, 0)) * 100, 2)
  end::numeric;
$function$;

CREATE OR REPLACE FUNCTION public.sch_parse_human_time(p_text text)
 RETURNS time without time zone
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_raw text := lower(regexp_replace(coalesce(p_text, ''), '\s+', '', 'g'));
  v_match text[];
  v_hour integer;
  v_minute integer;
  v_meridiem text;
begin
  if v_raw = '' then
    return null;
  end if;

  v_match := regexp_match(v_raw, '^(\d{1,2})(?::?(\d{2}))?(am|pm)$');
  if v_match is null then
    return null;
  end if;

  v_hour := v_match[1]::integer;
  v_minute := coalesce(nullif(v_match[2], ''), '0')::integer;
  v_meridiem := v_match[3];

  if v_hour < 1 or v_hour > 12 or v_minute < 0 or v_minute > 59 then
    return null;
  end if;

  if v_meridiem = 'pm' and v_hour < 12 then
    v_hour := v_hour + 12;
  elsif v_meridiem = 'am' and v_hour = 12 then
    v_hour := 0;
  end if;

  return make_time(v_hour, v_minute, 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_resolve_employee_ref(p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_raw text := coalesce(p_text, '');
  v_norm text;
  v_result record;
begin
  v_norm := btrim(regexp_replace(lower(v_raw), '[^a-z0-9]+', ' ', 'g'));

  if v_norm = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty_employee_reference');
  end if;

  with candidates as (
    select
      e.id,
      e.display_name,
      e.employee_code,
      e.role,
      e.active,
      'display_name'::text as match_source,
      e.display_name as matched_text,
      btrim(regexp_replace(lower(e.display_name), '[^a-z0-9]+', ' ', 'g')) as candidate_norm
    from public.employees e
    where e.active = true

    union all

    select
      e.id,
      e.display_name,
      e.employee_code,
      e.role,
      e.active,
      'alias'::text as match_source,
      a.alias_text as matched_text,
      btrim(regexp_replace(lower(a.alias_text), '[^a-z0-9]+', ' ', 'g')) as candidate_norm
    from public.employee_aliases a
    join public.employees e on e.id = a.employee_id
    where a.active = true
      and e.active = true
  ), scored as (
    select
      c.*,
      case
        when v_norm = c.candidate_norm then 1000 + length(c.candidate_norm)
        when v_norm like '%' || c.candidate_norm || '%' and length(c.candidate_norm) >= 3 then 750 + length(c.candidate_norm)
        when c.candidate_norm like v_norm || '%' and length(v_norm) >= 3 then 650 + length(v_norm)
        when c.candidate_norm like '%' || v_norm || '%' and length(v_norm) >= 4 then 550 + length(v_norm)
        when split_part(c.candidate_norm, ' ', 1) = split_part(v_norm, ' ', 1) and length(split_part(v_norm, ' ', 1)) >= 3 then 250
        else 0
      end as score
    from candidates c
  )
  select *
  into v_result
  from scored
  where score >= 200
  order by score desc, length(candidate_norm) desc, display_name asc
  limit 1;

  if v_result.id is null then
    return jsonb_build_object('ok', false, 'reason', 'employee_not_resolved', 'query', p_text);
  end if;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_result.id,
    'employee_name', v_result.display_name,
    'employee_code', v_result.employee_code,
    'role', v_result.role,
    'match_source', v_result.match_source,
    'matched_text', v_result.matched_text,
    'score', v_result.score
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_seed_location_coverage_templates_from_groups(p_day_of_week integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_count integer := 0;
begin
  if p_day_of_week is not null and (p_day_of_week < 0 or p_day_of_week > 6) then
    raise exception 'p_day_of_week must be between 0 and 6';
  end if;

  insert into public.location_coverage_templates (
    id,
    location_id,
    day_of_week,
    segment_number,
    assigned_employee_id,
    owner_type,
    coverage_start,
    coverage_end,
    coverage_purpose,
    source_location_group_id,
    active,
    notes,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    l.id,
    ct.day_of_week,
    ct.segment_number,
    ct.assigned_employee_id,
    ct.owner_type,
    ct.coverage_start,
    ct.coverage_end,
    case
      when ct.coverage_purpose = 'reminder' then 'reminder'
      when ct.coverage_purpose = 'late_coverage' then 'late_coverage'
      when ct.coverage_purpose = 'deep_clean' then 'deep_clean'
      when lower(coalesce(l.form_type, l.location_type, '')) = 'restroom'
       and ct.coverage_purpose in ('restroom_upkeep','area_owner') then 'restroom_upkeep'
      when lower(coalesce(l.form_type, l.location_type, '')) <> 'restroom'
       and ct.coverage_purpose = 'restroom_upkeep' then 'area_owner'
      else ct.coverage_purpose
    end as coverage_purpose,
    lg.id,
    ct.active,
    trim(concat_ws(' ', 'Seeded from group schedule.', nullif(ct.notes, ''))),
    now(),
    now()
  from public.coverage_templates ct
  join public.location_groups lg on lg.id = ct.location_group_id
  join public.location_group_memberships lgm on lgm.location_group_id = lg.id and lgm.active = true
  join public.locations l on l.id = lgm.location_id and l.active = true
  where ct.active = true
    and (p_day_of_week is null or ct.day_of_week = p_day_of_week)
  on conflict (location_id, day_of_week, segment_number) do update set
    assigned_employee_id = excluded.assigned_employee_id,
    owner_type = excluded.owner_type,
    coverage_start = excluded.coverage_start,
    coverage_end = excluded.coverage_end,
    coverage_purpose = excluded.coverage_purpose,
    source_location_group_id = excluded.source_location_group_id,
    active = excluded.active,
    notes = excluded.notes,
    updated_at = now();

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'day_of_week', p_day_of_week,
    'upserted_rows', v_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_service_date(p_at timestamp with time zone DEFAULT now())
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$
  select (p_at at time zone 'America/Chicago')::date;
$function$;

CREATE OR REPLACE FUNCTION public.sch_set_employee_alias_active(p_alias_id uuid, p_active boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row record;
begin
  if p_alias_id is null then
    raise exception 'p_alias_id is required';
  end if;

  update public.employee_aliases a
  set active = coalesce(p_active, true),
      updated_at = now()
  where a.id = p_alias_id
  returning a.* into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'alias_not_found', 'alias_id', p_alias_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'alias_id', v_row.id,
    'employee_id', v_row.employee_id,
    'alias_text', v_row.alias_text,
    'active', v_row.active,
    'notes', v_row.notes
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_set_location_workload_settings(p_location_id uuid, p_difficulty_rating integer, p_priority_rating integer, p_workload_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row public.locations%rowtype;
begin
  if p_location_id is null then
    raise exception 'p_location_id is required';
  end if;
  if p_difficulty_rating is not null and (p_difficulty_rating < 1 or p_difficulty_rating > 10) then
    raise exception 'difficulty_rating must be between 1 and 10';
  end if;
  if p_priority_rating is not null and (p_priority_rating < 1 or p_priority_rating > 10) then
    raise exception 'priority_rating must be between 1 and 10';
  end if;

  update public.locations
     set difficulty_rating = p_difficulty_rating,
         priority_rating = p_priority_rating,
         workload_notes = p_workload_notes,
         updated_at = now()
   where id = p_location_id
   returning * into v_row;

  if not found then
    raise exception 'Location not found';
  end if;

  return jsonb_build_object(
    'location_id', v_row.id,
    'location_code', v_row.location_code,
    'location_name', v_row.location_name,
    'difficulty_rating', v_row.difficulty_rating,
    'priority_rating', v_row.priority_rating,
    'workload_notes', v_row.workload_notes,
    'workload_weight', coalesce(v_row.difficulty_rating, 1) * coalesce(v_row.priority_rating, 1)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_set_schedule_close_time(p_service_date date, p_closing_time time without time zone, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_opening time := time '05:00 AM';
  v_row public.operating_hours%rowtype;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;
  if p_closing_time is null then
    raise exception 'p_closing_time is required';
  end if;

  select coalesce(opening_time, v_opening)
    into v_opening
  from public.operating_hours
  where operating_date = p_service_date
  order by updated_at desc
  limit 1;

  insert into public.operating_hours (
    id, operating_date, opening_time, closing_time, active, notes, created_at, updated_at
  )
  values (
    gen_random_uuid(),
    p_service_date,
    v_opening,
    p_closing_time,
    true,
    p_notes,
    now(),
    now()
  )
  on conflict (operating_date)
  do update set
    opening_time = excluded.opening_time,
    closing_time = excluded.closing_time,
    active = true,
    notes = excluded.notes,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'operating_date', v_row.operating_date,
    'opening_time', v_row.opening_time,
    'closing_time', v_row.closing_time,
    'notes', v_row.notes
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_sync_pto_absence_overrides(p_start_date date DEFAULT CURRENT_DATE, p_end_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_start date := coalesce(p_start_date, current_date);
  v_end date := coalesce(p_end_date, coalesce(p_start_date, current_date));
  v_mark text := '[auto_pto_sync]';
  v_deactivated integer := 0;
  v_inserted_or_updated integer := 0;
begin
  if v_end < v_start then
    raise exception 'p_end_date must be on or after p_start_date';
  end if;

  if to_regclass('public.daily_absence_overrides') is null then
    raise exception 'Missing public.daily_absence_overrides';
  end if;

  with pto_source as (
    select distinct gs::date as absence_date, p.employee_id, 'employee_planned_time_off'::text as source_table
    from public.employee_planned_time_off p
    cross join lateral generate_series(greatest(p.start_date, v_start), least(p.end_date, v_end), interval '1 day') gs
    where p.active = true and p.start_date <= v_end and p.end_date >= v_start
    union
    select distinct gs::date as absence_date, ep.employee_id, 'employee_pto'::text as source_table
    from public.employee_pto ep
    cross join lateral generate_series(greatest(ep.start_date, v_start), least(ep.end_date, v_end), interval '1 day') gs
    where ep.active = true and ep.start_date <= v_end and ep.end_date >= v_start
  )
  update public.daily_absence_overrides dao
     set active = false,
         updated_at = now(),
         notes = trim(coalesce(dao.notes, '') || ' Auto PTO sync deactivated because source PTO no longer covers this date.')
   where dao.absence_date between v_start and v_end
     and dao.active = true
     and dao.notes like (v_mark || '%')
     and not exists (select 1 from pto_source src where src.absence_date = dao.absence_date and src.employee_id = dao.employee_id);
  get diagnostics v_deactivated = row_count;

  with pto_source as (
    select distinct gs::date as absence_date, p.employee_id, 'employee_planned_time_off'::text as source_table
    from public.employee_planned_time_off p
    cross join lateral generate_series(greatest(p.start_date, v_start), least(p.end_date, v_end), interval '1 day') gs
    where p.active = true and p.start_date <= v_end and p.end_date >= v_start
    union
    select distinct gs::date as absence_date, ep.employee_id, 'employee_pto'::text as source_table
    from public.employee_pto ep
    cross join lateral generate_series(greatest(ep.start_date, v_start), least(ep.end_date, v_end), interval '1 day') gs
    where ep.active = true and ep.start_date <= v_end and ep.end_date >= v_start
  )
  insert into public.daily_absence_overrides (id, absence_date, employee_id, absence_type, active, notes, created_at, updated_at)
  select gen_random_uuid(), src.absence_date, src.employee_id, 'pto', true, v_mark || ' Synced from ' || string_agg(src.source_table, ', ' order by src.source_table) || '.', now(), now()
  from pto_source src
  where not exists (
    select 1 from public.daily_absence_overrides dao
    where dao.absence_date = src.absence_date and dao.employee_id = src.employee_id and dao.active = true
  )
  group by src.absence_date, src.employee_id
  on conflict (absence_date, employee_id)
  do update set
    absence_type = 'pto',
    active = true,
    notes = excluded.notes,
    updated_at = now()
  where public.daily_absence_overrides.active = false
     or public.daily_absence_overrides.notes like (v_mark || '%');
  get diagnostics v_inserted_or_updated = row_count;

  return jsonb_build_object('ok', true, 'start_date', v_start, 'end_date', v_end, 'inserted_or_updated', v_inserted_or_updated, 'deactivated', v_deactivated);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_upsert_employee_area_preference_by_code(p_employee_name text, p_group_code text, p_preference_type text, p_notes text, p_active boolean DEFAULT true, p_override_restricted boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_employee_id uuid;
  v_location_group_id uuid;
  v_existing_id uuid;
  v_existing_type text;
begin
  select id into v_employee_id
  from public.employees
  where display_name = p_employee_name
  limit 1;

  select id into v_location_group_id
  from public.location_groups
  where group_code = p_group_code
  limit 1;

  if v_employee_id is null then
    raise exception 'Employee not found with display_name: %', p_employee_name;
  end if;

  if v_location_group_id is null then
    raise exception 'Location group not found with group_code: %', p_group_code;
  end if;

  select id, preference_type
    into v_existing_id, v_existing_type
  from public.employee_area_preferences
  where employee_id = v_employee_id
    and location_group_id = v_location_group_id
    and active = true
  order by updated_at desc nulls last, created_at desc nulls last
  limit 1;

  if v_existing_id is null then
    insert into public.employee_area_preferences (
      employee_id, location_group_id, preference_type, notes, active
    ) values (
      v_employee_id, v_location_group_id, p_preference_type, p_notes, p_active
    );
  elsif lower(coalesce(v_existing_type, '')) = 'restricted' and not p_override_restricted then
    update public.employee_area_preferences
       set notes = case
             when coalesce(notes, '') = '' then p_notes
             when notes ilike ('%' || p_notes || '%') then notes
             else trim(concat_ws(' | ', nullif(notes, ''), p_notes))
           end,
           updated_at = now()
     where id = v_existing_id;
  else
    update public.employee_area_preferences
       set preference_type = p_preference_type,
           notes = p_notes,
           active = p_active,
           updated_at = now()
     where id = v_existing_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_validate_kathy_east_boundary(p_start_date date DEFAULT CURRENT_DATE, p_end_date date DEFAULT (CURRENT_DATE + 60))
 RETURNS TABLE(violation_type text, source_table text, service_date date, day_of_week integer, group_code text, group_name text, employee_name text, coverage_start text, coverage_end text, coverage_purpose text, notes text)
 LANGUAGE sql
 STABLE
AS $function$
  select
    'kathy_east_boundary_template'::text,
    'coverage_templates'::text,
    null::date,
    ct.day_of_week,
    lg.group_code,
    lg.group_name,
    e.display_name,
    to_char(ct.coverage_start, 'HH24:MI:SS'),
    to_char(ct.coverage_end, 'HH24:MI:SS'),
    ct.coverage_purpose,
    ct.notes
  from public.coverage_templates ct
  join public.employees e on e.id = ct.assigned_employee_id
  join public.location_groups lg on lg.id = ct.location_group_id
  where ct.active = true
    and e.display_name = 'Kathy Phelps'
    and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')

  union all

  select
    'kathy_east_boundary_daily'::text,
    'daily_schedule_assignments'::text,
    dsa.service_date,
    extract(dow from dsa.service_date)::integer,
    lg.group_code,
    lg.group_name,
    e.display_name,
    to_char(dsa.coverage_start, 'HH24:MI:SS'),
    to_char(dsa.coverage_end, 'HH24:MI:SS'),
    dsa.coverage_purpose,
    dsa.notes
  from public.daily_schedule_assignments dsa
  join public.employees e on e.id = dsa.assigned_employee_id
  join public.location_groups lg on lg.id = dsa.location_group_id
  where dsa.service_date between coalesce(p_start_date, current_date) and coalesce(p_end_date, coalesce(p_start_date, current_date))
    and coalesce(dsa.status, '') = 'ASSIGNED'
    and e.display_name = 'Kathy Phelps'
    and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')

  union all

  select
    'kathy_missing_restricted_preference'::text,
    'employee_area_preferences'::text,
    null::date,
    null::integer,
    lg.group_code,
    lg.group_name,
    e.display_name,
    null::text,
    null::text,
    null::text,
    'Kathy east-boundary preference is not active/restricted.'::text
  from public.employees e
  cross join public.location_groups lg
  where e.display_name = 'Kathy Phelps'
    and lg.group_code in ('CATHOUSE_CAFE_RESTROOMS', 'EVENT_CENTER', 'HERPETARIUM')
    and not exists (
      select 1
      from public.employee_area_preferences eap
      where eap.employee_id = e.id
        and eap.location_group_id = lg.id
        and eap.active = true
        and lower(coalesce(eap.preference_type, '')) = 'restricted'
    );
$function$;

CREATE OR REPLACE FUNCTION public.sch_validate_operational_schedule_rules(p_start_date date DEFAULT CURRENT_DATE, p_end_date date DEFAULT (CURRENT_DATE + 60))
 RETURNS TABLE(violation_type text, source_table text, service_date date, day_of_week integer, group_code text, group_name text, employee_name text, coverage_start text, coverage_end text, coverage_purpose text, notes text)
 LANGUAGE sql
 STABLE
AS $function$
  select 'invalid_gift_shop_template'::text,
         'coverage_templates'::text,
         null::date,
         ct.day_of_week,
         lg.group_code,
         lg.group_name,
         e.display_name,
         to_char(ct.coverage_start,'HH24:MI:SS'),
         to_char(ct.coverage_end,'HH24:MI:SS'),
         ct.coverage_purpose,
         ct.notes
  from public.coverage_templates ct
  join public.location_groups lg on lg.id=ct.location_group_id
  left join public.employees e on e.id=ct.assigned_employee_id
  where ct.active=true
    and lg.group_code like '%GIFT_SHOP'
    and not (
      ct.day_of_week=1
      and coalesce(ct.coverage_purpose,'')='reminder'
      and ct.coverage_start >= time '08:00'
      and ct.coverage_start <= time '08:30'
      and ct.coverage_end <= time '09:45'
    )
  union all
  select 'invalid_gift_shop_daily_assignment'::text,
         'daily_schedule_assignments'::text,
         dsa.service_date,
         extract(dow from dsa.service_date)::integer,
         lg.group_code,
         lg.group_name,
         e.display_name,
         to_char(dsa.coverage_start,'HH24:MI:SS'),
         to_char(dsa.coverage_end,'HH24:MI:SS'),
         dsa.coverage_purpose,
         dsa.notes
  from public.daily_schedule_assignments dsa
  join public.location_groups lg on lg.id=dsa.location_group_id
  left join public.employees e on e.id=dsa.assigned_employee_id
  where dsa.service_date between coalesce(p_start_date,current_date) and coalesce(p_end_date,coalesce(p_start_date,current_date))
    and lg.group_code like '%GIFT_SHOP'
    and not (
      extract(dow from dsa.service_date)::integer=1
      and coalesce(dsa.coverage_purpose,'')='reminder'
      and dsa.coverage_start >= time '08:00'
      and dsa.coverage_start <= time '08:30'
      and dsa.coverage_end <= time '09:45'
    )
  order by 1,2,4,3,5,8;
$function$;

CREATE OR REPLACE FUNCTION public.set_system_setting(p_setting_key text, p_setting_value jsonb, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row public.system_settings%rowtype;
begin
  insert into public.system_settings (
    setting_key,
    setting_value,
    description
  )
  values (
    p_setting_key,
    p_setting_value,
    p_description
  )
  on conflict (setting_key) do update
  set
    setting_value = excluded.setting_value,
    description = coalesce(excluded.description, public.system_settings.description),
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'setting_key', v_row.setting_key,
    'setting_value', v_row.setting_value,
    'description', v_row.description,
    'updated_at', v_row.updated_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
    return new;
    end;
    $function$;

CREATE OR REPLACE FUNCTION public.set_updated_at_schedule_automation_runs()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at_schedule_operational_notes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_migration_log_summary()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  insert into public.migration_log_summary(
    migration_name, statement_count, total_sql_bytes, latest_sql_sha256,
    first_applied_at, last_applied_at, last_applied_by, updated_at
  ) values (
    new.migration_name, 1, octet_length(new.sql_text),
    encode(digest(new.sql_text, 'sha256'), 'hex'),
    new.applied_at, new.applied_at, new.applied_by, now()
  )
  on conflict (migration_name) do update
  set statement_count = public.migration_log_summary.statement_count + 1,
      total_sql_bytes = public.migration_log_summary.total_sql_bytes + excluded.total_sql_bytes,
      latest_sql_sha256 = excluded.latest_sql_sha256,
      first_applied_at = least(public.migration_log_summary.first_applied_at, excluded.first_applied_at),
      last_applied_at = greatest(public.migration_log_summary.last_applied_at, excluded.last_applied_at),
      last_applied_by = excluded.last_applied_by,
      updated_at = now();
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.tool_report_device_sync_status(p_device_identifier text, p_queue_count integer, p_oldest_item_at timestamp with time zone, p_retry_count integer, p_last_server_ack_at timestamp with time zone, p_frontend_version text, p_last_error text, p_correlation_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_device public.devices%rowtype;
  v_now timestamptz := now();
begin
  select d.* into v_device
  from public.device_aliases da
  join public.devices d
    on d.id = da.canonical_device_id
   and d.active = true
  where da.alias_identifier = btrim(p_device_identifier)
    and da.active = true
  limit 1;

  if not found then
    select d.* into v_device
    from public.devices d
    where d.device_id = btrim(p_device_identifier)
      and d.active = true
    limit 1;
  end if;

  if v_device.id is null then
    raise exception 'Active device not found.';
  end if;

  insert into public.device_sync_status(
    device_id,
    presented_identifier,
    queue_count,
    oldest_item_at,
    retry_count,
    last_server_ack_at,
    frontend_version,
    last_error,
    correlation_id,
    updated_at
  ) values (
    v_device.id,
    btrim(p_device_identifier),
    greatest(0, coalesce(p_queue_count, 0)),
    p_oldest_item_at,
    greatest(0, coalesce(p_retry_count, 0)),
    p_last_server_ack_at,
    nullif(btrim(coalesce(p_frontend_version, '')), ''),
    left(nullif(coalesce(p_last_error, ''), ''), 1000),
    nullif(btrim(coalesce(p_correlation_id, '')), ''),
    v_now
  )
  on conflict(device_id) do update set
    presented_identifier = excluded.presented_identifier,
    queue_count = excluded.queue_count,
    oldest_item_at = excluded.oldest_item_at,
    retry_count = excluded.retry_count,
    last_server_ack_at = excluded.last_server_ack_at,
    frontend_version = excluded.frontend_version,
    last_error = excluded.last_error,
    correlation_id = excluded.correlation_id,
    updated_at = v_now;

  update public.devices
  set last_seen_at = v_now,
      updated_at = v_now
  where id = v_device.id;

  return jsonb_build_object(
    'ok', true,
    'device_id', v_device.device_id,
    'updated_at', v_now,
    'last_seen_at', v_now
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_session(p_session_uuid text, p_response_json jsonb DEFAULT '{}'::jsonb, p_submitted_by_employee_name text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_client_completion_id text DEFAULT NULL::text)
 RETURNS TABLE(session_uuid text, location_name text, employee_name text, status text, submitted_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
declare
  v_session_id uuid;
  v_location_id uuid;
  v_location_name text;
  v_employee_id uuid;
  v_employee_name text;
  v_device_pk uuid;
  v_now timestamptz := now();
  v_completion_response_id uuid;
begin
  if p_client_completion_id is not null then
    if exists (
      select 1
      from public.completion_responses cr
      where cr.client_completion_id = p_client_completion_id
    ) then
      return query
      select
        s.session_uuid,
        l.location_name,
        e.display_name,
        s.status,
        coalesce(cr.submitted_at, v_now)
      from public.sessions s
      join public.locations l on l.id = s.location_id
      join public.employees e on e.id = s.employee_id
      left join public.completion_responses cr on cr.session_id = s.id
      where s.session_uuid = p_session_uuid
      limit 1;
      return;
    end if;
  end if;

  select
    s.id,
    s.location_id,
    l.location_name,
    e.id,
    e.display_name
  into
    v_session_id,
    v_location_id,
    v_location_name,
    v_employee_id,
    v_employee_name
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  where s.session_uuid = p_session_uuid
    and s.status = 'pending_submit'
  limit 1;

  if v_session_id is null then
    raise exception 'Pending session not found for session_uuid: %', p_session_uuid;
  end if;

  if p_device_id is not null then
    select d.id
      into v_device_pk
    from public.devices d
    where d.device_id = p_device_id
    limit 1;
  else
    v_device_pk := null;
  end if;

  insert into public.completion_responses (
    session_id,
    location_id,
    submitted_by_employee_id,
    device_id,
    response_json,
    submitted_at,
    client_completion_id
  )
  values (
    v_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    coalesce(p_response_json, '{}'::jsonb),
    v_now,
    p_client_completion_id
  )
  on conflict (session_id) do update
  set
    response_json = excluded.response_json,
    submitted_at = excluded.submitted_at,
    submitted_by_employee_id = excluded.submitted_by_employee_id,
    device_id = excluded.device_id,
    client_completion_id = coalesce(excluded.client_completion_id, public.completion_responses.client_completion_id)
  returning id into v_completion_response_id;

  perform public.create_maintenance_tickets_from_response(
    v_completion_response_id,
    v_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    v_now,
    coalesce(p_response_json, '{}'::jsonb)
  );

  update public.sessions
  set
    status = 'closed',
    completion_source = 'kiosk_form',
    updated_at = now()
  where id = v_session_id;

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json
  )
  values (
    v_session_id,
    'session_completed',
    'form',
    coalesce(p_submitted_by_employee_name, 'unknown'),
    jsonb_build_object(
      'response', coalesce(p_response_json, '{}'::jsonb),
      'client_completion_id', p_client_completion_id
    )
  );

  insert into public.system_logs (
    level,
    source,
    message,
    session_id,
    location_id,
    device_id
  )
  values (
    'INFO',
    'complete_session',
    'Session closed after completion submission',
    v_session_id,
    v_location_id,
    v_device_pk
  );

  return query
  select
    p_session_uuid,
    v_location_name,
    v_employee_name,
    'closed'::text,
    v_now;
end;
$function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_complete_open_dynamic(p_run_id uuid, p_force boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_changed integer := 0;
begin
  update public.sessions s
  set
    status = 'pending_submit',
    ended_at = coalesce(
      s.ended_at,
      least(now(), s.started_at + make_interval(mins => public.demo_scan_mock_demo_duration_minutes(s.id::text)))
    ),
    duration_minutes = coalesce(s.duration_minutes, public.demo_scan_mock_demo_duration_minutes(s.id::text)),
    duration_display = coalesce(s.duration_display, public.demo_scan_mock_demo_duration_minutes(s.id::text)::text || ' min'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'active'
    and (
      p_force
      or now() >= s.started_at + make_interval(mins => public.demo_scan_mock_demo_duration_minutes(s.id::text))
    );

  update public.sessions s
  set
    status = 'closed',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::integer)::text || ' min'),
    completion_source = coalesce(s.completion_source, 'kiosk_form'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'pending_submit';
  get diagnostics v_changed = row_count;

  insert into public.completion_responses (
    session_id,
    location_id,
    submitted_by_employee_id,
    device_id,
    response_json,
    submitted_at,
    created_at,
    client_completion_id
  )
  select
    s.id,
    s.location_id,
    s.employee_id,
    s.device_id,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'mode', 'assigned_area_schedule',
      'duration_minutes', s.duration_minutes,
      'services_performed', to_jsonb(array['trash_removed', 'surfaces_checked', 'supplies_checked']::text[]),
      'notes', 'Demo assigned-area cleaning completed in ' || coalesce(s.duration_display, '15-20 min') || '.',
      'cleaning_notes', 'Demo assigned-area cleaning completed in ' || coalesce(s.duration_display, '15-20 min') || '.'
    ),
    coalesce(s.ended_at, now()),
    coalesce(s.ended_at, now()),
    'demo-completion:' || p_run_id::text || ':assigned-area:session:' || s.id::text
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':%')
    and s.status = 'closed'
    and not exists (select 1 from public.completion_responses cr where cr.session_id = s.id);

  return v_changed;
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_stop(p_run_id uuid DEFAULT NULL::uuid, p_cleanup boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_changed integer := 0;
  v_deleted jsonb := null;
begin
  select id into v_run_id
  from public.demo_scan_mock_runs
  where (p_run_id is null or id = p_run_id)
  order by case when status = 'active' then 0 else 1 end, started_at desc
  limit 1;

  if p_cleanup then
    with x as (select * from public.demo_scan_mock_cleanup(p_run_id))
    select to_jsonb(x.*) into v_deleted from x;
    return jsonb_build_object('run_id', coalesce(v_run_id::text, p_run_id::text, 'all'), 'stopped', true, 'cleanup', true, 'deleted', v_deleted);
  end if;

  if v_run_id is null then
    return jsonb_build_object('run_id', null, 'stopped', false, 'cleanup', false, 'message', 'No demo run found.');
  end if;

  update public.sessions
  set status = 'cancelled', updated_at = now()
  where client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and status = 'active';
  get diagnostics v_changed = row_count;

  update public.demo_scan_mock_runs
  set status = 'stopped', stopped_at = now(), updated_at = now()
  where id = v_run_id;

  return jsonb_build_object('run_id', v_run_id::text, 'stopped', true, 'cleanup', false, 'cancelled_open_sessions', v_changed);
end $function$;

CREATE OR REPLACE FUNCTION public.device_auth_auto_enforce_when_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  perform public.device_auth_evaluate_and_enforce();
  return coalesce(new,old);
end
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_device_reminder(p_instance_key text, p_device_id text, p_reminder_kind text DEFAULT 'notification'::text, p_source_id text DEFAULT NULL::text, p_metadata_json jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.ack_device_notification(
    p_device_id,
    p_instance_key,
    p_reminder_kind,
    'dismissed',
    coalesce(p_metadata_json,'{}'::jsonb) || jsonb_build_object('source_id',p_source_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_location_proximity(p_location_code text, p_device_identifier text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric, p_session_uuid text DEFAULT NULL::text, p_client_event_id text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_presented_device text := nullif(btrim(coalesce(p_device_identifier, '')), '');
  v_resolved_location_code text := public.resolve_scan_location_code(p_location_code);
  v_device_pk uuid;
  v_device_id text;
  v_location_id uuid;
  v_location_name text;
  v_session_id uuid;
  v_target_lat numeric;
  v_target_lon numeric;
  v_coordinate_source text;
  v_radius numeric := greatest(25, public.get_setting_int('gps_proximity_radius_m', 175));
  v_max_accuracy numeric := greatest(25, public.get_setting_int('gps_max_accuracy_m', 100));
  v_distance numeric;
  v_effective_radius numeric;
  v_result text;
  v_badge_color text;
  v_event_id uuid;
  v_session_key text := coalesce(nullif(btrim(p_session_uuid), ''), '');
begin
  if v_presented_device is null then raise exception 'device identifier is required'; end if;
  if v_resolved_location_code is null then raise exception 'Active location not found for code: %', p_location_code; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then raise exception 'latitude is invalid'; end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then raise exception 'longitude is invalid'; end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then raise exception 'accuracy_m cannot be negative'; end if;

  select d.id, d.device_id
    into v_device_pk, v_device_id
  from public.devices d
  where d.active = true and upper(btrim(d.device_id)) = upper(v_presented_device)
  union all
  select d.id, d.device_id
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active = true
  where da.active = true and upper(btrim(da.alias_identifier)) = upper(v_presented_device)
  limit 1;
  if v_device_pk is null then raise exception 'Active device not found: %', v_presented_device; end if;

  select l.id, l.location_name
    into v_location_id, v_location_name
  from public.locations l
  where l.active = true and l.location_code = v_resolved_location_code
  limit 1;

  if v_session_key <> '' then
    select s.id into v_session_id
    from public.sessions s
    where s.session_uuid = v_session_key
      and s.device_id = v_device_pk
      and s.location_id = v_location_id
    limit 1;
    if v_session_id is null then
      raise exception 'Session does not belong to this device and location';
    end if;
  end if;

  select lp.latitude, lp.longitude,
         coalesce(nullif(lp.coordinate_source, ''), 'location_proximity_settings')
    into v_target_lat, v_target_lon, v_coordinate_source
  from public.location_proximity_settings lp
  where lp.location_id = v_location_id
    and lp.active = true
    and lp.latitude is not null
    and lp.longitude is not null
  order by lp.updated_at desc
  limit 1;

  if v_target_lat is null or v_target_lon is null then
    select gp.latitude, gp.longitude,
           coalesce(nullif(gp.coordinate_source, ''), 'location_group_proximity_settings')
      into v_target_lat, v_target_lon, v_coordinate_source
    from public.location_group_memberships gm
    join public.location_groups lg on lg.id = gm.location_group_id and lg.active = true
    join public.location_group_proximity_settings gp
      on gp.location_group_id = lg.id
     and gp.active = true
     and gp.latitude is not null
     and gp.longitude is not null
    where gm.location_id = v_location_id and gm.active = true
    order by gp.updated_at desc, lg.group_name
    limit 1;
  end if;

  if v_target_lat is null or v_target_lon is null then
    v_result := 'not_configured';
    v_badge_color := 'amber';
    v_effective_radius := v_radius;
  else
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians((p_latitude - v_target_lat)::double precision) / 2), 2)
      + cos(radians(v_target_lat::double precision))
      * cos(radians(p_latitude::double precision))
      * power(sin(radians((p_longitude - v_target_lon)::double precision) / 2), 2)
    ));
    v_effective_radius := v_radius + least(greatest(coalesce(p_accuracy_m, 0), 0), 25);
    if p_accuracy_m is not null and p_accuracy_m > v_max_accuracy then
      v_result := 'low_accuracy';
      v_badge_color := 'amber';
    elsif v_distance <= v_effective_radius then
      v_result := 'near';
      v_badge_color := 'green';
    else
      v_result := 'away';
      v_badge_color := 'red';
    end if;
  end if;

  insert into public.device_location_proximity_status(
    device_id, location_id, session_uuid, presented_identifier, result, badge_color,
    distance_m, allowed_radius_m, accuracy_m, client_latitude, client_longitude,
    target_latitude, target_longitude, coordinate_source, evaluated_at,
    correlation_id, metadata_json
  ) values (
    v_device_pk, v_location_id, v_session_key, v_presented_device, v_result, v_badge_color,
    v_distance, v_effective_radius, p_accuracy_m, p_latitude, p_longitude,
    v_target_lat, v_target_lon, v_coordinate_source, now(),
    nullif(btrim(coalesce(p_correlation_id, '')), ''),
    jsonb_build_object('location_code', v_resolved_location_code, 'location_name', v_location_name)
  )
  on conflict (device_id, location_id, session_uuid) do update set
    presented_identifier = excluded.presented_identifier,
    result = excluded.result,
    badge_color = excluded.badge_color,
    distance_m = excluded.distance_m,
    allowed_radius_m = excluded.allowed_radius_m,
    accuracy_m = excluded.accuracy_m,
    client_latitude = excluded.client_latitude,
    client_longitude = excluded.client_longitude,
    target_latitude = excluded.target_latitude,
    target_longitude = excluded.target_longitude,
    coordinate_source = excluded.coordinate_source,
    evaluated_at = now(),
    correlation_id = excluded.correlation_id,
    metadata_json = excluded.metadata_json;

  if p_client_event_id is not null then
    select se.id into v_event_id
    from public.scan_events se
    where se.client_event_id = p_client_event_id
    limit 1;
  end if;

  if v_event_id is null then
    insert into public.scan_events(
      scanned_at, location_id, location_code, device_id, device_identifier,
      session_id, event_type, result, notes, payload_json, client_event_id
    ) values (
      now(), v_location_id, v_resolved_location_code, v_device_pk, v_device_id,
      v_session_id, 'work_position_check', v_result,
      case
        when v_result = 'away' then format('Phone is %s meters from the authoritative location coordinate.', round(v_distance))
        when v_result = 'near' then 'Phone is within the authoritative location radius.'
        when v_result = 'low_accuracy' then 'GPS accuracy is too low for a green proximity result.'
        else 'No authoritative GPS coordinate is configured for this location.'
      end,
      jsonb_build_object(
        'distance_m', v_distance,
        'allowed_radius_m', v_effective_radius,
        'accuracy_m', p_accuracy_m,
        'client_latitude', p_latitude,
        'client_longitude', p_longitude,
        'target_latitude', v_target_lat,
        'target_longitude', v_target_lon,
        'coordinate_source', v_coordinate_source,
        'badge_color', v_badge_color,
        'correlation_id', p_correlation_id
      ),
      nullif(btrim(coalesce(p_client_event_id, '')), '')
    ) returning id into v_event_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', v_result,
    'badge_color', v_badge_color,
    'device_id', v_device_id,
    'presented_device_id', v_presented_device,
    'location_code', v_resolved_location_code,
    'location_name', v_location_name,
    'session_uuid', nullif(v_session_key, ''),
    'distance_m', case when v_distance is null then null else round(v_distance, 1) end,
    'allowed_radius_m', round(v_effective_radius, 1),
    'accuracy_m', p_accuracy_m,
    'target_latitude', v_target_lat,
    'target_longitude', v_target_lon,
    'coordinate_source', v_coordinate_source,
    'evaluated_at', now(),
    'scan_event_id', v_event_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_open_sessions(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_timeout_minutes integer := public.get_setting_int('stale_session_timeout_minutes',120);
  v_expired_count integer := 0;
  r record;
begin
  for r in
    select s.id,s.status,s.location_id,s.device_id,s.started_at,s.ended_at
    from public.sessions s
    where (s.status='active' and s.started_at<=p_now-make_interval(mins=>v_timeout_minutes))
       or (s.status='pending_submit' and coalesce(s.ended_at,s.started_at)<=p_now-make_interval(mins=>v_timeout_minutes))
    order by s.started_at for update skip locked
  loop
    update public.sessions
       set status='cancelled',ended_at=coalesce(ended_at,p_now),
           duration_minutes=coalesce(duration_minutes,greatest(0,round(extract(epoch from (coalesce(ended_at,p_now)-started_at))/60.0))),
           duration_display=coalesce(duration_display,greatest(0,round(extract(epoch from (coalesce(ended_at,p_now)-started_at))/60.0))::text||' min'),
           completion_source=coalesce(completion_source,'system'),updated_at=p_now
     where id=r.id and status=r.status;
    if found then
      insert into public.session_events(session_id,event_type,actor_type,actor_ref,details_json)
      values(r.id,'session_auto_cancelled','system','expire_stale_open_sessions',jsonb_build_object('reason','stale_timeout','previous_status',r.status,'timeout_minutes',v_timeout_minutes,'cancelled_at',p_now));
      insert into public.system_logs(level,source,message,session_id,location_id,device_id)
      values('WARN','expire_stale_open_sessions','Stale session cancelled without fabricating completion',r.id,r.location_id,r.device_id);
      v_expired_count:=v_expired_count+1;
    end if;
  end loop;
  return v_expired_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finish_session(p_location_code text, p_device_id text)
 RETURNS TABLE(session_uuid text, location_name text, employee_name text, device_id text, status text, started_at timestamp with time zone, ended_at timestamp with time zone, duration_minutes integer, duration_display text)
 LANGUAGE plpgsql
AS $function$
declare
  v_location_id uuid;
  v_location_name text;
  v_device_pk uuid;
  v_session_id uuid;
  v_session_uuid text;
  v_employee_name text;
  v_started_at timestamptz;
  v_ended_at timestamptz := now();
  v_duration_minutes integer;
  v_duration_display text;
  v_resolved_location_code text := public.resolve_scan_location_code(p_location_code);
begin
  select l.id, l.location_name
    into v_location_id, v_location_name
  from public.locations l
  where l.location_code = v_resolved_location_code
    and l.active = true
  limit 1;

  if v_location_id is null then
    raise exception 'Active location not found for code: %', p_location_code;
  end if;

  select d.id
    into v_device_pk
  from public.devices d
  where d.device_id = p_device_id
    and d.active = true
  limit 1;

  if v_device_pk is null then
    raise exception 'Active device not found: %', p_device_id;
  end if;

  select
    s.id,
    s.session_uuid,
    e.display_name,
    s.started_at
  into
    v_session_id,
    v_session_uuid,
    v_employee_name,
    v_started_at
  from public.sessions s
  join public.employees e on e.id = s.employee_id
  where s.location_id = v_location_id
    and s.device_id = v_device_pk
    and s.status = 'active'
  order by s.started_at desc
  limit 1;

  if v_session_id is null then
    raise exception 'No active session found for location % and device %', coalesce(v_resolved_location_code, p_location_code), p_device_id;
  end if;

  v_duration_minutes := greatest(0, round(extract(epoch from (v_ended_at - v_started_at)) / 60.0));
  v_duration_display := v_duration_minutes::text || ' min';

  update public.sessions
  set
    status = 'pending_submit',
    ended_at = v_ended_at,
    duration_minutes = v_duration_minutes,
    duration_display = v_duration_display,
    updated_at = now()
  where id = v_session_id;

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json
  )
  values (
    v_session_id,
    'session_finished',
    'device',
    p_device_id,
    jsonb_build_object(
      'location_code', coalesce(v_resolved_location_code, p_location_code),
      'scan_input_code', p_location_code,
      'device_id', p_device_id,
      'duration_minutes', v_duration_minutes
    )
  );

  insert into public.system_logs (
    level,
    source,
    message,
    session_id,
    location_id,
    device_id
  )
  values (
    'INFO',
    'finish_session',
    'Session moved to pending_submit',
    v_session_id,
    v_location_id,
    v_device_pk
  );

  return query
  select
    v_session_uuid,
    v_location_name,
    v_employee_name,
    p_device_id,
    'pending_submit'::text,
    v_started_at,
    v_ended_at,
    v_duration_minutes,
    v_duration_display;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_location_scan_state(p_location_code text, p_device_id text)
 RETURNS TABLE(location_code text, location_name text, location_type text, location_active boolean, device_approved boolean, latest_session_uuid text, latest_session_status text, latest_employee_name text, latest_device_id text, started_at timestamp with time zone, ended_at timestamp with time zone, suggested_action text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_device_ok boolean;
  v_resolved_location_code text := public.resolve_scan_location_code(p_location_code);
begin
  v_device_ok := public.is_approved_device(p_device_id);

  return query
  select
    coalesce(vls.location_code, v_resolved_location_code, p_location_code),
    vls.location_name,
    vls.location_type,
    vls.location_active,
    v_device_ok,
    vls.session_uuid,
    vls.session_status,
    vls.employee_name,
    vls.device_id,
    vls.started_at,
    vls.ended_at,
    case
      when vls.location_code is null then 'invalid_location'
      when v_device_ok = false then 'unauthorized_device'
      when vls.session_status is null then 'start_session'
      when vls.session_status = 'active' and upper(btrim(vls.device_id)) = upper(btrim(p_device_id)) then 'finish_session'
      when vls.session_status = 'active' then 'blocked_location_active'
      when vls.session_status = 'pending_submit' and upper(btrim(vls.device_id)) = upper(btrim(p_device_id)) then 'resume_pending_submit'
      when vls.session_status = 'pending_submit' then 'blocked_pending_submit'
      when vls.session_status in ('closed', 'cancelled') then 'start_session'
      else 'unknown'
    end
  from public.v_location_status vls
  where vls.location_code = v_resolved_location_code

  union all

  select p_location_code, null, null, false, v_device_ok,
         null, null, null, null, null, null, 'invalid_location'
  where v_resolved_location_code is null;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_setting_bool(p_setting_key text, p_default boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v jsonb;
begin
  select public.get_setting(p_setting_key) into v;
  if v is null then
    return p_default;
  end if;
  return (v::text)::boolean;
exception
  when others then
    return p_default;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_setting_text(p_setting_key text, p_default text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v jsonb;
begin
  select public.get_setting(p_setting_key) into v;
  if v is null then
    return p_default;
  end if;
  return trim(both '"' from v::text);
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_get_or_create_memphis_thread(p_user_id uuid)
 RETURNS msg_threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_memphis_user_id uuid;
  v_thread public.msg_threads%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id is required.';
  end if;
  if not public.msg_is_runtime_user(p_user_id) then
    raise exception 'User is not an active custodial Messenger identity.';
  end if;

  select mu.id into v_memphis_user_id
  from public.msg_users mu
  where mu.is_active = true
    and mu.role = 'bot'
    and lower(btrim(mu.display_name)) = 'memphis'
  order by mu.created_at asc
  limit 1;

  if v_memphis_user_id is null then
    raise exception 'Memphis bot user not found.';
  end if;
  if p_user_id = v_memphis_user_id then
    raise exception 'Memphis cannot create a conversation with itself.';
  end if;

  select t.* into v_thread
  from public.msg_threads t
  join public.msg_thread_participants p1
    on p1.thread_id = t.id and p1.user_id = p_user_id and p1.left_at is null
  join public.msg_thread_participants p2
    on p2.thread_id = t.id and p2.user_id = v_memphis_user_id and p2.left_at is null
  where t.is_active = true
    and t.thread_type in ('bot','direct')
    and 2 = (
      select count(*)
      from public.msg_thread_participants px
      where px.thread_id = t.id and px.left_at is null
    )
  order by case when t.thread_type = 'bot' then 0 else 1 end, t.created_at asc
  limit 1;

  if v_thread.id is not null then
    if v_thread.thread_type <> 'bot' or coalesce(v_thread.title,'') <> 'Memphis' then
      update public.msg_threads
      set thread_type = 'bot', title = 'Memphis', updated_at = now()
      where id = v_thread.id
      returning * into v_thread;
    end if;
    return v_thread;
  end if;

  insert into public.msg_threads(thread_type, title, created_by_user_id, is_active)
  values('bot', 'Memphis', p_user_id, true)
  returning * into v_thread;

  insert into public.msg_thread_participants(thread_id, user_id)
  values(v_thread.id, p_user_id), (v_thread.id, v_memphis_user_id);

  return v_thread;
end
$function$;

CREATE OR REPLACE FUNCTION public.msg_list_threads_for_device(p_user_id uuid, p_device_identifier text)
 RETURNS TABLE(thread_id uuid, thread_type text, thread_title text, last_message_at timestamp with time zone, updated_at timestamp with time zone, last_message_id uuid, last_message_body text, last_message_type text, last_sender_name text, unread_count integer)
 LANGUAGE sql
 STABLE
AS $function$
  with base as (
    select * from public.msg_list_threads(p_user_id)
  )
  select b.*
  from base b
  left join public.msg_hidden_threads_by_device h
    on h.thread_id = b.thread_id
   and h.device_identifier = btrim(coalesce(p_device_identifier, ''))
  where h.id is null
     or h.hidden_at < coalesce(b.last_message_at, b.updated_at)
  order by coalesce(b.last_message_at, b.updated_at) desc, b.thread_id;
$function$;

CREATE OR REPLACE FUNCTION public.msg_list_users(p_current_user_id uuid)
 RETURNS TABLE(id uuid, display_name text, role text, is_active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select mu.id, mu.display_name, mu.role, mu.is_active
  from public.msg_users mu
  where mu.is_active = true
    and public.msg_is_runtime_user(mu.id)
    and (p_current_user_id is null or mu.id <> p_current_user_id)
  order by
    case
      when mu.role = 'bot' then 1
      when mu.role in ('manager','ops','ops_manager','operations_manager') then 2
      else 3
    end,
    mu.display_name;
$function$;

CREATE OR REPLACE FUNCTION public.msg_mark_thread_deleted(p_thread_id uuid, p_user_id uuid, p_device_identifier text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_hidden_before timestamptz := clock_timestamp();
  v_requested_device text := nullif(btrim(coalesce(p_device_identifier, '')), '');
  v_canonical_device text;
  v_deleted_count integer := 0;
begin
  if p_thread_id is null or p_user_id is null then
    raise exception 'thread_id and user_id are required.';
  end if;
  if not public.msg_is_runtime_user(p_user_id) then
    raise exception 'User is not an active custodial Messenger identity.';
  end if;
  if not exists (
    select 1
    from public.msg_thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.user_id = p_user_id
      and tp.left_at is null
  ) then
    raise exception 'User is not an active participant in this thread.';
  end if;

  if v_requested_device is not null then
    select d.device_id into v_canonical_device
    from public.devices d
    where d.active = true
      and upper(btrim(d.device_id)) = upper(v_requested_device)
    limit 1;

    if v_canonical_device is null then
      select d.device_id into v_canonical_device
      from public.device_aliases da
      join public.devices d on d.id = da.canonical_device_id and d.active = true
      where da.active = true
        and upper(btrim(da.alias_identifier)) = upper(v_requested_device)
      limit 1;
    end if;
  end if;

  v_canonical_device := coalesce(v_canonical_device, v_requested_device);
  if v_canonical_device is null then
    raise exception 'device_identifier is required.';
  end if;

  insert into public.msg_thread_visibility(
    thread_id, user_id, device_identifier, hidden_before, created_at, updated_at
  ) values (
    p_thread_id, p_user_id, v_canonical_device, v_hidden_before, now(), now()
  )
  on conflict(thread_id, user_id, device_identifier)
  do update set hidden_before = excluded.hidden_before, updated_at = now();

  insert into public.msg_message_deletions(message_id, user_id, deleted_at)
  select m.id, p_user_id, v_hidden_before
  from public.msg_messages m
  where m.thread_id = p_thread_id
    and m.is_deleted = false
    and coalesce(m.sent_at, m.created_at) <= v_hidden_before
  on conflict(message_id, user_id)
  do update set deleted_at = excluded.deleted_at;
  get diagnostics v_deleted_count = row_count;

  update public.msg_thread_participants
  set left_at = v_hidden_before
  where thread_id = p_thread_id
    and user_id = p_user_id
    and left_at is null;

  update public.msg_threads
  set updated_at = now()
  where id = p_thread_id;

  return jsonb_build_object(
    'ok', true,
    'thread_id', p_thread_id,
    'user_id', p_user_id,
    'device_identifier', v_canonical_device,
    'hidden_before', v_hidden_before,
    'deleted_message_count', v_deleted_count,
    'participant_left', true
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.msg_restore_thread_visibility(p_thread_id uuid, p_user_id uuid, p_device_identifier text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_requested text := nullif(btrim(coalesce(p_device_identifier,'')), '');
  v_device text;
begin
  if p_thread_id is null or p_user_id is null then
    raise exception 'thread_id and user_id are required.';
  end if;
  if not public.msg_is_runtime_identity(p_user_id) then
    raise exception 'Runtime messaging user not found or inactive.';
  end if;
  if v_requested is not null then
    select d.device_id into v_device
    from public.devices d
    where d.active=true and upper(btrim(d.device_id))=upper(v_requested)
    union all
    select d.device_id
    from public.device_aliases da
    join public.devices d on d.id=da.canonical_device_id and d.active=true
    where da.active=true and upper(btrim(da.alias_identifier))=upper(v_requested)
    limit 1;
  end if;
  v_device := coalesce(v_device,v_requested,'server');

  delete from public.msg_thread_visibility
  where thread_id=p_thread_id
    and user_id=p_user_id
    and (
      device_identifier is null
      or upper(btrim(device_identifier))=upper(v_device)
      or (v_requested is not null and upper(btrim(device_identifier))=upper(v_requested))
    );
end
$function$;

CREATE OR REPLACE FUNCTION public.msg_send_broadcast(p_sender_user_id uuid, p_title text, p_body text)
 RETURNS TABLE(thread_id uuid, broadcast_id uuid, message_id uuid, recipient_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_thread public.msg_threads%rowtype;
  v_broadcast public.msg_broadcasts%rowtype;
  v_message public.msg_messages%rowtype;
  v_count integer := 0;
begin
  if p_sender_user_id is null then raise exception 'sender_user_id is required.'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'Broadcast body is required.'; end if;
  if not exists (
    select 1 from public.msg_users mu
    where mu.id = p_sender_user_id
      and mu.is_active = true
      and mu.role in ('manager', 'admin')
  ) then
    raise exception 'Manager role required.';
  end if;

  insert into public.msg_threads(thread_type, title, created_by_user_id, is_active, last_message_at)
  values ('broadcast', coalesce(nullif(btrim(p_title), ''), 'Ops Manager Broadcast'), p_sender_user_id, true, now())
  returning * into v_thread;

  insert into public.msg_thread_participants(thread_id, user_id)
  select v_thread.id, mu.id
  from public.msg_users mu
  where mu.is_active = true and mu.role <> 'bot';

  insert into public.msg_broadcasts(thread_id, created_by_user_id, title, body, target_type, target_json)
  values (v_thread.id, p_sender_user_id, nullif(btrim(coalesce(p_title, '')), ''), btrim(p_body), 'all_hands', '{}'::jsonb)
  returning * into v_broadcast;

  v_message := public.msg_send_message(
    v_thread.id,
    p_sender_user_id,
    p_body,
    'broadcast',
    jsonb_build_object('title', p_title, 'broadcast_id', v_broadcast.id, 'target_type', 'all_hands')
  );

  insert into public.msg_broadcast_recipients(
    broadcast_id, user_id, delivered_at, displayed_at, read_at, acknowledged_at
  )
  select v_broadcast.id, mu.id, null, null, null, null
  from public.msg_users mu
  where mu.is_active = true
    and mu.role <> 'bot'
    and mu.id <> p_sender_user_id;

  select count(*)::int into v_count
  from public.msg_broadcast_recipients br
  where br.broadcast_id = v_broadcast.id;

  return query select v_thread.id, v_broadcast.id, v_message.id, v_count;
end
$function$;

CREATE OR REPLACE FUNCTION public.mz_retention_setting_int(p_key text, p_default integer, p_min integer DEFAULT 1, p_max integer DEFAULT 1000000)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_value integer;
begin
  v_value := public.get_setting_int(p_key, p_default);
  if v_value is null then
    v_value := p_default;
  end if;
  return greatest(p_min, least(p_max, v_value));
exception when others then
  return p_default;
end;
$function$;

CREATE OR REPLACE FUNCTION public.operational_day_start(p_ref timestamp with time zone DEFAULT now())
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_start_hour integer := public.get_setting_int('operational_day_start_hour', 4);
  v_local timestamp;
begin
  v_local := timezone('America/Chicago', p_ref);

  return (
    date_trunc('day', v_local - make_interval(hours => v_start_hour))
    + make_interval(hours => v_start_hour)
  ) at time zone 'America/Chicago';
end;
$function$;

CREATE OR REPLACE FUNCTION public.scan_history_storage_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_sessions_bytes bigint := pg_total_relation_size('public.sessions');
  v_completion_bytes bigint := pg_total_relation_size('public.completion_responses');
  v_scan_events_bytes bigint := pg_total_relation_size('public.scan_events');
  v_session_events_bytes bigint := pg_total_relation_size('public.session_events');
  v_system_logs_bytes bigint := pg_total_relation_size('public.system_logs');
  v_tickets_bytes bigint := pg_total_relation_size('public.maintenance_tickets');
  v_total_bytes bigint;
  v_warning_mb integer := public.get_setting_int('scan_history_warning_mb', 350);
begin
  v_total_bytes := v_sessions_bytes
    + v_completion_bytes
    + v_scan_events_bytes
    + v_session_events_bytes
    + v_system_logs_bytes
    + v_tickets_bytes;

  return jsonb_build_object(
    'warning_mb', v_warning_mb,
    'total_bytes', v_total_bytes,
    'total_mb', round((v_total_bytes::numeric / 1024 / 1024), 2),
    'near_warning', v_total_bytes >= (v_warning_mb::bigint * 1024 * 1024),
    'tables', jsonb_build_object(
      'sessions', v_sessions_bytes,
      'completion_responses', v_completion_bytes,
      'scan_events', v_scan_events_bytes,
      'session_events', v_session_events_bytes,
      'system_logs', v_system_logs_bytes,
      'maintenance_tickets', v_tickets_bytes
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch2_publish_solution(p_run_id uuid, p_confirm boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run public.schedule_generation_runs%rowtype;
  v_audit jsonb;
  v_diff jsonb;
  v_audit_id uuid;
  v_previous_rows jsonb := '[]'::jsonb;
  v_published_rows jsonb := '[]'::jsonb;
  v_current_hash text;
  v_inserted integer := 0;
  v_expected_count integer := 0;
  v_actual_count integer := 0;
begin
  -- C13: service_role guard — already present but reinforced here.
  if coalesce(p_confirm, false)
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'postgres' then
    raise exception 'SCH2 publish confirm requires service_role backend execution';
  end if;

  perform pg_advisory_xact_lock(hashtext('memphis_sch2_publish'));

  select * into v_run
  from public.schedule_generation_runs
  where id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SCH2 run not found', 'run_id', p_run_id);
  end if;

  v_current_hash := public.sch2_input_hash(v_run.service_date);
  if v_current_hash is distinct from v_run.input_hash then
    return jsonb_build_object(
      'ok', false,
      'error', 'SCH2 preview is stale; regenerate before publishing',
      'run_id', p_run_id,
      'service_date', v_run.service_date,
      'preview_input_hash', v_run.input_hash,
      'current_input_hash', v_current_hash
    );
  end if;

  v_audit := public.sch2_audit_solution(p_run_id);
  if coalesce((v_audit->>'hard_violation_count')::integer, 0) > 0
     or coalesce((v_audit->>'open_required_count')::integer, 0) > 0
     or coalesce((v_audit->>'work_item_count')::integer, 0) = 0
     or coalesce((v_audit->>'solution_assignment_count')::integer, 0) = 0
     or coalesce((v_audit->>'solution_assignment_count')::integer, 0) <> coalesce((v_audit->>'work_item_count')::integer, 0) then
    return jsonb_build_object(
      'ok', false,
      'error', 'SCH2 publish blocked by hard violations, required OPEN rows, empty preview, or preview row-count mismatch',
      'run_id', p_run_id,
      'audit', v_audit
    );
  end if;

  v_diff := public.sch2_compare_current_vs_preview(p_run_id);

  -- C12: Capture existing rows for rollback before any destructive operation.
  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_previous_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_run.service_date;

  insert into public.schedule_publish_audit (
    run_id,
    service_date,
    previous_rows,
    published_rows,
    diff_summary,
    published_by,
    status,
    published_at
  ) values (
    p_run_id,
    v_run.service_date,
    v_previous_rows,
    '[]'::jsonb,
    v_diff,
    current_user,
    case when coalesce(p_confirm, false) then 'publishing' else 'dry_run' end,
    now()
  ) returning id into v_audit_id;

  if not coalesce(p_confirm, false) then
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'publish_audit_id', v_audit_id,
      'run_id', p_run_id,
      'service_date', v_run.service_date,
      'audit', v_audit,
      'diff', v_diff
    );
  end if;

  -- C12: Capture expected count before delete.
  select count(*)::integer into v_expected_count
  from public.schedule_solution_assignments
  where run_id = p_run_id;

  -- C12: DELETE-then-INSERT with explicit error handling.
  -- PostgreSQL functions are atomic, so any failure will roll back the entire
  -- operation including the DELETE. We wrap in a sub-block to catch errors,
  -- log them to the audit row, and re-raise to force full rollback.
  begin
    delete from public.daily_schedule_assignments
     where service_date = v_run.service_date;

    insert into public.daily_schedule_assignments (
      service_date,
      location_group_id,
      segment_number,
      assigned_employee_id,
      owner_type,
      coverage_start,
      coverage_end,
      status,
      load_points,
      notes,
      source_type,
      coverage_purpose
    )
    select
      sa.service_date,
      sa.location_group_id,
      sa.segment_number,
      sa.assigned_employee_id,
      sa.owner_type,
      sa.coverage_start,
      sa.coverage_end,
      sa.status,
      sa.load_points,
      concat_ws(' | ', nullif(sa.notes, ''), 'Published by SCH2 run ' || p_run_id::text),
      'sch2_published',
      sa.coverage_purpose
    from public.schedule_solution_assignments sa
    where sa.run_id = p_run_id
    order by sa.coverage_start, sa.location_group_id, sa.segment_number;

    get diagnostics v_inserted = row_count;
  exception
    when others then
      -- C12: Log the error to the audit row, then re-raise to force rollback.
      -- The RAISE will abort the transaction, undoing the DELETE.
      update public.schedule_publish_audit
         set status = 'publish_error', error_message = 'INSERT failed: ' || sqlerrm
       where id = v_audit_id;
      raise exception 'SCH2 publish INSERT failed for run %: %', p_run_id, sqlerrm;
  end;

  -- C12: Verify step — count inserted rows vs expected.
  select count(*)::integer into v_actual_count
  from public.daily_schedule_assignments
  where service_date = v_run.service_date;

  if v_actual_count <> v_expected_count then
    -- Row count mismatch — the data is in an inconsistent state.
    -- Raise to force full transaction rollback (including the DELETE).
    update public.schedule_publish_audit
       set status = 'publish_error',
           error_message = format('Row count mismatch: expected %s, actual %s', v_expected_count, v_actual_count)
     where id = v_audit_id;
    raise exception 'SCH2 publish verify failed for run %: expected % rows, found %',
      p_run_id, v_expected_count, v_actual_count;
  end if;

  select coalesce(jsonb_agg(to_jsonb(dsa) order by dsa.coverage_start, dsa.location_group_id, dsa.segment_number), '[]'::jsonb)
    into v_published_rows
  from public.daily_schedule_assignments dsa
  where dsa.service_date = v_run.service_date;

  update public.schedule_publish_audit
     set published_rows = v_published_rows,
         status = 'published',
         published_at = now()
   where id = v_audit_id;

  update public.schedule_generation_runs
     set status = 'published', published_at = now(), published_by = current_user, updated_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'publish_audit_id', v_audit_id,
    'run_id', p_run_id,
    'service_date', v_run.service_date,
    'inserted_rows', v_inserted,
    'expected_rows', v_expected_count,
    'verified_rows', v_actual_count,
    'audit', v_audit,
    'diff', v_diff
  );
exception
  when others then
    if v_audit_id is not null then
      update public.schedule_publish_audit
         set status = 'publish_error', error_message = sqlerrm
       where id = v_audit_id;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_apply_lunch_coverage_base_20260628(p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row record;
  v_candidate_employee_id uuid;
  v_candidate_employee_name text;
  v_candidate_explanation text;
  v_lunch_start time;
  v_lunch_end time;
  v_overlap_start time;
  v_overlap_end time;
  v_split_rows integer := 0;
  v_lunch_rows integer := 0;
  v_open_rows integer := 0;
  v_before_after_rows integer := 0;
  v_next_segment integer;
  v_existing_lunch boolean := false;
  v_exists_before boolean := false;
  v_exists_after boolean := false;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  for v_row in
    select dsa.*, e.display_name as owner_name, lw.lunch_start, lw.lunch_end
    from public.daily_schedule_assignments dsa
    join public.employees e on e.id = dsa.assigned_employee_id
    join public.location_groups lg on lg.id = dsa.location_group_id
    join lateral public.sch_lunch_window_for_employee(p_service_date, dsa.assigned_employee_id) lw on true
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id is not null
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.coverage_purpose, '') not in ('lunch_coverage', 'reminder', 'response_only')
      and lg.group_code not in ('PRIMATE_CANYON', 'CAT_COUNTRY')
      and lg.group_code not like '%GIFT_SHOP%'
      and dsa.coverage_start < lw.lunch_end
      and dsa.coverage_end > lw.lunch_start
      and dsa.coverage_start < dsa.coverage_end
    order by dsa.coverage_start, dsa.coverage_end, dsa.location_group_id, dsa.segment_number
  loop
    v_lunch_start := v_row.lunch_start;
    v_lunch_end := v_row.lunch_end;
    v_overlap_start := greatest(v_row.coverage_start, v_lunch_start);
    v_overlap_end := least(v_row.coverage_end, v_lunch_end);

    if v_overlap_start >= v_overlap_end then
      continue;
    end if;

    v_candidate_employee_id := null;
    v_candidate_employee_name := null;
    v_candidate_explanation := null;

    select c.employee_id, c.employee_name, c.explanation
      into v_candidate_employee_id, v_candidate_employee_name, v_candidate_explanation
    from public.sch_get_coverage_candidates(
      p_service_date,
      v_row.location_group_id,
      v_overlap_start,
      v_overlap_end
    ) c
    where c.employee_id <> v_row.assigned_employee_id
      and not exists (
        select 1
        from public.sch_lunch_window_for_employee(p_service_date, c.employee_id) clw
        where clw.lunch_start < v_overlap_end
          and clw.lunch_end > v_overlap_start
      )
    order by c.recommendation_score desc, c.employee_name asc
    limit 1;

    select exists (
      select 1
      from public.daily_schedule_assignments existing
      where existing.service_date = p_service_date
        and existing.location_group_id = v_row.location_group_id
        and existing.coverage_purpose = 'lunch_coverage'
        and existing.coverage_start = v_overlap_start
        and existing.coverage_end = v_overlap_end
    ) into v_existing_lunch;

    -- Check if a "morning ownership" (before) segment already exists.
    v_exists_before := false;
    if v_row.coverage_start < v_overlap_start then
      select exists (
        select 1
        from public.daily_schedule_assignments existing
        where existing.service_date = p_service_date
          and existing.location_group_id = v_row.location_group_id
          and existing.assigned_employee_id = v_row.assigned_employee_id
          and existing.coverage_start = v_row.coverage_start
          and existing.coverage_end = v_overlap_start
          and coalesce(existing.source_type, '') like '%lunch_split_before%'
      ) into v_exists_before;
    end if;

    -- Check if a "return to owner" (after) segment already exists.
    v_exists_after := false;
    if v_overlap_end < v_row.coverage_end then
      select exists (
        select 1
        from public.daily_schedule_assignments existing
        where existing.service_date = p_service_date
          and existing.location_group_id = v_row.location_group_id
          and existing.assigned_employee_id = v_row.assigned_employee_id
          and existing.coverage_start = v_overlap_end
          and existing.coverage_end = v_row.coverage_end
          and coalesce(existing.source_type, '') like '%lunch_split_after%'
      ) into v_exists_after;
    end if;

    -- If the before and after segments already exist AND the lunch row exists,
    -- this row was already processed in a prior run — skip the delete/insert cycle.
    if v_exists_before and v_exists_after and v_existing_lunch then
      continue;
    end if;

    -- Only delete the original row if it still exists (it may have already been
    -- split in a prior run and this is a re-process of the before/after segments).
    -- We check whether the current row's coverage still spans the lunch window.
    -- If v_exists_before or v_exists_after is true but not both, the original was
    -- already deleted in a prior run — skip delete.
    if not v_exists_before and not v_exists_after then
      delete from public.daily_schedule_assignments where id = v_row.id;
      v_split_rows := v_split_rows + 1;
    end if;

    if v_row.coverage_start < v_overlap_start and not v_exists_before then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date, v_row.location_group_id, v_next_segment, v_row.assigned_employee_id, v_row.owner_type,
        v_row.coverage_start, v_overlap_start, v_row.status, v_row.load_points,
        trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Morning ownership until lunch')),
        trim(concat_ws(':', nullif(v_row.source_type, ''), 'lunch_split_before')),
        v_row.coverage_purpose
      );
      v_before_after_rows := v_before_after_rows + 1;
    end if;

    if not v_existing_lunch then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date,
        v_row.location_group_id,
        v_next_segment,
        v_candidate_employee_id,
        case when v_candidate_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
        v_overlap_start,
        v_overlap_end,
        case when v_candidate_employee_id is null then 'OPEN' else 'ASSIGNED' end,
        v_row.load_points,
        case
          when v_candidate_employee_id is null then
            trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Lunch coverage needed for ' || v_row.owner_name || ' ' || to_char(v_overlap_start, 'HH12:MI AM') || ' - ' || to_char(v_overlap_end, 'HH12:MI AM') || '. No available coverage candidate found.'))
          else
            trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Lunch coverage for ' || v_row.owner_name || ' ' || to_char(v_overlap_start, 'HH12:MI AM') || ' - ' || to_char(v_overlap_end, 'HH12:MI AM') || '. Cover: ' || v_candidate_employee_name || '. ' || coalesce(v_candidate_explanation, '')))
        end,
        case when v_candidate_employee_id is null then 'lunch_coverage_open' else 'lunch_coverage' end,
        'lunch_coverage'
      );
      v_lunch_rows := v_lunch_rows + 1;
      if v_candidate_employee_id is null then
        v_open_rows := v_open_rows + 1;
      end if;
    end if;

    if v_overlap_end < v_row.coverage_end and not v_exists_after then
      select coalesce(max(segment_number), 0) + 1000 into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = v_row.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date, v_row.location_group_id, v_next_segment, v_row.assigned_employee_id, v_row.owner_type,
        v_overlap_end, v_row.coverage_end, v_row.status, v_row.load_points,
        trim(concat_ws(' | ', nullif(v_row.notes, ''), 'Return to owner after lunch')),
        trim(concat_ws(':', nullif(v_row.source_type, ''), 'lunch_split_after')),
        v_row.coverage_purpose
      );
      v_before_after_rows := v_before_after_rows + 1;
    end if;
  end loop;

  update public.daily_schedule_assignments
     set segment_number = segment_number + 100000,
         updated_at = now()
   where service_date = p_service_date;

  with renumbered as (
    select id,
           row_number() over (
             partition by service_date, location_group_id
             order by coverage_start, coverage_end,
               case coverage_purpose when 'lunch_coverage' then 1 else 0 end,
               created_at,
               id
           )::integer as new_segment_number
    from public.daily_schedule_assignments
    where service_date = p_service_date
  )
  update public.daily_schedule_assignments dsa
     set segment_number = r.new_segment_number,
         updated_at = now()
    from renumbered r
   where dsa.id = r.id;

  return jsonb_build_object(
    'service_date', p_service_date,
    'applied', v_split_rows > 0,
    'split_original_segments', v_split_rows,
    'lunch_coverage_rows', v_lunch_rows,
    'open_lunch_coverage_rows', v_open_rows,
    'owner_before_after_rows', v_before_after_rows
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_audit_schedule_day_detail(p_service_date date DEFAULT sch_service_date(now()))
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_date date := coalesce(p_service_date, public.sch_service_date(now()));
  v_payload jsonb;
begin
  select jsonb_build_object(
    'ok', true,
    'service_date', v_date,
    'weekday', trim(to_char(v_date, 'Day')),
    'generated_at', now(),
    'counts', jsonb_build_object(
      'assignments_total', (select count(*)::int from public.daily_schedule_assignments where service_date = v_date),
      'assignments_open', (select count(*)::int from public.daily_schedule_assignments where service_date = v_date and status = 'OPEN'),
      'active_roster_rows', (select count(*)::int from public.daily_work_roster where service_date = v_date and active = true),
      'active_absences', (select count(*)::int from public.daily_absence_overrides where absence_date = v_date and active = true)
    ),
    'assigned_while_absent', coalesce((
      select jsonb_agg(row_to_json(x) order by x.employee_name, x.group_name)
      from (
        select
          e.display_name as employee_name,
          dao.absence_type,
          dao.notes as absence_notes,
          dsa.service_date,
          lg.group_name,
          dsa.segment_number,
          to_char(dsa.coverage_start, 'HH24:MI:SS') as coverage_start,
          to_char(dsa.coverage_end, 'HH24:MI:SS') as coverage_end,
          dsa.status
        from public.daily_schedule_assignments dsa
        join public.daily_absence_overrides dao on dao.employee_id = dsa.assigned_employee_id and dao.absence_date = dsa.service_date and dao.active = true
        join public.employees e on e.id = dsa.assigned_employee_id
        join public.location_groups lg on lg.id = dsa.location_group_id
        where dsa.service_date = v_date
          and dsa.assigned_employee_id is not null
      ) x
    ), '[]'::jsonb),
    'pto_without_absence_override', coalesce((
      select jsonb_agg(row_to_json(x) order by x.employee_name, x.source_table)
      from (
        with pto_source as (
          select p.employee_id, 'employee_planned_time_off'::text as source_table, p.start_date, p.end_date, p.pto_type as absence_type
          from public.employee_planned_time_off p
          where p.active = true and p.start_date <= v_date and p.end_date >= v_date
          union all
          select ep.employee_id, 'employee_pto'::text as source_table, ep.start_date, ep.end_date, ep.absence_type
          from public.employee_pto ep
          where ep.active = true and ep.start_date <= v_date and ep.end_date >= v_date
        )
        select e.display_name as employee_name, src.source_table, src.start_date, src.end_date, src.absence_type
        from pto_source src
        join public.employees e on e.id = src.employee_id
        where not exists (
          select 1
          from public.daily_absence_overrides dao
          where dao.employee_id = src.employee_id
            and dao.absence_date = v_date
            and dao.active = true
        )
      ) x
    ), '[]'::jsonb),
    'working_without_assignments', coalesce((
      select jsonb_agg(row_to_json(x) order by x.employee_name)
      from (
        select
          e.display_name as employee_name,
          dwr.service_date,
          to_char(dwr.shift_start, 'HH24:MI:SS') as shift_start,
          to_char(dwr.shift_end, 'HH24:MI:SS') as shift_end,
          dwr.source_type,
          dwr.notes
        from public.daily_work_roster dwr
        join public.employees e on e.id = dwr.employee_id
        where dwr.service_date = v_date
          and dwr.active = true
          and not exists (
            select 1
            from public.daily_schedule_assignments dsa
            where dsa.service_date = v_date
              and dsa.assigned_employee_id = dwr.employee_id
          )
      ) x
    ), '[]'::jsonb),
    'assigned_outside_active_roster', coalesce((
      select jsonb_agg(row_to_json(x) order by x.employee_name, x.group_name)
      from (
        select
          e.display_name as employee_name,
          lg.group_name,
          dsa.segment_number,
          to_char(dsa.coverage_start, 'HH24:MI:SS') as coverage_start,
          to_char(dsa.coverage_end, 'HH24:MI:SS') as coverage_end,
          dwr.active as roster_active,
          to_char(dwr.shift_start, 'HH24:MI:SS') as roster_shift_start,
          to_char(dwr.shift_end, 'HH24:MI:SS') as roster_shift_end
        from public.daily_schedule_assignments dsa
        join public.employees e on e.id = dsa.assigned_employee_id
        join public.location_groups lg on lg.id = dsa.location_group_id
        left join public.daily_work_roster dwr on dwr.service_date = dsa.service_date and dwr.employee_id = dsa.assigned_employee_id
        where dsa.service_date = v_date
          and dsa.assigned_employee_id is not null
          and (
            dwr.id is null
            or dwr.active = false
            or dsa.coverage_start < dwr.shift_start
            or dsa.coverage_end > dwr.shift_end
          )
      ) x
    ), '[]'::jsonb),
    'open_segments', coalesce((
      select jsonb_agg(row_to_json(x) order by x.group_name, x.segment_number)
      from (
        select group_name, group_code, segment_number, coverage_start, coverage_end, notes, reason_open
        from public.v_memphis_open_segments
        where service_date = v_date
      ) x
    ), '[]'::jsonb)
  ) into v_payload;

  return v_payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_clear_scan_alerts_after_scan_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.location_code is not null then
    perform public.sch_clear_scan_alerts_for_location(new.location_code, 'new_scan_event');
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_coverall_printable_schedule(p_service_date date DEFAULT sch_service_date(now()))
 RETURNS TABLE(service_date date, coverall_employee_code text, coverall_employee_name text, assignment_start text, assignment_end text, location_group_code text, location_group_name text, work_phase text, english_instruction text, spanish_instruction text, source_type text, notes text, print_order integer)
 LANGUAGE sql
 STABLE
AS $function$
  with base as (
    select
      dsa.service_date,
      e.employee_code as coverall_employee_code,
      e.display_name as coverall_employee_name,
      dsa.coverage_start,
      dsa.coverage_end,
      lg.group_code as location_group_code,
      lg.group_name as location_group_name,
      coalesce(dsa.coverage_purpose, '') as coverage_purpose,
      coalesce(dsa.source_type, '') as source_type,
      coalesce(dsa.notes, '') as notes,
      case coalesce(dsa.coverage_purpose, '')
        when 'deep_clean' then 'Morning primary owner'
        when 'restroom_upkeep' then '9:45 restroom rebalance'
        when 'area_owner' then '9:45 area ownership'
        when 'lunch_coverage' then 'Lunch coverage'
        when 'late_coverage' then 'Late coverage'
        else 'Assigned work'
      end as work_phase,
      case coalesce(dsa.coverage_purpose, '')
        when 'deep_clean' then 10
        when 'restroom_upkeep' then 20
        when 'area_owner' then 30
        when 'lunch_coverage' then 40
        when 'late_coverage' then 50
        else 90
      end as phase_order
    from public.daily_schedule_assignments dsa
    join public.employees e on e.id = dsa.assigned_employee_id
    join public.location_groups lg on lg.id = dsa.location_group_id
    where dsa.service_date = coalesce(p_service_date, public.sch_service_date(now()))
      and dsa.status = 'ASSIGNED'
      and e.active = true
      and upper(coalesce(e.employee_code, '')) like 'COVER%'
      and coalesce(dsa.coverage_purpose, '') not in ('reminder', 'response_only')
  )
  select
    b.service_date,
    b.coverall_employee_code,
    b.coverall_employee_name,
    to_char(b.coverage_start, 'HH24:MI') as assignment_start,
    to_char(b.coverage_end, 'HH24:MI') as assignment_end,
    b.location_group_code,
    b.location_group_name,
    b.work_phase,
    concat('From ', to_char(b.coverage_start, 'HH24:MI'), ' to ', to_char(b.coverage_end, 'HH24:MI'), ': clean/check ', b.location_group_name, '. Tell the manager if you find a problem or need supplies.') as english_instruction,
    concat('De ', to_char(b.coverage_start, 'HH24:MI'), ' a ', to_char(b.coverage_end, 'HH24:MI'), ': limpie/revise ', b.location_group_name, '. Avise al supervisor si encuentra un problema o necesita suministros.') as spanish_instruction,
    b.source_type,
    b.notes,
    row_number() over (partition by b.coverall_employee_code order by b.coverage_start, b.phase_order, b.location_group_name)::integer as print_order
  from base b
  order by b.coverall_employee_code, b.coverage_start, b.phase_order, b.location_group_name;
$function$;

CREATE OR REPLACE FUNCTION public.sch_employee_my_schedule_phase_v1(p_service_date date, p_employee_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_local_time time := timezone('America/Chicago', p_as_of)::time;
  v_cutover time := time '09:45';
  v_close_time time := coalesce(public.sch_get_schedule_close_time(p_service_date), time '18:00');
  v_employee record;
  v_shift record;
  v_has_945_change boolean := false;
  v_items jsonb := '[]'::jsonb;
  v_future_notice text := null;
  v_active_employee_ids uuid[] := '{}'::uuid[];
  v_active_count integer := 0;
  v_employee_active_now boolean := false;
  v_loads jsonb := '{}'::jsonb;
  v_load_key text;
  v_candidate record;
  v_single_remaining_start time := null;
  rec record;
begin
  select id, display_name, employee_code, role
    into v_employee
  from public.employees
  where id = p_employee_id
    and active = true;

  if v_employee.id is null then
    return jsonb_build_object('ok', false, 'error', 'Employee not found or inactive');
  end if;

  select shift_start, shift_end
    into v_shift
  from public.daily_work_roster
  where service_date = p_service_date
    and employee_id = p_employee_id
    and active = true
  order by shift_start
  limit 1;

  select exists (
    select 1
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id = p_employee_id
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.source_type, '') like '%restroom_rebalance_0945%'
  ) into v_has_945_change;

  if v_has_945_change and v_local_time < v_cutover then
    v_future_notice := 'Your restroom ownership changes at 9:45 AM. Check My Schedule then for the updated restroom list.';
  end if;

  select
    coalesce(array_agg(r.employee_id order by r.shift_end, r.shift_start, e.display_name), '{}'::uuid[]),
    count(*)::int
    into v_active_employee_ids, v_active_count
  from public.daily_work_roster r
  join public.employees e on e.id = r.employee_id
  where r.service_date = p_service_date
    and r.active = true
    and r.shift_start <= v_local_time
    and r.shift_end > v_local_time
    and r.shift_start < v_close_time;

  v_employee_active_now := p_employee_id = any(v_active_employee_ids);

  for rec in
    select x.employee_id::text as employee_id_text
    from unnest(coalesce(v_active_employee_ids, '{}'::uuid[])) as x(employee_id)
  loop
    v_loads := jsonb_set(v_loads, array[rec.employee_id_text], to_jsonb(0), true);
  end loop;

  with source_rows as (
    select
      dsa.coverage_start,
      dsa.coverage_end,
      coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose,
      lg.group_code,
      lg.group_name,
      public.sch_is_public_restroom_group(lg.id) as is_public_restroom,
      (coalesce(dsa.coverage_purpose, '') = 'reminder') as is_schedule_only_reminder
    from public.daily_schedule_assignments dsa
    join public.location_groups lg on lg.id = dsa.location_group_id
    where dsa.service_date = p_service_date
      and dsa.assigned_employee_id = p_employee_id
      and dsa.status = 'ASSIGNED'
      and coalesce(dsa.coverage_purpose, 'area_owner') in (
        'deep_clean',
        'reminder',
        'area_owner',
        'restroom_upkeep',
        'lunch_coverage',
        'late_coverage',
        'response_only'
      )
      and (
        (
          v_local_time < v_cutover
          and coalesce(dsa.coverage_purpose, '') in ('deep_clean', 'reminder', 'area_owner', 'restroom_upkeep', 'response_only')
          and dsa.coverage_start < v_cutover
          and dsa.coverage_end > v_local_time
        )
        or
        (
          v_local_time >= v_cutover
          and coalesce(dsa.coverage_purpose, '') in ('deep_clean', 'reminder', 'area_owner', 'restroom_upkeep', 'response_only')
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
        )
        or
        (
          coalesce(dsa.coverage_purpose, '') = 'lunch_coverage'
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
        )
        or
        (
          coalesce(dsa.coverage_purpose, '') = 'late_coverage'
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
        )
      )
  ), dedup as (
    select distinct on (group_code, coverage_purpose)
      group_code,
      group_name,
      coverage_purpose,
      is_public_restroom,
      is_schedule_only_reminder,
      min(coverage_start) over (partition by group_code, coverage_purpose) as first_start,
      max(coverage_end) over (partition by group_code, coverage_purpose) as last_end
    from source_rows
    order by group_code, coverage_purpose, coverage_start
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', group_name,
      'group_code', group_code,
      'coverage_purpose', coverage_purpose,
      'coverage_start', to_char(first_start, 'HH12:MI AM'),
      'coverage_end', case when last_end = time '23:59:59' then 'Close' else to_char(last_end, 'HH12:MI AM') end,
      'is_public_restroom', is_public_restroom,
      'is_schedule_only_reminder', is_schedule_only_reminder
    )
    order by
      case coverage_purpose
        when 'lunch_coverage' then 2
        when 'late_coverage' then 3
        else 1
      end,
      case when is_public_restroom then 0 else 1 end,
      group_name
  ), '[]'::jsonb)
  into v_items
  from dedup;

  if v_active_count > 0 then
    for rec in
      select dsa.assigned_employee_id::text as employee_id_text, count(*)::int as item_count
      from public.daily_schedule_assignments dsa
      where dsa.service_date = p_service_date
        and dsa.status = 'ASSIGNED'
        and dsa.assigned_employee_id = any(v_active_employee_ids)
        and coalesce(dsa.coverage_purpose, 'area_owner') in (
          'deep_clean',
          'reminder',
          'area_owner',
          'restroom_upkeep',
          'lunch_coverage',
          'late_coverage',
          'response_only'
        )
        and dsa.coverage_start <= v_local_time
        and dsa.coverage_end > v_local_time
      group by dsa.assigned_employee_id
    loop
      v_load_key := rec.employee_id_text;
      v_loads := jsonb_set(
        v_loads,
        array[v_load_key],
        to_jsonb(coalesce((v_loads ->> v_load_key)::int, 0) + rec.item_count),
        true
      );
    end loop;
  end if;

  if v_local_time >= v_cutover and v_local_time < v_close_time and v_active_count > 0 and v_employee_active_now then
    for rec in
      with active_roster as (
        select r.employee_id
        from public.daily_work_roster r
        where r.service_date = p_service_date
          and r.active = true
          and r.shift_start <= v_local_time
          and r.shift_end > v_local_time
      ), current_direct_coverage as (
        select distinct dsa.location_group_id
        from public.daily_schedule_assignments dsa
        join active_roster ar on ar.employee_id = dsa.assigned_employee_id
        where dsa.service_date = p_service_date
          and dsa.status = 'ASSIGNED'
          and coalesce(dsa.coverage_purpose, 'area_owner') in (
            'deep_clean',
            'area_owner',
            'restroom_upkeep',
            'response_only',
            'late_coverage'
          )
          and dsa.coverage_start <= v_local_time
          and dsa.coverage_end > v_local_time
      ), latest_owner_rows as (
        select distinct on (dsa.location_group_id)
          dsa.location_group_id,
          lg.group_code,
          lg.group_name,
          coalesce(dsa.coverage_purpose, 'area_owner') as coverage_purpose,
          dsa.assigned_employee_id as owner_employee_id,
          owner_roster.shift_end as owner_shift_end,
          public.sch_is_public_restroom_group(lg.id) as is_public_restroom
        from public.daily_schedule_assignments dsa
        join public.location_groups lg on lg.id = dsa.location_group_id
        left join public.daily_work_roster owner_roster
          on owner_roster.service_date = p_service_date
         and owner_roster.employee_id = dsa.assigned_employee_id
         and owner_roster.active = true
        where dsa.service_date = p_service_date
          and dsa.status = 'ASSIGNED'
          and dsa.assigned_employee_id is not null
          and coalesce(dsa.coverage_purpose, 'area_owner') in (
            'deep_clean',
            'area_owner',
            'restroom_upkeep',
            'response_only'
          )
          and dsa.coverage_end > v_cutover
        order by dsa.location_group_id, dsa.coverage_end desc, dsa.coverage_start desc, dsa.updated_at desc nulls last, dsa.id desc
      )
      select lo.*
      from latest_owner_rows lo
      left join current_direct_coverage dc on dc.location_group_id = lo.location_group_id
      where dc.location_group_id is null
        and not (lo.owner_employee_id = any(v_active_employee_ids))
      order by case when lo.is_public_restroom then 0 else 1 end, lo.group_name, lo.group_code
    loop
      v_candidate := null;

      if v_active_count = 1 then
        select
          r.employee_id,
          e.display_name as employee_name,
          e.employee_code,
          least(r.shift_end, v_close_time) as effective_end
          into v_candidate
        from public.daily_work_roster r
        join public.employees e on e.id = r.employee_id
        where r.service_date = p_service_date
          and r.active = true
          and r.employee_id = v_active_employee_ids[1]
        limit 1;
      else
        select
          c.employee_id,
          c.employee_name,
          c.employee_code,
          least(r.shift_end, v_close_time) as effective_end,
          coalesce((v_loads ->> c.employee_id::text)::int, 0) as effective_load,
          c.best_proximity_score,
          c.walking_minutes,
          c.recommendation_score,
          (c.recommendation_score - (coalesce((v_loads ->> c.employee_id::text)::numeric, 0) * 20)) as adjusted_score
          into v_candidate
        from public.sch_get_coverage_candidates(p_service_date, rec.location_group_id, v_local_time, v_close_time) c
        join public.daily_work_roster r
          on r.service_date = p_service_date
         and r.employee_id = c.employee_id
         and r.active = true
        where c.employee_id = any(v_active_employee_ids)
          and r.shift_start <= v_local_time
          and r.shift_end > v_local_time
        order by adjusted_score desc, effective_load asc, c.best_proximity_score desc, c.walking_minutes asc nulls last, c.employee_name asc
        limit 1;

        if v_candidate.employee_id is null then
          select
            r.employee_id,
            e.display_name as employee_name,
            e.employee_code,
            least(r.shift_end, v_close_time) as effective_end,
            coalesce((v_loads ->> r.employee_id::text)::int, 0) as effective_load
            into v_candidate
          from public.daily_work_roster r
          join public.employees e on e.id = r.employee_id
          where r.service_date = p_service_date
            and r.active = true
            and r.employee_id = any(v_active_employee_ids)
            and r.shift_start <= v_local_time
            and r.shift_end > v_local_time
          order by effective_load asc, least(r.shift_end, v_close_time) desc, e.display_name asc
          limit 1;
        end if;
      end if;

      if v_candidate.employee_id is null or v_candidate.effective_end <= v_local_time then
        continue;
      end if;

      v_load_key := v_candidate.employee_id::text;
      v_loads := jsonb_set(
        v_loads,
        array[v_load_key],
        to_jsonb(coalesce((v_loads ->> v_load_key)::int, 0) + 1),
        true
      );

      if v_candidate.employee_id = p_employee_id then
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'name', rec.group_name,
          'group_code', rec.group_code,
          'coverage_purpose', rec.coverage_purpose,
          'coverage_start', to_char(greatest(v_cutover, coalesce(rec.owner_shift_end, v_local_time)), 'HH12:MI AM'),
          'coverage_end', case when v_candidate.effective_end = time '23:59:59' then 'Close' else to_char(v_candidate.effective_end, 'HH12:MI AM') end,
          'is_public_restroom', rec.is_public_restroom,
          'is_schedule_only_reminder', false
        ));
      end if;
    end loop;
  end if;

  if v_local_time >= v_cutover and v_active_count = 1 and v_employee_active_now and jsonb_array_length(coalesce(v_items, '[]'::jsonb)) > 0 then
    select greatest(
      v_cutover,
      coalesce(max(r.shift_end), v_local_time)
    )
      into v_single_remaining_start
    from public.daily_work_roster r
    where r.service_date = p_service_date
      and r.active = true
      and r.employee_id <> p_employee_id
      and r.shift_start < v_close_time
      and r.shift_end <= v_local_time;

    v_items := jsonb_build_array(jsonb_build_object(
      'name', 'All Locations',
      'group_code', 'ALL_LOCATIONS',
      'coverage_purpose', case when coalesce(v_employee.employee_code, '') = 'EMP002' then 'late_coverage' else 'area_owner' end,
      'coverage_start', to_char(coalesce(v_single_remaining_start, greatest(v_cutover, v_local_time)), 'HH12:MI AM'),
      'coverage_end', case
        when least(coalesce(v_shift.shift_end, v_close_time), v_close_time) = time '23:59:59' then 'Close'
        else to_char(least(coalesce(v_shift.shift_end, v_close_time), v_close_time), 'HH12:MI AM')
      end,
      'is_public_restroom', false,
      'is_schedule_only_reminder', false
    ));
  end if;

  select coalesce(jsonb_agg(item order by
    case coalesce(item->>'coverage_purpose', 'area_owner')
      when 'lunch_coverage' then 2
      when 'late_coverage' then 3
      else 1
    end,
    case when coalesce((item->>'is_public_restroom')::boolean, false) then 0 else 1 end,
    coalesce(item->>'name', '')
  ), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) item;

  return jsonb_build_object(
    'ok', true,
    'service_date', p_service_date,
    'as_of_time', to_char(v_local_time, 'HH12:MI AM'),
    'phase', case when v_local_time < v_cutover then 'morning' else 'current' end,
    'employee', jsonb_build_object(
      'employee_id', v_employee.id,
      'employee_code', v_employee.employee_code,
      'display_name', v_employee.display_name,
      'role', v_employee.role
    ),
    'shift', case when v_shift.shift_start is null then null else jsonb_build_object(
      'start', to_char(v_shift.shift_start, 'HH12:MI AM'),
      'end', case when v_shift.shift_end = time '23:59:59' then 'Close' else to_char(v_shift.shift_end, 'HH12:MI AM') end
    ) end,
    'has_945_change', v_has_945_change,
    'notice', v_future_notice,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_employee_my_schedule_summary(p_service_date date, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_day integer := extract(dow from p_service_date)::integer;
  v_employee record;
  v_shift record;
  v_main jsonb := '[]'::jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_blocks jsonb := '[]'::jsonb;
begin
  select id, display_name, employee_code, role
    into v_employee
  from public.employees
  where id = p_employee_id
    and active = true;

  if v_employee.id is null then
    return jsonb_build_object('ok', false, 'error', 'Employee not found or inactive');
  end if;

  select shift_start, shift_end
    into v_shift
  from public.employee_shift_templates
  where employee_id = p_employee_id
    and day_of_week = v_day
    and active = true
  limit 1;

  with rows as (
    select
      ct.coverage_start,
      ct.coverage_end,
      ct.coverage_purpose,
      lg.id as location_group_id,
      lg.group_code,
      lg.group_name,
      public.sch_group_load_points(lg.id) as load_points,
      public.sch_is_public_restroom_group(lg.id) as is_public_restroom,
      exists (
        select 1
        from public.location_group_workload_settings lgws
        where lgws.location_group_id = lg.id
          and lgws.active = true
          and lgws.manual_load_points is not null
      ) as is_schedule_only_reminder
    from public.coverage_templates ct
    join public.location_groups lg on lg.id = ct.location_group_id
    where ct.active = true
      and ct.day_of_week = v_day
      and ct.assigned_employee_id = p_employee_id
      and ct.coverage_purpose in ('deep_clean','reminder','area_owner','restroom_upkeep')
  ), main_groups as (
    select
      location_group_id,
      group_code,
      group_name,
      bool_or(is_public_restroom) as is_public_restroom,
      bool_or(is_schedule_only_reminder) as is_schedule_only_reminder,
      min(coverage_start) as first_start,
      max(coverage_end) as last_end,
      sum(load_points) as load_points
    from rows
    where coverage_purpose in ('deep_clean','reminder')
    group by location_group_id, group_code, group_name
  ), main_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'name', group_name,
        'group_code', group_code,
        'is_public_restroom', is_public_restroom,
        'is_schedule_only_reminder', is_schedule_only_reminder,
        'time', to_char(first_start, 'HH12:MI AM') || ' - ' || to_char(last_end, 'HH12:MI AM')
      )
      order by
        case when is_public_restroom then 0 else 1 end,
        case when is_schedule_only_reminder then 2 else 1 end,
        group_name
    ), '[]'::jsonb) as data
    from main_groups
  ), extra_rows as (
    select r.*
    from rows r
    where r.coverage_purpose in ('area_owner','restroom_upkeep')
      and not exists (
        select 1 from main_groups m where m.location_group_id = r.location_group_id
      )
  ), extra_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'name', group_name,
        'group_code', group_code,
        'purpose', coverage_purpose,
        'is_public_restroom', is_public_restroom,
        'time', to_char(coverage_start, 'HH12:MI AM') || ' - ' || to_char(coverage_end, 'HH12:MI AM')
      )
      order by coverage_start, case when is_public_restroom then 0 else 1 end, group_name
    ), '[]'::jsonb) as data
    from extra_rows
  ), block_json as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'name', group_name,
        'purpose', coverage_purpose,
        'is_public_restroom', is_public_restroom,
        'time', to_char(coverage_start, 'HH12:MI AM') || ' - ' || to_char(coverage_end, 'HH12:MI AM')
      )
      order by coverage_start, coverage_end, case when is_public_restroom then 0 else 1 end, group_name
    ), '[]'::jsonb) as data
    from rows
  )
  select main_json.data, extra_json.data, block_json.data
    into v_main, v_extra, v_blocks
  from main_json, extra_json, block_json;

  return jsonb_build_object(
    'ok', true,
    'service_date', p_service_date,
    'employee', jsonb_build_object(
      'employee_id', v_employee.id,
      'employee_code', v_employee.employee_code,
      'display_name', v_employee.display_name,
      'role', v_employee.role
    ),
    'shift', case when v_shift.shift_start is null then null else jsonb_build_object(
      'start', to_char(v_shift.shift_start, 'HH12:MI AM'),
      'end', case when v_shift.shift_end = time '23:59:59' then 'Close' else to_char(v_shift.shift_end, 'HH12:MI AM') end
    ) end,
    'has_daily_changes', false,
    'change_summary', 'No changes today. This is your normal route.',
    'main_route', coalesce(v_main, '[]'::jsonb),
    'extra_coverage', coalesce(v_extra, '[]'::jsonb),
    'raw_blocks', coalesce(v_blocks, '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_employee_route_fit_score(p_employee_id uuid, p_day_of_week integer, p_location_group_id uuid, p_purpose text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  with existing as (
    select array_agg(ct.location_group_id) as group_ids
    from public.coverage_templates ct
    where ct.active = true
      and ct.assigned_employee_id = p_employee_id
      and ct.day_of_week = p_day_of_week
      and (p_purpose is null or ct.coverage_purpose = p_purpose)
  ), before_after as (
    select
      public.sch_group_route_spread_penalty(coalesce(group_ids, array[]::uuid[])) as before_penalty,
      public.sch_group_route_spread_penalty(coalesce(group_ids, array[]::uuid[]) || p_location_group_id) as after_penalty
    from existing
  )
  select round(greatest(after_penalty - before_penalty, 0), 2)::numeric
  from before_after;
$function$;

CREATE OR REPLACE FUNCTION public.sch_extract_lunch_end(p_notes text)
 RETURNS time without time zone
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_match text[];
begin
  v_match := regexp_match(coalesce(p_notes, ''), 'Lunch\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)|[0-9]{3,4}\s*(?:AM|PM|am|pm))\s*[–—-]\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)|[0-9]{3,4}\s*(?:AM|PM|am|pm))');
  if v_match is null then
    return null;
  end if;
  return public.sch_parse_human_time(v_match[2]);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_extract_lunch_start(p_notes text)
 RETURNS time without time zone
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_match text[];
begin
  v_match := regexp_match(coalesce(p_notes, ''), 'Lunch\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)|[0-9]{3,4}\s*(?:AM|PM|am|pm))\s*[–—-]\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)|[0-9]{3,4}\s*(?:AM|PM|am|pm))');
  if v_match is null then
    return null;
  end if;
  return public.sch_parse_human_time(v_match[1]);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_fill_open_lunch_coverage(p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_updated integer := 0;
begin
  with open_rows as (
    select d.id, d.service_date, d.location_group_id, d.coverage_start, d.coverage_end
    from public.daily_schedule_assignments d
    where d.service_date = p_service_date
      and d.coverage_purpose = 'lunch_coverage'
      and (d.assigned_employee_id is null or d.status <> 'ASSIGNED')
  ), chosen as (
    select o.id,
           coalesce(best.employee_id, fallback.employee_id) as employee_id
    from open_rows o
    left join lateral (
      select c.employee_id
      from public.sch_get_coverage_candidates(o.service_date, o.location_group_id, o.coverage_start, o.coverage_end) c
      where not exists (
        select 1 from public.sch_lunch_window_for_employee(o.service_date, c.employee_id) lw
        where lw.lunch_start < o.coverage_end and lw.lunch_end > o.coverage_start
      )
      order by c.recommendation_score desc, c.employee_name asc
      limit 1
    ) best on true
    left join lateral (
      select r.employee_id
      from public.daily_work_roster r
      join public.employees e on e.id = r.employee_id
      where r.service_date = o.service_date
        and r.active = true
        and r.shift_start <= o.coverage_start
        and r.shift_end >= o.coverage_end
        and not exists (
          select 1 from public.sch_lunch_window_for_employee(o.service_date, r.employee_id) lw
          where lw.lunch_start < o.coverage_end and lw.lunch_end > o.coverage_start
        )
      order by e.display_name asc
      limit 1
    ) fallback on best.employee_id is null
  ), updated as (
    update public.daily_schedule_assignments d
       set assigned_employee_id = chosen.employee_id,
           owner_type = 'EMPLOYEE',
           status = 'ASSIGNED',
           source_type = 'midday_static_fill',
           notes = trim(concat_ws(' | ', nullif(d.notes, ''), 'Filled by available active employee for lunch interval.')),
           updated_at = now()
      from chosen
     where d.id = chosen.id
       and chosen.employee_id is not null
     returning d.id
  )
  select count(*) into v_updated from updated;

  return jsonb_build_object('service_date', p_service_date, 'filled_rows', v_updated);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_get_daily_schedule(p_service_date date)
 RETURNS TABLE(location_group_id uuid, group_code text, group_name text, included_locations text[], segment_id uuid, segment_number integer, owner_type text, assigned_employee_id uuid, assigned_employee_name text, coverage_start text, coverage_end text, status text, load_points numeric, notes text)
 LANGUAGE sql
 STABLE
AS $function$
  with settings as (
    select public.sch_get_schedule_close_time(p_service_date) as close_time
  ),
  has_generated as (
    select exists(
      select 1
      from public.daily_schedule_assignments dsa
      where dsa.service_date = p_service_date
    ) as yes
  ),
  generated_rows as (
    select
      dsa.location_group_id,
      dsa.id as segment_id,
      dsa.segment_number,
      dsa.owner_type,
      dsa.assigned_employee_id,
      to_char(dsa.coverage_start, 'HH12:MI AM') as coverage_start,
      to_char(dsa.coverage_end, 'HH12:MI AM') as coverage_end,
      dsa.status,
      dsa.load_points,
      dsa.notes
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date
  ),
  legacy_rows as (
    select
      dga.location_group_id,
      dga.id as segment_id,
      row_number() over (partition by dga.location_group_id order by dga.coverage_start, dga.coverage_end, dga.created_at) as segment_number,
      case when dga.assigned_employee_id is null or dga.assignment_type = 'OPEN' then 'OPEN' else 'EMPLOYEE' end as owner_type,
      dga.assigned_employee_id,
      to_char(dga.coverage_start, 'HH12:MI AM') as coverage_start,
      to_char(least(dga.coverage_end, s.close_time), 'HH12:MI AM') as coverage_end,
      case when dga.assigned_employee_id is null or dga.assignment_type = 'OPEN' then 'OPEN' else 'ASSIGNED' end as status,
      public.sch_group_load_points(dga.location_group_id) as load_points,
      coalesce(dga.notes, dga.reason_code) as notes
    from public.daily_group_assignments dga
    cross join settings s
    where dga.assignment_date = p_service_date
      and coalesce(dga.active, true) = true
      and dga.coverage_start < s.close_time
      and not exists (select 1 from has_generated where yes = true)
  ),
  template_rows as (
    select
      ct.location_group_id,
      ct.id as segment_id,
      ct.segment_number,
      case
        when ct.assigned_employee_id is null then 'OPEN'
        when exists (
          select 1
          from public.employee_shift_templates est
          cross join settings s2
          where est.employee_id = ct.assigned_employee_id
            and est.active = true
            and est.day_of_week = extract(dow from p_service_date)::integer
            and est.shift_start <= ct.coverage_start
            and est.shift_end >= least(ct.coverage_end, s2.close_time)
        ) then 'EMPLOYEE'
        else 'OPEN'
      end as owner_type,
      case
        when ct.assigned_employee_id is null then null
        when exists (
          select 1
          from public.employee_shift_templates est
          cross join settings s2
          where est.employee_id = ct.assigned_employee_id
            and est.active = true
            and est.day_of_week = extract(dow from p_service_date)::integer
            and est.shift_start <= ct.coverage_start
            and est.shift_end >= least(ct.coverage_end, s2.close_time)
        ) then ct.assigned_employee_id
        else null
      end as assigned_employee_id,
      to_char(ct.coverage_start, 'HH12:MI AM') as coverage_start,
      to_char(least(ct.coverage_end, s.close_time), 'HH12:MI AM') as coverage_end,
      case
        when ct.assigned_employee_id is null then 'OPEN'
        when exists (
          select 1
          from public.employee_shift_templates est
          cross join settings s2
          where est.employee_id = ct.assigned_employee_id
            and est.active = true
            and est.day_of_week = extract(dow from p_service_date)::integer
            and est.shift_start <= ct.coverage_start
            and est.shift_end >= least(ct.coverage_end, s2.close_time)
        ) then 'ASSIGNED'
        else 'OPEN'
      end as status,
      public.sch_group_load_points(ct.location_group_id) as load_points,
      ct.notes
    from public.coverage_templates ct
    cross join settings s
    where ct.active = true
      and ct.day_of_week = extract(dow from p_service_date)::integer
      and ct.coverage_start < s.close_time
      and not exists (select 1 from has_generated where yes = true)
      and not exists (
        select 1 from public.daily_group_assignments dga
        where dga.assignment_date = p_service_date
          and coalesce(dga.active, true) = true
      )
  ),
  schedule_source as (
    select * from generated_rows
    union all
    select * from legacy_rows
    union all
    select * from template_rows
  )
  select
    lg.id as location_group_id,
    lg.group_code,
    lg.group_name,
    coalesce(array_agg(distinct l.location_name) filter (where l.id is not null), array[]::text[]) as included_locations,
    ss.segment_id,
    ss.segment_number,
    ss.owner_type,
    ss.assigned_employee_id,
    e.display_name as assigned_employee_name,
    ss.coverage_start,
    ss.coverage_end,
    ss.status,
    ss.load_points,
    ss.notes
  from schedule_source ss
  join public.location_groups lg on lg.id = ss.location_group_id
  left join public.location_group_memberships lgm on lgm.location_group_id = lg.id and lgm.active = true
  left join public.locations l on l.id = lgm.location_id and l.active = true
  left join public.employees e on e.id = ss.assigned_employee_id
  group by lg.id, lg.group_code, lg.group_name, ss.segment_id, ss.segment_number, ss.owner_type, ss.assigned_employee_id, e.display_name, ss.coverage_start, ss.coverage_end, ss.status, ss.load_points, ss.notes
  order by lg.group_name, ss.segment_number;
$function$;

CREATE OR REPLACE FUNCTION public.sch_group_adjusted_load_points(p_location_group_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select round(
    (
      public.sch_group_load_points(p_location_group_id) * coalesce(lgps.cluster_weight_multiplier, 1.0)
    ) + coalesce(lgps.isolation_penalty_points, 0),
    2
  )::numeric
  from public.location_groups lg
  left join public.location_group_proximity_settings lgps
    on lgps.location_group_id = lg.id
   and lgps.active = true
  where lg.id = p_location_group_id;
$function$;

CREATE OR REPLACE FUNCTION public.sch_group_proximity_points(p_location_group_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select round(
    public.sch_group_load_points(p_location_group_id) * greatest(coalesce(lgps.cluster_weight_multiplier, 1) - 1, 0)
    + coalesce(lgps.isolation_penalty_points, 0),
    2
  )::numeric
  from public.location_groups lg
  left join public.location_group_proximity_settings lgps
    on lgps.location_group_id = lg.id
   and lgps.active = true
  where lg.id = p_location_group_id;
$function$;

CREATE OR REPLACE FUNCTION public.sch_is_employee_location_group_restricted(p_employee_id uuid, p_location_group_id uuid, p_day_of_week integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  with target as (
    -- H24: Use employee_id (stable) and group_code for matching.
    -- Original code matched on display_name = 'Alijah Collins' which is fragile.
    -- Now we match on the restriction preference by employee_id directly,
    -- and use group_code only for the Herpetarium-specific Monday exception.
    -- Fallback comment: display_name was 'Alijah Collins' in the original code.
    select lg.group_code
    from public.location_groups lg
    where lg.id = p_location_group_id
  )
  select coalesce((
    select case
      -- H24: Use group_code + employee_id-based preference check instead of
      -- hardcoded display_name. If the employee has an active 'restricted'
      -- preference for HERPETARIUM, check the Monday exception.
      when t.group_code = 'HERPETARIUM'
           and exists (
             select 1
             from public.employee_area_preferences eap
             where eap.employee_id = p_employee_id
               and eap.location_group_id = p_location_group_id
               and eap.active = true
               and lower(coalesce(eap.preference_type, '')) = 'restricted'
           ) then
        not public.sch_alijah_herpetarium_monday_exception_allowed(
          p_employee_id,
          p_location_group_id,
          p_day_of_week
        )
      else exists (
        select 1
        from public.employee_area_preferences eap
        where eap.employee_id = p_employee_id
          and eap.location_group_id = p_location_group_id
          and eap.active = true
          and lower(coalesce(eap.preference_type, '')) = 'restricted'
      )
    end
    from target t
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.sch_queue_scan_alert_manager_escalations(p_grace_minutes integer DEFAULT 30, p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row record;
  v_manager record;
  v_system_user_id uuid;
  v_thread_id uuid;
  v_message_id uuid;
  v_message text;
  v_results jsonb := '[]'::jsonb;
  v_limit integer := greatest(coalesce(p_limit, 50), 1);
  v_grace integer := greatest(coalesce(p_grace_minutes, 30), 1);
begin
  select mu.id as msg_user_id, mda.device_identifier
    into v_manager
  from public.msg_users mu
  left join public.msg_device_assignments mda on mda.msg_user_id = mu.id and mda.is_active = true
  where mu.is_active = true
    and mu.role = 'manager'
  order by case when mu.display_name = 'Ops Manager' then 0 else 1 end,
           case when mda.device_identifier = '1e74fe4c-dc20b3b9' then 0 else 1 end,
           mu.created_at
  limit 1;

  if v_manager.msg_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'No active manager Messenger user found');
  end if;

  select id into v_system_user_id
  from public.msg_users
  where display_name = 'Memphis'
    and is_active = true
  limit 1;

  if v_system_user_id is null then
    v_system_user_id := v_manager.msg_user_id;
  end if;

  for v_row in
    select *
    from public.scan_alert_notification_log
    where active = true
      and alert_type = 'overdue'
      and escalated_at is null
      and created_at <= now() - make_interval(mins => v_grace)
    order by created_at asc
    limit v_limit
  loop
    v_message := format(
      '%s is still overdue. %s was notified at %s.',
      coalesce(v_row.location_name, v_row.location_code),
      coalesce((select split_part(display_name, ' ', 1) from public.employees where id = v_row.assigned_employee_id), 'The assigned employee'),
      to_char(timezone('America/Chicago', v_row.created_at), 'HH12:MI AM')
    );

    if p_dry_run then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'scan_alert_notification_id', v_row.id,
        'location_code', v_row.location_code,
        'manager_msg_user_id', v_manager.msg_user_id,
        'manager_device_identifier', v_manager.device_identifier,
        'message', v_message,
        'dry_run', true
      ));
    else
      v_thread_id := public.sch_get_or_create_scan_alert_thread(v_manager.msg_user_id);
      v_message_id := gen_random_uuid();

      insert into public.msg_messages (
        id,
        thread_id,
        sender_user_id,
        message_type,
        body,
        metadata_json,
        sent_at,
        created_at,
        is_deleted
      ) values (
        v_message_id,
        v_thread_id,
        v_system_user_id,
        'system',
        v_message,
        jsonb_build_object(
          'source', 'scan_alert_escalation',
          'scan_alert_notification_id', v_row.id,
          'alert_type', v_row.alert_type,
          'location_code', v_row.location_code,
          'assigned_employee_id', v_row.assigned_employee_id,
          'original_message_id', v_row.msg_message_id,
          'grace_minutes', v_grace
        ),
        now(),
        now(),
        false
      );

      insert into public.msg_receipts (id, message_id, user_id, delivered_at, read_at)
      values (gen_random_uuid(), v_message_id, v_manager.msg_user_id, now(), null)
      on conflict (message_id, user_id) do nothing;

      update public.msg_threads
         set updated_at = now(), last_message_at = now()
       where id = v_thread_id;

      update public.scan_alert_notification_log
         set escalated_at = now(),
             escalation_msg_user_id = v_manager.msg_user_id,
             escalation_msg_device_identifier = v_manager.device_identifier,
             escalation_msg_thread_id = v_thread_id,
             escalation_msg_message_id = v_message_id,
             escalation_message = v_message,
             alert_context = coalesce(alert_context, '{}'::jsonb) || jsonb_build_object('escalated_at', now(), 'escalation_grace_minutes', v_grace)
       where id = v_row.id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'scan_alert_notification_id', v_row.id,
        'location_code', v_row.location_code,
        'manager_msg_user_id', v_manager.msg_user_id,
        'manager_device_identifier', v_manager.device_identifier,
        'msg_thread_id', v_thread_id,
        'msg_message_id', v_message_id,
        'message', v_message,
        'dry_run', false
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'grace_minutes', v_grace,
    'result_count', jsonb_array_length(v_results),
    'results', v_results
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_schedule_health_day(p_service_date date DEFAULT sch_service_date(now()))
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_service_date date := coalesce(p_service_date, public.sch_service_date(now()));
  v_roster_rows integer := 0;
  v_assignment_rows integer := 0;
  v_open_rows integer := 0;
  v_assigned_rows integer := 0;
  v_active_employee_count integer := 0;
  v_absent_count integer := 0;
  v_event_count integer := 0;
  v_missing_template_count integer := 0;
  v_due_soon_restrooms integer := 0;
  v_overdue_restrooms integer := 0;
  v_not_cleaned_restrooms integer := 0;
  v_open_tickets integer := 0;
  v_warnings jsonb := '[]'::jsonb;
begin
  select count(*) into v_roster_rows from public.daily_work_roster where service_date = v_service_date and active = true;

  select count(*), count(*) filter (where status = 'OPEN'), count(*) filter (where status = 'ASSIGNED')
    into v_assignment_rows, v_open_rows, v_assigned_rows
  from public.daily_schedule_assignments where service_date = v_service_date;

  select count(*) into v_active_employee_count from public.employees where active = true;
  select count(*) into v_absent_count from public.daily_absence_overrides where absence_date = v_service_date and active = true;
  select count(*) into v_event_count from public.events_app_events where event_date = v_service_date;

  select count(*) into v_missing_template_count
  from public.location_groups lg
  where lg.active = true
    and not exists (select 1 from public.coverage_templates ct where ct.location_group_id = lg.id and ct.active = true);

  if v_service_date = public.sch_service_date(now()) then
    select count(*) filter (where timer_status = 'due_soon'),
           count(*) filter (where timer_status = 'overdue'),
           count(*) filter (where timer_status = 'not_cleaned_yet')
      into v_due_soon_restrooms, v_overdue_restrooms, v_not_cleaned_restrooms
    from public.v_restroom_check_timers;
  end if;

  select count(*) into v_open_tickets from public.maintenance_tickets where status = 'open';

  if v_assignment_rows = 0 then v_warnings := v_warnings || jsonb_build_array('No generated schedule rows exist for this date.'); end if;
  if v_open_rows > 0 then v_warnings := v_warnings || jsonb_build_array(v_open_rows || ' schedule segment(s) are OPEN.'); end if;
  if v_missing_template_count > 0 then v_warnings := v_warnings || jsonb_build_array(v_missing_template_count || ' active location group(s) have no active coverage template.'); end if;
  if v_service_date = public.sch_service_date(now()) and v_overdue_restrooms > 0 then v_warnings := v_warnings || jsonb_build_array(v_overdue_restrooms || ' individual restroom timer(s) are overdue.'); end if;

  return jsonb_build_object(
    'service_date', v_service_date,
    'generated', v_assignment_rows > 0,
    'roster_rows', v_roster_rows,
    'assignment_rows', v_assignment_rows,
    'assigned_rows', v_assigned_rows,
    'open_rows', v_open_rows,
    'active_employee_count', v_active_employee_count,
    'absent_count', v_absent_count,
    'events_today', v_event_count,
    'groups_missing_templates', v_missing_template_count,
    'individual_restrooms_due_soon', v_due_soon_restrooms,
    'individual_restrooms_overdue', v_overdue_restrooms,
    'individual_restrooms_not_cleaned_yet', v_not_cleaned_restrooms,
    'open_maintenance_tickets', v_open_tickets,
    'warnings', v_warnings
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_set_employee_shift_template_metadata(p_employee_ref text, p_day_of_week integer, p_lunch_start time without time zone DEFAULT NULL::time without time zone, p_lunch_end time without time zone DEFAULT NULL::time without time zone, p_color_hex text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_resolved jsonb;
  v_employee_id uuid;
  v_color text := null;
  v_row record;
begin
  if btrim(coalesce(p_employee_ref, '')) = '' then
    raise exception 'p_employee_ref is required';
  end if;

  if p_day_of_week is null or p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'p_day_of_week must be 0-6 where 0 is Sunday';
  end if;

  if p_lunch_start is not null and p_lunch_end is not null and p_lunch_end <= p_lunch_start then
    raise exception 'p_lunch_end must be after p_lunch_start';
  end if;

  if p_color_hex is not null and btrim(p_color_hex) <> '' then
    if btrim(p_color_hex) !~ '^#?[0-9A-Fa-f]{6}$' then
      raise exception 'p_color_hex must be a 6-digit hex color';
    end if;
    v_color := case when left(btrim(p_color_hex), 1) = '#' then upper(btrim(p_color_hex)) else '#' || upper(btrim(p_color_hex)) end;
  end if;

  v_resolved := public.sch_resolve_employee_ref(p_employee_ref);
  if coalesce((v_resolved ->> 'ok')::boolean, false) is not true then
    raise exception 'Could not resolve employee reference: %', p_employee_ref;
  end if;

  v_employee_id := (v_resolved ->> 'employee_id')::uuid;

  update public.employee_shift_templates est
     set lunch_start = coalesce(p_lunch_start, est.lunch_start),
         lunch_end = coalesce(p_lunch_end, est.lunch_end),
         color_hex = coalesce(v_color, est.color_hex),
         notes = coalesce(p_notes, est.notes),
         updated_at = now()
   where est.employee_id = v_employee_id
     and est.day_of_week = p_day_of_week
     and est.active = true
   returning est.* into v_row;

  if v_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'active_shift_template_not_found',
      'employee_id', v_employee_id,
      'employee_name', v_resolved ->> 'employee_name',
      'day_of_week', p_day_of_week
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'template_id', v_row.id,
    'employee_id', v_row.employee_id,
    'employee_name', v_resolved ->> 'employee_name',
    'day_of_week', v_row.day_of_week,
    'shift_start', to_char(v_row.shift_start, 'HH24:MI:SS'),
    'shift_end', to_char(v_row.shift_end, 'HH24:MI:SS'),
    'lunch_start', case when v_row.lunch_start is null then null else to_char(v_row.lunch_start, 'HH24:MI:SS') end,
    'lunch_end', case when v_row.lunch_end is null then null else to_char(v_row.lunch_end, 'HH24:MI:SS') end,
    'color_hex', v_row.color_hex,
    'notes', v_row.notes
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_split_restored_scan_owner_rows_around_lunch(p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  r record;
  v_helper_id uuid;
  v_helper_name text;
  v_helper_note text;
  v_lunch_start time;
  v_lunch_end time;
  v_next_segment integer;
  v_owner_splits integer := 0;
  v_lunch_rows integer := 0;
  v_return_rows integer := 0;
  v_open_rows integer := 0;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  for r in
    select dsa.*, lg.group_code, lg.group_name, e.display_name as owner_name, lw.lunch_start as owner_lunch_start, lw.lunch_end as owner_lunch_end
    from public.daily_schedule_assignments dsa
    join public.location_groups lg on lg.id = dsa.location_group_id
    join public.employees e on e.id = dsa.assigned_employee_id
    join lateral public.sch_lunch_window_for_employee(p_service_date, dsa.assigned_employee_id) lw on true
    where dsa.service_date = p_service_date
      and lg.group_code in ('CAT_COUNTRY', 'PRIMATE_CANYON')
      and dsa.status = 'ASSIGNED'
      and dsa.assigned_employee_id is not null
      and coalesce(dsa.coverage_purpose, '') not in ('lunch_coverage', 'reminder', 'response_only')
      and dsa.coverage_start < lw.lunch_end
      and dsa.coverage_end > lw.lunch_start
      and coalesce(dsa.source_type, '') not like '%lunch_split_before%'
      and coalesce(dsa.source_type, '') not like '%lunch_split_after%'
    order by dsa.service_date, dsa.coverage_start, lg.group_name
  loop
    v_lunch_start := greatest(r.coverage_start, r.owner_lunch_start);
    v_lunch_end := least(r.coverage_end, r.owner_lunch_end);
    if v_lunch_start >= v_lunch_end then
      continue;
    end if;

    v_helper_id := null;
    v_helper_name := null;
    v_helper_note := null;

    select c.employee_id, c.employee_name, c.explanation
      into v_helper_id, v_helper_name, v_helper_note
    from public.sch_get_coverage_candidates(p_service_date, r.location_group_id, v_lunch_start, v_lunch_end) c
    where c.employee_id <> r.assigned_employee_id
      and not exists (
        select 1
        from public.sch_lunch_window_for_employee(p_service_date, c.employee_id) lw2
        where lw2.lunch_start < v_lunch_end
          and lw2.lunch_end > v_lunch_start
      )
    order by c.recommendation_score desc, c.employee_name asc
    limit 1;

    if r.coverage_start < v_lunch_start then
      update public.daily_schedule_assignments
         set coverage_end = v_lunch_start,
             source_type = trim(concat_ws(':', nullif(source_type, ''), 'lunch_split_before')),
             notes = trim(concat_ws(' | ', nullif(notes, ''), 'Restored scan location: owner holds area until lunch.')),
             updated_at = now()
       where id = r.id;
      v_owner_splits := v_owner_splits + 1;
    end if;

    if not exists (
      select 1
      from public.daily_schedule_assignments x
      where x.service_date = p_service_date
        and x.location_group_id = r.location_group_id
        and x.coverage_purpose = 'lunch_coverage'
        and x.coverage_start = v_lunch_start
        and x.coverage_end = v_lunch_end
    ) then
      select coalesce(max(segment_number), 0) + 1000
        into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = r.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date, r.location_group_id, v_next_segment, v_helper_id,
        case when v_helper_id is null then 'OPEN' else 'EMPLOYEE' end,
        v_lunch_start, v_lunch_end,
        case when v_helper_id is null then 'OPEN' else 'ASSIGNED' end,
        r.load_points,
        case when v_helper_id is null then
          trim(concat_ws(' | ', nullif(r.notes, ''), 'Lunch coverage needed for ' || r.owner_name || ' at restored scan location ' || r.group_name || '. No helper candidate found.'))
        else
          trim(concat_ws(' | ', nullif(r.notes, ''), 'Lunch coverage for ' || r.owner_name || ' at restored scan location ' || r.group_name || '. Cover: ' || v_helper_name || '. ' || coalesce(v_helper_note, '')))
        end,
        case when v_helper_id is null then 'restored_scan_lunch_coverage_open' else 'restored_scan_lunch_coverage' end,
        'lunch_coverage'
      );
      v_lunch_rows := v_lunch_rows + 1;
      if v_helper_id is null then
        v_open_rows := v_open_rows + 1;
      end if;
    end if;

    if r.coverage_start < v_lunch_start and v_lunch_end < r.coverage_end
       and not exists (
         select 1
         from public.daily_schedule_assignments x
         where x.service_date = p_service_date
           and x.location_group_id = r.location_group_id
           and x.assigned_employee_id = r.assigned_employee_id
           and x.coverage_start = v_lunch_end
           and x.coverage_end = r.coverage_end
           and coalesce(x.source_type, '') like '%lunch_split_after%'
       ) then
      select coalesce(max(segment_number), 0) + 1000
        into v_next_segment
      from public.daily_schedule_assignments
      where service_date = p_service_date
        and location_group_id = r.location_group_id;

      insert into public.daily_schedule_assignments (
        service_date, location_group_id, segment_number, assigned_employee_id, owner_type,
        coverage_start, coverage_end, status, load_points, notes, source_type, coverage_purpose
      ) values (
        p_service_date, r.location_group_id, v_next_segment, r.assigned_employee_id, r.owner_type,
        v_lunch_end, r.coverage_end, r.status, r.load_points,
        trim(concat_ws(' | ', nullif(r.notes, ''), 'Restored scan location: owner returns after lunch.')),
        trim(concat_ws(':', nullif(r.source_type, ''), 'lunch_split_after')),
        r.coverage_purpose
      );
      v_return_rows := v_return_rows + 1;
    end if;
  end loop;

  update public.daily_schedule_assignments
     set segment_number = segment_number + 100000,
         updated_at = now()
   where service_date = p_service_date;

  with numbered as (
    select id,
           row_number() over (
             partition by service_date, location_group_id
             order by coverage_start, coverage_end,
               case coverage_purpose when 'lunch_coverage' then 1 else 0 end,
               created_at,
               id
           )::integer as new_segment_number
    from public.daily_schedule_assignments
    where service_date = p_service_date
  )
  update public.daily_schedule_assignments dsa
     set segment_number = numbered.new_segment_number,
         updated_at = now()
    from numbered
   where dsa.id = numbered.id;

  return jsonb_build_object(
    'service_date', p_service_date,
    'applied', v_owner_splits > 0 or v_lunch_rows > 0 or v_return_rows > 0,
    'owner_splits', v_owner_splits,
    'lunch_rows', v_lunch_rows,
    'return_rows', v_return_rows,
    'open_rows', v_open_rows
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_upsert_employee_alias(p_employee_ref text, p_alias_text text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_resolved jsonb;
  v_employee_id uuid;
  v_alias text := btrim(coalesce(p_alias_text, ''));
  v_row public.employee_aliases%rowtype;
begin
  if btrim(coalesce(p_employee_ref, '')) = '' then
    raise exception 'p_employee_ref is required';
  end if;

  if v_alias = '' then
    raise exception 'p_alias_text is required';
  end if;

  v_resolved := public.sch_resolve_employee_ref(p_employee_ref);
  if coalesce((v_resolved ->> 'ok')::boolean, false) is not true then
    raise exception 'Could not resolve employee reference: %', p_employee_ref;
  end if;

  v_employee_id := (v_resolved ->> 'employee_id')::uuid;

  insert into public.employee_aliases (employee_id, alias_text, active, notes, created_at, updated_at)
  values (v_employee_id, v_alias, true, p_notes, now(), now())
  on conflict (employee_id, lower(btrim(alias_text)))
  do update set
    alias_text = excluded.alias_text,
    active = true,
    notes = coalesce(excluded.notes, public.employee_aliases.notes),
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'alias_id', v_row.id,
    'employee_id', v_row.employee_id,
    'employee_name', v_resolved ->> 'employee_name',
    'alias_text', v_row.alias_text,
    'active', v_row.active,
    'notes', v_row.notes
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.tool_admin_health_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.admin_health_summary();
$function$;

CREATE OR REPLACE FUNCTION public.tool_close_maintenance_ticket(p_ticket_id text, p_closed_by text, p_close_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.close_maintenance_ticket(p_ticket_id::uuid, p_closed_by, p_close_notes);
$function$;

CREATE OR REPLACE FUNCTION public.tool_force_close_session(p_session_uuid text, p_closed_by text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.force_close_session(p_session_uuid, p_closed_by, p_reason);
$function$;

CREATE OR REPLACE FUNCTION public.tool_get_last_cleaned(p_location text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (
      select jsonb_build_object(
        'location_code', glc.location_code,
        'location_name', glc.location_name,
        'cleaned_by', glc.cleaned_by,
        'started_at', glc.started_at,
        'ended_at', glc.ended_at,
        'duration_minutes', glc.duration_minutes,
        'duration_display', glc.duration_display,
        'device_id', glc.device_id,
        'status', glc.status
      )
      from public.get_last_cleaned(p_location) glc
      limit 1
    ),
    jsonb_build_object(
      'found', false,
      'message', 'No matching cleaned location found'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.tool_list_active_devices()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'device_id', x.device_id,
        'device_name', x.device_name,
        'active', x.active,
        'assigned_employee_name', x.assigned_employee_name,
        'last_seen_at', x.last_seen_at,
        'notes', x.notes
      )
      order by x.device_id
    ),
    '[]'::jsonb
  )
  from public.list_active_devices() x;
$function$;

CREATE OR REPLACE FUNCTION public.tool_list_active_employees()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_code', x.employee_code,
        'display_name', x.display_name,
        'role', x.role,
        'active', x.active
      )
      order by x.display_name
    ),
    '[]'::jsonb
  )
  from public.list_active_employees() x;
$function$;

CREATE OR REPLACE FUNCTION public.tool_list_open_sessions()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'session_uuid', x.session_uuid,
        'location_code', x.location_code,
        'location_name', x.location_name,
        'employee_name', x.employee_name,
        'device_id', x.device_id,
        'status', x.status,
        'started_at', x.started_at,
        'ended_at', x.ended_at,
        'duration_minutes', x.duration_minutes,
        'duration_display', x.duration_display
      )
      order by x.started_at desc
    ),
    '[]'::jsonb
  )
  from public.list_open_sessions() x;
$function$;

CREATE OR REPLACE FUNCTION public.tool_ping_device(p_device_id text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.device_heartbeat(p_device_id, p_notes);
$function$;

CREATE OR REPLACE FUNCTION public.tool_purge_closed_scan_history_before(p_cutoff timestamp with time zone, p_requested_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.purge_closed_scan_history_before(p_cutoff, p_requested_by);
$function$;

CREATE OR REPLACE FUNCTION public.tool_record_scan_event(p_location_code text, p_device_identifier text, p_event_type text, p_result text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payload_json jsonb DEFAULT '{}'::jsonb, p_client_event_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.record_scan_event(
    p_location_code,
    p_device_identifier,
    p_event_type,
    p_result,
    p_notes,
    p_payload_json,
    p_client_event_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.commit_cleaning_workflow(p_client_session_id text, p_client_completion_id text, p_device_id text, p_location_code text, p_client_started_at timestamp with time zone, p_client_ended_at timestamp with time zone, p_response_json jsonb DEFAULT '{}'::jsonb, p_scan_evidence jsonb DEFAULT '[]'::jsonb, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_client_session_id text := nullif(btrim(coalesce(p_client_session_id, '')), '');
  v_client_completion_id text := nullif(btrim(coalesce(p_client_completion_id, '')), '');
  v_correlation_id text := nullif(btrim(coalesce(p_correlation_id, '')), '');
  v_location_id uuid;
  v_location_code text;
  v_location_name text;
  v_location_type text;
  v_form_type text;
  v_device_pk uuid;
  v_device_id text;
  v_device_name text;
  v_employee_id uuid;
  v_employee_name text;
  v_session_id uuid;
  v_session_uuid text;
  v_session_status text;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_duration_minutes integer;
  v_duration_display text;
  v_completion_response_id uuid;
  v_existing_completion_id uuid;
  v_existing_submitted_at timestamptz;
  v_ticket_count integer := 0;
  v_session_created boolean := false;
  v_item jsonb;
  v_event_type text;
  v_event_id text;
begin
  if v_client_session_id is null or length(v_client_session_id) > 200 then
    raise exception 'client_session_id is required and must be at most 200 characters';
  end if;
  if v_client_completion_id is null or length(v_client_completion_id) > 200 then
    raise exception 'client_completion_id is required and must be at most 200 characters';
  end if;
  if nullif(btrim(coalesce(p_device_id, '')), '') is null then raise exception 'device_id is required'; end if;
  if nullif(btrim(coalesce(p_location_code, '')), '') is null then raise exception 'location_code is required'; end if;
  if jsonb_typeof(coalesce(p_response_json, '{}'::jsonb)) <> 'object' then raise exception 'response_json must be an object'; end if;
  if pg_column_size(coalesce(p_response_json, '{}'::jsonb)) > 1048576 then raise exception 'response_json exceeds 1 MB'; end if;
  if jsonb_typeof(coalesce(p_scan_evidence, '[]'::jsonb)) <> 'array' then raise exception 'scan_evidence must be an array'; end if;

  perform pg_advisory_xact_lock(hashtextextended('scan-session:' || v_client_session_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('scan-completion:' || v_client_completion_id, 0));

  select cr.id, cr.submitted_at, s.id, s.session_uuid, s.status, s.started_at, s.ended_at,
         s.duration_minutes, s.duration_display,
         l.id, l.location_code, l.location_name, l.location_type, l.form_type,
         d.id, d.device_id, d.device_name,
         e.id, e.display_name
    into v_existing_completion_id, v_existing_submitted_at,
         v_session_id, v_session_uuid, v_session_status, v_started_at, v_ended_at,
         v_duration_minutes, v_duration_display,
         v_location_id, v_location_code, v_location_name, v_location_type, v_form_type,
         v_device_pk, v_device_id, v_device_name,
         v_employee_id, v_employee_name
  from public.completion_responses cr
  join public.sessions s on s.id = cr.session_id
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  join public.employees e on e.id = s.employee_id
  where cr.client_completion_id = v_client_completion_id
  limit 1;

  if v_existing_completion_id is not null then
    if upper(btrim(v_device_id)) <> upper(btrim(p_device_id)) then
      raise exception 'client_completion_id is already bound to another device';
    end if;
    if v_client_session_id <> (select s.client_session_id from public.sessions s where s.id = v_session_id) then
      raise exception 'client_completion_id is already bound to another client_session_id';
    end if;
    return jsonb_build_object(
      'session_uuid', v_session_uuid,
      'client_session_id', v_client_session_id,
      'client_completion_id', v_client_completion_id,
      'location_code', v_location_code,
      'location_name', v_location_name,
      'location_type', v_location_type,
      'form_type', v_form_type,
      'employee_name', v_employee_name,
      'device_id', v_device_id,
      'device_name', v_device_name,
      'status', v_session_status,
      'started_at', v_started_at,
      'ended_at', v_ended_at,
      'duration_minutes', v_duration_minutes,
      'duration_display', v_duration_display,
      'submitted_at', v_existing_submitted_at,
      'completion_response_id', v_existing_completion_id,
      'replayed', true,
      'correlation_id', v_correlation_id
    );
  end if;

  select l.id, l.location_code, l.location_name, l.location_type, l.form_type
    into v_location_id, v_location_code, v_location_name, v_location_type, v_form_type
  from public.locations l
  where l.location_code = public.resolve_scan_location_code(p_location_code)
    and l.active = true
  limit 1;
  if v_location_id is null then raise exception 'Active location not found for code: %', p_location_code; end if;

  select d.id, d.device_id, d.device_name, e.id, e.display_name
    into v_device_pk, v_device_id, v_device_name, v_employee_id, v_employee_name
  from public.devices d
  left join public.employees e on e.id = d.assigned_employee_id and e.active = true
  where upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    and d.active = true
  limit 1;
  if v_device_pk is null then raise exception 'Active device not found: %', p_device_id; end if;
  if v_employee_id is null then raise exception 'Device % is not assigned to an active employee', v_device_id; end if;

  select s.id, s.session_uuid, s.status, s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.location_id, s.device_id, s.employee_id
    into v_session_id, v_session_uuid, v_session_status, v_started_at, v_ended_at,
         v_duration_minutes, v_duration_display,
         v_location_id, v_device_pk, v_employee_id
  from public.sessions s
  where s.client_session_id = v_client_session_id
  for update;

  if v_session_id is not null then
    if v_device_pk <> (select d.id from public.devices d where upper(btrim(d.device_id)) = upper(btrim(p_device_id)) and d.active limit 1) then
      raise exception 'client_session_id is bound to another device';
    end if;
    if v_location_id <> (select l.id from public.locations l where l.location_code = public.resolve_scan_location_code(p_location_code) and l.active limit 1) then
      raise exception 'client_session_id is bound to another location';
    end if;
    if v_employee_id <> (select d.assigned_employee_id from public.devices d where upper(btrim(d.device_id)) = upper(btrim(p_device_id)) and d.active limit 1) then
      raise exception 'device assignment changed during this session; manager review required';
    end if;
    if v_session_status = 'cancelled' then
      raise exception 'Session was cancelled before completion reached the server; manager recovery is required';
    end if;
    if exists (select 1 from public.completion_responses cr where cr.session_id = v_session_id) then
      select cr.id, cr.submitted_at into v_existing_completion_id, v_existing_submitted_at
      from public.completion_responses cr where cr.session_id = v_session_id limit 1;
      return jsonb_build_object(
        'session_uuid', v_session_uuid,
        'client_session_id', v_client_session_id,
        'client_completion_id', v_client_completion_id,
        'location_code', v_location_code,
        'location_name', v_location_name,
        'location_type', v_location_type,
        'form_type', v_form_type,
        'employee_name', v_employee_name,
        'device_id', v_device_id,
        'device_name', v_device_name,
        'status', v_session_status,
        'started_at', v_started_at,
        'ended_at', v_ended_at,
        'duration_minutes', v_duration_minutes,
        'duration_display', v_duration_display,
        'submitted_at', v_existing_submitted_at,
        'completion_response_id', v_existing_completion_id,
        'replayed', true,
        'correlation_id', v_correlation_id
      );
    end if;
  else
    perform public.expire_stale_open_sessions(now());

    if exists (select 1 from public.sessions s where s.device_id = v_device_pk and s.status in ('active','pending_submit')) then
      raise exception 'Device already has another open session: %', v_device_id;
    end if;
    if exists (select 1 from public.sessions s where s.employee_id = v_employee_id and s.status in ('active','pending_submit')) then
      raise exception 'Assigned employee already has another open session: %', v_employee_name;
    end if;
    if exists (select 1 from public.sessions s where s.location_id = v_location_id and s.status in ('active','pending_submit')) then
      raise exception 'Location already has another open session: %', v_location_code;
    end if;

    v_started_at := coalesce(p_client_started_at, p_client_ended_at, now());
    v_session_uuid := gen_random_uuid()::text;
    insert into public.sessions(
      session_uuid, client_session_id, location_id, employee_id, device_id,
      status, started_at, completion_source
    ) values (
      v_session_uuid, v_client_session_id, v_location_id, v_employee_id, v_device_pk,
      'active', v_started_at, null
    ) returning id into v_session_id;
    v_session_status := 'active';
    v_session_created := true;

    insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
    values (
      v_session_id,
      'session_started',
      'device',
      v_device_id,
      jsonb_build_object(
        'location_code', v_location_code,
        'device_id', v_device_id,
        'employee_name', v_employee_name,
        'client_session_id', v_client_session_id,
        'correlation_id', v_correlation_id,
        'identity_source', 'devices.assigned_employee_id',
        'created_during_atomic_commit', true
      )
    );
  end if;

  v_started_at := coalesce(v_started_at, p_client_started_at, now());
  v_ended_at := coalesce(p_client_ended_at, now());
  if v_ended_at > now() + interval '10 minutes' then raise exception 'client_ended_at is too far in the future'; end if;
  if v_started_at > v_ended_at then raise exception 'client_started_at cannot be after client_ended_at'; end if;
  if v_started_at < now() - interval '7 days' then raise exception 'client_started_at is too old'; end if;
  if v_ended_at - v_started_at > interval '24 hours' then raise exception 'cleaning duration exceeds 24 hours'; end if;

  v_duration_minutes := greatest(0, round(extract(epoch from (v_ended_at - v_started_at)) / 60.0)::integer);
  v_duration_display := v_duration_minutes::text || ' min';

  if v_session_status = 'active' then
    update public.sessions
    set status = 'pending_submit',
        ended_at = v_ended_at,
        duration_minutes = v_duration_minutes,
        duration_display = v_duration_display,
        updated_at = now()
    where id = v_session_id and status = 'active';

    insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
    values (
      v_session_id,
      'session_finished',
      'device',
      v_device_id,
      jsonb_build_object(
        'location_code', v_location_code,
        'device_id', v_device_id,
        'duration_minutes', v_duration_minutes,
        'client_session_id', v_client_session_id,
        'correlation_id', v_correlation_id,
        'atomic_commit', true
      )
    );
    v_session_status := 'pending_submit';
  elsif v_session_status <> 'pending_submit' then
    raise exception 'Session status % cannot be completed', v_session_status;
  end if;

  insert into public.completion_responses(
    session_id,
    location_id,
    submitted_by_employee_id,
    device_id,
    response_json,
    submitted_at,
    client_completion_id
  ) values (
    v_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    coalesce(p_response_json, '{}'::jsonb),
    now(),
    v_client_completion_id
  ) returning id, submitted_at into v_completion_response_id, v_existing_submitted_at;

  v_ticket_count := public.create_maintenance_tickets_from_response(
    v_completion_response_id,
    v_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    v_existing_submitted_at,
    coalesce(p_response_json, '{}'::jsonb)
  );

  if jsonb_array_length(coalesce(p_scan_evidence, '[]'::jsonb)) > 200 then
    raise exception 'scan_evidence cannot contain more than 200 events';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_scan_evidence, '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_event_type := nullif(btrim(coalesce(v_item->>'event_type', '')), '');
    v_event_id := nullif(btrim(coalesce(v_item->>'client_event_id', '')), '');
    if v_event_type not in (
      'scan_received', 'scan_blocked', 'scan_start', 'scan_finish',
      'scan_resume_pending', 'scan_invalid_location', 'scan_unauthorized_device', 'scan_error'
    ) then
      continue;
    end if;

    insert into public.scan_events(
      scanned_at,
      location_id,
      location_code,
      device_id,
      device_identifier,
      session_id,
      event_type,
      result,
      notes,
      payload_json,
      client_event_id
    ) values (
      coalesce(nullif(v_item->>'scanned_at', '')::timestamptz, now()),
      v_location_id,
      v_location_code,
      v_device_pk,
      v_device_id,
      v_session_id,
      v_event_type,
      nullif(v_item->>'result', ''),
      nullif(v_item->>'notes', ''),
      coalesce(v_item->'payload_json', '{}'::jsonb) || jsonb_build_object('correlation_id', v_correlation_id),
      v_event_id
    )
    on conflict (client_event_id) where client_event_id is not null
    do update set
      session_id = coalesce(public.scan_events.session_id, excluded.session_id),
      location_id = coalesce(public.scan_events.location_id, excluded.location_id),
      device_id = coalesce(public.scan_events.device_id, excluded.device_id),
      payload_json = coalesce(public.scan_events.payload_json, '{}'::jsonb) || excluded.payload_json;
  end loop;

  update public.sessions
  set status = 'closed',
      ended_at = v_ended_at,
      duration_minutes = v_duration_minutes,
      duration_display = v_duration_display,
      completion_source = 'kiosk_form',
      updated_at = now()
  where id = v_session_id and status = 'pending_submit';

  if not found then raise exception 'Session could not transition from pending_submit to closed'; end if;

  insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
  values (
    v_session_id,
    'session_completed',
    'form',
    v_employee_name,
    jsonb_build_object(
      'client_session_id', v_client_session_id,
      'client_completion_id', v_client_completion_id,
      'correlation_id', v_correlation_id,
      'ticket_count', v_ticket_count,
      'identity_source', 'devices.assigned_employee_id',
      'atomic_commit', true
    )
  );

  insert into public.system_logs(level, source, message, session_id, location_id, device_id)
  values ('INFO', 'commit_cleaning_workflow', 'Atomic cleaning workflow committed', v_session_id, v_location_id, v_device_pk);

  return jsonb_build_object(
    'session_uuid', v_session_uuid,
    'client_session_id', v_client_session_id,
    'client_completion_id', v_client_completion_id,
    'location_code', v_location_code,
    'location_name', v_location_name,
    'location_type', v_location_type,
    'form_type', v_form_type,
    'employee_name', v_employee_name,
    'device_id', v_device_id,
    'device_name', v_device_name,
    'status', 'closed',
    'started_at', v_started_at,
    'ended_at', v_ended_at,
    'duration_minutes', v_duration_minutes,
    'duration_display', v_duration_display,
    'submitted_at', v_existing_submitted_at,
    'completion_response_id', v_completion_response_id,
    'maintenance_ticket_count', v_ticket_count,
    'session_created_during_commit', v_session_created,
    'replayed', false,
    'correlation_id', v_correlation_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_preflight()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_missing text[];
begin
  select array_agg(name)
  into v_missing
  from (
    values
      ('public.employees', to_regclass('public.employees')),
      ('public.locations', to_regclass('public.locations')),
      ('public.devices', to_regclass('public.devices')),
      ('public.sessions', to_regclass('public.sessions')),
      ('public.scan_events', to_regclass('public.scan_events')),
      ('public.session_events', to_regclass('public.session_events')),
      ('public.completion_responses', to_regclass('public.completion_responses')),
      ('public.maintenance_tickets', to_regclass('public.maintenance_tickets')),
      ('public.system_settings', to_regclass('public.system_settings')),
      ('public.v_location_dashboard_status', to_regclass('public.v_location_dashboard_status')),
      ('public.v_recent_scan_activity', to_regclass('public.v_recent_scan_activity'))
  ) as t(name, reg)
  where reg is null;

  if v_missing is not null then
    raise exception 'Wrong Supabase database/branch or missing app schema. Missing: %', array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure('public.operational_day_start(timestamp with time zone)') is null then
    raise exception 'Missing required function public.operational_day_start(timestamptz). This is likely the wrong project/branch.';
  end if;

  if not exists (select 1 from public.employees where active) then
    raise exception 'Cannot start demo: no active employees found.';
  end if;

  if not exists (select 1 from public.devices where active) then
    raise exception 'Cannot start demo: no active devices found.';
  end if;

  if (select count(*) from public.locations where active) < 6 then
    raise exception 'Cannot start demo: at least 6 active locations are required.';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.msg_ensure_employee_memphis_threads()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select u.id
    from public.msg_users u
    where u.is_active = true
      and u.role = 'employee'
    order by u.id
  loop
    perform public.msg_get_or_create_memphis_thread(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;

CREATE OR REPLACE FUNCTION public.mz_free_tier_retention_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_settings jsonb := '{}'::jsonb;
  v_top_tables jsonb := '[]'::jsonb;
  v_cron_jobs jsonb := '[]'::jsonb;
  v_db_bytes bigint := pg_database_size(current_database());
  v_warn_mb integer := public.mz_retention_setting_int('retention_db_warn_mb', 300, 1, 500);
  v_urgent_mb integer := public.mz_retention_setting_int('retention_db_urgent_mb', 400, 1, 500);
  v_critical_mb integer := public.mz_retention_setting_int('retention_db_critical_mb', 450, 1, 500);
  v_status text := 'ok';
begin
  select coalesce(jsonb_object_agg(setting_key, setting_value order by setting_key), '{}'::jsonb)
    into v_settings
  from public.system_settings
  where setting_key like 'retention_%';

  select coalesce(jsonb_agg(row_to_json(t) order by t.total_bytes desc), '[]'::jsonb)
    into v_top_tables
  from (
    select
      relname as table_name,
      n_live_tup::bigint as estimated_rows,
      pg_total_relation_size(relid) as total_bytes,
      pg_size_pretty(pg_total_relation_size(relid)) as total_size
    from pg_stat_user_tables
    order by pg_total_relation_size(relid) desc
    limit 20
  ) t;

  -- H21: Do NOT expose the 'command' column from cron.job.
  -- Only expose jobname, schedule, and active status.
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobid', jobid,
    'jobname', jobname,
    'schedule', schedule,
    'active', active
  ) order by jobname), '[]'::jsonb)
    into v_cron_jobs
  from cron.job
  where jobname like 'mz-%retention%'
     or jobname like 'mz-%cleanup%'
     or jobname like 'mz-%stale%';

  if v_db_bytes >= (v_critical_mb::bigint * 1024 * 1024) then
    v_status := 'critical';
  elsif v_db_bytes >= (v_urgent_mb::bigint * 1024 * 1024) then
    v_status := 'urgent';
  elsif v_db_bytes >= (v_warn_mb::bigint * 1024 * 1024) then
    v_status := 'warn';
  end if;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'database', jsonb_build_object(
      'bytes', v_db_bytes,
      'pretty', pg_size_pretty(v_db_bytes),
      'status', v_status,
      'warn_mb', v_warn_mb,
      'urgent_mb', v_urgent_mb,
      'critical_mb', v_critical_mb,
      'supabase_free_limit_mb', 500
    ),
    'settings', v_settings,
    'top_tables', v_top_tables,
    'cron_jobs', v_cron_jobs
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch2_build_work_items(p_service_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_input_hash text;
  v_inserted integer := 0;
  v_daily_source_count integer := 0;
  v_template_source_count integer := 0;
begin
  v_input_hash := public.sch2_input_hash(p_service_date);

  insert into public.schedule_generation_runs (
    service_date, generator_version, input_hash, status, mode, force
  ) values (
    p_service_date, 'sch2-preview-2026-06-11', v_input_hash, 'building_work_items', 'preview', false
  ) returning id into v_run_id;

  with has_daily as (
    select exists (
      select 1 from public.daily_schedule_assignments dsa where dsa.service_date = p_service_date
    ) as ok
  ), source_rows as (
    select
      dsa.id as source_daily_assignment_id,
      dsa.service_date,
      dsa.location_group_id,
      dsa.segment_number,
      dsa.assigned_employee_id,
      dsa.owner_type,
      dsa.coverage_start,
      dsa.coverage_end,
      dsa.coverage_purpose,
      dsa.status,
      dsa.load_points,
      dsa.source_type,
      dsa.notes
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date

    union all

    select
      null::uuid as source_daily_assignment_id,
      p_service_date as service_date,
      ct.location_group_id,
      ct.segment_number,
      ct.assigned_employee_id,
      ct.owner_type,
      ct.coverage_start,
      ct.coverage_end,
      ct.coverage_purpose,
      case when ct.assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end as status,
      coalesce(public.sch_group_adjusted_load_points(ct.location_group_id), 1)::numeric as load_points,
      'coverage_template'::text as source_type,
      ct.notes
    from public.coverage_templates ct
    cross join has_daily hd
    where hd.ok = false
      and ct.active = true
      and ct.day_of_week = extract(dow from p_service_date)::integer
  ), enriched as (
    select
      sr.*,
      lg.group_code,
      lg.group_name,
      public.sch_is_public_restroom_group(sr.location_group_id) as is_public_restroom
    from source_rows sr
    join public.location_groups lg on lg.id = sr.location_group_id
    where lg.active = true
  )
  insert into public.schedule_work_items (
    run_id,
    service_date,
    work_item_key,
    source_daily_assignment_id,
    location_group_id,
    segment_number,
    coverage_start,
    coverage_end,
    coverage_purpose,
    required,
    may_be_open,
    scan_required,
    is_public_restroom,
    route_zone,
    bundle_key,
    load_points,
    original_assigned_employee_id,
    original_owner_type,
    original_status,
    original_source_type,
    notes,
    hard_rule_tags
  )
  select
    v_run_id,
    e.service_date,
    concat_ws(':', e.location_group_id::text, e.segment_number::text, e.coverage_start::text, e.coverage_end::text, e.coverage_purpose) as work_item_key,
    e.source_daily_assignment_id,
    e.location_group_id,
    e.segment_number,
    e.coverage_start,
    e.coverage_end,
    e.coverage_purpose,
    not (
      e.coverage_purpose in ('reminder', 'response_only')
      or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
      or (
        (e.group_code like '%GIFT_SHOP%' or e.group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP'))
        and extract(dow from e.service_date)::integer = 1
        and e.coverage_purpose = 'reminder'
        and e.coverage_start = time '08:00'
        and e.coverage_end <= time '09:45'
      )
    ) as required,
    (
      e.coverage_purpose in ('reminder', 'response_only')
      or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')
    ) as may_be_open,
    not (e.coverage_purpose in ('reminder', 'response_only') or e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY')) as scan_required,
    e.is_public_restroom,
    case
      when e.group_code in ('EXPO', 'EXPO_RESTROOMS', 'AQUARIUM', 'KOMODOS', 'MEMMEX_RESTROOMS') then 'west'
      when e.group_code in ('TETON', 'TETON_RESTROOMS', 'NORTH_WEST_PASSAGE', 'NWP', 'EAST_END_RESTROOMS', 'EAST_END_BREAK_ROOM') then 'east'
      when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'bonobos_event'
      when e.group_code in ('CAT_HOUSE_CAFE_RESTROOMS', 'CATHOUSE_CAFE_RESTROOMS', 'TROPICAL_BIRDS', 'HERPETARIUM') then 'central_east'
      else lower(regexp_replace(coalesce(split_part(e.group_code, '_', 1), 'unknown'), '[^a-zA-Z0-9]+', '_', 'g'))
    end as route_zone,
    case
      when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'BONOBOS_SPLASH_EVENT'
      else e.group_code
    end as bundle_key,
    coalesce(e.load_points, 0),
    e.assigned_employee_id,
    e.owner_type,
    e.status,
    e.source_type,
    e.notes,
    array_remove(array[
      case when e.group_code in ('PRIMATE_CANYON', 'CAT_COUNTRY') then 'response_only' end,
      case when e.group_code = 'HERPETARIUM' and extract(dow from e.service_date)::integer = 3 then 'herpetarium_wednesday' end,
      case when e.is_public_restroom then 'restroom' end,
      case when e.coverage_purpose = 'lunch_coverage' then 'lunch_coverage' end,
      case when e.group_code in ('BONOBOS', 'BONOBOS_RESTROOMS', 'SPLASH_PAD_RESTROOMS', 'EVENT_CENTER') then 'bonobos_splash_event_bundle' end,
      case when e.group_code like '%GIFT_SHOP%' or e.group_code in ('TRADING_POST', 'TRADING_POST_GIFT_SHOP') then 'gift_shop_reminder_only' end
    ]::text[], null)
  from enriched e;

  get diagnostics v_inserted = row_count;

  -- H25: Zero-work-item guard.
  if v_inserted = 0 then
    select count(*)::integer into v_daily_source_count
    from public.daily_schedule_assignments dsa
    where dsa.service_date = p_service_date;

    select count(*)::integer into v_template_source_count
    from public.coverage_templates ct
    where ct.active = true
      and ct.day_of_week = extract(dow from p_service_date)::integer;

    update public.schedule_generation_runs
       set status = 'preview_error',
           error_message = format('SCH2 build produced zero work items for %s; daily_source_rows=%s; template_source_rows=%s', p_service_date, v_daily_source_count, v_template_source_count),
           updated_at = now()
     where id = v_run_id;

    raise exception 'SCH2 build produced zero work items for %, daily_source_rows=%, template_source_rows=%',
      p_service_date, v_daily_source_count, v_template_source_count;
  end if;

  update public.schedule_generation_runs
     set status = 'work_items_ready', updated_at = now()
   where id = v_run_id;

  return v_run_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_absence_preview(p_service_date date, p_absent_employee_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_removed jsonb := '[]'::jsonb;
  v_open jsonb := '[]'::jsonb;
  v_reassigned jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_simulated_load jsonb := '{}'::jsonb;
  v_row record;
  v_candidate record;
  v_assigned_start text;
  v_assigned_end text;
  v_group_load numeric := 0;
  v_extra_points numeric := 0;
  v_extra_segments integer := 0;
  v_existing_extra_segments integer := 0;
  v_adjusted_score numeric := 0;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'location_group_id', s.location_group_id,
    'group_code', s.group_code,
    'group_name', s.group_name,
    'assigned_employee_id', s.assigned_employee_id,
    'assigned_employee_name', s.assigned_employee_name,
    'coverage_start', s.coverage_start,
    'coverage_end', s.coverage_end,
    'status', s.status
  ) order by s.group_name, s.coverage_start, s.coverage_end), '[]'::jsonb)
  into v_removed
  from public.sch_get_daily_schedule(p_service_date) s
  where s.assigned_employee_id = any(coalesce(p_absent_employee_ids, array[]::uuid[]));

  for v_row in
    select
      s.location_group_id,
      s.group_code,
      s.group_name,
      case when cardinality(s.included_locations) > 0 then s.included_locations[1] else null end as location_name,
      s.assigned_employee_id,
      s.assigned_employee_name,
      s.coverage_start,
      s.coverage_end,
      s.status,
      coalesce(s.load_points, public.sch_group_load_points(s.location_group_id)) as load_points
    from public.sch_get_daily_schedule(p_service_date) s
    where s.assigned_employee_id = any(coalesce(p_absent_employee_ids, array[]::uuid[]))
    order by s.coverage_start, s.coverage_end, coalesce(s.load_points, 0) desc, s.group_name
  loop
    v_candidate := null;
    v_assigned_start := null;
    v_assigned_end := null;
    v_extra_points := 0;
    v_extra_segments := 0;
    v_existing_extra_segments := 0;
    v_adjusted_score := 0;
    v_group_load := coalesce(v_row.load_points, public.sch_group_load_points(v_row.location_group_id), 0);

    select c.*,
           (
             c.recommendation_score
             - coalesce((v_simulated_load -> c.employee_id::text ->> 'points')::numeric, 0) * 1.5
             - coalesce((v_simulated_load -> c.employee_id::text ->> 'segments')::numeric, 0) * 1.25
             - case
                 when coalesce((v_simulated_load -> c.employee_id::text ->> 'segments')::integer, 0) = 0 then 0
                 when coalesce((v_simulated_load -> c.employee_id::text ->> 'segments')::integer, 0) = 1 then 30
                 when coalesce((v_simulated_load -> c.employee_id::text ->> 'segments')::integer, 0) = 2 then 85
                 else 160 + (coalesce((v_simulated_load -> c.employee_id::text ->> 'segments')::integer, 0) * 35)
               end
           ) as adjusted_score,
           coalesce((v_simulated_load -> c.employee_id::text ->> 'points')::numeric, 0) as simulated_points,
           coalesce((v_simulated_load -> c.employee_id::text ->> 'segments')::integer, 0) as simulated_segments
      into v_candidate
    from public.sch_get_coverage_candidates(
      p_service_date,
      v_row.location_group_id,
      v_row.coverage_start::time,
      v_row.coverage_end::time
    ) c
    where not (c.employee_id = any(coalesce(p_absent_employee_ids, array[]::uuid[])))
    order by adjusted_score desc, c.employee_name asc
    limit 1;

    if v_candidate.employee_id is not null then
      v_assigned_start := to_char(greatest(v_row.coverage_start::time, v_candidate.shift_start::time), 'HH12:MI AM');
      v_assigned_end := to_char(least(v_row.coverage_end::time, v_candidate.shift_end::time), 'HH12:MI AM');
      v_existing_extra_segments := coalesce((v_simulated_load -> v_candidate.employee_id::text ->> 'segments')::integer, 0);
      v_extra_points := coalesce((v_simulated_load -> v_candidate.employee_id::text ->> 'points')::numeric, 0) + v_group_load;
      v_extra_segments := v_existing_extra_segments + 1;
      v_adjusted_score := coalesce(v_candidate.adjusted_score, v_candidate.recommendation_score);

      v_simulated_load := v_simulated_load || jsonb_build_object(
        v_candidate.employee_id::text,
        jsonb_build_object('points', v_extra_points, 'segments', v_extra_segments)
      );

      v_reassigned := v_reassigned || jsonb_build_array(jsonb_build_object(
        'location_group_id', v_row.location_group_id,
        'group_code', v_row.group_code,
        'group_name', v_row.group_name,
        'location_name', v_row.location_name,
        'coverage_start', v_assigned_start,
        'coverage_end', v_assigned_end,
        'original_coverage_start', v_row.coverage_start,
        'original_coverage_end', v_row.coverage_end,
        'removed_employee_id', v_row.assigned_employee_id,
        'removed_employee_name', v_row.assigned_employee_name,
        'assigned_employee_id', v_candidate.employee_id,
        'assigned_employee_name', v_candidate.employee_name,
        'recommendation_score', v_candidate.recommendation_score,
        'preview_adjusted_score', v_adjusted_score,
        'preview_added_load_points', v_group_load,
        'preview_simulated_employee_added_points', v_extra_points,
        'preview_simulated_employee_added_segments', v_extra_segments,
        'preview_spread_penalty_applied', case
          when v_existing_extra_segments = 0 then 0
          when v_existing_extra_segments = 1 then 30
          when v_existing_extra_segments = 2 then 85
          else 160 + (v_existing_extra_segments * 35)
        end,
        'explanation', trim(concat_ws('. ', v_candidate.explanation, 'Preview simulated added load ' || v_extra_points || ' points across ' || v_extra_segments || ' reassigned segments'))
      ));
    else
      v_open := v_open || jsonb_build_array(jsonb_build_object(
        'location_group_id', v_row.location_group_id,
        'group_code', v_row.group_code,
        'group_name', v_row.group_name,
        'location_name', v_row.location_name,
        'coverage_start', v_row.coverage_start,
        'coverage_end', v_row.coverage_end,
        'reason', 'No eligible coverage candidate found in preview'
      ));
    end if;
  end loop;

  if jsonb_array_length(v_reassigned) > 0 then
    v_warnings := v_warnings || jsonb_build_array('Preview shows likely auto-reassignment candidates with simulated load balancing and spread penalty. Publish will regenerate the schedule and may adjust final choices based on live load/proximity scoring.');
  end if;

  if jsonb_array_length(v_open) > 0 then
    v_warnings := v_warnings || jsonb_build_array('Some absent assignments still preview as OPEN because no eligible candidate was found.');
  end if;

  return jsonb_build_object(
    'service_date', p_service_date,
    'removed_assignments', v_removed,
    'reassigned_assignments', v_reassigned,
    'open_segments', v_open,
    'overload_warnings', v_warnings
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_apply_lunch_coverage_wrapper_base_20260628(p_service_date date)
 RETURNS jsonb
 LANGUAGE sql
AS $function$
  select jsonb_build_object(
    'standard_lunch_coverage', public.sch_apply_lunch_coverage_base_20260628(p_service_date),
    'restored_scan_lunch_split', public.sch_split_restored_scan_owner_rows_around_lunch(p_service_date)
  );
$function$;

CREATE OR REPLACE FUNCTION public.sch_assignment_adjusted_load_points(p_employee_id uuid, p_day_of_week integer, p_purpose text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  with rows as (
    select ct.location_group_id
    from public.coverage_templates ct
    where ct.active = true
      and ct.assigned_employee_id = p_employee_id
      and ct.day_of_week = p_day_of_week
      and (p_purpose is null or ct.coverage_purpose = p_purpose)
  )
  select coalesce(sum(public.sch_group_adjusted_load_points(location_group_id)), 0)
       + public.sch_group_route_spread_penalty(array_agg(location_group_id))
  from rows;
$function$;

CREATE OR REPLACE FUNCTION public.sch_assignment_candidate_score(p_employee_id uuid, p_day_of_week integer, p_location_group_id uuid, p_purpose text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  with weights as (
    select proximity_weight, difficulty_weight, priority_weight
    from public.scheduler_scoring_settings
    where setting_code = 'default' and active = true
    limit 1
  ), components as (
    select
      public.sch_employee_route_fit_score(p_employee_id, p_day_of_week, p_location_group_id, p_purpose) as route_fit_penalty,
      public.sch_group_difficulty_points(p_location_group_id) as difficulty_points,
      public.sch_group_priority_points(p_location_group_id) as priority_points
  )
  select round(
    (route_fit_penalty * coalesce(proximity_weight, 0.50))
    + (difficulty_points * coalesce(difficulty_weight, 0.25))
    + (priority_points * coalesce(priority_weight, 0.25)),
    2
  )::numeric
  from components cross join weights;
$function$;

CREATE OR REPLACE FUNCTION public.sch_audit_schedule_day(p_service_date date DEFAULT sch_service_date(now()))
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_date date := coalesce(p_service_date, public.sch_service_date(now()));
  v_detail jsonb := public.sch_audit_schedule_day_detail(v_date);
  v_roster_count integer := coalesce((v_detail #>> '{counts,active_roster_rows}')::integer, 0);
  v_assignment_count integer := coalesce((v_detail #>> '{counts,assignments_total}')::integer, 0);
  v_open_count integer := coalesce((v_detail #>> '{counts,assignments_open}')::integer, 0);
  v_expected_template_count integer := 0;
  v_schedule_expected boolean := false;
  v_readiness_ok boolean := false;
  v_issue_free boolean := false;
  v_readiness_status text;
begin
  select count(*)::integer
    into v_expected_template_count
  from public.employee_shift_templates est
  join public.employees e on e.id = est.employee_id
  where est.active = true
    and e.active = true
    and est.day_of_week = extract(dow from v_date)::integer;

  v_schedule_expected := v_expected_template_count > 0
    or v_roster_count > 0
    or v_assignment_count > 0;

  v_readiness_status := case
    when not v_schedule_expected then 'not_expected'
    when v_roster_count = 0 then 'missing_roster'
    when v_assignment_count = 0 then 'missing_assignments'
    when v_open_count > 0 then 'open_assignments'
    else 'ready'
  end;

  v_readiness_ok := (not v_schedule_expected)
    or (v_roster_count > 0 and v_assignment_count > 0 and v_open_count = 0);

  v_issue_free := jsonb_array_length(coalesce(v_detail->'assigned_while_absent', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'pto_without_absence_override', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'working_without_assignments', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'assigned_outside_active_roster', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_detail->'open_segments', '[]'::jsonb)) = 0;

  return v_detail || jsonb_build_object(
    'ok', v_readiness_ok and v_issue_free,
    'readiness_status', v_readiness_status,
    'schedule_expected', v_schedule_expected,
    'expected_template_count', v_expected_template_count,
    'readiness_ok', v_readiness_ok,
    'issue_free', v_issue_free,
    'readiness_issues', case
      when v_readiness_status = 'ready' or v_readiness_status = 'not_expected' then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object(
        'code', v_readiness_status,
        'message', format('Schedule readiness failed for %s: roster=%s assignments=%s open=%s', v_date, v_roster_count, v_assignment_count, v_open_count)
      ))
    end
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.sch_employee_my_schedule_page(p_service_date date, p_employee_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_base jsonb := '{}'::jsonb;
  v_all_items jsonb := '[]'::jsonb;
  v_current_items jsonb := '[]'::jsonb;
  v_employee_name text;
  v_employee_code text;
  v_shift_start time;
  v_shift_end time;
  v_roster_active boolean := false;
  v_local_time time;
  v_phase text;
  v_notice text;
  v_assignment_count integer := 0;
begin
  if p_service_date is null or p_employee_id is null then
    raise exception 'service_date and employee_id are required';
  end if;

  v_base := coalesce(
    public.sch_employee_my_schedule_phase_v1(p_service_date, p_employee_id, p_now),
    '{}'::jsonb
  );

  select e.display_name, e.employee_code
    into v_employee_name, v_employee_code
  from public.employees e
  where e.id = p_employee_id and e.active = true
  limit 1;

  if v_employee_name is null then
    raise exception 'Active employee not found';
  end if;

  select r.shift_start, r.shift_end, r.active
    into v_shift_start, v_shift_end, v_roster_active
  from public.daily_work_roster r
  where r.service_date = p_service_date
    and r.employee_id = p_employee_id
  order by r.active desc, r.updated_at desc
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', dsa.id,
      'service_date', dsa.service_date,
      'segment_number', dsa.segment_number,
      'location_group_id', dsa.location_group_id,
      'group_code', lg.group_code,
      'group_name', lg.group_name,
      'location_group_code', lg.group_code,
      'location_group_name', lg.group_name,
      'coverage_start', dsa.coverage_start,
      'coverage_end', dsa.coverage_end,
      'start_time', dsa.coverage_start,
      'end_time', dsa.coverage_end,
      'coverage_purpose', dsa.coverage_purpose,
      'purpose', dsa.coverage_purpose,
      'source_type', dsa.source_type,
      'owner_type', dsa.owner_type,
      'status', dsa.status,
      'load_points', dsa.load_points,
      'notes', dsa.notes
    )
    order by dsa.coverage_start, dsa.coverage_end, dsa.segment_number, lg.group_name
  ), '[]'::jsonb), count(*)::integer
    into v_all_items, v_assignment_count
  from public.daily_schedule_assignments dsa
  join public.location_groups lg on lg.id = dsa.location_group_id
  where dsa.service_date = p_service_date
    and dsa.assigned_employee_id = p_employee_id
    and dsa.status = 'ASSIGNED';

  v_current_items := case
    when jsonb_typeof(v_base->'items') = 'array' then v_base->'items'
    else '[]'::jsonb
  end;

  v_local_time := (p_now at time zone 'America/Chicago')::time;

  if coalesce(v_roster_active, false) = false then
    v_phase := 'off_day';
    v_notice := 'You are not scheduled to work today.';
  elsif v_assignment_count = 0 then
    v_phase := 'schedule_missing';
    v_notice := 'Your shift exists, but no work assignments were generated. Contact an Ops Manager.';
  elsif v_shift_start is not null and v_local_time < v_shift_start then
    v_phase := 'before_shift';
    v_notice := format('Your full schedule is below. Your shift begins at %s.', to_char(v_shift_start, 'FMHH12:MI AM'));
  elsif v_shift_end is not null and v_local_time >= v_shift_end then
    v_phase := 'after_shift';
    v_notice := 'Your shift is complete. Today''s full schedule remains below.';
    v_current_items := '[]'::jsonb;
  elsif jsonb_array_length(v_current_items) = 0 then
    v_phase := 'between_assignments';
    v_notice := 'You are between scheduled assignments. Your complete day remains below.';
  else
    v_phase := coalesce(nullif(v_base->>'phase', ''), 'current_assignment');
    v_notice := coalesce(nullif(v_base->>'notice', ''), 'Your complete day is shown below.');
  end if;

  return v_base || jsonb_build_object(
    'employee_id', p_employee_id,
    'employee_name', v_employee_name,
    'employee_code', v_employee_code,
    'service_date', p_service_date,
    'phase', v_phase,
    'notice', v_notice,
    'shift', case
      when v_shift_start is null or v_shift_end is null then null
      else jsonb_build_object(
        'start', to_char(v_shift_start, 'HH12:MI AM'),
        'end', case when v_shift_end = time '23:59:59' then 'Close' else to_char(v_shift_end, 'HH12:MI AM') end,
        'shift_start', v_shift_start,
        'shift_end', v_shift_end,
        'active', coalesce(v_roster_active, false)
      )
    end,
    'items', v_current_items,
    'all_items', v_all_items,
    'current_items', v_current_items,
    'assignment_count', v_assignment_count,
    'schedule_status', case
      when coalesce(v_roster_active, false) = false then 'off'
      when v_assignment_count = 0 then 'missing_assignments'
      when jsonb_array_length(v_current_items) = 0 then 'between_assignments'
      else 'scheduled'
    end,
    'contract_version', 'my_schedule.v3'
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.sch_get_current_owner(p_location_code text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(location_code text, location_name text, service_date date, group_code text, group_name text, owner_type text, assigned_employee_id uuid, assigned_employee_name text, coverage_start text, coverage_end text, status text, notes text)
 LANGUAGE sql
 STABLE
AS $function$
  with target_group as (
    select lg.id, lg.group_code, lg.group_name, l.location_code, l.location_name
    from public.locations l
    join public.location_group_memberships lgm on lgm.location_id = l.id and lgm.active = true
    join public.location_groups lg on lg.id = lgm.location_group_id and lg.active = true
    where upper(l.location_code) = upper(p_location_code)
    limit 1
  ),
  current_rows as (
    select *
    from public.sch_get_daily_schedule(public.sch_service_date(p_at)) s
    join target_group tg on tg.id = s.location_group_id
    where to_timestamp(to_char(public.sch_service_date(p_at), 'YYYY-MM-DD') || ' ' || s.coverage_start, 'YYYY-MM-DD HH12:MI AM') <= (p_at at time zone 'America/Chicago')
      and to_timestamp(to_char(public.sch_service_date(p_at), 'YYYY-MM-DD') || ' ' || s.coverage_end, 'YYYY-MM-DD HH12:MI AM') > (p_at at time zone 'America/Chicago')
    order by s.segment_number
    limit 1
  )
  select
    tg.location_code,
    tg.location_name,
    public.sch_service_date(p_at) as service_date,
    tg.group_code,
    tg.group_name,
    coalesce(cr.owner_type, 'OPEN') as owner_type,
    cr.assigned_employee_id,
    cr.assigned_employee_name,
    cr.coverage_start,
    cr.coverage_end,
    coalesce(cr.status, 'OPEN') as status,
    cr.notes
  from target_group tg
  left join current_rows cr on true;
$function$;

CREATE OR REPLACE FUNCTION public.sch_get_daily_schedule_with_purpose(p_service_date date)
 RETURNS TABLE(location_group_id uuid, group_code text, group_name text, included_locations text[], segment_id uuid, segment_number integer, owner_type text, assigned_employee_id uuid, assigned_employee_name text, coverage_start text, coverage_end text, status text, load_points numeric, coverage_purpose text, notes text, source_type text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select
    s.location_group_id,
    s.group_code,
    s.group_name,
    s.included_locations,
    s.segment_id,
    s.segment_number,
    s.owner_type,
    s.assigned_employee_id,
    s.assigned_employee_name,
    s.coverage_start,
    s.coverage_end,
    s.status,
    s.load_points,
    coalesce(
      dsa.coverage_purpose,
      ct.coverage_purpose,
      case
        when s.group_code in ('ELEPHANT_TRUNK_GIFT_SHOP','ELEPHANT_TRUNK_RESTROOMS','BAMBOO_GIFT_SHOP','NORTH_WEST_PASSAGE_GIFT_SHOP') then 'reminder'
        when s.assigned_employee_name = 'Michael McWright' then 'late_coverage'
        when s.coverage_start::time < time '09:45' then 'deep_clean'
        else 'area_owner'
      end
    ) as coverage_purpose,
    s.notes,
    coalesce(
      nullif(btrim(dsa.source_type), ''),
      case when ct.id is not null then 'coverage_template' else 'schedule' end
    ) as source_type
  from public.sch_get_daily_schedule(p_service_date) s
  left join public.daily_schedule_assignments dsa on dsa.id = s.segment_id
  left join public.coverage_templates ct on ct.id = s.segment_id;
$function$;

CREATE OR REPLACE FUNCTION public.sch_get_employee_work_status(p_service_date date, p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_employee record;
  v_absence record;
  v_override record;
  v_template record;
  v_shift_start time;
  v_shift_end time;
  v_shift_source text := null;
  v_shift_notes text := null;
  v_lunch_start time := null;
  v_lunch_end time := null;
  v_color_hex text := null;
  v_assignments jsonb := '[]'::jsonb;
  v_assignment_count integer := 0;
  v_weekday text;
  v_status text;
  v_reason text;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  if p_employee_id is null then
    raise exception 'p_employee_id is required';
  end if;

  select e.*
  into v_employee
  from public.employees e
  where e.id = p_employee_id;

  if v_employee.id is null then
    return jsonb_build_object(
      'ok', false,
      'work_status', 'unknown_employee',
      'reason', 'employee_id_not_found',
      'service_date', p_service_date
    );
  end if;

  v_weekday := trim(to_char(p_service_date, 'Day'));

  select dao.*
  into v_absence
  from public.daily_absence_overrides dao
  where dao.employee_id = p_employee_id
    and dao.absence_date = p_service_date
    and dao.active = true
  order by dao.updated_at desc nulls last
  limit 1;

  select eso.*
  into v_override
  from public.employee_shift_overrides eso
  where eso.employee_id = p_employee_id
    and eso.shift_date = p_service_date
  order by eso.updated_at desc nulls last
  limit 1;

  if v_override.id is not null and coalesce(v_override.active, true) = true then
    v_shift_start := v_override.shift_start;
    v_shift_end := v_override.shift_end;
    v_shift_source := 'override';
    v_shift_notes := v_override.notes;
    v_lunch_start := coalesce(v_override.lunch_start, public.sch_extract_lunch_start(v_override.notes));
    v_lunch_end := coalesce(v_override.lunch_end, public.sch_extract_lunch_end(v_override.notes));
    v_color_hex := coalesce(v_override.color_hex, public.sch_extract_color_hex(v_override.notes));
  elsif v_override.id is null then
    select est.*
    into v_template
    from public.employee_shift_templates est
    where est.employee_id = p_employee_id
      and est.active = true
      and est.day_of_week = extract(dow from p_service_date)::int
    order by est.shift_start
    limit 1;

    if v_template.id is not null then
      v_shift_start := v_template.shift_start;
      v_shift_end := v_template.shift_end;
      v_shift_source := 'template';
      v_shift_notes := v_template.notes;
      v_lunch_start := coalesce(v_template.lunch_start, public.sch_extract_lunch_start(v_template.notes));
      v_lunch_end := coalesce(v_template.lunch_end, public.sch_extract_lunch_end(v_template.notes));
      v_color_hex := coalesce(v_template.color_hex, public.sch_extract_color_hex(v_template.notes));
    end if;
  end if;

  select coalesce(jsonb_agg(row_to_json(x) order by x.group_name, x.segment_number), '[]'::jsonb), count(*)::int
  into v_assignments, v_assignment_count
  from (
    select
      location_group_id,
      group_code,
      group_name,
      segment_number,
      coverage_start,
      coverage_end,
      status,
      owner_type,
      load_points,
      source_type,
      notes
    from public.v_memphis_employee_schedule
    where service_date = p_service_date
      and employee_id = p_employee_id
    order by group_name, segment_number
  ) x;

  if coalesce(v_employee.active, false) = false then
    v_status := 'inactive_employee';
    v_reason := 'employee_inactive';
  elsif v_absence.id is not null then
    v_status := case v_absence.absence_type
      when 'pto' then 'off_pto'
      when 'sick' then 'off_sick'
      when 'callout' then 'off_callout'
      else 'off_absence_override'
    end;
    v_reason := v_absence.absence_type;
  elsif v_override.id is not null and coalesce(v_override.active, true) = false then
    v_status := 'off_shift_override';
    v_reason := 'inactive_shift_override';
  elsif v_shift_start is null then
    v_status := 'off_static';
    v_reason := 'no_static_shift_template';
  elsif v_assignment_count > 0 then
    v_status := 'working_assigned';
    v_reason := 'active_shift_with_assignments';
  else
    v_status := 'working_unassigned';
    v_reason := 'active_shift_without_assignments';
  end if;

  return jsonb_build_object(
    'ok', true,
    'employee_id', v_employee.id,
    'employee_name', v_employee.display_name,
    'employee_code', v_employee.employee_code,
    'employee_active', v_employee.active,
    'service_date', p_service_date,
    'weekday', v_weekday,
    'work_status', v_status,
    'reason', v_reason,
    'absence', case when v_absence.id is null then null else jsonb_build_object(
      'id', v_absence.id,
      'absence_type', v_absence.absence_type,
      'notes', v_absence.notes,
      'active', v_absence.active
    ) end,
    'shift', jsonb_build_object(
      'source', v_shift_source,
      'shift_start', case when v_shift_start is null then null else to_char(v_shift_start, 'HH24:MI:SS') end,
      'shift_end', case when v_shift_end is null then null else to_char(v_shift_end, 'HH24:MI:SS') end,
      'lunch_start', case when v_lunch_start is null then null else to_char(v_lunch_start, 'HH24:MI:SS') end,
      'lunch_end', case when v_lunch_end is null then null else to_char(v_lunch_end, 'HH24:MI:SS') end,
      'lunch', case when v_lunch_start is not null and v_lunch_end is not null then to_char(v_lunch_start, 'HH24:MI') || '-' || to_char(v_lunch_end, 'HH24:MI') else null end,
      'color_hex', v_color_hex,
      'notes', v_shift_notes
    ),
    'assignment_count', v_assignment_count,
    'assignments', v_assignments
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_guard_restricted_coverage_template()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  if public.sch_is_employee_location_group_restricted(new.assigned_employee_id, new.location_group_id, new.day_of_week) then
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.notes := trim(concat_ws(
      ' | ',
      nullif(new.notes, ''),
      'Opened by schedule safety guard: assigned employee is restricted from this location group.'
    ));
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_guard_restricted_daily_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_day integer;
  v_group_code text;
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  -- H23: Look up group_code and fail closed on NULL.
  select group_code into v_group_code
  from public.location_groups
  where id = new.location_group_id;

  if v_group_code is null then
    raise exception 'Unknown location_group_id %', new.location_group_id;
  end if;

  v_day := extract(dow from new.service_date)::integer;

  if public.sch_is_employee_location_group_restricted(new.assigned_employee_id, new.location_group_id, v_day) then
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.status := 'OPEN';
    new.notes := trim(concat_ws(
      ' | ',
      nullif(new.notes, ''),
      'Opened by schedule safety guard: assigned employee is restricted from this location group.'
    ));
    new.source_type := trim(both ':' from concat_ws(
      ':',
      nullif(new.source_type, ''),
      'restricted_guard'
    ));
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_guard_restricted_location_coverage_template()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_location_group_id uuid;
begin
  if new.assigned_employee_id is null then
    return new;
  end if;

  select lgm.location_group_id
    into v_location_group_id
  from public.location_group_memberships lgm
  join public.location_groups lg on lg.id = lgm.location_group_id and lg.active = true
  where lgm.location_id = new.location_id
    and lgm.active = true
  order by lg.group_code
  limit 1;

  if v_location_group_id is not null
     and public.sch_is_employee_location_group_restricted(new.assigned_employee_id, v_location_group_id, new.day_of_week) then
    new.assigned_employee_id := null;
    new.owner_type := 'OPEN';
    new.notes := trim(concat_ws(
      ' | ',
      nullif(new.notes, ''),
      'Opened by schedule safety guard: assigned employee is restricted from this location group.'
    ));
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_sync_shift_metadata_from_notes()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_templates integer := 0;
  v_overrides integer := 0;
begin
  update public.employee_shift_templates
     set lunch_start = coalesce(lunch_start, public.sch_extract_lunch_start(notes)),
         lunch_end = coalesce(lunch_end, public.sch_extract_lunch_end(notes)),
         color_hex = coalesce(color_hex, public.sch_extract_color_hex(notes)),
         updated_at = now()
   where notes is not null
     and (
       lunch_start is null
       or lunch_end is null
       or color_hex is null
     );
  get diagnostics v_templates = row_count;

  update public.employee_shift_overrides
     set lunch_start = coalesce(lunch_start, public.sch_extract_lunch_start(notes)),
         lunch_end = coalesce(lunch_end, public.sch_extract_lunch_end(notes)),
         color_hex = coalesce(color_hex, public.sch_extract_color_hex(notes)),
         updated_at = now()
   where notes is not null
     and (
       lunch_start is null
       or lunch_end is null
       or color_hex is null
     );
  get diagnostics v_overrides = row_count;

  return jsonb_build_object('ok', true, 'updated_templates', v_templates, 'updated_overrides', v_overrides);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_validate_alijah_herpetarium_rule(p_start_date date DEFAULT CURRENT_DATE, p_end_date date DEFAULT (CURRENT_DATE + 60))
 RETURNS TABLE(source_table text, service_date date, day_of_week integer, group_code text, group_name text, employee_name text, segment_number integer, coverage_start text, coverage_end text, notes text)
 LANGUAGE sql
 STABLE
AS $function$
  with alijah as (
    select id, display_name from public.employees where display_name = 'Alijah Collins' limit 1
  ), herp as (
    select id, group_code, group_name from public.location_groups where group_code = 'HERPETARIUM' limit 1
  ), date_window as (
    select coalesce(p_start_date, current_date) as start_date,
           coalesce(p_end_date, coalesce(p_start_date, current_date)) as end_date
  )
  select
    'coverage_templates'::text as source_table,
    null::date as service_date,
    ct.day_of_week,
    h.group_code,
    h.group_name,
    a.display_name as employee_name,
    ct.segment_number,
    to_char(ct.coverage_start, 'HH24:MI:SS') as coverage_start,
    to_char(ct.coverage_end, 'HH24:MI:SS') as coverage_end,
    ct.notes
  from public.coverage_templates ct
  cross join alijah a
  cross join herp h
  where ct.active = true
    and ct.assigned_employee_id = a.id
    and ct.location_group_id = h.id
    and public.sch_is_employee_location_group_restricted(ct.assigned_employee_id, ct.location_group_id, ct.day_of_week)

  union all

  select
    'daily_schedule_assignments'::text as source_table,
    dsa.service_date,
    extract(dow from dsa.service_date)::integer as day_of_week,
    h.group_code,
    h.group_name,
    a.display_name as employee_name,
    dsa.segment_number,
    to_char(dsa.coverage_start, 'HH24:MI:SS') as coverage_start,
    to_char(dsa.coverage_end, 'HH24:MI:SS') as coverage_end,
    dsa.notes
  from public.daily_schedule_assignments dsa
  cross join alijah a
  cross join herp h
  cross join date_window dw
  where dsa.service_date between dw.start_date and dw.end_date
    and dsa.assigned_employee_id = a.id
    and dsa.location_group_id = h.id
    and public.sch_is_employee_location_group_restricted(dsa.assigned_employee_id, dsa.location_group_id, extract(dow from dsa.service_date)::integer)

  union all

  select
    'location_coverage_templates'::text as source_table,
    null::date as service_date,
    lct.day_of_week,
    h.group_code,
    h.group_name,
    a.display_name as employee_name,
    lct.segment_number,
    to_char(lct.coverage_start, 'HH24:MI:SS') as coverage_start,
    to_char(lct.coverage_end, 'HH24:MI:SS') as coverage_end,
    lct.notes
  from public.location_coverage_templates lct
  join public.location_group_memberships lgm on lgm.location_id = lct.location_id and lgm.active = true
  cross join alijah a
  cross join herp h
  where lct.active = true
    and lct.assigned_employee_id = a.id
    and lgm.location_group_id = h.id
    and public.sch_is_employee_location_group_restricted(lct.assigned_employee_id, h.id, lct.day_of_week)
  order by source_table, day_of_week, coverage_start, segment_number;
$function$;

CREATE OR REPLACE FUNCTION public.start_session(p_location_code text, p_employee_name text, p_device_id text, p_client_session_id text DEFAULT NULL::text)
 RETURNS TABLE(session_uuid text, location_name text, employee_name text, device_id text, status text, started_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
declare
  v_location_id uuid;
  v_location_name text;
  v_employee_id uuid;
  v_employee_name text;
  v_device_pk uuid;
  v_session_id uuid;
  v_session_uuid text;
  v_started_at timestamptz := now();
  v_resolved_location_code text := public.resolve_scan_location_code(p_location_code);
begin
  if p_client_session_id is not null then
    select
      s.id,
      s.session_uuid,
      l.location_name,
      e.display_name,
      s.started_at
    into
      v_session_id,
      v_session_uuid,
      v_location_name,
      v_employee_name,
      v_started_at
    from public.sessions s
    join public.locations l on l.id = s.location_id
    join public.employees e on e.id = s.employee_id
    where s.client_session_id = p_client_session_id
    limit 1;

    if v_session_id is not null then
      return query
      select
        v_session_uuid,
        v_location_name,
        v_employee_name,
        p_device_id,
        'active'::text,
        v_started_at;
      return;
    end if;

    v_started_at := now();
  end if;

  select l.id, l.location_name
    into v_location_id, v_location_name
  from public.locations l
  where l.location_code = v_resolved_location_code
    and l.active = true
  limit 1;

  if v_location_id is null then
    raise exception 'Active location not found for code: %', p_location_code;
  end if;

  select e.id, e.display_name
    into v_employee_id, v_employee_name
  from public.employees e
  where e.display_name = p_employee_name
    and e.active = true
  limit 1;

  if v_employee_id is null then
    raise exception 'Active employee not found: %', p_employee_name;
  end if;

  select d.id
    into v_device_pk
  from public.devices d
  where d.device_id = p_device_id
    and d.active = true
  limit 1;

  if v_device_pk is null then
    raise exception 'Active device not found: %', p_device_id;
  end if;

  perform public.expire_stale_open_sessions(v_started_at);

  if exists (
    select 1 from public.sessions s
    where s.employee_id = v_employee_id
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Employee already has an open session: %', p_employee_name;
  end if;

  if exists (
    select 1 from public.sessions s
    where s.location_id = v_location_id
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Location already has an open session: %', coalesce(v_resolved_location_code, p_location_code);
  end if;

  if exists (
    select 1 from public.sessions s
    where s.device_id = v_device_pk
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Device already has an open session: %', p_device_id;
  end if;

  v_session_uuid := gen_random_uuid()::text;

  insert into public.sessions (
    session_uuid,
    client_session_id,
    location_id,
    employee_id,
    device_id,
    status,
    started_at,
    completion_source
  )
  values (
    v_session_uuid,
    p_client_session_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    'active',
    v_started_at,
    null
  )
  returning id into v_session_id;

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json
  )
  values (
    v_session_id,
    'session_started',
    'device',
    p_device_id,
    jsonb_build_object(
      'location_code', coalesce(v_resolved_location_code, p_location_code),
      'scan_input_code', p_location_code,
      'employee_name', p_employee_name,
      'device_id', p_device_id,
      'client_session_id', p_client_session_id
    )
  );

  insert into public.system_logs (
    level,
    source,
    message,
    session_id,
    location_id,
    device_id
  )
  values (
    'INFO',
    'start_session',
    'Session started',
    v_session_id,
    v_location_id,
    v_device_pk
  );

  return query
  select
    v_session_uuid,
    v_location_name,
    v_employee_name,
    p_device_id,
    'active'::text,
    v_started_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_session_v2(p_location_code text, p_device_id text, p_client_session_id text, p_client_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_location_id uuid;
  v_location_code text;
  v_location_name text;
  v_location_type text;
  v_form_type text;
  v_device_pk uuid;
  v_device_id text;
  v_device_name text;
  v_employee_id uuid;
  v_employee_name text;
  v_session_id uuid;
  v_session_uuid text;
  v_status text;
  v_started_at timestamptz;
  v_inserted boolean := false;
  v_client_id text := nullif(btrim(coalesce(p_client_session_id, '')), '');
begin
  if v_client_id is null or length(v_client_id) > 200 then
    raise exception 'client_session_id is required and must be at most 200 characters';
  end if;
  if nullif(btrim(coalesce(p_device_id, '')), '') is null then
    raise exception 'device_id is required';
  end if;
  if nullif(btrim(coalesce(p_location_code, '')), '') is null then
    raise exception 'location_code is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('scan-start:' || v_client_id, 0));

  select s.id, s.session_uuid, s.status, s.started_at,
         l.location_code, l.location_name, l.location_type, l.form_type,
         d.device_id, d.device_name,
         e.id, e.display_name
    into v_session_id, v_session_uuid, v_status, v_started_at,
         v_location_code, v_location_name, v_location_type, v_form_type,
         v_device_id, v_device_name,
         v_employee_id, v_employee_name
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  join public.employees e on e.id = s.employee_id
  where s.client_session_id = v_client_id
  limit 1;

  if v_session_id is not null then
    if upper(btrim(v_device_id)) <> upper(btrim(p_device_id)) then
      raise exception 'client_session_id is already bound to another device';
    end if;
    return jsonb_build_object(
      'session_uuid', v_session_uuid,
      'client_session_id', v_client_id,
      'location_code', v_location_code,
      'location_name', v_location_name,
      'location_type', v_location_type,
      'form_type', v_form_type,
      'employee_name', v_employee_name,
      'device_id', v_device_id,
      'device_name', v_device_name,
      'status', v_status,
      'started_at', v_started_at,
      'replayed', true,
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
    );
  end if;

  select l.id, l.location_code, l.location_name, l.location_type, l.form_type
    into v_location_id, v_location_code, v_location_name, v_location_type, v_form_type
  from public.locations l
  where l.location_code = public.resolve_scan_location_code(p_location_code)
    and l.active = true
  limit 1;
  if v_location_id is null then
    raise exception 'Active location not found for code: %', p_location_code;
  end if;

  select d.id, d.device_id, d.device_name, e.id, e.display_name
    into v_device_pk, v_device_id, v_device_name, v_employee_id, v_employee_name
  from public.devices d
  left join public.employees e on e.id = d.assigned_employee_id and e.active = true
  where upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    and d.active = true
  limit 1;
  if v_device_pk is null then
    raise exception 'Active device not found: %', p_device_id;
  end if;
  if v_employee_id is null then
    raise exception 'Device % is not assigned to an active employee', v_device_id;
  end if;

  perform public.expire_stale_open_sessions(now());

  if exists (
    select 1 from public.sessions s
    where s.device_id = v_device_pk
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Device already has another open session: %', v_device_id;
  end if;
  if exists (
    select 1 from public.sessions s
    where s.employee_id = v_employee_id
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Assigned employee already has another open session: %', v_employee_name;
  end if;
  if exists (
    select 1 from public.sessions s
    where s.location_id = v_location_id
      and s.status in ('active', 'pending_submit')
  ) then
    raise exception 'Location already has another open session: %', v_location_code;
  end if;

  v_started_at := coalesce(p_client_started_at, now());
  if v_started_at > now() + interval '10 minutes' then
    raise exception 'client_started_at is too far in the future';
  end if;
  if v_started_at < now() - interval '7 days' then
    raise exception 'client_started_at is too old';
  end if;

  v_session_uuid := gen_random_uuid()::text;
  insert into public.sessions(
    session_uuid,
    client_session_id,
    location_id,
    employee_id,
    device_id,
    status,
    started_at,
    completion_source
  ) values (
    v_session_uuid,
    v_client_id,
    v_location_id,
    v_employee_id,
    v_device_pk,
    'active',
    v_started_at,
    null
  ) returning id into v_session_id;
  v_inserted := true;

  insert into public.session_events(session_id, event_type, actor_type, actor_ref, details_json)
  values (
    v_session_id,
    'session_started',
    'device',
    v_device_id,
    jsonb_build_object(
      'location_code', v_location_code,
      'device_id', v_device_id,
      'employee_name', v_employee_name,
      'client_session_id', v_client_id,
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), ''),
      'identity_source', 'devices.assigned_employee_id'
    )
  );

  insert into public.system_logs(level, source, message, session_id, location_id, device_id)
  values ('INFO', 'start_session_v2', 'Server-authoritative session started', v_session_id, v_location_id, v_device_pk);

  return jsonb_build_object(
    'session_uuid', v_session_uuid,
    'client_session_id', v_client_id,
    'location_code', v_location_code,
    'location_name', v_location_name,
    'location_type', v_location_type,
    'form_type', v_form_type,
    'employee_name', v_employee_name,
    'device_id', v_device_id,
    'device_name', v_device_name,
    'status', 'active',
    'started_at', v_started_at,
    'replayed', not v_inserted,
    'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
  );
exception
  when unique_violation then
    select s.id, s.session_uuid, s.status, s.started_at,
           l.location_code, l.location_name, l.location_type, l.form_type,
           d.device_id, d.device_name,
           e.id, e.display_name
      into v_session_id, v_session_uuid, v_status, v_started_at,
           v_location_code, v_location_name, v_location_type, v_form_type,
           v_device_id, v_device_name,
           v_employee_id, v_employee_name
    from public.sessions s
    join public.locations l on l.id = s.location_id
    join public.devices d on d.id = s.device_id
    join public.employees e on e.id = s.employee_id
    where s.client_session_id = v_client_id
    limit 1;
    if v_session_id is null then raise; end if;
    return jsonb_build_object(
      'session_uuid', v_session_uuid,
      'client_session_id', v_client_id,
      'location_code', v_location_code,
      'location_name', v_location_name,
      'location_type', v_location_type,
      'form_type', v_form_type,
      'employee_name', v_employee_name,
      'device_id', v_device_id,
      'device_name', v_device_name,
      'status', v_status,
      'started_at', v_started_at,
      'replayed', true,
      'correlation_id', nullif(btrim(coalesce(p_correlation_id, '')), '')
    );
end
$function$;

CREATE OR REPLACE FUNCTION public.tool_admin_bundle(p_location_limit integer DEFAULT 100, p_activity_limit integer DEFAULT 50, p_ticket_limit integer DEFAULT 100, p_exception_limit integer DEFAULT 100, p_device_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'snapshot',
      coalesce(
        (
          select to_jsonb(s)
          from public.v_admin_health_snapshot s
          order by s.snapshot_at desc
          limit 1
        ),
        '{}'::jsonb
      ),
    'exceptions',
      coalesce(
        (
          select jsonb_agg(to_jsonb(x) order by x.event_at desc nulls last, x.location_name, x.summary)
          from (
            select *
            from public.v_exception_queue
            order by event_at desc nulls last, location_name, summary
            limit greatest(coalesce(p_exception_limit, 100), 0)
          ) x
        ),
        '[]'::jsonb
      ),
    'open_sessions',
      coalesce(public.tool_list_open_sessions(), '[]'::jsonb),
    'devices',
      coalesce(
        (
          select jsonb_agg(to_jsonb(d) order by d.sort_rank, d.device_name, d.device_id)
          from (
            select *,
              case health_status
                when 'offline' then 1
                when 'stale' then 2
                when 'never_seen' then 3
                when 'healthy' then 4
                else 9
              end as sort_rank
            from public.v_device_health
            order by sort_rank, device_name, device_id
            limit greatest(coalesce(p_device_limit, 100), 0)
          ) d
        ),
        '[]'::jsonb
      ),
    'tickets',
      coalesce(
        (
          select jsonb_agg(to_jsonb(t) order by t.date_submitted desc nulls last, t.created_at desc nulls last, t.location_code)
          from (
            select *
            from public.v_open_maintenance_tickets
            order by date_submitted desc nulls last, created_at desc nulls last, location_code
            limit greatest(coalesce(p_ticket_limit, 100), 0)
          ) t
        ),
        '[]'::jsonb
      ),
    'recent_activity',
      coalesce(
        (
          select jsonb_agg(to_jsonb(a) order by coalesce(a.submitted_at, a.ended_at, a.started_at) desc nulls last, a.location_code)
          from (
            select *
            from public.v_recent_scan_activity
            order by coalesce(submitted_at, ended_at, started_at) desc nulls last, location_code
            limit greatest(coalesce(p_activity_limit, 50), 0)
          ) a
        ),
        '[]'::jsonb
      ),
    'dashboard',
      coalesce(
        (
          select jsonb_agg(to_jsonb(ds) order by ds.sort_rank, ds.open_ticket_count desc, ds.location_name)
          from (
            select *,
              case status_color
                when 'red' then 1
                when 'yellow' then 2
                when 'blue' then 3
                when 'black' then 4
                when 'green' then 5
                else 9
              end as sort_rank
            from public.v_location_dashboard_status
            order by sort_rank, open_ticket_count desc, location_name
            limit greatest(coalesce(p_location_limit, 100), 0)
          ) ds
        ),
        '[]'::jsonb
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.tool_complete_session(p_session_uuid text, p_response_json jsonb DEFAULT '{}'::jsonb, p_submitted_by_employee_name text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_client_completion_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_session record;
  v_presented_device_pk uuid;
  v_row record;
begin
  select s.id, s.session_uuid, s.client_session_id, s.status,
         s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.completion_source, s.device_id as session_device_pk,
         l.location_name, l.location_code, l.location_type, l.form_type,
         e.display_name as employee_name, d.device_id
    into v_session
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.devices d on d.id = s.device_id
  where s.session_uuid = p_session_uuid or s.client_session_id = p_session_uuid
  order by case when s.session_uuid = p_session_uuid then 0 else 1 end
  limit 1;

  if v_session.session_uuid is null then
    raise exception 'Session not found for server or client identifier: %', p_session_uuid;
  end if;

  if nullif(btrim(coalesce(p_device_id,'')), '') is not null then
    select d.id into v_presented_device_pk
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active = true
    where da.active = true and upper(btrim(da.alias_identifier)) = upper(btrim(p_device_id))
    union all
    select d.id from public.devices d
    where d.active = true and upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    limit 1;
    if v_presented_device_pk is null or v_presented_device_pk <> v_session.session_device_pk then
      raise exception 'Session does not belong to device %', p_device_id;
    end if;
  end if;

  if v_session.status = 'cancelled' then
    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_session.client_session_id,
      'location_code', v_session.location_code,
      'location_name', v_session.location_name,
      'location_type', v_session.location_type,
      'form_type', v_session.form_type,
      'employee_name', v_session.employee_name,
      'device_id', v_session.device_id,
      'status', 'cancelled',
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'duration_minutes', v_session.duration_minutes,
      'duration_display', v_session.duration_display,
      'completion_source', v_session.completion_source,
      'replayed', true,
      'terminal', true,
      'discard_local_workflow', true,
      'reason', 'session_cancelled_without_authoritative_completion'
    );
  end if;

  if v_session.status = 'closed' and exists(
    select 1 from public.completion_responses cr where cr.session_id = v_session.id
  ) then
    return (
      select jsonb_build_object(
        'session_uuid', v_session.session_uuid,
        'client_session_id', v_session.client_session_id,
        'location_code', v_session.location_code,
        'location_name', v_session.location_name,
        'location_type', v_session.location_type,
        'form_type', v_session.form_type,
        'employee_name', v_session.employee_name,
        'device_id', v_session.device_id,
        'status', 'closed',
        'submitted_at', cr.submitted_at,
        'replayed', true
      )
      from public.completion_responses cr
      where cr.session_id = v_session.id
      limit 1
    );
  end if;

  select * into v_row
  from public.complete_session(
    v_session.session_uuid,
    p_response_json,
    p_submitted_by_employee_name,
    v_session.device_id,
    p_client_completion_id
  )
  limit 1;

  return jsonb_build_object(
    'session_uuid', v_row.session_uuid,
    'client_session_id', v_session.client_session_id,
    'location_code', v_session.location_code,
    'location_name', v_row.location_name,
    'location_type', v_session.location_type,
    'form_type', v_session.form_type,
    'employee_name', v_row.employee_name,
    'device_id', v_session.device_id,
    'status', v_row.status,
    'submitted_at', v_row.submitted_at,
    'replayed', false
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.tool_evaluate_location_proximity(p_location_code text, p_device_identifier text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric DEFAULT NULL::numeric, p_session_uuid text DEFAULT NULL::text, p_client_event_id text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.evaluate_location_proximity(
    p_location_code,
    p_device_identifier,
    p_latitude,
    p_longitude,
    p_accuracy_m,
    p_session_uuid,
    p_client_event_id,
    p_correlation_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.tool_finish_session(p_location_code text, p_device_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_resolved_code text := public.resolve_scan_location_code(p_location_code);
  v_device_pk uuid;
  v_canonical_device_id text;
  v_existing record;
  v_finished record;
begin
  select d.id, d.device_id
    into v_device_pk, v_canonical_device_id
  from public.device_aliases da
  join public.devices d on d.id = da.canonical_device_id and d.active = true
  where da.active = true
    and upper(btrim(da.alias_identifier)) = upper(btrim(p_device_id))
  union all
  select d.id, d.device_id
  from public.devices d
  where d.active = true
    and upper(btrim(d.device_id)) = upper(btrim(p_device_id))
  limit 1;

  if v_device_pk is null then
    raise exception 'Active device not found: %', p_device_id;
  end if;

  select s.session_uuid, s.client_session_id, l.location_name,
         e.display_name as employee_name, d.device_id, s.status,
         s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.completion_source, l.location_type, l.form_type
    into v_existing
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.devices d on d.id = s.device_id
  where s.device_id = v_device_pk
    and l.location_code = v_resolved_code
    and s.status in ('active','pending_submit','closed','cancelled')
  order by s.started_at desc
  limit 1;

  if v_existing.session_uuid is null then
    raise exception 'No session found for location % and device %', coalesce(v_resolved_code,p_location_code), v_canonical_device_id;
  end if;

  if v_existing.status = 'cancelled' then
    return jsonb_build_object(
      'session_uuid', v_existing.session_uuid,
      'client_session_id', v_existing.client_session_id,
      'location_name', v_existing.location_name,
      'employee_name', v_existing.employee_name,
      'device_id', v_existing.device_id,
      'status', 'cancelled',
      'started_at', v_existing.started_at,
      'ended_at', v_existing.ended_at,
      'duration_minutes', v_existing.duration_minutes,
      'duration_display', v_existing.duration_display,
      'completion_source', v_existing.completion_source,
      'location_type', v_existing.location_type,
      'form_type', v_existing.form_type,
      'replayed', true,
      'terminal', true,
      'discard_local_workflow', true,
      'reason', 'session_cancelled_without_authoritative_completion'
    );
  end if;

  if v_existing.status in ('pending_submit','closed') then
    return jsonb_build_object(
      'session_uuid', v_existing.session_uuid,
      'client_session_id', v_existing.client_session_id,
      'location_name', v_existing.location_name,
      'employee_name', v_existing.employee_name,
      'device_id', v_existing.device_id,
      'status', v_existing.status,
      'started_at', v_existing.started_at,
      'ended_at', v_existing.ended_at,
      'duration_minutes', v_existing.duration_minutes,
      'duration_display', v_existing.duration_display,
      'completion_source', v_existing.completion_source,
      'location_type', v_existing.location_type,
      'form_type', v_existing.form_type,
      'replayed', true
    );
  end if;

  select * into v_finished
  from public.finish_session(p_location_code, v_canonical_device_id)
  limit 1;

  return jsonb_build_object(
    'session_uuid', v_finished.session_uuid,
    'location_name', v_finished.location_name,
    'employee_name', v_finished.employee_name,
    'device_id', v_finished.device_id,
    'status', v_finished.status,
    'started_at', v_finished.started_at,
    'ended_at', v_finished.ended_at,
    'duration_minutes', v_finished.duration_minutes,
    'duration_display', v_finished.duration_display,
    'location_type', v_existing.location_type,
    'form_type', v_existing.form_type,
    'replayed', false
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.tool_get_location_scan_state(p_location_code text, p_device_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select coalesce(
    (
      select jsonb_build_object(
        'location_code', x.location_code,
        'location_name', x.location_name,
        'location_type', x.location_type,
        'form_type', coalesce(l.form_type, x.location_type),
        'location_active', x.location_active,
        'device_approved', x.device_approved,
        'assigned_device_employee_name', de.display_name,
        'assigned_device_name', d.device_name,
        'latest_session_uuid', x.latest_session_uuid,
        'latest_session_status', x.latest_session_status,
        'latest_employee_name', x.latest_employee_name,
        'latest_device_id', x.latest_device_id,
        'started_at', x.started_at,
        'ended_at', x.ended_at,
        'suggested_action', x.suggested_action
      )
      from public.get_location_scan_state(p_location_code, p_device_id) x
      left join public.locations l on l.location_code = x.location_code
      left join public.devices d
        on upper(btrim(d.device_id)) = upper(btrim(coalesce(p_device_id, '')))
       and d.active = true
      left join public.employees de on de.id = d.assigned_employee_id and de.active = true
      limit 1
    ),
    jsonb_build_object(
      'found', false,
      'message', 'No scan state found'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.tool_get_location_scan_state_v2(p_location_code text, p_device_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  with base as (
    select *
    from public.get_location_scan_state(p_location_code, p_device_id)
    limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'found', true,
        'location_code', b.location_code,
        'location_name', b.location_name,
        'location_type', b.location_type,
        'form_type', coalesce(l.form_type, b.location_type),
        'location_active', b.location_active,
        'device_approved', b.device_approved,
        'assigned_device_employee_name', de.display_name,
        'assigned_device_name', d.device_name,
        'latest_session_uuid', b.latest_session_uuid,
        'latest_client_session_id', s.client_session_id,
        'latest_session_status', b.latest_session_status,
        'latest_employee_name', b.latest_employee_name,
        'latest_device_id', b.latest_device_id,
        'started_at', b.started_at,
        'ended_at', b.ended_at,
        'duration_minutes', s.duration_minutes,
        'duration_display', s.duration_display,
        'completion_source', s.completion_source,
        'suggested_action', b.suggested_action
      )
      from base b
      left join public.locations l on l.location_code = b.location_code
      left join public.devices d
        on upper(btrim(d.device_id)) = upper(btrim(coalesce(p_device_id, '')))
       and d.active = true
      left join public.employees de on de.id = d.assigned_employee_id and de.active = true
      left join public.sessions s on s.session_uuid = b.latest_session_uuid
      limit 1
    ),
    jsonb_build_object(
      'found', false,
      'location_code', public.resolve_scan_location_code(p_location_code),
      'device_approved', public.is_approved_device(p_device_id),
      'message', 'No scan state found'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.tool_get_system_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'system_enabled', public.get_setting_bool('system_enabled', false),
    'use_approved_devices', public.get_setting_bool('use_approved_devices', false),
    'require_same_device_to_finish', public.get_setting_bool('require_same_device_to_finish', true),
    'block_employee_with_pending_submit', public.get_setting_bool('block_employee_with_pending_submit', true),
    'block_location_while_pending_submit', public.get_setting_bool('block_location_while_pending_submit', true),
    'minimum_duration_warning_minutes', public.get_setting_int('minimum_duration_warning_minutes', 1),
    'restroom_long_cleaning_minutes', public.get_setting_int('restroom_long_cleaning_minutes', 30),
    'exhibit_long_cleaning_minutes', public.get_setting_int('exhibit_long_cleaning_minutes', 45),
    'background_image_url', public.get_setting_text('background_image_url', null)
  );
$function$;

CREATE OR REPLACE FUNCTION public.tool_runtime_readiness()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'employees_count', (select count(*) from public.employees where active = true),
    'devices_count', (select count(*) from public.devices where active = true),
    'locations_count', (select count(*) from public.locations where active = true),
    'system_enabled', public.get_setting_bool('system_enabled', false),
    'use_approved_devices', public.get_setting_bool('use_approved_devices', false),
    'has_background_image', public.get_setting_text('background_image_url', null) is not null,
    'ready', (
      (select count(*) from public.employees where active = true) > 0
      and (select count(*) from public.devices where active = true) > 0
      and (select count(*) from public.locations where active = true) > 0
      and public.get_setting_bool('system_enabled', false) = true
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_assigned_area_tick(p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_local_now timestamp;
  v_local_date date;
  v_local_time time;
  v_minutes integer;
  v_slot integer;
  v_slot_start_at timestamptz;
  v_desired_type text;
  v_closed integer := 0;
  v_started integer := 0;
  v_details jsonb := '[]'::jsonb;
  v_wave_size integer := 3;
  r record;
  v_device_id uuid;
  v_device_identifier text;
  v_session_id uuid;
  v_session_key text;
  v_duration integer;
begin
  perform public.demo_scan_mock_preflight();

  select id into v_run_id
  from public.demo_scan_mock_runs
  where (p_run_id is null or id = p_run_id)
    and status = 'active'
  order by started_at desc
  limit 1;

  if v_run_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_demo_run');
  end if;

  v_local_now := timezone('America/Chicago', now());
  v_local_date := v_local_now::date;
  v_local_time := v_local_now::time;
  v_minutes := extract(hour from v_local_now)::int * 60 + extract(minute from v_local_now)::int;

  if v_minutes < 315 then
    return jsonb_build_object('ok', true, 'window', 'before_5_15am_central', 'started', 0, 'run_id', v_run_id::text);
  end if;

  if v_minutes >= 960 then
    v_closed := public.demo_scan_mock_complete_open_dynamic(v_run_id, true);
    return jsonb_build_object('ok', true, 'window', 'after_4pm_central', 'started', 0, 'closed_sessions', v_closed, 'run_id', v_run_id::text);
  end if;

  v_closed := public.demo_scan_mock_complete_open_dynamic(v_run_id, false);
  v_slot := floor((v_minutes - 315) / 20.0)::int;
  v_slot_start_at := (v_local_date::timestamp + time '05:15' + make_interval(mins => (v_slot * 20))) at time zone 'America/Chicago';
  v_desired_type := case when v_slot % 2 = 0 then 'exhibit' else 'restroom' end;

  if exists (
    select 1 from public.sessions
    where client_session_id like ('demo-scan:' || v_run_id::text || ':assigned-area:' || to_char(v_local_date, 'YYYYMMDD') || ':slot:' || v_slot::text || ':%')
  ) then
    return jsonb_build_object('ok', true, 'started', 0, 'reason', 'slot_already_started', 'slot', v_slot, 'closed_sessions', v_closed, 'run_id', v_run_id::text);
  end if;

  for r in
    with latest_completed as (
      select distinct on (s.location_id)
        s.location_id,
        coalesce(cr.submitted_at, s.ended_at, s.started_at) as completed_at
      from public.sessions s
      left join public.completion_responses cr on cr.session_id = s.id
      where s.status = 'closed'
        and coalesce(cr.submitted_at, s.ended_at, s.started_at) >= public.operational_day_start(now())
      order by s.location_id, coalesce(cr.submitted_at, s.ended_at, s.started_at) desc
    ), eligible as (
      select
        al.*,
        lc.completed_at,
        case
          when lc.completed_at is null then true
          when al.form_type = 'restroom' then now() >= lc.completed_at + interval '135 minutes'
          when al.form_type = 'exhibit' then now() >= lc.completed_at + interval '255 minutes'
          else false
        end as is_due
      from public.v_demo_scan_mock_today_assigned_locations al
      left join latest_completed lc on lc.location_id = al.location_id
      where al.service_date = v_local_date
        and al.coverage_start <= v_local_time
        and al.coverage_end > v_local_time
        and not exists (
          select 1 from public.sessions os
          where os.location_id = al.location_id
            and os.status in ('active', 'pending_submit')
        )
        and not exists (
          select 1 from public.sessions es
          where es.employee_id = al.employee_id
            and es.status in ('active', 'pending_submit')
        )
    ), employee_best as (
      select *
      from (
        select
          e.*,
          row_number() over (
            partition by e.employee_id
            order by
              case when e.form_type = v_desired_type then 0 else 1 end,
              case when e.is_due then 0 else 1 end,
              coalesce(e.completed_at, public.operational_day_start(now()) - interval '1 hour') asc,
              case e.coverage_purpose when 'area_owner' then 0 when 'deep_clean' then 1 when 'restroom_upkeep' then 2 else 4 end,
              e.sort_order,
              e.location_code
          ) as employee_pick_rank
        from eligible e
      ) x
      where employee_pick_rank = 1
    ), final_ranked as (
      select
        eb.*,
        row_number() over (
          order by
            case when eb.form_type = v_desired_type then 0 else 1 end,
            case when eb.is_due then 0 else 1 end,
            coalesce(eb.completed_at, public.operational_day_start(now()) - interval '1 hour') asc,
            case eb.coverage_purpose when 'area_owner' then 0 when 'deep_clean' then 1 when 'restroom_upkeep' then 2 else 4 end,
            eb.sort_order,
            eb.location_code
        ) as wave_rank
      from employee_best eb
    )
    select * from final_ranked
    where wave_rank <= v_wave_size
    order by wave_rank
  loop
    v_session_key := 'demo-scan:' || v_run_id::text || ':assigned-area:' || to_char(v_local_date, 'YYYYMMDD') || ':slot:' || v_slot::text || ':wave:' || r.wave_rank::text;

    select d.id, d.device_id
    into v_device_id, v_device_identifier
    from public.devices d
    where d.active = true
    order by case when d.assigned_employee_id = r.employee_id then 0 else 1 end, d.device_id
    limit 1;

    v_duration := public.demo_scan_mock_demo_duration_minutes(v_session_key || r.location_code);

    insert into public.sessions (
      session_uuid, location_id, employee_id, device_id, status, started_at, created_at, updated_at, client_session_id
    ) values (
      v_session_key, r.location_id, r.employee_id, v_device_id, 'active', v_slot_start_at, now(), now(), v_session_key
    ) returning id into v_session_id;

    insert into public.scan_events (
      scanned_at, location_id, location_code, device_id, device_identifier, session_id,
      event_type, result, notes, payload_json, created_at, client_event_id
    ) values (
      v_slot_start_at, r.location_id, r.location_code, v_device_id, v_device_identifier, v_session_id,
      'scan_start', 'demo_assigned_area_session_started', 'Demo assigned-area session started.',
      jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'mode', 'assigned_area_schedule', 'slot', v_slot, 'wave', r.wave_rank, 'wave_size', v_wave_size, 'group_name', r.group_name, 'coverage_purpose', r.coverage_purpose, 'location_type', r.form_type, 'duration_minutes', v_duration, 'work_start_central', '05:15', 'work_stop_central', '16:00'),
      v_slot_start_at,
      'demo-scan-event:' || v_run_id::text || ':assigned-area:session:' || v_session_id::text || ':start'
    );

    insert into public.session_events (
      session_id, event_type, actor_type, actor_ref, details_json, created_at
    ) values (
      v_session_id, 'demo_assigned_area_session_started', 'system', 'demo_scan_mock_assigned_area_tick',
      jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'mode', 'assigned_area_schedule', 'slot', v_slot, 'wave', r.wave_rank, 'location_code', r.location_code, 'employee_name', r.employee_name, 'duration_minutes', v_duration),
      v_slot_start_at
    );

    v_started := v_started + 1;
    v_details := v_details || jsonb_build_array(jsonb_build_object('wave', r.wave_rank, 'location_code', r.location_code, 'location_type', r.form_type, 'employee_name', r.employee_name, 'group_name', r.group_name, 'duration_minutes', v_duration));
  end loop;

  update public.demo_scan_mock_runs
  set
    cycle_number = greatest(cycle_number, v_slot),
    last_advanced_at = now(),
    updated_at = now(),
    metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object('mode', 'assigned_area_schedule', 'work_window_central', '05:15-16:00', 'sessions_per_slot', v_wave_size, 'last_slot', v_slot, 'last_started_count', v_started)
  where id = v_run_id;

  return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'slot', v_slot, 'started', v_started, 'desired_type', v_desired_type, 'closed_sessions', v_closed, 'sessions', v_details);
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_begin_cycle(p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_cycle integer;
  v_employee_count integer;
  v_inserted integer := 0;
begin
  perform public.demo_scan_mock_preflight();

  select r.cycle_number, r.employee_count
  into v_cycle, v_employee_count
  from public.demo_scan_mock_runs r
  where r.id = p_run_id
    and r.status = 'active';

  if not found then
    raise exception 'No active demo run found for %', p_run_id;
  end if;

  with loc_ranked as (
    select
      l.*,
      row_number() over (order by coalesce(l.sort_order, 999999), l.location_code) as rn,
      count(*) over () as total_count
    from public.locations l
    where l.active
  ), chosen_locations as (
    select *
    from loc_ranked
    order by (((rn - 1 - (v_cycle * greatest(v_employee_count, 1)))::integer % total_count::integer + total_count::integer) % total_count::integer), rn
    limit v_employee_count
  ), chosen_with_slot as (
    select row_number() over (order by coalesce(sort_order, 999999), location_code) as slot, *
    from chosen_locations
  ), chosen_employees as (
    select row_number() over (order by e.display_name, e.id) as slot, e.id as employee_id, e.display_name
    from public.employees e
    where e.active
    order by e.display_name, e.id
    limit v_employee_count
  ), employee_devices as (
    select
      ce.slot,
      ce.employee_id,
      ce.display_name,
      coalesce(ad.id, fd.id) as device_pk,
      coalesce(ad.device_id, fd.device_id) as device_identifier
    from chosen_employees ce
    left join lateral (
      select d.id, d.device_id
      from public.devices d
      where d.active and d.assigned_employee_id = ce.employee_id
      order by d.device_id
      limit 1
    ) ad on true
    left join lateral (
      select d.id, d.device_id
      from public.devices d
      where d.active
      order by d.device_id
      offset greatest(ce.slot::integer - 1, 0)
      limit 1
    ) fd on true
  ), ins as (
    insert into public.sessions (
      session_uuid,
      location_id,
      employee_id,
      device_id,
      status,
      started_at,
      completion_source,
      created_at,
      updated_at,
      client_session_id
    )
    select
      'demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':slot:' || c.slot::text,
      c.id,
      ed.employee_id,
      ed.device_pk,
      'active',
      now() - make_interval(mins => (((c.slot::integer * 2) % 11)::integer)),
      null,
      now(),
      now(),
      'demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':slot:' || c.slot::text
    from chosen_with_slot c
    join employee_devices ed on ed.slot = c.slot
    where ed.device_pk is not null
      and not exists (
        select 1 from public.sessions existing
        where existing.session_uuid = 'demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':slot:' || c.slot::text
      )
    returning id
  )
  select count(*) into v_inserted from ins;

  insert into public.scan_events (
    scanned_at,
    location_id,
    location_code,
    device_id,
    device_identifier,
    session_id,
    event_type,
    result,
    notes,
    payload_json,
    created_at,
    client_event_id
  )
  select
    s.started_at,
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_start',
    'demo_active_session_started',
    'Demo mock scan session started.',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'active_start'
    ),
    s.started_at,
    'demo-scan-event:' || p_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text || ':start'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || p_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text || ':start'
    );

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json,
    created_at
  )
  select
    s.id,
    'demo_session_started',
    'system',
    'demo_scan_mock',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'active_start',
      'demo_marker', 'cycle:' || v_cycle::text || ':session:' || s.id::text || ':started'
    ),
    s.started_at
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':cycle:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.session_events ev
      where ev.session_id = s.id
        and ev.details_json ->> 'demo_marker' = 'cycle:' || v_cycle::text || ':session:' || s.id::text || ':started'
    );

  update public.demo_scan_mock_runs
  set updated_at = now()
  where id = p_run_id;

  return v_inserted;
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_refresh_snapshot(p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_cycle integer;
  v_employee_count integer;
  v_inserted integer := 0;
begin
  perform public.demo_scan_mock_preflight();

  select r.cycle_number, r.employee_count
  into v_cycle, v_employee_count
  from public.demo_scan_mock_runs r
  where r.id = p_run_id
    and r.status = 'active';

  if not found then
    raise exception 'No active demo run found for %', p_run_id;
  end if;

  with available_employees as (
    select row_number() over (order by e.display_name, e.id) as slot, e.id as employee_id, e.display_name,
           count(*) over () as employee_total
    from public.employees e
    where e.active
  ), available_devices as (
    select row_number() over (order by d.device_id, d.id) as slot, d.id as device_pk, d.device_id,
           count(*) over () as device_total
    from public.devices d
    where d.active
  ), eligible_locations as (
    select
      l.*,
      row_number() over (order by coalesce(l.sort_order, 999999), l.location_code) as rn,
      row_number() over (partition by l.form_type order by coalesce(l.sort_order, 999999), l.location_code) as type_rn
    from public.locations l
    where l.active
      and not exists (
        select 1 from public.sessions os
        where os.location_id = l.id
          and os.status in ('active', 'pending_submit')
      )
  ), loc_plan as (
    select
      el.*,
      case
        when el.form_type = 'restroom' and el.type_rn = 1 then 'overdue_restroom'
        when el.form_type = 'restroom' and el.type_rn = 2 then 'due_soon_restroom'
        when el.form_type = 'exhibit' and el.type_rn = 1 then 'overdue_exhibit'
        when el.form_type = 'exhibit' and el.type_rn = 2 then 'due_soon_exhibit'
        else 'okay'
      end as demo_status_bucket,
      case
        when el.form_type = 'restroom' and el.type_rn = 1 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '130 minutes')
        when el.form_type = 'restroom' and el.type_rn = 2 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '100 minutes')
        when el.form_type = 'exhibit' and el.type_rn = 1 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '255 minutes')
        when el.form_type = 'exhibit' and el.type_rn = 2 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '205 minutes')
        else greatest(public.operational_day_start(now()) + interval '5 minutes', now() - make_interval(mins => (15 + ((el.rn::integer + v_cycle) % 35))::integer))
      end as completed_at
    from eligible_locations el
  ), loc_with_people as (
    select
      lp.*,
      ae.employee_id,
      ae.display_name as employee_name,
      ad.device_pk,
      ad.device_id as device_identifier
    from loc_plan lp
    join available_employees ae
      on ae.slot = (((lp.rn::integer - 1) % greatest(ae.employee_total::integer, 1)) + 1)
    join available_devices ad
      on ad.slot = (((lp.rn::integer - 1) % greatest(ad.device_total::integer, 1)) + 1)
  ), ins as (
    insert into public.sessions (
      session_uuid,
      location_id,
      employee_id,
      device_id,
      status,
      started_at,
      ended_at,
      duration_minutes,
      duration_display,
      completion_source,
      created_at,
      updated_at,
      client_session_id
    )
    select
      'demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':loc:' || lwp.location_code,
      lwp.id,
      lwp.employee_id,
      lwp.device_pk,
      'closed',
      lwp.completed_at - interval '18 minutes',
      lwp.completed_at,
      18,
      '18 min',
      'kiosk_form',
      lwp.completed_at - interval '18 minutes',
      now(),
      'demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':loc:' || lwp.location_code
    from loc_with_people lwp
    where not exists (
      select 1 from public.sessions existing
      where existing.session_uuid = 'demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':loc:' || lwp.location_code
    )
    returning id
  )
  select count(*) into v_inserted from ins;

  with available_employees as (
    select row_number() over (order by e.display_name, e.id) as slot, e.id as employee_id, e.display_name,
           count(*) over () as employee_total
    from public.employees e
    where e.active
  ), available_devices as (
    select row_number() over (order by d.device_id, d.id) as slot, d.id as device_pk, d.device_id,
           count(*) over () as device_total
    from public.devices d
    where d.active
  ), eligible_locations as (
    select
      l.*,
      row_number() over (order by coalesce(l.sort_order, 999999), l.location_code) as rn,
      row_number() over (partition by l.form_type order by coalesce(l.sort_order, 999999), l.location_code) as type_rn
    from public.locations l
    where l.active
      and not exists (
        select 1 from public.sessions os
        where os.location_id = l.id
          and os.status in ('active', 'pending_submit')
      )
  ), loc_plan as (
    select
      el.*,
      case
        when el.form_type = 'restroom' and el.type_rn = 1 then 'overdue_restroom'
        when el.form_type = 'restroom' and el.type_rn = 2 then 'due_soon_restroom'
        when el.form_type = 'exhibit' and el.type_rn = 1 then 'overdue_exhibit'
        when el.form_type = 'exhibit' and el.type_rn = 2 then 'due_soon_exhibit'
        else 'okay'
      end as demo_status_bucket,
      case
        when el.form_type = 'restroom' and el.type_rn = 1 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '130 minutes')
        when el.form_type = 'restroom' and el.type_rn = 2 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '100 minutes')
        when el.form_type = 'exhibit' and el.type_rn = 1 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '255 minutes')
        when el.form_type = 'exhibit' and el.type_rn = 2 then greatest(public.operational_day_start(now()) + interval '5 minutes', now() - interval '205 minutes')
        else greatest(public.operational_day_start(now()) + interval '5 minutes', now() - make_interval(mins => (15 + ((el.rn::integer + v_cycle) % 35))::integer))
      end as completed_at
    from eligible_locations el
  ), loc_with_people as (
    select
      lp.*,
      ae.employee_id,
      ae.display_name as employee_name,
      ad.device_pk,
      ad.device_id as device_identifier
    from loc_plan lp
    join available_employees ae
      on ae.slot = (((lp.rn::integer - 1) % greatest(ae.employee_total::integer, 1)) + 1)
    join available_devices ad
      on ad.slot = (((lp.rn::integer - 1) % greatest(ad.device_total::integer, 1)) + 1)
  ), demo_sessions as (
    select s.*, lwp.location_code, lwp.location_name, lwp.form_type, lwp.demo_status_bucket, lwp.employee_name, lwp.device_identifier
    from public.sessions s
    join loc_with_people lwp on lwp.id = s.location_id
    where s.client_session_id = 'demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':loc:' || lwp.location_code
  )
  insert into public.completion_responses (
    session_id,
    location_id,
    submitted_by_employee_id,
    device_id,
    response_json,
    submitted_at,
    created_at,
    client_completion_id
  )
  select
    ds.id,
    ds.location_id,
    ds.employee_id,
    ds.device_id,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'status_bucket', ds.demo_status_bucket,
      'services_performed', to_jsonb(array['trash_removed', 'surfaces_wiped', 'supplies_checked']::text[]),
      'notes', 'Demo completion seeded for dashboard status: ' || ds.demo_status_bucket,
      'cleaning_notes', 'Demo completion seeded for dashboard status: ' || ds.demo_status_bucket
    ),
    ds.ended_at,
    ds.ended_at,
    'demo-completion:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || ds.id::text
  from demo_sessions ds
  where not exists (
    select 1 from public.completion_responses cr
    where cr.session_id = ds.id
  );

  insert into public.scan_events (
    scanned_at,
    location_id,
    location_code,
    device_id,
    device_identifier,
    session_id,
    event_type,
    result,
    notes,
    payload_json,
    created_at,
    client_event_id
  )
  select
    s.started_at,
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_start',
    'demo_snapshot_started',
    'Demo snapshot cleaning started.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', p_run_id::text, 'cycle_number', v_cycle, 'phase', 'snapshot_start'),
    s.started_at,
    'demo-scan-event:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || s.id::text || ':start'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || s.id::text || ':start'
    );

  insert into public.scan_events (
    scanned_at,
    location_id,
    location_code,
    device_id,
    device_identifier,
    session_id,
    event_type,
    result,
    notes,
    payload_json,
    created_at,
    client_event_id
  )
  select
    s.ended_at,
    s.location_id,
    l.location_code,
    s.device_id,
    d.device_id,
    s.id,
    'scan_finish',
    'demo_snapshot_finished',
    'Demo snapshot cleaning completed.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', p_run_id::text, 'cycle_number', v_cycle, 'phase', 'snapshot_finish'),
    s.ended_at,
    'demo-scan-event:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || s.id::text || ':finish'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':session:' || s.id::text || ':finish'
    );

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json,
    created_at
  )
  select
    s.id,
    'demo_snapshot_completed',
    'system',
    'demo_scan_mock',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'snapshot_completed',
      'demo_marker', 'snapshot:' || v_cycle::text || ':session:' || s.id::text || ':completed'
    ),
    s.ended_at
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':%')
    and not exists (
      select 1 from public.session_events ev
      where ev.session_id = s.id
        and ev.details_json ->> 'demo_marker' = 'snapshot:' || v_cycle::text || ':session:' || s.id::text || ':completed'
    );

  insert into public.maintenance_tickets (
    completion_response_id,
    session_id,
    location_id,
    reported_by_employee_id,
    device_id,
    issue_source,
    status,
    issue_summary,
    issue_category,
    fixture_type,
    fixture_identifier,
    out_of_order,
    issue_payload,
    location_code_snapshot,
    location_name_snapshot,
    reporter_name_snapshot,
    reported_at,
    created_at
  )
  select
    cr.id,
    s.id,
    s.location_id,
    s.employee_id,
    s.device_id,
    'completion_form',
    'open',
    case when l.form_type = 'restroom' then 'Demo issue: low paper supply' else 'Demo issue: spot clean requested' end,
    case when l.form_type = 'restroom' then 'supplies' else 'cleanliness' end,
    case when l.form_type = 'restroom' then 'paper_towel_dispenser' else 'exhibit_area' end,
    case when l.form_type = 'restroom' then 'dispenser-' || l.location_code else 'zone-' || l.location_code end,
    false,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', p_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'snapshot_issue',
      'severity', 'low'
    ),
    l.location_code,
    l.location_name,
    e.display_name,
    s.ended_at,
    s.ended_at
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.completion_responses cr on cr.session_id = s.id
  where s.client_session_id like ('demo-scan:' || p_run_id::text || ':snapshot:' || v_cycle::text || ':%')
    and (
      l.location_code in (
        select location_code
        from public.locations
        where active
        order by coalesce(sort_order, 999999), location_code
        offset ((v_cycle * 3) % greatest((select count(*) from public.locations where active), 1))
        limit 1
      )
      or l.location_code in (
        select location_code
        from public.locations
        where active and form_type = 'exhibit'
        order by coalesce(sort_order, 999999), location_code
        offset (v_cycle % greatest((select count(*) from public.locations where active and form_type = 'exhibit'), 1))
        limit 1
      )
    )
    and not exists (
      select 1 from public.maintenance_tickets mt
      where mt.session_id = s.id
        and mt.issue_payload ->> 'demo_mock' = 'true'
    );

  update public.demo_scan_mock_runs
  set updated_at = now()
  where id = p_run_id;

  return v_inserted;
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_shift_tick(p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_employee_count integer;
  v_local_now timestamp;
  v_local_date date;
  v_minutes integer;
  v_slot integer;
  v_slot_start_local timestamp;
  v_slot_start_at timestamptz;
  v_location_id uuid;
  v_location_code text;
  v_location_type text;
  v_employee_id uuid;
  v_device_id uuid;
  v_device_identifier text;
  v_session_id uuid;
  v_session_key text;
  v_closed integer := 0;
begin
  perform public.demo_scan_mock_preflight();

  select r.id, r.employee_count
  into v_run_id, v_employee_count
  from public.demo_scan_mock_runs r
  where (p_run_id is null or r.id = p_run_id)
    and r.status = 'active'
  order by r.started_at desc
  limit 1;

  if v_run_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_demo_run');
  end if;

  v_local_now := timezone('America/Chicago', now());
  v_local_date := v_local_now::date;
  v_minutes := extract(hour from v_local_now)::integer * 60 + extract(minute from v_local_now)::integer;

  if v_minutes < 420 then
    return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'window', 'before_7am_central', 'started', false);
  end if;

  if v_minutes >= 960 then
    v_closed := public.demo_scan_mock_complete_open_sessions(v_run_id, true, 35);
    return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'window', 'after_4pm_central', 'started', false, 'closed_sessions', v_closed);
  end if;

  v_closed := public.demo_scan_mock_complete_open_sessions(v_run_id, false, 35);

  v_slot := floor((v_minutes - 420) / 20.0)::integer;
  v_slot_start_local := v_local_date::timestamp + time '07:00' + make_interval(mins => (v_slot * 20));
  v_slot_start_at := v_slot_start_local at time zone 'America/Chicago';
  v_session_key := 'demo-scan:' || v_run_id::text || ':shift:' || to_char(v_local_date, 'YYYYMMDD') || ':slot:' || v_slot::text;

  if exists (select 1 from public.sessions where client_session_id = v_session_key) then
    return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'slot', v_slot, 'started', false, 'reason', 'slot_already_started', 'closed_sessions', v_closed);
  end if;

  with latest_completed as (
    select distinct on (s.location_id)
      s.location_id,
      coalesce(cr.submitted_at, s.ended_at, s.started_at) as completed_at
    from public.sessions s
    left join public.completion_responses cr on cr.session_id = s.id
    where s.status = 'closed'
      and coalesce(cr.submitted_at, s.ended_at, s.started_at) >= public.operational_day_start(now())
    order by s.location_id, coalesce(cr.submitted_at, s.ended_at, s.started_at) desc
  ), candidates as (
    select
      l.id,
      l.location_code,
      l.form_type,
      coalesce(l.sort_order, 999999) as sort_order,
      lc.completed_at,
      case when l.form_type = 'restroom' then interval '135 minutes' else interval '255 minutes' end as service_interval,
      case when lc.completed_at is null then true else now() >= lc.completed_at + case when l.form_type = 'restroom' then interval '135 minutes' else interval '255 minutes' end end as is_due
    from public.locations l
    left join latest_completed lc on lc.location_id = l.id
    where l.active = true
      and l.form_type in ('restroom', 'exhibit')
      and not exists (
        select 1 from public.sessions os
        where os.location_id = l.id
          and os.status in ('active', 'pending_submit')
      )
  )
  select id, location_code, form_type
  into v_location_id, v_location_code, v_location_type
  from candidates
  order by
    case when is_due then 0 else 1 end,
    coalesce(completed_at, public.operational_day_start(now()) - interval '1 hour') asc,
    sort_order,
    location_code
  limit 1;

  if v_location_id is null then
    return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'slot', v_slot, 'started', false, 'reason', 'no_available_location', 'closed_sessions', v_closed);
  end if;

  with emp as (
    select id, row_number() over (order by display_name, id) - 1 as rn, count(*) over () as total
    from public.employees
    where active = true
  )
  select id into v_employee_id
  from emp
  where rn = (v_slot % total)
  limit 1;

  select d.id, d.device_id
  into v_device_id, v_device_identifier
  from public.devices d
  where d.active = true
  order by case when d.assigned_employee_id = v_employee_id then 0 else 1 end, d.device_id
  limit 1;

  insert into public.sessions (
    session_uuid,
    location_id,
    employee_id,
    device_id,
    status,
    started_at,
    created_at,
    updated_at,
    client_session_id
  ) values (
    v_session_key,
    v_location_id,
    v_employee_id,
    v_device_id,
    'active',
    v_slot_start_at,
    now(),
    now(),
    v_session_key
  )
  returning id into v_session_id;

  insert into public.scan_events (
    scanned_at,
    location_id,
    location_code,
    device_id,
    device_identifier,
    session_id,
    event_type,
    result,
    notes,
    payload_json,
    created_at,
    client_event_id
  ) values (
    v_slot_start_at,
    v_location_id,
    v_location_code,
    v_device_id,
    v_device_identifier,
    v_session_id,
    'scan_start',
    'demo_shift_session_started',
    'Demo shift-schedule session started. Restrooms use 135-minute cadence; exhibits use 255-minute cadence; starts are staggered by 20 minutes.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'mode', 'shift_schedule', 'slot', v_slot, 'location_type', v_location_type),
    v_slot_start_at,
    'demo-scan-event:' || v_run_id::text || ':shift:session:' || v_session_id::text || ':start'
  );

  insert into public.session_events (
    session_id,
    event_type,
    actor_type,
    actor_ref,
    details_json,
    created_at
  ) values (
    v_session_id,
    'demo_shift_session_started',
    'system',
    'demo_scan_mock_shift_tick',
    jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'mode', 'shift_schedule', 'slot', v_slot),
    v_slot_start_at
  );

  update public.demo_scan_mock_runs
  set
    cycle_number = greatest(cycle_number, v_slot),
    last_advanced_at = now(),
    updated_at = now(),
    metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
      'mode', 'shift_schedule',
      'restroom_interval_minutes', 135,
      'exhibit_interval_minutes', 255,
      'stagger_minutes', 20,
      'work_window_central', '07:00-16:00',
      'last_slot', v_slot,
      'last_location_code', v_location_code
    )
  where id = v_run_id;

  return jsonb_build_object('ok', true, 'run_id', v_run_id::text, 'slot', v_slot, 'started', true, 'location_code', v_location_code, 'location_type', v_location_type, 'closed_sessions', v_closed);
end $function$;

CREATE OR REPLACE FUNCTION public.mz_apply_free_tier_retention(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_local_today date := (p_now at time zone 'America/Chicago')::date;
  v_scan_days integer := public.mz_retention_setting_int('retention_scan_history_days', 120, 14, 3650);
  v_system_logs_days integer := public.mz_retention_setting_int('retention_system_logs_days', 30, 7, 3650);
  v_schedule_past_days integer := public.mz_retention_setting_int('retention_schedule_past_days', 45, 7, 3650);
  v_schedule_future_days integer := public.mz_retention_setting_int('retention_schedule_future_days', 45, 7, 3650);
  v_event_notification_days integer := public.mz_retention_setting_int('retention_event_notification_days', 45, 7, 3650);
  v_guest_resolved_days integer := public.mz_retention_setting_int('retention_guest_resolved_days', 180, 30, 3650);
  v_feedback_resolved_days integer := public.mz_retention_setting_int('retention_feedback_resolved_days', 180, 30, 3650);
  v_maintenance_closed_days integer := public.mz_retention_setting_int('retention_maintenance_closed_days', 180, 30, 3650);
  v_migration_sql_days integer := public.mz_retention_setting_int('retention_migration_sql_text_days', 7, 1, 3650);
  v_migration_log_days integer := public.mz_retention_setting_int('retention_migration_log_days', 30, 7, 3650);
  v_migration_batch integer := public.mz_retention_setting_int('retention_migration_batch_rows', 50000, 100, 50000);
  v_batch_limit integer := 5000;
  v_expired_sessions integer := 0;
  v_scan_purge jsonb := '{}'::jsonb;
  v_msg_old jsonb := '{}'::jsonb;
  v_msg_deleted integer := 0;
  v_msg_hidden jsonb := '{}'::jsonb;
  v_events_deleted integer := 0;
  v_event_notifications_deleted integer := 0;
  v_guest_reports_deleted integer := 0;
  v_feedback_deleted integer := 0;
  v_maintenance_deleted integer := 0;
  v_system_logs_deleted integer := 0;
  v_schedule_assignments_deleted integer := 0;
  v_daily_group_assignments_deleted integer := 0;
  v_roster_deleted integer := 0;
  v_migration_sql_redacted integer := 0;
  v_migration_rows_deleted integer := 0;
  v_report jsonb := '{}'::jsonb;
begin
  -- Prevent overlapping cron/manual runs.
  perform pg_advisory_xact_lock(hashtext('memphis_zoo_free_tier_retention'));

  select public.expire_stale_open_sessions(p_now) into v_expired_sessions;
  select public.purge_closed_scan_history_before(p_now - make_interval(days => v_scan_days), 'free_tier_retention') into v_scan_purge;
  select public.msg_purge_messages_older_than_14_days() into v_msg_old;
  select public.msg_cleanup_deleted_messages() into v_msg_deleted;
  select public.msg_purge_fully_hidden_threads() into v_msg_hidden;

  -- C14: Delete events FIRST, then delete orphaned notification logs.
  -- This fixes the dependency order: events must be deleted before
  -- notification logs that reference them.
  with deleted as (
    delete from public.events_app_events e
    where e.event_date < v_local_today
      and e.id in (
        select e2.id from public.events_app_events e2
        where e2.event_date < v_local_today
        order by e2.event_date asc
        limit v_batch_limit
      )
    returning 1
  ) select count(*)::integer into v_events_deleted from deleted;

  -- Now delete orphaned notification logs (event_id no longer exists) and
  -- old notification logs by age.
  with deleted as (
    delete from public.events_app_notification_log n
    where n.id in (
      select n2.id from public.events_app_notification_log n2
      where coalesce(n2.updated_at, n2.created_at) < p_now - make_interval(days => v_event_notification_days)
         or not exists (select 1 from public.events_app_events e where e.id = n2.event_id)
      order by coalesce(n2.updated_at, n2.created_at) asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_event_notifications_deleted from deleted;

  -- System logs — batch capped.
  with deleted as (
    delete from public.system_logs sl
    where sl.ctid in (
      select sl2.ctid from public.system_logs sl2
      where sl2.created_at < p_now - make_interval(days => v_system_logs_days)
      order by sl2.created_at asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_system_logs_deleted from deleted;

  -- Daily schedule assignments — batch capped.
  with deleted as (
    delete from public.daily_schedule_assignments dsa
    where dsa.ctid in (
      select dsa2.ctid from public.daily_schedule_assignments dsa2
      where dsa2.service_date <> date '1900-01-01'
        and (dsa2.service_date < v_local_today - v_schedule_past_days
             or dsa2.service_date > v_local_today + v_schedule_future_days)
      order by dsa2.service_date asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_schedule_assignments_deleted from deleted;

  -- Daily group assignments — batch capped.
  with deleted as (
    delete from public.daily_group_assignments dga
    where dga.ctid in (
      select dga2.ctid from public.daily_group_assignments dga2
      where dga2.assignment_date <> date '1900-01-01'
        and (dga2.assignment_date < v_local_today - v_schedule_past_days
             or dga2.assignment_date > v_local_today + v_schedule_future_days)
      order by dga2.assignment_date asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_daily_group_assignments_deleted from deleted;

  -- Daily work roster — batch capped.
  with deleted as (
    delete from public.daily_work_roster dwr
    where dwr.ctid in (
      select dwr2.ctid from public.daily_work_roster dwr2
      where dwr2.service_date <> date '1900-01-01'
        and (dwr2.service_date < v_local_today - v_schedule_past_days
             or dwr2.service_date > v_local_today + v_schedule_future_days)
      order by dwr2.service_date asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_roster_deleted from deleted;

  -- Guest cleanliness reports — batch capped.
  with deleted as (
    delete from public.guest_cleanliness_reports gr
    where gr.ctid in (
      select gr2.ctid from public.guest_cleanliness_reports gr2
      where lower(coalesce(gr2.status, 'open')) in ('closed', 'resolved', 'acknowledged')
        and coalesce(gr2.resolved_at, gr2.submitted_at) < p_now - make_interval(days => v_guest_resolved_days)
      order by coalesce(gr2.resolved_at, gr2.submitted_at) asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_guest_reports_deleted from deleted;

  -- System feedback items — batch capped.
  with deleted as (
    delete from public.system_feedback_items fi
    where fi.ctid in (
      select fi2.ctid from public.system_feedback_items fi2
      where lower(coalesce(fi2.status, 'open')) in ('closed', 'resolved', 'acknowledged', 'done')
        and coalesce(fi2.acknowledged_at, fi2.updated_at, fi2.created_at) < p_now - make_interval(days => v_feedback_resolved_days)
      order by coalesce(fi2.acknowledged_at, fi2.updated_at, fi2.created_at) asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_feedback_deleted from deleted;

  -- Maintenance tickets — batch capped.
  with deleted as (
    delete from public.maintenance_tickets mt
    where mt.ctid in (
      select mt2.ctid from public.maintenance_tickets mt2
      where lower(coalesce(mt2.status, 'open')) in ('closed', 'resolved')
        and coalesce(mt2.closed_at, mt2.reported_at, mt2.created_at) < p_now - make_interval(days => v_maintenance_closed_days)
      order by coalesce(mt2.closed_at, mt2.reported_at, mt2.created_at) asc
      limit v_batch_limit
    )
    returning 1
  ) select count(*)::integer into v_maintenance_deleted from deleted;

  -- Migration log SQL text redaction — already batch capped.
  with target as (
    select ctid
    from public.migration_log
    where applied_at < p_now - make_interval(days => v_migration_sql_days)
      and sql_text is not null
      and sql_text <> '[retention-discarded SQL text; migration metadata retained]'
    order by applied_at asc
    limit least(v_migration_batch, v_batch_limit)
  ), updated as (
    update public.migration_log ml
    set sql_text = '[retention-discarded SQL text; migration metadata retained]'
    from target
    where ml.ctid = target.ctid
    returning 1
  ) select count(*)::integer into v_migration_sql_redacted from updated;

  -- Migration log row deletion — already batch capped.
  with target as (
    select ctid
    from public.migration_log
    where applied_at < p_now - make_interval(days => v_migration_log_days)
    order by applied_at asc
    limit least(v_migration_batch, v_batch_limit)
  ), deleted as (
    delete from public.migration_log ml
    using target
    where ml.ctid = target.ctid
    returning 1
  ) select count(*)::integer into v_migration_rows_deleted from deleted;

  select public.mz_free_tier_retention_report() into v_report;

  return jsonb_build_object(
    'ok', true,
    'ran_at', p_now,
    'local_today', v_local_today,
    'expired_stale_sessions', v_expired_sessions,
    'scan_history', v_scan_purge,
    'messaging_14_day_purge', v_msg_old,
    'messaging_deleted_cleanup', v_msg_deleted,
    'messaging_hidden_thread_purge', v_msg_hidden,
    'deleted_events', v_events_deleted,
    'deleted_event_notifications', v_event_notifications_deleted,
    'deleted_standalone_system_logs', v_system_logs_deleted,
    'deleted_schedule_assignments', v_schedule_assignments_deleted,
    'deleted_daily_group_assignments', v_daily_group_assignments_deleted,
    'deleted_work_roster_rows', v_roster_deleted,
    'deleted_resolved_guest_reports', v_guest_reports_deleted,
    'deleted_resolved_feedback', v_feedback_deleted,
    'deleted_closed_maintenance_tickets', v_maintenance_deleted,
    'redacted_migration_sql_rows', v_migration_sql_redacted,
    'deleted_migration_log_rows', v_migration_rows_deleted,
    'post_run_report', v_report
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch2_generate_preview(p_service_date date, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_input_hash text;
  v_existing_run_id uuid;
  v_audit jsonb;
  v_diff jsonb;
  v_work_item_count integer := 0;
  v_candidate_count integer := 0;
  v_solution_count integer := 0;
  v_item record;
  v_choice record;
  v_target_required_load numeric := 0;
  v_target_required_location_count numeric := 0;
  v_final_employee_id uuid;
  v_final_total_score numeric := 0;
  v_final_proximity_score numeric := 0;
  v_final_route_fit_score numeric := 0;
  v_final_workload_score numeric := 0;
  v_final_hard_reject_reasons text[] := array[]::text[];
  v_final_current_solution_load numeric := 0;
  v_final_required_location_count integer := 0;
  v_final_target_load_gap_after numeric := 0;
  v_final_balanced_rank integer := null;
  v_assignment_reason text;
begin
  v_input_hash := public.sch2_input_hash(p_service_date);

  if not coalesce(p_force, false) then
    select id into v_existing_run_id
    from public.schedule_generation_runs
    where service_date = p_service_date
      and input_hash = v_input_hash
      and status in ('preview_ready', 'preview_blocked')
    order by created_at desc
    limit 1;

    if v_existing_run_id is not null then
      v_audit := public.sch2_audit_solution(v_existing_run_id);
      v_diff := public.sch2_compare_current_vs_preview(v_existing_run_id);
      return jsonb_build_object(
        'ok', true,
        'reused', true,
        'run_id', v_existing_run_id,
        'service_date', p_service_date,
        'audit', v_audit,
        'diff', v_diff
      );
    end if;
  end if;

  v_run_id := public.sch2_build_work_items(p_service_date);

  select count(*)::integer into v_work_item_count
  from public.schedule_work_items
  where run_id = v_run_id;

  if v_work_item_count = 0 then
    update public.schedule_generation_runs
       set status = 'preview_error',
           error_message = 'SCH2 preview cannot continue: zero work items were generated',
           updated_at = now()
     where id = v_run_id;
    raise exception 'SCH2 preview cannot continue: zero work items were generated for %', p_service_date;
  end if;

  update public.schedule_generation_runs
     set force = coalesce(p_force, false), status = 'scoring_candidates', updated_at = now()
   where id = v_run_id;

  with roster as (
    select
      r.employee_id,
      e.display_name as employee_name,
      e.employee_code,
      r.shift_start,
      r.shift_end
    from public.daily_work_roster r
    join public.employees e on e.id = r.employee_id and e.active = true
    left join public.daily_absence_overrides dao
      on dao.absence_date = r.service_date
     and dao.employee_id = r.employee_id
     and dao.active = true
    where r.service_date = p_service_date
      and r.active = true
      and dao.id is null
  ), base as materialized (
    select
      wi.id as work_item_id,
      wi.run_id,
      r.employee_id,
      r.employee_name,
      r.employee_code,
      wi.location_group_id,
      wi.coverage_start,
      wi.coverage_end,
      wi.coverage_purpose,
      wi.original_assigned_employee_id,
      wi.required,
      0::numeric as assigned_load_points,
      0::numeric as assigned_segments,
      public.sch_is_employee_location_group_restricted(r.employee_id, wi.location_group_id, extract(dow from p_service_date)::integer) as is_restricted,
      (r.shift_start < wi.coverage_end and r.shift_end > wi.coverage_start) as shift_overlaps,
      lw.lunch_start,
      lw.lunch_end,
      coalesce(public.sch_employee_route_fit_score(r.employee_id, extract(dow from p_service_date)::integer, wi.location_group_id, wi.coverage_purpose), 0)::numeric as route_penalty
    from public.schedule_work_items wi
    cross join roster r
    left join lateral public.sch_lunch_window_for_employee(p_service_date, r.employee_id) lw on true
    where wi.run_id = v_run_id
  ), scored as materialized (
    select
      b.*,
      array_remove(array[
        case when b.is_restricted then 'restricted' end,
        case when not b.shift_overlaps then 'shift_no_overlap' end,
        case when b.employee_code = 'EMP002' and not (
b.coverage_start >= time '09:45'
          and b.coverage_start < time '18:00'
          and b.coverage_purpose in ('restroom_upkeep', 'late_coverage')
        ) then 'Michael_EMP002_opening_or_non_restroom' end,
        case when b.coverage_purpose = 'lunch_coverage'
              and b.lunch_start is not null
              and b.lunch_end is not null
              and b.lunch_start < b.coverage_end
              and b.lunch_end > b.coverage_start then 'same_lunch_overlap' end
      ]::text[], null) as hard_reject_reasons,
      greatest(0, 100 - coalesce(b.route_penalty, 0))::numeric as route_fit_score,
      greatest(0, 100 - (coalesce(b.assigned_load_points, 0) * 8) - (coalesce(b.assigned_segments, 0) * 4))::numeric as workload_score,
      greatest(0, 100 - coalesce(b.route_penalty, 0))::numeric as proximity_score
    from base b
  )
  insert into public.schedule_candidate_scores (
    run_id,
    work_item_id,
    employee_id,
    eligible,
    hard_reject_reasons,
    proximity_score,
    route_fit_score,
    workload_score,
    total_score,
    explanation
  )
  select
    s.run_id,
    s.work_item_id,
    s.employee_id,
    cardinality(s.hard_reject_reasons) = 0,
    s.hard_reject_reasons,
    round(s.proximity_score, 2),
    round(s.route_fit_score, 2),
    round(s.workload_score, 2),
    round(((s.route_fit_score * 0.75) + (s.workload_score * 0.25))::numeric, 2),
    concat_ws('; ',
      'route_fit=' || round(s.route_fit_score, 2)::text,
      'workload=' || round(s.workload_score, 2)::text,
      'current_load=' || s.assigned_load_points::text,
      case when cardinality(s.hard_reject_reasons) > 0 then 'reject=' || array_to_string(s.hard_reject_reasons, ',') else 'eligible' end
    )
  from scored s;

  get diagnostics v_candidate_count = row_count;

  -- H26: Zero-candidate guard.
  if v_candidate_count = 0 then
    update public.schedule_generation_runs
       set status = 'preview_error',
           error_message = format('SCH2 preview produced zero candidate scores for %s work items', v_work_item_count),
           updated_at = now()
     where id = v_run_id;
    raise exception 'SCH2 preview produced zero candidate scores for % work items on %', v_work_item_count, p_service_date;
  end if;

  update public.schedule_generation_runs
     set status = 'building_solution', updated_at = now()
   where id = v_run_id;

  with regular_roster as (
    select distinct r.employee_id
    from public.daily_work_roster r
    join public.employees e on e.id = r.employee_id and e.active = true
    left join public.daily_absence_overrides dao
      on dao.absence_date = r.service_date
     and dao.employee_id = r.employee_id
     and dao.active = true
    where r.service_date = p_service_date
      and r.active = true
      and dao.id is null
  ), employee_count as (
    select count(*)::numeric as n from regular_roster
  ), work_totals as (
    select
      coalesce(sum(wi.load_points) filter (where wi.required), 0)::numeric as required_load,
      count(distinct wi.location_group_id) filter (where wi.required)::numeric as required_locations
    from public.schedule_work_items wi
    where wi.run_id = v_run_id
  )
  select
    coalesce(wt.required_load / nullif(ec.n, 0), 0)::numeric,
    coalesce(wt.required_locations / nullif(ec.n, 0), 0)::numeric
  into v_target_required_load, v_target_required_location_count
  from work_totals wt
  cross join employee_count ec;

  for v_item in
    select wi.*
    from public.schedule_work_items wi
    where wi.run_id = v_run_id
      and wi.required = true
    order by
      wi.load_points desc,
      wi.is_public_restroom desc,
      wi.coverage_start,
      wi.bundle_key,
      wi.id
  loop
    with current_solution_load as (
      select
        c.employee_id,
        coalesce(sum(sa.load_points) filter (where sa.status = 'ASSIGNED' and assigned_wi.required = true), 0)::numeric as assigned_load_points,
        count(distinct sa.location_group_id) filter (where sa.status = 'ASSIGNED' and assigned_wi.required = true)::integer as required_location_count,
        coalesce(bool_or(sa.location_group_id = v_item.location_group_id) filter (where sa.status = 'ASSIGNED' and assigned_wi.required = true), false)::boolean as has_current_location_group
      from public.schedule_candidate_scores c
      left join public.schedule_solution_assignments sa
        on sa.run_id = c.run_id
       and sa.assigned_employee_id = c.employee_id
      left join public.schedule_work_items assigned_wi
        on assigned_wi.id = sa.work_item_id
      where c.run_id = v_run_id
        and c.work_item_id = v_item.id
        and c.eligible = true
      group by c.employee_id
    ), candidate_balance as (
      select
        c.*,
        coalesce(csl.assigned_load_points, 0)::numeric as current_solution_load,
        coalesce(csl.required_location_count, 0)::integer as current_required_location_count,
        (coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0))::numeric as projected_solution_load,
        (coalesce(csl.required_location_count, 0) + case when coalesce(csl.has_current_location_group, false) then 0 else 1 end)::integer as projected_required_location_count,
        abs((coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0)) - v_target_required_load)::numeric as target_load_gap_after,
        abs((coalesce(csl.required_location_count, 0) + case when coalesce(csl.has_current_location_group, false) then 0 else 1 end) - v_target_required_location_count)::numeric as target_location_gap_after,
        greatest(
          0,
          100
            - ((abs((coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0)) - v_target_required_load) / greatest(v_target_required_load, 1)) * 80)
            - ((abs((coalesce(csl.required_location_count, 0) + case when coalesce(csl.has_current_location_group, false) then 0 else 1 end) - v_target_required_location_count) / greatest(v_target_required_location_count, 1)) * 20)
            - ((greatest(0, (coalesce(csl.assigned_load_points, 0) + coalesce(v_item.load_points, 0)) - (v_target_required_load * 1.20)) / greatest(v_target_required_load, 1)) * 100)
            - (greatest(0, (coalesce(csl.required_location_count, 0) + case when coalesce(csl.has_current_location_group, false) then 0 else 1 end) - (ceil(v_target_required_location_count)::integer + 1)) * 10)
        )::numeric as dynamic_workload_score
      from public.schedule_candidate_scores c
      join current_solution_load csl on csl.employee_id = c.employee_id
      where c.run_id = v_run_id
        and c.work_item_id = v_item.id
        and c.eligible = true
    ), candidate_rank_base as (
      select
        cb.*,
        min(cb.projected_solution_load) over () as min_projected_solution_load,
        min(cb.projected_required_location_count) over () as min_projected_required_location_count,
        round(((cb.route_fit_score * 0.75) + (cb.dynamic_workload_score * 0.25))::numeric, 2) as balanced_total_score
      from candidate_balance cb
    ), candidate_ranked as (
      select
        cb.*,
        row_number() over (
          order by
            case
              when cb.projected_solution_load > greatest(v_target_required_load * 1.20, coalesce(v_item.load_points, 0))
               and cb.min_projected_solution_load <= greatest(v_target_required_load * 1.20, coalesce(v_item.load_points, 0)) then 1
              else 0
            end asc,
            case
              when cb.projected_required_location_count > (ceil(v_target_required_location_count)::integer + 1)
               and cb.min_projected_required_location_count <= (ceil(v_target_required_location_count)::integer + 1) then 1
              else 0
            end asc,
            cb.balanced_total_score desc,
            cb.target_load_gap_after asc,
            cb.target_location_gap_after asc,
            cb.current_required_location_count asc,
            cb.current_solution_load asc,
            case when cb.employee_id = v_item.original_assigned_employee_id then 0 else 1 end,
            cb.employee_id
        )::integer as balanced_rank
      from candidate_rank_base cb
    )
    select * into v_choice
    from candidate_ranked
    order by balanced_rank asc
    limit 1;

    if not found then
      v_final_employee_id := null;
      v_final_total_score := 0;
      v_final_proximity_score := 0;
      v_final_route_fit_score := 0;
      v_final_workload_score := 0;
      v_final_hard_reject_reasons := array['no_eligible_candidate']::text[];
      v_final_current_solution_load := 0;
      v_final_required_location_count := 0;
      v_final_target_load_gap_after := 0;
      v_final_balanced_rank := null;
      v_assignment_reason := 'no_eligible_candidate_required_open';
    else
      v_final_employee_id := v_choice.employee_id;
      v_final_total_score := coalesce(v_choice.total_score, 0);
      v_final_proximity_score := coalesce(v_choice.proximity_score, 0);
      v_final_route_fit_score := coalesce(v_choice.route_fit_score, 0);
      v_final_workload_score := coalesce(v_choice.dynamic_workload_score, v_choice.workload_score, 0);
      v_final_hard_reject_reasons := coalesce(v_choice.hard_reject_reasons, array[]::text[]);
      v_final_current_solution_load := coalesce(v_choice.current_solution_load, 0);
      v_final_required_location_count := coalesce(v_choice.current_required_location_count, 0);
      v_final_target_load_gap_after := coalesce(v_choice.target_load_gap_after, 0);
      v_final_total_score := coalesce(v_choice.balanced_total_score, v_final_total_score);
      v_final_balanced_rank := v_choice.balanced_rank;
      v_assignment_reason := case
        when v_final_employee_id = v_item.original_assigned_employee_id then 'kept_existing_owner_after_fairness'
        else 'selected_fair_balanced_candidate'
      end;
    end if;

    insert into public.schedule_solution_assignments (
      run_id,
      work_item_id,
      service_date,
      location_group_id,
      segment_number,
      assigned_employee_id,
      owner_type,
      coverage_start,
      coverage_end,
      coverage_purpose,
      status,
      source_type,
      source_daily_assignment_id,
      load_points,
      assignment_reason,
      score_total,
      score_breakdown,
      notes
    ) values (
      v_item.run_id,
      v_item.id,
      v_item.service_date,
      v_item.location_group_id,
      v_item.segment_number,
      v_final_employee_id,
      case when v_final_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
      v_item.coverage_start,
      v_item.coverage_end,
      v_item.coverage_purpose,
      case when v_final_employee_id is null then 'OPEN' else 'ASSIGNED' end,
      'sch2_preview',
      v_item.source_daily_assignment_id,
      v_item.load_points,
      v_assignment_reason,
      v_final_total_score,
      jsonb_build_object(
        'total_score', v_final_total_score,
        'proximity_score', v_final_proximity_score,
        'route_fit_score', v_final_route_fit_score,
        'workload_score', v_final_workload_score,
        'target_required_load', v_target_required_load,
        'target_required_location_count', v_target_required_location_count,
        'current_solution_load', v_final_current_solution_load,
        'current_required_location_count', v_final_required_location_count,
        'target_load_gap_after', v_final_target_load_gap_after,
        'projected_solution_load', coalesce(v_choice.projected_solution_load, case when v_final_employee_id is null then 0 else v_final_current_solution_load + coalesce(v_item.load_points, 0) end),
        'projected_required_location_count', coalesce(v_choice.projected_required_location_count, v_final_required_location_count),
        'target_location_gap_after', coalesce(v_choice.target_location_gap_after, 0),
        'balanced_rank', v_final_balanced_rank,
        'hard_reject_reasons', coalesce(to_jsonb(v_final_hard_reject_reasons), '[]'::jsonb)
      ),
      concat_ws(' | ', nullif(v_item.notes, ''), 'SCH2 preview')
    );
  end loop;

  insert into public.schedule_solution_assignments (
    run_id,
    work_item_id,
    service_date,
    location_group_id,
    segment_number,
    assigned_employee_id,
    owner_type,
    coverage_start,
    coverage_end,
    coverage_purpose,
    status,
    source_type,
    source_daily_assignment_id,
    load_points,
    assignment_reason,
    score_total,
    score_breakdown,
    notes
  )
  select
    wi.run_id,
    wi.id,
    wi.service_date,
    wi.location_group_id,
    wi.segment_number,
    wi.original_assigned_employee_id,
    case when wi.original_assigned_employee_id is null then 'OPEN' else 'EMPLOYEE' end,
    wi.coverage_start,
    wi.coverage_end,
    wi.coverage_purpose,
    case when wi.original_assigned_employee_id is null then 'OPEN' else 'ASSIGNED' end,
    'sch2_preview',
    wi.source_daily_assignment_id,
    wi.load_points,
    'preserved_non_required_preview_item',
    0,
    jsonb_build_object(
      'target_required_load', v_target_required_load,
      'target_required_location_count', v_target_required_location_count,
      'hard_reject_reasons', '[]'::jsonb
    ),
    concat_ws(' | ', nullif(wi.notes, ''), 'SCH2 preview')
  from public.schedule_work_items wi
  where wi.run_id = v_run_id
    and wi.required = false;

  select count(*)::integer into v_solution_count
  from public.schedule_solution_assignments
  where run_id = v_run_id;

  if v_solution_count <> v_work_item_count then
    update public.schedule_generation_runs
       set status = 'preview_error',
           error_message = format('SCH2 preview solution count mismatch: work_items=%s, solution_assignments=%s', v_work_item_count, v_solution_count),
           updated_at = now()
     where id = v_run_id;
    raise exception 'SCH2 preview solution count mismatch for %: work_items=%, solution_assignments=%', p_service_date, v_work_item_count, v_solution_count;
  end if;

  v_audit := public.sch2_audit_solution(v_run_id);
  v_diff := public.sch2_compare_current_vs_preview(v_run_id);

  update public.schedule_generation_runs
     set diff_summary = v_diff, updated_at = now()
   where id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'run_id', v_run_id,
    'service_date', p_service_date,
    'audit', v_audit,
    'diff', v_diff
  );
exception
  when others then
    if v_run_id is not null then
      update public.schedule_generation_runs
         set status = 'preview_error', error_message = sqlerrm, updated_at = now()
       where id = v_run_id;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_apply_lunch_coverage_wrapper_norm_base_20260628(p_service_date date)
 RETURNS jsonb
 LANGUAGE sql
AS $function$ select jsonb_build_array(public.sch_apply_lunch_coverage_wrapper_base_20260628(p_service_date), public.sch_normalize_restored_scan_lunch_load_points(p_service_date)); $function$;

CREATE OR REPLACE FUNCTION public.sch_get_location_schedule_owner(p_location_code text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(location_code text, location_name text, location_type text, service_date date, location_id uuid, location_group_id uuid, group_code text, group_name text, coverage_purpose text, assigned_employee_id uuid, assigned_employee_name text, assigned_employee_code text, msg_user_id uuid, msg_device_identifier text, coverage_start text, coverage_end text, owner_source text, alert_target_reason text)
 LANGUAGE sql
 STABLE
AS $function$
with target_location as (
  select
    l.id as location_id,
    l.location_code,
    l.location_name,
    lower(coalesce(l.form_type, l.location_type, '')) as location_type
  from public.locations l
  where upper(l.location_code) = upper(p_location_code)
    and l.active = true
  limit 1
), target_group as (
  select
    tl.location_id,
    tl.location_code,
    tl.location_name,
    tl.location_type,
    lg.id as location_group_id,
    lg.group_code,
    lg.group_name
  from target_location tl
  left join public.location_group_memberships lgm on lgm.location_id = tl.location_id and lgm.active = true
  left join public.location_groups lg on lg.id = lgm.location_group_id and lg.active = true
  order by lg.group_name nulls last
  limit 1
), location_rows as (
  select
    tg.*,
    public.sch_service_date(p_at) as service_date,
    lct.id as segment_id,
    lct.segment_number,
    lct.assigned_employee_id,
    lct.coverage_purpose,
    to_char(lct.coverage_start, 'HH12:MI AM') as coverage_start,
    to_char(lct.coverage_end, 'HH12:MI AM') as coverage_end,
    'location_template'::text as owner_source,
    case
      when tg.location_type = 'restroom' and lct.coverage_purpose = 'restroom_upkeep' then 1
      when tg.location_type <> 'restroom' and lct.coverage_purpose = 'area_owner' then 1
      when lct.coverage_purpose = 'deep_clean' then 2
      when lct.coverage_purpose = 'late_coverage' then 3
      else 9
    end as purpose_rank
  from target_group tg
  join public.location_coverage_templates lct on lct.location_id = tg.location_id
  where lct.active = true
    and lct.assigned_employee_id is not null
    and lct.day_of_week = extract(dow from public.sch_service_date(p_at))::integer
    and to_timestamp(to_char(public.sch_service_date(p_at), 'YYYY-MM-DD') || ' ' || to_char(lct.coverage_start, 'HH12:MI AM'), 'YYYY-MM-DD HH12:MI AM') <= (p_at at time zone 'America/Chicago')
    and to_timestamp(to_char(public.sch_service_date(p_at), 'YYYY-MM-DD') || ' ' || to_char(lct.coverage_end, 'HH12:MI AM'), 'YYYY-MM-DD HH12:MI AM') > (p_at at time zone 'America/Chicago')
), group_rows as (
  select
    tg.*,
    public.sch_service_date(p_at) as service_date,
    s.segment_id,
    s.segment_number,
    s.assigned_employee_id,
    s.coverage_purpose,
    s.coverage_start,
    s.coverage_end,
    'group_schedule'::text as owner_source,
    case
      when tg.location_type = 'restroom' and s.coverage_purpose = 'restroom_upkeep' then 5
      when tg.location_type <> 'restroom' and s.coverage_purpose = 'area_owner' then 5
      when s.coverage_purpose = 'deep_clean' then 6
      when s.coverage_purpose = 'late_coverage' then 7
      when s.coverage_purpose = 'area_owner' then 8
      else 19
    end as purpose_rank
  from target_group tg
  join public.sch_get_daily_schedule_with_purpose(public.sch_service_date(p_at)) s
    on s.location_group_id = tg.location_group_id
  where s.assigned_employee_id is not null
    and to_timestamp(to_char(public.sch_service_date(p_at), 'YYYY-MM-DD') || ' ' || s.coverage_start, 'YYYY-MM-DD HH12:MI AM') <= (p_at at time zone 'America/Chicago')
    and to_timestamp(to_char(public.sch_service_date(p_at), 'YYYY-MM-DD') || ' ' || s.coverage_end, 'YYYY-MM-DD HH12:MI AM') > (p_at at time zone 'America/Chicago')
), chosen as (
  select * from location_rows
  union all
  select * from group_rows
  order by purpose_rank, segment_number
  limit 1
)
select
  c.location_code,
  c.location_name,
  c.location_type,
  c.service_date,
  c.location_id,
  c.location_group_id,
  c.group_code,
  c.group_name,
  c.coverage_purpose,
  c.assigned_employee_id,
  e.display_name as assigned_employee_name,
  e.employee_code as assigned_employee_code,
  mu.id as msg_user_id,
  mda.device_identifier as msg_device_identifier,
  c.coverage_start,
  c.coverage_end,
  c.owner_source,
  case
    when c.location_type = 'restroom' and c.coverage_purpose = 'restroom_upkeep' then 'restroom upkeep owner'
    when c.location_type <> 'restroom' and c.coverage_purpose = 'area_owner' then 'area owner'
    when c.coverage_purpose = 'deep_clean' then 'morning deep clean owner'
    when c.coverage_purpose = 'late_coverage' then 'late coverage owner'
    else 'scheduled owner'
  end as alert_target_reason
from chosen c
join public.employees e on e.id = c.assigned_employee_id
left join public.msg_users mu on mu.employee_id = e.id and mu.is_active = true
left join public.msg_device_assignments mda on mda.msg_user_id = mu.id and mda.is_active = true
order by mda.updated_at desc nulls last
limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.tool_admin_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'runtime', public.tool_runtime_readiness(),
    'open_sessions', public.tool_list_open_sessions(),
    'active_devices', public.tool_list_active_devices(),
    'settings', public.tool_get_system_settings()
  );
$function$;

CREATE OR REPLACE FUNCTION public.tool_commit_cleaning_workflow(p_client_session_id text, p_client_completion_id text, p_device_id text, p_location_code text, p_client_started_at timestamp with time zone, p_client_ended_at timestamp with time zone, p_response_json jsonb DEFAULT '{}'::jsonb, p_scan_evidence jsonb DEFAULT '[]'::jsonb, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_session record;
  v_presented_device_pk uuid;
begin
  select s.id, s.session_uuid, s.client_session_id, s.status,
         s.started_at, s.ended_at, s.duration_minutes, s.duration_display,
         s.completion_source, s.device_id as session_device_pk,
         l.location_code, l.location_name, l.location_type, l.form_type,
         e.display_name as employee_name, d.device_id
    into v_session
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id = btrim(p_client_session_id)
  limit 1;

  if v_session.session_uuid is not null and v_session.status = 'cancelled' then
    select d.id into v_presented_device_pk
    from public.device_aliases da
    join public.devices d on d.id = da.canonical_device_id and d.active = true
    where da.active = true and upper(btrim(da.alias_identifier)) = upper(btrim(p_device_id))
    union all
    select d.id from public.devices d
    where d.active = true and upper(btrim(d.device_id)) = upper(btrim(p_device_id))
    limit 1;

    if v_presented_device_pk is null or v_presented_device_pk <> v_session.session_device_pk then
      raise exception 'Session does not belong to device %', p_device_id;
    end if;

    return jsonb_build_object(
      'session_uuid', v_session.session_uuid,
      'client_session_id', v_session.client_session_id,
      'client_completion_id', p_client_completion_id,
      'location_code', v_session.location_code,
      'location_name', v_session.location_name,
      'location_type', v_session.location_type,
      'form_type', v_session.form_type,
      'employee_name', v_session.employee_name,
      'device_id', v_session.device_id,
      'status', 'cancelled',
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'duration_minutes', v_session.duration_minutes,
      'duration_display', v_session.duration_display,
      'completion_source', v_session.completion_source,
      'replayed', true,
      'terminal', true,
      'discard_local_workflow', true,
      'reason', 'session_cancelled_without_authoritative_completion',
      'correlation_id', p_correlation_id
    );
  end if;

  return public.commit_cleaning_workflow(
    p_client_session_id,
    p_client_completion_id,
    p_device_id,
    p_location_code,
    p_client_started_at,
    p_client_ended_at,
    p_response_json,
    p_scan_evidence,
    p_correlation_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.tool_start_session(p_location_code text, p_employee_name text, p_device_id text, p_client_session_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select jsonb_build_object(
    'session_uuid', x.session_uuid,
    'location_name', x.location_name,
    'employee_name', x.employee_name,
    'device_id', x.device_id,
    'status', x.status,
    'started_at', x.started_at,
    'location_type', l.location_type,
    'form_type', l.form_type
  )
  from public.start_session(
    p_location_code,
    p_employee_name,
    p_device_id,
    p_client_session_id
  ) x
  left join public.locations l on l.location_code = p_location_code
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.tool_start_session_v2(p_location_code text, p_device_id text, p_client_session_id text, p_client_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.start_session_v2(
    p_location_code,
    p_device_id,
    p_client_session_id,
    p_client_started_at,
    p_correlation_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_advance(p_run_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_cycle integer;
  v_closed integer := 0;
begin
  perform public.demo_scan_mock_preflight();

  select r.id, r.cycle_number
  into v_run_id, v_cycle
  from public.demo_scan_mock_runs r
  where (p_run_id is null or r.id = p_run_id)
    and r.status = 'active'
  order by r.started_at desc
  limit 1;

  if v_run_id is null then
    raise exception 'No active demo scan mock run found.';
  end if;

  update public.sessions s
  set
    status = 'pending_submit',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)::text || ' min'),
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'active';

  update public.sessions s
  set
    status = 'closed',
    ended_at = coalesce(s.ended_at, now()),
    duration_minutes = coalesce(s.duration_minutes, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)),
    duration_display = coalesce(s.duration_display, greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)::integer)::text || ' min'),
    completion_source = 'kiosk_form',
    updated_at = now()
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'pending_submit';
  get diagnostics v_closed = row_count;

  insert into public.completion_responses (
    session_id, location_id, submitted_by_employee_id, device_id,
    response_json, submitted_at, created_at, client_completion_id
  )
  select
    s.id, s.location_id, s.employee_id, s.device_id,
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', v_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'active_session_completion',
      'services_performed', to_jsonb(array['trash_removed', 'fixtures_checked', 'floor_spot_cleaned']::text[]),
      'notes', 'Demo active session completed automatically during mock advance.',
      'cleaning_notes', 'Demo active session completed automatically during mock advance.'
    ),
    coalesce(s.ended_at, now()),
    coalesce(s.ended_at, now()),
    'demo-completion:' || v_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'closed'
    and not exists (select 1 from public.completion_responses cr where cr.session_id = s.id);

  insert into public.scan_events (
    scanned_at, location_id, location_code, device_id, device_identifier,
    session_id, event_type, result, notes, payload_json, created_at, client_event_id
  )
  select
    coalesce(s.ended_at, now()), s.location_id, l.location_code, s.device_id, d.device_id,
    s.id, 'scan_finish', 'demo_active_session_finished',
    'Demo active session finished during mock advance.',
    jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'cycle_number', v_cycle, 'phase', 'active_finish'),
    coalesce(s.ended_at, now()),
    'demo-scan-event:' || v_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text || ':finish'
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.devices d on d.id = s.device_id
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'closed'
    and not exists (
      select 1 from public.scan_events se
      where se.client_event_id = 'demo-scan-event:' || v_run_id::text || ':cycle:' || v_cycle::text || ':session:' || s.id::text || ':finish'
    );

  insert into public.session_events (
    session_id, event_type, actor_type, actor_ref, details_json, created_at
  )
  select
    s.id, 'demo_session_completed', 'system', 'demo_scan_mock_advance',
    jsonb_build_object(
      'demo_mock', true,
      'mock_run_id', v_run_id::text,
      'cycle_number', v_cycle,
      'phase', 'active_completed',
      'demo_marker', 'cycle:' || v_cycle::text || ':session:' || s.id::text || ':completed'
    ),
    coalesce(s.ended_at, now())
  from public.sessions s
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:%')
    and s.status = 'closed'
    and not exists (
      select 1 from public.session_events ev
      where ev.session_id = s.id
        and ev.details_json ->> 'demo_marker' = 'cycle:' || v_cycle::text || ':session:' || s.id::text || ':completed'
    );

  insert into public.maintenance_tickets (
    completion_response_id, session_id, location_id, reported_by_employee_id, device_id,
    issue_source, status, issue_summary, issue_category, fixture_type, fixture_identifier,
    out_of_order, issue_payload, location_code_snapshot, location_name_snapshot,
    reporter_name_snapshot, reported_at, created_at
  )
  select
    cr.id, s.id, s.location_id, s.employee_id, s.device_id,
    'completion_form', 'open',
    case when l.form_type = 'restroom' then 'Demo issue: refill soap dispenser' else 'Demo issue: debris near guest path' end,
    case when l.form_type = 'restroom' then 'supplies' else 'cleanliness' end,
    case when l.form_type = 'restroom' then 'soap_dispenser' else 'guest_path' end,
    case when l.form_type = 'restroom' then 'soap-' || l.location_code else 'path-' || l.location_code end,
    false,
    jsonb_build_object('demo_mock', true, 'mock_run_id', v_run_id::text, 'cycle_number', v_cycle, 'phase', 'advance_issue', 'severity', 'medium'),
    l.location_code, l.location_name, e.display_name,
    coalesce(s.ended_at, now()), coalesce(s.ended_at, now())
  from public.sessions s
  join public.locations l on l.id = s.location_id
  join public.employees e on e.id = s.employee_id
  join public.completion_responses cr on cr.session_id = s.id
  where s.client_session_id like ('demo-scan:' || v_run_id::text || ':cycle:' || v_cycle::text || ':%')
    and s.status = 'closed'
    and ((('x' || substr(md5(s.id::text || v_cycle::text), 1, 8))::bit(32)::bigint % 4) = 0)
    and not exists (
      select 1 from public.maintenance_tickets mt
      where mt.session_id = s.id
        and mt.issue_payload ->> 'demo_mock' = 'true'
    );

  update public.demo_scan_mock_runs
  set
    cycle_number = cycle_number + 1,
    last_advanced_at = now(),
    updated_at = now(),
    metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object('last_closed_sessions', v_closed)
  where id = v_run_id;

  perform public.demo_scan_mock_begin_cycle(v_run_id);
  perform public.demo_scan_mock_refresh_snapshot(v_run_id);

  return v_run_id;
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_cron_shift_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  return public.demo_scan_mock_assigned_area_tick(null);
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_start(p_employee_count integer DEFAULT NULL::integer, p_reset_existing boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_active_employees integer;
  v_active_locations integer;
  v_employee_count integer;
begin
  perform public.demo_scan_mock_preflight();

  if p_reset_existing then
    perform * from public.demo_scan_mock_cleanup(null);
  end if;

  select count(*) into v_active_employees from public.employees where active;
  select count(*) into v_active_locations from public.locations where active;

  v_employee_count := coalesce(p_employee_count, v_active_employees);
  v_employee_count := greatest(1, least(v_employee_count, v_active_employees, greatest(v_active_locations - 6, 1)));

  insert into public.demo_scan_mock_runs (
    status,
    started_at,
    employee_count,
    cycle_number,
    notes,
    metadata_json
  ) values (
    'active',
    now(),
    v_employee_count,
    0,
    'Memphis Zoo custodial dashboard demo/mock scan-session run. All generated rows are demo-tagged.',
    jsonb_build_object(
      'demo_mock', true,
      'engine_version', 'v2',
      'created_by', 'demo_scan_mock_start',
      'cleanup_tags', jsonb_build_array('demo-scan:%', 'demo-scan-event:%', 'demo-completion:%')
    )
  ) returning id into v_run_id;

  perform public.demo_scan_mock_begin_cycle(v_run_id);
  perform public.demo_scan_mock_refresh_snapshot(v_run_id);

  return v_run_id;
end $function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_start_shift_schedule(p_reset_existing boolean DEFAULT true, p_employee_count integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_active_employees integer;
  v_employee_count integer;
begin
  perform public.demo_scan_mock_preflight();

  if p_reset_existing then
    perform * from public.demo_scan_mock_cleanup(null);
  end if;

  select count(*) into v_active_employees from public.employees where active;
  v_employee_count := greatest(1, least(coalesce(p_employee_count, v_active_employees), v_active_employees));

  insert into public.demo_scan_mock_runs (
    status,
    started_at,
    employee_count,
    cycle_number,
    notes,
    metadata_json
  ) values (
    'active',
    now(),
    v_employee_count,
    0,
    'Shift-schedule demo: 7 AM to 4 PM Central, 20-minute staggered starts, 135-minute restroom cadence, 255-minute exhibit cadence.',
    jsonb_build_object(
      'demo_mock', true,
      'engine_version', 'v3_shift_schedule',
      'mode', 'shift_schedule',
      'restroom_interval_minutes', 135,
      'exhibit_interval_minutes', 255,
      'stagger_minutes', 20,
      'session_duration_minutes', 35,
      'work_start_central', '07:00',
      'work_stop_central', '16:00',
      'operational_day_start_protected', '04:00 Central'
    )
  ) returning id into v_run_id;

  perform public.demo_scan_mock_shift_tick(v_run_id);
  return v_run_id;
end $function$;

CREATE OR REPLACE FUNCTION public.sch_apply_lunch_coverage(p_service_date date)
 RETURNS jsonb
 LANGUAGE sql
AS $function$ select jsonb_build_array(public.sch_apply_lunch_coverage_wrapper_norm_base_20260628(p_service_date), public.sch_fill_open_lunch_coverage(p_service_date), public.sch_normalize_restored_scan_lunch_load_points(p_service_date)); $function$;

CREATE OR REPLACE FUNCTION public.sch_get_scan_alert_owner(p_location_code text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(location_code text, location_name text, location_type text, service_date date, location_group_id uuid, group_code text, group_name text, coverage_purpose text, assigned_employee_id uuid, assigned_employee_name text, assigned_employee_code text, msg_user_id uuid, msg_device_identifier text, coverage_start text, coverage_end text, alert_target_reason text)
 LANGUAGE sql
 STABLE
AS $function$
  select
    lso.location_code,
    lso.location_name,
    lso.location_type,
    lso.service_date,
    lso.location_group_id,
    lso.group_code,
    lso.group_name,
    lso.coverage_purpose,
    lso.assigned_employee_id,
    lso.assigned_employee_name,
    lso.assigned_employee_code,
    lso.msg_user_id,
    lso.msg_device_identifier,
    lso.coverage_start,
    lso.coverage_end,
    lso.alert_target_reason
  from public.sch_get_location_schedule_owner(p_location_code, p_at) lso;
$function$;

CREATE OR REPLACE FUNCTION public.demo_scan_mock_cron_advance()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_run_id uuid;
begin
  select id
  into v_run_id
  from public.demo_scan_mock_runs
  where status = 'active'
  order by started_at desc
  limit 1;

  if v_run_id is null then
    return null;
  end if;

  return public.demo_scan_mock_advance(v_run_id);
end $function$;

CREATE OR REPLACE FUNCTION public.sch_format_scan_alert_message(p_location_code text, p_alert_type text, p_minutes_until_due integer DEFAULT NULL::integer, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_owner record;
  v_message text;
  v_alert text := lower(coalesce(p_alert_type, 'due_soon'));
begin
  select * into v_owner
  from public.sch_get_scan_alert_owner(p_location_code, p_at)
  limit 1;

  if v_owner.assigned_employee_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'No scheduled alert owner found',
      'location_code', p_location_code,
      'alert_type', v_alert
    );
  end if;

  if v_alert = 'overdue' then
    v_message := format(
      'Hey %s, %s is overdue. Can you check and scan it when you get there?',
      split_part(v_owner.assigned_employee_name, ' ', 1),
      v_owner.location_name
    );
  elsif p_minutes_until_due is not null then
    v_message := format(
      'Hey %s, %s is due in %s minutes.',
      split_part(v_owner.assigned_employee_name, ' ', 1),
      v_owner.location_name,
      p_minutes_until_due
    );
  else
    v_message := format(
      'Hey %s, %s is due soon.',
      split_part(v_owner.assigned_employee_name, ' ', 1),
      v_owner.location_name
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'location_code', v_owner.location_code,
    'location_name', v_owner.location_name,
    'location_type', v_owner.location_type,
    'alert_type', v_alert,
    'assigned_employee_id', v_owner.assigned_employee_id,
    'assigned_employee_name', v_owner.assigned_employee_name,
    'msg_user_id', v_owner.msg_user_id,
    'msg_device_identifier', v_owner.msg_device_identifier,
    'coverage_purpose', v_owner.coverage_purpose,
    'coverage_start', v_owner.coverage_start,
    'coverage_end', v_owner.coverage_end,
    'alert_target_reason', v_owner.alert_target_reason,
    'message', v_message
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_generate_daily_schedule(p_service_date date, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_day integer;
  v_deleted integer := 0;
  v_generated integer := 0;
  v_roster integer := 0;
  v_close_time time;
  v_reassigned integer := 0;
  v_active_absence_count integer := 0;
  v_lunch_result jsonb := '{}'::jsonb;
  v_row record;
  v_candidate record;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  v_day := extract(dow from p_service_date)::integer;
  v_close_time := public.sch_get_schedule_close_time(p_service_date);

  if p_force then
    delete from public.daily_schedule_assignments where service_date = p_service_date;
    get diagnostics v_deleted = row_count;
    delete from public.daily_work_roster where service_date = p_service_date;
  end if;

  insert into public.daily_work_roster (
    service_date, employee_id, shift_start, shift_end, source_type, notes, active
  )
  select
    p_service_date,
    est.employee_id,
    est.shift_start,
    est.shift_end,
    'template',
    est.notes,
    true
  from public.employee_shift_templates est
  join public.employees e on e.id = est.employee_id
  where est.active = true
    and e.active = true
    and est.day_of_week = v_day
  on conflict (service_date, employee_id)
  do update set
    shift_start = excluded.shift_start,
    shift_end = excluded.shift_end,
    source_type = excluded.source_type,
    notes = excluded.notes,
    active = excluded.active,
    updated_at = now();

  update public.daily_work_roster dwr
     set shift_start = eso.shift_start,
         shift_end = eso.shift_end,
         source_type = 'override',
         notes = coalesce(eso.notes, dwr.notes),
         active = coalesce(eso.active, true),
         updated_at = now()
    from public.employee_shift_overrides eso
   where dwr.service_date = p_service_date
     and eso.shift_date = p_service_date
     and eso.employee_id = dwr.employee_id;

  insert into public.daily_work_roster (
    service_date, employee_id, shift_start, shift_end, source_type, notes, active
  )
  select
    p_service_date,
    eso.employee_id,
    eso.shift_start,
    eso.shift_end,
    'override',
    eso.notes,
    coalesce(eso.active, true)
  from public.employee_shift_overrides eso
  left join public.daily_work_roster dwr
    on dwr.service_date = p_service_date
   and dwr.employee_id = eso.employee_id
  where eso.shift_date = p_service_date
    and dwr.id is null
  on conflict (service_date, employee_id)
  do nothing;

  update public.daily_work_roster dwr
     set active = false,
         source_type = 'absence_override',
         notes = trim(coalesce(dwr.notes,'') || ' Absent on ' || p_service_date::text),
         updated_at = now()
    from public.daily_absence_overrides dao
   where dwr.service_date = p_service_date
     and dao.absence_date = p_service_date
     and dao.employee_id = dwr.employee_id
     and dao.active = true;

  select count(*) into v_active_absence_count
  from public.daily_absence_overrides
  where absence_date = p_service_date
    and active = true;

  select count(*) into v_roster
  from public.daily_work_roster
  where service_date = p_service_date
    and active = true;

  insert into public.daily_schedule_assignments (
    service_date,
    location_group_id,
    segment_number,
    assigned_employee_id,
    owner_type,
    coverage_start,
    coverage_end,
    status,
    load_points,
    notes,
    source_type,
    coverage_purpose
  )
  select
    p_service_date,
    ct.location_group_id,
    ct.segment_number,
    case
      when ct.assigned_employee_id is null then null
      when exists (
        select 1
        from public.daily_work_roster dwr
        where dwr.service_date = p_service_date
          and dwr.employee_id = ct.assigned_employee_id
          and dwr.active = true
          and dwr.shift_start <= ct.coverage_start
          and dwr.shift_end >= least(ct.coverage_end, v_close_time)
      ) then ct.assigned_employee_id
      else null
    end as assigned_employee_id,
    case
      when ct.assigned_employee_id is null then 'OPEN'
      when exists (
        select 1
        from public.daily_work_roster dwr
        where dwr.service_date = p_service_date
          and dwr.employee_id = ct.assigned_employee_id
          and dwr.active = true
          and dwr.shift_start <= ct.coverage_start
          and dwr.shift_end >= least(ct.coverage_end, v_close_time)
      ) then 'EMPLOYEE'
      else 'OPEN'
    end as owner_type,
    ct.coverage_start,
    least(ct.coverage_end, v_close_time) as coverage_end,
    case
      when ct.assigned_employee_id is null then 'OPEN'
      when exists (
        select 1
        from public.daily_work_roster dwr
        where dwr.service_date = p_service_date
          and dwr.employee_id = ct.assigned_employee_id
          and dwr.active = true
          and dwr.shift_start <= ct.coverage_start
          and dwr.shift_end >= least(ct.coverage_end, v_close_time)
      ) then 'ASSIGNED'
      else 'OPEN'
    end as status,
    public.sch_group_load_points(ct.location_group_id),
    ct.notes,
    case
      when ct.assigned_employee_id is null then 'coverage_template_planned_open'
      when exists (
        select 1
        from public.daily_work_roster dwr
        where dwr.service_date = p_service_date
          and dwr.employee_id = ct.assigned_employee_id
          and dwr.active = true
          and dwr.shift_start <= ct.coverage_start
          and dwr.shift_end >= least(ct.coverage_end, v_close_time)
      ) then 'coverage_template'
      else 'coverage_template_unavailable'
    end as source_type,
    ct.coverage_purpose
  from public.coverage_templates ct
  join public.location_groups lg on lg.id = ct.location_group_id and lg.active = true
  where ct.active = true
    and ct.day_of_week = v_day
    and ct.coverage_start < v_close_time
  on conflict (service_date, location_group_id, segment_number)
  do update set
    assigned_employee_id = excluded.assigned_employee_id,
    owner_type = excluded.owner_type,
    coverage_start = excluded.coverage_start,
    coverage_end = excluded.coverage_end,
    status = excluded.status,
    load_points = excluded.load_points,
    notes = excluded.notes,
    source_type = excluded.source_type,
    coverage_purpose = excluded.coverage_purpose,
    updated_at = now();

  if not exists (select 1 from public.daily_schedule_assignments where service_date = p_service_date) then
    insert into public.daily_schedule_assignments (
      service_date,
      location_group_id,
      segment_number,
      assigned_employee_id,
      owner_type,
      coverage_start,
      coverage_end,
      status,
      load_points,
      notes,
      source_type,
      coverage_purpose
    )
    select
      dga.assignment_date,
      dga.location_group_id,
      row_number() over (partition by dga.location_group_id order by dga.coverage_start, dga.coverage_end, dga.created_at),
      dga.assigned_employee_id,
      case when dga.assigned_employee_id is null or dga.assignment_type = 'OPEN' then 'OPEN' else 'EMPLOYEE' end,
      dga.coverage_start,
      least(dga.coverage_end, v_close_time),
      case when dga.assigned_employee_id is null or dga.assignment_type = 'OPEN' then 'OPEN' else 'ASSIGNED' end,
      public.sch_group_load_points(dga.location_group_id),
      coalesce(dga.notes, dga.reason_code),
      case when dga.assigned_employee_id is null or dga.assignment_type = 'OPEN' then 'legacy_planned_open' else 'legacy_daily_group_assignments' end,
      case when dga.assigned_employee_id is null or dga.assignment_type = 'OPEN' then 'area_owner' else 'area_owner' end
    from public.daily_group_assignments dga
    where dga.assignment_date = p_service_date
      and coalesce(dga.active, true) = true
      and dga.coverage_start < v_close_time
    on conflict (service_date, location_group_id, segment_number)
    do nothing;
  end if;

  for v_row in
    select id, location_group_id, coverage_start, coverage_end, notes
    from public.daily_schedule_assignments
    where service_date = p_service_date
      and status = 'OPEN'
      and coverage_start < v_close_time
      and source_type in ('coverage_template_unavailable')
    order by coverage_start, coverage_end, segment_number, location_group_id
  loop
    v_candidate := null;

    select *
      into v_candidate
    from public.sch_get_coverage_candidates(
      p_service_date,
      v_row.location_group_id,
      v_row.coverage_start,
      v_row.coverage_end
    )
    order by recommendation_score desc, employee_name asc
    limit 1;

    if v_candidate.employee_id is not null then
      update public.daily_schedule_assignments
         set assigned_employee_id = v_candidate.employee_id,
             owner_type = 'EMPLOYEE',
             status = 'ASSIGNED',
             coverage_start = greatest(v_row.coverage_start, v_candidate.shift_start::time),
             coverage_end = least(v_row.coverage_end, v_candidate.shift_end::time),
             source_type = case
               when source_type is null or source_type = '' then 'auto_reassigned'
               when source_type like '%auto_reassigned%' then source_type
               else source_type || ':auto_reassigned'
             end,
             notes = trim(concat_ws(' | ', nullif(notes, ''), 'Auto reassigned by weighted balancing', v_candidate.explanation)),
             updated_at = now()
       where id = v_row.id;
      v_reassigned := v_reassigned + 1;
    end if;
  end loop;

  v_lunch_result := public.sch_apply_lunch_coverage(p_service_date);

  select count(*) into v_generated
  from public.daily_schedule_assignments
  where service_date = p_service_date;

  return jsonb_build_object(
    'service_date', p_service_date,
    'close_time', v_close_time,
    'deleted_existing_rows', v_deleted,
    'work_roster_rows', v_roster,
    'generated_rows', v_generated,
    'reassigned_open_rows', v_reassigned,
    'active_absence_count', v_active_absence_count,
    'lunch_coverage', v_lunch_result,
    'mode', case when exists (select 1 from public.coverage_templates ct where ct.day_of_week = v_day and ct.active = true) then 'coverage_templates' else 'legacy_fallback' end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.msg_memphis_pre_generate_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_body text := coalesce(new.body, '');
  v_lower text := lower(coalesce(new.body, ''));
  v_start_offset integer := 0;
  v_offsets integer[] := array[0];
  v_offset integer;
  v_service_date date;
begin
  if coalesce(new.metadata_json->>'channel', '') <> 'memphis' then
    return new;
  end if;

  if coalesce(new.message_type, '') <> 'text' then
    return new;
  end if;

  if v_lower !~ '(schedule|scheduled|shift|shifts|assigned|assignment|assignments|staff|staffing|working|works|work today|work tomorrow|who cleans|cleans|cleaning|cover|coverage|open area|open areas|open segment|uncovered|unassigned|restroom|restrooms|aquarium|teton|zambezi|expo|courtyard|breezeway|bonobos|cathouse|memmex|splash pad|event center|east admin|west admin|china|primate|pavilion)' then
    return new;
  end if;

  if v_lower ~ '\mtomorrow\M' then
    v_offsets := array[1];
  elsif v_lower ~ '\myesterday\M' then
    v_offsets := array[-1];
  elsif v_lower ~ '(this week|next week|weekly|week schedule|whole week|entire week|all week)' then
    if v_lower ~ 'next week' then
      v_start_offset := 7;
    else
      v_start_offset := 0;
    end if;
    v_offsets := array[
      v_start_offset,
      v_start_offset + 1,
      v_start_offset + 2,
      v_start_offset + 3,
      v_start_offset + 4,
      v_start_offset + 5,
      v_start_offset + 6
    ];
  end if;

  foreach v_offset in array v_offsets loop
    v_service_date := public.sch_service_date(now() + make_interval(days => v_offset));
    perform public.sch_generate_daily_schedule(v_service_date, false);
  end loop;

  return new;
exception when others then
  raise warning 'msg_memphis_pre_generate_schedule failed for message %, error: %', new.id, sqlerrm;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_absence_publish(p_service_date date, p_absent_employee_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_generate jsonb;
  v_absent_count integer := coalesce(cardinality(p_absent_employee_ids), 0);
  v_open_count integer := 0;
  v_assigned_count integer := 0;
  v_effective_count integer := 0;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  update public.daily_absence_overrides
     set active = false,
         updated_at = now(),
         notes = coalesce(notes, 'Replaced by scheduler UI')
   where absence_date = p_service_date
     and active = true
     and absence_type = 'manual_override';

  if v_absent_count > 0 then
    insert into public.daily_absence_overrides (
      id, absence_date, employee_id, absence_type, active, notes, created_at, updated_at
    )
    select gen_random_uuid(), p_service_date, x.employee_id, 'manual_override', true,
           'Published from scheduler UI', now(), now()
    from (select distinct unnest(p_absent_employee_ids) as employee_id) x
    where not exists (
      select 1 from public.daily_absence_overrides y
      where y.absence_date = p_service_date
        and y.employee_id = x.employee_id
        and y.active = true
    );
  end if;

  select count(*)::int into v_effective_count
  from public.daily_absence_overrides
  where absence_date = p_service_date and active = true;

  v_generate := public.sch_generate_daily_schedule(p_service_date, true);

  select count(*) into v_open_count
  from public.daily_schedule_assignments
  where service_date = p_service_date and status = 'OPEN';

  select count(*) into v_assigned_count
  from public.daily_schedule_assignments
  where service_date = p_service_date and status = 'ASSIGNED';

  return jsonb_build_object(
    'service_date', p_service_date,
    'published_absent_count', v_absent_count,
    'effective_absent_count', v_effective_count,
    'assigned_rows', v_assigned_count,
    'open_rows', v_open_count,
    'generate_result', v_generate
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_ensure_daily_schedule(p_service_date date, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_existing_rows integer := 0;
  v_open_rows integer := 0;
  v_generated jsonb := null;
  v_did_generate boolean := false;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  select count(*) into v_existing_rows
  from public.daily_schedule_assignments
  where service_date = p_service_date;

  if p_force or v_existing_rows = 0 then
    v_generated := public.sch_generate_daily_schedule(p_service_date, p_force);
    v_did_generate := true;
  end if;

  select count(*) into v_existing_rows
  from public.daily_schedule_assignments
  where service_date = p_service_date;

  select count(*) into v_open_rows
  from public.daily_schedule_assignments
  where service_date = p_service_date
    and status = 'OPEN';

  return jsonb_build_object(
    'service_date', p_service_date,
    'generated', v_did_generate,
    'force', coalesce(p_force, false),
    'assignment_rows', v_existing_rows,
    'open_rows', v_open_rows,
    'generate_result', v_generated
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_ensure_daily_schedule(p_service_date date, p_reason text DEFAULT 'automatic_readiness_check'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_roster_count integer := 0;
  v_assignment_count integer := 0;
  v_generated boolean := false;
  v_generator_result jsonb := '{}'::jsonb;
  v_status text;
begin
  if p_service_date is null then
    raise exception 'p_service_date is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('schedule-ready:' || p_service_date::text, 0));

  select count(*)::int into v_roster_count
  from public.daily_work_roster
  where service_date = p_service_date and active = true;

  select count(*)::int into v_assignment_count
  from public.daily_schedule_assignments
  where service_date = p_service_date;

  if v_roster_count = 0 or v_assignment_count = 0 then
    v_generator_result := public.sch_generate_daily_schedule(p_service_date, false);
    v_generated := true;

    select count(*)::int into v_roster_count
    from public.daily_work_roster
    where service_date = p_service_date and active = true;

    select count(*)::int into v_assignment_count
    from public.daily_schedule_assignments
    where service_date = p_service_date;
  end if;

  v_status := case when v_roster_count > 0 and v_assignment_count > 0 then 'completed' else 'failed' end;

  insert into public.schedule_automation_runs(
    automation_key, service_date, status, result_json, created_at, updated_at
  ) values (
    'daily_static_schedule_ready',
    p_service_date,
    v_status,
    jsonb_build_object(
      'reason', coalesce(nullif(btrim(p_reason), ''), 'automatic_readiness_check'),
      'generated', v_generated,
      'roster_count', v_roster_count,
      'assignment_count', v_assignment_count,
      'generator_result', v_generator_result
    ),
    now(), now()
  )
  on conflict (automation_key, service_date) do update set
    status = excluded.status,
    result_json = excluded.result_json,
    updated_at = now();

  if v_status <> 'completed' then
    raise exception 'Schedule for % is not ready after generation', p_service_date;
  end if;

  return jsonb_build_object(
    'service_date', p_service_date,
    'generated', v_generated,
    'roster_count', v_roster_count,
    'assignment_count', v_assignment_count,
    'reason', p_reason,
    'generator_result', v_generator_result
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.sch_generate_daily_schedule_privileged(p_service_date date, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  return public.sch_generate_daily_schedule(p_service_date, p_force);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_queue_scan_alert_message(p_location_code text, p_alert_type text, p_minutes_until_due integer DEFAULT NULL::integer, p_at timestamp with time zone DEFAULT now(), p_cooldown_minutes integer DEFAULT 30, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_payload jsonb;
  v_location_id uuid;
  v_location_name text;
  v_alert_type text := lower(coalesce(p_alert_type, 'due_soon'));
  v_status_bucket text;
  v_existing record;
  v_thread_id uuid;
  v_message_id uuid;
  v_sender_user_id uuid;
begin
  if v_alert_type not in ('due_soon','overdue') then
    raise exception 'p_alert_type must be due_soon or overdue';
  end if;

  v_payload := public.sch_format_scan_alert_message(p_location_code, v_alert_type, p_minutes_until_due, p_at);

  if coalesce((v_payload ->> 'ok')::boolean, false) = false then
    return v_payload || jsonb_build_object('queued', false, 'skipped', true);
  end if;

  select id, location_name into v_location_id, v_location_name
  from public.locations
  where upper(location_code) = upper(p_location_code)
  limit 1;

  v_status_bucket := v_alert_type || ':' || coalesce(v_payload ->> 'coverage_purpose', 'unknown');

  select * into v_existing
  from public.scan_alert_notification_log l
  where upper(l.location_code) = upper(p_location_code)
    and l.alert_type = v_alert_type
    and l.assigned_employee_id = (v_payload ->> 'assigned_employee_id')::uuid
    and l.active = true
    and l.created_at >= p_at - make_interval(mins => greatest(coalesce(p_cooldown_minutes, 30), 1))
  order by l.created_at desc
  limit 1;

  if v_existing.id is not null then
    return v_payload || jsonb_build_object(
      'queued', false,
      'skipped', true,
      'skip_reason', 'duplicate_within_cooldown',
      'existing_notification_id', v_existing.id,
      'existing_created_at', v_existing.created_at
    );
  end if;

  if p_dry_run then
    return v_payload || jsonb_build_object(
      'queued', false,
      'dry_run', true,
      'skipped', false
    );
  end if;

  select id into v_sender_user_id
  from public.msg_users
  where display_name = 'Memphis'
    and is_active = true
  limit 1;

  if v_sender_user_id is null then
    select id into v_sender_user_id
    from public.msg_users
    where role = 'manager'
      and is_active = true
    order by created_at
    limit 1;
  end if;

  v_thread_id := public.sch_get_or_create_scan_alert_thread((v_payload ->> 'msg_user_id')::uuid);
  v_message_id := gen_random_uuid();

  insert into public.msg_messages (
    id,
    thread_id,
    sender_user_id,
    message_type,
    body,
    metadata_json,
    sent_at,
    created_at,
    is_deleted
  ) values (
    v_message_id,
    v_thread_id,
    v_sender_user_id,
    'system',
    v_payload ->> 'message',
    jsonb_build_object(
      'source', 'scan_alert',
      'alert_type', v_alert_type,
      'location_code', p_location_code,
      'location_name', v_payload ->> 'location_name',
      'coverage_purpose', v_payload ->> 'coverage_purpose',
      'alert_target_reason', v_payload ->> 'alert_target_reason',
      'generated_at', p_at
    ),
    now(),
    now(),
    false
  );

  insert into public.msg_receipts (id, message_id, user_id, delivered_at, read_at)
  values (gen_random_uuid(), v_message_id, (v_payload ->> 'msg_user_id')::uuid, now(), null)
  on conflict (message_id, user_id) do nothing;

  update public.msg_threads
     set updated_at = now(), last_message_at = now()
   where id = v_thread_id;

  insert into public.scan_alert_notification_log (
    id,
    location_id,
    location_code,
    location_name,
    alert_type,
    status_bucket,
    assigned_employee_id,
    msg_user_id,
    msg_device_identifier,
    coverage_purpose,
    alert_message,
    msg_thread_id,
    msg_message_id,
    alert_context,
    created_at,
    active
  ) values (
    gen_random_uuid(),
    v_location_id,
    upper(p_location_code),
    coalesce(v_location_name, v_payload ->> 'location_name'),
    v_alert_type,
    v_status_bucket,
    (v_payload ->> 'assigned_employee_id')::uuid,
    (v_payload ->> 'msg_user_id')::uuid,
    v_payload ->> 'msg_device_identifier',
    v_payload ->> 'coverage_purpose',
    v_payload ->> 'message',
    v_thread_id,
    v_message_id,
    v_payload,
    now(),
    true
  );

  return v_payload || jsonb_build_object(
    'queued', true,
    'skipped', false,
    'msg_thread_id', v_thread_id,
    'msg_message_id', v_message_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_regenerate_existing_schedules_for_absence_range(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_start date := coalesce(p_start_date, current_date);
  v_end date := coalesce(p_end_date, coalesce(p_start_date, current_date));
  v_date date;
  v_generated integer := 0;
  v_dates jsonb := '[]'::jsonb;
begin
  if v_end < v_start then
    raise exception 'p_end_date must be on or after p_start_date';
  end if;

  for v_date in
    select gs::date
    from generate_series(v_start, v_end, interval '1 day') gs
    where exists (
      select 1
      from public.daily_schedule_assignments dsa
      where dsa.service_date = gs::date
      limit 1
    )
    or exists (
      select 1
      from public.daily_work_roster dwr
      where dwr.service_date = gs::date
      limit 1
    )
  loop
    perform public.sch_generate_daily_schedule(v_date, true);
    v_generated := v_generated + 1;
    v_dates := v_dates || to_jsonb(v_date::text);
  end loop;

  return jsonb_build_object('ok', true, 'start_date', v_start, 'end_date', v_end, 'generated_count', v_generated, 'generated_dates', v_dates);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_daily_absence_override_regenerate_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_start date;
  v_end date;
begin
  if tg_op = 'DELETE' then
    v_start := old.absence_date;
    v_end := old.absence_date;
  elsif tg_op = 'INSERT' then
    v_start := new.absence_date;
    v_end := new.absence_date;
  else
    v_start := least(coalesce(old.absence_date, new.absence_date), coalesce(new.absence_date, old.absence_date));
    v_end := greatest(coalesce(old.absence_date, new.absence_date), coalesce(new.absence_date, old.absence_date));
  end if;

  if current_setting('memphis.skip_absence_regen', true) = 'on' then
    return coalesce(new, old);
  end if;

  perform public.sch_regenerate_existing_schedules_for_absence_range(v_start, v_end);
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_ensure_current_day_schedule()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select public.sch_ensure_daily_schedule(
    public.sch_service_date(now()),
    'scheduled_current_day_readiness'
  );
$function$;

CREATE OR REPLACE FUNCTION public.sch_ensure_schedule_window(p_start_date date DEFAULT sch_service_date(now()), p_days integer DEFAULT 14, p_reason text DEFAULT 'scheduled_rolling_window_readiness'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_start date := coalesce(p_start_date, public.sch_service_date(now()));
  v_days integer := greatest(1, least(coalesce(p_days, 14), 31));
  v_offset integer;
  v_date date;
  v_result jsonb;
  v_audit jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ready integer := 0;
  v_failed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('schedule-window:' || v_start::text || ':' || v_days::text, 0));

  for v_offset in 0..(v_days - 1) loop
    v_date := v_start + v_offset;
    begin
      v_result := public.sch_ensure_daily_schedule(
        v_date,
        coalesce(nullif(btrim(p_reason), ''), 'scheduled_rolling_window_readiness')
      );
      v_audit := public.sch_audit_schedule_day(v_date);
      if coalesce((v_audit->>'ok')::boolean, false) then
        v_ready := v_ready + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'service_date', v_date,
          'ok', true,
          'result', v_result,
          'audit', v_audit
        ));
      else
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'service_date', v_date,
          'ok', false,
          'error', 'schedule_audit_failed',
          'result', v_result,
          'audit', v_audit
        ));
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'service_date', v_date,
        'ok', false,
        'error', sqlerrm
      ));
    end;
  end loop;

  insert into public.schedule_automation_runs(
    automation_key, service_date, status, result_json, created_at, updated_at
  ) values (
    'rolling_schedule_window_ready',
    v_start,
    case when v_failed = 0 then 'completed' else 'failed' end,
    jsonb_build_object(
      'start_date', v_start,
      'days', v_days,
      'reason', p_reason,
      'ready_days', v_ready,
      'failed_days', v_failed,
      'results', v_results
    ),
    now(), now()
  )
  on conflict (automation_key, service_date) do update set
    status = excluded.status,
    result_json = excluded.result_json,
    updated_at = now();

  return jsonb_build_object(
    'ok', v_failed = 0,
    'start_date', v_start,
    'days', v_days,
    'ready_days', v_ready,
    'failed_days', v_failed,
    'results', v_results
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.sch_pto_absence_sync_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_start date;
  v_end date;
begin
  if tg_op = 'DELETE' then
    v_start := old.start_date;
    v_end := old.end_date;
  elsif tg_op = 'INSERT' then
    v_start := new.start_date;
    v_end := new.end_date;
  else
    v_start := least(coalesce(old.start_date, new.start_date), coalesce(new.start_date, old.start_date));
    v_end := greatest(coalesce(old.end_date, new.end_date), coalesce(new.end_date, old.end_date));
  end if;

  perform public.sch_sync_pto_absence_overrides(v_start, v_end);
  perform public.sch_regenerate_existing_schedules_for_absence_range(v_start, v_end);
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_queue_due_scan_alerts(p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT true, p_cooldown_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row record;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_alert_type text;
  v_minutes_until_overdue integer;
  v_overdue_minutes integer;
  v_limit integer := greatest(coalesce(p_limit, 50), 1);
begin
  for v_row in
    select
      location_code,
      location_name,
      form_type,
      status_code,
      latest_completed_at
    from public.v_location_dashboard_status
    where status_code in ('due_soon','overdue')
    order by case status_code when 'overdue' then 1 when 'due_soon' then 2 else 9 end,
             latest_completed_at nulls first,
             location_name
    limit v_limit
  loop
    v_alert_type := case when v_row.status_code = 'overdue' then 'overdue' else 'due_soon' end;

    v_overdue_minutes := case
      when v_row.form_type = 'restroom' then public.get_setting_int('restroom_overdue_minutes', 120)
      when v_row.form_type = 'exhibit' then public.get_setting_int('exhibit_overdue_minutes', 240)
      else public.get_setting_int('restroom_overdue_minutes', 120)
    end;

    if v_alert_type = 'due_soon' and v_row.latest_completed_at is not null then
      v_minutes_until_overdue := greatest(ceil(extract(epoch from ((v_row.latest_completed_at + make_interval(mins => v_overdue_minutes)) - now())) / 60.0)::integer, 0);
    else
      v_minutes_until_overdue := null;
    end if;

    v_result := public.sch_queue_scan_alert_message(
      v_row.location_code,
      v_alert_type,
      v_minutes_until_overdue,
      now(),
      p_cooldown_minutes,
      p_dry_run
    );

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'location_code', v_row.location_code,
        'location_name', v_row.location_name,
        'dashboard_status', v_row.status_code,
        'result', v_result
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'checked_limit', v_limit,
    'result_count', jsonb_array_length(v_results),
    'results', v_results
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sch_queue_due_scan_alerts(p_limit integer DEFAULT 50, p_dry_run boolean DEFAULT true, p_cooldown_minutes integer DEFAULT 30, p_manager_escalation_grace_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_row record;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_escalations jsonb;
  v_alert_type text;
  v_minutes_until_overdue integer;
  v_overdue_minutes integer;
  v_limit integer := greatest(coalesce(p_limit, 50), 1);
begin
  for v_row in
    select
      location_code,
      location_name,
      form_type,
      status_code,
      latest_completed_at
    from public.v_location_dashboard_status
    where status_code in ('due_soon','overdue')
    order by case status_code when 'overdue' then 1 when 'due_soon' then 2 else 9 end,
             latest_completed_at nulls first,
             location_name
    limit v_limit
  loop
    v_alert_type := case when v_row.status_code = 'overdue' then 'overdue' else 'due_soon' end;

    v_overdue_minutes := case
      when v_row.form_type = 'restroom' then public.get_setting_int('restroom_overdue_minutes', 120)
      when v_row.form_type = 'exhibit' then public.get_setting_int('exhibit_overdue_minutes', 240)
      else public.get_setting_int('restroom_overdue_minutes', 120)
    end;

    if v_alert_type = 'due_soon' and v_row.latest_completed_at is not null then
      v_minutes_until_overdue := greatest(ceil(extract(epoch from ((v_row.latest_completed_at + make_interval(mins => v_overdue_minutes)) - now())) / 60.0)::integer, 0);
    else
      v_minutes_until_overdue := null;
    end if;

    v_result := public.sch_queue_scan_alert_message(
      v_row.location_code,
      v_alert_type,
      v_minutes_until_overdue,
      now(),
      p_cooldown_minutes,
      p_dry_run
    );

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'location_code', v_row.location_code,
        'location_name', v_row.location_name,
        'dashboard_status', v_row.status_code,
        'result', v_result
      )
    );
  end loop;

  v_escalations := public.sch_queue_scan_alert_manager_escalations(
    p_manager_escalation_grace_minutes,
    p_limit,
    p_dry_run
  );

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'checked_limit', v_limit,
    'result_count', jsonb_array_length(v_results),
    'results', v_results,
    'manager_escalations', v_escalations
  );
end;
$function$;

alter table only "public"."ai_provider_access_audit" add constraint "ai_provider_access_audit_input_hash" CHECK (input_sha256 ~ '^[0-9a-f]{64}$'::text);

alter table only "public"."ai_provider_access_audit" add constraint "ai_provider_access_audit_metadata_object" CHECK (jsonb_typeof(metadata_json) = 'object'::text);

alter table only "public"."ai_provider_access_audit" add constraint "ai_provider_access_audit_redaction_count_check" CHECK (redaction_count >= 0);

alter table only "public"."ai_provider_access_audit" add constraint "ai_provider_access_audit_redaction_object" CHECK (jsonb_typeof(redaction_json) = 'object'::text);

alter table only "public"."annie_contacts" add constraint "annie_contacts_source_check" CHECK (source = ANY (ARRAY['manual'::text, 'suggested'::text, 'import'::text]));

alter table only "public"."annie_deliverables" add constraint "annie_deliverables_filename_check" CHECK (char_length(filename) <= 160);

alter table only "public"."annie_log_notes" add constraint "annie_log_notes_content_check" CHECK (char_length(content) <= 5000);

alter table only "public"."annie_log_reminders" add constraint "annie_log_reminders_content_check" CHECK (char_length(content) <= 500);

alter table only "public"."annie_log_reminders" add constraint "annie_log_reminders_due_check" CHECK (char_length(due) <= 200);

alter table only "public"."annie_log_suggested_reminders" add constraint "annie_log_suggested_reminders_content_check" CHECK (char_length(content) <= 500);

alter table only "public"."annie_log_suggested_reminders" add constraint "annie_log_suggested_reminders_due_check" CHECK (char_length(due) <= 200);

alter table only "public"."annie_log_suggested_reminders" add constraint "annie_log_suggested_reminders_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'dismissed'::text]));

alter table only "public"."annie_suggested_contacts" add constraint "annie_suggested_contacts_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'dismissed'::text]));

alter table only "public"."coverage_templates" add constraint "coverage_templates_day_of_week_check" CHECK (day_of_week >= 0 AND day_of_week <= 6);

alter table only "public"."coverage_templates" add constraint "coverage_templates_purpose_check" CHECK (coverage_purpose = ANY (ARRAY['deep_clean'::text, 'area_owner'::text, 'restroom_upkeep'::text, 'reminder'::text, 'late_coverage'::text, 'response_only'::text]));

alter table only "public"."current_attendance_state" add constraint "current_attendance_state_id_check" CHECK (id = 1);

alter table only "public"."daily_absence_overrides" add constraint "daily_absence_type_check" CHECK (absence_type = ANY (ARRAY['callout'::text, 'sick'::text, 'pto'::text, 'manual_override'::text]));

alter table only "public"."daily_group_assignments" add constraint "daily_group_assignments_time_check" CHECK (coverage_end > coverage_start);

alter table only "public"."daily_group_assignments" add constraint "daily_group_assignments_type_check" CHECK (assignment_type = ANY (ARRAY['primary_full_day'::text, 'primary_partial_day'::text, 'backup_day_off'::text, 'backup_partial_day'::text, 'absence_reassignment'::text, 'shift_end_reassignment'::text, 'coverall'::text, 'manual_override'::text]));

alter table only "public"."daily_schedule_assignments" add constraint "daily_schedule_assignments_coverage_end_after_start_check" CHECK (coverage_end > coverage_start);

alter table only "public"."daily_schedule_assignments" add constraint "daily_schedule_assignments_purpose_check" CHECK (coverage_purpose = ANY (ARRAY['deep_clean'::text, 'area_owner'::text, 'restroom_upkeep'::text, 'reminder'::text, 'late_coverage'::text, 'lunch_coverage'::text, 'response_only'::text]));

alter table only "public"."demo_scan_mock_runs" add constraint "demo_scan_mock_runs_cycle_number_check" CHECK (cycle_number >= 0);

alter table only "public"."demo_scan_mock_runs" add constraint "demo_scan_mock_runs_employee_count_check" CHECK (employee_count >= 0);

alter table only "public"."demo_scan_mock_runs" add constraint "demo_scan_mock_runs_status_check" CHECK (status = ANY (ARRAY['active'::text, 'stopped'::text]));

alter table only "public"."device_auth_credentials" add constraint "device_auth_credentials_expiration" CHECK (expires_at > created_at);

alter table only "public"."device_auth_credentials" add constraint "device_auth_credentials_hash_length" CHECK (length(token_hash) = 64);

alter table only "public"."device_auth_credentials" add constraint "device_auth_credentials_label_length" CHECK (device_label IS NULL OR length(device_label) <= 160);

alter table only "public"."device_auth_credentials" add constraint "device_auth_credentials_metadata_object" CHECK (jsonb_typeof(metadata_json) = 'object'::text);

alter table only "public"."device_auth_enrollment_codes" add constraint "device_auth_enrollment_code_expiration" CHECK (expires_at > created_at);

alter table only "public"."device_auth_enrollment_codes" add constraint "device_auth_enrollment_code_hash_length" CHECK (length(code_hash) = 64);

alter table only "public"."device_auth_enrollment_codes" add constraint "device_auth_enrollment_failed_attempts" CHECK (failed_attempts >= 0 AND failed_attempts <= 10);

alter table only "public"."device_auth_enrollment_codes" add constraint "device_auth_enrollment_metadata_object" CHECK (jsonb_typeof(metadata_json) = 'object'::text);

alter table only "public"."device_auth_events" add constraint "device_auth_events_event_type_length" CHECK (length(event_type) >= 1 AND length(event_type) <= 100);

alter table only "public"."device_auth_events" add constraint "device_auth_events_identifier_length" CHECK (presented_identifier IS NULL OR length(presented_identifier) <= 200);

alter table only "public"."device_auth_events" add constraint "device_auth_events_metadata_object" CHECK (jsonb_typeof(metadata_json) = 'object'::text);

alter table only "public"."device_auth_policy" add constraint "device_auth_policy_mode_check" CHECK (mode = ANY (ARRAY['observe'::text, 'enroll'::text, 'enforce'::text]));

alter table only "public"."device_auth_policy" add constraint "device_auth_policy_singleton_check" CHECK (singleton);

alter table only "public"."device_notification_acknowledgements" add constraint "device_notification_ack_key_length" CHECK (length(notification_key) >= 1 AND length(notification_key) <= 500);

alter table only "public"."device_sync_status" add constraint "device_sync_status_queue_count_check" CHECK (queue_count >= 0);

alter table only "public"."device_sync_status" add constraint "device_sync_status_retry_count_check" CHECK (retry_count >= 0);

alter table only "public"."employee_aliases" add constraint "employee_aliases_alias_nonblank" CHECK (btrim(alias_text) <> ''::text);

alter table only "public"."employee_area_familiarity" add constraint "employee_area_familiarity_score_check" CHECK (familiarity_score >= 1 AND familiarity_score <= 10);

alter table only "public"."employee_area_preferences" add constraint "employee_area_preferences_type_check" CHECK (preference_type = ANY (ARRAY['prefer'::text, 'avoid'::text, 'restricted'::text]));

alter table only "public"."employee_group_proximity" add constraint "employee_group_proximity_score_check" CHECK (proximity_score >= 1 AND proximity_score <= 5);

alter table only "public"."employee_planned_time_off" add constraint "employee_planned_time_off_date_order" CHECK (end_date >= start_date);

alter table only "public"."employee_pto" add constraint "employee_pto_date_check" CHECK (end_date >= start_date);

alter table only "public"."employee_pto" add constraint "employee_pto_type_check" CHECK (absence_type = ANY (ARRAY['pto'::text, 'vacation'::text, 'sick'::text, 'holiday'::text, 'admin_leave'::text]));

alter table only "public"."employee_shift_overrides" add constraint "shift_overrides_time_check" CHECK (shift_end > shift_start);

alter table only "public"."employee_shift_templates" add constraint "shift_templates_day_check" CHECK (day_of_week >= 0 AND day_of_week <= 6);

alter table only "public"."employee_shift_templates" add constraint "shift_templates_time_check" CHECK (shift_end > shift_start);

alter table only "public"."employees" add constraint "employees_role_check" CHECK (role = ANY (ARRAY['staff'::text, 'supervisor'::text, 'admin'::text]));

alter table only "public"."event_area_aliases" add constraint "event_area_aliases_confidence_weight_check" CHECK (confidence_weight >= 1 AND confidence_weight <= 1000);

alter table only "public"."events_app_events" add constraint "events_app_events_attendee_count_check" CHECK (attendee_count IS NULL OR attendee_count >= 0);

alter table only "public"."events_app_events" add constraint "events_app_events_end_after_start_check" CHECK (end_time IS NULL OR end_date > event_date OR end_time > start_time);

alter table only "public"."events_app_events" add constraint "events_app_events_end_date_not_before_start_check" CHECK (end_date >= event_date);

alter table only "public"."events_app_notification_log" add constraint "events_app_notification_log_kind_check" CHECK (notification_kind = ANY (ARRAY['day_of_event'::text, 'two_days_out'::text, 'three_days_out'::text, 'two_days_before'::text, 'day_before'::text, 'morning_of'::text, 'shift_plus_15'::text, 'shift_plus_fifteen'::text]));

alter table only "public"."events_app_notification_log" add constraint "events_app_notification_log_status_check" CHECK (status = ANY (ARRAY['sending'::text, 'sent'::text, 'error'::text, 'superseded'::text]));

alter table only "public"."location_coverage_templates" add constraint "location_coverage_templates_coverage_purpose_check" CHECK (coverage_purpose = ANY (ARRAY['deep_clean'::text, 'area_owner'::text, 'restroom_upkeep'::text, 'reminder'::text, 'late_coverage'::text]));

alter table only "public"."location_coverage_templates" add constraint "location_coverage_templates_day_of_week_check" CHECK (day_of_week >= 0 AND day_of_week <= 6);

alter table only "public"."location_coverage_templates" add constraint "location_coverage_templates_owner_type_check" CHECK (owner_type = ANY (ARRAY['EMPLOYEE'::text, 'OPEN'::text]));

alter table only "public"."location_coverage_templates" add constraint "location_coverage_templates_time_check" CHECK (coverage_start < coverage_end);

alter table only "public"."location_group_adjacency" add constraint "location_group_adjacency_score_check" CHECK (proximity_score >= 1 AND proximity_score <= 10);

alter table only "public"."location_group_adjacency" add constraint "location_group_adjacency_walk_check" CHECK (walking_minutes IS NULL OR walking_minutes >= 0);

alter table only "public"."location_group_proximity_settings" add constraint "location_group_cluster_multiplier_check" CHECK (cluster_weight_multiplier > 0::numeric);

alter table only "public"."location_group_proximity_settings" add constraint "location_group_isolation_penalty_check" CHECK (isolation_penalty_points >= 0::numeric);

alter table only "public"."location_group_proximity_settings" add constraint "location_group_route_x_check" CHECK (route_x >= 0::numeric AND route_x <= 100::numeric);

alter table only "public"."location_group_proximity_settings" add constraint "location_group_route_y_check" CHECK (route_y >= 0::numeric AND route_y <= 100::numeric);

alter table only "public"."location_group_scoring" add constraint "group_scoring_difficulty_check" CHECK (difficulty_rating >= 1 AND difficulty_rating <= 5);

alter table only "public"."location_group_scoring" add constraint "group_scoring_estimated_minutes_check" CHECK (estimated_minutes > 0);

alter table only "public"."location_group_scoring" add constraint "group_scoring_importance_check" CHECK (importance_rating >= 1 AND importance_rating <= 5);

alter table only "public"."location_group_scoring" add constraint "group_scoring_priority_check" CHECK (cleaning_priority >= 1 AND cleaning_priority <= 5);

alter table only "public"."location_group_workload_settings" add constraint "location_group_manual_load_nonnegative" CHECK (manual_load_points IS NULL OR manual_load_points >= 0::numeric);

alter table only "public"."locations" add constraint "locations_difficulty_rating_check" CHECK (difficulty_rating IS NULL OR difficulty_rating >= 1 AND difficulty_rating <= 10);

alter table only "public"."locations" add constraint "locations_form_type_check" CHECK (form_type IS NULL OR (form_type = ANY (ARRAY['restroom'::text, 'exhibit'::text])));

alter table only "public"."locations" add constraint "locations_priority_rating_check" CHECK (priority_rating IS NULL OR priority_rating >= 1 AND priority_rating <= 10);

alter table only "public"."locations" add constraint "locations_type_check" CHECK (location_type = ANY (ARRAY['restroom'::text, 'exhibit'::text]));

alter table only "public"."maintenance_tickets" add constraint "maintenance_tickets_status_check" CHECK (status = ANY (ARRAY['open'::text, 'closed'::text]));

alter table only "public"."migration_log_summary" add constraint "migration_log_summary_hash" CHECK (latest_sql_sha256 ~ '^[0-9a-f]{64}$'::text);

alter table only "public"."moxie_access_audit" add constraint "moxie_access_audit_mode_check" CHECK (access_mode = ANY (ARRAY['read'::text, 'write'::text, 'deny'::text]));

alter table only "public"."moxie_auth_credentials" add constraint "moxie_auth_credentials_hash_length" CHECK (length(password_hash) = 128);

alter table only "public"."moxie_auth_credentials" add constraint "moxie_auth_credentials_key_not_blank" CHECK (btrim(credential_key) <> ''::text);

alter table only "public"."moxie_auth_credentials" add constraint "moxie_auth_credentials_salt_length" CHECK (length(password_salt) >= 32 AND length(password_salt) <= 256);

alter table only "public"."moxie_auth_credentials" add constraint "moxie_auth_credentials_version_positive" CHECK (password_version > 0);

alter table only "public"."msg_broadcasts" add constraint "msg_broadcasts_body_not_blank" CHECK (length(btrim(body)) > 0);

alter table only "public"."msg_broadcasts" add constraint "msg_broadcasts_target_type_check" CHECK (target_type = ANY (ARRAY['all_hands'::text, 'role'::text, 'zone'::text, 'group'::text]));

alter table only "public"."msg_messages" add constraint "msg_messages_body_max_len" CHECK (length(body) <= 2000);

alter table only "public"."msg_messages" add constraint "msg_messages_body_not_blank" CHECK (length(btrim(body)) > 0);

alter table only "public"."msg_messages" add constraint "msg_messages_message_type_check" CHECK (message_type = ANY (ARRAY['text'::text, 'system'::text, 'broadcast'::text, 'bot_response'::text]));

alter table only "public"."msg_threads" add constraint "msg_threads_thread_type_check" CHECK (thread_type = ANY (ARRAY['direct'::text, 'broadcast'::text, 'bot'::text, 'group'::text]));

alter table only "public"."msg_users" add constraint "msg_users_role_check" CHECK (role = ANY (ARRAY['employee'::text, 'manager'::text, 'bot'::text, 'admin'::text, 'staff'::text]));

alter table only "public"."ops_manager_auth_events" add constraint "ops_manager_auth_events_detail_object" CHECK (jsonb_typeof(detail_json) = 'object'::text);

alter table only "public"."ops_manager_auth_events" add constraint "ops_manager_auth_events_device_id_length" CHECK (device_id IS NULL OR length(device_id) <= 96);

alter table only "public"."ops_manager_auth_events" add constraint "ops_manager_auth_events_event_type_length" CHECK (length(event_type) >= 1 AND length(event_type) <= 100);

alter table only "public"."ops_manager_trusted_devices" add constraint "ops_manager_trusted_devices_access_level" CHECK (max_access_level = ANY (ARRAY['read_only'::text, 'full_access'::text]));

alter table only "public"."ops_manager_trusted_devices" add constraint "ops_manager_trusted_devices_device_id_length" CHECK (length(device_id) >= 1 AND length(device_id) <= 96);

alter table only "public"."ops_manager_trusted_devices" add constraint "ops_manager_trusted_devices_expiration" CHECK (expires_at > created_at);

alter table only "public"."ops_manager_trusted_devices" add constraint "ops_manager_trusted_devices_hash_length" CHECK (length(token_hash) = 64);

alter table only "public"."ops_manager_trusted_devices" add constraint "ops_manager_trusted_devices_label_length" CHECK (length(device_label) >= 1 AND length(device_label) <= 160);

alter table only "public"."ops_manager_trusted_devices" add constraint "ops_manager_trusted_devices_metadata_object" CHECK (jsonb_typeof(metadata_json) = 'object'::text);

alter table only "public"."ops_manager_weekly_schedules" add constraint "ops_manager_weekly_schedules_day_of_week_check" CHECK (day_of_week >= 0 AND day_of_week <= 6);

alter table only "public"."release_deployment_manifest" add constraint "release_deployment_manifest_backend_sha" CHECK (backend_commit ~ '^[0-9a-f]{40}$'::text);

alter table only "public"."release_deployment_manifest" add constraint "release_deployment_manifest_details_object" CHECK (jsonb_typeof(details_json) = 'object'::text);

alter table only "public"."release_deployment_manifest" add constraint "release_deployment_manifest_frontend_sha" CHECK (frontend_commit ~ '^[0-9a-f]{40}$'::text);

alter table only "public"."release_deployment_manifest" add constraint "release_deployment_manifest_manifest_sha" CHECK (migration_manifest_sha256 ~ '^[0-9a-f]{64}$'::text);

alter table only "public"."release_deployment_manifest" add constraint "release_deployment_manifest_status_check" CHECK (status = ANY (ARRAY['candidate'::text, 'validated'::text, 'deployed'::text, 'retired'::text, 'rolled_back'::text]));

alter table only "public"."release_validation_runs" add constraint "release_validation_runs_status_check" CHECK (status = ANY (ARRAY['pass'::text, 'fail'::text, 'warning'::text]));

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_alert_type_check" CHECK (alert_type = ANY (ARRAY['due_soon'::text, 'overdue'::text]));

alter table only "public"."scan_events" add constraint "scan_events_event_type_check" CHECK (event_type = ANY (ARRAY['scan_received'::text, 'scan_blocked'::text, 'scan_start'::text, 'scan_finish'::text, 'scan_resume_pending'::text, 'scan_invalid_location'::text, 'scan_unauthorized_device'::text, 'scan_error'::text, 'work_position_check'::text]));

alter table only "public"."schedule_automation_runs" add constraint "schedule_automation_runs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text]));

alter table only "public"."scheduler_scoring_settings" add constraint "scheduler_scoring_weights_nonnegative" CHECK (proximity_weight >= 0::numeric AND difficulty_weight >= 0::numeric AND priority_weight >= 0::numeric);

alter table only "public"."scheduler_scoring_settings" add constraint "scheduler_scoring_weights_sum_check" CHECK (round(proximity_weight + difficulty_weight + priority_weight, 4) = 1.0000);

alter table only "public"."sessions" add constraint "sessions_completion_source_check" CHECK (completion_source IS NULL OR (completion_source = ANY (ARRAY['kiosk_form'::text, 'admin'::text, 'repair'::text, 'system'::text, 'incident_recovery'::text, 'system_timeout_cancelled'::text])));

alter table only "public"."sessions" add constraint "sessions_status_check" CHECK (status = ANY (ARRAY['active'::text, 'pending_submit'::text, 'closed'::text, 'cancelled'::text]));

alter table only "public"."system_logs" add constraint "system_logs_level_check" CHECK (level = ANY (ARRAY['DEBUG'::text, 'INFO'::text, 'WARN'::text, 'ERROR'::text]));

alter table only "public"."working_cluster_adjacency" add constraint "working_cluster_adjacency_level_check" CHECK (adjacency_level >= 0 AND adjacency_level <= 6);

alter table only "public"."completion_responses" add constraint "completion_responses_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

alter table only "public"."completion_responses" add constraint "completion_responses_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;

alter table only "public"."completion_responses" add constraint "completion_responses_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

alter table only "public"."completion_responses" add constraint "completion_responses_submitted_by_employee_id_fkey" FOREIGN KEY (submitted_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

alter table only "public"."coverage_templates" add constraint "coverage_templates_assigned_employee_id_fkey" FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

alter table only "public"."coverage_templates" add constraint "coverage_templates_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."daily_absence_overrides" add constraint "daily_absence_overrides_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."daily_group_assignments" add constraint "daily_group_assignments_assigned_employee_id_fkey" FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

alter table only "public"."daily_group_assignments" add constraint "daily_group_assignments_derived_from_employee_id_fkey" FOREIGN KEY (derived_from_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

alter table only "public"."daily_group_assignments" add constraint "daily_group_assignments_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."daily_schedule_assignments" add constraint "daily_schedule_assignments_assigned_employee_id_fkey" FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

alter table only "public"."daily_schedule_assignments" add constraint "daily_schedule_assignments_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."daily_work_roster" add constraint "daily_work_roster_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."device_aliases" add constraint "device_aliases_canonical_device_id_fkey" FOREIGN KEY (canonical_device_id) REFERENCES devices(id) ON DELETE CASCADE;

alter table only "public"."device_auth_credentials" add constraint "device_auth_credentials_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;

alter table only "public"."device_auth_enrollment_codes" add constraint "device_auth_enrollment_codes_consumed_by_credential_id_fkey" FOREIGN KEY (consumed_by_credential_id) REFERENCES device_auth_credentials(credential_id) ON DELETE SET NULL;

alter table only "public"."device_auth_enrollment_codes" add constraint "device_auth_enrollment_codes_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;

alter table only "public"."device_auth_events" add constraint "device_auth_events_credential_id_fkey" FOREIGN KEY (credential_id) REFERENCES device_auth_credentials(credential_id) ON DELETE SET NULL;

alter table only "public"."device_auth_events" add constraint "device_auth_events_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

alter table only "public"."device_location_proximity_status" add constraint "device_location_proximity_status_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;

alter table only "public"."device_location_proximity_status" add constraint "device_location_proximity_status_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

alter table only "public"."device_sync_status" add constraint "device_sync_status_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;

alter table only "public"."devices" add constraint "devices_assigned_employee_id_fkey" FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

alter table only "public"."employee_aliases" add constraint "employee_aliases_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_area_familiarity" add constraint "employee_area_familiarity_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_area_familiarity" add constraint "employee_area_familiarity_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."employee_area_preferences" add constraint "employee_area_preferences_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_area_preferences" add constraint "employee_area_preferences_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."employee_backup_group_assignments" add constraint "employee_backup_group_assignments_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_backup_group_assignments" add constraint "employee_backup_group_assignments_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."employee_group_proximity" add constraint "employee_group_proximity_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_group_proximity" add constraint "employee_group_proximity_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."employee_location_group_assignments" add constraint "employee_location_group_assignments_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_location_group_assignments" add constraint "employee_location_group_assignments_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."employee_planned_time_off" add constraint "employee_planned_time_off_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_primary_group_assignments" add constraint "employee_primary_group_assignments_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_primary_group_assignments" add constraint "employee_primary_group_assignments_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."employee_pto" add constraint "employee_pto_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_shift_overrides" add constraint "employee_shift_overrides_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_shift_templates" add constraint "employee_shift_templates_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_zone_assignments" add constraint "employee_zone_assignments_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."employee_zone_assignments" add constraint "employee_zone_assignments_zone_id_fkey" FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE;

alter table only "public"."event_area_aliases" add constraint "event_area_aliases_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."events_app_events" add constraint "events_app_events_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE RESTRICT;

alter table only "public"."events_app_notification_log" add constraint "events_app_notification_log_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

alter table only "public"."events_app_notification_log" add constraint "events_app_notification_log_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events_app_events(id) ON DELETE CASCADE;

alter table only "public"."events_app_notification_log" add constraint "events_app_notification_log_msg_user_id_fkey" FOREIGN KEY (msg_user_id) REFERENCES msg_users(id) ON DELETE SET NULL;

alter table only "public"."events_app_notification_log" add constraint "events_app_notification_log_response_message_id_fkey" FOREIGN KEY (response_message_id) REFERENCES msg_messages(id) ON DELETE SET NULL;

alter table only "public"."events_app_notification_log" add constraint "events_app_notification_log_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES msg_threads(id) ON DELETE SET NULL;

alter table only "public"."location_coverage_templates" add constraint "location_coverage_templates_assigned_employee_id_fkey" FOREIGN KEY (assigned_employee_id) REFERENCES employees(id);

alter table only "public"."location_coverage_templates" add constraint "location_coverage_templates_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id);

alter table only "public"."location_coverage_templates" add constraint "location_coverage_templates_source_location_group_id_fkey" FOREIGN KEY (source_location_group_id) REFERENCES location_groups(id);

alter table only "public"."location_group_adjacency" add constraint "location_group_adjacency_from_location_group_id_fkey" FOREIGN KEY (from_location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."location_group_adjacency" add constraint "location_group_adjacency_to_location_group_id_fkey" FOREIGN KEY (to_location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."location_group_aliases" add constraint "location_group_aliases_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."location_group_memberships" add constraint "location_group_memberships_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."location_group_memberships" add constraint "location_group_memberships_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

alter table only "public"."location_group_proximity_settings" add constraint "location_group_proximity_settings_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id);

alter table only "public"."location_group_scoring" add constraint "location_group_scoring_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE CASCADE;

alter table only "public"."location_group_workload_settings" add constraint "location_group_workload_settings_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id);

alter table only "public"."location_group_zone_assignments" add constraint "location_group_zone_assignments_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id);

alter table only "public"."location_group_zone_assignments" add constraint "location_group_zone_assignments_zone_id_fkey" FOREIGN KEY (zone_id) REFERENCES zones(id);

alter table only "public"."location_proximity_settings" add constraint "location_proximity_settings_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id);

alter table only "public"."location_zone_assignments" add constraint "location_zone_assignments_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

alter table only "public"."location_zone_assignments" add constraint "location_zone_assignments_zone_id_fkey" FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE;

alter table only "public"."maintenance_tickets" add constraint "maintenance_tickets_completion_response_id_fkey" FOREIGN KEY (completion_response_id) REFERENCES completion_responses(id) ON DELETE SET NULL;

alter table only "public"."maintenance_tickets" add constraint "maintenance_tickets_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

alter table only "public"."maintenance_tickets" add constraint "maintenance_tickets_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;

alter table only "public"."maintenance_tickets" add constraint "maintenance_tickets_reported_by_employee_id_fkey" FOREIGN KEY (reported_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

alter table only "public"."maintenance_tickets" add constraint "maintenance_tickets_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

alter table only "public"."msg_broadcast_recipients" add constraint "msg_broadcast_recipients_broadcast_id_fkey" FOREIGN KEY (broadcast_id) REFERENCES msg_broadcasts(id) ON DELETE CASCADE;

alter table only "public"."msg_broadcast_recipients" add constraint "msg_broadcast_recipients_user_id_fkey" FOREIGN KEY (user_id) REFERENCES msg_users(id) ON DELETE CASCADE;

alter table only "public"."msg_broadcasts" add constraint "msg_broadcasts_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES msg_users(id) ON DELETE RESTRICT;

alter table only "public"."msg_broadcasts" add constraint "msg_broadcasts_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES msg_threads(id) ON DELETE SET NULL;

alter table only "public"."msg_device_assignments" add constraint "msg_device_assignments_msg_user_id_fkey" FOREIGN KEY (msg_user_id) REFERENCES msg_users(id) ON DELETE CASCADE;

alter table only "public"."msg_hidden_threads_by_device" add constraint "msg_hidden_threads_by_device_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES msg_threads(id) ON DELETE CASCADE;

alter table only "public"."msg_memphis_thread_context" add constraint "msg_memphis_thread_context_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES msg_threads(id) ON DELETE CASCADE;

alter table only "public"."msg_message_deletions" add constraint "msg_message_deletions_message_id_fkey" FOREIGN KEY (message_id) REFERENCES msg_messages(id) ON DELETE CASCADE;

alter table only "public"."msg_message_deletions" add constraint "msg_message_deletions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES msg_users(id) ON DELETE CASCADE;

alter table only "public"."msg_messages" add constraint "msg_messages_sender_user_id_fkey" FOREIGN KEY (sender_user_id) REFERENCES msg_users(id) ON DELETE RESTRICT;

alter table only "public"."msg_messages" add constraint "msg_messages_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES msg_threads(id) ON DELETE CASCADE;

alter table only "public"."msg_receipts" add constraint "msg_receipts_message_id_fkey" FOREIGN KEY (message_id) REFERENCES msg_messages(id) ON DELETE CASCADE;

alter table only "public"."msg_receipts" add constraint "msg_receipts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES msg_users(id) ON DELETE CASCADE;

alter table only "public"."msg_thread_participants" add constraint "msg_thread_participants_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES msg_threads(id) ON DELETE CASCADE;

alter table only "public"."msg_thread_participants" add constraint "msg_thread_participants_user_id_fkey" FOREIGN KEY (user_id) REFERENCES msg_users(id) ON DELETE CASCADE;

alter table only "public"."msg_thread_visibility" add constraint "msg_thread_visibility_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES msg_threads(id) ON DELETE CASCADE;

alter table only "public"."msg_thread_visibility" add constraint "msg_thread_visibility_user_id_fkey" FOREIGN KEY (user_id) REFERENCES msg_users(id) ON DELETE CASCADE;

alter table only "public"."msg_threads" add constraint "msg_threads_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES msg_users(id) ON DELETE RESTRICT;

alter table only "public"."msg_users" add constraint "msg_users_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;

alter table only "public"."ops_manager_auth_events" add constraint "ops_manager_auth_events_credential_id_fkey" FOREIGN KEY (credential_id) REFERENCES ops_manager_trusted_devices(credential_id) ON DELETE SET NULL;

alter table only "public"."ops_manager_weekly_schedules" add constraint "ops_manager_weekly_schedules_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES internal_ops_contacts(id) ON DELETE CASCADE;

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_assigned_employee_id_fkey" FOREIGN KEY (assigned_employee_id) REFERENCES employees(id);

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_escalation_msg_message_id_fkey" FOREIGN KEY (escalation_msg_message_id) REFERENCES msg_messages(id);

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_escalation_msg_thread_id_fkey" FOREIGN KEY (escalation_msg_thread_id) REFERENCES msg_threads(id);

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_escalation_msg_user_id_fkey" FOREIGN KEY (escalation_msg_user_id) REFERENCES msg_users(id);

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id);

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_msg_message_id_fkey" FOREIGN KEY (msg_message_id) REFERENCES msg_messages(id);

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_msg_thread_id_fkey" FOREIGN KEY (msg_thread_id) REFERENCES msg_threads(id);

alter table only "public"."scan_alert_notification_log" add constraint "scan_alert_notification_log_msg_user_id_fkey" FOREIGN KEY (msg_user_id) REFERENCES msg_users(id);

alter table only "public"."scan_events" add constraint "scan_events_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

alter table only "public"."scan_events" add constraint "scan_events_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;

alter table only "public"."scan_events" add constraint "scan_events_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

alter table only "public"."schedule_candidate_scores" add constraint "schedule_candidate_scores_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id);

alter table only "public"."schedule_candidate_scores" add constraint "schedule_candidate_scores_run_id_fkey" FOREIGN KEY (run_id) REFERENCES schedule_generation_runs(id) ON DELETE CASCADE;

alter table only "public"."schedule_candidate_scores" add constraint "schedule_candidate_scores_work_item_id_fkey" FOREIGN KEY (work_item_id) REFERENCES schedule_work_items(id) ON DELETE CASCADE;

alter table only "public"."schedule_manual_locks" add constraint "schedule_manual_locks_assigned_employee_id_fkey" FOREIGN KEY (assigned_employee_id) REFERENCES employees(id);

alter table only "public"."schedule_manual_locks" add constraint "schedule_manual_locks_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id);

alter table only "public"."schedule_publish_audit" add constraint "schedule_publish_audit_run_id_fkey" FOREIGN KEY (run_id) REFERENCES schedule_generation_runs(id);

alter table only "public"."schedule_solution_assignments" add constraint "schedule_solution_assignments_assigned_employee_id_fkey" FOREIGN KEY (assigned_employee_id) REFERENCES employees(id);

alter table only "public"."schedule_solution_assignments" add constraint "schedule_solution_assignments_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id);

alter table only "public"."schedule_solution_assignments" add constraint "schedule_solution_assignments_run_id_fkey" FOREIGN KEY (run_id) REFERENCES schedule_generation_runs(id) ON DELETE CASCADE;

alter table only "public"."schedule_solution_assignments" add constraint "schedule_solution_assignments_work_item_id_fkey" FOREIGN KEY (work_item_id) REFERENCES schedule_work_items(id) ON DELETE CASCADE;

alter table only "public"."schedule_work_items" add constraint "schedule_work_items_location_group_id_fkey" FOREIGN KEY (location_group_id) REFERENCES location_groups(id);

alter table only "public"."schedule_work_items" add constraint "schedule_work_items_run_id_fkey" FOREIGN KEY (run_id) REFERENCES schedule_generation_runs(id) ON DELETE CASCADE;

alter table only "public"."session_events" add constraint "session_events_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;

alter table only "public"."sessions" add constraint "sessions_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE RESTRICT;

alter table only "public"."sessions" add constraint "sessions_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;

alter table only "public"."sessions" add constraint "sessions_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;

alter table only "public"."system_logs" add constraint "system_logs_device_id_fkey" FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

alter table only "public"."system_logs" add constraint "system_logs_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;

alter table only "public"."system_logs" add constraint "system_logs_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

create view "public"."v_approved_devices" as
 SELECT d.id AS device_pk,
    d.device_id,
    d.device_name,
    d.active,
    e.display_name AS assigned_employee_name,
    d.notes,
    d.last_seen_at,
    d.created_at,
    d.updated_at
   FROM devices d
     LEFT JOIN employees e ON e.id = d.assigned_employee_id;;

create view "public"."v_demo_scan_mock_today_assigned_locations" as
 SELECT DISTINCT ON (dsa.service_date, l.id, dsa.assigned_employee_id, dsa.coverage_purpose) dsa.service_date,
    LEAST(dsa.coverage_start, '05:15:00'::time without time zone) AS coverage_start,
    GREATEST(dsa.coverage_end, '16:00:00'::time without time zone) AS coverage_end,
    dsa.coverage_purpose,
    lg.group_name,
    l.id AS location_id,
    l.location_code,
    l.location_name,
    l.form_type,
    COALESCE(l.sort_order, 999999) AS sort_order,
    e.id AS employee_id,
    e.display_name AS employee_name
   FROM daily_schedule_assignments dsa
     JOIN location_groups lg ON lg.id = dsa.location_group_id AND lg.active = true
     JOIN location_group_memberships lgm ON lgm.location_group_id = dsa.location_group_id AND lgm.active = true
     JOIN locations l ON l.id = lgm.location_id AND l.active = true
     JOIN employees e ON e.id = dsa.assigned_employee_id AND e.active = true
  WHERE dsa.status = 'ASSIGNED'::text AND dsa.assigned_employee_id IS NOT NULL AND dsa.coverage_purpose <> 'late_coverage'::text AND (l.form_type = ANY (ARRAY['restroom'::text, 'exhibit'::text]))
  ORDER BY dsa.service_date, l.id, dsa.assigned_employee_id, dsa.coverage_purpose, dsa.coverage_start;;

create view "public"."v_device_health" as
 SELECT d.id AS device_pk,
    d.device_id,
    d.device_name,
    d.active,
    d.last_seen_at,
        CASE
            WHEN d.last_seen_at IS NULL THEN 'Never seen'::text
            ELSE to_char(timezone('America/Chicago'::text, d.last_seen_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text
        END AS last_seen_at_display,
    now() - d.last_seen_at AS last_seen_age,
        CASE
            WHEN d.last_seen_at IS NULL THEN 'never_seen'::text
            WHEN d.last_seen_at >= (now() - '01:00:00'::interval) THEN 'healthy'::text
            WHEN d.last_seen_at >= (now() - '24:00:00'::interval) THEN 'stale'::text
            ELSE 'offline'::text
        END AS health_status,
    e.display_name AS assigned_employee_name
   FROM devices d
     LEFT JOIN employees e ON e.id = d.assigned_employee_id
  WHERE d.active = true;;

create view "public"."v_last_cleaned_by_location" as
 SELECT l.id AS location_id,
    l.location_code,
    l.location_name,
    l.location_type,
    s.id AS session_id,
    s.session_uuid,
    s.status,
    s.started_at,
    s.ended_at,
    s.duration_minutes,
    s.duration_display,
    e.id AS employee_id,
    e.display_name AS cleaned_by,
    d.id AS device_pk,
    d.device_id,
    row_number() OVER (PARTITION BY l.id ORDER BY s.started_at DESC NULLS LAST) AS rn
   FROM locations l
     LEFT JOIN sessions s ON s.location_id = l.id AND s.status = 'closed'::text
     LEFT JOIN employees e ON e.id = s.employee_id
     LEFT JOIN devices d ON d.id = s.device_id;;

create view "public"."v_location_dashboard_status" as
 WITH op_day AS (
         SELECT operational_day_start(now()) AS day_start
        ), latest_scan AS (
         SELECT se.location_id,
            max(COALESCE(se.scanned_at, se.created_at)) AS last_scan_at
           FROM scan_events se
          GROUP BY se.location_id
        ), open_session AS (
         SELECT DISTINCT ON (s.location_id) s.location_id,
            s.id AS session_id,
            s.session_uuid,
            s.status AS session_status,
            s.started_at,
            s.ended_at,
            s.duration_minutes,
            s.duration_display,
            e.display_name AS employee_name,
            d.device_id AS device_identifier
           FROM sessions s
             LEFT JOIN employees e ON e.id = s.employee_id
             LEFT JOIN devices d ON d.id = s.device_id
          WHERE s.status = ANY (ARRAY['active'::text, 'pending_submit'::text])
          ORDER BY s.location_id, s.started_at DESC, s.created_at DESC
        ), latest_completed AS (
         SELECT DISTINCT ON (s.location_id) s.location_id,
            s.id AS session_id,
            s.session_uuid,
            s.started_at,
            s.ended_at,
            s.duration_minutes,
            s.duration_display,
            e.display_name AS employee_name,
            cr.submitted_at,
            cr.response_json,
            COALESCE(cr.submitted_at, s.ended_at, s.started_at) AS effective_completed_at
           FROM sessions s
             JOIN employees e ON e.id = s.employee_id
             LEFT JOIN completion_responses cr ON cr.session_id = s.id
             CROSS JOIN op_day od_1
          WHERE s.status = 'closed'::text AND COALESCE(cr.submitted_at, s.ended_at, s.started_at) >= od_1.day_start
          ORDER BY s.location_id, (COALESCE(cr.submitted_at, s.ended_at, s.started_at)) DESC, s.started_at DESC
        ), open_tickets AS (
         SELECT mt.location_id,
            count(*) AS open_ticket_count
           FROM maintenance_tickets mt
          WHERE mt.status = 'open'::text
          GROUP BY mt.location_id
        )
 SELECT l.id AS location_id,
    l.location_code,
    l.location_name,
    l.location_type,
    l.form_type,
    od.day_start AS operational_day_start,
    ls.last_scan_at,
    os.session_id AS open_session_id,
    os.session_uuid AS open_session_uuid,
    os.session_status AS open_session_status,
    os.started_at AS open_session_started_at,
    os.ended_at AS open_session_ended_at,
    lc.session_id AS latest_completed_session_id,
    lc.session_uuid AS latest_completed_session_uuid,
    lc.started_at AS latest_started_at,
    lc.ended_at AS latest_ended_at,
    lc.submitted_at AS latest_submitted_at,
    lc.effective_completed_at AS latest_completed_at,
    lc.employee_name AS latest_employee_name,
    lc.duration_minutes,
    lc.duration_display,
    COALESCE(lc.response_json -> 'services_performed'::text, lc.response_json -> 'servicesPerformed'::text, lc.response_json -> 'services'::text, lc.response_json -> 'completed_services'::text, lc.response_json -> 'completedServices'::text, '[]'::jsonb) AS services_performed,
    COALESCE(lc.response_json ->> 'notes'::text, lc.response_json ->> 'cleaning_notes'::text, lc.response_json ->> 'cleaningNotes'::text, lc.response_json ->> 'maintenance_notes'::text, lc.response_json ->> 'maintenanceNotes'::text, lc.response_json ->> 'other_service_performed'::text, lc.response_json ->> 'otherServicePerformed'::text, lc.response_json ->> 'note'::text) AS notes,
    COALESCE(ot.open_ticket_count, 0::bigint) AS open_ticket_count,
        CASE
            WHEN os.session_status = ANY (ARRAY['active'::text, 'pending_submit'::text]) THEN 'in_progress'::text
            WHEN lc.effective_completed_at IS NULL THEN 'not_cleaned'::text
            WHEN l.form_type = 'restroom'::text AND now() >= (lc.effective_completed_at + make_interval(mins => get_setting_int('restroom_overdue_minutes'::text, 120))) THEN 'overdue'::text
            WHEN l.form_type = 'restroom'::text AND now() >= (lc.effective_completed_at + make_interval(mins => get_setting_int('restroom_due_soon_minutes'::text, 90))) THEN 'due_soon'::text
            WHEN l.form_type = 'exhibit'::text AND now() >= (lc.effective_completed_at + make_interval(mins => get_setting_int('exhibit_overdue_minutes'::text, 240))) THEN 'overdue'::text
            WHEN l.form_type = 'exhibit'::text AND now() >= (lc.effective_completed_at + make_interval(mins => get_setting_int('exhibit_due_soon_minutes'::text, 195))) THEN 'due_soon'::text
            ELSE 'okay'::text
        END AS status_code,
        CASE
            WHEN os.session_status = ANY (ARRAY['active'::text, 'pending_submit'::text]) THEN 'blue'::text
            WHEN lc.effective_completed_at IS NULL THEN 'black'::text
            WHEN l.form_type = 'restroom'::text AND now() >= (lc.effective_completed_at + make_interval(mins => get_setting_int('restroom_overdue_minutes'::text, 120))) THEN 'red'::text
            WHEN l.form_type = 'restroom'::text AND now() >= (lc.effective_completed_at + make_interval(mins => get_setting_int('restroom_due_soon_minutes'::text, 90))) THEN 'yellow'::text
            WHEN l.form_type = 'exhibit'::text AND now() >= (lc.effective_completed_at + make_interval(mins => get_setting_int('exhibit_overdue_minutes'::text, 240))) THEN 'red'::text
            WHEN l.form_type = 'exhibit'::text AND now() >= (lc.effective_completed_at + make_interval(mins => get_setting_int('exhibit_due_soon_minutes'::text, 195))) THEN 'yellow'::text
            ELSE 'green'::text
        END AS status_color,
    to_char(timezone('America/Chicago'::text, od.day_start), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS operational_day_start_display,
    to_char(timezone('America/Chicago'::text, ls.last_scan_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS last_scan_at_display,
    to_char(timezone('America/Chicago'::text, os.started_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS open_session_started_at_display,
    to_char(timezone('America/Chicago'::text, os.ended_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS open_session_ended_at_display,
    to_char(timezone('America/Chicago'::text, lc.started_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS latest_started_at_display,
    to_char(timezone('America/Chicago'::text, lc.ended_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS latest_ended_at_display,
    to_char(timezone('America/Chicago'::text, lc.submitted_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS latest_submitted_at_display,
    to_char(timezone('America/Chicago'::text, lc.effective_completed_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS latest_completed_at_display,
    os.employee_name AS open_session_employee_name,
    os.device_identifier AS open_session_device_identifier
   FROM locations l
     CROSS JOIN op_day od
     LEFT JOIN latest_scan ls ON ls.location_id = l.id
     LEFT JOIN open_session os ON os.location_id = l.id
     LEFT JOIN latest_completed lc ON lc.location_id = l.id
     LEFT JOIN open_tickets ot ON ot.location_id = l.id
  WHERE l.active = true;;

create view "public"."v_location_status" as
 WITH ranked AS (
         SELECT l.id AS location_id,
            l.location_code,
            l.location_name,
            l.location_type,
            l.active AS location_active,
            s.id AS session_id,
            s.session_uuid,
            s.status AS session_status,
            s.started_at,
            s.ended_at,
            s.duration_minutes,
            s.duration_display,
            e.display_name AS employee_name,
            d.device_id,
            row_number() OVER (PARTITION BY l.id ORDER BY s.started_at DESC NULLS LAST) AS rn
           FROM locations l
             LEFT JOIN sessions s ON s.location_id = l.id
             LEFT JOIN employees e ON e.id = s.employee_id
             LEFT JOIN devices d ON d.id = s.device_id
        )
 SELECT location_id,
    location_code,
    location_name,
    location_type,
    location_active,
    session_id,
    session_uuid,
    session_status,
    started_at,
    ended_at,
    duration_minutes,
    duration_display,
    employee_name,
    device_id
   FROM ranked
  WHERE rn = 1;;

create view "public"."v_memphis_area_schedule" as
 SELECT dsa.service_date,
    lg.id AS location_group_id,
    lg.group_code,
    lg.group_name,
    dsa.segment_number,
    dsa.assigned_employee_id,
    e.display_name AS assigned_employee_name,
    e.employee_code,
    to_char(dsa.coverage_start::interval, 'HH24:MI'::text) AS coverage_start,
    to_char(dsa.coverage_end::interval, 'HH24:MI'::text) AS coverage_end,
    dsa.status,
    dsa.owner_type,
    dsa.load_points,
    dsa.source_type,
    dsa.notes
   FROM daily_schedule_assignments dsa
     JOIN location_groups lg ON lg.id = dsa.location_group_id
     LEFT JOIN employees e ON e.id = dsa.assigned_employee_id;;

create view "public"."v_memphis_employee_load_summary" as
 SELECT dsa.service_date,
    dsa.assigned_employee_id AS employee_id,
    e.display_name AS employee_name,
    e.employee_code,
    count(*) FILTER (WHERE dsa.status = 'ASSIGNED'::text)::integer AS assigned_segments,
    COALESCE(sum(dsa.load_points) FILTER (WHERE dsa.status = 'ASSIGNED'::text), 0::numeric) AS assigned_load_points,
    COALESCE(sum(EXTRACT(epoch FROM dsa.coverage_end - dsa.coverage_start) / 60::numeric) FILTER (WHERE dsa.status = 'ASSIGNED'::text), 0::numeric) AS assigned_minutes,
    count(*) FILTER (WHERE dsa.status = 'ASSIGNED'::text AND COALESCE(dsa.source_type, ''::text) ~~ '%auto_reassigned%'::text)::integer AS open_gap_coverage_count
   FROM daily_schedule_assignments dsa
     JOIN employees e ON e.id = dsa.assigned_employee_id
  GROUP BY dsa.service_date, dsa.assigned_employee_id, e.display_name, e.employee_code;;

create view "public"."v_memphis_employee_schedule" as
 SELECT dsa.service_date,
    dsa.assigned_employee_id AS employee_id,
    e.display_name AS employee_name,
    e.employee_code,
    lg.id AS location_group_id,
    lg.group_code,
    lg.group_name,
    dsa.segment_number,
    to_char(dsa.coverage_start::interval, 'HH24:MI'::text) AS coverage_start,
    to_char(dsa.coverage_end::interval, 'HH24:MI'::text) AS coverage_end,
    dsa.status,
    dsa.owner_type,
    dsa.load_points,
    dsa.source_type,
    dsa.notes
   FROM daily_schedule_assignments dsa
     JOIN location_groups lg ON lg.id = dsa.location_group_id
     LEFT JOIN employees e ON e.id = dsa.assigned_employee_id
  WHERE dsa.assigned_employee_id IS NOT NULL;;

create view "public"."v_memphis_open_segments" as
 SELECT dsa.service_date,
    lg.id AS location_group_id,
    lg.group_code,
    lg.group_name,
    dsa.segment_number,
    to_char(dsa.coverage_start::interval, 'HH24:MI'::text) AS coverage_start,
    to_char(dsa.coverage_end::interval, 'HH24:MI'::text) AS coverage_end,
    dsa.notes,
        CASE
            WHEN dsa.notes ~~* '%off%'::text THEN 'template owner off'::text
            WHEN dsa.notes ~~* '%absent%'::text THEN 'absence impact'::text
            WHEN dsa.source_type ~~* '%open%'::text THEN 'open coverage'::text
            ELSE 'no active coverage'::text
        END AS reason_open
   FROM daily_schedule_assignments dsa
     JOIN location_groups lg ON lg.id = dsa.location_group_id
  WHERE dsa.status = 'OPEN'::text;;

create view "public"."v_open_maintenance_tickets" as
 SELECT mt.id AS ticket_id,
    COALESCE(mt.location_code_snapshot, l.location_code) AS location_code,
    COALESCE(mt.location_name_snapshot, l.location_name) AS location_name,
    mt.reported_at AS date_submitted,
    mt.issue_summary AS maintenance_issue,
    COALESCE(mt.reporter_name_snapshot, e.display_name) AS reported_by,
    mt.fixture_type,
    mt.fixture_identifier,
    mt.out_of_order,
    mt.status,
    mt.issue_payload,
    mt.close_notes,
    mt.created_at,
    to_char(timezone('America/Chicago'::text, mt.reported_at), 'MM/DD/YYYY'::text) AS date_submitted_date_display,
    to_char(timezone('America/Chicago'::text, mt.reported_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS date_submitted_display,
    to_char(timezone('America/Chicago'::text, mt.created_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS created_at_display
   FROM maintenance_tickets mt
     LEFT JOIN locations l ON l.id = mt.location_id
     LEFT JOIN employees e ON e.id = mt.reported_by_employee_id
  WHERE mt.status = 'open'::text;;

create view "public"."v_recent_scan_activity" as
 SELECT s.session_uuid,
    l.location_code,
    l.location_name,
    l.form_type,
    e.display_name AS employee_name,
    d.device_id AS device_identifier,
    d.device_name,
    s.status,
    s.started_at,
    to_char(timezone('America/Chicago'::text, s.started_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS started_at_display,
    s.ended_at,
    to_char(timezone('America/Chicago'::text, s.ended_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS ended_at_display,
    cr.submitted_at,
    to_char(timezone('America/Chicago'::text, cr.submitted_at), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS submitted_at_display,
    s.duration_minutes,
    s.duration_display,
    COALESCE(cr.response_json -> 'services_performed'::text, cr.response_json -> 'servicesPerformed'::text, cr.response_json -> 'services'::text, cr.response_json -> 'completed_services'::text, cr.response_json -> 'completedServices'::text, '[]'::jsonb) AS services_performed,
    COALESCE(cr.response_json ->> 'notes'::text, cr.response_json ->> 'cleaning_notes'::text, cr.response_json ->> 'cleaningNotes'::text, cr.response_json ->> 'maintenance_notes'::text, cr.response_json ->> 'maintenanceNotes'::text, cr.response_json ->> 'other_service_performed'::text, cr.response_json ->> 'otherServicePerformed'::text, cr.response_json ->> 'note'::text) AS notes,
    COALESCE(mt.open_ticket_count, 0::bigint) AS open_ticket_count
   FROM sessions s
     JOIN locations l ON l.id = s.location_id
     JOIN employees e ON e.id = s.employee_id
     LEFT JOIN devices d ON d.id = s.device_id
     LEFT JOIN completion_responses cr ON cr.session_id = s.id
     LEFT JOIN ( SELECT maintenance_tickets.session_id,
            count(*) AS open_ticket_count
           FROM maintenance_tickets
          WHERE maintenance_tickets.status = 'open'::text
          GROUP BY maintenance_tickets.session_id) mt ON mt.session_id = s.id
  ORDER BY (COALESCE(cr.submitted_at, s.ended_at, s.started_at)) DESC, s.created_at DESC;;

create view "public"."v_restroom_check_timers" as
 WITH restroom_locations AS (
         SELECT lg.id AS location_group_id,
            lg.group_code,
            lg.group_name,
            l.id AS location_id,
            l.location_code,
            l.location_name
           FROM location_groups lg
             JOIN location_group_memberships lgm ON lgm.location_group_id = lg.id AND lgm.active = true
             JOIN locations l ON l.id = lgm.location_id AND l.active = true
          WHERE lg.active = true AND lower(COALESCE(l.form_type, l.location_type, ''::text)) = 'restroom'::text AND sch_is_public_restroom_group(lg.id) AND NOT (l.location_name ~~* '%East Admin%'::text OR l.location_name ~~* '%West Admin%'::text OR l.location_name ~~* '%Elephant Trunk%'::text)
        ), latest_completion AS (
         SELECT DISTINCT ON (rl_1.location_id) rl_1.location_id,
            COALESCE(cr.submitted_at, s.ended_at, s.started_at) AS last_completed_at,
            e.display_name AS last_completed_by,
            d.device_id AS last_completed_device
           FROM restroom_locations rl_1
             LEFT JOIN sessions s ON s.location_id = rl_1.location_id AND s.started_at >= sch_service_date(now())::timestamp with time zone AND (s.status = ANY (ARRAY['completed'::text, 'pending_submit'::text, 'active'::text]))
             LEFT JOIN completion_responses cr ON cr.session_id = s.id
             LEFT JOIN employees e ON e.id = COALESCE(cr.submitted_by_employee_id, s.employee_id)
             LEFT JOIN devices d ON d.id = COALESCE(cr.device_id, s.device_id)
          ORDER BY rl_1.location_id, (COALESCE(cr.submitted_at, s.ended_at, s.started_at)) DESC NULLS LAST
        ), current_owner AS (
         SELECT DISTINCT ON (dsa.location_group_id) dsa.location_group_id,
            dsa.assigned_employee_id,
            e.display_name AS assigned_owner,
            dsa.coverage_start,
            dsa.coverage_end,
            dsa.coverage_purpose,
            dsa.status
           FROM daily_schedule_assignments dsa
             LEFT JOIN employees e ON e.id = dsa.assigned_employee_id
          WHERE dsa.service_date = sch_service_date(now()) AND timezone('America/Chicago'::text, now())::time without time zone >= dsa.coverage_start AND timezone('America/Chicago'::text, now())::time without time zone < dsa.coverage_end
          ORDER BY dsa.location_group_id, (
                CASE
                    WHEN dsa.coverage_purpose = ANY (ARRAY['restroom_check'::text, 'restroom_upkeep'::text, 'area_owner'::text]) THEN 0
                    ELSE 1
                END), dsa.coverage_start DESC
        )
 SELECT sch_service_date(now()) AS service_date,
    rl.location_group_id,
    rl.group_code,
    rl.group_name AS schedule_package_name,
    rl.location_id,
    rl.location_code,
    rl.location_name AS scanned_restroom_name,
    lc.last_completed_at,
    timezone('America/Chicago'::text, lc.last_completed_at) AS last_completed_at_central,
    lc.last_completed_by,
    lc.last_completed_device,
        CASE
            WHEN lc.last_completed_at IS NOT NULL THEN lc.last_completed_at + '02:00:00'::interval
            ELSE NULL::timestamp with time zone
        END AS next_check_due_at,
        CASE
            WHEN lc.last_completed_at IS NOT NULL THEN timezone('America/Chicago'::text, lc.last_completed_at + '02:00:00'::interval)
            ELSE NULL::timestamp without time zone
        END AS next_check_due_at_central,
        CASE
            WHEN lc.last_completed_at IS NULL THEN 'not_cleaned_yet'::text
            WHEN (lc.last_completed_at + '02:00:00'::interval) <= now() THEN 'overdue'::text
            WHEN (lc.last_completed_at + '02:00:00'::interval) <= (now() + '00:30:00'::interval) THEN 'due_soon'::text
            ELSE 'ok'::text
        END AS timer_status,
        CASE
            WHEN lc.last_completed_at IS NOT NULL THEN round(EXTRACT(epoch FROM lc.last_completed_at + '02:00:00'::interval - now()) / 60.0)::integer
            ELSE NULL::integer
        END AS minutes_until_due,
    co.assigned_employee_id,
    co.assigned_owner,
    to_char(co.coverage_start::interval, 'HH24:MI'::text) AS owner_coverage_start,
    to_char(co.coverage_end::interval, 'HH24:MI'::text) AS owner_coverage_end,
    co.coverage_purpose,
    co.status AS owner_status,
        CASE
            WHEN lc.last_completed_at IS NOT NULL THEN 'scan_completion'::text
            ELSE 'no_scan_today'::text
        END AS timer_source
   FROM restroom_locations rl
     LEFT JOIN latest_completion lc ON lc.location_id = rl.location_id
     LEFT JOIN current_owner co ON co.location_group_id = rl.location_group_id;;

create view "public"."v_sch2_constraint_violations" as
 WITH solution AS (
         SELECT sa.id,
            sa.run_id,
            sa.work_item_id,
            sa.service_date,
            sa.location_group_id,
            sa.segment_number,
            sa.assigned_employee_id,
            sa.owner_type,
            sa.coverage_start,
            sa.coverage_end,
            sa.coverage_purpose,
            sa.status,
            sa.source_type,
            sa.source_daily_assignment_id,
            sa.load_points,
            sa.assignment_reason,
            sa.score_total,
            sa.score_breakdown,
            sa.notes,
            sa.created_at,
            wi.required,
            wi.may_be_open,
            wi.scan_required,
            wi.is_public_restroom,
            wi.hard_rule_tags,
            lg.group_code,
            lg.group_name,
            e.display_name AS employee_name,
            e.employee_code
           FROM schedule_solution_assignments sa
             JOIN schedule_work_items wi ON wi.id = sa.work_item_id
             JOIN location_groups lg ON lg.id = sa.location_group_id
             LEFT JOIN employees e ON e.id = sa.assigned_employee_id
        ), lunch_windows AS (
         SELECT s.id,
            s.run_id,
            s.work_item_id,
            s.service_date,
            s.location_group_id,
            s.segment_number,
            s.assigned_employee_id,
            s.owner_type,
            s.coverage_start,
            s.coverage_end,
            s.coverage_purpose,
            s.status,
            s.source_type,
            s.source_daily_assignment_id,
            s.load_points,
            s.assignment_reason,
            s.score_total,
            s.score_breakdown,
            s.notes,
            s.created_at,
            s.required,
            s.may_be_open,
            s.scan_required,
            s.is_public_restroom,
            s.hard_rule_tags,
            s.group_code,
            s.group_name,
            s.employee_name,
            s.employee_code,
            lw.lunch_start,
            lw.lunch_end
           FROM solution s
             LEFT JOIN LATERAL sch_lunch_window_for_employee(s.service_date, s.assigned_employee_id) lw(lunch_start, lunch_end) ON s.assigned_employee_id IS NOT NULL
        )
 SELECT s.run_id,
    s.service_date,
    s.work_item_id,
    s.id AS assignment_id,
    s.location_group_id,
    s.assigned_employee_id,
    'open_required'::text AS violation_type,
    'hard'::text AS severity,
    (((('Required work item is OPEN or missing owner: '::text || s.group_name) || ' '::text) || s.coverage_start) || '-'::text) || s.coverage_end AS detail
   FROM solution s
  WHERE s.required = true AND (s.status <> 'ASSIGNED'::text OR s.assigned_employee_id IS NULL)
UNION ALL
 SELECT s.run_id,
    s.service_date,
    s.work_item_id,
    s.id AS assignment_id,
    s.location_group_id,
    s.assigned_employee_id,
    'restricted_assignment'::text AS violation_type,
    'hard'::text AS severity,
    (('Restricted assignment: '::text || COALESCE(s.employee_name, 'OPEN'::text)) || ' -> '::text) || s.group_name AS detail
   FROM solution s
  WHERE s.assigned_employee_id IS NOT NULL AND sch_is_employee_location_group_restricted(s.assigned_employee_id, s.location_group_id, EXTRACT(dow FROM s.service_date)::integer)
UNION ALL
 SELECT s.run_id,
    s.service_date,
    s.work_item_id,
    s.id AS assignment_id,
    s.location_group_id,
    s.assigned_employee_id,
    'herpetarium_wednesday'::text AS violation_type,
    'hard'::text AS severity,
    'Herpetarium must not be scheduled on Wednesday'::text AS detail
   FROM solution s
  WHERE s.group_code = 'HERPETARIUM'::text AND EXTRACT(dow FROM s.service_date)::integer = 3 AND (s.coverage_purpose = ANY (ARRAY['deep_clean'::text, 'area_owner'::text, 'restroom_upkeep'::text, 'lunch_coverage'::text]))
UNION ALL
 SELECT s.run_id,
    s.service_date,
    s.work_item_id,
    s.id AS assignment_id,
    s.location_group_id,
    s.assigned_employee_id,
    'response_only_group_has_normal_work'::text AS violation_type,
    'hard'::text AS severity,
    'Primate Canyon/Cat Country must stay No Clean / Calls to Location Only'::text AS detail
   FROM solution s
  WHERE (s.group_code = ANY (ARRAY['PRIMATE_CANYON'::text, 'CAT_COUNTRY'::text])) AND (s.coverage_purpose = ANY (ARRAY['deep_clean'::text, 'area_owner'::text, 'restroom_upkeep'::text, 'lunch_coverage'::text]))
UNION ALL
 SELECT s.run_id,
    s.service_date,
    s.work_item_id,
    s.id AS assignment_id,
    s.location_group_id,
    s.assigned_employee_id,
    'gift_shop_not_monday_0800_reminder'::text AS violation_type,
    'hard'::text AS severity,
    'Gift shops are Monday 8:00 reminder-only work, not scan-cleaning work'::text AS detail
   FROM solution s
  WHERE (s.group_code ~~ '%GIFT_SHOP%'::text OR (s.group_code = ANY (ARRAY['TRADING_POST'::text, 'TRADING_POST_GIFT_SHOP'::text]))) AND NOT (EXTRACT(dow FROM s.service_date)::integer = 1 AND s.coverage_purpose = 'reminder'::text AND s.coverage_start = '08:00:00'::time without time zone AND s.coverage_end <= '09:45:00'::time without time zone)
UNION ALL
 SELECT lw.run_id,
    lw.service_date,
    lw.work_item_id,
    lw.id AS assignment_id,
    lw.location_group_id,
    lw.assigned_employee_id,
    'lunch_coverage_same_lunch_overlap'::text AS violation_type,
    'hard'::text AS severity,
    (((('same_lunch / overlap / lunch_coverage violation: '::text || COALESCE(lw.employee_name, 'OPEN'::text)) || ' has lunch '::text) || COALESCE(lw.lunch_start::text, '?'::text)) || '-'::text) || COALESCE(lw.lunch_end::text, '?'::text) AS detail
   FROM lunch_windows lw
  WHERE lw.coverage_purpose = 'lunch_coverage'::text AND lw.lunch_start IS NOT NULL AND lw.lunch_end IS NOT NULL AND lw.lunch_start < lw.coverage_end AND lw.lunch_end > lw.coverage_start
UNION ALL
 SELECT s.run_id,
    s.service_date,
    s.work_item_id,
    s.id AS assignment_id,
    s.location_group_id,
    s.assigned_employee_id,
    'Michael_EMP002_regular_assignment'::text AS violation_type,
    'hard'::text AS severity,
    'Michael / EMP002 is afternoon-call visibility only and must not be balanced into regular morning/restroom/lunch work'::text AS detail
   FROM solution s
  WHERE s.assigned_employee_id IS NOT NULL AND (s.employee_code = 'EMP002'::text OR s.employee_name ~~* 'Michael McWright'::text) AND NOT ((s.coverage_purpose = ANY (ARRAY['restroom_upkeep'::text, 'late_coverage'::text])) AND s.coverage_start >= '09:45:00'::time without time zone AND s.coverage_start < '18:00:00'::time without time zone)
UNION ALL
 SELECT s.run_id,
    s.service_date,
    s.work_item_id,
    s.id AS assignment_id,
    s.location_group_id,
    s.assigned_employee_id,
    'restroom_0945_missing_assignment'::text AS violation_type,
    'hard'::text AS severity,
    '09:45 / 0945 restroom protection: public restroom has no assigned owner through rebalance window'::text AS detail
   FROM solution s
  WHERE s.is_public_restroom = true AND s.coverage_start <= '09:45:00'::time without time zone AND s.coverage_end > '09:45:00'::time without time zone AND (s.status <> 'ASSIGNED'::text OR s.assigned_employee_id IS NULL);;

create view "public"."v_sch2_publish_diff" as
 WITH preview_rows AS (
         SELECT r.id AS run_id,
            sa.service_date,
            sa.location_group_id,
            sa.segment_number,
            sa.coverage_start,
            sa.coverage_end,
            sa.coverage_purpose,
            sa.assigned_employee_id,
            sa.owner_type,
            sa.status,
            sa.load_points
           FROM schedule_generation_runs r
             JOIN schedule_solution_assignments sa ON sa.run_id = r.id
        ), current_rows AS (
         SELECT r.id AS run_id,
            dsa.service_date,
            dsa.location_group_id,
            dsa.segment_number,
            dsa.coverage_start,
            dsa.coverage_end,
            dsa.coverage_purpose,
            dsa.assigned_employee_id,
            dsa.owner_type,
            dsa.status,
            dsa.load_points
           FROM schedule_generation_runs r
             JOIN daily_schedule_assignments dsa ON dsa.service_date = r.service_date
        )
 SELECT COALESCE(p.run_id, c.run_id) AS run_id,
    COALESCE(p.service_date, c.service_date) AS service_date,
    COALESCE(p.location_group_id, c.location_group_id) AS location_group_id,
    COALESCE(p.segment_number, c.segment_number) AS segment_number,
    COALESCE(p.coverage_start, c.coverage_start) AS coverage_start,
    COALESCE(p.coverage_end, c.coverage_end) AS coverage_end,
    COALESCE(p.coverage_purpose, c.coverage_purpose) AS coverage_purpose,
        CASE
            WHEN c.location_group_id IS NULL THEN 'preview_only'::text
            WHEN p.location_group_id IS NULL THEN 'current_only'::text
            WHEN p.assigned_employee_id IS DISTINCT FROM c.assigned_employee_id OR p.owner_type IS DISTINCT FROM c.owner_type OR p.status IS DISTINCT FROM c.status OR p.load_points IS DISTINCT FROM c.load_points THEN 'changed'::text
            ELSE 'same'::text
        END AS diff_type,
    c.assigned_employee_id AS current_employee_id,
    p.assigned_employee_id AS preview_employee_id,
    c.status AS current_status,
    p.status AS preview_status,
    c.load_points AS current_load_points,
    p.load_points AS preview_load_points
   FROM preview_rows p
     FULL JOIN current_rows c ON c.run_id = p.run_id AND c.location_group_id = p.location_group_id AND c.segment_number = p.segment_number AND c.coverage_start = p.coverage_start AND c.coverage_end = p.coverage_end AND c.coverage_purpose = p.coverage_purpose;;

create view "public"."v_sch2_route_audit" as
 WITH employee_routes AS (
         SELECT sa.run_id,
            sa.assigned_employee_id AS employee_id,
            count(DISTINCT COALESCE(wi.route_zone, 'unknown'::text))::integer AS route_zone_count,
            COALESCE(sch_group_route_spread_penalty(array_agg(DISTINCT sa.location_group_id)), 0::numeric) AS route_spread_penalty
           FROM schedule_solution_assignments sa
             JOIN schedule_work_items wi ON wi.id = sa.work_item_id
          WHERE sa.status = 'ASSIGNED'::text AND sa.assigned_employee_id IS NOT NULL AND (sa.coverage_purpose <> ALL (ARRAY['reminder'::text, 'response_only'::text]))
          GROUP BY sa.run_id, sa.assigned_employee_id
        )
 SELECT run_id,
    employee_id,
    route_zone_count,
    route_spread_penalty,
    route_zone_count > 3 OR route_spread_penalty > 18::numeric AS route_spread_violation,
        CASE
            WHEN route_zone_count > 3 OR route_spread_penalty > 18::numeric THEN 'route_spread_high'::text
            ELSE NULL::text
        END AS violation_type
   FROM employee_routes;;

create view "public"."v_sch2_workload_audit" as
 WITH regular_roster AS (
         SELECT r.id AS run_id,
            dwr.employee_id
           FROM schedule_generation_runs r
             JOIN daily_work_roster dwr ON dwr.service_date = r.service_date AND dwr.active = true
             JOIN employees e ON e.id = dwr.employee_id AND e.active = true
             LEFT JOIN daily_absence_overrides dao ON dao.absence_date = r.service_date AND dao.employee_id = dwr.employee_id AND dao.active = true
          WHERE dao.id IS NULL AND COALESCE(e.employee_code, ''::text) <> 'EMP002'::text
        ), employee_counts AS (
         SELECT regular_roster.run_id,
            count(DISTINCT regular_roster.employee_id)::numeric AS regular_employee_count
           FROM regular_roster
          GROUP BY regular_roster.run_id
        ), work_totals AS (
         SELECT schedule_work_items.run_id,
            COALESCE(sum(schedule_work_items.load_points) FILTER (WHERE schedule_work_items.required = true), 0::numeric) AS total_required_load,
            count(DISTINCT schedule_work_items.location_group_id) FILTER (WHERE schedule_work_items.required = true)::numeric AS total_required_locations
           FROM schedule_work_items
          GROUP BY schedule_work_items.run_id
        ), targets AS (
         SELECT wt.run_id,
            COALESCE(wt.total_required_load / NULLIF(ec.regular_employee_count, 0::numeric), 0::numeric) AS target_required_load,
            COALESCE(wt.total_required_locations / NULLIF(ec.regular_employee_count, 0::numeric), 0::numeric) AS target_required_location_count
           FROM work_totals wt
             LEFT JOIN employee_counts ec ON ec.run_id = wt.run_id
        ), employee_load AS (
         SELECT rr.run_id,
            rr.employee_id,
            COALESCE(sum(COALESCE(sa.load_points, 0::numeric)) FILTER (WHERE sa.status = 'ASSIGNED'::text AND wi.required = true), 0::numeric) AS assigned_load_points,
            COALESCE(sum(
                CASE
                    WHEN wi.is_public_restroom THEN COALESCE(sa.load_points, 0::numeric)
                    ELSE 0::numeric
                END) FILTER (WHERE sa.status = 'ASSIGNED'::text AND wi.required = true), 0::numeric) AS restroom_load_points,
            count(sa.id) FILTER (WHERE sa.status = 'ASSIGNED'::text AND wi.required = true)::integer AS assigned_segments,
            count(DISTINCT sa.location_group_id) FILTER (WHERE sa.status = 'ASSIGNED'::text AND wi.required = true)::integer AS required_location_count
           FROM regular_roster rr
             LEFT JOIN schedule_solution_assignments sa ON sa.run_id = rr.run_id AND sa.assigned_employee_id = rr.employee_id AND (sa.coverage_purpose <> ALL (ARRAY['reminder'::text, 'response_only'::text, 'late_coverage'::text]))
             LEFT JOIN schedule_work_items wi ON wi.id = sa.work_item_id
          GROUP BY rr.run_id, rr.employee_id
        ), spread AS (
         SELECT el.run_id,
            el.employee_id,
            el.assigned_load_points,
            el.restroom_load_points,
            el.assigned_segments,
            el.required_location_count,
            t.target_required_load,
            t.target_required_location_count,
            max(el.assigned_load_points) OVER (PARTITION BY el.run_id) - min(el.assigned_load_points) OVER (PARTITION BY el.run_id) AS workload_spread,
            max(el.required_location_count) OVER (PARTITION BY el.run_id) - min(el.required_location_count) OVER (PARTITION BY el.run_id) AS location_count_spread
           FROM employee_load el
             LEFT JOIN targets t ON t.run_id = el.run_id
        )
 SELECT run_id,
    employee_id,
    assigned_load_points,
    restroom_load_points,
    workload_spread,
    assigned_segments,
    required_location_count,
    target_required_load,
    target_required_location_count,
    location_count_spread,
        CASE
            WHEN location_count_spread > 1 THEN 'location_count_spread_high'::text
            WHEN workload_spread > GREATEST(6::numeric, COALESCE(target_required_load, 0::numeric) * 0.35) THEN 'workload_spread_high'::text
            ELSE NULL::text
        END AS violation_type
   FROM spread;;

create view "public"."v_schedule_adjusted_load_summary" as
 SELECT ct.day_of_week,
        CASE ct.day_of_week
            WHEN 0 THEN 'Sunday'::text
            WHEN 1 THEN 'Monday'::text
            WHEN 2 THEN 'Tuesday'::text
            WHEN 3 THEN 'Wednesday'::text
            WHEN 4 THEN 'Thursday'::text
            WHEN 5 THEN 'Friday'::text
            WHEN 6 THEN 'Saturday'::text
            ELSE NULL::text
        END AS weekday,
    e.id AS employee_id,
    e.display_name AS assigned_employee,
    ct.coverage_purpose,
    count(*) AS segment_count,
    sum(sch_group_load_points(lg.id)) AS raw_load_points,
    sum(sch_group_adjusted_load_points(lg.id)) AS adjusted_location_load_points,
    sch_group_route_spread_penalty(array_agg(lg.id)) AS route_spread_penalty,
    sum(sch_group_adjusted_load_points(lg.id)) + sch_group_route_spread_penalty(array_agg(lg.id)) AS total_adjusted_load_points,
    min(ct.coverage_start) AS coverage_start_min,
    max(ct.coverage_end) AS coverage_end_max
   FROM coverage_templates ct
     JOIN location_groups lg ON lg.id = ct.location_group_id
     JOIN employees e ON e.id = ct.assigned_employee_id
  WHERE ct.active = true
  GROUP BY ct.day_of_week, e.id, e.display_name, ct.coverage_purpose;;

create view "public"."v_schedule_display_duplicates" as
 SELECT service_date,
    assigned_employee_id,
    location_group_id,
    coverage_start,
    coverage_end,
    coverage_purpose,
    status,
    segment_number,
    count(*)::integer AS duplicate_count,
    array_agg(id ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST) AS assignment_ids
   FROM daily_schedule_assignments
  GROUP BY service_date, assigned_employee_id, location_group_id, coverage_start, coverage_end, coverage_purpose, status, segment_number
 HAVING count(*) > 1;;

create view "public"."v_schedule_location_group_zones" as
 SELECT lg.id AS location_group_id,
    lg.group_code,
    lg.group_name,
    lg.active AS group_active,
    z.id AS zone_id,
    z.zone_code,
    z.zone_name,
    lgza.active AS zone_assignment_active,
    lgza.notes
   FROM location_groups lg
     LEFT JOIN location_group_zone_assignments lgza ON lgza.location_group_id = lg.id AND lgza.active = true
     LEFT JOIN zones z ON z.id = lgza.zone_id AND z.active = true;;

create view "public"."v_scheduler_group_score_components" as
 WITH base AS (
         SELECT lg.id AS location_group_id,
            lg.group_code,
            lg.group_name,
            lgps.working_cluster,
            sch_group_load_points(lg.id) AS raw_load_points,
            sch_group_difficulty_points(lg.id) AS difficulty_points,
            sch_group_priority_points(lg.id) AS priority_points,
            sch_group_proximity_points(lg.id) AS proximity_points,
            sch_group_adjusted_load_points(lg.id) AS adjusted_load_points
           FROM location_groups lg
             LEFT JOIN location_group_proximity_settings lgps ON lgps.location_group_id = lg.id AND lgps.active = true
          WHERE lg.active = true
        ), bounds AS (
         SELECT min(base.difficulty_points) AS min_difficulty,
            max(base.difficulty_points) AS max_difficulty,
            min(base.priority_points) AS min_priority,
            max(base.priority_points) AS max_priority,
            min(base.proximity_points) AS min_proximity,
            max(base.proximity_points) AS max_proximity
           FROM base
        ), weights AS (
         SELECT scheduler_scoring_settings.proximity_weight,
            scheduler_scoring_settings.difficulty_weight,
            scheduler_scoring_settings.priority_weight
           FROM scheduler_scoring_settings
          WHERE scheduler_scoring_settings.setting_code = 'default'::text AND scheduler_scoring_settings.active = true
         LIMIT 1
        )
 SELECT b.location_group_id,
    b.group_code,
    b.group_name,
    b.working_cluster,
    b.raw_load_points,
    b.difficulty_points,
    b.priority_points,
    b.proximity_points,
    b.adjusted_load_points,
    sch_normalize_score(b.difficulty_points, bounds.min_difficulty, bounds.max_difficulty) AS difficulty_score_0_100,
    sch_normalize_score(b.priority_points, bounds.min_priority, bounds.max_priority) AS priority_score_0_100,
    sch_normalize_score(b.proximity_points, bounds.min_proximity, bounds.max_proximity) AS proximity_score_0_100,
    round(sch_normalize_score(b.proximity_points, bounds.min_proximity, bounds.max_proximity) * COALESCE(w.proximity_weight, 0.50) + sch_normalize_score(b.difficulty_points, bounds.min_difficulty, bounds.max_difficulty) * COALESCE(w.difficulty_weight, 0.25) + sch_normalize_score(b.priority_points, bounds.min_priority, bounds.max_priority) * COALESCE(w.priority_weight, 0.25), 2) AS scheduler_group_score_0_100
   FROM base b
     CROSS JOIN bounds
     CROSS JOIN weights w;;

create view "public"."v_admin_health_snapshot" as
 WITH cfg AS (
         SELECT get_setting_int('stale_session_timeout_minutes'::text, 120) AS stale_timeout_minutes,
            get_setting_int('scan_history_warning_mb'::text, 350) AS scan_history_warning_mb,
            operational_day_start(now()) AS operational_day_start
        ), storage AS (
         SELECT scan_history_storage_summary() AS summary
        ), counts AS (
         SELECT ( SELECT count(*) AS count
                   FROM sessions
                  WHERE sessions.status = 'active'::text) AS active_sessions,
            ( SELECT count(*) AS count
                   FROM sessions
                  WHERE sessions.status = 'pending_submit'::text) AS pending_submit_sessions,
            ( SELECT count(*) AS count
                   FROM sessions
                  WHERE sessions.status = 'closed'::text AND COALESCE(sessions.ended_at, sessions.started_at, sessions.created_at) >= (( SELECT cfg.operational_day_start
                           FROM cfg))) AS closed_sessions_today,
            ( SELECT count(*) AS count
                   FROM v_open_maintenance_tickets) AS open_ticket_count,
            ( SELECT count(*) AS count
                   FROM v_location_dashboard_status
                  WHERE v_location_dashboard_status.status_code = 'overdue'::text) AS overdue_locations,
            ( SELECT count(*) AS count
                   FROM v_location_dashboard_status
                  WHERE v_location_dashboard_status.status_code = 'due_soon'::text) AS due_soon_locations,
            ( SELECT count(*) AS count
                   FROM v_location_dashboard_status
                  WHERE v_location_dashboard_status.status_code = 'in_progress'::text) AS in_progress_locations,
            ( SELECT count(*) AS count
                   FROM locations
                  WHERE locations.active = true) AS active_locations,
            ( SELECT count(*) AS count
                   FROM devices
                  WHERE devices.active = true) AS active_devices,
            ( SELECT count(*) AS count
                   FROM devices
                  WHERE devices.active = true AND devices.last_seen_at >= (now() - '24:00:00'::interval)) AS devices_seen_last_24h,
            ( SELECT count(*) AS count
                   FROM devices
                  WHERE devices.active = true AND (devices.last_seen_at IS NULL OR devices.last_seen_at < (now() - '24:00:00'::interval))) AS devices_missing_recent_heartbeat,
            ( SELECT count(*) AS count
                   FROM sessions s_1
                  WHERE (s_1.status = ANY (ARRAY['active'::text, 'pending_submit'::text])) AND COALESCE(s_1.ended_at, s_1.started_at) <= (now() - make_interval(mins => ( SELECT cfg.stale_timeout_minutes
                           FROM cfg)))) AS stale_open_sessions,
            ( SELECT count(*) AS count
                   FROM system_logs
                  WHERE (system_logs.level = ANY (ARRAY['WARN'::text, 'ERROR'::text])) AND system_logs.created_at >= (now() - '24:00:00'::interval)) AS warn_error_logs_last_24h
        )
 SELECT now() AS snapshot_at,
    ( SELECT cfg.operational_day_start
           FROM cfg) AS operational_day_start,
    ( SELECT cfg.stale_timeout_minutes
           FROM cfg) AS stale_timeout_minutes,
    ( SELECT cfg.scan_history_warning_mb
           FROM cfg) AS scan_history_warning_mb,
    c.active_sessions,
    c.pending_submit_sessions,
    c.closed_sessions_today,
    c.open_ticket_count,
    c.overdue_locations,
    c.due_soon_locations,
    c.in_progress_locations,
    c.active_locations,
    c.active_devices,
    c.devices_seen_last_24h,
    c.devices_missing_recent_heartbeat,
    c.stale_open_sessions,
    c.warn_error_logs_last_24h,
    s.summary AS storage_summary
   FROM counts c
     CROSS JOIN storage s;;

create view "public"."v_exception_queue" as
 SELECT 'open_ticket'::text AS exception_type,
    mt.ticket_id::text AS entity_id,
    mt.location_code,
    mt.location_name,
    mt.date_submitted AS event_at,
    mt.date_submitted_display AS event_at_display,
    mt.maintenance_issue AS summary,
    mt.reported_by AS actor,
    jsonb_build_object('fixture_type', mt.fixture_type, 'fixture_identifier', mt.fixture_identifier, 'out_of_order', mt.out_of_order, 'status', mt.status) AS details
   FROM v_open_maintenance_tickets mt
UNION ALL
 SELECT 'overdue_location'::text AS exception_type,
    v.location_id::text AS entity_id,
    v.location_code,
    v.location_name,
    v.latest_completed_at AS event_at,
    v.latest_completed_at_display AS event_at_display,
    'Location overdue for cleaning'::text AS summary,
    v.latest_employee_name AS actor,
    jsonb_build_object('form_type', v.form_type, 'status_code', v.status_code, 'status_color', v.status_color, 'open_ticket_count', v.open_ticket_count) AS details
   FROM v_location_dashboard_status v
  WHERE v.status_code = 'overdue'::text
UNION ALL
 SELECT 'stale_device'::text AS exception_type,
    d.id::text AS entity_id,
    NULL::text AS location_code,
    d.device_name AS location_name,
    GREATEST(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) AS event_at,
        CASE
            WHEN GREATEST(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) IS NULL THEN 'Never seen'::text
            ELSE to_char(timezone('America/Chicago'::text, GREATEST(d.last_seen_at, ds.last_server_ack_at, ds.updated_at)), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text
        END AS event_at_display,
    'Device missing recent heartbeat'::text AS summary,
    d.device_id AS actor,
    jsonb_build_object('device_id', d.device_id, 'active', d.active, 'last_seen_at', d.last_seen_at, 'last_server_ack_at', ds.last_server_ack_at, 'sync_updated_at', ds.updated_at) AS details
   FROM devices d
     LEFT JOIN device_sync_status ds ON ds.device_id = d.id
  WHERE d.active = true AND d.assigned_employee_id IS NOT NULL AND (GREATEST(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) IS NULL OR GREATEST(d.last_seen_at, ds.last_server_ack_at, ds.updated_at) < (now() - '24:00:00'::interval))
UNION ALL
 SELECT 'stale_open_session'::text AS exception_type,
    s.session_uuid AS entity_id,
    l.location_code,
    l.location_name,
    COALESCE(s.ended_at, s.started_at) AS event_at,
    to_char(timezone('America/Chicago'::text, COALESCE(s.ended_at, s.started_at)), 'MM/DD/YYYY HH12:MI AM'::text) || ' Central'::text AS event_at_display,
    'Open session exceeded stale timeout'::text AS summary,
    e.display_name AS actor,
    jsonb_build_object('status', s.status, 'device_id', d.device_id, 'started_at', s.started_at, 'ended_at', s.ended_at) AS details
   FROM sessions s
     JOIN locations l ON l.id = s.location_id
     JOIN employees e ON e.id = s.employee_id
     LEFT JOIN devices d ON d.id = s.device_id
  WHERE (s.status = ANY (ARRAY['active'::text, 'pending_submit'::text])) AND COALESCE(s.ended_at, s.started_at) <= (now() - make_interval(mins => get_setting_int('stale_session_timeout_minutes'::text, 120)));;

create view "public"."v_memphis_absence_coverage" as
 SELECT dao.absence_date AS service_date,
    dao.employee_id AS absent_employee_id,
    ae.display_name AS absent_employee_name,
    dsa.group_code,
    dsa.group_name,
    dsa.segment_number,
    dsa.coverage_start,
    dsa.coverage_end,
    dsa.assigned_employee_id,
    dsa.assigned_employee_name,
        CASE
            WHEN dsa.status = 'ASSIGNED'::text THEN 'COVERED'::text
            ELSE 'OPEN'::text
        END AS coverage_status,
        CASE
            WHEN dsa.status = 'ASSIGNED'::text THEN COALESCE(dsa.source_type, 'assigned'::text)
            ELSE 'open_no_coverage'::text
        END AS reassignment_reason,
    dsa.notes
   FROM daily_absence_overrides dao
     JOIN employees ae ON ae.id = dao.employee_id
     LEFT JOIN v_memphis_area_schedule dsa ON dsa.service_date = dao.absence_date AND dsa.notes ~~* (('%'::text || ae.display_name) || '%'::text)
  WHERE dao.active = true;;

create view "public"."v_restroom_package_status" as
 SELECT service_date,
    location_group_id,
    group_code,
    schedule_package_name,
    count(*)::integer AS restroom_count,
    count(*) FILTER (WHERE timer_status <> 'not_cleaned_yet'::text)::integer AS cleaned_count,
    count(*) FILTER (WHERE timer_status = 'not_cleaned_yet'::text)::integer AS not_cleaned_count,
    count(*) FILTER (WHERE timer_status = 'due_soon'::text)::integer AS due_soon_count,
    count(*) FILTER (WHERE timer_status = 'overdue'::text)::integer AS overdue_count,
    min(next_check_due_at) FILTER (WHERE next_check_due_at IS NOT NULL) AS next_package_due_at,
    min(next_check_due_at_central) FILTER (WHERE next_check_due_at_central IS NOT NULL) AS next_package_due_at_central,
    assigned_employee_id,
    assigned_owner,
    owner_coverage_start,
    owner_coverage_end,
        CASE
            WHEN count(*) FILTER (WHERE timer_status = 'overdue'::text) > 0 THEN 'overdue'::text
            WHEN count(*) FILTER (WHERE timer_status = 'due_soon'::text) > 0 THEN 'due_soon'::text
            WHEN count(*) FILTER (WHERE timer_status = 'not_cleaned_yet'::text) = count(*) THEN 'not_cleaned_yet'::text
            WHEN count(*) FILTER (WHERE timer_status = 'not_cleaned_yet'::text) > 0 THEN 'partially_cleaned'::text
            ELSE 'ok'::text
        END AS package_status
   FROM v_restroom_check_timers
  GROUP BY service_date, location_group_id, group_code, schedule_package_name, assigned_employee_id, assigned_owner, owner_coverage_start, owner_coverage_end;;

CREATE TRIGGER trg_sch_guard_operational_coverage_template BEFORE INSERT OR UPDATE OF location_group_id, day_of_week, coverage_start, coverage_end, coverage_purpose, active ON coverage_templates FOR EACH ROW EXECUTE FUNCTION sch_guard_operational_coverage_template();

CREATE TRIGGER trg_sch_guard_restricted_coverage_template BEFORE INSERT OR UPDATE OF location_group_id, day_of_week, assigned_employee_id ON coverage_templates FOR EACH ROW EXECUTE FUNCTION sch_guard_restricted_coverage_template();

CREATE TRIGGER daily_absence_overrides_regenerate_schedule AFTER INSERT OR DELETE OR UPDATE ON daily_absence_overrides FOR EACH ROW EXECUTE FUNCTION sch_daily_absence_override_regenerate_trigger();

CREATE TRIGGER trg_daily_absence_overrides_updated_at BEFORE UPDATE ON daily_absence_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_daily_group_assignments_updated_at BEFORE UPDATE ON daily_group_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_prevent_duplicate_daily_schedule_assignment BEFORE INSERT ON daily_schedule_assignments FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_daily_schedule_assignment();

CREATE TRIGGER trg_sch_apply_default_coverage_purpose BEFORE INSERT OR UPDATE OF location_group_id, assigned_employee_id, coverage_start, coverage_purpose ON daily_schedule_assignments FOR EACH ROW EXECUTE FUNCTION sch_apply_default_coverage_purpose();

CREATE TRIGGER trg_sch_guard_operational_daily_assignment BEFORE INSERT OR UPDATE OF service_date, location_group_id, coverage_start, coverage_end, coverage_purpose ON daily_schedule_assignments FOR EACH ROW EXECUTE FUNCTION sch_guard_operational_daily_assignment();

CREATE TRIGGER trg_sch_guard_restricted_daily_assignment BEFORE INSERT OR UPDATE OF service_date, location_group_id, assigned_employee_id ON daily_schedule_assignments FOR EACH ROW EXECUTE FUNCTION sch_guard_restricted_daily_assignment();

CREATE TRIGGER trg_devices_updated_at BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_employee_backup_group_assignments_updated_at BEFORE UPDATE ON employee_backup_group_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_employee_group_proximity_updated_at BEFORE UPDATE ON employee_group_proximity FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_employee_location_group_assignments_updated_at BEFORE UPDATE ON employee_location_group_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER employee_planned_time_off_sync_absences AFTER INSERT OR DELETE OR UPDATE ON employee_planned_time_off FOR EACH ROW EXECUTE FUNCTION sch_pto_absence_sync_trigger();

CREATE TRIGGER trg_employee_primary_group_assignments_updated_at BEFORE UPDATE ON employee_primary_group_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER employee_pto_sync_absences AFTER INSERT OR DELETE OR UPDATE ON employee_pto FOR EACH ROW EXECUTE FUNCTION sch_pto_absence_sync_trigger();

CREATE TRIGGER trg_employee_pto_updated_at BEFORE UPDATE ON employee_pto FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_employee_shift_overrides_updated_at BEFORE UPDATE ON employee_shift_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_employee_shift_templates_updated_at BEFORE UPDATE ON employee_shift_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_employee_zone_assignments_updated_at BEFORE UPDATE ON employee_zone_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_events_app_events_set_end_date BEFORE INSERT OR UPDATE OF event_date, end_date ON events_app_events FOR EACH ROW EXECUTE FUNCTION events_app_events_set_end_date();

CREATE TRIGGER trg_events_app_events_updated_at BEFORE UPDATE ON events_app_events FOR EACH ROW EXECUTE FUNCTION events_app_set_updated_at();

CREATE TRIGGER trg_events_app_notification_log_updated_at BEFORE UPDATE ON events_app_notification_log FOR EACH ROW EXECUTE FUNCTION events_app_set_updated_at();

CREATE TRIGGER trg_sch_guard_restricted_location_coverage_template BEFORE INSERT OR UPDATE OF location_id, day_of_week, assigned_employee_id ON location_coverage_templates FOR EACH ROW EXECUTE FUNCTION sch_guard_restricted_location_coverage_template();

CREATE TRIGGER trg_location_group_memberships_updated_at BEFORE UPDATE ON location_group_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_location_group_scoring_updated_at BEFORE UPDATE ON location_group_scoring FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_location_groups_updated_at BEFORE UPDATE ON location_groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_location_zone_assignments_updated_at BEFORE UPDATE ON location_zone_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_locations_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sync_migration_log_summary AFTER INSERT ON migration_log FOR EACH ROW EXECUTE FUNCTION sync_migration_log_summary();

CREATE TRIGGER trg_msg_memphis_pre_generate_schedule AFTER INSERT ON msg_messages FOR EACH ROW EXECUTE FUNCTION msg_memphis_pre_generate_schedule();

CREATE TRIGGER trg_msg_threads_set_updated_at BEFORE UPDATE ON msg_threads FOR EACH ROW EXECUTE FUNCTION msg_set_updated_at();

CREATE TRIGGER trg_msg_users_set_updated_at BEFORE UPDATE ON msg_users FOR EACH ROW EXECUTE FUNCTION msg_set_updated_at();

CREATE TRIGGER trg_operating_hours_updated_at BEFORE UPDATE ON operating_hours FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sch_clear_scan_alerts_after_scan_event AFTER INSERT ON scan_events FOR EACH ROW EXECUTE FUNCTION sch_clear_scan_alerts_after_scan_event();

CREATE TRIGGER trg_schedule_automation_runs_updated_at BEFORE UPDATE ON schedule_automation_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at_schedule_automation_runs();

CREATE TRIGGER trg_schedule_operational_notes_updated_at BEFORE UPDATE ON schedule_operational_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at_schedule_operational_notes();

CREATE TRIGGER trg_sessions_status_transition BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION enforce_session_status_transition();

CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_zones_updated_at BEFORE UPDATE ON zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

create policy "events_app_events_authed_read" on "public"."events_app_events" as permissive for select to "authenticated" using (true);

create policy "events_app_events_service_all" on "public"."events_app_events" as permissive for all to "service_role" using (true) with check (true);

create policy "maintenance_tickets_select_policy" on "public"."maintenance_tickets" as permissive for select to public using (true);

create policy "schedule_automation_runs_authed_read" on "public"."schedule_automation_runs" as permissive for select to "authenticated" using (true);

create policy "schedule_automation_runs_service_all" on "public"."schedule_automation_runs" as permissive for all to "service_role" using (true) with check (true);

create policy "schedule_candidate_scores_authed_read" on "public"."schedule_candidate_scores" as permissive for select to "authenticated" using (true);

create policy "schedule_candidate_scores_service_all" on "public"."schedule_candidate_scores" as permissive for all to "service_role" using (true) with check (true);

create policy "schedule_generation_runs_authed_read" on "public"."schedule_generation_runs" as permissive for select to "authenticated" using (true);

create policy "schedule_generation_runs_service_all" on "public"."schedule_generation_runs" as permissive for all to "service_role" using (true) with check (true);

create policy "schedule_manual_locks_authed_read" on "public"."schedule_manual_locks" as permissive for select to "authenticated" using (true);

create policy "schedule_manual_locks_service_all" on "public"."schedule_manual_locks" as permissive for all to "service_role" using (true) with check (true);

create policy "schedule_operational_notes_authed_read" on "public"."schedule_operational_notes" as permissive for select to "authenticated" using (true);

create policy "schedule_operational_notes_service_all" on "public"."schedule_operational_notes" as permissive for all to "service_role" using (true) with check (true);

create policy "schedule_publish_audit_authed_read" on "public"."schedule_publish_audit" as permissive for select to "authenticated" using (true);

create policy "schedule_publish_audit_service_all" on "public"."schedule_publish_audit" as permissive for all to "service_role" using (true) with check (true);

create policy "schedule_solution_assignments_authed_read" on "public"."schedule_solution_assignments" as permissive for select to "authenticated" using (true);

create policy "schedule_solution_assignments_service_all" on "public"."schedule_solution_assignments" as permissive for all to "service_role" using (true) with check (true);

create policy "schedule_work_items_authed_read" on "public"."schedule_work_items" as permissive for select to "authenticated" using (true);

create policy "schedule_work_items_service_all" on "public"."schedule_work_items" as permissive for all to "service_role" using (true) with check (true);

alter table "public"."ai_provider_access_audit" enable row level security;

alter table "public"."ai_provider_access_audit" force row level security;

alter table "public"."annie_chat_state" enable row level security;

alter table "public"."annie_chat_state" force row level security;

alter table "public"."annie_contacts" enable row level security;

alter table "public"."annie_contacts" force row level security;

alter table "public"."annie_deliverables" enable row level security;

alter table "public"."annie_deliverables" force row level security;

alter table "public"."annie_log_notes" enable row level security;

alter table "public"."annie_log_notes" force row level security;

alter table "public"."annie_log_reminders" enable row level security;

alter table "public"."annie_log_reminders" force row level security;

alter table "public"."annie_log_suggested_reminders" enable row level security;

alter table "public"."annie_log_suggested_reminders" force row level security;

alter table "public"."annie_suggested_contacts" enable row level security;

alter table "public"."annie_suggested_contacts" force row level security;

alter table "public"."completion_responses" enable row level security;

alter table "public"."completion_responses" force row level security;

alter table "public"."coverage_templates" enable row level security;

alter table "public"."coverage_templates" force row level security;

alter table "public"."current_attendance_state" enable row level security;

alter table "public"."current_attendance_state" force row level security;

alter table "public"."daily_absence_overrides" enable row level security;

alter table "public"."daily_absence_overrides" force row level security;

alter table "public"."daily_group_assignments" enable row level security;

alter table "public"."daily_group_assignments" force row level security;

alter table "public"."daily_schedule_assignments" enable row level security;

alter table "public"."daily_schedule_assignments" force row level security;

alter table "public"."daily_work_roster" enable row level security;

alter table "public"."daily_work_roster" force row level security;

alter table "public"."demo_scan_mock_runs" enable row level security;

alter table "public"."demo_scan_mock_runs" force row level security;

alter table "public"."device_aliases" enable row level security;

alter table "public"."device_aliases" force row level security;

alter table "public"."device_auth_credentials" enable row level security;

alter table "public"."device_auth_credentials" force row level security;

alter table "public"."device_auth_enrollment_codes" enable row level security;

alter table "public"."device_auth_enrollment_codes" force row level security;

alter table "public"."device_auth_events" enable row level security;

alter table "public"."device_auth_events" force row level security;

alter table "public"."device_auth_policy" enable row level security;

alter table "public"."device_auth_policy" force row level security;

alter table "public"."device_location_proximity_status" enable row level security;

alter table "public"."device_location_proximity_status" force row level security;

alter table "public"."device_notification_acknowledgements" enable row level security;

alter table "public"."device_notification_acknowledgements" force row level security;

alter table "public"."device_sync_status" enable row level security;

alter table "public"."device_sync_status" force row level security;

alter table "public"."devices" enable row level security;

alter table "public"."devices" force row level security;

alter table "public"."employee_aliases" enable row level security;

alter table "public"."employee_aliases" force row level security;

alter table "public"."employee_area_familiarity" enable row level security;

alter table "public"."employee_area_familiarity" force row level security;

alter table "public"."employee_area_preferences" enable row level security;

alter table "public"."employee_area_preferences" force row level security;

alter table "public"."employee_backup_group_assignments" enable row level security;

alter table "public"."employee_backup_group_assignments" force row level security;

alter table "public"."employee_group_proximity" enable row level security;

alter table "public"."employee_group_proximity" force row level security;

alter table "public"."employee_location_group_assignments" enable row level security;

alter table "public"."employee_location_group_assignments" force row level security;

alter table "public"."employee_planned_time_off" enable row level security;

alter table "public"."employee_planned_time_off" force row level security;

alter table "public"."employee_primary_group_assignments" enable row level security;

alter table "public"."employee_primary_group_assignments" force row level security;

alter table "public"."employee_pto" enable row level security;

alter table "public"."employee_pto" force row level security;

alter table "public"."employee_shift_overrides" enable row level security;

alter table "public"."employee_shift_overrides" force row level security;

alter table "public"."employee_shift_templates" enable row level security;

alter table "public"."employee_shift_templates" force row level security;

alter table "public"."employee_zone_assignments" enable row level security;

alter table "public"."employee_zone_assignments" force row level security;

alter table "public"."employees" enable row level security;

alter table "public"."employees" force row level security;

alter table "public"."event_area_aliases" enable row level security;

alter table "public"."event_area_aliases" force row level security;

alter table "public"."events_app_events" enable row level security;

alter table "public"."events_app_events" force row level security;

alter table "public"."events_app_notification_log" enable row level security;

alter table "public"."events_app_notification_log" force row level security;

alter table "public"."foundation_removal_archive" enable row level security;

alter table "public"."foundation_removal_archive" force row level security;

alter table "public"."guest_cleanliness_reports" enable row level security;

alter table "public"."guest_cleanliness_reports" force row level security;

alter table "public"."internal_ops_contacts" enable row level security;

alter table "public"."internal_ops_contacts" force row level security;

alter table "public"."legacy_application_write_rollups" enable row level security;

alter table "public"."legacy_application_write_rollups" force row level security;

alter table "public"."location_coverage_templates" enable row level security;

alter table "public"."location_coverage_templates" force row level security;

alter table "public"."location_group_adjacency" enable row level security;

alter table "public"."location_group_adjacency" force row level security;

alter table "public"."location_group_aliases" enable row level security;

alter table "public"."location_group_aliases" force row level security;

alter table "public"."location_group_memberships" enable row level security;

alter table "public"."location_group_memberships" force row level security;

alter table "public"."location_group_proximity_settings" enable row level security;

alter table "public"."location_group_proximity_settings" force row level security;

alter table "public"."location_group_scoring" enable row level security;

alter table "public"."location_group_scoring" force row level security;

alter table "public"."location_group_workload_settings" enable row level security;

alter table "public"."location_group_workload_settings" force row level security;

alter table "public"."location_group_zone_assignments" enable row level security;

alter table "public"."location_group_zone_assignments" force row level security;

alter table "public"."location_groups" enable row level security;

alter table "public"."location_groups" force row level security;

alter table "public"."location_proximity_settings" enable row level security;

alter table "public"."location_proximity_settings" force row level security;

alter table "public"."location_zone_assignments" enable row level security;

alter table "public"."location_zone_assignments" force row level security;

alter table "public"."locations" enable row level security;

alter table "public"."locations" force row level security;

alter table "public"."maintenance_tickets" enable row level security;

alter table "public"."maintenance_tickets" force row level security;

alter table "public"."migration_log" enable row level security;

alter table "public"."migration_log" force row level security;

alter table "public"."migration_log_summary" enable row level security;

alter table "public"."migration_log_summary" force row level security;

alter table "public"."moxie_access_audit" enable row level security;

alter table "public"."moxie_access_audit" force row level security;

alter table "public"."moxie_auth_credentials" enable row level security;

alter table "public"."moxie_auth_credentials" force row level security;

alter table "public"."msg_broadcast_recipients" enable row level security;

alter table "public"."msg_broadcast_recipients" force row level security;

alter table "public"."msg_broadcasts" enable row level security;

alter table "public"."msg_broadcasts" force row level security;

alter table "public"."msg_device_assignments" enable row level security;

alter table "public"."msg_device_assignments" force row level security;

alter table "public"."msg_hidden_threads_by_device" enable row level security;

alter table "public"."msg_hidden_threads_by_device" force row level security;

alter table "public"."msg_memphis_thread_context" enable row level security;

alter table "public"."msg_memphis_thread_context" force row level security;

alter table "public"."msg_message_deletions" enable row level security;

alter table "public"."msg_message_deletions" force row level security;

alter table "public"."msg_messages" enable row level security;

alter table "public"."msg_messages" force row level security;

alter table "public"."msg_receipts" enable row level security;

alter table "public"."msg_receipts" force row level security;

alter table "public"."msg_thread_participants" enable row level security;

alter table "public"."msg_thread_participants" force row level security;

alter table "public"."msg_thread_visibility" enable row level security;

alter table "public"."msg_thread_visibility" force row level security;

alter table "public"."msg_threads" enable row level security;

alter table "public"."msg_threads" force row level security;

alter table "public"."msg_users" enable row level security;

alter table "public"."msg_users" force row level security;

alter table "public"."operating_hours" enable row level security;

alter table "public"."operating_hours" force row level security;

alter table "public"."ops_manager_auth_events" enable row level security;

alter table "public"."ops_manager_auth_events" force row level security;

alter table "public"."ops_manager_trusted_devices" enable row level security;

alter table "public"."ops_manager_trusted_devices" force row level security;

alter table "public"."ops_manager_weekly_schedules" enable row level security;

alter table "public"."ops_manager_weekly_schedules" force row level security;

alter table "public"."release_deployment_manifest" enable row level security;

alter table "public"."release_deployment_manifest" force row level security;

alter table "public"."release_validation_runs" enable row level security;

alter table "public"."release_validation_runs" force row level security;

alter table "public"."scan_alert_notification_log" enable row level security;

alter table "public"."scan_alert_notification_log" force row level security;

alter table "public"."scan_events" enable row level security;

alter table "public"."scan_events" force row level security;

alter table "public"."schedule_assignment_archive" enable row level security;

alter table "public"."schedule_assignment_archive" force row level security;

alter table "public"."schedule_automation_runs" enable row level security;

alter table "public"."schedule_automation_runs" force row level security;

alter table "public"."schedule_candidate_scores" enable row level security;

alter table "public"."schedule_candidate_scores" force row level security;

alter table "public"."schedule_generation_runs" enable row level security;

alter table "public"."schedule_generation_runs" force row level security;

alter table "public"."schedule_manual_locks" enable row level security;

alter table "public"."schedule_manual_locks" force row level security;

alter table "public"."schedule_operational_notes" enable row level security;

alter table "public"."schedule_operational_notes" force row level security;

alter table "public"."schedule_publish_audit" enable row level security;

alter table "public"."schedule_publish_audit" force row level security;

alter table "public"."schedule_solution_assignments" enable row level security;

alter table "public"."schedule_solution_assignments" force row level security;

alter table "public"."schedule_work_items" enable row level security;

alter table "public"."schedule_work_items" force row level security;

alter table "public"."scheduler_scoring_settings" enable row level security;

alter table "public"."scheduler_scoring_settings" force row level security;

alter table "public"."session_events" enable row level security;

alter table "public"."session_events" force row level security;

alter table "public"."sessions" enable row level security;

alter table "public"."sessions" force row level security;

alter table "public"."system_feedback_items" enable row level security;

alter table "public"."system_feedback_items" force row level security;

alter table "public"."system_logs" enable row level security;

alter table "public"."system_logs" force row level security;

alter table "public"."system_settings" enable row level security;

alter table "public"."system_settings" force row level security;

alter table "public"."working_cluster_adjacency" enable row level security;

alter table "public"."working_cluster_adjacency" force row level security;

alter table "public"."zones" enable row level security;

alter table "public"."zones" force row level security;

grant delete, insert, references, select, trigger, truncate, update on table "public"."ai_provider_access_audit" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."ai_provider_access_audit" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_chat_state" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_chat_state" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_contacts" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_contacts" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_deliverables" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_deliverables" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_log_notes" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_log_notes" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_log_reminders" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_log_reminders" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_log_suggested_reminders" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_log_suggested_reminders" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_suggested_contacts" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."annie_suggested_contacts" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."completion_responses" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."completion_responses" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."coverage_templates" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."coverage_templates" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."current_attendance_state" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."current_attendance_state" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."daily_absence_overrides" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."daily_absence_overrides" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."daily_group_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."daily_group_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."daily_schedule_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."daily_schedule_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."daily_work_roster" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."daily_work_roster" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."demo_scan_mock_runs" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."demo_scan_mock_runs" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_aliases" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_aliases" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_auth_credentials" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_auth_credentials" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_auth_enrollment_codes" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_auth_enrollment_codes" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_auth_events" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_auth_events" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_auth_policy" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_auth_policy" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_location_proximity_status" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_location_proximity_status" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_notification_acknowledgements" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_notification_acknowledgements" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_sync_status" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."device_sync_status" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."devices" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."devices" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_aliases" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_aliases" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_area_familiarity" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_area_familiarity" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_area_preferences" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_area_preferences" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_backup_group_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_backup_group_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_group_proximity" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_group_proximity" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_location_group_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_location_group_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_planned_time_off" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_planned_time_off" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_primary_group_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_primary_group_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_pto" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_pto" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_shift_overrides" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_shift_overrides" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_shift_templates" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_shift_templates" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_zone_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employee_zone_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employees" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."employees" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."event_area_aliases" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."event_area_aliases" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."events_app_events" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."events_app_events" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."events_app_notification_log" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."events_app_notification_log" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."foundation_removal_archive" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."foundation_removal_archive" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."guest_cleanliness_reports" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."guest_cleanliness_reports" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."internal_ops_contacts" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."internal_ops_contacts" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."legacy_application_write_rollups" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."legacy_application_write_rollups" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_coverage_templates" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_coverage_templates" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_adjacency" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_adjacency" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_aliases" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_aliases" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_memberships" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_memberships" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_proximity_settings" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_proximity_settings" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_scoring" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_scoring" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_workload_settings" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_workload_settings" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_zone_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_group_zone_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_groups" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_groups" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_proximity_settings" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_proximity_settings" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_zone_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."location_zone_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."locations" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."locations" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."maintenance_tickets" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."maintenance_tickets" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."migration_log" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."migration_log" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."migration_log_summary" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."migration_log_summary" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."moxie_access_audit" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."moxie_access_audit" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."moxie_auth_credentials" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."moxie_auth_credentials" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_broadcast_recipients" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_broadcast_recipients" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_broadcasts" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_broadcasts" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_device_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_device_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_hidden_threads_by_device" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_hidden_threads_by_device" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_memphis_thread_context" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_memphis_thread_context" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_message_deletions" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_message_deletions" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_messages" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_messages" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_receipts" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_receipts" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_thread_participants" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_thread_participants" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_thread_visibility" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_thread_visibility" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_threads" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_threads" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_users" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."msg_users" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."operating_hours" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."operating_hours" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."ops_manager_auth_events" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."ops_manager_auth_events" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."ops_manager_trusted_devices" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."ops_manager_trusted_devices" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."ops_manager_weekly_schedules" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."ops_manager_weekly_schedules" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."release_deployment_manifest" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."release_deployment_manifest" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."release_validation_runs" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."release_validation_runs" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."scan_alert_notification_log" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."scan_alert_notification_log" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."scan_events" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."scan_events" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_assignment_archive" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_assignment_archive" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_automation_runs" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_automation_runs" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_candidate_scores" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_candidate_scores" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_generation_runs" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_generation_runs" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_manual_locks" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_manual_locks" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_operational_notes" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_operational_notes" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_publish_audit" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_publish_audit" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_solution_assignments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_solution_assignments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_work_items" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."schedule_work_items" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."scheduler_scoring_settings" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."scheduler_scoring_settings" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."session_events" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."session_events" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."sessions" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."sessions" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."system_feedback_items" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."system_feedback_items" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."system_logs" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."system_logs" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."system_settings" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."system_settings" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_admin_health_snapshot" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_admin_health_snapshot" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_approved_devices" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_approved_devices" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_demo_scan_mock_today_assigned_locations" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_demo_scan_mock_today_assigned_locations" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_device_health" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_device_health" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_exception_queue" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_exception_queue" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_last_cleaned_by_location" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_last_cleaned_by_location" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_location_dashboard_status" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_location_dashboard_status" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_location_status" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_location_status" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_absence_coverage" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_absence_coverage" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_area_schedule" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_area_schedule" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_employee_load_summary" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_employee_load_summary" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_employee_schedule" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_employee_schedule" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_open_segments" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_memphis_open_segments" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_open_maintenance_tickets" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_open_maintenance_tickets" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_recent_scan_activity" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_recent_scan_activity" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_restroom_check_timers" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_restroom_check_timers" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_restroom_package_status" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_restroom_package_status" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_sch2_constraint_violations" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_sch2_constraint_violations" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_sch2_publish_diff" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_sch2_publish_diff" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_sch2_route_audit" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_sch2_route_audit" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_sch2_workload_audit" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_sch2_workload_audit" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_schedule_adjusted_load_summary" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_schedule_adjusted_load_summary" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_schedule_display_duplicates" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_schedule_display_duplicates" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_schedule_location_group_zones" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_schedule_location_group_zones" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_scheduler_group_score_components" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."v_scheduler_group_score_components" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."working_cluster_adjacency" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."working_cluster_adjacency" to "service_role";

grant delete, insert, references, select, trigger, truncate, update on table "public"."zones" to "postgres";

grant delete, insert, references, select, trigger, truncate, update on table "public"."zones" to "service_role";

grant execute on function "public"."ack_device_notification"(p_device_identifier text, p_notification_key text, p_notification_type text, p_action text, p_metadata_json jsonb) to "postgres";

grant execute on function "public"."ack_device_notification"(p_device_identifier text, p_notification_key text, p_notification_type text, p_action text, p_metadata_json jsonb) to "service_role";

grant execute on function "public"."admin_health_summary"() to "postgres";

grant execute on function "public"."admin_health_summary"() to "service_role";

grant execute on function "public"."can_employee_start_session"(p_employee_name text) to "postgres";

grant execute on function "public"."can_employee_start_session"(p_employee_name text) to "service_role";

grant execute on function "public"."claim_event_notification"(p_event_id uuid, p_employee_id uuid, p_msg_user_id uuid, p_notification_kind text, p_scheduled_for_local text) to "postgres";

grant execute on function "public"."claim_event_notification"(p_event_id uuid, p_employee_id uuid, p_msg_user_id uuid, p_notification_kind text, p_scheduled_for_local text) to "service_role";

grant execute on function "public"."close_maintenance_ticket"(p_ticket_id uuid, p_closed_by text, p_close_notes text) to "postgres";

grant execute on function "public"."close_maintenance_ticket"(p_ticket_id uuid, p_closed_by text, p_close_notes text) to "service_role";

grant execute on function "public"."commit_cleaning_workflow"(p_client_session_id text, p_client_completion_id text, p_device_id text, p_location_code text, p_client_started_at timestamp with time zone, p_client_ended_at timestamp with time zone, p_response_json jsonb, p_scan_evidence jsonb, p_correlation_id text) to "postgres";

grant execute on function "public"."commit_cleaning_workflow"(p_client_session_id text, p_client_completion_id text, p_device_id text, p_location_code text, p_client_started_at timestamp with time zone, p_client_ended_at timestamp with time zone, p_response_json jsonb, p_scan_evidence jsonb, p_correlation_id text) to "service_role";

grant execute on function "public"."complete_session"(p_session_uuid text, p_response_json jsonb, p_submitted_by_employee_name text, p_device_id text, p_client_completion_id text) to "postgres";

grant execute on function "public"."complete_session"(p_session_uuid text, p_response_json jsonb, p_submitted_by_employee_name text, p_device_id text, p_client_completion_id text) to "service_role";

grant execute on function "public"."create_maintenance_tickets_from_response"(p_completion_response_id uuid, p_session_id uuid, p_location_id uuid, p_reported_by_employee_id uuid, p_device_id uuid, p_reported_at timestamp with time zone, p_response_json jsonb) to "postgres";

grant execute on function "public"."create_maintenance_tickets_from_response"(p_completion_response_id uuid, p_session_id uuid, p_location_id uuid, p_reported_by_employee_id uuid, p_device_id uuid, p_reported_at timestamp with time zone, p_response_json jsonb) to "service_role";

grant execute on function "public"."demo_scan_mock_advance"(p_run_id uuid) to "postgres";

grant execute on function "public"."demo_scan_mock_advance"(p_run_id uuid) to "service_role";

grant execute on function "public"."demo_scan_mock_assigned_area_tick"(p_run_id uuid) to "postgres";

grant execute on function "public"."demo_scan_mock_assigned_area_tick"(p_run_id uuid) to "service_role";

grant execute on function "public"."demo_scan_mock_begin_cycle"(p_run_id uuid) to "postgres";

grant execute on function "public"."demo_scan_mock_begin_cycle"(p_run_id uuid) to "service_role";

grant execute on function "public"."demo_scan_mock_cleanup"(p_run_id uuid) to "postgres";

grant execute on function "public"."demo_scan_mock_cleanup"(p_run_id uuid) to "service_role";

grant execute on function "public"."demo_scan_mock_complete_open_dynamic"(p_run_id uuid, p_force boolean) to "postgres";

grant execute on function "public"."demo_scan_mock_complete_open_dynamic"(p_run_id uuid, p_force boolean) to "service_role";

grant execute on function "public"."demo_scan_mock_complete_open_sessions"(p_run_id uuid, p_force boolean, p_duration_minutes integer) to "postgres";

grant execute on function "public"."demo_scan_mock_complete_open_sessions"(p_run_id uuid, p_force boolean, p_duration_minutes integer) to "service_role";

grant execute on function "public"."demo_scan_mock_cron_advance"() to "postgres";

grant execute on function "public"."demo_scan_mock_cron_advance"() to "service_role";

grant execute on function "public"."demo_scan_mock_cron_shift_tick"() to "postgres";

grant execute on function "public"."demo_scan_mock_cron_shift_tick"() to "service_role";

grant execute on function "public"."demo_scan_mock_demo_duration_minutes"(p_seed text) to "postgres";

grant execute on function "public"."demo_scan_mock_demo_duration_minutes"(p_seed text) to "service_role";

grant execute on function "public"."demo_scan_mock_preflight"() to "postgres";

grant execute on function "public"."demo_scan_mock_preflight"() to "service_role";

grant execute on function "public"."demo_scan_mock_refresh_snapshot"(p_run_id uuid) to "postgres";

grant execute on function "public"."demo_scan_mock_refresh_snapshot"(p_run_id uuid) to "service_role";

grant execute on function "public"."demo_scan_mock_shift_tick"(p_run_id uuid) to "postgres";

grant execute on function "public"."demo_scan_mock_shift_tick"(p_run_id uuid) to "service_role";

grant execute on function "public"."demo_scan_mock_start"(p_employee_count integer, p_reset_existing boolean) to "postgres";

grant execute on function "public"."demo_scan_mock_start"(p_employee_count integer, p_reset_existing boolean) to "service_role";

grant execute on function "public"."demo_scan_mock_start_shift_schedule"(p_reset_existing boolean, p_employee_count integer) to "postgres";

grant execute on function "public"."demo_scan_mock_start_shift_schedule"(p_reset_existing boolean, p_employee_count integer) to "service_role";

grant execute on function "public"."demo_scan_mock_status"(p_run_id uuid) to "postgres";

grant execute on function "public"."demo_scan_mock_status"(p_run_id uuid) to "service_role";

grant execute on function "public"."demo_scan_mock_stop"(p_run_id uuid, p_cleanup boolean) to "postgres";

grant execute on function "public"."demo_scan_mock_stop"(p_run_id uuid, p_cleanup boolean) to "service_role";

grant execute on function "public"."device_auth_auto_enforce_when_ready"() to "postgres";

grant execute on function "public"."device_auth_auto_enforce_when_ready"() to "service_role";

grant execute on function "public"."device_auth_consume_enrollment_code"(p_device_id uuid, p_code_hash text, p_credential_id uuid, p_token_hash text, p_device_label text, p_expires_at timestamp with time zone, p_user_agent_hash text, p_ip_hash text, p_metadata_json jsonb) to "postgres";

grant execute on function "public"."device_auth_consume_enrollment_code"(p_device_id uuid, p_code_hash text, p_credential_id uuid, p_token_hash text, p_device_label text, p_expires_at timestamp with time zone, p_user_agent_hash text, p_ip_hash text, p_metadata_json jsonb) to "service_role";

grant execute on function "public"."device_auth_evaluate_and_enforce"() to "postgres";

grant execute on function "public"."device_auth_evaluate_and_enforce"() to "service_role";

grant execute on function "public"."device_auth_issue_enrollment_code"(p_device_id uuid, p_code_hash text, p_created_by text, p_expires_at timestamp with time zone, p_metadata_json jsonb) to "postgres";

grant execute on function "public"."device_auth_issue_enrollment_code"(p_device_id uuid, p_code_hash text, p_created_by text, p_expires_at timestamp with time zone, p_metadata_json jsonb) to "service_role";

grant execute on function "public"."device_heartbeat"(p_device_id text, p_notes text) to "postgres";

grant execute on function "public"."device_heartbeat"(p_device_id text, p_notes text) to "service_role";

grant execute on function "public"."dismiss_device_reminder"(p_instance_key text, p_device_id text, p_reminder_kind text, p_source_id text, p_metadata_json jsonb) to "postgres";

grant execute on function "public"."dismiss_device_reminder"(p_instance_key text, p_device_id text, p_reminder_kind text, p_source_id text, p_metadata_json jsonb) to "service_role";

grant execute on function "public"."enforce_session_status_transition"() to "postgres";

grant execute on function "public"."enforce_session_status_transition"() to "service_role";

grant execute on function "public"."evaluate_location_proximity"(p_location_code text, p_device_identifier text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric, p_session_uuid text, p_client_event_id text, p_correlation_id text) to "postgres";

grant execute on function "public"."evaluate_location_proximity"(p_location_code text, p_device_identifier text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric, p_session_uuid text, p_client_event_id text, p_correlation_id text) to "service_role";

grant execute on function "public"."events_app_events_set_end_date"() to "postgres";

grant execute on function "public"."events_app_events_set_end_date"() to "service_role";

grant execute on function "public"."events_app_set_updated_at"() to "postgres";

grant execute on function "public"."events_app_set_updated_at"() to "service_role";

grant execute on function "public"."expire_stale_open_sessions"(p_now timestamp with time zone) to "postgres";

grant execute on function "public"."expire_stale_open_sessions"(p_now timestamp with time zone) to "service_role";

grant execute on function "public"."finalize_event_notification"(p_event_id uuid, p_employee_id uuid, p_notification_kind text, p_status text, p_thread_id uuid, p_response_message_id uuid, p_notes text) to "postgres";

grant execute on function "public"."finalize_event_notification"(p_event_id uuid, p_employee_id uuid, p_notification_kind text, p_status text, p_thread_id uuid, p_response_message_id uuid, p_notes text) to "service_role";

grant execute on function "public"."finish_session"(p_location_code text, p_device_id text) to "postgres";

grant execute on function "public"."finish_session"(p_location_code text, p_device_id text) to "service_role";

grant execute on function "public"."force_close_session"(p_session_uuid text, p_closed_by text, p_reason text) to "postgres";

grant execute on function "public"."force_close_session"(p_session_uuid text, p_closed_by text, p_reason text) to "service_role";

grant execute on function "public"."get_last_cleaned"(p_location text) to "postgres";

grant execute on function "public"."get_last_cleaned"(p_location text) to "service_role";

grant execute on function "public"."get_location_scan_state"(p_location_code text, p_device_id text) to "postgres";

grant execute on function "public"."get_location_scan_state"(p_location_code text, p_device_id text) to "service_role";

grant execute on function "public"."get_setting"(p_setting_key text) to "postgres";

grant execute on function "public"."get_setting"(p_setting_key text) to "service_role";

grant execute on function "public"."get_setting_bool"(p_setting_key text, p_default boolean) to "postgres";

grant execute on function "public"."get_setting_bool"(p_setting_key text, p_default boolean) to "service_role";

grant execute on function "public"."get_setting_int"(p_setting_key text, p_default integer) to "postgres";

grant execute on function "public"."get_setting_int"(p_setting_key text, p_default integer) to "service_role";

grant execute on function "public"."get_setting_text"(p_setting_key text, p_default text) to "postgres";

grant execute on function "public"."get_setting_text"(p_setting_key text, p_default text) to "service_role";

grant execute on function "public"."is_approved_device"(p_device_id text) to "postgres";

grant execute on function "public"."is_approved_device"(p_device_id text) to "service_role";

grant execute on function "public"."list_active_devices"() to "postgres";

grant execute on function "public"."list_active_devices"() to "service_role";

grant execute on function "public"."list_active_employees"() to "postgres";

grant execute on function "public"."list_active_employees"() to "service_role";

grant execute on function "public"."list_device_notification_acknowledgements"(p_device_identifier text, p_limit integer) to "postgres";

grant execute on function "public"."list_device_notification_acknowledgements"(p_device_identifier text, p_limit integer) to "service_role";

grant execute on function "public"."list_open_sessions"() to "postgres";

grant execute on function "public"."list_open_sessions"() to "service_role";

grant execute on function "public"."msg_acknowledge_message"(p_message_id uuid, p_user_id uuid, p_device_identifier text) to "postgres";

grant execute on function "public"."msg_acknowledge_message"(p_message_id uuid, p_user_id uuid, p_device_identifier text) to "service_role";

grant execute on function "public"."msg_cleanup_deleted_messages"() to "postgres";

grant execute on function "public"."msg_cleanup_deleted_messages"() to "service_role";

grant execute on function "public"."msg_create_group_thread"(p_created_by_user_id uuid, p_title text, p_member_user_ids uuid[]) to "postgres";

grant execute on function "public"."msg_create_group_thread"(p_created_by_user_id uuid, p_title text, p_member_user_ids uuid[]) to "service_role";

grant execute on function "public"."msg_delete_message"(p_message_id uuid, p_request_user_id uuid) to "postgres";

grant execute on function "public"."msg_delete_message"(p_message_id uuid, p_request_user_id uuid) to "service_role";

grant execute on function "public"."msg_delete_thread_permanently"(p_thread_id uuid) to "postgres";

grant execute on function "public"."msg_delete_thread_permanently"(p_thread_id uuid) to "service_role";

grant execute on function "public"."msg_ensure_employee_memphis_threads"() to "postgres";

grant execute on function "public"."msg_ensure_employee_memphis_threads"() to "service_role";

grant execute on function "public"."msg_get_memphis_thread_context"(p_thread_id uuid) to "postgres";

grant execute on function "public"."msg_get_memphis_thread_context"(p_thread_id uuid) to "service_role";

grant execute on function "public"."msg_get_memphis_user_id"() to "postgres";

grant execute on function "public"."msg_get_memphis_user_id"() to "service_role";

grant execute on function "public"."msg_get_or_create_direct_thread"(p_user_a uuid, p_user_b uuid) to "postgres";

grant execute on function "public"."msg_get_or_create_direct_thread"(p_user_a uuid, p_user_b uuid) to "service_role";

grant execute on function "public"."msg_get_or_create_memphis_thread"(p_user_id uuid) to "postgres";

grant execute on function "public"."msg_get_or_create_memphis_thread"(p_user_id uuid) to "service_role";

grant execute on function "public"."msg_get_user_by_device"(p_device_identifier text) to "postgres";

grant execute on function "public"."msg_get_user_by_device"(p_device_identifier text) to "service_role";

grant execute on function "public"."msg_hide_thread_for_device"(p_thread_id uuid, p_device_identifier text) to "postgres";

grant execute on function "public"."msg_hide_thread_for_device"(p_thread_id uuid, p_device_identifier text) to "service_role";

grant execute on function "public"."msg_is_runtime_identity"(p_user_id uuid) to "postgres";

grant execute on function "public"."msg_is_runtime_identity"(p_user_id uuid) to "service_role";

grant execute on function "public"."msg_is_runtime_user"(p_user_id uuid) to "postgres";

grant execute on function "public"."msg_is_runtime_user"(p_user_id uuid) to "service_role";

grant execute on function "public"."msg_list_thread_messages"(p_thread_id uuid, p_user_id uuid, p_limit integer, p_before timestamp with time zone) to "postgres";

grant execute on function "public"."msg_list_thread_messages"(p_thread_id uuid, p_user_id uuid, p_limit integer, p_before timestamp with time zone) to "service_role";

grant execute on function "public"."msg_list_threads"(p_user_id uuid) to "postgres";

grant execute on function "public"."msg_list_threads"(p_user_id uuid) to "service_role";

grant execute on function "public"."msg_list_threads_for_device"(p_user_id uuid, p_device_identifier text) to "postgres";

grant execute on function "public"."msg_list_threads_for_device"(p_user_id uuid, p_device_identifier text) to "service_role";

grant execute on function "public"."msg_list_users"(p_current_user_id uuid) to "postgres";

grant execute on function "public"."msg_list_users"(p_current_user_id uuid) to "service_role";

grant execute on function "public"."msg_mark_message_delivered"(p_message_id uuid, p_user_id uuid, p_device_identifier text) to "postgres";

grant execute on function "public"."msg_mark_message_delivered"(p_message_id uuid, p_user_id uuid, p_device_identifier text) to "service_role";

grant execute on function "public"."msg_mark_message_displayed"(p_message_id uuid, p_user_id uuid, p_device_identifier text) to "postgres";

grant execute on function "public"."msg_mark_message_displayed"(p_message_id uuid, p_user_id uuid, p_device_identifier text) to "service_role";

grant execute on function "public"."msg_mark_messages_delivered"(p_thread_id uuid, p_user_id uuid, p_message_ids uuid[]) to "postgres";

grant execute on function "public"."msg_mark_messages_delivered"(p_thread_id uuid, p_user_id uuid, p_message_ids uuid[]) to "service_role";

grant execute on function "public"."msg_mark_messages_displayed"(p_thread_id uuid, p_user_id uuid, p_message_ids uuid[]) to "postgres";

grant execute on function "public"."msg_mark_messages_displayed"(p_thread_id uuid, p_user_id uuid, p_message_ids uuid[]) to "service_role";

grant execute on function "public"."msg_mark_thread_deleted"(p_thread_id uuid, p_user_id uuid, p_device_identifier text) to "postgres";

grant execute on function "public"."msg_mark_thread_deleted"(p_thread_id uuid, p_user_id uuid, p_device_identifier text) to "service_role";

grant execute on function "public"."msg_mark_thread_read"(p_thread_id uuid, p_user_id uuid) to "postgres";

grant execute on function "public"."msg_mark_thread_read"(p_thread_id uuid, p_user_id uuid) to "service_role";

grant execute on function "public"."msg_memphis_pre_generate_schedule"() to "postgres";

grant execute on function "public"."msg_memphis_pre_generate_schedule"() to "service_role";

grant execute on function "public"."msg_purge_fully_hidden_threads"() to "postgres";

grant execute on function "public"."msg_purge_fully_hidden_threads"() to "service_role";

grant execute on function "public"."msg_purge_messages_older_than_14_days"() to "postgres";

grant execute on function "public"."msg_purge_messages_older_than_14_days"() to "service_role";

grant execute on function "public"."msg_restore_thread_visibility"(p_thread_id uuid, p_user_id uuid, p_device_identifier text) to "postgres";

grant execute on function "public"."msg_restore_thread_visibility"(p_thread_id uuid, p_user_id uuid, p_device_identifier text) to "service_role";

grant execute on function "public"."msg_send_broadcast"(p_sender_user_id uuid, p_title text, p_body text) to "postgres";

grant execute on function "public"."msg_send_broadcast"(p_sender_user_id uuid, p_title text, p_body text) to "service_role";

grant execute on function "public"."msg_send_message"(p_thread_id uuid, p_sender_user_id uuid, p_body text, p_message_type text, p_metadata_json jsonb) to "postgres";

grant execute on function "public"."msg_send_message"(p_thread_id uuid, p_sender_user_id uuid, p_body text, p_message_type text, p_metadata_json jsonb) to "service_role";

grant execute on function "public"."msg_send_message"(p_thread_id uuid, p_sender_user_id uuid, p_body text, p_message_type text, p_metadata_json jsonb, p_client_message_id text) to "postgres";

grant execute on function "public"."msg_send_message"(p_thread_id uuid, p_sender_user_id uuid, p_body text, p_message_type text, p_metadata_json jsonb, p_client_message_id text) to "service_role";

grant execute on function "public"."msg_set_memphis_thread_context"(p_thread_id uuid, p_last_intent text, p_last_employee_name text, p_last_group_name text, p_last_location_code text, p_last_service_date date, p_last_subject_type text, p_context_json jsonb) to "postgres";

grant execute on function "public"."msg_set_memphis_thread_context"(p_thread_id uuid, p_last_intent text, p_last_employee_name text, p_last_group_name text, p_last_location_code text, p_last_service_date date, p_last_subject_type text, p_context_json jsonb) to "service_role";

grant execute on function "public"."msg_set_updated_at"() to "postgres";

grant execute on function "public"."msg_set_updated_at"() to "service_role";

grant execute on function "public"."msg_unhide_thread_for_device"(p_thread_id uuid, p_device_identifier text) to "postgres";

grant execute on function "public"."msg_unhide_thread_for_device"(p_thread_id uuid, p_device_identifier text) to "service_role";

grant execute on function "public"."mz_apply_free_tier_retention"(p_now timestamp with time zone) to "postgres";

grant execute on function "public"."mz_apply_free_tier_retention"(p_now timestamp with time zone) to "service_role";

grant execute on function "public"."mz_free_tier_retention_report"() to "postgres";

grant execute on function "public"."mz_free_tier_retention_report"() to "service_role";

grant execute on function "public"."mz_retention_setting_int"(p_key text, p_default integer, p_min integer, p_max integer) to "postgres";

grant execute on function "public"."mz_retention_setting_int"(p_key text, p_default integer, p_min integer, p_max integer) to "service_role";

grant execute on function "public"."operational_day_start"(p_ref timestamp with time zone) to "postgres";

grant execute on function "public"."operational_day_start"(p_ref timestamp with time zone) to "service_role";

grant execute on function "public"."prevent_duplicate_daily_schedule_assignment"() to "postgres";

grant execute on function "public"."prevent_duplicate_daily_schedule_assignment"() to "service_role";

grant execute on function "public"."purge_closed_scan_history_before"(p_cutoff timestamp with time zone, p_requested_by text) to "postgres";

grant execute on function "public"."purge_closed_scan_history_before"(p_cutoff timestamp with time zone, p_requested_by text) to "service_role";

grant execute on function "public"."record_scan_event"(p_location_code text, p_device_identifier text, p_event_type text, p_result text, p_notes text, p_payload_json jsonb, p_client_event_id text) to "postgres";

grant execute on function "public"."record_scan_event"(p_location_code text, p_device_identifier text, p_event_type text, p_result text, p_notes text, p_payload_json jsonb, p_client_event_id text) to "service_role";

grant execute on function "public"."resolve_scan_location_code"(p_input text) to "postgres";

grant execute on function "public"."resolve_scan_location_code"(p_input text) to "service_role";

grant execute on function "public"."run_application_write"(p_name text, p_sql text) to "postgres";

grant execute on function "public"."run_application_write"(p_name text, p_sql text) to "service_role";

grant execute on function "public"."run_sql_migration"(p_name text, p_sql text) to "postgres";

grant execute on function "public"."run_sql_migration"(p_name text, p_sql text) to "service_role";

grant execute on function "public"."run_sql_readonly"(p_sql text) to "postgres";

grant execute on function "public"."run_sql_readonly"(p_sql text) to "service_role";

grant execute on function "public"."run_sql_write"(p_sql text) to "postgres";

grant execute on function "public"."run_sql_write"(p_sql text) to "service_role";

grant execute on function "public"."run_sql_write"(p_sql text, p_context text) to "postgres";

grant execute on function "public"."run_sql_write"(p_sql text, p_context text) to "service_role";

grant execute on function "public"."scan_history_storage_summary"() to "postgres";

grant execute on function "public"."scan_history_storage_summary"() to "service_role";

grant execute on function "public"."sch2_audit_solution"(p_run_id uuid) to "postgres";

grant execute on function "public"."sch2_audit_solution"(p_run_id uuid) to "service_role";

grant execute on function "public"."sch2_build_work_items"(p_service_date date) to "postgres";

grant execute on function "public"."sch2_build_work_items"(p_service_date date) to "service_role";

grant execute on function "public"."sch2_compare_current_vs_preview"(p_run_id uuid) to "postgres";

grant execute on function "public"."sch2_compare_current_vs_preview"(p_run_id uuid) to "service_role";

grant execute on function "public"."sch2_explain_assignment"(p_run_id uuid, p_work_item_id uuid) to "postgres";

grant execute on function "public"."sch2_explain_assignment"(p_run_id uuid, p_work_item_id uuid) to "service_role";

grant execute on function "public"."sch2_generate_preview"(p_service_date date, p_force boolean) to "postgres";

grant execute on function "public"."sch2_generate_preview"(p_service_date date, p_force boolean) to "service_role";

grant execute on function "public"."sch2_input_hash"(p_service_date date) to "postgres";

grant execute on function "public"."sch2_input_hash"(p_service_date date) to "service_role";

grant execute on function "public"."sch2_publish_solution"(p_run_id uuid, p_confirm boolean) to "postgres";

grant execute on function "public"."sch2_publish_solution"(p_run_id uuid, p_confirm boolean) to "service_role";

grant execute on function "public"."sch2_rollback_publish"(p_publish_audit_id uuid) to "postgres";

grant execute on function "public"."sch2_rollback_publish"(p_publish_audit_id uuid) to "service_role";

grant execute on function "public"."sch_absence_preview"(p_service_date date, p_absent_employee_ids uuid[]) to "postgres";

grant execute on function "public"."sch_absence_preview"(p_service_date date, p_absent_employee_ids uuid[]) to "service_role";

grant execute on function "public"."sch_absence_publish"(p_service_date date, p_absent_employee_ids uuid[]) to "postgres";

grant execute on function "public"."sch_absence_publish"(p_service_date date, p_absent_employee_ids uuid[]) to "service_role";

grant execute on function "public"."sch_alijah_herpetarium_monday_exception_allowed"(p_employee_id uuid, p_location_group_id uuid, p_day_of_week integer) to "postgres";

grant execute on function "public"."sch_alijah_herpetarium_monday_exception_allowed"(p_employee_id uuid, p_location_group_id uuid, p_day_of_week integer) to "service_role";

grant execute on function "public"."sch_apply_default_coverage_purpose"() to "postgres";

grant execute on function "public"."sch_apply_default_coverage_purpose"() to "service_role";

grant execute on function "public"."sch_apply_lunch_coverage"(p_service_date date) to "postgres";

grant execute on function "public"."sch_apply_lunch_coverage"(p_service_date date) to "service_role";

grant execute on function "public"."sch_apply_lunch_coverage_base_20260628"(p_service_date date) to "postgres";

grant execute on function "public"."sch_apply_lunch_coverage_base_20260628"(p_service_date date) to "service_role";

grant execute on function "public"."sch_apply_lunch_coverage_wrapper_base_20260628"(p_service_date date) to "postgres";

grant execute on function "public"."sch_apply_lunch_coverage_wrapper_base_20260628"(p_service_date date) to "service_role";

grant execute on function "public"."sch_apply_lunch_coverage_wrapper_norm_base_20260628"(p_service_date date) to "postgres";

grant execute on function "public"."sch_apply_lunch_coverage_wrapper_norm_base_20260628"(p_service_date date) to "service_role";

grant execute on function "public"."sch_assignment_adjusted_load_points"(p_employee_id uuid, p_day_of_week integer, p_purpose text) to "postgres";

grant execute on function "public"."sch_assignment_adjusted_load_points"(p_employee_id uuid, p_day_of_week integer, p_purpose text) to "service_role";

grant execute on function "public"."sch_assignment_candidate_score"(p_employee_id uuid, p_day_of_week integer, p_location_group_id uuid, p_purpose text) to "postgres";

grant execute on function "public"."sch_assignment_candidate_score"(p_employee_id uuid, p_day_of_week integer, p_location_group_id uuid, p_purpose text) to "service_role";

grant execute on function "public"."sch_audit_schedule_day"(p_service_date date) to "postgres";

grant execute on function "public"."sch_audit_schedule_day"(p_service_date date) to "service_role";

grant execute on function "public"."sch_audit_schedule_day_detail"(p_service_date date) to "postgres";

grant execute on function "public"."sch_audit_schedule_day_detail"(p_service_date date) to "service_role";

grant execute on function "public"."sch_clear_scan_alerts_after_scan_event"() to "postgres";

grant execute on function "public"."sch_clear_scan_alerts_after_scan_event"() to "service_role";

grant execute on function "public"."sch_clear_scan_alerts_for_location"(p_location_code text, p_clear_reason text) to "postgres";

grant execute on function "public"."sch_clear_scan_alerts_for_location"(p_location_code text, p_clear_reason text) to "service_role";

grant execute on function "public"."sch_coverall_printable_schedule"(p_service_date date) to "postgres";

grant execute on function "public"."sch_coverall_printable_schedule"(p_service_date date) to "service_role";

grant execute on function "public"."sch_daily_absence_override_regenerate_trigger"() to "postgres";

grant execute on function "public"."sch_daily_absence_override_regenerate_trigger"() to "service_role";

grant execute on function "public"."sch_employee_my_schedule_page"(p_service_date date, p_employee_id uuid, p_now timestamp with time zone) to "postgres";

grant execute on function "public"."sch_employee_my_schedule_page"(p_service_date date, p_employee_id uuid, p_now timestamp with time zone) to "service_role";

grant execute on function "public"."sch_employee_my_schedule_phase_v1"(p_service_date date, p_employee_id uuid, p_as_of timestamp with time zone) to "postgres";

grant execute on function "public"."sch_employee_my_schedule_phase_v1"(p_service_date date, p_employee_id uuid, p_as_of timestamp with time zone) to "service_role";

grant execute on function "public"."sch_employee_my_schedule_summary"(p_service_date date, p_employee_id uuid) to "postgres";

grant execute on function "public"."sch_employee_my_schedule_summary"(p_service_date date, p_employee_id uuid) to "service_role";

grant execute on function "public"."sch_employee_route_fit_score"(p_employee_id uuid, p_day_of_week integer, p_location_group_id uuid, p_purpose text) to "postgres";

grant execute on function "public"."sch_employee_route_fit_score"(p_employee_id uuid, p_day_of_week integer, p_location_group_id uuid, p_purpose text) to "service_role";

grant execute on function "public"."sch_ensure_current_day_schedule"() to "postgres";

grant execute on function "public"."sch_ensure_current_day_schedule"() to "service_role";

grant execute on function "public"."sch_ensure_daily_schedule"(p_service_date date, p_force boolean) to "postgres";

grant execute on function "public"."sch_ensure_daily_schedule"(p_service_date date, p_force boolean) to "service_role";

grant execute on function "public"."sch_ensure_daily_schedule"(p_service_date date, p_reason text) to "postgres";

grant execute on function "public"."sch_ensure_daily_schedule"(p_service_date date, p_reason text) to "service_role";

grant execute on function "public"."sch_ensure_schedule_window"(p_start_date date, p_days integer, p_reason text) to "postgres";

grant execute on function "public"."sch_ensure_schedule_window"(p_start_date date, p_days integer, p_reason text) to "service_role";

grant execute on function "public"."sch_extract_color_hex"(p_notes text) to "postgres";

grant execute on function "public"."sch_extract_color_hex"(p_notes text) to "service_role";

grant execute on function "public"."sch_extract_lunch_end"(p_notes text) to "postgres";

grant execute on function "public"."sch_extract_lunch_end"(p_notes text) to "service_role";

grant execute on function "public"."sch_extract_lunch_start"(p_notes text) to "postgres";

grant execute on function "public"."sch_extract_lunch_start"(p_notes text) to "service_role";

grant execute on function "public"."sch_fill_open_lunch_coverage"(p_service_date date) to "postgres";

grant execute on function "public"."sch_fill_open_lunch_coverage"(p_service_date date) to "service_role";

grant execute on function "public"."sch_format_scan_alert_message"(p_location_code text, p_alert_type text, p_minutes_until_due integer, p_at timestamp with time zone) to "postgres";

grant execute on function "public"."sch_format_scan_alert_message"(p_location_code text, p_alert_type text, p_minutes_until_due integer, p_at timestamp with time zone) to "service_role";

grant execute on function "public"."sch_generate_daily_schedule"(p_service_date date, p_force boolean) to "postgres";

grant execute on function "public"."sch_generate_daily_schedule"(p_service_date date, p_force boolean) to "service_role";

grant execute on function "public"."sch_generate_daily_schedule_privileged"(p_service_date date, p_force boolean) to "postgres";

grant execute on function "public"."sch_generate_daily_schedule_privileged"(p_service_date date, p_force boolean) to "service_role";

grant execute on function "public"."sch_get_coverage_candidates"(p_service_date date, p_location_group_id uuid, p_coverage_start time without time zone, p_coverage_end time without time zone) to "postgres";

grant execute on function "public"."sch_get_coverage_candidates"(p_service_date date, p_location_group_id uuid, p_coverage_start time without time zone, p_coverage_end time without time zone) to "service_role";

grant execute on function "public"."sch_get_current_owner"(p_location_code text, p_at timestamp with time zone) to "postgres";

grant execute on function "public"."sch_get_current_owner"(p_location_code text, p_at timestamp with time zone) to "service_role";

grant execute on function "public"."sch_get_daily_schedule"(p_service_date date) to "postgres";

grant execute on function "public"."sch_get_daily_schedule"(p_service_date date) to "service_role";

grant execute on function "public"."sch_get_daily_schedule_with_purpose"(p_service_date date) to "postgres";

grant execute on function "public"."sch_get_daily_schedule_with_purpose"(p_service_date date) to "service_role";

grant execute on function "public"."sch_get_employee_work_status"(p_service_date date, p_employee_id uuid) to "postgres";

grant execute on function "public"."sch_get_employee_work_status"(p_service_date date, p_employee_id uuid) to "service_role";

grant execute on function "public"."sch_get_location_schedule_owner"(p_location_code text, p_at timestamp with time zone) to "postgres";

grant execute on function "public"."sch_get_location_schedule_owner"(p_location_code text, p_at timestamp with time zone) to "service_role";

grant execute on function "public"."sch_get_or_create_scan_alert_thread"(p_msg_user_id uuid) to "postgres";

grant execute on function "public"."sch_get_or_create_scan_alert_thread"(p_msg_user_id uuid) to "service_role";

grant execute on function "public"."sch_get_scan_alert_owner"(p_location_code text, p_at timestamp with time zone) to "postgres";

grant execute on function "public"."sch_get_scan_alert_owner"(p_location_code text, p_at timestamp with time zone) to "service_role";

grant execute on function "public"."sch_get_schedule_close_time"(p_service_date date) to "postgres";

grant execute on function "public"."sch_get_schedule_close_time"(p_service_date date) to "service_role";

grant execute on function "public"."sch_group_adjusted_load_points"(p_location_group_id uuid) to "postgres";

grant execute on function "public"."sch_group_adjusted_load_points"(p_location_group_id uuid) to "service_role";

grant execute on function "public"."sch_group_difficulty_points"(p_location_group_id uuid) to "postgres";

grant execute on function "public"."sch_group_difficulty_points"(p_location_group_id uuid) to "service_role";

grant execute on function "public"."sch_group_load_points"(p_location_group_id uuid) to "postgres";

grant execute on function "public"."sch_group_load_points"(p_location_group_id uuid) to "service_role";

grant execute on function "public"."sch_group_priority_points"(p_location_group_id uuid) to "postgres";

grant execute on function "public"."sch_group_priority_points"(p_location_group_id uuid) to "service_role";

grant execute on function "public"."sch_group_proximity_points"(p_location_group_id uuid) to "postgres";

grant execute on function "public"."sch_group_proximity_points"(p_location_group_id uuid) to "service_role";

grant execute on function "public"."sch_group_route_spread_penalty"(p_location_group_ids uuid[]) to "postgres";

grant execute on function "public"."sch_group_route_spread_penalty"(p_location_group_ids uuid[]) to "service_role";

grant execute on function "public"."sch_guard_operational_coverage_template"() to "postgres";

grant execute on function "public"."sch_guard_operational_coverage_template"() to "service_role";

grant execute on function "public"."sch_guard_operational_daily_assignment"() to "postgres";

grant execute on function "public"."sch_guard_operational_daily_assignment"() to "service_role";

grant execute on function "public"."sch_guard_restricted_coverage_template"() to "postgres";

grant execute on function "public"."sch_guard_restricted_coverage_template"() to "service_role";

grant execute on function "public"."sch_guard_restricted_daily_assignment"() to "postgres";

grant execute on function "public"."sch_guard_restricted_daily_assignment"() to "service_role";

grant execute on function "public"."sch_guard_restricted_location_coverage_template"() to "postgres";

grant execute on function "public"."sch_guard_restricted_location_coverage_template"() to "service_role";

grant execute on function "public"."sch_is_employee_location_group_restricted"(p_employee_id uuid, p_location_group_id uuid, p_day_of_week integer) to "postgres";

grant execute on function "public"."sch_is_employee_location_group_restricted"(p_employee_id uuid, p_location_group_id uuid, p_day_of_week integer) to "service_role";

grant execute on function "public"."sch_is_public_restroom_group"(p_location_group_id uuid) to "postgres";

grant execute on function "public"."sch_is_public_restroom_group"(p_location_group_id uuid) to "service_role";

grant execute on function "public"."sch_list_location_workload_settings"() to "postgres";

grant execute on function "public"."sch_list_location_workload_settings"() to "service_role";

grant execute on function "public"."sch_lunch_window_for_employee"(p_service_date date, p_employee_id uuid) to "postgres";

grant execute on function "public"."sch_lunch_window_for_employee"(p_service_date date, p_employee_id uuid) to "service_role";

grant execute on function "public"."sch_normalize_restored_scan_lunch_load_points"(p_service_date date) to "postgres";

grant execute on function "public"."sch_normalize_restored_scan_lunch_load_points"(p_service_date date) to "service_role";

grant execute on function "public"."sch_normalize_score"(p_value numeric, p_min numeric, p_max numeric) to "postgres";

grant execute on function "public"."sch_normalize_score"(p_value numeric, p_min numeric, p_max numeric) to "service_role";

grant execute on function "public"."sch_parse_human_time"(p_text text) to "postgres";

grant execute on function "public"."sch_parse_human_time"(p_text text) to "service_role";

grant execute on function "public"."sch_pto_absence_sync_trigger"() to "postgres";

grant execute on function "public"."sch_pto_absence_sync_trigger"() to "service_role";

grant execute on function "public"."sch_queue_due_scan_alerts"(p_limit integer, p_dry_run boolean, p_cooldown_minutes integer) to "postgres";

grant execute on function "public"."sch_queue_due_scan_alerts"(p_limit integer, p_dry_run boolean, p_cooldown_minutes integer) to "service_role";

grant execute on function "public"."sch_queue_due_scan_alerts"(p_limit integer, p_dry_run boolean, p_cooldown_minutes integer, p_manager_escalation_grace_minutes integer) to "postgres";

grant execute on function "public"."sch_queue_due_scan_alerts"(p_limit integer, p_dry_run boolean, p_cooldown_minutes integer, p_manager_escalation_grace_minutes integer) to "service_role";

grant execute on function "public"."sch_queue_scan_alert_manager_escalations"(p_grace_minutes integer, p_limit integer, p_dry_run boolean) to "postgres";

grant execute on function "public"."sch_queue_scan_alert_manager_escalations"(p_grace_minutes integer, p_limit integer, p_dry_run boolean) to "service_role";

grant execute on function "public"."sch_queue_scan_alert_message"(p_location_code text, p_alert_type text, p_minutes_until_due integer, p_at timestamp with time zone, p_cooldown_minutes integer, p_dry_run boolean) to "postgres";

grant execute on function "public"."sch_queue_scan_alert_message"(p_location_code text, p_alert_type text, p_minutes_until_due integer, p_at timestamp with time zone, p_cooldown_minutes integer, p_dry_run boolean) to "service_role";

grant execute on function "public"."sch_regenerate_existing_schedules_for_absence_range"(p_start_date date, p_end_date date) to "postgres";

grant execute on function "public"."sch_regenerate_existing_schedules_for_absence_range"(p_start_date date, p_end_date date) to "service_role";

grant execute on function "public"."sch_resolve_employee_ref"(p_text text) to "postgres";

grant execute on function "public"."sch_resolve_employee_ref"(p_text text) to "service_role";

grant execute on function "public"."sch_schedule_health_day"(p_service_date date) to "postgres";

grant execute on function "public"."sch_schedule_health_day"(p_service_date date) to "service_role";

grant execute on function "public"."sch_seed_location_coverage_templates_from_groups"(p_day_of_week integer) to "postgres";

grant execute on function "public"."sch_seed_location_coverage_templates_from_groups"(p_day_of_week integer) to "service_role";

grant execute on function "public"."sch_service_date"(p_at timestamp with time zone) to "postgres";

grant execute on function "public"."sch_service_date"(p_at timestamp with time zone) to "service_role";

grant execute on function "public"."sch_set_employee_alias_active"(p_alias_id uuid, p_active boolean) to "postgres";

grant execute on function "public"."sch_set_employee_alias_active"(p_alias_id uuid, p_active boolean) to "service_role";

grant execute on function "public"."sch_set_employee_shift_template_metadata"(p_employee_ref text, p_day_of_week integer, p_lunch_start time without time zone, p_lunch_end time without time zone, p_color_hex text, p_notes text) to "postgres";

grant execute on function "public"."sch_set_employee_shift_template_metadata"(p_employee_ref text, p_day_of_week integer, p_lunch_start time without time zone, p_lunch_end time without time zone, p_color_hex text, p_notes text) to "service_role";

grant execute on function "public"."sch_set_location_workload_settings"(p_location_id uuid, p_difficulty_rating integer, p_priority_rating integer, p_workload_notes text) to "postgres";

grant execute on function "public"."sch_set_location_workload_settings"(p_location_id uuid, p_difficulty_rating integer, p_priority_rating integer, p_workload_notes text) to "service_role";

grant execute on function "public"."sch_set_schedule_close_time"(p_service_date date, p_closing_time time without time zone, p_notes text) to "postgres";

grant execute on function "public"."sch_set_schedule_close_time"(p_service_date date, p_closing_time time without time zone, p_notes text) to "service_role";

grant execute on function "public"."sch_split_restored_scan_owner_rows_around_lunch"(p_service_date date) to "postgres";

grant execute on function "public"."sch_split_restored_scan_owner_rows_around_lunch"(p_service_date date) to "service_role";

grant execute on function "public"."sch_sync_pto_absence_overrides"(p_start_date date, p_end_date date) to "postgres";

grant execute on function "public"."sch_sync_pto_absence_overrides"(p_start_date date, p_end_date date) to "service_role";

grant execute on function "public"."sch_sync_shift_metadata_from_notes"() to "postgres";

grant execute on function "public"."sch_sync_shift_metadata_from_notes"() to "service_role";

grant execute on function "public"."sch_upsert_employee_alias"(p_employee_ref text, p_alias_text text, p_notes text) to "postgres";

grant execute on function "public"."sch_upsert_employee_alias"(p_employee_ref text, p_alias_text text, p_notes text) to "service_role";

grant execute on function "public"."sch_upsert_employee_area_preference_by_code"(p_employee_name text, p_group_code text, p_preference_type text, p_notes text, p_active boolean, p_override_restricted boolean) to "postgres";

grant execute on function "public"."sch_upsert_employee_area_preference_by_code"(p_employee_name text, p_group_code text, p_preference_type text, p_notes text, p_active boolean, p_override_restricted boolean) to "service_role";

grant execute on function "public"."sch_validate_alijah_herpetarium_rule"(p_start_date date, p_end_date date) to "postgres";

grant execute on function "public"."sch_validate_alijah_herpetarium_rule"(p_start_date date, p_end_date date) to "service_role";

grant execute on function "public"."sch_validate_kathy_east_boundary"(p_start_date date, p_end_date date) to "postgres";

grant execute on function "public"."sch_validate_kathy_east_boundary"(p_start_date date, p_end_date date) to "service_role";

grant execute on function "public"."sch_validate_operational_schedule_rules"(p_start_date date, p_end_date date) to "postgres";

grant execute on function "public"."sch_validate_operational_schedule_rules"(p_start_date date, p_end_date date) to "service_role";

grant execute on function "public"."set_system_setting"(p_setting_key text, p_setting_value jsonb, p_description text) to "postgres";

grant execute on function "public"."set_system_setting"(p_setting_key text, p_setting_value jsonb, p_description text) to "service_role";

grant execute on function "public"."set_updated_at"() to "postgres";

grant execute on function "public"."set_updated_at"() to "service_role";

grant execute on function "public"."set_updated_at_schedule_automation_runs"() to "postgres";

grant execute on function "public"."set_updated_at_schedule_automation_runs"() to "service_role";

grant execute on function "public"."set_updated_at_schedule_operational_notes"() to "postgres";

grant execute on function "public"."set_updated_at_schedule_operational_notes"() to "service_role";

grant execute on function "public"."start_session"(p_location_code text, p_employee_name text, p_device_id text, p_client_session_id text) to "postgres";

grant execute on function "public"."start_session"(p_location_code text, p_employee_name text, p_device_id text, p_client_session_id text) to "service_role";

grant execute on function "public"."start_session_v2"(p_location_code text, p_device_id text, p_client_session_id text, p_client_started_at timestamp with time zone, p_correlation_id text) to "postgres";

grant execute on function "public"."start_session_v2"(p_location_code text, p_device_id text, p_client_session_id text, p_client_started_at timestamp with time zone, p_correlation_id text) to "service_role";

grant execute on function "public"."sync_migration_log_summary"() to "postgres";

grant execute on function "public"."sync_migration_log_summary"() to "service_role";

grant execute on function "public"."tool_admin_bundle"(p_location_limit integer, p_activity_limit integer, p_ticket_limit integer, p_exception_limit integer, p_device_limit integer) to "postgres";

grant execute on function "public"."tool_admin_bundle"(p_location_limit integer, p_activity_limit integer, p_ticket_limit integer, p_exception_limit integer, p_device_limit integer) to "service_role";

grant execute on function "public"."tool_admin_health_summary"() to "postgres";

grant execute on function "public"."tool_admin_health_summary"() to "service_role";

grant execute on function "public"."tool_admin_summary"() to "postgres";

grant execute on function "public"."tool_admin_summary"() to "service_role";

grant execute on function "public"."tool_close_maintenance_ticket"(p_ticket_id text, p_closed_by text, p_close_notes text) to "postgres";

grant execute on function "public"."tool_close_maintenance_ticket"(p_ticket_id text, p_closed_by text, p_close_notes text) to "service_role";

grant execute on function "public"."tool_commit_cleaning_workflow"(p_client_session_id text, p_client_completion_id text, p_device_id text, p_location_code text, p_client_started_at timestamp with time zone, p_client_ended_at timestamp with time zone, p_response_json jsonb, p_scan_evidence jsonb, p_correlation_id text) to "postgres";

grant execute on function "public"."tool_commit_cleaning_workflow"(p_client_session_id text, p_client_completion_id text, p_device_id text, p_location_code text, p_client_started_at timestamp with time zone, p_client_ended_at timestamp with time zone, p_response_json jsonb, p_scan_evidence jsonb, p_correlation_id text) to "service_role";

grant execute on function "public"."tool_complete_session"(p_session_uuid text, p_response_json jsonb, p_submitted_by_employee_name text, p_device_id text, p_client_completion_id text) to "postgres";

grant execute on function "public"."tool_complete_session"(p_session_uuid text, p_response_json jsonb, p_submitted_by_employee_name text, p_device_id text, p_client_completion_id text) to "service_role";

grant execute on function "public"."tool_evaluate_location_proximity"(p_location_code text, p_device_identifier text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric, p_session_uuid text, p_client_event_id text, p_correlation_id text) to "postgres";

grant execute on function "public"."tool_evaluate_location_proximity"(p_location_code text, p_device_identifier text, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric, p_session_uuid text, p_client_event_id text, p_correlation_id text) to "service_role";

grant execute on function "public"."tool_finish_session"(p_location_code text, p_device_id text) to "postgres";

grant execute on function "public"."tool_finish_session"(p_location_code text, p_device_id text) to "service_role";

grant execute on function "public"."tool_force_close_session"(p_session_uuid text, p_closed_by text, p_reason text) to "postgres";

grant execute on function "public"."tool_force_close_session"(p_session_uuid text, p_closed_by text, p_reason text) to "service_role";

grant execute on function "public"."tool_get_last_cleaned"(p_location text) to "postgres";

grant execute on function "public"."tool_get_last_cleaned"(p_location text) to "service_role";

grant execute on function "public"."tool_get_location_scan_state"(p_location_code text, p_device_id text) to "postgres";

grant execute on function "public"."tool_get_location_scan_state"(p_location_code text, p_device_id text) to "service_role";

grant execute on function "public"."tool_get_location_scan_state_v2"(p_location_code text, p_device_id text) to "postgres";

grant execute on function "public"."tool_get_location_scan_state_v2"(p_location_code text, p_device_id text) to "service_role";

grant execute on function "public"."tool_get_system_settings"() to "postgres";

grant execute on function "public"."tool_get_system_settings"() to "service_role";

grant execute on function "public"."tool_list_active_devices"() to "postgres";

grant execute on function "public"."tool_list_active_devices"() to "service_role";

grant execute on function "public"."tool_list_active_employees"() to "postgres";

grant execute on function "public"."tool_list_active_employees"() to "service_role";

grant execute on function "public"."tool_list_open_sessions"() to "postgres";

grant execute on function "public"."tool_list_open_sessions"() to "service_role";

grant execute on function "public"."tool_ping_device"(p_device_id text, p_notes text) to "postgres";

grant execute on function "public"."tool_ping_device"(p_device_id text, p_notes text) to "service_role";

grant execute on function "public"."tool_purge_closed_scan_history_before"(p_cutoff timestamp with time zone, p_requested_by text) to "postgres";

grant execute on function "public"."tool_purge_closed_scan_history_before"(p_cutoff timestamp with time zone, p_requested_by text) to "service_role";

grant execute on function "public"."tool_record_scan_event"(p_location_code text, p_device_identifier text, p_event_type text, p_result text, p_notes text, p_payload_json jsonb, p_client_event_id text) to "postgres";

grant execute on function "public"."tool_record_scan_event"(p_location_code text, p_device_identifier text, p_event_type text, p_result text, p_notes text, p_payload_json jsonb, p_client_event_id text) to "service_role";

grant execute on function "public"."tool_report_device_sync_status"(p_device_identifier text, p_queue_count integer, p_oldest_item_at timestamp with time zone, p_retry_count integer, p_last_server_ack_at timestamp with time zone, p_frontend_version text, p_last_error text, p_correlation_id text) to "postgres";

grant execute on function "public"."tool_report_device_sync_status"(p_device_identifier text, p_queue_count integer, p_oldest_item_at timestamp with time zone, p_retry_count integer, p_last_server_ack_at timestamp with time zone, p_frontend_version text, p_last_error text, p_correlation_id text) to "service_role";

grant execute on function "public"."tool_runtime_readiness"() to "postgres";

grant execute on function "public"."tool_runtime_readiness"() to "service_role";

grant execute on function "public"."tool_start_session"(p_location_code text, p_employee_name text, p_device_id text, p_client_session_id text) to "postgres";

grant execute on function "public"."tool_start_session"(p_location_code text, p_employee_name text, p_device_id text, p_client_session_id text) to "service_role";

grant execute on function "public"."tool_start_session_v2"(p_location_code text, p_device_id text, p_client_session_id text, p_client_started_at timestamp with time zone, p_correlation_id text) to "postgres";

grant execute on function "public"."tool_start_session_v2"(p_location_code text, p_device_id text, p_client_session_id text, p_client_started_at timestamp with time zone, p_correlation_id text) to "service_role";

comment on table "public"."annie_chat_state" is 'Moxie-private chat state. Direct anonymous/authenticated access is forbidden; only the server-side Moxie module may use the service role.';

comment on table "public"."annie_contacts" is 'Moxie-private contacts. Not part of Memphis operational AI context.';

comment on table "public"."annie_deliverables" is 'Moxie-private deliverables. Not part of Memphis operational AI context.';

comment on table "public"."annie_log_notes" is 'Moxie-private notes. Not part of Memphis operational AI context.';

comment on table "public"."annie_log_reminders" is 'Moxie-private reminders. Not part of Memphis operational AI context.';

comment on table "public"."annie_log_suggested_reminders" is 'Moxie-private suggested reminders. Not part of Memphis operational AI context.';

comment on table "public"."annie_suggested_contacts" is 'Moxie-private suggested contacts. Not part of Memphis operational AI context.';

comment on table "public"."device_auth_credentials" is 'Revocable employee-device credentials. Only HMAC token hashes are stored.';

comment on table "public"."device_auth_enrollment_codes" is 'Short-lived one-time enrollment codes generated by an authenticated Ops Manager.';

comment on table "public"."device_auth_events" is 'Privacy-preserving device authentication audit events.';

comment on table "public"."device_auth_policy" is 'Explicit staged rollout state for employee-device credentials: observe, enroll, then enforce.';

comment on table "public"."moxie_access_audit" is 'Server-side audit of Moxie data access. Memphis modules are not authorized to read Annie/Moxie state tables.';

comment on table "public"."moxie_auth_credentials" is 'Server-side persistent Moxie authentication credential. Passwords are scrypt-derived; plaintext is never stored.';

comment on table "public"."msg_broadcast_recipients" is 'Recipient tracking for broadcasts.';

comment on table "public"."msg_broadcasts" is 'Broadcast announcements sent by Ops Managers or admins.';

comment on table "public"."msg_device_assignments" is 'Maps physical device identifiers to messenger users for auto-login.';

comment on table "public"."msg_hidden_threads_by_device" is 'Per-device hidden thread state so deleting a thread hides it only on that device.';

comment on table "public"."msg_messages" is 'Messages sent inside messenger threads.';

comment on table "public"."msg_receipts" is 'Per-user delivery/read tracking for messenger messages.';

comment on table "public"."msg_thread_participants" is 'Participants in messenger threads.';

comment on table "public"."msg_threads" is 'Messenger conversation threads. Module-local communication layer.';

comment on table "public"."msg_users" is 'Messenger module identities. Separate from scan/scheduler/events but bridged to employees.';

comment on table "public"."ops_manager_auth_events" is 'Privacy-preserving authentication audit events. IP and user agent values are stored only as HMAC hashes.';

comment on table "public"."ops_manager_trusted_devices" is 'Revocable Ops Manager trusted-device credentials. token_hash is an HMAC; raw cookie secrets are never persisted.';

comment on column "public"."events_app_events"."end_date" is 'Inclusive local end date for events. Same as event_date for same-day events; later for overnight events such as Zoo Snooze.';

comment on column "public"."msg_receipts"."delivered_at" is 'Set only after a device explicitly acknowledges receipt. Legacy rows before this migration may contain insertion timestamps.';

comment on column "public"."msg_receipts"."displayed_at" is 'Set when the recipient device reports that the message was rendered to the user.';

comment on column "public"."msg_receipts"."acknowledged_at" is 'Set when an operational message or broadcast is explicitly acknowledged.';

comment on function "public"."expire_stale_open_sessions"(p_now timestamp with time zone) is 'Cancels stale active or pending-submit sessions. It never fabricates a completed cleaning.';

comment on function "public"."msg_cleanup_deleted_messages"() is 'Destructive legacy message cleanup. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only.';

comment on function "public"."msg_get_user_by_device"(p_device_identifier text) is 'Resolves active messenger user assignment by device identifier.';

comment on function "public"."msg_purge_fully_hidden_threads"() is 'Destructive legacy hidden-thread purge. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only.';

comment on function "public"."msg_purge_messages_older_than_14_days"() is 'Destructive legacy message purge. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only.';

comment on function "public"."mz_apply_free_tier_retention"(p_now timestamp with time zone) is 'Destructive legacy retention routine. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only; use solely after explicit audited approval.';

comment on function "public"."purge_closed_scan_history_before"(p_cutoff timestamp with time zone, p_requested_by text) is 'Destructive scan-history purge. Automatic execution disabled 2026-07-15. PostgreSQL-owner execution only.';

comment on function "public"."run_sql_write"(p_sql text, p_context text) is 'Internal service-role data-write gateway. It rejects DDL/security statements and does not write migration_log.';

comment on function "public"."tool_get_location_scan_state_v2"(p_location_code text, p_device_id text) is 'Returns authoritative scan state including client/server session identity for recovery after browser restart or offline synchronization.';

commit;
