"""Test held manager RPCs against original table constraints and ownership triggers."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import uuid
import time

root = Path(__file__).resolve().parents[1]
migrations = root / 'supabase/migrations'
image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
container='custodial-registration-fixture-'+uuid.uuid4().hex

def sql(statement):
    return subprocess.run(['docker','exec','-i',container,'psql','-XAtq','-h','/fixture','-U','postgres','-v','ON_ERROR_STOP=1'],
                          input=statement,text=True,check=True,capture_output=True).stdout.strip()

def rejected(statement, message):
    try: sql(statement)
    except subprocess.CalledProcessError as e:
        if message in e.stderr: return
        raise AssertionError(e.stderr) from e
    raise AssertionError('Expected refusal: '+message)

def source(prefix):
    return next(migrations.glob(prefix+'_*')).read_text()

manager1,manager2,cred1,cred2 = [str(uuid.uuid4()) for _ in range(4)]
token='fake-test-only-token-0000001'
def register(credential,manager,token,platform='ios'):
    return f"set role service_role;select ops_manager_register_push('{credential}','{manager}','fixture','{platform}','{token}',null,null)"
def failure(scope):return f"set role service_role;select ops_manager_record_auth_failure('{scope}',repeat('a',64),'{{}}')"
try:
    subprocess.run(['docker','run','-d','--pull=never','--name',container,'--network','none','--read-only',
        '--user','100:101','--tmpfs','/fixture:rw,mode=0700,uid=100,gid=101','--tmpfs','/tmp:rw,mode=1777',
        '--memory','450m','--pids-limit','96','--entrypoint','/bin/bash',image,'-ec',
        '''initdb -D /fixture/db -U postgres -A trust --no-locale >/dev/null; exec postgres -D /fixture/db -c listen_addresses='' -c unix_socket_directories=/fixture -c shared_preload_libraries='' '''],check=True,capture_output=True)
    for _ in range(80):
        if subprocess.run(['docker','exec',container,'pg_isready','-h','/fixture'],capture_output=True).returncode==0:break
        time.sleep(.1)
    original=source('20260721203000')
    tables=original[original.index('create table if not exists public.ops_manager_notification_preferences'):original.index('create or replace function public.ops_manager_enqueue_message_push')]
    sql(f"""create role anon;create role authenticated;create role service_role bypassrls;
      create table ops_manager_managers(manager_id uuid primary key);
      create table ops_manager_trusted_devices(credential_id uuid primary key,manager_id uuid,revoked_at timestamptz,expires_at timestamptz);
      insert into ops_manager_managers values('{manager1}'),('{manager2}');
      insert into ops_manager_trusted_devices values('{cred1}','{manager1}',null,now()+interval '1 day'),('{cred2}','{manager2}',null,now()+interval '1 day');"""+tables)
    for prefix,table in [('20260717200242','ops_manager_device_security_rate_limits'),('20260717235932','ops_manager_enrollment_code_rate_limits')]:
        s=source(prefix); a=s.index('create table if not exists public.'+table+' (')
        sql(s[a:s.index('\n);',a)+3]+f'grant select,insert,update,delete on {table} to service_role;')
    sql((root/'proposals/manager-registration-and-failure-counters.sql').read_text())
    for role in ['authenticated','anon']:
        rejected(f"set role {role};select ops_manager_register_push(null,null,null,null,null,null,null)",'permission denied')
        rejected(f"set role {role};select ops_manager_record_auth_failure(null,null,null)",'permission denied')
    import json
    old=json.loads(sql(register(cred1,manager1,token)))
    new=json.loads(sql(register(cred2,manager2,token+'new')))
    rejected(register(cred2,manager2,token,'invalid'),'platform')
    assert sql(f"select credential_id from ops_manager_push_devices where fcm_token='{token}' and enabled")==cred1
    assert sql(f"select credential_id from ops_manager_push_devices where fcm_token='{token}new' and enabled")==cred2
    sql(f"update ops_manager_trusted_devices set revoked_at=now() where credential_id='{cred1}'")
    final=json.loads(sql(register(cred2,manager2,token)));assert final['credential_id']==cred2 and final['push_device_id']==new['push_device_id'] and 'fcm_token' not in final
    assert json.loads(sql(register(cred2,manager2,token)))['push_device_id']==final['push_device_id']
    assert sql('select count(*) from ops_manager_push_devices where enabled')=='1'
    assert sql(f"select count(*) from ops_manager_notification_preferences where credential_id='{cred1}'")=='1'
    rejected(register(cred1,manager1,token),'active trusted manager device')
    assert sql(f"select credential_id from ops_manager_push_devices where fcm_token='{token}' and enabled")==cred2
    print('PASS transfer with retired original, unique destination, replay, protected token, original preferences, failed transfer restores both original registrations')
    for scope,table in [('device_security','ops_manager_device_security_rate_limits'),('enrollment_code','ops_manager_enrollment_code_rate_limits')]:
        with ThreadPoolExecutor(max_workers=7) as pool:
            rows=sorted((json.loads(x) for x in pool.map(lambda _:sql(failure(scope)),range(7))),key=lambda r:r['failure_count'])
        assert [r['failure_count'] for r in rows]==list(range(1,8))
        assert all(bool(r['locked_until'])==(r['failure_count']>=5) for r in rows)
        assert sql(f"select locked_until>clock_timestamp() from {table}")=='t'
        sql(f"update {table} set first_failed_at=now()-interval '1 hour',locked_until=now()-interval '1 second'")
        assert json.loads(sql(failure(scope)))['failure_count']==1
        assert sql(f"select locked_until is null from {table}")=='t'
        print('PASS',scope,'7 concurrent sessions count individually; five-attempt lock and expired-window restart')
finally:
    subprocess.run(['docker','rm','-f',container],capture_output=True)
