// Explicit source/loopback suite, no database replay, provider or release action.
// Keep standalone database runners separate: their fixtures are not optional.
await import('./events-chicago-time-tests.mjs');
await import('./messaging-durability-contract-tests.mjs');
await import('./place-lifecycle-source-tests.mjs');
await import('./places-api-http-tests.mjs');
await import('./place-operational-adapter-tests.mjs');
await import('./native-provider-api-tests.mjs');
await import('./native-provider-json-tests.mjs');
await import('./native-provider-events-tests.mjs');
await import('./native-location-lifecycle-tests.mjs');
console.log('CURRENT_SYSTEM_SOURCE_CONTRACTS_PASS: 9 explicit owning suites; no database/provider/production/phone proof');
