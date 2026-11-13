// F08: genuine fresh304 PostgreSQL, PostgREST and ordinary Ops API session.
// No hosted service, employee enrollment, browser, release admission or provider call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import pg from 'pg';
import {createCiFreshOnlyFixture} from './ci-fresh-only-replay.mjs';
const root=resolve(new URL('..',import.meta.url).pathname);
assert.deepEqual(process.argv.slice(2,3),['--out']);assert.equal(process.argv.length,4);
const out=resolve(process.argv[3]);assert.equal(out,process.argv[3]);fs.mkdirSync(out,{mode:0o700});
const save=(name,value)=>fs.writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,...options});
const owner=randomUUID(),name='mz_schema_rebuild_f08_'+owner.replaceAll('-','');
const restName=name+'_rest',restImage='ghcr.io/supabase/postgrest@sha256:d2009b5c9deffc210c8a5592698472fede14fd9f6ca89823c8474ca54d58c012';
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
save('INTENT.json',{owner,name,restName,head,pid:process.pid,scope:'F08_FRESH304_REAL_API_AUTH_BOUNDARY_ONLY',production:false});
let fixture,pool,restId,api,proxy,apiExited=false,seed=null,closedPool=false,restRemoved=false,apiClosed=false,proxyClosed=false,verdict;
const freePort=()=>new Promise((accept,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):accept(port));});});
const apiPort=await freePort(),proxyPort=await freePort();
async function settled(child){if(child.exitCode!==null||child.signalCode!==null)return;await new Promise((accept,reject)=>{const t=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owned API did not settle after SIGTERM'));},5000);child.once('exit',()=>{clearTimeout(t);accept();});});}
async function waitHttp(url,predicate){for(let i=0;i<80;i++){if(api&&apiExited)throw Error('Owned API exited before readiness');try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(2000)});const body=await response.json();if(predicate(response,body))return body;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Owned loopback HTTP readiness did not settle');}
let failure;
try{
 assert.equal(fs.existsSync(join(root,'.env')),false,'Refuse ambient repository dotenv');
 fixture=await createCiFreshOnlyFixture({name,hostSocket:true,dataStorage:'owned-disk'});await fixture.assertOwned();
 assert.equal(fixture.receipt.selected_replay.migrations,304);save('CONSTRUCTION.json',fixture.receipt);
 const observed=JSON.parse(docker(['inspect','--format','{{json .}}',fixture.container]));
 assert.equal(observed.HostConfig.Memory,536870912);assert.equal(observed.HostConfig.MemorySwap,536870912);
 pool=new pg.Pool({host:fixture.socketDirectory,user:'supabase_admin',database:'postgres',max:1,connectionTimeoutMillis:5000});pool.on('error',()=>{});
 await pool.query("create role custodial_readonly_runtime_20991231 login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; alter role custodial_readonly_runtime_20991231 set default_transaction_read_only=on; alter role custodial_readonly_runtime_20991231 set statement_timeout='15s'; grant custodial_application_reader to custodial_readonly_runtime_20991231;");
 // The fresh-only constructor intentionally omits the external PostgREST login.
 const authenticator=(await pool.query("select rolcanlogin from pg_roles where rolname='authenticator'")).rows;
 assert.equal(authenticator.length,0,'This fresh-only API fixture must own its new transport login');
 await pool.query('create role authenticator login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant anon,authenticated,service_role to authenticator;');
 save('ISOLATED_TRANSPORT_SETUP.json',{newLoopbackOnlyAuthenticator:true,memberships:['anon','authenticated','service_role'],production:false});
 const auth=join(out,'auth');fs.mkdirSync(auth,{mode:0o700});const secret=randomBytes(32).toString('hex'),jwtSecret=randomBytes(32).toString('hex');
 const baseEnv={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',TZ:'America/Chicago',OPS_MANAGER_SESSION_SECRET:secret};
 const seeded=spawnSync(process.execPath,['scripts/create-isolated-rehearsal-manager-session.mjs',auth],{cwd:root,env:baseEnv,encoding:'utf8',timeout:10000});assert.equal(seeded.status,0,'Normal Ops fixture session creation failed');
 seed=join(auth,'dependency-manager-seed.sql');await pool.query(fs.readFileSync(seed,'utf8'));
 const jwtPart=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),unsigned=jwtPart({alg:'HS256',typ:'JWT'})+'.'+jwtPart({role:'service_role',exp:Math.floor(Date.now()/1000)+900});
 const jwt=unsigned+'.'+createHmac('sha256',jwtSecret).update(unsigned).digest('base64url');
 const inspected=spawnSync('docker',['image','inspect',restImage],{stdio:'ignore',timeout:30000});if(inspected.status!==0)docker(['pull',restImage],{timeout:180000});
 restId=docker(['run','-d','--name',restName,'--label','custodial.f08.owner='+owner,'--memory','128m','--memory-swap','128m','-p','127.0.0.1::3000','--mount','type=bind,source='+fixture.socketDirectory+',target=/custodial-fixture-socket',
  '-e','PGRST_DB_URI=postgresql://authenticator@/postgres?host=/custodial-fixture-socket','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET',restImage],{env:{...process.env,PGRST_JWT_SECRET:jwtSecret}}).trim();
 const rest=JSON.parse(docker(['inspect','--format','{{json .}}',restId]));assert.equal(rest.Config.Labels['custodial.f08.owner'],owner);
 const bindings=rest.NetworkSettings.Ports['3000/tcp'];assert.equal(bindings.length,1);assert.equal(bindings[0].HostIp,'127.0.0.1');const restUrl='http://127.0.0.1:'+bindings[0].HostPort;
 save('OWNED_RESOURCES.json',{postgres:fixture.container,rest:restId,restPort:bindings[0].HostPort,apiPort,owner});
 await waitHttp(restUrl+'/',response=>response.status===200);
 const proxyLog=fs.openSync(join(out,'REST_PREFIX_PROXY.log'),'wx',0o600);
 proxy=spawn(process.execPath,['scripts/supabase-rest-rehearsal-proxy.mjs'],{cwd:root,stdio:['ignore',proxyLog,proxyLog],env:{...baseEnv,REHEARSAL_POSTGREST_URL:restUrl,REHEARSAL_SUPABASE_REST_PROXY_PORT:String(proxyPort)}});fs.closeSync(proxyLog);
 save('PROXY_PROCESS.json',{pid:proxy.pid,loopbackPort:proxyPort});
 const supabaseUrl='http://127.0.0.1:'+proxyPort;
 await waitHttp(supabaseUrl+'/healthz',(response,body)=>response.status===200&&body.scope==='isolated_rehearsal_supabase_rest_prefix');

 const readerUrl='postgresql://custodial_readonly_runtime_20991231@localhost/postgres?host='+encodeURIComponent(fixture.socketDirectory);
 const parsed=new pg.Client({connectionString:readerUrl});assert.equal(parsed.connectionParameters.host,fixture.socketDirectory);
 const log=fs.openSync(join(out,'API.log'),'wx',0o600);
 api=spawn(process.execPath,['--max-old-space-size=384','src/index.js'],{cwd:root,stdio:['ignore',log,log],env:{...baseEnv,NODE_ENV:'production',PORT:String(apiPort),SUPABASE_URL:supabaseUrl,SUPABASE_SERVICE_ROLE_KEY:jwt,
  CUSTODIAL_READONLY_DATABASE_URL:readerUrl,CUSTODIAL_BACKEND_PROOF_SECRET:randomBytes(32).toString('hex'),CUSTODIAL_NATIVE_ROUTE_PROOF_SECRET:randomBytes(32).toString('hex'),DEVICE_CREDENTIAL_SECRET:randomBytes(32).toString('hex'),
  GITHUB_OWNER:'lasrevinu333-design',GITHUB_REPO:'memphis-zoo-mcp',GITHUB_BRANCH:'main',GITHUB_TOKEN:'isolated-no-account-access',EVENT_MAINTENANCE_SWEEP_MS:'0',FEEDBACK_REMINDER_SWEEP_MS:'0',OPERATIONAL_NOTIFICATION_SWEEP_MS:'0',CUSTODIAL_RESTORE_GATE_REQUIRED:'true'}});fs.closeSync(log);api.once('exit',()=>{apiExited=true;});
 save('API_PROCESS.json',{pid:api.pid,head,loopbackPort:apiPort});
 await waitHttp('http://127.0.0.1:'+apiPort+'/healthz',(response,body)=>response.status===200&&body.ok===true);
 const file=fs.openSync(join(out,'AUTH_BOUNDARY.log'),'wx',0o600);
 const proof=spawnSync('bash',['scripts/verify-isolated-rehearsal-backend-dependencies.sh','http://127.0.0.1:'+apiPort+'/health/dependencies',join(out,'PROTECTED_DEPENDENCIES.json'),fs.readFileSync(join(root,'supabase/canonical/schema-fingerprint.txt'),'utf8').trim(),join(auth,'dependency-manager-authorization.header')],{cwd:root,env:{...baseEnv,REHEARSAL_DEPENDENCY_MAX_ATTEMPTS:'3',REHEARSAL_DEPENDENCY_RETRY_DELAY_SECONDS:'0'},stdio:['ignore',file,file],timeout:30000});fs.closeSync(file);assert.equal(proof.status,0,'F08 real normal Ops API boundary qualification failed');
 const resources=JSON.parse(docker(['inspect','--format','{{json .}}',fixture.container]));assert.equal(resources.State.OOMKilled,false);const events=docker(['exec',fixture.container,'cat','/sys/fs/cgroup/memory.events']);assert.match(events,/oom 0\noom_kill 0/);save('RESOURCE_RESULT.json',{postgresMemory:resources.HostConfig.Memory,memoryEvents:events,postgrestMemory:rest.HostConfig.Memory});
 verdict={status:'PASS',head,actualFresh304:true,actualPostgrest:true,actualApi:true,ordinaryOpsManagerSession:true,maximumAccessLevel:'read_only',selfAssertedLeadershipNotSubstituted:true,protectedExpected503:true,missingAndMalformed401:true,publicExactMinimal503:true,production:false,fullCandidateAdmission:false,physicalProof:false};
}catch(error){failure=error;save('FAILURE.json',{message:error.message,code:error.code??null,head,production:false});}
finally{
 if(api){api.kill('SIGTERM');await settled(api);apiClosed=true;}
 if(proxy){proxy.kill('SIGTERM');await settled(proxy);proxyClosed=true;}
 if(restId){const r=JSON.parse(docker(['inspect','--format','{{json .}}',restId]));assert.equal(r.Config.Labels['custodial.f08.owner'],owner);docker(['stop','-t','3',restId]);docker(['rm',restId]);restRemoved=true;}
 if(pool){await pool.end();closedPool=true;}
 if(fixture)await fixture.cleanup();
 const auth=join(out,'auth');if(fs.existsSync(auth)){for(const file of fs.readdirSync(auth)){assert.ok(['dependency-manager-seed.sql','dependency-manager-authorization.header'].includes(file));fs.unlinkSync(join(auth,file));}fs.rmdirSync(auth);}
 save('CLEANUP.json',{apiClosed,proxyClosed,postgrestRemoved:restRemoved,poolClosed:closedPool,ownedFixtureCleanupReturned:!!fixture,privateFixtureSessionFilesRemoved:!fs.existsSync(auth)});
}
if(failure)throw failure;
assert.ok(apiClosed&&proxyClosed&&restRemoved&&closedPool);save('RESULT.json',{...verdict,cleanupReturned:true});
console.log('F08_FRESH304_GENUINE_POSTGREST_ORDINARY_OPS_API_BOUNDARY_PASS');
