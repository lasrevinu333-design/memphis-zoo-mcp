# Approved manual schedule integration

Main works alone. The seven approved normal schedules and their frozen packet
stay unchanged. The owner approved the exact 75% proximity / 25% workload
calculation; it applies to dated absence adjustments. Activation uses the actual
server service date as soon as the implementation is ready and verified.

PTO is entered manually by Eric or through Sophia's existing authorized entry
path. Manager-confirmed full-day PTO and call-outs use the existing canonical
staffing command ledger. An imported report, a submitted request, or an arbitrary
calendar entry is not an accepted staffing command. The legacy report parser now
imports only unambiguous Approved rows; AI extractions are review data.

## Implemented preparation

`solveApprovedManualAbsencePeriod` composes the approved day engine over a
source-aligned seven-day period. Normal days bypass the solver. Unchanged dated
plans retain their exact accepted basis. A third absence requires the original
accepted two-absence plan and confirmed CoverAll hours; it substitutes capacity
without reshuffling other owners or rerunning the objective.

`prepareApprovedManualPeriodProjection` lowers those plans to native assignment
rows and native full-hour lunch records. It runs the maintained hard-constraint
model against fixed owners. The original normal source stays separate. Each
combined group/day retains its whole existing effort budget, and derived rows
retain exact parent links. Extra confirmed CoverAll hours inherit all areas
through the actual end time and add no employee shift extension. Nonemployee
capacity must have its own typed identity and no employee incumbent.

`prepareApprovedManualPeriodIsolated` uses the existing bounded compiler queue
and fused HiGHS process. Inputs are detached before the first await. The original
absolute deadline includes queuing, initialization, computation and cleanup.
Results bind the original request, source, period, native rows and lunch document.
These APIs return DATA with publication and production-write flags false.

The manager view supports early partial coverage and typed capacity. Employees
receive their own approved base areas from their actual static shift start.
Complete-site coverage begins at the approved checked start and continues
through the final confirmed staffed end. Temporary ownership of colleagues'
areas before all staff arrive remains unspecified and is reported explicitly.

## Remaining native admission

1. Connect manager-entered PTO/call-outs to this preparation from the existing
   canonical staffing/day-change command owner. Preserve original keys, accepted
   facts, cancellation targets and revision checks. Future off-days do not count
   as an additional missing on-duty employee.
2. Add narrow native SQL validation and storage inside the existing complete
   action transaction. Validate the fresh immutable normal source, exact accepted
   facts, actual availability, parent geometry/budgets, complete coverage, all
   full-hour relief and the retained two-absence basis. Persist projection,
   lunch companion and original outcome atomically. The DATA above is not an
   ordinary I1 optimizer receipt.
3. Complete the nonemployee-capacity transition as part of current-day normal
   activation. The retained reference still has eight historical placeholder
   incumbents. Existing `static_weekly_capacity_source_*` routines and
   `static-weekly-contractor-source-transition.js` already implement fresh
   capacity UUID mapping and history preservation. Reuse their checks and
   registration behavior in the atomic manual activation. Historical placeholder
   slots and people remain intact; typed capacity uses new separate slots, with
   no employee or phone identity. A legacy slot with incumbent history cannot
   be relabeled in place: the maintained hydration guard expressly rejects it.
4. Materialize subsequent aligned periods by repeating the fixed approved normal
   data. Apply only the dated accepted adjustments. Keep each normal baseline
   intact rather than optimizing or replacing it each day.

`prepareApprovedManualCapacityTransition` now reuses the maintained transition's
shared pure mapping for the manual current-date plan. Recorded-data tests retain
all 22 existing positions and history, propose eight separate nonemployee
capacity positions, and preserve all normal employee duties, shifts and lunches.
The prospective total of 30 positions is not an employee headcount. The plan
explicitly refuses Source301 admission and still requires the fresh registry,
dependency and atomic transaction gates above.

The current canonical source still has 301 migrations. No Source302 migration
has been adopted. The new native DATA path is not yet a live manager save path.
Final populated-target rehearsal, the final release pair/CI, live release and
the signed app build follow that admission work. Eric performs physical testing.

## Implementation evidence

The fresh owned Source301 SQL check qualified 346 normal assignments, 40
full-hour lunches, 40 employee-day readbacks, 162,540 location/minute ownership
comparisons and 301 additional location checks at employees' actual starts.
These are database checks, not physical device tests.

Local native DATA tests qualify unchanged normal days, a two-person adjustment,
a third-person typed-capacity substitute, confirmed coverage through 18:00,
preserved effort budgets and capacity display with null employee identity. The
capacity UUIDs in these tests are explicit disposable fixtures, not production
registrations. The owned isolated process test qualified a real dated solve,
detachment before await, event-loop responsiveness, result tamper refusal and
supported process cleanup. Its largest measured parent timer gap was 330 ms.
