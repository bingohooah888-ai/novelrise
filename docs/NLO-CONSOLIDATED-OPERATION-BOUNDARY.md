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

## Local-only operation candidates

The existing apply_file operation now uses a physical path guard and pinned raw
Git blob bytes before atomic replacement. Dirty files, links, reserved paths,
credential-like paths, and unexpected target roots fail closed. A checkout
whose CRLF bytes differ from the pinned Git blob is deliberately rejected.
The same-OS-user concurrent process threat is not solved by these checks.
The prior repository-script preflight operation is disabled on this Bridge
until actual OS isolation is proven; existing GitHub CI remains the fallback.

The local-sandbox-package module builds a hash-pinned, locally approved .wsb
package. It has no host mappings, networking, clipboard, GPU, audio, video or
printer redirection, and requests Protected Client. It never launches Windows
Sandbox, changes Windows features, or sends scripts/results to the public Issue.
Windows Sandbox availability and effective isolation are unproven on the real
machine. Microsoft's configuration and CLI documentation describe the options;
the CLI has no guest process stdout/stderr retrieval. No guest/browser session
or host shell is remotely authorized by this candidate.

The runtime-update-plan module validates exact base, target and allowed NLO
file delta in a separate, detached, clean checkout, and includes a local-only
transaction with a mandatory independent maintenance verifier. It does not fetch
or restart, and never updates the configured development checkout. Automatic
rollback is attempted only from a clean known candidate; ambiguous state stops.
There is no production caller for the maintenance verifier, and no automatic
supervisor cutover is wired. The existing supervisor restart code 75 is a
potential integration point, not a new authorization. No live rollout yet.

Focused synthetic tests exercise file replacement, dirty-file/link denial,
offline package preparation and a real temporary Git checkout update. These
are not Windows guest or live-runtime proof. Do not mark capabilities enabled.
