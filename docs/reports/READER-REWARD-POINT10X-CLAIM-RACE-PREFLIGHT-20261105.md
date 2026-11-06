# NOVELIGHT βScout Point10倍｜Issue #294 承認CLAIM競合・共有排他 FULL PREFLIGHT（追加監査）

記録日：2026-11-05 JST。**静的・隔離環境の検証のみ**。OWNERの新規承認でもStaging live proofでもない。

## 対象の固定値

- 正式main：`03f64b14138ec5c6a90c0d8231a0784f878e78fa`
- 正式MASTER（`docs/NOVELIGHT-MASTER.md`）blob：`91d11fa367b7de64990b13397b13d4bb6e3c0230`
- 本体Draft PR #2762：検証開始HEAD `5e0131e2905d427eb5178427cf5e3f37b63b8160`、behind 0、ahead 110
- SQL候補Draft PR #2763：HEAD `58e60ef90801078e097e321590428c4b8b343486`、behind 0、ahead 2
- Issue #294はOWNER作成のopen。今回、Issueコメント／承認／CLAIMED／CONSUMEDは**投稿しない**。
- 本体、SQL候補いずれもmainへ統合せず、Productionのデプロイ・Staging操作は行わない。

## 確認した競合要因（既存コードの読み取りのみ）

1. 現在Draft #2762の `.github/workflows/staging-reader-point-tenfold-proof.yml` の `admit` mutex：`novelight-reader-point10x-admit-issue294`。
2. 同じ旧workflowの `stage` mutex：`supabase-staging-migration-sync`。
3. 非稼働の `docs/plans/READER-REWARD-POINT10X-OWNER-LEDGER-INERT-WORKFLOW-20261105.yml` の提案mutex：`novelight-issue294-staging-atomic-review-inert`。
4. **三つは異なる**。従って新scopeと旧scopeの「admissionから実行完了までの共有排他」を、この構成で立証できない。旧workflowをこの監査で修正・起動しない。
5. GitHub Issueコメントの読み取り→CLAIMED投稿は1個の原子的Compare-And-Swapではない。仮にconcurrency文字列を一致させても、GitHub Actions側の待機置換・クラッシュ・CONSUMED書込み失敗等に耐える**永続排他／使い切り保証を別途実証**する必要がある。
6. GitHub ActionsのIssueコメントトリガーはtrusted-mainに置かれた有効workflowだけを対象とする。Draftに存在する現在の旧workflowと、`docs/plans`の非稼働案は、実行済みの新経路として扱わない。

## 追加の非実行モデルと反証テスト

- `scripts/scout-point10x-claim-race-model.mjs`：既存YAMLのadmit/stageと非稼働案のmutexを静的検査。曖昧なjob/不正なmutexの解析はFail Closed。承認・secret・DB・GitHubへの実IOはない。
- `tests/scout-point10x-claim-race-model.test.mjs`：実YAMLのmutex不一致、欠落・二重job・悪意ある動的group、CLAIMの二重読み取り、理想的直列化と実証の区別、権限フラグが常にfalseであることを反証。
- 2 run × 各3操作（scan/append/verify）の順序制約付き**全20通り**を隔離モデルで探索。共有排他なしでは**12通りで重複CLAIMが起こり得る**。例：A.scan → B.scan → A.append → A.verify → B.append → B.verify。
- **理想化された完全直列化**を仮定した2通りでは重複CLAIM 0。しかしこれは実環境のmutex、OWNER認証、コメント耐久性、Stagingの安全性の証明ではない。モデルは常に`mayReadStagingSecrets=false`・`mayWriteStaging=false`・`mayPostClaim=false`。
- 今回の14件focusedテストは隔離Node24でPASS／0FAIL。前工程の73件、旧Gate群は変更しない。GitHub CI／CodeQLはコミット後に**新HEAD**で別途確認する。

## 本当に動かすために、次回の別承認下で独立証明すべき条件

1. 古い `reader-reward-beta-point-10x-staging`／`rollback-only` と新しい `reader-reward-beta-point-10x-staging-atomic-rollback` ／ `atomic-persistent-staging-cutover` を**決して同一承認として扱わない**。両scopeが触れるデータ／Writerの競合排他は、全関係workflowで共有する。既存workflowの実行可能経路の変更には別レビューが必要。
2. Issue #294の真正なOWNER作成イベント／comment ID／全コメントページの取得、最新main・Draft candidate HEAD、fixed hashesを検証する。全scope/operation/HEADの再利用拒否と共有排他を**Staging secretにアクセスする前**に証明する。
3. CLAIMED投稿を失敗・タイムアウト・応答不明としても、投稿された可能性があれば古い承認を自動再利用しない。CLAIMEDを再取得して本人・ID・fingerprint・一意性を確認し、その後だけStaging environmentに進む。
4. 各terminal outcome（失敗・キャンセル・中断・COMMIT不明を含む）でCONSUMEDを記録し、投稿失敗なら人手の独立監査を要求する。**CONSUMEDの不在を未使用と判断しない**。CLAIMEDがある限り使い切り済み。
5. 実行器の永続・原子的な排他証拠、lease/fencing token、ワーカー停止・inflight drain、DB unit fence、旧5pt SECURITY DEFINER RPCを含む全Writer cutover、private marker・Point5面・50pt RPCの単一TXを別途設計・審査する。
6. Backupの独立復元に失敗、COMMITが不明、合法Pointが新規発生、RPC/ACL/RLSの一致未検証ならFail Closed。旧backupを盲目的に上書きせず、read-only requery／別OWNER承認のforward repairを行う。
7. **非稼働ファイルを`.github/workflows`へ移動しない**。Draftのまま正式レビューと専用承認を待つ。旧SQL安全フィルター・承認scope・mainは変更しない。

## 実施していないこと

実OWNER承認コメント、Issue #294のCLAIMED/CONSUMED実投稿、Staging secret読取、Staging run、実DB read/write/DDL、Production更新、main統合、workflow稼働化、Vercel deployment、実送金・AI実行、実backup/restore。

**判定：静的差異と二重CLAIMの論理的反例は確認。共有排他と永続使い切りの実証は未解決（BLOCKED）**。
