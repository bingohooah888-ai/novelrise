# Supabase production migration deployment

NOVELIGHTの本番Supabase migrationは、次の3本のGitHub Actionsを役割分離して管理する。

- `.github/workflows/supabase-production-auto-deploy.yml`
  - `main` に新しいmigrationが入ったときの自動read-only safety plan用
  - pending完全一致確認と `supabase db push --linked --dry-run` までで終了し、本番DBは変更しない
- `.github/workflows/production-migration-approved-dispatch.yml`
  - ChatGPTで明示承認された通常migration deploy用
  - Production Approval Ledger issue #165のowner-authored one-time approvalを正式な人間承認として扱い、同じ承認に対する `production-approval` Environmentの二重レビューは要求しない
- `.github/workflows/supabase-production.yml`
  - 手動の `status` / `dry-run` / `repair-history` / `deploy` 用
  - 緊急時・再確認・限定的なhistory repair用の安全なフォールバックとして残し、mutationは `production-approval` Environment承認を必須にする

本番DB変更は完全無人化しない。通常deployではChatGPT上の明示承認を、manual fallbackではGitHub Environment承認を人間の承認点として残し、それ以外の反復操作を自動化する。同一Production操作に対して両方の承認を重複要求しない。

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

### 1. Automatic safety plan

`main` へ `supabase/migrations/**` が入ると `.github/workflows/supabase-production-auto-deploy.yml` が起動し、自動で以下を行う。

- merge前のmainとmerge後mainを比較し、今回追加されたmigration versionを抽出する
- `supabase migration list --linked` で本番remote historyを確認する
- 本番でpendingになっているmigrationが、今回mainへ入ったmigrationと完全一致することを確認する
- 想定外の古いpending migration、欠落、historyずれがあれば停止する
- `supabase db push --linked --dry-run` を実行する
- Actions summaryへ、対象main SHA・migration version・「mutationなし」を記録する

このworkflowは `supabase db push --linked --yes` を持たず、`production-approval` Environmentでも待機しない。ここまでは本番DBを変更しない。

既存migrationが別理由でpendingになっている場合は、Issue #165の `NOVELIGHT_PRODUCTION_MIGRATION_PREFLIGHT <mainSha>` 経路でfresh read-only preflightを取り直してもよい。いずれの場合もEvidence Freshness Gateを満たすcurrent evidenceが必要。

### 2. Chat approval

read-only evidenceで対象が確定した後、ユーザーがChatGPT上でそのProduction migration deployを明示承認した場合だけ、assistantはProduction Approval Ledger issue #165へ次の形式のowner approval recordを1件記録できる。

```text
NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_APPROVE {"operation":"supabase-migration-deploy","mainSha":"<40-hex-current-main>","challenge":"<8-uppercase-hex>","migrations":["<14-digit-version>", "..."]}
```

承認は次に固定される。

- exact current `main` SHA
- canonical sort済み・重複なしのmigration version集合
- one-time challenge
- operation `supabase-migration-deploy`
- baseline repair version `20260815000000` を含まないこと

`.github/workflows/production-migration-approved-dispatch.yml` はissue #165のowner-authored commentだけを受け付ける。JSON、SHA、challenge、migration集合、baseline除外を検証し、同じapprovalが過去にclaim/execution済みならfail closedする。

### 3. Claim and Production boundary

chat workflowはmutation前に次を行う。

- current `main` が承認SHAと一致することを確認
- approvalを `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_CLAIMED` としてone-time claimする
- PR #219以前のbridgeが残したbot-started `supabase-production.yml` waiting runが1件だけ存在する場合、Issue #165の対応する `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_DISPATCHED` 記録と一意に照合できたときだけcancelする
- human-started active manual run、複数のbot run、ledgerと一意に結び付かないrunがあれば停止する
- Production jobに入った後、current `main` と同じclaimをもう一度独立検証する
- exactly approved SHAをcheckoutする
- Production project refを固定値として使用する
- `supabase-production-migration` concurrency lockを使う

claim後にmainが変わった場合、同じapprovalを再利用しない。fresh evidenceと新しい明示承認が必要。

### 4. Chat-approved deploy

Production境界の再検証後も、mutation直前に以下を再確認する。

- `supabase migration list --linked`
- Production pending migrationが承認されたversion集合と完全一致すること
- `supabase db push --linked --dry-run`

すべてcurrent/passの場合だけ:

- `supabase db push --linked --yes`
- post-deploy migration status
- pending local migrationが残っていないこと
- `production_beta_observability.sql` のread-only検証
- `production-beta-verification` commit status

を同じworkflowで実行する。

成功時はIssue #165へ `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_EXECUTED`、失敗時は `NOVELIGHT_PRODUCTION_MIGRATION_DEPLOY_FAILED` を記録し、`mutation_result` / `postcheck_result` / `failure_phase` を分離して残す。

`db push --yes` が成功した後のobservabilityだけが失敗した場合、migration mutation自体を再実行してはならない。fresh migration historyを確認してmutationをSATISFIEDとして扱い、observabilityをread-onlyで別調査する。

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
- 本番DB mutationには明示的な人間承認を必須にする。通常deployではSHA/version/challenge固定のchat approval、manual fallbackでは `production-approval` Environmentを使う。
- 同一chat-approved操作にEnvironmentの二重承認を要求しない。
- 自動main-push workflowはread-only plan/dry-runまでで、mutationしない。
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
