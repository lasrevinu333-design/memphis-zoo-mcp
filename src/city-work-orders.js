// Read the City's existing public Active Maintenance Requests layer. No
// credentials, writes, contact fields, staff notes or arbitrary query input.
export const CITY_ACTIVE_URL='https://maps.memphistn.gov/mapping/rest/services/GeneralServices/GenServ_PMS_Services_PROD/MapServer/0/query';
const WHERE="Facility_Code LIKE '15Z%'";
const FIELDS='OBJECTID,WorkOrderID,Facility_Code,Facility_FullName,RequestDescription,RequestStatus,RequestDate,CloseDate,last_edited_date';
const ACTIVE=new Set(['Approved','Awaiting Materials','In Progress','Ready For Review','Requested']);
const unavailable=()=>({state:'unavailable',reason:'city_source_unavailable',rows:[]});
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)?v.replace(/\s+/g,' ').trim():null;
const date=v=>v==null?null:Number.isSafeInteger(v)&&Number.isFinite(new Date(v).getTime())?new Date(v).toISOString():undefined;
export function projectCityWorkOrders(payload,count,at){
  if(!Number.isSafeInteger(count)||count<0||count>2000||!Array.isArray(payload?.features)
    ||payload.exceededTransferLimit===true||payload.features.length!==count)throw Error('city_snapshot_incomplete');
  const ids=new Set();
  const rows=payload.features.map(({attributes:r}={})=>{
    if(!r||!Number.isSafeInteger(r.OBJECTID)||ids.has(r.OBJECTID)||!ACTIVE.has(r.RequestStatus)
      ||!text(r.Facility_Code,500)?.startsWith('15Z')||!text(r.Facility_FullName||r.Facility_Code,500)
      ||(r.WorkOrderID!=null&&!text(r.WorkOrderID,30))
      ||(r.RequestDescription!=null&&r.RequestDescription!==''&&text(r.RequestDescription,1000)===null)
      ||[r.RequestDate,r.CloseDate,r.last_edited_date].some(v=>date(v)===undefined))throw Error('city_snapshot_invalid');
    ids.add(r.OBJECTID);
    return {id:String(r.OBJECTID),work_order_id:text(r.WorkOrderID,30),facility:text(r.Facility_Code,500),
      facility_label_conflict:!!text(r.Facility_FullName,500)&&text(r.Facility_FullName,500)!==text(r.Facility_Code,500),
      description:text(r.RequestDescription,1000),status:r.RequestStatus,requested_at:date(r.RequestDate),
      // A prior close date can survive reopening. The City's active layer and
      // current status govern this list; preserve the date without inferring.
      source_close_date:date(r.CloseDate),updated_at:date(r.last_edited_date)};
  });
  return {state:'current',generated_at:new Date(at).toISOString(),coverage:'city_active_zoo',rows};
}
export function makeCityWorkOrderReader({fetchImpl=globalThis.fetch,now=()=>Date.now()}={}){
  let cached=null,inFlight=null;
  return async function readCityWorkOrders(){
    if(cached&&now()-cached.at>=0&&now()-cached.at<60000)return cached.feed;
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      const signal=AbortSignal.timeout(6000),at=now();
      const get=async(extra)=>{
        const url=new URL(CITY_ACTIVE_URL);url.search=new URLSearchParams({f:'json',where:WHERE,returnGeometry:'false',...extra});
        const r=await fetchImpl(url,{signal,redirect:'error',headers:{Accept:'application/json'}});
        if(!r.ok)throw Error('city_source_unavailable');
        const body=await r.text();if(body.length>2*1024*1024)throw Error('city_source_limit');
        const data=JSON.parse(body);if(data.error)throw Error('city_source_unavailable');return data;
      };
      try{
        const [payload,total]=await Promise.all([get({outFields:FIELDS,orderByFields:'OBJECTID ASC',resultRecordCount:'2000'}),get({returnCountOnly:'true'})]);
        const feed=projectCityWorkOrders(payload,total.count,at);cached={at,feed};return feed;
      }catch{return unavailable();}
      finally{inFlight=null;}
    })();
    return inFlight;
  };
}
