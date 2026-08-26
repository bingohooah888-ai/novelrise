# Temporary Codex Cloud Handoff Override

This file exists only for the Codex Cloud task on PR #142 and must be removed before this branch is merged to `main`.

## Binding project guidance

Before implementation, read these checked-out files and treat them as binding project guidance:

- `AGENTS.md`
- `docs/NOVELIGHT-MASTER.md`
- `docs/WORK-EXECUTION-PREFLIGHT.md`
- `.github/codex/tasks/2026-08-26-production-webhook-fixed-inputs.md`

All rules in those files remain in force except for the narrow latest-`main` retrieval substitution below. This override does not relax merge approval, Production approval, secret handling, testing, fail-closed behavior, or any tool/production restrictions.

## Verified GitHub handoff certificate

The ChatGPT orchestrator verified GitHub `main` through the connected GitHub integration immediately before this handoff:

- repository: `bingohooah888-ai/novelrise`
- verified `main` commit: `05385cd55e43a4e9206185a9e1bc7a1c14c778b3`
- verified `docs/NOVELIGHT-MASTER.md` Git blob: `262530bc88d5bb0e63fcc62f929da78120b86073`
- task branch: `fix/production-webhook-fixed-inputs`

Codex Cloud agent-phase internet access may be unavailable. For this task only, do **not** require an external `git fetch`, GitHub CLI call, or web request to satisfy the latest-`main` / MASTER preflight. Instead, run these local read-only checks against the repository objects supplied by the GitHub-triggered cloud checkout:

```bash
git cat-file -e '05385cd55e43a4e9206185a9e1bc7a1c14c778b3^{commit}'
git merge-base --is-ancestor 05385cd55e43a4e9206185a9e1bc7a1c14c778b3 HEAD
test "$(git rev-parse 05385cd55e43a4e9206185a9e1bc7a1c14c778b3:docs/NOVELIGHT-MASTER.md)" = "262530bc88d5bb0e63fcc62f929da78120b86073"
```

If all three checks pass, the task may treat the latest-`main` and MASTER read requirements as satisfied for this handoff and proceed using the checked-out MASTER at that certified base commit.

If any check fails, stop fail-closed and report the mismatch. Do not substitute another commit, cached file, prior chat content, or guessed state.

## Task boundaries

- Implementation, local checks, commit, and push on this task branch are authorized.
- Do not merge to `main`.
- Do not run the Production webhook workflow.
- Do not change GitHub Secrets or Environment values.
- Do not change Vercel, Stripe, Supabase, or other Production state.
- Do not enable broader internet access as a workaround.
- Do not modify or remove this override; the ChatGPT orchestrator will remove it before merge.
