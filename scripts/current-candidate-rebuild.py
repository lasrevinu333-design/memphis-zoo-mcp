import pathlib,json,hashlib,subprocess,time,os,uuid
import argparse,stat,sys
parser=argparse.ArgumentParser(description='Explicit isolated current308 reconstruction, never production or release admission')
parser.add_argument('--workspace',required=True,help='new owned disposable directory on a disk-backed secondary filesystem')
parser.add_argument('--evidence',required=True,help='new durable evidence directory')
parser.add_argument('--vendor-fixture',required=True,help='unchanged hash-bound SQL fixture from the pinned image')
parser.add_argument('--consumer-spec',help='explicit owned local CI consumer spec; never deployment or release')
args=parser.parse_args()
consumer_spec=args.consumer_spec
B=pathlib.Path(__file__).resolve().parent.parent
D=pathlib.Path(args.workspace);O=pathlib.Path(args.evidence);V=pathlib.Path(args.vendor_fixture)
for p in [D,O,V]:
 if not p.is_absolute() or p.is_symlink() or p.resolve()!=p:parser.error('exact absolute non-symlink paths required')
if D.exists() or O.exists() or not V.is_dir():parser.error('workspace/evidence must be new; exact vendor fixture must exist')
if not D.parent.is_dir() or not O.parent.is_dir():parser.error('existing owned parent directories required')
# PGDATA must be disk-backed, never tmpfs/ramfs/overlay or the root disk.
fs=subprocess.check_output(['stat','-f','-c','%T',str(D.parent)],text=True).strip()
if fs in ['tmpfs','ramfs','overlayfs'] or D.parent.stat().st_dev==pathlib.Path('/').stat().st_dev:
 parser.error('owned secondary disk-backed workspace required')
O.mkdir(mode=0o700);D.mkdir(mode=0o700);(D/'pgdata').mkdir(mode=0o700);(D/'init').mkdir(mode=0o755)
data_inode=(D/'pgdata').stat().st_ino
owner=str(uuid.uuid4());N='mz_schema_rebuild_current308_'+owner.replace('-','')
I='public.ecr.aws/supabase/postgres@sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518'
cid=None; helper=None;result={'scope':'EXPLICIT_CURRENT308_FRESH_PROFILE_RECONSTRUCTION_NOT_PRODUCTION_OR_RELEASE_ADMISSION','name':N,'owner':owner,'memory':536870912,'migrations':[],'passed':False};start=time.time()
def run(a,data=None,timeout=30):return subprocess.run(['docker','--host=unix:///var/run/docker.sock',*a],input=data,text=True,capture_output=True,timeout=timeout)
def docker(a,**kw):
 p=run(a,**kw)
 if p.returncode:raise RuntimeError(p.stderr[-4000:])
 return p.stdout.strip()
def inspect(c):return json.loads(docker(['inspect','--format','{{json .}}',c]))
def own(c,name):
 d=inspect(c);assert d['Name']=='/'+name and d['Config']['Labels']['custodial.audit.owner']==owner and d['HostConfig']['Memory']==536870912 and d['HostConfig']['MemorySwap']==536870912 and d['HostConfig']['NetworkMode']=='none' and d['HostConfig']['ReadonlyRootfs'] is True;return d
try:
 assert run(['image','inspect',I]).returncode==0,'pinned image must already be cached; this constructor never pulls'
 assert run(['inspect',N]).returncode!=0
 rows=json.loads((B/'supabase/canonical/migration-replay-order.json').read_text())['phases'];rows=[x for p in rows for x in p['files']]
 for x in rows:assert hashlib.sha256((B/'supabase/migrations'/x['name']).read_bytes()).hexdigest()==x['sha256']
 profile=json.loads(subprocess.check_output(['node',str(B/'scripts/current-candidate-replay-profile.mjs'),'--describe'],text=True));assert profile['migration_count']==308
 (O/'CURRENT308_PROFILE.json').write_text(json.dumps(profile,indent=2));effective={x['name']:x for x in profile['effective_sql']}
 catalog_sql=subprocess.check_output(['node',str(B/'scripts/current-candidate-catalog-snapshot.mjs'),'--sql'],text=True)

 args=['create','--name',N,'--label','custodial.audit.owner='+owner,'--network','none','--read-only','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','128','--no-healthcheck','--log-driver','local','--log-opt','max-size=1m','--log-opt','max-file=2','--tmpfs','/tmp:rw,size=64m','--tmpfs','/var/run/postgresql:rw,size=8m','--mount',f'type=bind,source={D}/pgdata,target=/var/lib/postgresql/data,bind-recursive=disabled','--mount',f'type=bind,source={D}/init,target=/docker-entrypoint-initdb.d,readonly','-e','POSTGRES_USER=supabase_admin','-e','POSTGRES_DB=postgres','-e','PGDATA=/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=isolated-no-network-test-only','-e','POSTGRES_INITDB_ARGS=--auth-local=trust --auth-host=scram-sha-256',I,'postgres','-D','/var/lib/postgresql/data']
 for s in ['shared_buffers=224MB','max_connections=60','listen_addresses=','shared_preload_libraries=pg_cron,pg_net,pg_stat_statements','cron.launch_active_jobs=off','cron.database_name=postgres','statement_timeout=2min','lock_timeout=0','jit=off','work_mem=2184kB','maintenance_work_mem=32MB','idle_in_transaction_session_timeout=0','temp_file_limit=-1']:args+=['-c',s]
 (O/'intent.json').write_text(json.dumps(result|{'args':args},indent=2));cid=docker(args);result['cid']=cid;result['container']=own(cid,N);docker(['start',cid]);
 for i in range(60):
  boot=run(['logs',cid])
  if 'PostgreSQL init process complete; ready for start up.' in boot.stdout+boot.stderr and run(['exec',cid,'pg_isready','-U','supabase_admin','-d','postgres']).returncode==0:break
  assert own(cid,N)['State']['Running'];time.sleep(1)
 else:raise RuntimeError('database readiness bound')
 def sql(s):return run(['exec','-i',cid,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],data=s,timeout=135)
 # Reproduce pinned vendor NORMAL initialization from its unchanged image
 # files, rather than the explicitly FUNCTION-only selected fixture bootstrap.
 vendor=V
 expected_vendor=json.loads((B/'scripts/fixtures/current-replay-vendor-files.json').read_text())
 actual_vendor=[]
 for sub in ['init-scripts','migrations']:
  folder=vendor/sub;assert folder.is_dir() and not folder.is_symlink()
  for path in sorted(folder.glob('*.sql')):
   assert path.is_file() and not path.is_symlink()
   actual_vendor.append({'path':str(path.relative_to(vendor)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
 assert expected_vendor['image']==I and actual_vendor==expected_vendor['files'],'exact pinned vendor SQL fixture required'
 (O/'VENDOR_INIT_FILES.json').write_text(json.dumps(expected_vendor,indent=2))
 p=sql("CREATE ROLE postgres SUPERUSER LOGIN; ALTER DATABASE postgres OWNER TO postgres;");assert p.returncode==0,p.stderr
 for source in sorted((vendor/'init-scripts').glob('*.sql')):
  p=run(['exec','-i',cid,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],data=source.read_text(),timeout=135)
  (O/('vendor-init-'+source.name+'.log')).write_text(p.stdout+p.stderr);assert p.returncode==0,p.stderr
 for source in sorted((vendor/'migrations').glob('*.sql')):
  p=sql(source.read_text());(O/('vendor-migration-'+source.name+'.log')).write_text(p.stdout+p.stderr);assert p.returncode==0,p.stderr
 remove='\n'.join('alter default privileges for role '+owner+' '+scope+' revoke all on '+kind+' from public,anon,authenticated,service_role;' for owner in ['postgres','supabase_admin'] for scope in ['', 'in schema public'] for kind in ['tables','sequences'])
 p=sql(remove);assert p.returncode==0,p.stderr
 q="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole);"
 assert sql(q).stdout.strip()=='0'
 for i,row in enumerate(rows):
  assert time.time()-start<1000,'total exact bound'
  source=B/'supabase/migrations'/row['name']
  if row['name']=='20261022041249_original_schedule_delivery_outcome.sql':source=B/'release/fresh-only-replay/images'/row['name']
  assert hashlib.sha256(source.read_bytes()).hexdigest()==effective[row['name']]['effective_sha256']
  before_defaults=sql(q).stdout.strip();assert before_defaults=='0'
  p=sql(source.read_text());(O/f'{i+1:03d}.log').write_text(p.stdout+p.stderr);grants=sql(q);r=row|{'order':i+1,'exit':p.returncode,'default_grants_after':grants.stdout.strip()};result['migrations'].append(r);print(json.dumps(r),flush=True)
  if p.returncode:raise RuntimeError('Original guarded migration failed at '+str(i+1)+' '+row['name']+': '+p.stderr[-1800:])
  if grants.stdout.strip()!='0':
   allowed={'20260718083100_reconstruct_public_grant_hardening.sql','20260729150527_audit_defense_in_depth_hardening.sql','20260815160613_normalize_managed_production_schema_security.sql'}
   assert row['name'] in allowed,'Unexpected API default introduction: '+row['name']
   import re
   assert not re.search(r'create\s+(?:unlogged\s+)?table|create\s+sequence',(B/'supabase/migrations'/row['name']).read_text(),re.I),'Defaults must be removed before any table/sequence creation'
   remove='\n'.join('alter default privileges for role '+owner+' '+scope+' revoke all on '+kind+' from public,anon,authenticated,service_role;' for owner in ['postgres','supabase_admin'] for scope in ['', 'in schema public'] for kind in ['tables','sequences'])
   corrected=sql(remove);assert corrected.returncode==0,corrected.stderr;assert sql(q).stdout.strip()=='0'
   r['known_default_only_migration_api_defaults_removed']=True
  r['default_grants_before']=before_defaults
  r['raw_default_grants_after']=grants.stdout.strip()
  r['effective_default_grants_after']=sql(q).stdout.strip();assert r['effective_default_grants_after']=='0'
  r['effective_sha256']=effective[row['name']]['effective_sha256']
  if i+1 in [289,291]:
   guard=sql("select jsonb_build_object('count',(select count(*) from public.custodial_release_authority_restore_inventory),'guard',(select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'));")
   assert guard.returncode==0,guard.stderr;(O/f'GUARD_AFTER_{i+1}.json').write_text(guard.stdout)
  if i+1==291:
   current_function=sql("select to_jsonb(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure));")
   assert current_function.returncode==0,current_function.stderr
   observed_file=O/'SOURCE291_CANARY_BEFORE.sql';observed_file.write_text(json.loads(current_function.stdout))
   repair_text=subprocess.check_output(['node',str(B/'scripts/current-candidate-replay-profile.mjs'),'--before-sql','20261025094420_authority_identity_renderer_counterparts.sql',str(observed_file)],text=True)
   (O/'SOURCE291_CANARY_ORDER_REPAIR.sql').write_text(repair_text)
   corrected=sql(repair_text);(O/'SOURCE291_CANARY_ORDER_REPAIR.log').write_text(corrected.stdout+corrected.stderr);assert corrected.returncode==0,corrected.stderr
   current_function=sql("select to_jsonb(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure));")
   assert current_function.returncode==0,current_function.stderr
   observed_file=O/'SOURCE291_CANARY_AFTER.sql';observed_file.write_text(json.loads(current_function.stdout))
   replay_text=subprocess.check_output(['node',str(B/'scripts/current-candidate-replay-profile.mjs'),'--before-sql','20261025094420_authority_identity_renderer_counterparts.sql',str(observed_file)],text=True)
   assert replay_text==repair_text,'Original-equivalent already-repaired Source291 must be stable'
   corrected=sql(replay_text);(O/'SOURCE291_CANARY_ORDER_REPLAY.log').write_text(corrected.stdout+corrected.stderr);assert corrected.returncode==0,corrected.stderr
  if i+1 in [304,306,307,308]:
   captured=sql(catalog_sql);assert captured.returncode==0,captured.stderr
   raw=O/f'SOURCE{i+1}_CATALOG_RAW.jsonl';raw.write_text(captured.stdout)
   subprocess.run(['node',str(B/'scripts/current-candidate-catalog-snapshot.mjs'),'--from-recorded',str(raw),str(O/f'SOURCE{i+1}_CATALOG.json')],check=True)
  if i+1==252:
   capture=sql("select jsonb_build_object('inventory',(select jsonb_agg(to_jsonb(x) order by object_kind collate \"C\",object_identity collate \"C\") from public.custodial_release_authority_restore_inventory x),'canary',pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),'owner',current_user,'inventory_aggregate',(select public.static_weekly_digest_text(string_agg(restore_order::text||E'\\n'||object_kind||E'\\n'||object_identity||E'\\n'||definition_sha256,E'\\n---\\n' ORDER BY object_kind COLLATE \"C\",object_identity COLLATE \"C\")) from public.custodial_release_authority_restore_inventory));")
   assert capture.returncode==0,capture.stderr
   (O/'ACTUAL_PREFIX252.json').write_text(capture.stdout)
   repair=O/'SOURCE252_ORDER_REPAIR.sql'
   repair.write_text(subprocess.check_output(['node',str(B/'scripts/current-candidate-replay-profile.mjs'),'--before-sql','20261010193211_native_private_custody_chunk_retention.sql'],text=True))
   result['source252_repair_sql_sha256']=hashlib.sha256(repair.read_bytes()).hexdigest()
   for attempt in range(2):
    repaired=sql(repair.read_text());(O/f'source252-repair-{attempt+1}.log').write_text(repaired.stdout+repaired.stderr)
    assert repaired.returncode==0,repaired.stderr
   repaired_capture=sql("select jsonb_build_object('count',(select count(*) from public.custodial_release_authority_restore_inventory),'canary',public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),'immutable',(select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'),'aggregate',(select public.static_weekly_digest_text(string_agg(restore_order::text||E'\\n'||object_kind||E'\\n'||object_identity||E'\\n'||definition_sha256,E'\\n---\\n' ORDER BY object_kind COLLATE \"C\",object_identity COLLATE \"C\")) from public.custodial_release_authority_restore_inventory));")
   assert repaired_capture.returncode==0,repaired_capture.stderr
   (O/'REPAIRED_PREFIX252.json').write_text(repaired_capture.stdout)

  if p.returncode:raise RuntimeError('Exact ordered raw SQL failed at '+str(i+1)+' '+row['name']+': '+p.stderr[-1800:])
 regression=sql((B/'scripts/fixtures/cohort-places-feedback-database-regression.sql').read_text());(O/'retained-repair-regression.log').write_text(regression.stdout+regression.stderr);assert regression.returncode==0,regression.stderr
 result['retained_repair_sql_pass']=True
 regression=sql((B/'scripts/fixtures/unfinished-work-database-regression.sql').read_text());(O/'unfinished-work-regression.log').write_text(regression.stdout+regression.stderr);assert regression.returncode==0,regression.stderr
 result['unfinished_work_sql_pass']=True
 regression=sql((B/'scripts/fixtures/local-enrollment-retention-database-regression.sql').read_text());(O/'local-retention-regression.log').write_text(regression.stdout+regression.stderr);assert regression.returncode==0,regression.stderr
 result['local_retention_sql_floor_pass']=True
 if consumer_spec:
  specpath=pathlib.Path(consumer_spec)
  assert specpath.is_absolute() and not specpath.is_symlink() and specpath.resolve()==specpath and specpath.stat().st_uid==os.getuid() and stat.S_IMODE(specpath.stat().st_mode)==0o600
  spec=json.loads(specpath.read_text());assert set(spec)=={'schema','script','args','relay','relay_sha256','runtime'} and spec['schema']=='custodial.current308-local-ci-consumer.v1'
  allowed={'integrated-backend-authority-suite-order-isolated-tests.mjs','read-only-database-authority-tests.mjs','owner-actions-database-tests.mjs','manager-scheduler-database-tests.mjs','static-weekly-schedule-concurrency-tests.mjs', 'static-weekly-schedule-authority-closure-tests.mjs', 'static-weekly-schedule-authority-v3-tests.mjs', 'static-weekly-day-changes-database-tests.mjs', 'static-weekly-vacant-roster-slot-database-tests.mjs', 'static-weekly-existing-employee-restore-database-tests.mjs', 'static-weekly-vacate-roster-slot-database-tests.mjs'}
  assert spec['script'] in allowed and isinstance(spec['args'],list) and all(isinstance(x,str) for x in spec['args'])
  assert spec['args']==[] or (spec['script']=='integrated-backend-authority-suite-order-isolated-tests.mjs' and spec['args'] in [['--order','final-first'],['--order','named-first']]) or (spec['script']=='static-weekly-vacate-roster-slot-database-tests.mjs' and spec['args'] in [['--current-fixture-index','0'],['--current-fixture-index','1']]), 'Only exact current SQL CI consumer arguments'
  runtime=pathlib.Path(spec['runtime']);assert runtime.is_absolute() and runtime.resolve()==runtime and runtime==D.parent and runtime.stat().st_uid==os.getuid()
  relay_source=pathlib.Path(spec['relay']);assert relay_source.is_file() and not relay_source.is_symlink() and relay_source.resolve()==relay_source and relay_source.is_relative_to(runtime)
  assert hashlib.sha256(relay_source.read_bytes()).hexdigest()==spec['relay_sha256']
  import shutil
  relay_target=D/'init/custodial-pg-wire-relay';assert not relay_target.exists();shutil.copy2(relay_source,relay_target)
  assert hashlib.sha256(relay_target.read_bytes()).hexdigest()==spec['relay_sha256']
  descriptor={'schema':'custodial.current308-owned-ci-database.v1','cid':cid,'owner':owner,'name':N,'runtime':str(runtime),'workspace':str(D),'consumer':str(B/'scripts'/spec['script']),'consumer_args':spec['args'],'profile':profile,'relay':{'kind':'static','path':'/docker-entrypoint-initdb.d/custodial-pg-wire-relay','host_path':str(relay_target),'sha256':spec['relay_sha256']},'source_profile_sha256':hashlib.sha256((B/'scripts/current-candidate-replay-profile.mjs').read_bytes()).hexdigest(),'no_API_table_sequence_defaults':sql(q).stdout.strip()=='0','migration_witnesses':result['migrations'],'release_admission':False,'production':False}
  descriptor_path=O/'CONSUMER_DATABASE.json';descriptor_path.write_text(json.dumps(descriptor,indent=2)+'\n');descriptor_path.chmod(0o600)
  env={k:v for k,v in os.environ.items() if k in ['PATH','LANG','JAVA_HOME']};env.update(HOME=str(runtime/'home'),TMPDIR=str(runtime/'tmp'),TZ='America/Chicago',CUSTODIAL_CURRENT308_OWNED_CI_DESCRIPTOR=str(descriptor_path))
  argv=['bwrap','--unshare-net','--die-with-parent','--ro-bind','/','/','--bind',str(runtime),str(runtime),'--ro-bind',str(runtime/'backend-deps/node_modules'),str(B/'node_modules'),'--ro-bind','/run/docker.sock','/run/docker.sock','--tmpfs','/tmp','--dev','/dev','--proc','/proc','node',str(B/'scripts'/spec['script']),*spec['args']]
  with (O/'CONSUMER.log').open('w') as output:consumer=subprocess.run(argv,cwd=B,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=240)
  result['consumer']={'script':spec['script'],'exit_code':consumer.returncode,'log_sha256':hashlib.sha256((O/'CONSUMER.log').read_bytes()).hexdigest(),'no_API_table_sequence_defaults_after':sql(q).stdout.strip()=='0'}
  assert consumer.returncode==0,'Current SQL CI consumer failed: '+spec['script']
  assert result['consumer']['no_API_table_sequence_defaults_after'],'Consumer changed forbidden defaults'
  assert relay_target.is_file() and hashlib.sha256(relay_target.read_bytes()).hexdigest()==spec['relay_sha256'];relay_target.unlink()
 result['passed']=True;result['diagnostic_completed']=True;result['bootstrap_profile']='Exact pinned vendor init files; API table/sequence defaults removed under existing no-auto fixture rule; original application SQL unmodified; no production or release admission authority'
except Exception as e:
 result['error']=str(e)
 if cid is None:
  created=run(['inspect',N])
  if created.returncode==0:
   candidate=json.loads(created.stdout)[0];own(candidate['Id'],N);cid=candidate['Id'];result['cid']=cid
 if cid:
  try:
   own(cid,N)
   observed=sql("select jsonb_build_object('inventory',(select jsonb_agg(to_jsonb(i) order by object_kind collate \"C\",object_identity collate \"C\") from public.custodial_release_authority_restore_inventory i),'canary',pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),'guard',(select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'));")
   if observed.returncode==0:(O/'FAILED_PREDECESSOR.json').write_text(observed.stdout)
   else:(O/'FAILED_PREDECESSOR_CAPTURE.log').write_text(observed.stderr)
  except Exception as diagnostic:result['predecessor_capture_error']=str(diagnostic)

finally:
 if cid:
  try:
   try:
    metrics=run(['exec',cid,'sh','-c','cat /sys/fs/cgroup/memory.max; cat /sys/fs/cgroup/memory.peak; cat /sys/fs/cgroup/memory.events'])
    if metrics.returncode==0:
     lines=metrics.stdout.splitlines();assert lines[0]=='536870912','exact owned cgroup required'
     result['cgroup']={'memory_max':int(lines[0]),'memory_peak':int(lines[1]),'events':{k:int(v) for k,v in (line.split() for line in lines[2:])}}
    else:result['cgroup_measurement_unavailable']=metrics.stderr[-500:]
   except Exception as metric_error:result['cgroup_measurement_unavailable']=str(metric_error)
   result['final_state']=own(cid,N)['State'];(O/'container.log').write_text(docker(['logs',cid]));docker(['rm','-f',cid]);assert run(['inspect',cid]).returncode==1
   data=D/'pgdata';st=data.stat();result['pgdata_after']={'uid':st.st_uid,'gid':st.st_gid,'mode':oct(st.st_mode&0o777),'ino':st.st_ino};assert st.st_ino==data_inode and st.st_uid in [100,os.getuid()] and (st.st_mode&0o777)==0o700
   command=f"set -eu\ntest \"$(stat -c '%u:%g:%a' /var/lib/postgresql/data)\" = '{st.st_uid}:{st.st_gid}:700'\ntest -z \"$(find /var/lib/postgresql/data -xdev -mindepth 1 ! -type f ! -type d -print -quit)\"\nfind /var/lib/postgresql/data -xdev -mindepth 1 -depth -delete\ntest -z \"$(find /var/lib/postgresql/data -mindepth 1 -print -quit)\"\n"
   hn=N+'_pgdata_cleanup';assert run(['inspect',hn]).returncode==1
   helper=docker(['create','--name',hn,'--label','custodial.audit.owner='+owner,'--network','none','--read-only','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','128','--no-healthcheck','--cap-drop','ALL','--security-opt','no-new-privileges','--user',f'{st.st_uid}:{st.st_gid}','--entrypoint','/bin/sh','--mount',f'type=bind,source={data},target=/var/lib/postgresql/data,bind-recursive=disabled',I,'-ceu',command]);hd=own(helper,hn);assert hd['Config']['User']==f'{st.st_uid}:{st.st_gid}' and hd['HostConfig']['Privileged']==False and len(hd['Mounts'])==1 and hd['Mounts'][0]['Source']==str(data);docker(['start',helper]);assert docker(['wait',helper],timeout=60)=='0';docker(['rm',helper]);assert run(['inspect',helper]).returncode==1;assert data.stat().st_ino==st.st_ino;data.rmdir();
   remaining_init=list((D/'init').iterdir());assert all(x.name=='custodial-pg-wire-relay' and x.is_file() and not x.is_symlink() for x in remaining_init)
   for x in remaining_init:
    assert consumer_spec and hashlib.sha256(x.read_bytes()).hexdigest()==json.loads(pathlib.Path(consumer_spec).read_text())['relay_sha256'];x.unlink()
   (D/'init').rmdir();D.rmdir();result['cleanup']=True
  except Exception as e:result['cleanup_error']=str(e)
 if not cid:
  for path in [D/'pgdata',D/'init',D]:path.rmdir()
  result['cleanup']=True
 result['seconds']=round(time.time()-start,2);(O/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:result.get(k) for k in ['passed','error','cleanup','cleanup_error','seconds']}))

if not result.get('passed') or not result.get('cleanup'):sys.exit(1)
