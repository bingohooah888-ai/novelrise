# NLO MASTER Auto Sync

NLO keeps the ChatGPT NOVELIGHT Project MASTER aligned with the canonical `docs/NOVELIGHT-MASTER.md` while the supervised NLO bridge is running.

- The watcher checks the canonical MASTER every 2 minutes by default.
- The decision to sync is based on the MASTER content SHA-256, so unrelated `main` commits do not rewrite the Project file.
- Automatic sync runs through a dedicated **headless** Chrome session. It must not open, foreground, or create a visible ChatGPT window/tab.
- The headless session reuses the protected NLO ChatGPT profile so an existing authenticated Project session can be used without UI.
- If that profile is already in use, Playwright is unavailable, or the background CDP endpoint cannot be established, the automatic sync is deferred instead of falling back to a visible browser.
- When the MASTER content changes and the background session is usable, NLO runs the existing safe Project sync flow: upload the new CURRENT MASTER, verify it is visible, then remove stale MASTER files.
- If validation, upload, or verification fails, stale files are not deleted.
- If ChatGPT login is required, the state becomes `login_required`; automatic retries remain headless. A deliberate manual `master_sync_project` may be used when interactive login is actually needed.
- Successful state is stored in `master-sync/AUTO-SYNC.json`, including the Project URL and last synced MASTER hash.
- Automatic Project mutations are serialized with `master-sync/PROJECT-SYNC.lock`.
- `uiLaunchAllowed` is always written as `false` by the automatic watcher.
- `NOVELIGHT_MASTER_AUTO_SYNC_INTERVAL_MS` can change the poll interval; values below 60 seconds are clamped to 60 seconds.
- `NOVELIGHT_MASTER_AUTO_SYNC_CDP_PORT` can override the dedicated background CDP port; the default is `9333`.

The watcher is loaded by `src/github-bridge-daemon.js`, so it starts and restarts with the existing NLO supervisor. It does not depend on Remote Desktop Commander / DC.

## NLO / DC status boundary

The MASTER Project sync mechanism must not be used as evidence that Remote Desktop Commander and NLO are the same service. NLO availability follows the canonical NLO First Policy: direct NLO MCP first, then GitHub Control Issue #797 `nlo_health`. A Remote Desktop Commander device being `offline` is never sufficient evidence that NLO is offline.
