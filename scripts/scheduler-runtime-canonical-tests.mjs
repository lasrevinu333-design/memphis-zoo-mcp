import assert from 'node:assert/strict';
import {canonicalJson as current,bytewiseCompare as currentCompare} from '../src/static-weekly-schedule-model.js';
import {canonicalJson as prior,bytewiseCompare as priorCompare} from './fixtures/runtime-predecessor/static-weekly-schedule-model.js';
const capture=fn=>{try{return{value:fn()};}catch(e){return{name:e.name,message:e.message,code:e.code};}};
let checks=0;
function compare(factory){const a=factory(prior),b=factory(current);assert.deepEqual(capture(()=>current(b.value)),capture(()=>prior(a.value)));if(a.trace)assert.deepEqual(b.trace,a.trace);checks++;}
for(const x of [null,true,false,0,-0,0.5,1e-7,1e21,1e-300,Number.MAX_VALUE,'"\n📱\ud800',[],[1,,3],{a:1,bbb:{z:2,a:3}},Object.create(null),new Date(0),new Map([['a',1]]),new Uint16Array([1,500]),undefined,NaN,Infinity,-Infinity,1n,Symbol('s'),()=>1])compare(()=>({value:x}));
const keys=['tier_10','tier_2','tier_01','A','a','é','e\u0301','𐀀','📱','\ud800','\ud801','\ufffd','\u0000','__proto__','constructor','1','01'];
for(const order of[keys,keys.slice().reverse()]){
 compare(()=>({value:Object.fromEntries(order.map((k,i)=>[k,i]))}));
 compare(()=>{const trace=[],value={};for(const k of order)Object.defineProperty(value,k,{enumerable:true,get(){trace.push(k);return k;}});return{value,trace};});
}
compare(()=>{const trace=[],value={a:1,z:2};Object.defineProperty(value,'b',{enumerable:true,get(){trace.push('b');delete value.z;value.new='not included';return 3;}});return{value,trace};});
compare(()=>{const trace=[],value=new Proxy({b:2,a:1},{ownKeys(t){trace.push('keys');return Reflect.ownKeys(t).reverse();},getOwnPropertyDescriptor(t,k){trace.push('descriptor:'+k);return Reflect.getOwnPropertyDescriptor(t,k);},get(t,k,r){trace.push('get:'+String(k));return Reflect.get(t,k,r);}});return{value,trace};});
compare(()=>{const trace=[],value=[1,2];Object.defineProperty(value,'map',{get(){trace.push('map');return Array.prototype.map;}});return{value,trace};});
compare(()=>{const trace=[];class Custom extends Array{static get[Symbol.species](){trace.push('species');return Array;}}return{value:new Custom(1,2),trace};});
compare(fn=>{const trace=[],value=[1,2];value.map=function(callback){trace.push('callback-identity:'+String(callback===fn));return Array.prototype.map.call(this,callback);};return{value,trace};});
compare(fn=>{const trace=[],value={};Object.defineProperty(value,'a',{enumerable:true,get(){trace.push(fn({z:2,a:1}));return{b:3,a:4};}});return{value,trace};});
// Reentrant failures caught by a getter must not end the outer encoding scope.
compare(fn=>{const trace=[],value={};Object.defineProperty(value,'a',{enumerable:true,get(){trace.push(capture(()=>fn({bad:NaN})));trace.push(fn({z:2,a:1}));return{z:'changed',a:4};}});value.z={a:5,z:6};return{value,trace};});
// An uncaught outer failure must release all invocation-local encoding facts.
compare(fn=>{const trace=[capture(()=>fn({a:{z:3,a:NaN}}))];return{value:{z:'after error',a:{z:2,a:1}},trace};});
let seed=0x20261113;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
function tree(depth){if(!depth)return[null,true,false,-0,1e-7,'📱\ud800'][rand()%6];if(rand()%3===0)return Array.from({length:rand()%5},()=>tree(depth-1));const value={};for(let i=0,n=rand()%7;i<n;i++)value[keys[rand()%keys.length]]=tree(depth-1);return value;}
for(let i=0;i<1000;i++){const bits=new Uint32Array([rand(),rand()]),number=new Float64Array(bits.buffer)[0];compare(()=>({value:number}));}
for(let i=0;i<1000;i++){const value=tree(4);compare(()=>({value:structuredClone(value)}));}
for(const limit of[255,256,257,512])compare(()=>({value:Array.from({length:limit},(_,i)=>({['shape_'+i]:i,common:{z:i,a:-i}}))}));
compare(()=>({value:Object.fromEntries(Array.from({length:200},(_,i)=>['x'.repeat(50)+i,i]))}));
compare(()=>{const value={};value.self=value;return{value};});
const value={a:{b:1}};const initial=current(value);value.a.b++;assert.notEqual(current(value),initial);assert.equal(current(value),prior(value));checks++;
for(const a of ['',...keys,'ascii','abc','a','abc def','😀z','😀','\ud800','\ud801',123,null,undefined])for(const b of ['',...keys,'ascii','a','abc def','😀z','😀','\ud800','\ud801',123,null,undefined]){assert.equal(currentCompare(a,b),priorCompare(a,b));checks++;}
console.log(JSON.stringify({status:'PASS',checks,comparison:'exact current vs frozen prior canonical text, error class/message/code, getter/proxy/species/callback identity traces; no data/digest reuse'}));
