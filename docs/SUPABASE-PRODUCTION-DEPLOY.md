# Supabase production migration deployment

NOVELIGHTの本番Supabase migrationは、次の2本のGitHub Actionsで管理する。

- `.github/workflows/supabase-production.yml`
  - 手動の `status` / `dry-run` / `repair-history` / `deploy` 用
  - 緊急時・再確認・限定的なhistory repair用の安全なフォールバックとして残す
- `.github/workflows/supabase-production-auto-deploy.yml`
  - `main` に新しいmigrationが入ったときの通常運用
  - 自動安全確認 → GitHub Environment承認1回 → 自動deploy → 自動検証

本番DB変更は完全無人化しない。人間が承認するポイントは残し、それ以外の反復操作を自動化する。

## GitHub Secrets

GitHubの `production` environment またはRepository Actions secretsに、次の2つを登録する。

- `SUPABASE_ACCESS_TOKEN`: Supabase accountのPersonal Access Token
- `PRODUCTION_DB_PASSWORD`: NOVELIGHT本番Supabase projectのDatabase password

Project ref `fiepaguycecrredwrcwx` はworkflow内で固定しており、secretではない。

## 一度だけ必要な承認ゲート設定

自動deployは、承認ゲート設定が完了するまで安全側に停止する。

1. GitHub `Settings` → `Environments` で `production-approval` environmentを作成する。
2. `Required reviewers` に本番DB変更を承認するユーザーを登録する。
3. 1人運営中は本人承認が必要なため、`Prevent self-review` は有効にしない。
4. 可能ならdeployment branchを `main` に限定する。
5. 上記を確認した後でのみ、Repository Actions variable `PRODUCTION_APPROVAL_GATE_READY` を `true` にする。

`PRODUCTION_APPROVAL_GATE_READY` が未設定または `true` 以外なら、自動workflowはstatus/dry-runまで実行して停止し、本番DBを変更しない。

## 通常の自動フロー

`main` へ `supabase/migrations/**` が入ると、自動workflowが起動する。

### 1. Safety plan

自動で以下を行う。

- merge前のmainとmerge後mainを比較し、今回追加されたmigration versionを抽出する
- `supabase migration list --linked` で本番remote historyを確認する
- 本番でpendingになっているmigrationが、今回mainへ入ったmigrationと完全一致することを確認する
- 想定外の古いpending migration、欠落、historyずれがあれば停止する
- `supabase db push --linked --dry-run` を実行する

ここまでは本番DBを変更しない。

### 2. Human approval

Safety planが成功し、`PRODUCTION_APPROVAL_GATE_READY=true` の場合だけ、`production-approval` environmentでworkflowが承認待ちになる。

ユーザーはGitHub Actionsの `Review deployments` から承認する。これが通常運用で唯一の手動操作になる。

承認されなければ本番DBは変更されない。

### 3. Approved deploy

承認後も、待機中に本番状態が変わっていないことを再確認する。

- migration statusを再取得
- pending migrationが承認時の対象と完全一致することを再確認
- dry-runを再実行
- `supabase db push --linked --yes` で適用
- migration historyを再確認し、pendingが残っていないことを確認
- `production_beta_observability.sql` をread-onlyで実行
- `production-beta-verification` commit statusを記録

承認待ちの間に別migrationが増えた場合はdeployしない。

## 手動workflow

`.github/workflows/supabase-production.yml` は削除しない。次の用途で残す。

### status

`supabase migration list --linked` だけを実行する。DB schemaは変更しない。
`production-approval` の承認は要求せず、状態確認をすぐ実行できる。

### dry-run

migration statusを表示した後、`supabase db push --linked --dry-run` を実行する。本番DBは変更しない。
`production-approval` の承認は要求せず、安全計画をすぐ確認できる。

### repair-history

Productionでhistorical core tablesが既に存在するのに、migration管理開始前のinitial baseline `20260815000000` だけがremote migration history上でpendingになっている場合に限って使う、一時整合作業用。

現在のworkflowでrepairできるversionは **`20260815000000` だけ** に固定する。任意versionを入力・選択する機能は持たせない。ほかのmigration historyに将来ずれが出た場合は、過去の確認を使い回さず、その時点のfresh evidenceに基づく別の修正・承認手順を作る。

confirmationが正確に `REPAIR` の場合だけ実行する。`20260815000000` がProductionで実際にpendingでなければ停止する。

history変更前にSupabase Management APIのread-only database queryで `profiles` / `novels` / `episodes` / `favorites` の4つのhistorical core tableが現在のProductionにすべて存在することを確認する。1つでも欠ける、read-only確認に失敗する、または結果が曖昧な場合はfail closedし、historyを変更しない。このbaseline migration自体は4tableが既存ならstrict no-opであるため、実DB状態を確認してからhistoryだけを整合する。

実行前に通常の自動deployと同じ `production-approval` Environmentで1回だけ人間の承認を要求する。承認後のhistory repair、status再確認、observability検証は、その1回の承認を受けた同じ操作として継続する。

### deploy

自動承認フローが利用できない場合のフォールバック。`workflow_dispatch` から `deploy` を選び、confirmationが正確に `DEPLOY` の場合だけ適用する。

通常の自動deployと同じ `production-approval` Environmentで1回だけ人間の承認を要求する。承認後のstatus確認、dry-run、適用、post-mutation確認、observability検証は、その1回の承認を受けた同じ操作として継続する。`PRODUCTION_APPROVAL_GATE_READY=true` でなければmutationはfail closedで停止する。

通常運用ではこの手動deployを使わず、承認ゲート付き自動workflowを使う。

## Safety rules

- 本番DB変更はPRのCI成功後、`main` に入ったmigrationだけを対象にする。
- 自動deployは完全無人化しない。GitHub Environmentの人間承認を必須にする。
- 手動workflowの `deploy` / `repair-history` も `production-approval` Environmentの人間承認を必須にし、`status` / `dry-run` にはmutation承認を要求しない。
- 承認前と承認後の両方でpending migrationを確認する。
- 今回のpushと本番pendingが完全一致しなければdeployしない。
- `PRODUCTION_APPROVAL_GATE_READY=true` はRequired reviewers設定後にのみ有効化する。
- 想定外のmigrationがpendingなら自動・手動ともdeployしない。
- `repair-history` は `20260815000000` 以外を受け付けない。
- initial baselineのhistory repairでは4つのcore tableをfresh read-only queryで直前確認し、その確認を省略しない。
- ほかのmigration history異常へ、過去の確認結果やこのbaseline repair経路を流用しない。
- migrationには可能な限りprecheck、postcheck、rollbackを用意し、CIで検証する。
- rollbackは自動実行しない。障害内容とデータ影響を確認してから明示的に実行する。
- secretsをrepository、workflow、ログ、SQL、issue、PR本文へ直接書かない。

## One-time migration history alignment

NOVELIGHTではCLI導入前にSQL Editorまたは手動構築で適用・作成したDB状態が存在する。すでに本番へ反映済みの状態に対応するmigrationがpendingとして表示された場合は、そのまま再適用しない。

今回の `20260815000000` は、Productionのhistorical core tablesがmigration管理開始前から存在していたことをfresh read-only checkで確認できた場合だけ、Supabase CLIの `migration repair --status applied` を使ってremote migration historyだけを合わせる。

`20260819190000` と `20260822194000` は過去にhistory alignment済みで、現在のrepair workflowの対象外とする。将来これらを含む別versionのhistory異常が発生した場合は、当時の証拠をcurrentとして再利用せず、DB実状態をfreshに確認したうえで専用の修正・承認経路を作る。
