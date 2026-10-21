# Community Phase 1: timebox and cost accounting preparation

Status: read-only planning only. NOT an executable hosted runner or staging grant.

Owner-approved alternate approach: a bounded-time isolated Staging execution
with independently operating trusted-main deletion watcher, deletion
postcheck, and provider charge reconciliation. Provider hard stops are NOT
assumed and cannot be emulated merely by adding booleans to a plan.

Timebox structural validation: max 120 minutes, watchdog every <= 5 minutes,
cleanup grace <= 15 minutes; fail closed if watcher is absent or untrusted,
and verify deletion of the exact run-owned Supabase branch after any result.
Production and shared Staging projects are explicitly prohibited.

The current main hosted workflow remains read-only. An independently reviewed
executor, protected environment, out-of-job watchdog, actual protected
Preview deployment and three-role account fixtures still require implementation
and fresh exact-SHA run authorization. Do NOT reopen Issue #188 or provision
resources just because the shape checker accepts a proposed plan.

Actual cost: do not present the quote as an invoice. The pure reporting module
reports final USD total ONLY when two finalized official provider statements
and independently verified branch deletion are present. If either statement
is pending or billed in another currency, total is pending; reconcile FX
against official invoices, never combine USD and JPY unconverted.

Observed Supabase branch quote USD 0.01344/hour. Two-hour compute estimate:
USD 0.02688, excluding storage, egress and Vercel charges. This is not a cap.
These files do not create a billable resource.
