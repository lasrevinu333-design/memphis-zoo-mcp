import assert from 'node:assert/strict';
export async function run({fixture,pool,save,assertFrozen}){
 const sender='bc180000-0000-4000-8000-000000000101',key='root-concurrent-original';
 await fixture.assertOwned();assertFrozen();
 await pool.query("insert into public.msg_users(id,display_name,role,is_active) values($1,'F18 owned concurrent synthetic manager','manager',true)",[sender]);
 const clients=await Promise.all([pool.connect(),pool.connect()]);
 const calls=[];let results;
 try{
  await Promise.all(clients.map(async(c,i)=>{await c.query('begin');await c.query('set local role service_role');await c.query("set local statement_timeout='15000ms'");calls.push({client:i,pid:(await c.query('select pg_backend_pid() pid')).rows[0].pid});}));
  assert.notEqual(calls[0].pid,calls[1].pid,'Two actual database backends required');
  // Both original calls begin before either result is awaited. The owning
  // function must serialize the key; the second sees the committed receipt.
  results=await Promise.all(clients.map(async(c)=>{const r=await c.query('select * from public.msg_broadcast_operation_v1($1::uuid,$2::text,$3::text,$4::text,false)',[sender,key,'Synthetic concurrency','One original broadcast']);await c.query('commit');return r.rows;}));
 }catch(e){await Promise.all(clients.map(c=>c.query('rollback').catch(()=>{})));throw e;}
 finally{clients.forEach(c=>c.release());}
 assert.deepEqual(results[0],results[1]);assert.equal(results[0].length,1);
 const counts=(await pool.query(`select
  (select count(*)::int from public.msg_threads where created_by_user_id=$1) threads,
  (select count(*)::int from public.msg_broadcasts where created_by_user_id=$1) broadcasts,
  (select count(*)::int from public.msg_messages where sender_user_id=$1) messages,
  (select count(*)::int from public.msg_broadcast_request_receipts where sender_user_id=$1 and client_broadcast_id=$2) receipts`,[sender,key])).rows[0];
 assert.deepEqual(counts,{threads:1,broadcasts:1,messages:1,receipts:1});
 const original=(await pool.query('select * from public.msg_broadcast_operation_v1($1,$2,$3,$4,true)',[sender,key,'Synthetic concurrency','One original broadcast'])).rows;assert.deepEqual(original,results[0]);
 const evidence={status:'PASS',scope:'Actual two-connection original broadcast, no provider dispatch',checks:['distinct backend PIDs','concurrent same-key exact original receipt','one thread/broadcast/message/receipt','read-only original result'],calls,results,counts};
 save('REPAIR_BROADCAST_CONCURRENT_ORIGINAL.json',evidence);return evidence;
}
