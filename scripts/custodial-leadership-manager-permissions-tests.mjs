import assert from 'node:assert/strict';
import {hasManagerPermission,isCustodialLeadershipManagementSession,projectManagerSession} from '../src/auth/manager-permissions.js';
const session={role:'ops_manager',manager_id:'36e19682-7747-45b0-93d9-584e2d638b28',credential_id:'fa4ec65a-7dbe-4fa0-b07f-0fca49df0a1a',
 device_id:'fixture-browser',auth_mode:'custodial_leadership_pin',actor_kind:'CUSTODIAL_LEADERSHIP_COHORT',read_only:false,owner:false,
 custodial_management_admin:true,permissions:{schema:'custodial.manager-permissions.v1',read:true,owner:false,custodialManagementAdmin:true,policyVersion:1}};
let checks=0;
for(const action of ['read','write','manage_absences','manage_coverall','regenerate_routes','close_scan_tickets']){assert.equal(hasManagerPermission(session,action),true);checks++;}
for(const action of ['cloud_admin','github_credentials','supabase_credentials','render_credentials','unknown']){assert.equal(hasManagerPermission(session,action),false);checks++;}
for(const patch of [{auth_mode:'trusted_device'},{actor_kind:'NAMED_MANAGER'},{owner:true},{read_only:true},{custodial_management_admin:false},{credential_id:''},{manager_id:''},
 {permissions:{...session.permissions,owner:true}},{permissions:{...session.permissions,custodialManagementAdmin:false}},{permissions:{...session.permissions,policyVersion:0}}]){
 const other={...session,...patch};assert.equal(isCustodialLeadershipManagementSession(other),false);checks++;
}
// A self-asserted name cannot supply authority to an ordinary delegate.
const delegate=projectManagerSession({access_level:'full_access'},{manager_id:session.manager_id,display_name:'Fixture delegate',active:true,
 revoked_at:null,is_system_principal:false,system_key:'fixture_delegate',roles:['OPS_MANAGER']},{credentialBound:true});
for(const claimedName of ['Eric Operle','Jennifer','Annie']){
 assert.equal(hasManagerPermission({...delegate,self_asserted_name:claimedName},'write'),false);checks++;
}
assert.equal(session.owner,false);assert.equal(session.permissions.owner,false);
console.log(JSON.stringify({scope:'PURE_PERMISSION_PROJECTION_ONLY',checks,sqlExecuted:false,authenticationProven:false,productionActivated:false}));
