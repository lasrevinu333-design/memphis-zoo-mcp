import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

// Not executed by importing this file. Caller must apply the selected migration
// in its owned disposable current-schema fixture and provide its normal Pool.
export async function runMcpOAuthDurableDatabaseTests({pool,fixture}){
  assert.equal(typeof fixture?.assertOwned,'function');assert.match(fixture.container,/^[0-9a-f]{64}$/);
  assert.equal(pool.options.host,fixture.socketDirectory,'only the existing owned unpublished Unix fixture');
  await fixture.assertOwned();
  const artifacts=[],families=[],clients=[];let checks=0,generation,originalExecutionError=null;
  const digest=()=>randomBytes(32).toString('hex'),now=()=>Math.floor(Date.now()/1000);
  const one=async(client,sql,args=[])=>{const r=await client.query(sql,args);return Object.values(r.rows[0])[0];};
  const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
  const exchange='select public.mcp_oauth_exchange_code_v2($1,$2,$3,$4,$5,$6,$7)';
  const rotate='select public.mcp_oauth_rotate_refresh_v2($1,$2,$3,$4,$5,$6,$7)';
  const active='select public.mcp_oauth_family_active_v2($1,$2,$3)';
  const prepare=()=>{const code=digest(),family=digest(),binding=digest(),refresh=digest();artifacts.push(code);families.push(family);
    return {code,family,binding,refresh,authorityGeneration:generation,args:[code,now()+300,family,binding,refresh,now()+3600,generation]};};
  try{
    const a=await pool.connect();clients.push(a);
    const b=await pool.connect();clients.push(b);
    const functions=['mcp_oauth_authority_generation_v2()','mcp_oauth_consume_decision_v2(text,bigint,text)','mcp_oauth_exchange_code_v2(text,bigint,text,text,text,bigint,text)',
      'mcp_oauth_rotate_refresh_v2(text,text,text,bigint,text,bigint,text)','mcp_oauth_family_active_v2(text,text,text)'];
    for(const fn of functions)for(const role of ['anon','authenticated','service_role']){
      check(await one(pool,'select has_function_privilege($1,$2,\'EXECUTE\')',[role,'public.'+fn]),role==='service_role',`${role} ${fn} ACL`);}
    for(const table of ['mcp_oauth_replay_artifacts_v2','mcp_oauth_token_families_v2']){
      check(await one(pool,'select relrowsecurity from pg_class where oid=$1::regclass',['public.'+table]),true,'RLS enabled');
      for(const role of ['anon','authenticated'])check(await one(pool,'select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')',
        [role,'public.'+table]),false,`${role} direct table denied`);}
    await a.query('set role anon');await assert.rejects(()=>a.query('select public.mcp_oauth_family_active_v2($1,$2,$3)',[digest(),digest(),'0']),e=>e.code==='42501');checks++;
    await a.query('reset role');await a.query('set role service_role');await b.query('set role service_role');
    generation=await one(a,'select public.mcp_oauth_authority_generation_v2()');assert.match(generation,/^(0|[1-9][0-9]{0,18})$/);checks++;
    const decision=digest();artifacts.push(decision);
    check(await one(a,'select public.mcp_oauth_consume_decision_v2($1,$2,$3)',[decision,now()+300,generation]),true,'decision first');
    check(await one(b,'select public.mcp_oauth_consume_decision_v2($1,$2,$3)',[decision,now()+300,generation]),false,'decision other connection');
    const first=prepare();check(await one(a,exchange,first.args),true,'exchange atomic commit');
    check(await one(b,exchange,first.args),false,'code reused on independent connection');
    check(await one(b,active,[first.family,first.binding,first.authorityGeneration]),true,'durable family visible on second instance');
    check(await one(b,active,[first.family,digest(),first.authorityGeneration]),false,'wrong binding denied');
    check(await one(a,active,[first.family,first.binding,first.authorityGeneration]),true,'wrong binding cannot revoke legitimate family');
    const winnerDigests=[digest(),digest()];
    const outcomes=await Promise.all([one(a,rotate,[first.family,first.binding,first.refresh,0,winnerDigests[0],now()+3600,first.authorityGeneration]),
      one(b,rotate,[first.family,first.binding,first.refresh,0,winnerDigests[1],now()+3600,first.authorityGeneration])]);
    check(outcomes.sort(),[false,true],'two-instance refresh exactly one winner');
    check(await one(b,active,[first.family,first.binding,first.authorityGeneration]),false,'reuse revocation COMMITTED');
    check(await one(a,rotate,[first.family,first.binding,winnerDigests[0],1,digest(),now()+3600,first.authorityGeneration]),false,'descendant denied');
    const concurrent=prepare(),secondFamily=digest();families.push(secondFamily);
    const duplicateArgs=[...concurrent.args];duplicateArgs[2]=secondFamily;
    check((await Promise.all([one(a,exchange,concurrent.args),one(b,exchange,duplicateArgs)])).sort(),[false,true],'atomic concurrent code consumption');
    check(Number(await one(pool,'select count(*) from public.mcp_oauth_token_families_v2 where family_digest=any($1::text[])',[[concurrent.family,secondFamily]])),1,'exactly one family');
    const rolled=prepare();await a.query('begin');check(await one(a,exchange,rolled.args),true,'transaction staged');await a.query('rollback');
    check(Number(await one(pool,'select count(*) from public.mcp_oauth_replay_artifacts_v2 where artifact_digest=$1',[rolled.code])),0,'rollback restores code availability');
    check(Number(await one(pool,'select count(*) from public.mcp_oauth_token_families_v2 where family_digest=$1',[rolled.family])),0,'rollback removes family');
    const failing=prepare();failing.args[2]=first.family;
    await assert.rejects(()=>a.query(exchange,failing.args),e=>e.code==='23505');checks++;
    check(Number(await one(pool,'select count(*) from public.mcp_oauth_replay_artifacts_v2 where artifact_digest=$1',[failing.code])),0,'family failure rolls back code consumption');
    const expiring=prepare();check(await one(a,exchange,expiring.args),true,'expiry lock fixture');
    await a.query('begin');await a.query('select 1 from public.mcp_oauth_token_families_v2 where family_digest=$1 for update',[expiring.family]);
    const waiting=one(b,rotate,[expiring.family,expiring.binding,expiring.refresh,0,digest(),now()+1,expiring.authorityGeneration]);
    await a.query('select pg_sleep(2)');await a.query('commit');check(await waiting,false,'rotation deadline checked AFTER row lock');
    check(await one(b,active,[expiring.family,expiring.binding,expiring.authorityGeneration]),true,'expired requested successor did not revoke old family');
    const nullish=prepare();nullish.args[1]=null;check(await one(a,exchange,nullish.args),false,'NULL code expiry denied');
    check(await one(a,rotate,[first.family,first.binding,null,0,digest(),now()+3600,first.authorityGeneration]),false,'NULL refresh proof denied');
    const beforeRestore=prepare();check(await one(a,exchange,beforeRestore.args),true,'pre-restore family');
    const unusedBeforeRestore=prepare(),unusedDecision=digest();artifacts.push(unusedDecision);
    const freshRefresh=digest();check(await one(a,rotate,[beforeRestore.family,beforeRestore.binding,beforeRestore.refresh,0,freshRefresh,now()+3600,generation]),true,'pre-restore rotated state');
    // Simulate application backup rollback while preserving custodial_dr, just as
    // the real restore excludes that schema. This is ONLY the disposable fixture.
    const admin=await pool.connect();clients.push(admin);
    await admin.query('begin');await admin.query("select pg_advisory_xact_lock(hashtextextended('memphis-zoo-application-mutation-fence',0))");
    await admin.query('update custodial_dr.restore_control set authority_generation=authority_generation+1 where singleton=true');
    await admin.query('update public.mcp_oauth_token_families_v2 set current_refresh_digest=$1,generation=0 where family_digest=$2',[beforeRestore.refresh,beforeRestore.family]);
    await admin.query('commit');
    const newGeneration=await one(b,'select public.mcp_oauth_authority_generation_v2()');
    check(BigInt(newGeneration),BigInt(generation)+1n,'non-restored authority advanced exactly once');
    check(await one(a,active,[beforeRestore.family,beforeRestore.binding,generation]),false,'old access fails despite restored family state');
    check(await one(b,rotate,[beforeRestore.family,beforeRestore.binding,beforeRestore.refresh,0,digest(),now()+3600,generation]),false,'restored old refresh cannot resurrect');
    check(await one(a,exchange,unusedBeforeRestore.args),false,'old unspent code cannot mint after restore');
    check(await one(b,'select public.mcp_oauth_consume_decision_v2($1,$2,$3)',[unusedDecision,now()+300,generation]),false,'old unspent decision cannot mint after restore');
    generation=newGeneration;const afterRestore=prepare();check(await one(a,exchange,afterRestore.args),true,'new-generation authorization can proceed');
    await fixture.assertOwned();return {scope:'Actual SQL in caller-owned disposable current-schema fixture',checks,result:'PASS'};
  }catch(error){originalExecutionError=error;throw error;}
  finally{
    const cleanupErrors=[];
    for(const [index,client] of clients.entries()){
      let connectionError=null;
      try{await client.query('rollback');await client.query('reset role');}
      catch(error){connectionError=error;cleanupErrors.push(Object.assign(new Error(`Recorded SQL client ${index} transaction cleanup failed`,{cause:error}),{cleanup_stage:'transaction',client_index:index}));}
      // An uncertain transaction must not return as an idle reusable connection.
      // pg release(error) destroys that recorded connection instead.
      try{client.release(connectionError||undefined);}
      catch(error){cleanupErrors.push(Object.assign(new Error(`Recorded SQL client ${index} release failed`,{cause:error}),{cleanup_stage:'release',client_index:index}));}
    }
    let stillOwned=false;
    try{await fixture.assertOwned();stillOwned=true;}
    catch(error){cleanupErrors.push(new Error('Owned SQL fixture custody check failed before row cleanup',{cause:error}));}
    if(stillOwned){
      // All recorded clients are released first. These queries use a healthy pool
      // connection and only this run's generated digests; never a table truncate.
      for(const [table,keys,column] of [['mcp_oauth_token_families_v2',families,'family_digest'],['mcp_oauth_replay_artifacts_v2',artifacts,'artifact_digest']]){
        try{await pool.query(`delete from public.${table} where ${column}=any($1::text[])`,[keys]);}
        catch(error){cleanupErrors.push(new Error(`Owned OAuth row cleanup failed: ${table}`,{cause:error}));}
      }
    }
    if(cleanupErrors.length){
      const failure=new AggregateError([...(originalExecutionError?[originalExecutionError]:[]),...cleanupErrors],
        'OAuth SQL original execution/cleanup failed; all recorded clients were processed',
        {cause:originalExecutionError||cleanupErrors[0]});
      failure.original_execution_error=originalExecutionError;failure.cleanup_errors=cleanupErrors;
      throw failure;
    }
  }
}
