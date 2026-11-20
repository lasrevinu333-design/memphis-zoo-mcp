// Connection-free execution of exact shipping shape/order assertions, not native SQL qualification.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const text=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const program=JSON.parse(text('../proposals/immutable-private-current-postgres-program.json'));
const l=text('./immutable-private-postgres-source.mjs');const a=l.indexOf(' assert.equal(program.recipes.length,'),b=l.indexOf(' for(const r of program.recipes)',a);assert.ok(a>0&&b>a);
const loader=new Function('program','assert',l.slice(a,b));
const i=text('./immutable-private-source-initializer.mjs');const c=i.indexOf(' const recipeIdentities=Object.freeze('),d=i.indexOf(' // One fresh, ordered native catalog read',c);assert.ok(c>0&&d>c);
const initializer=new Function('source','ownerProfile','assert',i.slice(c,d)+'return recipeIdentities;');
const base=[{identity:'public.unit_base_one()'},{identity:'public.unit_base_two()'}];
const current={id:'immutable-private-current-postgres',actor:'postgres'};
test('shipping current loader and initializer accept exact29/31 and exact trailing order',()=>{loader(program,assert);assert.equal(initializer({recipes:[...base,...program.recipes]},current,assert).length,31);});
for(const mode of ['short28','long30','duplicate_absence','misplaced_absence'])test('shipping loader refuses '+mode,()=>{
 const p=structuredClone(program);if(mode==='short28')p.recipes.pop();if(mode==='long30')p.recipes.push(p.recipes.at(-1));if(mode==='duplicate_absence')p.recipes[0]=p.recipes.at(-1);if(mode==='misplaced_absence')[p.recipes[0],p.recipes[28]]=[p.recipes[28],p.recipes[0]];assert.throws(()=>loader(p,assert));
});
for(const count of [28,29,30])test('shipping initializer refuses stale current count '+count,()=>assert.throws(()=>initializer({recipes:[...base,...program.recipes].slice(0,count)},current,assert)));
for(const mode of ['duplicate','misplaced'])test('shipping initializer refuses absence '+mode,()=>{
 const recipes=structuredClone([...base,...program.recipes]);if(mode==='duplicate')recipes[0]=recipes.at(-1);else [recipes[0],recipes[30]]=[recipes[30],recipes[0]];assert.throws(()=>initializer({recipes},current,assert));
});
test('shipping initializer retains legacy25 and refuses mixed current31',()=>{const legacy={id:'immutable-private-legacy-supabase-admin',actor:'supabase_admin'},recipes=Array.from({length:25},(_,n)=>({identity:'public.unit_legacy_'+n+'()'}));assert.equal(initializer({recipes},legacy,assert).length,25);assert.throws(()=>initializer({recipes:[...base,...program.recipes]},legacy,assert));});
