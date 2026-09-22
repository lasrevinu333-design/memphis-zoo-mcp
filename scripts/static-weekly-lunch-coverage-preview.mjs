#!/usr/bin/env node
/** Local candidate preparation only. No network, SQL write, push, or publication. */
import { readFileSync, statSync } from 'node:fs';
import { compileStaticWeeklySchedule } from '../src/static-weekly-schedule-compiler.js';
import { createStaticWeeklyLunchCoverageCandidate } from '../src/static-weekly-lunch-coverage.js';

const args=process.argv.slice(2);
if(args.length<1 || args.length>2) {
  console.error('Usage: node scripts/static-weekly-lunch-coverage-preview.mjs INPUT.json [COMPILED_RESULT.json]');
  process.exitCode=2;
} else {
  const read=path=>{
    if(!statSync(path).isFile() || statSync(path).size>32*1024*1024)throw new Error('lunch_preview_file_limit');
    return JSON.parse(readFileSync(path,'utf8'));
  };
  try {
    const input=read(args[0]);
    const result=args[1]?read(args[1]):await compileStaticWeeklySchedule(input);
    const candidate=createStaticWeeklyLunchCoverageCandidate(input,result);
    console.log(JSON.stringify({ok:candidate.status==='PLANNED',publicationAuthority:'NOT_PUBLISHED',
      databaseWritten:false,notificationsEnqueued:false,candidate},null,2));
    process.exitCode=candidate.status==='PLANNED'?0:1;
  }catch(error) {
    console.error(JSON.stringify({ok:false,publicationAuthority:'NOT_PUBLISHED',databaseWritten:false,
      error:error.code||error.message||'lunch_preview_failed'}));
    process.exitCode=1;
  }
}
