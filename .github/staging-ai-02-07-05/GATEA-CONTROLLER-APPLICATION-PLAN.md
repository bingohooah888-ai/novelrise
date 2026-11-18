# Gate A independent Controller — code-only preparation (NO-GO)

This candidate is **not deployed or connected**. The existing A1 Worker and
`GATEA_WATCHDOG` Durable Object namespace are unchanged. This draft adds one
*prospective* Controller Worker and a Service Binding in the **candidate** S2
Wrangler configuration only. It creates no Cloudflare resources.

## Reused code

- `cloudflare-gatea-live-candidate.mjs`: existing S2 watchdog and signed death
  dispatch; no route or paid admission is enabled.
- `existing-watchdog-entrypoint.mjs` + `detached-stop-connector.mjs`: exact
  run-bound signed death verification and one-use recovery, STOP, Auth revoke,
  synthetic-only cleanup, and independent census.
- `signed-watchdog-arm.mjs` and `independent-watchdog-arm.mjs`: protected
  pre-paid ARM verification, unchanged.
- `gatea-controller-arm-issuer-candidate.mjs`: *proposed* independent issuer
  using an externally proven watchdog arm, real stop/revoke/census evidence,
  durable one-use claim, and an off-Runner signer. No real ports are supplied.

## Minimum separately approved deployment prerequisites

1. Verify immutable deployment provenance for the existing A1 Worker and
   SQLite namespace. Do not infer that a source file matches Cloudflare bytes.
2. Create **at most one** separately deployed Controller Worker in the same
   Cloudflare account, with `workers_dev:false`, `preview_urls:false`, no
   public routes, and no Production authority. Pin the controller version.
3. Provision an *authenticated*, independent source for the OWNER-approved
   immutable run scope, controller identity, signed Watchdog arm, and actual
   capabilities. No request JSON or Worker boolean can self-certify these.
4. Provision only separately approved Staging-scoped ports: durable atomic
   one-shot claim, model transport STOP (and independently state if in-flight
   provider cancellation is impossible), trial-environment OFF, bounded
   synthetic Auth revocation, synthetic-only cleanup, and independently
   authenticated zero-residue census. Preserve consumed paid-claim tombstones.
5. Provide off-Runner Ed25519 keys with pinned public keys and independently
   trusted nonces; never commit secrets or issue them via GitHub comments.
6. Review and connect the Controller runtime bootstrap to the `create020705`
   factories. The default Controller Worker is deliberately 404-only and
   `GATEA_CONTROLLER_LIVE_ENABLED=false`. The S2 proposal also leaves LIVE,
   HTTP admission and recovery dispatch all disabled.
7. Grant a **separate**, explicit OWNER approval for the future Service Binding,
   environment/Secret changes, deployment, bounded synthetic Staging STOP
   drill, and rollback. Paid AI POST remains forbidden until Gate A PASS.

## Failure semantics and rollback

Unknown identity, absent trust, signatures, permissions, stale heartbeat,
non-atomic claim, incomplete stop, absent independent census, or loss of
Cloudflare service binding all mean **NO-GO**. Never retry paid POST. Do not
report a 200 ACK, mock boolean, or signed document alone as proof of STOP.
On failed rollout keep S2 flags OFF, detach the proposed Service Binding only
under separate approval, and restore the previously pinned A1 Worker version
without deleting the existing Durable Object class/SQLite namespace. The
live controller is not installed by this change.

## Costs

No Cloudflare deployment, request, Staging operation, or paid API expense is
incurred by this code-only change. Future Workers/DO usage is subject to
Cloudflare's prevailing limits and plan. Obtain an approved spending ceiling
before activation and ensure a safe, independent stop if quota is exhausted.

## 2026-11-18: isolated candidate implementation / blocked live ports

The following are **code-only** and have no Cloudflare, Supabase, GitHub,
Vercel, JWT or AI I/O at module import. The previous Controller default
remains hard-404 even if accidentally deployed; all candidate flags stay OFF.

- `gatea-controller-trusted-bootstrap-candidate.mjs`: composes the existing
  Controller receiver and ARM issuer only with independently verified,
  immutable OWNER approval, signed Controller capabilities, and exact Staging
  identity. No concrete secrets, transports or privileges are included.
- `gatea-controller-arm-reader-candidate.mjs`: pre-paid ARM reader for the
  existing protected gate. Requires independent identity attestation, the
  pinned Ed25519 ARM signature, a trusted nonce, and a separate durable
  single-use receipt claim; denies missing/forged/stale proofs and replay.
- `gatea-controller-atomic-claims-candidate.mjs`: SQLite transactionSync
  and unique INSERT OR IGNORE candidate for existing Watchdog DO storage;
  run+approval uniqueness survives nonce/key rotation within the **same**
  approved DO instance. It does not prove real cross-process atomicity until
  DO routing, identity, storage backend and concurrent crash drills pass.
- The existing `detached-stop-connector.mjs` and
  `staging-synthetic-cleanup.mjs` remain the single Staging STOP/Revocation/
  fixture cleanup/census implementation; do NOT add duplicate delete paths.

**Still not implemented or verified in a live independent Controller:**
Cloudflare Service Binding execution; OWNER scope authentication and pinned
identity attestation; actual remote STOP and provider in-flight cancellation;
Staging-only Admin/JWT revocation; exact Vercel Preview disabling; independently
credentialed read-back/census; durable one-shot routing/fencing and concurrent
recovery; pinned signing key rotation; safe crash recovery. All of these require
separate, narrowly scoped approvals for infrastructure and credentials. A
simulated PASS is NOT evidence. Gate A remains NO-GO.

**Next one-time activation package for OWNER approval (not performed here):**
(1) set a monetary ceiling and rollback plan; (2) create at most one isolated
Controller Worker without public routes; (3) provision separate least-privilege
staging-only and read-only/census identities and pinned keys without exposing
secret values; (4) connect one internal Service Binding to the existing S2
Watchdog, preserving original A1/DO data and flags OFF; (5) verify immutable
versions, SQLite, failure containment and actual STOP authority; (6) separately
approve a bounded synthetic Staging stop/auth/census and runner-failure drill,
with no paid AI POST, no Production connection and no automatic retries.

## 2026-11-18 internal DO claim connection (candidate only)

- The prospective Controller receives `GATEA_CLAIM_LEDGER` as a **private cross-Worker binding** to the original `novelight-ai-gatea-watchdog` DO class. It must address the exact pre-existing `ai-020705-<runId>` instance. It does not create a new namespace.
- The existing S2 *source candidate* now exports an authenticated private DO fetch Durable Object private fetch handler. The live row and persisted signed-death receipt are checked **within the SQLite transaction** before a unique INSERT. A duplicate, changed scope, nonce, wrong state, missing receipt or missing binding returns NO-GO; no retries.
- `GATEA_CLAIM_LEDGER_ENABLED` remains **false** alongside all existing S2 flags. The Controller default remains 404-only. These are not deployed configurations.
- A recovery claim does not imply STOP, Auth revocation, fixture cleanup, zero census or the ability to cancel already dispatched provider requests. Existing `detached-stop-connector.mjs` still performs and checks those steps. Controller-side real credentials and independently verified STOP/census implementations are **not yet available** and may not be replaced with fixture booleans.
- Do not turn any flag on or deploy any candidate until OWNER has separately approved signed OWNER scope provenance, isolated Controller identity, Cloudflare version/rollback proof, minimal Staging-only stop/delete roles, independent census role, Vercel Preview stop, Ed25519 key lifecycle, bounded costs, and a synthetic no-paid-POST failure drill.

### Private DO fetch, secrets, and explicitly missing real privileges

Existing A1 is a legacy Durable Object class, so the Controller never relies
on an unproven modern RPC method. `GATEA_CLAIM_LEDGER` is instead a private
cross-Worker DO namespace binding pointing to the existing Watchdog Worker.
Only an exact private `POST /_novelight/gatea/claim` on the DO stub, signed
with a 32-byte HMAC-SHA256 key `GATEA_CLAIM_HMAC_KEY` (future Secret in both
isolated Workers), may attempt to claim the existing run-scoped SQLite row.
The main/public Worker does NOT route to this path. Request MAC freshness is
10 seconds; SQLite row state/nonce/signed-death fields and unique claim are
checked in one transaction. Missing Secret, binding or enabled flag fails
closed. All new settings are proposed only; **nothing is deployed**.

Live OWNER identity/signature verification, ARM trust source, provider STOP,
Vercel Preview stop, JWT/session invalidation, scoped synthetic deletion,
separately credentialed census and rollback cannot be proven by injected
callbacks, simulated booleans or offline tests. Those require separately
approved real endpoints, narrow Staging-only credentials and a live bounded
failure drill. Never enable a public admission endpoint or paid AI as part
of this code-only change.
