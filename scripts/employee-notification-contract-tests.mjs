import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
// NEW focused original-open member runs actual extracted owning handlers with
// synthetic authenticated middleware state/SQL results. No auth/provider/DB or
// listening socket is created; ordinary test imports and old cases stay below.
if (['--event-open-original-only', '--event-open-original-temporal-only', '--event-open-service-date-only', '--event-open-service-date-migration-only'].includes(process.argv[2])) {
  const source = await readFile(new URL('../src/employee-notifications.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20261012052430_employee_event_open_original_receipt.sql', import.meta.url), 'utf8');
  const id = n => `${n}0000000-0000-4000-8000-000000000001`;
  const key = `event:${id(1)}:8:2026-10-20:${id(2)}:${id(3)}:4:two_days_before`;
  const original = () => ({instance_id:id(4),notification_key:key,event_id:id(1),notification_kind:'two_days_before',
    credential_id:id(5),employee_id:id(2),device_id:id(3),assignment_epoch:4,event_revision:8,
    service_date:'2026-10-20',scheduled_for:'2026-10-18T13:15:00+00:00',state:'opened',
    sent_at:'2026-10-18T13:15:01.000001+00:00',opened_at:'2026-10-18T13:16:00.123456+00:00',cancelled_at:null,
    provider_message_id:'SYNTHETIC_PROVIDER_PRIVATE',last_error:'SYNTHETIC_PRIVATE_NOT_FOR_EXPORT'});
  function request() {
    const device={canonical_device_pk:id(3),canonical_device_id:'KIOSK_08',assignment_epoch:'4',
      assigned_employee_id:id(2),device_active:true,employee_active:true};
    const credential={credential_id:id(5),device_id:id(3),confirmed_at:'2026-10-01T00:00:00Z',revoked_at:null,
      expires_at:'2030-01-01T00:00:00Z'};
    return {memphisDevice:device,memphisDeviceCredential:credential,
      memphisDeviceAuth:{ok:true,credentialed:true,device,credential},body:{notification_key:key},query:{}};
  }
  function setup(options={}) {
    const routes=new Map(), calls=[], filters=[];
    const db={rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='mz_mark_employee_event_opened')return {data:options.openData === undefined ? original() : options.openData,error:options.openError||null};
      if(name==='app_event_manager_digest_candidate')return {data:options.eventData===undefined
        ? [{event_revision:8,event_date:'2026-10-20',occurrence_starts_at:'2030-10-20T15:00:00Z'}]:options.eventData,error:options.eventError||null};
      assert.equal(name,'mz_event_reminder_schedule');return {data:options.scheduleData===undefined
        ? [{reminder_date:'2026-10-18',scheduled_for:'2026-10-18T13:15:00Z'}]:options.scheduleData,error:options.scheduleError||null};
    },from(table){assert.equal(table,'event_push_instances');const selection={select(fields){this.fields=fields;return this;},
      eq(field,value){filters.push({field,value});return this;},order(){return this;},limit(count){this.count=count;
        return Promise.resolve({data:options.listData===undefined?[original()]:options.listData,error:null});}};return selection;}};
    const helperStart=source.indexOf('// Original event receipts are server facts');
    const helperEnd=source.indexOf('function terminalDeliveryError',helperStart);
    const failStart=source.indexOf('function fail(res, error)');
    const failEnd=source.indexOf('export function installEmployeeNotificationRoutes',failStart);
    const routesStart=source.indexOf('  app.get(`${API_PREFIX}/events`');
    const routesEnd=source.indexOf('  app.post(`${API_PREFIX}/test`',routesStart);
    assert(helperStart>=0&&helperEnd>helperStart&&routesStart>=0&&routesEnd>routesStart);
    const context=createContext({Buffer,Date,db,requireEmployee(){},app:{
      get(path,...handlers){routes.set(path,handlers.at(-1));},post(path,...handlers){routes.set(path,handlers.at(-1));}}},
      {codeGeneration:{strings:false,wasm:false}});
    runInContext(`const API_PREFIX='/employee-notifications-api';
      function clip(value,max){return String(value??'').trim().slice(0,max);}
      ${source.slice(helperStart,helperEnd)}
      ${source.slice(failStart,failEnd)}
      ${source.slice(routesStart,routesEnd)}`,context,{timeout:1000});
    async function run(kind,req=request()) {
      const res={statusCode:null,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
      await routes.get(`/employee-notifications-api/${kind}`)(req,res);return res;
    }
    return {run,calls,filters};
  }
  const results=[];async function check(name,fn){await fn();results.push(name);}
  if (process.argv[2] === '--event-open-service-date-migration-only') {
    const forward=await readFile(new URL('../supabase/migrations/20261012070515_employee_event_open_service_date_binding.sql',import.meta.url),'utf8');
    const before=migration.split('$new_body$')[1];
    const fragment=tag=>forward.split('$'+tag+'$')[1];
    const event=fragment('event_guard'),correctedEvent=fragment('corrected_event_guard');
    const reminder=fragment('reminder_guard'),correctedReminder=fragment('corrected_reminder_guard');
    await check('new forward substitutions match exact source264 predecessor once',()=>{
      assert.equal(createHash('sha256').update(before).digest('hex'),'bf09cee0f6a9547c913a438149340993e70bbae1a83b68d4bd0042a76ac1fbe6');
      assert.equal(Buffer.byteLength(before),4876);
      for(const value of [event,reminder]){assert(value);assert.equal(before.split(value).length,2);}
    });
    let after;
    await check('only calendar predicate substitutions, preserving every other source-body byte',()=>{
      assert.equal(correctedEvent,event+'  or e.event_date is distinct from original.service_date\n');
      assert.equal(correctedReminder,reminder.replace('s.reminder_date=original.service_date and ',''));
      after=before.replace(event,correctedEvent).replace(reminder,correctedReminder);
      assert.equal(after.replace(correctedEvent,event).replace(correctedReminder,reminder),before);
      assert(forward.includes('replace(replace(body,event_guard,corrected_event_guard),reminder_guard,corrected_reminder_guard)'));
    });
    await check('forward source preserves canary and exact unrelated inventory, no owner/grant statement',()=>{
      assert.doesNotMatch(forward,/(?:^|\n)\s*(?:GRANT\b|REVOKE\b|ALTER\s+FUNCTION\b)/i);
      assert.match(forward,/JOIN event_service_date_canary_before old ON old.oid=p.oid/);
      assert.match(forward,/ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable/);
      assert.match(forward,/EXCEPT SELECT \* FROM event_service_date_inventory_before/);
      assert.match(forward,/WHERE i.object_kind='function'[\s\S]*to_regprocedure\(i.object_identity\)=target/);
    });
    console.log(JSON.stringify({status:'PASS_NEW_EVENT_SERVICE_DATE_FORWARD_SOURCE_MEMBER',cases:results.length,results,
      changed_body_sha256:createHash('sha256').update(after).digest('hex'),changed_body_bytes:Buffer.byteLength(after),
      scope:'Actual forward source text substitutions only; not PostgreSQL execution/syntax/ACL proof',
      SQL:false,realAuth:false,provider:false,network:false,old_groups_replayed:false}));process.exit(0);
  }
  if (process.argv[2] === '--event-open-service-date-only') {
    const dated = ({kind='two_days_before',eventDate='2026-10-20',reminderDate='2026-10-18',start='2026-10-20T15:00:00Z'}={}) => {
      const scheduled=reminderDate+'T12:15:00Z';
      const row={...original(),notification_kind:kind,service_date:eventDate,scheduled_for:scheduled,
        sent_at:reminderDate+'T12:16:00.000001Z',opened_at:reminderDate+'T12:17:00.123456Z'};
      row.notification_key=`event:${row.event_id}:8:${eventDate}:${row.employee_id}:${row.device_id}:4:${kind}`;
      return {row,event:{event_revision:8,event_date:eventDate,occurrence_starts_at:start},
        schedule:{reminder_date:reminderDate,scheduled_for:scheduled}};
    };
    const runDated = async (f,{row=f.row,event=f.event,schedule=f.schedule}={}) => {
      const s=setup({listData:[row],eventData:[event],scheduleData:[schedule]}),req=request();
      req.query={notification_key:row.notification_key};
      return {s,r:await s.run('events',req)};
    };
    for (const args of [
      {kind:'two_days_before'},
      {kind:'three_days_before',reminderDate:'2026-10-17'},
      {kind:'shift_plus_15',reminderDate:'2026-10-20'},
      {kind:'two_days_before',eventDate:'2026-10-19',reminderDate:'2026-10-17',start:'2026-10-20T00:30:00Z'}
    ]) await check(args.kind+' CURRENT uses actual event_date, not reminder or UTC instant calendar '+(args.eventDate||''),async()=>{
      const f=dated(args),{s,r}=await runDated(f);assert.equal(r.statusCode,200);
      assert.equal(r.body.data[0].event_validity,'CURRENT');
      assert.equal(r.body.data[0].open_receipt.opened_at,f.row.opened_at);
      const call=s.calls.find(c=>c.name==='mz_event_reminder_schedule');
      assert.deepEqual(JSON.parse(JSON.stringify(call.args)),{p_event_id:f.row.event_id,
        p_event_revision:8,p_employee_id:f.row.employee_id,p_notification_kind:f.row.notification_kind});
      assert(!s.calls.some(c=>c.name==='mz_mark_employee_event_opened'));
    });
    for(const [name,edit] of [
      ['original service date wrongly equals reminder date',f=>({row:{...f.row,service_date:f.schedule.reminder_date}})],
      ['current event date differs from retained original',f=>({event:{...f.event,event_date:'2026-10-21'}})]
    ]) await check(name+' stays WITHHELD',async()=>{
      const f=dated(),{s,r}=await runDated(f,edit(f));assert.equal(r.statusCode,200);
      assert.equal(r.body.data[0].event_validity,'WITHHELD');assert(!Object.hasOwn(r.body.data[0],'open_receipt'));
      assert(!s.calls.some(c=>c.name==='mz_event_reminder_schedule'));
    });
    for(const [name,edit] of [
      ['missing actual event_date',f=>{const {event_date,...event}=f.event;return {event};}],
      ['null actual event_date',f=>({event:{...f.event,event_date:null}})],
      ['malformed actual civil date',f=>({event:{...f.event,event_date:'2026-02-30'}})],
      ['missing schedule date provenance',f=>({schedule:{scheduled_for:f.schedule.scheduled_for}})],
      ['malformed schedule date provenance',f=>({schedule:{...f.schedule,reminder_date:'2026-02-30'}})],
      ['different original scheduled instant',f=>({schedule:{...f.schedule,scheduled_for:'2026-10-18T12:15:01Z'}})],
      ['missing current revision provenance',f=>{const {event_revision,...event}=f.event;return {event};}]
    ]) await check(name+' remains UNKNOWN with no original receipt',async()=>{
      const f=dated(),{r}=await runDated(f,edit(f));assert.equal(r.statusCode,200);
      assert.equal(r.body.data[0].event_validity,'UNKNOWN');assert(!Object.hasOwn(r.body.data[0],'open_receipt'));
    });
    console.log(JSON.stringify({status:'PASS_NEW_EVENT_SERVICE_DATE_MEMBER',cases:results.length,results,
      scope:'Actual extracted owning GET; synthetic original source/RPC responses only',SQL:false,realAuth:false,
      provider:false,network:false,physical:false,old_groups_replayed:false}));process.exit(0);
  }
  if(process.argv[2] === '--event-open-original-temporal-only') {
    await check('authentic sent original remains CURRENT without manufacturing an opened receipt',async()=>{
      const row={...original(),state:'sent',opened_at:null},s=setup({listData:[row]}),r=await s.run('events');
      assert.equal(r.statusCode,200);assert.equal(r.body.data[0].event_validity,'CURRENT');
      assert(!Object.hasOwn(r.body.data[0],'open_receipt'));
    });
    for(const[name,row]of [
      ['sent without original sent_at',{...original(),state:'sent',sent_at:null,opened_at:null}],
      ['sent with contradictory original opened_at',{...original(),state:'sent'}],
      ['opened without original opened_at',{...original(),opened_at:null}]
    ])await check(name+' refuses before schedule guard can label CURRENT',async()=>{
      const s=setup({listData:[row]}),r=await s.run('events');assert.notEqual(r.statusCode,200);assert.equal(s.calls.length,0);
    });
    console.log(JSON.stringify({status:'PASS_NEW_EVENT_ORIGINAL_TEMPORAL_MEMBER',cases:results.length,results,
      scope:'SYNTHETIC original-row temporal consistency through actual extracted owning list handler only',
      SQL:false,realAuth:false,provider:false,network:false,native:false,physical:false}));process.exit(0);
  }
  await check('exact returned original opened tuple, finite original microseconds and no private payload',async()=>{
    const s=setup(),res=await s.run('opened');assert.equal(res.statusCode,200);
    assert.deepEqual(JSON.parse(JSON.stringify(res.body.data)),{schema:'custodial.employee-event-open-receipt.v1',
      instance_id:id(4),notification_key:key,event_id:id(1),notification_kind:'two_days_before',
      credential_id:id(5),employee_id:id(2),device_id:id(3),device_identifier:'KIOSK_08',assignment_epoch:4,
      state:'opened',opened_at:original().opened_at});
    assert.equal(s.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0].args)),{p_credential_id:id(5),p_notification_key:key});
    assert(!JSON.stringify(res.body).includes('SYNTHETIC_PRIVATE'));assert(!JSON.stringify(res.body).includes('PROVIDER'));
    assert(!Object.hasOwn(res.body.data,'opened'));
  });
  const malformed=[['null returned receipt',null],['bare opened boolean',{opened:true}],['ambiguous returned rows',[original(),original()]],
    ['zero returned rows',[]],['pending returned state',{...original(),state:'pending'}],
    ['wrong original employee',{...original(),employee_id:id(6)}],['wrong original device',{...original(),device_id:id(6)}],
    ['wrong original credential',{...original(),credential_id:id(6)}],['same credential wrong epoch',{...original(),assignment_epoch:5}],
    ['string returned epoch',{...original(),assignment_epoch:'4'}],['wrong original key',{...original(),notification_key:key+'x'}],
    ['missing original instance',{...original(),instance_id:null}],['invalid original opened timestamp',{...original(),opened_at:'infinity'}],
    ['nonexistent original civil date',{...original(),opened_at:'2026-02-30T12:00:00Z'}],
    ['open predates send',{...original(),opened_at:'2026-10-18T13:14:00Z'}],
    ['withdrawn returned row',{...original(),cancelled_at:'2026-10-18T13:15:30Z'}],
    ['historical unadmitted day_before',{...original(),notification_kind:'day_before'}],
    ['unsafe returned revision',{...original(),event_revision:2147483648}]];
  for(const[name,value]of malformed)await check(name+' refuses, never opened true',async()=>{
    const s=setup({openData:value}),r=await s.run('opened');assert.notEqual(r.statusCode,200);assert.equal(r.body.ok,false);
  });
  for(const[name,edit]of [
    ['oversize UTF8 key',r=>{r.body.notification_key='é'.repeat(121);}],['embedded control key',r=>{r.body.notification_key=key+'\nX';}],
    ['untrimmed key',r=>{r.body.notification_key=' '+key;}],['typed-null key',r=>{r.body.notification_key=null;}],
    ['foreign body actor',r=>{r.body.employee_id=id(6);}],['observe-mode uncredentialed auth',r=>{r.memphisDeviceAuth.credentialed=false;}],
    ['recovery-only auth',r=>{r.memphisDeviceAuth.offline_recovery_only=true;}],['boolean auth epoch',r=>{r.memphisDevice.assignment_epoch=true;}]
  ])await check(name+' refuses BEFORE RPC, no truncation or adoption',async()=>{
    const s=setup(),req=request();edit(req);const r=await s.run('opened',req);assert.notEqual(r.statusCode,200);assert.equal(s.calls.length,0);
  });
  await check('RPC refusal preserves pending, not accepted provider shorthand',async()=>{
    const s=setup({openError:{message:'Original recipient refused'}}),r=await s.run('opened');assert.equal(r.body.ok,false);
  });
  await check('fixed-original GET current tuple plus typed receipt, no repeat POST/mutation',async()=>{
    const s=setup(),req=request();req.query={notification_key:key};const r=await s.run('events',req);
    assert.equal(r.statusCode,200);assert.equal(r.body.data.length,1);assert.equal(r.body.data[0].event_validity,'CURRENT');
    assert.equal(r.body.data[0].open_receipt.opened_at,original().opened_at);
    assert.equal(r.body.data[0].device_identifier,'KIOSK_08');
    for(const[field,value]of Object.entries({credential_id:id(5),employee_id:id(2),device_id:id(3),assignment_epoch:4,notification_key:key}))
      assert(s.filters.some(f=>f.field===field&&f.value===value));
    assert(s.calls.every(c=>c.name!=='mz_mark_employee_event_opened'));
  });
  for(const[name,options,expected]of [
    ['held/withdrawn Event',{eventData:[]},'WITHHELD'],['revised Event',{eventData:[{event_revision:9,occurrence_starts_at:'2030-10-20T15:00:00Z'}]},'WITHHELD'],
    ['schedule no longer admits original employee',{scheduleData:[]},'WITHHELD'],['guard unavailable',{eventError:{message:'unavailable'}},'UNKNOWN'],
    ['ambiguous Event guard',{eventData:[{event_revision:8},{event_revision:8}]},'UNKNOWN'],
    ['ambiguous schedule',{scheduleData:[{},{}]},'UNKNOWN']
  ])await check(name+' has no typed opened recovery or invented denial',async()=>{
    const s=setup(options),r=await s.run('events');assert.equal(r.statusCode,200);
    assert.equal(r.body.data[0].event_validity,expected);assert(!Object.hasOwn(r.body.data[0],'open_receipt'));
  });
  await check('fixed GET absent is unknown empty original list, not replay authorization',async()=>{
    const s=setup({listData:[]}),req=request();req.query={notification_key:key};const r=await s.run('events',req);
    assert.equal(r.statusCode,200);assert.equal(r.body.data.length,0);assert.equal(s.calls.length,0);
  });
  for(const[name,rows]of [['wrong returned recipient',[{...original(),employee_id:id(6)}]],
    ['duplicate original list',[original(),original()]],['oversize original list',Array.from({length:101},original)]])
    await check(name+' refuses entire list',async()=>{const r=await setup({listData:rows}).run('events');assert.notEqual(r.statusCode,200);});
  await check('source264 exact source-body/ACL/recovery/ALWAYS guards and immutable original update scope',()=>{
    const old=migration.split('$old_body$')[1],body=migration.split('$new_body$')[1];
    assert.equal(createHash('sha256').update(old).digest('hex'),'f36ca009247ef497576b1c0d9aa4e21cf5b23bdb55378e9b17d44f43119336ec');
    assert.equal(Buffer.byteLength(old),507);
    const locks=['pg_advisory_xact_lock','for share of d0','where credential_id=p_credential_id for share',
      'where id=d.assigned_employee_id for share','where id=original.event_id for share','credential_id=p_credential_id for update'];
    let offset=-1;for(const lock of locks){const at=body.indexOf(lock);assert(at>offset,lock);offset=at;}
    for(const guard of ['original.employee_id is distinct from employee.id','original.assignment_epoch is distinct from d.assignment_epoch',
      'c.revoked_at is not null','employee.active is not true','e.needs_review','e.cancelled_at is not null',
      'public.mz_event_reminder_schedule','public.app_event_place_authority',"if original.state='opened' then return original"])
      assert(body.includes(guard),guard);
    assert(!/\bgrant\s+execute|\balter\s+.*owner\s+to/i.test(migration));
    const update=body.slice(body.indexOf('update public.event_push_instances'));
    assert.match(update,/set state='opened',opened_at=at_time,updated_at=at_time/);
    assert.doesNotMatch(update.slice(0,update.indexOf('  where')),/employee_id\s*=|device_id\s*=|assignment_epoch\s*=/);
    assert.match(migration,/ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable/);
    assert.match(migration,/Event open unrelated inventory\/ACL or final ALWAYS guard changed/);
  });
  console.log(JSON.stringify({status:'PASS_NEW_EVENT_OPEN_ORIGINAL_MEMBER',cases:results.length,results,
    scope:'SYNTHETIC authenticated state/SQL responses, actual extracted owning HTTP handlers + source264 guards only',
    SQL:false,realAuth:false,provider:false,network:false,native:false,physical:false}));process.exit(0);
}
const {default:express}=await import('express');
const {buildEmployeeEventReminderBody,employeeNotificationInternals,installEmployeeNotificationRoutes}
  = await import('../src/employee-notifications.js');

const root = new URL('../', import.meta.url);
const reminderBody = buildEmployeeEventReminderBody({
  event_name: 'Members Night', display_location: 'Event Center', event_date: '2026-10-20',
  start_time: '18:00:00', end_time: '20:30:00', attendee_count: 240,
  notes: 'VIP itinerary and catering; request extra trash cans',
}, 'Tammy');
assert.match(reminderBody, /Tammy.*Members Night.*Event Center.*2026-10-20.*18:00:00.*20:30:00.*240/);
assert.doesNotMatch(reminderBody, /VIP|itinerary|catering|trash cans/i,
  'unclassified event notes cannot leak into employee reminder speech');
const classifiedBody = buildEmployeeEventReminderBody({
  event_name: 'Members Night', display_location: 'Event Center', event_date: '2026-10-20',
  start_time: '18:00:00', end_time: '20:30:00', attendee_count: 240,
  notes: 'Private VIP itinerary and catering; manager ticket details',
  source_text: 'Do not broadcast the source email',
  custodial_note_codes: ['trash_boxes', 'trash_boxes', 'unknown'],
  custodial_public_notes: 'Waxed floor; use the service entrance.',
}, 'Tammy');
assert.match(classifiedBody, /Place trash boxes/);
assert.match(classifiedBody, /Waxed floor; use the service entrance/);
assert.equal((classifiedBody.match(/Place trash boxes/g) || []).length, 1);
assert.doesNotMatch(classifiedBody, /VIP|itinerary|catering|ticket|source email|unknown/i);
assert.doesNotMatch(buildEmployeeEventReminderBody({ event_name: 'No count', display_location: 'Zoo Footprint',
  event_date: '2026-10-20', start_time: '09:00:00', end_time: '10:00:00' }, 'Gregory'), /attendance/i);
assert.throws(() => buildEmployeeEventReminderBody({ event_name: 'Incomplete' }, 'Tammy'), /missing/);
const [source, manager, indexSource, migration, nativeKindsMigration, boundaryMigration, closureMigration] = await Promise.all([
  readFile(new URL('src/employee-notifications.js', root), 'utf8'),
  readFile(new URL('src/manager-notifications.js', root), 'utf8'),
  readFile(new URL('src/index.js', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260724010000_native_employee_event_delivery.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260731211500_native_employee_message_location_push.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260813141806_custodial_operational_boundary_closure.sql', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260813210000_custodial_u4_ops_closure.sql', root), 'utf8'),
]);

assert.match(source, /const API_PREFIX = ['"]\/employee-notifications-api['"]/);
for (const route of ['register', 'events', 'opened', 'test']) {
  assert.ok(source.includes(`\${API_PREFIX}/${route}`), `missing ${route} route registration`);
}

assert.match(source, /messenger_fallback: false/);
assert.match(source, /employee-native-push\.v2/);
for (const kind of ['event_three_days_before', 'event_two_days_before', 'event_shift_plus_15', 'message', 'due_soon', 'overdue']) {
  assert.ok(source.includes(`'${kind}'`), `missing native employee notification kind ${kind}`);
}
assert.match(source, /makeDeviceCredentialMiddleware\(\{ supabase: db, runReadOnlySql \}\)/);
const canonicalCredentialId = '55555555-5555-4555-8555-555555555555';
assert.equal(
  employeeNotificationInternals.credentialId({
    memphisDeviceCredential: { credential_id: canonicalCredentialId },
    memphisDevice: { credential_id: 'wrong-device-shape' },
  }),
  canonicalCredentialId,
  'employee push registration must consume the credential object populated by device-auth middleware',
);
assert.equal(
  employeeNotificationInternals.credentialId({
    memphisDeviceAuth: { credential: { credential_id: canonicalCredentialId } },
  }),
  canonicalCredentialId,
  'employee push registration must retain the canonical auth-result fallback',
);
const testNotifications = Object.fromEntries(
  ['event', 'message', 'due_soon', 'overdue'].map((kind) => [
    kind,
    employeeNotificationInternals.buildManagerTestNotification(kind, {
      runId: '66666666-6666-4666-8666-666666666666',
      deviceIdentifier: 'KIOSK_08',
    }),
  ]),
);
assert.equal(testNotifications.event.channel_id, 'employee-events');
assert.equal(testNotifications.event.data_json.kind, 'employee_event');
assert.equal(testNotifications.message.channel_id, 'employee-messages');
assert.equal(testNotifications.message.data_json.kind, 'employee_message');
assert.equal(testNotifications.due_soon.channel_id, 'employee-due-soon');
assert.equal(testNotifications.due_soon.data_json.status_code, 'due_soon');
assert.equal(testNotifications.overdue.channel_id, 'employee-overdue');
assert.equal(testNotifications.overdue.data_json.status_code, 'overdue');
assert.ok(Object.values(testNotifications).every((item) => item.data_json.test_delivery === true));
assert.match(source, /\$\{API_PREFIX\}\/test`, requireManagerWrite/);
assert.match(source, /job_type: 'employee_native_push'/);
assert.match(indexSource, /installEmployeeNotificationRoutes\(app, \{[\s\S]*requireManager: requireOpsManagerWrite/);
assert.match(indexSource, /installEmployeeNotificationRoutes\(app, \{[\s\S]*registerOperationalJobHandler: registerOperationalNotificationJobHandler/);
assert.match(source, /registerOperationalJobHandler\('employee_event_push', deliverClaimedJob\)/);
assert.match(source, /registerOperationalJobHandler\('employee_native_push', deliverClaimedJob\)/);
assert.match(source, /device_auth_resolver_configured: authReadConfigured/);
assert.match(source, /employee_notification_auth_ready/);
assert.match(source, /claim_operational_notification_job_by_key/);
assert.doesNotMatch(source, /claim_operational_notification_jobs/);
assert.match(source, /channelId = 'employee-events'/);
assert.match(source, /employee_native_push/);
assert.match(source, /mz_enqueue_employee_location_pushes/);
assert.match(source, /payload\.channel_id/);
assert.match(source, /notification_key/);
assert.match(source, /error\?\.permanent[\s\S]*push_token_rejected/);
assert.match(source, /mz_record_employee_push_delivery/);
assert.match(source, /mz_claim_employee_event_push_delivery/);
assert.match(source, /mz_release_employee_event_push_delivery/);
assert.match(source, /mz_record_employee_event_push_delivery/);
assert.match(source, /push_registration_superseded_after_provider_dispatch/);
assert.match(closureMigration, /last_successful_delivery_at=case[\s\S]*token_hash=excluded\.token_hash[\s\S]*else null/);
assert.match(manager, /export function createPushRuntime/);
assert.match(manager, /channel_id: channelId/);
assert.match(manager, /getClientConfig, send, sweep/);
assert.match(indexSource, /installEmployeeNotificationRoutes\(app, \{[\s\S]*runReadOnlySql:[\s\S]*runSupabaseReadOnlySql/);

for (const contract of [
  'employee_push_registrations',
  'event_push_instances',
  'assignment_epoch',
  'day_before',
  'shift_plus_15',
  'employee_event_push',
  'mz_enqueue_employee_event_pushes',
  'mz_register_employee_push',
  'mz_mark_employee_event_opened',
]) assert.ok(migration.includes(contract), `missing migration contract ${contract}`);

assert.match(migration, /08:00:00 America\/Chicago/);
assert.match(migration, /shift_start::text\|\|' America\/Chicago'\)::timestamptz \+ interval '15 minutes'/);
assert.match(migration, /status='dead'/);
assert.doesNotMatch(migration, /operational_notification_jobs[\s\S]{0,240}status='cancelled'/);

for (const contract of [
  'mz_enqueue_employee_message_push',
  'trg_mz_enqueue_employee_message_push',
  'mz_enqueue_employee_location_pushes',
  'employee_native_push',
  'employee-messages',
  'employee-due-soon',
  'employee-overdue',
  'device_notification_acknowledgements',
  'assignment_epoch',
]) assert.ok(nativeKindsMigration.includes(contract), `missing native employee push contract ${contract}`);
assert.match(nativeKindsMigration, /status\.status_code in \('due_soon','overdue'\)/);
assert.match(nativeKindsMigration, /job_type in \('employee_event_push','employee_native_push'\)/);
assert.doesNotMatch(nativeKindsMigration, /messenger_fallback|presentation_demo/);
assert.match(boundaryMigration, /mz_enqueue_employee_location_pushes\(timestamp with time zone\)/);
assert.match(boundaryMigration, /v_service_date date:=public\.sch_service_date\(p_now\)/);

const registeredWorkerTypes = [];
installEmployeeNotificationRoutes(express(), {
  supabase: {},
  pushRuntime: { configured: true },
  registerOperationalJobHandler: (jobType, handler) => {
    assert.equal(typeof handler, 'function');
    registeredWorkerTypes.push(jobType);
  },
});
assert.deepEqual(registeredWorkerTypes.sort(), ['employee_event_push', 'employee_native_push']);

async function checkHealth(options) {
  const app = express();
  installEmployeeNotificationRoutes(app, options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/employee-notifications-api/health`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const healthy = await checkHealth({
  supabase: {},
  pushRuntime: { configured: true },
  runReadOnlySql: async () => [{ employee_notification_auth_ready: true }],
});
assert.equal(healthy.status, 200);
assert.equal(healthy.body.ok, true);
assert.deepEqual(healthy.body.dependencies, {
  database_reachable: true,
  device_auth_resolver_configured: true,
  push_provider_configured: true,
});

const missingAuthResolver = await checkHealth({
  supabase: {},
  pushRuntime: { configured: true },
});
assert.equal(missingAuthResolver.status, 503);
assert.equal(missingAuthResolver.body.ok, false);
assert.equal(missingAuthResolver.body.dependencies.device_auth_resolver_configured, false);

const claimedJob = {
  job_id: '77777777-7777-4777-8777-777777777771',
  job_key: 'employee-message:revocation-boundary',
  job_type: 'employee_native_push',
  source_id: '77777777-7777-4777-8777-777777777772',
  lease_token: '77777777-7777-4777-8777-777777777773',
  payload_json: {
    credential_id: canonicalCredentialId,
    employee_id: '77777777-7777-4777-8777-777777777774',
    device_id: '77777777-7777-4777-8777-777777777775',
    assignment_epoch: 4,
    channel_id: 'employee-messages',
    title: 'Revocation boundary',
    body: 'This must not cross a revoked credential boundary.',
    data_json: { notification_type: 'message' },
  },
};
const authorizedRegistration = {
  registration_id: '77777777-7777-4777-8777-777777777776',
  credential_id: canonicalCredentialId,
  employee_id: claimedJob.payload_json.employee_id,
  device_id: claimedJob.payload_json.device_id,
  assignment_epoch: 4,
  fcm_token: `contract-fcm-${'x'.repeat(40)}`,
  active: true,
};

let sendCount = 0;
let resolveCount = 0;
let credentialRevoked = false;
const revokeAfterClaimDb = {
  async rpc(name) {
    if (name === 'mz_get_employee_native_push_delivery_receipt') {
      return { data: { current: true, already_recorded: false, recorded: false }, error: null };
    }
    assert.equal(name, 'mz_resolve_employee_push_delivery');
    resolveCount += 1;
    return credentialRevoked
      ? { data: { ok: false, terminal: true, reason: 'device_credential_revoked' }, error: null }
      : { data: { ok: true, registration: authorizedRegistration }, error: null };
  },
};
const revokeAfterClaimRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: revokeAfterClaimDb,
  pushRuntime: {
    configured: true,
    async send() { sendCount += 1; return 'provider-message-must-not-exist'; },
  },
  beforeFinalDeliveryCheck: async () => { credentialRevoked = true; },
});
await assert.rejects(
  () => revokeAfterClaimRuntime.deliverClaimedJob(claimedJob),
  (error) => error?.terminal === true && error?.code === 'device_credential_revoked',
  'revocation after claim and before send must be a terminal delivery outcome',
);
assert.equal(resolveCount, 2, 'delivery must revalidate once after claim and once immediately before FCM');
assert.equal(sendCount, 0, 'FCM must not be called after credential revocation');

let preClaimResolveCount = 0;
const revokedBeforeClaimRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_get_employee_native_push_delivery_receipt') {
        return { data: { current: true, already_recorded: false, recorded: false }, error: null };
      }
      assert.equal(name, 'mz_resolve_employee_push_delivery');
      preClaimResolveCount += 1;
      return { data: { ok: false, terminal: true, reason: 'device_credential_expired' }, error: null };
    },
  },
  pushRuntime: {
    configured: true,
    async send() { sendCount += 1; return 'provider-message-must-not-exist'; },
  },
});
await assert.rejects(
  () => revokedBeforeClaimRuntime.deliverClaimedJob(claimedJob),
  (error) => error?.terminal === true && error?.code === 'device_credential_expired',
  'a job claimed after credential expiry must fail closed',
);
// Restarting a worker against the same durable job must repeat the authority
// check and remain terminal instead of attempting provider delivery.
await assert.rejects(
  () => revokedBeforeClaimRuntime.deliverClaimedJob(claimedJob),
  (error) => error?.terminal === true && error?.code === 'device_credential_expired',
);
assert.equal(preClaimResolveCount, 2);
assert.equal(sendCount, 0);

let recordedBinding = null;
const rotatedDuringProviderRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name, args) {
      if (name === 'mz_get_employee_native_push_delivery_receipt') {
        return { data: { current: true, already_recorded: false, recorded: false }, error: null };
      }
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_prepare_employee_native_push_delivery') {
        return { data: { current: true, dispatch_authorized: true, already_prepared: false }, error: null };
      }
      assert.equal(name, 'mz_record_employee_native_push_delivery');
      recordedBinding = args;
      return { data: { current: false, recorded: false, reason: 'push_registration_superseded' }, error: null };
    },
  },
  pushRuntime: {
    configured: true,
    async send() { return 'provider-message-for-superseded-token'; },
  },
});
await assert.rejects(
  () => rotatedDuringProviderRuntime.deliverClaimedJob(claimedJob),
  (error) => error?.terminal === true && error?.code === 'push_registration_superseded_after_provider_dispatch',
  'a provider result cannot be committed after the exact FCM token generation rotates',
);
assert.equal(recordedBinding.p_registration_id, authorizedRegistration.registration_id);
assert.equal(recordedBinding.p_token_hash, createHash('sha256').update(authorizedRegistration.fcm_token).digest('hex'));
assert.equal(recordedBinding.p_job_id, claimedJob.job_id);
assert.equal(recordedBinding.p_lease_token, claimedJob.lease_token);

let nativeReceiptRecorded = false;
let nativeDispatchPrepared = false;
let nativeReplaySendCount = 0;
const nativeReplayRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_get_employee_native_push_delivery_receipt') {
        return nativeReceiptRecorded
          ? { data: { current: true, already_recorded: true, recorded: true, provider_message_id: 'provider-native-once' }, error: null }
          : { data: { current: true, already_recorded: false, recorded: false }, error: null };
      }
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_prepare_employee_native_push_delivery') {
        assert.equal(nativeDispatchPrepared, false);
        nativeDispatchPrepared = true;
        return { data: { current: true, dispatch_authorized: true, already_prepared: false }, error: null };
      }
      assert.equal(name, 'mz_record_employee_native_push_delivery');
      nativeReceiptRecorded = true;
      return { data: { current: true, already_recorded: false, recorded: true, provider_message_id: 'provider-native-once' }, error: null };
    },
  },
  pushRuntime: {
    configured: true,
    async send() { nativeReplaySendCount += 1; return 'provider-native-once'; },
  },
});
assert.deepEqual(await nativeReplayRuntime.deliverClaimedJob(claimedJob), { provider_message_id: 'provider-native-once' });
assert.deepEqual(await nativeReplayRuntime.deliverClaimedJob(claimedJob), { provider_message_id: 'provider-native-once', replayed: true });
assert.equal(nativeReplaySendCount, 1, 'a durable native delivery receipt must suppress provider replay after response loss');

let releaseLeaseExpirySend;
let markLeaseExpirySendStarted;
let preparedLease = null;
let currentLease = claimedJob.lease_token;
let leaseExpirySendCount = 0;
const leaseExpirySendStarted = new Promise((resolve) => { markLeaseExpirySendStarted = resolve; });
const leaseExpirySendRelease = new Promise((resolve) => { releaseLeaseExpirySend = resolve; });
const reclaimedJob = { ...claimedJob, lease_token: '77777777-7777-4777-8777-777777777799' };
const leaseExpiryRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name, args) {
      if (name === 'mz_get_employee_native_push_delivery_receipt') {
        if (preparedLease) {
          return { data: { current: true, terminal: true, already_recorded: false, recorded: false,
            dispatch_prepared: true, delivery_outcome_unknown: true, reason: 'native_push_delivery_outcome_unknown' }, error: null };
        }
        return { data: { current: true, already_recorded: false, recorded: false }, error: null };
      }
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_prepare_employee_native_push_delivery') {
        assert.equal(args.p_lease_token, currentLease);
        assert.equal(preparedLease, null);
        preparedLease = args.p_lease_token;
        return { data: { current: true, dispatch_authorized: true, already_prepared: false }, error: null };
      }
      assert.equal(name, 'mz_record_employee_native_push_delivery');
      return args.p_lease_token === currentLease
        ? { data: { current: true, recorded: true }, error: null }
        : { data: { current: false, recorded: false, reason: 'employee_native_push_lease_superseded' }, error: null };
    },
  },
  pushRuntime: {
    configured: true,
    async send() {
      leaseExpirySendCount += 1;
      markLeaseExpirySendStarted();
      await leaseExpirySendRelease;
      return 'provider-native-lease-expiry';
    },
  },
});
const staleWorkerDelivery = leaseExpiryRuntime.deliverClaimedJob(claimedJob);
await leaseExpirySendStarted;
currentLease = reclaimedJob.lease_token;
await assert.rejects(
  () => leaseExpiryRuntime.deliverClaimedJob(reclaimedJob),
  (error) => error?.terminal === true && error?.code === 'native_push_delivery_outcome_unknown',
  'a reclaimed worker must not cross an unresolved provider dispatch boundary',
);
releaseLeaseExpirySend();
await assert.rejects(
  () => staleWorkerDelivery,
  (error) => error?.terminal === true && error?.code === 'employee_native_push_lease_superseded_after_provider_dispatch',
);
assert.equal(leaseExpirySendCount, 1, 'lease expiry during FCM must not permit a second provider dispatch');

const eventClaimedJob = {
  ...claimedJob,
  job_id: '88888888-8888-4888-8888-888888888881',
  job_key: 'employee-event:cancel-boundary',
  job_type: 'employee_event_push',
  source_id: '88888888-8888-4888-8888-888888888882',
};
const eventInstance = {
  instance_id: eventClaimedJob.source_id,
  event_id: '88888888-8888-4888-8888-888888888883',
  employee_id: '88888888-8888-4888-8888-888888888884',
  event_revision: 1,
  notification_key: 'event:cancel-boundary',
  notification_kind: 'day_before',
  credential_id: canonicalCredentialId,
  assignment_epoch: 4,
  state: 'pending',
  employees: { display_name: 'Tammy' },
  events_app_events: { event_name: 'Cancelled event', display_location: 'Zoo Footprint',
    event_date: '2026-10-20', start_time: '18:00:00', end_time: '20:30:00', attendee_count: 240 },
};
const currentEventProjection = { current:true,event_id:eventInstance.event_id,
  event_revision:eventInstance.event_revision,instance_id:eventInstance.instance_id,
  employee_id:eventInstance.employee_id,notification_key:eventInstance.notification_key,
  employee_name:'Tammy',event_name:'Current confirmed event',display_location:'Canonical Event Center',
  event_date:'2026-10-20',start_instant_utc:'2026-10-20T23:00:00Z',
  end_instant_utc:'2026-10-21T01:30:00Z',attendee_count:240,
  custodial_note_codes:['trash_boxes'],custodial_public_notes:'Waxed floor: use protected route.' };
function eventInstanceQuery(row, { onUpdate = null } = {}) {
  const query = {
    select() { return query; },
    update() { onUpdate?.(); return query; },
    eq() { return query; },
    in() { return query; },
    single: async () => ({ data: row, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return query;
}

let cancelledEventSendCount = 0;
const cancelledBeforeProviderRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      assert.equal(name, 'mz_claim_employee_event_push_delivery');
      return { data: { ok: false, terminal: true, reason: 'event_push_instance_cancelled' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance);
    },
  },
  pushRuntime: {
    configured: true,
    async send() { cancelledEventSendCount += 1; return 'provider-message-must-not-exist'; },
  },
});
await assert.rejects(
  () => cancelledBeforeProviderRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.terminal === true && error?.code === 'event_push_instance_cancelled',
  'an event cancelled after job claim must fail the database-bound pre-provider check',
);
assert.equal(cancelledEventSendCount, 0, 'FCM must not receive an event that is cancelled before provider dispatch');

let duplicateClaimEventUpdates = 0;
let duplicateClaimEventSends = 0;
const duplicateSameLeaseClaimRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      assert.equal(name, 'mz_claim_employee_event_push_delivery');
      return { data: { ok: false, terminal: false, defer_finish: true,
        reason: 'event_push_delivery_in_flight', state: 'leased' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance, { onUpdate: () => { duplicateClaimEventUpdates += 1; } });
    },
  },
  pushRuntime: {
    configured: true,
    async send() { duplicateClaimEventSends += 1; return 'provider-message-must-not-exist'; },
  },
});
await assert.rejects(
  () => duplicateSameLeaseClaimRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.deferFinish === true && error?.terminal !== true && error?.code === 'event_push_delivery_in_flight',
  'an exact same-lease event claim retry must leave the original provider boundary untouched',
);
assert.equal(duplicateClaimEventSends, 0);
assert.equal(duplicateClaimEventUpdates, 0);

let crossingEventSendCount = 0;
let crossingEventBody = '';
const cancelledAcrossProviderRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_claim_employee_event_push_delivery') {
        return { data: { ok: true, instance_id: eventInstance.instance_id, state: 'leased' }, error: null };
      }
      if (name === 'mz_employee_event_push_current_projection') return {data:currentEventProjection,error:null};
      assert.equal(name, 'mz_record_employee_event_push_delivery');
      return { data: { current: false, recorded: false, reason: 'event_or_revision_superseded' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance);
    },
  },
  pushRuntime: {
    configured: true,
    async send(push) { crossingEventSendCount += 1; crossingEventBody=push.body; return 'provider-message-cancelled-at-boundary'; },
  },
});
await assert.rejects(
  () => cancelledAcrossProviderRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.terminal === true && error?.code === 'event_or_revision_superseded_after_provider_dispatch',
  'a cancellation crossing the provider boundary cannot be recorded as a successful event delivery',
);
assert.equal(crossingEventSendCount, 1);
assert.match(crossingEventBody,/Canonical Event Center/);
assert.match(crossingEventBody,/Waxed floor/);
assert.doesNotMatch(crossingEventBody,/Cancelled event|Zoo Footprint|PRIVATE_MANAGER_SOURCE/);

let staleProjectionSends=0;
const staleProjectionRuntime=installEmployeeNotificationRoutes(express(),{
  supabase:{
    async rpc(name){
      if(name==='mz_resolve_employee_push_delivery')return {data:{ok:true,registration:authorizedRegistration},error:null};
      if(name==='mz_claim_employee_event_push_delivery')return {data:{ok:true,dispatch_authorized:true},error:null};
      if(name==='mz_employee_event_push_current_projection')return {data:{current:false,reason:'event_place_needs_review'},error:null};
      if(name==='mz_release_employee_event_push_delivery')return {data:{current:true,released:true},error:null};
      throw new Error(`unexpected stale projection RPC ${name}`);
    },
    from(name){assert.equal(name,'event_push_instances');return eventInstanceQuery(eventInstance);},
  },pushRuntime:{configured:true,async send(){staleProjectionSends++;return 'must-not-send';}},
});
await assert.rejects(()=>staleProjectionRuntime.deliverClaimedJob(eventClaimedJob),
  error=>error?.terminal===true&&error?.code==='event_place_needs_review');
assert.equal(staleProjectionSends,0);

let releaseEventLeaseExpirySend;
let markEventLeaseExpirySendStarted;
let preparedEventLease = null;
let currentEventLease = eventClaimedJob.lease_token;
let eventLeaseExpirySendCount = 0;
const eventLeaseExpirySendStarted = new Promise((resolve) => { markEventLeaseExpirySendStarted = resolve; });
const eventLeaseExpirySendRelease = new Promise((resolve) => { releaseEventLeaseExpirySend = resolve; });
const reclaimedEventJob = { ...eventClaimedJob, lease_token: '88888888-8888-4888-8888-888888888899' };
const eventLeaseExpiryRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name, args) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_claim_employee_event_push_delivery') {
        if (preparedEventLease) {
          return { data: { ok: false, terminal: true, dispatch_authorized: false,
            reason: 'event_push_delivery_outcome_unknown' }, error: null };
        }
        preparedEventLease = args.p_lease_token;
        return { data: { ok: true, dispatch_authorized: true, instance_id: eventInstance.instance_id, state: 'leased' }, error: null };
      }
      if (name === 'mz_employee_event_push_current_projection') return {data:currentEventProjection,error:null};
      assert.equal(name, 'mz_record_employee_event_push_delivery');
      return args.p_lease_token === currentEventLease
        ? { data: { current: true, recorded: true }, error: null }
        : { data: { current: false, recorded: false, reason: 'employee_event_push_lease_superseded' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance);
    },
  },
  pushRuntime: {
    configured: true,
    async send() {
      eventLeaseExpirySendCount += 1;
      markEventLeaseExpirySendStarted();
      await eventLeaseExpirySendRelease;
      return 'provider-event-lease-expiry';
    },
  },
});
const staleEventWorkerDelivery = eventLeaseExpiryRuntime.deliverClaimedJob(eventClaimedJob);
await eventLeaseExpirySendStarted;
currentEventLease = reclaimedEventJob.lease_token;
await assert.rejects(
  () => eventLeaseExpiryRuntime.deliverClaimedJob(reclaimedEventJob),
  (error) => error?.terminal === true && error?.code === 'event_push_delivery_outcome_unknown',
  'a reclaimed event worker must not repeat an unresolved provider dispatch',
);
releaseEventLeaseExpirySend();
await assert.rejects(
  () => staleEventWorkerDelivery,
  (error) => error?.terminal === true && error?.code === 'employee_event_push_lease_superseded_after_provider_dispatch',
);
assert.equal(eventLeaseExpirySendCount, 1, 'lease expiry during event FCM must not permit a second provider dispatch');

let rotatedFailureEventUpdates = 0;
const rotatedDuringProviderFailureRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_claim_employee_event_push_delivery') {
        return { data: { ok: true, instance_id: eventInstance.instance_id, state: 'leased' }, error: null };
      }
      if (name === 'mz_employee_event_push_current_projection') return {data:currentEventProjection,error:null};
      if (name === 'mz_release_employee_event_push_delivery') {
        return { data: { current: true, released: true, state: 'failed' }, error: null };
      }
      assert.equal(name, 'mz_record_employee_push_delivery');
      return { data: { current: false, recorded: false, reason: 'push_registration_superseded' }, error: null };
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance, { onUpdate: () => { rotatedFailureEventUpdates += 1; } });
    },
  },
  pushRuntime: {
    configured: true,
    async send() {
      throw Object.assign(new Error('old provider token rejected'), { permanent: true, deliveryNotAccepted: true });
    },
  },
});
await assert.rejects(
  () => rotatedDuringProviderFailureRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.terminal !== true && error?.permanent !== true
    && error?.code === 'push_registration_rotated_after_provider_failure',
  'an old-token provider failure must remain retryable against the replacement token',
);
assert.equal(rotatedFailureEventUpdates, 1, 'a stale provider failure must transition the leased event to retryable failed state');

let ambiguousReleaseCalls = 0;
let ambiguousEventUpdates = 0;
const ambiguousProviderRuntime = installEmployeeNotificationRoutes(express(), {
  supabase: {
    async rpc(name) {
      if (name === 'mz_resolve_employee_push_delivery') {
        return { data: { ok: true, registration: authorizedRegistration }, error: null };
      }
      if (name === 'mz_claim_employee_event_push_delivery') {
        return { data: { ok: true, instance_id: eventInstance.instance_id, state: 'leased' }, error: null };
      }
      if (name === 'mz_employee_event_push_current_projection') return {data:currentEventProjection,error:null};
      if (name === 'mz_release_employee_event_push_delivery') {
        ambiguousReleaseCalls += 1;
        return { data: { current: true, released: true }, error: null };
      }
      throw new Error(`unexpected ambiguous-provider RPC ${name}`);
    },
    from(name) {
      assert.equal(name, 'event_push_instances');
      return eventInstanceQuery(eventInstance, { onUpdate: () => { ambiguousEventUpdates += 1; } });
    },
  },
  pushRuntime: {
    configured: true,
    async send() {
      throw Object.assign(new Error('FCM returned HTTP 200.'), { deliveryNotAccepted: false });
    },
  },
});
await assert.rejects(
  () => ambiguousProviderRuntime.deliverClaimedJob(eventClaimedJob),
  (error) => error?.terminal === true && error?.permanent === true
    && error?.code === 'event_push_delivery_outcome_unknown',
  'an ambiguous FCM 200 must terminally preserve the prepared at-most-once marker',
);
assert.equal(ambiguousReleaseCalls, 0, 'ambiguous provider acceptance must never release the durable dispatch marker');
assert.equal(ambiguousEventUpdates, 1, 'ambiguous provider acceptance terminally cancels the event instead of creating a retryable state');

assert.match(source, /resolveAuthorizedDelivery\(credential, assignmentEpoch\)[\s\S]*beforeFinalDeliveryCheck[\s\S]*resolveAuthorizedDelivery\(credential, assignmentEpoch\)/);
assert.match(source, /claimEventDelivery\(job, eventInstance, credential, assignmentEpoch, registration\)[\s\S]*pushRuntime\.send/);
assert.match(source, /recordEventDelivery\(job, eventInstance, credential, assignmentEpoch, registration, providerMessageId\)/);
assert.match(source, /mz_get_employee_native_push_delivery_receipt/);
assert.match(source, /mz_prepare_employee_native_push_delivery/);
assert.match(source, /mz_release_employee_native_push_delivery/);
assert.match(source, /mz_record_employee_native_push_delivery/);
assert.match(source, /providerResultSuperseded[\s\S]*push_registration_rotated_after_provider_failure/);
assert.match(source, /\.in\('state', \['pending', 'leased', 'failed'\]\)[\s\S]*maybeSingle/);
assert.match(source, /finish_operational_notification_job_terminal/);
assert.match(indexSource, /error\?\.terminal === true[\s\S]*finish_operational_notification_job_terminal/);
assert.match(source, /deferFinish[\s\S]*if \(deferFinish\) continue/);
const operationalWorkerStart = indexSource.indexOf("async function runOperationalNotificationWorker");
const operationalWorkerEnd = indexSource.indexOf("async function listGuestCleanlinessReports");
assert.ok(operationalWorkerStart >= 0 && operationalWorkerEnd > operationalWorkerStart, "the operational worker must remain inspectable");
const operationalWorker = indexSource.slice(operationalWorkerStart, operationalWorkerEnd);
// Keep the independent-review baseline immutable. The candidate adds only the
// named guest-pause path; it is not declared independently reviewed by this test.
// Removing those exact additions must recover the byte-identical reviewed worker.
const guestPauseAdditions = [
  ['claim_operational_notification_jobs_v2', 'claim_operational_notification_jobs'],
  ['      p_guest_reporting_enabled: GUEST_FEATURE.enabled === true,\n', ''],
  ['          let deferGuest = false;\n', ''],
  ['            deferGuest = error?.deferGuest === true && job.job_type === "guest_cleanliness_report";\n', ''],
  ['          if (deferGuest) {\n            mutationLease.assertActive();\n            await runRpc("pause_guest_notification_job",{p_job_id:job.job_id,p_lease_token:job.lease_token});\n            return {job_id:job.job_id,succeeded:false,paused:true,terminal:false};\n          }\n', ''],
];
let reviewedFinalizationCore = operationalWorker;
for (const [candidateText, originalText] of guestPauseAdditions) {
  assert.equal(reviewedFinalizationCore.split(candidateText).length - 1, 1,
    'each declared guest-pause delta must occur exactly once');
  reviewedFinalizationCore = reviewedFinalizationCore.replace(candidateText, originalText);
}
assert.equal(
  createHash("sha256").update(reviewedFinalizationCore).digest("hex"),
  "f9151af2a3115297b05a9a9725b56f8fa8e9d23394f8fd190565e5b6871008db",
  "unchanged finalization core must retain the exact independently reviewed bytes",
);

async function assertOperationalWorkerDeferral(workerSource) {
  const rpcReferences = workerSource.match(/\brunRpc\b/g) || [];
  const awaitedRpcCalls = workerSource.match(/\bawait\s+runRpc\s*\(/g) || [];
  assert.equal(
    rpcReferences.length,
    4,
    "the worker must contain exactly four owned RPC references: claim, guest pause, and two mutually exclusive finish calls",
  );
  assert.equal(
    awaitedRpcCalls.length,
    rpcReferences.length,
    "every worker RPC reference must be a directly awaited call; aliasing or callback finalization is forbidden",
  );
  const rpcCalls = [];
  const handlerCalls = [];
  const claimedJobs = [
    { job_id: "10000000-0000-4000-8000-000000000001", job_type: "deferred_fixture", lease_token: "20000000-0000-4000-8000-000000000001", attempts: 1 },
    { job_id: "10000000-0000-4000-8000-000000000002", job_type: "success_fixture", lease_token: "20000000-0000-4000-8000-000000000002", attempts: 1 },
  ];
  const context = createContext({
    runRpc: async (name, payload) => {
      rpcCalls.push({ name, payload });
      if (name === "claim_operational_notification_jobs_v2") return claimedJobs;
      return { ok: true };
    },
    withApplicationMutationLease: async ({ operation }) => operation({ assertActive() {} }),
    supabaseAdmin: {},
    GUEST_FEATURE: {enabled:false},
    processGuestCleanlinessNotificationJob: async () => { throw new Error("guest fixture must not run"); },
    operationalNotificationJobHandlers: new Map([
      ["deferred_fixture", async (job) => {
        handlerCalls.push(job.job_id);
        throw Object.assign(new Error("provider result remains in flight"), { deferFinish: true });
      }],
      ["success_fixture", async (job) => { handlerCalls.push(job.job_id); }],
    ]),
    runCustodialOfflineReconciliationNotificationWorker: async () => ({ ok: true, claimed: 0 }),
    Promise: undefined,
    process: undefined,
    queueMicrotask: undefined,
    setImmediate: undefined,
    setTimeout: undefined,
  }, {
    codeGeneration: { strings: false, wasm: false },
    name: "operational-notification-worker-contract",
  });
  const worker = runInContext(
    `"use strict";
     let operationalNotificationWorkerInFlight = false;
     const OPERATIONAL_NOTIFICATION_WORKER_ID = "notification-contract-worker";
     ${workerSource}
     runOperationalNotificationWorker;`,
    context,
    { timeout: 1_000 },
  );
  const outcome = await worker({ limit: 10 });
  assert.deepEqual(handlerCalls, claimedJobs.map((job) => job.job_id), "a deferred first job must not stop the outer loop from processing the next claimed job");
  assert.equal(outcome.results.length, 2);
  assert.equal(outcome.results[0].deferred, true);
  assert.equal(outcome.results[0].succeeded, false);
  assert.equal(outcome.results[1].succeeded, true);
  const finishCalls = rpcCalls.filter(({ name }) => name !== "claim_operational_notification_jobs_v2");
  assert.deepEqual(finishCalls.map(({ name, payload }) => ({ name, job_id: payload.p_job_id })), [
    { name: "finish_operational_notification_job", job_id: claimedJobs[1].job_id },
  ], "a deferred job must invoke neither retry nor terminal finalization; only the succeeding second job may finish");
}

await assertOperationalWorkerDeferral(operationalWorker);
const aliasedDeferredFinishMutant = operationalWorker.replace(
  "if (deferFinish) {",
  'if (deferFinish) {\n            await runRpc("finish_operational_" + "notification_job", { p_job_id: job.job_id, p_lease_token: job.lease_token });',
);
assert.notEqual(aliasedDeferredFinishMutant, operationalWorker);
await assert.rejects(() => assertOperationalWorkerDeferral(aliasedDeferredFinishMutant), /exactly four owned RPC references/);
const earlyBreakMutant = operationalWorker.replace("results.push(result);", "results.push(result);\n      break;");
assert.notEqual(earlyBreakMutant, operationalWorker);
await assert.rejects(() => assertOperationalWorkerDeferral(earlyBreakMutant), /must not stop the outer loop/);
const asynchronousDeferredFinishMutant = operationalWorker.replace(
  "if (deferFinish) {",
  `if (deferFinish) {
            setTimeout(() => {
              void runRpc(["finish_operational", "notification_job"].join("_"), {
                p_job_id: job.job_id,
                p_lease_token: job.lease_token,
                p_succeeded: false,
              });
            }, 0);`,
);
assert.notEqual(asynchronousDeferredFinishMutant, operationalWorker);
await assert.rejects(() => assertOperationalWorkerDeferral(asynchronousDeferredFinishMutant), /exactly four owned RPC references/);
const obfuscatedGlobalTimerFinishMutant = operationalWorker.replace(
  "if (deferFinish) {",
  `if (deferFinish) {
            globalThis[["set", "Timeout"].join("")](() => {
              void runRpc(["finish_operational", "notification_job"].join("_"), {
                p_job_id: job.job_id,
                p_lease_token: job.lease_token,
                p_succeeded: false,
              });
            }, 100);`,
);
assert.notEqual(obfuscatedGlobalTimerFinishMutant, operationalWorker);
await assert.rejects(
  () => assertOperationalWorkerDeferral(obfuscatedGlobalTimerFinishMutant),
  /exactly four owned RPC references/,
);
const intrinsicPromiseFinishMutant = operationalWorker.replace(
  "if (deferFinish) {",
  `if (deferFinish) {
            let schedulerHops = 0;
            const scheduleLateFinish = () => {
              schedulerHops += 1;
              if (schedulerHops === 100) {
                void runRpc(["finish", "operational", "notification", "job"].join("_"), {
                  p_job_id: job.job_id,
                  p_lease_token: job.lease_token,
                  p_succeeded: false,
                });
                return;
              }
              (async () => {})().then(scheduleLateFinish);
            };
            scheduleLateFinish();`,
);
assert.notEqual(intrinsicPromiseFinishMutant, operationalWorker);
await assert.rejects(
  () => assertOperationalWorkerDeferral(intrinsicPromiseFinishMutant),
  /exactly four owned RPC references/,
);

console.log('EMPLOYEE_NATIVE_NOTIFICATION_CONTRACT_PASS');
