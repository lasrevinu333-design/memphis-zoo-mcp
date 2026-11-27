"""Exercise the two held 429 successor RPCs with independent PostgreSQL sessions."""
import subprocess
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sql_dir = root / 'release/pending-reviewed-sql'
image = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
container = 'custodial-assignment-fixture-' + uuid.uuid4().hex

def sql(statement):
    return subprocess.run(['docker','exec','-i',container,'psql','-XAtq','-h','/fixture','-U','postgres','-v','ON_ERROR_STOP=1'], input=statement,text=True,check=True,capture_output=True).stdout.strip()

a,b,credential,device,manager = [str(uuid.uuid4()) for _ in range(5)]
try:
    subprocess.run(['docker','run','-d','--pull=never','--name',container,'--network','none','--read-only',
        '--user','100:101','--tmpfs','/fixture:rw,mode=0700,uid=100,gid=101','--tmpfs','/tmp:rw,mode=1777',
        '--memory','450m','--pids-limit','64','--entrypoint','/bin/bash',image,'-ec',
        '''initdb -D /fixture/db -U postgres -A trust --no-locale >/dev/null; exec postgres -D /fixture/db -c listen_addresses='' -c unix_socket_directories=/fixture -c shared_preload_libraries='' '''],check=True,capture_output=True)
    import time
    for _ in range(80):
        if subprocess.run(['docker','exec',container,'pg_isready','-h','/fixture'],capture_output=True).returncode == 0: break
        time.sleep(.1)
    sql(f"""create role anon;create role authenticated;create role static_weekly_control_plane;create role service_role;
    create table devices(id uuid primary key,device_id text unique,active boolean,assigned_employee_id uuid,assignment_epoch bigint);
    create table employees(id uuid primary key,active boolean);
    create table device_auth_credentials(credential_id uuid primary key,device_id uuid,confirmed_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    create table fixture_originals(id text primary key);
    insert into employees values('{a}',true),('{b}',true);
    insert into devices values('{device}','KIOSK_08',true,'{a}',2);
    insert into device_auth_credentials values('{credential}','{device}',now(),null,now()+interval '1 day');
    create function custodial_assert_manager(uuid) returns void language sql as $$select$$;
    create function custodial_assign_employee_device(text,uuid,uuid,text,boolean) returns jsonb language sql as $$
    update devices set assignment_epoch=assignment_epoch+1,assigned_employee_id=$2 where device_id=$1 returning to_jsonb(devices)$$;
    create function app_apply_operational_command(text,jsonb) returns jsonb language sql as $$insert into fixture_originals values($2->>'operation_id') on conflict do nothing;select $2$$;""")
    for name in ('20261126010800','20261126010801'):
        sql(next(sql_dir.glob(name+'_*')).read_text())
    def change(owner,epoch,target):return f"select custodial_assign_employee_device_at_epoch('KIOSK_08','{target}','{manager}','fixture','{owner}',{epoch});"
    def feedback(owner,epoch,key):return f"""select custodial_feedback_create_current_employee(jsonb_build_object('operation_id','{key}','hub_context','employee','device_id','KIOSK_08','metadata_json',jsonb_build_object('identity_verification',jsonb_build_object('status','verified','kind','enrolled_employee_device','device_id','KIOSK_08','employee_id','{owner}','credential_id','{credential}','assignment_epoch',{epoch}))));"""
    def rejects(stmt,reason):
        try:sql(stmt)
        except subprocess.CalledProcessError as exc:
            if reason in exc.stderr:return
            raise AssertionError(exc.stderr) from exc
        raise AssertionError('unexpected successful write')
    # Hold the production RPC's transaction open after it admits the original. Another
    # session must be unable to advance the assignment until that write commits.
    with subprocess.Popen(['docker','exec','-i',container,'psql','-XAtq','-h','/fixture','-U','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True) as session:
        session.stdin.write('BEGIN;\n'+feedback(a,2,'first')+'\n\\echo locked\n');session.stdin.flush()
        while True:
            line=session.stdout.readline()
            if not line:raise RuntimeError('fixture session ended before lock')
            if line.strip()=='locked':break
        rejects("set lock_timeout='150ms';"+change(a,2,b),'lock timeout')
        session.stdin.write('COMMIT;\n\\q\n');session.stdin.flush();assert session.wait(timeout=10)==0
    sql(change(a,2,b));rejects(feedback(a,2,'former'),'no longer current');sql(change(b,3,a));
    rejects(change(a,2,b),'assignment changed');rejects(feedback(a,2,'stale'),'no longer current');sql(feedback(a,4,'successor'));sql(feedback(a,4,'successor'))
    assert sql('select string_agg(id,\',\' order by id) from fixture_originals')=='first,successor'
    print('PASS feedback share lock blocks reassignment until commit, post-reassignment submissions fail, A-B-A stale assignment and feedback fail, current successor and original idempotency pass; synthetic database and downstream command fixtures.')
finally:
    subprocess.run(['docker','rm','-f',container],capture_output=True)
