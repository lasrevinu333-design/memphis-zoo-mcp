import assert from 'node:assert/strict';
import {recipientDirectory,messengerDisplayName} from '../src/messenger-recipient-directory.js';
const id=n=>`c1010000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rows=[{id:id(1),display_name:'Annie Feist',role:'manager'},{id:id(2),display_name:'Annie (shared PIN)',role:'manager'},
 {id:id(3),display_name:'Annie Feist',role:'employee'},{id:id(4),display_name:'Eric Operle',role:'manager'},{id:id(5),display_name:'Eric Operle (shared PIN)',role:'manager'}];
const links=[{id:id(1),ops_manager_id:id(11)},{id:id(2),custodial_cohort_manager_id:id(20),custodial_claimed_account_id:id(11)},
 {id:id(3)},{id:id(4),ops_manager_id:id(12)},{id:id(5),custodial_cohort_manager_id:id(20),custodial_claimed_account_id:id(12)}];
const before=JSON.stringify({rows,links}),result=recipientDirectory(rows,links,id(5));
assert.deepEqual(result.map(row=>row.id),[id(2),id(3)]);
assert.equal(result[0].display_name,'Annie Feist');assert.equal(result[1].display_name,'Annie Feist','same-name employee is not merged');
assert.equal(JSON.stringify({rows,links}),before,'no account/history mutation');
assert.deepEqual(recipientDirectory([rows[0]],links,id(99)).map(row=>row.id),[id(1)],'legacy remains if no eligible cohort row');
assert.equal(recipientDirectory(rows,[],id(99)).length,5,'no guessed identity links');
const ambiguous=[...rows,{id:id(6),display_name:'Annie (shared PIN)',role:'manager'}];
assert.equal(recipientDirectory(ambiguous,[...links,{id:id(6),custodial_cohort_manager_id:id(21),custodial_claimed_account_id:id(11)}],id(5)).length,4,'multiple eligible cohort inboxes are not guessed');
assert.equal(messengerDisplayName('Jennifer (shared PIN)'),'Jennifer');
assert.equal(messengerDisplayName('Genuine (other suffix)'),'Genuine (other suffix)');
console.log('PASS exact-manager recipient projection; no account merge, message mutation, or name-only identity matching');
