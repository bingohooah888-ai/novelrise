# NOVELIGHT 読者収益化 — 残る主要機能のオフライン統合（2026-11-15）

## 根拠と承認境界

- 基準main：`679a5bcfa98529ae32088a2d693e5ff8d41d7a2c`（工程①〜⑧統合済み）。
- 正式正本：`docs/NOVELIGHT-MASTER.md`。不足監査：`docs/reports/READER-REWARD-PHASE08-OFFLINE-RELEASE-AUDIT-20261115.md`。
- 出典：既存Draft PR #2762 HEAD `0340f35b52d0b4758cf89985264fb30abc19270b` の既存blobをそのまま再利用。PR #2762の第50章はDraftであり、正本の第49章と整合する正式変更は今回**無断で行わない**。
- 本PRはオフライン内部ライブラリ20、オフラインテスト23、既存fixture/SQL資料7、監査レポート1の計51ファイル。公開API・Cron・Workflow・環境変数・Secrets・`supabase/migrations` は変更しない。

## 主要機能ごとの補完

| 範囲 | 再利用する主要コード | オフライン到達点／未実証事項 |
| --- | --- | --- |
| 有効読書・コメント報酬発行 | `formal-comment-eligibility`, `formal-admin-comment-review`, `formal-earning-source-reader`, `formal-earning-server-connection`, `formal-private-postgres-adapter`, `formal-earning-delivery`, `formal-earning-durable`, `formal-earning-runner` | 正規イベント証拠、適格性判定、イベント一意性、durable claim・retry/rollback、内部実行器factoryを既存コードで統合。**本番の発行worker起動や実台帳への付与ではない** |
| 既存読者の引継ぎ・新規登録 | `formal-new-reader-onboarding`, `formal-opening-sync`, `formal-maintenance-runner`, `formal-application-host`, `formal-api-dispatch` | 初期化の重複防止、既存reader Point/Level照合、30日降格、内部認証付きHTTP構成の候補を追加。公開ルート/registration trigger/Cronは未登録 |
| βPoint10倍・正式Level移行 | `beta-point-tenfold-plan`, `formal-cutover-offline`, `point-tenfold-writer-cutover-contract`, `point10x-atomic-staging-simulation` | 10倍の換算quote、旧writer/RPC停止、保存/復旧順序と障害時の合成試験。**SQLやmigrationは実行しない** |
| 既存Point台帳・交換の整合 | `formal-offline-integration`, `durable-reconciliation-contract` | 工程⑤〜⑧の既存Wallet・予約/確定/返還・正規台帳と、複数のreceipt／勘定の照合を模擬入力で行う |
| 障害復旧 | `state-space-simulation`, `durable-reconciliation-contract`, `point10x-atomic-staging-simulation` | 同時操作、重複通知、クラッシュ時点、部分履行、rollback-only等の副作用のないモデル検証。実Provider・実DBの復旧証拠にはならない |

## Draft SQL・テスト用資料の取り扱い

- `docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql`・`SCOUT_FORMAL_LEVEL_STATE_DRAFT.sql`・`SCOUT_FORMAL_XP_CUTOVER_DRAFT.sql` は**非稼働の設計資料**であり、migrationには一切移動・登録しない。
- `docs/plans/SCOUT-FORMAL-EARNINGS-4TABLE-STAGING-APPLY-20261111.sql`・`SCOUT-FORMAL-EARNINGS-FUNCTIONS-PENDING-20261111.sql`・`SCOUT-FORMAL-EARNINGS-TRIGGERS-PENDING-20261111.sql`は既存の**オフライン契約テストの入力資料**として保管する。ファイル名にSTAGINGとあってもStagingに実行・適用しない。資料の取り込みは適用承認や設計完了の証明ではない。
- `tests/fixtures/reader-reward-levelup-trigger-legacy.sql` は旧writerの照合用fixtureである。

## 数値・OWNER決定（変更禁止）

10 Scout Point = 1円、外部交換の最低申請30,000 Point。βPointは価値を維持して10倍継承（外部ギフト非適格、AI直接利用ではβ由来分を先に消費）。読書はLevelにより1〜11 Point/話、適格話数コメントは20 Point/件・月50件。Lv.30→100は各400XP、30日間に新規確定200XP未満なら1Level降格、Lv.70以上到達者の下限Lv.50。AI Creditへの中間交換や旧3,000 Point下限は導入しない。正式MASTER更新は別途OWNER判断が必要。

## 公開判定と残る阻害事項

**公開不可**。今回の結果は非公開の実装コードと模擬・静的検証であり、実環境検証の完了ではない。

1. OWNERによる正式MASTERの仕様整合、AI対象機能・実際のPoint価格、ギフトProvider/契約、本人確認・手数料・法務・税務・予算方針の確定。
2. 正式報酬の実行host/登録・サーバー側本人認証、旧Writer/RPC/triggerの停止・βPoint10倍・称号閾値・XP/Level state・private Walletとの一括整合のStaging実証。
3. 実JWT・既存有効読書/コメントDBソース・PostgreSQL行ロック/RLS/ACL・重複防止・逆仕訳・rollbackの隔離検証、事故時の停止・復旧手順の独立証拠。
4. 外部ギフト/AI Providerの実契約・署名検証、部分履行/支払結果不明/返還の安全な実証。
5. 正式公開の別途明示承認。今回のPRをmainに統合しても自動公開してはならない。

**禁止**：main統合、Preview生成、Staging/Production DB操作・migration適用、Secrets/環境変数、Workflow手動実行、実Point付与・消費、外部ギフト発行・支払、private Wallet有効化、一般公開。
