# NOVELIGHT βScout Point10倍｜Trusted read-only executor境界・11照会監査証拠・障害復旧（非稼働）

**2026-11-05 JST｜FULL PREFLIGHT｜Draft PR #2762｜INERT MODEL ONLY｜NO-GO**

## 正式基準・着手時の差分

- GitHub main `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`。正式MASTER `docs/NOVELIGHT-MASTER.md` blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`。前工程と一致。
- Draft PR #2762 開始HEAD `292936d93087762ebcfa53a0ff52bf88fa508c61`。別Draft PR #2763 HEAD `58e60ef90801078e097e321590428c4b8b343486`（変更禁止）。
- OWNER管理 Issue #294：現行の承認境界を維持。新しい同一snapshot read-only scopeは**提案のみ・未登録・未承認**、CLAIMED/CONSUMED投稿なし。
- 固定8照会SQL SHA256 `740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11`
- 固定3照会SQL SHA256 `6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1`
- Windows元リポジトリに当該ターン開始時、未コミット4ファイルあり。元mainは編集せず、独立worktreeでのみ新規ファイルを追加。
- NLOとDesktop Commander（DC）は別システム。直接NLO MCPはこのチャットに未露出、GitHub Bridge Issue #1837のヘルス応答は確認できず、**NLO稼働状態は未確認**。安全なDC経由のローカル検証を使用。

## 今回のスコープ：新規3ファイルのみ

1. `scripts/scout-point10x-trusted-readonly-boundary-review.mjs`：完全非稼働の権限境界、監査証拠、復旧レビュー関数。ネットワーク／DB／GitHub／OWNER／SQL実行呼出し・実Secretsアクセス・書込みコードは追加しない。
2. `tests/scout-point10x-trusted-readonly-boundary-review.test.mjs`：正常合成と負例。OWNER/CONTROL/CASの偽装、古いmain/HEAD/scope、別session、権限過大、原SQL digest drift、未知の特権経路、結果payload、署名でないdigestのなりすまし、11件順序・件数・前後文脈、ROLLBACK/CONTROL COMMIT不明時のHOLDを確認。
3. 本レポート：実証階層と残留リスクを記録。

## 権限境界：**実装設計であって権限の実装ではない**

将来のtrusted executorは少なくとも次を独立して証明する必要がある。現状ではどの証明も実装済みとは判断しない。

- **GitHub OWNER面**：Issue #294の本人認証済み新規イベント。新scope `reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly`、正確なmain+PR HEAD、11照会plan digest、2原SQL SHA、単発comment ID、expires、operation、Staging refが不可分。
- **独立CONTROL面**：OWNER approvalを一回だけ消費する永続Postgres transaction/CAS、spent tombstone、同一mutation domain上の単調fencing epoch。GitHubコメントやメモリ内状態は代替不可。既存承認や旧scopeの再利用は不可。
- **Data Plane面**：実際の旧SECURITY DEFINER RPC・service_role・Cron/Edge/queue/再試行のWriter fencingと競合阻止は未証明。CONTROL CASだけでは強制排他にならない。
- **Staging metadata面**：独立の最小権限read-only role、Staging接続先の外部実証、物理接続1本／session1／`READ ONLY REPEATABLE READ` transaction1、元SQLをハッシュ固定した11個のSELECTの順序実行と末尾ROLLBACK。SQL文字列・DB接続能力は今回の純粋関数には渡さない。
- **監査保存面**：作業証拠はsanitized metadata（11件のID・SQL digest・結果digest・件数・同一session/transaction/snapshot文脈）に限定し、元SQL・生レコード・個人情報・secretを含めない。レコードへのアクセス権、完全性・署名・retention/restoreは将来別承認。

## 11件監査証拠モデル

`makeGoodEvidenceEnvelopeFixture()` は既存 `makeGoodOfflineFixture()` の11 synthetic SELECTを参照し、順序とstatement/result digest・row count・OWNER SHA・CONTROL epoch・固定Staging ref・rollback/close ACKをまとめる。digest sealは**改竄検出の合成学習素材**であり、暗号署名でもOWNER本人確認でもStaging証拠でもない。

`reviewInertEvidenceEnvelope()` は、追加のraw payload、欠落・順序崩れ・digestずれ、違うmock trace、別snapshot、虚偽のtrusted属性、unknown privileged path、SQL失敗や閉鎖応答不明を拒否。合成正常時の出力も`NO_GO_INERT_EVIDENCE_ENVELOPE`かつ`mayConnectDb=false`／`actualCatalogCompared=false`。不正入力は部分結果を破棄して`HOLD_INERT_EVIDENCE_ENVELOPE`。

## 障害復旧モデル（自動再実行禁止）

`RECOVERY_STEPS`は要件を読むための擬似順序で、実際に操作を起動しない。OWNER scope不一致、既使用承認、CAS競合・古いepoch・CONTROL COMMIT ACK不明、接続断・timeout・SQL失敗・split snapshot、ROLLBACK/close ACK不明、保存先不明、未知特権経路はHOLD。**CONTROL COMMIT ACKが不明なら独立CONTROL journal/spentの信頼済み読み直しが将来必要**。再CLAIM・同じ承認再利用・結果混合・自動再接続・GO判定は禁止。

出力は常に`decision=NO_GO`、`mayReplayOperation=false`、`mayReleaseFence=false`、`mayResumeClaim=false`、`noAutomaticRetry=true`。新モデルが誤って自動実行権限を持たない構造の負例を追加。

## 実証区分

| 区分                                                           | 状態                                                                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ソース実装                                                     | 新規非稼働JS純粋モデル＋負例テスト＋本監査レポート                                                                                                                                 |
| ローカル自動検証                                               | 新規focused 115件PASS／0 FAIL。ローカル全Node 5,124件中5,115 PASS／0 FAIL／9 SKIP。Prettier／ESLint／360 JS構文PASS。Runtime Gate start／implementation PASS（GitHub／CIは別確認） |
| GitHub CI / CodeQL                                             | Draft PR #2762の新HEADを別途照合、過去HEADの成功を流用しない                                                                                                                       |
| 実Staging PostgreSQL / 11 SELECT / SQL Parser / Docker         | **0回・未実証・未承認**                                                                                                                                                            |
| 実OWNER認証／CLAIM／CONSUMED／CONTROL CAS                      | **0回・未実証・未承認**                                                                                                                                                            |
| 実Writer fencing／旧SECDEF遮断／独立Backup-Restore／Production | **未実証・未実行**                                                                                                                                                                 |
| main統合、Vercel deploy、Supabase mutation                     | **0回**                                                                                                                                                                            |

**NO-GO継続。** 完成したのは権限境界・監査証拠・障害復旧の**非稼働レビュー素材**だけである。次は、実権限接続前に独立した脅威モデル・承認イベントの署名/provenance・永続CONTROL CASのsource-only設計とその負例を準備し、安全境界を越える際はfresh OWNER承認で停止する。
