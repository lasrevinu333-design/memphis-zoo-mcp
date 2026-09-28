import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {authenticateSeparationContextRequest,authenticateDeviceCredentialRequest,deviceCredentialInternals,installDeviceCredentialRoutes} from '../src/auth/device-credential-auth.js';
const id=n=>`96000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const secret='synthetic-original-credential-secret-0123456789',env={DEVICE_CREDENTIAL_SECRET:'synthetic-separation-store-secret-0123456789'},now=new Date('2026-09-27T08:00:00.000Z');
const device={canonical_device_pk:id(1),canonical_device_id:'KIOSK_08',device_id:'KIOSK_08',requested_device_id:'KIOSK_08',device_active:true,
 assigned_employee_id:id(2),employee_code:'EMP901',employee_active:false,assignment_epoch:7,assignment_valid:true};
const credential={credential_id:id(3),device_id:id(1),token_hash:deviceCredentialInternals.tokenHash(secret,env),confirmed_at:'2026-09-20T00:00:00Z',
 expires_at:'2026-09-26T00:00:00Z',revoked_at:null,metadata_json:deviceCredentialInternals.deviceCredentialSecretMetadata(env)};
const context={schema:'custodial.separation-context.v1',purpose:'SEPARATION_STATUS_ONLY',state:'PENDING_RECONCILIATION',separation_id:id(4),authority_revision:12,
 employee_id:id(2),device_id:id(1),canonical_device_id:'KIOSK_08',credential_id:id(3),assignment_epoch:7,cutoff_at:'2026-09-24T13:42:00.123456Z',
 native_inventory_state:'UNKNOWN',server_known_open_sessions:[],new_work_allowed:false,phone_released:false};
function fixture(){
 const f={device:structuredClone(device),credential:structuredClone(credential),context:structuredClone(context),contextReads:0,touches:0};
 const path='/device-auth/separation-context?device_id=KIOSK_08',stamp=now.toISOString(),version='custodial-native-request.v1',requestId=id(5),hash=createHash('sha256').update(Buffer.alloc(0)).digest('hex');
 const signature=createHmac('sha256',secret).update([version,id(3),'KIOSK_08','GET',path,hash,requestId,stamp,'custodial'].join('\n')).digest('hex');
 f.req={method:'GET',originalUrl:path,query:{device_id:'KIOSK_08'},body:{},headers:{authorization:'Device '+id(3)+'.'+secret,'x-device-id':'KIOSK_08',
  'x-memphis-native-attestation-version':version,'x-memphis-native-request-id':requestId,'x-memphis-native-request-timestamp':stamp,
  'x-memphis-app-edition':'custodial','x-memphis-native-request-attestation':signature}};
 f.store={findCredential:async()=>f.credential,getPolicy:async()=>({mode:'observe'}),touchCredential:async()=>{f.touches++;},audit:async()=>{}};
 f.runReadOnlySql=async sql=>{if(sql.includes('custodial_v13_read_separation_context')){f.contextReads++;return[{context:f.context}];}return[f.device];};
 f.options={env,store:f.store,runReadOnlySql:f.runReadOnlySql,now};return f;
}
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack});}}
await test('original token/native proof returns exact lossless status only without credential touch',async()=>{const f=fixture(),r=await authenticateSeparationContextRequest(f.req,f.options);
 assert.equal(r.ok,true);assert.equal(r.separation_recovery_only,true);assert.deepEqual(r.context,context);assert.equal(f.touches,0);assert.equal(f.contextReads,1);});
for(const [name,mutate] of [
 ['wrong route',f=>f.req.originalUrl='/device-auth/status'],['wrong method',f=>f.req.method='POST'],
 ['missing token',f=>delete f.req.headers.authorization],['cookie-only missing native proof',f=>{f.req.headers.cookie='memphis_device_credential='+id(3)+'.'+secret;delete f.req.headers.authorization;delete f.req.headers['x-memphis-native-request-attestation'];}],
 ['wrong token',f=>f.req.headers.authorization='Device '+id(3)+'.'+'x'.repeat(40)],['wrong credential',f=>f.credential.credential_id=id(8)],
 ['revoked',f=>f.credential.revoked_at=now.toISOString()],['not confirmed',f=>f.credential.confirmed_at=null],
 ['wrong key generation',f=>f.credential.metadata_json.credential_secret_key_id='a'.repeat(64)],
 ['wrong credential device',f=>f.credential.device_id=id(8)],['active employee',f=>f.device.employee_active=true],
 ['inactive phone',f=>f.device.device_active=false],['missing employee',f=>f.device.assigned_employee_id=null],
 ['manager device',f=>f.device.canonical_device_id='MANAGER_01'],['invalid epoch',f=>f.device.assignment_epoch=1.5],
 ['native proof missing',f=>delete f.req.headers['x-memphis-native-request-attestation']],['native body modified',f=>f.req.scanAuthorityRawBody=Buffer.from('changed')],
 ['native path changed',f=>f.req.originalUrl+='&changed=true'],['native timestamp stale',f=>f.options.now=new Date(now.getTime()+300000)],
 ['native wrong edition',f=>f.req.headers['x-memphis-app-edition']='infrastructure'],
])await test('denied before private context read: '+name,async()=>{const f=fixture();mutate(f);let denied=false;try{denied=(await authenticateSeparationContextRequest(f.req,f.options)).ok===false;}catch(e){denied=e.status===403;}
 assert.equal(denied,true);assert.equal(f.contextReads,0);assert.equal(f.touches,0);});
for(const [field,value] of [['employee_id',id(8)],['credential_id',id(8)],['device_id',id(8)],['canonical_device_id','KIOSK_09'],['assignment_epoch',8],
 ['new_work_allowed',true],['phone_released',true],['authority_revision','12'],['cutoff_at',new Date()],['cutoff_at','2026-09-24T13:42:00.123Z'],['native_inventory_state','EMPTY'],['server_known_open_sessions',null],['purpose','NEW_WORK'],['state','FINALIZED']])
 await test('context mismatch '+field+' '+String(value),async()=>{const f=fixture();f.context[field]=value;assert.equal((await authenticateSeparationContextRequest(f.req,f.options)).ok,false);});
await test('unknown historical original context denied not backfilled',async()=>{const f=fixture();f.context=null;assert.equal((await authenticateSeparationContextRequest(f.req,f.options)).ok,false);});
await test('ordinary auth remains denied even in observe mode',async()=>{const f=fixture();assert.equal((await authenticateDeviceCredentialRequest(f.req,f.options)).ok,false);assert.equal(f.contextReads,0);});
await test('fresh status API is mounted separately and never includes credential material',async()=>{
 const f=fixture(),routes=new Map(),app={get:(p,handler)=>routes.set('GET '+p,handler),post(){},use(){}};
 installDeviceCredentialRoutes(app,{env,store:f.store,runReadOnlySql:f.runReadOnlySql});
 const handler=routes.get('GET /device-auth/separation-context');assert.equal(typeof handler,'function');
 // Route's real clock requires a fresh transport proof, not the fixed unit time.
 const stamp=new Date().toISOString();f.req.headers['x-memphis-native-request-timestamp']=stamp;
 f.req.headers['x-memphis-native-request-attestation']=createHmac('sha256',secret).update(['custodial-native-request.v1',id(3),'KIOSK_08','GET',f.req.originalUrl,createHash('sha256').update(Buffer.alloc(0)).digest('hex'),id(5),stamp,'custodial'].join('\n')).digest('hex');
 const res={headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;}};
 await handler(f.req,res);assert.equal(res.code,200);assert.deepEqual(res.body,{ok:true,data:context});assert.equal(res.headers['Cache-Control'],'no-store');
 assert.ok(!JSON.stringify(res.body).includes(secret));assert.ok(!JSON.stringify(res.body).includes('token_hash'));
});
console.log(JSON.stringify({scope:'H04 status-only real auth/route, synthetic retained token/context; not SQL/native/phone proof',passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,results},null,2));
if(results.some(x=>!x.pass))process.exitCode=1;
