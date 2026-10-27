import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {consolidateScheduleItems} from '../src/schedule-display.js';

const rows=[
 {group_code:'A',name:'Aquarium',coverage_start:'06:00',coverage_end:'09:45'},
 {group_code:'Z',name:'Zebra Restrooms',coverage_start:'07:00',coverage_end:'09:45'},
 {group_code:'B',name:'Bonobos Restrooms',coverage_start:'06:00',coverage_end:'09:45'},
 {group_code:'C',name:'China service area',is_public_restroom:true,coverage_start:'06:00',coverage_end:'09:45'},
 {group_code:'N',name:'Nocturnal',coverage_start:'06:00',coverage_end:'09:45'},
].map(r=>({...r,coverage_purpose:'deep_clean',service_mode:'scan_tracked'}));
const original=JSON.stringify(rows);
const view=consolidateScheduleItems(rows);
assert.deepEqual(view.items.map(r=>r.name),['Bonobos Restrooms','China service area','Zebra Restrooms','Aquarium','Nocturnal'],'restroom-first alphabetic within the morning section, not input/time order');
assert.equal(JSON.stringify(rows),original,'display sorting does not rewrite authority rows');
assert.equal(view.items.find(r=>r.name==='Zebra Restrooms').coverage_start,'07:00 AM','original later start remains visible');
assert.doesNotMatch(view.sections[0].title,/full clean/i,'morning presentation does not mandate full cleaning');
const mixed=consolidateScheduleItems([...rows,{name:'A Restroom',group_code:'L',coverage_purpose:'lunch_coverage',coverage_start:'12:00',coverage_end:'13:00',occurrence_id:'loan-one'}]);
assert.deepEqual(mixed.sections.map(r=>r.key),['morning','lunch'],'category order never crosses semantic/lunch sections');
assert.equal(mixed.sections[1].items[0].coverage_end,'01:00 PM');
const pdf=readFileSync(new URL('./render-october-candidate-pdfs.mjs',import.meta.url),'utf8');
assert.match(pdf,/compareScheduleDisplayItems/,'PDF must use same owning category/name comparator');
assert.doesNotMatch(pdf,/'Initial clean'/,'PDF must not require full cleaning based on morning time');
const scheduleApi=readFileSync(new URL('../src/schedule-api.js',import.meta.url),'utf8');
assert.doesNotMatch(scheduleApi,/Morning Full Clean Schedule/,'fallback schedule page cannot mandate full cleaning either');
console.log('SCHEDULE_DISPLAY_ORDER_PASS 9 (actual display owner + renderer/fallback wiring; no PDF or phone execution)');
