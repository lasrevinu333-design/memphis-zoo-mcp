-- Pure PostgreSQL metadata predicate qualification only. No target/archive,
-- business DATA, actors, schemas, grants, routines or production admission.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
CREATE TEMP TABLE cancellation127_observed(owner_name text,public_schema boolean,kind text,security_definer boolean,
 volatility text,configuration text[],body_md5 text,definition_md5 text,definition_sha256 text,named_acl jsonb,
 owner_execute boolean,control_execute boolean,denied_runtime_execute boolean,grant_definition text,grant_sha256 text) ON COMMIT DROP;
INSERT INTO cancellation127_observed VALUES('postgres',true,'f',true,'v',ARRAY['search_path=pg_catalog, public'],
 '5a44d92246554e8ba37081c3ee0cfbe0','b2ad1bcabfdd6b77b7a824dfdf020cdd','ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016',
'[{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"EXECUTE"},{"grantee":"static_weekly_control_plane","grantor":"postgres","grantable":false,"privilege":"EXECUTE"}]'::jsonb,true,true,false,'select public.custodial_release_authority_reset_grants(''public.static_weekly_v3_read_manager_snapshot(date)''); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;','363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee');
CREATE TEMP TABLE cancellation127_baseline ON COMMIT DROP AS TABLE cancellation127_observed;
CREATE TEMP TABLE cancellation127_cases(name text,passed boolean) ON COMMIT DROP;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;

INSERT INTO cancellation127_cases SELECT 'exact original current metadata', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM true;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET owner_name=NULL;
INSERT INTO cancellation127_cases SELECT 'missing owner', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET owner_name='supabase_admin';
INSERT INTO cancellation127_cases SELECT 'different owner', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET public_schema=false;
INSERT INTO cancellation127_cases SELECT 'wrong schema', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET kind='p';
INSERT INTO cancellation127_cases SELECT 'wrong routine kind', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET security_definer=false;
INSERT INTO cancellation127_cases SELECT 'wrong security', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET volatility='s';
INSERT INTO cancellation127_cases SELECT 'wrong volatility', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET configuration=NULL;
INSERT INTO cancellation127_cases SELECT 'wrong configuration', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET body_md5=repeat('0',32);
INSERT INTO cancellation127_cases SELECT 'wrong body', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET definition_sha256=repeat('0',64);
INSERT INTO cancellation127_cases SELECT 'wrong full definition', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET definition_md5=repeat('0',32);
INSERT INTO cancellation127_cases SELECT 'wrong full MD5', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET owner_execute=false;
INSERT INTO cancellation127_cases SELECT 'missing owner execute', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET control_execute=false;
INSERT INTO cancellation127_cases SELECT 'missing control execute', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET denied_runtime_execute=true;
INSERT INTO cancellation127_cases SELECT 'new runtime execute', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET grant_definition=grant_definition||' ';
INSERT INTO cancellation127_cases SELECT 'grant bytes changed', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET grant_sha256=repeat('0',64);
INSERT INTO cancellation127_cases SELECT 'grant digest changed', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET named_acl=named_acl-1;
INSERT INTO cancellation127_cases SELECT 'missing ACL entry', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET named_acl=named_acl||jsonb_build_array(named_acl->0);
INSERT INTO cancellation127_cases SELECT 'extra ACL entry', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET named_acl=jsonb_set(named_acl,'{1,grantor}','"static_weekly_control_plane"');
INSERT INTO cancellation127_cases SELECT 'wrong grantor', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET named_acl=jsonb_set(named_acl,'{1,privilege}','"SELECT"');
INSERT INTO cancellation127_cases SELECT 'wrong privilege', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET named_acl=jsonb_set(named_acl,'{1,grantable}','true');
INSERT INTO cancellation127_cases SELECT 'grantable changed', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DELETE FROM cancellation127_observed; INSERT INTO cancellation127_observed TABLE cancellation127_baseline;
UPDATE cancellation127_observed SET named_acl=jsonb_set(named_acl,'{1,grantee}','"service_role"');
INSERT INTO cancellation127_cases SELECT 'named role changed', EXISTS(SELECT 1 FROM cancellation127_observed o WHERE
o.owner_name='postgres' AND o.public_schema AND o.kind='f'
   AND o.security_definer AND o.volatility='v'
   AND o.configuration=ARRAY['search_path=pg_catalog, public']::text[]
   AND o.body_md5='5a44d92246554e8ba37081c3ee0cfbe0'
   AND o.definition_md5='b2ad1bcabfdd6b77b7a824dfdf020cdd'
   AND o.definition_sha256='ab1583186f60403baea1ef6041881d18ef96181d6f14fd789e637aff0c59d016'
   AND o.named_acl='[{"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},{"grantee":"static_weekly_control_plane","grantor":"postgres","privilege":"EXECUTE","grantable":false}]'::jsonb
   AND o.owner_execute AND o.control_execute AND NOT o.denied_runtime_execute
   AND o.grant_definition=$existing_grant$select public.custodial_release_authority_reset_grants('public.static_weekly_v3_read_manager_snapshot(date)'); grant execute on function static_weekly_v3_read_manager_snapshot(date) to static_weekly_control_plane;$existing_grant$
   AND o.grant_sha256='363ba443a22e34a7aada201ae2cbfadf2b456cd443bbae2dd9ce113d686557ee') IS NOT DISTINCT FROM false;
DO $assert$ BEGIN IF EXISTS(SELECT 1 FROM cancellation127_cases WHERE passed IS DISTINCT FROM true) THEN
 RAISE EXCEPTION 'Pure cancellation127 metadata predicate refused expected shape';END IF;END $assert$;
SELECT 'PURE_METADATA_ONLY_NO_TARGET_NO_PRIVILEGE_PROOF' scope,count(*) cases,bool_and(passed) all_passed FROM cancellation127_cases;
ROLLBACK;
