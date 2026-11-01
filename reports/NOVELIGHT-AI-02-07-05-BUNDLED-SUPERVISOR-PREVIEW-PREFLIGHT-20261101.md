# AI 02-07-05 — consolidated protected runner / detached supervisor / Preview precreation bundle

Base main: `fc1a23f3386933db311ce9d87fb3625e4d1ba886` (PR #2735 integrated). This is **offline code + tests only**; paid trial, live watchdog, Staging writes, new Preview, JWT and AI enablement remain NO-GO.

## Implemented in ONE PR
1. `preview-precreation-readonly.mjs`: fixed exact-main/branch/Staging-ref preview metadata inspection. A READY old-SHA Preview cannot count as current-main proof. Branch-scoped environment KEY names are compared without decrypting or exposing values. No Vercel API or deployment action exists in this module.
2. `protected-runner-offline-drill.mjs`: invokes the existing six independent preflight proof contracts, preserving their fail-closed behavior; even six synthetic matches produce `authorizesExecution:false`. There is no service client, JWT, key, AI provider or live workflow activation.
3. `detached-supervisor-offline-drill.mjs`: uses four separately injected read-only observers (owner ledger, GitHub runner, Staging census, independent heartbeat) and reuses the existing watchdog handoff/admission. Distinguishes lack of heartbeat from a terminal record. All outcomes are advisory; no kill, cleanup, payment or mutation callback can be passed.
4. Synthetic offline negative tests for wrong project, old Preview SHA, missing environment metadata, incomplete proof gates, missing heartbeat, spoofed run SHA, sanitized upstream errors, no pay/write authority.
5. Updated Phase 2 gate document and technical report with the precise operator approval sequence.

## Live read-only facts rechecked
- Production deployment `dpl_69d9t9XG8uw8da4WRZnfiGhSKb3y` READY at new main SHA `fc1a23f3386933db311ce9d87fb3625e4d1ba886`.
- Vercel Preview `dpl_EQij5nLkYSiha2Yn4UyGYs9pszwu` READY at old SHA `c59b0038e06816ace42cdf2e50e24a2c02fb5927`; never use as current-main test proof.
- Read-only Vercel environment KEY metadata: 9 vars, each preview-scoped only to old staging branch `staging/ai-02-07-04-owner-ui-proof-20261101`. No current-branch staging secrets were provisioned or copied. No decrypted values were obtained.
- Staging Supabase project `wmlzjgvxgoyrovdhbqbg` was previously checked OFF/4 zero budgets/AI aggregates 0; migration and one-shot RLS/service role checks passed at that observation.

## Outstanding **critical real-world blockers**
- A protected independent controller and kill authority must be **actually deployed and verified from a separate execution environment**. Injected callbacks are NOT authenticated just because an offline test passes.
- A new current-main Staging Preview requires a **distinct one-shot Staging approval**. Any branch-specific environment keys and protected reviewers need separate authorized provisioning, without copying Production secrets or printing values.
- A live OWNER workflow connecting existing atomic claim, protected paid provider, synthetic JWT and cleanup needs a separately reviewed security-boundary PR and final evidence; current workflow remains OFFLINE PREFLIGHT ONLY.
- 1 model/1 POST/10 JPY/1 hour/no retries, provider capability and contract, independent zero-census and manual quality review remain unverified.

This PR does not modify live workflows or environments and requires a new exact-HEAD PR merge approval. That merge may trigger the existing automatic Vercel Production deployment but authorizes no other Production operation.
