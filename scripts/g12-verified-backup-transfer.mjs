// Qualification control only. Never a product verifier or restore admission.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';

export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const FORMAT = 'custodial.g12.ci-verified-derived-transfer.v1';
const MAX_PACKAGE = 2 * 1024 ** 3;
const VERIFIER_SOURCES=Object.freeze({
  'scripts/disaster-recovery-archive.mjs':'1195c423aacd7c20d5ec819b57b361241e4e49138427f3b7b78f48f2b73ac96a',
  'scripts/disaster-recovery-crypto.mjs':'232bc23dd8cbfeb888523b462ddc4639b8233f80dbdd5747a49dc5f56bf2e1c5',
  'scripts/production-backup-pg-dump-command.mjs':'8ad52b64334f4338582429ade37ad1a3c094d6732a28ec9b5f213b5142f3d55f',
});
function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
function privateWrite(file, bytes) { fs.writeFileSync(file, bytes, {flag:'wx', mode:0o600}); }
function hashFile(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try { requireThat(fs.fstatSync(fd).isFile(),'Regular file required.'); const h=crypto.createHash('sha256'), b=Buffer.alloc(1024*1024); let n; while((n=fs.readSync(fd,b,0,b.length,null))!==0)h.update(b.subarray(0,n)); return h.digest('hex'); }
  finally {fs.closeSync(fd);}
}
function child(command,args,options={}) {
  const r=spawnSync(command,args,{timeout:120000,maxBuffer:1024*1024,encoding:'utf8',env:{PATH:'/usr/bin:/bin'},...options});
  // Do not reproduce child output: archive contents/secrets must never enter logs.
  requireThat(!r.error && r.status===0,'Transfer subprocess failed: '+path.basename(command)+'.');
  return r.stdout;
}
function github(endpoint) {
  return JSON.parse(child('/usr/bin/gh',['api','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2026-03-10','--method','GET',endpoint],{env:{PATH:process.env.PATH,GH_TOKEN:process.env.GH_TOKEN}}));
}
// Extract only fresh ordinary files/directories. Reject traversal, duplicate file
// names, links, devices, oversized expansion and ownership/mode restoration.
const EXTRACT = String.raw`
import sys,tarfile,zipfile,pathlib,os,shutil
source,dest,kind=sys.argv[1:]
root=pathlib.Path(dest); assert root.is_dir() and not any(root.iterdir())
def name(raw):
 p=pathlib.PurePosixPath(raw)
 assert not p.is_absolute() and '..' not in p.parts and chr(92) not in raw and chr(0) not in raw
 return '/'.join(x for x in p.parts if x!='.')
seen=set(); total=0
if kind=='zip':
 with zipfile.ZipFile(source) as z:
  assert len(z.infolist())==1
  m=z.infolist()[0]; assert name(m.filename)=='memphis-zoo-backup.tar.gz.enc' and not m.is_dir() and (m.external_attr>>16)&0o170000 in (0,0o100000)
  assert m.file_size<=134217728
  with z.open(m) as f, open(root/m.filename,'xb') as o: shutil.copyfileobj(f,o)
  os.chmod(root/m.filename,0o600)
else:
 with tarfile.open(source,'r:gz') as t:
  members=t.getmembers(); assert len(members)<=20000
  for m in members:
   n=name(m.name)
   if not n: assert m.isdir(); continue
   target=root/n
   if m.isdir(): target.mkdir(parents=True,exist_ok=True,mode=0o700); continue
   assert m.isfile() and n not in seen and m.size<=1073741824
   seen.add(n); total+=m.size; assert total<=2147483648
   target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   with t.extractfile(m) as f, open(target,'xb') as o: shutil.copyfileobj(f,o)
   os.chmod(target,0o600)
`;
export function extractSafe(source,destination,kind='tar') {
  child('/usr/bin/python3',['-c',EXTRACT,source,destination,kind],{env:{PATH:'/usr/bin:/bin'}});
}
export function cleanupOwnedWork(receiptFile,parent) {
  const receipt=JSON.parse(fs.readFileSync(receiptFile));
  requireThat(receipt.format==='custodial.g12.transfer-owned-work.v1' && receipt.uid===process.getuid()
    && path.dirname(receipt.directory)===parent && /^g12-transfer-[A-Za-z0-9]+$/.test(path.basename(receipt.directory)),'Owned cleanup receipt differs.');
  if(!fs.existsSync(receipt.directory))return {owned_work_absent:true};
  const s=fs.lstatSync(receipt.directory);
  requireThat(s.isDirectory() && !s.isSymbolicLink() && s.dev===receipt.dev && s.ino===receipt.ino && s.uid===receipt.uid,'Owned transfer directory identity changed.');
  fs.rmSync(receipt.directory,{recursive:true});requireThat(!fs.existsSync(receipt.directory),'Owned cleanup incomplete.');
  return {owned_work_absent:true};
}
export function recipientIdentity(pem) {
  const k=crypto.createPublicKey(pem);
  requireThat(k.asymmetricKeyType==='rsa' && k.asymmetricKeyDetails.modulusLength>=3072,'RSA recipient >=3072 bits required.');
  return {key:k,sha256:sha(k.export({type:'spki',format:'der'}))};
}
export function validatePlan(p) {
  requireThat(p && p.format===FORMAT && typeof p.recipient_public_key_pem==='string' && /^[a-f0-9]{64}$/.test(p.recipient_spki_sha256),'Reviewed recipient binding missing.');
  requireThat(recipientIdentity(p.recipient_public_key_pem).sha256===p.recipient_spki_sha256,'Recipient pin differs.');
  requireThat(p.backup_run_id===40442251961 && p.backup_attempt===1 && p.backup_artifact_id===12706817205
    && p.backup_commit==='9995d2bb35e0b39ef04f6eeff36f1305355cc013'
    && p.original_zip_sha256==='522b976382fd69c5659658ac0ed0b96c154897e91b7279cd4576edb292555e14'
    && p.archive_digest==='9bd67f89266b5ff812a9b0f96941f50d592694541af7585e96f014525cc0da93'
    && p.project_ref==='rqquvtjdmugpigbndmne','Fixed original backup binding differs.');
  requireThat(p.verifier_commit==='4803109c968d874519f9dec2278089971bf3530b' && p.repository==='lasrevinu333-design/memphis-zoo-mcp' && p.control_branch==='codex/custodial-g12-derived-backup-transfer-20261027','Fixed control scope differs.');
  requireThat(p.verifier_sources && Object.keys(p.verifier_sources).sort().join('|')===Object.keys(VERIFIER_SOURCES).sort().join('|')
    && Object.entries(VERIFIER_SOURCES).every(([k,v])=>p.verifier_sources[k]===v),'Closed verifier dependency pins differ.');
  return p;
}
export function validateOriginalMetadata(run,artifact,p) {
  requireThat(run.id===p.backup_run_id && run.run_attempt===1 && run.head_sha===p.backup_commit
    && run.event==='workflow_dispatch' && run.path==='.github/workflows/production-disaster-recovery-backup.yml'
    && run.status==='completed' && run.conclusion==='success' && run.repository?.full_name===p.repository,'Original backup run differs.');
  requireThat(artifact.id===p.backup_artifact_id && artifact.name==='memphis-zoo-disaster-recovery-40442251961'
    && artifact.expired===false && artifact.size_in_bytes===15482161 && artifact.digest==='sha256:'+p.original_zip_sha256
    && artifact.workflow_run?.id===p.backup_run_id && artifact.workflow_run?.head_sha===p.backup_commit,'Original artifact differs.');
}
export async function loadVerifier(product,pins) {
  for(const [logical,digest] of Object.entries(pins))requireThat(hashFile(path.join(product,logical))===digest,'Maintained verifier source differs.');
  const archive=await import(pathToFileURL(path.join(product,'scripts/disaster-recovery-archive.mjs')));
  const signing=await import(pathToFileURL(path.join(product,'scripts/disaster-recovery-crypto.mjs')));
  return {...archive,...signing};
}
// Caller supplies an already-authenticated opaque archive; never accept a
// caller-provided verified=true flag. Original snapshot remains read-only.
export function deriveArchive(api,verified,destination,newKey,newKeyId) {
  const binding=api.readVerifiedArchiveSourceBinding(verified);
  api.assertVerifiedArchiveIndependentIntentKey(verified,newKey);
  requireThat(api.requireSigningKey(newKey,'Derived archive key')===newKey && /^[A-Za-z0-9._:-]{1,120}$/.test(newKeyId),'Derived signing parameters invalid.');
  fs.mkdirSync(destination,{mode:0o700});
  const names=[...verified.checksumPaths,'SHA256SUMS'];
  for(const name of names){const out=path.join(destination,name);fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.copyFileSync(path.join(verified.directory,name),out,fs.constants.COPYFILE_EXCL);fs.chmodSync(out,0o600);}
  const original=JSON.parse(fs.readFileSync(path.join(verified.directory,'archive-signature.json')));
  const derived={format:original.format,algorithm:'hmac-sha256',key_id:newKeyId,archive_digest:binding.archive_digest,
    signature:api.signBinding(api.archiveSignatureBinding({archiveDigest:binding.archive_digest,projectRef:binding.project_ref,sourceIdentity:binding.source_identity,archiveFormat:binding.format}),newKey)};
  privateWrite(path.join(destination,'archive-signature.json'),api.stableJsonFile(derived));
  for(const name of names)requireThat(hashFile(path.join(verified.directory,name))===hashFile(path.join(destination,name)),'Derived DATA or checksum inventory changed.');
  const checked=api.materializeVerifiedArchive({sourceDir:destination,archiveVerifyKey:newKey,archiveVerifyKeyId:newKeyId});
  try{requireThat(checked.archiveDigest===binding.archive_digest && api.stableJson(checked.summary)===api.stableJson(binding.summary),'Derived source identity changed.');}
  finally{checked.cleanup();}
  return {original_signature_sha256:hashFile(path.join(verified.directory,'archive-signature.json')),derived_signature_sha256:hashFile(path.join(destination,'archive-signature.json')),
    original_key_id:original.key_id,derived_key_id:newKeyId,archive_digest:binding.archive_digest,checksummed_files:names.length-1};
}
function removeOwnedFile(file,identity){
  if(!identity)return;
  let actual;try{actual=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return;throw e;}
  requireThat(actual.isFile()&&!actual.isSymbolicLink()&&actual.dev===identity.dev&&actual.ino===identity.ino,'Owned output identity changed; foreign path preserved.');
  fs.unlinkSync(file);
}
export async function sealFile(input,output,publicPem,binding) {
  requireThat(fs.statSync(input).size<=MAX_PACKAGE,'Transfer package too large.');
  const recipient=recipientIdentity(publicPem), key=crypto.randomBytes(32), iv=crypto.randomBytes(12);
  const header={format:FORMAT,encryption:'aes-256-gcm',key_wrap:'rsa-oaep-sha256',recipient_spki_sha256:recipient.sha256,
    wrapped_key:crypto.publicEncrypt({key:recipient.key,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),iv:iv.toString('base64'),binding};
  const bytes=Buffer.from(JSON.stringify(header)); requireThat(bytes.length<=65536,'Envelope header too large.');
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(bytes);
  const prefix=Buffer.alloc(8);prefix.write('G12X',0,'ascii');prefix.writeUInt32BE(bytes.length,4);
  let outputFd=null,owned=null;
  try{
    outputFd=fs.openSync(output,'wx',0o600);owned=fs.fstatSync(outputFd);
    fs.writeSync(outputFd,Buffer.concat([prefix,bytes]));
    await pipeline(fs.createReadStream(input),cipher,fs.createWriteStream(output,{fd:outputFd,autoClose:false}));
    fs.writeSync(outputFd,cipher.getAuthTag());fs.fsyncSync(outputFd);
    const current=fs.lstatSync(output);requireThat(current.dev===owned.dev&&current.ino===owned.ino&&current.isFile(),'Cipher output identity changed.');
    return {ciphertext_sha256:hashFile(output),ciphertext_bytes:current.size,recipient_spki_sha256:recipient.sha256,header};
  }catch(e){removeOwnedFile(output,owned);throw e;}finally{if(outputFd!==null)fs.closeSync(outputFd);key.fill(0);}
}
// Authentication failure never publishes a decrypted plaintext pathname.
export async function openFile(input,output,privatePem,expectedBinding) {
  const fd=fs.openSync(input,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let key,tempFd=null,tempIdentity=null;
  const temp=output+'.partial-'+crypto.randomBytes(8).toString('hex');
  try{
    const size=fs.fstatSync(fd).size;requireThat(size<=MAX_PACKAGE+65560 && size>=24,'Envelope size invalid.');
    const prefix=Buffer.alloc(8);requireThat(fs.readSync(fd,prefix,0,8,0)===8 && prefix.subarray(0,4).toString()==='G12X','Envelope magic invalid.');
    const n=prefix.readUInt32BE(4);requireThat(n>0 && n<=65536 && size>8+n+16,'Envelope header size invalid.');
    const raw=Buffer.alloc(n);requireThat(fs.readSync(fd,raw,0,n,8)===n,'Envelope header truncated.');const h=JSON.parse(raw);
    const pub=crypto.createPublicKey(crypto.createPrivateKey(privatePem));
    requireThat(h.format===FORMAT && h.encryption==='aes-256-gcm' && h.key_wrap==='rsa-oaep-sha256'
      && recipientIdentity(pub.export({type:'spki',format:'pem'})).sha256===h.recipient_spki_sha256
      && JSON.stringify(h.binding)===JSON.stringify(expectedBinding),'Envelope recipient/binding differs.');
    key=crypto.privateDecrypt({key:privatePem,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(h.wrapped_key,'base64'));
    requireThat(key.length===32 && Buffer.from(h.iv,'base64').length===12,'Envelope key/IV invalid.');
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(h.iv,'base64'));decipher.setAAD(raw);
    const tag=Buffer.alloc(16);requireThat(fs.readSync(fd,tag,0,16,size-16)===16,'Envelope tag truncated.');decipher.setAuthTag(tag);
    tempFd=fs.openSync(temp,'wx',0o600);tempIdentity=fs.fstatSync(tempFd);
    await pipeline(fs.createReadStream(input,{fd,autoClose:false,start:8+n,end:size-17}),decipher,fs.createWriteStream(temp,{fd:tempFd,autoClose:false}));
    fs.fsyncSync(tempFd);const current=fs.lstatSync(temp);requireThat(current.dev===tempIdentity.dev&&current.ino===tempIdentity.ino&&current.isFile(),'Plaintext temp identity changed.');
    // Hard-link creation is exclusive: never overwrite a prior local result.
    fs.linkSync(temp,output);fs.unlinkSync(temp);return h;
  }catch(e){removeOwnedFile(temp,tempIdentity);throw e;}finally{if(tempFd!==null)fs.closeSync(tempFd);if(key)key.fill(0);fs.closeSync(fd);}
}
export async function prepare(planFile) {
  const p=validatePlan(JSON.parse(fs.readFileSync(planFile)));
  requireThat(process.env.GITHUB_REPOSITORY===p.repository && process.env.GITHUB_EVENT_NAME==='workflow_dispatch'
    && process.env.GITHUB_REF==='refs/heads/'+p.control_branch && /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||'')
    && /^[0-9]+$/.test(process.env.GITHUB_RUN_ID||'') && process.env.GITHUB_RUN_ATTEMPT==='1','Reviewed manual control run required.');
  const product=path.resolve('product');
  requireThat(child('/usr/bin/git',['-C',product,'rev-parse','HEAD']).trim()===p.verifier_commit,'Exact maintained product checkout required.');
  const api=await loadVerifier(product,p.verifier_sources);
  const run=github('repos/'+p.repository+'/actions/runs/'+p.backup_run_id);
  const artifact=github('repos/'+p.repository+'/actions/artifacts/'+p.backup_artifact_id);validateOriginalMetadata(run,artifact,p);
  const parent=fs.realpathSync(process.env.RUNNER_TEMP||'');requireThat(fs.statSync(parent).uid===process.getuid(),'Owned runner temporary directory required.');
  const work=fs.mkdtempSync(path.join(parent,'g12-transfer-'));fs.chmodSync(work,0o700);
  const workIdentity=fs.statSync(work);let verified;let emitted=false;let outputIdentity=null;const output=path.join(parent,'g12-transfer-ciphertext');
  const ownerFile=path.join(parent,'g12-transfer-owned-work.json');
  privateWrite(ownerFile,JSON.stringify({format:'custodial.g12.transfer-owned-work.v1',directory:work,dev:workIdentity.dev,ino:workIdentity.ino,uid:workIdentity.uid}));
  const previousTmp=process.env.TMPDIR;process.env.TMPDIR=work; // Verifier private snapshots remain inside this exact owned cleanup tree.
  const clean=()=>cleanupOwnedWork(ownerFile,parent);
  const abort=()=>{try{verified?.cleanup();clean();}finally{process.exit(1);}};
  process.once('SIGTERM',abort);process.once('SIGINT',abort);
  try{
    fs.mkdirSync(output,{mode:0o700});outputIdentity=fs.lstatSync(output);
    const zip=path.join(work,'original.zip'), zipFd=fs.openSync(zip,'wx',0o600);
    try{child('/usr/bin/gh',['api','-H','Accept: application/vnd.github+json','--method','GET','repos/'+p.repository+'/actions/artifacts/'+p.backup_artifact_id+'/zip'],{stdio:['ignore',zipFd,'pipe'],env:{PATH:process.env.PATH,GH_TOKEN:process.env.GH_TOKEN}});}finally{fs.closeSync(zipFd);}
    requireThat(hashFile(zip)===p.original_zip_sha256 && fs.statSync(zip).size===15482161,'Actual original ZIP digest/size differs.');
    const encrypted=path.join(work,'encrypted');fs.mkdirSync(encrypted,{mode:0o700});extractSafe(zip,encrypted,'zip');
    const tar=path.join(work,'original.tar.gz');
    child('/usr/bin/openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-iter','250000','-in',path.join(encrypted,'memphis-zoo-backup.tar.gz.enc'),'-out',tar,'-pass','env:BACKUP_ENCRYPTION_PASSPHRASE'],{env:{PATH:'/usr/bin:/bin',BACKUP_ENCRYPTION_PASSPHRASE:process.env.BACKUP_ENCRYPTION_PASSPHRASE}});fs.chmodSync(tar,0o600);
    const original=path.join(work,'original');fs.mkdirSync(original,{mode:0o700});extractSafe(tar,original);
    verified=api.materializeVerifiedArchive({sourceDir:original,archiveVerifyKey:process.env.BACKUP_MANIFEST_SIGNING_KEY,archiveVerifyKeyId:process.env.BACKUP_MANIFEST_SIGNING_KEY_ID,
      requiredEntries:['backup-summary.json','inventory/table-catalog.json','inventory/storage-buckets.json','inventory/storage-objects.json']});
    requireThat(verified.archiveDigest===p.archive_digest && verified.summary.project_ref===p.project_ref,'Authenticated original source differs.');
    const payload=path.join(work,'payload');fs.mkdirSync(payload,{mode:0o700});const provenance=path.join(payload,'original-provenance');fs.mkdirSync(provenance,{mode:0o700});
    fs.copyFileSync(zip,path.join(provenance,'original-artifact.zip'));fs.copyFileSync(tar,path.join(provenance,'original.tar.gz'));
    for(const name of ['archive-signature.json','backup-summary.json','SHA256SUMS'])fs.copyFileSync(path.join(verified.directory,name),path.join(provenance,name));
    const derivedKey=crypto.randomBytes(32).toString('hex'), derivedKeyId='g12-derived-'+process.env.GITHUB_RUN_ID;
    const derivation=deriveArchive(api,verified,path.join(payload,'derived-archive'),derivedKey,derivedKeyId);
    privateWrite(path.join(payload,'derived-key.json'),api.stableJsonFile({format:'custodial.g12.derived-archive-key.v1',key_id:derivedKeyId,key:derivedKey}));
    const binding={scope:'G12_LOCAL_REAL_DATA_ONLY_NOT_RELEASE_ADMISSION',repository:p.repository,original_run_id:p.backup_run_id,original_attempt:1,
      original_commit:p.backup_commit,original_artifact_id:p.backup_artifact_id,original_zip_sha256:p.original_zip_sha256,original_tar_sha256:hashFile(tar),
      archive_digest:p.archive_digest,project_ref:p.project_ref,transfer_run_id:Number(process.env.GITHUB_RUN_ID),transfer_attempt:1,transfer_control_commit:process.env.GITHUB_SHA,
      verifier_commit:p.verifier_commit,verifier_sources:p.verifier_sources,recipient_spki_sha256:p.recipient_spki_sha256,original_hmac_verified_in_ci:true,original_hmac_verified_locally:false,all_data_and_checksums_unchanged:true,...derivation};
    privateWrite(path.join(payload,'CI_VERIFICATION_AND_DERIVATION.json'),api.stableJsonFile(binding));
    const bundle=path.join(work,'recipient-payload.tar.gz');child('/usr/bin/tar',['-czf',bundle,'-C',work,'payload']);fs.chmodSync(bundle,0o600);
    const envelope=await sealFile(bundle,path.join(output,'verified-derived-backup.g12enc'),p.recipient_public_key_pem,binding);
    privateWrite(path.join(output,'CIPHERTEXT_CUSTODY.json'),api.stableJsonFile({format:FORMAT,binding,ciphertext_sha256:envelope.ciphertext_sha256,ciphertext_bytes:envelope.ciphertext_bytes,
      original_keys_exported:false,sender_authentication:'Exact reviewed GitHub run and actual artifact digest must be independently collected; recipient encryption alone is not sender authentication.'}));
    emitted=true;
  }finally{
    let cleanupFailure;
    try{verified?.cleanup();}catch(e){cleanupFailure=e;}
    try{clean();}catch(e){cleanupFailure=e;}
    process.off('SIGTERM',abort);process.off('SIGINT',abort);
    if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;
    if((!emitted || cleanupFailure)&&outputIdentity){const actual=fs.lstatSync(output);requireThat(actual.isDirectory()&&!actual.isSymbolicLink()&&actual.dev===outputIdentity.dev&&actual.ino===outputIdentity.ino,'Foreign output preserved.');fs.rmSync(output,{recursive:true});}
    if(cleanupFailure)throw cleanupFailure;
  }
  requireThat(!fs.existsSync(work),'Plaintext cleanup incomplete.');
  console.log(JSON.stringify({scope:'G12_DERIVED_TRANSFER_ONLY',ciphertext_prepared:true,plaintext_work_directory_removed:true,original_keys_exported:false}));
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{
    if(process.argv.length===3 && process.argv[2]==='--cleanup'){
      const parent=fs.realpathSync(process.env.RUNNER_TEMP||'');const owner=path.join(parent,'g12-transfer-owned-work.json');
      if(fs.existsSync(owner))console.log(JSON.stringify(cleanupOwnedWork(owner,parent)));
      else console.log(JSON.stringify({owned_work_receipt_present:false,cleanup_claim:'NO_RECORDED_RESOURCE_AUTHORITY'}));
    }else{requireThat(process.argv.length===4 && process.argv[2]==='--prepare','Only --prepare <reviewed-plan> or --cleanup is supported.');await prepare(process.argv[3]);}
  }
  catch{console.error('G12 transfer refused; no restore or release admission.');process.exitCode=1;}
}
