import assert from 'node:assert/strict';
import {createStaticWeeklyControlPlane} from '../src/static-weekly-control-plane.js';
import {ACCEPTED_SEVEN_DATA_DIGEST,ACCEPTED_SEVEN_SHA256} from '../src/accepted-seven-manual-week.js';
const id=n=>'12000000-0000-4000-8000-'+String(n).padStart(12,'0'),manager={manager_id:id(1),manager_display_name:'SYNTHETIC preview manager',read_only:false};
const original=()=>({schema:'custodial.approved-manual-coverall-activation-preview-basis.v2',managerId:id(1),packetId:id(2),expectedRevision:27,
 previewDigest:'a'.repeat(64),employmentRevisionVector:Array.from({length:14},()=>({synthetic:true})),currentPositions:22,additionalCapacityPositions:8,prospectivePositions:30,newEmployees:0});
const seven=()=>({...original(),operationKind:'ACCEPTED_SEVEN_UPDATE_REUSE_EXISTING_CAPACITY',manualDataDigest:ACCEPTED_SEVEN_DATA_DIGEST,
 acceptedArtifactSha256:ACCEPTED_SEVEN_SHA256,currentPositions:30,additionalCapacityPositions:0});
async function preview(basis){
 const calls=[];const client={async query(sql,args){calls.push({sql,args});return {rows:sql.includes('static_weekly_read_coverall_activation_basis')?[{result:structuredClone(basis)}]:[]};},release(){calls.push({released:true});}};
 const cp=createStaticWeeklyControlPlane({database:{async connect(){return client;},async close(){}},shutdownCompiler:async()=>{}});
 try{return {value:await cp.previewApprovedManualActivation({manager,packetId:id(2),expectedRevision:27}),calls};}
 finally{await cp.close();}
}
let checks=0;
for(const basis of [original(),seven()]){
 const {value,calls}=await preview(basis);assert.equal(value.status,'PREVIEW_ONLY');assert.equal(value.published,false);
 assert.equal(value.currentPositions,basis.currentPositions);assert.equal(value.additionalCapacityPositions,basis.additionalCapacityPositions);
 assert.equal(calls.some(c=>c.sql==='commit'),true);assert.equal(calls.some(c=>c.sql?.includes('begin_coverall_activation')),false);checks++;
}
for(const mutate of [b=>delete b.operationKind,b=>delete b.manualDataDigest,b=>delete b.acceptedArtifactSha256,
 b=>{b.operationKind='unknown';},b=>{b.manualDataDigest='0'.repeat(64);},b=>{b.acceptedArtifactSha256='0'.repeat(64);},
 b=>{b.currentPositions=22;b.additionalCapacityPositions=8;},b=>{b.additionalCapacityPositions=1;},
 b=>{b.prospectivePositions=38;},b=>{b.newEmployees=1;},b=>{b.expectedRevision=26;},b=>{b.packetId=id(3);},
 b=>{b.managerId=id(4);},b=>{b.employmentRevisionVector.pop();}]){
 const b=seven();mutate(b);await assert.rejects(()=>preview(b),e=>e.code==='static_manual_activation_basis_invalid');checks++;
}
for(const mutate of [b=>{b.operationKind='unknown';},b=>{b.currentPositions=30;b.additionalCapacityPositions=0;},b=>{b.manualDataDigest=ACCEPTED_SEVEN_DATA_DIGEST;}]){
 const b=original();mutate(b);await assert.rejects(()=>preview(b),e=>e.code==='static_manual_activation_basis_invalid');checks++;
}
console.log(JSON.stringify({status:'PASS_SOURCE_BOUND_ACTIVATION_PREVIEW_BRANCHES',checks,actualSQL:false,realAuthentication:false,
 scope:'Actual backend preview method with synthetic database responses; existing real actor/SQL gates remain required',buildInstallOrDevice:false}));
