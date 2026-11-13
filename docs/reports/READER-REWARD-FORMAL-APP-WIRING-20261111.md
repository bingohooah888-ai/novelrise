# NOVELIGHT 正式SCOUT LEVEL/Point：未公開アプリ接続（2026-11-11）

対象：既存Draft PR #2762。Staging Point利用5テーブルは適用済み。今回のコード変更によるDB操作はなし。

## 今回の完成範囲

- `api/_lib/reader-reward/formal-application-host.js`：既存の正式LEVEL状態・30日XP台帳・正規Point台帳を読むPostgres repository、Point利用Service、認証済み読者/管理者HTTPハンドラーと、読書・コメント報酬ランナーを単一の未登録ファクトリーへ合成。
- `assets/formal-scout-reward-transport.js`：既存の読者・管理者マウントが受け取れる認証付きリクエスト関数。URL・セッション・fetchは将来の承認済みホストが注入する。デフォルト通信先や自動マウントなし。
- 関連する局所テスト：正規DB形状の読み取りとAuth、読者/管理者ハンドラー、未承認報酬の停止、ブラウザ通信境界の合成データ試験。

## 既存資産を再利用（作り直しなし）

- LEVEL/XP：`formal-canonical-reader.js`
- Point/ウォレット・予算・履歴：`formal-usage-postgres-repository.js`・`formal-usage-service.js`
- 読者/管理者API：`formal-usage-http.js`
- 報酬処理：`formal-earning-runner.js`
- 画面：`formal-scout-reward-ui.js`、`formal-scout-reward-admin.js`、`formal-scout-reward-mount.js`

## 次の実施条件

正式公開の機能フラグと本番切替承認は現時点で与えない。既存5テーブルは空のため実ユーザーの初期ウォレット・LEVEL状態の作成と正規Point残高同期、実DBロールの限定GRANT、報酬用private追加4テーブルと確定済み報酬ロジック実DB適用は**未実施**。今回の実装を公開済み・実JWT成功済みとは扱わない。必要な承認後に接続先の設定、実データ投入と実JWT実証を行う。main/Production/Preview、外部交換、実AIは対象外。
