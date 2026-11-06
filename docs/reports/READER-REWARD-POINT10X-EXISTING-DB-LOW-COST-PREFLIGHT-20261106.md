# NOVELIGHT β Scout Point10倍｜既存Supabase・追加契約ゼロの最小切替候補

**2026-11-06 JST / main `f278472a5ce2575d5847feb720d85574b652f1fe` / Draft only / NO-GO**

## 結論・採用範囲

- OWNER判断：**独立CONTROL追加契約を保留**。β Scout Pointの「旧100→新1,000」等の**数値単位10倍**に限り、既存Supabase内での切替をレビューする。新規有料リソースなし。
- PR #2762（Draft、HEAD `20891ce73ae788545784c72b4eb6a1e1f900aa87`）の採用仕様は **10pt＝1円相当／外部ギフト最低30,000pt**。ただし同PRのMASTER第50章は現行mainへ未統合。**外部ギフト交換・AI Point実消費・新しい金銭的権利をこのPRで有効化しない**。
- PR #2763（Draft、HEAD `58e60ef90801078e097e321590428c4b8b343486`）の5数値UPDATEを**別レビュー用ファイル1本**に最小限再利用。既存PRは編集・統合しない。旧固定Staging件数は転記せず、実行時の全行snapshotで整合確認する。
- SQLは `docs/plans/READER-REWARD-POINT10X-EXISTING-DB-ATOMIC-REVIEW-20261106.sql` のみ。**`supabase/migrations`／実行中Actionsに一切追加しない。実DBでは未実行。**

## 本日読み取り専用で確認した事実

1. 最新main・MASTER Git blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`、MASTER全5,086行のSHA256は `1938181b477235f43eaa78194f38261edddd52fe4efb82d48913616fa22c2ae6`。Runtime Gate `start`／`github` PASS。
2. 現在のSupabase連携に表示されるのはProduction `fiepaguycecrredwrcwx` のみ。Staging `wmlzjgvxgoyrovdhbqbg` はこの連携では `Project not found`。**削除済みと断定しない**。Vercel PreviewにはStaging専用の変数名が登録されているが、値・有効性は調査していない。
3. Productionの読み取り専用カタログ実測：旧5pt付与関数 `novelight_award_level_up_points()` の定義MD5 `830b9784d2e7d5bdd71054188aa06e91`、称号付与関数 `e912c55468e49cdcf00be084f21d283b`、β発掘Pointのno-op `f016fc2098eb7e2dcfc50898fd5812a0`。旧5pt関数は**2026-09-28の非公開発掘を除くβ版**が正本であり、2026-09-20の古い関数で上書きしてはならない。
4. 既存台帳はRLS有効、`event_key`一意、逆仕訳参照あり。これだけで異なる操作の二重支払・外部交換の原子性は保証できない。

## 新規・専用の承認境界（旧独立CONTROL workflowは変更しない）

- 新提案scope：`reader-reward-beta-point-tenfold-existing-db-staging-v1`。**既存OWNER V3読み取り専用／旧rollback-only／旧独立CONTROL scopeの承認は流用しない**。
- このSQLには新scope、`mode=staging-beta-atomic-single-use`、Staging ref、GitHub本人ID、実行回数1、最新main SHA、単発承認comment IDのGUCトリップワイヤを設けた。**GUCはDBの接続先証明やGitHub本人認証にはならない。** 現時点で入力元の信頼済みrunner／単発spent消費は実装していないため、全実行経路をHOLD。
- 必須の後続承認：正式Stagingの所在・接続権限復旧、staging限定read-only観測、独立バックアップ／別環境復元試験、既存全Writer drain・privileged bypass経路の排他・本番と完全分離の証明、対象HEAD/SHA256とSQLを固定した**新しいStaging専用のOWNER単発実行承認**。これらを確認するまでGUCも設定しない。
- 同一SERIALIZABLEトランザクションで6テーブルを排他、旧関数とRLS・閾値・範囲を検査、台帳・称号報酬・Point閾値・称号進捗・運営調整額の5UPDATE、現行β関数の5pt→50pt、全行JSONB一致、ACLとSECURITY DEFINER保持、private cutover markerを原子的にcommitする提案。失敗時は全体ROLLBACK。COMMIT応答不明なら再実行禁止・primary照会が先。
- **単一DB内のmarkerは独立CONTROL spent tombstoneの代用品ではない。** Productionの管理者操作・バックアップ復元から独立できないため、厳密な外部一次監査／レプリカ独立性を満たさない。今回のβ単位変更に限定し、将来の外部ギフト換金とAI課金では要件を再評価する。

## 残る実稼働ブロッカー

1. Staging ref `wmlzjgvxgoyrovdhbqbg` を接続可能なSupabase組織・アカウントで読み取り専用確認。現時点の連携だけでは実Stagingを検証できない。
2. SQLはコードレビュー候補であり、**本物のStaging DBに対するSQL実行・backup/restore・高権限Writer排他・RLS実証は未完了**。関数／triggerの本物の実行後整合、TXタイムアウト、資格情報の限定も未実証。
3. main PRの統合はVercel Production自動ビルドの可能性があるため、**対象PR＋HEAD限定の別本番承認**が必要。これはDB書き込み承認やPoint10倍有効化の承認ではない。
4. 正式ProductionのPoint改変は更に独立した明示本番承認と本番復旧・監査が必要。今回の追加費用0円案は、それらを暗黙に許可しない。

## 境界と報告

今回の変更はSQL候補・focused tests・本レポートのみ。GitHub PRはDraftで保留。**DBの変更・Secret・Staging／Productionの状態変更・新規課金・CONTROL作成・旧OWNER V3再投稿・他PR統合・Point有効化を実施しない**。ローカル原本の未コミットファイル4 modified＋3 untrackedを保護する。
