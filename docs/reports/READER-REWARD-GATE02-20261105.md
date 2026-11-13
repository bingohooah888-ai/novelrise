# NOVELIGHT 読者報酬 Gate 02 — 30日XP根拠集計・降格判定の非公開Dry-Run

更新：2026-11-05 JST
対象：Draft PR #2762 `feature/reader-reward-gate01-20261104`
実施範囲：**純粋関数・単体テスト・設計文書のみ**。main・Production・Staging・DB・Stripe・AI既存ブランチ・ユーザー画面・feature flag・Cronは変更しない。

## 1. 変更していないOWNER確定仕様

- 正式版Lv.100、β版上限Lv.30の既存公開挙動は維持。
- 30日間に実際に確定獲得したScout XPが200以上なら維持、200未満なら最大1レベル降格。
- 一度でもLv.70以上へ到達したユーザーはLv.50を降格下限とする。
- 既存ユーザーの初回判定は正式リリースから30日後、新規ユーザーは登録から30日後。
- 判定期間は正確な30日であり、暦月単位ではない。各区間の余剰XPは次期維持ノルマへ繰り越さない。
- 降格後は下がったレベルの次レベルXPゲージ0から貯め直す。生涯総獲得XPの独立カウンターは作らない。
- 報酬単価Lv.1〜100、コメント報酬条件等はGate 01のOWNER確定値を維持。

## 2. 既存台帳の確認結果

GitHub mainに存在する `supabase/migrations/20260909071500_scout_beta_event_foundations.sql` を読み取り専用で確認。

- `scout_xp_ledger`: `id`, `user_id`, `source_event_id`, `xp_kind`, `xp_value`, `rule_version`, `occurred_at`
- `xp_value` は整数で -1000000〜1000000を許容するため、過去XPの訂正など符号付きの履歴を考慮する必要がある。
- `unique(user_id, source_event_id, xp_kind)` で同じXP源の重複発生を制約。
- 既存のXP台帳は変更せず、新しい累計XPテーブルも作らない。

## 3. 今回追加したコード

`api/_lib/reader-reward/maintenance-review.js`

- `quoteScoutMaintenanceWindow`: 正式リリースまたは新規登録を起点に、1回目・2回目…の**連続する30日間**を算出。開始時刻を含み終了時刻を含まない `[start, end)` 区間を採用し、二重集計を防ぐ。起点日時は推測で決めない。
- `quoteScoutMaintenanceReviewDryRun`: 既存XP台帳の列名に合わせた「単一ユーザーの全期間スナップショット」を読み取る純粋関数。30日間のXP合計が200以上かを判定し、Gate 01の降格・下限・XPゲージリセット計算へ接続する**候補結果のみ**を返す。
- 既に処理済みの30日区間は安定したreview keyと既処理checkpointで重複判定を停止する。過去の期間を飛ばしたり、前回checkpointと一致しない場合も停止する。
- 30日の終了前、台帳情報の完全性未確認、異なるユーザーの混入、同一源重複、形式不正は降格しない。
- 負のXP訂正が含まれる期間は、訂正をどの活動期間に帰属させるか未承認のため `xp_adjustment_review` に保留し、未決定ルールで自動降格しない。
- この「完全性確認済み」フラグ単独でDB照会の完全性や本人認証を証明できるわけではない。実環境の権限・全件取得・監査・排他制御は別途必須。

`tests/reader-reward-maintenance-review.test.mjs`

- 12件の追加focused test。30日窓の境界、既存／新規起点、199/200XP、重複レビュー、失われたcheckpoint、XP訂正、ユーザー混入、重複XP源、壊れた入力、Lv.50下限を検証。
- Gate 01の21件と合わせて**33件PASS／0件FAIL**（Windows隔離ディレクトリ上でNode `--test` を実行）。追加2ファイルはPrettier整形済み。

## 4. 安全上の保留と次工程

1. 実環境での**サーバー検証済み全XP台帳の取得経路**・トランザクション境界・遅延処理・パフォーマンスの検証。現時点でAPI、DB、Cronへ未接続。
2. 既存台帳に負の訂正がある場合、どの判定期間へ反映し、確定後の降格を訂正するかはOWNER・安全審査待ち（勝手に正味計算や遡及降格を行わない）。
3. Review keyの永続化・同時実行の排他・一度だけ確定する台帳設計。**文字列Keyだけでは実DB上の冪等性保証にならない。**
4. 現在Level・次Level XP進捗・過去最高Levelの正式保存、昇格関数、Lv31〜100のXP必要量テーブル。本番の既存βデータを無許可に書き換えない。
5. 換金可能な少額報酬の上限・全体予算・法務税務・交換条件は引き続き別ゲート。

本PRは**Draft保持**。高リスクMASTER草案を含むため、OWNER本番統合承認なしにmainへmerge不可。正式リリース時の一般公開・実報酬付与・交換にはさらに別途明示承認が必要。

## 5. 実証の4区分

- コード実装：**Gate 02の副作用のない関数・テストを追加**
- 自動テスト：**focused Node 33件PASS、0件FAIL**。GitHub CI / CodeQLは最新HEADの別途結果で判断
- Staging実環境：**未実施**
- Production反映：**未実施**
