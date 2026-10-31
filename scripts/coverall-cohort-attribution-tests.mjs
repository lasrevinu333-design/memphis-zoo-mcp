import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {coverAllIssuingManagerFromActor,createCoverAllPrintDocument,createCoverAllCopyTexts} from '../src/static-weekly-coverall-print.js';
import {coverAllCanonicalBinding,scopeCanonicalCoverAllDocument} from '../src/static-weekly-coverall-access.js';
import {canonicalJson} from '../src/static-weekly-schedule-model.js';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,cases=[];
const actor={manager_id:id(1),manager_name:'Custodial leadership cohort',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',identity_assurance:'SELF_ASSERTED_NAME',individual_identity_verified:false,claimed_account_id:id(2),claimed_name:'Synthetic claimed manager'},
 snapshot={roster:[],authority_revision:7,projection_status:'current',current_publication:{publication_id:id(3),version_id:id(4)},exceptions:[{type:'cover_all',serviceDate:'2026-11-02',payload:{availability:{slotId:id(6),shift:{start:'05:00',end:'14:00'}}}}],latest_projection:{projection_id:id(5),publication_id:id(3),version_id:id(4),week_start:'2026-10-30',week_end:'2026-11-05',replay_digest:'a'.repeat(64),assignments:[]}},
 source={publication_id:id(3),version_id:id(4),compiler_input:{slots:[{id:id(6),label:'CoverAll01',kind:'CONTRACTOR_CAPACITY',capacityId:id(6),contractorCapacity:true,incumbencies:[]}]}},
 lunch={persistence_status:'PERSISTED',projection_id:id(5),document_identity:'b'.repeat(64),service_date:'2026-11-02',loans:[],responsibilities:[]};
function doc(issuingManager){return createCoverAllPrintDocument({snapshot,source,lunch,serviceDate:'2026-11-02',expectedRevision:7,projectionId:id(5),issuingManager});}
function test(name,fn){fn();cases.push({name,status:'PASS'});}
test('Cohort handout retains original self-asserted claim and never named-manager assurance',()=>{
 const d=doc(coverAllIssuingManagerFromActor(actor));assert.equal(d.managerContact.authority,'AUTHENTICATED_COHORT_SELF_ASSERTED_NAME');assert.equal(d.managerContact.individualIdentityVerified,false);assert.equal(d.managerContact.claimedAccountId,id(2));
 assert.ok(createCoverAllCopyTexts(d).every(t=>t.text.includes('claimed name: Synthetic claimed manager')));
 const binding=coverAllCanonicalBinding(d,id(6),'2026-10-30');assert.equal(scopeCanonicalCoverAllDocument(d,binding).managerContact.authority,d.managerContact.authority);
});
test('Named handout metadata stays byte-equivalent',()=>{const expected={name:'Synthetic named manager',role:'Issuing custodial manager',method:'IN_PERSON',authority:'AUTHENTICATED_NAMED_MANAGER',managerId:id(9)};assert.deepEqual(doc(coverAllIssuingManagerFromActor({manager_id:id(9),manager_name:expected.name})).managerContact,expected);});
for(const change of [{individual_identity_verified:true},{identity_assurance:'VERIFIED_NAME'},{claimed_account_id:null},{claimed_name:''}])test('Invalid cohort assurance or claim denied '+JSON.stringify(change),()=>assert.throws(()=>coverAllIssuingManagerFromActor({...actor,...change})));
test('Recomputed body digest does not make false verified cohort acceptable',()=>{const {documentDigest,...d}=doc(coverAllIssuingManagerFromActor(actor));d.managerContact.individualIdentityVerified=true;const forged={...d,documentDigest:createHash('sha256').update(canonicalJson(d)).digest('hex')};assert.throws(()=>createCoverAllCopyTexts(forged));});
console.log(JSON.stringify({scope:'actual print/canonical link functions, synthetic accepted input; no SQL',cases},null,2));
