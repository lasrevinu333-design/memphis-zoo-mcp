const ZONE = 'America/Chicago';
const minute = 60_000;
const numeric = value => value !== null && value !== undefined && value !== '' && !(typeof value === 'string' && !value.trim())
  && (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) ? Number(value) : null;
const stamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
export function zooServiceDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const take = key => parts.find(part=>part.type===key).value;
  return `${take('year')}-${take('month')}-${take('day')}`;
}
export function timeMinutes(value) {
  const raw=String(value??'').trim();
  const military=raw.match(/^(\d{2}):(\d{2})(?::00)?$/);
  if(military&&Number(military[1])<24&&Number(military[2])<60)return Number(military[1])*60+Number(military[2]);
  const civil=raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(!civil||Number(civil[1])<1||Number(civil[1])>12||Number(civil[2])>59)return null;
  return (Number(civil[1])%12+(civil[3].toUpperCase()==='PM'?12:0))*60+Number(civil[2]);
}
const clock = value => `${Math.floor(value/60)%12||12}:${String(value%60).padStart(2,'0')} ${value<720?'AM':'PM'}`;
export function sourceLabel(value, now=Date.now(), limit=60*minute, forcedStale=false) {
  const when=stamp(value),age=now-when;
  if(!Number.isFinite(when)||age< -minute)return {stale:true,label:'Update time unavailable'};
  const label=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(when));
  return {stale:forcedStale||age>limit,label:`${forcedStale||age>limit?'Last update':'Updated'} ${label}`};
}
export function scheduleFacts(data, identity, receivedAt, now=Date.now()) {
  const unavailable={shift:'Schedule unavailable',lunch:'Lunch unavailable',stale:true,detail:'Open Schedule for the latest assignments.'};
  if(!data||data.service_date!==zooServiceDate(now))return unavailable;
  const ids=[data.canonical_device_id,data.device_id].filter(Boolean).map(value=>String(value).toUpperCase());
  if(!ids.length||ids.some(value=>value!==identity.deviceId))return unavailable;
  const employeeId=String(data.employee_id||data.employee?.id||'');
  const employeeName=String(data.employee_name||data.employee?.display_name||'').trim();
  if(identity.employeeId ? employeeId!==identity.employeeId : !employeeName||employeeName!==identity.employeeName)return unavailable;
  if(data.projection_status==='blocked_recurring_authority')return {...unavailable,detail:'Schedule pending a manager’s updated plan. Saved cleaning work is preserved.'};
  if(data.projection_status&&data.projection_status!=='current')return {...unavailable,detail:'Schedule update required.'};
  const freshness=sourceLabel(receivedAt,now,5*minute,data.stale===true);
  if(data.schedule_status==='off'||data.phase==='off_day'||data.shift?.active===false)
    return {shift:'Not scheduled today',lunch:'Not scheduled',...freshness,detail:freshness.label};
  const start=timeMinutes(data.shift?.shift_start??data.shift?.start),end=timeMinutes(data.shift?.shift_end??data.shift?.end);
  if(start===null||end===null||end<=start)return unavailable;
  const lunchStart=timeMinutes(data.lunch?.start??data.shift?.lunch_start),lunchEnd=timeMinutes(data.lunch?.end??data.shift?.lunch_end);
  const lunch=lunchStart!==null&&lunchEnd!==null&&lunchStart>=start&&lunchEnd<=end&&lunchEnd>lunchStart
    ? `${clock(lunchStart)}–${clock(lunchEnd)}`:'Lunch not published';
  return {shift:`${clock(start)}–${clock(end)}`,lunch,...freshness,detail:freshness.label};
}
export function attendanceFacts(data,now=Date.now()) {
  const count=numeric(data?.attendance);
  if(count===null||!Number.isSafeInteger(count)||count<0||data?.available===false)
    return {value:'Unavailable',stale:true,detail:'Guest count has not been verified.'};
  const fresh=sourceLabel(data.source_timestamp??data.fetched_at??data.updated_at,now,60*minute,data.stale===true);
  const optional=value=>{const n=numeric(value);return n!==null&&Number.isSafeInteger(n)&&n>=0?n.toLocaleString('en-US'):'--';};
  return {value:count.toLocaleString('en-US'),...fresh,detail:fresh.label,
    comparison:`Planned ${optional(data.planned)} · Last Year ${optional(data.last_year)} / Plan ${optional(data.yesterday_plan)}`};
}
// Original Team Hub weather: current conditions, today's high/low, wind and
// current-hour precipitation. These are informational facts, never work authority.
export function currentWeatherFacts(data,receivedAt,now=Date.now()) {
  const missing={temperature:'Unavailable',condition:'',icon:'--',summary:'',stale:true,detail:'Weather feed unavailable.'};
  const current=data?.current,units=data?.current_units,temperature=numeric(current?.temperature_2m),observed=numeric(current?.time);
  if(temperature===null||observed===null||units?.time!=='unixtime'||!['°F','°C'].includes(units.temperature_2m))return missing;
  const observedMs=observed*1000;
  if(!Number.isFinite(observedMs)||observedMs>now+minute||observedMs<now-24*60*minute)return missing;
  const fresh=sourceLabel(new Date(observedMs).toISOString(),now,60*minute,data?.stale===true||sourceLabel(receivedAt,now).stale);
  const c=numeric(current.weather_code),f=value=>Math.round(units.temperature_2m==='°C'?value*9/5+32:value);
  let condition='',icon='🌡️';
  if(c===0){condition='clear';icon='☀️';}
  else if([1,2].includes(c)){condition='partly cloudy';icon='🌤️';}
  else if(c===3){condition='cloudy';icon='☁️';}
  else if([45,48].includes(c)){condition='foggy';icon='🌫️';}
  else if([51,53,55,56,57].includes(c)){condition='drizzle';icon='🌦️';}
  else if([61,63,65,66,67,80,81,82].includes(c)){condition='rain';icon='🌧️';}
  else if([71,73,75,77,85,86].includes(c)){condition='snow';icon='❄️';}
  else if([95,96,99].includes(c)){condition='thunderstorms';icon='⛈️';}
  const summary=[],daily=data?.daily,dayIndex=Array.isArray(daily?.time)?daily.time.findIndex(value=>{
    const epoch=numeric(value);return epoch!==null&&Number.isFinite(epoch*1000)&&Math.abs(epoch*1000-now)<48*60*minute&&zooServiceDate(epoch*1000)===zooServiceDate(now);
  }):-1;
  const high=numeric(daily?.temperature_2m_max?.[dayIndex]),low=numeric(daily?.temperature_2m_min?.[dayIndex]);
  if(dayIndex>=0&&data.daily_units?.time==='unixtime'&&data.daily_units?.temperature_2m_max===units.temperature_2m&&data.daily_units?.temperature_2m_min===units.temperature_2m&&high!==null&&low!==null&&high>=low)summary.push(`High ${f(high)}° / Low ${f(low)}°`);
  const wind=numeric(current.wind_speed_10m);
  if(wind!==null&&wind>=0&&['mp/h','mph'].includes(units.wind_speed_10m))summary.push(`${Math.round(wind)} mph`);
  const times=data?.hourly?.time;
  const hourIndex=Array.isArray(times)&&data.hourly_units?.time==='unixtime'?times.findIndex(value=>{
    const epoch=numeric(value);return epoch!==null&&epoch*1000<=now&&now<epoch*1000+60*minute;
  }):-1;
  const rain=numeric(data?.hourly?.precipitation_probability?.[hourIndex]);
  if(hourIndex>=0&&data.hourly_units?.precipitation_probability==='%'&&rain!==null&&rain>=0&&rain<=100)summary.push(`Precipitation ${Math.round(rain)}%`);
  return {temperature:`${f(temperature)}°F`,condition,icon,summary:summary.join(' · '),...fresh,detail:`Open-Meteo · ${fresh.label}`};
}
// Informational forecast and warnings; neither source is employee GPS or work authority.
export const HOME_WEATHER_URL='https://api.open-meteo.com/v1/forecast?latitude=35.1506&longitude=-89.9944&current=temperature_2m,weather_code,wind_speed_10m,apparent_temperature&hourly=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime&timezone=America%2FChicago&forecast_days=2';
export const HOME_WEATHER_ALERTS_URL='https://api.weather.gov/alerts/active?point=35.1506,-89.9944';
export function weatherCondition(code) {
  const value=numeric(code);
  if(value===0)return 'Clear';
  for(const [codes,label] of [[[1,2],'Partly cloudy'],[[3],'Cloudy'],[[45,48],'Fog'],[[51,53,55,56,57],'Drizzle'],[[61,63,65,66,67,80,81,82],'Rain'],[[71,73,75,77,85,86],'Snow'],[[95,96,99],'Thunderstorms']])if(codes.includes(value))return label;
  return 'Unavailable';
}
export function weatherFacts(data,receivedAt,now=Date.now()) {
  const fresh=sourceLabel(receivedAt,now,60*minute,data?.stale===true),hourly=data?.hourly,units=data?.hourly_units;
  if(!hourly||!Array.isArray(hourly.time)||!Array.isArray(hourly.temperature_2m))return {hours:[],stale:true,detail:'Hourly weather unavailable.'};
  if(units?.time!=='unixtime'||!['°F','°C'].includes(units.temperature_2m))return {hours:[],stale:true,detail:'Weather units unavailable.'};
  const temperature=(value,unit)=>{const n=numeric(value);return n!==null&&['°F','°C'].includes(unit)?`${Math.round(unit==='°C'?n*9/5+32:n)}°F`:'Unavailable';};
  const candidates=hourly.time.map((time,index)=>({time:numeric(time),index})).filter(row=>row.time!==null&&row.time*1000+60*minute>now&&row.time*1000<=now+8*60*minute).sort((a,b)=>a.time-b.time);
  const hours=[];
  for(const {time,index:i} of candidates){
    if(hours.length===8)break;
    if(hours.some(row=>row.time===time)||numeric(hourly.temperature_2m[i])===null)continue;
    const probability=numeric(hourly.precipitation_probability?.[i]),wind=numeric(hourly.wind_speed_10m?.[i]);
    const windUnit=units.wind_speed_10m,windMph=wind!==null&&wind>=0?['mp/h','mph'].includes(windUnit)?wind:windUnit==='km/h'?wind/1.609344:null:null;
    hours.push({time,label:new Intl.DateTimeFormat('en-US',{timeZone:ZONE,hour:'numeric'}).format(new Date(time*1000)),temperature:temperature(hourly.temperature_2m[i],units.temperature_2m),
      feelsLike:temperature(hourly.apparent_temperature?.[i],units.apparent_temperature),condition:weatherCondition(hourly.weather_code?.[i]),wind:windMph===null?'Unavailable':`${Math.round(windMph)} mph`,
      rain:units.precipitation_probability==='%'&&probability!==null&&probability>=0&&probability<=100?`${Math.round(probability)}% rain`:'Unavailable'});
  }
  return {hours,...fresh,stale:!hours.length||fresh.stale,detail:hours.length?`Open-Meteo · ${fresh.label}`:'Hourly weather unavailable.'};
}
export function weatherAlertsFacts(data,receivedAt,now=Date.now()) {
  const fresh=sourceLabel(receivedAt,now,5*minute,data?.stale===true);
  const missing={alerts:[],available:false,stale:true,detail:'Weather warnings unavailable.'};
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))return missing;
  let malformed=false;const byId=new Map();
  for(const feature of data.features){
    const p=feature?.properties,id=String(p?.id||feature?.id||'').trim();
    if(!p||!id||!p.status||!p.scope){malformed=true;continue;}
    if(p.status!=='Actual'||p.scope!=='Public')continue;
    if(p.messageType==='Cancel'){byId.delete(id);continue;}
    const effective=stamp(p.effective),expires=stamp(p.expires),sent=stamp(p.sent),end=p.ends?stamp(p.ends):expires;
    if(!['Alert','Update'].includes(p.messageType)||!String(p.event||'').trim()||![effective,expires,sent,end].every(Number.isFinite)||expires<=effective||sent>now+minute){malformed=true;continue;}
    if(effective>now||Math.min(end,expires)<=now)continue;
    const event=String(p.event),instruction=String(p.instruction||'');
    const interrupt=!fresh.stale&&p.urgency==='Immediate'&&['Severe','Extreme'].includes(p.severity)&&['Tornado Warning','Severe Thunderstorm Warning'].includes(event);
    const row={id,event,headline:String(p.headline||event),instruction,description:String(p.description||''),expires:new Date(Math.min(end,expires)).toISOString(),sent:p.sent,interrupt,source:'National Weather Service'};
    if(!byId.has(id)||stamp(byId.get(id).sent)<sent)byId.set(id,row);
  }
  const alerts=[...byId.values()].sort((a,b)=>Number(b.interrupt)-Number(a.interrupt)||a.id.localeCompare(b.id));
  return {alerts,available:!malformed,stale:malformed||fresh.stale,detail:malformed?'Some weather warnings could not be verified.':`National Weather Service · ${fresh.label}${!alerts.length&&!fresh.stale?' · No active alerts reported.':''}`};
}

const escapeFact=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function weatherHoursHtml(value) {
  return (value?.hours||[]).map(hour=>`<li><span>${escapeFact(hour.label)}</span><strong>${escapeFact(hour.temperature)}</strong><span>Feels like ${escapeFact(hour.feelsLike)}</span><span>${escapeFact(hour.condition)}</span><span>Wind ${escapeFact(hour.wind)}</span><span>${escapeFact(hour.rain)}</span></li>`).join('');
}
export function weatherAlertsHtml(value) {
  return (value?.alerts||[]).map(alert=>`<li data-urgent="${alert.interrupt===true}"><strong>${escapeFact(alert.headline)}</strong>${alert.instruction?`<p>${escapeFact(alert.instruction)}</p>`:''}<small>Expires ${escapeFact(new Intl.DateTimeFormat('en-US',{timeZone:ZONE,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(alert.expires)))}</small></li>`).join('');
}
export function homeIdentity(profile,deviceId) {
  const id=String(deviceId||'').trim().toUpperCase();
  if(!/^KIOSK_(0[2-9]|10)$/.test(id)||profile?.authenticated!==true
    ||String(profile.canonical_device_id||profile.device_id||'').toUpperCase()!==id)return null;
  const employeeName=String(profile.employee_name||profile.employee?.display_name||'').trim();
  if(!employeeName)return null;
  return {deviceId:id,employeeId:String(profile.employee_id||profile.employee?.id||''),employeeName,
    credentialId:String(profile.credential_id||''),assignmentEpoch:profile.assignment_epoch??null};
}
export function homeBinding(identity) {
  return identity?JSON.stringify([identity.deviceId,identity.employeeId,identity.employeeName,identity.credentialId,
    identity.assignmentEpoch??null,identity.protectedBinding||'']):'';
}
