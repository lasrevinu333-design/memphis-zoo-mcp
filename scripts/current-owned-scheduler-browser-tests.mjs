// Actual current browser -> normal HTTPS runtime -> owned current310 SQL.
// No production transport, historical fixture replay, or release approval.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {consumeCurrentQualifiedSqlFixture} from './current-qualified-sql-ci-fixture.mjs';
import {setupCurrentOwnedSchedulerBrowser} from './fixtures/current-owned-scheduler-browser.mjs';

const backend=fileURLToPath(new URL('..',import.meta.url)),frontend=path.resolve(backend,'../frontend');
let resource,fixture,reportFile;
const report={schema:'custodial.current310-browser-runtime-sql-qualification.v1',passed:false,production:false,release_admission:false};
try {
 assert.deepEqual(process.argv.slice(2),[]);
 resource=await consumeCurrentQualifiedSqlFixture({name:'mz_schema_rebuild_current_browser_'+process.pid});
 const descriptor=JSON.parse(fs.readFileSync(process.env.CUSTODIAL_CURRENT310_OWNED_CI_DESCRIPTOR));
 const runtime=descriptor.runtime,output=path.join(runtime,'ci-output');
 reportFile=path.join(output,'current310-browser-runtime-sql.json');
 assert.equal(fs.existsSync(reportFile),false,'Previous results must be preserved first');
 report.source_profile=resource.receipt.source_profile;report.borrow=resource.receipt;
 fixture=await setupCurrentOwnedSchedulerBrowser({fixture:resource,frontendOrigin:'https://127.0.0.1:4173',
  tls:{key:fs.readFileSync(path.join(runtime,'localhost-key.pem')),cert:fs.readFileSync(path.join(runtime,'localhost-cert.pem'))}});
 report.runtime_setup=await fixture.evidence();
 console.log(JSON.stringify({phase:'ACTUAL_SQL_PUBLICATION_AND_HTTPS_ENROLLMENT_READY',week:fixture.week,production:false}));
 const browserResult=path.join(output,'current-browser-lost-cancel.json');
 const browserDiagnostic=path.join(output,'current-browser-lost-cancel-diagnostic.json');
 assert.equal(fs.existsSync(browserResult),false,'Previous browser result must be preserved first');
 assert.equal(fs.existsSync(browserDiagnostic),false,'Previous browser diagnostic must be preserved first');
 report.browser_diagnostic_path=browserDiagnostic;
 const input={endpoint:fixture.origin,week:fixture.week,session:fixture.session,employeeId:fixture.employeeId,slotId:fixture.slotId,
  publicationId:fixture.publicationId,versionId:fixture.versionId,revision:fixture.revision,bootstrapCookies:fixture.bootstrapCookies()};
 const argv=[path.resolve(runtime,'../work/run-owned-browser.py'),runtime,process.execPath,
  path.join(frontend,'node_modules/@playwright/test/cli.js'),'test','--config','current-qualification.playwright.config.js',
  '--output',path.join(output,'browser-test-output')];
 const child=spawn('python3',argv,{cwd:frontend,stdio:'inherit',env:{...process.env,
  CUSTODIAL_CURRENT_SCHEDULER_BROWSER_FIXTURE:JSON.stringify(input),CUSTODIAL_CURRENT_SCHEDULER_BROWSER_RESULT:browserResult,
  CUSTODIAL_CURRENT_SCHEDULER_BROWSER_DIAGNOSTIC:browserDiagnostic,
  CUSTODIAL_LOCAL_TLS_KEY:path.join(runtime,'localhost-key.pem'),CUSTODIAL_LOCAL_TLS_CERT:path.join(runtime,'localhost-cert.pem')}});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 report.browser_exit_code=code;assert.equal(code,0,'Current browser case failed; no browser or SQL PASS inferred');
 const browser=JSON.parse(fs.readFileSync(browserResult));assert.equal(browser.passed,true);
 assert.deepEqual(browser.request_counts,{begin:1,prepare:1,cancel:1});assert.equal(browser.lost_successful_reply,true);
 assert.match(browser.semantic_digest,/^[a-f0-9]{64}$/);
 report.browser=browser;
 report.sql=await fixture.assertSameOperation({operationId:browser.operation_id,semanticDigest:browser.semantic_digest});
 report.runtime=await fixture.evidence();
 report.browser_process_cleanup=JSON.parse(fs.readFileSync(path.join(output,'browser-process-cleanup.json')));assert.equal(report.browser_process_cleanup.test_exit_code,0);
 report.host_lease_release_pending_parent=true;
 report.passed=true;
} catch(error) {
 report.error={name:error.name,code:error.code??null,message:error.message,phase:error.currentOwnedBrowserFixturePhase??null};
 if(error.fixtureLocalCloseFailure)report.fixtureLocalCloseFailure=error.fixtureLocalCloseFailure;
} finally {
 if(fixture)try{await fixture.close();report.runtime_closed=true;}catch(error){report.runtime_closed=false;report.passed=false;report.close_error=error.message;}
 if(resource)try{await resource.cleanup();report.borrow_released=true;}catch(error){report.borrow_released=false;report.passed=false;report.cleanup_error=error.message;}
 report.parent_final_database_cleanup_required=true;
 if(reportFile)fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({schema:report.schema,passed:report.passed,error:report.error??null,report:reportFile??null,
  runtime_closed:report.runtime_closed===true,borrow_released:report.borrow_released===true,production:false,release_admission:false}));
 if(!report.passed)process.exitCode=1;
}
