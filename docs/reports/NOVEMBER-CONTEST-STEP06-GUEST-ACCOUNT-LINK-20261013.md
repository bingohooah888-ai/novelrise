# Stage 06 Part D — signed guest to authenticated reader linkage (Draft)

**Never enable or deploy under an earlier Production approval.** This part is
strictly additional migration / server code and requires a new owner approval.

## Identity and scoring boundaries

- The server validates the current Supabase access token (not user metadata or
  a client-supplied user ID) **and** the original purpose-specific signed,
  expiring, HttpOnly guest cookie. No guest key appears in the request body.
- Service-role-only \`novelight_contest_link_guest_account\` atomically locks
  the guest, resolves the verified account's private reader, marks the guest
  as \`merged\`, stops its active sessions, copies only provisional/accepted
  episode evidence with uniqueness-based deduplication, excludes author
  self-reads, and recalculates BOTH readers' scores in the same transaction.
- Replaying the same cookie+account is idempotent. Rebinding a merged guest to
  another account is rejected. Existing review holds and excluded events are
  not laundered through the link. A previously cleared account is returned to
  provisional for fraud review. Independent guest credentials still require
  stage-07 multi-identity review and must not be assumed to be a real person.
- Stage-07 adjudication and browser E2E have not been replaced by signed-cookie
  ownership. Do not publish contest scores or prize winners based on this link.
- Existing normal reading history, PV, SCOUT RECORD, LIGHT SEED and payment
  functionality are unchanged. Contest and browser transport remain OFF until
  a separately approved activation.
- Rollback refuses to delete linkage functionality after any link has occurred:
  use separate audited recovery rather than silently split consolidated data.
