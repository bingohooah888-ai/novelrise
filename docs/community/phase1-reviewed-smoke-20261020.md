# Community Phase 1 — one changed smoke test Git blob (2026-10-20)

**Draft; read-only review. No Staging or Production authorization.**

- main: `83a9554f0b47f31bad0d959dbaaba23b07a43caa`
- Draft PR #2222 head: `7f7ec898094607c70f2abd756bb00617462f787a`
- Trusted GitHub compare: **37 files, 0 behind, status ahead**.
- **36** of the 37 path/status/Git-blob triplets are unchanged from the approved immutable manifest.
- Single changed path: `tests/e2e/specs/smoke.spec.js`.
- Old reviewed SHA: `fc5fa385bb5f285e971367a0c04fa30ff4047126`.
- New combined reviewed SHA: `eae105adb9704a1a694764904b522a1f372c7014`.

The candidate merges the latest main's header action geometry and label-centering test additions with Phase 1's `./community-plaza-ui.js` mock browser import. This test uses local mocks, not a paid Staging/Preview environment. Current main accessibility CSS, header tests and read-only pre-cost security from PR #2395 are kept. The new test requires this specific combined blob and refuses the old blob. All existing missing/extra/different-content, exact ancestry, Draft state and OWNER one-use restrictions stay fail-closed.

Issue #188 is CLOSED, PR #2222 remains Draft/unmerged. No public timeline or board enablement. Hosted paid write paths stay blocked. Supabase shared Staging still contains the divergent migration `20261014052000` and lacks Production/main `20261018120000`; independent staging administration and enforced hard spend ceilings are unverified. Do not run real Staging, migrations or Preview.

**Approval scope:** Only a new scoped `本番承認` permits merging this three-file security review PR (manifest, focused tests, evidence). Not PR #2222, Issue #188, DB, paid Stage or public feature release.
