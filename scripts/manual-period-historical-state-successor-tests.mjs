import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertHistoricalPeriodRevisionState as check,deriveManualPeriodHistoricalStateSource as derive,originalManualPeriodSha} from './manual-period-historical-state-successor.mjs';
const original=readFileSync(new URL('./manual-period-repair-database-extension.mjs',import.meta.url));
const add=(s,n)=>new Date(Date.parse(s+'T12:00Z')+n*86400000).toISOString().slice(0,10);
const fixture=i=>{const activationDate=add('2026-11-16',i),serviceDate=add(activationDate,-1),start=add(serviceDate,-((new Date(serviceDate+'T12:00Z').getUTCDay()+6)%7)),end=add(start,6),stale=activationDate<=end;return {activationDate,serviceDate,currentPublicationId:'new-publication',state:{authority:{governed:true,service_date:serviceDate,publication_id:'old-publication',projection_id:'00000000-0000-4000-8000-000000000001',week_start:start,projection_authority_revision:5,staffing_authority_revision:stale?8:3,projection_status:stale?'stale_staffing_change':'current'},matching_projection_rows:1,projections:[{id:'00000000-0000-4000-8000-000000000001',week_start:start,week_end:end}]}};};
test('Monday previous-week current and all six within-week stale branches validate exact revisions',()=>{for(let i=0;i<7;i++)assert.equal(check(fixture(i)),i===0?'current':'stale_staffing_change');});
test('stale evidence remains mandatory when qualifying revision invalidates it',()=>{const f=fixture(0);f.state.authority.staffing_authority_revision=5;f.state.authority.projection_status='stale_staffing_change';assert.equal(check(f),'stale_staffing_change');f.state.authority.projection_status='current';assert.throws(()=>check(f));});
test('unknown statuses, false current, missing or changed identity/period/revision fail',()=>{
 for(const mutate of [f=>f.state.authority.projection_status='missing_projection',f=>f.state.authority.projection_status='current',f=>f.state.authority.projection_authority_revision=0,f=>f.state.authority.staffing_authority_revision=-1,f=>f.state.matching_projection_rows=0,f=>f.state.projections=[],f=>f.state.authority.publication_id=f.currentPublicationId,f=>f.state.projections[0].week_end='2026-11-23',f=>f.activationDate=add(f.activationDate,1),f=>f.state.authority.projection_id='wrong',f=>{f.state.authority.staffing_authority_revision=3;f.state.authority.projection_status='current';}]){const f=fixture(1);mutate(f);assert.throws(()=>check(f));}
});
test('exact source derivation preserves original stale helper, SQL, plan and every other callback byte',()=>{
 assert.equal(createHash('sha256').update(original).digest('hex'),originalManualPeriodSha);const d=derive(original);assert.equal(d.runtimeSqlChanged,false);assert.equal(d.originalPlanChanged,false);assert.ok(d.source.includes("if(historicalStatus==='stale_staffing_change')assertStoredStaleHistoricalPeriod"));
 assert.throws(()=>derive(Buffer.concat([original,Buffer.from('\n')])));assert.throws(()=>derive(Buffer.from(original.toString().replace("'stale_staffing_change'","'current'"))));
});
