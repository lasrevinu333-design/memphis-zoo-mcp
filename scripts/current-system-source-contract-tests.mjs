// Explicit source/loopback suite, no database replay, provider or release action.
// Keep standalone database runners separate: their fixtures are not optional.
await import('./events-chicago-time-tests.mjs');
await import('./messaging-durability-contract-tests.mjs');
await import('./messaging-delete-receipt-contract-tests.mjs');
await import('./place-lifecycle-source-tests.mjs');
await import('./places-api-http-tests.mjs');
await import('./place-operational-adapter-tests.mjs');
await import('./native-provider-api-tests.mjs');
await import('./native-provider-json-tests.mjs');
await import('./native-provider-events-tests.mjs');
await import('./native-location-lifecycle-tests.mjs');
await import('./native-location-dispatch-contract-tests.mjs');
await import('./native-lunch-contract-tests.mjs');
await import('./completion-taxonomy-contract-tests.mjs');
await import('./oc24-coverall-print-tests.mjs');
await import('./memphis-direct-contact-privacy-tests.mjs');
await import('./memphis-provenance-boundary-tests.mjs');
await import('./native-target-source-contract-tests.mjs');
await import('./coverall-advisory-order-tests.mjs');
await import('./coverall-event-brief-tests.mjs');
await import('./coverall-event-print-integration-tests.mjs');
await import('./nonemployee-coverall-source-transition-tests.mjs');
await import('./nonemployee-coverall-source-bridge-tests.mjs');
await import('./schedule-component-weight-authority-tests.mjs');
console.log('CURRENT_SYSTEM_SOURCE_CONTRACTS_PASS: 23 explicit owning suites; no database/provider/production/phone proof');
