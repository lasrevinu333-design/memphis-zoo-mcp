-- Deployed migration history snapshot: 20260716001958 retire_legacy_backup_tables

insert into public.foundation_removal_archive(removal_batch,source_table,source_id,row_json,archived_by)
select 'retire_legacy_backup_tables_20260716','coverage_templates_backup_static_pdf_20260628',coalesce(id::text,ctid::text),to_jsonb(t),'foundation_cleanup'
from public.coverage_templates_backup_static_pdf_20260628 t;

insert into public.foundation_removal_archive(removal_batch,source_table,source_id,row_json,archived_by)
select 'retire_legacy_backup_tables_20260716','daily_schedule_assignments_backup_cat_primate_lunch_20260628',coalesce(id::text,ctid::text),to_jsonb(t),'foundation_cleanup'
from public.daily_schedule_assignments_backup_cat_primate_lunch_20260628 t;

insert into public.foundation_removal_archive(removal_batch,source_table,source_id,row_json,archived_by)
select 'retire_legacy_backup_tables_20260716','location_reactivation_backup_primate_canyon_20260628',ctid::text,to_jsonb(t),'foundation_cleanup'
from public.location_reactivation_backup_primate_canyon_20260628 t;

insert into public.foundation_removal_archive(removal_batch,source_table,source_id,row_json,archived_by)
select 'retire_legacy_backup_tables_20260716','schedule_cleanup_backup_20260628',ctid::text,to_jsonb(t),'foundation_cleanup'
from public.schedule_cleanup_backup_20260628 t;

drop table public.coverage_templates_backup_static_pdf_20260628;
drop table public.daily_schedule_assignments_backup_cat_primate_lunch_20260628;
drop table public.location_reactivation_backup_primate_canyon_20260628;
drop table public.schedule_cleanup_backup_20260628;
