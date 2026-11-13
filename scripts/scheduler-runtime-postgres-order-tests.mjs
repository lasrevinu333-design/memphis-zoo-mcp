import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {postgresJsonbCanonicalText as current} from '../src/static-weekly-schedule-program.js';
import {postgresJsonbCanonicalText as prior} from './fixtures/runtime-predecessor/static-weekly-schedule-program.js';
const text=readFileSync(new URL('../src/static-weekly-schedule-program.js',import.meta.url),'utf8');
const start='function postgresJsonbOrderedKeys(',end='// PostgreSQL jsonb::text uses';
assert.equal(text.split(start).length,2);assert.equal(text.split(end).length,2);
const body=text.slice(text.indexOf(start),text.indexOf(end)).replace('export function','function');
const keys=['tier_10','tier_2','tier_01','A','a','Å','A\u030a','é','e\u0301','𐀀','📱','\ud800','\ud801','\udfff','\ufffd','\u0000','__proto__','constructor','1','01','001'];
const corpus=[Object.fromEntries(keys.slice().reverse().map((k,i)=>[k,i])),{a:1,bbb:2,zz:3},{b:1,a:2},Object.fromEntries([['\ud801',1],['\ud800',2]])];
let checks=0;for(const value of corpus){assert.equal(current(value),prior(value));checks++;}
const substitutions=[
 ['if(length)return length;','if(length)return -length;'],
 ['if(length)return length;','if(length)return 0;'],
 ['a.bytes[i]<b.bytes[i]?-1:1','a.bytes[i]<b.bytes[i]?1:-1'],
 ['return 0;\n  }).map','return a.key<b.key?-1:a.key>b.key?1:0;\n  }).map'],
 ['Object.keys(value || {})','Object.keys(value || {}).slice(1)'],
 ['Object.keys(value || {})','Object.keys(value || {}).concat(Object.keys(value || {}).slice(0,1))'],
 ['a.length-b.length','b.length-a.length'],
 ['a<b?-1:a>b?1:0','a<b?1:a>b?-1:0'],
 ['raw.every(key=>!/[^\\x00-\\x7f]/.test(key))','true'],
];
for(const [from,to]of substitutions){
 assert.equal(body.split(from).length,2,'one actual-current mutation target');
 const mutant=Function('postgresJsonbNumberText',body.replace(from,to)+';return postgresJsonbCanonicalText;')(String);
 assert.ok(corpus.some(value=>mutant(value)!==prior(value)),'current comparator mutation must fail the independent prior-byte oracle');checks++;
}
console.log(JSON.stringify({status:'PASS',checks,currentSourceMutants:9,originalSixMutantsRetained:true,SQL:false,app_build:false,phone:false}));
