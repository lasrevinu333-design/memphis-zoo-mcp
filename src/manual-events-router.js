import express from 'express';
import {createManualEventBridge,validateManualEventInput} from './auth/manual-events-operation.mjs';
import {getEventReferenceData} from './events-api.js';
import {parseManualEventTexts} from './manual-events-parser.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const formats=new Set(['paste','csv','spreadsheet','manual_form']);
const columns='id,revision,event_name,event_scope,status,primary_venue_id,venue_ids,display_location,location_group_id,coverage_location_ids,staffing_area_ids,source_location_text,parser_confidence,needs_review,parse_reason,source_text,source_format,manually_overridden,overridden_by,overridden_at,event_timezone,operation_id,event_date,end_date,start_time,end_time,start_instant_utc,end_instant_utc,attendee_count,notes,custodial_note_codes,custodial_public_notes,created_by_manager_id';

function binding(req,write=false){
 const s=req.memphisAuth;
 if(s?.role!=='ops_manager'||!uuid.test(s.manager_id||'')||!uuid.test(s.credential_id||'')
  ||typeof s.device_id!=='string'||!s.device_id||!s.token||!Number.isFinite(Date.parse(s.expires_at))||Date.parse(s.expires_at)<=Date.now()
  ||write&&(s.read_only===true||s.access_level!=='full_access'))throw fail('Current manager access is required.',403);
 return JSON.stringify([s.manager_id,s.credential_id,s.device_id,s.token,s.expires_at,s.access_level,s.read_only]);
}

// Deterministic intake; mutations use the current signed cohort transaction.
export function createManualEventsRouter({runReadOnlySql,requireOpsManagerAuth,requireOpsManagerWrite,bridge=createManualEventBridge()}){
 if(!runReadOnlySql||!requireOpsManagerAuth||!requireOpsManagerWrite||typeof bridge!=='function')throw new TypeError('Manual event authority dependencies are required.');
 const router=express.Router();
 router.use(requireOpsManagerAuth,(req,res,next)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization, X-Device-Id');next();});
 const route=(action,write=false)=>async(req,res)=>{
  try{
   const original=binding(req,write),managerId=req.memphisAuth.manager_id;
   const current=()=>{if(binding(req,write)!==original)throw fail('Manager access changed. Reload before continuing.',403);};
   const recheck=async()=>{
    await new Promise((resolve,reject)=>{
     let done=false;const finish=e=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve();};
     const timer=setTimeout(()=>finish(fail('Manager access could not be rechecked.',503)),6000);
     const sink={headersSent:false,writableEnded:false,setHeader(){},status(){return this;},json(){finish(fail('Manager access is no longer available.',403));return this;}};
     try{Promise.resolve((write?requireOpsManagerWrite:requireOpsManagerAuth)(req,sink,()=>finish())).catch(finish);}catch(e){finish(e);}
    });current();
   };
   const read=async sql=>{current();const rows=await runReadOnlySql(sql);await recheck();return rows;};
   const data=await action({req,read,current,recheck,managerId});current();res.json({ok:true,data});
  }catch(e){res.status([400,403,404,409].includes(e?.status)?e.status:503).json({ok:false,error:e.message||'Manual event action unavailable.',...(e?.unknown?{state:'OUTCOME_UNKNOWN',retry_safe:false}:{})});}
 };
 router.get('/',route(async({read})=>read(`select ${columns} from public.events_app_events where event_date >= (now() at time zone 'America/Chicago')::date - 7 and coalesce(status,'SCHEDULED') <> 'CANCELLED' order by event_date,start_time,id limit 200`)));
 for(const [path,key] of [['location-groups','locationGroups'],['event-venues','eventVenues'],['coverage-locations','locationGroups']])router.get('/'+path,route(async({read})=>{
  const data=await getEventReferenceData(read);return path==='coverage-locations'?data[key].filter(r=>r.eligible_custodial_coverage!==false):data[key];
 }));
 router.post('/parse',route(async({req,read})=>{
  const body=req.body;if(!body||typeof body!=='object'||Array.isArray(body))throw fail('Event text is required.');
  if(Object.keys(body).some(k=>!['text','texts'].includes(k))||Object.hasOwn(body,'text')===Object.hasOwn(body,'texts'))throw fail('Supply text or texts, once.');
  const refs=await getEventReferenceData(read);
  return parseManualEventTexts({texts:body.texts??[body.text],locationGroups:refs.locationGroups,eventVenues:refs.eventVenues,eventDefaults:refs.defaultRules});
 }));
 router.get('/operation/:operationId',route(async({req})=>bridge(req,validateManualEventInput({kind:'status',operation_id:req.params.operationId}))));
 const save=updating=>route(async({req})=>{
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw fail('Reviewed event is required.');
  const {request_digest,...record}=req.body;
  return bridge(req,validateManualEventInput({kind:'save',event_id:updating?req.params.eventId:null,request_digest,record}));
 },true);
 router.post('/',requireOpsManagerWrite,save(false));
 router.put('/:eventId',requireOpsManagerWrite,save(true));
 return router;
}
