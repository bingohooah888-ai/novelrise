# NOVELIGHT SCOUT LEVEL100・読者収益化：まとめ実装（2026-11-11）

対象：既存Draft PR #2762、開始HEAD `0d5367e168d3a5c450119520190560b18494f77c`。

## 機能開発の成果

- 読書／コメント報酬のprivate DB4テーブルを、既存正式報酬SQL原案から抽出した**Staging適用専用SQL**に確定（未適用）。トリガー・報酬関数・実データ・権限付与は含めない。
- 初期ウォレット／LEVELの正式データ同期コードを追加。正規Scout Point台帳から**すでに10倍化済みの残高をそのまま**読み、旧βPointは交換適格0で初期化する。既存 `initialize_beta_level` を再利用し、LEVEL状態とウォレット作成は将来OWNER承認後、単一PostgreSQLトランザクションで行う。未承認時は書き込まない。
- 実API接続の準備として、既存認証付きreader/admin handlerへの未登録ルーティングと、既存UIマウントへの注入式通信部品を追加。公開 `api/*.js` エントリポイントや本番HTMLへの組込みは行わない。
- 既存の正式LEVEL/XP/Pointリーダー、Point利用リポジトリ、読者・管理者画面、報酬ランナーを再実装しない。

## 承認が必要な後続作業（実施していない）

1. **Staging承認②**：このPR HEADに固定した4テーブルSQLをStaging `wmlzjgvxgoyrovdhbqbg` に1回適用し、RLS/ACL/制約/空状態を読み取り確認する。復旧条件も承認文内で明確化する。
2. **Staging実データ初期化承認（別scope）**：既存10倍Point台帳の切替証拠、旧βデータの整合、実DB接続ロール、イベント書き込み停止を確認し、対象ユーザーの既存LEVEL初期化関数＋wallet登録を**限定ユーザー／回数**で実証。Staging承認②はこの実データ操作の承認ではない。
3. **接続・機能限定検証承認（別scope）**：正式報酬の残る関数・トリガー、実JWT、実Point・外部事業者・実AI・main/Production・Previewはそれぞれ個別承認が必要。正式公開も別判断。

## 安全対策の範囲

新規PR、Workflow、監査基盤、DB変更、実JWT、実Point操作、公開設定変更、Preview作成なし。新規局所テストだけを追加し、合格済み既存テストの再監査はしない。SQLは一括でStaging反映できるよう準備し、追加の安全基盤は作らない。

## 2026-11-11：正式報酬の未公開接続を追加

- `docs/plans/SCOUT-FORMAL-EARNINGS-FUNCTIONS-PENDING-20261111.sql`：既存2原案から、Point同期関数＋読書／コメント報酬・審査・キュー等の既存10関数だけを整理。新規トリガーなし。service_role / anon / authenticated / PUBLIC へのEXECUTEを付与せず、再承認まで未適用。
- `docs/plans/SCOUT-FORMAL-EARNINGS-TRIGGERS-PENDING-20261111.sql`：既存読書・コメントテーブルのトリガー2件と、正式リリース後に必要なservice_role EXECUTEを別ファイルへ隔離。**β稼働中に適用禁止**。正式切替・初期ウォレット全件作成・既存書き込みとの衝突回避等が個別に承認された後だけ検討。
- `api/_lib/reader-reward/formal-application-host.js`：すでに作成済みの未登録アプリファクトリーへ、既存のStaging専用初期LEVEL／wallet同期と認証付きreader/admin APIルータを合成。コンストラクターのDBアクセスなし。
- ブラウザ画面は既存 `formal-scout-reward-page.js` の注入式 reader/adminマウントを使用。実装ファイルに本番HTMLからのscript読み込み、実API URL、実JWT取得、公開ルート登録は追加しない。
- 残る実環境の工程は、**①未公開10関数のみのStaging適用・読み取り専用確認**、②正式切替に伴うトリガー有効化、③専用権限／実データ同期／実JWT限定検証。②③は今回未承認であり、①の承認に含めない。Production・main・Preview・Point発行／消費・AI／外部交換は禁止のまま。
- 今回は既存開発の再実装や総合監査を行わず、追加接続とSQL分離だけの局所テストを行う。

## 2026-11-11：Staging実データ接続の読み取り専用確認と同期ゲート

### 現物確認（Supabase Staging `wmlzjgvxgoyrovdhbqbg`、SQL SELECTのみ）

- `public.scout_point_ledger`: 3,581行、1,605ユーザー、confirmed 3,581行、合計3,581 Point。全行 `point_value=1`、`point_kind='badge'`、未確定・負値・formal付与は0件。
- `auth.users`: 17件。Point台帳ユーザーとの一致は**1人／3行／合計3 Point**、一致しないのは**1,604人／3,578行**。XP台帳は2,749行、1,683ユーザーのうち認証と一致は1人。
- `scout_level_state`・`scout_point_usage_wallets`・credit claim: 全0件。
- `scout_point_future_rewards_10x` Migration記録は存在するが、既存Pointの10倍換算実証ではない。3,581行の値がすべて1であり、`unitVerification.cutoverVerifiedByTrustedServer` や `canonicalLedgerReconciled` を自動的にtrueにしてはならない。
- PostgreSQL role: `service_role` はNOLOGIN、`postgres` と `authenticator` はLOGIN。Supabase管理SQLの `current_user` は `postgres`。既存アプリはPostgreSQL poolを注入する未登録ファクトリーのみで、正式Webサーバー用DBログイン・最低権限接続の実配線は確認されていない。パスワード・接続文字列は収集しない。

### 今回のコード

- `formal-opening-sync.js` に **`inspectCohort()`** を追加。正規台帳とStaging認証ユーザーの集合差、未確定・負値、既存正式LEVEL/wallet数を、ユーザーIDを出さずに読み取り専用で返す。
- 認証台帳に存在しないPoint保有者、未確定・負値、途中初期化、10倍単位未証明のいずれかがあれば `opening_cohort_blocked` として初期同期を停止。すでにある `initializeOne()` の明示Staging承認ゲートの後、同じDBトランザクション内でcohort判定を要求する。ブロック時はROLLBACKして、LEVEL初期化・ウォレットINSERTへ進まない。
- 既存 `formal-application-host.js` に `inspectFormalOpeningCohort` を公開せず注入式メソッドとして追加。APIルート登録・実JWT・DB接続作成はしない。
- 初期同期の局所テストで、実測に似た1,604件不一致がある場合に書き込み0件／ROLLBACKとなることを確認。**本当のStaging初期化は実行していない**。

### 次回にまとめて必要なもの

1. Stagingの `auth.users` と正規Point/XP台帳の対応原因を確認し、承認されたデータ整合化方針とPoint 10倍単位の移行実証を得る。Migration名だけでは不可。
2. 正式アプリ接続のPostgreSQLログインロールを既存の接続方式で確認し、必要な限定GRANTだけを別途承認。秘密値をログやチャットに出さない。
3. 不一致を解消してコホート判定が通った**後**、初期LEVEL／walletの実Staging書き込みと限定的な実JWT動作確認を対象と回数を指定して別途OWNER承認。トリガー有効化、実Point、外部交換・AI、main/Production/Previewはさらに別承認。

この段階でデータ修正、仮の10倍換算、強制的なStaging初期化、migrationやworkflowの追加は行わない。
