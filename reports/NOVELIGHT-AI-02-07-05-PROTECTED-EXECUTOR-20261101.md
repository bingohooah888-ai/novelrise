# NOVELIGHT AI 02-07-05 | Protected Staging Executor wiring (dormant)

Base main: `80378003586727acbed1e991cc3f3c13680acb7a`. 2026-11-01 JST.

## Scope
- A new **dormant** `protected-stage-executor.mjs` composes the already merged GitHub OWNER approval coordinator, atomic one-shot guarded provider and existing synthetic Staging cleanup adapter. It has no CLI entrypoint, Actions trigger, credentials, HTTP endpoint, Preview creation or direct external network activity.
- Six **mandatory trusted read-only** preflight adapters must verify current main, protected Staging runner, approved Preview identity, applied atomic migration, actual synthetic consent and provider-side 10-yen billing ceiling. Every failure denies **before** GitHub CLAIM and before provider/DB work.
- OWNER, exact SHA, Preview ID, Staging Supabase ref, synthetic actor/novel/episode, <=10,000,000 micros ceiling and provider metadata are bound to the same one-shot guarded provider. A mismatched guarded provider cannot be substituted.
- On an admitted attempt the existing coordinator writes one GitHub CLAIMED, one atomic Staging claim immediately before the only provider attempt, then **always attempts** Staging AI OFF/zero budgets + protected environment stop, verified synthetic JWT revocation/deletion, independent zero-row census and CONSUMED. Failures consume the approval without retry.
- Focused tests are synthetic only. The existing `ai-020705-owner-staging-paid-trial.yml` remains strictly read-only and **does not invoke this executor**. No live AI or Staging actions have been performed.

## Still NO-GO
- These preflight adapters must be bound to genuine GitHub/Vercel/Supabase/provider **read-only** observations and independently reviewed. The Stage workflow must be explicitly protected, scoped and separately approved before wiring live callbacks.
- The existing cleanup contracts still require independently authorized real stop, Vercel environment rollback/reset, Auth session revocation, synthetic fixture cleanup, independent census and out-of-process watchdog for runner cancellation. A timed-out or killed process cannot guarantee `finally` execution; an external watchdog is mandatory before live trial.
- Staging migration not applied; new exact-SHA Preview not prepared; protected credentials, independent paid-call limit enforcement, real JWT, paid AI, consent proof and billing verification are not approved/proven.
- This PR is **code/offline tests only**, not operational readiness. Do not merge without separate `本番承認`; do not make a Preview, Staging write/migration, JWT test, external paid call, Production mutation or AI enablement without separately scoped authorization.
