import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import {readFileSync} from 'node:fs';
import {installStaticWeeklySha256HexAccelerator,canonicalJson,contentDigest} from '../src/static-weekly-schedule-model.js';
import {generateStaticWeeklySchedulingProgram,buildStaticWeeklySchedulingModel,createStaticWeeklySchedulingModelBuilder} from '../src/static-weekly-schedule-program.js';

installStaticWeeklySha256HexAccelerator(text=>createHash('sha256').update(text).digest('hex'),{
  schema:'memphis-zoo.sha256-incremental-native.v1',isProxy:types.isProxy,
  create(){const hash=createHash('sha256');return{writeUtf8:chunk=>hash.update(chunk),finishHex:()=>hash.digest('hex')};}
});
let checks=0;
const equal=(a,b,label)=>{assert.ok(isDeepStrictEqual(a,b),label);checks++;};
// Hash eligibility includes malformed/exotic arrays; fallback preserves their
// legacy serialization/error behavior. This is a representation test only.
const samples=[[],[[2,'x'],[-0,'y']],['\ud800','😀'],[null,true,false],new Array(3),Object.assign([1],{extra:2}),
  Object.defineProperty([1],Symbol('extra'),{value:2}),Object.defineProperty([1],'0',{enumerable:false}),
  Object.defineProperty([1],'0',{get(){return 7;}}),new Proxy([1,2],{}),[Infinity],[[undefined]],Object.create(null)];
const cyclic=[];cyclic.push(cyclic);samples.push(cyclic);
const outcome=fn=>{try{return{value:fn()};}catch(e){return{name:e.name,code:e.code,message:e.message};}};
for(const value of samples)equal(outcome(()=>contentDigest(value)),outcome(()=>createHash('sha256').update(canonicalJson(value)).digest('hex')),'canonical hash/error unchanged');

const bytes=readFileSync(new URL('./fixtures/six-person-absence-source.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469');
const source=JSON.parse(bytes).compilerInput;
const program=generateStaticWeeklySchedulingProgram({...source,versions:[source.version]},null);
assert.equal(program.error,undefined);
const problem=program.problem, original=structuredClone(problem),builder=createStaticWeeklySchedulingModelBuilder(problem);
const bindings=[];let first=null,last=null,terminalCount=0;
// Zero bindings are deliberate: compare canonical representations, without
// claiming this synthetic witness is feasible or proves optimality.
for(const objective of program.objectives){
  const expected=buildStaticWeeklySchedulingModel(original,bindings,objective);
  const actual=builder(bindings,objective);
  equal(actual,expected,`complete model ${objective.name}`);
  if(objective.family==='stable_identity'){
    terminalCount++;
    first??={bindings:structuredClone(bindings),objective:structuredClone(objective)};
    last={bindings:structuredClone(bindings),objective:structuredClone(objective)};
    // Poison the entire exposed basis; the next tier must remain detached.
    if(Object.isFrozen(actual.modelBasis.constraints.rows))assert.throws(()=>{actual.modelBasis.constraints.rows.length=0;});
    else actual.modelBasis.constraints.rows.length=0;
    actual.x.clear();actual.dailyLoads.length=0;
  }
  bindings.push({name:objective.name,terms:objective.terms,value:0});
}
assert.ok(terminalCount>1);
problem.work.length=0;
equal(builder(last.bindings,last.objective),buildStaticWeeklySchedulingModel(original,last.bindings,last.objective),'private problem snapshot');
for(const altered of [[],last.bindings.slice().reverse(),[...last.bindings,last.bindings[0]],
  [...last.bindings,{name:'foreign_rank_binding',terms:[[1,'daily_rank_1']],value:1}]]){
  equal(builder(altered,last.objective),buildStaticWeeklySchedulingModel(original,altered,last.objective),'rank-shape/binding fallback');
}
const independent=createStaticWeeklySchedulingModelBuilder(original);
equal(independent(first.bindings,first.objective),buildStaticWeeklySchedulingModel(original,first.bindings,first.objective),'independent builder');
assert.throws(()=>builder(last.bindings,last.objective,0));checks++;
console.log(JSON.stringify({status:'PASS',checks,terminalCount,solver:false,publication:false}));
