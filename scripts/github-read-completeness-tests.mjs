import assert from'node:assert/strict';import{listDirectory,readFile}from'../src/github/read.js';
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
const files=[{path:'one.txt',type:'blob',size:3,sha:'one'},{path:'two.txt',type:'blob',size:3,sha:'two'}];
function fixture({tree=files,truncated=false,omit=false,missing=false}={}){
 let reads=0;
 const getTree=async()=>({data:{tree,...(omit?{}:{truncated})}});
 const getContent=async({path})=>{
  reads++;if(missing)throw Object.assign(Error('synthetic missing'),{status:404});
  return{data:{type:'file',path,size:3,content:Buffer.from('hit').toString('base64')}};
 };
 const getBlob=async({file_sha})=>{reads++;if(missing)throw Object.assign(Error('synthetic missing'),{status:404});return{data:{sha:file_sha,size:3,encoding:'base64',content:Buffer.from('hit').toString('base64')}};};
 const g={owner:'synthetic',defaultRepo:'allowed',allowedRepos:['allowed'],branch:'main',octokit:{rest:{git:{getTree,getBlob},repos:{getContent}}}};
 return{g,get reads(){return reads}};
}
async function limited(env,fn){const prior=new Map(Object.keys(env).map(k=>[k,process.env[k]]));try{Object.assign(process.env,env);return await fn();}finally{for(const[k,v]of prior)v===undefined?delete process.env[k]:process.env[k]=v;}}
for(const upstream of [true,false]){
 const f=fixture({truncated:upstream});const r=await listDirectory({github:f.g,recursive:true,maxEntries:10});check(r.truncated,upstream);check(r.upstream_truncated,upstream);check(r.count,2);check(r.total_matching,upstream?null:2);check(r.total_matching_exact,!upstream);check(r.observed_matching,2);check(f.reads,0);
}
{const f=fixture({omit:true}),r=await listDirectory({github:f.g,recursive:true});check(r.truncated,true);check(r.upstream_truncated,null);check(r.incomplete_reasons,['upstream_completeness_unknown']);check(r.total_matching,null);}
{const f=fixture(),r=await listDirectory({github:f.g,recursive:true,maxEntries:1});check(r.truncated,true);check(r.incomplete_reasons,['max_entries']);check(r.total_matching,2);check(r.count,1);}
{const f=fixture({tree:[]}),r=await listDirectory({github:f.g,recursive:true});check(r.truncated,false);check(r.total_matching,0);}
for(const[q,cap,expected]of [['search:txt',1,true],['search:one',1,false],['search:absent',1,false]]){
 const f=fixture(),r=await listDirectory({github:f.g,path:q,maxEntries:cap});check(r.truncated,expected);check(f.reads,0);
}
for(const q of ['search:absent','search-content:absent']){const f=fixture({truncated:true}),r=await listDirectory({github:f.g,path:q,maxEntries:10});check(r.truncated,true);check(r.upstream_truncated,true);check(r.count,0);}
for(const cap of [1,2,3]){const f=fixture(),r=await listDirectory({github:f.g,path:'search-content:hit',maxEntries:cap});check(r.truncated,cap<2);check(r.scanned_candidate_count,Math.min(cap,2));check(f.reads,Math.min(cap,2));check(r.count,Math.min(cap,2));check(r.scanned_bytes,3*Math.min(cap,2));}
await limited({MCP_GITHUB_CONTENT_SEARCH_MAX_CANDIDATES:'1'},async()=>{for(const tree of [files,files.slice(0,1)]){const f=fixture({tree}),r=await listDirectory({github:f.g,path:'search-content:hit',maxEntries:10});check(r.truncated,tree.length>1);check(f.reads,1);check(r.incomplete_reasons,tree.length>1?['max_candidates']:[]);}});
await limited({MCP_GITHUB_CONTENT_SEARCH_TOTAL_MAX_BYTES:'3'},async()=>{const f=fixture(),r=await listDirectory({github:f.g,path:'search-content:absent',maxEntries:10});check(r.truncated,true);check(r.incomplete_reasons,['max_total_bytes']);check(f.reads,1);check(r.count,0);check(r.scanned_bytes,3);});
await limited({MCP_GITHUB_CONTENT_SEARCH_TOTAL_MAX_BYTES:'6'},async()=>{const f=fixture(),r=await listDirectory({github:f.g,path:'search-content:absent',maxEntries:10});check(r.truncated,false);check(f.reads,2);check(r.count,0);});
{const f=fixture({missing:true}),r=await listDirectory({github:f.g,path:'search-content:hit',maxEntries:10});check(r.truncated,true);check(r.incomplete_reasons,['file_unavailable']);check(r.count,0);}
{const f=fixture();for(const repo of ['other','foreign/allowed']){await assert.rejects(()=>listDirectory({github:f.g,repo,recursive:true}),/not allowed/);checks++;}await assert.rejects(()=>readFile({github:f.g,path:'../outside'}),/segments/);checks++;await assert.rejects(()=>readFile({github:f.g,path:'one.txt',maxBytes:2}),/too large/);checks++;check(f.reads,1);}
console.log(JSON.stringify({suite:'github-read-completeness',checks,status:'PASS',external_reads:0}));
