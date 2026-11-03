// Regression: the production general middleware must preserve each owning original-byte parser.
// Real loopback HTTP and current route composition; authentication/SQL ports are synthetic.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];
const require=createRequire(root+'/backend/package.json'),express=require('express');
const {createGeneralJsonMiddleware,createGeneralUrlencodedMiddleware}=await import(pathToFileURL(root+'/backend/src/request-json-parser.js'));
const {installSameOriginalRecoveryNativeChallengeComposition:install}=await import(pathToFileURL(root+'/backend/src/same-original-recovery-native-challenge-composition.js'));
let externalCalls=0;const refuse=async()=>{externalCalls++;throw Error('Synthetic refusal port; no external access');};
const deps={env:{NODE_ENV:'test'},store:{findCredential:refuse},runReadOnlySql:refuse,db:{rpc:refuse}};
const production=fs.readFileSync(root+'/backend/src/index.js','utf8');
if(!production.includes('app.use(createGeneralJsonMiddleware());\napp.use(createGeneralUrlencodedMiddleware());'))throw Error('Production must mount the tested shared parser pair in order');
const servers=[];
async function create(general){
 const app=express();if(general){app.use(createGeneralJsonMiddleware());app.use(createGeneralUrlencodedMiddleware());}
 app.post('/form-control',(req,res)=>res.json({body:req.body}));
 install(app,deps);app.use((error,req,res,next)=>res.status(error.status||500).json({code:'general_parser_error',type:error.type}));
 const server=app.listen(0,'127.0.0.1');servers.push(server);await new Promise(r=>server.once('listening',r));return 'http://127.0.0.1:'+server.address().port;
}
const owner=await create(false),integrated=await create(true),cases=[];
const paths=['/device-auth/local-enrollment-retention','/device-auth/original-inventory-ack','/device-auth/original-inventory-ack-status','/device-auth/original-inventory-separation-approval-status','/device-auth/original-inventory-manifest-chunk','/device-auth/original-inventory-manifest-chunk-status','/device-auth/same-original-recovery/challenge','/device-auth/same-original-recovery/challenge-status','/device-auth/same-original-recovery/manager-preparation','/device-auth/private-custody-original-completion-read'];
async function post(base,path,body){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body});return{status:r.status,body:await r.json()};}
try{
 const form=await fetch(integrated+'/form-control',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'number=1.25&text=hello'});const formBody=await form.json();
 cases.push({path:'/form-control',label:'ordinary URL-encoded form remains parsed',expected:{status:200,body:{number:'1.25',text:'hello'}},actual:{status:form.status,body:formBody.body},pass:form.status===200&&formBody.body?.number==='1.25'&&formBody.body?.text==='hello'});
 for(const path of paths)for(const [label,body] of [['invalid closed body','{}'],['malformed JSON','{']]){
 const expected=await post(owner,path,body),actual=await post(integrated,path,body);
 cases.push({path,label,expected,actual,pass:expected.status===actual.status&&expected.body.code===actual.body.code&&!/parser_order/.test(actual.body.code||'')});
 if(out)fs.writeFileSync(out,JSON.stringify({in_progress:true,cases},null,2)+'\n');
}}finally{for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}}
const report={scope:'Actual original-byte native route composition compared with the same handlers behind actual general middleware. Invalid/unauthenticated requests must reach the identical owning refusal; this grants no authority. Independent network namespace. No live credential, SQL, provider or native operation.',cases,passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length,external_port_calls:externalCalls,servers_closed:servers.every(s=>!s.listening)};
if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
