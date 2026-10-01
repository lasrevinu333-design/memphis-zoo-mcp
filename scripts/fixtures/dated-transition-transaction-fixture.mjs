// Synthetic database contract fixture only. Not PostgreSQL or production.
import {DATED_TRANSITION_STORE_CONTRACT} from '../../src/static-weekly-dated-transition-materialization.js';
import {postgresJsonbContentDigest as digest} from '../../src/static-weekly-schedule-program.js';
const copy=structuredClone;
export const MANAGER_ID='96000000-0000-4000-8000-000000000009';
export function createDatedTransitionDatabaseFixture(plan){
 const initial={authorityRevision:17,managers:[MANAGER_ID],rosterSlots:copy(plan.rosterSlots),
  approvedAvailability:plan.days.map(d=>({serviceDate:d.serviceDate,availability:copy(d.availability)})),
  dependencyNonce:0,rows:{'2026-09-28':{historical:'original Monday'},'2026-09-29':{historical:'original Tuesday'},
   '2026-09-30':{historical:'original Wednesday'},'2026-10-05':{recurring:'preserve Monday authority'}},
  protectedWork:[{id:'historical-cleaning',completed:true},{id:'pending-cleaning',saved:true}],
  publications:[],receipts:[],rollbackHistory:[]};
 let state=copy(initial),failAt=null,tail=Promise.resolve(),active=0,maxActive=0;
 const hit=label=>{if(failAt===label)throw Error('fixture-failure:'+label);};
 const store={contract:DATED_TRANSITION_STORE_CONTRACT,
  async transaction(work){
   const before=tail;let release;tail=new Promise(r=>release=r);await before;
   active++;maxActive=Math.max(maxActive,active);
   const draft=copy(state);let staged=null;
   const current=()=>copy(draft.publications.find(p=>p.active)||null);
   const tx={
    async snapshot(managerId,start,end){hit('snapshot');return {authorityRevision:draft.authorityRevision,
     authorizedManagerId:draft.managers.includes(managerId)?managerId:null,
     dependencyDigest:digest({roster:draft.rosterSlots,availability:draft.approvedAvailability,nonce:draft.dependencyNonce}),
     rosterSlots:copy(draft.rosterSlots),approvedAvailability:copy(draft.approvedAvailability),
     hasExistingOccurrences:Object.keys(draft.rows).some(date=>date>=start&&date<end)};},
    async receipt(managerId,key){return copy(draft.receipts.find(r=>r.request.managerId===managerId&&r.request.idempotencyKey===key)||null);},
    async stage(value){
     hit('before-stage');
     for(const [i,day] of value.days.entries()){
      if(day.serviceDate<value.effectiveStart||day.serviceDate>=value.effectiveEndExclusive||draft.rows[day.serviceDate])throw Error('fixture-boundary-or-overwrite');
      draft.rows[day.serviceDate]=copy(day);if(i===1)hit('partial-stage');
     }
     staged={persistenceStatus:'PERSISTED',publicationId:'96000000-0000-4000-8000-000000000101',
      projectionId:'96000000-0000-4000-8000-000000000102',planDigest:value.planDigest,
      phonePdfRevision:value.phonePdfRevision,days:copy(value.days),active:true};
     if(failAt==='wrong-readback')staged.days[0].assignments[0].personId=null;
    },
    async readStaged(){hit('readback');return copy(staged);},
    async finalize(request,record){
     draft.authorityRevision++;draft.publications.push(copy(record));
     const response={state:'PERSISTED',revision:draft.authorityRevision,publicationId:record.publicationId,
      projectionId:record.projectionId,planDigest:record.planDigest,phonePdfRevision:record.phonePdfRevision,
      phoneDeliveryState:'PENDING',affectedPhonesUpdated:false};
     draft.receipts.push({request:copy(request),response:copy(response)});hit('after-receipt');
     if(failAt==='lying-phone-receipt')response.affectedPhonesUpdated=true;
     return response;
    },
    async current(planDigest){const found=current();return found?.planDigest===planDigest?found:null;},
    async appendRollback(request,record){
     const publication=draft.publications.find(p=>p.publicationId===record.publicationId&&p.active);
     if(!publication)throw Error('fixture-current-publication-required');
     publication.active=false;for(const day of record.days)delete draft.rows[day.serviceDate];
     draft.rollbackHistory.push({request:copy(request),retainedPublication:copy(publication)});
     draft.authorityRevision++;
     const response={state:'ROLLED_BACK',revision:draft.authorityRevision,planDigest:record.planDigest,
      publicationId:record.publicationId,projectionId:record.projectionId,phoneDeliveryState:'PENDING',affectedPhonesUpdated:false};
     draft.receipts.push({request:copy(request),response:copy(response)});hit('rollback');return response;
    },
    async readCurrentDay(date){return copy(draft.rows[date]||null);},
   };
   try{const result=await work(tx);hit('before-commit');state=draft;hit('after-commit');return result;}
   finally{active--;release();}
  },
 };
 return {store,initial:copy(initial),inspect:()=>copy(state),setFailure:value=>failAt=value,
  change:fn=>fn(state),maxConcurrent:()=>maxActive};
}
