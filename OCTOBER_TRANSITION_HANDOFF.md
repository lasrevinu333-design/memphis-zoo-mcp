# October 1-4 dated schedule candidate and October 5 recurring source

LOCAL IMPLEMENTATION / TEST EVIDENCE ONLY. Original integration owner: task `01a09d81-143e-7f63-aeed-f47519a47a82`, Audit custodial program readiness. No independent audit, production publication, actual phone readback, signing, deployment or employee PDF delivery occurred. The held release checkout and repair.lock were not modified. This worker used an independent clone and branch in task-5; no other worker shares its Git metadata.

Branch: `candidate/october1-dated-transition`, parent `b9e83ff202a7487e6943c9323b89cb574a242857`. The final commit and bundle hashes are in the adjacent immutable handoff receipt, generated after committing.

The historical September 28 config/handout stays intact. The new October 5 config is exactly the old corrected configuration except its effective date and explicit date-authority metadata. No person, shift, lunch, restriction, proximity, ownership or workload fact changed. Kathy's Admin duties are not emitted for September 28-30.

`createOctoberTransitionCandidate` prepares a bounded local compiler candidate, effective `[2026-10-01, 2026-10-05)`, with distinct version/publication identities and digest. It is explicitly NOT a recurring registration artifact. Date guards reject September 28-30 and October 5 onward. The October 5 source keeps the generator's Monday restriction and existing SQL publication controls. The portable compiler internally uses published-version semantics to evaluate the local candidate; that is a simulation, not a persisted publication. Its complete seven-day witness contains adjacent October 5-7 rows, but the transition export admits ONLY October 1-4. The separate recurring source supplies October 5 onward. Do not materialize the transition compiler witness wholesale.

Candidate phone/PDF revision:
`ee75f76a21e0d3a82291b8c720b5548532e1f168f1941a0cd74e80662302bd08`

Transition source digest:
`5c35cdd94e6d6dc19b1ea5e31bfa6f2f78619e9654e80e9504b5c455f6e17527`

October 5 recurring source digest:
`ac98f94d0c28a9cd493898bef2463059ef59a80bfcac1f8d0a455ddf6901571a`

The definitive local data is `evidence/final-october-candidate/phone-pdf-data.json`. The definitive draft PDFs are `output/pdf-reviewable/October_1-4_Transition_DRAFT.pdf` (26 pages) and `output/pdf-reviewable/October_5_Recurring_First_Week_DRAFT.pdf` (44 pages). Every PDF page carries the exact same candidate revision. Both include explicit off days; this explains their page count versus the historical 30 workday sheets. The PDFs are draft replacements, not accepted or delivered replacements. `acceptedRevision` remains null.

Verified availability (all times Memphis local; day numbers Sunday=0):

| Person | Working days | Shift | Lunch |
| --- | --- | --- | --- |
| Karen | Mon, Tue, Wed, Fri, Sat | 05:00-14:00 | 09:30-10:30 |
| Tammy | Mon-Fri | 05:00-14:00 | 08:30-09:30 |
| Kathy | Tue-Sat | 06:00-15:00 | 10:30-11:30; Thu 10:00-11:00 |
| Kaili | Sun-Thu | 07:00-16:00 | 10:30-11:30; Thu 11:00-12:00 |
| Alijah | Sun, Mon, Thu, Fri, Sat | 07:00-16:00 | 11:30-12:30; Thu 12:00-13:00 |
| Gregory | Sun-Wed, Sat | 08:00-17:00 | 12:30-13:30 |

These facts come from the corrected b9e83ff config and exact hash-bound historical handout, not guessed hours. All nine stable positions and their incumbent histories remain; exactly six staffed and three vacant. Admin/private restroom physical packages are preserved. Admin morning cleaning is permitted, with the three-hour Admin check policy represented in candidate data/PDFs. Other check deadlines retain the existing 90-minute policy. The candidate does not prove production timer/reminder enforcement. Gregory's temporary lunch coverage is explicitly on-call/issues-only and creates no new normal route. The exact split coverage segment times are printed, rather than incorrectly displaying an entire lunch hour for each partial segment.

Tuesday weekly Elephant Trunk employee men's/women's restroom duty remains Kathy's one-time `reminder_only` row, 10:00-10:30, first shown October 6. It has no invented NFC tag or shop-floor route. The three retired gift-shop duties stay removed. Saturday Cat Country keeps Karen 09:45-14:00 -> Alijah 14:00-16:00 -> Gregory 16:00-17:00. Alijah never receives Herpetarium.

Friday October 2 and October 9 Herpetarium 15:00-16:00 remain explicit OPEN. At that time the only remaining scheduled person is Alijah, who is ineligible. Karen/Tammy end 14:00, Kathy ends 15:00, Kaili/Gregory are off Friday. No fixed-hours solution exists among these six. Do not invent coverage or extend hours. A real eligible staffing change or an explicitly accepted exception is required. Structural continuity checks include this explicit OPEN segment; zero structural gaps does NOT mean the staffing exception has been covered. Nothing is assigned after the last actual custodian departs.

Local verification:

- October 5 full seven-day generator/compiler/verifier: FEASIBLE / ACCEPTABLE, 323 source assignments, no required review work. These are local compiler statuses, not acceptance.
- Dated and recurring complete compiler witnesses independently replayed through the full verifier: PASS (two witnesses).
- New date/assignment/availability/lunch/handoff tests: 11 exact dates, 751 assignment rows (749 assigned + 2 explicit Friday OPEN), 45 scheduled lunches; boundary/tamper/unregistrable checks passed. All source duties/physical packages, stable histories and exact shifts/lunches are preserved.
- Existing compiler regression suite: PASS, including complete bounded independent oracle, exact equity and authority mutations.
- Existing model and historical handout regression: PASS.
- Existing shift-end coverage suite: PASS; 170 derived handoffs, 2,925 minute samples, 131,625 location-minute checks. Its synthetic hire fixture now sets Friday relative to the tested Monday, instead of hardcoding October 2. All existing before/after hire, restriction, duplicate and missing-coverage assertions remain.
- PDF text/data checks: all 70 pages carry the exact candidate revision; all 749 assigned-duty rows and 322 lunch segments match their employee/date data. All 70 final pages rendered and visually checked; layout bounds passed. No local PDF rendering substitutes for accepted revision delivery or real phone convergence.

Reproduction from this branch (use fresh output names; generators refuse replacement):

```bash
STATIC_WEEKLY_OWNER_CONFIG_PATH=config/custodial-six-person-static-20261005.json node scripts/generate-owner-corrected-static-weekly-schedule.mjs evidence/october5-recurring.json
node scripts/generate-october-transition-candidate.mjs evidence/october5-recurring.json evidence/new-october-candidate
node scripts/static-weekly-october-transition-tests.mjs evidence/new-october-candidate
node scripts/render-october-candidate-pdfs.mjs evidence/new-october-candidate/phone-pdf-data.json output/new-pdfs
pdftotext -layout output/new-pdfs/October_1-4_Transition_DRAFT.pdf output/new-pdfs/October_1-4_Transition_DRAFT.txt
pdftotext -layout output/new-pdfs/October_5_Recurring_First_Week_DRAFT.pdf output/new-pdfs/October_5_Recurring_First_Week_DRAFT.txt
node scripts/static-weekly-october-pdf-data-tests.mjs evidence/new-october-candidate/phone-pdf-data.json output/new-pdfs
```

The retained final packet was assembled from the two already verified complete witnesses using `assemble-verified-october-transition-candidate.mjs`, avoiding repeated solver executions when correcting display-only policy labels. All original draft attempts remain local history and are excluded from the frozen delivery bundle. The complete final proofs, local source, current PDFs and PASS logs are in that bundle.

Remaining integration work belongs to the original owner: reconcile with the latest effective production publication/staffing revision and missing projections; implement or use an independently accepted dated manager-transition materialization workflow against current authority; verify append-only acceptance, revision binding, denied backdating and actual database/reader/phone convergence. This candidate contains NO SQL migration or mounted manager command and cannot by itself repair production's `missing_projection`. It deliberately does not relax Monday recurring publication. Production's current source was not queried by this worker. The September 30 diagnosis is inherited context, not a fresh live readback.

Obtain the required bounded changed-input independent review and exact owner acceptance under the release owner's coordination before publication. The accepted production revision must then drive both phones and replacement PDFs. No release-ready claim is made by this handoff.
