-- Pure PostgreSQL ACL-array predicate semantics only; no actual function/role changes or catalog admission.
BEGIN;
DO $tests$
DECLARE owner_oid oid:='postgres'::regrole;postgres_oid oid:='postgres'::regrole;
 inventory_guard_before record;test record;admitted boolean;cases integer:=0;
BEGIN
 FOR test IN SELECT * FROM(VALUES
 ('owner-only','{postgres=X/postgres}'::aclitem[],true),
 ('NULL',NULL::aclitem[],false),('empty','{}'::aclitem[],false),
 ('PUBLIC-extra','{postgres=X/postgres,=X/postgres}'::aclitem[],false),
 ('PUBLIC-only','{=X/postgres}'::aclitem[],false),
 ('wrong-grantor','{postgres=X/pg_database_owner}'::aclitem[],false),
 ('grant-option','{postgres=X*/postgres}'::aclitem[],false),
 ('wrong-privilege','{postgres=r/postgres}'::aclitem[],false),
 ('duplicate-owner','{postgres=X/postgres,postgres=X/postgres}'::aclitem[],false)
 ) x(label,acl,expected) LOOP
  SELECT test.acl proacl INTO inventory_guard_before;
  IF inventory_guard_before.proacl IS NULL
    OR (SELECT count(*) FROM pg_catalog.aclexplode(inventory_guard_before.proacl))<>(SELECT count(DISTINCT principal) FROM (VALUES(owner_oid),(postgres_oid)) expected(principal))
    OR (SELECT count(DISTINCT grantee) FROM pg_catalog.aclexplode(inventory_guard_before.proacl))<>(SELECT count(DISTINCT principal) FROM (VALUES(owner_oid),(postgres_oid)) expected(principal))
    OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(inventory_guard_before.proacl) a
      WHERE a.grantee NOT IN(owner_oid,postgres_oid) OR a.grantor<>owner_oid
        OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
 THEN admitted:=false;ELSE admitted:=true;END IF;
  IF admitted IS DISTINCT FROM test.expected THEN RAISE EXCEPTION 'ACL predicate mismatch: %',test.label;END IF;cases:=cases+1;
 END LOOP;
 -- Distinct original owner/principal still requires exactly two distinct rows.
 postgres_oid:='pg_database_owner'::regrole;
 SELECT '{postgres=X/postgres,pg_database_owner=X/postgres}'::aclitem[] proacl INTO inventory_guard_before;
 IF inventory_guard_before.proacl IS NULL
    OR (SELECT count(*) FROM pg_catalog.aclexplode(inventory_guard_before.proacl))<>(SELECT count(DISTINCT principal) FROM (VALUES(owner_oid),(postgres_oid)) expected(principal))
    OR (SELECT count(DISTINCT grantee) FROM pg_catalog.aclexplode(inventory_guard_before.proacl))<>(SELECT count(DISTINCT principal) FROM (VALUES(owner_oid),(postgres_oid)) expected(principal))
    OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(inventory_guard_before.proacl) a
      WHERE a.grantee NOT IN(owner_oid,postgres_oid) OR a.grantor<>owner_oid
        OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
 THEN RAISE EXCEPTION 'distinct original two-principal shape refused';END IF;cases:=cases+1;
 RAISE NOTICE 'PASS exact adapted Source153 ACL-array predicate cases=%; not actual owner/catalog admission',cases;
END $tests$;
ROLLBACK;
