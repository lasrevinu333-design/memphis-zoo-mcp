import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,readFileSync,openSync,fstatSync,closeSync,mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import * as current from '../src/static-weekly-schedule-program.js';
// Pure representation proof. No engine, solver, receipt fabrication or
// publication. --actual additionally checks the privately retained exact LP;
// the portable run NEVER claims that omitted private artifact was examined.
const sha=v=>createHash('sha256').update(v).digest('hex');
const BASE='b2e70ef652ec4aef05252d1890136f9fa66a5fa2ac97aba40d6b76d0815be068';
const FINAL='1a5ef78107964d823f1a1eaf617b9d5e439339122730ac4691bd671199a4da52';
const SOURCE=new URL('../src/static-weekly-schedule-program.js',import.meta.url);
const text=readFileSync(SOURCE,'utf8');
const helperStart='// Once every daily rank is independently fixed to an endpoint of the same\n';
const buildStart='export function buildStaticWeeklySchedulingModel(problem, bindings, objective, deadline = null) {';
const linkStart='    const fixedValues = fixedBinaryDailyRankValues(prefix, loads, ranks, maximum, bindings, new Set(x.values()));\n';
const linkEnd='    ranks.slice(0, -1).forEach';
const originalLink='    loads.forEach((entry, itemIndex) => ranks.forEach((rank, rankIndex) => { const permutation = permutations[itemIndex][rankIndex]; constraints.push({ name: `${prefix}_link_lo_${itemIndex + 1}_${rankIndex + 1}`, terms: [[1, rank], ...entry.terms.map(([coefficient, variable]) => [-coefficient, variable]), [-maximum, permutation]], relation: ">=", value: entry.constant - maximum }); constraints.push({ name: `${prefix}_link_hi_${itemIndex + 1}_${rankIndex + 1}`, terms: [[1, rank], ...entry.terms.map(([coefficient, variable]) => [-coefficient, variable]), [maximum, permutation]], relation: "<=", value: entry.constant + maximum }); }));\n';
export function reverseFixedRankLinks(source){
 assert.equal(sha(source),FINAL,'Exact final product bytes required');
 for(const needle of [helperStart,buildStart,linkStart,linkEnd])assert.equal(source.split(needle).length,2,'Unique guarded source seam');
 const begin=source.indexOf(helperStart),end=source.indexOf(buildStart,begin);
 let previous=source.slice(0,begin)+source.slice(end);
 const a=previous.indexOf(linkStart),b=previous.indexOf(linkEnd,a);
 assert.ok(a>=0&&b>a);previous=previous.slice(0,a)+originalLink+previous.slice(b);
 assert.equal(sha(previous),BASE,'Exact two-hunk reversal; unrelated drift forbidden');return previous;
}
async function moduleFrom(source){
 const resolved=source.replace(/from "(\.\/[^"\n]+)"/g,(_,relative)=>`from "${new URL(relative,SOURCE).href}"`);
 const directory=mkdtempSync(join(tmpdir(),'custodial-fixed-ranks-')),file=join(directory,'program.mjs');
 try{writeFileSync(file,resolved,{flag:'wx',mode:0o600});return await import(pathToFileURL(file).href);}
 finally{unlinkSync(file);rmdirSync(directory);}
}
const same=(a,b,label)=>assert.equal(isDeepStrictEqual(a,b),true,label);
function sourceInput(count){
 const slots=Array.from({length:count},(_,i)=>({id:`s${i}`,label:`synthetic-${i}`,incumbencies:[{personId:`p${i}`,displayName:`Synthetic ${i}`,effectiveStart:'2020-01-01',effectiveEnd:null}]}));
 return{serviceDate:'2026-08-10',timezone:'America/Chicago',exceptions:[],proximity:[],slots,versions:[{id:'synthetic-fixed-rank-source',publicationId:'synthetic-fixed-rank-publication',status:'published',effectiveStart:'2026-08-03',effectiveEnd:null,
 objective:{requireVerifiedProximity:true},slotAvailability:slots.map(s=>({slotId:s.id,dayOfWeek:1,status:'working',shift:{start:'07:00',end:'16:00'},productiveCapacityProvenance:'synthetic-shift',maxServiceEffortMinutes:300,maxServiceEffortProvenance:'synthetic-max',qualifications:['general'],qualificationProvenance:'synthetic-credential',restrictions:[],restrictionProvenance:'synthetic-restriction',acceptedRouteAnchorLocationId:'A',acceptedRouteProvenance:'synthetic-route'})),
 assignments:[{workId:'one',dayOfWeek:1,locationId:'A',window:{start:'08:00',end:'09:00'},ownerSlotId:slots[0].id,serviceEffortMinutes:20,serviceEffortProvenance:'synthetic-effort',priority:2,priorityProvenance:'synthetic-priority',requiredQualifications:['general'],qualificationProvenance:'synthetic-qualification',restrictions:[],restrictionProvenance:'synthetic-restriction'}]}]};
}
function shape(n=3,M=5){return{prefix:'daily_rank',loads:Array.from({length:n},(_,i)=>({constant:0,upper:M,terms:[[M,`x_${i}`]]})),ranks:Array.from({length:n},(_,i)=>`daily_rank_${i+1}`),maximum:M,
 bindings:Array.from({length:n},(_,i)=>({name:`daily_service_effort_utilization_rank_${i+1}`,terms:[[1,`daily_rank_${i+1}`]],value:i?0:M})),assignmentVariables:new Set(Array.from({length:n},(_,i)=>`x_${i}`))};}
const derive=(helper,s)=>helper(s.prefix,s.loads,s.ranks,s.maximum,s.bindings,s.assignmentVariables);
const rowValue=(row,values)=>row.terms.reduce((total,[c,v])=>total+BigInt(c)*BigInt(values.get(v)),0n);
function satisfies(row,values){const value=rowValue(row,values),rhs=BigInt(row.value);return row.relation==='='?value===rhs:row.relation==='>='?value>=rhs:value<=rhs;}
function compareModels(oldModel,newModel){
 assert.equal(oldModel.error,undefined);assert.equal(newModel.error,undefined);
 const oldRows=oldModel.modelBasis.constraints.rows,newRows=newModel.modelBasis.constraints.rows;
 const original=oldRows.filter(r=>/^daily_rank_link_(lo|hi)_/.test(r.name));
 const matching=newRows.filter(r=>/^daily_rank_link_match_/.test(r.name));
 assert.equal(original.length,2*matching.length);
 same(oldRows.filter(r=>!/^daily_rank_link_(lo|hi)_/.test(r.name)),newRows.filter(r=>!/^daily_rank_link_match_/.test(r.name)),'Every ordered non-link row preserved');
 same(oldModel.objective,newModel.objective,'Exact objective/order unchanged');same(oldModel.priorBindings,newModel.priorBindings,'All ordered bindings unchanged');
 same([...oldModel.binary],[...newModel.binary],'All binary variables/order unchanged');same([...oldModel.general],[...newModel.general],'All rank variables/order unchanged');
 same(oldModel.expressions,newModel.expressions,'All generated objective families unchanged');same(oldModel.routeCanonicality,newModel.routeCanonicality,'Routes unchanged');
 same(oldModel.dailyLoads,newModel.dailyLoads,'All actual load identities/coefficients unchanged');
 // All LP text outside the unique changed link rows is also exact, including
 // Bounds/Binary/General, fixed equalities, objective and row evaluation order.
 const strip=(lp,re)=>lp.split('\n').filter(line=>!re.test(line)).join('\n');
 assert.equal(strip(oldModel.lp,/^ daily_rank_link_(lo|hi)_/),strip(newModel.lp,/^ daily_rank_link_match_/));
 assert.notEqual(oldModel.modelDigest,newModel.modelDigest);assert.notEqual(oldModel.modelBasisDigest,newModel.modelBasisDigest);assert.notEqual(sha(oldModel.lp),sha(newModel.lp));
 assert.equal(oldModel.priorBindingDigest,newModel.priorBindingDigest);
 const oldMap=new Map(oldRows.map(r=>[r.name,r])),fixed=new Map(oldModel.priorBindings.flatMap(b=>b.terms.length===1&&b.terms[0][0]===1?[[b.terms[0][1],b.value]]:[]));
 let truthCases=0;
 for(let i=0;i<oldModel.dailyRank.loads.length;i++)for(let j=0;j<oldModel.dailyRank.ranks.length;j++){
  const load=oldModel.dailyRank.loads[i],rank=oldModel.dailyRank.ranks[j],p=oldModel.dailyRank.permutations[i][j],M=oldModel.dailyRank.maximum;
  assert.equal(load.constant,0);same(load.terms,[[M,load.terms[0][1]]],'Single source binary');assert.equal(load.upper,M);
  const lo=oldMap.get(`daily_rank_link_lo_${i+1}_${j+1}`),hi=oldMap.get(`daily_rank_link_hi_${i+1}_${j+1}`),reduced=matching[i*oldModel.dailyRank.ranks.length+j];
  same(lo.terms,[[1,rank],[-M,load.terms[0][1]],[-M,p]],'Original lower algebra');same(hi.terms,[[1,rank],[-M,load.terms[0][1]],[M,p]],'Original upper algebra');
  for(const x of [0,1])for(const bit of [0,1]){const values=new Map([[rank,fixed.get(rank)],[load.terms[0][1],x],[p,bit]]);assert.equal(satisfies(lo,values)&&satisfies(hi,values),satisfies(reduced,values));truthCases++;}
 }
 return{truthCases,originalRows:oldRows.length,newRows:newRows.length,originalTerms:oldRows.reduce((n,r)=>n+r.terms.length,0),newTerms:newRows.reduce((n,r)=>n+r.terms.length,0),variables:oldModel.binary.size+oldModel.general.size,
 oldLpSha256:sha(oldModel.lp),newLpSha256:sha(newModel.lp),oldModelDigest:oldModel.modelDigest,newModelDigest:newModel.modelDigest,oldBasisDigest:oldModel.modelBasisDigest,newBasisDigest:newModel.modelBasisDigest,priorBindingDigest:newModel.priorBindingDigest};
}
function privateFile(file,digest,size){
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);assert.ok(s.isFile()&&s.uid===process.getuid());assert.equal(s.mode&0o777,0o600);if(size!==null)assert.equal(s.size,size);else assert.ok(s.size>0&&s.size<=16*1024*1024);const bytes=readFileSync(fd);assert.equal(sha(bytes),digest);return bytes;}finally{closeSync(fd);}
}
async function actualProof(legacy){
 const directory='/home/eric/Documents/Codex/2026-10-02/place-lifecycle-worker/native-highs-growth-actual-20261003-2314';
 const inputFile=join(directory,'input.json'),inputBytes=privateFile(inputFile,'d2b0e74eecfb2e6e0c98747a5435fe1d0797b08bc1ed195eb86b61f71666e7f4',null);
 const input=JSON.parse(inputBytes);
 assert.equal(sha(JSON.stringify(input.source)),'5b2961200fb5be9615de9b473ad3281a940ce42e5f54aebfe98984e27521976f');
 const metadata=JSON.parse(privateFile(join(directory,'private-tier44/tier44.json'),'bcd8e31089e16c699d02d45e924b7f4660a2a1fe34893f6af175d1680784e6d3',51835));
 const lp=privateFile(join(directory,'private-tier44/tier44.lp'),'9361f4ff58519d938595f121a1aca9e69323bd95f31d3f8b798ff533c27fe5fa',574487).toString('utf8');
 const originalBytes=sha(JSON.stringify(input.source)),program=legacy.generateStaticWeeklySchedulingProgram(input.source),fresh=current.generateStaticWeeklySchedulingProgram(input.source);
 assert.equal(program.error,undefined);same(fresh,program,'Actual canonical seed/program byte identity unchanged');
 for(let i=0;i<43;i++){assert.equal(program.objectives[i].name,metadata.priorBindings[i].name);same(program.objectives[i].terms,metadata.priorBindings[i].terms,'Source-generated original prior terms');}
 const objective=program.objectives[43];assert.equal(objective.name,'daily_stable_id_rank_tie');
 const oldModel=legacy.buildStaticWeeklySchedulingModel(program.problem,metadata.priorBindings,objective),newModel=current.buildStaticWeeklySchedulingModel(fresh.problem,metadata.priorBindings,objective);
 assert.equal(oldModel.lp,lp,'Complete actual retained original LP equality');
 for(const key of ['modelDigest','modelBasisDigest','priorBindingDigest'])assert.equal(oldModel[key],metadata[key]);
 const proof=compareModels(oldModel,newModel);assert.equal(proof.truthCases,7056);assert.equal(proof.originalRows,3954);assert.equal(proof.newRows,2190);assert.equal(proof.originalTerms,14915);assert.equal(proof.newTerms,7859);assert.equal(proof.variables,2023);
 assert.equal(newModel.priorBindings.length,43);assert.equal(sha(JSON.stringify(input.source)),originalBytes);
 // Complete fallback models remain identical, not merely equal digests.
 let fallbacks=0;
 for(const mutate of [b=>b.pop(),b=>{b[1].value=17;},b=>b.push(structuredClone(b[1])),b=>{b[1].name='wrong';},b=>{b[1].terms[0][0]=2;},b=>{[b[1],b[2]]=[b[2],b[1]];},b=>b.push({name:'foreign',terms:[[1,'daily_rank_1']],value:35})]){
  const bindings=structuredClone(metadata.priorBindings);mutate(bindings);
  same(current.buildStaticWeeklySchedulingModel(fresh.problem,bindings,objective),legacy.buildStaticWeeklySchedulingModel(program.problem,bindings,objective),'Exact actual hostile/unsupported original fallback');fallbacks++;
 }
 return{...proof,actualFallbackModels:fallbacks,requestSha256:originalBytes,originalMetadataSha256:'bcd8e31089e16c699d02d45e924b7f4660a2a1fe34893f6af175d1680784e6d3',originalLPImmutable:true};
}
export async function runStaticWeeklyFixedRankLinkTests({actual=false}={}){
 const started=performance.now();let checks=0;
 const previous=reverseFixedRankLinks(text);checks++;
 for(const bad of [text+'\n',text.replace(linkStart,linkStart+linkStart),text.replace('const modelBytes =','const modelBytesX =')]){assert.throws(()=>reverseFixedRankLinks(bad));checks++;}
 const legacy=await moduleFrom(previous),privateModule=await moduleFrom(text+'\nexport { fixedBinaryDailyRankValues as __testFixedValues };\n'),helper=privateModule.__testFixedValues;
 for(const [file,digest]of [['static-weekly-schedule-model.js','23fd769ded7a126c6dc61c0421a7a2bb96e0073cbae048440910de192d16738e'],['static-weekly-schedule-verifier.js','1700488fafa6e7683aed9ba11e1d6b0eb9800ed4a19d2713410a987417bfcabf'],['static-weekly-schedule-compiler.js','593893e4daac566fa665bb987af17ce803414c92ebd59abf6e8a24aed2361f1a']]){assert.equal(sha(readFileSync(new URL('../src/'+file,import.meta.url))),digest);checks++;}
 const verifier=readFileSync(new URL('../src/static-weekly-schedule-verifier.js',import.meta.url),'utf8');
 assert.ok(verifier.includes('generateStaticWeeklySchedulingProgram(input, null, deadline)'));assert.ok(verifier.includes('iterateStaticWeeklySchedulingWitnessTiers(regenerated, witnessByName, deadline)'));checks+=2;
 same(derive(helper,shape()),[5,0,0],'Supported endpoint bindings');checks++;
 const mutations=[s=>s.prefix='weekly_rank',s=>s.maximum=0,s=>s.maximum=NaN,s=>s.maximum=Number.MAX_SAFE_INTEGER+1,s=>s.loads[0].constant=1,s=>s.loads[0].upper++,s=>s.loads[0].terms.push([5,'x_9']),s=>s.loads[0].terms[0][0]=4,s=>s.loads[0].terms[0][1]='u_0',s=>s.assignmentVariables.delete('x_0'),s=>s.loads[1].terms[0][1]='x_0',s=>s.bindings.pop(),s=>s.ranks.pop(),s=>s.bindings[0].value=2,s=>s.bindings[0].terms.push([1,'daily_rank_2']),s=>s.bindings[0].terms[0][0]=2,s=>s.bindings[0].terms[0][1]='daily_rank_2',s=>s.bindings[0].name='forged',s=>s.bindings.push(structuredClone(s.bindings[0])),s=>{[s.bindings[0],s.bindings[1]]=[s.bindings[1],s.bindings[0]];},s=>s.bindings.push({name:'foreign',terms:[[1,'daily_rank_1']],value:5}),s=>s.bindings[2].value=5];
 for(const mutation of mutations){const s=shape();mutation(s);assert.equal(derive(helper,s),null);checks++;}
 let completeTruthCases=0,completeFeasibleCases=0,cellTruthCases=0;
 for(let M=1;M<=5;M++)for(const r of [0,M])for(const x of [0,1])for(const p of [0,1]){assert.equal(r-M*x-M*p>=-M&&r-M*x+M*p<=M,r===M?p<=x:p+x<=1);cellTruthCases++;}
 checks++;
 // Enumerate complete assignment/permutation vectors, including invalid
 // matching matrices, preserving every objective coefficient and fixed rank.
 for(let n=1;n<=3;n++)for(let high=0;high<=n;high++)for(let xmask=0;xmask<(1<<n);xmask++)for(let pmask=0;pmask<(1<<(n*n));pmask++){
  const M=5,x=Array.from({length:n},(_,i)=>(xmask>>i)&1),r=Array.from({length:n},(_,j)=>j<high?M:0),p=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>(pmask>>(i*n+j))&1));
  const match=p.every(row=>row.reduce((a,b)=>a+b,0)===1)&&p[0].every((_,j)=>p.reduce((a,row)=>a+row[j],0)===1);
  const original=match&&p.every((row,i)=>row.every((bit,j)=>r[j]-M*x[i]-M*bit>=-M&&r[j]-M*x[i]+M*bit<=M)),changed=match&&p.every((row,i)=>row.every((bit,j)=>r[j]===M?bit<=x[i]:bit+x[i]<=1));
  assert.equal(original,changed);completeTruthCases++;if(original){const oldCost=p.reduce((a,row,i)=>a+row.reduce((b,bit,j)=>b+(n-i)*(j+1)*bit,0),0),newCost=p.flatMap((row,i)=>row.map((bit,j)=>(n-i)*(j+1)*bit)).reduce((a,b)=>a+b,0);assert.equal(oldCost,newCost);completeFeasibleCases++;}
 }
 checks+=2;
 const tiny=[];
 for(let n=1;n<=4;n++){
  const input=sourceInput(n),oldProgram=legacy.generateStaticWeeklySchedulingProgram(input),program=current.generateStaticWeeklySchedulingProgram(input);assert.equal(program.error,undefined);same(program,oldProgram,'Complete seed and all source-generated objectives unchanged');checks+=2;
  const initial=legacy.buildStaticWeeklySchedulingModel(oldProgram.problem,[],oldProgram.objectives[0]);same(current.buildStaticWeeklySchedulingModel(program.problem,[],program.objectives[0]),initial,'Unfixed initial model exact original');checks++;
  const seed=legacy.buildStaticWeeklySchedulingModel(oldProgram.problem,[],{name:'seed',family:'seed',terms:[]});
  const binding=oldProgram.objectives.filter(o=>o.family==='daily_leximax').map((o,i)=>({name:o.name,terms:o.terms,value:i?0:seed.dailyRank.maximum}));
  const objective=oldProgram.objectives.find(o=>o.family==='daily_stable_tie');
  tiny.push(compareModels(legacy.buildStaticWeeklySchedulingModel(oldProgram.problem,binding,objective),current.buildStaticWeeklySchedulingModel(program.problem,binding,objective)));checks++;
  for(const mutate of [b=>b.pop(),b=>b.push(structuredClone(b[0])),b=>{b[0].value=seed.dailyRank.maximum/2;},b=>{b[0].terms.push([1,'unknown']);},b=>{b[0].name='wrong';}]){
   const bad=structuredClone(binding);mutate(bad);
   same(current.buildStaticWeeklySchedulingModel(program.problem,bad,objective),legacy.buildStaticWeeklySchedulingModel(oldProgram.problem,bad,objective),'Complete unsupported portable model exact original fallback');checks++;
  }
  const mixed=structuredClone(program.problem);
  // A distinct second coefficient in every load is unsupported, even when
  // the same binary is repeated. No coalescing or dropped term is permitted.
  mixed.candidates.push(structuredClone(mixed.candidates[0]));
  same(current.buildStaticWeeklySchedulingModel(mixed,binding,objective),legacy.buildStaticWeeklySchedulingModel(mixed,binding,objective),'Duplicate candidate/term exact predecessor outcome');checks++;
  // Independently regenerated witness tiers: choose exactly one source x,
  // derive the rank values from it, and inspect the model when reaching tie.
  const witness=new Map([...seed.binary,...seed.general].map(v=>[v,0]));witness.set([...seed.x.values()][0],1);
  const oldIt=legacy.iterateStaticWeeklySchedulingWitnessTiers(oldProgram,witness),newIt=current.iterateStaticWeeklySchedulingWitnessTiers(program,witness);
  let boundTie=false;
  while(true){const oldStep=oldIt.next(),newStep=newIt.next();assert.equal(oldStep.done,newStep.done);if(oldStep.done)break;assert.equal(newStep.value.error,undefined);assert.equal(oldStep.value.value,newStep.value.value);same(oldStep.value.objective,newStep.value.objective,'Recomputed objective unchanged');
   if(newStep.value.objective.family==='daily_stable_tie'){compareModels(oldStep.value.model,newStep.value.model);boundTie=true;break;}same(oldStep.value.model,newStep.value.model,'Earlier unfixed tier exact original');}
  oldIt.return();newIt.return();assert.equal(boundTie,true);checks++;
 }
 const actualResult=actual?await actualProof(legacy):null;
 assert.ok(performance.now()-started<60000);
 return{status:'PASS',checks,cellTruthCases,completeTruthCases,completeFeasibleCases,hostileGuardCases:mutations.length,tiny,actual:actualResult,actualPrivateCaptureChecked:actual,sourceSha256:FINAL,predecessorSha256:BASE,elapsedMs:performance.now()-started,pid:process.pid,solver:false,engine:false,publication:false,independentlyProvesOptimality:false,allocationBenefitUnmeasured:true};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--actual'));
 console.log(JSON.stringify(await runStaticWeeklyFixedRankLinkTests({actual:process.argv[2]==='--actual'})));
}
