# NLO MASTER Auto Sync

NLO keeps the ChatGPT NOVELIGHT Project MASTER aligned with the canonical `docs/NOVELIGHT-MASTER.md` while the supervised NLO bridge is running.

- The watcher checks the canonical MASTER every 2 minutes by default.
- The decision to sync is based on the MASTER content SHA-256, so unrelated `main` commits do not rewrite the Project file.
- When the MASTER content changes, NLO runs the existing safe Project sync flow: upload the new CURRENT MASTER, verify it is visible, then remove stale MASTER files.
- If validation, upload, or verification fails, stale files are not deleted.
- If the NLO Chrome profile needs ChatGPT login, the state becomes `login_required` and a later poll retries.
- Successful state is stored in `master-sync/AUTO-SYNC.json`, including the Project URL and last synced MASTER hash.
- Automatic Project mutations are serialized with `master-sync/PROJECT-SYNC.lock`.
- `NOVELIGHT_MASTER_AUTO_SYNC_INTERVAL_MS` can change the poll interval; values below 60 seconds are clamped to 60 seconds.

The watcher is loaded by `src/github-bridge-daemon.js`, so it starts and restarts with the existing NLO supervisor. It does not depend on Remote Desktop Commander / DC.
