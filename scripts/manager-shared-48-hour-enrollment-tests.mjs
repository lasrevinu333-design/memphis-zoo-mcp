import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { createOpsManagerSession, installSharedAuthRoutes } from "../src/auth/shared-access-auth.js";

const env = {
  NODE_ENV: "production",
  RENDER: "1",
  OPS_MANAGER_SESSION_SECRET: "test-only-shared-48-hour-secret",
};
const allowedOrigin = "https://lasrevinu333-design.github.io";

function makeStore() {
  const eric = {
    manager_id: "00000000-0000-4000-8000-000000000001",
    display_name: "Eric",
    roles: ["OPS_MANAGER", "CUSTODIAL_MANAGER", "SECURITY_ADMIN"],
    active: true,
    revoked_at: null,
  };
  const sharedManager = {
    manager_id: randomUUID(),
    display_name: "Shared Ops Manager Enrollment",
    roles: ["OPS_MANAGER"],
    active: true,
    revoked_at: null,
  };
  const ordinaryManager = {
    manager_id: randomUUID(),
    display_name: "Ordinary Manager",
    roles: ["OPS_MANAGER"],
    active: true,
    revoked_at: null,
  };
  const ericCredential = randomUUID();
  const ordinaryCredential = randomUUID();
  const now = new Date();
  const devices = new Map([
    [ericCredential, {
      credential_id: ericCredential,
      device_id: "eric-existing-desktop",
      device_label: "Eric Desktop",
      token_hash: "a".repeat(64),
      max_access_level: "full_access",
      manager_id: eric.manager_id,
      manager: eric,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
      revoked_at: null,
    }],
    [ordinaryCredential, {
      credential_id: ordinaryCredential,
      device_id: "ordinary-existing-desktop",
      device_label: "Ordinary Desktop",
      token_hash: "b".repeat(64),
      max_access_level: "full_access",
      manager_id: ordinaryManager.manager_id,
      manager: ordinaryManager,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
      revoked_at: null,
    }],
  ]);
  const windows = [];
  const rateLimits = new Map();
  const events = [];

  const publicDevice = (row) => ({
    credential_id: row.credential_id,
    device_id: row.device_id,
    device_label: row.device_label,
    max_access_level: row.max_access_level,
    manager_id: row.manager_id,
    shared_enrollment_window_id: row.shared_enrollment_window_id || null,
    platform_summary: row.platform_summary || null,
    created_at: row.created_at,
    last_used_at: row.last_used_at || null,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at || null,
    revoked_reason: row.revoked_reason || null,
    active: !row.revoked_at && Date.parse(row.expires_at) > Date.now(),
  });
  const publicWindow = (row) => row ? {
    window_id: row.window_id,
    status: row.status === "active" && Date.parse(row.expires_at) <= Date.now() ? "expired" : row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    disabled_at: row.disabled_at || null,
    disabled_reason: row.disabled_reason || null,
    enrollment_count: row.enrollment_count,
    failed_attempt_count: row.failed_attempt_count,
    last_enrolled_at: row.last_enrolled_at || null,
    active: row.status === "active" && Date.parse(row.expires_at) > Date.now(),
  } : null;

  return {
    eric, sharedManager, ordinaryManager, ericCredential, ordinaryCredential,
    devices, windows, rateLimits, events,
    async find(id) { return devices.get(id) || null; },
    async touch(id) { const row=devices.get(id); if(row) row.last_used_at=new Date().toISOString(); },
    async audit(event) { events.push(event); },
    async listTrustedDevices() { return [...devices.values()].map(publicDevice); },
    async getSharedEnrollmentWindow() { return publicWindow(windows.at(-1)); },
    async createSharedEnrollmentWindow(record) {
      const active=windows.find((row)=>row.status==="active");
      if(active){active.status="replaced";active.disabled_at=new Date().toISOString();active.disabled_reason="replaced_by_new_window";}
      const createdAt=new Date();
      const row={window_id:randomUUID(),code_hash:record.code_hash,manager_id:sharedManager.manager_id,created_by_manager_id:record.created_by_manager_id,created_by_credential_id:record.created_by_credential_id,created_at:createdAt.toISOString(),expires_at:new Date(createdAt.getTime()+48*60*60*1000).toISOString(),status:"active",enrollment_count:0,failed_attempt_count:0,disabled_at:null};
      windows.push(row);
      return {ok:true,...publicWindow(row),replaced_window_id:active?.window_id||null};
    },
    async disableSharedEnrollmentWindow(windowId) {
      const row=windows.find((item)=>item.window_id===windowId);
      if(!row)return {ok:false,status:404};
      if(row.status==="active"){row.status="disabled";row.disabled_at=new Date().toISOString();row.disabled_reason="test_disable";}
      return {ok:true,...publicWindow(row)};
    },
    async consumeSharedEnrollmentWindow(record) {
      const row=windows.find((item)=>item.status==="active");
      if(!row)return {ok:false,status:401,reason:"inactive"};
      if(Date.parse(row.expires_at)<=Date.now()){row.status="expired";return {ok:false,status:401,reason:"expired"};}
      if(row.code_hash!==record.code_hash){row.failed_attempt_count+=1;return {ok:false,status:401,reason:"invalid"};}
      for(const device of devices.values())if(device.device_id===record.device_id&&!device.revoked_at){device.revoked_at=new Date().toISOString();device.revoked_reason="re_enrolled";}
      const device={credential_id:record.credential_id,device_id:record.device_id,device_label:record.device_label,token_hash:record.token_hash,max_access_level:"full_access",manager_id:sharedManager.manager_id,manager:sharedManager,shared_enrollment_window_id:row.window_id,platform_summary:record.platform_summary,created_at:new Date().toISOString(),expires_at:record.expires_at,revoked_at:null};
      devices.set(device.credential_id,device);row.enrollment_count+=1;row.last_enrolled_at=new Date().toISOString();
      return {ok:true,window_id:row.window_id,manager:sharedManager,trusted_device:publicDevice(device)};
    },
    async getSharedEnrollmentRateLimit(key) { return rateLimits.get(key)||null; },
    async recordSharedEnrollmentFailure(key,metadata={}) {
      const current=rateLimits.get(key);const count=Number(current?.failure_count||0)+1;const seconds=count>=5?900:Math.min(30,2**(count-1));
      const row={key_hash:key,failure_count:count,first_failed_at:current?.first_failed_at||new Date().toISOString(),last_failed_at:new Date().toISOString(),locked_until:new Date(Date.now()+seconds*1000).toISOString(),metadata_json:metadata};rateLimits.set(key,row);return row;
    },
    async clearSharedEnrollmentFailures(key) { rateLimits.delete(key); },
    async renameTrustedDevice(id,label) { const row=devices.get(id);if(!row)return null;row.device_label=label;return publicDevice(row); },
    async revoke(id,reason) { const row=devices.get(id);if(row&&!row.revoked_at){row.revoked_at=new Date().toISOString();row.revoked_reason=reason;} },
    async revokeAllExceptManager(managerId,reason) { const changed=[];for(const row of devices.values())if(row.manager_id!==managerId&&!row.revoked_at){row.revoked_at=new Date().toISOString();row.revoked_reason=reason;changed.push(publicDevice(row));}return changed; },
  };
}

const store=makeStore();
const app=express();
app.use(express.json({limit:"64kb"}));
installSharedAuthRoutes(app,{env,trustedDeviceStore:store,setCors(){}});
const server=app.listen(0,"127.0.0.1");
await new Promise((resolve)=>server.once("listening",resolve));
const base=`http://127.0.0.1:${server.address().port}`;

const ericToken=createOpsManagerSession({credentialId:store.ericCredential,deviceId:"eric-existing-desktop",manager:store.eric,accessLevel:"full_access",env}).token;
const ordinaryToken=createOpsManagerSession({credentialId:store.ordinaryCredential,deviceId:"ordinary-existing-desktop",manager:store.ordinaryManager,accessLevel:"full_access",env}).token;
const adminHeaders={authorization:`Bearer ${ericToken}`,origin:allowedOrigin,"content-type":"application/json","user-agent":"Desktop Chrome","x-device-id":"eric-existing-desktop"};

async function json(path,{method="GET",headers={},body}={}){
  const response=await fetch(`${base}${path}`,{method,headers,body:body===undefined||/^(GET|HEAD)$/i.test(method)?undefined:JSON.stringify(body),redirect:"manual"});
  return {response,payload:await response.json()};
}

try{
  let result=await json("/auth-api/ops/shared-enrollment",{method:"POST",headers:{...adminHeaders,authorization:`Bearer ${ordinaryToken}`,"x-device-id":"ordinary-existing-desktop"},body:{role:"CUSTODIAL_MANAGER"}});
  assert.equal(result.response.status,403,"ordinary OPS_MANAGER cannot generate the shared passcode");

  result=await json("/auth-api/ops/shared-enrollment",{method:"POST",headers:adminHeaders,body:{role:"SECURITY_ADMIN",ttl_seconds:999999}});
  assert.equal(result.response.status,200);
  const firstCode=result.payload.data.passcode;
  const firstWindowId=result.payload.data.window_id;
  assert.match(firstCode,/^\d{8}$/);
  assert.match(result.payload.data.display_passcode,/^\d{4} \d{4}$/);
  assert.equal(Date.parse(result.payload.data.expires_at)-Date.parse(result.payload.data.created_at),48*60*60*1000,"lifetime must be exactly 48 hours");
  assert.equal(JSON.stringify(store.windows).includes(firstCode),false,"plaintext must not be persisted");

  const enroll=async(deviceId,label,userAgent="Desktop Chrome",code=firstCode)=>json("/auth-api/ops/shared-enrollment/consume",{method:"POST",headers:{origin:allowedOrigin,"content-type":"application/json","user-agent":userAgent,"x-device-id":deviceId,"x-device-label":label},body:{code,device_id:deviceId,device_label:label,role:"CUSTODIAL_MANAGER"}});
  const desktop=await enroll("disposable-desktop","Disposable Desktop");
  const phone=await enroll("disposable-phone","Disposable Phone","Android Chrome",`${firstCode.slice(0,4)} ${firstCode.slice(4)}`);
  assert.equal(desktop.response.status,200);
  assert.equal(phone.response.status,200,"same active passcode must enroll a second device");
  assert.deepEqual(desktop.payload.data.session.roles,["OPS_MANAGER"],"browser cannot choose its role");
  assert.deepEqual(phone.payload.data.session.roles,["OPS_MANAGER"]);
  const desktopCookie=desktop.response.headers.get("set-cookie");
  assert.match(desktopCookie,/memphis_ops_trust=.*HttpOnly.*SameSite=None.*Secure/);
  assert.notEqual(desktop.payload.data.trusted_device.credential_id,phone.payload.data.trusted_device.credential_id);

  result=await json("/auth-api/session?access_level=full_access",{headers:{origin:allowedOrigin,cookie:desktopCookie,"x-device-id":"disposable-desktop"}});
  assert.equal(result.response.status,200,"trusted desktop must reopen without a passcode");
  assert.deepEqual(result.payload.data.session.roles,["OPS_MANAGER"]);

  result=await json("/auth-api/ops/shared-enrollment",{headers:adminHeaders});
  assert.equal(result.response.status,200);
  assert.equal(result.payload.data.enrollment_window.enrollment_count,2);
  assert.equal(result.payload.data.devices.length,2);
  assert.equal(JSON.stringify(result.payload).includes(firstCode),false,"status endpoint cannot retrieve plaintext");

  result=await json("/auth-api/ops/shared-enrollment",{method:"POST",headers:adminHeaders,body:{}});
  assert.equal(result.response.status,200);
  const replacementCode=result.payload.data.passcode;
  assert.notEqual(replacementCode,firstCode);
  assert.equal(store.windows.find((row)=>row.window_id===firstWindowId).status,"replaced");
  result=await enroll("old-code-browser","Old Code", "Desktop Edge",firstCode);
  assert.equal(result.response.status,401,"replacement invalidates old passcode");
  store.rateLimits.clear();
  result=await enroll("replacement-browser","Replacement Browser","Desktop Edge",replacementCode);
  assert.equal(result.response.status,200);

  const replacementWindowId=result.payload.data.trusted_device.shared_enrollment_window_id;
  result=await json(`/auth-api/ops/shared-enrollment/${replacementWindowId}/disable`,{method:"POST",headers:adminHeaders,body:{reason:"acceptance_complete"}});
  assert.equal(result.response.status,200);
  store.rateLimits.clear();
  result=await enroll("disabled-window-browser","Disabled","Desktop Chrome",replacementCode);
  assert.equal(result.response.status,401,"disabled passcode must fail");

  for(const legacy of ["/auth-api/ops/pairing/consume","/auth-api/ops/manager-codes/consume","/auth-api/ops/managers"]){
    result=await json(legacy,{method:legacy.endsWith("managers")?"GET":"POST",headers:adminHeaders,body:{}});
    assert.equal(result.response.status,410,`${legacy} must be retired`);
  }

  result=await json("/auth-api/ops/shared-enrollment/consume",{method:"POST",headers:{origin:"https://evil.example","content-type":"application/json","x-device-id":"wrong-origin"},body:{code:replacementCode}});
  assert.equal(result.response.status,403);

  const desktopCredential=desktop.payload.data.trusted_device.credential_id;
  result=await json(`/auth-api/ops/trusted-devices/${desktopCredential}/revoke`,{method:"POST",headers:adminHeaders,body:{reason:"test_revoke"}});
  assert.equal(result.response.status,200);
  result=await json("/auth-api/session?access_level=full_access",{headers:{origin:allowedOrigin,cookie:desktopCookie,"x-device-id":"disposable-desktop"}});
  assert.equal(result.response.status,401,"revoked device must lose access on next request");

  result=await json("/auth-api/ops/trusted-devices/revoke-all",{method:"POST",headers:adminHeaders,body:{reason:"test_non_eric_revoke_all"}});
  assert.equal(result.response.status,200);
  assert.equal(store.devices.get(store.ericCredential).revoked_at,null,"Eric existing desktop must remain trusted");
  assert.equal(store.devices.get(store.ordinaryCredential).revoked_at!==null,true);

  assert.equal(store.events.some((event)=>JSON.stringify(event).includes(firstCode)||JSON.stringify(event).includes(replacementCode)),false,"audit events cannot contain plaintext passcodes");
  console.log("MANAGER_SHARED_48_HOUR_HTTP_INTEGRATION_PASS");
} finally {
  await new Promise((resolve,reject)=>server.close((error)=>error?reject(error):resolve()));
}
