// Fresh local reconstruction only. This never authorizes production migration,
// arbitrary normalization, grants, restore admission or a schema fingerprint.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const REFERENCE_SHA='2f0b2b84762a4786560c59880a076b1e869575af5b1f221830b7b4f0ca67c5b3';
const EXPECTED='d9abaf120c47e789c6b3114717f14eb76d1ceacf9aea5600bccfb1005a176d27';
const PREIMAGE='71e312f7ada5e0caa097bcbdd81be07cc65d936b160a46dcdca795deaf1ae8ab';
const CONSTRAINT_ORDER_PREIMAGE='629aa8e6c31bfc8e2b656f3f43cc7ff4663395b97022be24b86ddfca46f8fb23';
const CANARY='d87c2c10574dbcaf542245a83b8019e66017b819a0abcc54d313074f831afb84';
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
export function source252FreshOrderSql(bytes){
 if(sha(bytes)!==REFERENCE_SHA)throw Error('Exact sealed Source252 reference required');
 const ref=JSON.parse(bytes);
 if(ref.inventory_sha256!==EXPECTED||ref.canary_sha256!==CANARY||ref.count!==6884
  ||ref.source?.commit!=='9a0da26eb3e0d0052227da15224cbc78ee8705c0'
  ||ref.actual_production!==false||ref.release_admission!==false||ref.rows.length!==6884)
  throw Error('Source252 reference scope differs');
 const tuples=ref.rows.map(([kind,identity,order,digest])=>`(${q(kind)},${q(identity)},${Number(order)},${q(digest)})`).join(',\n');
 return `-- Exact Source252 fresh replay order repair. All6884 original definitions
-- and original identity/order targets come from the unchanged sealed reference.
-- Only the recorded eleven-position or seventeen-position permutation may change,
-- within the original column/function-GRANT and exact six constraint buckets. No SQL definition, ACL or business row changes.
BEGIN;
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $local_fixture$ BEGIN
 IF current_user<>'supabase_admin' OR session_user<>'supabase_admin'
 OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) NOT IN('supabase_admin','postgres')
 OR current_setting('listen_addresses')<>'' OR current_setting('cron.launch_active_jobs')<>'off'
 THEN RAISE EXCEPTION 'Owned isolated fresh fixture required; not a production transition';END IF;
END $local_fixture$;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source252_expected(kind text,identity text,expected_order integer,digest text,PRIMARY KEY(kind,identity)) ON COMMIT DROP;
INSERT INTO source252_expected VALUES ${tuples};
CREATE TEMP TABLE source252_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
DO $source_bound$ DECLARE observed text;expected text;BEGIN
 IF (SELECT count(*) FROM source252_before)<>6884
 OR public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure))<>${q(CANARY)}
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 OR to_regclass('public.custodial_native_private_custody_operations') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclnamespace IN(0,'public'::regnamespace) AND d.defaclobjtype IN('r','S')
   AND a.grantee IN(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
 OR EXISTS(SELECT 1 FROM source252_expected e FULL JOIN source252_before a ON (a.object_kind,a.object_identity)=(e.kind,e.identity)
  WHERE e.kind IS NULL OR a.object_kind IS NULL OR a.definition_sha256<>e.digest
   OR public.static_weekly_digest_text(a.definition_sql)<>e.digest)
 THEN RAISE EXCEPTION 'Source252 exact definitions, original guard or no-auto context differs';END IF;
 SELECT public.static_weekly_digest_text(string_agg(restore_order::text||E'\\n'||object_kind||E'\\n'||object_identity||E'\\n'||definition_sha256,E'\\n---\\n'
  ORDER BY object_kind COLLATE "C",object_identity COLLATE "C")) INTO observed FROM source252_before;
 SELECT public.static_weekly_digest_text(string_agg(expected_order::text||E'\\n'||kind||E'\\n'||identity||E'\\n'||digest,E'\\n---\\n'
  ORDER BY kind COLLATE "C",identity COLLATE "C")) INTO expected FROM source252_expected;
 IF expected<>${q(EXPECTED)} OR observed NOT IN(${q(PREIMAGE)},${q(CONSTRAINT_ORDER_PREIMAGE)},${q(EXPECTED)})
 THEN RAISE EXCEPTION 'Unrecognized Source252 predecessor or sealed order reference';END IF;
 IF observed=${q(EXPECTED)} THEN RETURN;END IF;
 IF (SELECT count(*) FROM source252_before a JOIN source252_expected e ON(a.object_kind,a.object_identity)=(e.kind,e.identity) WHERE a.restore_order<>e.expected_order)<>(CASE WHEN observed=${q(CONSTRAINT_ORDER_PREIMAGE)} THEN 17 ELSE 11 END)
 OR EXISTS(SELECT 1 FROM source252_before a JOIN source252_expected e ON(a.object_kind,a.object_identity)=(e.kind,e.identity)
  WHERE a.restore_order<>e.expected_order AND NOT ((a.object_kind='column' AND a.restore_order IN(200000,202106,202107) AND e.expected_order IN(200000,202106,202107))
   OR (observed=${q(CONSTRAINT_ORDER_PREIMAGE)} AND a.object_kind='constraint'
    AND a.object_identity IN('maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_actor_manager_id_fkey',
     'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_outcome_check',
     'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_pkey',
     'maintenance_ticket_outcome_history:maintenance_ticket_outcome_history_ticket_id_fkey',
     'maintenance_tickets:maintenance_ticket_resolution_evidence_check',
     'maintenance_tickets:maintenance_tickets_resolution_actor_manager_id_fkey')
    AND a.restore_order IN(500000,501237,501238,501241,501242,501243)
    AND e.expected_order IN(500000,501237,501238,501241,501242,501243))
   OR (a.object_kind='grant' AND a.restore_order IN(1000012,1000013,1000099,1000100,1000161,1000162,1000173,1000174)
    AND e.expected_order IN(1000012,1000013,1000099,1000100,1000161,1000162,1000173,1000174))))
 THEN RAISE EXCEPTION 'Only exact observed independent column/grant order permutation may be repaired';END IF;
 -- Original source migrations use the same exclusive-lock metadata update
 -- boundary. Every definition and target order was checked before opening it.
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory a SET restore_order=e.expected_order
 FROM source252_expected e WHERE(a.object_kind,a.object_identity)=(e.kind,e.identity) AND a.restore_order<>e.expected_order;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS((SELECT inventory_id,object_kind,object_identity,definition_sql,definition_sha256,captured_at FROM source252_before)
  EXCEPT (SELECT inventory_id,object_kind,object_identity,definition_sql,definition_sha256,captured_at FROM public.custodial_release_authority_restore_inventory))
 OR EXISTS((SELECT inventory_id,object_kind,object_identity,definition_sql,definition_sha256,captured_at FROM public.custodial_release_authority_restore_inventory)
  EXCEPT (SELECT inventory_id,object_kind,object_identity,definition_sql,definition_sha256,captured_at FROM source252_before))
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 THEN RAISE EXCEPTION 'Unrelated recovery data or immutable guard changed';END IF;
 SELECT public.static_weekly_digest_text(string_agg(restore_order::text||E'\\n'||object_kind||E'\\n'||object_identity||E'\\n'||definition_sha256,E'\\n---\\n'
  ORDER BY object_kind COLLATE "C",object_identity COLLATE "C")) INTO observed FROM public.custodial_release_authority_restore_inventory;
 IF observed<>${q(EXPECTED)} THEN RAISE EXCEPTION 'Source252 original predecessor not restored exactly';END IF;
END $source_bound$;
COMMIT;
`;
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 const ref=readFileSync(new URL('../release/production-forward-source/private-custody-source252-reference.json',import.meta.url));
 process.stdout.write(source252FreshOrderSql(ref));
}
