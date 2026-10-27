import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {createOctoberDatedPostgresStore as afterStore} from '../src/static-weekly-dated-transition-postgres.js';
import {loadPreparedOctoberDatedPlan,createOctoberDatedMaterializationController as afterController} from '../src/static-weekly-dated-transition-materialization.js';
import {createDatedTransitionDatabaseFixture,MANAGER_ID} from './fixtures/dated-transition-transaction-fixture.mjs';
// Exact pre-correction bytes are retained. Rewire relative imports only for
// execution from this fixture directory; the original files are untouched.
async function baseline(name){const bytes=fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');const source=bytes.replace(/from '(\.\/[^']+)'/g,(_m,p)=>`from '${new URL('../src/'+p.slice(2),import.meta.url).href}'`);return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
const {createOctoberDatedPostgresStore:beforeStore}=await baseline('dated-postgres-before-web.txt');
const {loadPreparedOctoberDatedPlan:beforePlan,createOctoberDatedMaterializationController:beforeController}=await baseline('dated-materialization-before-web.txt');
const serialized=JSON.parse(fs.readFileSync(new URL('../config/custodial-october-dated-plan-20261001.json',import.meta.url),'utf8'));
const plan=loadPreparedOctoberDatedPlan(serialized),manager={managerId:MANAGER_ID};
const checks=[];const check=(name,fn)=>{fn();checks.push(name);};
function client(failure){const c=new EventEmitter();c.queries=[];c.released=[];c.query=async text=>{c.queries.push(text);if(failure)await failure(text,c);return {rows:[]};};c.release=e=>c.released.push(e);return c;}
const error=code=>Object.assign(Error('synthetic '+code),{code});
const database=c=>({async connect(){return c;}});
{
 const c=client(text=>{if(text==='commit')throw error('57P01');});
 await assert.rejects(()=>beforeStore({database:database(c),plan}).transaction(async()=>true),e=>e.code==='57P01');
 check('F1 reproduced: old 57P01 client returned without discard error',()=>assert.equal(c.released[0],undefined));
 check('F2 reproduced: old adapter acquires authority before any restore fence',()=>{assert.ok(c.queries.some(q=>q.includes('memphis')||q.includes('pg_advisory_xact_lock')));assert.ok(!c.queries.some(q=>q.includes('custodial_begin_application_mutation')));});
}
for(const code of ['57P01','08006','ECONNRESET']){
 const c=client(text=>{if(text==='commit')throw error(code);});
 await assert.rejects(()=>afterStore({database:database(c),plan}).transaction(async()=>true),e=>e.code==='dated_transition_database_adapter_unavailable'&&e.cause.code===code);
 check('broken checked-out client destroyed '+code,()=>{assert.equal(c.released[0].code,code);assert.equal(c.listenerCount('error'),0);assert.ok(c.queries.includes('rollback'));});
}
for(const code of ['ECONNREFUSED','57P03']){
 let work=false;await assert.rejects(()=>afterStore({database:{async connect(){throw error(code);}},plan}).transaction(async()=>{work=true;}),e=>e.code==='dated_transition_database_adapter_unavailable'&&e.cause.code===code);
 check('acquisition failure classified before any authority work '+code,()=>assert.equal(work,false));
}
{
 const c=client();await assert.rejects(()=>afterStore({database:database(c),plan}).transaction(async()=>{assert.equal(c.listenerCount('error'),1);c.emit('error',error('57P01'));return 'must not commit';}),/database_adapter_unavailable/);
 check('asynchronous checked-out error handled before commit',()=>{assert.ok(!c.queries.includes('commit'));assert.equal(c.released[0].code,'57P01');assert.equal(c.listenerCount('error'),0);});
}
{
 const c=client((text,c)=>{if(text==='commit')c.emit('error',error('08006'));});
 await assert.rejects(()=>afterStore({database:database(c),plan}).transaction(async()=>true),/database_adapter_unavailable/);
 check('connection loss during commit never produces success claim',()=>assert.equal(c.released[0].code,'08006'));
}
{
 const c=client(text=>{if(text==='rollback')throw error('EPIPE');});
 await assert.rejects(()=>afterStore({database:database(c),plan}).transaction(async()=>{throw Error('synthetic business failure');}),e=>e.code==='dated_transition_database_adapter_unavailable'&&e.cause.code==='EPIPE');
 check('rollback connection loss discards client',()=>assert.equal(c.released[0].code,'EPIPE'));
}
{
 const c=client();const result=await afterStore({database:database(c),plan}).transaction(async()=>true);
 check('healthy transaction fences before authority/source and returns reusable client',()=>{assert.equal(result,true);assert.ok(c.queries.indexOf('select public.custodial_begin_application_mutation()')<c.queries.findIndex(q=>q.includes('pg_advisory_xact_lock')));assert.equal(c.released[0],undefined);assert.equal(c.listenerCount('error'),0);});
}
async function scenario(factory,ownedPlan){const db=createDatedTransitionDatabaseFixture(ownedPlan),controller=factory({plan:ownedPlan,store:db.store});const p=await controller.preview({manager,expectedRevision:17});const request={manager,expectedRevision:17,idempotencyKey:'web-exact-key',previewDigest:p.previewDigest};const accepted=await controller.confirm(request);return {db,controller,request,accepted};}
{
 const s=await scenario(beforeController,beforePlan(serialized));s.db.change(d=>{d.rosterSlots[0].personId=MANAGER_ID;});
 await assert.rejects(()=>s.controller.confirm(s.request),/roster mismatch/);
 check('F3 reproduced: old exact receipt blocked by dependency drift',()=>assert.equal(s.db.inspect().receipts.length,1));
}
for(const [name,change] of [['incumbent drift',d=>{d.rosterSlots[0].personId=MANAGER_ID;}],['availability drift',d=>{d.approvedAvailability[0].availability=[];}],['authority revision drift',d=>{d.authorityRevision++;}]]){
 const s=await scenario(afterController,plan);s.db.change(change);const before=s.db.inspect();const retry=await s.controller.confirm(s.request);
 check('accepted exact retry survives '+name,()=>{assert.equal(retry.replayed,true);assert.equal(retry.publicationId,s.accepted.publicationId);assert.deepEqual(s.db.inspect(),before);});
 await assert.rejects(()=>s.controller.confirm({...s.request,expectedRevision:18}),/idempotency conflict/);checks.push('different request cannot reuse accepted key after '+name);
}
{
 const s=await scenario(afterController,plan);s.db.change(d=>{d.managers=[];});
 await assert.rejects(()=>s.controller.confirm(s.request),/manager_not_authorized/);checks.push('revoked manager cannot reconcile immutable receipt');
}
{
 const s=await scenario(afterController,plan);const rollback={manager,expectedRevision:18,idempotencyKey:'web-rollback',publicationId:s.accepted.publicationId,projectionId:s.accepted.projectionId};
 await s.controller.rollback(rollback);s.db.change(d=>{d.rosterSlots=[];d.authorityRevision++;});const before=s.db.inspect();
 const retry=await s.controller.confirm(s.request),rolled=await s.controller.rollback(rollback);
 check('accepted retry after rollback remains historical and append-free',()=>{assert.equal(retry.replayed,true);assert.equal(retry.effectivePublicationCurrent,false);assert.equal(rolled.replayed,true);assert.deepEqual(s.db.inspect(),before);});
}
const result={status:'PASS',checks:checks.length,checksPassed:checks,scope:'exact retained fail-before modules and bounded synthetic client/receipt regressions; actual PostgreSQL proof is separate',productionWritten:false};
if(process.env.DATED_WEB_EVIDENCE_DIR){fs.mkdirSync(process.env.DATED_WEB_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(process.env.DATED_WEB_EVIDENCE_DIR+'/authority-unit-results.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify(result));
