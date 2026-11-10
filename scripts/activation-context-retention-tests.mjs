// Actual captured stage/final/payload owners; explicitly synthetic dependency ports.
// This proves control-flow/value parity and retained-memory reduction, not live admission.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const stem='../docs/pending-repairs/20261110050014_custodial_activation_context_retention';
const repair=readFileSync(new URL(stem+'.sql',import.meta.url),'utf8');
const preimages=JSON.parse(readFileSync(new URL(stem+'.preimages.json',import.meta.url)));
let sql=readFileSync(new URL('./fixtures/activation-context-retention.sql',import.meta.url),'utf8');
for(const row of preimages){
 assert.equal(createHash('sha256').update(row.definition).digest('hex'),row.preimage_sha256);
 assert.equal(sql.split(row.definition).length-1,1,'Exactly one actual captured preimage in fixture');
}
const body=repair.slice(repair.indexOf('do $context_retention$'),repair.lastIndexOf('commit;'));
const refusal=`
create role fixture_nonowner;
do $metadata_refusals$ begin
 begin alter function public.static_weekly_coverall_stage_initial_operational(uuid,uuid,jsonb,jsonb) owner to fixture_nonowner;
 execute $repair$${body}$repair$;raise exception 'Changed owner accepted';
 exception when others then if sqlerrm not like 'Exact activation context metadata differs:%' then raise;end if;end;
 begin grant execute on function public.static_weekly_coverall_stage_initial_operational(uuid,uuid,jsonb,jsonb) to public;
 execute $repair$${body}$repair$;raise exception 'Changed ACL accepted';
 exception when others then if sqlerrm not like 'Exact activation context metadata differs:%' then raise;end if;end;
 begin insert into public.custodial_release_authority_restore_inventory values('static_weekly_coverall_stage_initial_operational(uuid,uuid,jsonb,jsonb)','unexpected');
 execute $repair$${body}$repair$;raise exception 'Changed recovery surface accepted';
 exception when others then if sqlerrm not like 'Activation context recovery surface differs:%' then raise;end if;end;
 raise notice 'PASS changed owner/ACL/recovery surface refused with original restored by savepoint';
end $metadata_refusals$;
`;
assert.equal(sql.split('-- EXACT_REPAIR_APPLY').length-1,1);sql=sql.replace('-- EXACT_REPAIR_APPLY',refusal+repair);
sql+=`do $duplicate$ begin begin execute $repair$${body}$repair$;raise exception 'Duplicate accepted';exception when others then if sqlerrm not like 'Exact activation context predecessor differs:%' then raise;end if;end;
 if (select count(*) from public.custodial_release_authority_restore_inventory)<>1 or not exists(select 1 from public.custodial_release_authority_restore_inventory where object_identity='unrelated original' and marker='preserve exact') then raise exception 'Unrelated recovery changed';end if;
 raise notice 'PASS duplicate predecessor refused and unrelated recovery preserved';end $duplicate$;`;
const name='custodial-context-test-'+randomUUID().slice(0,12),image='public.ecr.aws/supabase/postgres:17.6.1.165';
const run=(args,options={})=>spawnSync('docker',args,{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,...options});
assert.equal(run(['image','inspect',image]).status,0,'Exact cached PG17 fixture image required; no implicit pull');
assert.notEqual(run(['inspect',name]).status,0,'Refuse existing container');
try{
 const result=run(['run','--rm','-i','--network','none','--name',name,'--user','postgres','--tmpfs','/tmp:rw,size=256m,mode=1777','--entrypoint','bash',image,'-c',
 "set -e; initdb -D /tmp/test-data -A trust -U postgres >/dev/null; pg_ctl -D /tmp/test-data -l /tmp/postgres.log -o '-k /tmp -h 127.0.0.1 -c shared_buffers=32MB -c jit=off' -w start >/dev/null; psql -h /tmp -U postgres -d postgres; pg_ctl -D /tmp/test-data -m fast -w stop >/dev/null"],{input:sql});
 process.stdout.write(result.stdout||'');process.stdout.write(result.stderr||'');assert.equal(result.status,0,result.error?.message||'Exact context repair fixture failed');
}finally{run(['rm','-f',name]);assert.notEqual(run(['inspect',name]).status,0,'Owned fixture must be removed');}
console.log(JSON.stringify({status:'PASS',scope:'actual captured three owners and exact repair; synthetic external ports',production:false,full_activation:false,owned_container_removed:true}));
