#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

assert.match(
  source,
  /already has\|already bound\|does not belong\|manager recovery\|required review\|transition[\s\S]{0,120}\?\s*409/,
  'session/device/location ownership conflicts must return HTTP 409 so clients do not retry them as transient server failures',
);

console.log('scan RPC error classification tests passed');
