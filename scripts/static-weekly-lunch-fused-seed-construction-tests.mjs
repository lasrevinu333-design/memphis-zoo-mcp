import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import * as currentCoverage from '../src/static-weekly-lunch-coverage.js';
import * as currentAdapter from '../src/static-weekly-lunch-authority-adapter.js';
import * as currentPublication from '../src/static-weekly-lunch-publication.js';
import * as currentVerifier from '../src/static-weekly-schedule-verifier.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const predecessor = {
  verifier: '4ffdc408d4cc6414c3ec9779d3b70ecc0ef61244dd17b6554d72ebef61074740',
  coverage: '78cf722a4dffbfb07bc3ed08788e72bdf76ecccc08dea961e836241d832e102b',
  adapter: '4199753acee0252fea75baa78a90a8198c6ae9897670cfdc70c4a955b60f359e',
  publication: 'c04e0a75f18b63db926a4b09223f17055f2f2febec5bcf4469b2db8b294d5531',
  worker: '48f645ca1997f94e6fb09c23e47fa4a92353bcc100dceb9272db24af40ccd671',
};
const paths = {
  verifier: 'src/static-weekly-schedule-verifier.js',
  coverage: 'src/static-weekly-lunch-coverage.js',
  adapter: 'src/static-weekly-lunch-authority-adapter.js',
  publication: 'src/static-weekly-lunch-publication.js',
  worker: 'src/static-weekly-schedule-compiler-worker.js',
};
const currentPins = {
  verifier:'1700488fafa6e7683aed9ba11e1d6b0eb9800ed4a19d2713410a987417bfcabf',
  coverage:'9072d2fbeeaebc7b64c794a8a941a9554760c9869698a13610db9bab7d456fcb',
  adapter:'b8d7461215bf0444ed4d462cb9989d6dec9d795ec156f7f31c3d73601c001999',
  publication:'f9538bc5df3ed1546b412a0a4371a659c9d358a2fba58bafd9d38fed6a0e608c',
  worker:'1881397f1b259ffbb9750aba426fcc9960f1fd2af05f01a315223e3b5d850b1b',
};
function assertCurrentPins(current) {
  for (const [key,pin] of Object.entries(currentPins)) assert.equal(sha(current[key]),pin,'reviewed current source pin '+key);
}
const replaceOne = (text, needle, replacement) => {
  assert.equal(text.split(needle).length, 2, 'unique reverse needle required');
  return text.replace(needle, replacement);
};

function reconstructPredecessors() {
  const current = Object.fromEntries(Object.entries(paths).map(([key,path]) => [key,source(path)]));
  const old = {};
  const importLine = 'import { LUNCH_COVERAGE_SCHEMA, deriveLunchCoverageFromPreparedProblem, lunchCoverageContentDigest } from "./static-weekly-lunch-derivation.js";\n';
  let verifier = replaceOne(current.verifier, importLine, '');
  const publicStart = 'export function verifyStaticWeeklyScheduleResult(input = {}, result = {}, deadline = null, { allowProvisionalExecutionReceipt = false } = {}) {\n';
  const privateStart = 'function verifyStaticWeeklyScheduleResultInternal(input, result, deadline, allowProvisionalExecutionReceipt, deriveVerifiedLunch) {\n';
  const begin = verifier.indexOf(publicStart), privateBegin = verifier.indexOf(privateStart);
  assert.ok(begin >= 0 && privateBegin > begin, 'closed verifier extension');
  verifier = verifier.slice(0,begin) + publicStart + verifier.slice(privateBegin + privateStart.length);
  const finish = '  if (!deriveVerifiedLunch) return verification;\n';
  assert.equal(verifier.split(finish).length,2);
  verifier = verifier.slice(0,verifier.indexOf(finish)) + '}\n';
  old.verifier = replaceOne(verifier, '  const verification = {\n    ok: violations.length === 0', '  return {\n    ok: violations.length === 0');

  const derivation = source('src/static-weekly-lunch-derivation.js');
  const pure = derivation.slice(0,derivation.indexOf('\n// Serialization helper only;'));
  assert.ok(pure.length > 1000, 'closed pure extraction');
  const originalPure = replaceOne(pure, "  weekdayDate } from './static-weekly-schedule-program.js';\n", "  weekdayDate } from './static-weekly-schedule-program.js';\nimport { verifyStaticWeeklyScheduleResult } from './static-weekly-schedule-verifier.js';\n");
  const creator = 'export function createStaticWeeklyLunchCoverageCandidate(input, result) {';
  assert.equal(current.coverage.split(creator).length,2);
  old.coverage = originalPure + current.coverage.slice(current.coverage.indexOf(creator));

  let adapter = replaceOne(current.adapter,"import { canonicalJson } from './static-weekly-schedule-model.js';\n",'');
  adapter = replaceOne(adapter,"import { createIndependentlyVerifiedStaticWeeklyLunchCandidate } from './static-weekly-schedule-verifier.js';\n",'');
  const returnFinish = '  return finishLunchAuthorityDocument(exactCandidate, result);\n';
  const finishStart = 'function finishLunchAuthorityDocument(exactCandidate, result) {\n';
  const verifyStart = '\nexport function verifyStaticWeeklyLunchAuthorityDocument';
  assert.equal(adapter.split(finishStart).length,2);
  assert.equal(adapter.split(verifyStart).length,2);
  old.adapter = adapter.slice(0,adapter.indexOf(returnFinish)) + adapter.slice(adapter.indexOf(finishStart)+finishStart.length,adapter.indexOf(verifyStart)) + adapter.slice(adapter.indexOf(verifyStart));

  const publicationAppend = '\n// Fresh private recurring-worker source only; public defensive preview remains unchanged.\n';
  assert.equal(current.publication.split(publicationAppend).length,2);
  old.publication = replaceOne(current.publication.split(publicationAppend)[0], 'createStaticWeeklyLunchAuthorityDocument, createFreshVerifiedStaticWeeklyLunchAuthorityDocument }', 'createStaticWeeklyLunchAuthorityDocument }');
  old.worker = replaceOne(current.worker, 'createStaticWeeklyLunchPreviewDocument, createFreshVerifiedStaticWeeklyLunchPreviewDocument }', 'createStaticWeeklyLunchPreviewDocument }');
  old.worker = replaceOne(old.worker, 'const lunch = createFreshVerifiedStaticWeeklyLunchPreviewDocument(compiled);', 'const lunch = createStaticWeeklyLunchPreviewDocument(compiled);');
  return {current,old};
}

function referenceUrl(text, path, dependencies = {}) {
  const location = new URL('../' + path,import.meta.url);
  const rebound = text.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,(_whole,left,relative,right) => {
    const absolute = new URL(relative,location).href;
    return left + (dependencies[absolute] || absolute) + right;
  });
  return 'data:text/javascript;base64,' + Buffer.from(rebound).toString('base64');
}

function capture(run, sentinel) {
  try { return { outcome:'returned',value:run() }; }
  catch(error) {
    return { outcome:'threw', sentinelIdentity:error===sentinel, name:error.name,
      message:error.message, code:error.code, reason:error.reason };
  }
}

export async function runLunchFusedSeedConstructionTests() {
  let checks = 0;
  const check = (name,predicate) => { assert.ok(predicate,name); checks++; };
  const {current,old} = reconstructPredecessors();
  assertCurrentPins(current);
  check('all current edited modules exactly pinned',true);
  check('pure derivation module exactly pinned',sha(source('src/static-weekly-lunch-derivation.js'))==='42eb82ce146867bc69215430644b841ab7aeab39baf95b8c9cda101ea41b4324');
  for (const key of Object.keys(predecessor)) check('full predecessor byte reconstruction '+key,sha(old[key])===predecessor[key]);
  for (const [path,pin] of [
    ['src/static-weekly-schedule-model.js','23fd769ded7a126c6dc61c0421a7a2bb96e0073cbae048440910de192d16738e'],
    ['src/static-weekly-schedule-program.js','6feeea1894da194d26b315d4f923b88bcd39d901f0df812466446d6b3d4b76b9'],
    ['src/static-weekly-schedule-compiler.js','593893e4daac566fa665bb987af17ce803414c92ebd59abf6e8a24aed2361f1a'],
  ]) check('unchanged independently bound dependency '+path,sha(source(path))===pin);
  for (const key of Object.keys(predecessor)) {
    const altered = {...current,[key]:current[key]+'\n// unexplained drift\n'};
    assert.throws(()=>assertCurrentPins(altered),/reviewed current source pin/);
    check('full-source pin rejects actual additional source mutation '+key,true);
  }

  const originalVerifierUrl = referenceUrl(old.verifier,paths.verifier);
  const verifierAbsolute = new URL('../'+paths.verifier,import.meta.url).href;
  const originalCoverageUrl = referenceUrl(old.coverage,paths.coverage,{[verifierAbsolute]:originalVerifierUrl});
  const coverageAbsolute = new URL('../'+paths.coverage,import.meta.url).href;
  const originalAdapterUrl = referenceUrl(old.adapter,paths.adapter,{[coverageAbsolute]:originalCoverageUrl});
  const adapterAbsolute = new URL('../'+paths.adapter,import.meta.url).href;
  const originalPublicationUrl = referenceUrl(old.publication,paths.publication,{[adapterAbsolute]:originalAdapterUrl});
  const originalVerifier = await import(originalVerifierUrl);
  const originalCoverage = await import(originalCoverageUrl);
  const originalAdapter = await import(originalAdapterUrl);
  const originalPublication = await import(originalPublicationUrl);
  check('coverage public export identities retained',isDeepStrictEqual(Object.keys(originalCoverage).sort(),Object.keys(currentCoverage).sort()));

  const cases = [
    ['missing authority',()=>({input:{},result:{}})],
    ['missing publication',()=>({input:{},result:{canonicalAuthority:{},authorityDigest:'a',replayDigest:'r'}})],
    ['input hole',()=>({input:{slots:new Array(1)},result:{canonicalAuthority:{},authorityDigest:'a',replayDigest:'r'}})],
    ['input cycle',()=>{const input={};input.self=input;return {input,result:{canonicalAuthority:{},authorityDigest:'a',replayDigest:'r'}};}],
    ['input accessor',sentinel=>{const input={};Object.defineProperty(input,'slots',{enumerable:true,get(){throw sentinel;}});return {input,result:{canonicalAuthority:{},authorityDigest:'a',replayDigest:'r'}};}],
    ['authority getter error',sentinel=>({input:{},result:{get canonicalAuthority(){throw sentinel;}}})],
    ['authority digest getter error',sentinel=>({input:{},result:{canonicalAuthority:{},get authorityDigest(){throw sentinel;}}})],
    ['replay digest getter error',sentinel=>({input:{},result:{canonicalAuthority:{},authorityDigest:'a',get replayDigest(){throw sentinel;}}})],
  ];
  const apiCases = [
    ['public candidate', (m,x)=>m.coverage.createStaticWeeklyLunchCoverageCandidate(x.input,x.result)],
    ['public candidate verification',(m,x)=>m.coverage.verifyStaticWeeklyLunchCoverageCandidate(x.input,x.result,{forged:true})],
    ['public absent candidate document',(m,x)=>m.adapter.createStaticWeeklyLunchAuthorityDocument(x)],
    ['public supplied candidate document',(m,x)=>m.adapter.createStaticWeeklyLunchAuthorityDocument({...x,candidate:{forged:true}})],
    ['public null candidate document',(m,x)=>m.adapter.createStaticWeeklyLunchAuthorityDocument({...x,candidate:null})],
    ['public false candidate document',(m,x)=>m.adapter.createStaticWeeklyLunchAuthorityDocument({...x,candidate:false})],
    ['public document verification',(m,x)=>m.adapter.verifyStaticWeeklyLunchAuthorityDocument({...x,document:{schema:'memphis-zoo.static-weekly-lunch-authority-document.v1',forged:true}})],
    ['public base verification',(m,x)=>m.verifier.verifyStaticWeeklyScheduleResult(x.input,x.result)],
  ];
  const original = {coverage:originalCoverage,adapter:originalAdapter,verifier:originalVerifier};
  const actual = {coverage:currentCoverage,adapter:currentAdapter,verifier:currentVerifier};
  for (const [name,make] of cases) for (const [api,run] of apiCases) {
    const sentinel = new Error('bounded original sentinel '+name);
    const before=capture(()=>run(original,make(sentinel)),sentinel);
    const after=capture(()=>run(actual,make(sentinel)),sentinel);
    check('public return/error parity '+name+'/'+api,isDeepStrictEqual(before,after));
  }

  for (const candidate of [undefined,null,false,0,'',{},[]]) {
    const observe = adapter => {
      const reads=[],sentinel=new Error('first authority read');
      const result={get canonicalAuthority(){reads.push('canonicalAuthority');throw sentinel;}};
      return {captured:capture(()=>adapter.createStaticWeeklyLunchAuthorityDocument({input:{},result,candidate}),sentinel),reads};
    };
    check('falsey/truthy candidate field read and catch parity',isDeepStrictEqual(observe(originalAdapter),observe(currentAdapter)));
  }
  for (const key of ['compilerInput','overlayCompilerInput']) {
    const observe = publication => {
      const reads=[],sentinel=new Error('canonical source '+key);
      const authority={compilerInput:{},overlayCompilerInput:{exceptions:[]}};
      Object.defineProperty(authority,key,{get(){reads.push(key);throw sentinel;}});
      return {captured:capture(()=>publication.createStaticWeeklyLunchPreviewDocument({canonicalAuthority:authority}),sentinel),reads};
    };
    check('public clone/read error identity parity '+key,isDeepStrictEqual(observe(originalPublication),observe(currentPublication)));
  }
  for (const value of [false,true,undefined]) {
    const observe = verifier => {
      const reads=[],sentinel=new Error('provisional option');
      const options={get allowProvisionalExecutionReceipt(){reads.push('option');return value;}};
      return {captured:capture(()=>verifier.verifyStaticWeeklyScheduleResult({}, {}, null, options),sentinel),reads};
    };
    check('public option getter evaluated once',isDeepStrictEqual(observe(originalVerifier),observe(currentVerifier)));
  }
  const sentinel=new Error('exact option exception');
  for (const verifier of [originalVerifier,currentVerifier]) check('public destructuring throw identity',capture(()=>verifier.verifyStaticWeeklyScheduleResult({}, {}, null,{get allowProvisionalExecutionReceipt(){throw sentinel;}}),sentinel).sentinelIdentity===true);

  for (const [name,make] of cases) {
    const sentinel=new Error('fresh fail-closed '+name);
    const outcome=capture(()=>currentAdapter.createFreshVerifiedStaticWeeklyLunchAuthorityDocument(make(sentinel)),sentinel);
    check('typed fresh invalid source refuses '+name,outcome.outcome==='threw');
  }
  for (const claim of [
    {verifier:{ok:true}},
    {verification:{ok:true},preparedProblem:{states:new Map()}},
    {candidate:{schema:'memphis-zoo.static-weekly-lunch-candidate.v1',status:'PLANNED'}},
    {skipValidation:true,allowProvisionalExecutionReceipt:true},
  ]) {
    const forged={canonicalAuthority:{},authorityDigest:'a',replayDigest:'r',status:'FEASIBLE',publicationAuthority:'ACCEPTABLE',...claim};
    const outcome=capture(()=>currentAdapter.createFreshVerifiedStaticWeeklyLunchAuthorityDocument({input:{},result:forged,...claim}));
    check('caller claim cannot bypass typed full verification',outcome.outcome==='threw' && outcome.code==='lunch_base_schedule_not_verified');
  }
  const completion = current.verifier.slice(current.verifier.indexOf('  if (!deriveVerifiedLunch) return verification;'));
  check('typed completion follows every existing check',completion.indexOf('!verification.ok') < completion.indexOf('...deriveLunchCoverageFromPreparedProblem('));
  check('typed completion has no new source generator',!completion.includes('generateStaticWeeklySchedulingProgram('));
  check('typed completion uses same regenerated graph',completion.includes('deriveLunchCoverageFromPreparedProblem(regenerated.problem, result.weeklyAssignments)'));
  check('no graph/callback/provisional input on typed signature',current.verifier.includes('export function createIndependentlyVerifiedStaticWeeklyLunchCandidate(input, result) {'));
  check('new fresh adapter makes exactly two typed verifications',current.adapter.split('createIndependentlyVerifiedStaticWeeklyLunchCandidate(input, result)').length===3);
  check('full A/B equality unchanged',current.adapter.includes('canonicalJson(expected) === canonicalJson(exactCandidate)'));
  check('unrelated worker projection path unchanged',current.worker.includes('lunch:createStaticWeeklyLunchPreviewDocument(result)'));
  check('worker new default site unique',current.worker.split('createFreshVerifiedStaticWeeklyLunchPreviewDocument(compiled)').length===2);
  const result={checks,classification:'PURE_SOURCE_PUBLIC_ERROR_PARITY_ONLY',engineRuns:0,sqlRuns:0,
    sourceGeneratedPositiveAuthorityProof:false,timingBenefitEstablished:false,
    productSourceHashes:Object.fromEntries(Object.entries(current).map(([key,value])=>[paths[key],sha(value)]))};
  console.log(JSON.stringify(result));
  return result;
}

// Prepared but separately resource-coordinated actual canonical proof mode.
// This uses the exact pre-existing synthetic fixture, not an invented result,
// copied certificate, optimizer stub or presumed verifier success.
export async function runLunchFusedSeedCanonicalFourTests() {
  const pure = await runLunchFusedSeedConstructionTests();
  let checks = 0;
  const check = (name,predicate) => { assert.ok(predicate,name); checks++; };
  const mark = stage => console.log(JSON.stringify({classification:'BOUNDED_SYNTHETIC_CANONICAL_PROOF',stage}));
  const fixtureText = source('scripts/static-weekly-lunch-authority-adapter-tests.mjs');
  check('exact original canonical fixture producer',sha(fixtureText)==='8025947cf18698bb97288fbd2eb9c08f6d0908f9d602bdcc57de52fc0c6803e0');
  const fixtureFunctions = fixtureText.match(/^function fixture\(\) \{[\s\S]*?^\}\n/gm);
  check('unique pinned self-contained four-person fixture',fixtureFunctions?.length===1);
  const input = new Function('return ('+fixtureFunctions[0]+')')()();
  const inputBefore = structuredClone(input);
  const {compileStaticWeeklySchedule,postgresJsonbContentDigest} = await import('../src/static-weekly-schedule-compiler.js');
  const {shutdownStaticWeeklyCompiler} = await import('../src/static-weekly-schedule-compiler-runtime.js');
  const {current,old} = reconstructPredecessors();
  assertCurrentPins(current);
  const verifierAbsolute = new URL('../'+paths.verifier,import.meta.url).href;
  const coverageAbsolute = new URL('../'+paths.coverage,import.meta.url).href;
  const adapterAbsolute = new URL('../'+paths.adapter,import.meta.url).href;
  const originalVerifierUrl = referenceUrl(old.verifier,paths.verifier);
  const originalCoverageUrl = referenceUrl(old.coverage,paths.coverage,{[verifierAbsolute]:originalVerifierUrl});
  const originalAdapterUrl = referenceUrl(old.adapter,paths.adapter,{[coverageAbsolute]:originalCoverageUrl});
  const originalPublicationUrl = referenceUrl(old.publication,paths.publication,{[adapterAbsolute]:originalAdapterUrl});
  const originalCoverage = await import(originalCoverageUrl);
  const originalAdapter = await import(originalAdapterUrl);
  const originalPublication = await import(originalPublicationUrl);

  // Closed source-pinned TEST-ONLY invocation/terminal/derivation counters.
  // They delegate the unchanged checks/arguments/errors and never supply a
  // program, witness or authority. No such hooks exist in product modules.
  let observed = replaceOne(current.verifier,
    'function verifyStaticWeeklyScheduleResultInternal(input, result, deadline, allowProvisionalExecutionReceipt, deriveVerifiedLunch) {\n',
    'function verifyStaticWeeklyScheduleResultInternal(input, result, deadline, allowProvisionalExecutionReceipt, deriveVerifiedLunch) {\n  proofCounters.verifierCalls++;\n');
  observed = replaceOne(observed,
    'function verifyTerminalAttestation(attestation, expectedValue, solverIdentity, options) {\n',
    'function verifyTerminalAttestation(attestation, expectedValue, solverIdentity, options) {\n  proofCounters.terminalCalls++;\n');
  observed = replaceOne(observed,
    '    ...deriveLunchCoverageFromPreparedProblem(regenerated.problem, result.weeklyAssignments),',
    '    ...(proofCounters.derivations++, deriveLunchCoverageFromPreparedProblem(regenerated.problem, result.weeklyAssignments)),');
  observed += '\nconst proofCounters = {verifierCalls:0,terminalCalls:0,derivations:0};\nexport function observedLunchProofCounts(){return {...proofCounters};}\n';
  const observedVerifierUrl = referenceUrl(observed,paths.verifier);
  const observedAdapterUrl = referenceUrl(current.adapter,paths.adapter,{[verifierAbsolute]:observedVerifierUrl});
  const observedVerifier = await import(observedVerifierUrl);
  const observedAdapter = await import(observedAdapterUrl);
  const difference = (after,before) => Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]]));
  try {
    mark('actual_canonical_compile.begin');
    const result = await compileStaticWeeklySchedule(input);
    mark('actual_canonical_compile.returned');
    check('actual engine compile accepted only on real returned evidence',result.status==='FEASIBLE' && result.publicationAuthority==='ACCEPTABLE' && result.verifier?.ok===true);
    const resultBefore=structuredClone(result),tiers=result.solver.tiers.length;
    check('actual base carries nonempty canonical terminal tiers',Number.isSafeInteger(tiers)&&tiers>0);
    mark('complete_old_public_fused_comparison.begin');
    const oldCandidate=originalCoverage.createStaticWeeklyLunchCoverageCandidate(input,result);
    const publicCandidate=currentCoverage.createStaticWeeklyLunchCoverageCandidate(input,result);
    const fusedCandidate=currentVerifier.createIndependentlyVerifiedStaticWeeklyLunchCandidate(input,result);
    check('complete old/public candidate equality',isDeepStrictEqual(oldCandidate,publicCandidate));
    check('complete old/fused candidate equality',isDeepStrictEqual(oldCandidate,fusedCandidate));
    const oldDocument=originalAdapter.createStaticWeeklyLunchAuthorityDocument({input,result});
    const publicDocument=currentAdapter.createStaticWeeklyLunchAuthorityDocument({input,result});
    const fusedDocument=currentAdapter.createFreshVerifiedStaticWeeklyLunchAuthorityDocument({input,result});
    check('complete old/public document equality',isDeepStrictEqual(oldDocument,publicDocument));
    check('complete old/fused document equality',isDeepStrictEqual(oldDocument,fusedDocument));
    check('authority/replay bindings retain exact compiled identities',fusedDocument.base_authority_digest===result.authorityDigest && fusedDocument.base_replay_digest===result.replayDigest);
    check('candidate/document identity exact',fusedDocument.candidate_digest===oldCandidate.candidateDigest && fusedDocument.document_identity===oldDocument.document_identity);
    check('supplied valid candidate remains exact document',isDeepStrictEqual(publicDocument,currentAdapter.createStaticWeeklyLunchAuthorityDocument({input,result,candidate:oldCandidate})));
    check('complete old/public/fresh publication preview equality',isDeepStrictEqual(originalPublication.createStaticWeeklyLunchPreviewDocument(result),currentPublication.createStaticWeeklyLunchPreviewDocument(result)) && isDeepStrictEqual(publicDocument,currentPublication.createFreshVerifiedStaticWeeklyLunchPreviewDocument(result)));
    const countBefore=observedVerifier.observedLunchProofCounts();
    const observedDocument=observedAdapter.createFreshVerifiedStaticWeeklyLunchAuthorityDocument({input,result});
    const counts=difference(observedVerifier.observedLunchProofCounts(),countBefore);
    check('observer preserves complete exact document',isDeepStrictEqual(observedDocument,fusedDocument));
    check('two complete independent passes demonstrated',counts.verifierCalls===2 && counts.terminalCalls===2*tiers && counts.derivations===2);
    mark('complete_old_public_fused_comparison.returned');

    const negatives=[
      ['changed assignment',r=>{r.weeklyAssignments[0].slotId='forged-owner';}],
      ['changed input identity',r=>{r.inputDigest='f'.repeat(64);} ],
      ['changed authority identity',r=>{r.authorityDigest='f'.repeat(64);} ],
      ['changed integer witness',r=>{r.certificate.finalWitness.values[0][1]+=1;} ],
      ['first terminal report mutation',r=>{r.solver.tiers[0].attestation.terminalReport.utf8Sha256='f'.repeat(64);} ],
      ['last terminal report mutation',r=>{r.solver.tiers.at(-1).attestation.terminalReport.utf8Sha256='f'.repeat(64);} ],
    ];
    for (const [name,mutate] of negatives) {
      const forged=structuredClone(result);mutate(forged);
      const oldOutcome=capture(()=>originalAdapter.createStaticWeeklyLunchAuthorityDocument({input,result:forged}));
      const publicOutcome=capture(()=>currentAdapter.createStaticWeeklyLunchAuthorityDocument({input,result:forged}));
      const fusedOutcome=capture(()=>currentAdapter.createFreshVerifiedStaticWeeklyLunchAuthorityDocument({input,result:forged}));
      check('old/public rejection exact '+name,isDeepStrictEqual(oldOutcome,publicOutcome)&&oldOutcome.outcome==='threw');
      check('fused mandatory validation rejects '+name,fusedOutcome.outcome==='threw'&&fusedOutcome.code==='lunch_base_schedule_not_verified');
    }
    const badCandidate=structuredClone(oldCandidate);badCandidate.lunches[0].window.end='13:30';
    check('supplied candidate cannot bypass public verifier',currentCoverage.verifyStaticWeeklyLunchCoverageCandidate(input,result,badCandidate).ok===false);
    check('supplied candidate cannot bypass public document adapter',capture(()=>currentAdapter.createStaticWeeklyLunchAuthorityDocument({input,result,candidate:badCandidate})).code==='lunch_authority_candidate_verification_failed');
    const badDocument=structuredClone(fusedDocument);badDocument.responsibilities[0].coverer_person_id='forged-person';
    check('supplied document independently rejected',currentAdapter.verifyStaticWeeklyLunchAuthorityDocument({input,result,document:badDocument}).ok===false);

    // Calibrate only the actual first typed invocation's authority reads. Then
    // mutate AFTER A, before B, rather than guessing a magic read count.
    let singleReads=0;
    const firstView={...result};
    Object.defineProperty(firstView,'canonicalAuthority',{get(){singleReads++;return result.canonicalAuthority;}});
    check('first-pass read calibration preserves candidate',isDeepStrictEqual(observedVerifier.createIndependentlyVerifiedStaticWeeklyLunchCandidate(input,firstView),oldCandidate));
    check('first pass observed actual field access',singleReads>0);
    for (const kind of ['source','result']) {
      const mutableInput=structuredClone(input),view={...result};
      let reads=0;
      const changedAuthority=structuredClone(result.canonicalAuthority);changedAuthority.inputDigest='f'.repeat(64);
      Object.defineProperty(view,'canonicalAuthority',{get(){
        reads++;
        if(reads>singleReads && kind==='source') mutableInput.versions[0].slotAvailability[0].lunch={start:'13:00',end:'14:00'};
        return reads>singleReads && kind==='result'?changedAuthority:result.canonicalAuthority;
      }});
      const before=observedVerifier.observedLunchProofCounts();
      const outcome=capture(()=>observedAdapter.createFreshVerifiedStaticWeeklyLunchAuthorityDocument({input:mutableInput,result:view}));
      const mutationCounts=difference(observedVerifier.observedLunchProofCounts(),before);
      check('second full pass rejects intervening '+kind+' mutation',outcome.code==='lunch_authority_candidate_verification_failed' && outcome.reason==='lunch_base_schedule_not_verified' && mutationCounts.verifierCalls===2 && mutationCounts.derivations===1);
    }
    check('all original source bytes/values retained',isDeepStrictEqual(input,inputBefore));
    check('all original complete result bytes/values retained',isDeepStrictEqual(result,resultBefore));
    const receipt={classification:'BOUNDED_SYNTHETIC_CANONICAL_FOUR_PROOF',checks,pureChecks:pure.checks,
      fixtureProducerSha256:sha(fixtureText),rawFixtureInputDigest:postgresJsonbContentDigest(input),canonicalInputDigest:result.inputDigest,
      authorityDigest:result.authorityDigest,replayDigest:result.replayDigest,
      candidateDigest:oldCandidate.candidateDigest,documentIdentity:oldDocument.document_identity,
      actualCanonicalTiers:tiers,observedDefaultCounts:counts,
      independentlyProvesOptimality:false,actualStaffingRuntimeAcceptance:false,
      sqlRuns:0,productionWrites:0,timingBenefitEstablished:false};
    console.log(JSON.stringify(receipt));return receipt;
  } finally {
    await shutdownStaticWeeklyCompiler();
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.includes('--canonical-four')) await runLunchFusedSeedCanonicalFourTests();
  else await runLunchFusedSeedConstructionTests();
}
