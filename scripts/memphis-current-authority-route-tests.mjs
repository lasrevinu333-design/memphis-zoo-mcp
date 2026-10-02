import assert from 'node:assert/strict';
import {createMemphisResponder} from '../src/memphis-ai.js';
import {generateDailyStaffScheduleReply} from '../src/ai/memphis-ai-daily.js';
import {answerEmployeeWeeklyScheduleQuestion} from '../src/ai/memphis-ai-employee-week.js';
import {generateWeeklyScheduleReply} from '../src/ai/memphis-ai-weekly.js';
import {summarizeEmployeeWorkStatus} from '../src/ai/memphis-ai-work-status.js';
import {getGeminiEnvOrder} from '../src/utils/gemini-config.js';

const employee='22222222-2222-4222-8222-222222222222';
const publication='33333333-3333-4333-8333-333333333333';
const projection='44444444-4444-4444-8444-444444444444';
const today='2026-10-02';
const saved=new Map(getGeminiEnvOrder().map(name=>[name,process.env[name]]));
let checks=0;
function check(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;}
async function scenario({status='current',working=true,segmentProjection=projection,deviceActive=true,
  userRole='employee',attendanceFetchedAt=null}={}){
  const reads=[],writes=[];
  const runReadOnlySql=async sql=>{
    reads.push(sql);
    if(sql.includes('sch_service_date'))return[{service_date:today}];
    if(sql.includes("now() at time zone 'America/Chicago'"))return[{service_date:today}];
    if(sql.includes('msg_get_memphis_thread_context'))return[{data:{}}];
    if(sql.includes('msg_get_user_by_device'))return[{role:userRole,display_name:'Tammy'}];
    if(sql.includes('from public.devices d'))return[{device_id:'KIOSK_SYNTH',device_active:deviceActive,
      assigned_employee_id:employee,assigned_employee_name:'Tammy',employee_active:true}];
    if(sql.includes('sch_resolve_employee_ref'))return[{data:{ok:true,employee_id:employee,employee_name:'Tammy',role:'staff'}}];
    if(sql.includes('custodial_memphis_schedule_day'))return[{data:{schema:'memphis.schedule-day.v1',status,
      projection_status:status==='current'?'current':'missing_projection',publication_id:publication,projection_id:projection,
      rows:status==='current'?[{employee_id:employee,employee_name:'Tammy',working,shift_start:working?'07:00':null,
        shift_end:working?'16:00':null}]:[]}}];
    if(sql.includes('static_weekly_v6_schedule_authority_state'))return[{authority:{governed:true,
      projection_status:'current',publication_id:publication,projection_id:segmentProjection},
      segments:[{assigned_employee_id:employee,assigned_employee_name:'Tammy',group_name:'Aquarium',
        location_group_id:'66666666-6666-4666-8666-666666666666',group_code:'AQU',owner_type:'EMPLOYEE',
        coverage_start:'08:00',coverage_end:'09:00',status:'ASSIGNED',load_points:60},
        {assigned_employee_id:null,group_name:'Teton',location_group_id:'77777777-7777-4777-8777-777777777777',
          group_code:'TET',coverage_start:'10:00',coverage_end:'11:00',status:'OPEN'}],
      assignments:[{assigned_employee_id:employee,assigned_employee_name:'Tammy',group_name:'Aquarium',
        location_group_id:'66666666-6666-4666-8666-666666666666',group_code:'AQU',
        coverage_start:'08:00',coverage_end:'09:00',status:'ASSIGNED'}]}];
    if(sql.includes('from public.employees'))return[{id:employee,display_name:'Tammy',role:'staff'}];
    if(sql.includes('from public.v_open_maintenance_tickets'))return[{ticket_id:'ticket-1',
      location_name:'Aquarium',out_of_order:true}];
    if(sql.includes('from public.current_attendance_state'))return[{attendance:999,
      fetched_at:attendanceFetchedAt||new Date(Date.now()-3*60*60_000).toISOString()}];
    return[];
  };
  const runRpc=async(name,args)=>{writes.push({name,args});return name==='tool_list_active_employees'?[{display_name:'Tammy'}]:null;};
  const responder=createMemphisResponder({runReadOnlySql,runRpc});
  return{responder,reads,writes,runReadOnlySql};
}
try{
  for(const name of saved.keys())process.env[name]='';
  const current=await scenario();
  const work=await current.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t1',userMessage:'Is Tammy working today?'});
  assert.match(work.text,/Tammy is working/);checks++;
  assert.match(work.text,/Aquarium/);checks++;
  check(current.reads.some(sql=>sql.includes('custodial_memphis_schedule_day')),true,'canonical read used');
  check(current.reads.some(sql=>sql.includes('sch_get_employee_work_status')),false,'legacy work status not read');
  check(current.reads.some(sql=>sql.includes('daily_work_roster')||sql.includes('employee_shift_templates')),false,'legacy roster/template not read');
  const my=await current.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t2',userMessage:'my schedule'});
  assert.match(my.text,/Aquarium/);checks++;
  check(current.reads.some(sql=>sql.includes('v_memphis_employee_schedule')),false,'employee detail uses revision-bound segments');
  const unavailable=await scenario({status:'unavailable'});
  const noWork=await unavailable.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t3',userMessage:'Is Tammy working today?'});
  assert.match(noWork.text,/can't verify a current published schedule/);checks++;
  const noMy=await unavailable.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t4',userMessage:'my schedule'});
  assert.match(noMy.text,/can't verify your current published schedule/);checks++;
  const off=await scenario({working:false});
  const offReply=await off.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t5',userMessage:'Is Tammy working today?'});
  assert.match(offReply.text,/Tammy is off/);checks++;
  assert.doesNotMatch(offReply.text,/sick|PTO|vacation|Private/);checks++;
  const mismatch=await scenario({segmentProjection:'55555555-5555-4555-8555-555555555555'});
  const stale=await mismatch.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t6',userMessage:'Is Tammy working today?'});
  assert.match(stale.text,/can't verify a current published schedule/);checks++;
  const inactiveDevice=await scenario({deviceActive:false});
  const deniedMy=await inactiveDevice.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t7',userMessage:'my schedule'});
  assert.doesNotMatch(deniedMy.text,/Aquarium|07:00|16:00/);checks++;
  const daily=await generateDailyStaffScheduleReply({runReadOnlySql:current.runReadOnlySql,serviceDate:today,
    queryText:'Which custodians work today?'});
  assert.match(daily.text,/Tammy 07:00-16:00/);checks++;
  const missingDaily=await generateDailyStaffScheduleReply({runReadOnlySql:unavailable.runReadOnlySql,serviceDate:today});
  assert.match(missingDaily.text,/can't verify a current published custodial schedule/);checks++;
  for(const workStatus of ['off_pto','off_sick','off_callout','off_absence_override']){
    const summary=summarizeEmployeeWorkStatus({ok:true,employee_name:'Tammy',service_date:today,
      work_status:workStatus,reason:'Private synthetic absence reason'});
    assert.match(summary,/Tammy is off/);assert.doesNotMatch(summary,/PTO|sick|callout|Private/);checks++;
  }
  const unknown=summarizeEmployeeWorkStatus({ok:true,employee_name:'Tammy',service_date:today,
    work_status:'Private synthetic absence reason'});
  assert.doesNotMatch(unknown,/Private synthetic/);checks++;
  const week=await answerEmployeeWeeklyScheduleQuestion(current.runReadOnlySql,'What days does Tammy work next week?');
  assert.match(week,/published schedule/);checks++;
  check(current.reads.filter(sql=>sql.includes('custodial_memphis_schedule_day')).length>=7,true,'weekly read resolves seven current dated days');
  const weekAreas=await generateWeeklyScheduleReply({runReadOnlySql:current.runReadOnlySql,
    todayServiceDate:today,relativeServiceDate:today,text:'What is the whole week schedule?'});
  assert.match(weekAreas.text,/Current published/);checks++;
  assert.doesNotMatch(weekAreas.text,/unless absence|PTO|Private/);checks++;
  const weekArea=await generateWeeklyScheduleReply({runReadOnlySql:current.runReadOnlySql,
    todayServiceDate:today,relativeServiceDate:today,text:'Aquarium weekly schedule',
    areaTarget:{location_group_id:'66666666-6666-4666-8666-666666666666',group_name:'Aquarium'}});
  assert.match(weekArea.text,/Current published Aquarium assignments/);checks++;
  assert.doesNotMatch(weekArea.text,/unless absence|PTO|Private/);checks++;
  const staleWeek=await generateWeeklyScheduleReply({runReadOnlySql:unavailable.runReadOnlySql,
    todayServiceDate:today,relativeServiceDate:today,text:'What is the whole week schedule?'});
  assert.match(staleWeek.text,/can't verify the full current published/);checks++;
  check(current.reads.some(sql=>sql.includes('v_memphis_area_schedule')),false,'weekly route does not use legacy area view');
  const open=await current.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t8',userMessage:'What open segments today?'});
  assert.match(open.text,/Teton/);checks++;
  const load=await current.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t9',userMessage:'Who has the heaviest workload today?'});
  assert.match(load.text,/Tammy: 1 segments, 60 load points, 60 minutes/);checks++;
  const candidates=await current.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t10',userMessage:'Who can cover Teton?'});
  assert.match(candidates.text,/can't rank qualified replacement candidates/);checks++;
  const absence=await current.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t11',userMessage:'Who is absent today?',role:'manager'});
  assert.doesNotMatch(absence.text,/sick|PTO|vacation/i);checks++;
  check(current.reads.some(sql=>/v_memphis_open_segments|v_memphis_employee_load_summary|sch_get_coverage_candidates|daily_absence_overrides|employee_planned_time_off|employee_pto/.test(sql)),false,'old open/load/candidate/leave source never read');
  const manager=await scenario({userRole:'manager'});
  const managerAbsence=await manager.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'manager1',userMessage:'Who is out today?'});
  assert.match(managerAbsence.text,/work availability|published roster|scheduled to work/i);checks++;
  assert.doesNotMatch(managerAbsence.text,/PTO|sick|vacation|private reason/i);checks++;
  const ticketReply=await current.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t13',userMessage:'Any open tickets?'});
  assert.match(ticketReply.text,/Aquarium: open maintenance issue/);checks++;
  assert.doesNotMatch(ticketReply.text,/Private issue narrative|reported by/);checks++;
  check(current.reads.some(sql=>sql.includes('from public.v_open_maintenance_tickets')
    && /where location_code ilike/.test(sql)),false,'generic ticket question must not filter by its entire text');
  const staleAttendance=await manager.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'manager2',userMessage:'What is guest attendance today?'});
  assert.match(staleAttendance.text,/don't have a current attendance count/);checks++;
  assert.doesNotMatch(staleAttendance.text,/999/);checks++;
  const freshManager=await scenario({userRole:'manager',attendanceFetchedAt:new Date().toISOString()});
  const freshAttendance=await freshManager.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'manager3',userMessage:'What is guest attendance today?'});
  assert.match(freshAttendance.text,/999/);checks++;
  const staleOpen=await mismatch.responder.generateReply({deviceId:'KIOSK_SYNTH',threadId:'t12',userMessage:'What open segments today?'});
  assert.match(staleOpen.text,/can't verify current published open segments/);checks++;
  check(current.writes.some(({name})=>/generate.*schedule/.test(name)),false,'answers never generate schedule');
  console.log('MEMPHIS_CURRENT_AUTHORITY_ROUTE_PASS',JSON.stringify({checks,network:false,synthetic:true}));
}finally{for(const[name,value]of saved){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
