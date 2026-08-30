# Codex implementation task: initial Checkout concurrency safety

Base main: `e43e8b9003b7bad5ab0b2b84b8b20b00b31e8501`

This is a temporary implementation task file for the Codex work branch. Remove this file before the PR is considered ready to merge.

## Problem

`api/_lib/checkout.js` allows two concurrent first-time Checkout requests for the same authenticated Free user when `stripe_customer_id` is still null. Both requests can independently call `stripe.checkout.sessions.create()` using `customer_email`, so both sessions can be completed and create separate Stripe customers/subscriptions. The webhook reconciliation can then bind the profile to the first customer and reject the second customer as a mismatch, leaving a paid subscription untracked and potentially double-charging the user.

## Required implementation approach

Treat this as a High Risk Stripe/billing boundary change. Preserve current pricing and entitlement semantics.

1. First add a deterministic regression test that reproduces concurrent first-time Checkout handlers and currently demonstrates that more than one completable subscription Checkout can be created.
2. Add the smallest durable server-side per-user pending Checkout reservation/serialization boundary. Prefer a database-backed design that works across serverless instances. Do not rely only on process-local locks.
3. If Stripe idempotency is used, scope it to a logical reservation/attempt so a legitimate canceled/expired Checkout can later create a fresh attempt. Do not use a permanent fixed per-user idempotency key that blocks legitimate retries.
4. Concurrent requests for the same user must result in at most one completable subscription Checkout attempt. A follower request may safely reuse the same open Checkout URL/session, or fail closed with an explicit non-charge conflict while the first attempt is being created, but it must not create a second independent completable subscription Checkout.
5. Handle abandoned/expired/failed attempts so the user can retry without manual Production repair. Avoid stale reservations permanently blocking Checkout.
6. Preserve current behavior for paid profiles, existing Stripe customers with active/pending subscriptions, stale-customer repair, plan validation, metadata, legal disclosure copy, and user-facing safe error handling.
7. If a Supabase migration is required, add matching precheck, postcheck, rollback, and DB/RLS regression coverage according to repository conventions. Billing-owned fields/state must not become client-writable.
8. Update or add automated tests covering at least:
   - concurrent first Checkout from a Free profile with no `stripe_customer_id`;
   - normal first Checkout;
   - existing customer with ended subscriptions;
   - existing active/pending subscription routing to Portal;
   - failed Stripe session creation followed by safe retry;
   - expired/abandoned pending attempt followed by safe retry;
   - cross-user isolation;
   - no secret or sensitive payment data stored in Supabase.
9. Run the relevant repository gates. Because this is High Risk billing work, include the appropriate Node tests, formatting/lint/syntax checks, DB/RLS gate if migration changes are added, CodeQL/CI through the PR, and independent review.

## Safety boundaries

- Do not perform Production Stripe operations.
- Do not perform live charges.
- Do not mutate Production Supabase or deploy migrations to Production.
- Do not modify secrets or Production environment variables.
- Do not merge the PR.
- Production migration `20260830163000` / deploy run `33307362222` is already applied and must not be repeated.

## Definition of done for Codex implementation

The PR branch contains the focused implementation and regression tests, this temporary task file is deleted, and local/repository tests that Codex can run are green. Leave merge for the explicit user approval gate after ChatGPT independent review and CI/CodeQL evidence.
