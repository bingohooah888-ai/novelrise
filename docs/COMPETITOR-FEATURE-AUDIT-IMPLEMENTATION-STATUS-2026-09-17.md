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

状態：**実装済み / current main・Production反映済み**

実装証拠：

- PR #677 `Add multi-episode schedule management`
- merge commit：`eb28397c6833c74144c98b3dc50369fffd1a2f57`
- Production migration：`20260918180500_episode_schedule_batch_management` 適用済み
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

## B〜C候補 #19 作者の近況・更新ノート

状態：**実装済み（本変更セット） / Production migration未適用**

実装証拠：

- `author-notes.html`
- `novelight-author-notes-public.js`
- `novelight-author-notes-public.css`
- `supabase/migrations/20260919090000_author_status_notes.sql`
- `supabase/checks/20260919090000_author_status_notes_precheck.sql`
- `supabase/checks/20260919090000_author_status_notes_postcheck.sql`
- `supabase/rollback/20260919090000_author_status_notes_rollback.sql`
- `tests/author-status-notes-contract.test.mjs`
- `tests/rls/author-status-notes.sql`

実装済み範囲：

- 公開作者プロフィールに、公開中ノートを新しい順で最大5件表示する。
- 作者専用管理画面で、短いタイトル、本文、任意の公開自作品リンクを作成・編集・アーカイブできる。
- タイトル80文字、本文1,000文字、公開中ノート100件を上限とする。
- 作品リンクは保存時に本人所有かつ公開中であることを検証し、公開取得時にも現在の公開状態を再確認する。
- リンク作品が後から非公開になった場合、ノートは表示したまま作品名とリンクだけを公開出力から除く。
- raw tableはRLS有効かつ全client roleからrevokeし、公開・管理・保存・アーカイブの専用RPCだけを明示grantする。
- migration未反映中は管理画面を「データベース反映待ち」とし、公開プロフィールは近況欄を静かに省略する。

安全・公平性境界：

- いいね、コメント、リポスト／共有数、グローバルタイムライン、フォロワー数効果、自動フォロワー通知は追加しない。
- 作品Rank、LIGHT SEED、SCOUT、PV、お気に入り、検索・発見・露出、LIGHT ANALYTICS、推薦へ接続しない。
- 公開表示はDOM `textContent`で構築し、作者入力をHTMLとして解釈せず、本文改行だけを保持する。
- Production migration適用はPR mergeとは別の明示承認境界とする。


## B〜C候補 #20 アンケート／投票

状態：**実装済み（本変更セット） / Production migration未適用**

実装証拠：

- `novel-polls.html`
- `novelight-novel-poll.js`
- `novelight-novel-poll.css`
- `supabase/migrations/20260919100000_author_reader_polls.sql`
- `supabase/checks/20260919100000_author_reader_polls_precheck.sql`
- `supabase/checks/20260919100000_author_reader_polls_postcheck.sql`
- `supabase/rollback/20260919100000_author_reader_polls_rollback.sql`
- `tests/author-reader-polls-contract.test.mjs`
- `tests/rls/author-reader-polls.sql`

実装済み範囲：

- 公開作品ごとに同時1件までの単一選択アンケート。
- 質問200文字、選択肢2〜6個、各80文字、β期間中は1作品50件まで保持。
- ログイン読者1アカウント1票。投票後の変更・取消は行わない。
- 作者本人の自己投票を禁止し、既存Block関係では直接交流として投票を拒否する。投票者IDは作者・一般クライアントへ返さない。
- 公開中は未投票読者へ集計を隠し、投票後に現在集計、締め切り後に最終集計を表示する。
- 作者は集計を確認して公開中アンケートを締め切れる。投票開始後の質問・選択肢編集や再開は行わない。
- migration未反映中は作者管理を「データベース反映待ち」とし、読者側はアンケート欄を静かに省略する。

安全・公平性境界：

- 生テーブルはRLS有効かつclient rolesからrevokeし、専用RPCだけを明示grantする。
- 作品Rank、LIGHT SEED、SCOUT EXP、PV、お気に入り、検索順位、発見棚、露出、LIGHT ANALYTICS、推薦へ接続しない。
- 同時作成・同時投票は一意制約とRPC側の競合処理でfail-closedに扱う。
- Production migration適用はPR mergeとは別の明示承認境界とする。


## B〜C候補 #21 読者キュレーションリスト

状態：**実装済み（本変更セット） / Production migration未適用**

実装証拠：

- `curation-lists.html`
- `curation.html`
- `novelight-curation.js`
- `novelight-curation.css`
- `supabase/migrations/20260919102000_reader_curation_lists.sql`
- `supabase/checks/20260919102000_reader_curation_lists_precheck.sql`
- `supabase/checks/20260919102000_reader_curation_lists_postcheck.sql`
- `supabase/rollback/20260919102000_reader_curation_lists_rollback.sql`
- `tests/reader-curation-lists-contract.test.mjs`
- `tests/rls/reader-curation-lists.sql`

実装済み範囲：

- 1読者20リスト、1リスト50作品まで。リスト名80文字、説明500文字。
- 新規リストは非公開。共有時も公開ディレクトリへ載せず、推測困難な共有URLを知る人だけが閲覧できる。
- 現在公開中の作品だけ追加可能。後から非公開・下書きになった作品は共有表示から除外する。
- 所有者は共有URLをローテーションでき、旧URLを即時無効化できる。
- 本棚の本人専用 `list_name` とは分離し、既存非公開本棚を公開化しない。
- 作品ページから既存キュレーションへ追加し、本棚から管理画面へ移動できる。
- migration未反映中は管理・追加UIを「データベース反映待ち」として安全停止する。

安全・公平性境界：

- 生テーブルはRLS有効かつclient rolesからrevokeし、owner-bound管理RPCと共有トークン専用公開RPCだけを明示grantする。
- β版ではリストへのいいね、フォロー、人気順、ランキング、公開ディレクトリ、掲載数による評価を実装しない。
- 作品Rank、LIGHT SEED、SCOUT EXP、PV、お気に入り、検索順位、発見棚、露出、LIGHT ANALYTICS、推薦へ接続しない。
- 共有ページは `noindex` + `no-referrer` とし、検索インデックス化と共有トークンのReferer漏えいを抑える。
- Production migration適用はPR mergeとは別の明示承認境界とする。


## B〜C候補 #22 共同執筆／共同管理

状態：**実装済み（本変更セット） / Production migration未適用**

実装証拠：

- `collaboration.html`
- `episode-edit.html`
- `my-novels.html`
- `novel.html`
- `novelight-episode-schedule.js`
- `novelight-episode-history.js`
- `supabase/migrations/20260919112318_novel_collaborative_writing.sql`
- `supabase/checks/20260919112318_novel_collaborative_writing_precheck.sql`
- `supabase/checks/20260919112318_novel_collaborative_writing_postcheck.sql`
- `supabase/rollback/20260919112318_novel_collaborative_writing_rollback.sql`
- `tests/collaborative-writing-contract.test.mjs`
- `tests/rls/collaborative-writing.sql`

実装済み範囲：

- `novels.user_id` を唯一の作品所有者として維持し、共同執筆で所有権移転を行わない。
- β版の共同執筆者は `editor` 1種類。既存話のタイトル・本文編集と、末尾への新規非公開下書き作成だけを許可する。
- 公開、削除、話数・章・並び順、予約公開、作品設定、課金・露出設定は所有者専用のまま維持する。
- 1作品5人まで。招待URLは7日失効・1回使用で、生トークンは保存せずSHA-256ハッシュだけを保持する。
- 所有者は招待更新・失効・共同執筆者削除が可能。共同執筆者本人は離脱できる。
- 双方向Block関係では新規参加と共同編集を停止する。
- 共同編集は既存episode revision履歴を通し、別途private audit eventへ参加・離脱・招待・編集等を記録する。
- migration未反映中は共同執筆UIを「データベース反映待ち」で安全停止し、所有者の従来episode編集だけは既存owner経路を継続する。

安全・公平性境界：

- 共同執筆関連の生テーブルはRLS有効かつclient rolesからrevokeし、authenticated専用RPCだけを明示grantする。
- 既存 `novels` / `episodes` owner RLSは緩めない。
- 招待画面は `noindex` + `no-referrer`。
- 共同執筆者へ公開・削除・予約公開・revision復元等の所有者操作を出さない。
- 作品Rank、LIGHT SEED、SCOUT EXP、PV、お気に入り、検索順位、発見棚、露出、LIGHT ANALYTICS、推薦へ接続しない。
- Production migration適用はPR mergeとは別の明示承認境界とする。


## B〜C候補 #14 コメントの作者モデレーション強化

状態：**実装済み（本変更セット） / Production migration未適用**

実装証拠：

- `novelight-comments.js`
- `novelight-comments.css`
- `supabase/migrations/20260918192000_comment_author_moderation.sql`
- `supabase/checks/20260918192000_comment_author_moderation_precheck.sql`
- `supabase/checks/20260918192000_comment_author_moderation_postcheck.sql`
- `supabase/rollback/20260918192000_comment_author_moderation_rollback.sql`
- `tests/comment-author-moderation-contract.test.mjs`
- `tests/rls/comment-author-moderation.sql`

実装済み範囲：

- 作者は自作品の公開コメントを1件だけ固定できる。
- 別コメントを固定すると既存固定は解除され、固定状態は表示順だけへ影響する。
- 作者はコメントをsoft非表示／再表示でき、非表示理由は限定された分類として非公開監査へ残す。
- 非表示でも元コメント、コメント投稿イベント、既得SCOUT EXPは削除・取消しない。
- 作者返信は1読者コメントにつき1件だけとし、編集・削除は可能だが多段スレッドへ拡張しない。
- 作者返信は既存のblock境界を直接交流として尊重し、block中の新規返信を拒否する。
- block関係にある閲覧者へ既存作者返信を表示しない。
- 作者モデレーション操作は専用の非公開監査台帳へ記録する。
- migration未反映中は旧comment feedに`can_moderate`が存在しないため、作者操作UIを出さないrolling-deploy fail-safeとする。

安全・公平性境界：

- 固定・非表示・作者返信は、作品Rank、LIGHT SEED、SCOUT、PV、favorites、発見・検索順位・露出へ直接加点しない。
- 作者が批判的コメントを非表示にしたことを作品評価の改善として扱わない。
- soft非表示は評価履歴を消す手段にせず、元データとSCOUT履歴を保持する。
- raw moderation audit tableは一般クライアントへ直接公開しない。
- 作者返信自体ではSCOUT EXPを発生させない。
- 第二のコメントシステム、無制限スレッド、SNSタイムライン機能は追加しない。
- Production migration適用はPR mergeとは別の明示承認境界とする。
