// Read-only execution of the installed winner/range query against synthetic
// CTE relations. This tests real PostgreSQL query semantics, not publication
// admission, invalidation, recovery, or physical phone convergence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
const container=process.env.SHIFT_END_TEST_CONTAINER,socket=process.env.SHIFT_END_TEST_SOCKET;
assert.match(container??'',/^mz_schema_shift_end_[0-9]+$/);
assert.match(socket??'',/^\/tmp\/mz-shift-socket-[a-zA-Z0-9]+$/);
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',timeout:10000}))[0];
assert.equal(info.HostConfig.NetworkMode,'none');
assert.ok(info.Mounts.some(m=>m.Source===socket&&m.Destination==='/test-socket'));
const pool=new Pool({host:socket,user:'supabase_admin',password:'postgres',database:'postgres',max:1,connectionTimeoutMillis:3000});
const checks=[];
const check=(name,a,b)=>{assert.deepEqual(a,b,name);checks.push(name);};
try{
 const {rows}=await pool.query("select pg_get_viewdef('public.v_weekly_schedule_effective_ranges'::regclass,true) as definition");
 const definition=rows[0].definition;
 let query=definition.trim().replace(/;$/,'');
 for(const [table,replacement] of [['weekly_schedule_publications','test_publications'],['weekly_schedule_versions','test_versions']]){
  const matches=query.match(new RegExp('(?<![\\w])(?:public\\.)?'+table+'(?![\\w])','g'))??[];
  assert.equal(matches.length,1,'exact installed relation seam '+table);
  query=query.replace(new RegExp('(?<![\\w])(?:public\\.)?'+table+'(?![\\w])'),replacement);
 }
 const prefix=`with test_publications as (
  select * from jsonb_to_recordset($1::jsonb) as t(version_id uuid,effective_start date,authority_revision bigint)
 ),test_versions as (
  select * from jsonb_to_recordset($2::jsonb) as t(version_id uuid,version_number bigint,effective_start date,lifecycle_state text,publication_kind text,content_digest text)
 ) `;
 const id=n=>`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const base=[{version_id:id(1),effective_start:'2026-10-05',authority_revision:10},
  {version_id:id(2),effective_start:'2026-10-12',authority_revision:20},
  {version_id:id(3),effective_start:'2026-10-05',authority_revision:30},
  {version_id:id(4),effective_start:'2026-10-19',authority_revision:40}];
 const versions=base.map((row,index)=>({...row,version_number:index+1,lifecycle_state:'published',
  publication_kind:index?'supersede':'publish',content_digest:'a'.repeat(64)}));
 const evaluate=async(publications,sourceVersions)=>{
  const result=await pool.query(prefix+`select version_id,effective_start::text,effective_end::text from (${query}) ranges order by effective_start`,[JSON.stringify(publications),JSON.stringify(sourceVersions)]);
  return result.rows;
 };
 const expected=[{version_id:id(3),effective_start:'2026-10-05',effective_end:'2026-10-12'},
  {version_id:id(2),effective_start:'2026-10-12',effective_end:'2026-10-19'},
  {version_id:id(4),effective_start:'2026-10-19',effective_end:null}];
 check('duplicate Monday chooses latest revision before range calculation',await evaluate(base,versions),expected);
 check('storage order cannot select old duplicate Monday',await evaluate([...base].reverse(),[...versions].reverse()),expected);
 check('version display number cannot override authority revision',await evaluate(base,versions.map(v=>({...v,version_number:100-Number(v.version_number)}))),expected);
 check('third replacement of earlier future Monday remains below later distinct Monday',
  await evaluate([...base,{version_id:id(5),effective_start:'2026-10-05',authority_revision:50}],
   [...versions,{...versions[0],version_id:id(5),version_number:5}]),
  [{...expected[0],version_id:id(5)},...expected.slice(1)]);
 check('unpublished draft cannot become accepted winner',await evaluate(base,versions.map(v=>v.version_id===id(3)?{...v,lifecycle_state:'draft'}:v)),
  [{...expected[0],version_id:id(1)},...expected.slice(1)]);
 check('empty publication set has no invented schedule',await evaluate([],[]),[]);
 check('single publication remains indefinite',await evaluate([base[0]],[versions[0]]),
  [{version_id:id(1),effective_start:'2026-10-05',effective_end:null}]);
 for(const [date,expectedId] of [['2026-10-04',null],['2026-10-05',id(3)],['2026-10-11',id(3)],
  ['2026-10-12',id(2)],['2026-10-18',id(2)],['2026-10-19',id(4)],['2027-05-01',id(4)]]){
  const result=await pool.query(prefix+`select version_id from (${query}) ranges where effective_start<=$3::date and (effective_end is null or $3::date<effective_end)`,[JSON.stringify(base),JSON.stringify(versions),date]);
  check('one exact winner at '+date,result.rows.map(r=>r.version_id),expectedId?[expectedId]:[]);
 }
 const proof={status:'PASS',checks:checks.length,assertions:checks,
  installedViewSha256:createHash('sha256').update(definition).digest('hex'),
  production:false,independentAudit:false,scope:'installed PostgreSQL selector query with synthetic CTE inputs; no publication or invalidation writes'};
 if(process.env.STATIC_WEEKLY_RANGE_SELECTOR_EVIDENCE)writeFileSync(process.env.STATIC_WEEKLY_RANGE_SELECTOR_EVIDENCE,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(proof));
}finally{await pool.end();}
