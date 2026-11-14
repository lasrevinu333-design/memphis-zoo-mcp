import {isDeepStrictEqual} from 'node:util';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const changed=()=>Object.assign(new Error('Messenger employee assignment changed during this request.'),{status:409});
const denied=()=>Object.assign(new Error('Current employee Messenger authority is unavailable.'),{status:401});
const ordinaryRead=req=>{
  // Express accepts case-insensitive paths and a trailing slash by default.
  // Every spelling admitted by the same read route needs the same boundary.
  const path=String(req.path||'').toLowerCase().replace(/\/+$/,'');
  return ['GET','HEAD'].includes(req.method)&&(
    ['/me/by-device','/users','/threads','/threads/updates'].includes(path)
    ||/^\/thread\/[^/]+\/(messages|updates)$/.test(path));
};

function principal(req){
  const d=req.memphisDevice,c=req.memphisDeviceCredential,a=req.memphisDeviceAuth;
  const epoch=typeof d?.assignment_epoch==='number'&&Number.isSafeInteger(d.assignment_epoch)
    ?String(d.assignment_epoch):d?.assignment_epoch;
  if(req.memphisAuth||a?.ok!==true||a.device!==d||a.offline_recovery_only===true
    ||d?.device_active!==true||d.employee_active!==true
    ||!UUID.test(d.canonical_device_pk)||!UUID.test(d.assigned_employee_id)
    ||typeof d.canonical_device_id!=='string'||!/^[A-Z0-9_-]{1,64}$/.test(d.canonical_device_id)
    ||typeof epoch!=='string'||!/^[1-9][0-9]{0,15}$/.test(epoch)||BigInt(epoch)>9007199254740991n
    ||(a.credentialed===true&&(a.credential!==c||!UUID.test(c?.credential_id)
      ||c.device_id!==d.canonical_device_pk)))throw denied();
  return Object.freeze({device_pk:d.canonical_device_pk,device_id:d.canonical_device_id,
    employee_id:d.assigned_employee_id,assignment_epoch:epoch,
    credentialed:a.credentialed===true,credential_id:c?.credential_id??null,
    credential_token_hash:c?.token_hash??null});
}

function authenticate(requireDeviceAccess,req,res){
  // Reuse the original presented request and the existing authority middleware.
  // A cached principal must never turn a new authentication pass into a no-op.
  for(const key of ['memphisAuth','memphisDevice','memphisDeviceCredential','memphisDeviceAuth',
    'memphisMessagingManager','memphisMessagingDevice'])delete req[key];
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(allowed,error)=>{
      if(settled)return;settled=true;res.off('finish',closed);res.off('close',closed);
      if(error)reject(error);else resolve(allowed);
    };
    const closed=()=>finish(false);
    res.once('finish',closed);res.once('close',closed);
    try{Promise.resolve(requireDeviceAccess(req,res,()=>finish(true))).catch(e=>finish(false,e));}
    catch(e){finish(false,e);}
    if(res.headersSent||res.writableEnded||res.destroyed)finish(false);
  });
}

// Read-only counterpart to the existing original-message transaction binding.
// It adds no native proof requirement, writer, role, credential or client claim.
export function createMessagingReadOwners({runReadOnlySql,requireDeviceAccess}){
  const owners=new WeakMap();
  function prepare(req,res){
    if(req.memphisAuth||!ordinaryRead(req))return null;
    const admitted=principal(req),headers=structuredClone(req.headers);
    let identity=null,userId=null;
    async function current(){
      if(!isDeepStrictEqual(req.headers,headers))throw changed();
      if(!await authenticate(requireDeviceAccess,req,res))throw denied();
      if(!isDeepStrictEqual(req.headers,headers)||!isDeepStrictEqual(principal(req),admitted))throw changed();
    }
    async function relationship(){
      await current();
      // All selectors come from the admitted server principal. This query
      // cannot adopt a successor employee or a caller-supplied Messenger ID.
      const rows=await runReadOnlySql(`select d.id as device_pk,d.device_id,e.id as employee_id,
        d.assignment_epoch::text as assignment_epoch,u.id as user_id
        from public.devices d join public.employees e on e.id=d.assigned_employee_id
        join public.msg_users u on u.employee_id=e.id
        join public.msg_device_assignments mda on mda.device_identifier=d.device_id and mda.msg_user_id=u.id and mda.is_active
        where d.id='${admitted.device_pk}'::uuid and d.device_id='${admitted.device_id}'
        and d.active and e.active and u.is_active and u.role='employee'
        and e.id='${admitted.employee_id}'::uuid and d.assignment_epoch='${admitted.assignment_epoch}'::bigint`);
      await current();
      const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
      if(!row||row.device_pk!==admitted.device_pk||row.device_id!==admitted.device_id
        ||row.employee_id!==admitted.employee_id||String(row.assignment_epoch)!==admitted.assignment_epoch
        ||!UUID.test(row.user_id))throw changed();
      return row;
    }
    const owner=Object.freeze({
      get identity(){return identity;},
      async admit(value){
        const row=await relationship();
        if(value?.msg_user_id!==row.user_id||value.role!=='employee')throw changed();
        identity=Object.freeze({...value});userId=row.user_id;
      },
      async confirm(){
        if(!identity||!userId)throw denied();
        const row=await relationship();
        if(row.user_id!==userId)throw changed();
        return true;
      },
    });
    owners.set(req,owner);return owner;
  }
  return Object.freeze({prepare,get:req=>owners.get(req)||null});
}
