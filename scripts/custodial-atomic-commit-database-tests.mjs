#!/usr/bin/env node

// The former atomic test exercised the now-retired direct SQL writer.  Keep
// this public regression entry point, but run the stronger final-authority
// attack matrix so a legacy package command cannot silently test a bypass.
await import("./offline-actor-recovery-database-tests.mjs");
console.log("CUSTODIAL_ATOMIC_COMMIT_DATABASE_PASS");
