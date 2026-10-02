import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const uri = require('fast-uri');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
let checks = 0;
function check(value, expected) { assert.deepEqual(value, expected); checks++; }
// GHSA-hrr3-gc8f-f4qj: exercise the actual installed dependency, not lock text.
check(require('fast-uri/package.json').version, '3.1.8');
for (const address of ['//%41.com', '//A.com', '//a.com']) {
  check(uri.parse(address).host, 'a.com');
  check(uri.equal(address, '//a.com'), true);
}
check(uri.equal('//a.com', '//b.com'), false);
check(uri.parse('https://example.invalid:443/path?x=1').host, 'example.invalid');
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'https://example.invalid/schemas/identity', type: 'object',
  required: ['operationId'], additionalProperties: false,
  properties: { operationId: { type: 'string', format: 'uuid' } } });
const validate = ajv.compile({ $ref: 'https://example.invalid/schemas/identity' });
check(validate({ operationId: '11111111-1111-4111-8111-111111111111' }), true);
check(validate({ operationId: 'not-an-id' }), false);
check(validate({ operationId: '11111111-1111-4111-8111-111111111111', extra: true }), false);
const { Address4, Address6 } = require('ip-address');
check(require('ip-address/package.json').version, '10.7.1');
check(new Address6('a00::1').isInSubnet(new Address4('10.0.0.0/8')), false);
check(new Address4('32.0.0.1').isInSubnet(new Address6('2000::/3')), false);
check(new Address4('10.0.0.1').isInSubnet(new Address4('10.0.0.0/8')), true);
check(new Address6('fe90::1').isLinkLocal(), true);
check(new Address6('2001:db8::1').isLinkLocal(), false);
console.log(`PASS dependency URI/IP regression: ${checks} checks; local synthetic schema and addresses only`);
