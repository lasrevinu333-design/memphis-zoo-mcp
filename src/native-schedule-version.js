// Closed version/key projection only. This is never source or clock authority.
export function scheduleVersion(schema,layer){
 if(schema===`custodial.native-schedule-${layer}.v1`)return 1;
 if(schema===`custodial.native-schedule-${layer}.v2`)return 2;
 return 0;
}
export function scheduleBoundaryValid(boundary,version){
 return version===1?boundary==='09:45':version===2&&typeof boundary==='string'
  &&/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(boundary)&&boundary!=='09:45';
}
export function scheduleNotificationKey(v,employee,version){
 return version===1?`schedule-ownership:${v.service_date}:${employee}:09:45`
  :`schedule-departure:${v.service_date}:${employee}:${v.boundary_local}:projection:${v.projection_id}:revision:${v.source_revision}`;
}
export function scheduleLocalBoundary(value){
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
 return {date:`${fields.year.padStart(4,'0')}-${fields.month}-${fields.day}`,boundary:`${fields.hour}:${fields.minute}`,
  exactMinute:fields.second==='00'&&value.endsWith('00.000000Z')};
}
