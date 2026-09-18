# NOVELIGHT 競合機能監査・実装状況追補 2026-09-17

## 目的

`docs/COMPETITOR-FEATURE-AUDIT-2026-09-16.md` は2026-09-16時点の監査スナップショットであるため、その後に実装・main反映された競合監査項目の証拠を、元スナップショットを書き換えずに追補する。

恒久方針は `docs/NOVELIGHT-MASTER.md` を正本とする。

## A候補 #3 読書表示設定

状態：**実装済み / current main反映済み**

実装証拠：

- PR #620 `Add persistent reader display settings`
- main反映commit：`16d6b58ea6d58dc4b7b258eaa5418cf109933de3`
- `episode.html`
- `novelight-reading-settings.js`
- `novelight-reading-settings.css`
- `tests/reader-display-settings-contract.test.mjs`

実装済み範囲：

- 文字サイズ：小 / 標準 / 大 / 特大
- 行間：狭め / 標準 / 広め
- 読書テーマ：明るい / 暗い
- 本文横幅：狭め / 標準 / 広め
- 標準設定へのリセット
- device-local `localStorage` への保存
- 同一ブラウザのstorage更新への追随
- モバイル表示へのレスポンシブ対応

安全・公平性境界：

- 設定値はallowlistされた表示プリセットだけを保存する。
- Supabase、RPC、評価、作品Rank、LIGHT SEED、SCOUT判定へ表示設定を流用しない。
- 既存の `record_valid_read_progress`、`record_novel_exposure_conversion`、読書Journey計測は維持する。
- UI上でも「この端末の読書表示だけを変更します。作品の評価やSCOUT判定には影響しません。」と説明する。

未実装・将来判断：

- 縦書き / 横書き切替はA候補 #3のβ最小構成には含めず、需要と実装品質を見て将来判断する。
- 現在の設定保存は端末ローカルであり、ログイン読者向けクロスデバイス読書位置同期（A候補 #4）とは別機能として扱う。

## 監査上の扱い

2026-09-16監査本文の「current mainで確認できない」という記述は監査時点の状態として残す。

2026-09-17以降に実装状況を判断する場合は、本追補とcurrent mainを合わせて確認し、A候補 #3を未実装として重複開発しない。

## B候補 #12 ルビ・傍点等の小説向け本文表現

状態：**実装済み / current main反映済み**

実装証拠：

- PR #627 `Add safe ruby and emphasis prose markup`
- merge commit：`512f37ea1c0b07e1a8b5e4c06b53e0b5b17d861e`
- `novelight-prose.js`
- `tests/safe-prose-markup-contract.test.mjs`

実装済み範囲：

- ルビ：`｜漢字《かんじ》`
- 傍点：`《《強調》》`
- manuscript storageはプレーンテキストのまま維持
- 読者表示と作者プレビューで同じ安全rendererを使用
- 任意HTMLは解釈せず、allowlist DOMだけを生成
- malformed・oversized・multiline記法は原則として文字列のまま表示

安全・公平性境界：

- 本文記法はPV、有効読書、作品Rank、LIGHT SEED、SCOUT、発見・露出へ直接影響させない。
- rendererはSupabase、RPC、fetchその他のnetwork処理を持たない。
- 任意HTML、script、event handlerを本文から実行しない。

## B候補 #13 予約公開の複数話・範囲管理

状態：**実装済み（本変更セット） / Production migration未適用**

実装証拠：

- PR #677 `Add multi-episode schedule management`
- `episode-schedule.html`
- `supabase/migrations/20260918180500_episode_schedule_batch_management.sql`
- `supabase/checks/20260918180500_episode_schedule_batch_management_precheck.sql`
- `supabase/checks/20260918180500_episode_schedule_batch_management_postcheck.sql`
- `supabase/rollback/20260918180500_episode_schedule_batch_management_rollback.sql`
- `tests/episode-schedule-batch-management-contract.test.mjs`
- `tests/rls/episode-schedule-batch-management.sql`

実装済み範囲：

- 作品単位の予約公開管理画面
- 複数下書きの予約一覧
- 開始日時＋公開間隔による時間割の一括入力
- 個別時刻変更と複数話一括解除
- owner-boundの原子的batch RPC
- βの1batch上限50話
- 未公開作品は第1話を最初の予約公開とし、第2話以降は第1話より後だけ許可
- 既存の`episodes.scheduled_publish_at`と既存database-side due workerをSource of Truthとして再利用
- 第二の予約テーブル、第二のcron、第二の公開executorは追加しない

安全・公平性境界：

- 予約中の話は実公開まで`draft`のまま維持し、既存RLSで読者へ非公開とする。
- Rank、LIGHT SEED、SCOUT、PV、favorites、発見・露出へ直接影響させない。
- rollbackはB #13のbatch RPCだけを削除し、既存予約データ・既存cron・既存単発予約機能を壊さない。
- Production migration適用はPR mergeとは別の明示承認境界とする。
- 本変更セットがmainへmergeされた時点から、B候補 #13を未実装として重複開発しない。
