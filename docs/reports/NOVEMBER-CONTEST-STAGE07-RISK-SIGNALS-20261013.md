# NOVELIGHT contest stage 07 — private non-punitive fraud signals (Draft)

The earlier owner-approved Production work ends at migration
\`20261013162500\`; this new \`20261013171000\` migration is **not**
authorized for Production by that approval.

This first stage-07 slice returns objective, private *risk indicators* for
operator investigation without silently removing scores or excluding users:

- 20+ reading session starts in one hour (the current DB hard cap is 25);
- 12+ distinct qualifying episodes in an hour;
- 2+ overlapping foreground sessions in different episodes in 24 hours;
- server-qualified sessions with inconsistent mandatory time/progress/evidence;
- 3+ signed guest credentials previously linked to one account.

The indicators are **not conclusive fraud**. Concurrent tabs, a fast human
reader, IP address churn, shared networks and accessibility/TTS usage can
produce false positives. In particular, a signed guest cookie does not prove
one distinct natural person. Automatic punishment would be unjustified.

Technical boundaries: backend-only service_role RPC; database RLS privileges
remain unchanged; no public network endpoint; no raw IP or browser fingerprint
returned; no event or reader mutation; no award decision. The operator review
queue, audited hold/clear decisions, reader appeals, bot/multi-identity
correlation, session UX E2E and activation are separate later steps.

The current contest is draft/private. Browser and server reading enable gates
remain OFF until separately approved. Preview/Staging and Production are not
touched by this Draft.
