-- Deployed migration history snapshot: 20260716004053 retire_mcp_write_test_table

do $retire$
begin
  if to_regclass('public.mcp_write_test') is not null then
    insert into public.foundation_removal_archive(removal_batch,source_table,source_id,row_json,archived_by)
    select 'retire_mcp_write_test_20260716','mcp_write_test',id::text,to_jsonb(t),'foundation_cleanup'
    from public.mcp_write_test t;

    execute 'drop table public.mcp_write_test';
  end if;
end
$retire$;
