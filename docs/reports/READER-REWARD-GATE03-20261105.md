# NOVELIGHT 読者報酬 Gate 03 — レベル状態／XP台帳の整合と二重確定防止（Draft・非公開）

更新日：2026-11-05 JST
対象：Draft PR #2762、`feature/reader-reward-gate01-20261104`
作業区分：非公開の純粋関数・単体テスト・実装準備設計。**実DB変更／Staging／Production／Cron／決済／公開設定は未実施。**

## 1. OWNER確定仕様を変更しない

- 正式版Scout Level上限100、β版上限30は維持。
- 30日間の確定獲得Scout XPが200以上なら維持、200未満なら**1レベルのみ**降格。
- 過去にLv.70以上へ到達した場合の降格下限はLv.50。
- 既存登録者の初回判定は正式リリースから30日後、新規登録者は登録から30日後。以後30日間隔。
- 降格した場合、下がったLevelの次Level向けXPゲージを0から貯め直す。維持なら進捗を保持。
- **生涯総獲得XPという独立カウンターは作らない。** 不正対策・30日判定・取消監査に必要な既存 `scout_xp_ledger` イベント台帳を維持。
- 読書・コメント・発掘・LIGHT SEEDなどのXP配点、Lv.1〜100読書報酬単価、その他Gate01/02で確定した仕様は変更しない。

## 2. Gate 03追加コードとGate 02の最小補強

### `api/_lib/reader-reward/state-transition.js`（新規、純粋関数）

1. `validateScoutLevelStateSnapshot`
   - server側で将来取得すべきStateの候補項目：`userId`, `currentLevel`, `highestLevel`, `levelProgressXp`, `reviewAnchorMs`, `lastReviewedWindowEndMs`, `revision`。
   - 現在Levelと最高Levelの範囲、過去最高以上の現在Levelの禁止、Lv.70達成後のLv.50下限、30日区間と一致しないreview checkpoint、範囲外のXPやversionを拒否。
   - 保存候補に生涯総獲得XPを含めない。ユーザー入力を検証済みDB stateとみなすものではない。
2. `quoteScoutReviewStateTransition`
   - Gate02の完了した特定30日区間のDry-Run結果を、同一ユーザー・起点・判定順・review key・現Level・現XP進捗・過去最高Levelと再照合。
   - 199XP以下なら最大1Lv降格、必要時に進捗を0へ、200XP以上なら維持し進捗も維持。履歴・最高到達Lvを変更しない。
   - checkpointがすでに処理済み、連続していない、見積もり元状態が変わった場合は**状態遷移案を返さない**。
   - 出力は`status: proposal_only`と不変のexpectedState/nextStateのみ。**DB更新コマンドではない。**
3. `recheckScoutReviewProposal`
   - 仮想的に同じレビューを2ワーカーが準備した場合を想定し、review key既処理、checkpoint進行、状態revision/値の差異を判定。
   - `preconditions_match_only`は「画面外の試算時点で一致」を意味し、「永続化成功」「本番適用許可」「原子的更新成功」ではない。

### Gate 02の既存コード補強

`api/_lib/reader-reward/maintenance-review.js`のDry-Run候補に
`quotedFromLevel`、`quotedFromHighestLevel`、`quotedFromLevelProgressXp`を追加。

理由：降格では返却先XPが0になるため、**元のXPゲージが変化しても結果だけでは古い見積もりを区別できない**。Gate03のテストで発見した不整合を修正した。Gate02の200XP/30日などのルールや、実行経路・権限・データ保存先は変更しない。

## 3. DB導入時の排他・確定設計（提案、現時点では未実装）

### 最小状態レコード候補

`scout_level_state`相当を**既存スキーマ調査後に設計**。必要な情報は、`user_id`、現在Level、次Level向け進捗XP、最高到達Level、初回30日判定起点、最後に確定した判定区間の終了日時、単調増加する状態revision等。既存に同等のStateがあれば再利用し、独立した生涯総XPカウンターを追加しない。

### 30日判定確定レコード候補

`user_id + window_end`にDB上の**一意制約**を持つ確定記録を検討。review key、window start/end、採用したルール版、承認されたXP根拠の範囲、更新前後のレベル・XP進捗とstate revision、確定結果を監査できる形を要件とする。名前やカラムは提案であり、現時点でmigration作成はしない。

### 原子的な確定の必須条件

実際の実装時には、単一DBトランザクション内で以下を整合して実施する。

1. 対象ユーザーのStateを取得・ロックし、正当な判定起点・次の未処理30日区間・状態revisionを確認。
2. 同じスナップショットの`scout_xp_ledger`から対象ユーザー・期間の**全件**を取得。読み取り漏れ、遅延XP付与、取消、同時XP付与、全件取得境界の扱いを確定・検証する。
3. 同一期間の確定レコードは`(user_id, window_end)`のユニーク制約で重複を防ぐ。既存確定済みなら再降格せず既存結果を返す。
4. Stateの`revision`、現在Level・進捗・最高到達Level・前回checkpointを再検証し、予定の変化を**条件付きで一度だけ**適用し、確定記録も同じトランザクションで保存する。
5. 競合、データ不完全、符号付き訂正の帰属未決定等はCommitせず保留。誤った200XP未達判定による降格を防止。

**重要な限界**：review keyの文字列や本Gate03の純粋関数だけでは実DBの同時実行保証は成立しない。今後、XP付与の書き込み経路もState rowのロック／revisionと同期するか、同等の一貫したスナップショット・フェンス機構を用いる必要がある。XP付与側とReview側のトランザクション境界・ロック順を実装前に共同で監査する。

## 4. focused test結果

新規：`tests/reader-reward-state-transition.test.mjs` 14件。

- ユーザー・Level・XPゲージ・最高到達Level・review anchor・checkpoint・revisionのState整合
- 199XP降格と進捗0、200XP維持と進捗保持、Lv.50保護
- 2ワーカー同一reviewのDry-Run、checkpoint重複・先飛ばしの拒否
- 同時レベルアップ・進捗変更・最高到達更新時に旧案を拒否
- 別ユーザー、別期間、改変されたreview key、改変された算定結果を拒否
- XP訂正と全件根拠不足の保留
- **1回目のテストで見つかった「降格結果が0のため旧進捗が見分けられない」欠陥を修正し再検証**

結果：Gate01 21件＋Gate02 12件＋Gate03 14件＝**47件PASS／0件FAIL**。Windows隔離一時ディレクトリでNode `--test` を実行。新規JS/MJSはPrettier整形済み。

## 5. 作業境界と残る判断事項

- Gate03は**純粋関数による実装候補・テスト・設計書まで**。DB schema追加・migration作成・本番API接続・公開や金銭発行は行っていない。
- 本PRにはmain用正式MASTERの第50章草案が存在するが、OWNERの対象別`本番承認`がなければ統合しない。
- Stage／Production live proofは未実施。GitHub CI / CodeQLはHEADの実行結果を別途確認する。
- 将来の実DB導入前に、既存state実装との重複有無、正確なLv.31〜100の必要XP閾値、XP付与と降格判定の同時ロック、遅延・不正訂正時の帰属、監査・rollback、報酬予算・法務・交換条件を確認する。
- **ユーザーの追加決定なしに未決定の閾値・課金・換金条件を埋めない。**
