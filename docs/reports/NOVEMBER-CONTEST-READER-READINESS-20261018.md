# 2026-11 コンテスト読了計測 — 開始前の確認と修正

## 現在の本番状態（2026-10-18、読み取り専用調査）

- `novelight_contests`: `novelight-november-2026`、`status=registration`、`public_visible=true`
- 開始境界: 2026-10-31 15:00:00 UTC（日本時間 11/1 00:00）。
- 本番DB観測値（調査時）: `novelight_contest_read_sessions=0`、`novelight_contest_read_events=0`、`novelight_contest_entries=4`、通常 `valid_read_events=219`。
- 通常読書には `record_valid_read_progress`、コンテストには独立した `novelight_contest_*read_session` を使用する。両者は同じ `NovelightReadingSettings.contentProgress` を参照し、元の `.content` の横スクロールイベントを監視する。
- 現行エピソードには `NOVELIGHT_CONTEST_READER_CLIENT_ENABLED` の設定元がない。開始後も専用トラッカーが起動しない問題をこのPRで修正する。

## 修正の安全境界

- `GET /api/november-contest-reader-ready?episode_id=<published-id>` は読み取り専用。認証情報、Secret、個人情報、参加者情報を返さず `{ enabled: boolean }` のみ公開する。
- 有効条件は **Productionサーバーの読書計測環境フラグと専用Secretが有効**、かつ **コンテストが正式に `active`** で開催期間内、かつ **対象話が公開済みの参加作品の話** であること。いずれか不成立・通信失敗なら `enabled:false`。
- `enabled:true` の場合に限り既存のコンテスト計測スクリプトを読者ページに接続。元の通常計測を停止・置換せず、複製本文を作らない。
- 本修正だけではコンテスト開始、Production設定更新、DB記録の作成・加算は行わない。
- 非参加作品を読んでもコンテスト用読者識別子を作らない。正式な有効読書は既存サーバーの時間・進捗要件（原則80％・30秒、短編別閾値）で判定する。

## リリース直前の必須確認（本番承認と正式開始ゲート）

1. 最新mainおよびこの修正の本番反映を確認。
2. Vercel Productionの `NOVELIGHT_CONTEST_READING_ENABLED` と `NOVELIGHT_CONTEST_GUEST_SIGNING_SECRET` の存在・妥当性を **値を開示せずに** 確認。設定変更には本番承認が必要。環境設定の読み取り経路がない場合は未確認と明記し、開始を妨げる。
3. Contest Step12独立OWNER承認と開始runbookの条件を検証し、正式workflow以外で `registration → active` を変更しない。
4. 開始前のreadiness GETは `enabled:false`。開始後は公開済み参加作品のエピソードのみ `enabled:true`、その他は `false`。Secret未設定の場合も `false`。
5. その後、許諾を得た実際の読者による通常モード・拡大モードの自然な読書を検証し、通常の有効読書とコンテスト専用読了イベントを **個人識別子を出さず、集計差分のみ** 確認する。記録作成のための偽装読書やProduction DB直接書き込みはしない。
6. 不整合があれば集計や賞の確定を行わず調査する。

このドキュメントは読み取り専用確認・実装・テストの記録であり、Productionでの実読了保証ではない。
