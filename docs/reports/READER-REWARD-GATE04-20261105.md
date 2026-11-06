# NOVELIGHT 読者報酬 Gate 04 — レベルアップ・降格のXP状態遷移連携（非公開Draft）

作成：2026-11-05 JST
対象PR：#2762（`feature/reader-reward-gate01-20261104`）
適用境界：**Draft PR内の純粋関数・テスト・設計書のみ**。main／正式MASTER／Production／Staging／Supabase DB／Stripe／Cron／公開Feature Flag／既存AIブランチは変更しない。

## 1. OWNER確定仕様の維持

- SCOUT正式Lv.100上限。β版Lv.30上限と既存の読書・コメント・発掘・LIGHT SEED XP付与規則は変更しない。
- 30日間の確定獲得XPが200以上なら維持、199以下なら最大1レベル降格。
- Lv.70以上に到達したユーザーの降格下限Lv.50を維持。
- 既存ユーザーの初回判定は正式リリースから30日後、新規登録者は登録から30日後。以降30日ずつ。
- 降格した場合は下がったレベルから、次レベルまでのXP進捗0で貯め直す。
- 正式状態は現在Level、次Level進捗XP、過去最高Level、30日判定起点／checkpoint、単調revision。独立した生涯総獲得XPカウンターを追加しない。
- 確定済み読書・コメント報酬単価、金銭台帳の未公開境界を変更しない。

## 2. 追加コード／テスト

### `api/_lib/reader-reward/xp-progression.js`（新規）

純粋関数 `quoteScoutXpLevelUp` は、既存SCOUT XP台帳と同じ`userId`・`sourceEventId`・`xpKind`・`earnedXp`を受け、サーバー確認済みであるべき状態と**外部から承認済みとして渡される必要XP閾値**を基に、現在Level/ゲージ/最高到達Lvの遷移を**計画するだけ**。発行や保存は実施しない。

- XP獲得により同時に複数Levelへ上がるケース、および必要XPを差し引いた余剰ゲージの計算を試算。
- 実際のレベルアップに使用したXPも既存`scout_xp_ledger`履歴に残るため、同じ30日区間の**維持ノルマ200XPへ引き続き算入する**。新しい生涯総XPカウンターは作らない。
- `requiredXpByLevel`の必要XP閾値が未提示・未承認・途中欠落の場合、任意の数字を補わず`thresholds_not_confirmed`/`threshold_missing`として**候補変更を出さない**。テストの必要XP表は**架空のテスト入力であり正式価格・正式Lv閾値ではない**。
- あるLevelに必要なXPと正確に一致して昇格し、進捗0となった場合、次Levelの未確定閾値を勝手に埋め込まず停止できる。
- Lv.100到達時に余剰XPが出る場合、または既にLv.100である場合、余剰XPの取扱い未決定につき`level_cap_policy_pending`で保留。Lv.100へのちょうどの昇格は試算できる。
- 未認証・不完全なXP証拠、既処理ソース、別ユーザー、符号・形式不正、β期間前の正式版処理、30日判定が未処理のまま次期間へ入るイベント、確定済み判定期間への遅延XPを保留／拒否。
- XP源は既存DB`(user_id, source_event_id, xp_kind)`ユニーク契約を尊重。独立な`grantKey`の文字列生成は実DBの冪等化を保証するものではない。

純粋関数 `recheckScoutXpLevelUp` は、同じ状態revision・checkpoint・XPゲージ・最高到達レベルが維持され、XP源がまだ処理済みでないことを**確定前に再検証するための試算**。`preconditions_match_only`はDB原子的Commitや許可を意味しない。

### `tests/reader-reward-xp-progression.test.mjs`（新規）

19件の新規focused testを追加。複数Lv昇格、余剰ゲージ、同一XPソース重複、2ワーカー同時判定、古い状態版／checkpoint、未承認閾値、Lv.100境界、200XP維持との連携、先に降格してから次期XPを獲得する流れ、Lv.50保護、遅延XPの保留、XP種別の既存DB制約を確認。

**Gate 01〜04 focused Node：66件PASS／0件FAIL**。Windows上の隔離一時ディレクトリで`node --test`を実行。新規JS/MJSはPrettier整形済み。

### 失敗からの修正

初回試験では、Gate04に追加したUUID正規表現が実際のUUIDの区切りを正しく受け付けない不具合を検出・修正し、再試験で全件PASS。追加で「すでに判定確定した30日区間へ遅延到着したXPを新しいゲージへ混ぜない」チェックを設計・テストし、同時に`xp_kind`検証を既存DBの長さ制約に合わせた。

## 3. ゲートを跨ぐ状態整合

Gate 01：200XPノルマ・最大1Lv降格・必要時ゲージ0。

Gate 02：一人×正確な30日区間の獲得XP台帳を集計し、遅延・取消・不完全な証拠は保留。

Gate 03：Level状態のバージョン／checkpointを検査し、同じ期間・同じ状態への二重降格を防ぐ**設計**。

Gate 04：上記同じState revision上で、XP付与に伴うレベルアップの遷移案を作成。**レベルアップでrevisionが進めば古い降格案は失効し、降格でrevisionが進めば古いレベルアップ案は失効する**。XPを消費した進捗ゲージの値と30日間のXP獲得記録は異なる指標なので混同しない。

## 4. 導入前に残る承認・設計ゲート

1. Lv.31〜100の正式必要XP曲線とLv.100到達後の余剰XP取り扱い。必要XPはユーザー承認なしに確定しない。
2. 既存正式DBのScoutレベルState保存先、XP付与ルート、`scout_xp_ledger`のユニーク記録と現在レベル進捗更新の整合性・トランザクションを監査。
3. XP付与と降格判定の共通State行ロック／revision-CAS、同一ソースの永続処理済みチェック、判定済み区間の唯一のcommit、遅延・取消・期限跨ぎのルールを決定。実DB上の並行処理保証は未実装。
4. 読書報酬の予算、月上限、残高発行、換金・法務税務、Staging live proof・本番統合・正式リリースはすべて別承認。

## 5. 実証状況

| 項目 | 状態 |
| --- | --- |
| コード | Pure quotation＋recheck関数を追加 |
| focused test | **66 PASS／0 FAIL** |
| GitHub CI／CodeQL | PR最新HEADで別途確認 |
| Staging実証 | 未実施 |
| Production反映 | 未実施 |
| 実DBでのLevel/XP変更 | 未実施 |

**Draft PRを維持。一般ユーザーへの公開・金銭相当報酬付与・換金を一切開始しない。**
