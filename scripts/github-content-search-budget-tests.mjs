// Registered MCP handler, real schema/auth wrapper and immutable-blob reader.
// Only the existing GitHub client factory is synthetic. No network/provider IO.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url).pathname;
const modes=['stable','moving-inline','moving-raw','oversize','default-oversize','per-file-only','total-overflow','wrong-sha','wrong-blob-size','wrong-tree-size','missing-sha','wrong-encoding','unavailable','network','binary','empty'];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
for(const mode of modes){
 process.env.MCP_GITHUB_CONTENT_SEARCH_FILE_MAX_BYTES=mode==='default-oversize'?'1000000':'6';
 process.env.MCP_GITHUB_CONTENT_SEARCH_TOTAL_MAX_BYTES=mode==='per-file-only'?'20':mode==='default-oversize'?'20000000':'6';
 let reads=0,contentReads=0,received=0,paths=[];
 const over=['oversize','default-oversize','per-file-only'].includes(mode),length=mode==='default-oversize'?1000001:mode==='per-file-only'?7:over?12:3;
 const files=[{path:'one.txt',type:'blob',size:mode==='wrong-tree-size'?2:3,sha:mode==='missing-sha'?undefined:'blob-A'}];
 if(mode==='total-overflow')files.push({path:'two.txt',type:'blob',size:3,sha:'blob-B'},{path:'three.txt',type:'blob',size:1,sha:'blob-C'});
 const github={owner:'synthetic',defaultRepo:'allowed',allowedRepos:['allowed'],branch:'main',octokit:{rest:{git:{
  getTree:async()=>({data:{sha:'immutable-tree-A',truncated:false,tree:files}}),
  getBlob:async args=>{
   eq(args.owner,'synthetic');eq(args.repo,'allowed');assert.ok(files.some(f=>f.sha===args.file_sha));checks++;reads++;paths.push(args.file_sha);
   if(mode==='unavailable')throw Object.assign(Error('Synthetic missing blob'),{status:404});
   if(mode==='network')throw Error('Synthetic network failure');
   const text=mode==='binary'?Buffer.from([0,104,105]):mode==='empty'?Buffer.alloc(0):Buffer.from('hit'+'!'.repeat((mode==='total-overflow'&&reads===2?5:length)-3));received+=text.length;
   return{data:{sha:mode==='wrong-sha'?'new-blob':args.file_sha,size:mode==='wrong-blob-size'?4:text.length,encoding:mode==='wrong-encoding'?'utf-8':'base64',content:text.toString('base64')}};
  }
 },repos:{getContent:async()=>{contentReads++;const body=Buffer.from('hit'+'!'.repeat(9));return{data:{type:'file',sha:'new-branch-blob',size:12,encoding:mode==='moving-raw'?'none':'base64',content:mode==='moving-raw'?'':body.toString('base64')}};}}},request:async()=>{contentReads++;return{data:Buffer.from('hit'+'!'.repeat(9))};}}};
 const filename=root+'src/mcp/github-tools.js',module=new vm.SourceTextModule(readFileSync(filename,'utf8'),{identifier:pathToFileURL(filename).href});
 await module.link(async spec=>{const url=new URL(spec,pathToFileURL(filename)),actual=await import(url),values={...actual,...(spec==='../github/client.js'?{createGithubClient:()=>github}:{})},keys=Object.keys(values);return new vm.SyntheticModule(keys,function(){for(const key of keys)this.setExport(key,values[key]);});});await module.evaluate();
 const tools=new Map();module.namespace.registerGithubTools({registerTool(name,definition,handler){tools.set(name,{definition,handler})}},{includeWrites:false});
 const tool=tools.get('github_list_directory'),{z}=await import(pathToFileURL(root+'node_modules/zod/index.js'));
 const args=z.object(tool.definition.inputSchema).parse({path:'search-content:hit',max_entries:10});
 eq((await tool.handler(args,{})).isError,true);eq(reads,0);eq(contentReads,0);
 if(mode==='network'){
  await assert.rejects(()=>tool.handler(args,{authInfo:{scopes:['mcp:read']}}),/Synthetic network failure/);checks++;
 }else {
  const response=await tool.handler(args,{authInfo:{scopes:['mcp:read']}});
  eq(response.isError,undefined);const result=JSON.parse(response.content[0].text);
  eq(contentReads,0);eq(result.scanned_bytes,mode==='wrong-encoding'?0:received);
  if(['stable','moving-inline','moving-raw'].includes(mode)){eq(result.truncated,false);eq(result.entries[0].sha,'blob-A');eq(result.entries[0].size,3);eq(result.count,1);eq(reads,1);}
  else if(mode==='binary'){eq(result.truncated,false);eq(result.count,0);}
  else {eq(result.truncated,true);eq(result.count,mode==='total-overflow'?1:0);
   const reason=over?(mode==='per-file-only'||mode==='default-oversize'?'max_file_bytes':'max_total_bytes'):mode==='total-overflow'?'max_total_bytes':['wrong-encoding','unavailable'].includes(mode)?'file_unavailable':'content_identity_unconfirmed';
   assert.ok(result.incomplete_reasons.includes(reason),mode+': '+result.incomplete_reasons);checks++;
   if(mode==='total-overflow'){eq(paths,['blob-A','blob-B']);eq(result.scanned_bytes,8);}
   if(mode==='missing-sha')eq(reads,0);
  }
 }
 console.log(JSON.stringify({mode,immutable_blob_reads:reads,mutable_content_reads:contentReads,received_decoded_bytes:received,status:'PASS'}));
}
console.log(JSON.stringify({suite:'github-immutable-content-search',modes:modes.length,checks,status:'PASS',scope:'Actual registered MCP/schema/auth with synthetic provider only'}));
