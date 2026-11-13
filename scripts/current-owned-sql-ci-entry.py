from pathlib import Path
import json,hashlib,subprocess,shutil,os,sys
import argparse
parser=argparse.ArgumentParser(description='Explicit owned SQL CI fixture, never an app build, deployment, or production migration')
parser.add_argument('--consumer',choices=['manager','taxonomy'],required=True)
parser.add_argument('--runtime',required=True,help='new absolute owned directory on an existing secondary disk')
parser.add_argument('--evidence',required=True,help='new absolute durable evidence directory')
args=parser.parse_args()
B=Path(__file__).resolve().parent.parent
T=Path(args.runtime);E=Path(args.evidence)
for p in [T,E]:
 assert p.is_absolute() and p.resolve()==p and not p.exists() and p.parent.is_dir() and not p.parent.is_symlink()
 assert p.parent.stat().st_uid==os.getuid(), 'Caller must provide its own parent directory'
fs=subprocess.check_output(['stat','-f','-c','%T',str(T.parent)],text=True).strip()
assert fs not in ['tmpfs','ramfs','overlayfs'] and T.parent.stat().st_dev!=Path('/').stat().st_dev,'Existing secondary disk required; no root/tmpfs fallback'
count=310 if args.consumer=='taxonomy' else 308
consumer='completion-taxonomy-database-tests.mjs' if count==310 else 'manager-scheduler-database-tests.mjs'
constructor='current-qualification-rebuild.py' if count==310 else 'current-candidate-rebuild.py'
label=args.consumer
S=T/'source';O=E.parent
assert not T.is_relative_to(B) and not E.is_relative_to(B), 'Fixture roots must be outside source checkout'
assert not (O/(E.name+'-SOURCE.json')).exists() and not (O/(E.name+'.log')).exists(), 'Evidence identity already exists'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=B/('scripts/fixtures/qualified-current310-reconstruction-manifest.json' if count==310 else 'scripts/fixtures/qualified-predecessor-current308-replay.json')
assert sha(manifest)==('731de02212315ce3af9985e5ff9258602c444a3b0439a5b736f11af9f807c3c1' if count==310 else '6037f9ef923c4173e0f5287ff4036d248c4afc18e5a130f380a413139e7a456b')
old=json.loads(manifest.read_text());rows=[r for p in old['phases'] for r in p['files']]
current=json.loads((B/'supabase/canonical/migration-replay-order.json').read_text());assert [r for p in current['phases'] for r in p['files']][:count]==rows and len(rows)==count
for row in rows:assert sha(B/'supabase/migrations'/row['name'])==row['sha256']
# Explicit source stage for the selected original admitted308/310 constructor. The current
# source-only fixture helper and 317-file directory are not execution grants.
T.mkdir(mode=0o700);S.mkdir(mode=0o700)
for n in ['scripts','src','release','config']:
 assert not any(p.is_symlink() for p in (B/n).rglob('*')), 'Source symlinks refused'
 shutil.copytree(B/n,S/n,symlinks=False)
for n in ['package.json','package-lock.json']:shutil.copy2(B/n,S/n)
(S/'node_modules').mkdir()
(T/'backend-deps').mkdir(mode=0o700)
shutil.copytree((B/'node_modules').resolve(),T/'backend-deps/node_modules',symlinks=True)
assert (T/'backend-deps/node_modules/pg/package.json').is_file()
# Fail before reconstruction if the original sandbox dependencies are absent.
subprocess.run(['bwrap','--unshare-net','--die-with-parent','--ro-bind','/','/','--bind',str(T),str(T),'--ro-bind',str(T/'backend-deps/node_modules'),str(S/'node_modules'),'--tmpfs','/tmp','--dev','/dev','--proc','/proc','node','--check',str(S/'scripts'/consumer)],check=True)
(S/'supabase/migrations').mkdir(parents=True);(S/'supabase/canonical').mkdir()
for row in rows:shutil.copy2(B/'supabase/migrations'/row['name'],S/'supabase/migrations'/row['name'])
shutil.copy2(manifest,S/'supabase/canonical/migration-replay-order.json')
source=B/'scripts/fixtures/custodial-pg-wire-relay.c';assert sha(source)=='5bd54bf0f8a7557fbb9f4867bfdf380feabbdfe73e8040d3f1f2540c8d42a732';relay=T/'custodial-pg-wire-relay'
subprocess.run(['cc','-static','-O2','-Wall','-Wextra','-o',str(relay),str(source)],check=True)
assert relay.read_bytes()[:4]==b'\x7fELF'
for n in ['home','tmp']:(T/n).mkdir(mode=0o700)
spec={'schema':f'custodial.current{count}-local-ci-consumer.v1','script':consumer,'args':[],'relay':str(relay),'relay_sha256':sha(relay),'runtime':str(T)}
p=T/'consumer-spec.json';p.write_text(json.dumps(spec,indent=2)+'\n');p.chmod(0o600)
source_rows=[{'path':str(p.relative_to(S)),'sha256':sha(p)}for p in sorted(S.rglob('*'))if p.is_file()]
(O/(E.name+'-SOURCE.json')).write_text(json.dumps({'scope':f'Original current{count} constructor and current {consumer} assertions; isolated local CI qualification only','files':source_rows,'relay_source_sha256':sha(source),'production':False,'release_admission':False},indent=2)+'\n')
env={k:os.environ[k] for k in ['PATH','LANG'] if k in os.environ};env['TMPDIR']=str(T/'tmp')
with (O/(E.name+'.log')).open('x') as log:
 result=subprocess.run(['python3',str(S/'scripts'/constructor),'--workspace',str(T/'database'),'--evidence',str(E),'--vendor-fixture',str(B/'scripts/fixtures/current-replay-vendor-sql'),'--consumer-spec',str(p)],env=env,stdout=log,stderr=subprocess.STDOUT)
for row in source_rows:assert sha(S/row['path'])==row['sha256']
print(json.dumps({'exit':result.returncode,'evidence':str(E),'source_unchanged':True}));raise SystemExit(result.returncode)
