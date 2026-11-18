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

## 2026-11-18 OWNER-authenticated ARM guard and opt-in entrypoint

- `gatea-controller-trusted-bootstrap-candidate.mjs` now requires an
  independently sourced OWNER approval and attestation for **every immutable
  run-scope field** (repository, Staging project, main SHA, Preview ID, actor,
  novel, episode, run ID and approval comment) before issuing any signed ARM.
  Candidate SHA, branch and cap must also match when present. An earlier
  ARM-issuer path had no such pre-signature OWNER check; the new code denies
  forged scope, missing independent stop evidence and failed attestations
  before touching the atomic DO ledger or signer.
- `gatea-controller-execution-entry-candidate.mjs` is the proposed
  executable composition factory, with a default Worker that **always 404s**.
  The candidate Wrangler main points to that inert default. It requires both
  `GATEA_CONTROLLER_LIVE_ENABLED` and
  `GATEA_CONTROLLER_RECOVERY_ADMISSION_ENABLED` (both default false), a
  private existing-DO binding and a valid independently provisioned HMAC
  Secret before the opt-in factory can process a recovery.
- New negative tests check that default/incomplete admission, unauthenticated
  OWNER approval, mismatched actor/novel scope and unverified independent
  capabilities cannot issue an ARM or invoke privileged ports.

**IMPORTANT: no authenticated live bootstrap exists in the repo yet.**
The execution factory accepts externally supplied trusted functions; these
are still abstract contracts, not a verified Cloudflare identity or concrete
least-privilege Staging ports. The current GitHub OWNER ledger reader and
synthetic-only cleanup code should be reused in a separately approved
credentials-equipped runtime. Never use a boolean/mock response as live
authority. The actual S2 STOP, JWT revocation, Vercel Preview disable and
independent zero-census abilities remain unproven. Preserve Gate A NO-GO.

**Readiness prerequisites, not completed by this PR:** obtain a verifiable
snapshot and pinned full version of the existing 9948be49 deployment; prove
A1 rollback without SQL/DO state loss; separately approve and provision
GitHub issues:read/actions:read, exact Staging-only disable/stop and synthetic
Auth deletion/revocation privileges, a *separate* census-read identity,
independently pinned Ed25519 keys and HMAC Secret, and a strict Free-tier
quota/kill budget. Cloudflare changes, Staging mutation and any paid AI call
require future scoped approval after the live blockers are resolved.


## 2026-11-18 continuation: code-only signed identity and census observability

Added dormant `gatea-controller-independent-observers-candidate.mjs` and
`create020705SignedObserverBoundControllerEntryCandidate`. These reuse the
existing GitHub OWNER source, Controller factory, SQLite DO claim, signed-death
recovery connector, and synthetic-only STOP/CLEANUP. No duplicate database,
namespace, removal flow, public route, deployment or secret was added.

The proposed Controller can now require **two distinct private Service
Bindings, two distinct Ed25519 pinned public keys and key IDs**, with fresh
32-byte random challenges and exact signed run/census scopes. Untrusted,
stale, modified or unsigned responses fail closed. The signed capability
observation additionally requires:
- exact account/Worker/DO namespace and full (not short) Watchdog version;
- separately verified provider-dispatch fence and zero in-flight provider
  requests, acknowledging that cancellation after provider dispatch is
  **NOT GUARANTEED**;
- a separately verified STOP path that survives Cloudflare Free-tier quota
  exhaustion; a second Worker on the *same* Free-tier account is insufficient;
- an access-deny fence for outstanding Supabase JWTs (sign-out and user deletion
  do **not** immediately revoke existing access JWTs);
- preservation of existing DO namespace/SQLite rows and rollback provenance;
- separately credentialed census with scoped DB/Auth counts and retained
  claims, not an assertion of fabricated zeros.

The Controller default **remains a permanent 404**; the opt-in composition
factory is not connected to the deployed Wrangler default. A signature from
an independently keyed observer proves message authenticity, **not** that
the signer actually executed STOP/census. Live proof requires auditing the
observer's actual GET-only database/Auth reads, independent credential and
network boundaries, and an approved synthetic failure drill. An untrusted
factory callback returning `true` is never a live audit.

### Required future connection roles and exact permissions (not provisioned)
1. Cloudflare read-only access to inventory version IDs, original deploy
   artifacts, DO binding/SQLite origin and an executable rollback path;
   separate deploy privilege only after a new approval.
2. GitHub Issue #294 and Actions run GET-only access; no write permission
   for the Controller OWNER source.
3. Controller-only identity signer/private service, isolated from the
   paid Runner. Only the Controller receives the attestor Service Binding.
4. Staging-only stop/operator role for AI runtime OFF, exact Preview ID
   suspension, transport kill, and synthetic-user-only cleanup. Do not grant
   Production or unrestricted general-user deletion.
5. Independently operated Staging census **read-only** principal for Auth
   users/identities/sessions and exact scoped app tables. Do not reuse stop
   or deletion credentials. Verify retained approval/claim tombstones.
6. Provider cancellation, quota-independent admission fence, expiration of
   outstanding access JWTs, and STOP authority must be demonstrated rather
   than deduced from API acknowledgments.

### Activation and rollback contract (still NO-GO)
**Before any future deploy:** independently capture and compare the entire
immutable Watchdog source/artifact digest, full Cloudflare version IDs,
exact existing SQLite DO namespace/instance row inventory, signed deployment
provenance, and a reversible plan retaining prior Worker/DO classes,
migrations, rows, alarm state, and consumed claim tombstones. Review any
binding migration to the legacy SQLite class; never recreate the namespace.
Keep the candidate flags OFF, protect staging/production boundaries, and
do not enable paid POST. Test rollback with a non-mutating dry-plan before
approving a separately bounded synthetic STOP drill.

**Cost:** code-only changes incur no new Cloudflare, Supabase, Vercel or
provider requests. Future Cloudflare Free has finite daily requests, CPU and
DO quotas; exceeding a limit can prevent Controller execution, so on-quota
STOP alone cannot be credited. Any Worker/service provisioning or paid-plan
upgrade requires separate OWNER approval and an explicit ceiling. No
external quota-independent STOP or in-flight cancellation proof exists.

**Gate A: NO-GO.** The source now includes a stronger runtime connection
contract but no provisioned identity/census Service Bindings, real Staging
stop/revocation roles, verified off-quota admission fence, deployed version
proof, rollback drill, or independently observed zero-residue census.

### Further fail-closed safeguards
The GitHub OWNER proof is bound to the exact recovery-vs-ARM purpose.
Expired approvals may be inspected for recovery/cleanup but can never
issue a new ARM. This adds no ability to spend or call the provider.

The historical proposed migration
`20261101060000_novelight_ai_020705_one_shot_claim.sql`
pins model `gpt-5.6-luna`, whereas the current OWNER ledger reader
expects `gpt-6.1-sol`. This source mismatch is an additional NO-GO
until the separately approved actual Staging schema, provider/model support,
approval and migration plan are reconciled. No SQL was edited or applied.
 

## 2026-11-18: Cloudflare full-version pinning correction (NO-GO)

GitHub-only audit found that signed capabilities used to accept an unhyphenated
32-64 character hexadecimal `watchdogFullVersionId`. The official Cloudflare
Workers Version API returns UUID IDs, including dashes; this type mismatch
would deny a legitimate full ID and was insufficient to bind the observation
to the **actual pinned deployment**.

The dormant observer now demands:
- `GATEA_WATCHDOG_PINNED_VERSION_ID`: a **complete** Cloudflare UUID with
  the observed prefix `9948be49`, independently obtained from the active
  deployment rather than inferred from GitHub or a signed self-report;
- `GATEA_WATCHDOG_PINNED_ARTIFACT_SHA256`: a 64-hex checksum of the
  authenticated downloaded immutable deployed artifact (canonicalization
  and modules must be fixed by the reviewer); and
- a fresh independent Ed25519 signed capability response that matches both
  pinned values byte-for-byte and declares reviewed source parity.

These are hypothetical future **nonsecret** binding values and are **not
configured** by this PR. A claimed source parity flag or signed digest
cannot replace actual Cloudflare API inspection of active deployment,
version content/modules, DO exports and existing SQLite binding.
The Controller's deployed default remains 404-only.

### Exact read-only evidence acquisition and rollback checklist

1. Under *separate read-only* Cloudflare access, inspect account
   `6831b18fe814232fa2dd4c470b95aa15`, Worker
   `novelight-ai-gatea-watchdog` and the **active deployment**, including
   100% traffic allocation. Record full UUID, deployment ID, timestamps
   and any multi-version split. Confirm it is the version with prefix
   `9948be49` and not merely the latest uploaded version.
2. Read that exact version's immutable modules and binding/exports metadata
   from the Cloudflare Workers Version API. Canonicalize and hash fetched
   source artifacts in an isolated reviewer process; compare directly with
   the original A1 sources and deployed Wrangler/bundler output, NOT GitHub
   file hashes alone. Earlier repository report
   `docs/reports/AI-020705-S2-CLOUDFLARE-A1-LIVE-CANDIDATE-20261114.md`
   has only the local A1 source digests and explicitly says Cloudflare bytes
   were NOT retrieved.
3. Independently establish `GATEA_WATCHDOG`'s live class name,
   backing namespace `015ef5be967f4fbfbad31ab24a22bf26`, SQLite
   backend and original instance name `ai-020705-<runId>`. Do not rename,
   delete, transfer or recreate a DO class/namespace. Avoid copying
   synthetic fixtures to a new namespace and calling it a rollback.
4. Before any future version deployment, preserve the exact original
   rollback target, version UUID, read-only row/tombstone/alarm inventory
   and binding graph. Cloudflare rollback can be blocked by a DO class
   lifecycle change; a rollback also does not revert persistent SQLite
   state or connected resource changes. Verify schema compatibility for
   both forward and prior versions, and require separately approved
   non-mutating rollback plan validation.
5. The proposed Controller default remains inert and its two signed
   observer Service Bindings, read-only credentials, HMAC key, Ed25519
   key lifecycle, independent off-Cloudflare quota STOP and Staging-only
   authority remain unprovisioned. No real STOP or census is proved.

**NO-GO** on missing full version, unverifiable artifact bytes, binding
or SQLite mismatch, unsafe rollback, unsatisfied quotas/fences, or failed
real Staging Auth/STOP/census. No deployment or secret changes in this
code-only audit.

## 2026-11-18 read-only pre-deployment audit: verified blockers and approval sequence

**Scope:** GitHub Draft PR #2895 at
\`f1e8d430981256025a68159388ad88669c7513b1\`; Cloudflare/Supabase/
Vercel live credentials, Secrets, Bindings, deployments, Staging mutations
and paid AI calls were **not** used. This is evidence classification,
NOT Gate A approval or an executable release procedure.

### 1. What was directly observed

- PR #2895 was open/Draft at the pinned HEAD; prior automatically run CI
  #44315597545 and CodeQL #44315597573 both concluded success.
- GitHub Issue #294, titled \`[Staging Control] Supabase migration sync\`,
  was open and returned exactly **198** comments via the read-only
  GitHub connector. In those 198 bodies, the exact
  \`NOVELIGHT_STAGING_AI_020705_PAID_APPROVE \`,
  \`NOVELIGHT_STAGING_AI_020705_PAID_CLAIMED \`, and
  \`NOVELIGHT_STAGING_AI_020705_PAID_CONSUMED \` prefixes each occurred
  **zero times**. This is a dated observation, not an immutable statement.
  The existing GitHub OWNER port requires a valid approved/CLAIMED ledger
  and must remain NO-GO. Do not forge an approval or move to a new ledger.
- The repository's proposed SQL migration
  \`supabase/migrations/20261101060000_novelight_ai_020705_one_shot_claim.sql\`
  accepts only \`gpt-5.6-luna\`, but the OWNER ledger, candidate reader
  and new preflight plan require \`gpt-6.1-sol\`. The **applied** Staging
  schema/model eligibility were not queried and remain UNKNOWN; do not
  modify or apply SQL to reconcile this without a separate approval.
- \`api/_lib/ai/providers.js\` sends ordinary \`POST /v1/responses\`
  using \`AbortSignal.timeout\`, without \`background:true\`.
  The official OpenAI cancellation endpoint requires a response created
  in background mode. Aborting the local fetch does not certify a
  completed/cancelled provider-side request or zero spend:
  https://developers.openai.com/api/reference/resources/responses/methods/cancel
  Preserve no retry and pessimistic one-shot reservation.
- Prior repo report
  \`docs/reports/AI-020705-S2-CLOUDFLARE-A1-LIVE-CANDIDATE-20261114.md\`
  pins only **local** A1 source SHA-256 values and explicitly states
  that no remote deployed JS bytes were fetched or compared.
- Browser tabs contained no authenticated Cloudflare dashboard tab;
  available saved browser profile sign-in metadata showed GitHub/Google,
  not Cloudflare. No installed Cloudflare management connector was
  available. No complete live Watchdog Version UUID, active Deployment
  response, source content, actual binding map, quota telemetry, DO
  SQLite row inventory or executable rollback proof was obtained.
  The observed \`9948be49\` is only an **unverified short prefix** here.

### 2. Strictly read-only Cloudflare evidence acquisition (future approval)

Account in the code-only candidate:
\`6831b18fe814232fa2dd4c470b95aa15\`;
Worker: \`novelight-ai-gatea-watchdog\`.
Grant the narrowest **Workers Content Read-Only** permission to this
one Worker/account where supported, not Workers Write/Admin, and do
not transmit the token or source files containing secrets via chat.
A metadata-only role may not expose the deployed script content;
grant no write access merely to work around a failed GET.

Use authenticated **GET** endpoints only, checking response origin,
pagination and access scopes:

1. \`/accounts/{account_id}/workers/scripts/{script_name}/deployments\`
   to identify the **active** deployment, not merely the latest upload;
   then \`.../deployments/{deployment_id}\` to record deployment UUID,
   all versions, weights totaling 100%, and provenance.
   https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/get/
2. \`/accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}\`
   for the exact full UUID, source hash/metadata and bindings.
   https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/
3. The script \`.../content/v2\` GET may show the current script content;
   do **not** assume it reproduces arbitrary historical version bytes.
   Compare the active version's verified content/hash and bundled modules
   to reproducible A1 output with explicit canonicalization. If the
   immutable bytes cannot be fetched for the active UUID, mark parity
   UNKNOWN instead of hashing a GitHub source file.
   https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/
4. \`/accounts/{account_id}/workers/durable_objects/namespaces\`
   and \`.../namespaces/{id}/objects\`: inspect namespace ID,
   class, backing storage type, object identities and
   \`hasStoredData\` metadata. These are **not** proof of SQLite
   table rows or alarms. In particular, namespace
   \`015ef5be967f4fbfbad31ab24a22bf26\`, legacy class
   \`GateAWatchdogDurableObject\`, and any run-scoped
   \`ai-020705-<runId>\` instance must be verified as live.
   https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/

SQLite Data Studio can execute SQL and also **write** to a DO. Any
targeted SELECT-only row/alarm/tombstone snapshot requires separate
approval and credential/interface controls; it is not covered merely
by this read-only metadata inventory. No \`UPDATE\`, \`DELETE\`,
\`PRAGMA\` mutation, \`wrangler deploy\`, rollback or alarm operation:
https://developers.cloudflare.com/durable-objects/observability/data-studio/

### 3. Data-preserving rollback acceptance criteria

Before any later deployment, capture the active deployment UUID, **full
version UUID**, all modules and bundle hash, old/new DO class exports,
\`migrations\` versus \`exports\`, Service Bindings, and a read-only
record of \`gatea_watchdog_local\`, \`gatea_live_once\`,
\`gatea_atomic_claims_v1\` where they exist, and the DO alarm.
Respect that some tables may not yet exist: an absent candidate table
is not a reason to initialize or alter storage during audit. Preserve
paid claim tombstones across every rollback. Never create a substitute
DO namespace or transfer/rename/delete the existing class.

Rolling back a Worker code version does **not** roll back Durable
Object data. A class lifecycle change or changed connected resources
can block version rollback; changed SQLite schema can break the old
version even if it deploys. Require a demonstrably valid prior-version
target and compatible schema/metadata, plus a separate OWNER-approved
non-mutating dry plan before any actual rollout:
https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/

### 4. The currently missing independent authority

- Cloudflare Service Bindings, HMAC private claim, Ed25519 identity and
  signed census **are code-only candidates**; no independent runtime,
  actual signer, isolated source, or role was provisioned here.
- The STOP role must bind only the Staging project
  \`wmlzjgvxgoyrovdhbqbg\`, the exactly approved Vercel Preview and
  the verified synthetic actor. Disallow Production credentials and
  unrestricted user cleanup. Actual account/session revocation must
  also deny already-issued JWTs on sensitive requests; deleting a
  Supabase user alone does not invalidate the outstanding JWT.
  https://supabase.com/docs/guides/auth/managing-user-data
- The census signer must use a distinct read-only identity and query
  the verified Staging project, auth identities/sessions and scoped
  application rows; zero counts must not be self-asserted by STOP.
- Workers Free documents 100,000 requests/day (account-level).
  Its request quota exhaustion, CPU limits or DO SQLite storage
  exhaustion may prevent the same-account Worker/DO STOP from running.
  No same-account Controller or alarm is off-quota. Require a
  separate failure-domain admission fence that blocks **new** paid
  POSTs even if Cloudflare cannot run, and explicitly bound/persist
  any uncertain in-flight call; no retries:
  https://developers.cloudflare.com/workers/platform/limits/
- The existing OpenAI provider uses an ordinary non-background POST.
  **Already submitted processing must be treated as non-cancellable**
  without independently proven provider-side cancellation and response
  identity. Prevent a new POST first; do not claim that killing Runner,
  Preview or fetch cancels the transmitted attempt.

### 5. Incremental permissions/costs and hard STOP conditions

**Approval A (recommended next):** only read-only Cloudflare Work
session or individually scoped Content Read-Only API token to verify
the active deployment/full UUID, artifact provenance, namespace and
binding metadata. Additional paid-service commitment **JPY 0**,
no new card, upgrade, deployment, Worker request, auth mutation or AI
POST. API evidence must be redacted to non-secret IDs/hash metadata.
No permission to execute SQL in Data Studio in this scope.

**Approval B (later, only if A matches):** a separate, explicit,
SELECT-only DO SQLite/alarm snapshot via a controlled interface with
verified non-mutating permissions, plus an executable, independently
reviewed *rollback plan*, not rollback itself. Any usage of the DO
Data Studio counts against Cloudflare resource activity and requires
an agreed request/row budget; do not assume free or zero side effects.

**Approval C (later):** individually approved isolated Controller
deployment and separated Staging stop/delete/census credentials with
cost ceiling, fail-closed off-quota fence and narrowly bounded
synthetic no-paid-POST failure drill. Paid AI model/POST and Production
would require still later, separate approvals.

**Immediate NO-GO** if active version is not byte-parity proven; old
DO namespace/class/SQLite tombstones cannot be preserved; rollback
compatibility is unknown; OWNER CLAIMED is absent; model names
differ; issuer identity, stop, JWT deny, separate census or off-quota
admission is not real and independently verified. Leave default
Controller 404-only, all live flags OFF, and no automatic paid retry.
