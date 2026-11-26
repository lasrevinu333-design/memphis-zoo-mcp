import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {verifyArchivedLedgerV2} from './backup-ledger-binding-v2.mjs';
import {readVerifiedMigrationTargetCaptureSource,readVerifiedArchiveSourceBinding} from './disaster-recovery-archive.mjs';
import {readVerifiedImmutableArchiveOwnerProfile} from './immutable-private-owner-profile.mjs';
import {splitSchemaStatements} from './isolated-event-owner-schema.mjs';
import {readVerifiedCurrent428ForwardQualificationSource} from './current428-forward-qualification-source.mjs';

export const current429 = Object.freeze({
  runId:'45645963579',
  artifactId:'15039085011',
  ciphertextBytes:96961760,
  ciphertextSha256:'86e4a42617a7da2c9b6b28ef24a8d3cef9e0e64580fba77aa94666effb8cf3db',
  archiveDigest:'f305655a56e2538b41a21293f76750c752ec063196cac452ad11d9fe9865c489',
  producerCommit:'75c5ef7badbd4e0298830a53460ec38aaf404c20',
  producerTree:'1b68053e55857f2ea8bc8b3eb04cc6e37f2f71dc',
  projectRef:'rqquvtjdmugpigbndmne',
  sourceCount:429,
  sourceHead:'20261122145828',
  sourceLedgerSha256:'9ecf46a88a43308ec6c0f862ffbf803ae3366ab88f838e276c79dcefc8fd35fc',
  sourceTupleSha256:'abc5633aace4c2993ac4acefe61c7f8f56de561a33a15564e382a0a235f6012a',
  sourceCatalog:'52104aa4ab0ada870ac17d6ad7d3bc014a374873c7ca0c54e179e01b632e0f3d',
});

const refs=Object.freeze([
 ['20261126010759_rebind_installed_gps_and_dashboard_restore_inventory.sql','a765fd1ae80601543fc8995f74c6e3780ddb4915ece679d9ebbed6d6eda0b63f'],
 ['20261126010800_custodial_feedback_create_current_employee.sql','6d2a67a70a7491223f3fd8ef07020f63c56fcb12d22f2511b5f008617c821175'],
 ['20261126010801_custodial_phone_assignment_epoch_and_initial_fill.sql','2e3599a820939bc09fad971511eaf93dc319605c57963cc120b9aca18d8f3f45'],
 ['20261126010802_msg_set_memphis_thread_context_for_turn.sql','ddf25785324f8c3b2e28d239705e1162e3630d58752f965905d0a1acf9cfbe8a'],
].map(Object.freeze));
const sha=value=>createHash('sha256').update(value).digest('hex');

function transactionBody(sql) {
  const {statements,psqlGuards}=splitSchemaStatements(sql);
  assert.equal(psqlGuards,0);
  const keyword=statement=>statement?.tokens[0]?.value.toLowerCase();
  assert.equal(keyword(statements[0]),'begin');
  assert.equal(keyword(statements.at(-1)),'commit');
  assert.equal(statements[0].tokens.length,2);
  assert.equal(statements.at(-1).tokens.length,2);
  assert.ok(statements.length>2);
  for(const statement of statements.slice(1,-1))
    assert.ok(!['begin','start','commit','end','rollback','abort','savepoint','release','prepare'].includes(keyword(statement)));
  return sql.slice(statements[0].end,statements.at(-1).tokens[0].start);
}

export function readCurrent429Plan() {
  const pending=refs.map(([file,digest])=>{
    const path=new URL('../release/pending-reviewed-sql/'+file,import.meta.url);
    const state=lstatSync(path);
    assert.ok(state.isFile()&&state.nlink===1&&state.size>0&&state.size<65536);
    const bytes=readFileSync(path);
    assert.equal(sha(bytes),digest,'Exact reviewed forward bytes required');
    const sql=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return Object.freeze({file,version:file.slice(0,14),sha256:digest,sql,body:transactionBody(sql)});
  });
  return Object.freeze({pending:Object.freeze(pending),
    plan_sha256:sha(JSON.stringify(pending.map(({file,version,sha256})=>[file,version,sha256]))),
    expected_target_ledger_count:current429.sourceCount+pending.length,expected_target_ledger_head:pending.at(-1).version});
}

// Check the exact backup pins after authenticating and validating the archive.
export function assertCurrent429ForwardMetadata({sourceBinding:s,binding}) {
  assert.equal(s.archive_digest,current429.archiveDigest);
  assert.equal(s.project_ref,current429.projectRef);
  assert.equal(s.source_identity.backup_tool_commit,current429.producerCommit);
  assert.equal(s.source_identity.backup_tool_tree,current429.producerTree);
  assert.equal(s.source_identity.migration_ledger_sha256,current429.sourceLedgerSha256);
  assert.equal(binding.captured_migration_head,current429.sourceHead);
  assert.equal(binding.captured_ledger_count,current429.sourceCount);
  assert.equal(binding.ledger_sha256,current429.sourceTupleSha256);
  assert.equal(binding.catalog_fingerprint,current429.sourceCatalog);
}

export function readVerifiedCurrent429ForwardQualificationSource(archive) {
  const original=readVerifiedMigrationTargetCaptureSource(archive);
  const {sourceBinding,binding,catalog,ledger}=original;
  verifyArchivedLedgerV2({summary:sourceBinding.summary,binding,catalog,ledger});
  assertCurrent429ForwardMetadata(original);
  const owner={id:'immutable-private-current-postgres',actor:'postgres'};
  assert.deepEqual(readVerifiedImmutableArchiveOwnerProfile(archive),owner);
  const plan=readCurrent429Plan();
  assert.ok(plan.pending.every(item=>item.version>current429.sourceHead&&
    !ledger.some(row=>row.version===item.version||row.name===item.file.slice(15,-4))));
  const assertCurrent=()=>{
    assert.equal(readVerifiedMigrationTargetCaptureSource(archive),original);
    assert.deepEqual(readVerifiedImmutableArchiveOwnerProfile(archive),owner);
    assert.deepEqual(readCurrent429Plan(),plan);
  };
  assertCurrent();
  return Object.freeze({...plan,archive_digest:current429.archiveDigest,
    source_ledger_count:current429.sourceCount,source_ledger_head:current429.sourceHead,
    source_ledger_file_sha256:current429.sourceLedgerSha256,source_catalog_fingerprint:current429.sourceCatalog,
    source_inventory:{baseline:current429.sourceCount,forward_files:plan.pending.map(item=>item.file)},
    production_mutation_authorized:false,assertCurrent});
}

export function readPrivateForwardQualificationSource(archive) {
  return readVerifiedArchiveSourceBinding(archive).archive_digest===current429.archiveDigest
    ? readVerifiedCurrent429ForwardQualificationSource(archive)
    : readVerifiedCurrent428ForwardQualificationSource(archive);
}
