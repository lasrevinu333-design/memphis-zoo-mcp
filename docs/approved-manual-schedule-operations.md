# Approved Custodial schedule operations

Owner directions and exact formula approved in Main chat
`01a15718-2d88-7de1-8cec-6cdc241f0151`, October 30, 2026.

## Normal schedules stay locked

Preserve all seven normal days in `config/schedules/manual-approved-20261030/packet/`.
Their issued manifest is `fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f`.
No daily normal-schedule generation or absence-driven baseline replacement is
allowed. A normal-day change requires an explicit new owner request. Retain the
previous schedules, source packets, roster history and data.

One or two absences produce a service-date-specific adjustment. With a third
absence, retain the two-absence adjustment and let the manager supply an
existing source-bound CoverAll capacity position and confirmed actual hours.
Replace the third person's duties, including inherited areas and their relief
appointments, without optimizing the other normal owners again. This code
does not book a contractor or establish an authenticated manager confirmation.

## Constraints before scoring

Use the approved static shifts and lunch times, not TimeWorks punches. Every
group must have exactly one available owner through the approved coverage
window. Each lunch has one helper available for the entire hour, without an
overlapping relief appointment or the helper's own lunch. Include all inherited
groups in subsequent departure handoffs. Never extend a shift or hide an
uncovered period to make a plan pass. The final sole custodian has Zoo Wide
Coverage and inherits the areas' alerts/issues.

During an absence adjustment Tammy keeps Teton, Northwest Passage and East End
while on shift, with full-hour relief for her lunch. China Theater with its
restrooms is her only possible extra, minimized before scoring; assign relief
to other available staff first. Redistribute her areas if she is absent. Keep
Karen at Zambezi/Primate Pavilion and Kathy at East/West Admin when feasible.
Other normal assignments may move. Preserve qualifications, hard restrictions
and the existing normal-only versus inherited-alert classification for Alijah.

The existing bounded engine first solves and independently validates hard
feasibility. It then minimizes Tammy's China-extra duration, Tammy's relief
appointments, and time away from Karen/Kathy's preferred core areas in that
order. It validates each result. Only then does it construct the weighted
objective. The weighted solve fixes the validated full-hour helper appointments
and optimizes area owners. It makes no claim of a global optimum across every
alternative helper arrangement.

## Owner-approved calculation

The precise calculation was approved in response to
`call_97aaa12c08a84a0e8afed222696e481c`. The approval and parameters are recorded
in `config/schedules/manual-approved-20261030/absence-objective-proposal.json`;
the historical filename does not mean approval is still pending.

For area `g` and available employee `i`, take the minimum GPS Haversine distance
to one of that employee's original approved normal base groups. Multiply each
candidate distance by 0.80 for an explicit saved walking connection, 0.90 for a
shared saved neighborhood, or 1 otherwise. Use just one factor; overlaps do not
stack or merge transitively. Transferred areas never become new anchors.
These are preference penalties, not surveyed walking distances or times.

For each exact shift/lunch time slice:

* Proximity `P = 100 * sum_g adjustedDistance(g, owner(g)) / (23 * D)`, with
  fixed `D = 807.6262463035904` meters from the unchanged 23-group GPS reference.
* Workload `L = 100 * sum_i abs(points_i - 136/n) / (272 * (1 - 1/n))`.
  Count each approved combined group rating once; total 136. `n` is the actual
  available staff count, excluding people on their own lunches. For `n = 1`,
  workload imbalance is zero.
* Both penalties range from 0 to 100, lower is better. The combined penalty is
  `0.75 * P + 0.25 * L`. The day result is the mean weighted by each slice's
  covered minutes. There is no priority weight.

Example: loads 40/36/32/28 give `L = 7.8431372549`. With `P = 20`, the combined
penalty is `16.9607843137`. A two-hour slice counts twice as much as a one-hour
slice. This calculation applies only to dated absence adjustments.

## Activation and remaining admission work

Activate as soon as implementation is ready and verified. There is no future
Monday or November 2 hold; future dates in local tests are fixtures only.

The absence engine and CoverAll overlay currently return validated DATA drafts,
not SQL publication receipts. The remaining implementation is atomic admission
of the four existing employees over the real roster history, current-date
weekly publication/native projections, and authenticated dated-adjustment
persistence/readback. Do not label those unfinished steps completed based on
these local tests. Do not change the normal schedules to bypass admission.

## Migration-owner credential boundary

The destination is repository `lasrevinu333-design/memphis-zoo-mcp`, Actions
secret `SUPABASE_MIGRATION_DB_URL`. The candidate's
`.github/workflows/build52-production-migration-apply.yml` consumes it as
process variable `SUPABASE_DB_URL`; the distinct names are intentional.

Use project `rqquvtjdmugpigbndmne`, database/role `postgres`, TLS, and port 5432:
either the exact direct project endpoint or the reviewed session pooler. The
existing password-to-connection helper uses
`aws-1-us-east-1.pooler.supabase.com` and login
`postgres.rqquvtjdmugpigbndmne`. Transaction pooling on 6543 is not admitted.
Read-only checks must establish project, physical-cluster identity and migration
authority before the reviewed release workflow is used.

The targeted October 30 saved-file search found no verified owner credential.
Do not claim there is a saved password without a specific verified source.
No password reset, rotation, protected-store access, access-denial bypass or
reuse of backup/runtime credentials is authorized by a missing search result.
Leave `memphis_zoo_backup`, `custodial_readonly_runtime_20260822` and
`static_weekly_runtime_20260823` unchanged. No migrations or deployment were run
as part of this search or formula approval.

Main works alone. Do not resume old helpers, start another builder, or run an
audit under these implementation instructions.
