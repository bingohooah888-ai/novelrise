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


## 2026-10-13 development continuation (still Draft / not activated)

- Guest credential issuance now requires a trusted Vercel-forwarded client address,
  represented only by a purpose-specific keyed hash. Migration
  \`20261013153500_november_contest_guest_guard.sql\` adds a private
  service-role-only atomic 5-per-24-hour creation cap. Missing or malformed
  trusted address denies new guest issuance; no raw IP is retained. This is
  a bounded credential-issuance throttle, **not** a human-uniqueness claim or
  anti-proxy solution.
- \`novelight-contest-read-tracker.js\` is a dedicated browser adapter for
  scroll input and TTS progress/control events, with 12-second ordered
  heartbeat attempts. It discards unsafe sequence assumptions after network
  errors, backgrounds, and lost connectivity. Concurrent devices have
  independent session IDs but one server-side account reader record.
- The adapter is **disabled by default** unless
  \`window.NOVELIGHT_CONTEST_READER_CLIENT_ENABLED === true\`. The existing
  \`novelight-reading-continuity.js\` loads it only after a published episode's
  content is mounted, then passes the reader context. This avoids editing
  \`episode.html\` directly, which is protected by the SEO shell contract.
  No existing PV, regular reading history or TTS functionality is replaced.
- Explicit release planning must separately review the browser enable gate,
  server environment flag and secret, the new migration plus rollback, and
  stage 07 fraud review. Do not silently switch on the frontend or API.
- Guest-to-authenticated account migration is **not automatically inferred**
  from a login; a separate identity-link proof and duplicate-score review
  remain necessary. A cookie alone is not a unique person.
