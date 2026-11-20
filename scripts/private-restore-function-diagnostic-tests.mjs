import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {removePrivateCatalogLeaseRunner} from './private-catalog-lease-runner-source.mjs';
import {createHash} from 'node:crypto';
import {privateFunctionStatsArguments,PRIVATE_FUNCTION_STATS_SQL,projectPrivateFunctionStats,readPrivateFunctionStats} from './private-restore-function-diagnostic.mjs';
const current={id:'immutable-private-current-postgres',actor:'postgres'};
const row=(digest='a'.repeat(64))=>({function_sha256:digest,calls:'824',total_ms:'12345.678',self_ms:'12.345'});
const fixture=()=>({schema:'custodial.private-restore-function-cost.v1',track_functions:'all',jit:'on',functions:[row()]});
test('only authenticated current owner profile adds statistics; old profiles and invalid records remain unchanged',()=>{
 assert.deepEqual(privateFunctionStatsArguments(current),['-c','track_functions=all']);
 for(const value of [null,{},'postgres',{...current,extra:true},{...current,actor:'supabase_admin'},
  {id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'},new Proxy(current,{})])
  assert.deepEqual(privateFunctionStatsArguments(value),[]);
 let traps=0;const getter={actor:'postgres'};Object.defineProperty(getter,'id',{enumerable:true,get(){traps++;return current.id;}});
 assert.deepEqual(privateFunctionStatsArguments(getter),[]);assert.equal(traps,0);
});
test('statistics read is one fixed bounded SELECT and never reads DATA/query text or changes admission',()=>{
 assert.match(PRIVATE_FUNCTION_STATS_SQL,/^SELECT jsonb_build_object\(/);
 assert.match(PRIVATE_FUNCTION_STATS_SQL,/FROM pg_stat_user_functions s JOIN pg_proc p/);
 assert.match(PRIVATE_FUNCTION_STATS_SQL,/LIMIT 32/);
 assert.match(PRIVATE_FUNCTION_STATS_SQL,/extensions\.digest\(convert_to\(format/);
 assert.doesNotMatch(PRIVATE_FUNCTION_STATS_SQL,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|GRANT|SET|COPY|query|prosrc|pg_get_functiondef)\b/i);
});
test('statistics projection returns only closed hash/counter/timing metadata',()=>{
 const value=fixture(),expected={...structuredClone(value),metadata_only:true,private_payload_exported:false};
 const projected=projectPrivateFunctionStats(value);
 assert.deepEqual(projected,expected);assert.deepEqual(readPrivateFunctionStats(JSON.stringify(value)),expected);
 value.functions[0].calls='1';assert.equal(projected.functions[0].calls,'824');
 assert.deepEqual(projectPrivateFunctionStats({...fixture(),functions:[]}).functions,[]);
 const rows=Array.from({length:32},(_,i)=>row(i.toString(16).padStart(64,'0')));
 assert.equal(projectPrivateFunctionStats({...fixture(),functions:rows}).functions.length,32);
 assert.equal(projectPrivateFunctionStats({...fixture(),functions:[...rows,row('f'.repeat(64))]}),null);
});
test('unknown fields, unbounded counters, invalid times and identities never export raw values',()=>{
 for(const value of [null,{},[],{...fixture(),extra:'PRIVATE'},{...fixture(),schema:'PRIVATE'},
  {...fixture(),track_functions:'private'},{...fixture(),jit:'PRIVATE'},
  {...fixture(),functions:[row(),row()]},{...fixture(),functions:new Array(1)},
  {...fixture(),functions:[{...row(),query:'PRIVATE SQL'}]},
  ...['PRIVATE','A'.repeat(64),'f'.repeat(65)].map(function_sha256=>({...fixture(),functions:[{...row(),function_sha256}]})),
  ...['-1','01','1.0','1000000000000000',824].map(calls=>({...fixture(),functions:[{...row(),calls}]})),
  ...['NaN','Infinity','1e3','-1.000','01.000','1','1.0000','1000000000000.000',12].map(total_ms=>({...fixture(),functions:[{...row(),total_ms}]})),
  {...fixture(),functions:[{...row(),self_ms:'99999.000'}]}])assert.equal(projectPrivateFunctionStats(value),null);
 for(const raw of ['PRIVATE SQL','{',' '.repeat(16385),null])assert.equal(readPrivateFunctionStats(raw),null);
});
test('accessors, proxies, symbol fields and sparse arrays are refused without invoking them',()=>{
 let traps=0;const value=fixture();Object.defineProperty(value,'jit',{get(){traps++;return 'on';}});
 const rows=[row()];Object.defineProperty(rows,'0',{get(){traps++;return row();}});
 const symbol=fixture();symbol[Symbol('PRIVATE')]='PRIVATE';
 for(const v of [value,symbol,new Proxy(fixture(),{get(){traps++;throw Error('PRIVATE');}}),
  {...fixture(),functions:rows},{...fixture(),functions:new Proxy([row()],{})}])assert.equal(projectPrivateFunctionStats(v),null);
 assert.equal(traps,0);
});
test('observations occur under exact cleanup identity after the original outcome, without admission or SQL program changes',()=>{
 const s=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
 assert.ok(s.includes("'-c','cron.database_name='+database,'-c','cron.launch_active_jobs=off',...privateFunctionStatsArguments(requireOwnerProfile())"));
 const a=s.indexOf('finalFunctionStats=readPrivateFunctionStats(');
 assert.ok(a>s.indexOf('finally{\n    phase=failure?phase:'));
 assert.ok(a>s.indexOf("assert.equal(value.Config.Image,PG_IMAGE)",s.indexOf('finally{\n    phase=failure?phase:')));
 assert.ok(a<s.indexOf("await docker(['rm','-f',cid]",a));
 assert.match(s.slice(a,a+310),/cleanup:true,timeout:5000/);
 assert.ok(s.includes('function_cost:finalFunctionStats'));
 assert.ok(s.includes('const privateRestoreWorkTimeoutMs=1900000;'));
});
test('complete runner byte inverse removes only the five observational source additions',()=>{
 const sha=v=>createHash('sha256').update(v).digest('hex');
 const raw=readFileSync(new URL('../release/installed-source/20261120_private_function_cost_observational_inverse.json',import.meta.url),'utf8');
 assert.equal(sha(raw),'37eab10bde43f2eee685dc6d3601803e0c09715d3faabb309bb24ba69f49e1cc');
 const inverse=JSON.parse(raw);assert.equal(inverse.hunks.length,5);
 assert.equal(inverse.format,'custodial.private-function-cost-observational-inverse.v1');
 let source=removePrivateCatalogLeaseRunner(readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8'));
 assert.equal(sha(source),inverse.currentSha256);
 for(const hunk of inverse.hunks){assert.equal(source.split(hunk.after).length,2);source=source.replace(hunk.after,()=>hunk.before);}
 assert.equal(sha(source),'3c1f648dff14122bbcc33c1e5f4cbe5b88a9458408ce1a48f5b65e1323b16eac');
 assert.equal(sha(source),inverse.previousSha256);
});
