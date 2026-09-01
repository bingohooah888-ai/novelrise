# β版 露出配分 v2

`20260823171000_initial_and_paid_exposure.sql` adds two beta-release guarantees without changing ranking scores or ratings.

## Initial exposure opportunity

All newly published works, including Free, are eligible for an initial discovery priority until they have accumulated the tunable `initial_exposure_target` sample (default 6 impressions) or leave the tunable initial window (default 30 days). The number is an operating beta parameter, not a public promise of readers, clicks, PV, or ratings. If there are no readers, NOVELIGHT cannot manufacture impressions; when discovery traffic exists, under-sampled new works are prioritized before normal balancing.

Initial priority is followed by the existing author/work exposure balancing. Paid plan weights do not exclude Free from the general feed.

## Measurable plan additional exposure

Standard and Premium receive an explicit `home_plan_extra` surface outside the general feed. Premium receives a modest selection weight within that paid surface, and Premium keeps its existing separate premium slot. Because these surfaces are recorded independently, LIGHT ANALYTICS can report actual impressions delivered through plan-only opportunities rather than estimating a counterfactual uplift from an opaque weight.

General discovery remains available to all plans. Explicit new/PV/favorite sorts are not converted into paid rankings.

## Data

`novel_exposure_events.allocation_reason` distinguishes `initial_exposure`, `plan_extra`, `premium_extra`, and normal `balanced` exposure. Raw viewer identifiers remain server-side and authors receive only aggregates.

## Authoritative impression trust boundary

The forward migration `20260831210000_trusted_allocation_receipts.sql` makes an
authoritative impression possible only after an authenticated viewer receives a
private, opaque allocation receipt. Each receipt expires after five minutes, is
single-use, and is bound server-side to its viewer, allocation batch, exact work,
surface, author and plan snapshots, rule version, and allocation reason. The
consumer locks receipt rows before validation and recording, so concurrent replay
fails closed. Clients submit receipt UUIDs only; they cannot choose any ledger
snapshot or promote an allocation to a paid surface.

The historical caller-controlled recorders are revoked from both `anon` and
`authenticated`. Anonymous visitors can still browse discovery, but receive no
receipt and therefore cannot alter fairness, FIRST LIGHT, paid-exposure, or
authoritative analytics counters by rotating visitor tokens.

Neutral new/PV/favorite search telemetry is stored in
`neutral_search_impression_telemetry`, outside `novel_exposure_events`. It is
useful for coarse product telemetry but is never authoritative discovery evidence.
Applying this migration to Production remains a separate owner-approved operation;
the paired precheck, postcheck, and rollback are exercised by the Beta P0 gate.
