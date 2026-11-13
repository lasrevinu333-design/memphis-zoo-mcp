// Corrected October 1 Brandy workbook, weekly continuation explicitly approved
// November 4, 2026. Dated cover changes override the recurring rota.
// MOD is an operational display assignment, not an authentication grant.
// Null manager_id means no verified login identity is bound to this display name.
const person=(name,manager_id=null)=>Object.freeze({name,manager_id});
const weekly=Object.freeze([
  person('Eric Operle','00000000-0000-4000-8000-000000000001'),
  person('Brandy Gull'),person('Haley Lejman'),
  person('Eric McKenney','6b0a218b-6a1b-4ba6-a44e-6867e4816bc9'),
  person('Jennifer Sheffield'),person('Haley Lejman'),person('Josh'),
]);
const dated=Object.freeze({
  '2026-11-11':weekly[3], // Owner confirmation November 10.
  '2026-11-12':weekly[4], // Owner dated confirmation November 12.
  '2026-11-13':weekly[5], // Owner explicit assignment November 13.
});
export function managerOnDuty(serviceDate, {datedOverrides=dated}={}) {
  if(typeof serviceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
    ||!Number.isFinite(Date.parse(serviceDate+'T12:00:00Z'))
    ||new Date(serviceDate+'T12:00:00Z').toISOString().slice(0,10)!==serviceDate)throw Error('Invalid MOD service date');
  // A verified dated cover change always takes precedence over recurrence.
  const explicit=Object.hasOwn(datedOverrides,serviceDate);
  const person=explicit?datedOverrides[serviceDate]
    :serviceDate>='2026-11-04'?weekly[new Date(serviceDate+'T12:00:00Z').getUTCDay()]:null;
  return {schema:'custodial.manager-on-duty.v1',service_date:serviceDate,
    state:person?'confirmed':'unavailable',manager_id:person?.manager_id??null,name:person?.name??null};
}
export function chicagoServiceDate(now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
