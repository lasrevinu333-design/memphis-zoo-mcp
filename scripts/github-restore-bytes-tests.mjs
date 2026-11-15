// Exact writer/client with inert provider. Valid empty bytes differ from an absent body.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {restoreFileFromRef} from '../src/github/write.js';
import {normalizeRawContentToBuffer} from '../src/github/client.js';
const savedLimit=process.env.MCP_GITHUB_WRITE_MAX_BYTES,sha='1'.repeat(40),sourceRef='a'.repeat(40);let cases=0;
const hex=b=>b.toString('hex'),digest=b=>createHash('sha256').update(b).digest('hex');
async function check(options){
 const {name,bytes=Buffer.from('new π 😀\r\n'),old=Buffer.from('previous\n'),dry=false,stale=false,refuse=false,cap}=options;
 const raw=Object.hasOwn(options,'raw')?options.raw:bytes;
 if(cap)process.env.MCP_GITHUB_WRITE_MAX_BYTES=String(cap);else if(savedLimit===undefined)delete process.env.MCP_GITHUB_WRITE_MAX_BYTES;else process.env.MCP_GITHUB_WRITE_MAX_BYTES=savedLimit;
 let rawReads=0;const writes=[];
 const repos={
  async getContent(q){assert.equal(q.ref,'target-branch');return{data:{type:'file',sha,size:old.length,content:old.toString('base64'),encoding:'base64'}};},
  async createOrUpdateFileContents(q){writes.push(q);return{data:{content:{sha:'2'.repeat(40)},commit:{html_url:'https://synthetic.invalid/commit'}}};},
 };
 const github={owner:'synthetic-owner',defaultRepo:'synthetic-repo',allowedRepos:['synthetic-repo'],branch:'main',octokit:{
  rest:{repos},
  async request(_route,q){rawReads++;assert.equal(q.ref,sourceRef);return{data:raw};},
 }};
 const work=()=>restoreFileFromRef({github,path:'asset.dat',repo:'synthetic-repo',branch:'target-branch',source_ref:sourceRef,expected_sha:stale?'9'.repeat(40):sha,commit_message:'Synthetic exact byte restore',dry_run:dry});
 if(refuse||stale){await assert.rejects(work);assert.equal(writes.length,0);if(stale)assert.equal(rawReads,0);}
 else{
  const result=await work(),changed=!bytes.equals(old);assert.equal(result.ok,true);assert.equal(result.preview.changed,changed);assert.equal(writes.length,changed&&!dry?1:0);
  if(writes.length){assert.equal(hex(Buffer.from(writes[0].content,'base64')),hex(bytes));assert.equal(writes[0].sha,sha);assert.equal(writes[0].branch,'target-branch');}
  if(result.preview.binary){assert.equal(result.preview.new_sha256,digest(bytes));assert.equal(result.preview.old_sha256,digest(old));assert.equal(result.preview.summary.new_bytes,bytes.length);assert.equal(result.preview.newText,undefined);}
  if(dry&&changed)assert.equal(result.dry_run,true);
 }
 cases++;console.log('PASS '+name);
}
try{
 const binary=Buffer.from([0x89,0x50,0x4e,0x47,0,0xff,0xfe,0x80]),padded=Buffer.concat([Buffer.from([1,2]),binary,Buffer.from([3])]);
 for(const [form,raw]of [['buffer',binary],['arraybuffer',binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength)],['typed-offset',new Uint8Array(padded.buffer,padded.byteOffset+2,binary.length)],['dataview-offset',new DataView(padded.buffer,padded.byteOffset+2,binary.length)]])for(const dry of [false,true])await check({name:form+(dry?'-dry':''),bytes:binary,raw,dry});
 for(const raw of [Buffer.alloc(0),'',new Uint8Array(0),new ArrayBuffer(0)])await check({name:'valid-empty-'+typeof raw,bytes:Buffer.alloc(0),raw});
 await check({name:'binary-no-op',bytes:binary,old:binary});
 await check({name:'different-invalid-UTF8-is-not-no-op',bytes:Buffer.from([0x81]),old:Buffer.from([0x80])});
 await check({name:'empty-target',old:Buffer.alloc(0)});
 for(const raw of [undefined,null,{},7,false,Symbol('not bytes'),'\ud800'])for(const dry of [false,true])await check({name:'malformed-'+typeof raw+(dry?'-dry':''),raw,refuse:true,dry});
 for(const text of ['Unicode π 😀\r\n','literal replacement �','plain text'])await check({name:'valid-unicode-text',bytes:Buffer.from(text),raw:text});
 await check({name:'stale-before-raw-read',stale:true});
 await check({name:'byte-cap-equal-binary',bytes:Buffer.alloc(32,0x80),raw:Buffer.alloc(32,0x80),cap:32});
 await check({name:'byte-cap-plus-one',bytes:Buffer.alloc(33,0x80),raw:Buffer.alloc(33,0x80),cap:32,refuse:true});
 for(const raw of [binary,new Uint8Array(padded.buffer,padded.byteOffset+2,binary.length),new DataView(padded.buffer,padded.byteOffset+2,binary.length)]){const owned=normalizeRawContentToBuffer(raw),before=Buffer.from(owned);if(Buffer.isBuffer(raw))raw[0]^=1;else new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength)[0]^=1;assert.deepEqual(owned,before);cases++;}
 console.log(JSON.stringify({suite:'github-restore-exact-bytes',cases,result:'PASS',actual_writer_and_raw_normalizer:true,synthetic_provider_only:true}));
}finally{if(savedLimit===undefined)delete process.env.MCP_GITHUB_WRITE_MAX_BYTES;else process.env.MCP_GITHUB_WRITE_MAX_BYTES=savedLimit;}
