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
