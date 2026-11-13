/** Immutable, source-bound full scheduled-lunch responsibilities. */
import {canonicalJson,normalizeWindow} from './static-weekly-schedule-model.js';

export const FULL_HOUR_LUNCH_POLICY_SCHEMA='memphis-zoo.static-weekly-full-hour-lunch-policy.v1';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const id=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f]/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&canonicalJson(Object.keys(value).sort())===canonicalJson([...keys].sort());
const compare=(a,b)=>a<b?-1:a>b?1:0;

// The existing canonical program supplies its own fixed JSONB digest. A
// caller-supplied plan or cached receipt never replaces source admission.
export function validateFullHourLunchPolicy(policy,digest){
  if(policy===undefined)return null;
  if(!exact(policy,['schema','sourceDigest','loans','policyDigest'])
    ||policy.schema!==FULL_HOUR_LUNCH_POLICY_SCHEMA
    ||typeof policy.sourceDigest!=='string'||!/^[0-9a-f]{64}$/.test(policy.sourceDigest)
    ||!Array.isArray(policy.loans)||policy.loans.length>1792)fail('full_hour_lunch_policy_invalid');
  const {policyDigest,...body}=policy;
  if(policyDigest!==digest(body))fail('full_hour_lunch_policy_digest_mismatch');
  const loans=new Map();
  for(const loan of policy.loans){
    if(!exact(loan,['dayOfWeek','normalOwnerSlotId','window','areas'])
      ||!Number.isInteger(loan.dayOfWeek)||loan.dayOfWeek<0||loan.dayOfWeek>6
      ||!id(loan.normalOwnerSlotId)||!Array.isArray(loan.areas)||loan.areas.length>128
      ||!exact(loan.window,['start','end']))fail('full_hour_lunch_loan_invalid');
    normalizeWindow(loan.window,'full scheduled lunch');
    const key=`${loan.dayOfWeek}\0${loan.normalOwnerSlotId}`;
    if(loans.has(key))fail('full_hour_lunch_duplicate_owner');
    const areas=new Map();
    for(const area of loan.areas){
      if(!exact(area,['locationCode','covererSlotId'])||!id(area.locationCode)||!id(area.covererSlotId)
        ||area.covererSlotId===loan.normalOwnerSlotId||areas.has(area.locationCode))fail('full_hour_lunch_area_invalid');
      areas.set(area.locationCode,area.covererSlotId);
    }
    loans.set(key,{...loan,areas});
  }
  return loans;
}

export function createFullHourLunchPolicy({sourceDigest,loans},digest){
  const body={schema:FULL_HOUR_LUNCH_POLICY_SCHEMA,sourceDigest,loans:structuredClone(loans)
    .map(loan=>({...loan,areas:loan.areas.sort((a,b)=>compare(a.locationCode,b.locationCode))}))
    .sort((a,b)=>a.dayOfWeek-b.dayOfWeek||compare(a.normalOwnerSlotId,b.normalOwnerSlotId))};
  const policy={...body,policyDigest:digest(body)};
  validateFullHourLunchPolicy(policy,digest);
  return policy;
}
