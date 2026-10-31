import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareApprovedManualActivationPackage as current} from '../src/approved-manual-roster-transition.js';
import {prepareApprovedManualActivationPackage as prior} from '../release/worker1-canonical-manual-roster-snapshot-source01-20261031/BEFORE_ROSTER_IMPORT_COUNTERPART.mjs';
import {readApprovedManualWeek} from '../src/approved-manual-week.js';
import {prepareApprovedManualSourceDraft} from '../src/approved-manual-source-draft.js';
import {postgresJsonbContentDigest as digest} from '../src/static-weekly-schedule-program.js';
import {installStaticWeeklySha256HexAccelerator} from '../src/static-weekly-schedule-model.js';
installStaticWeeklySha256HexAccelerator(x=>createHash('sha256').update(x).digest('hex'));
const raw=JSON.parse(readFileSync(new URL('./fixtures/manual-live-roster-20261030.json',import.meta.url))).readback,week=readApprovedManualWeek(),
 draft=prepareApprovedManualSourceDraft({week,referenceBytes:readFileSync(new URL('../'+week.referenceBindings.reference.path,import.meta.url))}),
 ui={schema:'custodial.approved-manual-activation-options.v2',serviceDate:raw.serviceDate,authorityRevision:raw.authorityRevision,choices:[],active:null},decorated={...raw,approvedManualActivation:ui},
 uid=n=>`79000000-0000-4000-8000-${String(n).padStart(12,'0')}`,selection=draft.sourceDraft.slots.filter(s=>s.contractorCapacity).map((s,n)=>({legacy_slot_id:s.id,new_capacity_id:uid(100+n),capacity_code:`CoverAll${String(n+1).padStart(2,'0')}`})),
 args={week,draft,snapshot:raw,effectiveStart:raw.serviceDate,selection,sourceId:uid(1),versionId:uid(2),templatePublicationId:uid(3),templateId:'PURE_PROJECTOR_NOT_REGISTERED',packetId:uid(4),managerId:uid(5)},before=digest({raw,decorated,draft});
const old=prior(args),fresh=current(args),view=current({...args,snapshot:decorated});
assert.deepEqual(fresh,old,'Raw CLI behavior must stay byte-identical');assert.deepEqual(view,fresh,'Decorated input must produce exactly the raw result');assert.equal(digest({raw,decorated,draft}),before,'Caller/source mutation forbidden');
assert.equal(fresh.feasibility.projectionAssignments.length,346);assert.equal(fresh.feasibility.lunchDocument.loans.length,40);assert.equal(fresh.feasibility.solverInvoked,false);
console.log(JSON.stringify({status:'PASS',groups:4,scope:'normal activation package exact previous/raw/decorated compatibility and immutable inputs',rawPreviousExact:true,decoratedRawExact:true,inputsPreserved:true,normal346Lunch40SolverFalse:true,SQL:false}));
