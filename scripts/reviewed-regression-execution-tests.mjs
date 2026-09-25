// Executes the actual direct-Node launcher/hash/shell against synthetic fixtures.
// NOT HTTP, Docker, DB or hosted proof: those require separate actual-suite runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const owned=mkdtempSync(join(tmpdir(),'mz-reviewed-ci-boundary-'));
const pinnedBin='/opt/hostedtoolcache/node/22.23.1/x64/bin';
const entries=['scripts/legacy-activation-http-tests.mjs','scripts/release-pair-consumer-regression-tests.mjs','scripts/run-isolated-release-recorder-tests.mjs'];
const hash=b=>createHash('sha256').update(b).digest('hex');
let checks=0;
console.log(JSON.stringify({owned,cleanup:'remove exact temporary fixture in finally',production:false}));
try {
 for(const name of ['foundation-security-gate.yml','custodial-production-repair.yml']){
  const source=readFileSync(join(root,'.github/workflows',name),'utf8');
  const step=source.match(/^      - name: Reviewed phone, pair, and isolated recorder regressions\n([\s\S]*?)(?=^      - )/m)?.[1];assert.ok(step);
  const shell=step.match(/^        shell: (.+)$/m)[1];
  assert.ok(shell.startsWith('/usr/bin/env -i HOME=/home/runner PATH='+pinnedBin+':/usr/bin:/bin '));
  const body=step.slice(step.indexOf('        run: |\n')+'        run: |\n'.length).trimEnd().split('\n').map(l=>l.slice(10)).join('\n');
  const pins=[...body.matchAll(/^([a-f0-9]{64})  (.+)$/gm)].map(m=>({digest:m[1],path:m[2]}));assert.equal(pins.length,7);
  const command=entries.map(p=>pinnedBin+'/node '+p).join(' && ');assert.ok(body.endsWith(command));
  assert.doesNotMatch(command,/\bnpm\b/);
  const cwd=join(owned,name);mkdirSync(cwd);
  for(const p of pins){mkdirSync(dirname(join(cwd,p.path)),{recursive:true});copyFileSync(join(root,p.path),join(cwd,p.path));}
  // Same entrypoint paths and three-command && semantics; ONLY the three
  // bodies/hashes become declared fixtures. Real HTTP/PG proof runs separately.
  const fixtures=entries.map((p,i)=>Buffer.from("console.log('ENTRY_"+(i+1)+"');\n"));
  for(let i=0;i<entries.length;i++)writeFileSync(join(cwd,entries[i]),fixtures[i]);
  const script=join(cwd,'boundary.sh');
  const writeBoundary=()=>{
   let b=body.replace(/^docker pull .+$/m,': # image operation excluded from boundary unit test');
   for(const p of pins.filter(p=>entries.includes(p.path)))b=b.replace(p.digest+'  '+p.path,hash(readFileSync(join(cwd,p.path)))+'  '+p.path);
   // Adapt hosted absolute prefix only. No npm --version substitutes the chain.
   writeFileSync(script,b.replaceAll(pinnedBin,dirname(process.execPath)));
  };
  writeBoundary();
  const bin=join(cwd,'hostile-bin');mkdirSync(bin);const marker=join(cwd,'untrusted-command-ran');
  for(const tool of ['npm','node']){writeFileSync(join(bin,tool),"#!/bin/sh\ntouch '"+marker+"'\nexit 0\n");chmodSync(join(bin,tool),0o755);}
  const bashEnv=join(cwd,'hostile-bashenv');writeFileSync(bashEnv,"touch '"+marker+"'\nnode() { return 0; }\nnpm() { return 0; }\n");
  const preload=join(cwd,'hostile-preload.cjs');writeFileSync(preload,"require('fs').writeFileSync("+JSON.stringify(marker)+",'unexpected');process.exit(0);\n");
  const args=shell.split(' ').slice(1).map(a=>a==='{0}'?script:a.replace(pinnedBin,dirname(process.execPath)));
  const run=()=>spawnSync('/usr/bin/env',args,{cwd,encoding:'utf8',timeout:15000,env:{...process.env,
   PATH:bin+':'+process.env.PATH,BASH_ENV:bashEnv,'BASH_FUNC_node%%':"() { touch '"+marker+"'; return 0; }",
   'BASH_FUNC_npm%%':"() { touch '"+marker+"'; return 0; }",NODE_OPTIONS:'--require '+preload,
   npm_config_script_shell:'/bin/true',npm_config_node_options:'--require '+preload}});
  for(const npmrc of ['', 'script-shell=/bin/true\n','node-options=--require '+preload+'\n','script-shell=/bin/true\nnode-options=--require '+preload+'\n']){
   writeFileSync(join(cwd,'.npmrc'),npmrc);const good=run();assert.equal(good.status,0,good.stderr);
   assert.deepEqual(good.stdout.match(/ENTRY_[123]/g),['ENTRY_1','ENTRY_2','ENTRY_3']);
   assert.equal(existsSync(marker),false);checks+=3;
  }
  for(const p of pins){const target=join(cwd,p.path),original=readFileSync(target);
   writeFileSync(target,Buffer.concat([original,Buffer.from('\n/* changed execution input */\n')]));
   const bad=run();assert.notEqual(bad.status,0,p.path);assert.doesNotMatch(bad.stdout,/ENTRY_[123]/,p.path);
   writeFileSync(target,original);checks+=2;
  }
  const packagePath=join(cwd,'package.json'),original=readFileSync(packagePath),noOp=JSON.parse(original);
  noOp.scripts['test:reviewed-source-regressions']='true';writeFileSync(packagePath,JSON.stringify(noOp));
  const altered=run();assert.notEqual(altered.status,0);assert.doesNotMatch(altered.stdout,/ENTRY_[123]/);checks+=2;writeFileSync(packagePath,original);
  // Bind each intentional fixture failure, then prove actual && fail-fast:
  // failure in any command position prevents execution of all successors.
  for(let i=0;i<entries.length;i++){
   writeFileSync(join(cwd,entries[i]),Buffer.concat([fixtures[i],Buffer.from('process.exit(17);\n')]));writeBoundary();
   const failed=run();assert.equal(failed.status,17);assert.deepEqual(failed.stdout.match(/ENTRY_[123]/g),entries.slice(0,i+1).map((_,j)=>'ENTRY_'+(j+1)));
   assert.equal(existsSync(marker),false);checks+=3;writeFileSync(join(cwd,entries[i]),fixtures[i]);
  }
 }
 console.log(JSON.stringify({ok:true,checks,boundary:'actual direct-Node chain/hash/clean-shell semantics; synthetic entrypoints; no product/engine/hosted claim'}));
} finally {rmSync(owned,{recursive:true,force:true});assert.equal(existsSync(owned),false);console.log('REVIEWED_CI_FIXTURE_REMOVED',owned);}
