-- Run only against an isolated TEST database with no operational records.
-- Guard errors precede source lookup; legal kinds with this absent synthetic
-- generation must remain unavailable and must never admit delivery.
BEGIN;
DO $guard_tests$
DECLARE
 id constant uuid:='00000000-0000-4000-8000-000000000001';
 at_time constant timestamptz:='2026-10-08T20:35:00Z';
 c record;v jsonb;state text;checked integer:=0;
BEGIN
 IF EXISTS(SELECT 1 FROM public.employee_native_push_generations WHERE generation_id=id) THEN
  RAISE EXCEPTION 'Synthetic guard-test generation is not absent';END IF;
 FOR c IN SELECT * FROM (VALUES
  ('null_kind',null::text,id,id,id,at_time,'22023'),
  ('unknown_kind','UNKNOWN',id,id,id,at_time,'22023'),
  ('empty_kind','',id,id,id,at_time,'22023'),
  ('valid_MESSAGE','MESSAGE',id,id,id,at_time,'TARGET_STALE'),
  ('valid_SCHEDULE','SCHEDULE',id,id,id,at_time,'TARGET_STALE'),
  ('valid_LUNCH','LUNCH',id,id,id,at_time,'TARGET_STALE'),
  ('null_source','LUNCH',null::uuid,id,id,at_time,'22023'),
  ('null_employee','LUNCH',id,null::uuid,id,at_time,'22023'),
  ('null_generation','LUNCH',id,id,null::uuid,at_time,'22023'),
  ('null_time','LUNCH',id,id,id,null::timestamptz,'22023'),
  ('infinite_time','LUNCH',id,id,id,'infinity'::timestamptz,'22023')
 ) q(name,kind,source_key,employee_id,generation_id,source_at,expected) LOOP
  v:=null;state:=null;
  BEGIN
   v:=public.custodial_native_target_source_at(c.kind,c.source_key,c.employee_id,c.generation_id,c.source_at);
   state:=v->>'status';
  EXCEPTION WHEN OTHERS THEN state:=SQLSTATE;END;
  IF state IS DISTINCT FROM c.expected THEN
   RAISE EXCEPTION 'Native source guard %: expected %, got %',c.name,c.expected,state;END IF;
  IF v IS NOT NULL AND v->'delivery_admitted' IS DISTINCT FROM 'false'::jsonb THEN
   RAISE EXCEPTION 'Native source guard % admitted delivery',c.name;END IF;
  checked:=checked+1;
 END LOOP;
 IF checked<>11 THEN RAISE EXCEPTION 'Native source guard test count changed';END IF;
 RAISE NOTICE 'Native source kind guard: 11 assertions passed';
END $guard_tests$;
ROLLBACK;
