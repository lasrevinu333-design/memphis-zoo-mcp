// Offline port-level contract checks. No fixture constructor, Docker, DB, process,
// socket, filesystem allocation or network operation is executed by this suite.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
const source=readFileSync(new URL('./ci-fresh-owned-disk.mjs',import.meta.url),'utf8');
const parent=readFileSync(new URL('./ci-fresh-only-replay.mjs',import.meta.url),'utf8');
const child=readFileSync(new URL('./empty-database-rebuild-check.mjs',import.meta.url),'utf8');
const checks=[];const pass=x=>{checks.push(x);console.log('PASS '+x);};
function world(){
 const nodes=new Map(),fds=new Map(),containers=new Map(),calls=[];let ino=1,fd=3;
 const flags={free:4*1024**3,type:0xef53,killLive:false,failWait:false,failRmdir:false,failDone:false};
 const node=(p,{uid=1000,gid=1000,mode=0o700,file=false,content='',entries=[],symlink=false,target=p,dev=1}={})=>{const n={p,uid,gid,mode,file,content,entries,symlink,target,dev,ino:ino++};nodes.set(p,n);return n;};
 const parentPath='/owned/tmp',namespace=parentPath+'/custodial-ci-fixture-ABC123',custody=namespace+'/custodial-ci-fresh-custody-ABC123';node(parentPath);node(namespace);node(custody);
 const stats=p=>{const n=nodes.get(p);assert.ok(n,'Unexpected virtual filesystem path '+p);return {dev:n.dev,ino:n.ino,uid:n.uid,gid:n.gid,mode:n.mode,nlink:1,size:Buffer.byteLength(n.content),isDirectory:()=>!n.file&&!n.symlink,isFile:()=>n.file,isSymbolicLink:()=>n.symlink};};
 const read=(p,encoding)=>{const n=nodes.get(p);assert.ok(n?.file);return encoding? n.content:Buffer.from(n.content);};
 const write=(p,value)=>node(p,{file:true,mode:0o600,content:JSON.stringify(value)+'\n'});
 const absent=target=>({status:1,stdout:'',stderr:'Error: No such object: '+target+'\n'});
 const storageMount=(p)=>({Type:'bind',Source:p,Destination:'/var/lib/postgresql/data',RW:true,Propagation:'rprivate'});
 const host=()=>({NetworkMode:'none',ReadonlyRootfs:true,Memory:536870912,MemorySwap:536870912,NanoCpus:1e9,PidsLimit:128,PortBindings:{},LogConfig:{Type:'local',Config:{'max-size':'1m','max-file':'2'}},Tmpfs:{},Privileged:false,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],Mounts:[{Type:'bind',Source:namespace+'/pgdata',Target:'/var/lib/postgresql/data',BindOptions:{Propagation:'rprivate',NonRecursive:true}}]});
 function spawnSync(command,args){assert.equal(command,'docker');calls.push([...args]);const output=stdout=>({status:0,stdout,stderr:''});
  if(args[0]==='image')return output('sha256:'+'a'.repeat(64)+'\n');
  if(args[0]==='inspect'){const target=args.at(-1),c=containers.get(target)||[...containers.values()].find(x=>x.Name==='/'+target);return c?output(JSON.stringify(c)):absent(target);}
  if(args[0]==='create'){const id='b'.repeat(64),name=args[args.indexOf('--name')+1],cid=args[args.indexOf('--cidfile')+1];node(cid,{file:true,mode:0o644,content:id+'\n'});containers.set(id,{Id:id,Name:'/'+name,Image:'sha256:'+'a'.repeat(64),Config:{Image:args.at(-3),User:'100:101',Entrypoint:['/bin/sh'],Cmd:args.slice(-2),Labels:{'custodial.owner':'00000000-0000-4000-8000-000000000001','custodial.purpose':'owned-pgdata-cleanup'}},HostConfig:host(),Mounts:[storageMount(namespace+'/pgdata')],State:{Status:'created',Running:false,ExitCode:0}});return output(id+'\n');}
  if(args[0]==='exec')return output('1024\t/var/lib/postgresql/data\n');
  const id=args.at(-1),c=containers.get(id);assert.ok(c,'Unexpected virtual Docker operation '+args[0]);
  if(args[0]==='start'){c.State={Status:'running',Running:true,ExitCode:0};return output(id+'\n');}
  if(args[0]==='wait'){if(flags.failWait){flags.failWait=false;return {error:Error('modeled wait timeout')};}if(c.State.Running){nodes.get(namespace+'/pgdata').entries=[];c.State={Status:'exited',Running:false,ExitCode:0};}return output(String(c.State.ExitCode)+'\n');}
  if(args[0]==='kill'){c.State={Status:'exited',Running:false,ExitCode:137};return output(id+'\n');}
  if(args[0]==='rm'){assert.equal(c.State.Running,false);containers.delete(id);return output(id+'\n');}
  if(args[0]==='exec')return output('1024\t/var/lib/postgresql/data\n');
  throw Error('Unexpected virtual Docker verb '+args[0]);
 }
 // VM ports cross realms; normalize only plain receipt values for deep comparison.
 const portAssert=Object.assign((...args)=>assert(...args),assert,{deepEqual:(a,b,...rest)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),...rest)});
 const ports={assert:portAssert,createHash,resolve,dirname,Buffer,Date,process:{getuid:()=>1000,kill(){if(flags.killLive)return;const e=Error('absent');e.code='ESRCH';throw e;}},
  lstatSync:stats,realpathSync:p=>{const n=nodes.get(p);assert.ok(n,'Unexpected virtual realpath '+p);return n.target;},statfsSync:()=>({type:flags.type,bsize:4096,bavail:flags.free/4096}),
  mkdirSync:(p,o)=>{assert.equal(nodes.has(p),false);node(p,{mode:o.mode});},readdirSync:p=>{const n=nodes.get(p);assert.ok(n);assert.equal(n.uid,1000,'Host must not read PostgreSQL-owned contents');return n.entries;},
  readFileSync:read,existsSync:p=>nodes.has(p),rmdirSync:p=>{if(flags.failRmdir){flags.failRmdir=false;throw Error('modeled interruption before rmdir');}const n=nodes.get(p);assert.ok(n&&!n.file);assert.deepEqual(n.entries,[]);nodes.delete(p);},
  openSync:(p,mode,permissions)=>{if(mode==='wx'){if(flags.failDone&&p.endsWith('/OWNED_DISK_REMOVED.json')){flags.failDone=false;throw Error('modeled interruption after rmdir');}assert.equal(nodes.has(p),false);node(p,{file:true,mode:permissions});}else assert.ok(nodes.has(p));const f=fd++;fds.set(f,p);return f;},
  closeSync:f=>fds.delete(f),writeFileSync:(f,value)=>{const n=nodes.get(fds.get(f));assert.ok(n);n.content=String(value);},fsyncSync(){},spawnSync};
 const executable=source.replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\n;({normalizeDataStorage,validateOwnedDiskParent,createOwnedDiskStorage,assertOwnedDiskStorage,assertStorageMounts,assertOwnedDiskSettings,cleanupOwnedDiskStorage,assertCleanupFence,observeOwnedDiskBudget,ownedDiskCleanupCommand,OWNED_DISK_SETTINGS,DISK_BUDGET})';
 const api=vm.runInNewContext(executable,ports);
 function prepared(){const storage=api.createOwnedDiskStorage({directory:namespace,parent:parentPath});const data=nodes.get(namespace+'/pgdata');data.uid=100;data.entries=['PG_VERSION','base'];
  write(namespace+'/PARENT_ORIGINAL_CHILD_WAIT_AND_STREAMS.json',{actual_wait_returned:true,fresh_PID_PGID_proc_absent:true});write(namespace+'/PARENT_ORIGINAL_CHILD_OWNER.json',{pid:4001,pgid:4001});
  const birth={name:'mz_schema_rebuild_storage_test',owner:'00000000-0000-4000-8000-000000000001',image:'supabase/postgres@sha256:'+'c'.repeat(64),data_storage:'owned-disk',owned_disk_storage:storage,construction_only:true};return {storage,birth,container:'d'.repeat(64),custodyDirectory:custody};}
 return {api,nodes,calls,flags,parentPath,namespace,custody,prepared,write,node,host,storageMount,containers};
}
{
 const w=world();assert.equal(w.api.normalizeDataStorage(), 'tmpfs');assert.equal(w.api.normalizeDataStorage('owned-disk'),'owned-disk');for(const bad of [null,false,1,'disk','TMPFS',{},[]])assert.throws(()=>w.api.normalizeDataStorage(bad));assert.equal(w.calls.length,0);pass('explicit closed storage selection preserves default and rejects invalid values without Docker');
}
for(const mutate of [w=>w.nodes.get(w.parentPath).mode=0o777,w=>w.nodes.get(w.parentPath).uid=0,w=>w.nodes.get(w.parentPath).target='/elsewhere',w=>w.flags.type=0x01021994,w=>w.flags.type=0x858458f6,w=>w.flags.free=1024]){
 const w=world();mutate(w);const before=w.nodes.size;assert.throws(()=>w.api.createOwnedDiskStorage({directory:w.namespace,parent:w.parentPath}));assert.equal(w.nodes.size,before);assert.equal(w.calls.length,0);
}pass('unsafe parent, symlink, tmpfs/ramfs and low reserve fail before data allocation');
{
 const w=world(),o=w.prepared();assert.equal(o.storage.data.uid,1000);assert.equal(o.storage.data.gid,1000);assert.match(w.api.ownedDiskCleanupCommand(o.storage),/100:1000:700/);assert.throws(()=>w.api.ownedDiskCleanupCommand({data:{gid:'1000; false'}}));assert.equal(w.api.assertOwnedDiskStorage(o.storage).current.uid,100);assert.equal(o.storage.budget.max_data_bytes,1073741824);assert.throws(()=>w.api.createOwnedDiskStorage({directory:w.namespace,parent:w.parentPath}));pass('new-leaf custody records original identity and permits only expected PostgreSQL ownership');
 for(const [key,value] of [['ino',999],['dev',2],['uid',123],['gid',101],['mode',0o755]]){const n=w.nodes.get(o.storage.data.path),old=n[key];n[key]=value;assert.throws(()=>w.api.assertOwnedDiskStorage(o.storage));n[key]=old;}pass('changed inode, device, owner or mode fails storage identity');
}
{
 const w=world(),o=w.prepared(),observed={HostConfig:w.host(),Mounts:[{Type:'bind',Source:'/init',Destination:'/docker-entrypoint-initdb.d',RW:false,Propagation:'rprivate'},w.storageMount(o.storage.data.path)]};observed.HostConfig.Tmpfs={'/tmp':'rw,size=64m','/var/run/postgresql':'rw,size=8m'};
 w.api.assertStorageMounts(observed,{storage:o.storage,initDirectory:'/init'});pass('recorded Docker shape uses tmpfs map and only bind Mounts; omitted ReadOnly false accepted');
 for(const change of [x=>x.HostConfig.Memory*=2,x=>x.HostConfig.MemorySwap*=2,x=>x.HostConfig.NanoCpus*=2,x=>x.HostConfig.PidsLimit=256,x=>x.HostConfig.NetworkMode='bridge',x=>x.HostConfig.ReadonlyRootfs=false,x=>x.HostConfig.LogConfig.Config['max-size']='2m',x=>x.HostConfig.Tmpfs['/var/lib/postgresql/data']='rw,size=1g',x=>x.Mounts.push({Type:'volume',Destination:'/unexpected'}),x=>x.Mounts[1].Source='/foreign',x=>x.Mounts[1].RW=false,x=>x.HostConfig.Mounts[0].BindOptions.NonRecursive=false]){const changed=structuredClone(observed);change(changed);assert.throws(()=>w.api.assertStorageMounts(changed,{storage:o.storage,initDirectory:'/init'}));}pass('all isolation limits and exact nonrecursive mount boundaries reject widening');
}
{
 const w=world(),settings={jit:'off',work_mem:'2184kB',shared_buffers:'224MB',max_connections:'60',maintenance_work_mem:'32MB',statement_timeout:'2min',lock_timeout:'0',idle_in_transaction_session_timeout:'0',temp_file_limit:'-1'};
 w.api.assertOwnedDiskSettings({server_version_num:'170006',settings});for(const [key,value] of [['jit','on'],['work_mem','4MB'],['shared_buffers','64MB'],['max_connections','32']])assert.throws(()=>w.api.assertOwnedDiskSettings({server_version_num:'170006',settings:{...settings,[key]:value}}));assert.throws(()=>w.api.assertOwnedDiskSettings({server_version_num:'170007',settings}));pass('closed owner-session settings and exact PG17.6 readback reject drift');
}
{
 const w=world(),o=w.prepared();const result=w.api.cleanupOwnedDiskStorage(o);assert.equal(result.leaf_absent,true);assert.equal(result.helper.actual_wait_returned,true);assert.equal(result.helper.exit,0);assert.equal(w.containers.size,0);assert.equal(w.nodes.has(o.storage.data.path),false);
 const verbs=w.calls.map(x=>x[0]);assert.ok(verbs.indexOf('create')<verbs.indexOf('start'));assert.ok(verbs.indexOf('start')<verbs.indexOf('wait'));assert.ok(verbs.indexOf('wait')<verbs.indexOf('rm'));assert.equal(w.api.cleanupOwnedDiskStorage(o).leaf_absent,true);pass('actual cleanup orchestration ports inspect before start, wait before removal, remove exact leaf and support idempotent readback');
}
for(const flag of ['failRmdir','failDone']){
 const w=world(),o=w.prepared();w.flags[flag]=true;assert.throws(()=>w.api.cleanupOwnedDiskStorage(o),/modeled interruption/);const creates=w.calls.filter(x=>x[0]==='create').length;assert.equal(w.api.cleanupOwnedDiskStorage(o).leaf_absent,true);assert.equal(w.calls.filter(x=>x[0]==='create').length,creates);assert.equal(w.containers.size,0);
}pass('retained unknown reconciliation resumes after helper removal or host rmdir without rerunning deletion');
{
 const w=world(),o=w.prepared();w.flags.failWait=true;assert.throws(()=>w.api.cleanupOwnedDiskStorage(o),/modeled wait timeout/);assert.equal(w.containers.size,0);assert.equal(w.nodes.has(o.storage.data.path),true);assert.equal(JSON.parse(w.nodes.get(w.custody+'/OWNED_DISK_CLEANUP_ABORT_WAIT.json').content).exit,137);pass('uncertain helper wait is stopped, actually waited and removed while failure and data evidence remain');
}
for(const alter of [(w,o)=>w.containers.set(o.container,{Name:'/'+o.birth.name}),w=>w.flags.killLive=true,w=>w.nodes.delete(w.namespace+'/PARENT_ORIGINAL_CHILD_WAIT_AND_STREAMS.json')]){
 const w=world(),o=w.prepared();alter(w,o);assert.throws(()=>w.api.cleanupOwnedDiskStorage(o));assert.equal(w.calls.some(x=>x[0]==='create'),false);assert.equal(w.nodes.has(o.storage.data.path),true);
}pass('live original, live constructor group and missing wait fence forbid cleanup helper birth');
{
 const w=world(),o=w.prepared();w.api.observeOwnedDiskBudget(o.storage,o.container);w.api.observeOwnedDiskBudget(o.storage,o.container);assert.equal(w.calls.filter(x=>x[0]==='exec').length,1);w.api.observeOwnedDiskBudget(o.storage,o.container,{force:true});assert.equal(w.calls.filter(x=>x[0]==='exec').length,2);pass('disk size scan is cached for five seconds with explicit forced boundary observation');
}
{
 const validation=parent.slice(parent.indexOf('  assert.ok(options',parent.indexOf('export async function createCiFreshOnlyFixture')),parent.indexOf('  const root = fixtureFileRoot;',parent.indexOf('export async function createCiFreshOnlyFixture')));
 const w=world();for(const key of ['SCHEMA_REBUILD_DATA_STORAGE','SCHEMA_REBUILD_OWNED_DISK_PROFILE'])assert.throws(()=>vm.runInNewContext(validation,{assert,normalizeDataStorage:w.api.normalizeDataStorage,options:{name:'mz_schema_rebuild_storage_test'},process:{env:{[key]:'owned-disk'}}}));
 assert.ok(parent.indexOf("validateOwnedDiskParent(process.env.TMPDIR)")<parent.indexOf("const directory = mkdtempSync"));assert.ok(child.indexOf('assertOwnedDiskStorage(ownedDiskStorage,{requireEmpty:true})')<child.indexOf('if (dockerImage) {'));
 const a=child.indexOf('runDocker(freshOnly ? [')+'runDocker('.length,b=child.indexOf('\n    ]);',a)+6;
 const expression=child.slice(a,b),base={freshOnly:true,dockerContainer:'mz_schema_rebuild_storage_test',freshCustody:{owner:'synthetic',cidfile:'/owned/cid'},fixtureSocket:'',ownedDiskStorage:null,freshInitDirectory:'/owned/init',dockerImage:'pinned-image'};
 const argv=vm.runInNewContext(expression,base);assert.ok(argv.includes('shared_buffers=64MB')&&argv.includes('max_connections=10')&&argv.includes('statement_timeout=20000')&&argv.includes('lock_timeout=5000'));assert.ok(argv.includes('/var/lib/postgresql/data:rw,size=1g'));assert.equal(argv.includes('jit=off'),false);
 const socket=vm.runInNewContext(expression,{...base,fixtureSocket:'/owned/socket'});assert.ok(socket.includes('max_connections=32')&&socket.includes('lock_timeout=0'));pass('actual constructor admission refuses ambient override and historical tmpfs argv stays unchanged');
}
console.log(JSON.stringify({suite:'ci-fresh-owned-disk-contracts',status:'PASS',checks:checks.length,Docker:false,database:false,resourceAllocation:false,scope:'actual source orchestration with synthetic filesystem/process/Docker ports; no actual disk-profile execution'}));
