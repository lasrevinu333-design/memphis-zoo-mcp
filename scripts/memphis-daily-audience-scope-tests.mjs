import assert from 'node:assert/strict';
import test from 'node:test';
import {summarizeDailyRoster,generateDailyStaffScheduleReply} from '../src/ai/memphis-ai-daily.js';

const day='2026-11-15',staff=[{employee_name:'Synthetic custodian',shift_start:'08:00',shift_end:'17:00'}];
for(const query of ['Who is working today?','staffing','Which custodians work today?'])test(query+' reports the actual custodial roster without an unrelated manager warning',()=>{
 const text=summarizeDailyRoster(staff,day,[],query);
 assert.match(text,/Custodians: Synthetic custodian 08:00-17:00/);
 assert.doesNotMatch(text,/Ops managers|not verified|can't verify/);
});
for(const query of ['Which ops managers work today?','Who is the boss today?'])test(query+' retains explicit unavailable manager information',()=>{
 const text=summarizeDailyRoster(staff,day,[],query);
 assert.match(text,/can't verify day-of ops-manager staffing/);assert.doesNotMatch(text,/Synthetic custodian/);
});
test('empty current custodial publication reports its actual scope, never an all-staff absence',()=>{
 const text=summarizeDailyRoster([],day,[],'Who is working today?');
 assert.match(text,/custodians scheduled to work in the current publication/);
 assert.doesNotMatch(text,/Ops-manager|no one|nobody/i);
});
test('an actually supplied manager roster remains available',()=>{
 const text=summarizeDailyRoster(staff,day,[{employee_name:'Synthetic manager',role_title:'Operations',shift_start:'07:00',shift_end:'16:00'}]);
 assert.match(text,/Ops managers: Synthetic manager \(Operations\) 07:00-16:00/);
 assert.match(text,/Custodians: Synthetic custodian/);
});
test('missing or stale current authority still reports unavailable rather than an empty roster',async()=>{
 for(const data of [null,{schema:'memphis.schedule-day.v1',status:'unavailable',rows:[],projection_status:'stale'}]){
  const result=await generateDailyStaffScheduleReply({runReadOnlySql:async()=>[{data}],serviceDate:day,queryText:'Who is working today?'});
  assert.match(result.text,/can't verify a current published custodial schedule/);
  assert.doesNotMatch(result.text,/none listed|couldn't find any custodians/);
 }
});
