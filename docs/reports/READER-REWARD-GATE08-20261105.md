# NOVELIGHT 読者報酬 Gate 08 — 原子的取引の接続前設計・競合・障害復旧（Draft）

記録日：2026-11-05 JST
対象：Draft PR #2762 / feature/reader-reward-gate01-20261104
安全区分：FULL PREFLIGHT。非公開の純粋関数・focused tests・レポート・既存lint不具合の修正のみ。

## 1. 前提・既存成果

Gate 01〜07は再実装しない。既存focused Node 108件PASSを隔離環境で再現。OWNER確定事項（1 Scout Point＝1円相当、外部交換最低3,000pt、AI直接利用、βLv.30上限、30日200XP等）を変更しない。未決定9項目、特にβ既存Pointの換金適格性、端数精算、Lv31〜100、Lv100余剰、AI価格、予算、交換先・法務、リリース日を保留。

## 2. GitHub main既存migrationの読み取り専用監査

確認対象：supabase/migrations/20260920223049_scout_record_beta_core.sql、20260921025328_scout_record_usage_controls.sql、20260921022608_scout_badge_foundation.sql。履歴DDLの確認であり現在の実DBのスキーマ証明ではない。

- scout_point_ledger：整数point_value、status（confirmed/pending/frozen/cancelled）、UNIQUE(event_key)、reversal_of、metadata、RLSが存在する既存DDL。イベント冪等性と逆仕訳の再利用候補。reversal_ofの一回性は確認したDDLでは一意制約を検証できない。
- scout_point_user_controls：RLSおよびearning_suspended_untilは存在するが、これはPoint獲得停止であり換金・AI利用停止の証拠ではない。
- scout_point_operator_actions：RLS付き監査テーブルは再利用候補。予約Claim・提供者通知・外部履行状態は同テーブルだけでは証明できない。
- 未実証：実台帳の全件照合、本人確認と利用停止、旧βPoint適格性、同一ウォレットロック/CAS、同一予算スコープのロック/CAS、永続操作Claimとrevision、逆仕訳の一度限り制約、監査・outboxと状態更新の一括トランザクション、旧β自動付与との競合遮断。これらをmigration未作成のまま実装済みと扱わない。

## 3. 新規非公開コード

api/_lib/reader-reward/atomic-connection-plan.js を追加（純粋関数、DB接続なし）。

- auditScoutPointConnectionSurface：既存台帳・制限・管理監査の列/RLS/ユニークキーの再利用を部分監査し、原子的な未実証項目をblockerとして列挙。どんな入力でもmayConnectDb=false。
- quoteScoutPointAtomicConnection：Gate07 proposal/recheckと、認可・台帳・予算・一意性・競合対策の設計条件を確認。共通ウォレット→予算→操作Claimという固定ロック順、イベントキーの段階別一意化、同一トランザクションでの残高・予算・操作・台帳・audit・outbox書込、外部呼び出しをcommit後に限定する接続前手順を返す。recheck成功だけでDB保証とは呼ばない。
- quoteScoutPointRecovery：タイムアウト・通信切断・不明/保留/部分履行・二重通知時は再送せず、確定までholdまたは照合を要求。独立した履行証拠があるときのみcommit候補、非履行証拠があるときのみrelease候補、取消と外部資金回収の証拠があるときのみrefund候補。すべて実行不可の候補値。

同時換金とAI利用は同じwallet lockとrevisionに直列化する必要がある。外部業者への送金やAI呼出しはDBトランザクションの外で、安定したprovider idempotency key、durable outbox、重複通知キーと処理結果を照合する。通信タイムアウトは未履行の証明にならない。予約取引と最終精算取引は別の原子的DB transactionを想定し、実スキーマは確定・実装しない。

## 4. 新規テスト・失敗CIの原因

tests/reader-reward-atomic-connection-plan.test.mjs に18件追加。既存DDL構造、RLS/unique欠落、reserve/commit/release/refund、競合CAS、予算/本人確認未承認時Fail Closed、timeout、二重通知、部分履行、資金回収不足を検証。

- 隔離Node v24：既存108件＋新規18件＝126 PASS／0 FAIL。
- 引継ぎHEAD 7448a3bc7fe4b00641c76fc5bd7cd9a84c2082fc：CI Node tests success、CodeQL success、Static quality failure。
- 原因はpoint-settlement.jsの未使用SCOUT_POINT_YEN_VALUE import。該当importのみ削除して挙動は維持。
- Merge readiness failureはdocs/NOVELIGHT-MASTER.md差分に対するHEAD紐づけOWNER本番承認が未提出であるための意図したFail Closed。解除禁止。
- 新HEADのGitHub CI／CodeQLとPrettier/ESLintはPR更新後に別途確認する。確認できない項目は未確認として報告する。

## 5. 未解決課題と次の工程

OWNER未決定9項目は未採用。現行DBの実際のRLS、live UNIQUE、逆仕訳1回性、全書込経路、永続予約・wallet/budget state／revision CAS、outbox、提供者側冪等契約は未検証。Gate09は非公開の外部提供者冪等性・outbox・二重通知の障害復旧シミュレーションが推奨。

| 検証区分 | 結果 |
| --- | --- |
| Draftコード | 接続前設計のみ |
| focused tests | 126 PASS / 0 FAIL |
| Staging実DB検証 | 未実施 |
| Production／交換／AI実行 | 未実施 |
| main統合／正式公開 | 未実施・未承認 |

DB migrationの作成・適用、DBへの読み書き、Staging接続、Production、Stripe、外部換金、AI実行、PR統合、正式公開はいずれも行わない。既存β SCOUT RECORD／Point運用を変更しない。
