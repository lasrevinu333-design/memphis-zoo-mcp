import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {makeCompletionEvidenceReader} from '../src/completion-taxonomy-manager.js';

const catalogText=readFileSync(new URL('../src/completion-taxonomy-v1.json',import.meta.url),'utf8').trimEnd();
const catalog=JSON.parse(catalogText),digest=createHash('sha256').update(catalogText).digest('hex');
assert.equal(catalog.version,'COMP011-20261003-v1');
assert.equal(digest,'855b2adc17cb77263ffe6e467059e3a7c0e11084d267604bc0a3166a5bd3f3b3');
for(const area of ['restroom','exhibit']){
 const ids=new Set(),labels=new Set();
 for(const kind of ['services','issues'])for(const entry of catalog.areas[area][kind]){
  assert.match(entry.id,new RegExp(`^${area}\\.${kind==='services'?'service':'issue'}\\.`));
  assert.equal(typeof entry.label,'string');assert.ok(entry.label.length>0);
  assert.ok(!ids.has(entry.id));ids.add(entry.id);
  assert.ok(!labels.has(`${kind}:${entry.label}`));labels.add(`${kind}:${entry.label}`);
 }
 assert.ok(catalog.areas[area].issues.some(x=>x.id===`${area}.issue.hvac`));
 assert.ok(catalog.areas[area].issues.some(x=>x.id===`${area}.issue.follow_up`));
 assert.equal(catalog.areas[area].services[0].label,'Full cleaning services');
 const selectable=new Set([...catalog.areas[area].services,...catalog.areas[area].issues].map(x=>x.id));
 for(const kind of ['services','issues'])for(const historic of catalog.historical_reference.areas[area][kind]){
  assert.ok(historic.label);for(const mapped of historic.maps_to)assert.ok(selectable.has(mapped),`historic ${historic.label} -> ${mapped}`);
  if(/inspection/i.test(historic.label))assert.match(historic.relation,/superseded/);
 }
}
assert.equal(catalog.historical_reference.selectable,false);
assert.ok(catalog.areas.restroom.services.some(x=>x.id==='restroom.service.toilet_tissue_restocked'));
assert.ok(catalog.areas.exhibit.services.some(x=>x.id==='exhibit.service.interior_glass'));
assert.ok(catalog.areas.exhibit.services.some(x=>x.id==='exhibit.service.floors_waxed'));

const makeResponse=()=>{const headers={};return {headers,statusCode:0,body:null,setHeader(k,v){headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}}};
let calls=[];
const reader=makeCompletionEvidenceReader({runRpc:async(name,args)=>{calls.push({name,args});return {session_uuid:args.p_session_uuid,completion_recorded:true}},managerId:req=>req.memphisAuth?.manager_id,backendSecret:()=> 'synthetic-backend-secret'});
const req={params:{sessionUuid:'session-123'},memphisAuth:{manager_id:'manager-123',read_only:true}};
let res=makeResponse();await reader(req,res);
assert.equal(res.statusCode,200);assert.equal(res.headers['Cache-Control'],'no-store');
assert.deepEqual(calls,[{name:'custodial_manager_completion_evidence',args:{p_manager_id:'manager-123',p_session_uuid:'session-123',p_backend_execution_secret:'synthetic-backend-secret'}}]);
for(const [badReq,expected] of [
 [{...req,params:{sessionUuid:'bad/route'}},422],
 [{...req,memphisAuth:{}},403],
]){res=makeResponse();await reader(badReq,res);assert.equal(res.statusCode,expected)}
assert.equal(calls.length,1);
res=makeResponse();await makeCompletionEvidenceReader({runRpc:async()=>({session_uuid:'other',completion_recorded:true}),managerId:()=> 'manager-123',backendSecret:()=> 'x'})(req,res);
assert.equal(res.statusCode,503);
res=makeResponse();await makeCompletionEvidenceReader({runRpc:async()=>{throw Object.assign(new Error('private data'),{code:'42501'})},managerId:()=> 'manager-123',backendSecret:()=> 'x'})(req,res);
assert.equal(res.statusCode,403);assert.ok(!JSON.stringify(res.body).includes('private data'));
let routedCalls=0;
const routedReader=makeCompletionEvidenceReader({runRpc:async(_name,args)=>{routedCalls++;return {session_uuid:args.p_session_uuid,completion_recorded:true}},managerId:request=>request.memphisAuth?.manager_id,backendSecret:()=> 'synthetic-secret'});
const server=createServer((request,response)=>{
 response.status=n=>{response.statusCode=n;return response};
 response.json=body=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify(body));return response};
 const match=request.url.match(/^\/admin-api\/custodial\/cleaning-sessions\/([^/]+)\/completion-evidence$/);
 if(!match)return response.status(404).json({ok:false});
 if(request.headers.authorization!=='Bearer synthetic-named-manager')return response.status(403).json({ok:false});
 request.memphisAuth={manager_id:'manager-123',read_only:true};request.params={sessionUuid:decodeURIComponent(match[1])};
 void routedReader(request,response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const origin=`http://127.0.0.1:${server.address().port}`;
 const denied=await fetch(origin+'/admin-api/custodial/cleaning-sessions/session-123/completion-evidence');
 assert.equal(denied.status,403);assert.equal(routedCalls,0);
 const accepted=await fetch(origin+'/admin-api/custodial/cleaning-sessions/session-123/completion-evidence',{headers:{Authorization:'Bearer synthetic-named-manager'}});
 assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');
 assert.equal((await accepted.json()).data.session_uuid,'session-123');assert.equal(routedCalls,1);
 const malformed=await fetch(origin+'/admin-api/custodial/cleaning-sessions/%20bad/completion-evidence',{headers:{Authorization:'Bearer synthetic-named-manager'}});
 assert.equal(malformed.status,422);assert.equal(routedCalls,1);
}finally{await new Promise(resolve=>server.close(resolve))}
console.log('PASS completion taxonomy catalog digest/coverage and manager exact-reader boundary');
