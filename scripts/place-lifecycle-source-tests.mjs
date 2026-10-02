import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {authoritativePlaceCommand,applyPlaceCommand,readPlacePreview} from '../src/place-lifecycle.js';
const manager=randomUUID(),place=randomUUID();
const input={request_id:randomUUID(),place_id:place,expected_revision:0,action:'add',payload:{canonical_code:'EVENT_ONLY_TEST',display_name:'Event Only',event_eligible:true},reason:'Synthetic source test'};
const args=authoritativePlaceCommand({memphisAuth:{manager_id:manager}},input);
assert.equal(args.p_manager,manager);assert.equal(args.p_effective_at,null);
assert.throws(()=>authoritativePlaceCommand({memphisAuth:{manager_id:manager}},{...input,manager_id:randomUUID()}));
assert.throws(()=>authoritativePlaceCommand({},input));
assert.throws(()=>authoritativePlaceCommand({memphisAuth:{manager_id:manager}},{...input,payload:{...input.payload,nfc_url:'invented'}}));
assert.throws(()=>authoritativePlaceCommand({memphisAuth:{manager_id:manager}},{...input,payload:{...input.payload,event_eligible:'true'}}));
const calls=[];const client={rpc:async(name,body)=>{
 calls.push({name,body});if(name==='custodial_begin_application_mutation_lease')return {data:{mutations_paused:false,authority_generation:1}};
 if(name==='custodial_release_application_mutation_lease')return {data:true};return {data:{place_id:place,revision:1}};
}};
assert.equal((await applyPlaceCommand({memphisAuth:{manager_id:manager}},input,{client})).place_id,place);
assert.deepEqual(calls.map(c=>c.name),['custodial_begin_application_mutation_lease','custodial_place_command','custodial_release_application_mutation_lease']);
assert.deepEqual(calls[1].body,args);
const paused=[];
await assert.rejects(()=>applyPlaceCommand({memphisAuth:{manager_id:manager}},input,{client:{rpc:async(name)=>{
 paused.push(name);return {data:{mutations_paused:true,authority_generation:1}};
}}}),/restore mutation lease response is invalid/);
assert.deepEqual(paused,['custodial_begin_application_mutation_lease']);
const reads=[];
assert.equal((await readPlacePreview({memphisAuth:{manager_id:manager}},{},{client:{rpc:async(name,args)=>{
 reads.push({name,args});return {data:{places:[]}};
}}})).places.length,0);
assert.deepEqual(reads,[{name:'custodial_place_preview',args:{p_manager:manager}}]);
await assert.rejects(()=>readPlacePreview({memphisAuth:{manager_id:manager}},{manager_id:randomUUID()},{client}));
console.log('PLACE_LIFECYCLE_SOURCE_PASS (strict input, server-derived manager, restore lease; no runtime route)');
