import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {isActiveNamedManager} from '../src/auth/manager-permissions.js';
const source=readFileSync(new URL('../src/memphis-ai.js',import.meta.url),'utf8'),start=source.indexOf('async function fetchResponderIdentity('),end=source.indexOf('\nasync function resolveEmployeeByLooseName',start);assert.ok(start>0&&end>start);
const id=n=>`a1010000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope=vm.createContext({isActiveNamedManager,esc:x=>String(x).replaceAll("'","''"),fetchDeviceIdentity:async()=>{throw Error('Cohort must never fall back to device/name authority');}});vm.runInContext(source.slice(start,end)+'\nglobalThis.resolve=fetchResponderIdentity;',scope);
const row={msg_user_id:id(1),user_active:true,ops_manager_id:null,custodial_cohort_manager_id:id(2),custodial_claimed_account_id:id(3)};
const actor={schema:'custodial.cohort-messenger-actor.v1',msg_user_id:id(1),source_message_id:id(4),role:'manager',owner:false,custodial_cohort_manager_id:id(2),custodial_claimed_account_id:id(3),identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false};
let passed=0;async function check(name,run){await run();passed++;console.log('PASS '+name);}
const resolve=({identity=row,current=actor,message=id(4)}={})=>scope.resolve(async sql=>sql.includes('msg_custodial_cohort_message_actor_v1')?[{actor:current}]:[identity],id(1),id(5),message);
await check('current durable cohort source yields manager operational scope without verified personal identity',async()=>{const r=await resolve();assert.equal(r.role,'manager');assert.equal(r.identity_assurance,'SELF_ASSERTED_NAME');assert.equal(r.individual_identity_verified,false);assert.equal(r.identity_source,'current_self_asserted_cohort_message');});
await check('no original source message never adopts selected-name or device role',async()=>{assert.equal(await resolve({message:''}),null);});
await check('revoked or stale private binding denies operational scope',async()=>{assert.equal(await resolve({current:null}),null);});
await check('wrong selected account, cohort, original message, user or owner cannot widen authority',async()=>{for(const [key,value]of Object.entries({custodial_claimed_account_id:id(9),custodial_cohort_manager_id:id(9),source_message_id:id(9),msg_user_id:id(9),owner:true,individual_identity_verified:true,identity_assurance:'VERIFIED_PERSONAL'}))assert.equal(await resolve({current:{...actor,[key]:value}}),null);});
await check('mixed verified named and cohort binding is refused',async()=>{assert.equal(await resolve({identity:{...row,ops_manager_id:id(9)}}),null);});
await check('valid named manager path remains supported separately',async()=>{const r=await resolve({identity:{msg_user_id:id(1),user_active:true,ops_manager_id:id(9),manager_id:id(9),display_name:'Synthetic verified manager',roles:['OPS_MANAGER'],active:true,revoked_at:null,is_system_principal:false}});assert.equal(r.role,'manager');assert.equal(r.identity_source,'current_named_manager_registry');});
console.log(JSON.stringify({status:'PASS',passed,scope:'Exact responder identity function, modeled read-only DB boundary; no model/provider'}));
