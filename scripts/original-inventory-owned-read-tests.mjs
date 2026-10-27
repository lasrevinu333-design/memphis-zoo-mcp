import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOriginalInventorySeparationStore} from '../src/original-inventory-separation-store.js';
import {createSameOriginalRecoveryManagerAuthenticator} from '../src/auth/same-original-recovery-manager-auth.js';
import {createInventoryManagerCompositionFixture} from './original-inventory-separation-manager-tests.mjs';

// Actual normal authenticator + fixed store, with explicitly synthetic signed
// manager/manifest/SQL rows and a recording RPC. No real manager, native ACK,
// writer fence, SQL execution or effect capability is fabricated by this test.
async function fixture(){
 const f=createInventoryManagerCompositionFixture({rpcFormat:'object'});
 const {req}=await f.invoke('preview');assert.equal(f.calls.length,2);f.calls.length=0;
 const {db,...dependencies}=f.dependencies;
 const auth=createSameOriginalRecoveryManagerAuthenticator(dependencies);
 const issuer=await auth.authenticateCurrentManager(req,{requireCsrf:true});
 const makeStore=()=>createOriginalInventorySeparationStore({db,inspectAuthenticatedIssuer:auth.inspectAuthenticatedIssuer});
 const store=makeStore();
 const read=()=>store.readVerifiedInventory({nativeRequestId:f.original.native_request_id,issuer});
 const command=(verifiedReview,selectedIssuer=issuer)=>({originalRequest:f.original,
  originalRequestUtf8:'\n '+JSON.stringify(f.original,null,2)+'\t',issuer:selectedIssuer,verifiedReview});
 return {f,auth,req,issuer,store,makeStore,read,command};
}
const cases=[];const test=(name,run)=>cases.push([name,run]);
const unavailable=error=>error.code==='original_inventory_separation_original_read_unavailable'&&error.retry_safe===false;
const used=error=>error.code==='original_inventory_separation_attempt_used'&&error.retry_safe===false;
const writers=f=>f.calls.filter(x=>x.name.endsWith('issue_v1'));

test('complete_same_owner_read_reaches_only_fixed_SQL_writer_once',async()=>{
 const x=await fixture(),review=await x.read(),command=x.command(review);
 const receipt=await x.store.issueOriginalInventoryApprovalOnce(command);
 assert.deepEqual(x.f.calls.map(x=>x.name),['custodial_original_inventory_separation_manifest_v1',
  'custodial_original_inventory_separation_review_v1','custodial_original_inventory_separation_issue_v1']);
 assert.equal(writers(x.f)[0].args.p_original_utf8,command.originalRequestUtf8);
 assert.equal(receipt.original_request_sha256,createHash('sha256').update(command.originalRequestUtf8).digest('hex'));
 assert.equal(receipt.limits.work_accepted,false);assert.equal(receipt.limits.replay_allowed,false);
 assert.equal(receipt.limits.key_removal,false);assert.equal(receipt.limits.phone_released,false);
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(command),used);
 assert.equal(writers(x.f).length,1);
});
test('detached_JSON_or_foreign_store_cannot_supply_original_read',async()=>{
 for(const substitute of ['clone','json','other-store','unread']){
  const x=await fixture(),review=await x.read();
  const selected=substitute==='clone'?structuredClone(review):substitute==='json'?JSON.parse(JSON.stringify(review)):
   substitute==='unread'?structuredClone(x.f.review):review;
  const store=substitute==='other-store'?x.makeStore():x.store;
  await assert.rejects(store.issueOriginalInventoryApprovalOnce(x.command(selected)),unavailable);
  assert.equal(writers(x.f).length,0);
 }
});
test('same_actor_new_issuer_cannot_borrow_or_reuse_original_read',async()=>{
 const x=await fixture(),review=await x.read();
 const second=await x.auth.authenticateCurrentManager(x.req,{requireCsrf:true});
 assert.deepEqual(second,x.issuer);assert.notEqual(second,x.issuer);
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(x.command(review,second)),unavailable);
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(x.command(review)),unavailable);
 assert.equal(writers(x.f).length,0);
});
test('changed_original_command_consumes_attempt_without_dispatch',async()=>{
 const x=await fixture(),review=await x.read(),command=x.command(review);
 const changed={...x.f.original,expected_review_sha256:'0'.repeat(64)};
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce({...command,originalRequest:changed,
  originalRequestUtf8:JSON.stringify(changed)}),e=>e.code==='original_inventory_separation_original_conflict');
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(command),used);
 assert.equal(writers(x.f).length,0);
});
test('lost_writer_reply_cannot_resend_but_exact_original_status_survives',async()=>{
 const x=await fixture(),review=await x.read(),command=x.command(review);
 x.f.after(name=>{if(name.endsWith('issue_v1'))throw Error('synthetic lost reply');});
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(command));
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(command),used);
 x.f.after(()=>{});x.f.missingSource();
 const count=x.f.calls.length,receipt=await x.store.readOriginalInventoryApproval(command);
 assert.deepEqual(x.f.calls.slice(count).map(x=>x.name),['custodial_original_inventory_separation_status_v1']);
 assert.equal(receipt.original_request_sha256,createHash('sha256').update(command.originalRequestUtf8).digest('hex'));
 assert.equal(writers(x.f).length,1);
});
test('original_read_expiry_during_writer_keeps_reply_unknown_and_no_resend',async()=>{
 const x=await fixture();
 x.f.source.observed_at=new Date().toISOString().replace('Z','000Z');
 x.f.source.current_until=new Date(Date.now()+300).toISOString().replace('Z','000Z');
 const review=await x.read(),command=x.command(review);
 x.f.after(async name=>{if(name.endsWith('issue_v1'))await new Promise(resolve=>setTimeout(resolve,500));});
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(command),unavailable);
 await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(command),used);
 assert.equal(writers(x.f).length,1);
});
test('wall_clock_rollback_cannot_extend_original_read_interval',async()=>{
 const x=await fixture();
 x.f.source.observed_at=new Date().toISOString().replace('Z','000Z');
 x.f.source.current_until=new Date(Date.now()+300).toISOString().replace('Z','000Z');
 const review=await x.read(),command=x.command(review),OriginalDate=globalThis.Date;
 await new Promise(resolve=>setTimeout(resolve,500));
 try{
  globalThis.Date=class extends OriginalDate {
   constructor(...args){super(...(args.length?args:[OriginalDate.now()-60000]));}
  };
  await assert.rejects(x.store.issueOriginalInventoryApprovalOnce(command),unavailable);
 }finally{globalThis.Date=OriginalDate;}
 assert.equal(writers(x.f).length,0);
});
for(const [name,run]of cases){await run();console.log('PASS '+name);}
console.log(JSON.stringify({executed_owned_read_cases:cases.length,sql:'NOT_RUN',native_ack:'NOT_RUN',
 genuine_manager:'NOT_RUN',resources:'CLOSED_RECORDING_FACILITY'}));
