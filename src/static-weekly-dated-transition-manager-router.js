import {runWithManagerTransaction} from './static-weekly-manager-operation.js';
import express from 'express';

// Schedule facts are server-owned. Never fall back to the weekly mutators.
export function createDatedTransitionManagerRouter({controller,requireManagerWrite,namedManager,manager}){
 const router=express.Router();router.use(requireManagerWrite,namedManager);
 const exact=(body,keys)=>{
  if(!body||typeof body!=='object'||Array.isArray(body)
   ||Object.keys(body).length!==keys.length||keys.some(k=>!Object.hasOwn(body,k)))
   throw Object.assign(new Error('dated_transition_request_invalid'),{code:'dated_transition_request_invalid'});
 };
 const dispatch=(method,work)=>async(req,res)=>{
  try{
   if(typeof controller?.[method]!=='function'){
    res.status(503).json({ok:false,code:'dated_transition_store_unavailable_requires_bounded_database_adapter'});return;
   }
   const principal=manager(req);
   const data=await runWithManagerTransaction(req,()=>work(req,{managerId:principal?.manager_id}));
   if(req.staticWeeklyManagerOperation)await req.restoreMutationLease.settleBeforeSuccess();
   res.json({ok:true,data});
  }catch(error){
   if(req.staticWeeklyManagerOperation){try{await req.restoreMutationLease.settleBeforeSuccess();}catch(settlementError){error=settlementError;}}
   if(error?.code==='42501'){res.status(403).json({ok:false,code:'dated_transition_not_authorized'});return;}
   if(error?.code?.startsWith('static_weekly_')){res.status(503).json({ok:false,code:'dated_transition_outcome_unknown',error:'The request outcome or recovery settlement is unconfirmed. Check the original operation before retrying.'});return;}
   const code=typeof error?.code==='string'&&error.code.startsWith('dated_transition_')
    ?error.code:'dated_transition_invalid_request_or_state';
   const status=code.includes('unavailable')?503:code.includes('not_authorized')?403:
    /conflict|preview_mismatch|existing_occurrences|rollback_identity/.test(code)?409:400;
   res.status(status).json({ok:false,code});
  }
 };
 router.post('/preview',dispatch('preview',async(req,actor)=>{
  exact(req.body,['expected_revision']);return controller.preview({manager:actor,expectedRevision:req.body.expected_revision});
 }));
 router.post('/confirm',dispatch('confirm',async(req,actor)=>{
  exact(req.body,['expected_revision','idempotency_key','preview_digest']);
  return controller.confirm({manager:actor,expectedRevision:req.body.expected_revision,
   idempotencyKey:req.body.idempotency_key,previewDigest:req.body.preview_digest});
 }));
 router.get('/operations/:key',dispatch('status',async(req,actor)=>{
  if(Object.keys(req.query).length)throw Object.assign(new Error('dated_transition_request_invalid'),{code:'dated_transition_request_invalid'});
  return controller.status({manager:actor,idempotencyKey:req.params.key});
 }));
 router.post('/rollback',dispatch('rollback',async(req,actor)=>{
  exact(req.body,['expected_revision','idempotency_key','publication_id','projection_id']);
  return controller.rollback({manager:actor,expectedRevision:req.body.expected_revision,
   idempotencyKey:req.body.idempotency_key,publicationId:req.body.publication_id,projectionId:req.body.projection_id});
 }));
 return router;
}
