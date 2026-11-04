# NOVELIGHT 読者報酬 Gate 12 — 外部提供者の契約要件・最終履行／取消・OWNER依存関係（Draft）

記録日：2026-11-05 JST  
対象：Draft PR #2762 / feature/reader-reward-gate01-20261104  
実行方式：FULL PREFLIGHT、read-only調査および非公開純粋関数・focused tests。**実提供者への問合せ、API呼出し、DB、送金、AI利用は一切実施しない。**

## 1. 最新の正式基準・範囲

- main `03f64b14138ec5c6a90c0d8231a0784f878e78fa`、Gate12着手前のDraft PR HEAD `eef418435eb5d016d8c88898ce8d868e6c77d6d8`。behind 0、Draft維持、main未統合。
- 正本 `docs/NOVELIGHT-MASTER.md`（main上blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`、1〜5089行）／`AGENTS.md`／`docs/WORK-EXECUTION-PREFLIGHT.md`／`docs/AUTOMATION-CONTINUATION-GATE.md`／`docs/NLO-EXECUTION-POLICY.md`／`docs/development-workflow.md`を確認。
- Gate01〜11の既存コード・テスト・レポートは再実装せず、今回の追加3ファイルのみを変更。既存のSCOUT XP、βLv30、Scout Pointを変更しない。
- OWNER確定：1 SCOUT Point＝1円相当、外部交換最低3,000pt、AI直接利用時には3,000pt下限なし、事前AI Credit交換なし。現行ポイントを自由に換金可能と解釈しない。
- **外部交換先やAI提供者の社名、契約条項、技術的API仕様は現時点で未選定・未提供**。したがって本報告はサービス固有の確約・KYC義務・法律解釈・本番利用可否の判定ではなく、OWNER／提供者に確認すべき**vendor-neutralな事前要件整理**。

## 2. 提供者契約：共通20項目＋チャネル別9項目

新規非公開コード：`api/_lib/reader-reward/provider-contract-readiness.js`。

`assessScoutProviderContract` は提供者未選定のまま対象チャネル別の確認票を返す。**外部交換29項目／AI直接利用29項目**、両チャネル共通は20項目。

| 要件区分 | 署名済み契約／提供者資料と独立した検証で確認すべきこと |
| --- | --- |
| 冪等性 | キーの一意性スコープと保持期間、同キー同payload再送の結果、同キー異payloadの拒否、保持期間と最大障害復旧期間の関係 |
| 状態照会 | operation/idempotency keyからの認証済みread-only状態照会、結果の鮮度・一貫性・障害／遅延時の取扱い |
| 最終履行（finality） | accepted/processingと最終成功・最終失敗の定義、取引IDと証跡、後日の取消・返金・clawback可能性、期限・補償 |
| 通知／事故 | Webhookの署名・再送・重複・順序逆転・期限切れ・partial・timeout・紛争・監査保存 |
| 取消／回復 | 未送信／受付済み／実履行後での取消ルール、取消リクエストを「取消完了」と誤解しない、独立照会と外部資金回収の証拠 |
| 外部交換固有 | 交換商品と通貨、手数料、3,000pt下限（提供者非対応ならNOVELIGHT serverで厳格執行）、発行／配布／再送証跡、資金確保、適用される本人確認・税務・地域制限 |
| AI固有 | モデル別Point価格／原価／変更通知、料金確定・実消費量、生成中断・ストリーム部分結果・失敗時の課金／再実行、重複リクエストと二重生成の区別、データ利用／保存・プライバシー |

判定値は`unknown`／`provider_claimed`／`written_contract_reviewed`／`isolated_test_observed`。いずれも**呼出し側が提供した未認証メタデータ**であり、フラグが全て埋まっても`liveProviderVerified=false`、実行権限なし。提供者を勝手に決めず、出所のない能力を「有り」と評価しない。正式導入には署名済み契約、価格・決済条項、提供者側の技術裏付けと実環境証拠が別途必要。

## 3. 提供者の最終履行・取消・再照会

`quoteScoutProviderFinalityBoundary` はGate11の履歴集約／矛盾通知の設計を前提とした、提供者の最終性境界の非実行評価を追加する。

- 状態例：`unknown`、`pending`、`provisional_success`、`final_success`、`cancel_requested`、`final_cancelled`、`final_failed`、`partial`、`reversed_after_success`。
- タイムアウト・受付のみ・仮成功・取消申請中はhold。「リクエスト成功」は「最終履行／資金移動の確定」と異なる。
- 異なる外部transaction ID、成功・確定失敗の食い違い、遅延通知、partial／後日取消・clawbackはmanual hold。
- 仮想テストで最終成功＋独立履行証拠が整う場合でも`commit_evidence_candidate_only`。最終取消／失敗＋独立未履行証拠がそろう場合でも`release_evidence_candidate_only`。すでにcommitted・released・refundedなら再精算なし。
- Finalityやidempotency保持期間は提供者の**実契約・実照会**で証明されるまで不明。チェック値`true`は本番証拠ではない。返金時の外部資金回収／AI生成済みの補償条件は未決定のため自動返還しない。
- どの結果も`mayConnectDb=false`／`mayInvokeProvider=false`／`mayTransferValue=false`／`mayRunAI=false`／`maySettle=false`。

## 4. OWNER未決定事項と永続資源の依存関係

`mapScoutRewardDependencies`：OWNER判断を管理上9分類、永続技術資源を9分類に分けて外部交換とAI直接利用の阻害条件を区別。

| 分類 | 未確定・未実証の対象 | 直接影響 |
| --- | --- | --- |
| OWNER①② | Lv31〜100必要XP、Lv100余剰XP | 正式版のScout進行仕様。**既存残高の直接利用とは独立した論点** |
| OWNER③④ | 端数0.1円の精算、β蓄積Pointの消費・換金適格性 | 両チャネルの残高解釈／財務整合 |
| OWNER⑤ | AI機能別価格／Point必要量 | AI直接利用のみ |
| OWNER⑥ | 発行原資と消費予算／上限／期間 | 両チャネル |
| OWNER⑦⑧ | 交換先・商品・手数料、本人確認・法務・税務・地域別適用 | 外部交換の公開判断 |
| OWNER⑨ | 正式リリース日・β→正式切替範囲 | 両チャネル／公開計画 |
| 技術資源 | 台帳適格性、共有Wallet CAS、分離予算CAS、一意Claim、一意かつ変更不能Outbox、通知Journal、全書込の原子commit、Privileged RPC/RLSと既存経路の監査、提供者照合／無制限再試行防止 | **実DBのライブ証明待ち。既存LedgerのUNIQUE(event_key)だけでは不十分** |

OWNER判断と提供者の文書・隔離テストが全て入力上「済」であっても、**実DBの原子的動作、Stagingの実利用、main／Production承認は自動的には得られない**。コードは常に`safeForLiveExecution=false`を返す。

導入の依存順序（未承認のまま進めない）：OWNER仕様と予算・法務 → 提供者選定と署名済み契約／再照会／finality検証 → 正規のWallet/Claim/Budget/Outbox設計 → 別途承認されたmigrationとRLS監査 → Staging／提供者実証 → 別途本番承認、という概念設計。実行許可を示すものではない。

## 5. 品質と未実施事項

追加テスト：`tests/reader-reward-provider-contract-readiness.test.mjs`、**41件**。共通／個別要件、同一冪等キーと再送契約、プロバイダー自称だけでの未証明、キャンセル申請／確定の峻別、後日取消、partial、ID衝突・署名／鮮度／資金照会、OWNER9分類・資源9分類、決定済みフラグの過信防止を検証。

- 隔離Node24：Gate01〜11の229件＋Gate12の41件＝**270 PASS／0 FAIL**。
- Gate12 JS/MJS：repo設定のPrettier check、ESLint、Node syntax check PASS。
- GitHub CI／CodeQLのHEAD確定結果はPR反映後に別途確認。OWNERの高リスクPR main統合承認がない場合のMerge readiness failureは意図したFail Closedとして維持。

| 段階 | 状態 |
| --- | --- |
| 非公開要件整理・純粋関数・focused tests | 実装 |
| 実提供者の契約／技術テスト | **未実施（提供者未選定）** |
| DB原子性・Staging実環境証明 | **未実施** |
| Production・実送金・AI呼出し・main統合 | **未実施・未承認** |

**禁止範囲厳守：** DB migration／実DB書込み・読出し／Staging／Production mutation／実送金／実AI実行／main統合なし。既存β SCOUT RECORD・Point付与／残高は不変更。
