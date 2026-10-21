#!/usr/bin/env node

import assert from "node:assert/strict";
import { compareCronJobs, normalizedCronJobs, readCronJobs, restoreCronJobs, resolveCronJobDefaultSequence } from "./disaster-recovery-cron.mjs";
import pg from "pg";
import { types } from "node:util";


// NEW initializer/readonly-verifier Source cases with inert query records only.
// These are not native SQL, Source/owner/fence admission or rollback proof.
if (process.argv.includes('--fresh-cron-prepause-only')) {
  const {readFileSync}=await import('node:fs');
  const {createHash}=await import('node:crypto');
  const {isDeepStrictEqual}=await import('node:util');
  const {verifyRestoredCronJobs}=await import('./disaster-recovery-cron.mjs');
  const group=process.argv.find(v=>v.startsWith('--cron-prepause-case='))?.split('=')[1];
  const member=process.argv.find(v=>v.startsWith('--cron-prepause-member='))?.slice('--cron-prepause-member='.length);
  assert.ok(group===undefined||['reproduction','initializer','readonly','refusal','failure','structure','privacy'].includes(group));
  const source=readFileSync(new URL('./immutable-private-source-initializer.mjs',import.meta.url),'utf8');
  const extract=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
  const initializer=extract(' const cronRaw='," await query("+String.fromCharCode(96)+'insert into public.release_deployment_manifest');
  const querySource=extract(' const query=async(sql,params=[])=>',' const inventory=name=>');
  const compareSource=extract(' const cronCompared=',' const control=(await query(');
  const oldInsertion=" const cronRaw=source.inventory['inventory/cron-jobs.json'],cron=inventory('cron-jobs.json');assert.ok(Array.isArray(cron));\n const jobs=await query(`insert into cron.job select r.* from json_array_elements($1::json) with ordinality e(image,ordinality)\n  cross join lateral json_populate_record(null::cron.job,e.image) r order by e.ordinality`,[cronRaw]);\n assert.equal(jobs.rowCount,cron.length);\n";
  const sourceDb='UNIT_original_database',targetDb='mz_schema_rebuild_cron_prepause_unit';
  const job=(jobid='9007199254740993',extra={})=>({jobid,schedule:'0 0 1 1 *',command:'select 1 /* UNIT only */',
    nodename:'unit-only.invalid',nodeport:5432,database:sourceDb,username:'supabase_admin',active:false,jobname:null,...extra});
  const select=rows=>({command:'SELECT',rowCount:rows.length,rows});
  const fixture=({jobs=[],last='987',called=true,paused=false,onRead,failAt,hasFailure=false,failureValue,descriptor={}}={})=>{
    const state={jobs:jobs.map(v=>({...v})),counter:{last_value:last,is_called:called},paused,sourceCurrent:true,contextCurrent:true,
      descriptor:syntheticCronDefaultSequence(descriptor),queries:[],effects:[],target:targetDb,reads:{},trace:[],port:null};
    const raw=async(sql,params=[])=>{
      let label=sql.includes('unsupported_dependency_count')?'catalog':sql==='select current_database() database_name'?'target':
        sql.includes('from cron.job j order by j.jobid')?'jobs':sql.startsWith('select last_value::text')?'counter':
        sql.startsWith('alter sequence ')?'restart':sql==='truncate cron.job restart identity'?'truncate':
        sql==='select setval($1::regclass,$2,$3)'?'setval':sql.startsWith('insert into cron.job select')?'old_insert':
        sql.includes('insert into cron.job(')?'insert':sql.includes('from custodial_dr.restore_control where singleton')?'control':
        sql.startsWith('with expected as(')?'comparison':'UNKNOWN';
      state.queries.push({sql,params,label});state.trace.push(label);state.reads[label]=(state.reads[label]||0)+1;
      if(hasFailure&&failAt===label)throw failureValue;
      onRead?.(state,label,state.reads[label]);
      if(label==='catalog')return select(state.catalogRows===undefined?[{...state.descriptor}]:state.catalogRows);
      if(label==='target')return select([{database_name:state.target}]);
      if(label==='jobs')return select(state.jobs.map(row=>({row:{...row}})));
      if(label==='counter')return select(state.counterRows===undefined?[{...state.counter}]:state.counterRows);
      if(label==='control')return select([{generation:'0',mutations_paused:state.paused,state:state.paused?'PREPARING':'READY',restore_id:null}]);
      if(label==='restart'){
        if(state.paused)throw Object.assign(new Error('UNIT unchanged paused DDL guard refused'),{code:'55000'});
        state.effects.push('restart');state.counter={last_value:'1',is_called:false};return {command:'ALTER',rowCount:null,rows:[]};
      }
      if(label==='truncate'){state.effects.push('truncate');state.jobs=[];return {command:'TRUNCATE',rowCount:null,rows:[]};}
      if(label==='insert'){state.effects.push('insert');state.jobs.push(Object.fromEntries(
        ['jobid','schedule','command','nodename','nodeport','database','username','active','jobname'].map((field,index)=>[field,params[index]])));
        return {command:'INSERT',rowCount:1,rows:[]};}
      if(label==='old_insert'){state.effects.push('old_insert');state.jobs=JSON.parse(params[0]);return {command:'INSERT',rowCount:state.jobs.length,rows:[]};}
      if(label==='setval'){state.effects.push('setval');assert.equal(params[0],state.descriptor.sequence_oid);
        state.counter={last_value:params[1],is_called:params[2]};return select([{setval:params[1]}]);}
      if(label==='comparison'){state.comparisonParameter=params[0];const expected=normalizedCronJobs(JSON.parse(params[0]));
        return select([{n:compareCronJobs(expected,state.jobs).length?1:0}]);}
      throw new Error('Unexpected UNIT fixed cron query');
    };
    state.raw=raw;state.client={query:raw};return state;
  };
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  async function initialize(jobs,options={}) {
    const {old=false,state=fixture()}=options;
    const sourceDatabase=Object.hasOwn(options,'sourceDatabase')?options.sourceDatabase:sourceDb;
    const originalRaw=JSON.stringify(jobs),sourceFailure=new Error('UNIT original Source withdrawn'),contextFailure=new Error('UNIT original context changed');
    const checkSource=()=>{state.trace.push('source');if(!state.sourceCurrent)throw sourceFailure;};
    const readContext=async()=>{state.trace.push('context');checkSource();if(!state.contextCurrent)throw contextFailure;
      return {database:targetDb,transaction_id:'UNIT same original xid'};};
    const ports={assert,isDeepStrictEqual,db:{},nativeQuery:state.raw,checkSource,readContext,
      originalContext:{database:targetDb,transaction_id:'UNIT same original xid'},
      source:{inventory:{'inventory/cron-jobs.json':originalRaw},sourceBinding:{summary:{database_snapshot:{database_name:sourceDatabase}}}},
      normalizedCronJobs,restoreCronJobs:async(port,rows,options)=>{
        state.port=port;assert.equal(Object.isFrozen(port),true);assert.deepEqual(Object.keys(port),['query']);
        state.trace.push('restore');return restoreCronJobs(port,rows,options);},
      verifyRestoredCronJobs:async(port,rows,options)=>{assert.equal(port,state.port);state.trace.push('verify');
        return verifyRestoredCronJobs(port,rows,options);}};
    const declarations='const {assert,isDeepStrictEqual,db,nativeQuery,checkSource,readContext,originalContext,source,normalizedCronJobs,restoreCronJobs,verifyRestoredCronJobs}=ports;'+
      querySource+" const inventory=name=>JSON.parse(source.inventory['inventory/'+name]);\n";
    let failed=false,failure;
    try{await new AsyncFunction('ports',declarations+(old?oldInsertion:initializer)+
      (old?compareSource.replace('[cronExpectedRaw]','[cronRaw]'):compareSource))(ports);}
    catch(error){failed=true;failure=error;}
    assert.equal(ports.source.inventory['inventory/cron-jobs.json'],originalRaw);
    return {state,failed,failure,sourceFailure,contextFailure};
  }
  const cases=[];const run=async(part,name,body)=>{if((!group||group===part)&&(!member||name.includes(member))){await body();cases.push(name);
    console.log(JSON.stringify({case:name,status:'PASS_NEW_CRON_SOURCE_ONLY'}));}};
  await run('reproduction','initializer restores empty original sequence before later pause, not only job rows',async()=>{
    const result=await initialize([],{old:process.argv.includes('--cron-prepause-predecessor')});
    assert.equal(result.failed,false);console.log(JSON.stringify({counter:result.state.counter,source_only:true}));
    assert.deepEqual(result.state.counter,{last_value:'1',is_called:false});
  });
  await run('initializer','complete populated BIGINT originals restored before pause with canonical source DB remapping',async()=>{
    const jobs=[job('9223372036854775807',{jobname:'UNIT max'}),job('9007199254740992',{jobname:'UNIT adjacent'}),
      job('9007199254740993',{database:'UNIT_unrelated_database',jobname:'UNIT other DB'})];
    const raw=JSON.stringify(jobs),result=await initialize(jobs);assert.equal(result.failed,false);
    assert.equal(result.state.paused,false);assert.deepEqual(result.state.counter,{last_value:'9223372036854775807',is_called:true});
    assert.deepEqual(result.state.jobs.map(v=>v.jobid),['9007199254740992','9007199254740993','9223372036854775807']);
    assert.deepEqual(result.state.jobs.map(v=>v.database),[targetDb,'UNIT_unrelated_database',targetDb]);
    assert.equal(JSON.stringify(jobs),raw);assert.deepEqual(result.state.jobs,JSON.parse(result.state.comparisonParameter));
    assert.deepEqual(result.state.effects,['restart','truncate','insert','insert','insert','setval']);
    assert.ok(result.state.trace.indexOf('control')<result.state.trace.indexOf('restore'));
    assert.ok(result.state.trace.indexOf('setval')<result.state.trace.indexOf('verify'));
  });
  await run('initializer','query-only frozen port retains exact Source/context bracketing for every nested helper SQL',async()=>{
    const result=await initialize([job()]);assert.equal(result.failed,false);assert.equal(Object.isFrozen(result.state.port),true);
    assert.deepEqual(Object.keys(result.state.port),['query']);
    for(const query of result.state.queries){const index=result.state.trace.indexOf(query.label);
      assert.equal(result.state.trace[index-1],'source');assert.equal(result.state.trace[index+1],'source');}
  });
  await run('initializer','already-paused control refuses before any transactional restart/cron effect',async()=>{
    const state=fixture({paused:true}),result=await initialize([job()],{state});
    assert.equal(result.failed,true);assert.deepEqual(state.effects,[]);assert.equal(state.trace.includes('restore'),false);
  });
  for(const value of [undefined,null,'',42,'UNIT\0name','x'.repeat(64)]) {
    await run('initializer','missing or unsupported signed source database '+cases.length+' refuses before effects',async()=>{
      const result=await initialize([job()],{sourceDatabase:value});assert.equal(result.failed,true);assert.deepEqual(result.state.effects,[]);
    });
  }
  const readonlyFixture=(jobs=[],options={})=>{
    const expected=normalizedCronJobs(jobs,{sourceDatabase:sourceDb,targetDatabase:targetDb});
    const max=expected.reduce((n,v)=>BigInt(v.jobid)>n?BigInt(v.jobid):n,1n).toString();
    return fixture({jobs:expected,last:max,called:expected.length>0,paused:true,...options});
  };
  const verify=(state,jobs,options={sourceDatabase:sourceDb})=>verifyRestoredCronJobs(state.client,jobs,options);
  const noEffects=state=>{
    assert.deepEqual(state.effects,[]);
    for(const {sql} of state.queries)assert.match(sql.trimStart(),/^(?:select|with)\s/i);
    assert.equal(state.queries.some(v=>/^(?:alter|truncate|insert|update|delete|set|begin|commit|rollback|lock)\s/i.test(v.sql.trimStart())),false);
  };
  for(const jobs of [[],[job('7')],[job('9007199254740992'),job('9007199254740993')],[job('9223372036854775807')]]) {
    await run('readonly','post-pause verifier preserves exact rows/counter with '+jobs.length+' originals '+cases.length,async()=>{
      const state=readonlyFixture(jobs),result=await verify(state,jobs);
      assert.deepEqual(Object.keys(result).sort(),['before','expected','actual','differences','target_database'].sort());
      assert.deepEqual(result.expected,normalizedCronJobs(jobs,{sourceDatabase:sourceDb,targetDatabase:targetDb}));
      assert.deepEqual(result.before,result.actual);assert.deepEqual(result.actual,result.expected);assert.deepEqual(result.differences,[]);
      assert.equal(result.target_database,targetDb);noEffects(state);
      assert.equal(state.reads.counter,2);assert.ok(state.reads.catalog>=6);
    });
  }
  await run('readonly','unrelated original databases and exact command/schedule/node/user/name fields stay unchanged',async()=>{
    const jobs=[job('7',{database:'UNIT_other',schedule:'@hourly',command:'select E\'UNIT \\\\ text\'',nodename:'unit-other.invalid',
      nodeport:65535,username:'UNIT_user',active:true,jobname:'UNIT full original'})];
    const state=readonlyFixture(jobs),result=await verify(state,jobs);assert.deepEqual(result.actual,jobs);assert.deepEqual(result.differences,[]);noEffects(state);
  });
  await run('readonly','null source mapping option leaves original database untouched',async()=>{
    const jobs=[job('7')],state=fixture({jobs,last:'7',called:true,paused:true});
    const result=await verify(state,jobs,{});assert.equal(result.actual[0].database,sourceDb);assert.deepEqual(result.differences,[]);noEffects(state);
  });
  for(const [jobs,last,called] of [[[],'2',false],[[],'1',true],[[job('7')],'8',true],[[job('7')],'7',false]]) {
    await run('readonly','counter mismatch is discrepancy DATA, not a rewrite '+cases.length,async()=>{
      const state=readonlyFixture(jobs,{last,called}),result=await verify(state,jobs);assert.equal(result.differences.length,1);
      assert.equal(result.differences[0].field,'jobid_sequence');assert.deepEqual(result.differences[0].actual,{last_value:last,is_called:called});noEffects(state);
    });
  }
  for(const field of ['schedule','command','nodename','nodeport','database','username','active','jobname']) {
    await run('readonly','stable changed actual '+field+' is a full-row difference',async()=>{
      const jobs=[job('7')],state=readonlyFixture(jobs);state.jobs[0][field]=field==='active'?true:field==='nodeport'?5433:'UNIT changed';
      const result=await verify(state,jobs);assert.equal(result.differences.length,1);assert.equal(result.differences[0].category,'cron_state');noEffects(state);
    });
  }
  for(const jobs of [[job('7')],[]]) {
    await run('readonly','missing or extra current job membership cannot be MATCH '+cases.length,async()=>{
      const state=readonlyFixture(jobs);state.jobs=jobs.length?[]:[job('8',{database:targetDb})];
      const result=await verify(state,jobs);assert.ok(result.differences.length>0);noEffects(state);
    });
  }
  for(const change of [{sequence_oid:'40124'},{owner_name:'UNIT_successor'},{virtual_transaction:'5/13'},
    {backend_pid:124},{database_oid:'40001'},{default_node:'UNIT changed native default'}]) {
    await run('refusal','descriptor withdrawal after row read refuses '+JSON.stringify(change),async()=>{
      const jobs=[job()],state=readonlyFixture(jobs,{onRead:(value,label)=>{if(label==='jobs')Object.assign(value.descriptor,change);}});
      await assert.rejects(verify(state,jobs),/verification is unavailable or changed/);noEffects(state);
    });
  }
  for(const rows of [[],[syntheticCronDefaultSequence(),syntheticCronDefaultSequence()]]) {
    await run('refusal','missing or ambiguous native default is unavailable, including empty inventory '+cases.length,async()=>{
      const state=readonlyFixture();state.catalogRows=rows;await assert.rejects(verify(state,[]),/default sequence is unsupported or changed/);noEffects(state);
    });
  }
  for(const [label,change] of [['late rows',(state)=>state.jobs.push(job('8',{database:targetDb}))],
    ['late target',state=>state.target='UNIT_successor_database'],['late counter',state=>state.counter.last_value='8']]) {
    await run('refusal',label+' changed during reads cannot adopt a later mixed result',async()=>{
      const state=readonlyFixture([job('7')],{onRead:(value,read,count)=>{
        if((label==='late rows'&&read==='jobs'||label==='late target'&&read==='target'||label==='late counter'&&read==='counter')&&count===2)change(value);
      }});
      await assert.rejects(verify(state,[job('7')]),/verification is unavailable or changed/);noEffects(state);
    });
  }
  for(const row of [{last_value:7,is_called:true},{last_value:'07',is_called:true},{last_value:'7\n',is_called:true},
    {last_value:'9223372036854775808',is_called:true},{last_value:'7',is_called:'true'},
    {last_value:'7',is_called:true,permission:true}]) {
    await run('refusal','closed native counter shape refuses '+cases.length,async()=>{
      const state=readonlyFixture([job('7')]);state.counterRows=[row];
      await assert.rejects(verify(state,[job('7')]),/verification is unavailable or changed/);noEffects(state);
    });
  }
  await run('refusal','changed query method after await refuses without calling replacement',async()=>{
    let calls=0;const state=readonlyFixture([],{onRead:(value,label)=>{if(label==='jobs')value.client.query=()=>{calls++;};}});
    await assert.rejects(verify(state,[]),/verification is unavailable or changed/);assert.equal(calls,0);noEffects(state);
  });
  for(const at of ['control','target','catalog','restart','truncate','insert','setval','jobs','counter']) {
    await run('failure','Source withdrawal after '+at+' stops initializer without compensation or second attempt',async()=>{
      const state=fixture({onRead:(value,label)=>{if(label===at)value.sourceCurrent=false;}}),result=await initialize([job()],{state});
      assert.equal(result.failed,true);assert.equal(result.failure,result.sourceFailure);
      assert.ok(state.effects.filter(v=>v==='restart').length<=1);assert.ok(state.effects.filter(v=>v==='setval').length<=1);
      assert.equal(state.queries.some(v=>/^(?:begin|commit|rollback|set|grant|alter\s+role)/i.test(v.sql.trimStart())),false);
    });
  }
  await run('failure','owner/xid/fence context withdrawal through existing query closure stops next work',async()=>{
    const state=fixture({onRead:(value,label)=>{if(label==='restart')value.contextCurrent=false;}}),result=await initialize([job()],{state});
    assert.equal(result.failed,true);assert.equal(result.failure,result.contextFailure);assert.deepEqual(state.effects,['restart']);
  });
  for(const failure of [undefined,null,false,0,new Error('UNIT native first failure')]) {
    await run('failure','readonly await preserves literal first failure '+String(failure),async()=>{
      const state=readonlyFixture([],{failAt:'counter',hasFailure:true,failureValue:failure});let failed=false,caught;
      try{await verify(state,[]);}catch(error){failed=true;caught=error;}
      assert.equal(failed,true);assert.equal(caught,failure);noEffects(state);
    });
  }
  await run('structure','initializer restores inside READY control before return; no pause/commit/guard bypass added',async()=>{
    assert.ok(initializer.indexOf('state:\'READY\'')<initializer.indexOf('await restoreCronJobs('));
    assert.ok(source.indexOf('await restoreCronJobs(')<source.indexOf('return Object.freeze({schema:\'custodial.immutable-private-source-initialized.v1\''));
    assert.match(initializer,/Object\.freeze\(\{query\}\)/);assert.match(initializer,/source\.sourceBinding\.summary\.database_snapshot/);
    assert.match(compareSource,/\[cronExpectedRaw\]/);assert.doesNotMatch(initializer,/db\.query\s*=|prepareVerifiedImmutableFreshRestoreControl|\bBEGIN\b|\bCOMMIT\b|replica|enable trigger|disable trigger|\bgrant\b/i);
    assert.equal(createHash('sha256').update(oldInsertion).digest('hex'),'238a00527b580642c3b7a25a69d3af9539a18de0ff76ed744b95bb92286b03b6');
  });
  for(const read of [2,3]) {
    await run('privacy','new cron mismatch assertion remains bounded at job observation '+read,async()=>{
      const state=fixture({onRead:(value,label,count)=>{if(label==='jobs'&&count===read)value.jobs[0].command='UNIT-private-command-sentinel';}});
      const result=await initialize([job()],{state});assert.equal(result.failed,true);
      assert.equal(String(result.failure).includes('UNIT-private-command-sentinel'),false);
      assert.equal(String(result.failure.stack).includes('UNIT-private-command-sentinel'),false);
      assert.equal(JSON.stringify(result.failure).includes('UNIT-private-command-sentinel'),false);
      assert.equal(result.failure.actual,1);assert.equal(result.failure.expected,0);
    });
  }
  assert.ok(cases.length>0);
  console.log(JSON.stringify({status:'CRON_PREPAUSE_SOURCE_ONLY',cases:cases.length,native_SQL:'NOT_RUN',resources:0}));process.exit(0);
}

const CronOwnedNativeClient = pg.Client;
const cronOwnedNativeQuery = CronOwnedNativeClient.prototype.query;

// Recording-fixture DATA only; NOT the actual v33 default or owner evidence.
function syntheticCronDefaultSequence(overrides = {}) {
  return {
    job_oid: "40100", job_attribute_number: 1, job_owner: "supabase_admin", job_kind: "r", job_persistence: "p",
    job_type_oid: "20", job_identity: "", job_generated: "", default_oid: "40101",
    default_node: "SYNTHETIC_NEXTVAL_EXPRESSION_NODE", default_expression: "nextval('cron.jobid_seq'::regclass)",
    sequence_dependency_count: 1, unsupported_dependency_count: 0, sequence_oid: "40123",
    schema_name: "cron", sequence_name: "jobid_seq", owner_name: "supabase_admin", sequence_kind: "S", sequence_persistence: "p",
    expected_expression: "nextval('cron.jobid_seq'::regclass)", database_oid: "40000", backend_pid: 123,
    actor: "supabase_admin", session_actor: "supabase_admin", transaction_started_at: "SYNTHETIC_TRANSACTION_START", virtual_transaction: "5/12",
    ...overrides,
  };
}

// Main supplies the real disposable, unexposed fixture and owns its original
// RW transaction/fences. This callable creates no connection or admission.
export async function runCronInt64OwnedDatabaseCase(db) {
  return runCronOwnedDatabaseCase(db, false);
}

// Fixed positive-only profile for the changed rollback journey. No caller
// option controls which guards/assertions run; only unchanged invalid-input
// checks are omitted, not original identity, currentness or rollback checks.
export async function runCronTransactionalRollbackOwnedDatabaseCase(db) {
  return runCronOwnedDatabaseCase(db, true);
}

async function runCronOwnedDatabaseCase(db, transactionalRollbackOnly) {
  const requireClient = () => {
    assert.ok(db && typeof db === "object" && !types.isProxy(db)
      && Object.getPrototypeOf(db) === CronOwnedNativeClient.prototype
      && !Object.hasOwn(db, "query") && CronOwnedNativeClient.prototype.query === cronOwnedNativeQuery,
    "Cron owning case requires the actual unmodified pg.Client");
    for (const [key, expected] of [["_connected", true], ["_ending", false], ["_queryable", true]]) {
      const descriptor = Object.getOwnPropertyDescriptor(db, key);
      assert.ok(descriptor && Object.hasOwn(descriptor, "value") && descriptor.value === expected,
        "Original cron client is unavailable");
    }
  };
  requireClient();
  const query = async (sql, params) => {
    requireClient();
    const reply = await cronOwnedNativeQuery.call(db, sql, params);
    requireClient();
    return reply;
  };
  const contextSql = `
    select jsonb_build_object(
      'database_oid',(select oid::text from pg_catalog.pg_database where datname=current_database()),
      'database_name',current_database(),'actor',current_user,'session_actor',session_user,
      'backend_pid',pg_catalog.pg_backend_pid(),'transaction_id',pg_catalog.txid_current()::text,
      'transaction_started_at',pg_catalog.transaction_timestamp()::text,
      'read_only',pg_catalog.current_setting('transaction_read_only'),
      'replication_role',pg_catalog.current_setting('session_replication_role'),
      'port',pg_catalog.current_setting('port'),
      'job_owner',(select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class
        where oid='cron.job'::pg_catalog.regclass),
      'fences',(select pg_catalog.jsonb_agg(held order by label) from (
        select source.label,exists(select 1 from pg_catalog.pg_locks l
          where l.locktype='advisory' and l.pid=pg_catalog.pg_backend_pid()
          and l.database=(select oid from pg_catalog.pg_database where datname=current_database())
          and l.granted and l.mode='ExclusiveLock'
          and l.classid=((source.key>>32)&4294967295)::oid
          and l.objid=(source.key&4294967295)::oid and l.objsubid=1) held
        from (values
          ('admission',pg_catalog.hashtextextended('memphis-zoo-application-mutation-admission',0)),
          ('mutation',pg_catalog.hashtextextended('memphis-zoo-application-mutation-fence',0))
        ) source(label,key)
      ) observed)
    ) context
  `;
  const contextKeys = ["database_oid", "database_name", "actor", "session_actor", "backend_pid",
    "transaction_id", "transaction_started_at", "read_only", "replication_role", "port", "job_owner", "fences"];
  const readContext = async () => {
    const reply = await query(contextSql);
    assert.equal(reply.rowCount, 1);
    assert.equal(reply.rows.length, 1);
    assert.deepEqual(Object.keys(reply.rows[0]), ["context"]);
    const value = reply.rows[0].context;
    assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
    assert.deepEqual(Object.keys(value).sort(), [...contextKeys].sort());
    assert.match(value.database_oid, /^[1-9][0-9]*$/);
    assert.ok(typeof value.actor === "string" && value.actor.length > 0);
    assert.equal(value.actor, value.session_actor);
    assert.equal(value.actor, value.job_owner);
    assert.ok(Number.isInteger(value.backend_pid) && value.backend_pid > 0);
    assert.match(value.transaction_id, /^[1-9][0-9]*$/);
    assert.ok(typeof value.transaction_started_at === "string" && value.transaction_started_at.length > 0);
    assert.ok(typeof value.database_name === "string" && value.database_name.length > 0);
    assert.equal(value.read_only, "off");
    assert.equal(value.replication_role, "origin");
    assert.deepEqual(value.fences, [true, true]);
    assert.ok(typeof value.port === "string" && /^[1-9][0-9]*$/.test(value.port)
      && Number(value.port) <= 65535);
    return Object.freeze({ ...value, fences: Object.freeze([...value.fences]) });
  };
  // Separate statements reject autocommit/successor transactions before any
  // savepoint/effect, rather than treating the native client as ownership.
  const originalContext = await readContext();
  const requireContext = async () => assert.deepEqual(await readContext(), originalContext,
    "Cron owning case lost the original actor/transaction/fences");
  await requireContext();

  const quote = value => {
    assert.ok(typeof value === "string" && value.length > 0 && !value.includes("\0")
      && Buffer.byteLength(value, "utf8") <= 63);
    return '"' + value.replaceAll('"', '""') + '"';
  };
  let originalJobs, originalSequence, originalSequenceCatalog;
  const readSequence = async () => {
    requireClient();
    const identity = await resolveCronJobDefaultSequence(db);
    requireClient();
    assert.equal(identity.owner_name, originalContext.actor);
    if (originalSequenceCatalog) assert.deepEqual(identity, originalSequenceCatalog);
    const state = await query(`select last_value::text last_value,is_called from ${quote(identity.schema_name)}.${quote(identity.sequence_name)}`);
    assert.equal(state.rowCount, 1);
    assert.equal(state.rows.length, 1);
    assert.deepEqual(Object.keys(state.rows[0]), ["last_value", "is_called"]);
    assert.ok(typeof state.rows[0].last_value === "string" && /^[1-9][0-9]*$/.test(state.rows[0].last_value)
      && BigInt(state.rows[0].last_value) <= 9223372036854775807n);
    assert.equal(typeof state.rows[0].is_called, "boolean");
    return { identity: { ...identity }, state: { ...state.rows[0] } };
  };
  const readCounts = async () => {
    const result = await query(`select (select count(*)::text from cron.job) row_count,
      n_tup_ins::text inserted,n_tup_upd::text updated,n_tup_del::text deleted
      from pg_catalog.pg_stat_xact_all_tables where relid='cron.job'::pg_catalog.regclass`);
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows.length, 1);
    return { ...result.rows[0] };
  };
  let activeSavepoint = false, failure, result;
  const cleanupFailures = [];
  try {
    await query("SAVEPOINT cron_int64_owned_database_case");
    activeSavepoint = true;
    await requireContext();
    await query("LOCK TABLE cron.job IN ACCESS EXCLUSIVE MODE");
    originalJobs = await readCronJobs(db);
    requireClient();
    const sequence = await readSequence();
    originalSequenceCatalog = sequence.identity;
    originalSequence = sequence.state;
    await requireContext();

    const sourceDatabase = "cron_int64_owned_source_fixture";
    assert.notEqual(sourceDatabase, originalContext.database_name);
    const jobs = [7, "9007199254740992", "9007199254740993", "9223372036854775807"].map((jobid, index) => ({
      jobid, schedule: "0 0 1 1 *", command: "SELECT 1", nodename: "localhost",
      nodeport: Number(originalContext.port), database: sourceDatabase, username: originalContext.actor,
      active: false, jobname: `cron-int64-owned-${index}`,
    }));
    const originalInput = JSON.stringify(jobs);
    let beforeInvalid = null, afterInvalid = null;
    let invalidInputRefusals = 0;
    if (!transactionalRollbackOnly) {
    beforeInvalid = await readCounts();
    for (const jobid of [undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, Number("9223372036854775807")]) {
      await requireContext();
      await assert.rejects(restoreCronJobs(db, [{ ...jobs[0], jobid }], { sourceDatabase }), /BIGINT jobid/);
      requireClient();
      invalidInputRefusals++;
    }
    afterInvalid = await readCounts();
    assert.deepEqual(afterInvalid, beforeInvalid, "Unknown/unsafe numbers must refuse before actual mutation");
    }
    assert.deepEqual(await readCronJobs(db), originalJobs);
    assert.deepEqual((await readSequence()).state, originalSequence);
    await requireContext();
    const restored = await restoreCronJobs(db, jobs, { sourceDatabase });
    requireClient();
    await requireContext();
    const expected = normalizedCronJobs(jobs, { sourceDatabase, targetDatabase: originalContext.database_name });
    assert.deepEqual(restored.before, originalJobs);
    assert.deepEqual(restored.expected, expected);
    assert.deepEqual(restored.actual, expected);
    assert.deepEqual(restored.differences, []);
    assert.equal(restored.target_database, originalContext.database_name);
    const actual = await readCronJobs(db);
    assert.deepEqual(actual, expected);
    assert.deepEqual(compareCronJobs(expected, actual), []);
    // Explicit numeric ORDER BY avoids the TEXT output alias sorting lexically.
    const persisted = await query("select j.jobid::text jobid,j.active from cron.job j order by j.jobid");
    assert.equal(persisted.rowCount, 4);
    assert.deepEqual(persisted.rows.map(row => row.jobid), ["7", "9007199254740992", "9007199254740993", "9223372036854775807"]);
    assert.equal(new Set(persisted.rows.map(row => row.jobid)).size, 4);
    assert.ok(persisted.rows.every(row => row.active === false));
    assert.deepEqual((await readSequence()).state, { last_value: "9223372036854775807", is_called: true });
    assert.equal(JSON.stringify(jobs), originalInput);
    await requireContext();
    result = { original_jobs_count: originalJobs.length, restored_synthetic_jobs_count: 4,
      invalid_input_refusals: invalidInputRefusals, invalid_input_mutation_counts_before: beforeInvalid,
      invalid_input_mutation_counts_after: afterInvalid };
  } catch (error) {
    failure = error;
  } finally {
    if (activeSavepoint) {
      let rolledBack = false;
      try { await query("ROLLBACK TO SAVEPOINT cron_int64_owned_database_case"); rolledBack = true; }
      catch (error) { cleanupFailures.push(error); }
      if (rolledBack) {
        try { await query("RELEASE SAVEPOINT cron_int64_owned_database_case"); activeSavepoint = false; }
        catch (error) { cleanupFailures.push(error); }
        try {
          await requireContext();
          if (originalJobs) assert.deepEqual(await readCronJobs(db), originalJobs,
            "Original cron jobs differ after savepoint rollback");
          if (originalSequence) assert.deepEqual((await readSequence()).state, originalSequence,
            "Original cron sequence did not return after rollback; no compensation is permitted");
          await requireContext();
        } catch (error) { cleanupFailures.push(error); }
      }
    }
  }
  if (cleanupFailures.length) throw new AggregateError(failure ? [failure, ...cleanupFailures] : cleanupFailures,
    "Cron owning case cleanup/readback is unqualified; caller retains transaction responsibility", { cause: failure ?? cleanupFailures[0] });
  if (failure) throw failure;
  return Object.freeze({ ...result, original_jobs_restored: true, original_sequence_state_restored: true,
    caller_transaction_left_open: true, ...(transactionalRollbackOnly ? { profile: "transactional-rollback-only" } : {}) });
}

// Exact query-string import is intentionally side-effect free: no old/default
// unit groups, process.exit, connection acquisition, or SQL runs on import.
if (!["?cron-int64-owned-database-case", "?cron-transactional-rollback-owned-database-case"].includes(new URL(import.meta.url).search)) {

if (process.argv.includes("--cron-transactional-restart-only")) {
  const job = { jobid: "9223372036854775807", schedule: "0 0 1 1 *", command: "SELECT 1",
    nodename: "localhost", nodeport: 5432, database: "original_source", username: "supabase_admin", active: false, jobname: null };
  const fixture = ({ descriptor = syntheticCronDefaultSequence(), onRestart, restartError, setvalError, onSetval } = {}) => {
    const state = { descriptor, calls: [], rows: [], effects: [], setval: null };
    state.client = { query: async (sql, params = []) => {
      state.calls.push({ sql, params });
      if (sql.includes("unsupported_dependency_count")) return { rowCount: 1, rows: [{ ...state.descriptor }] };
      if (sql === "select current_database() database_name") return { rows: [{ database_name: "mz_schema_rebuild_restart_unit" }] };
      if (sql.includes("from cron.job j order by j.jobid")) return { rows: state.rows.map(row => ({ row: { ...row } })) };
      if (sql.startsWith("alter sequence ")) {
        state.effects.push("restart");
        if (restartError) throw restartError;
        onRestart?.(state); return { rows: [] };
      }
      if (sql === "truncate cron.job restart identity") { state.effects.push("truncate"); state.rows = []; return { rows: [] }; }
      if (sql.includes("insert into cron.job(")) {
        state.effects.push("insert");
        state.rows.push(Object.fromEntries(["jobid", "schedule", "command", "nodename", "nodeport", "database", "username", "active", "jobname"].map((key, index) => [key, params[index]])));
        return { rows: [] };
      }
      if (sql === "select setval($1::regclass,$2,$3)") {
        state.effects.push("setval"); state.setval = [...params];
        if (setvalError) throw setvalError;
        onSetval?.(state); return { rows: [] };
      }
      throw new Error("Unexpected transactional restart recording SQL");
    } };
    return state;
  };
  let passed = 0;
  const check = async (name, test) => { await test(); passed++; console.log(`CRON_TRANSACTIONAL_RESTART_NEW ${name} PASS`); };
  await check("restart-before-data-and-exact-max-setval", async () => {
    const state = fixture();
    const result = await restoreCronJobs(state.client, [job], { sourceDatabase: "original_source" });
    assert.deepEqual(state.effects, ["restart", "truncate", "insert", "setval"]);
    assert.equal(state.calls.find(call => call.sql.startsWith("alter sequence ")).sql, 'alter sequence "cron"."jobid_seq" restart');
    assert.deepEqual(state.setval, ["40123", job.jobid, true]);
    assert.deepEqual(result.differences, []);
    const restart = state.calls.findIndex(call => call.sql.startsWith("alter sequence "));
    assert.ok(state.calls[restart - 1].sql.includes("unsupported_dependency_count"));
    assert.ok(state.calls[restart + 1].sql.includes("unsupported_dependency_count"));
  });
  await check("empty-retains-existing-start-and-setval-false", async () => {
    const state = fixture(); await restoreCronJobs(state.client, []);
    assert.deepEqual(state.effects, ["restart", "truncate", "setval"]);
    assert.deepEqual(state.setval, ["40123", "1", false]);
    const sql = state.calls.find(call => call.sql.startsWith("alter sequence ")).sql;
    assert.equal(sql, 'alter sequence "cron"."jobid_seq" restart');
    assert.equal(/\b(with|start|increment|minvalue|maxvalue|cycle|cache|owner|owned|grant)\b/i.test(sql), false);
  });
  await check("catalog-identifiers-quoted-not-caller-sql", async () => {
    const descriptor = syntheticCronDefaultSequence({ schema_name: 'odd"schema', sequence_name: 'id"; SELECT 9;--' });
    const state = fixture({ descriptor }); await restoreCronJobs(state.client, [job]);
    assert.equal(state.calls.find(call => call.sql.startsWith("alter sequence ")).sql,
      'alter sequence "odd""schema"."id""; SELECT 9;--" restart');
    assert.deepEqual(state.setval, ["40123", job.jobid, true]);
  });
  await check("owner-withdrawal-after-restart-stops-before-truncate", async () => {
    const state = fixture({ onRestart: current => { current.descriptor.owner_name = "successor_owner"; } });
    await assert.rejects(restoreCronJobs(state.client, [job]), /unsupported or changed/);
    assert.deepEqual(state.effects, ["restart"]); assert.equal(state.setval, null);
  });
  await check("restart-permission-error-preserved-with-no-data-or-retry", async () => {
    const error = Object.assign(new Error("synthetic owner refusal"), { code: "42501" });
    const state = fixture({ restartError: error });
    await assert.rejects(restoreCronJobs(state.client, [job]), actual => actual === error);
    assert.deepEqual(state.effects, ["restart"]);
    assert.equal(state.calls.filter(call => call.sql.startsWith("alter sequence ")).length, 1);
  });
  await check("setval-failure-not-compensated-or-replayed", async () => {
    const error = new Error("synthetic setval uncertainty"); const state = fixture({ setvalError: error });
    await assert.rejects(restoreCronJobs(state.client, [job]), actual => actual === error);
    assert.deepEqual(state.effects, ["restart", "truncate", "insert", "setval"]);
    assert.equal(state.calls.filter(call => call.sql.startsWith("select setval(")).length, 1);
    assert.equal(state.calls.some(call => /^(rollback|commit|begin)\b/i.test(call.sql)), false);
  });
  await check("post-setval-original-withdrawal-remains-unknown", async () => {
    const state = fixture({ onSetval: current => { current.descriptor.sequence_oid = "40124"; } });
    await assert.rejects(restoreCronJobs(state.client, [job]), /unsupported or changed/);
    assert.deepEqual(state.effects, ["restart", "truncate", "insert", "setval"]);
  });
  await check("fixed-positive-profile-import-without-old-groups-or-sql", async () => {
    const url = new URL(import.meta.url); url.search = "cron-transactional-rollback-owned-database-case";
    const exported = await import(url.href);
    assert.equal(typeof exported.runCronTransactionalRollbackOwnedDatabaseCase, "function");
    assert.equal(typeof exported.runCronInt64OwnedDatabaseCase, "function");
    await assert.rejects(exported.runCronTransactionalRollbackOwnedDatabaseCase({}), /actual unmodified pg.Client/);
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL(import.meta.url), "utf8");
    assert.ok(text.includes("return runCronOwnedDatabaseCase(db, true);"));
    assert.ok(text.includes("if (!transactionalRollbackOnly) {\n    beforeInvalid = await readCounts();"));
    assert.ok(text.includes('"Original cron sequence did not return after rollback; no compensation is permitted"'));
    assert.ok(text.includes('await query("ROLLBACK TO SAVEPOINT cron_int64_owned_database_case")'));
  });
  console.log(JSON.stringify({ selector: "--cron-transactional-restart-only", passed,
    recording_only: true, actual_sql_or_rollback: "NOT_RUN", old_groups_run: 0 }));
} else if (process.argv.includes("--cron-default-sequence-only")) {
  const baseJob = { jobid: "9223372036854775807", schedule: "0 0 1 1 *", command: "SELECT 1",
    nodename: "localhost", nodeport: 5432, database: "original_source", username: "supabase_admin", active: false, jobname: null };
  const fixture = ({ descriptor = syntheticCronDefaultSequence(), onRead, onEffect, catalogRows } = {}) => {
    const state = { descriptor, rows: [], queries: [], catalogReads: 0, effects: [], setval: null };
    state.client = { query: async (sql, params = []) => {
      state.queries.push({ sql, params });
      if (sql.includes("unsupported_dependency_count")) {
        state.catalogReads++;
        assert.ok(sql.includes("pg_catalog.pg_attrdef") && sql.includes("pg_catalog.pg_depend"));
        assert.ok(sql.includes("pg_catalog.pg_get_expr") && sql.includes("expected_expression"));
        assert.equal(sql.includes("pg_get_serial_sequence"), false);
        const rows = catalogRows === undefined ? [{ ...state.descriptor }] : catalogRows;
        return { rowCount: rows.length, rows };
      }
      if (sql === "select current_database() database_name") return { rows: [{ database_name: "mz_schema_rebuild_sequence_unit" }] };
      if (sql === 'alter sequence "cron"."jobid_seq" restart') return { rows: [] };
      if (sql.includes("from cron.job j order by j.jobid")) {
        onRead?.(state);
        return { rows: state.rows.map(row => ({ row: { ...row } })) };
      }
      if (sql === "truncate cron.job restart identity") { state.effects.push("truncate"); state.rows = []; onEffect?.(state, "truncate"); return { rows: [] }; }
      if (sql.includes("insert into cron.job(")) {
        state.effects.push("insert");
        state.rows.push(Object.fromEntries(["jobid", "schedule", "command", "nodename", "nodeport", "database", "username", "active", "jobname"].map((key, index) => [key, params[index]])));
        onEffect?.(state, "insert"); return { rows: [] };
      }
      if (sql === "select setval($1::regclass,$2,$3)") { state.effects.push("setval"); state.setval = [...params]; onEffect?.(state, "setval"); return { rows: [] }; }
      throw new Error("Unexpected new default-sequence fixture SQL");
    } };
    return state;
  };
  let passed = 0;
  const check = async (name, test) => { await test(); passed++; console.log(`CRON_DEFAULT_SEQUENCE_NEW ${name} PASS`); };
  await check("fixed-catalog-resolver-without-serial-ownership", async () => {
    const state = fixture();
    const resolved = await resolveCronJobDefaultSequence(state.client);
    assert.deepEqual(resolved, syntheticCronDefaultSequence());
    assert.ok(Object.isFrozen(resolved));
    assert.equal(state.catalogReads, 1); assert.deepEqual(state.effects, []);
  });
  await check("missing-ambiguous-and-custom-default-before-effects", async () => {
    for (const overrides of [
      { sequence_dependency_count: 0, sequence_oid: null }, { default_oid: null, default_node: null },
      { sequence_dependency_count: 2 }, { unsupported_dependency_count: 1 },
      { default_expression: "nextval('cron.jobid_seq'::regclass) + 1" },
      { default_expression: "custom_nextval('cron.jobid_seq'::regclass)" },
      { sequence_kind: "r" }, { sequence_persistence: "u" }, { job_identity: "a" }, { job_type_oid: "23" },
    ]) {
      const state = fixture({ descriptor: syntheticCronDefaultSequence(overrides) });
      await assert.rejects(restoreCronJobs(state.client, [baseJob]), /default sequence is unsupported or changed/);
      assert.deepEqual(state.effects, []);
    }
    for (const catalogRows of [[], [syntheticCronDefaultSequence(), syntheticCronDefaultSequence()]]) {
      const state = fixture({ catalogRows });
      await assert.rejects(restoreCronJobs(state.client, [baseJob]), /default sequence is unsupported or changed/);
      assert.deepEqual(state.effects, []);
    }
  });
  await check("exact-closed-types-and-detached-catalog-result", async () => {
    for (const overrides of [{ sequence_oid: 40123 }, { sequence_oid: "040123" }, { sequence_oid: "4294967296" },
      { sequence_dependency_count: "1" }, { unsupported_dependency_count: false }, { owner_name: null }, { extra: false }]) {
      await assert.rejects(resolveCronJobDefaultSequence(fixture({ descriptor: syntheticCronDefaultSequence(overrides) }).client), /unsupported or changed/);
    }
    let invoked = 0;
    const row = syntheticCronDefaultSequence();
    Object.defineProperty(row, "sequence_oid", { enumerable: true, get() { invoked++; return "40123"; } });
    await assert.rejects(resolveCronJobDefaultSequence(fixture({ catalogRows: [row] }).client), /unsupported or changed/);
    assert.equal(invoked, 0);
    const state = fixture(); const original = await resolveCronJobDefaultSequence(state.client);
    state.descriptor.sequence_oid = "40124"; assert.equal(original.sequence_oid, "40123");
  });
  await check("restore-max-int64-to-original-catalog-oid", async () => {
    const state = fixture();
    const result = await restoreCronJobs(state.client, [{ ...baseJob, jobid: 7, jobname: "legacy" }, baseJob], { sourceDatabase: "original_source" });
    assert.deepEqual(result.differences, []);
    assert.deepEqual(result.actual.map(row => row.jobid), ["7", baseJob.jobid]);
    assert.ok(result.actual.every(row => row.database === "mz_schema_rebuild_sequence_unit"));
    assert.deepEqual(state.setval, ["40123", baseJob.jobid, true]);
    assert.equal(state.queries.some(row => row.sql.includes("pg_get_serial_sequence")), false);
  });
  await check("identity-owner-and-original-transaction-withdrawal-before-truncate", async () => {
    for (const overrides of [{ owner_name: "successor_owner" }, { sequence_oid: "40124" }, { default_oid: "40102" },
      { default_node: "SUCCESSOR_EXPRESSION_NODE" }, { virtual_transaction: "5/13" }, { actor: "successor_actor" }]) {
      const state = fixture({ onRead: current => Object.assign(current.descriptor, overrides) });
      await assert.rejects(restoreCronJobs(state.client, [baseJob]), /unsupported or changed/);
      assert.deepEqual(state.effects, []);
    }
  });
  await check("post-truncate-or-insert-withdrawal-stops-next-effect", async () => {
    for (const point of ["truncate", "insert"]) {
      const state = fixture({ onEffect: (current, effect) => { if (effect === point) current.descriptor.owner_name = "successor_owner"; } });
      await assert.rejects(restoreCronJobs(state.client, [baseJob]), /unsupported or changed/);
      assert.deepEqual(state.effects, point === "truncate" ? ["truncate"] : ["truncate", "insert"]);
      assert.equal(state.setval, null);
    }
  });
  await check("post-setval-change-is-unknown-no-replay-or-success", async () => {
    const state = fixture({ onEffect: (current, effect) => { if (effect === "setval") current.descriptor.sequence_oid = "40124"; } });
    await assert.rejects(restoreCronJobs(state.client, [baseJob]), /unsupported or changed/);
    assert.deepEqual(state.effects, ["truncate", "insert", "setval"]);
    assert.equal(state.queries.filter(row => row.sql.startsWith("select setval(")).length, 1);
  });
  await check("empty-inventory-still-requires-resolved-default", async () => {
    const supported = fixture(); await restoreCronJobs(supported.client, []);
    assert.deepEqual(supported.setval, ["40123", "1", false]);
    const missing = fixture({ catalogRows: [] });
    await assert.rejects(restoreCronJobs(missing.client, []), /unsupported or changed/);
    assert.deepEqual(missing.effects, []);
  });
  console.log(JSON.stringify({ selector: "--cron-default-sequence-only", passed,
    actual_catalog_and_sql: "NOT_RUN", catalog_rows: "SYNTHETIC, not v33 default evidence", old_groups_run: 0 }));
} else if (process.argv.includes("--cron-int64-only")) {
  const { readFileSync } = await import("node:fs");
  const { default: pg } = await import("pg");
  const { stableJsonFile } = await import("./disaster-recovery-crypto.mjs");
  const parse = pg.types.getTypeParser(114);
  const original = {
    jobid: "9223372036854775807", schedule: "5 * * * *",
    command: "select public.expire_stale_open_sessions();", nodename: "localhost",
    nodeport: 5432, database: "postgres", username: "postgres", active: true, jobname: null,
  };
  let passed = 0;
  const check = async (name, test) => { await test(); passed++; console.log(`CRON_INT64_NEW ${name} PASS`); };

  await check("actual-driver-loss-and-text-seal", () => {
    const numericJson = JSON.stringify(original).replace('"jobid":"9223372036854775807"', '"jobid":9223372036854775807');
    const rounded = parse(numericJson);
    assert.equal(BigInt(rounded.jobid), 9223372036854775808n);
    assert.throws(() => normalizedCronJobs([rounded]), /BIGINT jobid/);
    const exact = parse(JSON.stringify(original));
    assert.deepEqual(JSON.parse(stableJsonFile([exact])), [original]);
    assert.deepEqual(normalizedCronJobs([exact]), [original]);
  });
  await check("bigint-ordering-and-distinct-adjacent-ids", () => {
    const ids = [original.jobid, "9007199254740993", "10", "9007199254740992", "2", "9007199254740991"];
    assert.deepEqual(normalizedCronJobs(ids.map(jobid => ({ ...original, jobid }))).map(row => row.jobid),
      ["2", "10", "9007199254740991", "9007199254740992", "9007199254740993", original.jobid]);
  });
  await check("safe-legacy-input-and-comparison", () => {
    const legacy = { ...original, jobid: 7, jobname: "original-job" };
    const before = JSON.stringify(legacy);
    assert.deepEqual(normalizedCronJobs([legacy]), [{ ...legacy, jobid: "7" }]);
    assert.deepEqual(compareCronJobs([legacy], [{ ...legacy, jobid: "7" }]), []);
    assert.equal(JSON.stringify(legacy), before);
    assert.equal(compareCronJobs([original], [{ ...original, active: false }]).length, 1);
    assert.throws(() => normalizedCronJobs([legacy, { ...legacy, jobid: "7" }]), /duplicated/);
  });
  await check("reject-noncanonical-and-lost-bits", () => {
    for (const jobid of [0, -0, -1, 1.5, NaN, Infinity, 9007199254740992, Number(original.jobid),
      "", "0", "01", "+1", "-1", " 1", "1 ", "1\n", "1.0", "1e3", "9223372036854775808", "99999999999999999999", null, true, {}, 7n]) {
      assert.throws(() => normalizedCronJobs([{ ...original, jobid }]), /BIGINT jobid/);
    }
    for (const nodeport of [0, -1, 65536, 1.5, Infinity]) {
      assert.throws(() => normalizedCronJobs([{ ...original, nodeport }]), /invalid pg_cron job state/);
    }
  });

  // Execute just the actual shipping capture region, not backup entrypoint,
  // against synthetic driver responses. No connection, snapshot or signing.
  const backup = readFileSync(new URL("./production-backup.mjs", import.meta.url), "utf8");
  const captureStart = backup.indexOf("  const cronResult = await client.query(");
  const captureEnd = backup.indexOf("  const extensionResult =", captureStart);
  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const capture = new AsyncFunction("client", `let cronJobs;\n${backup.slice(captureStart, captureEnd)}\nreturn cronJobs;`);
  const requireProjection = sql => {
    assert.match(sql, /'jobid', j\.jobid::text/);
    assert.match(sql, /from cron\.job j order by j\.jobid/);
    for (const field of ["schedule", "command", "nodename", "nodeport", "database", "username", "active", "jobname"]) {
      assert.ok(sql.includes(`'${field}', j.${field}`));
    }
  };
  await check("actual-backup-region-preserves-and-refuses-numeric-capture", async () => {
    const client = { query: async sql => { requireProjection(sql); return { rows: [{ row: parse(JSON.stringify(original)) }] }; } };
    assert.deepEqual(await capture(client), [original]);
    for (const jobid of [7, "01", "9223372036854775808", "1\n", null]) {
      await assert.rejects(capture({ query: async () => ({ rows: [{ row: { ...original, jobid } }] }) }), /captured pg_cron BIGINT/);
    }
  });
  await check("actual-reader-text-projection", async () => {
    const actual = await readCronJobs({ query: async sql => {
      requireProjection(sql); return { rows: [{ row: parse(JSON.stringify(original)) }] };
    } });
    assert.deepEqual(actual, [original]);
  });

  const restoreFixture = () => {
    let rows = [], setval = null;
    const calls = [];
    return { calls, get setval() { return setval; }, client: { query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("unsupported_dependency_count")) return { rowCount: 1, rows: [syntheticCronDefaultSequence()] };
      if (sql === "select current_database() database_name") return { rows: [{ database_name: "mz_schema_rebuild_unit" }] };
      if (sql === 'alter sequence "cron"."jobid_seq" restart') return { rows: [] };
      if (sql.includes("from cron.job j")) { requireProjection(sql); return { rows: rows.map(row => ({ row: parse(JSON.stringify(row)) })) }; }
      if (sql === "truncate cron.job restart identity") { rows = []; return { rows: [] }; }
      if (sql.includes("insert into cron.job")) {
        assert.equal(typeof params[0], "string");
        rows.push(Object.fromEntries(["jobid", "schedule", "command", "nodename", "nodeport", "database", "username", "active", "jobname"].map((key, i) => [key, params[i]])));
        return { rows: [] };
      }
      if (sql.includes("pg_get_serial_sequence")) return { rows: [{ sequence_name: "cron.jobid_seq" }] };
      if (sql === "select setval($1::regclass,$2,$3)") { setval = [...params]; return { rows: [] }; }
      throw new Error("Unexpected synthetic SQL fixture call");
    } } };
  };
  await check("restore-exact-params-bigint-max-and-mapping", async () => {
    const fixture = restoreFixture();
    const input = [original, { ...original, jobid: 7, jobname: "legacy" }, { ...original, jobid: "9007199254740993", jobname: "large", database: "other_original" }];
    const unchanged = JSON.stringify(input);
    const result = await restoreCronJobs(fixture.client, input, { sourceDatabase: "postgres" });
    assert.deepEqual(result.differences, []);
    assert.deepEqual(result.actual.map(row => row.jobid), ["7", "9007199254740993", original.jobid]);
    assert.deepEqual(fixture.setval, ["40123", original.jobid, true]);
    assert.equal(result.actual[0].database, "mz_schema_rebuild_unit");
    assert.equal(result.actual[1].database, "other_original");
    assert.deepEqual(result.actual[2], { ...original, database: "mz_schema_rebuild_unit" });
    assert.equal(JSON.stringify(input), unchanged);
  });
  await check("restore-refusal-before-mutation-and-empty-sequence", async () => {
    const invalid = restoreFixture();
    await assert.rejects(restoreCronJobs(invalid.client, [{ ...original, jobid: Number(original.jobid) }]), /BIGINT jobid/);
    assert.equal(invalid.calls.length, 1); // Target identity only, no mutation.
    const empty = restoreFixture();
    assert.deepEqual((await restoreCronJobs(empty.client, [])).differences, []);
    assert.deepEqual(empty.setval, ["40123", "1", false]);
  });
  console.log(JSON.stringify({ selector: "--cron-int64-only", passed, actual_postgres_roundtrip: "NOT_RUN", synthetic_sql_adapter_only: true }));
} else {

const jobs = [{
  jobid: "7",
  schedule: "5 * * * *",
  command: "select public.expire_stale_open_sessions();",
  nodename: "localhost",
  nodeport: 5432,
  database: "postgres",
  username: "postgres",
  active: true,
  jobname: "mz-stale-sessions-hourly",
}];
assert.deepEqual(normalizedCronJobs(jobs), jobs.map(job => ({ ...job, jobid: String(job.jobid) })));
assert.equal(normalizedCronJobs(jobs, { sourceDatabase: "postgres", targetDatabase: "mz_schema_rebuild_1" })[0].database, "mz_schema_rebuild_1");
assert.deepEqual(compareCronJobs(jobs, jobs), []);
assert.equal(compareCronJobs(jobs, [{ ...jobs[0], active: false }]).length, 1);
assert.throws(() => normalizedCronJobs([{ ...jobs[0], leaked: true }]), /supported pg_cron job catalog/);
assert.throws(() => normalizedCronJobs([...jobs, { ...jobs[0] }]), /duplicated/);
console.log("DISASTER_RECOVERY_CRON_TESTS_PASS");
}
}
