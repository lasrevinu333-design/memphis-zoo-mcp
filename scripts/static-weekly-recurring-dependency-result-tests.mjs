import assert from 'node:assert/strict';
import {withRecurringDependencyStatus} from '../src/static-weekly-recurring-dependency-result.js';
const publication='10000000-0000-4000-8000-000000000001',invalidation='10000000-0000-4000-8000-000000000002';
const accepted={operation:'vacate_slot',revision:12,data:{current_projection:{publication_id:publication,projection_id:'old-projection'},former_employee_id:'original-person'}};
const baseline=structuredClone(accepted);
const empty={authorityRevision:12,processedChangeCount:0,invalidations:[],blockedPublications:[],affectedPhonesUpdated:false};
const state={...empty,authorityRevision:13,processedChangeCount:1,blockedPublications:[{publicationId:publication,invalidationId:invalidation,effectiveStart:'2026-10-05',effectiveEnd:null,authorityRevision:13,state:'BLOCKED_RECURRING_AUTHORITY'}]};
let checks=0;const same=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
same(withRecurringDependencyStatus(accepted,empty),accepted,'no changed dependency preserves response');
same(withRecurringDependencyStatus(accepted,{...empty,authorityRevision:18}),accepted,'unrelated later revision does not rewrite historical retry');
const result=withRecurringDependencyStatus(accepted,state);
same(result.revision,13,'current invalidation revision is explicit');
same(result.accepted_operation_receipt,baseline,'original accepted receipt remains separately exact');
same(accepted,baseline,'input/historical receipt is not mutated');
same(result.data.current_projection,null,'invalidated publication is not shown as current projection');
same(result.data.projection_status,'blocked_recurring_authority','blocked state is explicit');
same(result.data.former_employee_id,'original-person','original employee identity retained');
same(result.data.recurring_dependency_reconciliation.affectedPhonesUpdated,false,'cannot claim phone updates');
same(withRecurringDependencyStatus(accepted,{...state,processedChangeCount:0}).accepted_operation_receipt,baseline,'same-key retry distinguishes accepted receipt and current invalidation');
same(withRecurringDependencyStatus(accepted,{...state,blockedPublications:[{...state.blockedPublications[0],publicationId:invalidation}]}).data.current_projection,baseline.data.current_projection,'unrelated publication is not cleared');
for(const bad of [null,{}, {...state,authorityRevision:11},{...state,authorityRevision:'13'}, {...state,processedChangeCount:-1},
 {...state,affectedPhonesUpdated:true},{...state,invalidations:null},{...state,blockedPublications:{}},
 ...[{state:'ACCEPTED'},{authorityRevision:14},{effectiveEnd:'2026-10-01'},{effectiveStart:''},{publicationId:'wrong'}].map(p=>({...state,blockedPublications:[{...state.blockedPublications[0],...p}]}))]){
 assert.throws(()=>withRecurringDependencyStatus(accepted,bad),/transaction cannot commit/);checks++;
}
console.log(JSON.stringify({status:'PASS',checks,scope:'current dependency status versus immutable accepted receipt; pure response boundary only'}));
