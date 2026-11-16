// Fixed comparison DATA selected only after the caller authenticates its Source
// profile. No observed body, caller SQL or permission is accepted as an oracle.
import assert from 'node:assert/strict';
import {types} from 'node:util';
const profiles=Object.freeze({
 'immutable-private-legacy-supabase-admin':Object.freeze({actor:'supabase_admin',
  projection:'814c1bfe130b62bbd6ffbd278b6b7b1b23546d4942a2dccbec29083d1a65c3b8',
  record:'030a130aa642d5517aa4acc154de267c16034d94a6ead01b299f7653fdff1fcb'}),
 'immutable-private-current-postgres':Object.freeze({actor:'postgres',
  projection:'3b33effac412985b3f137d458960ae382387659f4f87ed9372335dde6589596b',
  record:'4833f9a0e02e3dd180221ef09f7240dd4511c5d406456e78401e538e377c2363'}),
});
export function immutableTextCodecSourceHashes(profile){
 assert.ok(profile&&typeof profile==='object'&&!types.isProxy(profile));
 assert.deepEqual(Reflect.ownKeys(profile).sort(),['actor','id']);
 const field=key=>{const d=Object.getOwnPropertyDescriptor(profile,key);assert.ok(d&&Object.hasOwn(d,'value'));return d.value;};
 const id=field('id');assert.equal(typeof id,'string');assert.ok(Object.hasOwn(profiles,id));
 const expected=profiles[id];assert.equal(field('actor'),expected.actor);
 return expected;
}
