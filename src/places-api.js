import express from 'express';
import { applyPlaceCommand,readPlacePreview } from './place-lifecycle.js';

export function placeHttpFailure(error){
 const code=String(error?.code||'');
 if(error?.name==='ZodError')return {status:422,body:{ok:false,code:'invalid_place_input',command_rejected:true,error:'Review the bounded place fields before confirming.'}};
 if(['22023','22P02','23505','23514','40001','55000'].includes(code))return {status:['22023','22P02'].includes(code)?422:409,
  body:{ok:false,code,command_rejected:true,error:String(error.message||'Place command rejected; refresh and review.')}};
 if(code==='42501')return {status:403,body:{ok:false,code,error:'An active Custodial Manager is required. Saved operations remain protected.'}};
 return {status:503,body:{ok:false,code:'place_outcome_unconfirmed',command_rejected:false,
  error:'The place outcome is not confirmed. Retain the same saved request and reconcile it before creating another command.'}};
}

export function createPlacesAdminRouter({client,requireManagerWrite}={}){
 if(typeof requireManagerWrite!=='function')throw new TypeError('Place administration requires the existing manager write guard.');
 const router=express.Router();
 router.use(requireManagerWrite,(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!req.memphisAuth?.roles?.includes('CUSTODIAL_MANAGER')||req.memphisAuth?.read_only){
   res.status(403).json({ok:false,code:'custodial_manager_required',error:'Full named Custodial Manager access is required.'});return;
  }
  if(!client){res.status(503).json({ok:false,code:'places_unavailable',error:'Place authority is unavailable; existing catalogs and saved work are unchanged.'});return;}
  next();
 });
 router.get('/preview',async(req,res)=>{
  try{
   const data=await readPlacePreview(req,req.query,{client});
   res.json({ok:true,data});
  }catch(error){const failure=placeHttpFailure(error);res.status(failure.status).json(failure.body);}
 });
 router.post('/commands',async(req,res)=>{
  try{
   if(Buffer.byteLength(JSON.stringify(req.body??null),'utf8')>32768){
    res.status(422).json({ok:false,code:'invalid_place_input',command_rejected:true,error:'Place command exceeds its bounded size.'});return;
   }
   const data=await applyPlaceCommand(req,req.body,{client});
   res.json({ok:true,request_id:req.body.request_id,outcome:data.replayed?'replayed':'applied',data,legacy_consumer_cutover:false});
  }catch(error){const failure=placeHttpFailure(error);res.status(failure.status).json(failure.body);}
 });
 return router;
}
