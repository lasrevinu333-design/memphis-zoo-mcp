#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {readApprovedManualWeek,previewApprovedManualDay} from '../src/approved-manual-week.js';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){
  const key=args[i],value=args[i+1];
  assert.ok(['--output','--catalog','--manifest-sha256','--day','--time'].includes(key)&&value&&!Object.hasOwn(options,key),
    'usage: prepare-approved-manual-week.mjs --output /absolute/new.json [--catalog /absolute/catalog.json --manifest-sha256 ISSUED_SHA] [--day friday --time 15:00]');
  options[key]=value;
}
assert.ok(options['--output']&&isAbsolute(options['--output']),'A new absolute output path is required');
assert.equal(Boolean(options['--catalog']),Boolean(options['--manifest-sha256']),'Custom packet requires its independently issued manifest pin');
assert.equal(Boolean(options['--day']),Boolean(options['--time']),'Day and time must be supplied together');
const week=readApprovedManualWeek(options['--catalog']?{catalogPath:options['--catalog'],expectedManifestSha256:options['--manifest-sha256']}:{});
const preview=options['--day']?previewApprovedManualDay(week,{day:options['--day'],time:options['--time']}):null;
writeFileSync(options['--output'],JSON.stringify({week,preview},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({schema:week.schema,dataDigest:week.dataDigest,output:options['--output'],days:week.days.length,
  fullHourReliefs:week.days.reduce((n,d)=>n+d.lunches.length,0),activation:week.activation,published:false,receiptEligible:false}));
