// Mandatory executed consumer proof; no SQL, clock or delivery qualification.
import assert from 'node:assert/strict';
import {runNativeScheduleOccurrenceTests} from './native-schedule-occurrence-tests.mjs';

const receipt=await runNativeScheduleOccurrenceTests();
assert.equal(receipt.status,'PASS');
assert.equal(receipt.checks,352);
assert.equal(receipt.original_checks,213);
assert.equal(receipt.dated_checks,139);
assert.equal(receipt.sql_executed,false);
assert.equal(receipt.solver_executed,false);
assert.equal(receipt.delivery_admitted,false);
console.log(JSON.stringify({suite:'native-schedule-source-called',...receipt}));

import {runNativeScheduleLunchRecipientTests} from './native-schedule-lunch-recipient-tests.mjs';
const lunchRecipientReceipt=runNativeScheduleLunchRecipientTests();
assert.equal(lunchRecipientReceipt.status,'PASS');
assert.equal(lunchRecipientReceipt.checks,93);
assert.equal(lunchRecipientReceipt.sql_executed,false);
assert.equal(lunchRecipientReceipt.delivery_admitted,false);
console.log(JSON.stringify({suite:'native-schedule-lunch-recipient-called',...lunchRecipientReceipt}));

import {runNativeScheduleValiditySourceTests} from './native-schedule-validity-source-tests.mjs';
const validityReceipt=await runNativeScheduleValiditySourceTests();
assert.equal(validityReceipt.status,'PASS');
assert.equal(validityReceipt.checks,94);
for(const field of ['sql_executed','clock_admitted','retention_admitted','delivery_admitted'])assert.equal(validityReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-validity-source-called',...validityReceipt}));

import {runNativeScheduleDeliveryPreparationTests} from './native-schedule-delivery-preparation-tests.mjs';
const contentReceipt=await runNativeScheduleDeliveryPreparationTests();
assert.equal(contentReceipt.status,'PASS');
assert.equal(contentReceipt.checks,146);
for(const field of ['new_sql_executed','provider_dispatch','clock_admitted','retention_admitted','native_wire_admitted','phone'])assert.equal(contentReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-content-preparation-called',...contentReceipt}));

import {runNativeSchedulePayloadTests} from './native-schedule-payload-tests.mjs';
const payloadReceipt=runNativeSchedulePayloadTests();
assert.equal(payloadReceipt.status,'PASS');
assert.equal(payloadReceipt.checks,131);
assert.equal(payloadReceipt.provider_dispatch,false);
assert.equal(payloadReceipt.native_qualified,false);
assert.equal(payloadReceipt.phone,false);
console.log(JSON.stringify({suite:'native-schedule-closed-wire-called',...payloadReceipt}));

import {runNativeScheduleFinalizationSourceTests} from './native-schedule-finalization-source-tests.mjs';
const finalizationReceipt=runNativeScheduleFinalizationSourceTests();
assert.equal(finalizationReceipt.status,'PASS');
assert.equal(finalizationReceipt.checks,20);
for(const field of ['new_sql_executed','provider_dispatch','native_qualified','phone'])assert.equal(finalizationReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-server-finalization-source-called',...finalizationReceipt}));

import {runNativeProviderInventoryPayloadTests} from './native-provider-inventory-payload-tests.mjs';
const inventoryReceipt=runNativeProviderInventoryPayloadTests();
assert.equal(inventoryReceipt.status,'PASS');
assert.equal(inventoryReceipt.checks,190);
for(const field of ['SQL_executed','production','native_qualified','provider_dispatch','phone'])assert.equal(inventoryReceipt[field],false);
console.log(JSON.stringify({suite:'native-provider-typed-inventory-called',...inventoryReceipt}));
await import('./native-provider-inventory-http-tests.mjs');

import {runNativeScheduleEventOriginalsTests} from './native-schedule-event-originals-tests.mjs';
const originalEventReceipt=await runNativeScheduleEventOriginalsTests();
assert.equal(originalEventReceipt.status,'PASS');
assert.equal(originalEventReceipt.checks,62);
for(const field of ['new_SQL','native_qualified','provider_dispatch','phone'])assert.equal(originalEventReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-authoritative-event-original-called',...originalEventReceipt}));
await import('./native-schedule-observation-http-tests.mjs');

import {runNativeScheduleJobPreparationTests} from './native-schedule-job-preparation-tests.mjs';
const jobPreparationReceipt=await runNativeScheduleJobPreparationTests();
assert.equal(jobPreparationReceipt.status,'PASS');
assert.equal(jobPreparationReceipt.checks,58);
assert.equal(jobPreparationReceipt.worker_body_executed,true);
for(const field of ['actual_SQL','provider_dispatch','native_qualified','phone'])assert.equal(jobPreparationReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-source-job-called',...jobPreparationReceipt}));

import {runNativeScheduleAttemptLifecycleTests} from './native-schedule-attempt-lifecycle-tests.mjs';
const attemptReceipt=await runNativeScheduleAttemptLifecycleTests();
assert.equal(attemptReceipt.status,'PASS');
assert.equal(attemptReceipt.checks,83);
for(const field of ['actual_SQL','provider_dispatch','native_qualified','phone'])assert.equal(attemptReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-single-attempt-outcome-called',...attemptReceipt}));

import {runNativeScheduleDispatchTests} from './native-schedule-dispatch-tests.mjs';
const scheduleSenderReceipt=await runNativeScheduleDispatchTests();
assert.equal(scheduleSenderReceipt.status,'PASS');
assert.equal(scheduleSenderReceipt.checks,106);
assert.equal(scheduleSenderReceipt.actual_transport_body,true);
assert.equal(scheduleSenderReceipt.synthetic_fetch,true);
for(const field of ['actual_SQL','provider_delivery','native_qualified','phone'])assert.equal(scheduleSenderReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-private-sender-called',...scheduleSenderReceipt}));

import {runNativeScheduleSourceDiscoveryTests} from './native-schedule-source-discovery-tests.mjs';
const discoveryReceipt=await runNativeScheduleSourceDiscoveryTests();
assert.equal(discoveryReceipt.status,'PASS');
assert.equal(discoveryReceipt.checks,57);
for(const field of ['SQL_executed','provider_dispatch','normal_worker_activated','phone'])assert.equal(discoveryReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-source-discovery-called',...discoveryReceipt}));

import {runNativeScheduleSourceOrchestrationTests} from './native-schedule-source-orchestration-tests.mjs';
const orchestrationReceipt=await runNativeScheduleSourceOrchestrationTests();
assert.equal(orchestrationReceipt.status,'PASS');
assert.equal(orchestrationReceipt.checks,86);
assert.equal(orchestrationReceipt.actual_helpers_executed,true);
for(const field of ['actual_SQL','provider_dispatch','normal_worker_activated','phone'])assert.equal(orchestrationReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-source-orchestration-called',...orchestrationReceipt}));

import {runNativeScheduleSourceProducerTests} from './native-schedule-source-producer-tests.mjs';
const producerReceipt=await runNativeScheduleSourceProducerTests();
assert.equal(producerReceipt.status,'PASS');
assert.equal(producerReceipt.checks,62);
assert.equal(producerReceipt.actual_worker_sweep,true);
for(const field of ['actual_SQL','provider_dispatch','phone'])assert.equal(producerReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-source-producer-called',...producerReceipt}));
await import('./native-schedule-source-producer-sdk-tests.mjs');

import {runNativeScheduleSenderFactoryTests} from './native-schedule-sender-factory-tests.mjs';
const factoryReceipt=await runNativeScheduleSenderFactoryTests();
assert.equal(factoryReceipt.status,'PASS');
assert.equal(factoryReceipt.checks,44);
assert.equal(factoryReceipt.actual_runtime_factory,true);
assert.equal(factoryReceipt.actual_strict_sender,true);
assert.equal(factoryReceipt.synthetic_OAuth_and_fetch,true);
for(const field of ['SQL_executed','real_key_access','provider_dispatch','native_qualified','phone'])assert.equal(factoryReceipt[field],false);
console.log(JSON.stringify({suite:'native-schedule-private-factory-called',...factoryReceipt}));
