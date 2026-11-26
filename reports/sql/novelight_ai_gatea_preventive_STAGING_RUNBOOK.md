# Gate A preventive Staging activation contract (NO-GO)

Candidate only. No migration is installed, no new credentials issued and no live
workflow is authorized by this document. Existing `05875d4` stays available for
unpaid verification; the previously removed Preview is not re-inspected.

## Blocking conditions

- An immutable old Preview may retain a raw provider key. A database claim can
  reject an application request, not an arbitrary external provider request.
  Require authoritative key provenance showing no usable provider credential
  in either legacy deployment (including restoration), or independently
  approved upstream revocation/restriction of the exact dedicated credential.
  Never revoke NLO Tunnel or a shared/unknown production credential.
- The current paid composition still passes `openAiApiKey` into Preview
  runtime. A trusted exclusive dispatch boundary must own the credential and
  enforce the exact claim/expiry before any provider send. Do not arm paid
  admission or relax the existing protected composition until this is proven.
- The Data API custom roles require signed short-lived tokens from an authorized
  issuer. Role selection in a decoded JWT is not authentication. Use two
  distinct Staging-only principals, a protected issuer scoped to their fixed
  IDs, never a shared signing secret in a runner, never a service key or PAT.
  A custom access token hook is a candidate only; verify existing hook
  configuration and preserve all ordinary user claims before changing it.
- Prove all enabled API schemas/routes deny unrelated reads/writes, arbitrary
  SQL/RPC, auth/vault access, cross-role calls and role escalation. NOLOGIN
  alone does not establish this. No grant changes to shared PUBLIC/net.
- Actual Auth deletion and retained-token denial across all relevant write
  paths, and late writes after expiry/STOP/cleanup, must be tested. A grace
  period, simulated PostgreSQL success, or signed acknowledgement is not proof.

## Rollback-only Staging SQL preparation

Use the existing tested proposal
`novelight_ai_gatea_preventive_v1_PROPOSAL.sql` as the sole function-body source.
Do NOT execute it unchanged on a hosted database. Its disposable-only guard
must stay intact. Produce a separately reviewed exact transaction script from
the pinned file, with the following mandatory boundaries:

1. Externally verify project ref `wmlzjgvxgoyrovdhbqbg` and connection identity;
   never infer project identity from current_database() alone. Verify the
   existing runtime singleton is OFF with four zero caps, no active trial or
   synthetic fixture in flight, and existing schema/role/constraint signatures.
   Record baseline ACLs, role memberships/LOGIN, function definitions,
   constraint, cron job IDs, and scoped tombstone counts without secrets.
2. One dedicated transaction: BEGIN; SET LOCAL lock_timeout = '3s';
   SET LOCAL statement_timeout = '15s'; no COMMIT or external calls. Within
   that transaction, provision only a missing NOLOGIN census role if needed,
   use the reviewed existing STOP role, and apply the proposal body excluding
   ONLY its disposable guard. Existing claim/model constraints and all
   existing data must be preserved. Do not schedule cron or delete real users
   in a rollback-only test.
3. Check effective ACLs, role memberships, no direct login, claim denied with
   no registered scope, STOP/census cross-role denial and no unrelated RPC
   authority. If role simulation cannot safely represent the actual API
   principal, report UNKNOWN. Separate HTTP clients cannot see uncommitted
   DDL, so this transaction cannot prove hosted Data API credential isolation.
4. ROLLBACK unconditionally; connection failure also aborts the transaction.
   Read back original definitions/ACLs, role memberships/LOGIN, constraints,
   runtime row, job metadata and tombstone counts. Any difference is NO-GO.
   Do not run through an interface that auto-commits or requires persistent DDL.
5. Real pg_cron jobs, JWT issuance and a bounded synthetic crash drill are a
   later explicitly approved activation. Use the two existing job-name
   candidates, no collision, independent STOP transaction and cleanup
   transaction; prove job execution independently. In rollback, disable only
   those exact new jobs, keep runtime OFF, restore reviewed definitions and
   ACLs only if doing so cannot re-enable paid execution, preserve both claim
   ledgers and existing SQLite. Never restore old Preview paid access.

## Existing Workflow wiring

The existing OWNER STOP workflow candidate now invokes only
`create020705PreventiveStopRpc` in the already existing
`gatea-independent-recovery` environment, with its existing OWNER/main/PR
checks. The proposed activation variable is absent/off by default. The
proposed STOP token, principal ID and publishable key are references only;
no settings or secrets are created. The independent census reader must use
its own separately controlled principal, never the STOP token. Existing
Cloudflare recovery preflight remains unchanged and does not certify this
candidate. Do not merge or dispatch any real workflow at this stage.

## Completion evidence

New CI must pass. Live credential isolation, provider bypass, signed token
verification, exact Staging transaction/readback, actual cron/crash cleanup
and independent final zero census are separate required evidence.
Gate A remains NO-GO; no paid AI, production, deployment or credential change.
