import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {collectOneOutlookEventInIsolatedTest} from '../src/outlook-collector-test-route.js';

// Callback contract for an existing authorized connector host, not a fixture
// claim of Microsoft access: fetchOriginal must call the single-message full
// fetch and return its complete original text; importObservation must bind the
// private typed writer to route.project_ref and add that verified ref to its
// exact ledger readback; readManagerFeed must use a current named-manager TEST
// session and add its independently verified target ref. No callback may use
// the production server's default SUPABASE_URL/service-role fallback.
const messageId='synthetic-original-message-1';
const eventId='12000000-0000-4000-8000-000000000001';
const managerId='13000000-0000-4000-8000-000000000001';
const route={kind:'isolated_test',project_ref:'abcdefghijklmnopqrst',
  production_project_ref:'rqquvtjdmugpigbndmne',writer_project_ref:'abcdefghijklmnopqrst',
  reader_project_ref:'abcdefghijklmnopqrst',manager_id:managerId,approved_message_id:messageId,
  run_id:'16000000-0000-4000-8000-000000000001'};
const event={event_name:'Synthetic Zoo Event',event_scope:'SINGLE_VENUE',primary_venue_id:eventId,
  event_date:'2026-10-10',end_date:'2026-10-10',start_time:'14:00:00',end_time:'15:00:00',
  start_instant_utc:'2026-10-10T19:00:00Z',end_instant_utc:'2026-10-10T20:00:00Z',attendee_count:50};
const original={kind:'original_message',complete:true,id:messageId,mailbox:'eoperle@memphiszoo.org',
  content:'Synthetic full source content, never a preview.',subject:'Synthetic notice',
  source_at:'2026-10-09T10:00:00Z',received_at:'2026-10-09T10:01:00Z'};
const digest=createHash('sha256').update(original.content).digest('hex');
const decision={action:'apply',evidence_kind:'original_event_notice',
  observation:{source_event_key:'synthetic-event',event}};
const feed=(row={id:eventId,revision:1,name:event.event_name,date:event.event_date,
  start_time:event.start_time,end_time:event.end_time,status:'SCHEDULED'})=>({
    target_project_ref:route.project_ref,ok:true,feed:{schema:'custodial.events-feed.v1',rows:[row]},
    meta:{manager_id:managerId,credential_id:'fixture-manager-credential'}});
function callbacks(overrides={}){
  const calls=[];
  const args={route,messageId,
    fetchOriginal:async id=>{calls.push('fetch');assert.equal(id,messageId);return original;},
    decideEvent:async source=>{calls.push('decide');assert.deepEqual(source,original);return decision;},
    importObservation:async request=>{calls.push('import');assert.equal(request.request.observation.source.content_sha256,digest);
      assert.equal(request.request.observation.source.message_id,messageId);
      return {target_project_ref:route.project_ref,action:'apply',state:'APPLIED',readback_verified:true,
        event_id:eventId,ledger_id:'14000000-0000-4000-8000-000000000001',replayed:false};},
    readManagerFeed:async()=>{calls.push('manager');return feed();},...overrides};
  return {args,calls};
}

test('one complete original binds source digest, typed import, and named-manager TEST readback',async()=>{
  const {args,calls}=callbacks();const result=await collectOneOutlookEventInIsolatedTest(args);
  assert.deepEqual(calls,['fetch','decide','import','manager']);
  assert.equal(result.state,'APPLIED');assert.equal(result.manager_readback_verified,true);
  assert.equal(result.source_digest,digest);assert.equal(result.replayed,false);
  assert.equal(result.outcome,'IMPORTED_MANAGER_READBACK');assert.equal(result.import_verified,true);
  assert.equal(result.run_id,route.run_id);assert.equal(result.source_at,original.source_at);
  assert.equal(result.mailbox_completeness,'unknown');assert.equal(result.projection_check,'current_projection');
  assert.ok(Number.isInteger(result.source_age_seconds));assert.ok(Number.isFinite(Date.parse(result.observed_at_utc)));
  assert.equal(JSON.stringify(result).includes(original.content),false);
});
test('production or cross-project route fails before a mailbox read',async()=>{
  for(const bad of [{...route,project_ref:route.production_project_ref},
    {...route,writer_project_ref:route.production_project_ref},
    {...route,reader_project_ref:route.production_project_ref},
    {...route,manager_id:'not-a-manager-id'},
    {...route,approved_message_id:'different-message'},
    {...route,cursor:'2026-10-09T12:00:00Z'},
    {...route,activate:true},
    {...route,write_production:true}]){
    const {args,calls}=callbacks();await assert.rejects(collectOneOutlookEventInIsolatedTest({...args,route:bad}),/isolated_test_route_unverified/);
    assert.deepEqual(calls,[]);
  }
});
test('route mutation during awaited fetch cannot retarget the typed writer or manager reader',async()=>{
  const mutableRoute={...route};
  const {args,calls}=callbacks({fetchOriginal:async()=>{
    calls.push('fetch');mutableRoute.project_ref=route.production_project_ref;
    mutableRoute.writer_project_ref=route.production_project_ref;
    mutableRoute.reader_project_ref=route.production_project_ref;
    mutableRoute.manager_id='15000000-0000-4000-8000-000000000001';
    mutableRoute.approved_message_id='different-message';return original;
  },importObservation:async (_request,bound)=>{
    calls.push('import');assert.notEqual(bound,mutableRoute);assert.ok(Object.isFrozen(bound));
    assert.equal(bound.project_ref,route.project_ref);
    assert.equal(bound.writer_project_ref,route.project_ref);
    assert.throws(()=>{bound.project_ref=route.production_project_ref;},TypeError);
    return {target_project_ref:route.project_ref,action:'apply',state:'APPLIED',
      readback_verified:true,event_id:eventId,ledger_id:'14000000-0000-4000-8000-000000000001'};
  },readManagerFeed:async bound=>{
    calls.push('manager');assert.equal(bound.reader_project_ref,route.project_ref);
    assert.equal(bound.manager_id,managerId);return feed();
  }});
  const result=await collectOneOutlookEventInIsolatedTest({...args,route:mutableRoute});
  assert.deepEqual(calls,['fetch','decide','import','manager']);
  assert.equal(result.outcome,'IMPORTED_MANAGER_READBACK');
});
test('preview or wrong source identity cannot reach the writer',async()=>{
  for(const bad of [{...original,complete:false},{...original,id:'different-message'},
    {...original,content:''},{...original,mailbox:'other@example.com'}]){
    const {args,calls}=callbacks({fetchOriginal:async()=>{calls.push('fetch');return bad;}});
    await assert.rejects(collectOneOutlookEventInIsolatedTest(args),/outlook_original_unverified/);
    assert.deepEqual(calls,['fetch']);
  }
});
test('event extraction cannot replace the fetched source evidence',async()=>{
  const {args,calls}=callbacks({decideEvent:async()=>{calls.push('decide');return {...decision,
    observation:{...decision.observation,source:{message_id:'invented'}}};}});
  await assert.rejects(collectOneOutlookEventInIsolatedTest(args),/outlook_source_override/);
  assert.deepEqual(calls,['fetch','decide']);
});
test('event extraction cannot mutate the original message identity',async()=>{
  const {args}=callbacks({decideEvent:async source=>{assert.throws(()=>{source.id='invented';},TypeError);return decision;}});
  const result=await collectOneOutlookEventInIsolatedTest(args);
  assert.equal(result.outcome,'IMPORTED_MANAGER_READBACK');assert.equal(result.message_id,messageId);
});
test('extractor mutation of caller-owned original metadata cannot alter typed provenance',async()=>{
  const mutableOriginal={...original};
  const {args}=callbacks({fetchOriginal:async()=>mutableOriginal,
    decideEvent:async view=>{
      assert.ok(Object.isFrozen(view));
      assert.throws(()=>{view.subject='Synthetic altered metadata';},TypeError);
      mutableOriginal.source_at='2026-10-09T11:00:00Z';
      mutableOriginal.received_at='2026-10-09T11:01:00Z';
      mutableOriginal.subject='Synthetic altered metadata';return decision;
    },importObservation:async request=>{
      const source=request.request.observation.source;
      assert.equal(source.source_at,original.source_at);
      assert.equal(source.received_at,original.received_at);
      assert.equal(source.subject,original.subject);
      assert.equal(source.content_sha256,digest);
      return {target_project_ref:route.project_ref,action:'apply',state:'APPLIED',
        readback_verified:true,event_id:eventId,ledger_id:'14000000-0000-4000-8000-000000000001'};
    }});
  const result=await collectOneOutlookEventInIsolatedTest(args);
  assert.equal(result.outcome,'IMPORTED_MANAGER_READBACK');
  assert.equal(result.source_at,original.source_at);
  assert.equal(result.received_at,original.received_at);
});
test('writer target and exact import readback are required',async()=>{
  for(const change of [{target_project_ref:route.production_project_ref},{readback_verified:false}]){
    const {args,calls}=callbacks({importObservation:async()=>{calls.push('import');return {
      target_project_ref:route.project_ref,action:'apply',state:'APPLIED',readback_verified:true,event_id:eventId,...change};}});
    const result=await collectOneOutlookEventInIsolatedTest(args);
    assert.equal(result.outcome,'IMPORT_UNCONFIRMED');assert.equal(result.import_verified,false);
    assert.equal(result.manager_readback_verified,false);assert.equal(result.ledger_id,undefined);
    assert.deepEqual(calls,['fetch','decide','import']);
  }
});
test('writer exception preserves unknown commit state and prevents readback claim',async()=>{
  const {args,calls}=callbacks({importObservation:async()=>{calls.push('import');throw new Error('transport lost');}});
  const result=await collectOneOutlookEventInIsolatedTest(args);
  assert.equal(result.outcome,'IMPORT_UNCONFIRMED');assert.equal(result.source_digest,digest);
  assert.equal(result.manager_readback_verified,false);assert.deepEqual(calls,['fetch','decide','import']);
});
test('manager identity, target, and current event fields must agree',async()=>{
  for(const response of [{...feed(),target_project_ref:route.production_project_ref},
    {...feed(),meta:{manager_id:'15000000-0000-4000-8000-000000000001',credential_id:'fixture'}},
    feed({...feed().feed.rows[0],name:'Stale name'})]){
    const {args}=callbacks({readManagerFeed:async()=>response});
    const result=await collectOneOutlookEventInIsolatedTest(args);
    assert.equal(result.outcome,'IMPORTED_MANAGER_UNCONFIRMED');
    assert.equal(result.import_verified,true);assert.equal(result.manager_readback_verified,false);
  }
});
test('manager transport exception preserves verified import without claiming feed proof',async()=>{
  const {args}=callbacks({readManagerFeed:async()=>{throw new Error('reader unavailable');}});
  const result=await collectOneOutlookEventInIsolatedTest(args);
  assert.equal(result.outcome,'IMPORTED_MANAGER_UNCONFIRMED');assert.equal(result.import_verified,true);
  assert.equal(result.manager_readback_verified,false);assert.equal(result.event_id,eventId);
});
test('replay after a later update preserves identity without mistaking current fields for old fields',async()=>{
  const {args}=callbacks({importObservation:async()=>({target_project_ref:route.project_ref,action:'apply',
    state:'APPLIED',readback_verified:true,event_id:eventId,
    ledger_id:'14000000-0000-4000-8000-000000000001',replayed:true}),
    readManagerFeed:async()=>feed({...feed().feed.rows[0],revision:2,name:'Updated Event'})});
  const result=await collectOneOutlookEventInIsolatedTest(args);
  assert.equal(result.replayed,true);assert.equal(result.revision,2);assert.equal(result.manager_readback_verified,true);
  assert.equal(result.projection_check,'identity_only_replay');
});
test('a source-ordered update checks the latest manager projection',async()=>{
  const updated={...event,event_name:'Updated Event'};
  const {args}=callbacks({decideEvent:async()=>({action:'apply',evidence_kind:'event_update',
    observation:{source_event_key:'synthetic-event',event:updated,event_id:eventId,expected_revision:1}}),
    readManagerFeed:async()=>feed({...feed().feed.rows[0],revision:2,name:'Updated Event'})});
  const result=await collectOneOutlookEventInIsolatedTest(args);
  assert.equal(result.revision,2);assert.equal(result.manager_readback_verified,true);
});
test('a purported update cannot pass with the old revision still on the manager feed',async()=>{
  const {args}=callbacks({decideEvent:async()=>({action:'apply',evidence_kind:'event_update',
    observation:{source_event_key:'synthetic-event',event,event_id:eventId,expected_revision:1}})});
  const result=await collectOneOutlookEventInIsolatedTest(args);
  assert.equal(result.outcome,'IMPORTED_MANAGER_UNCONFIRMED');assert.equal(result.manager_readback_verified,false);
});
test('cancellation requires a cancelled manager projection',async()=>{
  const cancelled={action:'cancel',evidence_kind:'event_cancellation',observation:{
    source_event_key:'synthetic-event',event_id:eventId,expected_revision:1,reason:'Synthetic cancellation'}};
  const writer=async()=>({target_project_ref:route.project_ref,action:'cancel',state:'CANCELLED',
    readback_verified:true,event_id:eventId,ledger_id:'14000000-0000-4000-8000-000000000001'});
  const {args}=callbacks({decideEvent:async()=>cancelled,importObservation:writer,
    readManagerFeed:async()=>feed({...feed().feed.rows[0],revision:2,status:'CANCELLED'})});
  const verified=await collectOneOutlookEventInIsolatedTest(args);
  assert.equal(verified.outcome,'IMPORTED_MANAGER_READBACK');
  const unconfirmed=await collectOneOutlookEventInIsolatedTest({...args,readManagerFeed:async()=>feed()});
  assert.equal(unconfirmed.outcome,'IMPORTED_MANAGER_UNCONFIRMED');
});
