// A deliberately name/alias-only first operational adoption. Place UUIDs are
// never schedule identities and human aliases are never physical tag routes.
import assert from 'node:assert/strict';
import { canonicalJson } from './static-weekly-schedule-model.js';

export const PLACE_OPERATIONAL_SCHEMA = 'custodial.place-name-publication.v1';
const fail = message => Object.assign(new Error(message), {code:'place_operational_candidate_changed'});
const clone = value => JSON.parse(JSON.stringify(value));

export function placePublicationInput(preview) {
  if (preview?.schema !== PLACE_OPERATIONAL_SCHEMA || !preview.candidate_source?.version
    || !Array.isArray(preview.selection) || !preview.selection.length) throw fail('Exact server Place preview required.');
  assertPlaceNameOnlyTransition(preview.base_source, preview.candidate_source);
  const {version, ...input} = clone(preview.candidate_source);
  return {...input, versions:[version]};
}

export function assertPlaceNameOnlyTransition(base, candidate) {
  if (!base?.version || !candidate?.version
    || !Array.isArray(base.version.assignments) || !Array.isArray(candidate.version.assignments)) {
    throw fail('One registered recurring source is required.');
  }
  const stable = source => {
    const result = clone(source);
    delete result.serviceDate;
    for (const key of ['id','publicationId','status','effectiveStart','effectiveEnd']) delete result.version[key];
    result.version.assignments = result.version.assignments.map(row => {
      // ONLY these display strings may differ. All owner/window/work identity,
      // mode/member UUIDs, qualifications, effort and provenance remain exact.
      delete row.locationNameSnapshot;
      if (Array.isArray(row.includedLocations)) row.includedLocations = row.includedLocations.map(x => {
        delete x.locationNameSnapshot; return x;
      });
      return row;
    });
    return canonicalJson(result);
  };
  try { assert.equal(stable(base), stable(candidate)); }
  catch { throw fail('Place display adoption cannot change ownership, windows, workdays, lunch, mode, members or other schedule facts.'); }
  return true;
}

export function placePublicationSummary(preview) {
  placePublicationInput(preview);
  return {
    schema:PLACE_OPERATIONAL_SCHEMA, preview_id:preview.preview_id,
    expected_revision:preview.expected_revision, effective_start:preview.effective_start,
    source_publication_id:preview.source_publication_id,
    selection:clone(preview.selection), source_sha256:preview.source_sha256,
    candidate_sha256:preview.candidate_sha256,
    source_scope:'SELECTED_NAMES_AND_HUMAN_ALIASES_ONLY',
    ownership_changed:false, eligibility_changed:false, tag_routes_changed:false,
    accepted:false, phone_delivery_state:'NOT_ACCEPTED', affected_phones_updated:false,
    remaining_lifecycle_gate:'Deactivation, reclassification, membership and logical merge require an explicit replacement-duty preview; this path rejects them.',
  };
}
