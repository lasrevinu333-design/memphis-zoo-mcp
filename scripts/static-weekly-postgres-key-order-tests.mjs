// Pure PostgreSQL JSONB serializer equivalence. No solver/SQL/preview/cache.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {postgresJsonbCanonicalText, postgresJsonbContentDigest} from '../src/static-weekly-schedule-program.js';
import {bytewiseCompare} from '../src/static-weekly-schedule-model.js';
import {createCurrentMorningIntegrationFixture} from './static-weekly-recurring-morning-integration-tests.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
// Independent predecessor algorithm from B10c, not an extracted candidate.
function predecessorNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError('postgres_jsonb_number_must_be_finite');
  const source = String(value);
  if (!/[eE]/.test(source)) return source;
  const [coefficient, exponentText] = source.toLowerCase().split('e');
  const exponent = Number(exponentText), negative = coefficient.startsWith('-');
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [whole, fractional = ''] = unsigned.split('.');
  const digits = `${whole}${fractional}`.replace(/^0+(?=\d)/, '') || '0';
  const decimalPosition = whole.length + exponent;
  let output;
  if (decimalPosition <= 0) output = `0.${'0'.repeat(-decimalPosition)}${digits}`;
  else if (decimalPosition >= digits.length) output = `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  else output = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  return negative && output !== '0' ? `-${output}` : output;
}
function predecessor(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return predecessorNumber(value);
  if (Array.isArray(value)) return `[${value.map(predecessor).join(', ')}]`;
  const utf8Length = (entry) => new TextEncoder().encode(entry).length;
  const keys = Object.keys(value || {}).sort((left, right) => utf8Length(left) - utf8Length(right) || bytewiseCompare(left, right));
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${predecessor(value[key])}`).join(', ')}}`;
}
const capture = (fn) => { try { return {text: fn()}; } catch (error) { return {error, name:error.name, message:error.message, code:error.code}; } };

export function runStaticWeeklyPostgresKeyOrderTests() {
  let checks = 0;
  const pins = {
    'src/static-weekly-schedule-model.js':'23fd769ded7a126c6dc61c0421a7a2bb96e0073cbae048440910de192d16738e',
    'scripts/static-weekly-recurring-morning-integration-tests.mjs':'b88670b8da89b5cfd96156fe1ae4fddb9ea03e1019da707442b3e48f4c37b871',
    'scripts/fixtures/six-person-absence-source.json':'882e5895d60338313b08f28ec327f2087468261749cdbac5dc7d78ac22e20469',
    'config/custodial-six-person-static-20261005.json':'40da4e1d4cce52b2361b5403b7e5e4477ca00def0fd3649a1d76dacb48422f30',
  };
  for (const [path, expected] of Object.entries(pins)) { assert.equal(sha(readFileSync(new URL('../'+path, import.meta.url))), expected, path+' drift'); checks++; }
  const equivalent = (factory) => {
    const before = factory(), after = factory();
    const left = capture(() => predecessor(before.value)), right = capture(() => postgresJsonbCanonicalText(after.value));
    assert.equal(right.text, left.text); assert.equal(right.name, left.name); assert.equal(right.message, left.message); assert.equal(right.code, left.code);
    if (before.trace) assert.deepEqual(after.trace, before.trace);
    if (before.expectedError) { assert.equal(left.error, before.expectedError); assert.equal(right.error, after.expectedError); }
    checks++;
  };
  const keys = ['tier_10','tier_2','tier_01','tier_1','A','a','Å','A\u030a','é','e\u0301','𐀀','📱','\ud800','\ud801','\udfff','\ufffd','\u0000','__proto__','constructor','1','01','001'];
  for (const order of [keys, keys.slice().reverse(), keys.slice(5).concat(keys.slice(0,5))]) {
    equivalent(() => ({value:Object.fromEntries(order.map((key,index) => [key,index]))}));
    equivalent(() => { const trace=[], value={}; for (const key of order) Object.defineProperty(value,key,{enumerable:true,get(){trace.push(key); return key;}}); return {value,trace}; });
  }
  for (const value of [null,true,false,0,-0,0.5,1e-7,1e21,1e-300,Number.MAX_VALUE,'\n" 📱 \ud800',[],[1,,3],{x:[null,{b:2,a:1}]},new Uint16Array([1,400]),NaN,Infinity,-Infinity,undefined,Symbol('s'),1n,()=>1]) equivalent(() => ({value}));
  const sentinel = new Error('same getter sentinel');
  equivalent(() => {const trace=[],value={}; Object.defineProperty(value,'a',{enumerable:true,get(){trace.push('throw');throw sentinel;}}); return {value,trace,expectedError:sentinel};});
  equivalent(() => {const trace=[],value={a:1,z:2}; Object.defineProperty(value,'b',{enumerable:true,get(){trace.push('b');delete value.z;value.new='not in key snapshot';return 3;}}); return {value,trace};});
  equivalent(() => {const trace=[],inner={z:2,a:1},value={a:0}; Object.defineProperty(value,'b',{enumerable:true,get(){trace.push('b');inner.q=4;return inner;}}); return {value,trace};});
  equivalent(() => {const trace=[], value=new Proxy({z:2,a:1},{ownKeys(target){trace.push('ownKeys');return Reflect.ownKeys(target).reverse();},getOwnPropertyDescriptor(target,key){trace.push('descriptor:'+key);return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key,receiver){trace.push('get:'+String(key));return Reflect.get(target,key,receiver);}}); return {value,trace};});
  equivalent(() => {const trace=[], value=new Proxy({}, {ownKeys(){trace.push('ownKeys');throw sentinel;}}); return {value,trace,expectedError:sentinel};});
  equivalent(() => {const trace=[], value=new Proxy({a:1},{getOwnPropertyDescriptor(){trace.push('descriptor');throw sentinel;}}); return {value,trace,expectedError:sentinel};});
  let seed=0x6052026; const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  function tree(depth) { if(!depth)return [null,false,true,-0,0.5,1e-6,'escaped"\ud800'][rnd()%7]; if(rnd()%3===0)return Array.from({length:rnd()%5},()=>tree(depth-1)); const out=Object.create(null); for(let i=0,n=rnd()%8;i<n;i++)out[keys[rnd()%keys.length]]=tree(depth-1); return out; }
  for(let index=0; index<120; index++){const value=tree(3);equivalent(()=>({value:structuredClone(value)}));}
  // No result or source caching: subsequent mutations are always observed.
  const mutable={abc:{z:1,a:2}}; const first=postgresJsonbCanonicalText(mutable); mutable.abc.a=99; mutable.q=3;
  assert.notEqual(postgresJsonbCanonicalText(mutable),first); assert.equal(postgresJsonbCanonicalText(mutable),predecessor(mutable)); checks++;
  const measuredInputs=[];
  for(const count of [6,7]) {
    const fixture=createCurrentMorningIntegrationFixture(count), value=fixture.input.planningInput.source;
    const before=JSON.stringify(value), expected=predecessor(value), actual=postgresJsonbCanonicalText(value);
    assert.equal(actual,expected); assert.equal(postgresJsonbContentDigest(value),sha(expected)); assert.equal(JSON.stringify(value),before); checks++;
    measuredInputs.push({count,syntheticIncumbencyDifferences:fixture.differences.length,bytes:Buffer.byteLength(actual),sha256:sha(actual)});
  }
  // Hostile source substitutions must fail the independent byte oracle.
  // These functions are test-local only; the imported product is untouched.
  const productText=readFileSync(new URL('../src/static-weekly-schedule-program.js',import.meta.url),'utf8');
  const body=productText.slice(productText.indexOf('export function postgresJsonbCanonicalText('),productText.indexOf('// PostgreSQL jsonb::text uses')).replace('export function','function');
  const substitutions=[
    ['if (lengthDifference) return lengthDifference;','if (lengthDifference) return -lengthDifference;'],
    ['if (lengthDifference) return lengthDifference;','if (lengthDifference) return 0;'],
    ['left.bytes[index] < right.bytes[index] ? -1 : 1','left.bytes[index] < right.bytes[index] ? 1 : -1'],
    ['return 0;','return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;'],
    ['Object.keys(value || {})','Object.keys(value || {}).slice(1)'],
    ['Object.keys(value || {})','Object.keys(value || {}).concat(Object.keys(value || {}).slice(0,1))'],
  ];
  const mutationCorpus=[Object.fromEntries(keys.slice().reverse().map((key,index)=>[key,index])),{a:1,bbb:2,zz:3},{b:1,a:2},Object.fromEntries([['\ud801',1],['\ud800',2]])];
  for(const [from,to] of substitutions) {
    assert.equal(body.split(from).length,2,'mutation target must be exact');
    const mutant=Function('postgresJsonbNumberText',body.replace(from,to)+';return postgresJsonbCanonicalText;')(predecessorNumber);
    assert.ok(mutationCorpus.some(value=>capture(()=>mutant(value)).text!==predecessor(value)),'hostile key-order substitution escaped'); checks++;
  }
  return {schema:'custodial.postgres-key-order-equivalence.v1',status:'PASS_PURE_BYTE_EQUIVALENCE_ONLY',checks,pins,measuredInputs,solver:false,preview:false,publication:false,production:false};
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) console.log(JSON.stringify(runStaticWeeklyPostgresKeyOrderTests()));
