# NOVELIGHT Staging Migration Sync

最終更新: 2026-09-01

この文書は、`docs/STAGING-RUNBOOK.md` の「migrationを含む変更の昇格順序」で要求される、専用Stagingへの正式かつ再現可能なmigration同期手順を定義する。

## 1. 目的

Production migration planは、Production承認handoff前にrepositoryとStaging migration historyの完全一致を要求する。Stagingが遅れている場合にProduction側のgateを弱めるのではなく、専用Stagingへ安全にmigrationを同期してから既存のStaging smokeとProduction planへ戻る。

実際のStaging DB mutationを行うWorkflowは次をSingle Sourceとする。

- `.github/workflows/supabase-staging-sync.yml`

通常の起動経路は次のowner-only request bridgeとする。

- `.github/workflows/supabase-staging-sync-request.yml`
- Control Issue: `#294 [Staging Control] Supabase migration sync`

request bridgeはmutation SQLやDB credentialを扱わず、検証済みのexact inputだけをSingle Source workflowへ渡す。`workflow_dispatch` はfallbackとして残す。

これらはProduction migration workflow、Production approval、通常のStaging smokeとは分離する。

## 2. 一度だけ必要な設定

秘密値そのものは文書・Issue・ログへ記録しない。

GitHubの `staging` Environmentへ次のSecretを設定する。

- `STAGING_DATABASE_URL`
  - 専用Staging Supabase projectの**direct database URL**
  - 形式は `postgresql://postgres:<password>@db.<staging-project-ref>.supabase.co:5432/postgres`
  - Production projectのURLやpasswordを流用しない
  - pooler URLを使用しない

既存の `STAGING_SUPABASE_URL` はStaging project identityの正本として維持する。Workflowは `STAGING_DATABASE_URL` のhostが `STAGING_SUPABASE_URL` のproject refと完全一致する場合だけ先へ進む。

`STAGING_DATABASE_URL` はGitHub Actions Secretとしてのみ保持し、Vercel Preview、browser code、Issue、artifact、ログへ複製しない。Workflowのjob-level `env` には置かず、target検証またはDB接続を実行するfirst-party `run` stepへだけ注入する。`actions/checkout`、`supabase/setup-cli` 等のthird-party action stepへは渡さない。

Staging DBへ接続するfirst-party stepは `PGSSLMODE=require` を必須とし、`psql`、`supabase migration list`、`supabase db push` のすべてで暗号化transportを要求する。target verifierとmigration verifierも `PGSSLMODE` がexactly `require` でない場合はFail-Closedする。

## 3. 実行時入力

実際のStaging sync Workflowは次をすべて明示入力として受け取る。

- `revision`: 実行対象となるexact 40-character current `main` SHA
- `migrations`: 今回同期する14桁migration versionを**1件だけ**指定する
- `confirmation`: `SYNC STAGING`

`migrations` は `20260831210000` のようなversionだけを指定する。複数migrationを1回で指定することは現在サポートせず、Fail-Closedで拒否する。これは、後続migrationのprecheckが先行migration適用後のschemaへ依存する場合に、すべてのprecheckを古いschemaへまとめて実行してしまうことを防ぐためである。

複数のpending migrationがある場合は、依存順序どおりに1件ずつ別runとして扱い、各runでその時点のexact `main`、Staging target、actual pending stateを改めて確認する。Workflowはmigration名やSQL本文を入力から受け取らず、指定SHAのrepository artifactを唯一の実行物とする。

### 3.1 通常の自動request経路

手動でGitHub Actions画面へ `revision` / `migrations` / `confirmation` を繰り返し入力することを通常運用にしない。

Staging DB mutationについてユーザーの明示承認が得られた後、最新mainとactual pendingをread-onlyで再確認し、Control Issue #294へrepository ownerとして次の1行だけを投稿する。

```text
NOVELIGHT_STAGING_MIGRATION_SYNC {"mainSha":"<exact-current-main-sha>","migration":"<single-14-digit-version>","confirmation":"SYNC STAGING"}
```

request bridgeは以下をFail-Closedで要求する。

- Issue #294そのもの、固定title、owner作成issueであること
- comment authorがrepository ownerであり `OWNER` associationであること
- JSONがexactly `mainSha` / `migration` / `confirmation` の3キーだけを持つこと
- `mainSha` が40文字lowercase hex、`migration` が14桁1件、`confirmation` がexactly `SYNC STAGING` であること
- claim前にrequested SHAとcurrent `main` が一致すること
- 同一request commentが過去に `CLAIMED` または `CONSUMED` されていないこと

検証後、request bridgeはGitHub Actions botによる `NOVELIGHT_STAGING_MIGRATION_SYNC_CLAIMED` ledgerを先に記録し、既存の `.github/workflows/supabase-staging-sync.yml` をreusable workflowとして呼び出す。終了時はsuccess/failure/cancelled/skippedを `NOVELIGHT_STAGING_MIGRATION_SYNC_CONSUMED` ledgerへ記録する。

一度claimされたrequestを自動retryしない。設定不足やprecheck failure等で停止した場合も、新しいread-only状態確認と新しい明示承認に基づく新規requestを作る。apply後failureのrecovery境界は既存Single Source workflowの規則を優先する。

Control Issue、request JSON、CLAIMED/CONSUMED ledgerへSecret、database URL、password、access token、Production credentialを記録しない。

## 4. Fail-Closed実行順序

Single Source workflowは次の順序を固定する。

1. typed confirmation、exact SHA、**単一のcanonical migration version**を検証する。
2. 指定SHAをcheckoutし、そのSHAが現在の `main` と一致することを確認する。
3. `STAGING_SUPABASE_URL` と `STAGING_DATABASE_URL` が同じ専用Staging projectを指すこと、および `PGSSLMODE=require` であることを検証し、Production projectや暗号化を必須にしない接続を明示的に拒否する。
4. 対象migrationについて以下がexactly one存在することを確認する。
   - `supabase/migrations/<version>_*.sql`
   - `supabase/checks/<version>_*_precheck.sql`
   - `supabase/checks/<version>_*_postcheck.sql`
   - `supabase/rollback/<version>_*_rollback.sql`
5. **repository-controlled SQLを1行も実行する前に**、Stagingのremote migration historyがcanonicalであり、actual pending setが入力した単一migrationと完全一致することを確認する。構造不正・非canonical version・想定外pendingが1件でもあれば停止する。
6. precheckをStaging DBへ実行する。
7. `supabase db push --db-url ... --dry-run` を実行する。
8. mutation直前にcurrent `main` SHA、Staging target、exact pending set、dry-runを再確認する。
9. canonical Supabase CLI `db push --yes` で専用Stagingだけへ適用する。
10. postcheckを実行する。
11. repositoryのmigration version集合とStaging remote historyの完全一致を確認する。
12. 成否にかかわらずrecovery境界を記録する。applyが成功した後にpostcheck/parityが失敗した場合は、Stagingがすでに変更済みであること、自動retry・自動rollbackを行わないことを明示する。

途中で1つでも不一致・欠落・設定drift・CLI failureがあれば停止する。

## 5. Rollback境界

rollback SQLはmutation前に存在を必須確認するが、Workflowから自動実行しない。

`db push --yes` が成功した後にpostcheckまたは最終parityが失敗した場合、Workflowは `STAGING_MIGRATION_RECOVERY_REQUIRED` を記録し、「Staging DBはすでに変更済み」であることを明示する。この状態で同じsyncを自動再実行したりrollback SQLを自動実行したりしない。

apply step自体がsuccessを返さなかった場合も、部分適用の可能性を推測で否定しない。DB状態をread-onlyで確認し、対象migrationのrollback artifactと実際のDB状態を照合したうえで、別の明示承認されたrecovery操作として扱う。

DDLが途中まで適用された可能性がある場合、自動rollbackを続けて実行すると障害状態をさらに変化させる可能性があるため、復旧判断とStaging同期は分離する。

## 6. 通常の昇格順序

migrationを含む変更では次を維持する。

1. migration / precheck / postcheck / rollbackと関連コードをCIで検証して `main` へmergeする。
2. Staging DB mutationの明示承認後、latest mainとsingle pending migrationをread-onlyで再確認し、Issue #294のowner-only request bridgeから `supabase-staging-sync.yml` をexact current main SHAと単一のexact migration versionに固定して実行する。複数pendingがある場合は依存順序で1件ずつ同期する。manual `workflow_dispatch` はfallbackとする。
3. Staging schema capability gateをPASSさせる。
4. authenticated / billing Staging smokeをPASSさせる。
5. Production migration planでProduction pending一致・dry-run・Staging exact parityを確認する。
6. Production用のfreshなOWNER承認を得る。
7. Production workflow自身でもpending一致とdry-runを再確認してから適用する。

Staging同期の成功はProduction適用の承認ではない。Production mutationは引き続き独立したHigh-Risk承認境界を持つ。

## 7. 禁止事項

- `PRODUCTION_DB_PASSWORD`、Production Supabase credential、Production approval environmentをStaging syncへ持ち込まない。
- `STAGING_DATABASE_URL` をjob-level `env` やthird-party actionへ渡さない。
- request bridgeまたはControl Issueへ `STAGING_DATABASE_URL` その他のSecretを渡さない。
- Staging DB接続で `PGSSLMODE=require` より弱いtransport設定を許可しない。
- Staging parity gateを無効化してProductionへ進まない。
- exact pending setが一致しない状態でprecheck SQLまたは `db push` を実行しない。
- malformed / noncanonicalなremote migration historyを無視してparityを成立させない。
- 複数migrationを1runへまとめて、依存するprecheckを古いschemaへ一括実行しない。
- stale SHAへ同期しない。
- claim済みrequestを自動retryしない。
- apply後の検証failureを「未変更」とみなして自動retryしない。
- rollbackを自動実行しない。
- Secretをecho、artifact、Issue、PR本文へ出さない。
