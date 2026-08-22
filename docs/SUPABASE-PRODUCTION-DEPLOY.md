# Supabase production migration deployment

NOVELIGHTの本番Supabase migrationは、`.github/workflows/supabase-production.yml` で管理する。

`main` に `supabase/migrations/**` の変更が入った場合は、`status` と `dry-run` を自動実行する。これらは本番DBを変更しない安全確認であり、通常運用ではユーザーの手動起動を不要とする。

本番DBを実際に変更する `deploy` と、migration historyを書き換える `repair-history` は自動実行しない。これらは引き続き `workflow_dispatch` から明示的に起動し、確認文字列を要求する。

## GitHub Secrets

GitHubの `production` environment またはRepository Actions secretsに、次の2つを登録する。

- `SUPABASE_ACCESS_TOKEN`: Supabase accountのPersonal Access Token
- `PRODUCTION_DB_PASSWORD`: NOVELIGHT本番Supabase projectのDatabase password

Project ref `fiepaguycecrredwrcwx` はworkflow内で固定しており、secretではない。

## Workflow modes

### automatic status + dry-run

`main` へSupabase migration、またはproduction migration workflow自体の変更が入ると自動起動する。

最初に `supabase migration list --linked` でlocal/remote migration historyを表示し、続けて `supabase db push --linked --dry-run` を実行する。本番DBは変更しない。

### status

手動確認が必要な場合に `workflow_dispatch` から利用できる。本番projectへlinkし、`supabase migration list --linked` だけを実行する。DB schemaは変更しない。

### dry-run

手動再確認が必要な場合に `workflow_dispatch` から利用できる。migration statusを表示した後、`supabase db push --linked --dry-run` を実行する。どのmigrationが適用対象になるかを確認するだけで、本番DBは変更しない。

### repair-history

SQL Editorから本番適用済みであることを確認した既知のmigrationだけを、remote migration historyへ `applied` として記録する一時的な整合作業用モード。

現時点では、適用確認済みの次の2versionだけを固定でrepairする。

- `20260819190000`
- `20260822194000`

confirmationが正確に `REPAIR` の場合だけ実行する。`supabase migration repair --status applied` はmigration tracking tableだけを更新し、migration SQLそのものは再実行しない。最後に `supabase migration list --linked` を再実行してlocal/remoteが一致したことを確認する。

### deploy

`workflow_dispatch` からのみ実行する。statusとdry-runを先に実行し、confirmationが正確に `DEPLOY` の場合だけ `supabase db push --linked --yes` を実行する。最後にmigration statusを再表示する。

## Safety rules

- 本番DB変更は必ずPRのCI成功後に行う。
- `main` にmigrationが入ったら、自動 `status` + `dry-run` の結果を確認する。
- 自動チェックは本番DBを変更しない。`deploy` は絶対に自動化しない。
- `deploy` 前に、想定したmigrationだけがpendingであることを確認する。
- 想定外の古いmigrationがpendingに出た場合は `deploy` しない。
- `repair-history` は、対象versionが本番へ適用済みであることをDB実状態から確認した場合だけ実行する。
- migrationには可能な限りprecheck、postcheck、rollbackを用意する。
- rollbackは自動実行しない。障害内容とデータ影響を確認してから明示的に実行する。
- secretsをrepository、workflow、ログ、SQL、issue、PR本文へ直接書かない。

## One-time migration history alignment

NOVELIGHTではCLI導入前にSQL Editorから適用したmigrationが存在する。初回の `status` / `dry-run` で、すでに本番へ適用済みのmigrationがpendingとして表示された場合は、そのまま再適用しない。

DBの実状態とGitHub上のmigration内容が一致していることを確認したうえで、Supabase CLIの `migration repair --status applied` を使ってremote migration historyだけを合わせる。history repairはschemaそのものを変更しないが、誤ったversionをapplied扱いにすると将来のdeployを壊すため、対象versionを確認してから行う。

2026-08-22時点で、SQL Editorのmigration backup stateから `20260819190000` と `20260822194000` の本番適用を確認済み。初回history alignmentではworkflowの `repair-history` モードを使い、この2versionだけをremote historyへ反映する。
