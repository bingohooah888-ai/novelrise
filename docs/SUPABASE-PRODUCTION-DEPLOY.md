# Supabase production migration deployment

NOVELIGHTの本番Supabase migrationは、人間承認をチャットの「本番承認」1回へ統一し、その後のGitHub台帳記録・対象migration確定・本番適用を自動化する。

通常経路は以下の3要素で構成する。

- `.github/workflows/high-risk-pr-approval.yml`
  - migrationを含む高リスクPRの「本番承認」を、PR番号・最終head SHA・one-time challengeへ固定する
  - 承認済みheadだけをCI再検証後にmainへ統合する
- `.github/workflows/supabase-production-auto-deploy.yml`
  - mainへ統合された後、Productionのpending migrationをfreshに取得する
  - pending migrationを元の承認済みPRへ逆引きし、元PRのmigration集合と完全一致することを確認する
  - current main、Production Readiness、backup鮮度、Staging parity、dry-runを再確認し、同じ本番承認の範囲内でProduction migrationを適用する
  - Approval LedgerのCLAIMED / EXECUTED / FAILEDはGitHub Actionsが自動記録する
- `.github/workflows/supabase-production.yml`
  - 通常経路が利用できない場合のmanual fallback
  - `status` / `dry-run` / `repair-history` / `deploy` を提供し、manual mutationだけは `production-approval` Environment承認を維持する

`.github/workflows/production-migration-approved-dispatch.yml` と Issue #737 の手動 `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE` 経路は互換・緊急時の旧経路として残してよいが、通常運用では使用しない。ユーザーへ長い承認JSONのコピー・貼り付けを求めない。

本番DB変更は完全無人化しない。人間の承認点は、migrationを含む高リスクPRに対してユーザーがチャットで行う「本番承認」1回だけとする。その承認後に行うSHA確認、pending照合、Staging parity、backup確認、dry-run、claim、postcheckは安全のための機械検証であり、追加の人間承認ではない。

## GitHub Secrets

GitHubの `production` environment またはRepository Actions secretsに、次の2つを登録する。

- `SUPABASE_ACCESS_TOKEN`: Supabase accountのPersonal Access Token
- `PRODUCTION_DB_PASSWORD`: NOVELIGHT本番Supabase projectのDatabase password

Project ref `fiepaguycecrredwrcwx` はworkflow内で固定しており、secretではない。

## Manual fallback用の承認ゲート設定

`.github/workflows/supabase-production.yml` のmanual mutation fallbackは `production-approval` Environmentを使う。

1. GitHub `Settings` → `Environments` で `production-approval` environmentを作成する。
2. `Required reviewers` に本番DB変更を承認するユーザーを登録する。
3. 1人運営中は本人承認が必要なため、`Prevent self-review` は有効にしない。
4. 可能ならdeployment branchを `main` に限定する。
5. 上記を確認した後でのみ、Repository Actions variable `PRODUCTION_APPROVAL_GATE_READY` を `true` にする。

`PRODUCTION_APPROVAL_GATE_READY` はmanual mutation fallbackだけのsafety switchであり、owner-authored chat approvalを再度Environmentで承認させるためには使わない。

## 通常フロー

### 1. PR段階の本番承認

migrationを含むPRは高リスクPRとして扱う。

ユーザーがチャットで「本番承認」を行った後、自動化はその承認をexact PR headへ固定した `NOVELIGHT_HIGH_RISK_APPROVE` 証跡へ変換する。証跡は少なくとも以下へ固定する。

- PR番号
- 最終head SHA
- one-time challenge
- operation `merge-high-risk-pr`

この時点の「本番承認」が、同じPRで追加されたProduction migrationまでを含む唯一の人間承認である。

承認済みPRはCI、RLS、E2E、CodeQLその他の必要gateを再確認してからmainへ統合する。

### 2. Production pendingのfresh取得と承認済みPRへの逆引き

承認済み高リスクPRの統合後、`.github/workflows/supabase-production-auto-deploy.yml` が通常経路として起動する。

自動化はProductionへmutationする前に、

- exact current mainを取得
- Production remote migration historyを取得
- pending migration集合をcanonicalに確定
- pending各migrationのlocal SQLを確認
- そのmigrationをmainへ追加したmerge commitを特定
- merge commitから元PRを一意に特定
- pending migrationがすべて同一の元PRに属することを確認
- 元PRに含まれるmigration集合とProduction pending集合が完全一致することを確認
- 元PRの最終headにexact owner-authored `NOVELIGHT_HIGH_RISK_APPROVE` が存在することを確認
- 元PRのmerge後に `supabase/migrations/**` が変更されていないことを確認

する。

pendingが存在しない場合はmutation不要として成功終了する。

pendingが複数PRにまたがる、元PRを一意に証明できない、元PRのmigration集合とpendingが一致しない、承認証跡がない、migrationが後から変更されている等の場合はfail closedする。承認範囲を推測で広げない。

### 3. Production mutation直前の安全再確認

元PRの「本番承認」を再利用できることが証明された場合も、mutation直前に以下をfreshに確認する。

- current mainが変わっていない
- `production-readiness-smoke` がcurrent mainでSUCCESS
- Production backupが許容鮮度内
- Production pending migrationが承認対象と完全一致
- `supabase db push --linked --dry-run --include-all` がPASS
- Staging migration historyがcurrent repositoryと完全一致
- 同じ承認スコープが過去にmachine claim済みでない

ここで作成する `NOVELIGHT_PRODUCTION_SINGLE_APPROVAL_MIGRATION_CLAIMED` はGitHub Actionsによる機械監査証跡であり、人間の追加承認ではない。

claim後にもcurrent main、pending完全一致、dry-runを再確認する。

### 4. Production migration適用とpostcheck

すべての再確認がPASSした場合だけ、

`supabase db push --linked --yes --include-all`

を実行する。

適用後は、

- Production migration history
- pending migrationが0件であること
- production beta observability
- `production-beta-verification` status

を確認する。

成功時はIssue #737へ `NOVELIGHT_PRODUCTION_SINGLE_APPROVAL_MIGRATION_EXECUTED`、失敗時は `NOVELIGHT_PRODUCTION_SINGLE_APPROVAL_MIGRATION_FAILED` をGitHub Actionsが記録する。

記録には、少なくとも元PR、承認head、承認challenge、current main、migration集合、run ID、mutation結果、postcheck結果、failure phaseを含める。

`db push --yes` が成功した後にpostcheckだけが失敗した場合、migration mutation自体を自動再実行してはならない。fresh migration historyを確認してmutationをSATISFIEDとして扱い、postcheckをread-onlyで調査する。

### 5. 二重承認禁止

通常経路では、PR merge後にユーザーへ次を要求しない。

- `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE ...` の手動コピー・貼り付け
- 二回目の「本番承認」
- 同じ承認スコープに対する `production-approval` Environment review
- 単なる続行確認

元PRで承認されたProduction内容が実質的に変わった場合だけ、新しい「本番承認」を求める。

## 手動workflow

`.github/workflows/supabase-production.yml` は削除しない。

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

manual `repair-history` は `production-approval` Environmentで1回だけ人間承認を要求する。承認後のhistory repair、status再確認、observability検証は、その1回の承認を受けた同じ操作として継続する。

baseline history repairは通常migration deployのchat routeへ絶対に混ぜない。`20260815000000` がすでにSATISFIED/APPLIEDなら再実行禁止。

### deploy

chat承認経路が利用できない場合のmanual fallback。`workflow_dispatch` から `deploy` を選び、confirmationが正確に `DEPLOY` の場合だけ適用する。

manual deployは `production-approval` Environmentで1回だけ人間承認を要求する。承認後のstatus確認、dry-run、適用、post-mutation確認、observability検証は、その1回の承認を受けた同じ操作として継続する。`PRODUCTION_APPROVAL_GATE_READY=true` でなければmutationはfail closedで停止する。

通常運用ではmanual deployを使わず、read-only plan → chat approval → chat-approved Production deployを使う。

## Safety rules

- 本番DB変更はPRのCI成功後、`main` に入ったmigrationだけを対象にする。
- 本番DB mutationには明示的な人間承認を必須にする。通常deployでは元の高リスクPRに対するチャットの「本番承認」1回を唯一の人間承認とし、manual fallbackでは `production-approval` Environmentを使う。
- 同一chat-approved操作に二回目の承認コメントやEnvironmentの二重承認を要求しない。
- 通常自動workflowは、Production pendingを承認済み元PRへ一意に逆引きできた場合だけmutationへ進み、証明できない場合はread-only確認でfail closedする。
- preflightのstale-run cleanupはGitHub Actions stateだけを対象にし、Supabase DBやmigration historyを変更しない。
- stale-run cleanupはpreflightとchat-approved deployで共通scriptを使い、人間起動run・複数bot run・waiting以外・current main・Ledger不一致をcancelしない。
- chat-approved deployはclaim前とProduction境界でcurrent mainを再確認する。
- mutation直前にpending migration完全一致とdry-runを再実行する。
- approved migration集合と本番pendingが完全一致しなければdeployしない。
- 想定外のmigrationがpendingならchat/manualともdeployしない。
- `repair-history` は `20260815000000` 以外を受け付けない。
- initial baselineのhistory repairでは4つのcore tableをfresh read-only queryで直前確認し、その確認を省略しない。
- ほかのmigration history異常へ、過去の確認結果やbaseline repair経路を流用しない。
- approval challengeはone-timeで、claim済みapprovalを再利用しない。
- migrationには可能な限りprecheck、postcheck、rollbackを用意し、CIで検証する。
- rollbackは自動実行しない。障害内容とデータ影響を確認してから明示的に実行する。
- secretsをrepository、workflow、ログ、SQL、issue、PR本文へ直接書かない。

## One-time migration history alignment

NOVELIGHTではCLI導入前にSQL Editorまたは手動構築で適用・作成したDB状態が存在する。すでに本番へ反映済みの状態に対応するmigrationがpendingとして表示された場合は、そのまま再適用しない。

今回の `20260815000000` は、Productionのhistorical core tablesがmigration管理開始前から存在していたことをfresh read-only checkで確認できた場合だけ、Supabase CLIの `migration repair --status applied` を使ってremote migration historyだけを合わせる。

`20260819190000` と `20260822194000` は過去にhistory alignment済みで、現在のrepair workflowの対象外とする。将来これらを含む別versionのhistory異常が発生した場合は、当時の証拠をcurrentとして再利用せず、DB実状態をfreshに確認したうえで専用の修正・承認経路を作る。
