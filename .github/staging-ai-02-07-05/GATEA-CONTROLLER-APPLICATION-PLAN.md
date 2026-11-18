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
