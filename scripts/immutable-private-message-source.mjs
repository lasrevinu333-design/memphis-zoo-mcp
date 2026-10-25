import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Fixed Source composition only. Nothing here installs SQL or admits restore.
const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const proposalDirectory = join(projectDirectory, "proposals");
const sourceProfiles = Object.freeze([
  Object.freeze({sourcePath:"proposals/immutable-original-message-effects-restore.sql",sourceSha256:"9d7a69400b13760196e3fd61940313c06401265c942be3905084f8350618a5da",size:22534}),
  Object.freeze({sourcePath:"proposals/immutable-original-message-guards-restore.sql",sourceSha256:"95970fcfe6d4ace265859ece8c5b6b12098f142c916a506f2e3b7adad692de8d",size:14230}),
  Object.freeze({sourcePath:"proposals/immutable-original-message-audit-restore.sql",sourceSha256:"46efec2563f52b37efc0ae7d6a34645a450c3ee565786a091edacc15fa11015d",size:13275}),
  Object.freeze({sourcePath:"proposals/immutable-original-message-receipts-restore.sql",sourceSha256:"3b4e209f9733c4f0938dcefe9027eb78f8192b168e5f4edc6a556ad81d938f80",size:13157}),
]);
const sha=x=>createHash("sha256").update(x).digest("hex");
const replaceOnce=(s,old,next)=>{assert.equal(s.split(old).length,2);return s.replace(old,()=>next);};
const literalBetween=(source,tag)=>{assert.equal(source.split(tag).length,3);return source.split(tag)[1];};
const bodyOf=definition=>{const tag='AS $function$';assert.equal(definition.split(tag).length,2);
  assert.ok(definition.endsWith('$function$\n'));return definition.slice(definition.indexOf(tag)+tag.length,-'$function$\n'.length);};

const sameFileState=(a,b)=>["dev","ino","mode","uid","gid","nlink","size","mtimeNs","ctimeNs"].every(key=>a[key]===b[key]);
const sameDirectory=(a,b)=>["dev","ino","mode","uid","gid"].every(key=>a[key]===b[key]);

export function loadImmutableMessageSourceRecipes() {
  assert.equal(arguments.length,0,"Immutable message Source accepts no input overrides.");
  const directories=[projectDirectory,proposalDirectory].map(path=>{
    const state=lstatSync(path,{bigint:true});
    assert.ok(state.isDirectory()&&!state.isSymbolicLink(),"Fixed message Source directory must be original and nonsymlink.");
    assert.equal(realpathSync(path),path,"Fixed message Source directory path differs.");
    return {path,state};
  });
  const assertDirectories=()=>{
    for(const original of directories){
      const current=lstatSync(original.path,{bigint:true});
      assert.ok(current.isDirectory()&&!current.isSymbolicLink()&&sameDirectory(current,original.state),"Fixed message Source directory changed.");
      assert.equal(realpathSync(original.path),original.path,"Fixed message Source directory path changed.");
    }
  };
  const readSource=(profile,original)=>{
    assertDirectories();
    const path=join(projectDirectory,profile.sourcePath);
    const named=lstatSync(path,{bigint:true});
    assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n&&named.size===BigInt(profile.size),"Fixed message Source file is unavailable, aliased or changed.");
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const before=fstatSync(fd,{bigint:true});
      assert.ok(before.isFile()&&sameFileState(before,named),"Fixed message Source open identity differs.");
      if(original)assert.ok(sameFileState(before,original.state),"Original message Source identity or metadata changed.");
      const bytes=Buffer.alloc(profile.size);
      let offset=0;
      while(offset<bytes.length){
        const count=readSync(fd,bytes,offset,bytes.length-offset,null);
        assert.ok(count>0,"Fixed message Source ended early.");
        offset+=count;
      }
      assert.equal(readSync(fd,Buffer.alloc(1),0,1,null),0,"Fixed message Source has unexpected trailing bytes.");
      const after=fstatSync(fd,{bigint:true}),afterNamed=lstatSync(path,{bigint:true});
      assert.ok(afterNamed.isFile()&&!afterNamed.isSymbolicLink()&&sameFileState(before,after)&&sameFileState(before,afterNamed),"Fixed message Source changed during read.");
      assert.equal(sha(bytes),profile.sourceSha256,"Fixed message Source digest differs.");
      if(original)assert.ok(bytes.equals(original.bytes),"Original message Source bytes changed.");
      assertDirectories();
      return {state:before,bytes};
    } finally { closeSync(fd); }
  };
  const originals=sourceProfiles.map(profile=>readSource(profile));
  const statements=Object.freeze(sourceProfiles.map((profile,index)=>Object.freeze({
    sourcePath:profile.sourcePath,sourceSha256:profile.sourceSha256,
    sql:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(originals[index].bytes),
  })));
  const derived=[...composeOriginalMessageEffectRecipes(statements[0].sql),
    ...composeOriginalMessageGuardRecipes(statements[1].sql),
    composeOriginalMessageAuditRecipe(statements[2].sql),composeOriginalMessageReceiptRecipe(statements[3].sql)];
  assert.equal(derived.length,9);
  assert.equal(new Set(derived.map(recipe=>recipe.identity)).size,9);
  const recipes=Object.freeze(derived.map(recipe=>Object.freeze({
    identity:recipe.identity,registry_identity:recipe.registry_identity,before:recipe.before,after:recipe.after,
    beforeHash:sha(recipe.before),afterHash:sha(recipe.after),
    beforeBodyHash:recipe.beforeBodyHash,afterBodyHash:recipe.afterBodyHash,
  })));
  const assertCurrent=Object.freeze(()=>{
    assertDirectories();
    for(let i=0;i<sourceProfiles.length;i++)readSource(sourceProfiles[i],originals[i]);
    assertDirectories();
  });
  assertCurrent();
  return Object.freeze({recipes,statements,assertCurrent});
}

    function composeOriginalMessageEffectRecipes(sql){
     assert.equal(typeof sql,'string');
     const profiles=JSON.parse(literalBetween(sql,'$original_message_effects_profiles$'));
     const branch=literalBetween(sql,'$exact_message_effects_branch$');
     assert.ok(branch.length>0);
     const expected=[
      ['msg_enqueue_background_work()','trg_msg_enqueue_background_work','first_begin'],
      ['msg_memphis_pre_generate_schedule()','trg_msg_memphis_pre_generate_schedule','outer_original_block'],
      ['msg_audit_persisted_message()','trg_msg_message_immutable_audit','first_begin'],
      ['mz_enqueue_employee_message_push()','trg_mz_enqueue_employee_message_push','first_begin'],
      ['ops_manager_enqueue_message_push()','trg_ops_manager_enqueue_message_push','first_begin'],
     ];
     const keys=['identity','lookup_identity','table_name','trigger_name','trigger_type','strategy',
      'before_definition','before_definition_sha256','before_prosrc_sha256','before_grant_definition',
      'before_grant_sha256','after_prosrc_sha256','after_definition_sha256'].sort();
     const hashKeys=['before_definition_sha256','before_prosrc_sha256','before_grant_sha256',
      'after_prosrc_sha256','after_definition_sha256'];
     assert.ok(Array.isArray(profiles));assert.equal(profiles.length,expected.length);
     return Object.freeze(profiles.map((profile,index)=>{
      assert.ok(profile!==null&&typeof profile==='object'&&!Array.isArray(profile));
      assert.deepEqual(Object.keys(profile).sort(),keys);
      for(const key of keys)if(key!=='trigger_type')assert.equal(typeof profile[key],'string',key);
      for(const key of hashKeys)assert.match(profile[key],/^[0-9a-f]{64}$/,key);
      const [registryIdentity,trigger,strategy]=expected[index];
      assert.equal(profile.identity,registryIdentity);
      assert.equal(profile.lookup_identity,'public.'+registryIdentity);
      assert.equal(profile.table_name,'msg_messages');assert.equal(profile.trigger_name,trigger);
      assert.equal(profile.trigger_type,5);assert.equal(profile.strategy,strategy);
      const before=profile.before_definition,originalBody=bodyOf(before);
      assert.ok(before.startsWith('CREATE OR REPLACE FUNCTION '+profile.lookup_identity+'\n'));
      assert.equal(sha(before),profile.before_definition_sha256);
      assert.equal(sha(originalBody),profile.before_prosrc_sha256);
      assert.equal(sha(profile.before_grant_definition),profile.before_grant_sha256);
      let after;
      if(strategy==='first_begin'){
       after=replaceOnce(before,'\nbegin\n','\nbegin\n'+branch);
       assert.equal(replaceOnce(after,branch,''),before);
      }else{
       const prefix='\nbegin\n'+branch,suffix='end;\n',afterBody=prefix+originalBody+suffix;
       after=replaceOnce(before,'AS $function$'+originalBody+'$function$\n',
        'AS $function$'+afterBody+'$function$\n');
       assert.equal(bodyOf(after),afterBody);
       assert.equal(afterBody.slice(prefix.length,-suffix.length),originalBody);
       assert.equal(replaceOnce(after,afterBody,originalBody),before);
      }
      assert.equal(sha(after),profile.after_definition_sha256);
      assert.equal(sha(bodyOf(after)),profile.after_prosrc_sha256);
      return Object.freeze({identity:profile.lookup_identity,registry_identity:registryIdentity,
       before,after,beforeBodyHash:profile.before_prosrc_sha256,afterBodyHash:profile.after_prosrc_sha256});
     }));
    }

    function composeOriginalMessageGuardRecipes(sql){
     // Representation only: Main pins this Source separately. No target read,
     // registry write or admission follows from an arbitrary supplied string.
     assert.equal(typeof sql,'string');
     const profiles=JSON.parse(literalBetween(sql,'$original_message_guard_profiles$'));
     const branch=literalBetween(sql,'$original_message_guard_branch$');
     assert.ok(Array.isArray(profiles));assert.equal(profiles.length,2);assert.ok(branch.length>0);
     const keys=['identity','lookup_identity','table_name','trigger_name','trigger_type','trigger_columns','owner',
      'before_definition','before_definition_sha256','before_prosrc_sha256','before_grant_definition',
      'before_grant_sha256','before_trigger_definition','before_trigger_sha256','after_prosrc_sha256','after_definition_sha256'];
     for(const profile of profiles){
      assert.ok(profile&&Object.getPrototypeOf(profile)===Object.prototype);
      assert.deepEqual(Object.keys(profile).sort(),[...keys].sort());
     }
     assert.deepEqual(profiles.map(p=>[p.identity,p.lookup_identity,p.trigger_name,p.trigger_type]),[
      ['msg_reject_retired_ops_manager_shared_message_mutation()','public.msg_reject_retired_ops_manager_shared_message_mutation()',
       'trg_msg_reject_retired_ops_manager_shared_message_mutation',31],
      ['mz_reject_event_messenger_message()','public.mz_reject_event_messenger_message()',
       'trg_mz_reject_event_messenger_message',7]]);
     return profiles.map(profile=>{
      assert.equal(profile.table_name,'msg_messages');assert.equal(profile.trigger_columns,'');assert.equal(profile.owner,'supabase_admin');
      for(const key of ['before_definition','before_grant_definition','before_trigger_definition'])assert.equal(typeof profile[key],'string');
      for(const key of ['before_definition_sha256','before_prosrc_sha256','before_grant_sha256','before_trigger_sha256','after_prosrc_sha256','after_definition_sha256']){
       assert.equal(typeof profile[key],'string');assert.match(profile[key],/^[a-f0-9]{64}$/);
      }
      const before=profile.before_definition;
      assert.equal(sha(before),profile.before_definition_sha256);
      assert.equal(sha(bodyOf(before)),profile.before_prosrc_sha256);
      assert.equal(sha(profile.before_grant_definition),profile.before_grant_sha256);
      assert.equal(sha(profile.before_trigger_definition),profile.before_trigger_sha256);
      const after=replaceOnce(before,'\nbegin\n','\nbegin\n'+branch);
      assert.equal(sha(after),profile.after_definition_sha256);
      assert.equal(sha(bodyOf(after)),profile.after_prosrc_sha256);
      assert.equal(replaceOnce(after,branch,''),before,'Message guard normal body is preserved exactly');
      return {identity:profile.lookup_identity,registry_identity:profile.identity,before,after,
       beforeBodyHash:profile.before_prosrc_sha256,afterBodyHash:profile.after_prosrc_sha256};
     });
    }

    function composeOriginalMessageAuditRecipe(sql){
     // Fixed Source representation only; Main separately pins the proposal.
     assert.equal(typeof sql,'string');
     const profiles=JSON.parse(literalBetween(sql,'$original_message_audit_profiles$'));
     const branch=literalBetween(sql,'$original_message_audit_branch$');
     assert.ok(Array.isArray(profiles));assert.equal(profiles.length,1);assert.ok(branch.length>0);
     const profile=profiles[0];
     assert.ok(profile&&Object.getPrototypeOf(profile)===Object.prototype);
     const keys=['identity','lookup_identity','table_name','trigger_name','trigger_type','trigger_columns','owner',
      'before_definition','before_definition_sha256','before_prosrc_sha256','before_grant_definition',
      'before_grant_sha256','before_trigger_definition','before_trigger_sha256','after_prosrc_sha256','after_definition_sha256'];
     assert.deepEqual(Object.keys(profile).sort(),[...keys].sort());
     for(const key of keys)if(key!=='trigger_type')assert.equal(typeof profile[key],'string',key);
     assert.equal(profile.identity,'msg_reject_retired_ops_manager_shared_message_audit_mutation()');
     assert.equal(profile.lookup_identity,'public.'+profile.identity);
     assert.equal(profile.table_name,'msg_message_audit');
     assert.equal(profile.trigger_name,'trg_msg_reject_retired_ops_manager_shared_audit_guard');
     assert.equal(profile.trigger_type,31);assert.equal(profile.trigger_columns,'');assert.equal(profile.owner,'supabase_admin');
     for(const key of ['before_definition_sha256','before_prosrc_sha256','before_grant_sha256',
      'before_trigger_sha256','after_prosrc_sha256','after_definition_sha256'])assert.match(profile[key],/^[a-f0-9]{64}$/);
     const before=profile.before_definition;
     assert.ok(before.startsWith('CREATE OR REPLACE FUNCTION '+profile.lookup_identity+'\n'));
     assert.equal(sha(before),'6c3717ebd362bd4bf9abfc00a3ece56963f21542f6f808780fcf6d5b6bcf3bb7');
     assert.equal(sha(before),profile.before_definition_sha256);
     assert.equal(sha(bodyOf(before)),profile.before_prosrc_sha256);
     assert.equal(sha(profile.before_grant_definition),profile.before_grant_sha256);
     assert.equal(sha(profile.before_trigger_definition),profile.before_trigger_sha256);
     const after=replaceOnce(before,'\nbegin\n','\nbegin\n'+branch);
     assert.equal(sha(after),profile.after_definition_sha256);
     assert.equal(sha(bodyOf(after)),profile.after_prosrc_sha256);
     assert.equal(replaceOnce(after,branch,''),before,'Audit normal/UPDATE/DELETE body is preserved exactly');
     return Object.freeze({identity:profile.lookup_identity,registry_identity:profile.identity,before,after,
      beforeBodyHash:profile.before_prosrc_sha256,afterBodyHash:profile.after_prosrc_sha256});
    }

    function composeOriginalMessageReceiptRecipe(sql){
     // Source representation only; Main separately pins/authenticates the
     // original recipe and owns all target/admission/registry operations.
     assert.equal(typeof sql,'string');
     const profiles=JSON.parse(literalBetween(sql,'$original_message_receipt_profiles$'));
     const branch=literalBetween(sql,'$original_message_receipt_branch$');
     assert.ok(Array.isArray(profiles));assert.equal(profiles.length,1);assert.ok(branch.length>0);
     const profile=profiles[0];assert.ok(profile&&Object.getPrototypeOf(profile)===Object.prototype);
     const keys=['identity','lookup_identity','table_name','trigger_name','trigger_type','trigger_columns','owner',
      'before_definition','before_definition_sha256','before_prosrc_sha256','before_grant_definition',
      'before_grant_sha256','before_trigger_definition','before_trigger_sha256','after_prosrc_sha256','after_definition_sha256'];
     assert.deepEqual(Object.keys(profile).sort(),[...keys].sort());
     assert.equal(profile.identity,'msg_reject_retired_ops_manager_shared_receipt_mutation()');
     assert.equal(profile.lookup_identity,'public.msg_reject_retired_ops_manager_shared_receipt_mutation()');
     assert.equal(profile.table_name,'msg_receipts');assert.equal(profile.trigger_type,31);assert.equal(profile.trigger_columns,'');
     assert.equal(profile.trigger_name,'trg_msg_reject_retired_ops_manager_shared_receipt_mutation');assert.equal(profile.owner,'supabase_admin');
     for(const key of ['before_definition','before_grant_definition','before_trigger_definition'])assert.equal(typeof profile[key],'string');
     for(const key of ['before_definition_sha256','before_prosrc_sha256','before_grant_sha256','before_trigger_sha256','after_prosrc_sha256','after_definition_sha256']){
      assert.equal(typeof profile[key],'string');assert.match(profile[key],/^[a-f0-9]{64}$/);
     }
     const before=profile.before_definition;
     assert.equal(profile.before_definition_sha256,'8f81b7a8d54778ef9b05f24d48075271686d88cf03de3f19d1642cb0d2591ad0');
     assert.equal(sha(before),profile.before_definition_sha256);assert.equal(sha(bodyOf(before)),profile.before_prosrc_sha256);
     assert.equal(sha(profile.before_grant_definition),profile.before_grant_sha256);
     assert.equal(sha(profile.before_trigger_definition),profile.before_trigger_sha256);
     const after=replaceOnce(before,'\nbegin\n','\nbegin\n'+branch);
     assert.equal(sha(after),profile.after_definition_sha256);assert.equal(sha(bodyOf(after)),profile.after_prosrc_sha256);
     assert.equal(replaceOnce(after,branch,''),before,'Original receipt guard normal body is preserved exactly');
     return {identity:profile.lookup_identity,registry_identity:profile.identity,before,after,
      beforeBodyHash:profile.before_prosrc_sha256,afterBodyHash:profile.after_prosrc_sha256};
    }
