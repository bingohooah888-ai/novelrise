# NOVELIGHT beta data foundations

This document describes the beta-start ledgers added by `20260823170000_beta_launch_data_foundations.sql`.

## Content classification

Every newly published work must explicitly declare one of `human`, `ai_assisted`, or `ai_generated`, acknowledge the current content policy, and choose `general` or `mature`. Mature works require at least one content warning. Existing pre-beta rows remain `unspecified` until the author edits/reconfirms them; they are not silently relabeled.

## Moderation reports

`content_reports` is operator-only. Readers submit reports through `submit_content_report`; the RPC validates the target, rate-limits by authenticated user or a one-way hash of the random visitor token, and stores structured categories for copyright, prohibited content, harassment, spam, AI misclassification, or other concerns.

## Acquisition and X attribution

Landing pages record UTM-style campaign metadata in `acquisition_touches`. Only the random visitor token hash is stored. After authentication, `claim_user_acquisition` links the first touch to the account in `user_acquisition`; X account information is never collected.

## Return visits

`beta_activity_days` stores one row per pseudonymous viewer/day and supports 7-day / 30-day revisit and retention analysis without storing the raw random visitor token.

## Reader journey

`reader_journey_events` records direct and externally sourced detail opens, meaningful 10-second episode reads, favorite additions, and LIGHT SEED actions. This ledger is intentionally independent of the internal discovery-impression attribution table so X/direct visits are not discarded merely because they have no recent NOVELIGHT impression.

## Founding Authors

`founding_authors` assigns immutable numbers 1–100, concurrency-safely, to the first 100 distinct authors who publish a work after this migration is deployed. Existing pre-migration/dev works are not backfilled.

## Subscription history

`subscription_event_log` is an append-only server-side ledger. The verified Stripe webhook writes each Stripe event once after entitlement synchronization, allowing plan conversion and cancellation history to be analyzed without relying only on the current profile state.
