# NLO consolidated operation boundary

The existing Issue #1837 is public. It is not a private file/terminal transport. Keep
OWNER verification, scoped one-use creation permits, and all existing production
and billing gates. No paid services or new infrastructure.

| Area | Reuse | Consolidated addition | Boundary |
| --- | --- | --- | --- |
| Files | existing worktree edit and text patch | runtime file fingerprint matching | no private file contents in public comments |
| Git | existing status/edit/commit/push and isolated creation | fixed HEAD/object probes in one batch | no arbitrary Git arguments |
| PowerShell/processes | existing direct NLO implementation | fixed version probes, minimal child environment, timeout | no arbitrary script or process termination |
| Browser | existing Playwright dependency | installed system-browser availability | authenticated browsing not delegated |
| Permission | existing separate local permit and OWNER approval | read-only batch with exact schema; creation permission unchanged | no remote permit issuance |
| Self-update | existing separate runtime rollout | startup module fingerprints and disk drift detection | no automatic launcher replacement |

Use operation `workspace_batch`, existing OWNER Issue request prefix and a valid
non-main branch, with `steps` containing up to eight fixed operations. Unknown
operations and extra fields fail before any step is run. No caller-controlled
path, executable, command text, URL, process ID, or browser profile is accepted.
The module directory hashes are a startup observation, not hardware-backed
attestation. Do not use this evidence alone to authorize a live update.

The sanitized environment applies only to the new fixed probes. It is not an
OS security sandbox and does not make arbitrary repository scripts safe. The
legacy process runner still inherits environment variables; do not expose it as
a general remote shell. Actual remote code/test execution with untrusted code
requires a separately authorized local isolation boundary that prevents access
to the owner token, files, browser sessions, and network mutations. No such
boundary has been demonstrated. Keep capability status testing.

Do not activate, change existing runtime paths, merge, or deploy merely because
this code exists. Complete current PR CI, review, the exact-HEAD OWNER integration
approval, and one safe consolidated local rollout before live use. Gate A stays
frozen and PR #2895 is untouched.
