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
const dependencyProfiles=new Map([
 ['immutable-original-authority-reconciliation.sql',{sha256:'b9fe5f2338634f3adeac7726d17d6aa44fca1ed8cb04927cf9c23777f1c10b18',pairs:[
  ['030a130aa642d5517aa4acc154de267c16034d94a6ead01b299f7653fdff1fcb','4833f9a0e02e3dd180221ef09f7240dd4511c5d406456e78401e538e377c2363'],
  ['814c1bfe130b62bbd6ffbd278b6b7b1b23546d4942a2dccbec29083d1a65c3b8','3b33effac412985b3f137d458960ae382387659f4f87ed9372335dde6589596b'],
 ]}],
 ['immutable-original-manager-push-restore.sql',{sha256:'5181d13fae8cac9e7c4093be78dc1e02142ebf7588893804c7f2ba60afe020bf',pairs:[
  ['884485499c6f2c893407e809f5a32200c5b4abe48c8eca944130babdff9d5b15','e89263e58487fc1dcbc08c31f5428130bc05cce726cd15ae162f03a3bc6aae36'],
 ]}],
]);
export const currentDataSchemaDependencyStatements=Object.freeze([...dependencyProfiles.keys()]);
export function rebindCurrentDataSchemaDependencies(name,sql){
 const profile=dependencyProfiles.get(name);assert.ok(profile,'Unknown current dependency Source refused');
 assert.equal(sha(sql),profile.sha256,'Whole exact scope-adjusted predecessor required');
 const before=sql;
 for(const [old,next] of profile.pairs){assert.equal(sql.split(old).length,2);assert.ok(!sql.includes(next));sql=sql.replace(old,next);}
 let inverse=sql;for(const [old,next] of profile.pairs)inverse=inverse.replace(next,old);
 assert.equal(inverse,before);return sql;
}
