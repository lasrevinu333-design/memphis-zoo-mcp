import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const container=`mz_recorder_test_${process.pid}`;
const socket=mkdtempSync(join(tmpdir(),'mz-recorder-socket-'));
chmodSync(socket,0o1777);
const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
let owned=false;
console.log(JSON.stringify({owned_container:container,owned_socket:socket,image,cleanup:'exact container and temporary socket in finally',network:'none',production:false}));
try {
  docker(['image','inspect',image]);
  docker(['run','--rm','-d','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,size=512m',
    '--mount',`type=bind,source=${socket},target=/var/run/postgresql`,'-e','POSTGRES_PASSWORD=postgres',image]);
  owned=true;
  let ready=0;
  for(let i=0;i<60&&ready<4;i++){
    try{docker(['exec','-e','PGPASSWORD=postgres',container,'psql','-X','-At','-U','supabase_admin','-d','postgres','-c','select 1']);ready++;}catch{ready=0;}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal(ready,4,'isolated database must become ready within 30 seconds');
  const child=spawn(process.execPath,['scripts/production-release-recorder-database-tests.mjs'],{stdio:'inherit',
    env:{...process.env,RECORDER_TEST_CONTAINER:container,RECORDER_TEST_SOCKET:socket},timeout:120000});
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  assert.equal(result.signal,null);
  process.exitCode=result.code||0;
} finally {
  if(owned){
    // The image changes ownership of its socket directory. Restore ownership of
    // only this task-owned mount before removing the container and its sockets.
    try{docker(['exec','-u','0',container,'chown','-R',`${process.getuid()}:${process.getgid()}`,'/var/run/postgresql']);}
    finally{docker(['rm','-f',container]);}
  }
  assert.equal(docker(['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}']).trim(),'');
  rmSync(socket,{recursive:true,force:true});
  console.log('ISOLATED_RECORDER_RESOURCES_REMOVED',container,socket);
}
