# NOVELIGHT 読者報酬 Gate 10 — 状態空間・競合・障害注入／実DB構造read-only監査（Draft）

記録：2026-11-05 JST  
対象：Draft PR #2762 / feature/reader-reward-gate01-20261104  
分類：FULL PREFLIGHT。Gate01〜09を再実装しない。非公開の純粋関数／隔離focused tests／現行Supabaseシステムカタログへの**SELECT限定**監査／レポートだけ。

## 1. 事前確認と境界

- latest main: `03f64b14138ec5c6a90c0d8231a0784f878e78fa`。着手前Draft PR HEAD: `ec8fa638515fb91bb2ef0cd8fc2523671bd4c63e`、behind 0、Draft／unmerged。
- 正式MASTER `docs/NOVELIGHT-MASTER.md`（main blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`、1〜5089行／EOFまでの内容を取得）、AGENTS、Preflight、Automation Continuation Gate、NLOポリシー、development-workflowを確認。保護境界の変更なし。
- OWNER確定事項（1pt＝1円相当、外部交換最低3,000pt、AI利用に3,000pt下限なし、βLv30上限、30日200XPほか）を維持。未決定事項（Lv31〜100／Lv100余剰／読書報酬端数／βPoint換金適格性／AI価格／予算／交換先・手数料・本人確認・税務法務／正式リリース日）を確定しない。
- 実行禁止：migration、DB DML・DDL・RPC、Staging、Production変更、送金、AI実利用、外部提供者呼出し、main merge。

## 2. 実Supabaseカタログの読み取り専用監査（本番データの行は取得しない）

接続先：Supabase `novelrise`（project ref: `fiepaguycecrredwrcwx`）。情報取得方法：`pg_class`、`pg_namespace`、`pg_attribute`、`pg_index`、`pg_constraint`、`pg_policies`、`pg_proc` のカタログSELECT。実利用者の残高・個人情報・Point行は取得せず、データ書込みなし。過去migration `20260920223049_scout_record_beta_core.sql`・`20260921025328_scout_record_usage_controls.sql`・`20260921022608_scout_badge_foundation.sql`とも照合。

| 既存テーブル | 現行実DBで観測された事項 | 制限 |
| --- | --- | --- |
| `public.scout_point_ledger` | RLS有効、`UNIQUE(event_key)`、`reversal_of` FK、整数`point_value`、`confirmed/pending/frozen/cancelled` | `reversal_of`単独uniqueを確認できない。換金予約・wallet CAS・outbox原子性は保証できない |
| `public.scout_point_user_controls` | RLS有効、`earning_suspended_until`、`reason`、PK(`user_id`) | 獲得停止は存在するが消費・換金停止／KYC認可と同義ではない |
| `public.scout_point_operator_actions` | RLS有効、操作監査、PK(`id`) | action enumはfreeze/confirm/cancel/suspend_points/resume_points/adjustで、外部提供者の予約Claim／送信履歴そのものではない |

- 上記3テーブルの`pg_policies`検索は**0件**。RLS有効自体は確認できるが、外部交換APIの利用可否・認可を証明するものではない。既存の`SECURITY DEFINER`関数（管理Point操作／獲得制限／履歴など）のメタデータは存在。実際の権限設計・提供者経路は別途監査必須。
- publicテーブル名を`outbox|redempt|reward|reservation|wallet|budget|idempoten|payout`のパターンで検索。別系統の`scout_reward_campaigns`／`scout_reward_campaign_entries`／`scout_reward_campaign_claims`は発見したが、これはキャンペーン向けテーブルでありSCOUT Point外部交換用のoperation/outbox/budgetを保証しない。この検索条件・公開スキーマの範囲では対応専用テーブルを確認できなかった。別名・別スキーマの存在を完全否定する調査ではない。
- 現行台帳の実行権限、全既存RPC経路、wallet serializability、provider対応、ライブデータの整合性、budget scope、返金時の資金回収は未検証。既存表だけで外部換金を始めてはいけない。

## 3. 新規非公開シミュレーション

追加：`api/_lib/reader-reward/state-space-simulation.js`。

- `exploreScoutReservationInterleavings`：Gate07 `quoteScoutPointOperation` / `recheckScoutPointOperation` とGate08・09の設計quoteを使い、同一財布・予算に対する2操作のbegin/finish順序**6通り**を全探索。仮想の残高・予算・予約・outboxだけをメモリ内で更新。wallet conservation、予約合計、予算上限、outbox一対一、stale revision拒否、外部交換最低金額、AI直接利用を検証。検証用のapprovedフラグは実認可証拠ではない。
- `exploreScoutCrashCutpoints`：操作phase 5種 × outbox状態5種 × 永続reservation/ledger/outboxの3ビット（8通り）＝**200通り**。Gate09既存のCrash Recovery quoteを再利用。部分永続化、未知の送信結果、重複実行危険、確定済みの再実行防止を確認。各パターン`mayInvokeProvider=false`、`mayConnectDb=false`、`mayMovePointsOrMoney=false`。
- `exploreScoutWebhookPermutations`：最大4イベントの到着順列（4件なら24通り）をGate09既存の通知判定で評価。イベントID重複、同一外部transaction IDの再通知、異なる成功transaction ID、成功と確定失敗の矛盾、pending、partialの組合せを区別。単一operationで「成功取引IDが2種類」または「成功と失敗が両方」は**manual hold**をモデル上で追加検出し、自動精算に進めない。矛盾前に出るcommit候補も実処理権限を持たない。
- 新規ロジックは実用サービスに接続しない**bounded model**。探索対象は2操作／最大4通知であり、無制限並列・実DB隔離レベル・外部保証を証明しない。Gate07〜09既存コードに修正なし。

## 4. テスト証拠

追加：`tests/reader-reward-state-space-simulation.test.mjs` — **36 focused cases**。独立した入力値grid（wallet 7通り × budget 6通り × 並行スケジュール6通り）、200 crash状態、4 callback eventsの24順列、wrong-user、duplicate operation、偽造再送、AI／換金競合、予算枯渇等を含む。

- 隔離Node v24: Gate01〜09既存155件 + 新規36件 ＝ **191 PASS / 0 FAIL**。
- Gate10のJS・testをリポジトリPrettier設定で整形／check：PASS。
- Gate10のJS・testにESLint：PASS。
- 最新PR HEADに対するGitHub CI / CodeQLはcommit後に確認する。高リスクMASTERのOWNER head-bound merge approvalが未付与ならmerge-readinessのfailureは意図したFail Closedであり解除しない。

## 5. 4段階の成果・次工程

| レベル | 結果 |
| --- | --- |
| 非公開モデルコード・レポート | Gate10差分として追加 |
| focused tests | 191 PASS / 0 FAIL |
| 実DB原子取引／Staging整合性／提供者冪等性実証 | 未実施（現行Supabase metadataへのread-only SELECTのみ実施） |
| Production状態変更・送金・AI呼出し・main統合 | 未実施・未承認 |

次工程Gate11候補：今回発見した複数provider transaction ID／成功失敗矛盾の、既存Gate09機能との設計上の境界のreviewと、実DB操作Claim・outbox・wallet・budgetの実装条件一覧（承認前の**設計のみ**）。実provider API仕様・法務／KYC・資金予算・AI価格・βPoint適格性はOWNER／提供者確認待ち。migrationやDB書き込みの先取りは禁止。
