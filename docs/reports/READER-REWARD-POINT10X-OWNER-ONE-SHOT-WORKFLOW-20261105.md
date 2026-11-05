# NOVELIGHT βScout Point10倍｜Issue #294の一回限りOWNER承認・非稼働workflow準備監査

記録日：2026-11-05 JST。対象：Draft PR #2762、独立SQL候補Draft PR #2763は未変更。  
正式main：`03f64b14138ec5c6a90c0d8231a0784f878e78fa`。  
正式MASTER blob：`91d11fa367b7de64990b13397b13d4bb6e3c0230`（5,089行）。  
#2762の開始時HEAD：`60bc1e30a08fc62938a0bd0ac4c03da9b7e033f0`。  
#2763 HEAD：`58e60ef90801078e097e321590428c4b8b343486`。

**結論：OWNER一回限りのCLAIMED／CONSUMEDとStaging executorを、安全ゲートを緩めず非稼働のコード・workflow下書き・反証テストまで具体化。実行可能なワークフロー登録、実DB書込み、Staging実行、main統合、本番デプロイは一切行わない。**

## 1. FULL PREFLIGHTと既存契約の維持

- mainの`docs/NOVELIGHT-MASTER.md`・`AGENTS.md`・`docs/WORK-EXECUTION-PREFLIGHT.md`・`docs/AUTOMATION-CONTINUATION-GATE.md`・`docs/NLO-EXECUTION-POLICY.md`・`docs/development-workflow.md`を照合。OWNER本人の**新規の**ステージング承認、最新main SHAとscopeと1回の実行への束縛、受理済みの失敗・中断・キャンセル時にも再利用不可が上位条件。
- Issue #294 `[Staging Control] Supabase migration sync`をGitHubのsource of truthとする。既存`staging-reader-point-tenfold-proof.yml`は旧scope `reader-reward-beta-point-10x-staging`／`rollback-only`。このworkflowは#2762のDraftに存在し、trusted-mainにはない。今回旧scope・承認方法・head-bound契約を拡大・変更しない。
- 2026-11-05時点の#2762/#2763はDraftで、いずれもmain behind=0。本体#2762だけに4新規ファイルを追加し、#2763のROLLBACK-only SQL4本と安全フィルターを変更しない。
- NLOはRemote Desktop Commanderとは別。今回はGitHub connectorで正本確認、認可済み隔離ローカル作業環境で静的コード・テスト実施。**Staging/Productionへの操作なし**。

## 2. 新規非実行コード

`scripts/scout-point10x-atomic-one-shot-ledger.mjs`：

`inspectScoutAtomicOneShotLedger` — 既存の`inspectScoutAtomicOwnerRequest`が返す仮想レビュー結果に対し、Issue #294コメント全ページを検査する設計。完全な履歴取得、Issue writer ID、GitHub actor、main/candidate SHA、専用scope/mode、承認コメントID・operation ID・scope＋candidate HEAD単位のリプレイ拒否、CLAIMED／CONSUMEDの固有fingerprintと順序整合を評価する。欠損・偽造・重複・不正なterminal outcome・REQUESTより古いCLAIM・CLAIMより古いCONSUMED・不明のトランザクションなどを**すべてFail Closed**。

`quoteScoutAtomicClaimTransition` — 将来のtrusted-main executorに、CLAIMをStagingのsecret参照**前に**OWNER認証済み経路で記録し、そのGitHub commentを取得し直す手順を要求する。GitHub Issueコメントは原子的CASではないため、**別途共有した排他serial lock**が必須。cancel/retryしても古いCLAIMを解放せず、新規承認を要求。

`quoteScoutAtomicConsumeTransition` — 成功、失敗、中断、キャンセル、COMMIT不明の5結果をterminalとする。CLAIMEDのrequest ID、operation ID、scope/mode、両SHA、run IDが完全一致しない履歴は拒否。COMMIT不明ならread-onlyのmarker・event journal再照会を要求し、自動再実行しない。**CONSUMED実際のコメント書込みは未実装**。記録失敗時にも使い回さないことを設計上の前提とする。

`quoteScoutAtomicRestoreProof` — Staging backup全体取得・独立PostgreSQL復元・全行digest・関数ACL／trigger／RLS／source unit・writer fence・COMMIT状態の照合が未成立なら停止する。正当な新規Point発行後の古いbackup上書きを拒否。自己申告が全て良好でも実Backup/Restoreを実施したとは認定せず、権限は常にfalse。

**共通不変条件：** `independentlyAuthenticated=false`、`ledgerClaimPosted=false`、`ledgerConsumedPosted=false`、`mayUseStagingSecrets=false`、`mayExecuteSql=false`、`mayRunStaging=false`、`mayChangeProduction=false`。この純粋コードをそのままOWNER認証や実行器として使ってはいけない。

## 3. 非稼働workflow下書き（`.github/workflows`には置かない）

`docs/plans/READER-REWARD-POINT10X-OWNER-LEDGER-INERT-WORKFLOW-20261105.yml` を追加。

- GitHub Actionsの監視ディレクトリ**外**、`"on": {}`、`if: ${{ false }}`、`permissions: contents: read`、秘密変数やDB/CLIの操作なし。
- 並列処理についてはIssue #294のStaging mutationで共有する専用排他mutex／`cancel-in-progress: false`を設計するが、**現行の旧workflowと共有されている事実はない**。本番/既存workflowのconcurrencyを今回変更しない。
- 将来のtrusted-mainで実装する場合、issue_comment.createdの正規OWNER認証→fresh SHA照合→CLAIM投稿→その投稿の真正性を再取得して確認→ここではじめてsecret参照／Staging操作→結果にかかわらずCONSUMED投稿、の順序が必須。CLAIM投稿自体の競合と処理途中のクラッシュを独立解決し、単なるIssueコメントをDB lockと同等に扱わない。
- 旧scope `reader-reward-beta-point-10x-staging`／`rollback-only`の承認を、新しいatomic proof/persistent scopeに昇格させない。永続Staging cutoverは別の明示OWNERステージング承認と独立のprivileged executorレビューが必要。

## 4. SECURITY DEFINER／private marker／旧Writerの未完了依存

- 既存の5pt付与SECURITY DEFINER関数は`point-tenfold-writer-cutover-contract.js`で基準関数SHA-256固定済み。5→50pt候補差分以外のowner/ACL/empty search_path/trigger変更は拒否。今回RPC定義／ACL／RLSを実DBで操作していない。
- private markerの非公開schema、Unique(scope,version)/approval ID、RLS/FORCE、PUBLIC/anon/authenticated/service_roleへのREVOKEは`docs/plans/READER-REWARD-POINT10X-PRIVATE-MARKER-REVIEW-20261105.sql`の設計のみ。**DDLは実行していない**。
- 旧Rank/発掘/レベル/称号/運営/直接service_role/Cron/Edge/Queue/Retry/Read/Comment全経路の持続的停止、inflight=0、DB unit fence、Backup/Restoreと同一DBトランザクションでのPoint5面＋private marker＋50pt RPC切替は依然未実装。
- COMMIT前のROLLBACK保証とCOMMIT後の復旧保証は別の証拠が必要。COMMIT済みで新規Pointがあれば古いbackupで上書きせず、event journalによるforward repairをOWNER別承認で審査。

## 5. 反証テスト・完了判定

新規`tests/scout-point10x-atomic-one-shot-ledger.test.mjs`：**73 focused tests**。OWNER/履歴偽装、コメント欠損・不完全ページ、CLAIM/CONSUMED重複・逆順・端末ステータスの改ざん・run ID/HEAD drift、CLAIM前のsecretアクセス、Claim reread未確認、terminal result別の不可再利用、backup/restore失敗・ACL/row digest/Writer fence/commit不明・Point損失防止、ワークフローの完全非稼働を検証。

隔離Node24上の本体PR相当：前工程673＋今回73＝**746件PASS／0FAIL**（実施後に確定報告）。Prettier／ESLint／Node構文とGitHub CI／CodeQLを同一HEADで確認し、PR本文へ最終結果を追加する。

**本工程の4ファイルは実行契約の準備であり、本人承認・機械CLAIM登録・Staging live proof・main merge・Production applyを完了したという意味ではない。** 次の実装にはtrusted-main workflow実行境界を新しいOWNER承認の下で追加し、全経路を審査してから実Staging検証が必要。
