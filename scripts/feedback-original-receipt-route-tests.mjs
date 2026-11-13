import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeFeedbackSubmitAuthority} from '../src/feedback-authority.js';
import {makeEmployeeFeedbackOriginalReceiptReader} from '../src/employee-feedback-original-receipt.js';
const id=n=>`91000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let enrolled=true,epoch=7,reads=0,afterRead=()=>{},missing=false,foreign=false;
const device=(req,res,next)=>{if(!enrolled)return res.status(401).json({ok:false});req.memphisDeviceAuth={credentialed:true};req.memphisDeviceCredential={credential_id:id(2)};req.memphisDevice={canonical_device_pk:id(3),canonical_device_id:'KIOSK_SYNTHETIC',assigned_employee_id:id(1),assignment_epoch:epoch,assigned_employee_name:'Fixture'};next();};
const gate=makeFeedbackSubmitAuthority({requireEmployeeDeviceCredential:device,requireOpsManagerWrite:(_r,s)=>s.status(403).json({ok:false}),authenticatePresentedOpsAccessRequest:()=>({presented:false})});
const app=express();app.use(express.json());
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const start=source.indexOf('function feedbackSubmissionActor(req)'),end=source.indexOf('app.post("/feedback-api/submit",',start);
assert.ok(start>0&&end>start);
vm.runInNewContext(source.slice(start,end),{app,Buffer,requireFeedbackSubmitAuthority:gate,makeEmployeeFeedbackOriginalReceiptReader,sqlLiteral:v=>`'${v}'`,runReadOnlySql:async sql=>{
 assert.match(sql,/^select id,operation_id,request_fingerprint,category,priority,message,/);assert.match(sql,new RegExp(`where operation_id='${id(4)}'::uuid limit 1`));reads++;afterRead();
 return missing?[]:[{id:id(5),operation_id:id(4),request_fingerprint:'a'.repeat(64),category:'app_problem',priority:'normal',message:'Original',hub_context:'employee',device_id:'KIOSK_SYNTHETIC',page_url:null,metadata_json:{identity_verification:{status:'verified',kind:'enrolled_employee_device',device_id:'KIOSK_SYNTHETIC',employee_id:foreign?id(9):id(1),credential_id:id(2),assignment_epoch:7}}}];
}});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
try{
 const send=async patch=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/feedback-api/original-receipt`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation_id:id(4),hub_context:'employee',expected_employee_id:id(1),expected_credential_id:id(2),expected_assignment_epoch:'7',...patch})});return{status:r.status,cache:r.headers.get('cache-control'),body:await r.json()};};
 let r=await send();assert.equal(r.status,200);assert.equal(r.cache,'private, no-store');assert.deepEqual(Object.keys(r.body.data.item).sort(),['binding','id','operation_id']);assert.equal(reads,1);
 enrolled=false;r=await send();assert.equal(r.status,401);assert.equal(reads,1);enrolled=true;
 r=await send({operation_id:'invalid'});assert.equal(r.status,409);assert.equal(reads,1);
 foreign=true;r=await send();assert.equal(r.status,409);foreign=false;
 missing=true;r=await send();assert.equal(r.status,409);missing=false;
 afterRead=()=>{epoch=8;};r=await send();assert.equal(r.status,409);assert.equal(r.body.ok,false);
 console.log('PASS: six actual mounted original-receipt route cases; synthetic credential verifier and SELECT adapter, no hosted DB or provider calls.');
}finally{await new Promise(resolve=>server.close(resolve));}
