import assert from 'node:assert/strict';
import {consolidateScheduleItems} from '../src/schedule-display.js';
import {consolidateScheduleItems as before} from './fixtures/dated-display-before-cycle1.js';
let checks=0;
const row={occurrence_id:'frozen-fixture-occurrence',service_date:'2026-10-01',coverage_start:'07:00',coverage_end:'09:45',coverage_purpose:'area_owner',service_mode:'response_only_no_clean',included_locations:['Cat Country'],group_name:'Cat Country'};
assert.equal(before([row]).items[0].coverage_purpose,'deep_clean');checks++;
for(const start of ['07:00','09:45','14:00'])for(const purpose of ['area_owner','response_only_no_clean','lunch_coverage']){
 const original={...row,coverage_start:start,coverage_end:start==='14:00'?'16:00':'10:45',coverage_purpose:purpose};
 const result=consolidateScheduleItems([original]);const display=result.items[0];
 assert.equal(display.service_mode,original.service_mode);assert.equal(display.creates_deep_clean,false);assert.notEqual(display.coverage_purpose,'deep_clean');assert.match(display.instruction,/Respond to issues only/);assert.equal(display.section_key,purpose==='lunch_coverage'?'lunch':'response');assert.equal(result.sections[0].items[0],display);checks++;
}
const mixed=consolidateScheduleItems([row,{...row,service_mode:'scan_tracked'}]);assert.equal(mixed.items.length,2);checks++;
const onCall=consolidateScheduleItems([{...row,on_call_only:true,coverage_purpose:'lunch_coverage'}]).items[0];assert.equal(onCall.on_call_only,true);assert.equal(onCall.coverage_purpose,'lunch_coverage');checks++;
console.log(JSON.stringify({status:'PASS',checks,scope:'retained fail-before display fixture; mode precedence, instruction and loan boundaries after correction'}));
