# NOVELIGHT Production build cost policy

## Objective
Keep quality, current Production behavior and urgent fixes intact while reducing Vercel Build CPU Minutes. This is **not** a change to user subscriptions or Stripe billing.

## Automated control
- Vercel Git deploys stay Production-`main` only; routine branch/PR Preview remains Default-Deny.
- `vercel.json.ignoreCommand` runs `node scripts/vercel-ignore-build.mjs`. Exit **0** skips a build; exit **1** builds.
- Skip only **Production** commits containing solely `docs/**`, `tests/**`, `.github/**` or specific non-runtime root documents (README/AGENTS/CHANGELOG/CONTRIBUTING/LICENSE).
- Mixed commits, application/static assets, `api/**`, `scripts/**`, dependency manifests, `supabase/**`, `vercel.json`, Preview, unknown environment, unavailable `HEAD^`, malformed diff or other uncertainty **always build**.
- This is an optimization, not a billing hard cap. Vercel may still count a canceled deployment against quotas, and any Production code update still triggers a build.
- Approved manual redeploy of an otherwise ignored SHA may need "Use project's Ignore Build Step" unchecked in Vercel. No Preview, Staging or Production approval is granted by this document.

## Batch routine work before main
- Prefer **one cohesive implementation branch / reviewed PR per user-approved workstream**, accumulating related small UI/documentation fixes and focused tests before the single final merge into main. Do not merge each tiny adjustment just to check an unapproved Preview.
- Independently risky changes should remain isolated for review and approval. Do not silently combine Auth/RLS/Stripe/migrations/security with unrelated work solely to save build minutes.
- When the user requests several nonurgent, related changes, plan one controlled Production release. Avoid a series of immediate separate main merges whenever changes can be validated before merging.
- **Urgent Production incidents, security repairs, user-visible breakage, data-integrity fixes and required rollback** bypass batching; never delay a necessary fix to save build costs.
- GitHub CI remains enabled; merge readiness, security checks, explicit `本番承認` for high-risk Production changes, and explicit `ステージング承認` before paid Preview/Staging remain mandatory.
- This policy does **not** introduce a timer, scheduled deployment, autonomous merge queue, or bypass the existing Production main auto-deploy. Those would require a separate production-infrastructure approval and verification.

## Verify cost reductions
1. Compare Vercel Usage > Build CPU Minutes and number of successful Production deployments over equivalent windows **after** activation, not with October 5 measurements taken before the October 6 Preview gate.
2. Check skip/build events after a merged docs-only commit and a code commit. The last healthy Production deployment must remain live when skipped.
3. Review Supabase Staging compute independently: an always-on development database can still accrue cost even if no Vercel build runs. Do not pause/delete a branch automatically or without explicit approval.
4. If a deployed runtime file was incorrectly excluded, remove it from the safe list and revert this guard. Removing `ignoreCommand` from `vercel.json` restores Vercel's default per-main-commit behavior.
