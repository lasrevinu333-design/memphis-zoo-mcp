#!/usr/bin/env python3
"""Reviewed disposable Actions transport; never release or production authority."""
from pathlib import Path,PurePosixPath
import os,sys,json,hashlib,tarfile,subprocess,stat,time,ctypes,signal,selectors,errno,shutil,socket
BASE=Path('/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024')
OWN=BASE/'atomic-finalization/G31-private286-official-nonempty-owning-fixture-DRAFT-source01/remote01-Source17-existing-actions-isolated-private286-PREP_ONLY'
RUN=OWN/'source20-prebind-final08'
BUNDLE_SHA='21aab51f362ab5c469dae8969d29376b2faecd5bba9c5599067d11799591ee9b'
BUNDLE_BYTES=74802161
MANIFEST=OWN/'source20-final09-frozen-control/authentic-original-snapshot-transport-final15/SUPPORT_PAYLOAD_EXACT_MEMBERS.NOT_AUTHORITY.json'
MANIFEST_SHA='90839f77f1d3a478448c354d6b96b127ac05d8cf95ea1753fee13c5de59e7a57'
MANIFEST_BYTES=326798
BRANCH='refs/heads/codex/custodial-g31-private286-original-snapshot-20261026'
REPO='lasrevinu333-design/memphis-zoo-mcp'
CONFIRM='ROOT_REVIEWED_PRIVATE286_SOURCE20_AUTHENTIC_SNAPSHOT_ONCE'
PG='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed'
STORAGE='public.ecr.aws/supabase/storage-api@sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd'
MIRROR='docker.io/supabase/storage-api@sha256:528ec49c3c32561908b07ee91bced7f8456f3b688164e341eaa422441767a0bd'
META=Path(os.environ['RUNNER_TEMP'])/'g31-external-custody';META.mkdir(mode=0o700)
seq=0;commands=[]
def exact(p,sha,n):
 p=Path(p);assert p.is_file()and not p.is_symlink();h=hashlib.sha256();size=0
 with p.open('rb')as f:
  while b:=f.read(1024*1024):h.update(b);size+=len(b)
 assert h.hexdigest()==sha and size==n,'Exact source bytes refused';return p

def ref(p):
 p=Path(p);h=hashlib.sha256();size=0
 with p.open('rb')as f:
  while b:=f.read(1024*1024):h.update(b);size+=len(b)
 return {'path':str(p),'sha256':h.hexdigest(),'bytes':size}
def save(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w')as f:json.dump(v,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 return ref(p)
def proc(pid):
 s=Path('/proc',str(pid),'stat').read_text();f=s[s.rindex(')')+2:].split();return {'pid':pid,'ppid':int(f[1]),'pgid':int(f[2]),'start_ticks':int(f[19])}
def mem():return int(next(x.split()[1]for x in Path('/proc/meminfo').read_text().splitlines()if x.startswith('MemAvailable:')))*1024

def run(argv,seconds=60,cap=16*1024**2,allow=False,operator=False,input_file=None):
 global seq
 seq+=1;name=f'{seq:04}';save(META/(name+'.INTENT.json'),{'argv':argv,'seconds':seconds,'cap':cap,'read_or_exact_owned_setup_only':True})
 started=time.monotonic();stdin=input_file.open('rb')if input_file else subprocess.DEVNULL
 try:child=subprocess.Popen(argv,stdin=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 finally:
  if input_file:stdin.close()
 owner=proc(child.pid);save(META/(name+'.OWNER.json'),owner)
 paths=[META/(name+'.stdout'),META/(name+'.stderr')];fds=[os.open(x,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)for x in paths]
 sel=selectors.DefaultSelector();sel.register(child.stdout,selectors.EVENT_READ,0);sel.register(child.stderr,selectors.EVENT_READ,1);sizes=[0,0];reason=None;term=None
 try:
  while sel.get_map()or child.poll()is None:
   now=time.monotonic()
   if reason is None and now-started>=seconds:reason='EXTERNAL_ORIGINAL_TIMEOUT'
   if reason is not None and term is None:
    save(META/(name+'.REFUSAL_BEFORE_SIGNAL.json'),{'owner':owner,'reason':reason,'elapsed':now-started,'sizes':sizes,'payload_adopted':False})
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    term=now
   if term is not None and now-term>=1:
    try:os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   for key,_ in sel.select(.05):
    b=os.read(key.fileobj.fileno(),65536)
    if not b:sel.unregister(key.fileobj);key.fileobj.close();continue
    i=key.data;take=b[:max(0,cap-sizes[i])];sizes[i]+=len(take);at=0
    while at<len(take):at+=os.write(fds[i],take[at:])
    if len(take)!=len(b)and reason is None:reason='EXTERNAL_ORIGINAL_STREAM_CAP'
   assert now-started<=seconds+5,'Original external pipe custody exceeded'
  rc=child.wait(timeout=1)
  save(META/(name+'.ORIGINAL_WAIT_BEFORE_RECONCILIATION.json'),{'owner':owner,'actual_wait_returned':True,'exit':rc,'refusal':reason})
  if operator:settle_known(RUN/'actual-private286-official-provider-once',owner)
  for fn in [os.kill,os.killpg]:
   try:fn(child.pid,0)
   except ProcessLookupError:pass
   else:raise AssertionError('Original command group remains')
  assert not Path('/proc',str(child.pid)).exists()
 finally:
  sel.close()
  for fd in fds:os.fsync(fd);os.close(fd)
 row={'owner':owner,'actual_original_wait_returned':True,'exit':rc,'fresh_PID_PGID_proc_absent':True,'refusal':reason,'stdout':ref(paths[0]),'stderr':ref(paths[1])};save(META/(name+'.WAIT.json'),row);commands.append(row)
 assert reason is None,'Original external command refused'
 if not allow:assert rc==0,'Original external step refused'
 return rc,paths[0].read_bytes(),paths[1].read_bytes()

def no_links(p):
 p=Path(p);assert p.is_absolute();q=Path(p.anchor)
 for v in p.parts[1:]:
  q=q/v
  if q.exists():assert not q.is_symlink(),'Symlink path refused'
 return p

def put(path,source,sha,n,mode):
 p=no_links(path);assert str(p).startswith(str(BASE)+'/')or str(p) in ('/home/eric/.cache/codex-toolchains/node-v22.23.1/bin/node', '/home/eric/Documents/Codex/2026-10-09/task-9/vendor-auth-restore-fixture-product-20261017-v1/UNIT_MIGRATE_CONFIG.json', '/home/eric/Documents/Codex/2026-10-09/task-9/vendor-auth-restore-fixture-product-20261017-v1/runtime/auth-v2.197.0-linux-amd64/auth')
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 if p.exists():exact(p,sha,n);return
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);h=hashlib.sha256();size=0
 with os.fdopen(fd,'wb')as f:
  while b:=source.read(1024*1024):h.update(b);size+=len(b);assert size<=n;f.write(b)
  assert size==n and h.hexdigest()==sha;f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),mode)
 exact(p,sha,n)

def fixed_root(p):
 p=Path(p);assert not p.exists(),'Fresh isolated root already exists'
 run(['sudo','install','-d','-m','700','-o',str(os.getuid()),'-g',str(os.getgid()),str(p)],20)
 assert p.stat().st_uid==os.getuid()and stat.S_IMODE(p.stat().st_mode)==0o700

def known_processes(out):
 rows=[]
 for pattern in ['command-*/01-OWNED_CHILD.json','normal-qualification/normal-cli-tmp/official-storage-*/*.OWNER.json','source-capture/official-source-*/*.owner.json']:
  for f in out.glob(pattern):
   assert f.is_file()and not f.is_symlink()and f.stat().st_uid==os.getuid()
   r=json.loads(f.read_text());ticks=r.get('proc_start_ticks',r.get('start_ticks'))
   assert int(r['pid'])>1 and int(r['pgid'])>1 and int(ticks)>0
   rows.append({'pid':int(r['pid']),'pgid':int(r['pgid']),'start_ticks':int(ticks),'receipt':ref(f)})
 f=out/'normal-qualification/NORMAL_CLI_ORIGINAL_CHILD_OWNER_BEFORE_PROGRESS.json'
 if f.exists():
  r=json.loads(f.read_text())['child'];rows.append({'pid':int(r['pid']),'pgid':int(r['pgid']),'start_ticks':int(r['start_ticks']),'receipt':ref(f)})
 return rows

def settle_known(out,original_owner):
 records=known_processes(out);groups={original_owner['pgid']:original_owner['start_ticks']}
 for r in records:groups[r['pgid']]=min(groups.get(r['pgid'],r['start_ticks']),r['start_ticks'])
 deadline=time.monotonic()+10;settled=[];signalled=set()
 while True:
  children=[]
  for f in Path('/proc').iterdir():
   if not f.name.isdigit():continue
   try:q=proc(int(f.name))
   except (FileNotFoundError,ProcessLookupError):continue
   if q['ppid']==os.getpid():
    assert q['pgid']in groups and q['start_ticks']>=groups[q['pgid']],'Foreign adopted child refuses signals'
    children.append(q)
  if not children:break
  for q in children:
   pid,status=os.waitpid(q['pid'],os.WNOHANG)
   if pid:settled.append(q|{'actual_waitpid':pid,'status':status});continue
   assert proc(q['pid'])==q,'Adopted original identity changed'
   if q['pgid']not in signalled:os.killpg(q['pgid'],signal.SIGKILL);signalled.add(q['pgid'])
  assert time.monotonic()<deadline,'Exact owned adopted-child wait deadline exceeded'
  time.sleep(.02)
 save(META/'EXACT_ADOPTED_ORIGINAL_CHILD_SETTLEMENT.json',{'original_owner':original_owner,'recorded_owner_receipts':records,'settled':settled,'signalled_only_recorded_owned_groups':sorted(signalled),'all_direct_adopted_children_absent':True})

def cleanup_exact(out):
 # Only metadata from this one just-waited synthetic operation; never Docker prune.
 deadline=time.monotonic()+45;prepath=out/'PREBIRTH_ORIGINAL_CONTAINER.json'
 if prepath.exists():pre=json.loads(prepath.read_text())
 else:
  armed=out/'SOCKET_PARENT_BIRTH_ARMED_FOR_CLEANUP.json';intent=out/'command-004-source-create/01-INTENT.json';durable=out/'SOURCE_DURABLE_CID.json'
  if not(armed.exists()and intent.exists()and durable.exists()):return {'early_source_identity_incomplete':True,'no_cleanup_authority_inferred':True,'cleanup_complete':False}
  birth=json.loads(armed.read_text());argv=json.loads(intent.read_text())['argv'];r=json.loads(durable.read_text());assert argv[:2]==['/usr/bin/docker','create']and r['source_fixture_only']is True
  name=argv[argv.index('--name')+1];network=argv[argv.index('--network')+1];labels=[argv[i+1]for i,v in enumerate(argv[:-1])if v=='--label'];fixture=next(v.split('=',1)[1]for v in labels if v.startswith('custodial.fixture-id='))
  assert name=='mz_schema_rebuild_held_product_'+fixture[:16]and network=='mz_schema_rebuild_storage_source_'+fixture[:20]and r['network']==network
  assert 'custodial.owner=overnight-held-correction-product-sql-effect'in labels and 'org.memphiszoo.custodial.fixture=synthetic'in labels and 'org.memphiszoo.custodial.owner=/root'in labels
  assert PG in argv and argv[argv.index('--memory')+1]=='1g'and argv[argv.index('--cpus')+1]=='1'
  parent=Path(birth['parent']);leaf=parent/'socket';assert birth['cleanup_armed_before_birth']is True and parent.parent==Path('/run/user')/str(os.getuid())
  assert 'type=bind,source='+str(leaf)+',target=/tmp/owned-socket'in argv
  ids=[(str(parent),birth['identity9'])]
  if leaf.exists():
   st=leaf.lstat();assert stat.S_ISDIR(st.st_mode)and not leaf.is_symlink()and st.st_uid==os.getuid()and stat.S_IMODE(st.st_mode)==0o777
   ids.append((str(leaf),[st.st_dev,st.st_ino,st.st_mode,st.st_uid]))
  else:ids.append((str(leaf),[None,None,None,os.getuid()]))
  pre={'name':name,'fixture':fixture,'network':network,'image':PG,'socket_identities':ids}
  save(META/'EARLY_SOURCE_CLEANUP_AUTHORITY.json',{'durable_CID':ref(durable),'original_create_intent':ref(intent),'original_socket_parent_birth':ref(armed),'socket_leaf_identity_is_current_under_original_private_parent':True,'no_target_authority_inferred':True})
 containers={};networks={};relays=[]
 def command(args,allow=False):
  left=deadline-time.monotonic();assert left>0,'Exact cleanup45s exhausted'
  return run(['/usr/bin/docker',*args],min(10,max(1,left)),cap=65536,allow=allow)
 def add(cid,name,image,key,val):
  assert len(cid)==64 and all(c in 'abcdef0123456789'for c in cid)and name.startswith('mz_schema_rebuild_')
  containers[cid]={'cid':cid,'name':name,'image':image,'key':key,'value':val}
 f=out/'DURABLE_ORIGINAL_CID.json'
 if f.exists():
  r=json.loads(f.read_text());assert r['name']==pre['name']and r['fixture']==pre['fixture'];add(r['CID'],r['name'],pre['image'],'custodial.fixture-id',pre['fixture'])
 f=out/'SOURCE_DURABLE_CID.json'
 if f.exists():
  r=json.loads(f.read_text());a=json.loads((out/'command-004-source-create/01-INTENT.json').read_text())['argv'];add(r['CID'],a[a.index('--name')+1],pre['image'],'custodial.fixture-id',pre['fixture'])
 net=out/'command-003-source-network-create/01.stdout'
 if net.exists():networks[pre['network']]={'id':net.read_text().strip(),'key':'custodial.storage-source','value':pre['network']}
 for f in out.glob('source-capture/official-source-*/DURABLE_SOURCE_PROVIDER_CID.json'):
  r=json.loads(f.read_text());add(r['cid'],r['name'],r['image'],'custodial.storage-source',pre['network'])
 for pattern in ['normal-qualification/normal-cli-tmp/official-storage-*/OWNED_LOOPBACK_RELAY_BOUND.json','source-capture/official-source-*/OWNED_LOOPBACK_RELAY_BOUND.json']:
  for f in out.glob(pattern):
   r=json.loads(f.read_text());normal='normal-qualification'in f.parts
   add(r['container_id'],r['container_name'],r['image'],'custodial.owner'if normal else'custodial.storage-source',r['container_name']if normal else pre['network'])
   networks[r['network_name']]={'id':r['network_id'],'key':'custodial.owner'if normal else'custodial.storage-source','value':r['container_name']if normal else pre['network']};relays.append(r['origin'])
 fmt='{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}}'
 for r in containers.values():
  rc,a,b=command(['inspect','--format',fmt,r['cid']],True)
  if rc==0:
   x=json.loads(a);assert x['Id']==r['cid']and x['Name']=='/'+r['name']and x['Image']==r['image']and x['Labels'].get(r['key'])==r['value'],'Exact owned CID identity changed'
   command(['rm','-f',r['cid']])
  else:assert b'no such'in b.lower(),'Ambiguous owned CID inspect'
  for target in [r['cid'],r['name']]:
   rc,a,b=command(['inspect','--format','{{.Id}}',target],True);assert rc!=0 and b'no such'in b.lower(),'Exact owned CID/name not absent'
 for name,r in networks.items():
  rc,a,b=command(['network','inspect',name],True)
  if rc==0:
   x=json.loads(a)[0];assert x['Id']==r['id']and x['Name']==name and x['Internal']is True and x['Labels'].get(r['key'])==r['value']and not x['Containers'],'Foreign/member network refuses cleanup';command(['network','rm',r['id']])
  else:assert b'not found'in b.lower()or b'no such'in b.lower()
  rc,a,b=command(['network','inspect',name],True);assert rc!=0 and(b'not found'in b.lower()or b'no such'in b.lower())
 ids=pre['socket_identities'];parent=Path(ids[0][0]);leaf=Path(ids[1][0]);assert parent.parent==Path('/run/user')/str(os.getuid())and leaf.parent==parent
 for p,r in [(parent,ids[0][1]),(leaf,ids[1][1])]:
  if p.exists():st=p.lstat();assert stat.S_ISDIR(st.st_mode)and not p.is_symlink()and(st.st_dev,st.st_ino,st.st_uid)==(r[0],r[1],r[3])
 if leaf.exists():
  for f in leaf.iterdir():assert f.name in ['.s.PGSQL.5432','.s.PGSQL.5432.lock']and not f.is_symlink();f.unlink()
  leaf.rmdir()
 if parent.exists():assert not list(parent.iterdir());parent.rmdir()
 ar=out/'normal-qualification/OWNED_ARCHIVE_SNAPSHOT.json'
 if ar.exists():
  r=json.loads(ar.read_text());p=Path(r['directory']);assert p.parent==out and p.name.startswith('memphis-zoo-verified-archive-')
  if p.exists():st=p.lstat();assert stat.S_ISDIR(st.st_mode)and not p.is_symlink()and(st.st_dev,st.st_ino,st.st_uid,stat.S_IMODE(st.st_mode))==(r['dev'],r['ino'],r['uid'],r['mode']);shutil.rmtree(p)
  assert not p.exists()
 for origin in relays:
  from urllib.parse import urlsplit
  u=urlsplit(origin);assert u.scheme=='http'and u.hostname=='127.0.0.1'and u.port
  try:z=socket.create_connection(('127.0.0.1',u.port),timeout=1)
  except ConnectionRefusedError:pass
  else:z.close();raise AssertionError('Owned relay still listening')
 return {'all_recorded_exact_CIDs_names_networks_absent':True,'socket_parent_absent':not parent.exists(),'original_retained_archive_untouched':True,'loopback_relays_refused':len(relays),'unknown_resource_birth_never_fabricated':True}

def main():
 assert len(sys.argv)==5 and sys.argv[1]==CONFIRM
 assert os.environ.get('GITHUB_ACTIONS')=='true'and os.environ['GITHUB_REPOSITORY']==REPO and os.environ['GITHUB_REF']==BRANCH
 assert os.environ['GITHUB_EVENT_NAME']=='workflow_dispatch'and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','No automatic retry'
 assert ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0
 cpu=min(os.sched_getaffinity(0));os.sched_setaffinity(0,{cpu})
 bundle=Path(sys.argv[2]);current=Path(sys.argv[3]);original=Path(sys.argv[4]);exact(bundle,BUNDLE_SHA,BUNDLE_BYTES)
 save(META/'ROOT_MANUAL_DISPATCH_IDENTITY.json',{'repository':REPO,'ref':BRANCH,'run_id':os.environ['GITHUB_RUN_ID'],'attempt':1,'source20':'bc79b77231389c382751f6092a23ab0a75c2982b','original286':'b20499c6a98b90db1779fe5d0060b619bceae261','bundle':ref(bundle),'CPU1':cpu,'MemAvailable_before':mem(),'production_authority':False})
 fixed_root(BASE);fixed_root(Path('/home/eric'))
 # Verify the entire archive layout and pinned manifest BEFORE any extraction.
 with tarfile.open(bundle,'r:gz')as tar:
  ms=tar.getmembers();assert len(ms)==716 and len({x.name for x in ms})==716
  named={x.name:x for x in ms};key=str(MANIFEST).lstrip('/');mi=named[key];assert mi.isfile()and mi.size==MANIFEST_BYTES
  mb=tar.extractfile(mi).read();assert hashlib.sha256(mb).hexdigest()==MANIFEST_SHA
  manifest=json.loads(mb);expected={r['path'].lstrip('/'):r for r in manifest['files']};expected[key]={'path':str(MANIFEST),'sha256':MANIFEST_SHA,'bytes':MANIFEST_BYTES,'mode':'0o664'}
  assert set(named)==set(expected)and sum(x.size for x in ms)==183722132
  for name,item in named.items():
   parts=PurePosixPath(name).parts;assert not name.startswith('/')and all(v not in ('','.','..')for v in parts)and item.isfile()and not item.issym()and not item.islnk()
   r=expected[name];assert item.size==r['bytes']and item.mode==int(r['mode'],8)and not item.linkname
  for name,item in named.items():
   r=expected[name]
   with tar.extractfile(item)as f:put(Path('/')/name,f,r['sha256'],r['bytes'],int(r['mode'],8))
 cfg=json.loads((RUN/'FIXED_PRIVATE286_OFFICIAL_NONEMPTY_INPUTS.DRAFT.json').read_text());hyd=json.loads((OWN/'source20-final09-frozen-control/EXACT_GIT_SOURCE_HYDRATION.NOT_EXECUTED.json').read_text())
 # Exact snapshot transport: genuine rawcommit+treeclosure, parents intentionally absent, no shallow/header rewrite.
 original_pack=Path('/mnt/ai_models/codex-preserved-custodial/current-source-staging-20261024/atomic-finalization/G31-private286-official-nonempty-owning-fixture-DRAFT-source01/remote01-Source17-existing-actions-isolated-private286-PREP_ONLY/source20-final09-frozen-control/authentic-original-snapshot-pack-final14b-umask022/AUTHENTIC_B204_EXACT_SNAPSHOT.pack')
 exact(original_pack,'61fe29d770394193e8224ab9190f29e58fff923fae6ee923a5cc0fa1ae094759',7504910)
 assert not original.exists(),'Original checkout path must be fresh'
 run(['git','init',str(original)],30)
 run(['git','-C',str(original),'index-pack','--stdin'],60,input_file=original_pack)
 save(META/'AUTHENTIC_ORIGINAL_SNAPSHOT_BOUNDARY.json',{'genuine_commit':'b20499c6a98b90db1779fe5d0060b619bceae261','tree':'ee9f1191672ff65f26592dfd0ca19a6200101cb1','pack':ref(original_pack),'snapshot_only_parent_history_not_included':True,'raw_commit_header_unchanged':True,'no_shallow_file_written':True})
 run(['git','-C',str(original),'checkout','--detach','b20499c6a98b90db1779fe5d0060b619bceae261'],30)
 original_raw=run(['git','-C',str(original),'cat-file','commit','b20499c6a98b90db1779fe5d0060b619bceae261'])[1]
 assert hashlib.sha1(b'commit '+str(len(original_raw)).encode()+b'\0'+original_raw).hexdigest()=='b20499c6a98b90db1779fe5d0060b619bceae261'
 for root,commit,tree in [(current,'bc79b77231389c382751f6092a23ab0a75c2982b','fca6da99b45cd2d3b7c37424319b1b6160345e5b'),(original,'b20499c6a98b90db1779fe5d0060b619bceae261','ee9f1191672ff65f26592dfd0ca19a6200101cb1')]:
  assert run(['git','-C',str(root),'rev-parse','HEAD'])[1].decode().strip()==commit
  assert run(['git','-C',str(root),'rev-parse','HEAD^{tree}'])[1].decode().strip()==tree
  assert not run(['git','-C',str(root),'status','--porcelain'])[1]
 for r in hyd['rows']:
  root=current if r['checkout']=='current20'else original;rel=PurePosixPath(r['logical_path']);assert not rel.is_absolute()and all(x not in ('','.','..')for x in rel.parts)
  b=(root/str(rel)).read_bytes();pin=r['destination'];assert len(b)==pin['bytes']and hashlib.sha256(b).hexdigest()==pin['sha256']and hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==r['git_blob_sha1']
  expectedmode=0o755 if r['mode']=='100755'else 0o644;assert stat.S_IMODE((root/str(rel)).stat().st_mode)==expectedmode
  import io
  put(Path(pin['path']),io.BytesIO(b),pin['sha256'],pin['bytes'],expectedmode)
 save(META/'ALL_SOURCE_HYDRATION_VERIFIED.json',{'current_authority':1111,'original_source':1541,'SQL_aliases':286,'original_helper_aliases':3,'all_rows':len(hyd['rows']),'full_source_tuples_verified':True,'paths_and_bodies_preserved':True,'source_hydration':ref(OWN/'source20-final09-frozen-control/EXACT_GIT_SOURCE_HYDRATION.NOT_EXECUTED.json')})
 runtime=Path('/run/user')/str(os.getuid())
 if not runtime.exists():run(['sudo','install','-d','-m','700','-o',str(os.getuid()),'-g',str(os.getgid()),str(runtime)],20)
 assert not runtime.is_symlink()and runtime.stat().st_uid==os.getuid()and stat.S_IMODE(runtime.stat().st_mode)==0o700
 node=cfg['node_tool'];exact(node['path'],node['sha256'],node['bytes']);assert run([node['path'],'--version'])[1].strip()==b'v22.23.1'
 # Public immutable images only; original operator still uses --pull never.
 for image in [PG,MIRROR,STORAGE]:run(['/usr/bin/docker','pull',image],120,cap=1024*1024)
 assert mem()>=4*1024**3,'Original fresh4GiB floor refused'
 op=RUN/'RUN_PRIVATE286_OFFICIAL_NONEMPTY_G31.DRAFT_NOT_ADMITTED.py';out=RUN/'actual-private286-official-provider-once';assert not out.exists()
 admission={'state':'ROOT_ADMITS_PRIVATE286_OFFICIAL_NONEMPTY_PROVIDER_DISPOSABLE_ONLY','operator_sha256':ref(op)['sha256'],'fixed_inputs':ref(RUN/'FIXED_PRIVATE286_OFFICIAL_NONEMPTY_INPUTS.DRAFT.json'),'Root_sole_child_owner':True,'no_production_provider_build_device_authority':True,'output':str(out),'original_manual_workflow_run':os.environ['GITHUB_RUN_ID'],'reviewed_remote_scope':'Root manual-only synthetic Source20 qualification, no production or release admission'}
 ar=save(RUN/'ROOT_REMOTE_ACTIONS_ADMISSION.ONCE.json',admission)
 # Operator owns its original1800+45 workload and all descendant/resource guards.
 # Parent has no product retry, and retains original wait before final adoption.
 rc=None;result=None;original_error=None;cleanup_error=None
 try:
  rc,a,b=run(['python3',str(op),'--Root-admission',ar['path']],1875,cap=1024*1024,allow=True,operator=True)
  result=json.loads((out/'RESULT.json').read_text())if(out/'RESULT.json').exists()else None
 except BaseException as e:original_error={'class':type(e).__name__,'message':str(e)}
 finally:
  try:cleanup=cleanup_exact(out)
  except BaseException as e:cleanup_error={'class':type(e).__name__,'message':str(e)};cleanup=None
  save(META/'ORIGINAL_OPERATOR_TERMINAL.json',{'original_exit':rc,'original_error':original_error,'result':ref(out/'RESULT.json')if(out/'RESULT.json').exists()else None,'actual_result_passed':bool(result and result.get('passed')),'source':cfg['current_candidate_owner_result'],'all_commands':commands,'exact_recorded_resource_cleanup':cleanup,'cleanup_error':cleanup_error,'production':False,'whole_G31':False,'no_replay':True})
 assert not original_error and not cleanup_error and rc==0 and result and result['passed']is True and all(result['cleanup'].values()),'Original qualification NOT_PASS; preserve evidence and no retry'

if __name__=='__main__':main()
