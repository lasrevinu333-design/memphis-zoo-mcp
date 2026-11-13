import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,chmodSync,rmSync,rmdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {ORDERED_PSQL_SHELL,orderedSqlBatch,orderedPsqlFrames,parseOrderedPsqlReceipt,
 ABSENCE_GUARD,REMOVE_DEFAULT_GRANTS_SQL,RESTORE_DEFAULT_GRANTS_FILES} from './static-weekly-ordered-psql-transport.mjs';

let checks=0;
// performance.now() is measured from this Node process start, before imports.
const attemptStart=0;
const check=(fn)=>{fn();checks++;};
const name=n=>`2026100400000${n}_synthetic_${n}.sql`;
const entries=[
 {file:name(1),batch:Buffer.from("do $x$begin raise notice 'ñ'; end$x$;\n")},
 {file:name(2),batch:Buffer.from('select 2;\n-- exact footer\n')},
 {file:name(3),batch:Buffer.from('select 3;\n')},
];
const {input,manifest}=orderedPsqlFrames(entries);
check(()=>assert.equal(manifest.length,3));
check(()=>assert.ok(input.startsWith('FRAME 0 ')));
check(()=>assert.equal((ORDERED_PSQL_SHELL.match(/\bLC_ALL=/g)??[]).length,1));
check(()=>assert.match(ORDERED_PSQL_SHELL,/LC_ALL=C tr -d 'A-Za-z0-9\+\/=+'/));
const migrationsDir=fileURLToPath(new URL('../supabase/migrations/',import.meta.url));
const migrationFiles=readdirSync(migrationsDir).filter(file=>file.endsWith('.sql')).sort();
const full=orderedPsqlFrames(migrationFiles.map(file=>({file,batch:readFileSync(join(migrationsDir,file))})));
const guarded=orderedPsqlFrames(migrationFiles.map(file=>({file,batch:orderedSqlBatch({
 absenceGuard:ABSENCE_GUARD,bytes:readFileSync(join(migrationsDir,file)),
 restoreDefaultsSql:RESTORE_DEFAULT_GRANTS_FILES.has(file)?REMOVE_DEFAULT_GRANTS_SQL:''})})));
check(()=>assert.equal(full.manifest.length,219));
check(()=>assert.ok(Buffer.byteLength(full.input)<16*1024*1024));
check(()=>assert.equal(guarded.manifest.length,219));
check(()=>assert.ok(Buffer.byteLength(guarded.input)<16*1024*1024));
const runnerSource=readFileSync(new URL('./run-isolated-shift-end-tests.mjs',import.meta.url),'utf8');
const checkpointSource=readFileSync(new URL('./static-weekly-current-manager-owned-checkpoint.mjs',import.meta.url),'utf8');
check(()=>assert.match(runnerSource,/if\(ownedManager219Stage\)orderedEntries\.push/));
check(()=>assert.match(runnerSource,/else\{\s*try\{sql\(absenceGuard\+'\\n'\+bytes/));
check(()=>assert.match(runnerSource,/ORDERED_PSQL_SHELL,'replay',String\(orderedEntries\.length\)/));
check(()=>assert.match(runnerSource,/lastVerifiedFile:partial\?\.completed>0/));
check(()=>assert.match(runnerSource,/nextPendingFile:pendingIndex==null\?null/));
check(()=>assert.match(runnerSource,/sqlStartedForPendingFile:'UNPROVEN'/));
check(()=>assert.match(checkpointSource,/scripts\/static-weekly-ordered-psql-transport\.mjs/));
check(()=>assert.throws(()=>orderedPsqlFrames([entries[1],entries[0]]),/strict migration order/));
check(()=>assert.throws(()=>orderedPsqlFrames([entries[0],entries[0]]),/strict migration order/));
for(const file of migrationFiles){
 const bytes=readFileSync(join(migrationsDir,file));
 const guard='do $absence$begin null; end$absence$;',restore='alter default privileges revoke all;';
 const batch=orderedSqlBatch({absenceGuard:guard,bytes,restoreDefaultsSql:restore});
 check(()=>assert.deepEqual(batch,Buffer.from(guard+'\n'+bytes+'\n'+restore+'\n'+guard)));
}
const dir=mkdtempSync(join(tmpdir(),'mz-ordered-transport-test-'));
try{
 const fake=join(dir,'psql');
 writeFileSync(fake,`#!/bin/sh
set -eu
n=$(find "$FAKE_PSQL_DIR" -name 'input-*.sql' | wc -l)
cat > "$FAKE_PSQL_DIR/input-$n.sql"
printf '%s\n%s\n' "$LC_ALL" "$LANG" > "$FAKE_PSQL_DIR/locale-$n.txt"
printf 'private psql output\n'
if [ "$FAKE_PSQL_FAIL_INDEX" = "$n" ]; then printf 'private psql failure\n' >&2; exit 3; fi
`);
 chmodSync(fake,0o700);
 const run=(payload,failIndex)=>{
  for(const file of readdirSync(dir).filter(f=>/^(?:input-\d+\.sql|locale-\d+\.txt)$/.test(f)))rmSync(join(dir,file));
  const env={PATH:`${dir}:${process.env.PATH}`,FAKE_PSQL_DIR:dir,FAKE_PSQL_FAIL_INDEX:failIndex==null?'':String(failIndex),
   LC_ALL:'en_US.utf8',LANG:'en_GB.utf8'};
  try{return {stdout:execFileSync('sh',['-c',ORDERED_PSQL_SHELL,'replay',String(payload===guarded.input?219:3)],
   {input:payload,env,encoding:'utf8',timeout:30000,maxBuffer:64*1024}),failed:false};}
  catch(error){return {stdout:String(error.stdout??''),failed:true};}
 };
 let result=run(guarded.input);
 check(()=>assert.equal(result.failed,false));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,migrationFiles.map(file=>({file}))).completed,219));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,219));
 for(let i=0;i<migrationFiles.length;i++)check(()=>assert.equal(readFileSync(join(dir,`locale-${i}.txt`),'utf8'),
  'en_US.utf8\nen_GB.utf8\n'));
 for(let i=0;i<migrationFiles.length;i++)check(()=>assert.deepEqual(readFileSync(join(dir,`input-${i}.sql`)),
  orderedSqlBatch({absenceGuard:ABSENCE_GUARD,bytes:readFileSync(join(migrationsDir,migrationFiles[i])),
   restoreDefaultsSql:RESTORE_DEFAULT_GRANTS_FILES.has(migrationFiles[i])?REMOVE_DEFAULT_GRANTS_SQL:''})));
 result=run(input);
 check(()=>assert.equal(result.failed,false));
 const receipt=parseOrderedPsqlReceipt(result.stdout,entries);
 check(()=>assert.equal(receipt.completed,3));
 check(()=>assert.equal(receipt.envelopes.length,3));
 check(()=>assert.ok(receipt.envelopes.every(row=>row.envelopeMilliseconds>=0&&row.endTick>=row.beginTick)));
 check(()=>assert.ok(!result.stdout.includes('private psql output')));
 for(let i=0;i<3;i++)check(()=>assert.deepEqual(readFileSync(join(dir,`input-${i}.sql`)),entries[i].batch));
 result=run(input,1);
 check(()=>assert.equal(result.failed,true));
 const failed=parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true});
 check(()=>assert.deepEqual({completed:failed.completed,failed:failed.failed?.code,index:failed.failed?.index},{completed:1,failed:'PSQL_EXIT_3',index:1}));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,2));
 check(()=>assert.throws(()=>parseOrderedPsqlReceipt(result.stdout,entries),/failed channel|complete protocol/));
 result=run(input.replace(/FRAME 0 ([a-f0-9])/,(_all,c)=>`FRAME 0 ${c==='a'?'b':'a'}`));
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'HASH'));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,0));
 result=run(input.replace('FRAME 1 ','FRAME 7 '));
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'INDEX'));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,1));
 const firstHeader=/^FRAME 0 ([a-f0-9]{64}) (\d+)\n/.exec(input);
 check(()=>assert.ok(firstHeader));
 for(const [changedLength,expectedCode] of [[Number(firstHeader[2])-1,'SIZE'],[Number(firstHeader[2])+1,'SIZE'],[2097153,'LINES']]){
  result=run(input.replace(firstHeader[0],`FRAME 0 ${firstHeader[1]} ${changedLength}\n`));
  check(()=>assert.equal(result.failed,true));
  check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,expectedCode));
  check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,0));
 }
 const firstBody=entries[0].batch.toString('base64');
 result=run(input.replace(firstBody,'@'+firstBody.slice(1)));
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'BASE64'));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,0));
 for(const invalid of ['\0','\r',' ']){
  result=run(input.replace(firstBody,invalid+firstBody.slice(1)));
  check(()=>assert.equal(result.failed,true));
  check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'BASE64'));
  check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,0));
 }
 result=run(input.replace(firstBody,'='+firstBody.slice(1)));
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.ok(['DECODE','HASH'].includes(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code)));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,0));
 const failedTr=join(dir,'tr');
 writeFileSync(failedTr,'#!/bin/sh\nexit 42\n');chmodSync(failedTr,0o700);
 result=run(input);
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'ALPHABET_UTILITY'));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,0));
 rmSync(failedTr);
 result=run(input.replace(firstBody,firstBody.slice(0,3)+'\n'+firstBody.slice(4)));
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'BASE64'));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,0));
 result=run(input.slice(0,firstHeader[0].length+Math.floor(Number(firstHeader[2])/2)));
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'EOF'));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,0));
 result=run(input.slice(0,input.lastIndexOf('FRAME 2 ')));
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'COUNT'));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,2));
 result=run(input+input.slice(input.lastIndexOf('FRAME 2 ')).replace('FRAME 2 ','FRAME 3 '));
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'EXTRA'));
 check(()=>assert.equal(readdirSync(dir).filter(f=>/^input-\d+\.sql$/.test(f)).length,3));
 result=run(input.slice(0,input.lastIndexOf('\n'))+'\nFRAME 3');
 check(()=>assert.equal(result.failed,true));
 check(()=>assert.equal(parseOrderedPsqlReceipt(result.stdout,entries,{allowFailure:true}).failed?.code,'EXTRA'));
 check(()=>assert.throws(()=>orderedPsqlFrames([{file:'bad.sql',batch:Buffer.from('x')}]),/migration filename/));
 check(()=>assert.throws(()=>orderedPsqlFrames([{file:name(1),batch:Buffer.alloc(0)}]),/exact SQL batch/));
 check(()=>assert.throws(()=>parseOrderedPsqlReceipt('READY 1\nOK 0 1\nDONE 3 1\n',entries),/complete protocol|no extra protocol|ordered/));
 check(()=>assert.throws(()=>parseOrderedPsqlReceipt('READY 1\nBEGIN 0 2\nOK 0 1\nDONE 3 3\n',entries),/nonnegative file envelope/));
 check(()=>assert.throws(()=>parseOrderedPsqlReceipt('READY 1\nBEGIN 0 2\nOK 0 3\nDONE 3 4\nEXTRA\n',entries),/1 !== 3|no extra protocol/));
 const prefix='READY 1\nBEGIN 0 2\nOK 0 3\nBEGIN 1 4\n';
 const partial=parseOrderedPsqlReceipt(prefix+'O',entries,{allowFailure:true});
 check(()=>assert.deepEqual({completed:partial.completed,index:partial.incomplete?.index,truncated:partial.truncatedProtocolLine},
  {completed:1,index:1,truncated:true}));
 check(()=>assert.equal(partial.envelopes[0].index,0));
 check(()=>assert.throws(()=>parseOrderedPsqlReceipt(prefix+'O\n',entries,{allowFailure:true}),/no extra protocol output/));
 check(()=>assert.throws(()=>parseOrderedPsqlReceipt('REA',entries,{allowFailure:true}),/ready receipt/));
 check(()=>assert.equal(parseOrderedPsqlReceipt('READY 1\n',entries,{allowFailure:true}).completed,0));
 check(()=>assert.equal(parseOrderedPsqlReceipt('READY 1\nBEGIN 0 2\n',entries,{allowFailure:true}).incomplete?.index,0));
 check(()=>assert.equal(parseOrderedPsqlReceipt('READY 1\nBEGIN 0 2\nOK 0 3\n',entries,{allowFailure:true}).completed,1));
 check(()=>assert.equal(parseOrderedPsqlReceipt(prefix,entries,{allowFailure:true}).incomplete?.index,1));
 check(()=>assert.throws(()=>parseOrderedPsqlReceipt('READY 1\nINVALID\n',entries,{allowFailure:true}),/partial protocol only on error|no extra protocol output/));
 const beforeTemp=new Set(readdirSync('/tmp').filter(file=>file.startsWith('mz-ordered-psql.')));
 const child=spawn('sh',['-c',ORDERED_PSQL_SHELL,'replay','3'],{env:{PATH:`${dir}:${process.env.PATH}`},stdio:['pipe','pipe','pipe']});
 let signalOutput='',signalled=false;
 const signalExit=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('owned signal-test child did not close'));},2000);
  child.stdout.on('data',chunk=>{signalOutput+=chunk.toString();if(!signalled&&signalOutput.includes('READY ')){
   signalled=true;child.kill('SIGTERM');}});
  child.once('error',error=>{clearTimeout(timer);reject(error)});
  child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal})});
 });
 check(()=>assert.equal(signalled,true));
 check(()=>assert.ok(signalExit.code===143||signalExit.signal==='SIGTERM'));
 check(()=>assert.ok(!signalOutput.includes('DONE')));
 check(()=>assert.deepEqual(readdirSync('/tmp').filter(file=>file.startsWith('mz-ordered-psql.')&&!beforeTemp.has(file)),[]));
 if(process.argv.includes('--pinned-image')){
  const image='supabase/postgres@sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed';
  const remain=(reserve=0)=>Math.max(0,Math.floor(60000-reserve-(performance.now()-attemptStart)));
  const bounded=(limit,reserve=0)=>{const left=remain(reserve);assert.ok(left>0,'absolute utility deadline exhausted');return Math.min(limit,left);};
  check(()=>assert.ok(remain(10000)>0,'one 60-second utility attempt includes cleanup reserve'));
  const localImage=spawnSync('docker',['image','inspect',image,'--format','{{.Id}}'],
   {encoding:'utf8',timeout:bounded(5000,10000)});
  check(()=>assert.equal(localImage.status,0,'pinned image must already be local; no pull'));
  const imageId=localImage.stdout.trim();
  const bootstrap=String.raw`set -eu
mkdir /tmp/mz-fake-psql
printf '#!/bin/sh\ncat > /dev/null\n' > /tmp/mz-fake-psql/psql
chmod 700 /tmp/mz-fake-psql/psql
PATH=/tmp/mz-fake-psql:$PATH
export PATH
sh -c "$1" replay 3`;
  const runPinned=(payload,index)=>{
   const container=`mz_ordered_psql_utility_${process.pid}_${index}`;
   const label=`${process.pid}-${index}`;
   const cidFile=join(dir,`cid-${index}`);
   const before=execFileSync('docker',['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}'],
    {encoding:'utf8',timeout:bounded(5000,10000)}).trim();
   check(()=>assert.equal(before,'','refuse a preexisting container name'));
   const args=['run','-i','--rm','--network','none','--name',container,'--cidfile',cidFile,
    '--label',`mz.ordered.utility=${label}`,
    '--entrypoint','sh',image,
    '-c',bootstrap,'fake',ORDERED_PSQL_SHELL];
   let result,originalError=null,cleanupError=null;
   try{
    result=spawnSync('docker',args,{input:payload,encoding:'utf8',
     timeout:bounded(15000,10000),maxBuffer:128*1024});
   }catch(error){originalError=error;}
   finally{
    try{
     let leftover=execFileSync('docker',['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}'],
      {encoding:'utf8',timeout:bounded(5000)}).trim();
     if(leftover){
      assert.ok(existsSync(cidFile),'owned container ID must have been captured before cleanup');
      const expectedId=readFileSync(cidFile,'utf8').trim();
      const inspection=JSON.parse(execFileSync('docker',['inspect',container,'--format','{{json .}}'],
       {encoding:'utf8',timeout:bounded(5000)}));
      assert.equal(inspection.Id,expectedId,'exact created container ID');
      assert.equal(inspection.Name,`/${container}`,'exact created name');
      assert.equal(inspection.Image,imageId,'pinned image identity');
      assert.equal(inspection.Config?.Labels?.['mz.ordered.utility'],label,'owned utility label');
      assert.equal(inspection.HostConfig?.NetworkMode,'none','network-none container');
      execFileSync('docker',['stop','-t','0',container],{encoding:'utf8',timeout:bounded(5000)});
      leftover=execFileSync('docker',['ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}'],
       {encoding:'utf8',timeout:bounded(5000)}).trim();
     }
     check(()=>assert.equal(leftover,'','exact owned image utility container cleaned'));
    }catch(error){cleanupError=error;}
   }
   if(cleanupError)throw originalError?new AggregateError([originalError,cleanupError],'utility and cleanup failed'):cleanupError;
   if(originalError)throw originalError;
   check(()=>assert.equal(result.error,undefined,'bounded pinned-image command'));
   return result;
  };
  let pinned=runPinned(input,0);
  check(()=>assert.equal(pinned.status,0,`pinned valid protocol: ${pinned.stderr}`));
  check(()=>assert.equal(parseOrderedPsqlReceipt(pinned.stdout,entries).completed,3));
  pinned=runPinned(input.replace(firstBody,'\0'+firstBody.slice(1)),1);
  check(()=>assert.notEqual(pinned.status,0,'pinned NUL must fail'));
  check(()=>assert.equal(parseOrderedPsqlReceipt(pinned.stdout,entries,{allowFailure:true}).failed?.code,'BASE64'));
  check(()=>assert.ok(remain()>0,'one absolute utility attempt, including cleanup, stayed within 60 seconds'));
  console.log('PINNED_IMAGE_BUSYBOX_FAKE_PSQL_PASS',JSON.stringify({image,network:'none',cases:2}));
 }
}finally{
 for(const file of readdirSync(dir))rmSync(join(dir,file));
 rmdirSync(dir);
}
console.log('ORDERED_PSQL_TRANSPORT_FAKE_PASS',JSON.stringify({checks,migrations:full.manifest.length,
 channelBytes:Buffer.byteLength(guarded.input),rawMigrationChannelBytes:Buffer.byteLength(full.input),fakePsqlProcesses:219}));
