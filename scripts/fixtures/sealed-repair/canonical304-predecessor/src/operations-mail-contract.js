// Pure adapters for an eventual independently admitted Outlook collector.
// These functions are NOT an authentication boundary or a new ingestion API.
// Only the existing trusted collector may supply unquoted notification fields
// and attachment cells. No mailbox access, writes or background loop here.
const ZONE = 'America/Chicago';
const SHA = /^[a-f0-9]{64}$/;
const fail = code => { throw new Error(code); };
const clean = (v, limit=240) => typeof v === 'string' && v.length <= limit && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : '';
const dateParts = value => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
export function chicagoInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) fail('local_date_time_invalid');
  const wall=Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0,16)!==`${date}T${time}`) fail('local_date_time_invalid');
  const matches=[];
  for (const hours of [5,6]) {
    const value=wall+hours*3600000,p=dateParts(value);
    if (`${p.year}-${p.month}-${p.day}`===date && `${p.hour}:${p.minute}`===time) matches.push(new Date(value).toISOString());
  }
  if (matches.length!==1) fail(matches.length?'ambiguous_local_time':'nonexistent_local_time');
  return matches[0];
}
function source(value, sender) {
  if (value?.mailbox!=='eoperle@memphiszoo.org' || value.sender!==sender
    || !clean(value.message_id,500) || !SHA.test(value.content_sha256)
    || typeof value.source_at!=='string' || !/Z$/.test(value.source_at) || !Number.isFinite(Date.parse(value.source_at))) fail('mail_source_binding_invalid');
  return {message_id:value.message_id,content_sha256:value.content_sha256,source_at:value.source_at};
}
export function spiceworksObservation(input) {
  const provenance=source(input?.source,'help@memzoomaint.on.spiceworks.com');
  if (!/^[1-9]\d{0,9}$/.test(input.ticket_id) || !Array.isArray(input.change_lines)
    || input.change_lines.length>20) fail('ticket_notification_invalid');
  const changes={};
  for (const line of input.change_lines) {
    // Full anchored structured change rows only, not prose, quoted history,
    // suggestions to close, or words in a ticket's description.
    const status=/^changed status from (Open|Closed|Pending|Waiting) -> (Open|Closed|Pending|Waiting)$/.exec(line);
    const field=/^set (category|assignee) to (.{1,160})$/.exec(line);
    let key,value;
    if (status) {key='status';value=status[2];}
    else if (field) {key=field[1];value=clean(field[2],160);}
    else continue;
    if (!value || Object.hasOwn(changes,key)) fail('ambiguous_ticket_change');
    changes[key]=value;
  }
  if (!Object.keys(changes).length) fail('no_authoritative_ticket_change');
  return {ticket_id:input.ticket_id,title:clean(input.title,240)||null,changes,provenance};
}
export function reconcileSpiceworks(observations) {
  if (!Array.isArray(observations) || observations.length>10000) fail('ticket_history_limit');
  const messages=new Map(),tickets=new Map();
  for (const observation of observations) {
    // Revalidate raw input; caller cannot inject an already-normalized record.
    const row=spiceworksObservation(observation),p=row.provenance,prior=messages.get(p.message_id);
    const serialized=JSON.stringify(row);
    if (prior && prior!==serialized) fail('conflicting_mail_replay');
    if (prior) continue;
    messages.set(p.message_id,serialized);
    const ticket=tickets.get(row.ticket_id)||{ticket_id:row.ticket_id,fields:{},provenance:[]};
    ticket.provenance.push(p);
    for (const [key,value] of Object.entries({...row.changes,...(row.title?{title:row.title}:{})})) {
      const current=ticket.fields[key],at=Date.parse(p.source_at);
      if (current && at===current.at && current.value!==value) fail('conflicting_same_time_ticket_change');
      if (!current || at>current.at) ticket.fields[key]={value,at};
    }
    tickets.set(row.ticket_id,ticket);
  }
  return [...tickets.values()].sort((a,b)=>Number(a.ticket_id)-Number(b.ticket_id)).map(ticket=>{
    const f=Object.fromEntries(Object.entries(ticket.fields).map(([key,row])=>[key,row.value]));
    return {ticket_id:ticket.ticket_id,title:f.title||null,category:f.category||null,assignee:f.assignee||null,
      status:f.status||'Unknown',custodial:f.category==='Custodial'||(!f.category&&f.assignee==='Eric Operle'),
      active:f.status!=='Closed',provenance:ticket.provenance.sort((a,b)=>a.source_at.localeCompare(b.source_at)||a.message_id.localeCompare(b.message_id))};
  });
}
export const SCHOOL_HEADERS=Object.freeze(['Order ID','Cust Name','Buses','item purchased','visit date of tickets','Visit Time','Qty of purchase']);
function excelDate(v) {
  if (typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (!Number.isInteger(v)||v<61||v>100000) fail('school_visit_date_invalid');
  return new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,10);
}
function excelTime(v) {
  if (typeof v==='string' && /^\d{2}:\d{2}(?::00)?$/.test(v)) return v.slice(0,5);
  if (typeof v!=='number'||!Number.isFinite(v)||v<0||v>=1) fail('school_arrival_invalid');
  const minutes=Math.round(v*1440);
  return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}
export function projectSchoolAttachment({headers,rows,source:inputSource,attachment,date_system='1900'}) {
  const mail=source(inputSource,'aferguson@memphiszoo.org');
  if(!clean(attachment?.id,500)||!SHA.test(attachment?.sha256))fail('school_attachment_binding_invalid');
  const provenance={...mail,attachment_id:attachment.id,attachment_sha256:attachment.sha256};
  if (date_system!=='1900'||JSON.stringify(headers)!==JSON.stringify(SCHOOL_HEADERS)
    ||!Array.isArray(rows)||rows.length>5000) fail('school_attachment_format_invalid');
  const groups=new Map();let current=null;
  for (const row of rows) {
    if (!Array.isArray(row)||row.length>7) fail('school_row_invalid');
    const [id,name,buses,product,date,time,qty]=row;
    if (row.every(v=>v==null||v==='') || /^(?:MON(?:DAY)?|TUE(?:SDAY)?|WED(?:NESDAY)?|THU(?:RSDAY)?|FRI(?:DAY)?|SAT(?:URDAY)?|SUN(?:DAY)?|TOTAL)$/i.test(String(id||name||''))) {current=null;continue;}
    if (id!=null&&id!=='') {
      if (!/^[1-9]\d*$/.test(String(id))||!clean(name)||!(buses==null||buses===''||(Number.isSafeInteger(buses)&&buses>=0))) fail('school_order_invalid');
      const visit=excelDate(date),arrival=time==null||time===''?null:excelTime(time),key=`${id}:${visit}`;
      if (groups.has(key)) fail('duplicate_school_order_block');
      // Validate the visit date even when arrival is absent. This noon
      // conversion is admission only, never a projected departure/cutoff.
      chicagoInstant(visit,'12:00');
      const start=arrival===null?null:chicagoInstant(visit,arrival);
      // The admitted seven-column attachment has no departure field. Keep
      // that unknown; a display/planning cutoff is not source evidence.
      current={id:key,order_id:String(id),name:clean(name),date:visit,arrival_at:start,departure_at:null,
        departure_source:null,status:start===null?'REVIEW_REQUIRED':'SCHEDULED',
        issue:start===null?'Arrival not provided.':null,
        students:0,chaperones:0,teachers:0,unclassified:0,buses:buses===''||buses==null?null:buses,
        provenance,notes:null};groups.set(key,current);
    } else if (!current || [name,buses,date,time].some(v=>v!=null&&v!=='')) fail('school_continuation_identity_invalid');
    if (!current||!Number.isSafeInteger(qty)||qty<0||!clean(product)) fail('school_quantity_invalid');
    const key=/^Field Trip (?:Elem Student 1-5|High Student 9-12|Middle Student 6-8|College Student)$/.test(product)?'students'
      :product==='Field Trip Paid Chaperone'?'chaperones':product==='Field Trip Teacher'?'teachers':'unclassified';
    current[key]+=qty;
    if (!Number.isSafeInteger(current[key])) fail('school_quantity_overflow');
  }
  return [...groups.values()].map(group=>{const adults=group.chaperones+group.teachers,total=group.students+adults+group.unclassified;
    if(!Number.isSafeInteger(total))fail('school_quantity_overflow');return{...group,adults,total};});
}

// The collector must establish that each named date is a COMPLETE replacement
// list, not an incremental mail or a guessed date range from a filename. Without
// that authority a missing row is never treated as a cancellation. This pure
// reconciliation is not a collector, database or permission to activate one.
export function reconcileSchoolSnapshots(snapshots) {
  if(!Array.isArray(snapshots)||snapshots.length>200)fail('school_history_limit');
  const byDate=new Map(),messages=new Map();
  for(const snapshot of snapshots){
    const dates=snapshot.complete_for_dates;
    if(!Array.isArray(dates)||!dates.length||dates.length>31||new Set(dates).size!==dates.length)fail('complete_school_dates_required');
    for(const date of dates)chicagoInstant(date,'13:00');
    const rows=projectSchoolAttachment(snapshot);
    if(rows.some(row=>!dates.includes(row.date)))fail('school_snapshot_scope_mismatch');
    const identity=`${snapshot.source.message_id}:${snapshot.attachment.id}`,bytes=JSON.stringify(snapshot);
    if(messages.has(identity)){if(messages.get(identity)!==bytes)fail('conflicting_school_replay');continue;}
    messages.set(identity,bytes);
    for(const date of dates){const list=byDate.get(date)||[];
      list.push({at:Date.parse(snapshot.source.source_at),identity,rows:rows.filter(row=>row.date===date),provenance:{
        ...source(snapshot.source,'aferguson@memphiszoo.org'),attachment_id:snapshot.attachment.id,attachment_sha256:snapshot.attachment.sha256}});
      byDate.set(date,list);
    }
  }
  const current=[],history=[];
  for(const [date,versions]of [...byDate].sort(([a],[b])=>a.localeCompare(b))){
    versions.sort((a,b)=>a.at-b.at||a.identity.localeCompare(b.identity));
    for(let i=1;i<versions.length;i++)if(versions[i].at===versions[i-1].at)fail('ambiguous_school_snapshot_order');
    const latest=versions.at(-1),activeIds=new Set(latest.rows.map(row=>row.id)),lastKnown=new Map();
    for(const version of versions.slice(0,-1))for(const row of version.rows){
      history.push({...row,status:'SUPERSEDED',superseded_by:latest.provenance});lastKnown.set(row.id,row);
    }
    current.push(...latest.rows);
    for(const [id,row]of lastKnown)if(!activeIds.has(id))current.push({...row,status:'CANCELLED',
      issue:'Absent from a newer complete date list.',provenance:latest.provenance,prior_provenance:row.provenance,date});
  }
  if(current.length+history.length>20000)fail('school_history_limit');
  return{rows:current,history};
}
