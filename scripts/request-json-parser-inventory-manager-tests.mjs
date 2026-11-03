// Regression: the production general middleware must preserve each owning original-byte parser.
// Real loopback HTTP and current route composition; authentication/SQL ports are synthetic.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];
const require=createRequire(root+'/backend/package.json'),express=require('express');
const {createGeneralJsonMiddleware,createGeneralUrlencodedMiddleware}=await import(pathToFileURL(root+'/backend/src/request-json-parser.js'));
const {installOriginalInventorySeparationManagerComposition:install}=await import(pathToFileURL(root+'/backend/src/original-inventory-separation-manager-composition.js'));
const {createInventoryManagerCompositionFixture:createFixture}=await import(pathToFileURL(root+'/backend/scripts/original-inventory-separation-manager-tests.mjs'));
const fixture=createFixture({rpcFormat:'object'}),preview=await fixture.invoke('preview');
if(preview.res.statusCode!==200)throw Error('Current joined synthetic fixture must qualify independently before HTTP composition');
const headers={...preview.req.headers,'content-type':'application/json'};
const app=express();app.use(createGeneralJsonMiddleware());app.use(createGeneralUrlencodedMiddleware());
const installed=install(app,fixture.dependencies),cases=[];
app.post('/general-control',(req,res)=>res.json({body:req.body,raw:req.scanAuthorityRawBody!==undefined}));
app.use((error,req,res,next)=>res.status(error.status||500).json({generalParserError:true,type:error.type}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
async function check(name,path,body,verify,expected,extra={}){
 const before=fixture.calls.length;
 const r=await fetch(base+path,{method:'POST',headers:{...headers,...extra},body});const actual={status:r.status,body:await r.json(),calls:fixture.calls.slice(before).map(c=>({name:c.name,original_utf8:c.args.p_original_utf8}))};
 cases.push({name,expected,actual,pass:verify(actual)});
 if(out)fs.writeFileSync(out,JSON.stringify({in_progress:true,cases},null,2)+'\n');
}
try{
 const raw='\n '+JSON.stringify(fixture.original,null,2)+'\t';
 await check('current inventory approval uses original exact HTTP bytes',installed.paths.confirm,raw,a=>a.status===200&&a.calls.some(c=>c.name.endsWith('issue_v1')&&c.original_utf8===raw),'200 from actual parser/auth/composition using synthetic manager and SQL ports; exact original request supplied');
 await check('original inventory outcome read does not reissue',installed.paths.originalStatus,raw,a=>a.status===200&&a.calls.length===1&&a.calls[0].name.endsWith('status_v1')&&a.calls[0].original_utf8===raw,'200, one original status read, zero issue RPCs');
 await check('malformed inventory JSON belongs to bounded original parser',installed.paths.confirm,'{"schema":',a=>a.status===400&&a.body.code==='original_inventory_separation_body_invalid'&&a.calls.length===0,'400 dedicated parser body refusal before auth/SQL');
 await check('over-limit inventory body refused before SQL',installed.paths.confirm,JSON.stringify({a:'x'.repeat(8200)}),a=>a.status===413&&a.calls.length===0,'413 with zero SQL port calls');
 await check('query alias cannot become an original approval',installed.paths.confirm+'?alias=1',raw,a=>a.status===400&&a.calls.length===0,'400 exact-path refusal with zero SQL port calls');
 await check('general JSON remains ordinary','/general-control','{"number":1.25}',a=>a.status===200&&a.body.body?.number===1.25&&a.body.raw===false,'200 ordinary JSON floats, no original-byte authority');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
const report={scope:'Actual current general middleware plus actual inventory route/parser/auth/handler/composition; signed manager rows and SQL are explicit synthetic recording ports. No actual issuance, manager account, SQL database or native effect.',cases,passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length,server_closed:!server.listening};
if(out)fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
