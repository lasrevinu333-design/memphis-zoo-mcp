import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createGeneralJsonMiddleware} from '../src/request-json-parser.js';
import {positionArguments,phoneLocations,installAssignedPhoneLocationRoutes,PHONE_LOCATION_CONTRACT as schema} from '../src/assigned-phone-location.js';
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-11-11T17:00:00.000Z');
const body={schema,employee_id:id(1),assignment_epoch:4,sample_id:id(2),observed_at:new Date(now-1000).toISOString(),latitude:35.15,longitude:-89.99,accuracy_m:8};
const request=()=>({body:structuredClone(body),memphisDeviceAuth:{credentialed:true},memphisDevice:{canonical_device_pk:id(3),assigned_employee_id:id(1),assignment_epoch:4},memphisDeviceCredential:{credential_id:id(4)}});
const row={device_id:'SYNTHETIC_PHONE',employee_id:id(1),employee_name:'Synthetic employee',assignment_epoch:4,sample_id:id(2),observed_at:body.observed_at,received_at:new Date(now).toISOString(),latitude:35.15,longitude:-89.99,accuracy_m:8};
test('no cleaning session is needed; authenticated device controls write identity',()=>{
 const args=positionArguments(request(),now);assert.equal(args.p_device_id,id(3));assert.equal(args.p_credential_id,id(4));assert.ok(!Object.keys(args).some(k=>/session|location_code/.test(k)));
 for(const patch of [{employee_id:id(9)},{assignment_epoch:3},{device_id:id(9)},{sample_id:'fake'},{observed_at:'now'},{observed_at:'2026-02-30T17:00:00.000Z'},{observed_at:new Date(now+1).toISOString()},{latitude:NaN},{latitude:91},{accuracy_m:0},{longitude:'-89'}]){const req=request();Object.assign(req.body,patch);assert.throws(()=>positionArguments(req,now));}
 for(const auth of [{credentialed:false},{credentialed:true,offline_recovery_only:true}]){const req=request();req.memphisDeviceAuth=auth;assert.throws(()=>positionArguments(req,now));}
});
test('capture age, not receipt time or session, decides live versus stale',()=>{
 assert.equal(phoneLocations([row],now)[0].state,'live');
 const stale=phoneLocations([{...row,observed_at:new Date(now-120001).toISOString()}],now)[0];assert.equal(stale.state,'stale');assert.equal(stale.position.latitude,35.15);
 assert.equal(phoneLocations([{...row,sample_id:null,latitude:null}],now)[0].state,'unavailable');
 for(const patch of [{observed_at:new Date(now+1).toISOString()},{latitude:Infinity},{accuracy_m:0},{received_at:null}]){assert.equal(phoneLocations([{...row,...patch}],now)[0].position,null);}
 assert.throws(()=>phoneLocations([row,row],now));
});
test('actual HTTP parser preserves signed bytes; anonymous/public cannot read; authority changes withhold response',async()=>{
 const app=express();app.use(createGeneralJsonMiddleware());let writes=0,verifyBytes=null,change=false;
 const manager={role:'ops_manager',manager_id:id(5),credential_id:id(6),device_id:'manager',permissions:{schema:'custodial.manager-permissions.v1',read:true}};
 let activeReq;
 installAssignedPhoneLocationRoutes(app,{now:()=>now,
  parseJson:express.json({verify(req,res,bytes){req.scanAuthorityRawBody=Buffer.from(bytes);}}),
  requireDevice(req,res,next){Object.assign(req,{...request(),body:req.body});next();},
  requireManager(req,res,next){if(req.headers['x-synthetic-manager']==='yes')req.memphisAuth={...manager};activeReq=req;next();},
  rateLimit(req,res,next){next();},verifyNative(req){verifyBytes=req.scanAuthorityRawBody;assert.ok(Buffer.isBuffer(verifyBytes));},
  async runRpc(fn,args){if(fn==='custodial_record_phone_position'){writes++;return {ok:true,sample_id:args.p_sample_id};}if(change)activeReq.memphisAuth.manager_id=id(7);return [row];}
 });
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const raw=JSON.stringify(body,null,2),post=await fetch(base+'/scan-api/phone-position',{method:'POST',headers:{'content-type':'application/json'},body:raw});assert.equal(post.status,200);assert.equal(verifyBytes.toString(),raw);assert.equal(writes,1);
  assert.equal((await fetch(base+'/dashboard-api/phone-locations')).status,403);
  assert.equal((await fetch(base+'/viewer-api/phone-locations')).status,404);
  const result=await fetch(base+'/dashboard-api/phone-locations',{headers:{'x-synthetic-manager':'yes'}});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal((await result.json()).data.phones[0].state,'live');
  assert.equal((await fetch(base+'/dashboard-api/phone-locations?employee_id='+id(9),{headers:{'x-synthetic-manager':'yes'}})).status,422);
  change=true;assert.equal((await fetch(base+'/dashboard-api/phone-locations',{headers:{'x-synthetic-manager':'yes'}})).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
