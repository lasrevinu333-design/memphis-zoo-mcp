import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { IMAGE, stageArchivedStorageObjects, uploadArchivedStorageObject } from './run-official-local-storage-rehearsal.mjs';

const pgImage = 'supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const hash = value => createHash('sha256').update(value).digest('hex');
function jwt(secret, role, sub) {
  const data = {role, aud:'authenticated', exp: Math.floor(Date.now()/1000) + 300, ...(sub && {sub})};
  const payload = [{alg:'HS256',typ:'JWT'}, data].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}

// This process runs inside the same isolated namespace as the official HTTP server.
// Schema/metadata inputs are synthetic. FileBackend and the serving DB/API are real.
async function readback() {
  assert.equal(process.env.STORAGE_FILE_BACKEND_PATH, '/owned-files');
  assert.equal(process.env.DATABASE_URL, 'postgres://postgres@127.0.0.1:5432/postgres');
  const require = createRequire('/app/package.json');
  const {Client} = require('pg');
  const {FileBackend} = require('/app/dist/storage/backend/file.js');
  const {TenantLocation} = require('/app/dist/storage/locator.js');
  const db = new Client({connectionString:process.env.DATABASE_URL});
  const bucket = 'custodial-equal-content';
  const root = mkdtempSync('/tmp/equal-staging-');
  const originals = [], records = [], sourceBytes = new Map();
  await db.connect();
  try {
    await db.query("insert into storage.buckets(id,name,public) values ($1,$1,false)",[bucket]);
    await db.query("create policy fixture_owner_read on storage.objects for select to authenticated using (owner_id = current_setting('request.jwt.claims',true)::jsonb->>'sub')");
    for (let i = 0; i < 4; i++) {
      const id = randomUUID(), owner = randomUUID(), version = randomUUID();
      const name = 'group/object-' + i, bytes = Buffer.from(i < 2 ? '' : 'same object body');
      const metadata = {size:bytes.length, mimetype:'text/plain', cacheControl:'max-age=' + (60+i)};
      const user_metadata = {tag:'fixture-' + i};
      const original = {id, bucket_id:bucket, name, owner, owner_id:owner, version, metadata, user_metadata};
      await db.query('insert into storage.objects(id,bucket_id,name,owner,owner_id,version,metadata,user_metadata) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id,bucket,name,owner,owner,version,metadata,user_metadata]);
      originals.push(original);
      records.push({object_id:id,bucket_id:bucket,name,owner,owner_id:owner,sha256:hash(bytes),size_bytes:bytes.length});
      sourceBytes.set(id,bytes);
    }
    const staged = await stageArchivedStorageObjects({inventory:{objectRecords:records},objectsRows:originals,
      readBlob: id => ({blob:new Blob([sourceBytes.get(id)])}),mount:root});
    assert.equal(staged.length, 4);
    assert.deepEqual(readdirSync(root).sort(), [...new Set(records.map(row=>row.sha256))].sort());
    assert.equal(readdirSync(root).length, 2);
    const backend = new FileBackend(), locator = new TenantLocation(process.env.GLOBAL_S3_BUCKET);
    const outputs = [];
    for (const object of staged) {
      await uploadArchivedStorageObject({object,bytes:readFileSync(join(root,object.file)),backend,locator,
        bucket:process.env.GLOBAL_S3_BUCKET,tenant:process.env.TENANT_ID});
    }
    for (const [i, original] of originals.entries()) {
      const {rows} = await db.query('select id,bucket_id,name,owner,owner_id,version,metadata,user_metadata from storage.objects where id=$1 and bucket_id=$2 and name=$3',
        [original.id,bucket,original.name]);
      assert.deepEqual(rows, [original]);
      const target = 'http://127.0.0.1:5000/object/authenticated/' + bucket + '/' + original.name;
      for (const token of [process.env.SERVICE_KEY, jwt(process.env.AUTH_JWT_SECRET,'authenticated',original.owner)]) {
        const response = await fetch(target,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
        assert.equal(response.status,200,'readback '+i+' HTTP '+response.status);
        assert.equal(response.headers.get('cache-control'), original.metadata.cacheControl);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), sourceBytes.get(original.id));
      }
      const foreign = originals[(i+1) % originals.length].owner;
      const denied = await fetch(target,{headers:{Authorization:'Bearer '+jwt(process.env.AUTH_JWT_SECRET,'authenticated',foreign)},signal:AbortSignal.timeout(5000)});
      const detail = await denied.json();
      assert([400,403,404].includes(denied.status) && /not.?found|unauthorized|denied/i.test(JSON.stringify(detail)), 'another owner read the object or received an unrelated error');
      outputs.push({id:original.id,name:original.name,owner:original.owner,version:original.version,
        metadata:original.metadata,user_metadata:original.user_metadata,sha256:records[i].sha256,owner_http:200,service_http:200,other_owner_http:denied.status});
    }
    console.log(JSON.stringify({staged_paths:2,unique_objects:outputs.length,objects:outputs}));
  } finally { await db.end(); }
}

async function runFixture() {
  const docker = (...args) => execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:90000}).trim();
  const root = dirname(fileURLToPath(import.meta.url));
  const secret = randomBytes(32).toString('hex');
  const containers=[];
  function create(...args) {
    const id=docker('create','--pull=never',...args);
    assert.match(id,/^[a-f0-9]{64}$/);
    containers.push(id);
    docker('start',id);
    return id;
  }
  async function ready(id, check) {
    for(let i=0;i<120;i++) {
      if(docker('inspect','--format','{{.State.Running}}',id)!=='true') break;
      try {if(check()) return;} catch{}
      await pause(250);
    }
    throw Error('Disposable provider startup failed: '+docker('logs','--tail','6',id).replaceAll(secret,'[redacted]').slice(-2000));
  }
  try {
    const pg = create('--network','none','--read-only','--user','100:101','--tmpfs','/fixture:rw,mode=0700,uid=100,gid=101',
      '--tmpfs','/tmp:rw,mode=1777','--memory','800m','--pids-limit','96','--entrypoint','/bin/sh',pgImage,'-ec',
      'initdb -D /fixture/db -U postgres -A trust --no-locale --encoding=UTF8 >/dev/null; exec postgres -D /fixture/db -k /fixture -c listen_addresses=127.0.0.1 -c shared_preload_libraries=');
    await ready(pg,()=>docker('exec',pg,'pg_isready','-U','postgres','-h','/fixture').includes('accepting connections'));
    docker('exec',pg,'psql','-v','ON_ERROR_STOP=1','-h','/fixture','-U','postgres','-c','create role supabase_storage_admin login;');
    const files=['equal-content-storage-provider-tests.mjs','run-official-local-storage-rehearsal.mjs','immutable-private-stage-diagnostic.mjs'];
    const config={DATABASE_URL:'postgres://postgres@127.0.0.1:5432/postgres',AUTH_JWT_SECRET:secret,SERVICE_KEY:jwt(secret,'service_role'),ANON_KEY:jwt(secret,'anon'),
      TENANT_ID:'fixture',PROJECT_REF:'fixture',GLOBAL_S3_BUCKET:'stub',STORAGE_BACKEND:'file',STORAGE_FILE_BACKEND_PATH:'/owned-files',
      DB_INSTALL_ROLES:'true',DATABASE_MAX_CONNECTIONS:'8',PG_QUEUE_ENABLE:'false',IMAGE_TRANSFORMATION_ENABLED:'false',PORT:'5000'};
    const storage=create('--network','container:'+pg,'--read-only','--memory','512m','--pids-limit','128',
      '--tmpfs','/tmp:rw,size=32m','--tmpfs','/owned-files:rw,size=16m',
      ...files.flatMap(name=>['--mount','type=bind,src='+join(root,name)+',dst=/case/'+name+',readonly']),
      ...Object.entries(config).flatMap(([k,v])=>['--env',k+'='+v]),IMAGE);
    await ready(storage,()=>{docker('exec',storage,'node','-e',"fetch('http://127.0.0.1:5000/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))");return true;});
    console.log(docker('exec',storage,'node','/case/equal-content-storage-provider-tests.mjs','--inside'));
  } finally {
    for (const id of containers.reverse()) {
      docker('rm','--force','--volumes',id);
      assert.throws(()=>docker('inspect',id), error=>/No such (object|container)/i.test(error.stderr));
    }
    console.log('Verified removal of '+containers.length+' isolated test containers.');
  }
}
try {
  if(process.argv[2]==='--inside') await readback();
  else { assert.equal(process.argv.length,2);await runFixture(); }
} catch(error) {
  console.error(error.stderr && error.stderr.length ? error.stderr.slice(-1600) : error.message);process.exitCode=1;
}
