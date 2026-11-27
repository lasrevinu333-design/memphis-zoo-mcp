// Assemble regression inputs with the actual versioned manual-schedule readers and
// packet builders. The historical reader is loaded from the original checkout.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [root,edition,destination]=process.argv.slice(2);
const load=name=>import(pathToFileURL(resolve(root,'src',name)).href);
const {readApprovedManualWeek}=await load('approved-manual-week.js');
const {prepareApprovedManualSourceDraft}=await load('approved-manual-source-draft.js');
const {projectApprovedManualRosterSnapshot,prepareApprovedManualRosterTransition}=await load('approved-manual-roster-transition.js');
const {installStaticWeeklySha256HexAccelerator}=await load('static-weekly-schedule-model.js');
installStaticWeeklySha256HexAccelerator(s=>createHash('sha256').update(s).digest('hex'));
const seven=edition==='seven';
const week=seven ? (await load('accepted-seven-manual-week.js')).readAcceptedSevenManualWeek(readApprovedManualWeek()) : readApprovedManualWeek();
const draft=prepareApprovedManualSourceDraft({week,referenceBytes:readFileSync(resolve(root,week.referenceBindings.reference.path))});
const snapshot=projectApprovedManualRosterSnapshot(JSON.parse(readFileSync(resolve(root,'scripts/fixtures/manual-live-roster-20261030.json'))).readback);
const id=i=>'79000000-0000-4000-8000-'+String(i).padStart(12,'0');
let fixture;
if(seven){
  snapshot.serviceDate='2026-11-16';
  const wanted=new Set(week.referenceBindings.people.map(p=>p.employeeId));
  for(const slot of snapshot.rosterSlots){
    for(const entry of slot.incumbencies)entry.effectiveEnd||='2026-11-08';
  }
  for(const [i,p] of week.referenceBindings.people.entries()){
    snapshot.rosterSlots.find(s=>s.slotId===p.slotId).incumbencies.push({
      incumbencyId:id(i+500),personId:p.employeeId,displayName:p.approvedName,effectiveStart:'2026-11-09',effectiveEnd:null
    });
  }
  for(const e of snapshot.employees)if(!wanted.has(e.employeeId)){e.active=false;e.hasMessenger=false;}
  const transition=prepareApprovedManualRosterTransition({week,draft,snapshot,effectiveStart:snapshot.serviceDate});
  assert.equal(transition.unchanged.length,7);
  assert.equal(transition.transfers.length,0);
  fixture={transition,config:draft.ownerConfig,snapshot};
}else{
  assert.ok(['original','current'].includes(edition));
  snapshot.serviceDate='2026-10-30';
  const selection=draft.sourceDraft.slots.filter(s=>s.contractorCapacity).map((s,i)=>({
    legacy_slot_id:s.id,new_capacity_id:id(100+i),capacity_code:'CoverAll'+String(i+1).padStart(2,'0')
  }));
  const {prepareApprovedManualCoverAllActivation}=await load('approved-manual-coverall-workflow.js');
  const packet=prepareApprovedManualCoverAllActivation({week,draft,snapshot,selection,
    sourceId:id(6),versionId:id(7),templatePublicationId:id(8),templateId:'COVERALL_PURE_CURRENT_FRIDAY',packetId:id(9),managerId:id(1)});
  assert.equal(packet.source.version.assignments.length,edition==='current'?327:346);
  assert.equal(packet.feasibility.lunchDocument.loans.length,40);
  fixture={packet,snapshot};
}
writeFileSync(destination,JSON.stringify(fixture),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({edition,digest:week.dataDigest,employees:week.referenceBindings.people.length}));
