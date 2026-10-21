import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,unlinkSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {CURRENT_MESSAGE_SOURCE_PINS,currentCanonicalMessageProfile} from './fixtures/employee-message-current-source.mjs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {messageDeletedSourceMutation} from './employee-message-source-admission-database-tests.mjs';
import {readMessagePreparePredecessor} from './fixtures/employee-message-prepare-predecessor.mjs';
import {assertMessageManifest,readMessageSource,assertMessageTarget,compareMessageDelta,cleanupMessageTarget,
 MESSAGE_FILE,MESSAGE_SHA,MESSAGE_MANIFEST,MESSAGE_IDENTITY,PREPARE_PRIOR,PREPARE_CURRENT,PREPARE_GRANT} from './employee-message-source-admission-replay.mjs';

// Pure/fake-only. This never launches Docker or supplies engine acceptance.
const hash=x=>createHash('sha256').update(x).digest('hex'),clone=x=>structuredClone(x);
let checks=0;
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const rejects=fn=>{assert.throws(fn);checks++;};
const source=readMessageSource(undefined,{profile:'CURRENT_CANONICAL_289'});
const frozenBytes=readFileSync(new URL('./fixtures/native-provider-event-decision-historical-source-models.json',import.meta.url));
equal(hash(frozenBytes),'30e660c3f708e1d1ca0f64547eaffcfbbca99059630b314361ae9797dc55cb0d');
const frozen=JSON.parse(frozenBytes).models.CURRENT_219;
equal(frozen.source_commit,'53848431fd55b215affeb4663f233acffb506597');equal(frozen.rows_sha256,MESSAGE_MANIFEST);equal(hash(JSON.stringify(frozen.rows)),MESSAGE_MANIFEST);
const historicalMigrations=frozen.rows;assertMessageManifest(historicalMigrations);equal(historicalMigrations.length,219);
equal(source.migrations.length,289);equal(source.canonical_manifest_sha256,'e5867270c2509b986708caf32109956bedf0703363dcc1d775f1737f502c5c68');equal(source.manifest_sha256,'fe4617a721731b9601b399193eaa67c904d4197efe9af506a575d2d01a1696b8');
equal(source.migrations.filter(x=>x.file===MESSAGE_FILE),[{file:MESSAGE_FILE,sha256:MESSAGE_SHA}]);
for(const mutate of [
 rows=>rows.pop(),rows=>rows.push(clone(rows[0])),rows=>rows.reverse(),rows=>{rows[30].sha256='a'.repeat(64);},
 rows=>{rows.find(x=>x.file===MESSAGE_FILE).sha256='b'.repeat(64);},
 rows=>{rows.find(x=>x.file===MESSAGE_FILE).file='20261004000100_employee_message_source_admission.sql';},
 rows=>{rows.at(-1).sha256='f'.repeat(64);},rows=>{rows[30].unexpected=true;},
]){const rows=clone(historicalMigrations);mutate(rows);rejects(()=>assertMessageManifest(rows));}
const fixtureId='00000000-0000-4000-8000-000000000001';
const target={id:'a'.repeat(64),fixture_id:fixtureId,name:'mz_schema_message_'+fixtureId.replaceAll('-','')};
const observed={Id:target.id,Name:'/'+target.name,Image:'sha256:fbf77524fc188126c1775fd2d2e54040bde295438a3e6f07936f3c39e6f688ed',
 State:{Running:true},HostConfig:{NetworkMode:'none',PortBindings:{}},NetworkSettings:{Ports:{}},
 Config:{Labels:{'custodial.owner':'employee-message-source-admission','custodial.synthetic':'true','custodial.fixture-id':fixtureId}},
 Mounts:[{Type:'tmpfs',Destination:'/var/lib/postgresql/data',Source:'tmpfs',RW:true}]};
equal(assertMessageTarget(observed,target),target);
for(const mutate of [x=>{x.Id='b'.repeat(64);},x=>{x.Name='/foreign';},x=>{x.Image='unpinned';},x=>{x.State.Running=false;},
 x=>{x.HostConfig.NetworkMode='bridge';},x=>{x.HostConfig.PortBindings={'5432/tcp':[{}]};},
 x=>{x.NetworkSettings.Ports={'5432/tcp':[{HostPort:'5432'}]};},x=>{x.Config.Labels['custodial.owner']='foreign';},
 x=>{x.Config.Labels['custodial.synthetic']='false';},x=>{x.Config.Labels['custodial.fixture-id']='foreign';},
 x=>{x.Mounts[0].Type='bind';},x=>{x.Mounts[0].Source='/private';},x=>{x.Mounts.push(clone(x.Mounts[0]));},
]){const row=clone(observed);mutate(row);rejects(()=>assertMessageTarget(row,target));}
rejects(()=>assertMessageTarget(observed,{...target,name:'arbitrary'}));
const stopped=clone(observed);stopped.State.Running=false;equal(assertMessageTarget(stopped,target,{allowStopped:true}),target);

const canonical=JSON.parse(readFileSync(new URL('../supabase/canonical/schema-fingerprint-input.json',import.meta.url)));
const deletedConstraint=canonical.constraints.find(x=>x.table_name==='msg_messages'&&x.constraint_name==='msg_messages_deletion_state_chk');
equal(deletedConstraint.definition,"CHECK (is_deleted IS FALSE AND deleted_at IS NULL AND purge_after IS NULL OR is_deleted IS TRUE AND deleted_at IS NOT NULL AND purge_after = (deleted_at + '14 days'::interval))");
const deletionSource=readFileSync(new URL('../supabase/migrations/20260718184652_messenger_delete_retention_shared_identity.sql',import.meta.url),'utf8');
assert.ok(deletionSource.includes("(is_deleted is true and deleted_at is not null and purge_after = deleted_at + interval '14 days')"));checks++;
const messageId='71000000-0000-4000-8000-000000000007';
equal(messageDeletedSourceMutation(messageId),`update public.msg_messages set is_deleted=true,deleted_at=now(),purge_after=now()+interval '14 days' where id='${messageId}'`);
rejects(()=>messageDeletedSourceMutation("bad'; drop table public.msg_messages;"));
// Source-level truth table for this exact existing CHECK, not SQL execution.
const validDeletedRow=({deleted,at,purge})=>deleted===false&&at===null&&purge===null
 ||deleted===true&&Number.isFinite(at)&&Number.isFinite(purge)&&purge===at+14*86400000;
equal(validDeletedRow({deleted:true,at:null,purge:null}),false,'actual fail-before fixture state violates the owning CHECK');
const at=Date.parse('2026-10-03T00:00:00Z');
equal(validDeletedRow({deleted:true,at,purge:at+14*86400000}),true,'coherent fixture required fields');
for(const row of [{deleted:true,at,purge:at+13*86400000},{deleted:true,at,purge:null},{deleted:false,at,purge:at+14*86400000}])equal(validDeletedRow(row),false);
const predecessor=readMessagePreparePredecessor();
const beforeDefinition=predecessor.prior;
equal(hash(beforeDefinition),PREPARE_PRIOR);
const migration=readFileSync(new URL('../supabase/migrations/'+MESSAGE_FILE,import.meta.url),'utf8');
const oldDecl=migration.match(/ old_decl text:='([^']*)';/)[1],oldInsert=migration.match(/ old_insert text:='([^']*)';/)[1];
const oldReturn=migration.match(/ old_return text:=\$old\$([\s\S]*?)\$old\$;/)[1];
const addition=migration.match(/ addition text:=\$message\$([\s\S]*?)\$message\$;/)[1];
const newReturn=migration.match(/\$new\$([\s\S]*?)\$new\$\);/)[1];
const afterDefinition=beforeDefinition.replace(oldDecl,oldDecl+' v_message_projection jsonb;').replace(oldInsert,addition+oldInsert).replace(oldReturn,newReturn);
equal(hash(afterDefinition),PREPARE_CURRENT);
equal(afterDefinition,predecessor.current);
const grant=`select public.custodial_release_authority_reset_grants('${MESSAGE_IDENTITY}'); grant execute on function ${MESSAGE_IDENTITY} to postgres; grant execute on function ${MESSAGE_IDENTITY} to service_role;`;
equal(hash(grant),PREPARE_GRANT);
equal(grant,predecessor.grant);
const row=(kind,sql,order)=>({inventory_id:'00000000-0000-4000-8000-'+String(order).padStart(12,'0'),object_kind:kind,
 object_identity:MESSAGE_IDENTITY,restore_order:order,definition_sql:sql,definition_sha256:hash(sql),captured_at:'2026-10-03T11:00:00.000000Z'});
const before={inventory:[row('function',beforeDefinition,100116),row('grant',grant,1000137)],
 surface:[{object_kind:'function',object_identity:MESSAGE_IDENTITY,purpose:'employee push dispatch preparation'}],live:{function:beforeDefinition,grant}};
const after=clone(before);after.inventory[0]={...after.inventory[0],definition_sql:afterDefinition,definition_sha256:hash(afterDefinition),captured_at:'2026-10-03T11:01:00.000000Z'};after.live.function=afterDefinition;
equal(compareMessageDelta(before,after).changed.length,1);
for(const mutate of [x=>x.inventory.pop(),x=>x.inventory.push(clone(x.inventory[0])),x=>{x.inventory[0].restore_order++;},
 x=>{x.inventory[0].inventory_id='other';},x=>{x.inventory[0].captured_at='bad';},x=>{x.inventory[0].captured_at='2026-10-02T00:00:00Z';},
 x=>{x.inventory[0].definition_sha256='0'.repeat(64);},x=>{x.inventory[0].definition_sql+=' ';x.inventory[0].definition_sha256=hash(x.inventory[0].definition_sql);},
 x=>{x.inventory[1].captured_at='2026-10-03T11:01:00Z';},x=>{x.inventory[1].definition_sql+=' ';x.inventory[1].definition_sha256=hash(x.inventory[1].definition_sql);},
 x=>x.surface.push({object_kind:'grant',object_identity:MESSAGE_IDENTITY,purpose:'new unauthorized member'}),
 x=>{x.surface[0].purpose='changed';},x=>{x.live.function=beforeDefinition;},x=>{x.live.grant+=' ';},
]){const changed=clone(after);mutate(changed);rejects(()=>compareMessageDelta(before,changed));}
const missingBefore=clone(before);missingBefore.inventory[0].object_identity='public.'+MESSAGE_IDENTITY;rejects(()=>compareMessageDelta(missingBefore,after));

// Exercise real cleanup boundary with explicit fake subprocess transcripts.
const cleanupFake=(row,remaining='')=>{const calls=[];return {calls,docker(args){calls.push(args);if(args[0]==='inspect')return JSON.stringify([row]);if(args[0]==='rm')return target.id+'\n';if(args[0]==='ps')return remaining;throw Error('unexpected');}};};
const good=cleanupFake(stopped);equal(cleanupMessageTarget(good.docker,target).no_owned_container,true);
equal(good.calls,[['inspect',target.id],['rm','-f',target.id],['ps','-a','--filter','id='+target.id,'--format','{{.ID}}']]);
const ambiguous=cleanupFake(stopped);equal(cleanupMessageTarget(ambiguous.docker,{...target,id:null}).target.id,target.id);equal(ambiguous.calls[0],['inspect',target.name]);
const foreign=clone(stopped);foreign.Config.Labels['custodial.owner']='foreign';const bad=cleanupFake(foreign);
rejects(()=>cleanupMessageTarget(bad.docker,target));equal(bad.calls.length,1,'no remove after failed custody');
rejects(()=>cleanupMessageTarget(cleanupFake(stopped,target.id).docker,target));
equal(cleanupMessageTarget(()=>{throw Object.assign(Error('missing'),{stderr:'Error: No such object: owned'});},target),{removed:false,no_owned_container:true});
rejects(()=>cleanupMessageTarget(()=>{throw Object.assign(Error('denied'),{stderr:'permission denied'});},target));
rejects(()=>cleanupMessageTarget(()=>'{malformed',target));

const text=readFileSync(new URL('./employee-message-source-admission-replay.mjs',import.meta.url),'utf8');
for(const required of ["assert.equal(git('status','--porcelain'),'','clean committed source required')","'--pull','never','--network','none'",
 'assertMessageTarget(rows[0],target)',"'-v','VERBOSITY=terse','-U','supabase_admin'",'timeout:60000',
 'set statement_timeout=30000;set lock_timeout=5000;',"{flag:'wx',mode:0o600}","finally{cleanup();",
 "process.once('SIGINT',stop)","process.once('SIGTERM',stop)",'verifyEmployeeMessageSourceAdmissionDatabase({sql,target:',
 '4f2cac31af750c5bc10a50445583b27ae2c6e67b0f66fe72c078b53c533d00db']){assert.ok(text.includes(required),required);checks++;}
// Real Node CLI preflight, explicitly SOURCE ONLY. No --execute call anywhere.
const cli=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./employee-message-source-admission-replay.mjs',import.meta.url)),'--source-check-current'],{encoding:'utf8',timeout:10000}));
equal(cli.scope,'SOURCE_ONLY_NO_ENGINE');equal(cli.migration_profile,'CURRENT_CANONICAL_289');equal(cli.manifest_sha256,source.manifest_sha256);equal(cli.canonical_manifest_sha256,source.canonical_manifest_sha256);equal(cli.migrations,source.migrations);equal(cli.message_boundary,source.message_boundary);
equal(source.inputs.length,23);equal(Object.fromEntries(source.inputs.slice(0,-1).map(row=>[row.file,row.sha256])),CURRENT_MESSAGE_SOURCE_PINS);
equal(currentCanonicalMessageProfile(source.migrations).message_boundary,{file:MESSAGE_FILE,sha256:MESSAGE_SHA,predecessor_count:209,predecessor_manifest_sha256:'f070f410e8c02c35a2d37780e6c2165975e731e50bf63a5bf0bd3ca6341480a9',following_migrations:79,following_manifest_sha256:'ff36e204a9169145903e92fa948e9195f51743d9c248ca4fd2f59b386f1a5ace'});
rejects(()=>assertMessageManifest(source.migrations));rejects(()=>currentCanonicalMessageProfile(historicalMigrations));
for(const profile of [null,'','AUTO','CURRENT_219',289,{}])rejects(()=>readMessageSource(undefined,{profile}));
for(const mutate of [rows=>rows.pop(),rows=>rows.push(clone(rows[0])),rows=>rows.reverse(),rows=>rows.sort((a,b)=>a.file.localeCompare(b.file)),
 rows=>{rows[0].sha256='0'.repeat(64);},rows=>{rows[209].sha256='0'.repeat(64);},rows=>{rows[288].sha256='0'.repeat(64);},rows=>{rows[210]={...rows[211]};},rows=>{rows[209].extra=true;}]){
 const rows=clone(source.migrations);mutate(rows);rejects(()=>currentCanonicalMessageProfile(rows));
}
assert.ok(text.includes("assert.equal(process.argv[2],'--execute');await execute(process.argv[3])"));checks++;
assert.ok(text.includes("const source=readMessageSource(),git="));checks++;
// Actual maintained canonical reader and all Source pins, fresh owned copies.
const privateSource=mkdtempSync(join(tmpdir(),'custodial-message-source-contract-'));
try{
 const root=fileURLToPath(new URL('../',import.meta.url));
 for(const file of ['supabase/canonical/migration-replay-order.json',...source.migrations.map(row=>'supabase/migrations/'+row.file),...source.inputs.map(row=>row.file)]){
  mkdirSync(dirname(join(privateSource,file)),{recursive:true});copyFileSync(join(root,file),join(privateSource,file));
 }
 equal(readMessageSource(privateSource,{profile:'CURRENT_CANONICAL_289'}),source);
 const corrupt=(file,mutate)=>{const path=join(privateSource,file),bytes=readFileSync(path);try{mutate(path,bytes);rejects(()=>readMessageSource(privateSource,{profile:'CURRENT_CANONICAL_289'}));}finally{try{unlinkSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}writeFileSync(path,bytes,{flag:'wx'});}};
 corrupt('supabase/canonical/migration-replay-order.json',(path,bytes)=>writeFileSync(path,Buffer.concat([bytes,Buffer.from('\n')])));
 corrupt('supabase/migrations/'+MESSAGE_FILE,path=>unlinkSync(path));
 corrupt('supabase/migrations/'+source.migrations.at(-1).file,(path,bytes)=>writeFileSync(path,Buffer.concat([bytes,Buffer.from('\n')])));
 corrupt('supabase/migrations/'+MESSAGE_FILE,path=>{unlinkSync(path);symlinkSync(join(root,'supabase/migrations',MESSAGE_FILE),path);});
 for(const file of ['src/employee-notifications.js','scripts/fixtures/employee-message-prepare-predecessor.json','scripts/native-provider-event-decisions-database-tests.mjs','scripts/fixtures/native-provider-event-decision-current-source.mjs'])
  corrupt(file,(path,bytes)=>writeFileSync(path,Buffer.concat([bytes,Buffer.from('\n')])));
 const extra=join(privateSource,'supabase/migrations/20261022000000_unowned.sql');writeFileSync(extra,'-- test-only unowned Source\n',{flag:'wx'});try{rejects(()=>readMessageSource(privateSource,{profile:'CURRENT_CANONICAL_289'}));}finally{unlinkSync(extra);}
 equal(readMessageSource(privateSource,{profile:'CURRENT_CANONICAL_289'}),source);
}finally{rmSync(privateSource,{recursive:true});}
console.log(JSON.stringify({status:'PASS',checks,scope:'fake subprocess and source/manifest/delta/cleanup contracts only; no Docker/SQL/HTTP/JVM/provider',engine_executed:false}));
