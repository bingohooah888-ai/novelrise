# NOVELIGHT Staging Migration Sync

最終更新: 2026-09-01

この文書は、`docs/STAGING-RUNBOOK.md` の「migrationを含む変更の昇格順序」で要求される、専用Stagingへの正式かつ再現可能なmigration同期手順を定義する。

## 1. 目的

Production migration planは、Production承認handoff前にrepositoryとStaging migration historyの完全一致を要求する。Stagingが遅れている場合にProduction側のgateを弱めるのではなく、専用Stagingへ安全にmigrationを同期してから既存のStaging smokeとProduction planへ戻る。

実行Workflowは次をSingle Sourceとする。

- `.github/workflows/supabase-staging-sync.yml`

このWorkflowはProduction migration workflow、Production approval、通常のStaging smokeとは分離する。

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

Workflow dispatchでは次をすべて明示する。

- `revision`: 実行対象となるexact 40-character current `main` SHA
- `migrations`: 14桁versionを昇順・重複なしのcomma-separated形式で指定したexact pending set
- `confirmation`: `SYNC STAGING`

例として1件だけ同期する場合、`migrations` は `20260831210000` のようなversionだけを指定する。Workflowはmigration名やSQL本文を入力から受け取らず、指定SHAのrepository artifactを唯一の実行物とする。

## 4. Fail-Closed実行順序

Workflowは次の順序を固定する。

1. typed confirmation、exact SHA、canonical migration setを検証する。
2. 指定SHAをcheckoutし、そのSHAが現在の `main` と一致することを確認する。
3. `STAGING_SUPABASE_URL` と `STAGING_DATABASE_URL` が同じ専用Staging projectを指すこと、および `PGSSLMODE=require` であることを検証し、Production projectや暗号化を必須にしない接続を明示的に拒否する。
4. 各migrationについて以下がexactly one存在することを確認する。
   - `supabase/migrations/<version>_*.sql`
   - `supabase/checks/<version>_*_precheck.sql`
   - `supabase/checks/<version>_*_postcheck.sql`
   - `supabase/rollback/<version>_*_rollback.sql`
5. precheckをStaging DBへ実行する。
6. Stagingのactual pending setが入力したexact setと完全一致することを確認する。remote migration historyに構造不正・非canonical versionが1行でもあれば停止する。
7. `supabase db push --db-url ... --dry-run` を実行する。
8. mutation直前にcurrent `main` SHA、Staging target、exact pending set、dry-runを再確認する。
9. canonical Supabase CLI `db push --yes` で専用Stagingだけへ適用する。
10. postcheckを実行する。
11. repositoryのmigration version集合とStaging remote historyの完全一致を確認する。

途中で1つでも不一致・欠落・設定drift・CLI failureがあれば停止する。

## 5. Rollback境界

rollback SQLはmutation前に存在を必須確認するが、Workflowから自動実行しない。

DDLが途中まで適用された可能性がある場合、自動rollbackを続けて実行すると障害状態をさらに変化させる可能性がある。そのためfailure後は状態をread-onlyで確認し、対象migrationのrollback artifactと実際のDB状態を照合したうえで、別の明示承認されたrecovery操作として扱う。

## 6. 通常の昇格順序

migrationを含む変更では次を維持する。

1. migration / precheck / postcheck / rollbackと関連コードをCIで検証して `main` へmergeする。
2. `supabase-staging-sync.yml` をexact current main SHAとexact migration setに固定して実行する。
3. Staging schema capability gateをPASSさせる。
4. authenticated / billing Staging smokeをPASSさせる。
5. Production migration planでProduction pending一致・dry-run・Staging exact parityを確認する。
6. Production用のfreshなOWNER承認を得る。
7. Production workflow自身でもpending一致とdry-runを再確認してから適用する。

Staging同期の成功はProduction適用の承認ではない。Production mutationは引き続き独立したHigh-Risk承認境界を持つ。

## 7. 禁止事項

- `PRODUCTION_DB_PASSWORD`、Production Supabase credential、Production approval environmentをStaging syncへ持ち込まない。
- `STAGING_DATABASE_URL` をjob-level `env` やthird-party actionへ渡さない。
- Staging DB接続で `PGSSLMODE=require` より弱いtransport設定を許可しない。
- Staging parity gateを無効化してProductionへ進まない。
- exact pending setが一致しない状態で `db push` しない。
- malformed / noncanonicalなremote migration historyを無視してparityを成立させない。
- stale SHAへ同期しない。
- rollbackを自動実行しない。
- Secretをecho、artifact、Issue、PR本文へ出さない。
