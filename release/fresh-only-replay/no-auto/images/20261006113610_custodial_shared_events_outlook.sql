-- FRESH-ONLY derived replay image; original applied-history Source is preserved.
-- Current Source is intentionally HOLD: expected reference literals are NULL.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
set local search_path=pg_catalog,public,extensions;
do $fresh_reference_preflight$
declare
 -- HOLD: only a later immutable Source successor may embed verified reference proof.
 verified_reference jsonb:=$c04_ref_6d3f90257ac4c4f27f004494${
  "construction": "NEW_CLEAN_SUPABASE_ADMIN_SOURCE_PREFIX226_NO_SYNTHETIC_DATA",
  "contracts": {
    "legacy": null,
    "staged": {
      "functions": [
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "ec115b8e61cf8b9c583231f79e0297e0b94c29406e9b5a27760f2b146bcf7217",
          "identity": "public.app_apply_event_command(text,uuid,jsonb,text,text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "0731412d608701cec051f478b4d5c3188634a017838bd2a5239bceeceadbe408",
          "identity": "public.app_event_cancellation_transition_guard()",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "2c8e67a8a854642333a774c4d9c0f6a3af6912093e3fc29fd7adfd6bd6b622f0",
          "identity": "public.app_event_supersession_guard()",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "c03c9ced052f240063611ab3c10be3f83f24d44b3e7affaec67e60d4f002e9bb",
          "identity": "public.app_event_transition_receipt_immutable()",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "eb24ae233538215c86cd6ee723dc62d682f82e4924d3fa66a56ff9570dbce5c2",
          "identity": "public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "3b57a7d9b5c799b75c2e2a361f0f5c38331c468fc1c84c315af3bedf8f22fa24",
          "identity": "public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "8b1d03a5aa2fc1b4a5ca81026d3ce24a88363bfd6ff32faa4762b9077de32e1f",
          "identity": "public.custodial_begin_application_mutation_lease(uuid,text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "6c43a3f46118457dad92e734b4087e102cc9b1a6792b9432d49d616e48c70f85",
          "identity": "public.custodial_release_application_mutation_lease(uuid)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "PUBLIC",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "cb75ddb8fcc66de2f6d46ad279b8b3a40ec1aaab1595ca672ec5f2868da7430d",
          "identity": "public.custodial_release_authority_current_column_definition(text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "PUBLIC",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "68fb07358e10890bed08cfabebed3f3649fd9df67952109052cc9725c442cc61",
          "identity": "public.custodial_release_authority_current_column_set_definition(text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "PUBLIC",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "4d5e7bdd3eab00cc7f9568eb7d6770d72c95fa5b5c49ae42ed2fbd666b9a511c",
          "identity": "public.custodial_release_authority_current_constraint_definition(text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "PUBLIC",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "6ea419b77106cde9611a2091e52552116607e192f961f1a88b3b591633245907",
          "identity": "public.custodial_release_authority_current_grant_definition(text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "PUBLIC",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "d223214b359ac36dace8f7f1576aad2298041f417d585f2920f39ff7caf851af",
          "identity": "public.custodial_release_authority_current_index_definition(text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "PUBLIC",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "a9f77828c5917b95f5dea85ee46bed6ef6581e203cb468a7f15647b59fd7f125",
          "identity": "public.custodial_release_authority_current_relation_definition(text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "PUBLIC",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "a35b953cc1f03f29b3f282802a20d2dbc6251467ce58a92758951fea8a3770d1",
          "identity": "public.custodial_release_authority_current_relation_state_definition(text)",
          "owner_name": "supabase_admin"
        },
        {
          "acl": [
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "EXECUTE"
            }
          ],
          "definition_sha256": "5337ef6187e2febb0668f1350092fa49de3258317ae19537317a889900a0e1c3",
          "identity": "public.static_weekly_digest_text(text)",
          "owner_name": "supabase_admin"
        }
      ],
      "inventory_count": 6503,
      "inventory_semantic_sha256": "1524cc9da48a697308ec68225b7de0d82acecd32fcdf7a2acc3313e715d5919e",
      "schema_after": {
        "column_set": "select public.custodial_release_authority_restore_column_set('public.events_app_events',array['archived_at','attendee_count','audience_employee_ids','audience_scope','cancellation_reason','cancelled_at','cancelled_by','cancelled_by_manager_id','cancelled_from_status','coverage_location_ids','created_at','created_by','created_by_manager_id','custodial_note_codes','custodial_public_notes','display_location','end_date','end_instant_utc','end_time','event_date','event_name','event_scope','event_timezone','id','location_group_id','manually_overridden','needs_review','notes','operation_id','overridden_at','overridden_by','parse_reason','parser_confidence','primary_venue_id','revision','source_format','source_location_text','source_text','staffing_area_ids','start_instant_utc','start_time','status','superseded_at','superseded_by_event_id','superseded_by_manager_id','supersession_request_digest','updated_at','updated_by_manager_id','venue_ids']::text[]);",
        "relation": "create table if not exists public.events_app_events (\n  archived_at timestamp with time zone,\n  attendee_count integer,\n  audience_employee_ids uuid[] default '{}'::uuid[] not null,\n  audience_scope text default 'assigned_location'::text not null,\n  cancellation_reason text,\n  cancelled_at timestamp with time zone,\n  cancelled_by text,\n  cancelled_by_manager_id uuid,\n  cancelled_from_status text,\n  coverage_location_ids uuid[] default '{}'::uuid[] not null,\n  created_at timestamp with time zone default now() not null,\n  created_by text,\n  created_by_manager_id uuid,\n  custodial_note_codes text[] default '{}'::text[] not null,\n  custodial_public_notes text,\n  display_location text,\n  end_date date not null,\n  end_instant_utc timestamp with time zone,\n  end_time time without time zone,\n  event_date date not null,\n  event_name text not null,\n  event_scope text default 'UNKNOWN'::text not null,\n  event_timezone text default 'America/Chicago'::text not null,\n  id uuid default gen_random_uuid() not null,\n  location_group_id uuid not null,\n  manually_overridden boolean default false not null,\n  needs_review boolean default false not null,\n  notes text,\n  operation_id uuid,\n  overridden_at timestamp with time zone,\n  overridden_by text,\n  parse_reason text,\n  parser_confidence text,\n  primary_venue_id uuid,\n  revision integer default 1 not null,\n  source_format text,\n  source_location_text text,\n  source_text text,\n  staffing_area_ids uuid[] default '{}'::uuid[] not null,\n  start_instant_utc timestamp with time zone,\n  start_time time without time zone not null,\n  status text default 'SCHEDULED'::text not null,\n  superseded_at timestamp with time zone,\n  superseded_by_event_id uuid,\n  superseded_by_manager_id uuid,\n  supersession_request_digest text,\n  updated_at timestamp with time zone default now() not null,\n  updated_by_manager_id uuid,\n  venue_ids uuid[] default '{}'::uuid[] not null\n);"
      },
      "schema_before": {
        "column_set": "select public.custodial_release_authority_restore_column_set('public.events_app_events',array['archived_at','attendee_count','audience_employee_ids','audience_scope','cancellation_reason','cancelled_at','cancelled_by','cancelled_by_manager_id','cancelled_from_status','coverage_location_ids','created_at','created_by','created_by_manager_id','custodial_note_codes','custodial_public_notes','display_location','end_date','end_instant_utc','end_time','event_date','event_name','event_scope','event_timezone','id','location_group_id','manually_overridden','needs_review','notes','operation_id','overridden_at','overridden_by','parse_reason','parser_confidence','primary_venue_id','revision','source_format','source_location_text','source_text','staffing_area_ids','start_instant_utc','start_time','status','superseded_at','superseded_by_event_id','superseded_by_manager_id','supersession_request_digest','updated_at','updated_by_manager_id','venue_ids']::text[]);",
        "relation": "create table if not exists public.events_app_events (\n  archived_at timestamp with time zone,\n  attendee_count integer,\n  audience_employee_ids uuid[] default '{}'::uuid[] not null,\n  audience_scope text default 'assigned_location'::text not null,\n  cancellation_reason text,\n  cancelled_at timestamp with time zone,\n  cancelled_by text,\n  cancelled_by_manager_id uuid,\n  cancelled_from_status text,\n  coverage_location_ids uuid[] default '{}'::uuid[] not null,\n  created_at timestamp with time zone default now() not null,\n  created_by text,\n  created_by_manager_id uuid,\n  custodial_note_codes text[] default '{}'::text[] not null,\n  custodial_public_notes text,\n  display_location text,\n  end_date date not null,\n  end_instant_utc timestamp with time zone,\n  end_time time without time zone,\n  event_date date not null,\n  event_name text not null,\n  event_scope text default 'UNKNOWN'::text not null,\n  event_timezone text default 'America/Chicago'::text not null,\n  id uuid default gen_random_uuid() not null,\n  location_group_id uuid not null,\n  manually_overridden boolean default false not null,\n  needs_review boolean default false not null,\n  notes text,\n  operation_id uuid,\n  overridden_at timestamp with time zone,\n  overridden_by text,\n  parse_reason text,\n  parser_confidence text,\n  primary_venue_id uuid,\n  revision integer default 1 not null,\n  source_format text,\n  source_location_text text,\n  source_text text,\n  staffing_area_ids uuid[] default '{}'::uuid[] not null,\n  start_instant_utc timestamp with time zone,\n  start_time time without time zone not null,\n  status text default 'SCHEDULED'::text not null,\n  superseded_at timestamp with time zone,\n  superseded_by_event_id uuid,\n  superseded_by_manager_id uuid,\n  supersession_request_digest text,\n  updated_at timestamp with time zone default now() not null,\n  updated_by_manager_id uuid,\n  venue_ids uuid[] default '{}'::uuid[] not null\n);"
      },
      "six_static_targets": [
        {
          "definition_sql": "select public.custodial_release_authority_restore_column('public.events_app_events','custodial_note_codes','text[]',null,'','','''{}''::text[]',true);",
          "object_identity": "public.events_app_events:custodial_note_codes",
          "object_kind": "column",
          "predecessor_sha256": "8ba11b63746e6184bd957789a728afe1eb8aa3802547201d29adf739fae3c2a0",
          "target_sha256": "8ba11b63746e6184bd957789a728afe1eb8aa3802547201d29adf739fae3c2a0"
        },
        {
          "definition_sql": "select public.custodial_release_authority_restore_column('public.events_app_events','custodial_public_notes','text',null,'','',null,false);",
          "object_identity": "public.events_app_events:custodial_public_notes",
          "object_kind": "column",
          "predecessor_sha256": "23dda9691705934b0a7965cec8ba311ff4faebc3f875f7e3142019f6f98fab95",
          "target_sha256": "23dda9691705934b0a7965cec8ba311ff4faebc3f875f7e3142019f6f98fab95"
        },
        {
          "definition_sql": "select public.custodial_release_authority_restore_column('public.events_app_events','end_instant_utc','timestamp with time zone',null,'','',null,false);",
          "object_identity": "public.events_app_events:end_instant_utc",
          "object_kind": "column",
          "predecessor_sha256": "47396e92efba0a4cbb9ab0526e727a3f029fe33452aefdda467c97b7f3e2c732",
          "target_sha256": "47396e92efba0a4cbb9ab0526e727a3f029fe33452aefdda467c97b7f3e2c732"
        },
        {
          "definition_sql": "select public.custodial_release_authority_restore_column('public.events_app_events','start_instant_utc','timestamp with time zone',null,'','',null,false);",
          "object_identity": "public.events_app_events:start_instant_utc",
          "object_kind": "column",
          "predecessor_sha256": "106a679f7e85be9e039b7f6f07c223f81d1041868318a025d650524970945c7c",
          "target_sha256": "106a679f7e85be9e039b7f6f07c223f81d1041868318a025d650524970945c7c"
        },
        {
          "definition_sql": "select public.custodial_release_authority_restore_column_set('public.events_app_events',array['archived_at','attendee_count','audience_employee_ids','audience_scope','cancellation_reason','cancelled_at','cancelled_by','cancelled_by_manager_id','cancelled_from_status','coverage_location_ids','created_at','created_by','created_by_manager_id','custodial_note_codes','custodial_public_notes','display_location','end_date','end_instant_utc','end_time','event_date','event_name','event_scope','event_timezone','id','location_group_id','manually_overridden','needs_review','notes','operation_id','overridden_at','overridden_by','parse_reason','parser_confidence','primary_venue_id','revision','source_format','source_location_text','source_text','staffing_area_ids','start_instant_utc','start_time','status','superseded_at','superseded_by_event_id','superseded_by_manager_id','supersession_request_digest','updated_at','updated_by_manager_id','venue_ids']::text[]);",
          "object_identity": "public.events_app_events",
          "object_kind": "column_set",
          "predecessor_sha256": "d271101bf6e2a2581b00150c974f5fe21540e8b85cff337500427a732c24a693",
          "target_sha256": "d271101bf6e2a2581b00150c974f5fe21540e8b85cff337500427a732c24a693"
        },
        {
          "definition_sql": "create table if not exists public.events_app_events (\n  archived_at timestamp with time zone,\n  attendee_count integer,\n  audience_employee_ids uuid[] default '{}'::uuid[] not null,\n  audience_scope text default 'assigned_location'::text not null,\n  cancellation_reason text,\n  cancelled_at timestamp with time zone,\n  cancelled_by text,\n  cancelled_by_manager_id uuid,\n  cancelled_from_status text,\n  coverage_location_ids uuid[] default '{}'::uuid[] not null,\n  created_at timestamp with time zone default now() not null,\n  created_by text,\n  created_by_manager_id uuid,\n  custodial_note_codes text[] default '{}'::text[] not null,\n  custodial_public_notes text,\n  display_location text,\n  end_date date not null,\n  end_instant_utc timestamp with time zone,\n  end_time time without time zone,\n  event_date date not null,\n  event_name text not null,\n  event_scope text default 'UNKNOWN'::text not null,\n  event_timezone text default 'America/Chicago'::text not null,\n  id uuid default gen_random_uuid() not null,\n  location_group_id uuid not null,\n  manually_overridden boolean default false not null,\n  needs_review boolean default false not null,\n  notes text,\n  operation_id uuid,\n  overridden_at timestamp with time zone,\n  overridden_by text,\n  parse_reason text,\n  parser_confidence text,\n  primary_venue_id uuid,\n  revision integer default 1 not null,\n  source_format text,\n  source_location_text text,\n  source_text text,\n  staffing_area_ids uuid[] default '{}'::uuid[] not null,\n  start_instant_utc timestamp with time zone,\n  start_time time without time zone not null,\n  status text default 'SCHEDULED'::text not null,\n  superseded_at timestamp with time zone,\n  superseded_by_event_id uuid,\n  superseded_by_manager_id uuid,\n  supersession_request_digest text,\n  updated_at timestamp with time zone default now() not null,\n  updated_by_manager_id uuid,\n  venue_ids uuid[] default '{}'::uuid[] not null\n);",
          "object_identity": "public.events_app_events",
          "object_kind": "relation",
          "predecessor_sha256": "b16f3f3da1cfa6ed558a10b27a41cd2fb05879c1b3bf8b628eef9d9b8eb2477f",
          "target_sha256": "b16f3f3da1cfa6ed558a10b27a41cd2fb05879c1b3bf8b628eef9d9b8eb2477f"
        }
      ],
      "tables": {
        "public.events_app_events": {
          "acl": [
            {
              "grantable": false,
              "grantee": "custodial_application_reader",
              "grantor": "supabase_admin",
              "privilege": "SELECT"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "DELETE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "INSERT"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "REFERENCES"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "SELECT"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "TRIGGER"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "TRUNCATE"
            },
            {
              "grantable": false,
              "grantee": "postgres",
              "grantor": "supabase_admin",
              "privilege": "UPDATE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "DELETE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "INSERT"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "MAINTAIN"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "REFERENCES"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "SELECT"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "TRIGGER"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "TRUNCATE"
            },
            {
              "grantable": false,
              "grantee": "service_role",
              "grantor": "supabase_admin",
              "privilege": "UPDATE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "DELETE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "INSERT"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "MAINTAIN"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "REFERENCES"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "SELECT"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "TRIGGER"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "TRUNCATE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "UPDATE"
            }
          ],
          "columns": [
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "archived_at",
              "not_null": false,
              "type": "timestamp with time zone"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "attendee_count",
              "not_null": false,
              "type": "integer"
            },
            {
              "collation": null,
              "default": "'{}'::uuid[]",
              "dimensions": 1,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "audience_employee_ids",
              "not_null": true,
              "type": "uuid[]"
            },
            {
              "collation": "pg_catalog.default",
              "default": "'assigned_location'::text",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "audience_scope",
              "not_null": true,
              "type": "text"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "cancellation_reason",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "cancelled_at",
              "not_null": false,
              "type": "timestamp with time zone"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "cancelled_by",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "cancelled_by_manager_id",
              "not_null": false,
              "type": "uuid"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "cancelled_from_status",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": "'{}'::uuid[]",
              "dimensions": 1,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "coverage_location_ids",
              "not_null": true,
              "type": "uuid[]"
            },
            {
              "collation": null,
              "default": "now()",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "created_at",
              "not_null": true,
              "type": "timestamp with time zone"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "created_by",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "created_by_manager_id",
              "not_null": false,
              "type": "uuid"
            },
            {
              "collation": "pg_catalog.default",
              "default": "'{}'::text[]",
              "dimensions": 1,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "custodial_note_codes",
              "not_null": true,
              "type": "text[]"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "custodial_public_notes",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "display_location",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "end_date",
              "not_null": true,
              "type": "date"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "end_instant_utc",
              "not_null": false,
              "type": "timestamp with time zone"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "end_time",
              "not_null": false,
              "type": "time without time zone"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "event_date",
              "not_null": true,
              "type": "date"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "event_name",
              "not_null": true,
              "type": "text"
            },
            {
              "collation": "pg_catalog.default",
              "default": "'UNKNOWN'::text",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "event_scope",
              "not_null": true,
              "type": "text"
            },
            {
              "collation": "pg_catalog.default",
              "default": "'America/Chicago'::text",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "event_timezone",
              "not_null": true,
              "type": "text"
            },
            {
              "collation": null,
              "default": "gen_random_uuid()",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "id",
              "not_null": true,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "location_group_id",
              "not_null": true,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": "false",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "manually_overridden",
              "not_null": true,
              "type": "boolean"
            },
            {
              "collation": null,
              "default": "false",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "needs_review",
              "not_null": true,
              "type": "boolean"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "notes",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "operation_id",
              "not_null": false,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "overridden_at",
              "not_null": false,
              "type": "timestamp with time zone"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "overridden_by",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "parse_reason",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "parser_confidence",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "primary_venue_id",
              "not_null": false,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": "1",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "revision",
              "not_null": true,
              "type": "integer"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "source_format",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "source_location_text",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "source_text",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": "'{}'::uuid[]",
              "dimensions": 1,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "staffing_area_ids",
              "not_null": true,
              "type": "uuid[]"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "start_instant_utc",
              "not_null": false,
              "type": "timestamp with time zone"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "start_time",
              "not_null": true,
              "type": "time without time zone"
            },
            {
              "collation": "pg_catalog.default",
              "default": "'SCHEDULED'::text",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "status",
              "not_null": true,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "superseded_at",
              "not_null": false,
              "type": "timestamp with time zone"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "superseded_by_event_id",
              "not_null": false,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "superseded_by_manager_id",
              "not_null": false,
              "type": "uuid"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "supersession_request_digest",
              "not_null": false,
              "type": "text"
            },
            {
              "collation": null,
              "default": "now()",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "updated_at",
              "not_null": true,
              "type": "timestamp with time zone"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "updated_by_manager_id",
              "not_null": false,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": "'{}'::uuid[]",
              "dimensions": 1,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "venue_ids",
              "not_null": true,
              "type": "uuid[]"
            }
          ],
          "constraints": [
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (cancelled_from_status IS NULL OR status = 'CANCELLED'::text AND (cancelled_from_status = ANY (ARRAY['SCHEDULED'::text, 'NEEDS_REVIEW'::text])))",
              "name": "events_app_cancel_origin_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (custodial_note_codes <@ ARRAY['trash_boxes'::text, 'extra_cans'::text, 'restroom_checks'::text] AND array_position(custodial_note_codes, NULL::text) IS NULL)",
              "name": "events_app_custodial_note_codes_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (length(custodial_public_notes) <= 500)",
              "name": "events_app_custodial_public_notes_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (start_instant_utc IS NULL AND end_instant_utc IS NULL OR start_instant_utc IS NOT NULL AND end_instant_utc IS NOT NULL AND end_instant_utc > start_instant_utc AND (start_instant_utc AT TIME ZONE 'America/Chicago'::text) = (event_date + start_time) AND (end_instant_utc AT TIME ZONE 'America/Chicago'::text) = (end_date + end_time))",
              "name": "events_app_event_instant_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (attendee_count IS NULL OR attendee_count >= 0)",
              "name": "events_app_events_attendee_count_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (audience_scope = ANY (ARRAY['assigned_location'::text, 'specific_employees'::text, 'all_working_employees'::text]))",
              "name": "events_app_events_audience_scope_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (cancelled_by_manager_id IS NULL OR NULLIF(btrim(cancelled_by), ''::text) IS NOT NULL)",
              "name": "events_app_events_cancelled_actor_snapshot_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (cancelled_by_manager_id) REFERENCES ops_manager_managers(manager_id) ON DELETE SET NULL",
              "name": "events_app_events_cancelled_by_manager_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (created_by_manager_id IS NULL OR NULLIF(btrim(created_by), ''::text) IS NOT NULL)",
              "name": "events_app_events_created_actor_snapshot_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (created_by_manager_id) REFERENCES ops_manager_managers(manager_id) ON DELETE SET NULL",
              "name": "events_app_events_created_by_manager_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (end_time IS NULL OR end_date > event_date OR end_time > start_time)",
              "name": "events_app_events_end_after_start_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (end_date >= event_date)",
              "name": "events_app_events_end_date_not_before_start_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (event_scope = ANY (ARRAY['ZOO_WIDE'::text, 'SINGLE_VENUE'::text, 'MULTI_VENUE'::text, 'OFFSITE'::text, 'UNKNOWN'::text]))",
              "name": "events_app_events_event_scope_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (location_group_id) REFERENCES location_groups(id) ON DELETE RESTRICT",
              "name": "events_app_events_location_group_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (event_scope <> 'MULTI_VENUE'::text OR COALESCE(array_length(venue_ids, 1), 0) >= 2)",
              "name": "events_app_events_multi_venue_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (parser_confidence IS NULL OR (parser_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))",
              "name": "events_app_events_parser_confidence_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "PRIMARY KEY (id)",
              "name": "events_app_events_pkey",
              "type": "p",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (primary_venue_id) REFERENCES event_venues(id)",
              "name": "events_app_events_primary_venue_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (status = 'NEEDS_REVIEW'::text AND event_scope = 'UNKNOWN'::text AND needs_review = true AND primary_venue_id IS NULL AND COALESCE(cardinality(venue_ids), 0) = 0 AND COALESCE(cardinality(coverage_location_ids), 0) = 0 AND COALESCE(cardinality(staffing_area_ids), 0) = 0 OR status <> 'NEEDS_REVIEW'::text AND ((status = ANY (ARRAY['CANCELLED'::text, 'ARCHIVED'::text])) OR event_scope <> 'UNKNOWN'::text AND needs_review = false))",
              "name": "events_app_events_review_isolation_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (event_scope <> 'SINGLE_VENUE'::text OR primary_venue_id IS NOT NULL)",
              "name": "events_app_events_single_venue_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (status = ANY (ARRAY['SCHEDULED'::text, 'CANCELLED'::text, 'ARCHIVED'::text, 'NEEDS_REVIEW'::text, 'SUPERSEDED'::text]))",
              "name": "events_app_events_status_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (superseded_by_event_id) REFERENCES events_app_events(id) ON DELETE RESTRICT",
              "name": "events_app_events_superseded_by_event_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (superseded_by_manager_id) REFERENCES ops_manager_managers(manager_id) ON DELETE RESTRICT",
              "name": "events_app_events_superseded_by_manager_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (event_timezone = 'America/Chicago'::text)",
              "name": "events_app_events_timezone_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (event_scope <> 'UNKNOWN'::text OR needs_review IS TRUE)",
              "name": "events_app_events_unknown_review_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (updated_by_manager_id IS NULL OR NULLIF(btrim(overridden_by), ''::text) IS NOT NULL)",
              "name": "events_app_events_updated_actor_snapshot_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (updated_by_manager_id) REFERENCES ops_manager_managers(manager_id) ON DELETE SET NULL",
              "name": "events_app_events_updated_by_manager_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (event_scope <> 'ZOO_WIDE'::text OR display_location = 'Zoo Footprint'::text)",
              "name": "events_app_events_zoo_wide_display_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (status = 'SUPERSEDED'::text AND superseded_by_event_id IS NOT NULL AND superseded_at IS NOT NULL AND superseded_by_manager_id IS NOT NULL AND supersession_request_digest IS NOT NULL AND superseded_by_event_id <> id OR status <> 'SUPERSEDED'::text AND superseded_by_event_id IS NULL AND superseded_at IS NULL AND superseded_by_manager_id IS NULL AND supersession_request_digest IS NULL)",
              "name": "events_app_supersession_state_check",
              "type": "c",
              "validated": true
            }
          ],
          "force_rowsecurity": true,
          "indexes": [
            {
              "definition": "CREATE UNIQUE INDEX events_app_events_pkey ON public.events_app_events USING btree (id)",
              "name": "events_app_events_pkey",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX events_app_superseded_by_event_id_idx ON public.events_app_events USING btree (superseded_by_event_id) WHERE (superseded_by_event_id IS NOT NULL)",
              "name": "events_app_superseded_by_event_id_idx",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_coverage_locations_gin ON public.events_app_events USING gin (coverage_location_ids)",
              "name": "idx_events_app_events_coverage_locations_gin",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_date_window ON public.events_app_events USING btree (event_date, end_date, start_time)",
              "name": "idx_events_app_events_date_window",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_event_date ON public.events_app_events USING btree (event_date, start_time)",
              "name": "idx_events_app_events_event_date",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_event_scope_date ON public.events_app_events USING btree (event_scope, event_date, start_time)",
              "name": "idx_events_app_events_event_scope_date",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_location_date_window ON public.events_app_events USING btree (location_group_id, event_date, end_date, start_time)",
              "name": "idx_events_app_events_location_date_window",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_location_group ON public.events_app_events USING btree (location_group_id, event_date)",
              "name": "idx_events_app_events_location_group",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_needs_review ON public.events_app_events USING btree (needs_review, event_date) WHERE (needs_review = true)",
              "name": "idx_events_app_events_needs_review",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE UNIQUE INDEX idx_events_app_events_operation_id_unique ON public.events_app_events USING btree (operation_id) WHERE (operation_id IS NOT NULL)",
              "name": "idx_events_app_events_operation_id_unique",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_primary_venue_date ON public.events_app_events USING btree (primary_venue_id, event_date)",
              "name": "idx_events_app_events_primary_venue_date",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_status_date ON public.events_app_events USING btree (status, event_date, start_time, id)",
              "name": "idx_events_app_events_status_date",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE INDEX idx_events_app_events_venue_ids_gin ON public.events_app_events USING gin (venue_ids)",
              "name": "idx_events_app_events_venue_ids_gin",
              "ready": true,
              "valid": true
            }
          ],
          "kind": "r",
          "owner": "supabase_admin",
          "parents": [],
          "partition": false,
          "persistence": "p",
          "policies": [
            {
              "check": null,
              "command": "r",
              "name": "custodial_application_reader_events_app_events_runtime",
              "permissive": true,
              "roles": [
                "custodial_application_reader"
              ],
              "using": "true"
            },
            {
              "check": null,
              "command": "r",
              "name": "events_app_events_authed_read",
              "permissive": true,
              "roles": [
                "authenticated"
              ],
              "using": "true"
            },
            {
              "check": "true",
              "command": "*",
              "name": "events_app_events_service_all",
              "permissive": true,
              "roles": [
                "service_role"
              ],
              "using": "true"
            }
          ],
          "rowsecurity": true,
          "triggers": [
            {
              "definition": "CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON events_app_events FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation()",
              "enabled": "O",
              "name": "custodial_disaster_restore_mutation_fence"
            },
            {
              "definition": "CREATE TRIGGER trg_app_event_cancellation_transition_guard BEFORE UPDATE ON events_app_events FOR EACH ROW EXECUTE FUNCTION app_event_cancellation_transition_guard()",
              "enabled": "O",
              "name": "trg_app_event_cancellation_transition_guard"
            },
            {
              "definition": "CREATE TRIGGER trg_app_event_place_admission_guard BEFORE INSERT OR UPDATE ON events_app_events FOR EACH ROW EXECUTE FUNCTION app_event_place_admission_guard()",
              "enabled": "O",
              "name": "trg_app_event_place_admission_guard"
            },
            {
              "definition": "CREATE TRIGGER trg_app_event_supersession_guard BEFORE INSERT OR DELETE OR UPDATE ON events_app_events FOR EACH ROW EXECUTE FUNCTION app_event_supersession_guard()",
              "enabled": "O",
              "name": "trg_app_event_supersession_guard"
            },
            {
              "definition": "CREATE TRIGGER trg_events_app_delete_retention_guard BEFORE DELETE ON events_app_events FOR EACH ROW EXECUTE FUNCTION events_app_delete_retention_guard()",
              "enabled": "O",
              "name": "trg_events_app_delete_retention_guard"
            },
            {
              "definition": "CREATE TRIGGER trg_events_app_events_set_end_date BEFORE INSERT OR UPDATE OF event_date, end_date ON events_app_events FOR EACH ROW EXECUTE FUNCTION events_app_events_set_end_date()",
              "enabled": "O",
              "name": "trg_events_app_events_set_end_date"
            },
            {
              "definition": "CREATE TRIGGER trg_events_app_events_updated_at BEFORE UPDATE ON events_app_events FOR EACH ROW EXECUTE FUNCTION events_app_set_updated_at()",
              "enabled": "O",
              "name": "trg_events_app_events_updated_at"
            },
            {
              "definition": "CREATE TRIGGER trg_events_app_validate_scope_venue BEFORE INSERT OR UPDATE OF event_scope, primary_venue_id, venue_ids, display_location, coverage_location_ids, staffing_area_ids, event_timezone, location_group_id, parser_confidence, needs_review ON events_app_events FOR EACH ROW EXECUTE FUNCTION events_app_validate_scope_venue()",
              "enabled": "O",
              "name": "trg_events_app_validate_scope_venue"
            },
            {
              "definition": "CREATE TRIGGER trg_events_app_zz_needs_review_isolation BEFORE INSERT OR UPDATE ON events_app_events FOR EACH ROW EXECUTE FUNCTION events_app_isolate_needs_review()",
              "enabled": "O",
              "name": "trg_events_app_zz_needs_review_isolation"
            }
          ]
        },
        "public.events_app_transition_receipts": {
          "acl": [
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "DELETE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "INSERT"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "MAINTAIN"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "REFERENCES"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "SELECT"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "TRIGGER"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "TRUNCATE"
            },
            {
              "grantable": false,
              "grantee": "supabase_admin",
              "grantor": "supabase_admin",
              "privilege": "UPDATE"
            }
          ],
          "columns": [
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "action",
              "not_null": true,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "actor_manager_id",
              "not_null": true,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": "statement_timestamp()",
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "created_at",
              "not_null": true,
              "type": "timestamp with time zone"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "event_id",
              "not_null": true,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "expected_revision",
              "not_null": true,
              "type": "integer"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "history_id",
              "not_null": true,
              "type": "uuid"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "operation_id",
              "not_null": true,
              "type": "uuid"
            },
            {
              "collation": "pg_catalog.default",
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "request_digest",
              "not_null": true,
              "type": "text"
            },
            {
              "collation": null,
              "default": null,
              "dimensions": 0,
              "generated": "",
              "identity": "",
              "inherit_count": 0,
              "local": true,
              "name": "result_record",
              "not_null": true,
              "type": "jsonb"
            }
          ],
          "constraints": [
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (action = ANY (ARRAY['cancel'::text, 'restore'::text]))",
              "name": "events_app_transition_receipts_action_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (actor_manager_id) REFERENCES ops_manager_managers(manager_id)",
              "name": "events_app_transition_receipts_actor_manager_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (event_id) REFERENCES events_app_events(id) ON DELETE CASCADE",
              "name": "events_app_transition_receipts_event_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (expected_revision > 0)",
              "name": "events_app_transition_receipts_expected_revision_check",
              "type": "c",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "FOREIGN KEY (history_id) REFERENCES events_app_event_history(id) ON DELETE CASCADE",
              "name": "events_app_transition_receipts_history_id_fkey",
              "type": "f",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "PRIMARY KEY (operation_id)",
              "name": "events_app_transition_receipts_pkey",
              "type": "p",
              "validated": true
            },
            {
              "deferrable": false,
              "deferred": false,
              "definition": "CHECK (jsonb_typeof(result_record) = 'object'::text)",
              "name": "events_app_transition_receipts_result_record_check",
              "type": "c",
              "validated": true
            }
          ],
          "force_rowsecurity": true,
          "indexes": [
            {
              "definition": "CREATE INDEX events_app_transition_receipts_event_idx ON public.events_app_transition_receipts USING btree (event_id, created_at)",
              "name": "events_app_transition_receipts_event_idx",
              "ready": true,
              "valid": true
            },
            {
              "definition": "CREATE UNIQUE INDEX events_app_transition_receipts_pkey ON public.events_app_transition_receipts USING btree (operation_id)",
              "name": "events_app_transition_receipts_pkey",
              "ready": true,
              "valid": true
            }
          ],
          "kind": "r",
          "owner": "supabase_admin",
          "parents": [],
          "partition": false,
          "persistence": "p",
          "policies": [],
          "rowsecurity": true,
          "triggers": [
            {
              "definition": "CREATE TRIGGER custodial_disaster_restore_mutation_fence BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON events_app_transition_receipts FOR EACH STATEMENT EXECUTE FUNCTION custodial_dr.guard_application_mutation()",
              "enabled": "O",
              "name": "custodial_disaster_restore_mutation_fence"
            },
            {
              "definition": "CREATE TRIGGER trg_app_event_transition_receipt_immutable BEFORE DELETE OR UPDATE ON events_app_transition_receipts FOR EACH ROW EXECUTE FUNCTION app_event_transition_receipt_immutable()",
              "enabled": "O",
              "name": "trg_app_event_transition_receipt_immutable"
            }
          ]
        }
      }
    }
  },
  "reference_provenance": {
    "Root_direct_Source16_and_columns49": {
      "bytes": 42769,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-clean-prefix226-driver04-preparation-20261024T123028Z/ROOT_DIRECT_SOURCE16_AND_COLUMNS49_SEMANTIC_CHECK.json",
      "sha256": "6555cd5d03da9ed8d1c8080c9113a3dfc376bb088e0556c5c830bab552e1a271"
    },
    "Root_selected_prospective_construction": {
      "bytes": 4232,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-selected-prospective-phase-c-constants-20261024T1310Z/ROOT_SELECTED_PROSPECTIVE_PHASE_C_CONSTRUCTION.json",
      "sha256": "a3c27ed75a3ed22bd1ae8fb93f0953cc8076874d51790ba207560546779952ae"
    },
    "Source_DDL_ledger": {
      "bytes": 79365,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/manager-access/fresh291-staged-prefix226-source-ledger-readonly-capture-source01-final/INDEPENDENT_SOURCE_DDL_AND_TRANSFORMATION_LEDGER.json",
      "sha256": "d0b7b93e6f4dde35706458512fd20cbc68657d017a742e055656a4a6e59946a2"
    },
    "Source_acceptance": null,
    "actual_guard_A": {
      "bytes": 2045,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-prefix226-readonly-guard-catalog-0e9011ced647409997a4cccf5b92b4a0/ROOT_ACTUAL_TOOL0_AND_FRESH_CUSTODY_READBACK.json",
      "sha256": "bb60f03e58fa741630b0d273df0f6f07938835481ae9b9faf750104c03b98b56"
    },
    "capture_query": {
      "bytes": 23799,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/manager-access/fresh291-staged-prefix226-readonly-capture-source02/CAPTURE_STAGED_PREFIX226_READONLY.sql",
      "sha256": "a80429d0fa5fd7f03bf5e38f4f73ce9871161bc7f7b9ff955e6a1a84096f6675"
    },
    "complete_controlled_capture": {
      "bytes": 10972012,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-clean-prefix226-reference-98929d18a4fd4d60bb7f955bfd9080fc/0244-capture-reference.stdout",
      "sha256": "9c6f1daa624436daf0e15ee97f94ac5b12b610ff8f754c91ed546557a97c63d3"
    },
    "direct_guard_catalog_capture": {
      "bytes": 3624,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-prefix226-readonly-guard-catalog-0e9011ced647409997a4cccf5b92b4a0/READONLY_CATALOG_CAPTURE.json",
      "sha256": "e64d0bfd6d25ed3da5e67c9a78297d59c8b8d1996ce3af9a9bf70943251669a3"
    },
    "expected_fingerprint_adoption": null,
    "full291_actual": null,
    "full_PG_deparser_strings_are_controlled_construction_outputs_not_independent_Source_hashes": true,
    "full_vendor_NORMAL": false,
    "genuine_complete226_construction": {
      "bytes": 1035188,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-clean-prefix226-driver04-preparation-20261024T123028Z/ROOT_SOURCE05_ACTUAL_CLOSED.json",
      "sha256": "4128e2507dd165a8c61632cbc10f8924bf1f59ae5375520efb86eb85d008c0bc"
    },
    "local_byte_exact_capture": {
      "bytes": 10972012,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/atomic-finalization/fresh291-prospective-staged-reference-five-image-source04/controlled-reference/COMPLETE_ORIGINAL_PREFIX226_CAPTURE.json",
      "sha256": "9c6f1daa624436daf0e15ee97f94ac5b12b610ff8f754c91ed546557a97c63d3"
    },
    "new_two_writer_targets_are_SQL_late_bound_unobserved": true,
    "platform_profile": {
      "bytes": 3653,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-selected-pinned-function-platform-profile04-20261024T1233Z/ROOT_SELECTED_PROFILE.json",
      "sha256": "5f9edfaed64318fd01134a6d01491fb0315fbb5d823e7adc40d10be1e0770b4a"
    },
    "post227_actual": null,
    "post228_actual": null,
    "preservation_baseline": {
      "bytes": 26882,
      "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/atomic-finalization/fresh291-prospective-staged-reference-five-image-source04/CONTROLLED_REFERENCE_PRESERVATION_BASELINE.json",
      "sha256": "dbb5d0d2c23244488a507551c19dc5804df1e50bc380d7809c169b0c757f6781"
    },
    "ready": false,
    "required_fresh_independent_Source_review_before_any_runtime": true
  },
  "reference_result": {
    "bytes": 4232,
    "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-selected-prospective-phase-c-constants-20261024T1310Z/ROOT_SELECTED_PROSPECTIVE_PHASE_C_CONSTRUCTION.json",
    "sha256": "a3c27ed75a3ed22bd1ae8fb93f0953cc8076874d51790ba207560546779952ae"
  },
  "schema": "custodial.fresh291.verified-source-reference.v1",
  "scope": "PROSPECTIVE STAGED SOURCE CONSTANTS FROM ROOT-SELECTED CONTROLLED REFERENCE; existing consumer schema name is not a new independent verdict, runtime admission or fingerprint adoption.",
  "selected_prefix226_sha256": "a6706fdceec604ef82b3d968706ce11137f57f8d58c1cf321fe33e120a6e8b79",
  "selected_replay_lane": "staged"
}
$c04_ref_6d3f90257ac4c4f27f004494$::jsonb;
 expected_source_reference_ref jsonb:=$c04_root_fa0f2cbebc4b9fd9e814d2e3${
  "bytes": 4232,
  "path": "/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/root-selected-prospective-phase-c-constants-20261024T1310Z/ROOT_SELECTED_PROSPECTIVE_PHASE_C_CONSTRUCTION.json",
  "sha256": "a3c27ed75a3ed22bd1ae8fb93f0953cc8076874d51790ba207560546779952ae"
}
$c04_root_fa0f2cbebc4b9fd9e814d2e3$::jsonb;
 contract jsonb;lane text;field_count integer;event_relation oid;event_owner oid;
 expected_prefix constant text:='a6706fdceec604ef82b3d968706ce11137f57f8d58c1cf321fe33e120a6e8b79';
 expected_function_names text[];observed_names text[];function_item record;function_oid oid;
 actual_definition text;actual_acl jsonb;actual_profile jsonb;actual_table record;
 actual_inventory_digest text;actual_inventory_count integer;expected_record record;
begin

 if verified_reference is null or expected_source_reference_ref is null then
  raise exception using errcode='55000',message='HOLD: verified Source-bound reference fingerprints are NULL; no installation authority';
 end if;
 if jsonb_typeof(verified_reference) is distinct from 'object'
  or verified_reference->>'schema' is distinct from 'custodial.fresh291.verified-source-reference.v1'
  or verified_reference->'reference_result' is distinct from expected_source_reference_ref
  or jsonb_typeof(expected_source_reference_ref) is distinct from 'object'
  or (select array_agg(k order by k) from jsonb_object_keys(expected_source_reference_ref) k) is distinct from array['bytes','path','sha256']::text[]
  or jsonb_typeof(expected_source_reference_ref->'path') is distinct from 'string' or left(expected_source_reference_ref->>'path',1)<>'/'
  or coalesce(expected_source_reference_ref->>'sha256','') !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(expected_source_reference_ref->'bytes') is distinct from 'number' or coalesce(expected_source_reference_ref->>'bytes','') !~ '^[1-9][0-9]*$' then
  raise exception 'Source reference schema/ref is not a complete immutable admitted reference';
 end if;
 if current_user<>'supabase_admin' or session_user<>current_user
  or current_setting('session_replication_role')<>'origin' or current_setting('transaction_read_only')<>'off' then
  raise exception 'Fresh replay requires original clean supabase_admin session/creator/context';
 end if;
 event_relation:=to_regclass('public.events_app_events');
 if event_relation is null then raise exception 'Fresh replay original event relation is absent';end if;
 select relowner into event_owner from pg_class where oid=event_relation;
 if event_owner is distinct from (select oid from pg_roles where rolname='supabase_admin') then
  raise exception 'Fresh replay original event owner differs';
 end if;
 select count(*) into field_count from pg_attribute where attrelid=event_relation and attnum>0 and not attisdropped
  and attname in('custodial_note_codes','custodial_public_notes','start_instant_utc','end_instant_utc');
 lock table public.events_app_events in access exclusive mode;
 lock table public.custodial_release_authority_restore_inventory in share row exclusive mode;

 if field_count=0 then lane:='legacy';elsif field_count=4 then lane:='staged';else
  raise exception 'Fresh replay shared four-field shape is partial';end if;
 if to_regprocedure('public.custodial_outlook_event_sync_v1(text,jsonb)') is not null or exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='custodial_outlook_event_sync_v1') then
  raise exception 'Fresh replay installation refuses any existing writer; deployed history is a separate forward lane';
 end if;

 contract:=verified_reference->'contracts'->lane;
 if contract is null or jsonb_typeof(contract) is distinct from 'object' then raise exception 'Selected Source-reference lane remains NULL';end if;
 if lane='staged' then
  if verified_reference->>'selected_prefix226_sha256' is distinct from expected_prefix
   or verified_reference->>'selected_replay_lane' is distinct from 'staged'
   or verified_reference->>'construction' is distinct from 'NEW_CLEAN_SUPABASE_ADMIN_SOURCE_PREFIX226_NO_SYNTHETIC_DATA' then
   raise exception 'Staged reference is not the exact selected clean Source prefix226';end if;
 else
  if verified_reference->>'selected_replay_lane' is distinct from 'legacy'
   or contract->>'legacy_source_basis_sha256' is distinct from '8a0f5f8fee06a367c23d9b8b09e75dde1f13eaea8df8d56aeb26d05cb2117c17' then
   raise exception 'Legacy reference is not the separate exact original Source basis';end if;
 end if;
 if jsonb_typeof(contract->'tables') is distinct from 'object' or jsonb_typeof(contract->'functions') is distinct from 'array'
  or jsonb_typeof(contract->'schema_before') is distinct from 'object' or jsonb_typeof(contract->'schema_after') is distinct from 'object'
  or jsonb_typeof(contract->'inventory_count') is distinct from 'number' or coalesce(contract->>'inventory_count','') !~ '^[1-9][0-9]*$'
  or coalesce(contract->>'inventory_semantic_sha256','') !~ '^[0-9a-f]{64}$' then
  raise exception 'Source-reference structural/dependency/recovery contract is incomplete';end if;
 -- Full Source-owned table profiles include complete constraints/indexes/triggers/policies, not four column names.
 if lane='staged' then
  if (select array_agg(k order by k) from jsonb_object_keys(contract->'tables') k)
   is distinct from array['public.events_app_events','public.events_app_transition_receipts']::text[] then
   raise exception 'Staged Source-reference table closure differs';end if;
 else
  if (select array_agg(k order by k) from jsonb_object_keys(contract->'tables') k)
   is distinct from array['public.events_app_events']::text[] then raise exception 'Legacy table closure differs';end if;
 end if;
 for actual_table in select key identity,value profile from jsonb_each(contract->'tables') loop

 select jsonb_build_object(
  'owner',pg_get_userbyid(c.relowner),'kind',c.relkind::text,'persistence',c.relpersistence::text,
  'partition',c.relispartition,'rowsecurity',c.relrowsecurity,'force_rowsecurity',c.relforcerowsecurity,
  'parents',coalesce((select jsonb_agg(i.inhparent::regclass::text order by i.inhparent::regclass::text) from pg_inherits i where i.inhrelid=c.oid),'[]'::jsonb),
  'acl',coalesce((select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
   from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a),'[]'::jsonb),
  'columns',coalesce((select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity::text,'generated',a.attgenerated::text,
   'dimensions',a.attndims,'collation',case when a.attcollation=0 then null else cn.nspname||'.'||co.collname end,
   'local',a.attislocal,'inherit_count',a.attinhcount) order by a.attname)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   left join pg_collation co on co.oid=a.attcollation left join pg_namespace cn on cn.oid=co.collnamespace
   where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
  'constraints',coalesce((select jsonb_agg(jsonb_build_object('name',x.conname,'type',x.contype::text,
   'definition',pg_get_constraintdef(x.oid,true),'validated',x.convalidated,'deferrable',x.condeferrable,'deferred',x.condeferred)
   order by x.conname) from pg_constraint x where x.conrelid=c.oid),'[]'::jsonb),
  'indexes',coalesce((select jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),
   'valid',i.indisvalid,'ready',i.indisready) order by ic.relname)
   from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid),'[]'::jsonb),
  'triggers',coalesce((select jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true),
   'enabled',t.tgenabled::text) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),'[]'::jsonb),
  'policies',coalesce((select jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd::text,'permissive',p.polpermissive,
   'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),
   'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname)
   from pg_policy p where p.polrelid=c.oid),'[]'::jsonb)
 ) into actual_profile from pg_class c where c.oid=to_regclass(actual_table.identity);

  if actual_profile is distinct from actual_table.profile then raise exception 'Source-owned table profile differs: %',actual_table.identity;end if;
 end loop;
 if lane='staged' then expected_function_names:=array['public.app_apply_event_command(text,uuid,jsonb,text,text)','public.custodial_begin_application_mutation_lease(uuid,text)','public.custodial_release_application_mutation_lease(uuid)','public.custodial_release_authority_current_relation_definition(text)','public.custodial_release_authority_current_column_set_definition(text)','public.custodial_release_authority_current_column_definition(text)','public.custodial_release_authority_current_constraint_definition(text)','public.custodial_release_authority_current_index_definition(text)','public.custodial_release_authority_current_relation_state_definition(text)','public.custodial_release_authority_current_grant_definition(text)','public.static_weekly_digest_text(text)','public.app_event_supersession_guard()','public.app_replace_event_authoritative(uuid,integer,jsonb,uuid)','public.app_event_cancellation_transition_guard()','public.app_event_transition_receipt_immutable()','public.app_transition_event_cancellation(uuid,text,integer,uuid,uuid,text)']::text[];else expected_function_names:=array['public.app_apply_event_command(text,uuid,jsonb,text,text)','public.custodial_begin_application_mutation_lease(uuid,text)','public.custodial_release_application_mutation_lease(uuid)','public.custodial_release_authority_current_relation_definition(text)','public.custodial_release_authority_current_column_set_definition(text)','public.custodial_release_authority_current_column_definition(text)','public.custodial_release_authority_current_constraint_definition(text)','public.custodial_release_authority_current_index_definition(text)','public.custodial_release_authority_current_relation_state_definition(text)','public.custodial_release_authority_current_grant_definition(text)','public.static_weekly_digest_text(text)']::text[];end if;
 select array_agg(x.identity order by x.identity) into observed_names from jsonb_to_recordset(contract->'functions') x(identity text);
 if observed_names is distinct from (select array_agg(x order by x) from unnest(expected_function_names) x) then
  raise exception 'Source-reference exact function closure/membership differs';end if;
 for function_item in select * from jsonb_to_recordset(contract->'functions') x(identity text,definition_sha256 text,owner_name text,acl jsonb) loop
  if coalesce(function_item.definition_sha256,'') !~ '^[0-9a-f]{64}$' or function_item.owner_name is null or jsonb_typeof(function_item.acl) is distinct from 'array' then
   raise exception 'Source-reference function proof is incomplete';end if;
  function_oid:=to_regprocedure(function_item.identity);
  if function_oid is null then raise exception 'Required Source function is absent: %',function_item.identity;end if;
  actual_definition:=pg_get_functiondef(function_oid);
  if encode(extensions.digest(convert_to(actual_definition,'UTF8'),'sha256'),'hex') is distinct from function_item.definition_sha256
   or (select pg_get_userbyid(proowner) from pg_proc where oid=function_oid) is distinct from function_item.owner_name then
   raise exception 'Required Source function definition/owner differs: %',function_item.identity;end if;
  select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
   'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable),'[]'::jsonb)
   into actual_acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=function_oid;
  if actual_acl is distinct from function_item.acl then raise exception 'Required Source function ACL differs: %',function_item.identity;end if;
 end loop;
 -- Explicit hash-bound NONCANONICAL_NO_AUTO_GRANTS_TEST_FIXTURE reference.
 -- Full source vector SHA256 3c4a1594fe392b6274c09cb73b79b27cddfce5817d5009ad336672e2eab3b955 (4714789 bytes).
 -- This is comparison-only: no inventory row, grant, normal image, or canonical SQL is changed.
 if lane <> 'staged' then raise exception 'No-auto fixture requires exact staged source lane';end if;
 if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclobjtype in ('r','S')
   and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)) then
  raise exception 'No-auto fixture table/sequence defaults are not zero';end if;
 if (select array_agg(restore_order order by restore_order) from public.custodial_release_authority_restore_inventory
  where object_kind='constraint' and object_identity=any(array['maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_actor_manager_id_fkey','maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_outcome_check','maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_pkey','maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_ticket_id_fkey','maintenance_tickets:maintenance_ticket_resolution_evidence_check','maintenance_tickets:maintenance_tickets_resolution_actor_manager_id_fkey']::text[]))
  is distinct from array[500000,501237,501238,501241,501242,501243]::integer[] then
  raise exception 'No-auto exact six source-unordered constraint order permutation differs';end if;
 for expected_record in select * from jsonb_to_recordset($no_auto_grants$[{"kind":"grant","order":900026,"sha256":"f0bc3b6fb092702b873ee6b55c05903294a0cb26586563b897fb35433b0bb7f9","identity":"public.custodial_session_corrections","definition":"select public.custodial_release_authority_reset_grants('public.custodial_session_corrections'); grant INSERT on table public.custodial_session_corrections to postgres; grant SELECT on table public.custodial_session_corrections to postgres; grant SELECT on table public.custodial_session_corrections to service_role;"},{"kind":"grant","order":900036,"sha256":"93abb99740611008b55417482209d0c85cb291076207ee86e4ffb43f4220a025","identity":"public.device_auth_removal_operations","definition":"select public.custodial_release_authority_reset_grants('public.device_auth_removal_operations'); grant INSERT on table public.device_auth_removal_operations to postgres; grant SELECT on table public.device_auth_removal_operations to postgres; grant INSERT on table public.device_auth_removal_operations to service_role; grant SELECT on table public.device_auth_removal_operations to service_role; grant SELECT on table public.device_auth_removal_operations to custodial_application_reader;"},{"kind":"grant","order":900093,"sha256":"fcbf2c457b02a90f964cffe63175ed4bbb411a51418f63bdea3b76bbe317474a","identity":"public.msg_thread_deletion_operations","definition":"select public.custodial_release_authority_reset_grants('public.msg_thread_deletion_operations'); grant DELETE on table public.msg_thread_deletion_operations to postgres; grant INSERT on table public.msg_thread_deletion_operations to postgres; grant SELECT on table public.msg_thread_deletion_operations to postgres; grant UPDATE on table public.msg_thread_deletion_operations to postgres; grant DELETE on table public.msg_thread_deletion_operations to service_role; grant INSERT on table public.msg_thread_deletion_operations to service_role; grant SELECT on table public.msg_thread_deletion_operations to service_role; grant UPDATE on table public.msg_thread_deletion_operations to service_role;"},{"kind":"grant","order":900104,"sha256":"c033f1f8ab7607644ce3e84ce3967a7c58b4622e10de974d5ebac726e7d62e0a","identity":"public.ops_manager_notification_preferences","definition":"select public.custodial_release_authority_reset_grants('public.ops_manager_notification_preferences'); grant DELETE on table public.ops_manager_notification_preferences to postgres; grant INSERT on table public.ops_manager_notification_preferences to postgres; grant SELECT on table public.ops_manager_notification_preferences to postgres; grant UPDATE on table public.ops_manager_notification_preferences to postgres; grant DELETE on table public.ops_manager_notification_preferences to service_role; grant INSERT on table public.ops_manager_notification_preferences to service_role; grant SELECT on table public.ops_manager_notification_preferences to service_role; grant UPDATE on table public.ops_manager_notification_preferences to service_role; grant SELECT on table public.ops_manager_notification_preferences to custodial_application_reader;"},{"kind":"grant","order":900088,"sha256":"407d9a983f2f7d9fdf0e119a6b3079e745e5990c4fb1f6dba0d437435bc04bc0","identity":"public.msg_message_audit","definition":"select public.custodial_release_authority_reset_grants('public.msg_message_audit'); grant SELECT on table public.msg_message_audit to service_role;"},{"kind":"grant","order":900006,"sha256":"17f0d9fe32b656a6678aee14b9ac575863c07eccf9324b3d6b08efbe90f2918b","identity":"public.custodial_employee_status_history","definition":"select public.custodial_release_authority_reset_grants('public.custodial_employee_status_history'); grant DELETE on table public.custodial_employee_status_history to postgres; grant INSERT on table public.custodial_employee_status_history to postgres; grant SELECT on table public.custodial_employee_status_history to postgres; grant UPDATE on table public.custodial_employee_status_history to postgres; grant DELETE on table public.custodial_employee_status_history to service_role; grant INSERT on table public.custodial_employee_status_history to service_role; grant SELECT on table public.custodial_employee_status_history to service_role; grant UPDATE on table public.custodial_employee_status_history to service_role; grant SELECT on table public.custodial_employee_status_history to custodial_application_reader;"},{"kind":"grant","order":900108,"sha256":"a02093760cff3c234380d192cfd4cef2a134331feca85ed8221896e6d36b3e76","identity":"public.ops_manager_push_devices","definition":"select public.custodial_release_authority_reset_grants('public.ops_manager_push_devices'); grant DELETE on table public.ops_manager_push_devices to postgres; grant INSERT on table public.ops_manager_push_devices to postgres; grant SELECT on table public.ops_manager_push_devices to postgres; grant UPDATE on table public.ops_manager_push_devices to postgres; grant DELETE on table public.ops_manager_push_devices to service_role; grant INSERT on table public.ops_manager_push_devices to service_role; grant SELECT on table public.ops_manager_push_devices to service_role; grant UPDATE on table public.ops_manager_push_devices to service_role; grant SELECT on table public.ops_manager_push_devices to custodial_application_reader;"},{"kind":"grant","order":900058,"sha256":"627e08babcc019a2cdac97fcf7f4e1adccd7a63ffc6bd8eb8221fbd37e09ca50","identity":"public.event_push_instances","definition":"select public.custodial_release_authority_reset_grants('public.event_push_instances'); grant DELETE on table public.event_push_instances to postgres; grant INSERT on table public.event_push_instances to postgres; grant SELECT on table public.event_push_instances to postgres; grant UPDATE on table public.event_push_instances to postgres; grant DELETE on table public.event_push_instances to service_role; grant INSERT on table public.event_push_instances to service_role; grant SELECT on table public.event_push_instances to service_role; grant UPDATE on table public.event_push_instances to service_role; grant SELECT on table public.event_push_instances to custodial_application_reader;"},{"kind":"grant","order":900015,"sha256":"4f824eb56a569e35a75e9a3eee04072ec91c0477b0ff01bae0e68f9eb763943a","identity":"public.custodial_offline_scan_authority_snapshots","definition":"select public.custodial_release_authority_reset_grants('public.custodial_offline_scan_authority_snapshots'); grant SELECT on table public.custodial_offline_scan_authority_snapshots to custodial_application_reader;"},{"kind":"grant","order":900106,"sha256":"222112fc4690ec7fc4a1cde7899416bc724a78bbc07a43ca4743d5e51e9371ce","identity":"public.ops_manager_notification_state","definition":"select public.custodial_release_authority_reset_grants('public.ops_manager_notification_state'); grant DELETE on table public.ops_manager_notification_state to postgres; grant INSERT on table public.ops_manager_notification_state to postgres; grant SELECT on table public.ops_manager_notification_state to postgres; grant UPDATE on table public.ops_manager_notification_state to postgres; grant DELETE on table public.ops_manager_notification_state to service_role; grant INSERT on table public.ops_manager_notification_state to service_role; grant SELECT on table public.ops_manager_notification_state to service_role; grant UPDATE on table public.ops_manager_notification_state to service_role; grant SELECT on table public.ops_manager_notification_state to custodial_application_reader;"},{"kind":"grant","order":900098,"sha256":"34c82b300a74aabab88327a5c87c1829deb41a095e32aae0d4b2d86bfa5720e7","identity":"public.operational_notification_jobs","definition":"select public.custodial_release_authority_reset_grants('public.operational_notification_jobs'); grant INSERT on table public.operational_notification_jobs to service_role; grant SELECT on table public.operational_notification_jobs to service_role; grant UPDATE on table public.operational_notification_jobs to service_role; grant SELECT on table public.operational_notification_jobs to custodial_application_reader;"},{"kind":"grant","order":900001,"sha256":"a809f0bd302ec292999d2fa2bf4f75fbe9254d29ba48b826abc805b2ae281f2a","identity":"public.cleaning_inspections","definition":"select public.custodial_release_authority_reset_grants('public.cleaning_inspections'); grant DELETE on table public.cleaning_inspections to postgres; grant INSERT on table public.cleaning_inspections to postgres; grant SELECT on table public.cleaning_inspections to postgres; grant UPDATE on table public.cleaning_inspections to postgres; grant SELECT on table public.cleaning_inspections to service_role; grant SELECT on table public.cleaning_inspections to custodial_application_reader;"},{"kind":"grant","order":950111,"sha256":"609afcdbc8937a8206a9b30493fbee700d61fe05c609aa1f4f65388d8ae92aa7","identity":"public.v_weekly_schedule_effective_ranges","definition":"select public.custodial_release_authority_reset_grants('public.v_weekly_schedule_effective_ranges'); grant SELECT on table public.v_weekly_schedule_effective_ranges to custodial_application_reader;"},{"kind":"grant","order":900034,"sha256":"6e2b0b8cb92704b8fd7f0074a84722dbfa749a323836c40bb269683a8d7d8563","identity":"public.device_auth_enrollment_operations","definition":"select public.custodial_release_authority_reset_grants('public.device_auth_enrollment_operations'); grant DELETE on table public.device_auth_enrollment_operations to postgres; grant INSERT on table public.device_auth_enrollment_operations to postgres; grant SELECT on table public.device_auth_enrollment_operations to postgres; grant UPDATE on table public.device_auth_enrollment_operations to postgres; grant DELETE on table public.device_auth_enrollment_operations to service_role; grant INSERT on table public.device_auth_enrollment_operations to service_role; grant SELECT on table public.device_auth_enrollment_operations to service_role; grant UPDATE on table public.device_auth_enrollment_operations to service_role; grant SELECT on table public.device_auth_enrollment_operations to custodial_application_reader;"},{"kind":"grant","order":900051,"sha256":"53d490ad69b0ce490e07d9a8cef48d9f07d334cee6a22f4be0a9974838e4dc17","identity":"public.employee_push_registrations","definition":"select public.custodial_release_authority_reset_grants('public.employee_push_registrations'); grant DELETE on table public.employee_push_registrations to postgres; grant INSERT on table public.employee_push_registrations to postgres; grant SELECT on table public.employee_push_registrations to postgres; grant UPDATE on table public.employee_push_registrations to postgres; grant DELETE on table public.employee_push_registrations to service_role; grant INSERT on table public.employee_push_registrations to service_role; grant SELECT on table public.employee_push_registrations to service_role; grant UPDATE on table public.employee_push_registrations to service_role; grant SELECT on table public.employee_push_registrations to custodial_application_reader;"},{"kind":"grant","order":900005,"sha256":"60e71cffd2b183205b3265815ddfffb8a2589f91fe7d088479ec5a250b6ae2a2","identity":"public.custodial_employee_device_assignment_history","definition":"select public.custodial_release_authority_reset_grants('public.custodial_employee_device_assignment_history'); grant DELETE on table public.custodial_employee_device_assignment_history to postgres; grant INSERT on table public.custodial_employee_device_assignment_history to postgres; grant SELECT on table public.custodial_employee_device_assignment_history to postgres; grant UPDATE on table public.custodial_employee_device_assignment_history to postgres; grant DELETE on table public.custodial_employee_device_assignment_history to service_role; grant INSERT on table public.custodial_employee_device_assignment_history to service_role; grant SELECT on table public.custodial_employee_device_assignment_history to service_role; grant UPDATE on table public.custodial_employee_device_assignment_history to service_role; grant SELECT on table public.custodial_employee_device_assignment_history to custodial_application_reader;"},{"kind":"grant","order":900105,"sha256":"e7a8d8b271caa6f9095c8d37c7d794a2d2ed7f2b2304e3b80fdf8ba2af3fe80e","identity":"public.ops_manager_notification_queue","definition":"select public.custodial_release_authority_reset_grants('public.ops_manager_notification_queue'); grant DELETE on table public.ops_manager_notification_queue to postgres; grant INSERT on table public.ops_manager_notification_queue to postgres; grant SELECT on table public.ops_manager_notification_queue to postgres; grant UPDATE on table public.ops_manager_notification_queue to postgres; grant DELETE on table public.ops_manager_notification_queue to service_role; grant INSERT on table public.ops_manager_notification_queue to service_role; grant SELECT on table public.ops_manager_notification_queue to service_role; grant UPDATE on table public.ops_manager_notification_queue to service_role; grant SELECT on table public.ops_manager_notification_queue to custodial_application_reader;"}]$no_auto_grants$::jsonb)
  x(kind text,identity text,"order" integer,definition text,sha256 text) loop
  if (select count(*) from public.custodial_release_authority_restore_inventory
   where object_kind=expected_record.kind and object_identity=expected_record.identity
    and restore_order=expected_record."order" and definition_sql=expected_record.definition
    and definition_sha256=expected_record.sha256) <> 1 then
   raise exception 'No-auto source-bound grant definition/order differs: %',expected_record.identity;end if;
 end loop;
 with allowed(identity,canonical_order) as (values ('maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_actor_manager_id_fkey',501238),('maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_outcome_check',501241),('maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_pkey',501242),('maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_ticket_id_fkey',501243),('maintenance_tickets:maintenance_ticket_resolution_evidence_check',500000),('maintenance_tickets:maintenance_tickets_resolution_actor_manager_id_fkey',501237))
 select count(*),encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_object('kind',i.object_kind,'identity',i.object_identity,
  'order',case when i.object_kind='constraint' then coalesce(a.canonical_order,i.restore_order) else i.restore_order end,
  'definition',i.definition_sql,'sha256',i.definition_sha256) order by i.object_kind,i.object_identity,i.restore_order),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
 into actual_inventory_count,actual_inventory_digest from public.custodial_release_authority_restore_inventory i
 left join allowed a on i.object_kind='constraint' and i.object_identity=a.identity;
 if actual_inventory_count <> 6503 or actual_inventory_digest is distinct from '40a10a8569fe98a40b6490a8f37db5340ca14f56c95f51b66e638ed322d856b5' then
  raise exception 'No-auto full source-derived recovery membership/definitions/orders differ';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  and tgname='trg_custodial_release_authority_restore_inventory_immutable' and tgenabled='A') then
  raise exception 'Fresh replay original inventory guard unavailable';end if;

 if public.custodial_release_authority_current_relation_definition('public.events_app_events') is distinct from contract#>>'{schema_before,relation}'
  or public.custodial_release_authority_current_column_set_definition('public.events_app_events') is distinct from contract#>>'{schema_before,column_set}' then
  raise exception 'Fresh replay exact predecessor relation/list differs';end if;
 if lane='legacy' and (public.static_weekly_digest_text(contract#>>'{schema_before,relation}') is distinct from '2e7f7f4abb847a7104be258188cbd0bd567b7deb10f503b7f47348df191310bb'
  or public.static_weekly_digest_text(contract#>>'{schema_before,column_set}') is distinct from 'fedc604747bc2a4ddadf9bc36ab1d412bd5f57d962c6823cf527f37d3fcc8469') then
  raise exception 'Legacy Source predecessor differs from immutable228';end if;
end $fresh_reference_preflight$;

-- One event source; no new public table grants, no human-manager impersonation.
-- Existing event/history/Outlook-ledger rows and restore guards are preserved.
alter table public.events_app_events
 add column if not exists custodial_public_notes text,
 add column if not exists custodial_note_codes text[] not null default '{}',
 add column if not exists start_instant_utc timestamptz,
 add column if not exists end_instant_utc timestamptz;

create or replace function public.custodial_outlook_event_sync_v1(p_action text,p_observation jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $function$
declare
 v_input jsonb:=p_observation; v_source jsonb; v_record jsonb; v_before jsonb;
 v_existing public.events_app_events%rowtype; v_saved public.events_app_events%rowtype;
 v_ledger public.events_app_outlook_sync%rowtype; v_prior public.events_app_outlook_sync%rowtype;
 v_message text;v_key text;v_hash text;v_status text;v_reason text;v_event_id uuid;
 v_source_at timestamptz;v_received_at timestamptz;v_start timestamptz;v_end timestamptz;
 v_date date;v_end_date date;v_start_time time;v_end_time time;v_revision integer;
 v_request uuid:=gen_random_uuid();v_lease jsonb;v_result jsonb;v_actor constant text:='ChatGPT Outlook Sync';
 v_venue public.event_venues%rowtype;v_scope text;v_mailbox constant text:='eoperle@memphiszoo.org';
begin
 if jsonb_typeof(v_input) is distinct from 'object' or octet_length(v_input::text)>65536 then
  raise exception using errcode='22023',message='A bounded JSON observation is required';end if;
 if p_action='status' then
  select * into v_ledger from public.events_app_outlook_sync where source_event_key='custodial-outlook-events-v1/checkpoint'
   order by received_at desc,id desc limit 1;
  return jsonb_build_object('schema','custodial.outlook-event-sync.v1','writer_ready',true,'mailbox',v_mailbox,
   'cursor',v_ledger.source_payload->>'through','checkpoint_at',v_ledger.created_at,
   'last_import_at',(select max(created_at) from public.events_app_outlook_sync where source_event_key like 'custodial-outlook-events-v1/event/%' and sync_status in ('APPLIED','CANCELLED','UNCHANGED')));
 end if;
 if p_action not in ('apply','cancel','review','checkpoint') or p_action is null then
  raise exception using errcode='22023',message='Unsupported Outlook synchronization action';end if;
 -- Same existing restore lease and transaction-level admission lock as the app.
 v_lease:=public.custodial_begin_application_mutation_lease(v_request,'custodial-outlook-events-v1');
 if v_lease->'mutations_paused' is distinct from 'false'::jsonb then
  raise exception using errcode='55000',message='Event mutations are paused';end if;
 perform pg_advisory_xact_lock(hashtextextended('custodial-outlook-events-v1',0));
 if p_action='checkpoint' then
  if v_input->>'mailbox' is distinct from v_mailbox or v_input->'complete' is distinct from 'true'::jsonb
   or coalesce(v_input->>'evidence_sha256','') !~ '^[0-9a-f]{64}$' or coalesce(v_input->>'run_id','') !~ '^[0-9a-f-]{36}$'
   or coalesce(v_input->>'pages_read','') !~ '^[1-9][0-9]{0,6}$' then raise exception using errcode='22023',message='Complete authenticated source review evidence is required';end if;
  v_source_at:=(v_input->>'through')::timestamptz;v_received_at:=(v_input->>'from')::timestamptz;
  if v_source_at is null or v_received_at is null or not isfinite(v_source_at) or not isfinite(v_received_at)
   or v_source_at>clock_timestamp()+interval '1 minute' or v_received_at>v_source_at then
   raise exception using errcode='22023',message='Invalid reviewed time window';end if;
  select * into v_prior from public.events_app_outlook_sync where source_event_key='custodial-outlook-events-v1/checkpoint' order by received_at desc limit 1;
  if v_prior.id is not null and v_received_at>(v_prior.source_payload->>'through')::timestamptz then
   raise exception using errcode='22023',message='Collector window leaves a coverage gap';end if;
  v_message:='collector:'||(v_input->>'run_id');v_key:='custodial-outlook-events-v1/checkpoint';v_hash:=encode(digest(v_input::text,'sha256'),'hex');
  select * into v_ledger from public.events_app_outlook_sync where outlook_message_id=v_message and source_event_key=v_key;
  if v_ledger.id is not null and v_ledger.payload_hash is distinct from v_hash then raise exception using errcode='40901',message='Checkpoint replay conflict';end if;
  insert into public.events_app_outlook_sync(outlook_message_id,source_event_key,received_at,payload_hash,sync_status,source_payload)
   values(v_message,v_key,v_source_at,v_hash,'UNCHANGED',v_input) on conflict(outlook_message_id,source_event_key) do nothing;
  perform public.custodial_release_application_mutation_lease(v_request);
  return jsonb_build_object('state','CHECKPOINT_SAVED','through',v_source_at,'replayed',v_ledger.id is not null);
 end if;
 v_source:=v_input->'source';v_message:=v_source->>'message_id';v_key:=v_input->>'source_event_key';
 if jsonb_typeof(v_source) is distinct from 'object' or v_source->>'mailbox' is distinct from v_mailbox
  or coalesce(length(v_message),0) not between 8 and 1500 or coalesce(length(v_key),0) not between 5 and 400
  or coalesce(v_source->>'content_sha256','') !~ '^[0-9a-f]{64}$'
  or coalesce(v_source->>'evidence_kind','') not in ('original_event_notice','event_update','event_cancellation') then
  raise exception using errcode='22023',message='Verified original Outlook event source is required';end if;
 if p_action='cancel' and v_source->>'evidence_kind'<>'event_cancellation' then
  raise exception using errcode='22023',message='Ticket closure is not event cancellation';end if;
 v_source_at:=(v_source->>'source_at')::timestamptz;v_received_at:=(v_source->>'received_at')::timestamptz;
 if v_source_at is null or v_received_at is null or not isfinite(v_source_at) or not isfinite(v_received_at)
  or v_source_at>clock_timestamp()+interval '10 minutes' or v_received_at>clock_timestamp()+interval '10 minutes' then
  raise exception using errcode='22023',message='Invalid Outlook source timestamps';end if;
 v_key:='custodial-outlook-events-v1/event/'||v_key;
 v_hash:=encode(digest(jsonb_build_object('action',p_action,'observation',v_input)::text,'sha256'),'hex');
 select * into v_ledger from public.events_app_outlook_sync where outlook_message_id=v_message and source_event_key=v_key;
 if v_ledger.id is not null then
  if v_ledger.payload_hash is distinct from v_hash then raise exception using errcode='40901',message='Source identity replay has different content';end if;
  perform public.custodial_release_application_mutation_lease(v_request);
  return jsonb_build_object('state',v_ledger.sync_status,'event_id',v_ledger.event_id,'replayed',true,'ledger_id',v_ledger.id);
 end if;
 select * into v_prior from public.events_app_outlook_sync where source_event_key=v_key and event_id is not null
  and sync_status in ('APPLIED','CANCELLED','UNCHANGED') order by (source_payload->'source'->>'source_at')::timestamptz desc,created_at desc limit 1;
 v_event_id:=coalesce(nullif(v_input->>'event_id','')::uuid,v_prior.event_id);
 if v_prior.event_id is not null and v_prior.event_id is distinct from v_event_id then
  raise exception using errcode='40901',message='Source key belongs to another event';end if;
 if v_event_id is not null then
  select * into v_existing from public.events_app_events where id=v_event_id for update;
  if v_existing.id is null then raise exception using errcode='P0002',message='Referenced event not found';end if;
 end if;
 v_before:=case when v_existing.id is not null then to_jsonb(v_existing) end;
 if p_action='review' then v_status:='NEEDS_REVIEW';v_reason:=left(coalesce(v_input->>'reason','Unresolved event facts'),1000);
 elsif v_existing.manually_overridden then v_status:='BLOCKED_MANUAL';v_reason:='Preserved owner override';
 elsif v_prior.id is not null and v_source_at<(v_prior.source_payload->'source'->>'source_at')::timestamptz then v_status:='UNCHANGED';v_reason:='Older source ignored';
 elsif v_prior.id is not null and v_source_at=(v_prior.source_payload->'source'->>'source_at')::timestamptz then v_status:='NEEDS_REVIEW';v_reason:='Conflicting equal-time source requires review';
 else
  if v_existing.id is not null then
   v_revision:=(v_input->>'expected_revision')::integer;
   if v_revision is null or v_revision is distinct from v_existing.revision then raise exception using errcode='40901',message='Event revision changed; reconcile before retry';end if;
  end if;
  if p_action='cancel' then
   if v_existing.id is null then raise exception using errcode='P0002',message='Cancellation requires an existing event';end if;
   if v_existing.status='CANCELLED' then v_saved:=v_existing;v_status:='UNCHANGED';
   else update public.events_app_events set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=v_actor,
    cancellation_reason=left(coalesce(v_input->>'reason','Authoritative Outlook cancellation'),1000),cancelled_by_manager_id=null,
    revision=coalesce(revision,1)+1,source_format='outlook_auto_sync' where id=v_event_id returning * into v_saved;
    v_status:='CANCELLED';end if;
  else
   v_record:=v_input->'event';v_scope:=v_record->>'event_scope';
   if jsonb_typeof(v_record) is distinct from 'object' or coalesce(length(btrim(v_record->>'event_name')),0) not between 1 and 180
    or v_scope not in ('ZOO_WIDE','SINGLE_VENUE','MULTI_VENUE','OFFSITE') or v_scope is null
    or coalesce(length(v_record->>'custodial_public_notes'),0)>500
    or exists(select 1 from jsonb_object_keys(v_record) k where k not in ('event_name','event_scope','primary_venue_id','venue_ids','location_group_id','display_location','event_date','end_date','start_time','end_time','start_instant_utc','end_instant_utc','attendee_count','custodial_public_notes','custodial_note_codes','coverage_location_ids')) then
    raise exception using errcode='22023',message='Invalid or unapproved event fields';end if;
   v_date:=(v_record->>'event_date')::date;v_end_date:=(v_record->>'end_date')::date;
   v_start_time:=(v_record->>'start_time')::time;v_end_time:=(v_record->>'end_time')::time;
   v_start:=(v_record->>'start_instant_utc')::timestamptz;v_end:=(v_record->>'end_instant_utc')::timestamptz;
   if v_start is null or v_end is null or v_date is null or v_end_date is null or v_start_time is null or v_end_time is null
    or not isfinite(v_start) or not isfinite(v_end) or v_end<=v_start or v_end_date<v_date or v_end_date>v_date+1
    or (v_start at time zone 'America/Chicago')::date<>v_date or (v_end at time zone 'America/Chicago')::date<>v_end_date
    or (v_start at time zone 'America/Chicago')::time<>v_start_time or (v_end at time zone 'America/Chicago')::time<>v_end_time then
    raise exception using errcode='22023',message='Explicit event dates, times and Chicago instants must agree';end if;
   if v_record->'attendee_count' is not null and v_record->'attendee_count'<>'null'::jsonb and (jsonb_typeof(v_record->'attendee_count')<>'number' or (v_record->>'attendee_count') !~ '^[0-9]+$') then
    raise exception using errcode='22023',message='Attendance must be a nonnegative integer or null';end if;
   if jsonb_typeof(coalesce(v_record->'custodial_note_codes','[]'))<>'array' or exists(select 1 from jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]')) x where x not in ('trash_boxes','extra_cans','restroom_checks')) then
    raise exception using errcode='22023',message='Unknown custodial note code';end if;
   if v_existing.id is null and exists(select 1 from public.events_app_events where lower(btrim(event_name))=lower(btrim(v_record->>'event_name')) and event_date=v_date) then
    raise exception using errcode='40901',message='Possible existing event; resolve its identity before creating another';end if;
   if v_scope in ('SINGLE_VENUE','ZOO_WIDE') then
    select * into v_venue from public.event_venues where id=nullif(v_record->>'primary_venue_id','')::uuid and active is true;
    if v_venue.id is null or (v_scope='SINGLE_VENUE' and v_venue.eligible_event_venue is not true)
     or (v_scope='ZOO_WIDE' and v_venue.venue_code<>'ZOO_FOOTPRINT') then raise exception using errcode='22023',message='Active eligible venue required';end if;
   end if;
   if v_existing.id is null then
    insert into public.events_app_events(event_name,event_scope,primary_venue_id,venue_ids,location_group_id,display_location,
     event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,attendee_count,custodial_public_notes,custodial_note_codes,
     coverage_location_ids,source_format,created_by,needs_review,manually_overridden,event_timezone,revision)
    values(btrim(v_record->>'event_name'),v_scope,nullif(v_record->>'primary_venue_id','')::uuid,
     array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]')))::uuid[],(v_record->>'location_group_id')::uuid,
     v_record->>'display_location',v_date,v_end_date,v_start_time,v_end_time,v_start,v_end,(v_record->>'attendee_count')::integer,
     v_record->>'custodial_public_notes',array(select jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]'))),
     array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]')))::uuid[],
     'outlook_auto_sync',v_actor,false,false,'America/Chicago',1) returning * into v_saved;
   else
    update public.events_app_events set event_name=btrim(v_record->>'event_name'),event_scope=v_scope,
     primary_venue_id=nullif(v_record->>'primary_venue_id','')::uuid,venue_ids=array(select jsonb_array_elements_text(coalesce(v_record->'venue_ids','[]')))::uuid[],
     location_group_id=(v_record->>'location_group_id')::uuid,display_location=v_record->>'display_location',event_date=v_date,end_date=v_end_date,
     start_time=v_start_time,end_time=v_end_time,start_instant_utc=v_start,end_instant_utc=v_end,attendee_count=(v_record->>'attendee_count')::integer,
     custodial_public_notes=v_record->>'custodial_public_notes',custodial_note_codes=array(select jsonb_array_elements_text(coalesce(v_record->'custodial_note_codes','[]'))),
     coverage_location_ids=array(select jsonb_array_elements_text(coalesce(v_record->'coverage_location_ids','[]')))::uuid[],
     source_format='outlook_auto_sync',revision=coalesce(revision,1)+1 where id=v_event_id returning * into v_saved;
   end if;
   v_status:='APPLIED';
  end if;
  v_event_id:=v_saved.id;
  if v_status in ('APPLIED','CANCELLED') then
   insert into public.events_app_event_history(event_id,action,actor,reason,previous_record,new_record)
    values(v_event_id,case when v_before is null then 'create' when p_action='cancel' then 'cancel' else 'update' end,v_actor,
     'Original Outlook source '||v_message,v_before,to_jsonb(v_saved));
  end if;
 end if;
 insert into public.events_app_outlook_sync(outlook_message_id,source_event_key,event_id,received_at,source_subject,payload_hash,sync_status,sync_note,source_payload)
  values(v_message,v_key,v_event_id,v_received_at,left(v_source->>'subject',200),v_hash,v_status,v_reason,v_input) returning * into v_ledger;
 perform public.custodial_release_application_mutation_lease(v_request);
 return jsonb_build_object('schema','custodial.outlook-event-sync.v1','state',v_status,'event_id',v_event_id,
  'revision',coalesce(v_saved.revision,v_existing.revision),'ledger_id',v_ledger.id,'source_sha256',v_hash,'replayed',false,'reason',v_reason);
end
$function$;
revoke all on function public.custodial_outlook_event_sync_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.custodial_outlook_event_sync_v1(text,jsonb) to service_role;

-- Installation postflight uses the unchanged original real writer definition.
do $fresh_writer_postflight$
declare writer oid;writer_owner oid;field record;actual_field record;
begin
  -- Reconcile only the exact real Source writer; a name/type match is not authority.
  writer:=to_regprocedure('public.custodial_outlook_event_sync_v1(text,jsonb)');
  if writer is null then
   raise exception 'Existing shared Event fields require the exact admitted Outlook writer';
  end if;
  select p.proowner into writer_owner from pg_catalog.pg_proc p where p.oid=writer;
  if writer_owner is distinct from (select c.relowner from pg_catalog.pg_class c where c.oid='public.events_app_events'::regclass)
   or not exists(select 1 from pg_catalog.pg_roles r where r.oid=writer_owner and r.rolname in ('postgres','supabase_admin')) then
   raise exception 'Existing shared Event writer original owner differs';
  end if;
  if encode(extensions.digest(convert_to(pg_get_functiondef(writer),'UTF8'),'sha256'),'hex')
   is distinct from '943393c799426d0430a44b0056db6b292d171f5e637c66f059fac4beff65a067' then
   raise exception 'Existing shared Event writer Source differs';
  end if;
  -- Preserve the exact owner-aware service-only administrative boundary in228.
  if has_function_privilege('anon',writer,'EXECUTE') or has_function_privilege('authenticated',writer,'EXECUTE')
   or not has_function_privilege('service_role',writer,'EXECUTE') or exists(
    select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=writer and (a.privilege_type<>'EXECUTE' or a.is_grantable
     or a.grantee not in(p.proowner,(select oid from pg_catalog.pg_roles where rolname='postgres'),
      (select oid from pg_catalog.pg_roles where rolname='service_role')))) then
   raise exception 'Existing shared Event writer owner-aware service-only ACL differs';
  end if;
  if not exists(select 1 from pg_catalog.pg_class c where c.oid='public.events_app_events'::regclass
   and c.relkind='r' and c.relpersistence='p' and not c.relispartition and c.relrowsecurity and c.relforcerowsecurity) then
   raise exception 'Existing shared Event relation authority differs';
  end if;
  for field in select * from (values
   ('custodial_note_codes','text[]',true,'''{}''::text[]',1),
   ('custodial_public_notes','text',false,null::text,0),
   ('start_instant_utc','timestamp with time zone',false,null::text,0),
   ('end_instant_utc','timestamp with time zone',false,null::text,0)
  ) wanted(name,data_type,not_null,expression,dimensions) loop
   select format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,
    pg_get_expr(d.adbin,d.adrelid) expression,a.attidentity,a.attgenerated,a.attndims,
    a.attcollation,t.typcollation,a.attislocal,a.attinhcount into actual_field
   from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid=a.atttypid
   left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid='public.events_app_events'::regclass and a.attname=field.name and a.attnum>0 and not a.attisdropped;
   if not found then raise exception 'Existing shared Event four-field shape is incomplete';end if;
   if actual_field.data_type is distinct from field.data_type or actual_field.not_null is distinct from field.not_null
    or actual_field.expression is distinct from field.expression or actual_field.attidentity<>'' or actual_field.attgenerated<>''
    or actual_field.attndims<>field.dimensions or actual_field.attcollation is distinct from actual_field.typcollation
    or not actual_field.attislocal or actual_field.attinhcount<>0 then
    raise exception 'Existing shared Event field declaration differs: %',field.name;
   end if;
  end loop;
end $fresh_writer_postflight$;
commit;
