# NOVELIGHT 読者報酬 Gate 13 — 提供者選定基準／OWNER判断優先順位／承認前read-only照合（Draft）

記録日：2026-11-05 JST  
対象：Draft PR #2762 / feature/reader-reward-gate01-20261104  
実行範囲：FULL PREFLIGHT。既存Gate01〜12は再実装・変更せず、非公開の純粋関数・focused tests・本レポートのみを追加。

## 1. 正式基準・状態・禁止境界

- 最新main：`03f64b14138ec5c6a90c0d8231a0784f878e78fa`。着手前Draft PR HEAD：`57a7bf88c8ba91b57a9f012d1559878f0a874a82`。mainに対するbehind 0、PR未統合。
- 正式MASTER：`docs/NOVELIGHT-MASTER.md`、main blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`、1〜5089行を確認。AGENTS、WORK-EXECUTION-PREFLIGHT、AUTOMATION-CONTINUATION-GATE、NLO-EXECUTION-POLICY、development-workflowも確認。
- OWNER確定済みの1 SCOUT Point＝1円相当、外部交換最低3,000pt、AI直接利用は3,000pt最低条件なし・AI Creditへ先行変換しない、βLv.30上限継続等を変更しない。
- 交換先・AI提供者・AI価格・予算・本人確認／法務の最終条件はOWNER未決定。候補提供者の実契約・実API・法令適合を今回検証済みとは表示しない。実事業者の選定は行わない。
- **変更禁止：** migration／DB読み書き・RPC／Staging／Production／実送金／実AI／main merge／安全ゲートの改変。

## 2. 新規非公開コード

`api/_lib/reader-reward/provider-selection-review.js` を追加。Gate12 `provider-contract-readiness.js` の要件票・OWNER依存モデルを**読み取り・再利用**する。Gate01〜12の既存コードは変更しない。

### A. compareScoutProviderCriteria

- チャネルを`external_exchange`／`ai_direct_use`に分け、Gate12確定の**共通20＋各チャネル固有9＝各29項目**を参照。最大12の架空候補を比較可能。
- 必須確認項目には提供者IDと法的主体、認証・権限、同一冪等キーの保持期限／再試行／異payload拒否、read-only状態照会、finality／事後取消、取引ID一意、Webhook認証／リプレイ、通信タイムアウト／partial、補償・回収手順等を含める。
- 事業者自称（`provider_claimed`）を独立証明とは扱わない。文書レビュー／隔離テストを入力上すべて満たしても、署名済み契約・現実の支払／AIサービス安全性は未実証。`eligibleForSelection=false`、`providerChosen=null`、`score=null`、`recommendation=null`を維持。
- 同一候補ID重複、提供者別要件を誤って流用する入力、同一要件に矛盾する主張、必須証拠欠落を検出。価格だけで危険な事業者が上位に来る数値スコアを**作らない**。

### B. prioritizeScoutOwnerDecisionQueue — 助言上の4段階

これはOWNER確定仕様ではなく、制度開始の法的・財務的リスクを先に解決するための**提案順位**。9分類の意思決定を自動変更しない。

| 優先段階 | OWNER未決定事項 | 提案理由 |
| --- | --- | --- |
| 1：価値・法務・財務の安全境界 | βで獲得済みPointの消費／換金適格性、発行原資・利用予算／対象期間、端数精算ルール、本人確認・法務・税務 | 後から変更すると利用者期待・債務・予算を崩す可能性がある |
| 2：提供者と商品／AI価格 | 外部交換先・商品・手数料、AI機能別消費Point | 段階1の条件に整合する候補・採算を選ぶ。交換とAIを別々に審査する |
| 3：正式SCOUT進行 | Lv31〜100の必要XP、Lv100余剰XP | ポイントの直接消費とは別仕様だが正式公開には必要 |
| 4：公開・移行 | 正式リリース日とβ→正式版への切替範囲 | 提供者契約・技術検証・法務・OWNER独立承認を確認してから決める |

- 各判断に依存する前提の未完了を出力。`approved`をテスト入力しただけで本人の意思決定とはみなさない。正式公開の条件を時間だけで解除しない。
- 法務検討自体は候補選定前から始められる一方、提供者個別の契約／規制適合は選定後に改めて審査する必要がある。段階は厳密な行政手順ではなく作業順の助言。

### C. compareScoutPreapprovalRequirements

- Gate12のOWNER・永続DB資源の依存モデルと、候補契約の証拠欠落を同一のread-only確認票に統合。
- 4分類：OWNER利用条件、提供者契約、共有Wallet・Budget・Claim・Outbox等の実DB原子性、独立の法務・安全・Staging・本番承認。
- 契約資料・OWNER承認・DB証拠がすべて**テスト入力上は合格**でも、`independentEvidenceEstablished=false`、`viableProviderSelected=null`、`maySelectProvider=false`、`mayConnectDb=false`、`mayInvokeProvider=false`、`mayTransferValue=false`、`mayRunAI=false`、`maySettle=false`、`mayPublish=false`。本番利用許可にならない。

## 3. focused tests・品質

追加：`tests/reader-reward-provider-selection-review.test.mjs`、**32件**。提供者未選定・チャネル別29項目・14の共通重要確認項目、自己申告と独立証拠の分離、重複候補・虚偽主張の扱い、決定9分類／4段階の優先順位、XP仕様と直接Point利用の切分、全条件仮設定でも本番禁止、read-onlyデータの不変性を検証。

- 隔離Node v24：既存Gate01〜12 **270件**＋Gate13 **32件**＝**302 PASS／0 FAIL**。
- 新規JS/MJS：リポジトリPrettier設定のwrite/check、ESLint 10.8.1、Node --checkいずれもPASS。
- GitHub CI・CodeQLは本Gate13 HEADをPRへ登録してから最終確認。既存の高リスクMASTER変更を含むPRのmain統合は、OWNERのhead-bound承認なしでは意図したFail Closedを維持。

## 4. 未解決と次の実務判断

- 現実の交換業者／AI提供者の契約実体、冪等キー保持期間、status照会API、最終履行と事後取消、法的なPoint交換の性質、KYC／税務の適用、AIの従量原価は未調査・未選定のまま。
- Gate10の実DB read-only観測（`scout_point_ledger`のUNIQUE(event_key)／RLS）は、Claim／Wallet／Budget／Outboxの実DB原子性を証明しない。今回はSupabaseを含む実DBへのアクセスも行っていない。
- 現在必要なのは、Gateを増やすだけでなく、**OWNERの意思決定と実提供者から取得する契約資料の確保**。その後、未承認のmigrationやStagingを先取りせず、独立承認と実証計画に進む。

| 実証段階 | Gate13結果 |
| --- | --- |
| 非公開の純粋関数・確認票 | 実装 |
| focused自動テスト | 302 PASS／0 FAIL |
| 提供者契約・実DB原子性・Staging | 未実証 |
| Production・送金・AI・main統合 | 未実施・未承認 |
