# Main branch protection

This repository protects the `main` branch with a GitHub ruleset.

Current safeguards:

- Pull requests are required before changes reach `main`.
- The GitHub Actions status check `check` must pass.
- Pull request branches must be up to date with `main` before merging.
- Force pushes are blocked.
- Deletion of `main` is restricted.

This document was added as a harmless verification change after enabling the ruleset.
