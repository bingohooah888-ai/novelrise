# Community Phase 1 — Closed Issue Preview protection (2026-10-19)

The OWNER control Issue #188 was verified **closed** during the read-only preflight. The candidate Preview workflow previously did not check the control issue's state. A new OWNER comment to a closed issue must not result in a Preview execution.

## Fail-closed proof points

- Trigger guard: only an issue_comment event whose issue state is `open` may start admission.
- Trusted runner admission: fetch the issue by GitHub REST immediately, independently verify its ID, URL, title, OWNER and current `open` state against the event snapshot, before any ledger CLAIM.
- Recheck the live issue state before CLAIM and again immediately before cost-bearing Preview creation. A closed issue halts without provisioning.
- The existing exact main SHA, Draft PR #2222 head, one-use ledger, protected `staging` environment, and checked file blobs remain mandatory. No bypass or new valid grant is introduced.
- The existing control issue stays **closed**. This patch does not reopen Issue #188, change candidate SHA pins, grant Staging approval, or perform any deployment or DB operation.

**This is defense in depth, not a green light to start Preview.** Existing provider spending-limit verification, independent Environment protection and isolated real-user acceptance evidence are still required. No automatic reopening or cost allocation is allowed.
