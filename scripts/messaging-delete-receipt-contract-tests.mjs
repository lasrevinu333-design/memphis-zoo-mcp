import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {createMessagingRouter} from '../src/messaging-api.js';

const sqlSource=readFileSync(new URL('../supabase/migrations/20260810140000_finalize_named_manager_messenger_retirement_integrity.sql',import.meta.url),'utf8');
const begin=sqlSource.indexOf('create or replace function public.msg_delete_thread(p_thread_id uuid,p_request_user_id uuid,p_operation_id uuid)');
const end=sqlSource.indexOf('create or replace function public.msg_admin_tombstone_thread(',begin);
assert.ok(begin>=0&&end>begin,'exact user delete RPC source is present');
const deleteSql=sqlSource.slice(begin,end);
assert.match(deleteSql,/pg_advisory_xact_lock\(hashtextextended\(p_operation_id::text,0\)\)/);
assert.match(deleteSql,/v_existing\.thread_id<>p_thread_id or v_existing\.user_id<>p_request_user_id or v_existing\.deletion_scope<>'user'/);
assert.match(deleteSql,/insert into public\.msg_thread_deletion_operations\(operation_id,thread_id,user_id,deletion_scope/);
assert.equal((deleteSql.match(/'operation_id',(?:v_existing\.operation_id|p_operation_id)/g)||[]).length,2,
  'fresh and replayed SQL outcomes must both carry their bound operation');

const thread='10000000-0000-4000-8000-000000000001';
const employee='20000000-0000-4000-8000-000000000002';
const manager='30000000-0000-4000-8000-000000000003';
const managerUser='40000000-0000-4000-8000-000000000004';
const foreignUser='50000000-0000-4000-8000-000000000005';
const operation='60000000-0000-4000-8000-000000000006';
const foreignOperation='70000000-0000-4000-8000-000000000007';
const deletedAt='2026-10-02T12:00:00.123456+00:00';
const deletedThrough='2026-10-02T12:00:00.123457+00:00';
const receipt=(args,changes={})=>({ok:true,deleted:true,thread_id:args.p_thread_id,
  operation_id:args.p_operation_id,deletion_scope:'user',deleted_at:deletedAt,
  deleted_through:deletedThrough,replayed:false,memphis_generation_ended:false,...changes});
let receiptResult=args=>receipt(args),identityMode='normal',participant=true;
const rpcCalls=[];
const app=express();app.use(express.json());
app.use('/messaging-api',createMessagingRouter({
  requireDeviceAccess(req,res,next){
    const token=req.headers.authorization;
    if(token==='Bearer employee'){req.memphisDevice={canonical_device_id:'KIOSK_04'};next();return}
    if(token==='Bearer manager' || token==='Bearer manager-read-only'){
      req.memphisAuth={manager_id:manager,read_only:token.endsWith('read-only')};next();return;
    }
    res.status(401).json({ok:false,error:'Test auth required'});
  },
  async runReadOnlySql(statement){
    const query=String(statement);
    if(/public\.device_aliases/.test(query))return [{canonical_device_id:'KIOSK_04',device_id:'KIOSK_04',device_active:true,assigned_employee_id:employee,employee_active:true}];
    if(/public\.msg_get_user_by_device\('KIOSK_04'\)/.test(query))return [identityMode==='missing'?{role:'employee'}:{msg_user_id:employee,role:'employee'}];
    if(/from public\.msg_threads t/.test(query))return [{id:thread,thread_type:'direct',system_key:null,is_active:true,has_memphis_bot:false}];
    if(/from public\.msg_thread_participants/.test(query))return participant?[{present:1}]:[];
    return [];
  },
  async runRpc(name,args){
    rpcCalls.push({name,args});
    if(name==='msg_ensure_ops_manager_user')return {msg_user_id:managerUser,role:'manager'};
    if(name==='msg_delete_thread')return receiptResult(args);
    throw Error(`Unexpected RPC ${name}`);
  },
  buildHealthPayload:()=>({ok:true}),appVersion:'test',releaseId:'test',contractVersion:'messaging.v1',
}));
const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))});
const origin=`http://127.0.0.1:${server.address().port}`;
const post=async(body={device_id:'KIOSK_04',user_id:employee,operation_id:operation},token='employee')=>{
  const response=await fetch(`${origin}/messaging-api/thread/${thread}/delete`,{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
};
let checks=0;
const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);checks++;console.log('PASS',label)};
const deleteCalls=()=>rpcCalls.filter(call=>call.name==='msg_delete_thread');
try{
  let result=await post();
  check('exact employee deletion status',result.status,200);
  check('exact browser receipt fields',Object.fromEntries(['ok','deleted','operation_id','thread_id','user_id','deletion_scope','deleted_at','deleted_through'].map(key=>[key,result.body.data[key]])),
    {ok:true,deleted:true,operation_id:operation,thread_id:thread,user_id:employee,deletion_scope:'user',deleted_at:deletedAt,deleted_through:deletedThrough});
  check('server-derived SQL caller',deleteCalls().at(-1).args,{p_thread_id:thread,p_request_user_id:employee,p_operation_id:operation});
  check('deletion meta preserved',result.body.meta,{version:'test',release_id:'test',contract_version:'messaging.v1',deletion:'current_user_only',authoritative:true,old_history_restores:false,memphis_starts_clean:false});
  receiptResult=args=>receipt(args,{replayed:true});
  result=await post();check('same-operation replay accepted',result.status,200);check('replay user remains authenticated viewer',result.body.data.user_id,employee);
  receiptResult=args=>receipt(args,{user_id:employee});
  result=await post();check('matching optional SQL actor accepted',result.status,200);
  receiptResult=args=>receipt(args,{deleted_at:'2026-10-02T07:00:00.123456-05:00'});
  result=await post();check('equivalent offset with later microsecond accepted',result.status,200);
  const invalid=[
    ['generic ok false',{ok:false}],['deleted false',{deleted:false}],
    ['wrong thread',{thread_id:'80000000-0000-4000-8000-000000000008'}],
    ['wrong operation',{operation_id:foreignOperation}],['missing operation',{operation_id:null}],
    ['foreign SQL actor',{user_id:foreignUser}],['null SQL actor',{user_id:null}],
    ['global scope',{deletion_scope:'global'}],['missing deleted time',{deleted_at:null}],
    ['local civil time',{deleted_at:'2026-10-02T12:00:00'}],
    ['invalid calendar time',{deleted_at:'2026-02-30T12:00:00Z'}],
    ['numeric timestamp',{deleted_at:1790942400123}],
    ['Date timestamp object',{deleted_at:new Date('2026-10-02T12:00:00Z')}],
    ['unknown offset',{deleted_at:'2026-10-02T12:00:00+XX:00'}],
    ['out-of-range offset',{deleted_at:'2026-10-02T12:00:00+24:00'}],
    ['out-of-range offset minutes',{deleted_at:'2026-10-02T12:00:00+00:60'}],
    ['unparseable through',{deleted_through:'yesterday'}],
    ['microsecond reversal',{deleted_through:'2026-10-02T12:00:00.123455+00:00'}],
  ];
  for(const [label,change] of invalid){
    receiptResult=args=>receipt(args,change);result=await post();
    check(`${label} rejected`,result.status,502);check(`${label} no success`,result.body.ok,false);
  }
  for(const [label,value] of [['empty result',[]],['two rows',[receipt({p_thread_id:thread,p_operation_id:operation}),receipt({p_thread_id:thread,p_operation_id:operation})]]]){
    receiptResult=()=>value;result=await post();check(`${label} rejected`,result.status,502);
  }
  receiptResult=args=>receipt(args);
  let before=deleteCalls().length;
  result=await post({device_id:'KIOSK_04',user_id:foreignUser,operation_id:operation});
  check('forged user denied before SQL',result.status,403);check('forged user no delete call',deleteCalls().length,before);
  result=await post({device_id:'KIOSK_04',user_id:employee,operation_id:'invalid'});
  check('invalid operation denied before SQL',result.status,422);check('invalid operation no delete call',deleteCalls().length,before);
  participant=false;result=await post();check('nonparticipant denied before SQL',result.status,403);
  check('nonparticipant no delete call',deleteCalls().length,before);participant=true;
  identityMode='missing';result=await post();check('claimed user cannot fill missing authenticated identity',result.status,400);
  check('missing identity no delete call',deleteCalls().length,before);identityMode='normal';
  result=await post({operation_id:operation},'manager-read-only');
  check('read-only manager cannot delete',result.status,403);check('read-only manager no delete call',deleteCalls().length,before);
  result=await post({operation_id:operation},'manager');
  check('named manager delete allowed',result.status,200);check('named manager actor is server-derived',result.body.data.user_id,managerUser);
  check('named manager SQL caller',deleteCalls().at(-1).args.p_request_user_id,managerUser);
  console.log('MESSAGING_DELETE_RECEIPT_CONTRACT_PASS',checks);
}finally{await new Promise(resolve=>server.close(resolve));console.log('OWNED_HTTP_SERVER_CLOSED')}
