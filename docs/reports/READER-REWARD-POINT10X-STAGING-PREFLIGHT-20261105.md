# NOVELIGHT βPoint10倍｜Staging READ-ONLY実測・原子切替準備レポート

作成日：2026-11-05 JST  
作業branch：`feature/reader-reward-gate01-20261104`／Draft PR #2762  
着手時main：`03f64b14138ec5c6a90c0d8231a0784f878e78fa`  
着手時PR HEAD：`2f3631e90e3ea3588917c334e0f5f6f33ebb9bb2`  
**判定：Staging read-only shadow確認済・ローカル原子／復旧モデル検証済。実Stagingのmigration、UPDATE、実RPC試験は**未承認・未実施**。Production DB／main／Vercel Production未変更。**

## 1. 正式基準と境界

正式main MASTER `docs/NOVELIGHT-MASTER.md` blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`（全5,089行）、PR上Draftの第50.4a条、`AGENTS.md`、`docs/WORK-EXECUTION-PREFLIGHT.md`、`docs/AUTOMATION-CONTINUATION-GATE.md`、`docs/NLO-EXECUTION-POLICY.md`、`docs/development-workflow.md`を確認。FULL PREFLIGHTの実行カードを最初に提示。mainへの直接変更なし。

MASTERによれば、Staging書込み・migration sync・実環境Smokeは明示的な**一回限りの「ステージング承認」**をexact main SHA・実施scopeに束縛し、Issue #188などOWNER認証済みの機械可読経路から投入することが必須。以前の承認の流用は禁止。

今回確認したIssue #188はClosed、最後のコメントは2026-10-31の別PR・別main・別scope。Point10倍切替に対応する現行承認は未確認。**現行の`full-smoke`／`live-proof`承認スコープはPoint台帳・RPC変更の承認ではない**ため、勝手に流用しない。Gate未成立ゆえ実Staging書込みはDefault-Deny。

## 2. Supabase branch識別・読み取り専用実測

- Production ref `fiepaguycecrredwrcwx`（`novelrise`）。
- **Staging ref `wmlzjgvxgoyrovdhbqbg`**（Supabase branch `staging`、`git_branch=main`、branch元とは別project ref）。DB `postgres`／PostgreSQL 17、ACTIVE_HEALTHY。
- ProductionとStagingで検査対象6テーブルのカラム／データ型を対比。10のPoint関連関数と10の主要トリガーの定義ハッシュが**一致**。既存関数は`novelight_award_level_up_points()`が新規到達レベルに**旧5pt**を付与。ステージングでの同時変更が必須。
- Branch APIでは`with_data=false`だがStagingには独自の多数の記録が存在。**Productionの全件コピー／バックアップではない**。StagingのデータをProduction残高へ流用しない。

| Point資産・対象 | Production（読取のみ） | Staging（読取のみ） | Staging x10予定 |
|---|---:|---:|---:|
| Point Ledger件数 | 132 | **3,581** | 3,581 |
| Ledgerユーザー数 | 36 | **1,605** | 1,605 |
| Ledger Point合計 | 172 | **3,581** | **35,810** |
| Ledger distinct event_key | 132 | 3,581 | 3,581 |
| 称号定義総件数 | 182 | **182** | 182 |
| 称号Point報酬定義の合計 | 835 | **835** | **8,350** |
| Point累積条件の称号数 | 2 | **2** | 2 |
| Point条件の閾値 | 100／500 | 100／500 | **1,000／5,000** |
| Point累積称号の進捗レコード | 360 | **12,870** | 12,870 |
| Point累積称号の進捗値合計 | 344 | **7,162** | **71,620** |
| Point称号の獲得済み件数 | 0 | **0** | 0 |
| 運営調整Point金額を持つ行 | 0 | **0** | 0 |

追加の読取検査で、Staging Ledgerの各行`point_value×10`が既存±1,000,000 CHECKに収まり、戻り除算との不一致0、重複event_key0、非confirmed0、reversal行0、Point称号進捗の上限超過0、Point称号の`progress_percent`異常0、運営金額の範囲逸脱0を確認。これは**SELECTで計算したshadow結果**であり、DB UPDATE実行成功とは異なる。

## 3. バックアップ・二重変換防止・ロールバック・全件照合

新規`docs/plans/READER-REWARD-POINT10X-STAGING-RUNBOOK-20261105.md`に、Staging専用のバックアップ取得と独立リストア、Point書込み停止境界、旧関数5pt→新50ptの原子的な同時変更、Point閾値100→1,000／500→5,000、Point称号進捗のみ10倍、元のevent_key／status／XP／earned状態の保持、全件チェックサム、永続一意マーカー、二重実行拒否、障害注入、スナップショット復旧、Production誤接続拒否を規定。

**バックアップ取得、独立Restore、実Stagingでの原子的変更・ロールバックは未実施**。Staging更新承認がない状況で取得や書込みを装わない。誤ってProductionを更新するSQL、未承認のmigration runner、workflow_dispatch等を作成しない。

## 4. 隔離環境の実行済み検証と限界

1. 隔離Node24＋非公開純粋関数：`api/_lib/reader-reward/tenfold-staging-evidence.js`、新規`tests/reader-reward-tenfold-staging-evidence.test.mjs`で**33のfocusedテスト**。別DB識別、StagingとProductionの異なる実測値、Point制約・重複検知、完全照合・ロールバックの未証明保持、実証フラグがすべてtrueでも実Staging/Production書込み権限が生まれないことを検証。
2. ローカルの廃棄可能な**PGlite 0.5.15／PostgreSQL 18 WASM**で、Point Ledger／称号定義／Point称号進捗／運営調整／XPの**合成データだけ**を作成し、SQLの`BEGIN/COMMIT/ROLLBACK`・表ロック・一意マーカー・途中失敗の全表rollback・正常x10・負数・pendingの保全・段階的なロールバック・旧関数の復元・二重変換拒否・再試行の**23条件PASS**を確認。スクリプト `docs/plans/READER-REWARD-POINT10X-LOCAL-PGLITE-PROOF.mjs`。**本物のSupabase Staging PostgreSQL 17で実行したことにはならない**。
3. 既存Gate01〜13と前回Point単位変更の **321件** のテストを維持し、今回33件追加（全件テスト **354件** を対象）。Prettier／ESLint／Nodeチェック、GitHub CI／CodeQLは最新PR HEADで最終確認。
4. 変更はDraft PRのコード／ドキュメントのみで、DB migrationファイル、Supabase DB更新、Staging Smoke、Vercel PreviewやProduction、本番支払い・AI呼出し、mainへのmergeは行わない。

## 5. 未達（次の承認段階まで停止）

- 本scope `reader-reward-beta-point-10x-staging`に対応する**OWNERの明示「ステージング承認」＋exact main SHA／PR HEAD／Staging project refへの束縛**。必要ならIssue #188の既存機械承認経路が同scopeを合法的に処理可能であることを検証する。
- Stagingの完全なバックアップ／リストア実証、現行Stagingの書込み経路とRPC変更の厳密な同時性、更新後の全件照合・障害注入・復旧・二重変換防止の**実DB証拠**。
- 実Stagingの認証済みユーザー権限とRLS、ブラウザ表示、正規アプリの発行処理の確認。Stagingの結果をProductionで再実施するには**別途Production DB承認**と最新データ再集計が必要。

**最終判定：承認不要な作業は完了、Staging書込みは承認待ちで安全停止。**
