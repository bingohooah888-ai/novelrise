# Phase 02-07-04: hosted real JWT + isolated Preview proof (NOT AUTHORIZED)

Status: **preparation only**. Previous synthetic DB concurrency proof
[Actions 40682515833](https://github.com/bingohooah888-ai/novelrise/actions/runs/40682515833)
passed and its one-use approval was consumed. Its approval does **not** cover
Auth user creation, password sign-in, Preview deployment, feature flags or
additional Staging writes.

## Confirmed constraints (2026-10-28)

- Production Supabase: `fiepaguycecrredwrcwx` — NEVER target.
- Dedicated Staging Supabase: `wmlzjgvxgoyrovdhbqbg`.
- Vercel project `prj_SmotUNrcyuUntdWTayzWeJ8eQGqe`, team
  `team_2XFgtRCPJQ6pbrEa4mOLQAEx`; no Preview deployment currently
  exists for the Phase 02-07-04 Draft branch.
- `vercel.json` intentionally disables Git auto-deploy for every branch
  except `main`. A protected Preview requires **separate approval** and
  an explicit, authorized deployment mechanism, not a casual branch push.
- The owner route `/api/ai-owner-bible-review` is gated by both
  `NOVELIGHT_AI_REVIEW_ENABLED=true` and
  `NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED=true`. Do not change either on
  Production; if approved, enable only on the isolated Preview with
  Staging-backed credentials. This is a route-preview exception, **not**
  permission to turn on model generation or positive AI spend budgets.
- The Auth sign-in necessarily changes `auth.users.last_sign_in_at` and
  may create Auth session records. It is **not** a read-only exercise.

## Proposed independently approved fixtures and strict scope

- Only Staging synthetic user UUID
  `00000000-0000-4000-8000-000000000943`, email
  `ai-review-jwt@example.invalid` and a randomly generated password.
  Provision with an approved Supabase Auth Admin mechanism, mark email
  confirmed, set `internal_e2e` metadata, verify all participation and
  notification side effects. Never print or commit the password, JWT, secret
  key, service credentials, or Vercel bypass token.
- Only a private, unpublished Staging novel `998891003` owned by that UUID.
  No actual user, work, episode, author profile, campaign, or credit writes.
- Pre- and post-census must confirm the dedicated project, exact migration,
  reserved fixture IDs free, no AI candidate rows, runtime AI OFF and all
  four budget caps zero. Discover and audit Auth/session/trigger side effects
  before writing. No broad cleanup or auto-retry.
- Cleanup may revoke the synthetic Auth session, delete only exact approved
  fixture IDs, and confirm zero FK/non-FK residues; those cleanup writes
  themselves must be part of the later explicit authorization.
- No auth logins with real accounts; no Preview POST review decisions;
  no AI model calls; no billed credit operations; no Production mutations.

## Trusted, isolated Preview requirements — separate authorization

1. Freeze the exact current Draft PR #2601 SHA and GitHub main SHA.
2. Deploy that exact Draft SHA to a **protected** isolated Vercel Preview
   using separately approved deployment permissions. Verify the deployment
   belongs to the exact NOVELIGHT team and project; no custom Production
   domain, no Production target.
3. Configure **Preview only**: `VERCEL_ENV=preview`,
   `SUPABASE_URL` and `NOVELIGHT_STAGING_SUPABASE_URL` equal to
   `https://wmlzjgvxgoyrovdhbqbg.supabase.co`;
   `SUPABASE_PUBLISHABLE_KEY` and
   `NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY` are the dedicated
   Staging publishable key, `SUPABASE_SECRET_KEY` is a dedicated
   Staging server key, `NOVELIGHT_AI_ADMIN_USER_ID` is the synthetic
   UUID, Stripe secret uses test mode, and *Staging runtime AI remains OFF*.
   Keep all protected credentials out of logs and committed files.
4. Make sure the Preview facts endpoint reports the exact Draft commit,
   environment `preview`, exact deployed origin, dedicated Staging
   backend and Stripe test mode.
5. The dormant probe `scripts/ai-review-hosted-jwt-probe.mjs` first queries
   Vercel's **own** deployment metadata with a separately scoped
   read-only Vercel API token and requires the expected deployment ID,
   READY non-Production state, exact project/branch/commit and origin.
   Only then can it access the protected Preview or attempt Auth sign-in.
6. Probe verifies an absent bearer returns 401 and the preapproved
   synthetic owner's real Supabase JWT yields a GET 200 with
   `aiGenerated: false`; logs must be secret-free.

## Approval boundaries (all separate)

A. Approve protected isolated Preview creation and its Preview-only
configuration. A previous main promotion is not this approval.

B. Approve exact-ID Staging Auth account, login mutation, private novel
creation and exact-ID cleanup, including session revocation/residual risk.
This requires a new one-use, exact SHA-scoped approval; neither previous
race-proof permission may be reused.

C. Any later full PR #2601 main merge, AI launch, budget change or Production
deployment is separately gated and is **not** authorized by A or B.

**Fail closed:** absent protected Preview, Vercel provenance, valid owner
authorization, a ready fixture or expected environment facts means no
bearer transmission, no Auth sign-in and no deployment. Never auto-retry
hosted writes or broaden residue cleanup.
