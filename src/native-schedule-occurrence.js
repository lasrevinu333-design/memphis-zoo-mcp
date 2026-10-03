import {createHash} from 'node:crypto';

// Source consideration only. No native wire, reservation, expiry, dispatch or
// delivery authority is created here. 09:45 is a local schedule boundary, not
// an observation of the current clock or a promise that a device has converged.
export const NATIVE_SCHEDULE_OCCURRENCE_SCHEMA='custodial.native-schedule-occurrence-source.v1';
export const NATIVE_SCHEDULE_SOURCE_LIMITS=Object.freeze({rows:4096,bytes:2*1024*1024,units:4096});
export const NATIVE_SCHEDULE_BOUNDARY='09:45';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha=/^[0-9a-f]{64}$/;
const modes=new Set(['scan_tracked','reminder_only','response_only_no_clean']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const requireValue=(condition,code='SOURCE_SHAPE_INVALID')=>{if(!condition)fail(code);};
const plain=x=>x!==null&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Object.keys(x).sort().join('\n')===[...keys].sort().join('\n');
const id=x=>typeof x==='string'&&uuid.test(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f-\u009f]/u.test(x);
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':plain(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const frozen=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(frozen);Object.freeze(x);}return x;};
function date(x){
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
 const d=new Date(x+'T00:00:00Z');return x.slice(0,4)!=='0000'&&Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===x;
}
export function assertNativeScheduleRequest({sourceKey,employeeId,generationId,serviceDate}){
 requireValue([sourceKey,employeeId,generationId].every(id)&&date(serviceDate),'REQUEST_INVALID');
}
function clock(value){
 const m=typeof value==='string'&&/^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(value);
 requireValue(m);const h=Number(m[1]),min=Number(m[2]),s=Number(m[3]||0),u=Number((m[4]||'').padEnd(6,'0'));
 requireValue(h<=24&&min<60&&s<60&&(h!==24||min+s+u===0));
 return ((h*60+min)*60+s)*1000000+u;
}
function window(row){const start=clock(row.coverage_start),end=clock(row.coverage_end);requireValue(start<end);return{start,end};}
const boundary=35100*1000000;
const active=(row,before)=>{const w=window(row);return before?w.start<boundary&&w.end>=boundary:w.start<=boundary&&w.end>boundary;};
const same=(a,b)=>canonical(a)===canonical(b);
const sorted=rows=>[...rows].sort((a,b)=>canonical(a)<canonical(b)?-1:canonical(a)>canonical(b)?1:0);
const unique=(rows,key,code)=>{const seen=new Set();for(const row of rows){const k=key(row);requireValue(!seen.has(k),code);seen.add(k);}};
function rows(value){requireValue(Array.isArray(value)&&value.length<=NATIVE_SCHEDULE_SOURCE_LIMITS.rows,'SOURCE_LIMIT_EXCEEDED');return value;}
const ids=value=>Array.isArray(value)&&value.length<=NATIVE_SCHEDULE_SOURCE_LIMITS.units&&value.every(id)&&new Set(value).size===value.length;
const bindingKeys=['service_date','projection_status','version_id','publication_id','projection_id'];
const segmentKeys=[...bindingKeys,'segment_id','location_group_id','included_location_ids','owner_type','assigned_employee_id','coverage_start','coverage_end','status','source_type','service_mode','governed'];
const physicalKeys=[...bindingKeys,'occurrence_id','location_group_id','location_id','assigned_employee_id','coverage_start','coverage_end','assignment_status','authority_source'];
const lunchKeys=['projection_id','loan_id','responsibility_id','normal_occurrence_id','normal_owner_id','coverer_id','location_group_id','included_location_ids','service_mode','coverage_start','coverage_end'];
const recipientKeys=['employee_id','device_id','device_identifier','credential_id','assignment_epoch','generation_id','principal_digest','token_digest'];
const targetKeys=['source_id','source_revision','source_digest','publication_id','version_id','service_date','assignment_occurrence_id','delivery_occurrence_id','delivery_key','valid_from','valid_until'];
function target(value,request){
 requireValue(exact(value,['schema','kind','source_key','status','delivery_admitted','source','recipient']), 'TARGET_UNAVAILABLE');
 requireValue(value.schema==='custodial.native-target-source.v1'&&value.kind==='SCHEDULE'&&value.source_key===request.sourceKey
  &&value.status==='SOURCE_ONLY_POLICY_MISSING'&&value.delivery_admitted===false,'TARGET_UNAVAILABLE');
 const r=value.recipient,s=value.source;
 requireValue(exact(r,recipientKeys)&&exact(s,targetKeys),'TARGET_UNAVAILABLE');
 requireValue(r.employee_id===request.employeeId&&r.generation_id===request.generationId&&id(r.device_id)&&id(r.credential_id)
  &&/^KIOSK_(?:0[2-9]|10)$/.test(r.device_identifier)&&Number.isSafeInteger(r.assignment_epoch)&&r.assignment_epoch>0
  &&sha.test(r.principal_digest)&&sha.test(r.token_digest),'TARGET_UNAVAILABLE');
 requireValue([s.source_id,s.publication_id,s.version_id].every(id)&&s.assignment_occurrence_id===request.sourceKey
  &&s.service_date===request.serviceDate&&typeof s.source_revision==='string'&&/^[1-9][0-9]{0,18}$/.test(s.source_revision)
  &&BigInt(s.source_revision)<=9223372036854775807n
  &&sha.test(s.source_digest)&&s.delivery_occurrence_id===null&&s.delivery_key===null&&s.valid_from===null&&s.valid_until===null,'TARGET_UNAVAILABLE');
 return value;
}
export function unavailableNativeScheduleSource(code){
 const allowed=['SOURCE_SHAPE_INVALID','SOURCE_LIMIT_EXCEEDED','TARGET_UNAVAILABLE','TARGET_CHANGED','SOURCE_NOT_CURRENT',
  'SOURCE_BINDING_MISMATCH','SOURCE_AMBIGUOUS','SOURCE_INCOMPLETE','READ_UNAVAILABLE'];
 requireValue(allowed.includes(code),'REQUEST_INVALID');
 return frozen({schema:NATIVE_SCHEDULE_OCCURRENCE_SCHEMA,status:'SOURCE_UNAVAILABLE',reason:code,delivery_admitted:false,
  dispatch_authorized:false,effect_authority:null,valid_until:null,occurrence:null});
}

export function deriveNativeScheduleOccurrence({request,snapshot,targetBefore,targetAfter}){
 assertNativeScheduleRequest(request);
 try{
  target(targetBefore,request);target(targetAfter,request);
  requireValue(same(targetBefore,targetAfter),'TARGET_CHANGED');
  requireValue(plain(snapshot)&&Buffer.byteLength(JSON.stringify(snapshot))<=NATIVE_SCHEDULE_SOURCE_LIMITS.bytes,'SOURCE_LIMIT_EXCEEDED');
  requireValue(exact(snapshot,['schema','authority','segments','physical','lunch'])&&snapshot.schema==='custodial.native-schedule-read.v1');
  requireValue(Array.isArray(snapshot.authority)&&snapshot.authority.length===1,'SOURCE_NOT_CURRENT');
  const a=snapshot.authority[0],t=targetBefore.source;
  requireValue(exact(a,[...bindingKeys,'governed','authority_source','projection_authority_revision']));
  requireValue(a.governed===true&&a.projection_status==='current'&&a.authority_source==='static_weekly_projection','SOURCE_NOT_CURRENT');
  requireValue(a.service_date===request.serviceDate&&a.projection_id===t.source_id&&a.publication_id===t.publication_id
   &&a.version_id===t.version_id&&a.projection_authority_revision===t.source_revision,'SOURCE_BINDING_MISMATCH');
  const segments=rows(snapshot.segments),physical=rows(snapshot.physical),lunch=rows(snapshot.lunch),byId=new Map();
  const binding=row=>requireValue(bindingKeys.every(k=>row[k]===a[k]),'SOURCE_BINDING_MISMATCH');
  unique(segments,s=>s.segment_id,'SOURCE_AMBIGUOUS');
  for(const s of segments){
   requireValue(exact(s,segmentKeys));binding(s);window(s);
   requireValue(id(s.segment_id)&&id(s.location_group_id)&&ids(s.included_location_ids)&&modes.has(s.service_mode)
    &&s.source_type==='static_weekly_projection'&&s.governed===true);
   requireValue(s.service_mode==='scan_tracked'?s.included_location_ids.length>0:s.included_location_ids.length===0,'SOURCE_INCOMPLETE');
   requireValue(s.status==='ASSIGNED'&&((s.owner_type==='EMPLOYEE'&&id(s.assigned_employee_id))
    ||(s.owner_type==='COVERALL'&&s.assigned_employee_id===null)),'SOURCE_AMBIGUOUS');
   byId.set(s.segment_id,s);
  }
  const anchor=byId.get(request.sourceKey);
  requireValue(anchor&&anchor.assigned_employee_id===request.employeeId,'SOURCE_BINDING_MISMATCH');
  const loans=new Map();
  unique(lunch,l=>[l.responsibility_id,l.normal_occurrence_id,l.coverage_start,l.coverage_end].join('|'),'SOURCE_AMBIGUOUS');
  for(const l of lunch){
   requireValue(exact(l,lunchKeys)&&l.projection_id===a.projection_id&&text(l.loan_id)&&text(l.responsibility_id)
    &&id(l.normal_occurrence_id)&&id(l.location_group_id)&&ids(l.included_location_ids)&&modes.has(l.service_mode)
    &&(l.coverer_id===null||id(l.coverer_id)));
   const s=byId.get(l.normal_occurrence_id),w=window(l);
   requireValue(s&&l.normal_owner_id===s.assigned_employee_id&&l.location_group_id===s.location_group_id
    &&l.service_mode===s.service_mode&&same([...l.included_location_ids].sort(),[...s.included_location_ids].sort())
    &&w.start>=window(s).start&&w.end<=window(s).end,'SOURCE_BINDING_MISMATCH');
   if(!loans.has(s.segment_id))loans.set(s.segment_id,[]);loans.get(s.segment_id).push(l);
  }
  const effective=(s,before)=>{
   const matches=(loans.get(s.segment_id)||[]).filter(l=>active(l,before));
   requireValue(matches.length<=1,'SOURCE_AMBIGUOUS');
   return {employee_id:matches.length?matches[0].coverer_id:s.assigned_employee_id,loan:matches[0]||null};
  };
  const physicalByOccurrence=new Map();
  unique(physical,p=>[p.occurrence_id,p.location_id,p.coverage_start,p.coverage_end].join('|'),'SOURCE_AMBIGUOUS');
  for(const p of physical){
   requireValue(exact(p,physicalKeys));binding(p);const w=window(p),s=byId.get(p.occurrence_id);
   requireValue(s&&s.service_mode==='scan_tracked'&&s.included_location_ids.includes(p.location_id)&&p.location_group_id===s.location_group_id
    &&p.assignment_status===s.status&&w.start>=window(s).start&&w.end<=window(s).end,'SOURCE_BINDING_MISMATCH');
   requireValue(p.assigned_employee_id===null||id(p.assigned_employee_id));
   requireValue(['static_weekly_projection','static_weekly_lunch_coverage'].includes(p.authority_source));
   if(!physicalByOccurrence.has(s.segment_id))physicalByOccurrence.set(s.segment_id,[]);physicalByOccurrence.get(s.segment_id).push(p);
  }
  function at(before){
   const units=new Map();
   const add=(key,s,owner,loan)=>{
    requireValue(!units.has(key),'SOURCE_AMBIGUOUS');
    units.set(key,{unit_key:key,employee_id:owner,recipient_kind:owner===null?'NO_EMPLOYEE_RECIPIENT':'EMPLOYEE',occurrence_id:s.segment_id,location_group_id:s.location_group_id,
     service_mode:s.service_mode,loan_id:loan?.loan_id||null,responsibility_id:loan?.responsibility_id||null});
   };
   for(const s of segments.filter(s=>active(s,before))){
    const owner=effective(s,before);
    if(s.service_mode!=='scan_tracked'){add('DUTY:'+s.service_mode+':'+s.location_group_id,s,owner.employee_id,owner.loan);continue;}
    const actual=(physicalByOccurrence.get(s.segment_id)||[]).filter(p=>active(p,before));
    requireValue(actual.length===s.included_location_ids.length,'SOURCE_INCOMPLETE');
    for(const p of actual){
     requireValue(p.assigned_employee_id===owner.employee_id&&p.authority_source===(owner.loan?'static_weekly_lunch_coverage':'static_weekly_projection'),'SOURCE_BINDING_MISMATCH');
     add('LOCATION:'+p.location_id,s,p.assigned_employee_id,owner.loan);
    }
   }
   requireValue(units.size<=NATIVE_SCHEDULE_SOURCE_LIMITS.units,'SOURCE_LIMIT_EXCEEDED');
   return units;
  }
  const before=at(true),after=at(false),employee=request.employeeId;
  const own=map=>[...map.values()].filter(v=>v.employee_id===employee).map(v=>v.unit_key).sort();
  const beforeKeys=own(before),afterKeys=own(after),changed=[...new Set([...beforeKeys,...afterKeys])].sort()
   .filter(k=>beforeKeys.includes(k)!==afterKeys.includes(k));
  // Source binding changes do not create another logical episode. A future
  // durable reservation must reject conflicting bytes for this same key.
  const logicalKey='schedule-ownership:'+request.serviceDate+':'+employee+':'+NATIVE_SCHEDULE_BOUNDARY;
  const semantic={service_date:request.serviceDate,employee_id:employee,boundary_local:NATIVE_SCHEDULE_BOUNDARY,
   before_units:beforeKeys,after_units:afterKeys};
  const sourceEvidence={authority:a,segments:sorted(segments),physical:sorted(physical),lunch:sorted(lunch),target:targetBefore};
  const occurrence=changed.length?{logical_key:logicalKey,semantic_sha256:digest(semantic),source_sha256:digest(sourceEvidence),
   service_date:request.serviceDate,boundary_local:NATIVE_SCHEDULE_BOUNDARY,employee_id:employee,
   recipient:structuredClone(targetBefore.recipient),source:structuredClone(t),before_units:beforeKeys,after_units:afterKeys,
   changes:changed.map(k=>({unit_key:k,before:before.get(k)||null,after:after.get(k)||null}))}:null;
  const result={schema:NATIVE_SCHEDULE_OCCURRENCE_SCHEMA,status:occurrence?'POLICY_AUTHORITY_REQUIRED':'NO_OWNERSHIP_CHANGE',
   reason:occurrence?'SCHEDULE_EFFECT_VALIDITY_AND_RETENTION_UNBOUND':'SEMANTIC_OWNERSHIP_UNCHANGED',delivery_admitted:false,
   dispatch_authorized:false,effect_authority:null,valid_until:null,occurrence};
  requireValue(Buffer.byteLength(JSON.stringify(result))<=NATIVE_SCHEDULE_SOURCE_LIMITS.bytes,'SOURCE_LIMIT_EXCEEDED');
  return frozen(result);
 }catch(e){
  if(['SOURCE_SHAPE_INVALID','SOURCE_LIMIT_EXCEEDED','TARGET_UNAVAILABLE','TARGET_CHANGED','SOURCE_NOT_CURRENT',
   'SOURCE_BINDING_MISMATCH','SOURCE_AMBIGUOUS','SOURCE_INCOMPLETE'].includes(e?.code))return unavailableNativeScheduleSource(e.code);
  throw e;
 }
}
