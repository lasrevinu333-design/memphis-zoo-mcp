#!/usr/bin/env node
// Verify GHSA-jqcg-44mw-7w3h's trust-boundary fix without external traffic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const proxyaddr = require('proxy-addr');
const installed = require('proxy-addr/package.json');
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
assert.equal(installed.version, '2.0.8');
assert.equal(lock.packages['node_modules/proxy-addr'].version, installed.version);
const tests = [];
function check(name, actual, expected) { assert.equal(actual, expected, name); tests.push(name); }
const ipv4 = proxyaddr.compile('10.0.0.0/8');
const mapped = proxyaddr.compile('::ffff:10.0.0.0/104');
const shortMapped = proxyaddr.compile('::ffff:10.0.0.0/8');
const wideV6 = proxyaddr.compile('::/1');
check('IPv4 trusted subnet remains usable', ipv4('10.1.2.3'), true);
check('IPv4 subnet excludes outside peer', ipv4('198.51.100.10'), false);
check('Correct mapped prefix admits its IPv4 subnet', mapped('10.1.2.3'), true);
check('Correct mapped prefix excludes outside peer', mapped('198.51.100.10'), false);
check('Short mapped prefix cannot trust arbitrary IPv4', shortMapped('198.51.100.10'), false);
check('Broad IPv6 prefix does not encompass IPv4', wideV6('198.51.100.10'), false);
const request = { socket: { remoteAddress: '198.51.100.10' }, headers: { 'x-forwarded-for': '10.1.2.3' } };
check('Untrusted peer cannot spoof the forwarded client address', proxyaddr(request, shortMapped), '198.51.100.10');
console.log(JSON.stringify({ result: 'PROXY_ADDRESS_REGRESSION_PASS', version: installed.version,
  cases: tests.length, tests, external_requests: 0 }));
