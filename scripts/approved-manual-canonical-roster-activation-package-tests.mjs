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
// The archived counterpart qualifies the original346-row packet. Keep that
// historical comparison exact, separately from the later owner shift correction.
const historicalBytes=readFileSync(new URL('./fixtures/approved-manual-week-before-start-correction.json',import.meta.url));
assert.equal(createHash('sha256').update(historicalBytes).digest('hex'),'837fc6f43fc2b5a506a81264bedf449be82def63e3a243a13fbe86e28eeb868b');
const historicalWeek=JSON.parse(historicalBytes),historicalDraft=prepareApprovedManualSourceDraft({week:historicalWeek,
 referenceBytes:readFileSync(new URL('../'+historicalWeek.referenceBindings.reference.path,import.meta.url))}),
 historicalArgs={...args,week:historicalWeek,draft:historicalDraft},historicalBefore=digest(historicalArgs),
 old=prior(historicalArgs),historical=current(historicalArgs),fresh=current(args),view=current({...args,snapshot:decorated});
assert.deepEqual(historical,old,'Historical raw CLI behavior must stay byte-identical');
assert.deepEqual(current({...historicalArgs,snapshot:decorated}),historical,'Historical decorated input must equal its raw result');
assert.equal(historical.feasibility.projectionAssignments.length,346);
assert.equal(digest(historicalArgs),historicalBefore,'Historical fixture mutation forbidden');
assert.deepEqual(view,fresh,'Corrected decorated input must produce exactly the raw result');assert.equal(digest({raw,decorated,draft}),before,'Caller/source mutation forbidden');
assert.equal(fresh.feasibility.projectionAssignments.length,327);assert.equal(fresh.feasibility.lunchDocument.loans.length,40);assert.equal(fresh.feasibility.solverInvoked,false);
console.log(JSON.stringify({status:'PASS',groups:8,scope:'normal activation package exact historical comparison and corrected raw/decorated compatibility; immutable inputs',historicalRawPreviousExact:true,historicalRows:346,decoratedRawExact:true,inputsPreserved:true,normal327Lunch40SolverFalse:true,SQL:false}));
