// Current postgres-only restore program successor. Historical SQL remains exact.
// These schemas are already selected/authenticated by the signed backup reader.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {productionBackupAllowedDataSchemas} from './production-backup-pg-dump-command.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const baseFull="('public','auth','storage','custodial_release_identity')";
const baseOrdinary="('public','auth','storage')";
const full="('public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private')";
const ordinary="('public','auth','storage','custodial_employment','custodial_coverall','custodial_leadership_private')";
const profiles=new Map([
 ['immutable-private-owner-context.sql',{sha256:'7e2d9d985670cf908800211e38bc9346c3e3df2a17dc9669ba3915c61ac02ef8',full:5,ordinary:4}],
 ['immutable-original-authority-reconciliation.sql',{sha256:'e60545804e8c76d94769c6b80426e3dcb86f0bdf47527cd42b5735eb7eff600a',full:3,ordinary:0}],
 ['immutable-original-authority-target-shape.sql',{sha256:'265185d8860131d5472db2a70f036332758b4b2f577b48582980f36ff7eacc3e',full:1,ordinary:0}],
]);
export const currentDataSchemaScopeStatements=Object.freeze([...profiles.keys()]);
export function extendCurrentPostgresDataSchemaScope(name,sql){
 assert.equal(typeof name,'string');assert.equal(typeof sql,'string');
 const profile=profiles.get(name);assert.ok(profile,'Unknown current data-schema Source refused');
 assert.deepEqual(productionBackupAllowedDataSchemas,['public','auth','storage','custodial_release_identity','custodial_employment','custodial_coverall','custodial_leadership_private']);
 assert.equal(sha(sql),profile.sha256,'Whole exact current predecessor SQL required');
 assert.equal(sql.split(baseFull).length-1,profile.full);assert.equal(sql.split(baseOrdinary).length-1,profile.ordinary);
 const next=sql.replaceAll(baseFull,full).replaceAll(baseOrdinary,ordinary);
 assert.equal(next.replaceAll(full,baseFull).replaceAll(ordinary,baseOrdinary),sql,'Every non-scope byte must remain exact');
 return next;
}
