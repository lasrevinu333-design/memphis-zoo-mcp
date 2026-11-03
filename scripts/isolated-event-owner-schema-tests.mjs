import assert from 'node:assert/strict';
import { planEventOwnerRestore,executeEventOwnerPlan,splitSchemaStatements } from './isolated-event-owner-schema.mjs';
if(process.argv.includes('--pg-dump-section-input-only')){
  const inputDir=process.env.PG_DUMP_SECTION_INPUT_DIR;
  if(!inputDir){
    console.log(JSON.stringify({selector:'--pg-dump-section-input-only',status:'NOT_RUN',
      missing:'Parent PG_DUMP_SECTION_INPUT_DIR with receipt.json/pre-data.sql/post-data.sql from ONE actual exported snapshot.',actual_emitter_cases_executed:0}));
    process.exit(2);
  }
  const {planEventOwnerSchemaPair,planVerifiedEventOwnerSchemaPair}=await import('./isolated-event-owner-schema.mjs');
  const {materializeVerifiedArchive}=await import('./disaster-recovery-archive.mjs');
  const {archiveSignatureBinding,signBinding}=await import('./disaster-recovery-crypto.mjs');
  const {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync}=await import('node:fs');
  const {join,resolve}=await import('node:path');
  const {tmpdir}=await import('node:os');
  const {createHash}=await import('node:crypto');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  let work=null,archive=null,stage='parent-input',inputHashes=null,result=null,failure=null;
  try{
    const dir=resolve(inputDir),receipt=JSON.parse(readFileSync(join(dir,'receipt.json'),'utf8'));
    assert.deepEqual(Object.keys(receipt).sort(),['exported_snapshot','pg_dump_version','schema','sections','source_commit','source_tree']);
    assert.equal(receipt.schema,'custodial.pg-dump-section-fixture-receipt.v1');
    assert.equal(receipt.source_commit,'3e01ef9bdc33ce51f3f0b9300046ccb5b4e9d955');
    assert.equal(receipt.source_tree,'c35dcb8f9ecfb6d42a45e7d7fb511da2f8feb1e4');
    assert.match(receipt.exported_snapshot,/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i);
    assert.match(receipt.pg_dump_version,/^pg_dump \(PostgreSQL\) [0-9][^\r\n]{0,80}$/);
    assert.ok(Array.isArray(receipt.sections) && receipt.sections.length===2);
    const profiles=[{section:'pre-data',path:'pre-data.sql',archivePath:'inventory/application-schema-pre-data.sql'},
      {section:'post-data',path:'post-data.sql',archivePath:'inventory/application-schema-post-data.sql'}];
    const bytes=profiles.map((profile,index)=>{
      const entry=receipt.sections[index];
      assert.deepEqual(Object.keys(entry).sort(),['argv','path','section','sha256']);
      assert.equal(entry.section,profile.section);assert.equal(entry.path,profile.path);
      assert.match(entry.sha256,/^[0-9a-f]{64}$/);
      assert.ok(Array.isArray(entry.argv) && entry.argv.every(arg=>typeof arg==='string'));
      assert.equal(entry.argv.filter(arg=>arg.startsWith('--section=')).length,1);
      assert.ok(entry.argv.includes('--section='+profile.section));
      assert.equal(entry.argv.filter(arg=>arg.startsWith('--snapshot=')).length,1);
      assert.ok(entry.argv.includes('--snapshot='+receipt.exported_snapshot));
      assert.ok(entry.argv.includes('--schema-only'));
      for(const flag of ['--clean','--if-exists','--no-owner','--no-acl','--disable-triggers','--use-set-session-authorization'])
        assert.ok(!entry.argv.includes(flag),'Unsupported emitted fixture command profile');
      const raw=readFileSync(join(dir,profile.path));
      assert.ok(raw.length>0);assert.equal(hash(raw),entry.sha256,'Parent section file differs from its recorded hash');
      return raw;
    });
    inputHashes=bytes.map(hash);
    const text=bytes.map(raw=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));
    text.forEach((sql,i)=>assert.deepEqual(Buffer.from(sql,'utf8'),bytes[i]));
    stage='parent-emitter-fixture-coverage';
    const emitted=text.flatMap(sql=>splitSchemaStatements(sql).statements);
    const word=(token,value)=>token?.kind==='identifier' && !token.quoted && token.value===value;
    const head=(statement,...values)=>values.every((value,i)=>word(statement.tokens[i],value));
    const words=(statement,...values)=>values.every(value=>statement.tokens.some(token=>word(token,value)));
    const tableStatement=s=>head(s,'create','table')||head(s,'alter','table');
    assert.ok(emitted.filter(s=>head(s,'create','table')).length>=2,'Parent FK fixture requires two actual emitted table definitions');
    assert.ok(emitted.some(s=>tableStatement(s)&&words(s,'generated','identity')),'Parent identity fixture was not emitted');
    assert.ok(emitted.some(s=>tableStatement(s)&&words(s,'default')),'Parent default fixture was not emitted');
    assert.ok(emitted.some(s=>head(s,'create','table')&&words(s,'check')&&!s.tokens.some((t,i)=>word(t,'not')&&word(s.tokens[i+1],'valid'))),
      'Parent validated CHECK fixture was not emitted inline');
    assert.ok(emitted.some(s=>head(s,'alter','table')&&words(s,'foreign','key')),'Parent FK fixture was not emitted');
    for(const setting of ['enable','force'])assert.ok(emitted.some(s=>head(s,'alter','table')&&words(s,setting,'row','level','security')),
      'Parent RLS/FORCE fixture was not emitted');
    assert.ok(emitted.some(s=>head(s,'create','policy')),'Parent policy fixture was not emitted');
    assert.ok(emitted.some(s=>head(s,'alter')&&words(s,'owner','to')),'Parent owner fixture was not emitted');
    assert.ok(emitted.some(s=>head(s,'grant')||head(s,'revoke')),'Parent ACL fixture was not emitted');
    assert.ok(emitted.some(s=>head(s,'comment')),'Parent comment fixture was not emitted');
    assert.ok(emitted.some(s=>head(s,'set')),'Parent SET preamble was not emitted');
    stage='actual-emitter-raw-pair';
    // No generated replacement SQL: consume exact parent emitter bytes only.
    const pair=planEventOwnerSchemaPair(text[0],text[1]);
    for(const [i,plan]of [[0,pair.preData],[1,pair.postData]]){
      const original=splitSchemaStatements(text[i]).statements;
      const retained=plan.blocks.flatMap(block=>block.statements);
      assert.deepEqual(retained.map(s=>s.text),original.map(s=>s.text));
      assert.equal(retained.length,original.length);
    }
    assert.ok(pair.eventCount>0,'Required parent event/ALWAYS fixture is absent');
    assert.ok(pair.postData.blocks.some(block=>block.kind==='event' && block.statements.some(s=>
      s.tokens.some((t,i)=>t.value==='enable' && s.tokens[i+1]?.value==='always'))),
      'Required actual emitted ALWAYS event state is absent');
    stage='unit-materializer-composition';
    work=mkdtempSync(join(tmpdir(),'actual-section-input-unit-'));
    mkdirSync(join(work,'inventory'),{mode:0o700});
    const sections=profiles.map((p,i)=>({section:p.section,path:p.archivePath,sha256:inputHashes[i]}));
    const sourceIdentity={application_schema_sections:sections};
    const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',consistent_database_snapshot:true,
      project_ref:'abcdefghijklmnopqrst',source_identity:sourceIdentity};
    const files=[['backup-summary.json',Buffer.from(JSON.stringify(summary)+'\n')],
      ...profiles.map((p,i)=>[p.archivePath,bytes[i]])];
    for(const [path,raw]of files)writeFileSync(join(work,path),raw,{mode:0o600});
    const sums=files.map(([path,raw])=>hash(raw)+'  '+path).join('\n')+'\n';
    writeFileSync(join(work,'SHA256SUMS'),sums,{mode:0o600});
    // Same existing synthetic unit-key convention; NOT approved signer/capture.
    const key='disaster-recovery-archive-materialization-test-key-0001',keyId='archive-materialization-test-v1';
    const archiveDigest=hash(sums);
    writeFileSync(join(work,'archive-signature.json'),JSON.stringify({format:'memphis-zoo-disaster-recovery-signature.v1',
      algorithm:'hmac-sha256',key_id:keyId,archive_digest:archiveDigest,
      signature:signBinding(archiveSignatureBinding({archiveDigest,projectRef:summary.project_ref,sourceIdentity,archiveFormat:summary.format}),key)}),{mode:0o600});
    archive=materializeVerifiedArchive({sourceDir:work,archiveVerifyKey:key,archiveVerifyKeyId:keyId});
    const composed=planVerifiedEventOwnerSchemaPair(archive);
    assert.deepEqual(composed.preData,pair.preData);assert.deepEqual(composed.postData,pair.postData);
    composed.sections.forEach((entry,i)=>assert.deepEqual(Buffer.from(entry.sql,'utf8'),bytes[i]));
    function immutable(value){if(value && typeof value==='object'){
      assert.ok(Object.isFrozen(value));assert.equal(Object.hasOwn(value,'commands'),false);
      Object.values(value).forEach(immutable);
    }}
    immutable(composed);
    assert.equal(hash(readFileSync(new URL('./isolated-event-owner-schema.mjs',import.meta.url))),
      '407be2c73064b58c43043d255a1024f8b3d91ec7e859a4ddc02bc1ecea91fc6d');
    assert.equal(hash(readFileSync(new URL('./disaster-recovery-archive.mjs',import.meta.url))),
      '3b00d11f32e5512ea92925bb0630c270dbdc63e72081ef98a9ec4c0ff7719846');
    result={selector:'--pg-dump-section-input-only',status:'PASS_SUPPLIED_SECTION_PARSE_COMPOSITION_ONLY',
      pg_dump_version:receipt.pg_dump_version,exported_snapshot:receipt.exported_snapshot,input_sha256:inputHashes,
      statementCount:pair.statementCount,eventCount:pair.eventCount,
      emitter_origin_requirement:'Parent protected pg_dump execution receipt establishes actual emission; input hashes/JSON and synthetic unit HMAC do not.',
      scope:'Supplied exact section bytes; actual raw pair + synthetic-unit materializer wrapper only. Receipt is test evidence, NOT signer/target/init authority.'};
  }catch(error){
    failure={selector:'--pg-dump-section-input-only',status:'FAIL_PARENT_EMITTER_PARSE_COMPOSITION',stage,input_sha256:inputHashes,
      error:error.message,stack:error.stack,
      disposition:'Keep parent receipt/output files unchanged. No parser relaxation; report exact owning contradiction for separate Main admission.'};
  }finally{
    if(archive)archive.cleanup();
    if(work)rmSync(work,{recursive:true,force:true});
  }
  if(work)assert.equal(existsSync(work),false);
  if(archive)assert.equal(existsSync(archive.directory),false);
  console.log(JSON.stringify({...(failure||result),owned_unit_cleanup_verified:true,
    actual_executor_invocations:0,limits:'No pg_dump/SQL/Docker/subprocess or real archive/capture/approved key use by this member. No schema execution, dependency graph, target or production-fresh qualification.'}));
  process.exit(failure?1:0);
}
if(process.argv.includes('--verified-section-composition-only')){
  const {planVerifiedEventOwnerSchemaPair}=await import('./isolated-event-owner-schema.mjs');
  const {materializeVerifiedArchive}=await import('./disaster-recovery-archive.mjs');
  const {archiveSignatureBinding,signBinding}=await import('./disaster-recovery-crypto.mjs');
  const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,existsSync,rmSync}=await import('node:fs');
  const {join}=await import('node:path');
  const {tmpdir}=await import('node:os');
  const {createHash}=await import('node:crypto');
  const work=mkdtempSync(join(tmpdir(),'verified-section-parse-unit-'));
  const snapshots=[],cases=[];
  // Existing archive unit-key convention. NEVER initial-install signing authority.
  const key='disaster-recovery-archive-materialization-test-key-0001';
  const keyId='archive-materialization-test-v1';
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const profiles=[{section:'pre-data',path:'inventory/application-schema-pre-data.sql'},
    {section:'post-data',path:'inventory/application-schema-post-data.sql'}];
  const pre='-- original unité\r\nCREATE FUNCTION public.original_event_fn() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;\n'+
    'ALTER FUNCTION public.original_event_fn() OWNER TO original_owner;\n'+
    'SET SESSION AUTHORIZATION original_owner; GRANT USAGE ON SCHEMA public TO unit_reader; RESET SESSION AUTHORIZATION;';
  const post='-- Name: original_event; Type: EVENT TRIGGER; Schema: -; Owner: original_owner\n'+
    'CREATE EVENT TRIGGER original_event ON ddl_command_start EXECUTE FUNCTION public.original_event_fn();\n'+
    'ALTER EVENT TRIGGER original_event OWNER TO original_owner;\nALTER EVENT TRIGGER original_event ENABLE ALWAYS;';
  let ordinal=0;
  function fixture({texts=[pre,post],legacy=false}={}){
    const directory=join(work,'unit-'+ordinal++);mkdirSync(join(directory,'inventory'),{recursive:true,mode:0o700});
    const sections=profiles.map((profile,i)=>({...profile,sha256:hash(texts[i])}));
    const sourceIdentity=legacy?{}:{application_schema_sections:sections};
    const summary={ok:true,consistent_database_snapshot:true,format:'memphis-zoo-disaster-recovery.v4',
      project_ref:'abcdefghijklmnopqrst',source_identity:sourceIdentity};
    const files=[['backup-summary.json',JSON.stringify(summary)+'\n'],
      ['inventory/application-schema.sql','-- full schema unit data, not executed\n'],...profiles.map((p,i)=>[p.path,texts[i]])];
    for(const [path,text]of files)writeFileSync(join(directory,path),text,{mode:0o600});
    const sums=files.map(([path,text])=>hash(text)+'  '+path).join('\n')+'\n';
    writeFileSync(join(directory,'SHA256SUMS'),sums,{mode:0o600});
    const archiveDigest=hash(sums);
    writeFileSync(join(directory,'archive-signature.json'),JSON.stringify({format:'memphis-zoo-disaster-recovery-signature.v1',
      algorithm:'hmac-sha256',key_id:keyId,archive_digest:archiveDigest,
      signature:signBinding(archiveSignatureBinding({archiveDigest,projectRef:summary.project_ref,sourceIdentity,archiveFormat:summary.format}),key)}),{mode:0o600});
    const archive=materializeVerifiedArchive({sourceDir:directory,archiveVerifyKey:key,archiveVerifyKeyId:keyId});
    snapshots.push(archive);return {archive,directory};
  }
  try{
    const a=fixture(),output=planVerifiedEventOwnerSchemaPair(a.archive);
    assert.equal(output.eventCount,1);assert.equal(output.statementCount,8);
    assert.equal(output.sections[0].sql,pre);assert.equal(output.sections[1].sql,post);
    assert.deepEqual(output.sections.map(({section,path,sha256})=>({section,path,sha256})),
      profiles.map((p,i)=>({...p,sha256:hash([pre,post][i])})));
    assert.equal(output.preData.blocks.flatMap(b=>b.statements).map(s=>s.text).join(''),pre);
    assert.equal(output.postData.blocks.flatMap(b=>b.statements).map(s=>s.text).join(''),post);
    function immutable(value){if(value && typeof value==='object'){
      assert.ok(Object.isFrozen(value));assert.equal(Object.hasOwn(value,'commands'),false);
      for(const child of Object.values(value))immutable(child);
    }}
    immutable(output);
    assert.throws(()=>{output.sections[0].sql='changed';},TypeError);
    assert.throws(()=>{output.preData.blocks[0].statements[0].text='changed';},TypeError);
    assert.throws(()=>{output.postData.blocks[0].statements[0].tokens[0].value='changed';},TypeError);
    cases.push('actual current materializer/reader -> paired parser preserves exact SQL, blocks and deep immutable non-executable data');
    for(const fake of [null,{}, {...a.archive},{directory:a.archive.directory,verified:true},
      {sections:output.sections,approved:true},{preDataSql:pre,postDataSql:post}])
      assert.throws(()=>planVerifiedEventOwnerSchemaPair(fake));
    assert.throws(()=>planVerifiedEventOwnerSchemaPair(pre,post));
    assert.throws(()=>planVerifiedEventOwnerSchemaPair(a.archive,new Map()));
    cases.push('fake/copied/flagged objects, separate strings and supplied owner context cannot become evidence');
    const closed=fixture();closed.archive.cleanup();
    assert.throws(()=>planVerifiedEventOwnerSchemaPair(closed.archive),/snapshot/i);
    const legacy=fixture({legacy:true});assert.throws(()=>planVerifiedEventOwnerSchemaPair(legacy.archive),/section/i);
    cases.push('closed original and genuinely materialized legacy archive refuse composition');
    const b=fixture({texts:[pre.replaceAll('original_owner','other_owner'),post.replaceAll('original_owner','other_owner')]});
    const originalDirectory=a.archive.directory;
    a.archive.directory=b.archive.directory;
    assert.throws(()=>planVerifiedEventOwnerSchemaPair(a.archive),/snapshot/i);
    a.archive.directory=originalDirectory;
    const mixed=fixture(),mixedPath=join(mixed.archive.directory,profiles[1].path);
    chmodSync(mixedPath,0o600);writeFileSync(mixedPath,post.replaceAll('original_owner','other_owner'));
    assert.throws(()=>planVerifiedEventOwnerSchemaPair(mixed.archive),/digest|snapshot/i);
    cases.push('mixed live root/context and swapped other-source post-data refuse instead of borrowing ownership');
    const changed=fixture(),changedPath=join(changed.archive.directory,profiles[0].path);
    chmodSync(changedPath,0o600);writeFileSync(changedPath,pre+'\n-- changed copied source');
    assert.throws(()=>planVerifiedEventOwnerSchemaPair(changed.archive),/digest|snapshot/i);
    cases.push('changed authenticated copied SQL refuses before parser return');
    writeFileSync(join(a.directory,profiles[0].path),'unsigned external source change');
    a.archive.summary.source_identity.application_schema_sections=b.archive.summary.source_identity.application_schema_sections;
    a.archive.checksumPaths.clear();
    const original=planVerifiedEventOwnerSchemaPair(a.archive);
    assert.equal(original.sections[0].sql,pre);assert.equal(original.postData.blocks[0].owner,'original_owner');
    cases.push('unsigned source/public metadata changes cannot substitute for private copied originals');
    const contradictory=fixture({texts:[pre+'\nCREATE TRIGGER wrong BEFORE INSERT ON public.t EXECUTE FUNCTION public.f();',post]});
    assert.throws(()=>planVerifiedEventOwnerSchemaPair(contradictory.archive),/contradicts pre-data/);
    const source=readFileSync(new URL('./isolated-event-owner-schema.mjs',import.meta.url),'utf8');
    assert.equal(hash(source.slice(source.indexOf('export async function executeEventOwnerPlan('))),
      '478d030dfc1d22f966c3a7260fb339b88ade3fd84c64a5cbd0611d9d740bd98d');
    assert.equal(hash(readFileSync(new URL('./disaster-recovery-archive.mjs',import.meta.url))),
      '392047feb53d94b5740f1602a7b352f04243b73cd2149649c891bb762016cfb4');
    cases.push('authenticated unit evidence does not waive parser phase refusal; exact codec and executor unchanged/uninvoked');
  }finally{
    for(const archive of snapshots)archive.cleanup();
    rmSync(work,{recursive:true,force:true});
  }
  assert.equal(existsSync(work),false);
  for(const archive of snapshots)assert.equal(existsSync(archive.directory),false);
  console.log(JSON.stringify({selector:'--verified-section-composition-only',count:cases.length,cases,
    status:'PASS_NEW_SYNTHETIC_MATERIALIZER_COMPOSITION',cleanup_verified:true,
    limits:'Existing synthetic unit HMAC/local fixtures + actual current materializer/reader/parser only; no genuine signer, actual capture, target, SQL/client/executor, restore or initialization authority.'}));
  process.exit(0);
}
if(process.argv.includes('--schema-paired-owner-parse-only')){
  const {planEventOwnerSchemaPair,planEventOwnerSchemaSection}=await import('./isolated-event-owner-schema.mjs');
  const {readFileSync}=await import('node:fs');
  const {createHash}=await import('node:crypto');
  const cases=[];
  const definition='CREATE FUNCTION "source schema"."original function"() RETURNS pg_catalog.event_trigger LANGUAGE plpgsql AS $body$ BEGIN PERFORM \'ALTER FUNCTION fake OWNER TO fake;\'; END $body$;';
  const owner='ALTER FUNCTION "source schema"."original function"() OWNER TO "original owner";';
  const pre=definition+'\n'+owner+'\nSET SESSION AUTHORIZATION "original owner"; GRANT USAGE ON SCHEMA "source schema" TO source_reader; RESET SESSION AUTHORIZATION;';
  const post='-- Name: original event; Type: EVENT TRIGGER; Schema: -; Owner: original owner\n'+
    'CREATE EVENT TRIGGER "original event" ON ddl_command_start EXECUTE FUNCTION "source schema"."original function"();\n'+
    'ALTER EVENT TRIGGER "original event" ENABLE ALWAYS;\nALTER EVENT TRIGGER "original event" OWNER TO "original owner";\n'+
    'SET SESSION AUTHORIZATION "original owner"; GRANT USAGE ON SCHEMA "source schema" TO source_reader; RESET SESSION AUTHORIZATION;';
  const pair=planEventOwnerSchemaPair(pre,post);
  assert.equal(pair.eventCount,1);assert.equal(pair.statementCount,11);
  for(const [plan,raw]of [[pair.preData,pre],[pair.postData,post]]){
    assert.equal(Object.hasOwn(plan,'commands'),false);
    const flat=plan.blocks.flatMap(block=>block.statements);
    assert.equal(flat.map(statement=>statement.text).join(''),raw);
    assert.equal(flat.length,plan.statementCount);
    assert.equal(plan.blocks.find(block=>block.kind==='acl').statements.length,3);
  }
  assert.equal(Object.hasOwn(pair,'commands'),false);
  const event=pair.postData.blocks.find(block=>block.kind==='event');
  assert.equal(event.owner,'original owner');assert.equal(event.statements.length,3);
  cases.push('exact raw pair internally derives owner; original statement order/ACL/event blocks retained once');
  for(const missing of [definition,owner,pre.replace(owner,'COMMENT ON FUNCTION "source schema"."original function"() IS \'owner absent\';'),
    pre.replace('RETURNS pg_catalog.event_trigger','RETURNS text'),
    pre.replaceAll('"original function"','"foreign function"'),
    pre.replaceAll('"source schema"','"foreign schema"')])
    assert.throws(()=>planEventOwnerSchemaPair(missing,post));
  cases.push('missing definition/owner, wrong return type and foreign function/schema cannot supply event owner');
  for(const conflicting of [pre+'\n'+owner,pre+'\n'+owner.replace('"original owner"','"other owner"'),
    pre+'\n'+definition,pre.replace(owner,owner.replace('"original owner"','"other owner"'))])
    assert.throws(()=>planEventOwnerSchemaPair(conflicting,post));
  assert.throws(()=>planEventOwnerSchemaPair(pre,owner+'\n'+post),/function alteration requires explicit dependency/);
  assert.throws(()=>planEventOwnerSchemaPair(owner+'\n'+definition,post),/preceding exact pre-data function definition/);
  assert.throws(()=>planEventOwnerSchemaPair(pre,'ALTER EVENT TRIGGER "original event" ENABLE ALWAYS;'),/lacks its original create\/owner block/);
  assert.throws(()=>planEventOwnerSchemaPair(pre,post.replace('OWNER TO "original owner"','OWNER TO "other owner"')));
  cases.push('duplicate/conflicting pre definitions/owners, post override and mismatched event owner refuse');
  let calls=0;
  const malicious={get preDataSql(){calls++;return pre;},get owners(){calls++;return new Map();}};
  assert.throws(()=>planEventOwnerSchemaPair(malicious,post));
  assert.equal(calls,0);
  for(const extra of [new Map(),{verified:true},{approved:true},{owners:{}}])
    assert.throws(()=>planEventOwnerSchemaPair(pre,post,extra),/only two raw SQL strings/);
  for(const bad of [undefined,null,'',new String(pre)])assert.throws(()=>planEventOwnerSchemaPair(bad,post));
  cases.push('pair accepts only two primitive raw strings; no supplied owner map/approval/accessor authority');
  assert.throws(()=>planEventOwnerRestore(pre),/No event-trigger restore blocks/);
  assert.throws(()=>planEventOwnerSchemaSection(post,{section:'post-data'}),/function archive owner mismatch/);
  // One newly paired default control; neither historical full nor section suite runs.
  const full=planEventOwnerRestore(pre+'\n'+post);
  assert.equal(full.eventCount,1);assert.equal(full.commands.flatMap(b=>b.statements).map(s=>s.text).join(''),pre+'\n'+post);
  cases.push('default full strictness and standalone missing-owner refusal unchanged; same raw full positive remains');
  for(const [left,right]of [[post,pre],[pre+'\nCREATE TRIGGER wrong BEFORE INSERT ON public.t EXECUTE FUNCTION public.f();',post],
    [pre,post+'\nCREATE TABLE wrong(id int);'],[pre+'\nDO $$ BEGIN PERFORM 1; END $$;',post],
    [pre,post+'\nDROP EVENT TRIGGER "original event";'],[pre,post+'\nCOMMIT;']])
    assert.throws(()=>planEventOwnerSchemaPair(left,right));
  cases.push('cross-phase/destructive/opaque/transaction contradictions remain unsupported');
  const opaqueExtra='\nCREATE FUNCTION public.non_event() RETURNS public.custom_type LANGUAGE sql AS $$ SELECT NULL; $$;\nALTER FUNCTION public.non_event() OWNER TO other_source_owner;';
  const extraPair=planEventOwnerSchemaPair(pre+opaqueExtra,post);
  assert.equal(extraPair.eventCount,1);
  const s=readFileSync(new URL('./isolated-event-owner-schema.mjs',import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(s.slice(s.indexOf('export async function executeEventOwnerPlan('))).digest('hex'),
    '478d030dfc1d22f966c3a7260fb339b88ade3fd84c64a5cbd0611d9d740bd98d');
  cases.push('unrelated opaque function is not event authority; executor bytes unchanged and never invoked');
  console.log(JSON.stringify({selector:'--schema-paired-owner-parse-only',count:cases.length,cases,
    status:'PASS_NEW_PAIRED_PARSE_CONTROLS',limits:'Pure raw pair representation only. No authenticated same-snapshot source, dependency graph, executor/client, SQL, archive, key or fresh-target admission.'}));
  process.exit(0);
}
if(process.argv.includes('--schema-section-parse-only')){
  const {planEventOwnerSchemaSection}=await import('./isolated-event-owner-schema.mjs');
  const {readFileSync}=await import('node:fs');
  const {createHash}=await import('node:crypto');
  const cases=[];
  const pre=`-- opaque body words are not top-level commands\nCREATE SCHEMA source_owned;
CREATE TABLE source_owned.original_rows(id bigint NOT NULL, CHECK(id>0));
CREATE FUNCTION source_owned.original_guard() RETURNS event_trigger LANGUAGE plpgsql AS $body$ BEGIN PERFORM 'DROP TABLE; CREATE EVENT TRIGGER;'; END $body$;
ALTER FUNCTION source_owned.original_guard() OWNER TO source_owner;
SET SESSION AUTHORIZATION source_owner;
GRANT USAGE ON SCHEMA source_owned TO source_reader;
REVOKE ALL ON TABLE source_owned.original_rows FROM PUBLIC;
RESET SESSION AUTHORIZATION;
SELECT pg_catalog.set_config('search_path', '', false);`;
  assert.throws(()=>planEventOwnerRestore(pre),/No event-trigger restore blocks found/);
  cases.push('actual default full planner retains zero-event refusal');
  const parsed=planEventOwnerSchemaSection(pre,{section:'pre-data'});
  assert.equal(parsed.eventCount,0);assert.equal(parsed.statementCount,9);
  assert.equal(Object.hasOwn(parsed,'commands'),false);
  assert.equal(parsed.blocks.flatMap(block=>block.statements).map(s=>s.text).join(''),pre);
  const acl=parsed.blocks.find(block=>block.kind==='acl');assert.equal(acl.statements.length,4);
  assert.ok(acl.statements[0].text.includes('SET SESSION AUTHORIZATION'));
  assert.ok(acl.statements[3].text.includes('RESET SESSION AUTHORIZATION'));
  cases.push('zero-event pre-data parses; all raw statements/order/ACL block preserved exactly once');
  let getterCalls=0;
  for(const profile of [undefined,null,{},[],{section:'data'},{section:'pre-data',verified:true},
    {section:'post-data',approved:true},Object.create({section:'pre-data'}),
    {get section(){getterCalls++;return 'pre-data';}}])
    assert.throws(()=>planEventOwnerSchemaSection(pre,profile));
  assert.equal(getterCalls,0);
  cases.push('closed section-only profile refuses flags/inheritance/accessors without granting provenance');
  for(const sql of ['CREATE TRIGGER owned BEFORE INSERT ON public.t EXECUTE FUNCTION public.g();',
    'CREATE CONSTRAINT TRIGGER owned AFTER INSERT ON public.t EXECUTE FUNCTION public.g();',
    'CREATE OR REPLACE TRIGGER owned BEFORE INSERT ON public.t EXECUTE FUNCTION public.g();',
    'CREATE UNIQUE INDEX owned ON public.t(id);','CREATE POLICY owned ON public.t USING(true);',
    'ALTER EVENT TRIGGER owned ENABLE ALWAYS;','ALTER TABLE ONLY public.t ENABLE ALWAYS TRIGGER owned;'])
    assert.throws(()=>planEventOwnerSchemaSection(sql,{section:'pre-data'}),/contradicts pre-data/);
  cases.push('explicit post-data trigger/index/policy definitions and trigger alterations contradict pre-data');
  for(const sql of ['DROP TABLE IF EXISTS public.t;','ALTER TABLE public.t DROP CONSTRAINT owned;',
    'BEGIN;','START TRANSACTION;','COMMIT;','SET LOCAL row_security=off;',
    'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;','RESET ROLE;','RESET SESSION AUTHORIZATION;',
    'CREATE unsupported_object misleading;',
    'DO $$ BEGIN PERFORM 1; END $$;','CALL public.opaque();','SELECT public.opaque();',
    'INSERT INTO public.t VALUES(1);','ALTER TABLE public.t ADD CONSTRAINT owned CHECK(id>0);'])
    assert.throws(()=>planEventOwnerSchemaSection(sql,{section:'pre-data'}));
  cases.push('clean DROP, DATA, transaction and opaque/ambiguous boundaries refuse without SQL rewriting');
  const post='CREATE INDEX owned ON public.t(id);\nSET SESSION AUTHORIZATION source_owner; GRANT SELECT ON public.t TO source_reader; RESET SESSION AUTHORIZATION;';
  const postPlan=planEventOwnerSchemaSection(post,{section:'post-data'});
  assert.equal(postPlan.eventCount,0);assert.equal(postPlan.blocks.find(b=>b.kind==='acl').statements.length,3);
  assert.equal(postPlan.blocks.flatMap(b=>b.statements).map(s=>s.text).join(''),post);
  assert.throws(()=>planEventOwnerSchemaSection('CREATE TABLE public.t(id int);',{section:'post-data'}),/contradicts post-data/);
  cases.push('zero-event post-data representation preserves blocks; pre-data definition refuses');
  const event=`-- Name: original_event; Type: EVENT TRIGGER; Schema: -; Owner: source_owner\nCREATE EVENT TRIGGER original_event ON ddl_command_start EXECUTE FUNCTION source_owned.original_guard();
ALTER EVENT TRIGGER original_event ENABLE ALWAYS;
ALTER EVENT TRIGGER original_event OWNER TO source_owner;`;
  assert.throws(()=>planEventOwnerSchemaSection(event,{section:'pre-data'}),/contradicts pre-data/);
  assert.throws(()=>planEventOwnerSchemaSection(event,{section:'post-data'}),/function archive owner mismatch/);
  const ownerRecord='ALTER FUNCTION source_owned.original_guard() OWNER TO source_owner;\n';
  const eventPlan=planEventOwnerSchemaSection(ownerRecord+event,{section:'post-data'});
  assert.equal(eventPlan.eventCount,1);assert.equal(eventPlan.blocks[1].kind,'event');
  assert.equal(eventPlan.blocks[1].statements.length,3);
  assert.equal(eventPlan.blocks.flatMap(b=>b.statements).map(s=>s.text).join(''),ownerRecord+event);
  assert.throws(()=>planEventOwnerSchemaSection(ownerRecord+event.replace('OWNER TO source_owner','OWNER TO other_owner'),{section:'post-data'}));
  cases.push('event-owner block remains indivisible/strict; missing cross-section owner stays unsupported');
  const guarded='\\restrict abc123\n'+pre+'\n\\unrestrict abc123\n';
  assert.equal(planEventOwnerSchemaSection(guarded,{section:'pre-data'}).psqlGuards,2);
  assert.throws(()=>planEventOwnerSchemaSection(guarded.replace('unrestrict abc123','unrestrict other'),{section:'pre-data'}));
  const source=readFileSync(new URL('./isolated-event-owner-schema.mjs',import.meta.url),'utf8');
  const executor=source.slice(source.indexOf('export async function executeEventOwnerPlan('));
  // Frozen predecessor executor bytes; no task-local evidence file dependency.
  assert.equal(createHash('sha256').update(executor).digest('hex'),'478d030dfc1d22f966c3a7260fb339b88ade3fd84c64a5cbd0611d9d740bd98d');
  cases.push('existing restrict-pair validation and entire executor bytes unchanged; executor never invoked');
  console.log(JSON.stringify({selector:'--schema-section-parse-only',count:cases.length,cases,
    status:'PASS_PARSE_ONLY_NEW_CONTROLS',limits:'Representation/token/block checks only; no authenticated section evidence, function/DO dependency inference, SQL/client/executor, archive, key, target or restore admission.'}));
  process.exit(0);
}
const fixture=`-- fake CREATE EVENT TRIGGER hidden;\nCREATE FUNCTION public."event function"() RETURNS event_trigger LANGUAGE plpgsql AS $body$ BEGIN PERFORM 'CREATE EVENT TRIGGER hidden;'; /* ALTER EVENT TRIGGER hidden OWNER TO x; */ RETURN; END $body$;\nALTER FUNCTION public."event function"() OWNER TO "owner role";\n--\n-- Name: event trigger; Type: EVENT TRIGGER; Schema: -; Owner: owner role\n--\nCREATE EVENT TRIGGER "event trigger" ON ddl_command_start WHEN TAG IN ('ALTER TABLE','CREATE TABLE') EXECUTE FUNCTION public."event function"();\nALTER EVENT TRIGGER "event trigger" ENABLE ALWAYS;\nALTER EVENT TRIGGER "event trigger" OWNER TO "owner role";\nSELECT 'following section';`;
const plan=planEventOwnerRestore(fixture);
assert.equal(plan.eventCount,1);assert.equal(plan.statementCount,6);assert.equal(plan.commands[2].owner,'owner role');assert.equal(plan.commands[2].statements.length,3);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER EVENT TRIGGER "event trigger" OWNER TO "owner role";','')),/Missing owning/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('Type: EVENT TRIGGER; Schema: -; Owner: owner role','Type: EVENT TRIGGER; Schema: -; Owner: wrong')),/header mismatch/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER EVENT TRIGGER "event trigger" OWNER','ALTER EVENT TRIGGER "wrong name" OWNER')),/name mismatch/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER FUNCTION public."event function"() OWNER TO "owner role";','ALTER FUNCTION public."event function"() OWNER TO other;')),/function archive owner mismatch/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('SELECT \'following section\';','ALTER EVENT TRIGGER "event trigger" OWNER TO "owner role";')),/Duplicate event-trigger owner/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('CREATE EVENT TRIGGER "event trigger"','CREATE EVENT TRIGGER "event trigger" EXTRA')),/Expected keyword on/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER FUNCTION public."event function"() OWNER TO "owner role";', '')),/function archive owner mismatch/);
assert.throws(()=>planEventOwnerRestore(fixture.replace('ALTER FUNCTION public."event function"() OWNER TO "owner role";', 'ALTER FUNCTION public."event function"() OWNER TO "owner role"; ALTER FUNCTION public."event function"() OWNER TO "owner role";')),/Duplicate function owner/);
const escapedIdentifiers=fixture.replaceAll('"event trigger"','"event ""trigger"').replace('Name: event trigger;','Name: event "trigger;')
  .replaceAll('"owner role"','"owner ""role"').replace('Owner: owner role','Owner: owner "role');
assert.equal(planEventOwnerRestore(escapedIdentifiers).commands[2].owner,'owner "role');
assert.equal(planEventOwnerRestore('/* nested /* CREATE EVENT TRIGGER fake; */ ALTER EVENT TRIGGER fake OWNER TO x; */'+fixture).eventCount,1);
assert.throws(()=>splitSchemaStatements('SELECT $$unterminated;'),/Unterminated dollar/);
assert.throws(()=>splitSchemaStatements('\\restrict one\nSELECT 1;\n\\unrestrict two\n'),/Mismatched/);
assert.throws(()=>splitSchemaStatements('\\! unexpected\nSELECT 1;'),/Unsupported/);
assert.equal(splitSchemaStatements('\\restrict abc\nSELECT \'quoted; text\';\n\\unrestrict abc\n').statements.length,1);
const embedded='CREATE FUNCTION public.foo() RETURNS text LANGUAGE sql AS $x$ SELECT \'\\restrict fake\'; SELECT \'CREATE EVENT TRIGGER evil;\'; $x$;';
assert.equal(splitSchemaStatements(embedded).statements[0].text,embedded);
assert.equal(planEventOwnerRestore('SET SESSION AUTHORIZATION postgres; GRANT USAGE ON SCHEMA public TO anon; RESET SESSION AUTHORIZATION;'+fixture).commands[0].kind,'acl');
assert.throws(()=>planEventOwnerRestore('SET SESSION AUTHORIZATION postgres; CREATE SCHEMA unexpected; RESET SESSION AUTHORIZATION;'+fixture),/only GRANT\/REVOKE/);
assert.throws(()=>planEventOwnerRestore(fixture+'SET SESSION AUTHORIZATION postgres; GRANT USAGE ON SCHEMA public TO anon;'),/Unterminated archive ACL/);
for(const failing of [false,true]){
  const calls=[];
  const client={async query(sql){calls.push(sql);if(sql.includes('pg_get_userbyid(p.proowner)'))return {rows:[{owner_name:'owner role'}]};if(sql==='select current_user, session_user')return {rows:[{current_user:'supabase_admin',session_user:'supabase_admin'}]};if(failing&&sql.includes('CREATE EVENT TRIGGER "event trigger"'))throw Error('synthetic create failure');return {rows:[]};}};
  if(failing)await assert.rejects(executeEventOwnerPlan(client,plan),/synthetic create failure/);else assert.equal((await executeEventOwnerPlan(client,plan)).eventBlocks,1);
  const enter=calls.indexOf('SET ROLE "owner role"'),reset=calls.indexOf('RESET ROLE',enter);assert.ok(enter>=0&&reset>enter,'RESET must follow owner entry even on failure');
  const following=calls.findIndex(x=>x.includes("SELECT 'following section'"));if(!failing)assert.ok(following>reset,'Owner context must be reset before following SQL');
}
const wrongRestoredOwner={async query(sql){
  if(sql==='select current_user, session_user')return {rows:[{current_user:'supabase_admin',session_user:'supabase_admin'}]};
  if(sql.includes('pg_get_userbyid(p.proowner)'))return {rows:[{owner_name:'wrong_owner'}]};
  assert.ok(!sql.startsWith('SET ROLE '),'No owner scope may open before recorded/restored owner matching');return {rows:[]};
}};
await assert.rejects(executeEventOwnerPlan(wrongRestoredOwner,plan),/Restored function owner differs/);
const aclCalls=[];
const failingAcl={async query(sql){aclCalls.push(sql);if(sql==='select current_user, session_user')return {rows:[{current_user:'supabase_admin',session_user:'supabase_admin'}]};if(sql.includes('GRANT USAGE ON SCHEMA public'))throw Error('synthetic ACL failure');return {rows:[]};}};
await assert.rejects(executeEventOwnerPlan(failingAcl,planEventOwnerRestore('SET SESSION AUTHORIZATION postgres; GRANT USAGE ON SCHEMA public TO anon; RESET SESSION AUTHORIZATION;'+fixture)),/synthetic ACL failure/);
assert.equal(aclCalls.at(-1),'RESET SESSION AUTHORIZATION','ACL grantor context must reset even on failure');
console.log('EVENT_OWNER_SCHEMA_PLAN_TESTS_PASS');
