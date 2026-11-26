# NOVELIGHT 02-07-05 S2 — existing Cloudflare A1 code-only candidate

2026-11-14 JST. PR #2860 Draft. Gate A NO-GO until real independent evidence. No deploy or paid request.

## Pinned immutable A1 source
Original owner-uploaded A1 ZIP sha256 verified against the original one-shot deployment script:
- cloudflare-gatea-watchdog-worker.mjs: ff4625b7363e286ed348f6734237280f85980e9a39d3ef1fa36fb6d776330e15
- cloudflare-gatea-watchdog-do.mjs: 31a0f76a812aa044cd84bedf96c5cc0577aa97dbe58de6393711885dc390267b
- wrangler.gatea.local.jsonc: d511ff4c21036fc97ba80c73dcb675d999b86413f1f5156349a83ee9015
These original files have not been overwritten. Remote deployed JS bytes have NOT been fetched or hash-verified. A1 was synthetic-only.

## Source changes (NOT live)
- cloudflare-gatea-live-candidate.mjs exports the SAME existing Worker DO class; closed public fetch unless independently approved enable flags and route. Arm requires owner Ed25519, heartbeat requires distinct runner Ed25519. Cloudflare DO alarm separately inspects GitHub Actions run and jobs, claims one durable recovery nonce and signs a proof only after verified unsuccessful terminal run and fresh signed heartbeat. The proof is stored in DO SQLite for later authenticated receipt retrieval.
- trusted-main-live-runtime.mjs, in app composition (not the restricted trusted control slice), wires the existing protected owner entry and detached-stop-connector without changing the existing signed-death verification, staging cleanup, session revocation or independent census requirements.
- wrangler.gatea.s2.candidate.jsonc reuses the exact existing account/Worker/DO class/binding and defaults LIVE/HTTP admission to false, workers.dev and Preview URLs false. No secrets, routes, triggers, new Worker or namespace.
- tests/ai-020705-cloudflare-live-candidate.test.mjs covers signed owner grant, scoped GitHub termination, fail-closed disabled public gate and missing trusted capabilities.

## Future activation prerequisites / explicit approvals
1. Pin actual remote A1 deploy bytes, exact new main SHA and approved Preview candidate; check existing namespace, no unintended DO class migration, rollback and stop procedures.
2. Separate trusted OWNER Ed25519 private/public key (private off GitHub/log/chat), runner Ed25519 key, independent Cloudflare controller private signing key, key ID; securely install only after separate approval.
3. Read-only GitHub Actions token scoped to the exact repo, main-based run and its jobs; the Cloudflare environment must not access Production credentials.
4. Explicitly approve authenticated route for the existing Worker, environment flag activation, bounded one-use arm and stop/census transport. This PR creates no route or live trigger.
5. Approved detached executor must have actual runner transport stop, Staging-only budget zero/OFF, verified synthetic Auth revoke, scoped cleanup and second-source independent zero census. Existing injected callbacks DO NOT prove these authorities.
6. Staging real JWT/fixture and one real AI POST (synthetic one episode, no retry, 10 yen maximum) require their own approvals. main merge separately requires exact SHA Production approval.

## Security, billing and stop
Workers Free and no payment method were observed. This code-only step incurs no Cloudflare deployment or OpenAI cost. Future Worker/DO requests consume usage quota and are not guaranteed free. No plan upgrade/card registration.
STOP / NO-GO if signature/heartbeat/death verification is missing or stale, main/owner/project/run mismatch, remote bytes mismatch, missing real stop/revoke/census proof, incomplete cost cap or isolation ambiguity. Do not claim actual Gate A PASS from mocks, metadata or CI.
