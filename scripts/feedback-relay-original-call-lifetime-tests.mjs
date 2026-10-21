import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerFeedbackRelayTools} from '../src/mcp/feedback-relay-tools.js';
import {configureMcpToolAuth} from '../src/mcp/register.js';
import {callFeedbackRelay,feedbackRelayPrincipal,FEEDBACK_RELAY_CONTRACT,FEEDBACK_RELAY_SCHEMA_SHA256} from '../src/feedback-email-relay.js';

// Actual product + actual Supabase client; all responses/identity are synthetic.
// No provider, live authorization, mail, SQL, or network assertion is made.
const id=n=>'86000000-0000-4000-8000-'+String(n).padStart(12,'0'),clone=value=>JSON.parse(JSON.stringify(value));
const connector={authInfo:{clientId:'memphis-mcp-connector-token',extra:{authSource:'connector_token'}}};
const oauth={authInfo:{clientId:'synthetic-client',scopes:['mcp:read','mcp:write'],
  extra:{authSource:'self_contained_oauth',issuer:'synthetic-issuer',subject:'synthetic-subject'}}};
const begin={contract_version:FEEDBACK_RELAY_CONTRACT,request_id:id(1),intent_id:id(2),
  claim_token:id(3),claim_generation:1,envelope_sha256:'a'.repeat(64)};
const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const pngHash=createHash('sha256').update(png).digest('hex');
const attached={status:'ready',ticket:id(4),operation_id:id(5),image:{type:'image/png',size:png.length,
  storage_bucket:'system-feedback-private',storage_path:'feedback/'+id(5)+'/'+pngHash+'.png',sha256:pngHash}};
function fixture({prepare={status:'no_attachment'},afterRpc=()=>{},afterStorage=()=>{},badAttachment=false}={}){
  const calls=[];
  const client=createClient('https://feedback-lifetime.invalid','synthetic-fixture-role',{
    auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options={})=>{
      const target=new URL(url);assert.equal(target.origin,'https://feedback-lifetime.invalid');
      if(target.pathname.startsWith('/rest/v1/rpc/')){
        const name=target.pathname.slice('/rest/v1/rpc/'.length),body=JSON.parse(options.body);
        assert.equal(options.method,'POST');
        assert.match(name,/^custodial_feedback_relay_(attachment_internal|status|claim|begin|receipt|defer|control)$/);
        calls.push({kind:'rpc',name,body});
        let data={ok:true,verb:name.slice('custodial_feedback_relay_'.length)};
        if(name.endsWith('_attachment_internal')){
          assert(['prepare','reject','complete'].includes(body.p_action));
          data=body.p_action==='prepare'?clone(prepare):body.p_action==='complete'?{status:'verified'}:{status:'needs_attention'};
        }else if(name.endsWith('_begin'))data={ok:true,may_send:true,attempt_id:id(6),
          attempt_generation:1,provider_generation:1,envelope_sha256:body.p_args.envelope_sha256};
        await afterRpc(name,body,data);
        return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
      }
      assert.equal(target.pathname,'/storage/v1/object/system-feedback-private/'+attached.image.storage_path);
      assert.equal(options.method??'GET','GET');calls.push({kind:'storage',path:target.pathname});
      await afterStorage();
      return new Response(badAttachment?Buffer.alloc(png.length):png,{status:200,headers:{'content-type':'image/png'}});
    }}});
  return{client,calls};
}
const names=f=>f.calls.map(call=>call.kind==='storage'?'storage':call.name.endsWith('_attachment_internal')?call.body.p_action:call.name.slice('custodial_feedback_relay_'.length));

test('NEW original feedback lifetime cancellation after prepare cannot dispatch begin or return may_send',async()=>{
  const controller=new AbortController(),extra={...clone(oauth),signal:controller.signal};
  const f=fixture({afterRpc:name=>{if(name.endsWith('_attachment_internal'))controller.abort();}});
  await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/authorization|cancel|unconfirmed/i);
  assert.deepEqual(names(f),['prepare']);
  assert.equal(f.calls[0].body.p_args.intent_id,begin.intent_id);
});

for(const [kind,template] of [['connector',connector],['OAuth',oauth]]){
  test(`NEW original feedback lifetime unchanged ${kind} keeps principal and no-attachment begin`,async()=>{
    const extra=clone(template);extra.authInfo.expiresAt=Math.floor(Date.now()/1000)+60;
    Object.defineProperty(extra.authInfo,'token',{get(){throw Error('Secret access is forbidden');}});
    const f=fixture(),r=await callFeedbackRelay('begin',clone(begin),extra,{client:f.client});
    assert.equal(r.may_send,true);assert.deepEqual(names(f),['prepare','begin']);
    const identity=kind==='connector'?['connector_token','memphis-mcp-connector-token']:
      ['self_contained_oauth','synthetic-issuer','synthetic-subject','synthetic-client'];
    const expected='relay:'+createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    assert.equal(feedbackRelayPrincipal(extra),expected);
    for(const call of f.calls)assert.equal(call.body.p_principal,expected);
    assert.equal(f.calls[1].body.p_args.request_id,begin.request_id);
    assert.equal(f.calls[1].body.p_args.claim_token,begin.claim_token);
    assert.equal(f.calls[1].body.p_args.claim_generation,begin.claim_generation);
    assert.equal(f.calls[1].body.p_args.envelope_sha256,begin.envelope_sha256);
  });
}
test('NEW original feedback lifetime already-cancelled and initially invalid calls dispatch nothing',async()=>{
  const cancelled=fixture();
  await assert.rejects(callFeedbackRelay('begin',clone(begin),{...clone(oauth),signal:AbortSignal.abort()},{client:cancelled.client}),/unconfirmed/i);
  assert.deepEqual(names(cancelled),[]);
  const invalid=fixture();
  await assert.rejects(callFeedbackRelay('begin',clone(begin),{},{client:invalid.client}),/authorization/i);
  assert.deepEqual(names(invalid),[]);
});
for(const [label,withdraw] of [
  ['authInfo replacement',extra=>{extra.authInfo=clone(extra.authInfo);}],
  ['context replacement',extra=>{extra.authInfo.extra=clone(extra.authInfo.extra);}],
  ['source change',extra=>{extra.authInfo.extra.authSource='connector_token';}],
  ['client change',extra=>{extra.authInfo.clientId='different-valid-client';}],
  ['issuer change',extra=>{extra.authInfo.extra.issuer='different-valid-issuer';}],
  ['subject change',extra=>{extra.authInfo.extra.subject='different-valid-subject';}],
  ['scope reference replacement',extra=>{extra.authInfo.scopes=[...extra.authInfo.scopes];}],
  ['scope value change',extra=>{extra.authInfo.scopes.push('different-scope');}],
  ['scope withdrawal',extra=>{extra.authInfo.scopes.pop();}],
  ['expiry renewal',extra=>{extra.authInfo.expiresAt+=60;}],
  ['signal replacement',extra=>{extra.signal=new AbortController().signal;}]
]){
  test(`NEW original feedback lifetime ${label} after prepare cannot adopt new ownership`,async()=>{
    const extra={...clone(oauth),signal:new AbortController().signal};extra.authInfo.expiresAt=Math.floor(Date.now()/1000)+60;
    const f=fixture({afterRpc:()=>withdraw(extra)});
    await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),['prepare']);
  });
}
for(const stage of ['prepare','begin']){
  test(`NEW original feedback lifetime expiry after ${stage} leaves original unconfirmed without resend`,async t=>{
    let now=Date.now();t.mock.method(Date,'now',()=>now);
    const extra=clone(oauth);extra.authInfo.expiresAt=Math.floor(now/1000)+30;
    const f=fixture({afterRpc:(name,body)=>{if((stage==='prepare'&&body.p_action==='prepare')||(stage==='begin'&&name.endsWith('_begin')))now+=31000;}});
    await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),stage==='prepare'?['prepare']:['prepare','begin']);
  });
}
test('NEW original feedback lifetime signal added to absent-signal original is not adopted',async()=>{
  const extra=clone(connector),f=fixture({afterRpc:()=>{extra.signal=new AbortController().signal;}});
  await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
  assert.deepEqual(names(f),['prepare']);
});
test('NEW original feedback lifetime cancellation after final begin never returns may_send or resends',async()=>{
  const controller=new AbortController(),extra={...clone(connector),signal:controller.signal};
  const f=fixture({afterRpc:name=>{if(name.endsWith('_begin'))controller.abort();}});
  await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
  assert.deepEqual(names(f),['prepare','begin']);
  assert.equal(f.calls[1].body.p_args.request_id,begin.request_id);
});
test('NEW original feedback lifetime equivalent owner replacement after final begin is still unconfirmed',async()=>{
  const extra=clone(oauth),f=fixture({afterRpc:name=>{if(name.endsWith('_begin'))extra.authInfo=clone(extra.authInfo);}});
  await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
  assert.deepEqual(names(f),['prepare','begin']);
});
test('NEW original feedback lifetime unchanged attachment verifies actual bytes then completes once',async()=>{
  const f=fixture({prepare:attached});
  const r=await callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client});
  assert.equal(r.may_send,true);assert.deepEqual(names(f),['prepare','storage','complete','begin']);
  assert.deepEqual(f.calls[2].body.p_args.observed,{sha256:pngHash,size:png.length,type:'image/png'});
  assert.equal(f.calls[2].body.p_args.ticket,attached.ticket);
});
for(const stage of ['ready-prepare','verification-success','verification-failure','reject-response','complete-response']){
  test(`NEW original feedback lifetime attachment ${stage} cancellation cannot advance any disposition or send`,async()=>{
    const controller=new AbortController(),extra={...clone(oauth),signal:controller.signal};
    const f=fixture({prepare:attached,badAttachment:['verification-failure','reject-response'].includes(stage),
      afterStorage:()=>{if(stage==='verification-success'||stage==='verification-failure')controller.abort();},
      afterRpc:(name,body)=>{
        if(name.endsWith('_attachment_internal')&&((stage==='ready-prepare'&&body.p_action==='prepare')
          ||(stage==='reject-response'&&body.p_action==='reject')||(stage==='complete-response'&&body.p_action==='complete')))controller.abort();
      }});
    await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),stage==='ready-prepare'?['prepare']:
      stage==='reject-response'?['prepare','storage','reject']:stage==='complete-response'?['prepare','storage','complete']:['prepare','storage']);
  });
}
test('NEW original feedback lifetime verification transport failure plus cancellation cannot invoke reject',async()=>{
  const controller=new AbortController(),extra={...clone(oauth),signal:controller.signal};
  const f=fixture({prepare:attached,afterStorage:()=>{controller.abort();throw Error('Synthetic unavailable original storage');}});
  await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
  assert.deepEqual(names(f),['prepare','storage']);
});
test('NEW original feedback lifetime equivalent context replacement during failed verification cannot reject',async()=>{
  const extra=clone(oauth),f=fixture({prepare:attached,badAttachment:true,
    afterStorage:()=>{extra.authInfo.extra=clone(extra.authInfo.extra);}});
  await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
  assert.deepEqual(names(f),['prepare','storage']);
});

test('NEW registered feedback relay original cancellation reaches the normal guarded tool handler',async()=>{
  for(const mode of ['current','cancelled-prepare','cancelled-begin','wrong-envelope','denied']){
    const controller=new AbortController(),extra={...clone(oauth),signal:controller.signal};
    if(mode==='denied')extra.authInfo.scopes=['mcp:read'];
    const f=fixture({afterRpc:(name,body,data)=>{
      if(mode==='cancelled-prepare'&&body.p_action==='prepare')controller.abort();
      if(mode==='cancelled-begin'&&name.endsWith('_begin'))controller.abort();
      if(mode==='wrong-envelope'&&name.endsWith('_begin'))data.envelope_sha256='b'.repeat(64);
    }});
    const sdk=new McpServer({name:'synthetic-original-feedback-owner',version:'1'});
    const register=sdk.registerTool.bind(sdk),handlers=new Map();
    sdk.registerTool=(name,definition,handler)=>{
      handlers.set(name,handler);return register(name,definition,handler);
    };
    configureMcpToolAuth(sdk,{securitySchemes:[{type:'oauth2',scopes:['mcp:read','mcp:write']}],challenge:'Bearer realm="synthetic-original"'});
    try{
      registerFeedbackRelayTools(sdk,{client:f.client});assert.equal(handlers.size,6);
      const handler=handlers.get('custodial_feedback_relay_begin');
      if(mode==='current'){
        const response=await handler(clone(begin),extra),value=JSON.parse(response.content[0].text);
        assert.deepEqual(value,{ok:true,may_send:true,attempt_id:id(6),attempt_generation:1,
          provider_generation:1,envelope_sha256:begin.envelope_sha256});
        assert.deepEqual(names(f),['prepare','begin']);
      }else if(mode==='denied'){
        assert.equal((await handler(clone(begin),extra)).isError,true);assert.deepEqual(names(f),[]);
      }else{
        await assert.rejects(handler(clone(begin),extra),/unconfirmed/i);
        assert.deepEqual(names(f),mode==='cancelled-prepare'?['prepare']:['prepare','begin']);
      }
      for(const call of f.calls){assert.equal(call.body.p_args.intent_id,begin.intent_id);assert.equal(call.body.p_args.claim_token,begin.claim_token);}
    }finally{await sdk.close();}
  }
});
test('NEW original feedback lifetime unchanged corrupt attachment retains existing reject behavior',async()=>{
  const f=fixture({prepare:attached,badAttachment:true});
  const r=await callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client});
  assert.equal(r.may_send,false);assert.equal(r.needs_attention,true);
  assert.deepEqual(names(f),['prepare','storage','reject']);
  assert.equal(f.calls[2].body.p_args.disposition,'corrupt');
});
const argsFor=verb=>{
  const base={contract_version:FEEDBACK_RELAY_CONTRACT,request_id:begin.request_id};
  if(verb==='status')return{contract_version:FEEDBACK_RELAY_CONTRACT};
  if(verb==='claim')return base;
  if(verb==='defer')return{...base,intent_id:begin.intent_id,claim_token:begin.claim_token,claim_generation:1,reason:'auth_unavailable'};
  if(verb==='control')return{...base,action:'pause',reason:'Synthetic original status'};
  return{...base,intent_id:begin.intent_id,attempt_id:id(6),envelope_sha256:begin.envelope_sha256,
    observation:{kind:'outcome_unknown',provider_account:'eoperle@memphiszoo.org',to:['eoperle@memphiszoo.org'],cc:[],bcc:[],
      subject:'Synthetic feedback',operation_id:id(5),feedback_id:id(7),request_fingerprint:'b'.repeat(64)}};
};
for(const verb of ['status','claim','receipt','defer','control']){
  test(`NEW original feedback lifetime ${verb} cancellation after original RPC cannot return success`,async()=>{
    const controller=new AbortController(),extra={...clone(oauth),signal:controller.signal},args=argsFor(verb);
    const f=fixture({afterRpc:()=>controller.abort()});
    await assert.rejects(callFeedbackRelay(verb,args,extra,{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),[verb]);assert.deepEqual(f.calls[0].body.p_args,{...args,adapter_schema_sha256:FEEDBACK_RELAY_SCHEMA_SHA256});
  });
}
test('NEW original feedback lifetime unchanged private status stays one RPC and absent-signal compatible',async()=>{
  const f=fixture(),r=await callFeedbackRelay('status',argsFor('status'),clone(connector),{client:f.client});
  assert.equal(r.ok,true);assert.deepEqual(names(f),['status']);
});

test('NEW feedback send permit wrong original envelope is unconfirmed without a new request',async()=>{
  const f=fixture({afterRpc:(name,body,data)=>{if(name.endsWith('_begin'))data.envelope_sha256='b'.repeat(64);}});
  await assert.rejects(callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client}),/unconfirmed/i);
  assert.deepEqual(names(f),['prepare','begin']);
  assert.deepEqual(f.calls[1].body.p_args,{...begin,adapter_schema_sha256:FEEDBACK_RELAY_SCHEMA_SHA256});
});
for(const [kind,template] of [['connector',connector],['OAuth',oauth]]){
  test(`NEW feedback send permit exact normal SQL ${kind} response preserves only original permission data`,async()=>{
    const extra=clone(template),args={...begin,claim_generation:7};
    Object.defineProperty(extra.authInfo,'token',{get(){throw Error('Secret access is forbidden');}});
    const f=fixture(),result=await callFeedbackRelay('begin',args,extra,{client:f.client});
    assert.deepEqual(result,{ok:true,may_send:true,attempt_id:id(6),attempt_generation:1,provider_generation:1,envelope_sha256:begin.envelope_sha256});
    assert.equal(Object.hasOwn(result,'request_id'),false);assert.equal(Object.hasOwn(result,'intent_id'),false);
    assert.deepEqual(names(f),['prepare','begin']);
    assert.deepEqual(f.calls[1].body,{p_principal:feedbackRelayPrincipal(extra),p_args:{...args,adapter_schema_sha256:FEEDBACK_RELAY_SCHEMA_SHA256}});
  });
}
test('NEW feedback send permit missing or malformed envelope cannot authorize a send',async()=>{
  for(const value of [undefined,null,'','a'.repeat(63),'a'.repeat(65),'A'.repeat(64),'g'.repeat(64),true,123]){
    const f=fixture({afterRpc:(name,body,data)=>{if(name.endsWith('_begin')){if(value===undefined)delete data.envelope_sha256;else data.envelope_sha256=value;}}});
    await assert.rejects(callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),['prepare','begin']);
  }
});
test('NEW feedback send permit attempt must be a canonical SQL-issued UUID',async()=>{
  for(const value of [undefined,null,'',id(6)+'\n',id(6).replace('-',''),true,0,
    '00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff',
    'abcdef01-2345-1234-9abc-abcdef012345','ABCDEF01-2345-4234-8ABC-ABCDEF012345']){
    const f=fixture({afterRpc:(name,body,data)=>{if(name.endsWith('_begin')){if(value===undefined)delete data.attempt_id;else data.attempt_id=value;}}});
    await assert.rejects(callFeedbackRelay('begin',clone(begin),clone(connector),{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),['prepare','begin']);
  }
});
for(const field of ['attempt_generation','provider_generation']){
  test(`NEW feedback send permit ${field} must be the exact supported SQL integer`,async()=>{
    for(const value of [undefined,null,'1',true,0,-1,1.5,2,999999999]){
      const f=fixture({afterRpc:(name,body,data)=>{if(name.endsWith('_begin')){if(value===undefined)delete data[field];else data[field]=value;}}});
      await assert.rejects(callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client}),/unconfirmed/i);
      assert.deepEqual(names(f),['prepare','begin']);
    }
  });
}
test('NEW feedback send permit cannot contradict strict successful admission',async()=>{
  for(const value of [undefined,null,false,'true',1]){
    const f=fixture({afterRpc:(name,body,data)=>{if(name.endsWith('_begin')){if(value===undefined)delete data.ok;else data.ok=value;}}});
    await assert.rejects(callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),['prepare','begin']);
  }
});
test('NEW feedback send permit missing or nonboolean may_send never escapes as truthy permission',async()=>{
  for(const value of [undefined,null,'true','false',1,0,{},[]]){
    const f=fixture({afterRpc:(name,body,data)=>{if(name.endsWith('_begin')){if(value===undefined)delete data.may_send;else data.may_send=value;}}});
    await assert.rejects(callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),['prepare','begin']);
  }
});
test('NEW feedback send permit contradictory or foreign positive fields are not normal SQL permission',async()=>{
  for(const delta of [{replayed:true},{mode:'reconcile'},{paused:true},{request_id:begin.request_id},{intent_id:begin.intent_id},{foreign:'not-normal-SQL'}]){
    const f=fixture({afterRpc:(name,body,data)=>{if(name.endsWith('_begin'))Object.assign(data,delta);}});
    await assert.rejects(callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),['prepare','begin']);
  }
});
for(const verb of ['status','claim','receipt','defer','control']){
  test(`NEW feedback send permit true on ${verb} cannot authorize sending`,async()=>{
    const f=fixture({afterRpc:(name,body,data)=>{
      for(const key of Object.keys(data))delete data[key];
      Object.assign(data,{ok:true,may_send:true,attempt_id:id(6),attempt_generation:1,provider_generation:1,envelope_sha256:begin.envelope_sha256});
    }});
    await assert.rejects(callFeedbackRelay(verb,argsFor(verb),clone(oauth),{client:f.client}),/unconfirmed/i);
    assert.deepEqual(names(f),[verb]);
  });
}
test('NEW feedback send permit false replay and reconcile preserve the exact original nonpermission',async()=>{
  const cases=[
    {ok:true,may_send:false,attempt_id:id(6),mode:'reconcile'},
    {ok:true,may_send:false,attempt_id:id(6),attempt_generation:1,provider_generation:1,envelope_sha256:begin.envelope_sha256,replayed:true},
    {ok:false,may_send:false,paused:true}
  ];
  for(const expected of cases){
    const before=JSON.stringify(expected),f=fixture({afterRpc:(name,body,data)=>{
      if(name.endsWith('_begin')){for(const key of Object.keys(data))delete data[key];Object.assign(data,expected);}
    }});
    const result=await callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client});
    assert.deepEqual(result,expected);assert.equal(result.may_send,false);
    assert.equal(JSON.stringify(expected),before);assert.deepEqual(names(f),['prepare','begin']);
  }
});
test('NEW feedback send permit attachment denial cannot acquire a begin permit',async()=>{
  const f=fixture({prepare:{status:'needs_attention'}});
  const result=await callFeedbackRelay('begin',clone(begin),clone(oauth),{client:f.client});
  assert.deepEqual(result,{ok:false,may_send:false,needs_attention:true});assert.deepEqual(names(f),['prepare']);
});
test('NEW feedback send permit valid response does not weaken original cancellation',async()=>{
  const controller=new AbortController(),extra={...clone(oauth),signal:controller.signal};
  const f=fixture({afterRpc:name=>{if(name.endsWith('_begin'))controller.abort();}});
  await assert.rejects(callFeedbackRelay('begin',clone(begin),extra,{client:f.client}),/unconfirmed/i);
  assert.deepEqual(names(f),['prepare','begin']);
});
