/** Defensive public lunch candidate create/verify APIs. */
import { canonicalJson } from './static-weekly-schedule-model.js';
import { generateStaticWeeklySchedulingProgram } from './static-weekly-schedule-program.js';
import { verifyStaticWeeklyScheduleResult } from './static-weekly-schedule-verifier.js';
import { deriveLunchCoverageFromPreparedProblem, lunchCoverageContentDigest as digest } from './static-weekly-lunch-derivation.js';
export { LUNCH_COVERAGE_SCHEMA, partitionLunchAreas, deriveLunchCoverageFromPreparedProblem } from './static-weekly-lunch-derivation.js';
const fail = code => { throw Object.assign(new Error(code), { code }); };

export function createStaticWeeklyLunchCoverageCandidate(input, result) {
  if(!result?.canonicalAuthority || !result.authorityDigest || !result.replayDigest)fail('lunch_complete_base_authority_required');
  const verification=verifyStaticWeeklyScheduleResult(input,result);
  if(!verification.ok || result.status!=='FEASIBLE' || result.publicationAuthority!=='ACCEPTABLE')
    fail('lunch_base_schedule_not_verified');
  const program=generateStaticWeeklySchedulingProgram(input);
  if(program.error || program.problem.inputDigest!==result.inputDigest)fail('lunch_base_schedule_identity_mismatch');
  const candidate={...deriveLunchCoverageFromPreparedProblem(program.problem,result.weeklyAssignments),
    baseAuthorityDigest:result.authorityDigest,baseReplayDigest:result.replayDigest};
  return {...candidate,candidateDigest:digest(candidate)};
}

export function verifyStaticWeeklyLunchCoverageCandidate(input,result,candidate) {
  try {
    const expected=createStaticWeeklyLunchCoverageCandidate(input,result);
    return {ok:canonicalJson(expected)===canonicalJson(candidate),expectedDigest:expected.candidateDigest};
  }catch(error){return {ok:false,reason:error.code||'lunch_candidate_invalid'};}
}
