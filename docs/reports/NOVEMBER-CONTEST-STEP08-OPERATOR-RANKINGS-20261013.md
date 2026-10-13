# NOVELIGHT Step 08 — ranking release controls, approval-bound Draft

The previously approved Stage 08 snapshot infrastructure is deployed in
Production as migration \`20261013194500\`, with the November contest still
\`draft\`, \`public_visible=false\`. This Draft extends that infrastructure
without switching any Production release flag.

## Ranking operator interface

The new NOVELIGHT ADMIN \`admin-contest-rankings.html\` provides the three
pre-established windows (November 7, 15 and 22, 2026 at **12:00 JST**), a
private ranking-preview table, and separate buttons for preparing a draft and
publishing a ranking. Only authenticated allowlisted admins can read/write
using the existing \`requireAdmin\` boundary. The write endpoint is
*default-disabled* unless
\`NOVELIGHT_CONTEST_RANKING_ADMIN_RELEASE_ENABLED=true\` is explicitly
configured under a separate, scoped rollout approval. The body requires
a review note of at least 20 characters, and publication additionally requires
typing \`発表承認\`. A SQL RPC independently verifies active/public contest,
the exact release time, snapshotted row checksum, selected snapshot UUID,
and a draft status, then publishes and records an operator audit in one
transaction. A stale preview cannot publish a changed snapshot. The contest
still cannot be started or cash awarded from the interface.

## Noon auto-preparation (NO ACTIVE CRON)

The \`GET /api/november-ranking-prepare\` service handler is
**dormant by default**. It requires BOTH
\`NOVELIGHT_CONTEST_RANKING_AUTO_PREP_ENABLED=true\` and a matching
server-only \`CRON_SECRET\`. Even then it rejects any date except
2026-11-07 / 15 / 22, 03:00–03:14 UTC (12:00–12:14 JST).
The matching service-role RPC checks the database clock independently,
requires the active/public contest, writes a private draft and an audit.
It **never publishes**.

**No \`crons\` block was added to \`vercel.json\` and no scheduler job has been
enabled.** A future separately authorized operational change may schedule
\`0 3 7,15,22 11 *\` in UTC only after verifying plan limits, deployment,
auth headers and rollout flags. The actual public release remains a separate
human approval and action. Automatic private preparation by itself does not
meet the public ranking publication requirement.

## Risks and next gates

- One new migration:
  \`20261013210000_november_contest_rank_operator.sql\`; no new tables.
  Private RPC roles, audit idempotency boundaries, draft mismatch protection.
- Rollback refuses to erase functions after automatic or operator audit events.
- Test scope: Node admin-auth/CSRF/flag validation, Cron secret / date window /
  non-publication, disposable DB RLS/hidden-state, static checks. Existing
  general browser CI is not equivalent to end-to-end live Supabase verification.
- Further approval needed for: Production PR/migration merge; any actual cron
  schedule or flag activation; public contest/registration/reading activation;
  public publication, winner selection and cash transfers. Each is distinct.
