# NOVELIGHT November contest — Stage 07 operator review (approval-bound Draft)

This proposal adds one private service-role-only migration,
\`20261013183000_november_contest_admin_review.sql\`, and a rollback that
refuses to erase a function after operator decisions exist. The older
\`20261013171000\` read-only risk-signals migration is already in Production
and must not be replayed.

The operator dashboard is linked from the existing NOVELIGHT ADMIN page.
All reader, score, anomaly and audit data is acquired only through an
authenticated, owner-allowlisted server endpoint using the existing
\`requireAdmin\` security boundary; no public Supabase read grant is opened.
A bounded list uses max 20 reader rows per page and server-side private risk
signals. Details load only on request. The browser renders untrusted
identifiers, notes and metrics using \`textContent\`, not interpolated HTML.

Allowed decisions are:
- **hold**: stop provisional scoring while evidence is reviewed;
- **reopen**: return to provisional scoring after further review;
- **clear**: operator reviewed evidence, not a finalized prize/winner decision.

Every change requires a 20–500-character note, restricted reason code, a
verified admin UUID and exact previous reader status. The SQL row lock rejects
stale and merged/excluded readers, recomputes affected per-work scores in the
same transaction, and writes a permanent contest-scoped audit row containing
the previous/new state, operator, reason and note. Ordinary readers cannot
call the review RPC. There is no automatic punishment or contest activation.

**Boundary**: Draft PR only; new migration not approved for Production.
Live operator-browser E2E, fraud appeals policies, human review procedures,
multi-identity resolution and contest opening remain separate work.
Preview/Staging remain default-denied without \`ステージング承認\`.

## Operator UI concurrency regression

UI keeps an operator's evidence note after a stale writer or server rejection, refreshes the current review state and prevents stale network responses from overriding a more recent selected reader. Review actions on excluded/merged readers are disabled in the client in addition to server/DB rejection. Local Playwright API mocks are not equivalent to staging/live HTTP proof.
