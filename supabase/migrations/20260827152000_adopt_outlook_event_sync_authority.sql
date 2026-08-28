-- Production already owns this Outlook synchronization ledger, but no source
-- migration described it. Independent restore therefore preserved a relation
-- that the clean-source fingerprint could never reproduce. Adopt the exact
-- production shape without rewriting rows or granting a browser principal.

begin;

create table if not exists public.events_app_outlook_sync (
  id uuid default gen_random_uuid() not null,
  outlook_message_id text not null,
  source_event_key text not null,
  event_id uuid,
  received_at timestamptz,
  source_subject text,
  payload_hash text,
  sync_status text default 'APPLIED'::text not null,
  sync_note text,
  source_payload jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint events_app_outlook_sync_pkey primary key (id),
  constraint events_app_outlook_sync_outlook_message_id_source_event_key_key
    unique (outlook_message_id, source_event_key),
  constraint events_app_outlook_sync_event_id_fkey
    foreign key (event_id) references public.events_app_events(id) on delete set null,
  constraint events_app_outlook_sync_sync_status_check check (
    sync_status = any (array[
      'APPLIED'::text,
      'UNCHANGED'::text,
      'NEEDS_REVIEW'::text,
      'BLOCKED_MANUAL'::text,
      'CANCELLED'::text,
      'ERROR'::text
    ])
  )
);

create index if not exists idx_events_app_outlook_sync_event
  on public.events_app_outlook_sync using btree (event_id, updated_at desc);
create index if not exists idx_events_app_outlook_sync_received
  on public.events_app_outlook_sync using btree (received_at desc);

alter table public.events_app_outlook_sync enable row level security;
alter table public.events_app_outlook_sync no force row level security;

revoke all privileges on table public.events_app_outlook_sync
  from public, anon, authenticated, service_role, custodial_application_reader,
       postgres, supabase_admin;
grant delete, insert, maintain, references, select, trigger, truncate, update
  on table public.events_app_outlook_sync to service_role;

comment on table public.events_app_outlook_sync is
  'Idempotency and audit ledger for ChatGPT Outlook-to-events synchronization. No mailbox credentials are stored.';

do $postflight$
declare
  expected_columns text[] := array[
    'id:uuid:true:gen_random_uuid()',
    'outlook_message_id:text:true:',
    'source_event_key:text:true:',
    'event_id:uuid:false:',
    'received_at:timestamp with time zone:false:',
    'source_subject:text:false:',
    'payload_hash:text:false:',
    'sync_status:text:true:''APPLIED''::text',
    'sync_note:text:false:',
    'source_payload:jsonb:true:''{}''::jsonb',
    'created_at:timestamp with time zone:true:now()',
    'updated_at:timestamp with time zone:true:now()'
  ];
  actual_columns text[];
  unexpected_acl integer;
begin
  select array_agg(
    a.attname::text || ':' || format_type(a.atttypid,a.atttypmod) || ':' ||
    a.attnotnull::text || ':' || coalesce(pg_get_expr(ad.adbin,ad.adrelid),'')
    order by a.attnum
  ) into actual_columns
  from pg_attribute a
  left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
  where a.attrelid='public.events_app_outlook_sync'::regclass
    and a.attnum>0
    and not a.attisdropped;

  if actual_columns is distinct from expected_columns then
    raise exception 'Existing Outlook synchronization columns do not equal the admitted production shape';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid='public.events_app_outlook_sync'::regclass
      and (conname,contype,pg_get_constraintdef(oid,true)) in (
        ('events_app_outlook_sync_pkey','p','PRIMARY KEY (id)'),
        ('events_app_outlook_sync_outlook_message_id_source_event_key_key','u','UNIQUE (outlook_message_id, source_event_key)'),
        ('events_app_outlook_sync_event_id_fkey','f','FOREIGN KEY (event_id) REFERENCES events_app_events(id) ON DELETE SET NULL'),
        ('events_app_outlook_sync_sync_status_check','c','CHECK (sync_status = ANY (ARRAY[''APPLIED''::text, ''UNCHANGED''::text, ''NEEDS_REVIEW''::text, ''BLOCKED_MANUAL''::text, ''CANCELLED''::text, ''ERROR''::text]))')
      )
  ) <> 4
     or (
       select count(*) from pg_constraint
       where conrelid='public.events_app_outlook_sync'::regclass
     ) <> 4 then
    raise exception 'Existing Outlook synchronization constraints do not equal the admitted production shape';
  end if;

  if (
    select count(*)
    from pg_index ix
    join pg_class i on i.oid=ix.indexrelid
    where ix.indrelid='public.events_app_outlook_sync'::regclass
      and i.relname in (
        'events_app_outlook_sync_pkey',
        'events_app_outlook_sync_outlook_message_id_source_event_key_key',
        'idx_events_app_outlook_sync_event',
        'idx_events_app_outlook_sync_received'
      )
  ) <> 4
     or (
       select count(*) from pg_index
       where indrelid='public.events_app_outlook_sync'::regclass
     ) <> 4 then
    raise exception 'Existing Outlook synchronization indexes do not equal the admitted production shape';
  end if;

  if not exists (
    select 1 from pg_class
    where oid='public.events_app_outlook_sync'::regclass
      and relrowsecurity
      and not relforcerowsecurity
  )
     or exists (
       select 1 from pg_policy
       where polrelid='public.events_app_outlook_sync'::regclass
     ) then
    raise exception 'Outlook synchronization RLS state does not equal the admitted fail-closed shape';
  end if;

  select count(*) into unexpected_acl
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
  left join pg_roles grantee on grantee.oid=acl.grantee
  where c.oid='public.events_app_outlook_sync'::regclass
    and acl.grantee<>c.relowner
    and not (
      grantee.rolname='service_role'
      and not acl.is_grantable
      and acl.privilege_type in (
        'DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'
      )
    );
  if unexpected_acl<>0 or not has_table_privilege('service_role','public.events_app_outlook_sync','select') then
    raise exception 'Outlook synchronization grants do not equal the admitted service-only shape';
  end if;

  if obj_description('public.events_app_outlook_sync'::regclass,'pg_class') is distinct from
     'Idempotency and audit ledger for ChatGPT Outlook-to-events synchronization. No mailbox credentials are stored.' then
    raise exception 'Outlook synchronization authority comment is missing';
  end if;
end
$postflight$;

commit;
