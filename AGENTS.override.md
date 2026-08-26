# Temporary Codex cloud verification override

This file exists only to let the Codex cloud checkout verify the exact certified base when network access to GitHub is unavailable. It does not weaken Production safety rules, merge approval rules, or secret-handling rules.

For branch `fix/production-webhook-secret-rotation`, ChatGPT has independently verified the latest GitHub `main` before this task began:

- certified `main` commit: `d929a5597f29bbfb8096f2553609a780517c39ff`
- `docs/NOVELIGHT-MASTER.md` blob on that commit: `262530bc88d5bb0e63fcc62f929da78120b86073`
- `docs/WORK-EXECUTION-PREFLIGHT.md` blob on that commit: `8c556ee11106c2a2da81000d66d0a72bdd2d4572`
- `AGENTS.md` blob on that commit: `7b41960b9e644080b502d0996f4083b6596ae7ff`

If live GitHub verification is unavailable, Codex may proceed only if the local repository proves all of the following:

1. the certified base commit object exists locally;
2. that commit is an ancestor of the current task branch HEAD;
3. `git rev-parse d929a5597f29bbfb8096f2553609a780517c39ff:docs/NOVELIGHT-MASTER.md` equals the certified MASTER blob above;
4. the corresponding Preflight and `AGENTS.md` blob SHAs also match exactly.

If any check fails or the certified commit is not present locally, stop fail-closed.

All normal repository rules still apply:

- no direct `main` change;
- no merge without explicit user approval;
- no Production workflow execution or Production external-state change during implementation;
- no secret/API-key values in repository files, PR text, comments, or logs;
- automated gates remain authoritative.

The ChatGPT orchestrator will remove this temporary override before merge.