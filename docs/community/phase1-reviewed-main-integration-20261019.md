# Phase 1 — content review after main UI integration (2026-10-19)

**DRAFT / REVIEW ONLY. This is not a Production, Preview, or Staging authorization.**

Current main at review: `14094f0265d592d332ea10514110ed48642bb0d2`.
Open Draft PR #2222 head: `b239173c7d939fc3729bb7804fb95c1c6cc8a9b0`.
Trusted GitHub compare: **37 files; status ahead; 0 commits behind**.

The previously approved 37-path manifest remains complete. **34 paths retain exactly the earlier Git blob and change status.** Only the following three paths change to incorporate concurrently merged Production UI corrections:

| Reviewed file | Previous Git blob | Re-reviewed Git blob | Reviewed main changes |
|---|---|---|---|
| `author-notes.html` | `b55355a64dcc75225e9a59ff2432fd0e460b46c5` | `5bd92792238608743d00d4d3eef72862cfcb070b` | Keep responsive note-title CSS and gated timeline controls |
| `index.html` | `104fd490a8326277a6a5f855dae1883064e336a6` | `6267de4d01d91839f155af745d1577bb2bbc0395` | Keep reader-account script and gated Community scripts |
| `tests/accessibility-baseline.test.mjs` | `7922d5506fddd0567d1e5fd1394d2e698a689a69` | `cb72484530f211c56c335b2fe62dcc81e8d9b831` | Account for 77 current-main pages plus 2 Community pages (79 total) |

The remaining two main-only updates (page-heading styles and inquiry-69 test) were merged without affecting the 37-file diff. Existing safety preflight changes from PR #2388 are also inherited in candidate history. No public feature flag was flipped.

**Unchanged fail-closed guarantees:** full file path/status/Git-blob check; current-main ancestry; Draft unmerged PR; one-use OWNER identity; closed Issue #188; required CI and CodeQL; no claim/deployment/staging without separately verified `ステージング承認`. Other old-SHA hosted-write and rollback paths remain blocked.

The shared Staging database is not approved for write: it has migration `20261014052000` missing from main, while main/Production has `20261018120000` missing there. Provider-enforced hard spend limits, independent Environment protection, isolated actual-user/admin proof and cleanup remain unverified. The currently connected Supabase account lists Production only in project-management inventory; Staging history is readable but Staging project-management and branching permissions are not established.

**Approval boundary:** `本番承認` for a future main merge of *this manifest and tests only*. Before any paid Preview, require a different exact-main/HEAD, one-use `ステージング承認`. PR #2222 must again be synchronized to main after a manifest-only merge; never release its 37 files or DB migration under this security PR.
