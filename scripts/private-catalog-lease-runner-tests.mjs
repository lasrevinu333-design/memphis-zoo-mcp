import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {removePrivateCatalogLeaseRunner} from './private-catalog-lease-runner-source.mjs';
const source=readFileSync(new URL('./run-private-backup-only-rehearsal.mjs',import.meta.url),'utf8');
test('catalog lease runner delta has a fixed complete predecessor inverse and refuses edits',()=>{
 const prior=removePrivateCatalogLeaseRunner(source);
 assert.equal(createHash('sha256').update(prior).digest('hex'),'05902eaa885fa652590ac056658715691ed13df2265fcd10aee51bed0b69f586');
 assert.equal(removePrivateCatalogLeaseRunner(prior),prior);
 assert.throws(()=>removePrivateCatalogLeaseRunner(source+'\n'));
});
test('only the current original-owner path nests catalog lease inside vendor lease and requires both retirements',()=>{
 const start=source.indexOf("if(requireOwnerProfile().id==='immutable-private-current-postgres'){",source.indexOf('const restoreOriginal='));
 const end=source.indexOf('}else result=await restoreOriginal();',start),block=source.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.ok(block.includes('const restoreWithCatalogLease=async()=>{'));
 assert.match(block,/withIsolatedCurrentCatalogPrivileges\([^\n]+,restoreOriginal\)/);
 assert.match(block,/withIsolatedCurrentVendorPrivileges\([^\n]+,restoreWithCatalogLease\)/);
 assert.ok(block.includes('assert.equal(catalogPrivileges.retirement_verified,true)'));
 assert.ok(block.includes('assert.equal(vendorPrivileges.retirement_verified,true)'));
 assert.ok(block.indexOf('projectIsolatedCatalogPrivilegeStatus')<block.indexOf('withIsolatedCurrentVendorPrivileges'));
 assert.ok(source.includes('vendor_privileges:vendorPrivileges,catalog_privileges:catalogPrivileges'));
 assert.ok(source.includes('const privateRestoreWorkTimeoutMs=1900000;'));
});
