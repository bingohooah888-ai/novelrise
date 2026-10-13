# 2026-11 contest stage 06 Part C — private reader HTTP boundary

Draft only. Stacked after PR #2179 / #2180. No Production deployment,
migration, registration change or contest activation is permitted here.

- New POST-only \`/api/november-contest-read\`, disabled by default:
  \`NOVELIGHT_CONTEST_READING_ENABLED=true\` must be set only after explicit
  launch/security review and environment approval.
- Requires 32+ byte purpose-specific \`NOVELIGHT_CONTEST_GUEST_SIGNING_SECRET\`
  (different from Supabase service secret). Never add its value to GitHub.
- \`NOVELIGHT_CONTEST_ALLOWED_ORIGIN\` defaults to \`https://novelight.jp\`.
  All POSTs require an exact same-origin Origin and Host.
- Authenticated reader: server verifies Supabase bearer token with getUser;
  user identity is never accepted from the request body.
- Guest reader: unpredictable, signed, expiring, HttpOnly + Secure +
  SameSite=Strict \`__Host-\` cookie. Only a hash is stored in the private
  contest readers table. Invalid credentials fail closed.
- Private readers are resolved per contest with database uniqueness. Session
  IDs are checked against contest/reader before calling server-only RPCs.
  Qualification creates only provisional idempotent episode evidence.
- A new identity is never created while the contest is draft/hidden/outside
  the running window. Session creation has the existing database 25/hour
  per-reader limit; heartbeat has its existing DB 8–45 s and sequence guards.

**Not yet approved for activation**: cookie clearing or multi-accounting can
produce new provisional guest identities. This API does not claim durable
cross-instance IP rate limits, bot prevention or human identity. An enforceable
credential-issuance rate limit and stage 07 fraud review must be delivered
before enabling the endpoint. Browser scroll/TTS wiring, background/pause,
reconnect, guest-to-account merge and live E2E are still pending. Ordinary PV,
SCOUT and LIGHT SEED remain untouched. Existing PR #2181 stays unmerged/closed.
