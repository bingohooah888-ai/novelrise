# NOVELIGHT OWNER決定：Scout Point整数10倍単位／デジタルギフト先行・β既存Point移行準備

作成日：2026-11-05 JST  
対象：Draft PR #2762 `feature/reader-reward-gate01-20261104`  
区分：OWNER仕様採用／非公開コード・focused tests・実DBの読み取り専用監査。**Production残高変更未実行**。

## 1. OWNER新決定・従来決定からの変更

- **10 Scout Point＝1円相当**。従来の1 Point＝1円相当は取り消す。内部・利用者表示は整数Pointで統一し、端数円を丸めない。
- 外部交換の最低額3,000円相当は変えず、**30,000 Point**から申請可能。AI直接利用には最低30,000 Pointを適用しない。AI価格はAI機能完成・実原価と採算が判明してからOWNER決定。AI／外部交換で換算レートは同一。
- 有効読了の金銭報酬（Lvにより0.10〜1.10円／話）は1〜11 Point／話に正確に対応。有効コメントは20 Point／件、50件／月・最大1,000 Pointの既存上限維持。**読書報酬の個人月間上限は設けず、利用状況を見て判断**（ただしサイト全体の予算・不正検知・可用性制御の検討は別）。
- レベル初回到達5 Pointは**50 Point**、読者称号100種の定義済み合計835 Pointは**8,350 Point**、全100種称号＋Lv100初回到達の理論合計は**13,300 Point**となる。Point獲得に紐づく称号閾値も同率変更し、称号獲得条件の経済的意味を維持する。
- **β版の既存Point履歴・残高もすべて10倍で継承する**。レベル、XP、読書数・コメント件数、称号獲得回数は10倍しない。β取得Pointは正式版AI利用対象、外部ギフト交換は正式版以降の適格Point対象とする既案を維持。
- 外部交換は**デジタルギフト先行**、銀行振込は将来検討。提供者、料率、商品、法務適合と最終送付方式は別途審査。
- 正式公開前の交換・付与ルートは開放しない。今回のOWNER仕様採用は**Production DB一括変更を実行する個別承認ではない**。

## 2. 実Supabaseの読み取り専用監査（2026-11-05、public／novelrise）

操作：PostgreSQLのシステムカタログと集計SELECTのみ。**個人ID・Point履歴の行単位の公開なし／DB変更なし**。

| 項目 | 現況 | 10倍換算時の予定 |
| --- | --- | --- |
| `scout_point_ledger` | **132行、36人、総Point172、全件confirmed** | 行・人・event_keyを変えず、総Point **1,720** |
| Ledger内訳 | badge 123行・127pt／level_up 9行・45pt | badge 1,270pt／level_up 450pt |
| reversals／非confirmed／負数 | 今回の集計でいずれも0 | 符号・状態の保持ロジックは必須 |
| `scout_badge_definitions` | 182定義、報酬合計835pt（読者100定義）、他の作者・限定は0pt | 182定義、合計8,350pt。50/100種など定義の獲得条件は不変更 |
| Scout Point累積称号条件 | `reader_point_100`閾値100、`reader_point_500`閾値500 | 閾値1,000、5,000 |
| 既存Point累積称号進捗 | `user_scout_badges`に該当する360行、獲得は0行 | 進捗を旧単位の10倍相当に再算定、誤授与しない |
| `scout_point_operator_actions.amount` | 0行 | 対象行が将来増えていたら同単位で整合／再審査 |

DBの既存制約：`scout_point_ledger.point_value`は整数かつ±1,000,000、`scout_point_operator_actions.amount`は整数かつ±100,000、`scout_point_ledger.event_key`はUNIQUE。元の金額が大きい場合、単純10倍は既存CHECK違反になりうるため実行直前に再監査が必要。現在の最大行Pointは5pt。別表やスキーマに関連データがないと断定したものではない。

## 3. 一括書換え前に必須の同時対応

1. 発行中の経路を把握し、**旧単位での新規付与と10倍済みのデータが混在しない**切替境界を確立する。該当する実関数／トリガーは少なくとも`novelight_award_level_up_points`（現在5pt）、`novelight_apply_scout_badge_evaluation`（定義表を参照）、その他発掘・運営調整経路。発行変更を伴うProduction SQLは独立承認前に実行しない。
2. 台帳の既存行ごとのPoint値の10倍変換と、旧値・変換バージョン・変換実施前後の監査を保持する。重複実行でさらに10倍にならない永続的な変換済み判定を用意する。イベントID・event_key・user_id・original/reversal関係は変更しない。台帳の追記不可変原則と既存行変更の整合は別途レビューする。
3. 読者称号の報酬定義`point_reward`、Point累積称号の`target_value`、既存Point連動称号の`progress_value`と再評価経路を統一。XPや作品Rank、他のmetric targetを変換しない。
4. `novelight_scout_record_summary`／`novelight_scout_point_history`等の既存Point表示RPCと運営管理画面の表示値・金額文言を最新レートへ統一する。既存の`scout_point_ledger` UPDATEはPoint変更を契機に称号進捗更新が走るとは限らない（既存トリガーはstatus変更時等）ため明示的な進捗再算定が必須。
5. **単一の整合したcutover**をStagingで先に証明し、Production実行前の最新集計・完全バックアップ・復旧リハーサル・保護ロック・短時間実行・事後突合を行う。更新後の行数、利用者数、Pointの合計、個人別整合（機密保持）、履歴・状態・イベント重複／称号再付与なしを別々に確認する。
6. 実際のProduction変更は、対象DB・SQL差分・停止時間・件数・復旧手順・1回限りの実行範囲を示して**別途明示的な本番DB変更承認**を受けてから実行する。PRの単なる「本番承認」（main統合）や今回のポイント方針採用で代替しない。

## 4. 今回の非公開コード・テストと限界

- `api/_lib/reader-reward/scout-point-usage.js`の設計定数を、10pt＝1円、外部交換最低30,000pt、レベル初回到達50pt、称号理論報酬8,350ptへ更新。0.1円を整数1 Pointに正確に変換する純粋関数は**候補のみ**で、Point発行権限はない。AI価格は固定しない。
- `api/_lib/reader-reward/beta-point-tenfold-plan.js`に**非実行の変換金額・制約・集計照合モデル**を新設。元のPoint値や集計版が異なれば保留、整数の限界・既存CHECK違反を阻止。証明フラグをすべてtrueにしても`mayWriteDb=false`／`mayChangeProduction=false`。
- Gate06〜11の既存focused testsの**金額fixtureだけ**を新単位に合わせ、古い状態遷移・冪等／予算／履行・安全条件は保持。新規のdry-run test 19件を追加。
- 同じDraft PRへの保存は正式公開・本番DB更新を意味しない。**今回の実利用者Point書換えは未実施**。実DBの書き込み・Staging・Production・外部送付・AI実行・main統合は実行していない。
