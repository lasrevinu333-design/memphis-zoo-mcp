// Pure Source-data regressions + exact Source301 SQL routing preservation.
// No PostgreSQL, credentials, private user data, provider send, device or clock mutation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {inspectApprovedManualLunchContinuity as inspect} from '../src/approved-manual-notification-continuity.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
const sourceURL=new URL('../release/worker2-notification-continuity-20261030/',import.meta.url);
const read=name=>readFileSync(new URL(name,sourceURL),'utf8');
const clone=structuredClone;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const omit=(o,keys)=>Object.fromEntries(Object.entries(o).filter(([key])=>!keys.includes(key)));
const day='2026-10-31',loanId='a'.repeat(64),key='b'.repeat(64),endKey='c'.repeat(64);
let checks=0;
function test(name,fn){fn();checks++;console.log(`PASS ${name}`);}
function seal(row){row.document.document_identity=digest(omit(row.document,['document_identity']));row.documentIdentity=row.document.document_identity;return row;}
function base(){return seal({projectionId:id(1),publicationId:id(100),versionId:id(200),weekStart:'2026-10-26',weekEnd:'2026-11-01',
 envelope:{adapter:{schema:'ordinary.original.accepted.adapter'},authority:{schema:'ordinary.original.authority',projectionAvailability:[
  {serviceDate:day,slotId:'owner',incumbentPersonId:id(301),incumbentName:'Synthetic Owner',status:'working',shift:{start:'07:00',end:'17:00'}},
  {serviceDate:day,slotId:'helper',incumbentPersonId:id(302),incumbentName:'Synthetic Helper',status:'working',shift:{start:'07:00',end:'17:00'}},
 ]}},document:{schema:'memphis-zoo.static-weekly-lunch-authority-document.v1',week_start:'2026-10-26',
  loans:[{loan_id:loanId,service_date:day,normal_owner_slot_id:'owner',normal_owner_person_id:id(301),coverage_start:'12:00',coverage_end:'13:00',status:'PLANNED',helper_slot_ids:['helper'],total_distance_minutes:5}],
  responsibilities:[{responsibility_id:'d'.repeat(64),loan_id:loanId,service_date:day,normal_owner_slot_id:'owner',normal_owner_person_id:id(301),coverer_slot_id:'helper',coverer_person_id:id(302),coverage_purpose:'LUNCH_ONLY',coverage_start:'12:00',coverage_end:'13:00',proximity_evidence:[{minutes:5}],segments:[{planWorkId:'work-1',window:{start:'12:15',end:'12:45'}}]}],
  notification_intents:[{notification_key:key,loan_id:loanId,service_date:day,event:'start',scheduled_time:'12:00',coverer_slot_id:'helper',delivery_state:'NOT_ENQUEUED'},
   {notification_key:endKey,loan_id:loanId,service_date:day,event:'end',scheduled_time:'13:00',coverer_slot_id:'helper',delivery_state:'NOT_ENQUEUED'}]}});}
function retained(previous,n){const r=clone(previous);r.projectionId=id(n);r.envelope.adapter={schema:'custodial.approved-manual-period-database-adapter.v1',version:'approved-manual-period-v1'};
 r.envelope.authority.schema='custodial.approved-manual-period-projection-authority.v1';r.envelope.authority.lunchIdentityRetention={schema:'custodial.approved-manual-lunch-identity-retention.v1',priorProjectionId:previous.projectionId,priorDocumentIdentity:previous.documentIdentity,loans:[{serviceDate:day,normalOwnerSlotId:'owner',loanId}],requiresSqlOwnerCurrentnessCheck:true};
 r.document.base_authority_digest=String(n).padStart(64,'0');return seal(r);}
function fixture(){const a=base(),b=retained(a,2),c=retained(b,3);return {currentState:{governed:true,projection_status:'current',projection_id:c.projectionId,publication_id:a.publicationId,version_id:a.versionId},projections:[a,b,c],sourceProjectionId:a.projectionId,sourceDocumentIdentity:a.documentIdentity,notificationKey:key,serviceDate:day};}
function checkData(input,yes){const before=digest(input);const r=inspect(input);assert.equal(r.state,yes?'MATCHING_SOURCE_DATA_ONLY':'UNAVAILABLE_SOURCE_DATA');assert.equal(r.databaseAuthority,false);assert.equal(digest(input),before);return r;}
function negative(name,mutate){test(name,()=>{const f=fixture();mutate(f);checkData(f,false);});}
function editCurrent(f,fn){fn(f.projections[2]);seal(f.projections[2]);}

test('old source projection survives two exact stored lineage links without rebinding original identity',()=>{
 const f=fixture(),r=checkData(f,true);assert.equal(r.sourceProjectionId,id(1));assert.equal(r.currentProjectionId,id(3));assert.notEqual(r.sourceDocumentIdentity,r.currentDocumentIdentity);
});
test('ordinary same-projection membership remains supported',()=>{const f=fixture();f.currentState.projection_id=id(1);checkData(f,true);});
test('end intent retains its original 13:00 key',()=>{const f=fixture();f.notificationKey=endKey;checkData(f,true);});
test('fresh verified proximity and its total may differ without physical work or clock drift',()=>{const f=fixture();for(const r of f.projections.slice(1)){r.document.loans[0].total_distance_minutes=6;r.document.responsibilities[0].proximity_evidence=[{minutes:6,verified:true}];seal(r);}f.projections[2].envelope.authority.lunchIdentityRetention.priorDocumentIdentity=f.projections[1].documentIdentity;checkData(f,true);});
test('unrelated current document members may change while this complete loan remains exact',()=>{const f=fixture();editCurrent(f,r=>r.document.unrelated='new PTO for another loan');checkData(f,true);});
test('fixed-to-native availability omits only duplicate immutable slot-label metadata',()=>{
 const f=fixture();for(const a of f.projections[0].envelope.authority.projectionAvailability){a.incumbentSlotId=a.slotId;a.incumbentSlotLabel='Original immutable source slot';}checkData(f,true);
});
negative('UNKNOWN current authority refuses',f=>f.currentState.projection_status='unknown');
negative('ungoverned schedule refuses',f=>f.currentState.governed=false);
negative('prepared-only row not selected by current SQL state refuses',f=>f.currentState.projection_id=id(999));
negative('PERSISTED caller label cannot replace current authority',f=>{f.currentState={persistence_status:'PERSISTED'};});
negative('missing current document refuses',f=>f.projections.pop());
negative('duplicate current projection refuses',f=>f.projections.push(clone(f.projections[2])));
negative('source immutable document hash mismatch refuses',f=>f.sourceDocumentIdentity='f'.repeat(64));
negative('mutated original document without matching hash refuses',f=>f.projections[0].document.loans[0].coverage_end='13:30');
negative('mutated current document without matching hash refuses',f=>f.projections[2].document.notification_intents[0].scheduled_time='12:01');
negative('unlinked manual projection refuses',f=>delete f.projections[2].envelope.authority.lunchIdentityRetention);
negative('wrong manual authority schema refuses',f=>f.projections[2].envelope.authority.schema='prepared.document');
negative('wrong native adapter refuses',f=>f.projections[2].envelope.adapter.version='unsupported');
negative('caller original authority flag false refuses',f=>f.projections[2].envelope.authority.lunchIdentityRetention.requiresSqlOwnerCurrentnessCheck=false);
negative('extra original authority flag refuses',f=>f.projections[2].envelope.authority.lunchIdentityRetention.accepted=true);
negative('missing intermediate immutable prior refuses',f=>f.projections.splice(1,1));
negative('crossed prior hash refuses',f=>f.projections[2].envelope.authority.lunchIdentityRetention.priorDocumentIdentity='f'.repeat(64));
negative('cross-publication lineage refuses',f=>f.projections[1].publicationId=id(900));
negative('cross-version lineage refuses',f=>f.projections[1].versionId=id(900));
negative('cross-frame lineage refuses',f=>f.projections[1].weekStart='2026-10-19');
negative('current selected publication mismatch refuses',f=>f.currentState.publication_id=id(900));
negative('retained record for another owner refuses',f=>f.projections[2].envelope.authority.lunchIdentityRetention.loans[0].normalOwnerSlotId='other');
negative('duplicate retained member record refuses',f=>f.projections[2].envelope.authority.lunchIdentityRetention.loans.push(clone(f.projections[2].envelope.authority.lunchIdentityRetention.loans[0])));
negative('cycle refuses instead of looping or resetting a job',f=>{const r=f.projections[2];r.envelope.authority.lunchIdentityRetention.priorProjectionId=r.projectionId;r.envelope.authority.lunchIdentityRetention.priorDocumentIdentity=r.documentIdentity;});
for(const [name,mutate] of [
 ['start due minute',r=>r.document.notification_intents[0].scheduled_time='12:01'],
 ['end due minute',r=>r.document.notification_intents[1].scheduled_time='13:01'],
 ['event kind',r=>r.document.notification_intents[0].event='end'],
 ['loan hour',r=>r.document.loans[0].coverage_end='13:30'],
 ['helper slot',r=>r.document.loans[0].helper_slot_ids=['other']],
 ['responsibility person',r=>r.document.responsibilities[0].coverer_person_id=id(900)],
 ['responsibility identity',r=>r.document.responsibilities[0].responsibility_id='f'.repeat(64)],
 ['physical segment',r=>r.document.responsibilities[0].segments[0].planWorkId='other-work'],
 ['segment end',r=>r.document.responsibilities[0].segments[0].window.end='12:50'],
 ['coverage purpose',r=>r.document.responsibilities[0].coverage_purpose='EXTRA_CLEAN'],
 ['intent delivery state',r=>r.document.notification_intents[0].delivery_state='DELIVERED'],
 ['missing intent',r=>r.document.notification_intents.shift()],
 ['duplicate intent',r=>r.document.notification_intents.push(clone(r.document.notification_intents[0]))],
 ['missing physical responsibilities',r=>r.document.responsibilities=[]],
 ['loan cancellation',r=>r.document.loans[0].status='CANCELLED'],
 ['helper no longer working',r=>r.envelope.authority.projectionAvailability[1].status='absent'],
 ['helper original shift end',r=>r.envelope.authority.projectionAvailability[1].shift.end='16:00'],
 ['owner speech name',r=>r.envelope.authority.projectionAvailability[0].incumbentName='Changed'],
])negative(`changed ${name} refuses without rewriting original state`,f=>editCurrent(f,mutate));
for(const state of ['pending','leased','done','dead'])test(`diagnostic leaves ${state} original jobs, leases and receipts byte-exact`,()=>{
 const f=fixture(),originals={jobs:[{job_id:id(500),job_key:`employee-lunch-push:${key}:${id(501)}`,source_id:id(1),status:state,lease_token:id(502),leased_until:'2026-10-31T17:05:00Z',available_at:'2026-10-31T17:00:00Z',completed_at:state==='done'?'2026-10-31T17:01:00Z':null}],receipts:[{job_id:id(500),source_id:id(1),body:'ORIGINAL',wire:'ORIGINAL-WIRE',content_sha256:'e'.repeat(64)}]};
 const raw=JSON.stringify(originals);checkData(f,true);assert.equal(JSON.stringify(originals),raw);assert.equal(Object.hasOwn(inspect(f),'dispatch_authorized'),false);
});
test('128-node lineage is finite and supported;129 refuses without widening the bound',()=>{
 const f=fixture();f.projections=[base()];for(let n=2;n<=129;n++)f.projections.push(retained(f.projections.at(-1),n));f.currentState.projection_id=id(128);checkData(f,true);f.currentState.projection_id=id(129);checkData(f,false);
});

const proposal=readFileSync(new URL('../proposals/approved-manual-notification-continuity.sql',import.meta.url),'utf8');
test('proposal contains only new helper plus the exact four changed owning functions',()=>{
 const names=[...proposal.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/g)].map(m=>m[1]);
 assert.deepEqual(names,['static_weekly_manual_lunch_current_basis','mz_enqueue_employee_lunch_coverage_pushes','custodial_native_target_source_at','custodial_native_lunch_live','static_weekly_v27_original_native_bindings']);
 assert.doesNotMatch(proposal,/CREATE\s+(?:TABLE|TRIGGER|INDEX)|DELETE\s+FROM|UPDATE\s+public\./i);
});
test('enqueue preserves both original insert/conflict paths, keys and due clocks',()=>{
 const before=read('mz_enqueue_employee_lunch_coverage_pushes.Source301.sql'),after=read('mz_enqueue_employee_lunch_coverage_pushes.proposed.sql');
 const normalize=s=>s.replace("  perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));\n",'')
  .replace('  -- Validate the exact current persisted document; never materialize a prepared draft.\n  perform public.static_weekly_v8_assert_lunch_document(v_authority.projection_id,v_document);\n\n','');
 assert.equal(normalize(after),before);assert.equal((after.match(/on conflict\(job_key\) do nothing/g)||[]).length,2);
 assert.ok(after.indexOf("hashtextextended('memphis-static-weekly-authority'")<after.indexOf('select * into strict v_authority'));
});
test('target source MESSAGE and SCHEDULE branches stay byte exact',()=>{
 const marker=' else\n  select * into v_job from public.operational_notification_jobs where job_id=p_source_key;';
 assert.equal(read('custodial_native_target_source_at.proposed.sql').split(marker)[0],read('custodial_native_target_source_at.Source301.sql').split(marker)[0]);
});
test('native target keeps old source document and current working-recipient eligibility',()=>{
 const s=read('custodial_native_target_source_at.proposed.sql');assert.match(s,/where projection_id=v_job\.source_id/);assert.match(s,/projection\.projection_id=v_authority\.projection_id/);
 assert.match(s,/v_source:=jsonb_build_object\('source_id',v_document\.projection_id/);assert.match(s,/'source_digest',v_document\.document_identity/);
});
test('original reserve/replay/unknown no-resend implementation is not replaced',()=>{
 const s=read('custodial_native_lunch_reserve_at.Source301.sql');assert.match(s,/native_lunch_outcome_unknown_no_resend/);assert.match(s,/'dispatch_authorized',false,'replayed',true/);
 assert.doesNotMatch(proposal,/CREATE OR REPLACE FUNCTION public\.custodial_native_lunch_reserve_at/);
});
test('native current member helper is read-only and private, never calls enqueue/materialize/accept',()=>{
 const s=proposal.slice(0,proposal.indexOf('CREATE OR REPLACE FUNCTION public.mz_enqueue_employee_lunch_coverage_pushes'));
 const executable=s.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE)\b|PERFORM public\.(?:mz_enqueue|static_weekly_v8_materialize|static_weekly_pending_accept)/i);
 assert.match(s,/FROM PUBLIC,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader/);
 assert.match(s,/pg_get_userbyid\(p\.proowner\)/);assert.match(s,/OWNER TO %I/);assert.match(s,/static_weekly_v8_assert_lunch_document\(current_projection\.projection_id,current_doc\.document_json\)/);
});
test('bindings may differ only in independently current-bound projection/hash, not semantic fields or original receipt evidence',()=>{
 const before=read('static_weekly_v27_original_native_bindings.Source301.sql'),after=read('static_weekly_v27_original_native_bindings.proposed.sql');
 assert.ok(after.includes("or normal_data->>'projection_id' is distinct from lunch_basis->>'current_projection_id'"));
 assert.ok(after.includes("or normal_data->>'document_identity' is distinct from lunch_basis->>'current_document_identity'"));
 const beforeQueries=before.slice(before.indexOf('  for original in'),before.indexOf('   fields:=case'));
 assert.ok(after.includes(beforeQueries));
 assert.match(after,/array\['notification_key','kind','service_date','loan_id','event','scheduled_time','scheduled_at','coverer_slot_id','route'\]/);
 assert.ok(after.includes("public.custodial_native_lunch_live(receipt.job_id,receipt.native_payload,p_at)"));
});
console.log(JSON.stringify({status:'PASS',checks,scope:'pure-source-data-and-exact-SQL-source-contracts',actual_sql:false,acceptedAuthority:false,providerSend:false,deviceDelivery:false}));
