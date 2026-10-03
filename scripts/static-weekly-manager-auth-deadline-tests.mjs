import assert from 'node:assert/strict';
import {createOpsManagerSession,makeOpsAccessMiddleware} from '../src/auth/shared-access-auth.js';

const env={NODE_ENV:'test',OPS_MANAGER_SESSION_SECRET:'static-weekly-manager-auth-deadline-synthetic-secret'};
const manager={manager_id:'10000000-0000-4000-8000-000000000091',display_name:'Synthetic Manager',roles:['OPS_MANAGER'],active:true};
const credentialId='manager-auth-deadline-credential',deviceId='manager-auth-deadline-device';
const token=createOpsManagerSession({credentialId,deviceId,manager,authMode:'trusted_device',accessLevel:'full_access',maximumAccessLevel:'full_access',env}).token;
const row={credential_id:credentialId,device_id:deviceId,max_access_level:'full_access',manager_id:manager.manager_id,manager,
 created_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60_000).toISOString(),revoked_at:null};
let checks=0;
const same=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
function fixture(find){
 const controller=new AbortController(),req={header:name=>name==='authorization'?`Bearer ${token}`:'',
  staticWeeklyManagerOperation:{signal:controller.signal}},res={headersSent:false,writableEnded:false,statusCode:200,body:null,
  status(code){this.statusCode=code;return this;},json(value){this.body=value;this.headersSent=true;this.writableEnded=true;return this;}};
 let nextCount=0;
 const middleware=makeOpsAccessMiddleware({env,requireWrite:true,trustedDeviceStore:{find},
  requireTrustedDeviceStore:true,requireCurrentManagerAssociation:true,
  operationSignalForRequest:request=>request.staticWeeklyManagerOperation?.signal});
 return{controller,req,res,invoke:()=>middleware(req,res,()=>{nextCount++;}),get nextCount(){return nextCount;}};
}
{
 let release;const wait=new Promise(resolve=>{release=resolve;});
 const f=fixture(()=>wait),pending=f.invoke();await Promise.resolve();
 f.controller.abort(new Error('synthetic ingress expiry'));await pending;
 same(f.res.statusCode,503,'stalled current-device lookup fails at request deadline');
 same(f.res.body.code,'static_weekly_recurring_operation_deadline_exceeded','auth deadline has typed failure');
 same(f.nextCount,0,'expired auth never reaches named manager or product handler');
 release(row);await Promise.resolve();await Promise.resolve();
 same(f.nextCount,0,'late valid store row cannot resurrect a timed-out request');
 same(f.req.memphisAuth,undefined,'late store row cannot install manager identity after timeout');
}
{
 let finds=0;const f=fixture(()=>{finds++;return row;});f.controller.abort(new Error('expired before auth'));
 await f.invoke();same(finds,0,'already expired request never starts the store lookup');
 same(f.nextCount,0,'already expired request cannot reach protected route');
}
{
 const f=fixture(async()=>row);await f.invoke();same(f.nextCount,1,'valid current manager still proceeds');
 same(f.req.memphisAuth.manager_id,manager.manager_id,'authenticated actor identity unchanged');
}
console.log(JSON.stringify({status:'PASS',checks,scope:'read-only manager auth cancellation before protected handler; no HTTP/DB/solver'}));
