# NOVELIGHT AI / Phase 2 common foundation (development only)

Scope approved by owner on 2026-10-27: **33 AI domains** (high: 19, medium-high: 9, medium: 5).
This file is an implementation record, not a change to the Chapter 47 MASTER.

## Implemented on work branch

- `api/_lib/ai/registry.js`: allowlist for exactly 33 approved AI domains; 24, 25, 30 excluded. The 2026-10-26 extensions are merged into domains 01, 05 and 14–16. Image generation is domain 36.
- `api/_lib/ai/context.js`: projections for owner-accessible drafts and reader-accessible, published, explicitly completed episodes. Reader contexts cannot contain private author notes. Server caller MUST query authoritative owner/public visibility and reading progress; never trust request JSON for these fields.
- `api/_lib/ai/router.js`: feature allowlist, explicit server authorization on every request (including cache), provider abstraction and retryable-only fallback, work/reader/revision-separated cache keys, durable budget interface, conservative reservation and audit metadata without raw text.
- `api/_lib/ai/providers.js`: server-side OpenAI Responses and Gemini generateContent adapters; `store: false` on OpenAI; no real API call in tests.
- `tests/ai-foundation.test.mjs`: relevant safety and mock-provider tests.
- `supabase/migrations/20261027120000_novelight_ai_shared_runtime_foundation.sql`: **not applied**; global OFF default, four micro-JPY budget ceilings, atomic reserve/settle RPCs, service-only RLS tables, and private Novel Bible fact / per-episode state storage.
- `api/_lib/ai/supabase-store.js`: Supabase adapters for durable budget reservations and sanitized audit, plus author-ownership-scoped inferred Bible facts; AI cannot overwrite a confirmed fact.
- `tests/ai-supabase-store.test.mjs`, `tests/rls/ai-runtime-foundation.sql`: mock adapter and disposable-Postgres RLS/budget contracts.

## Deliberately NOT implemented or enabled yet

1. No production HTTP route or user-facing AI interface. New modules are not imported by the deployed application.
2. Database migration has been authored on the work branch but **has NOT been applied to Staging or Production**. AI Credit purchase, pricing, entitlements and UI remain unimplemented; never enable AI usage until DB contracts and permissions are verified.
3. No external AI provider credentials configured; no paid API calls have been made.
4. No chapter 39/40 Geometry or image-upload permissions modified; image generation requires a separate image safety/storage/rights design.
5. No Preview, Staging or Production deployment and no change to pricing, billing, author drafts or public rank.
6. No completion claim for any of the 33 user-facing AI features.

## Release blockers and contract for the next workstream

- Review and safely apply the proposed `novelight_ai_*` tables and atomic usage RPCs only in an explicitly approved environment. The existing in-code cache adapter still needs durable backing, and official AI Credit entitlements/balance ledger remain separate work.
- Validate atomic user/day/month and global/day/month budget limits, idempotent request hashes and settlement under concurrency. All model rate inputs are **micro-JPY per million tokens** and must be set conservatively from verified provider pricing and exchange rates. The initial development API budget cap remains **JPY 5,000**, not authorization to execute external paid calls.
- Integrate owner and reader permission checks with existing `novels`, `episodes`, `reader_reading_progress` and `novel_private_story_notes`. The current `projectAiWorkContext` accepts only server-verified state and must NEVER be exposed directly with untrusted progress.
- Include publication visibility, scheduling, collaboration grants, deletion, future chapter boundaries, API request ceilings and role privileges in integration tests.
- Admin AI requires the existing `requireAdmin` allowlist, never a user-writable JWT claim.
- Account for provider-specific token charging, unknown response usage, multiple failed fallback calls, and a systemwide hard budget.
- Add feature flag default OFF and separate staging/production approval. Verify each feature only after actual UI, API and RLS integration.
- Review provider data-processing policies before sending third-party work text; never assume a free API tier permits confidential drafts.
- Keep price data configurable by verified provider/model; do not put unconfirmed fixed model pricing in `registry.js`.

## Security notes

The pure context projection and router are building blocks, not an authorization boundary until wired to trusted DB queries and server-only credentials. The `budget` object cannot be an in-memory counter. The budget must be persisted transactionally across Vercel function instances.

AI output must never be counted as PV, human comment, human evaluation, stars, LIGHT SEED or Rank.

## Cost and approval boundaries

Use built-in Node 24, existing Vercel and Supabase. Do not add dependencies or paid infrastructure. A branch/PR or mock CI verification is not a staging approval. Do not merge to main or mutate Production without the separate explicit approval required by AGENTS.md and MASTER.
