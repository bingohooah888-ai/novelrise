# NOVELIGHT 読者報酬 Gate 06 — SCOUT Point共通残高・正式切替時の重複付与／二重利用防止（Draft）

作成日：2026-11-05 JST
対象：Draft PR #2762、`feature/reader-reward-gate01-20261104`
実行境界：**本PR内の純粋関数・単体テスト・設計書のみ**。既存コード／本番・Staging・Supabase DB・Stripe・Cron・AI呼び出し・公開フラグは変更せず、PRもmainへ統合しない。

## 1. OWNER確定済みのルール（変更禁止）

| 事項 | Gate 06における扱い |
| --- | --- |
| 1 SCOUT Point | **1円相当**。AI用別ポイント・別の換金用LRを作らない |
| 外部換金／交換 | **最低3,000pt＝3,000円相当**。本人確認・交換先・手数料・上限・法務税務等は未承認 |
| AI利用 | SCOUT Pointを直接消費する。**AI利用に3,000pt下限を適用しない**。AI機能別必要ptは未決定 |
| レベルアップPoint | **到達Lvごと5pt**の既存基準を原則維持。同じLvの降格後再昇格では二重に獲得しない |
| 読者称号Point | 現行定義の全100種の合計 **835pt**（Easy30＋Normal305＋Hard500）。現在有効な58種は合計253pt |
| 作者／限定称号 | 現行報酬0ptを維持 |
| SCOUT XPレベル | Gate01〜05の200XP／30日維持、未達最大1Lv降格、Lv70経験者Lv50下限、降格後XPゲージ0を維持 |
| 読書／コメント金額 | 既決定の0.1円〜1.1円／話、2円／コメント・月50件などを維持。**小数円の整数Pointへの精算・繰越方式は未決定** |

Lv1→30のレベルアップ報酬は5pt×29回＝**145pt**。Lv1→100を同じ5pt方式で一度ずつ到達する場合は5pt×99回＝**495pt**。全100称号835ptを含む理論値は**1,330pt**。この合計は「全称号解放・獲得」を仮定した理論値であり、実ユーザーの保証額・βの換金対象を意味しない。

## 2. 本番DBメタデータの読み取り専用確認

`public.scout_point_ledger`の既存列は`id, user_id, source_event_id, source_xp_id, seed_id, point_kind, point_value, status, event_key, reversal_of, occurred_at, metadata`。RLSが有効で、`UNIQUE(event_key)`が存在する。既存`status`は`confirmed / pending / frozen / cancelled`で、`reversal_of`は元台帳行を参照する。`point_value`は符号付き整数。

`novelight_award_level_up_points()`のイベントキーは`level_up:<user_id>:<level>`、`novelight_apply_scout_badge_evaluation()`等の称号報酬キーは`badge:<user_id>:<badge_id>`。過去に獲得したレベルや称号の二重付与は既存Ledgerの一意性で防止できる（ただし正式版のXPレベル計算への切替が別途必要）。

**現存Ledgerの確定残高＝そのまま換金可能残高、ではない。** β期既存ポイントの換金対象範囲は未決定。保留／凍結／取消／逆仕訳、同時予約、払い戻し、AI利用料金を正式処理に統合するトランザクションと法務審査が必要。

## 3. Gate 06のコードと検証

新規：`api/_lib/reader-reward/scout-point-usage.js`

- 定数`SCOUT_POINT_YEN_VALUE=1`、`SCOUT_POINT_MIN_EXTERNAL_EXCHANGE=3000`、`SCOUT_LEVEL_UP_POINTS=5`、`SCOUT_READER_BADGE_DEFINED_MAX_POINTS=835`。
- `quoteScoutMilestonePointGrant`：レベル到達・既存読者称号の報酬**試算のみ**。既存`level_up:`／`badge:`イベントキーを使い、歴史的に同じイベントが付与済みなら`already_awarded`。不完全な取得履歴・未検証の称号定義・未検証到達は付与候補なし。作者称号は対象外。
- `quoteScoutTenthsYenAsPoints`：既存Scout Pointは整数なので、0.1円〜の端数金額を無断で切捨て／切上げしない。整数Pointに正確に変換できない金額は`fractional_settlement_policy_pending`とし、実付与不可。イベントを複数まとめて端数を蓄積する方式も未承認のため、この関数では決めない。
- `quoteScoutPointUsage`：目的`external_exchange`の場合のみ3,000pt以上を条件とし、`ai_direct_use`は3,000pt下限なし。単一のScout Point共通残高に対して、確定利用可能残高、既存制限、運用・交換先とAI価格の承認、同一操作の既処理確認が必要。不足時／不明時は試算を停止する。
- `recheckScoutPointUsage`：同じ残高・revision・同一操作キーを**最終的なDB原子的引落し前に再照合するための試算**。実DBでの排他・一意Claimを保証する関数ではない。

どの戻り値も`mayIssuePoints=false`／`maySpendOrPayOut=false`で、付与・残高減算・AI実行・外部支払を行わない。

追加：`tests/reader-reward-scout-point-usage.test.mjs`、**13件**。

- 1pt＝1円、3,000pt未満の外部交換拒否と3,000pt以上の試算
- AIの1pt利用試算、AI Credit不使用、AI別価格の未承認を拒否
- 換金とAIが同じ残高を同時に使おうとする場合、旧revisionの後続処理を拒否
- 残高不足、凍結・保留／不正確認不足、重複操作
- 同じLv到達（再昇格含む）の5pt二重付与防止、βのLv2〜30獲得済みキーを尊重
- 読者称号`badge:`キーとゼロ報酬、作者称号排除、835ptの配点確認
- 0.1円、0.2円等の分数円付与の保留

**Gate01〜05の76件＋Gate06の13件＝Node focused test 89件PASS／0件FAIL**。Windowsの隔離一時ディレクトリで実行。Prettier整形済み。

## 4. 将来のDB切替・ポイント利用フロー（設計のみ、実行しない）

1. **既存βを保持**：旧`scout_xp_beta_level_cap`、旧累計XP表示、旧`scout_xp_level_up_points`、既存Badge処理／Point台帳を維持したまま、正式機能公開前の検証を行う。
2. **切替証拠の準備**：既存ユーザーのLv、XPゲージ、既獲得称号、既付与`level_up:`／`badge:`キー、保留／凍結・取消／逆仕訳履歴を認証済みサーバーで突合。現時点で旧ユーザーのポイントを自動で換金対象にしない。
3. **正式Scoutレベル状態の導入前検証**：Lv31〜100閾値・Lv100余剰・XP訂正ルールが承認された後、Gate03/04のState revision／review claimとの排他・移行・ロールバックを実環境で設計。新規登録者はβ移行を通さない。
4. **付与の一意化**：既存`UNIQUE(event_key)`を再利用し、βで一度もらったLv/称号報酬は正式版で再付与しない。昇降格が繰り返されても、同じLevelのポイントを二度受け取れない。
5. **利用可能残高の新定義**：確定Pointから、取消／逆仕訳・凍結・保留・将来の引落し予約・β旧残高の適格性を監査した「実際に使用可能なPoint」をサーバー側で計算。既存`earning_suspended_until`だけを換金制限・AI利用制限の代用にしない。
6. **単一ウォレットからの競合しない利用**：外部換金とAI利用が同じState行／操作キー／残高を共有し、同一DBトランザクションで`reserve → commit`と失敗時返却を監査。各操作の一意性、同時処理防止、冪等性、業者との二重支払防止、失敗時の救済・異議申立てを設計・審査する。
7. **金額を勝手に補正しない**：0.1円などの読書報酬を整数Pointにまとめる単位・端数繰越・有効期限・取消時相殺は、ユーザー決定までFail Closed。レベルアップ5pt・称号合計835ptに含まれない金銭相当付与は、独自に決定しない。
8. **安全・法務と承認の分離**：資金原資、発行上限、換金先、送金・交換事業者契約、本人確認・税務・法令上の取扱い、利用規約、異常検知・監査ログ、RLS・権限、Staging live proof、本番統合および正式公開を**個別承認**する。

**禁止事項の結果**：今回の変更はDraft PR内のJS・テスト・この設計書だけ。DB migration・API接続・実ユーザーのPoint変動・Staging/Productionの更新・PR統合・AI機能実行・外部交換開始は一切実施していない。

## 5. 実証区分

| 項目 | 状態 |
| --- | --- |
| 非公開コード | 追加済み（副作用なし） |
| テスト | **89 PASS／0 FAIL** |
| 本番DB | メタデータ・既存関数を**読み取り専用**で確認 |
| GitHub CI／CodeQL | 最新HEADの結果を別途確認 |
| Staging | 未実施 |
| Production | 未反映 |
| 換金・AI使用 | 一切実行・公開していない |
