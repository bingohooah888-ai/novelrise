# NOVELIGHT November 2026 contest — guest anti-fraud security contract

Status: security foundation on a work branch; **not integrated with contest scoring and not deployed**.
This document describes required controls for any guest points to count toward a monetary award.

## Locked product decisions

- Competition: 2026-11-01 00:00 to 2026-12-01 00:00, Asia/Tokyo (end exclusive).
- One author, one eligible work; the work must contain >=10 publicly published episodes.
- Guest readers are eligible without creating accounts.
- Score per reader per work: >=3 distinct qualifying episodes = 1 point;
  >=5 = 3 points; >=10 = 5 points. **Replace** points at each milestone; never sum 1+3+5.
- No repeated episode credit for the same verified reader identity.
- Awards: top five works at JPY 10,000 each, including ties at the award boundary.
- Public snapshots update at 12:00 JST on Nov 7 / 15 / 22 and remain visible until Nov 30.
- Competition scores must never modify normal PV, Rank, SCOUT XP, LIGHT SEED or exposure allocation.

## Threat model and hard limits

Potential attacks include scripted replays, forged progress values, cookie deletion,
browser changes, short-duration page churn, shared/proxy/VPN networks, bot traffic,
client clock manipulation, guest-to-account double counting and collusion with authors.

**No cookie or IP technique can prove a unique human.** A motivated actor can reset
browser storage or rotate egress IPs. Thus a signed cookie protects integrity, not
uniqueness. Network evidence is supplementary risk evidence and never a standalone
proof of collusion. Shared homes, institutions and carrier NAT must not cause
automatic disqualification.

## Implemented, isolated core

`api/_lib/contest-guest-security.js` provides:

1. Signed, purpose-scoped, cryptographically random credential with server-side
   validation, constant-time MAC comparison, expiration and __Host- cookie flags.
2. Explicit origin allowlisting, rejecting cross-site requests and duplicate cookies.
3. HMAC-pseudonymized coarse network and user-agent evidence; no raw IP persistence
   through this utility.
4. Server-timestamp-based read heartbeats, replay/sequence controls, bounded elapsed
   credit, progression gating and no client-clock dependence.
5. 3/5/10 threshold scoring and independent payout-review disposition.

`tests/contest-guest-security.test.mjs` covers signed token tampering, expiry,
cross-contest replay, cookie tossing, origin rejection, time gating, replay and
non-additive points.

## Integration gates: NOT YET IMPLEMENTED

This branch intentionally DOES NOT attach the foundation to `episode.html` or
the existing `record_episode_pv` RPC. When the contest enrollment and server
ledger are built, the following are **required** before any guest point is awarded:

- Contest eligibility must be verified server-side on every first read event:
  active contest, enrolled published novel, published episode from that novel,
  no disallowed author/self reading, official JST timestamp window.
- Server issues credential in `Set-Cookie` only after verifying request origin;
  never accept guest ID or score supplied in the JSON payload.
- A trusted, atomic, privately accessible database ledger stores server-issued
  reader/session IDs, campaign, episode, aggregate progress and risk disposition.
  Unique constraints + row locks must make retries, parallel requests and
  multiple tabs idempotent.
- Each heartbeat validates server-side ordering and elapsed foreground time.
  Client scroll/visibility/interactions are hints and cannot establish human
  identity. Establish minimum thresholds for sufficiently deep reading
  (including short chapters / TTS / accessibility) before a chapter can qualify.
- Same episode is credited at most once per reader. Count distinct published
  episodes only, and compute 0/1/3/5 as a pure recomputation of current verified
  evidence, not as sequential +1/+3/+5 award events.
- Authenticated-session linkage: if a guest signs in, reconcile the guest ledger
  into the authenticated user ledger **transactionally**, never sum both readers'
  points for the same novel/episode.
- Correlate abnormal repeated device/network clusters, account creation spikes,
  implausible chapter completion patterns, and known bots via privileged evidence.
  Rotate HMAC salts and privacy-bound evidence retention under an explicit policy.
- Suspected automated or multi-account events go to `review_hold`, with human
  review, an audit trail and a clear appeals process; only **confirmed** abuse
  is excluded. Suspicion must not itself mean author disqualification.
- Server-only risk weights, detection thresholds, network correlations, and
  administrative notes may not leak through public APIs or dashboards.
- Suspected high-risk sessions may require additional abuse challenges, but
  guest readers must not be required to register merely to earn points.
- Keep minimum personal data. Do not store raw IPs in the public database or
  make browser fingerprinting / canvas fingerprints a permanent identity.
- Default deny if required env keys, contest config, audit ledger or database
  migrations are unavailable. Never fall back to a service-role key as a signing
  secret, never fail-open to raw PV, never accept a caller-supplied score.
- Verify RLS, privilege revocation, SSRF/cross-origin controls, rate limits,
  edge cases at JST time boundaries, transactional idempotency, staged and
  completed guest-to-auth migration, high-volume abuse and rollback readiness.

## Security keys and deployment requirements

Define a separate, 32+ byte high-entropy
`NOVELIGHT_CONTEST_GUEST_SIGNING_SECRET` only on the server. It must be distinct
from Supabase service-role keys and existing analytics fingerprint secrets.
Do not commit the key or return it in errors.

API routes must accept only trusted production origins and use a
`__Host-nl_contest_guest` cookie with `HttpOnly; Secure; SameSite=Lax; Path=/`.
Set `Cache-Control: no-store` for sensitive API responses.

**Neither a passing unit test nor this foundation makes contest guest points
production-ready.** The prize-bearing read ledger, rate controls, moderation
admin view, RLS integration, and end-to-end tests must pass FULL PREFLIGHT;
Production merge/DB mutation requires a fresh explicit `本番承認`.
