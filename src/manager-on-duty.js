// Owner-confirmed operational schedule, recorded November 10, 2026.
// November's supplied workbook is blank. Only these explicit confirmations
// have authority; the October workbook is not projected into later dates.
const dated = Object.freeze({
  '2026-11-11': Object.freeze({ manager_id:'6b0a218b-6a1b-4ba6-a44e-6867e4816bc9',name:'Eric McKenney' }),
});
const sunday = Object.freeze({manager_id:'00000000-0000-4000-8000-000000000001',name:'Eric Operle'});
export function managerOnDuty(serviceDate, {datedOverrides=dated}={}) {
  if(typeof serviceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
    ||!Number.isFinite(Date.parse(serviceDate+'T12:00:00Z'))
    ||new Date(serviceDate+'T12:00:00Z').toISOString().slice(0,10)!==serviceDate)throw Error('Invalid MOD service date');
  // A verified dated cover change always takes precedence over recurrence.
  const explicit=Object.hasOwn(datedOverrides,serviceDate);
  const person=explicit?datedOverrides[serviceDate]
    :serviceDate>='2026-11-10'&&new Date(serviceDate+'T12:00:00Z').getUTCDay()===0?sunday:null;
  return {schema:'custodial.manager-on-duty.v1',service_date:serviceDate,
    state:person?'confirmed':'unavailable',manager_id:person?.manager_id??null,name:person?.name??null};
}
export function chicagoServiceDate(now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
