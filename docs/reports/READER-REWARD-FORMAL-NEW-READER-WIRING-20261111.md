# NOVELIGHT 正式SCOUT：新規読者向け未公開オンボーディング（2026-11-11）

対象：既存Draft PR #2762。起点SHA `a9cd14403d8b845bed1996fc0e5e67986b52d1f8`。本作業はコードと合成テストのみでStaging DB・Production・main・Previewには未適用。

## 作成内容

- `api/_lib/reader-reward/formal-new-reader-onboarding.js`: 既存の `scout_level_state` と `scout_point_usage_wallets` を利用する**正式リリース後の新規登録者専用**の初期化処理。認証済み本人IDと `auth.users.created_at >= 正式リリース日時` を条件に、Lv.1、XP進捗0、判定起点は本人の登録日時、初期Point 0、旧Point交換適格0を同一トランザクションで作成する。初期化前に本人IDに紐づく既存Point/XPが存在すれば保留し、旧データに触れない。二重初期化は既存行を維持、部分状態は保留し自動修復しない。書込はStaging限定の明示OWNER承認スコープ・信頼済みサーバー・正式オンボーディング有効フラグ・正式リリース日時到来を**すべて**要求。
- 既存 `formal-application-host.js`・`formal-usage-host.js`・`formal-usage-http.js` に初期化処理を接続。既存の `auth.getUser(token)` 検証済みユーザーIDだけで、`POST action=initialize_new_formal_reader` を扱う。POST本体にユーザーIDは受け付けない。未承認状態ではHTTP 403を返す。既存の管理者検証 `requireAdmin` の下に `GET ?view=new_readers` の読み取り専用集計を接続。
- 読者UI：既存の `formal-scout-reward-client.js`・`formal-scout-reward-mount.js`・`formal-scout-reward-page.js`・`formal-scout-reward-ui.js` を再利用。正式ホストが `newReaderOnboardingAvailable=true` を明示注入したときのみ利用開始ボタンを表示する。初期化操作は**クリック時のみ**。ページ読込時のPOSTや自動登録・Point付与は一切なし。画面は従来のSCOUT LEVEL・XP・Point・履歴をそのまま利用。
- 管理者UI：従来の交換申請／返金一覧を維持し、新規読者の登録数／初期化済数／部分状態数を表示できる。認証済み管理者のread-only GETだけが対象。旧Pointユーザーを無断で除外した統計ではなく、登録日時が正式リリース後の新規Authユーザーだけの別指標。
- ブラウザの通信URL・JWT・DB接続は未注入。正式サイトHTML・`api/*.js`にroute/scriptを追加せず、未公開のファクトリーのみ。

## 遵守した制約

- 旧Point 3,581行・出所未確定1,604人、`auth.users`、旧XP台帳、既存Badge、既存正式12テーブルの**内容を一切変更しない**。古いIDを削除・補完・移行対象外としてマーキングしない。既存の `formal-opening-sync.js` の旧ユーザー保留を変えない。
- `docs/drafts/SCOUT_FORMAL_XP_CUTOVER_DRAFT.sql` 内に存在する `initialize_new_reader` の「リリース後登録はLv.1・登録日時起点」という仕様を採用しつつ、正式カットオーバーSQL・β XPトリガーの差し替え・報酬発行は実行していない。今回のJSコードは既存の12テーブルに直接書込む**将来用の未実行トランザクション実装**で、追加のDB関数・Migration・Workflowは不要。
- 本実装の新しい読者API/画面は未公開であり、実JWT・実Point発行・Stagingの実データ試験・Production使用は証明されていない。

## 次の承認

既存旧IDの原因調査とは別に、今後のStagingでの**合成の新規Authアカウント1件だけ**を対象に、読み取り専用インスペクト→Staging限定の1回初期化（Lv.1・Wallet0）→読み取り専用で結果確認→合成アカウントと作成データの限定クリーンアップの実行計画を提示できる。ただし、この段階で実DB書き込みや実JWTを実施する許可はない。実行前にStagingのトランザクション接続方式と正式リリース日時のテスト用表現（実正式公開と混同しない）をOWNERと固定する。対象実行の前に承認を受けること。

正式β→本番の移行（旧Point換算、旧ユーザー紐付け、実報酬トリガー、外部交換、AI利用）は引き続き別工程・別承認。実行不能な状態を「正式公開済み」と報告しない。
