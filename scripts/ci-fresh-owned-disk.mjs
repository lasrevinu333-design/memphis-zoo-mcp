// Explicit fresh migrations-only storage; importing this module creates no resource.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, statfsSync, mkdirSync, readdirSync, readFileSync, existsSync, rmdirSync, openSync, closeSync, writeFileSync, fsyncSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

export const PGDATA = '/var/lib/postgresql/data';
export const HOSTED_SETTINGS_SHA256 = 'a42bde5d3934d628fe43be6deb881ba44ae3670c8996b250dea70b8cc37b696e';
export const OWNED_DISK_SETTINGS = Object.freeze({jit:'off',work_mem:'2184kB',shared_buffers:'224MB',max_connections:'60',maintenance_work_mem:'32MB',statement_timeout:'2min',lock_timeout:'0',idle_in_transaction_session_timeout:'0',temp_file_limit:'-1'});
export const DISK_BUDGET = Object.freeze({max_data_bytes:1024**3,min_available_bytes:512*1024**2,hard_quota:false,observation_only_between_operations:true});
export function normalizeDataStorage(value = 'tmpfs') { assert.ok(['tmpfs','owned-disk'].includes(value),'Explicit dataStorage must be tmpfs or owned-disk'); return value; }
const safePath = p => { assert.equal(typeof p,'string'); assert.equal(resolve(p),p); assert.ok(!/[\x00-\x1f\x7f,]/.test(p),'Unsafe Docker bind path'); assert.equal(realpathSync(p),p,'Symlink/path escape refused'); return p; };
function identity(path) { safePath(path); const s=lstatSync(path); assert.ok(s.isDirectory()&&!s.isSymbolicLink()); for(const n of [s.dev,s.ino,s.uid,s.gid])assert.ok(Number.isSafeInteger(n)); return {path,dev:s.dev,ino:s.ino,uid:s.uid,gid:s.gid,mode:s.mode&0o7777}; }
function diskStat(path) { const s=statfsSync(path); assert.ok(![0x01021994,0x858458f6].includes(s.type>>>0),'Owned disk cannot use tmpfs/ramfs'); return {type:s.type,bsize:s.bsize,available_bytes:s.bavail*s.bsize}; }
function writeOnce(directory,name,value) { const fd=openSync(resolve(directory,name),'wx',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}const p=openSync(directory,'r');try{fsyncSync(p);}finally{closeSync(p);} }
function readReceipt(path) { safePath(path); const s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.nlink,1);assert.equal(s.mode&0o7777,0o600);assert.ok(s.size<=1024*1024);return JSON.parse(readFileSync(path,'utf8')); }
export function validateOwnedDiskParent(parent) {
  assert.equal(typeof parent,'string','Owned disk requires explicit private TMPDIR');const parentIdentity=identity(parent);assert.equal(parentIdentity.uid,process.getuid());assert.equal(parentIdentity.mode,0o700);const filesystem=diskStat(parent);
  assert.ok(filesystem.available_bytes>=DISK_BUDGET.max_data_bytes+DISK_BUDGET.min_available_bytes,'Owned disk requires 1.5 GiB available before construction');return {parentIdentity,filesystem};
}
export function createOwnedDiskStorage({directory,parent}) {
  const {parentIdentity,filesystem}=validateOwnedDiskParent(parent),namespace=identity(directory);
  for(const value of [parentIdentity,namespace]) {assert.equal(value.uid,process.getuid());assert.equal(value.mode,0o700);}
  assert.equal(dirname(directory),parent);assert.match(directory.slice(parent.length+1),/^custodial-ci-fixture-[A-Za-z0-9]+$/);
  assert.equal(namespace.dev,parentIdentity.dev);
  const path=resolve(directory,'pgdata');assert.equal(existsSync(path),false,'Never adopt existing PGDATA');mkdirSync(path,{mode:0o700});
  const data=identity(path);assert.equal(data.dev,namespace.dev);assert.equal(data.uid,process.getuid());assert.equal(data.mode,0o700);assert.deepEqual(readdirSync(path),[]);
  return {schema:'custodial.ci-owned-disk.v1',kind:'owned-disk',parent:parentIdentity,namespace,data,filesystem,
    budget:{...DISK_BUDGET},settings_source_sha256:HOSTED_SETTINGS_SHA256,settings_source_scope:'Observed postgres owner session PG17.6/170006; not either Render runtime account',settings:{...OWNED_DISK_SETTINGS},
    original_mount:{type:'bind',source:path,target:PGDATA,read_only:false,bind_propagation:'rprivate',bind_recursive:'disabled'}};
}
export function assertOwnedDiskStorage(storage,{allowAbsent=false,requireEmpty=false}={}) {
  assert.equal(storage?.schema,'custodial.ci-owned-disk.v1');assert.equal(storage.kind,'owned-disk');
  assert.deepEqual(storage.budget,DISK_BUDGET);assert.equal(storage.settings_source_sha256,HOSTED_SETTINGS_SHA256);assert.deepEqual(storage.settings,OWNED_DISK_SETTINGS);
  assert.deepEqual(identity(storage.parent.path),storage.parent);assert.deepEqual(identity(storage.namespace.path),storage.namespace);
  assert.equal(storage.parent.uid,process.getuid());assert.equal(storage.parent.mode,0o700);assert.equal(storage.namespace.uid,process.getuid());assert.equal(storage.namespace.mode,0o700);
  assert.equal(dirname(storage.namespace.path),storage.parent.path);assert.match(storage.namespace.path.slice(storage.parent.path.length+1),/^custodial-ci-fixture-[A-Za-z0-9]+$/);
  assert.equal(storage.data.path,resolve(storage.namespace.path,'pgdata'));assert.equal(storage.namespace.dev,storage.parent.dev);assert.equal(storage.data.dev,storage.namespace.dev);
  assert.equal(storage.data.uid,process.getuid());assert.equal(storage.data.mode,0o700);
  assert.deepEqual(storage.original_mount,{type:'bind',source:storage.data.path,target:PGDATA,read_only:false,bind_propagation:'rprivate',bind_recursive:'disabled'});
  const filesystem=diskStat(storage.parent.path);assert.equal(filesystem.type,storage.filesystem.type);assert.equal(filesystem.bsize,storage.filesystem.bsize);
  if(!existsSync(storage.data.path)){assert.equal(allowAbsent,true,'Owned PGDATA disappeared');return {absent:true,filesystem};}
  const current=identity(storage.data.path);assert.deepEqual([current.dev,current.ino,current.mode],[storage.data.dev,storage.data.ino,0o700]);
  const originalOwner=current.uid===storage.data.uid&&current.gid===storage.data.gid;
  assert.ok(originalOwner||(current.uid===100&&current.gid===storage.data.gid),'Unexpected PGDATA ownership');
  // Only the pinned PostgreSQL entrypoint can transition the exact new leaf.
  if(originalOwner||requireEmpty){assert.deepEqual(readdirSync(storage.data.path),[]);if(requireEmpty)assert.ok(originalOwner);}
  return {absent:false,current,filesystem};
}
export function diskMountArgs(storage) { return ['--mount',`type=bind,source=${storage.data.path},target=${PGDATA},bind-propagation=rprivate,bind-recursive=disabled`]; }
export function assertIsolation(observed) {
  const h=observed.HostConfig;assert.equal(h.NetworkMode,'none');assert.equal(h.ReadonlyRootfs,true);assert.equal(h.Memory,512*1024*1024);assert.equal(h.MemorySwap,512*1024*1024);assert.equal(h.NanoCpus,1_000_000_000);assert.equal(h.PidsLimit,128);
  assert.equal(Object.keys(h.PortBindings||{}).length,0);assert.equal(h.LogConfig.Type,'local');assert.deepEqual(h.LogConfig.Config,{'max-size':'1m','max-file':'2'});
}
export function assertStorageMounts(observed,{storage=null,initDirectory=null,socketDirectory=null,cleanup=false}={}) {
  assertIsolation(observed);
  const expected=cleanup?{[PGDATA]:{source:storage.data.path,rw:true}}:{'/docker-entrypoint-initdb.d':{source:initDirectory,rw:false},...(socketDirectory?{'/custodial-fixture-socket':{source:socketDirectory,rw:true}}:{}),...(storage?{[PGDATA]:{source:storage.data.path,rw:true}}:{})};
  const tmpfs=cleanup?{}:{'/tmp':'rw,size=64m','/var/run/postgresql':'rw,size=8m',...(!storage?{[PGDATA]:'rw,size=1g'}:{})};
  assert.deepEqual(observed.HostConfig.Tmpfs||{},tmpfs);
  const mounts=observed.Mounts;assert.ok(Array.isArray(mounts));assert.equal(mounts.length,Object.keys(expected).length,'Extra Docker bind/volume mount refused');
  for(const [destination,value] of Object.entries(expected)) {const found=mounts.filter(m=>m.Destination===destination);assert.equal(found.length,1);const m=found[0];assert.equal(m.Type,'bind');assert.equal(m.Source,value.source);assert.equal(m.RW,value.rw);if(storage&&destination===PGDATA)assert.equal(m.Propagation,'rprivate');}
  // Actual Docker readback lists tmpfs only in HostConfig.Tmpfs, not Mounts.
  if(storage){const configs=observed.HostConfig.Mounts||[];const data=configs.filter(m=>m.Target===PGDATA);assert.equal(data.length,1);assert.equal(data[0].Type,'bind');assert.equal(data[0].Source,storage.data.path);assert.equal(data[0].ReadOnly===true,false);assert.equal(data[0].BindOptions?.Propagation,'rprivate');assert.equal(data[0].BindOptions?.NonRecursive,true,'Nested host mounts refused');}
}
export const ownedDiskSettingsSql = `select jsonb_build_object('server_version_num',current_setting('server_version_num'),'settings',jsonb_build_object(${Object.keys(OWNED_DISK_SETTINGS).map(k=>`'${k}',current_setting('${k}')`).join(',')}));`;
export function assertOwnedDiskSettings(readback) {assert.equal(readback.server_version_num,'170006');assert.deepEqual(readback.settings,OWNED_DISK_SETTINGS);return {source_sha256:HOSTED_SETTINGS_SHA256,source_scope:'postgres owner session, not Render runtime role',target_server_version_num:'170006',actual_server_version_num:readback.server_version_num,settings:readback.settings,other_platform_differences_not_waived:true};}
function docker(args,timeout=20_000) {const r=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,'Owned disk Docker operation failed: '+args[0]);return r.stdout;}
function inspect(target) {const r=spawnSync('docker',['inspect','--format','{{json .}}',target],{encoding:'utf8',timeout:20_000,maxBuffer:2*1024*1024});if(r.error)throw r.error;if(r.status===0)return JSON.parse(r.stdout);if(r.status===1&&!r.stdout.trim()&&['Error: No such object: ','Error: No such container: ','error: no such object: '].some(p=>r.stderr===p+target+'\n'))return null;throw Error('Owned disk exact inspect unresolved');}
const diskObservations = new Map();
export function observeOwnedDiskBudget(storage,container,{force=false}={}) {
  const state=assertOwnedDiskStorage(storage);assert.match(container,/^[a-f0-9]{64}$/);assert.ok(state.filesystem.available_bytes>=DISK_BUDGET.min_available_bytes,'Owned disk reserve exhausted');
  const previous=diskObservations.get(container);
  if(!force&&previous&&Date.now()-previous.at_ms<5000)return {...previous,available_bytes:state.filesystem.available_bytes,cached:true};
  const raw=docker(['exec','--user','postgres',container,'du','-skx','--',PGDATA]);assert.match(raw,/^\d+\s+\/var\/lib\/postgresql\/data\s*$/);const bytes=Number(raw.trim().split(/\s+/)[0])*1024;
  assert.ok(Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=DISK_BUDGET.max_data_bytes,'Owned PGDATA exceeded 1 GiB observed budget');const result={at_ms:Date.now(),data_bytes:bytes,available_bytes:state.filesystem.available_bytes,current_data_identity:state.current,budget:DISK_BUDGET,hard_quota:false,cached:false};diskObservations.set(container,result);return result;
}
// rm does not follow child symlinks. find rejects all symlinks and special files
// before any deletion; -xdev and nonrecursive bind prohibit traversing another FS.
export function ownedDiskCleanupCommand(storage) {
assert.ok(Number.isSafeInteger(storage.data.gid)&&storage.data.gid>=0&&storage.data.gid<=4294967295);
return `set -eu\ntest "$(stat -c '%u:%g:%a' ${PGDATA})" = '100:${storage.data.gid}:700'\ntest -z "$(find ${PGDATA} -xdev -mindepth 1 ! -type f ! -type d -print -quit)"\nfind ${PGDATA} -xdev -mindepth 1 -depth -delete\ntest -z "$(find ${PGDATA} -mindepth 1 -print -quit)"\n`;
}
export function assertCleanupFence(fence) {assert.equal(fence.actual_wait_returned,true);assert.equal(fence.fresh_PID_PGID_proc_absent,true,'Original constructor can still write PGDATA');}
export function assertOwnedDiskCleanupFence(storage) {
  const fence=readReceipt(resolve(storage.namespace.path,'PARENT_ORIGINAL_CHILD_WAIT_AND_STREAMS.json'));assertCleanupFence(fence);
  const ownerRecord=readReceipt(resolve(storage.namespace.path,'PARENT_ORIGINAL_CHILD_OWNER.json'));
  assert.ok(Number.isSafeInteger(ownerRecord.pid)&&ownerRecord.pid>1);assert.equal(ownerRecord.pgid,ownerRecord.pid);
  assert.equal(existsSync('/proc/'+ownerRecord.pid),false,'Original constructor PID is present');try{process.kill(-ownerRecord.pgid,0);throw Error('Original constructor process group remains');}catch(e){if(e.code!=='ESRCH')throw e;}
  return fence;
}
function readCID(path) {safePath(path);const s=lstatSync(path);assert.ok(s.isFile()&&!s.isSymbolicLink());assert.equal(s.uid,process.getuid());assert.equal(s.nlink,1);assert.ok(s.size<=65);const value=readFileSync(path,'utf8').trim();assert.match(value,/^[a-f0-9]{64}$/);return value;}
export function cleanupOwnedDiskStorage({storage,birth,container,custodyDirectory}) {
  if(!storage)return null;
  const fence=assertOwnedDiskCleanupFence(storage);
  const originalAbsent=()=>{assert.equal(inspect(birth.name),null,'Original database name still present');if(container){assert.match(container,/^[a-f0-9]{64}$/);assert.equal(inspect(container),null,'Original database CID still present');}};
  originalAbsent();assert.equal(birth.data_storage,'owned-disk');assert.deepEqual(birth.owned_disk_storage,storage);assert.equal(birth.construction_only,true);assert.equal(dirname(custodyDirectory),storage.namespace.path);
  const donePath=resolve(custodyDirectory,'OWNED_DISK_REMOVED.json'),emptyPath=resolve(custodyDirectory,'OWNED_DISK_EMPTY_LEAF_CLEANUP.json');
  if(existsSync(donePath)){const done=readReceipt(donePath);assert.deepEqual(done.storage,storage);assert.equal(done.original_container,container);assert.equal(assertOwnedDiskStorage(storage,{allowAbsent:true}).absent,true);if(done.helper){assert.equal(inspect(done.helper.id),null);assert.equal(inspect(done.helper.name),null);}return done;}
  const command=ownedDiskCleanupCommand(storage);
  const helperName=birth.name+'_pgdata_cleanup',intentPath=resolve(custodyDirectory,'OWNED_DISK_CLEANUP_PREBIRTH.json'),cidfile=resolve(custodyDirectory,'owned-disk-cleanup.cid');
  const intent={schema:'custodial.ci-owned-disk-cleanup.v1',name:helperName,owner:birth.owner,image:birth.image,original_container:container,storage,command_sha256:createHash('sha256').update(command).digest('hex'),cidfile};
  const waitPath=resolve(custodyDirectory,'OWNED_DISK_CLEANUP_WAIT.json'),absentPath=resolve(custodyDirectory,'OWNED_DISK_CLEANUP_ABSENT.json');
  const completedHelper=()=>{
    assert.deepEqual(readReceipt(intentPath),intent);const id=readCID(cidfile),wait=readReceipt(waitPath);
    assert.deepEqual(wait,{id,name:helperName,actual_wait_returned:true,exit:0,running:false});assert.equal(inspect(id),null);assert.equal(inspect(helperName),null);
    const helper={...wait,exact_absence:true};if(existsSync(absentPath))assert.deepEqual(readReceipt(absentPath),helper);else writeOnce(custodyDirectory,'OWNED_DISK_CLEANUP_ABSENT.json',helper);return helper;
  };
  const state=assertOwnedDiskStorage(storage,{allowAbsent:true});let helper=null;
  if(state.absent) {
    if(existsSync(emptyPath))assert.deepEqual(readReceipt(emptyPath),{storage,original_container:container,empty_original_owner_leaf:true});else helper=completedHelper();
  } else if(state.current.uid===storage.data.uid&&state.current.gid===storage.data.gid){
    assert.deepEqual(readdirSync(storage.data.path),[]);const record={storage,original_container:container,empty_original_owner_leaf:true};
    if(existsSync(emptyPath))assert.deepEqual(readReceipt(emptyPath),record);else writeOnce(custodyDirectory,'OWNED_DISK_EMPTY_LEAF_CLEANUP.json',record);
  } else {
    if(existsSync(intentPath))assert.deepEqual(readReceipt(intentPath),intent);else{assert.equal(inspect(helperName),null,'Foreign cleanup name collision');writeOnce(custodyDirectory,'OWNED_DISK_CLEANUP_PREBIRTH.json',intent);}
    let helperCID=existsSync(cidfile)?readCID(cidfile):null,observed=inspect(helperCID||helperName),verified=false;
    if(!observed&&helperCID) helper=completedHelper();
    else try {
      if(!observed){
        const args=['create','--name',helperName,'--label','custodial.owner='+birth.owner,'--label','custodial.purpose=owned-pgdata-cleanup','--cidfile',cidfile,'--network','none','--read-only','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','128','--no-healthcheck','--log-driver','local','--log-opt','max-size=1m','--log-opt','max-file=2','--cap-drop','ALL','--security-opt','no-new-privileges','--user','100:101','--entrypoint','/bin/sh',...diskMountArgs(storage),birth.image,'-ceu',command];
        helperCID=docker(args).trim();assert.match(helperCID,/^[a-f0-9]{64}$/);assert.equal(readCID(cidfile),helperCID);observed=inspect(helperCID);
      }
      assert.equal(observed.Name,'/'+helperName);assert.equal(observed.Config.Labels?.['custodial.owner'],birth.owner);assert.equal(observed.Config.Labels?.['custodial.purpose'],'owned-pgdata-cleanup');assert.equal(observed.Config.Image,birth.image);
      const imageID=docker(['image','inspect','--format','{{.Id}}',birth.image]).trim();assert.match(imageID,/^sha256:[a-f0-9]{64}$/);assert.equal(observed.Image,imageID);assert.equal(observed.Config.User,'100:101');assert.deepEqual(observed.Config.Entrypoint,['/bin/sh']);assert.deepEqual(observed.Config.Cmd,['-ceu',command]);assertStorageMounts(observed,{storage,cleanup:true});
      assert.equal(observed.HostConfig.Privileged,false);assert.deepEqual(observed.HostConfig.CapDrop,['ALL']);assert.ok(observed.HostConfig.SecurityOpt.includes('no-new-privileges'));
      helperCID=observed.Id;assert.match(helperCID,/^[a-f0-9]{64}$/);assert.equal(readCID(cidfile),helperCID);verified=true;
      if(!existsSync(resolve(custodyDirectory,'OWNED_DISK_CLEANUP_INSPECT.json')))writeOnce(custodyDirectory,'OWNED_DISK_CLEANUP_INSPECT.json',observed);
      if(observed.State.Status==='created') {assertOwnedDiskStorage(storage);originalAbsent();assert.equal(docker(['start',helperCID]).trim(),helperCID);}
      else assert.ok(['running','exited'].includes(observed.State.Status),'Unexpected cleanup state');
      // An actual docker wait result, not start acceptance, proves command exit.
      const waited=docker(['wait',helperCID],45_000).trim();assert.match(waited,/^\d+$/);const after=inspect(helperCID);assert.equal(after.State.Running,false);assert.equal(after.State.ExitCode,Number(waited));
      const waitReceipt={id:helperCID,name:helperName,actual_wait_returned:true,exit:Number(waited),running:false};
      if(existsSync(waitPath))assert.deepEqual(readReceipt(waitPath),waitReceipt);else writeOnce(custodyDirectory,'OWNED_DISK_CLEANUP_WAIT.json',waitReceipt);
      assert.equal(docker(['rm',helperCID]).trim(),helperCID);assert.equal(inspect(helperCID),null);assert.equal(inspect(helperName),null);helper={...waitReceipt,exact_absence:true};
      if(existsSync(absentPath))assert.deepEqual(readReceipt(absentPath),helper);else writeOnce(custodyDirectory,'OWNED_DISK_CLEANUP_ABSENT.json',helper);
      assert.equal(Number(waited),0,'Cleanup helper failed; retained leaf needs reviewed reconciliation');
    } catch(error) {
      // If wait failed, stop only the exact helper already fully verified above.
      // Never turn timeout/start acceptance into successful cleanup or rerun it.
      if(verified) try {
        const live=inspect(helperCID);if(live){assert.equal(live.Id,helperCID);assert.equal(live.Config.Labels?.['custodial.owner'],birth.owner);assertStorageMounts(live,{storage,cleanup:true});
          if(live.State.Running)docker(['kill',helperCID]);const exit=docker(['wait',helperCID],20_000).trim();assert.match(exit,/^\d+$/);
          const stopped=inspect(helperCID);assert.equal(stopped.State.Running,false);assert.equal(stopped.State.ExitCode,Number(exit));
          if(!existsSync(resolve(custodyDirectory,'OWNED_DISK_CLEANUP_ABORT_WAIT.json')))writeOnce(custodyDirectory,'OWNED_DISK_CLEANUP_ABORT_WAIT.json',{id:helperCID,name:helperName,actual_wait_returned:true,exit:Number(exit),failure_preserved:true});
          assert.equal(docker(['rm',helperCID]).trim(),helperCID);}
        assert.equal(inspect(helperCID),null);assert.equal(inspect(helperName),null);
        if(!existsSync(resolve(custodyDirectory,'OWNED_DISK_CLEANUP_ABORT_ABSENT.json')))writeOnce(custodyDirectory,'OWNED_DISK_CLEANUP_ABORT_ABSENT.json',{id:helperCID,name:helperName,exact_absence:true,success:false});
      } catch(reconciliation){throw new AggregateError([error,reconciliation],'Owned cleanup helper outcome unresolved; original receipts and PGDATA retained');}
      throw error;
    }
  }
  originalAbsent();assertOwnedDiskCleanupFence(storage);
  if(!state.absent){const final=assertOwnedDiskStorage(storage);assert.equal(final.current.ino,storage.data.ino);rmdirSync(storage.data.path);}
  assert.equal(existsSync(storage.data.path),false);
  const receipt={schema:'custodial.ci-owned-disk-removed.v1',storage,original_container:container,original_name:birth.name,original_absence:true,original_child_fence:fence,helper,leaf_absent:true,evidence_preserved:true};writeOnce(custodyDirectory,'OWNED_DISK_REMOVED.json',receipt);return receipt;
}
