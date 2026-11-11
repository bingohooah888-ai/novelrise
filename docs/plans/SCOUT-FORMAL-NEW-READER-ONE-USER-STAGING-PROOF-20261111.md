# NOVELIGHT 正式SCOUT / Staging合成新規読者1件だけの検証手順（未承認・未実行）

Draft PR #2762。対象 Staging project ref：`wmlzjgvxgoyrovdhbqbg`。Production `fiepaguycecrredwrcwx` に接続しない。

## 前提・準備する値

- `TEST_REFERENCE_ISO`：OWNERが後日確定するUTC ISO8601の合成検証基準日時。**正式リリース日時ではない**。正式リリース日は未確定のままでよい。
- `TEST_USER_UUID`：Stagingで基準日時以後に新規作成する**合成Authユーザー1人だけ**のUUID。未知の旧1,604人のうちの誰かを使わない。メール・パスワード・実JWTをチャット・コード・ログへ書かない。
- `pool`：承認されたStaging専用のサーバー側PostgreSQLセッションを表す `pool.query` / `pool.connect` インターフェース。既存コードにある注入式クライアントを再利用する。Supabaseの `service_role` は PostgreSQL `NOLOGIN` であり、Supabase API KeyはPGログイン情報ではない。**PGの接続方式・必要権限が確定しない限り実接続しない**。
- `supabase`：認証付き読者APIの既存 `auth.getUser(token)` を持つ**Staging用サーバーAuthクライアント**。実JWTの確認は後続の別承認。

## 実行前：承認なしで可能なのはコード・合成テストと読取だけ

1. PR HEAD・対象Stagingを固定。既存の正式12テーブルと10関数は変更しない。報酬トリガーは無効のままとする。
2. `TEST_REFERENCE_ISO` は`TEST_USER_UUID`のAuth登録より**前**で、試験実行時より過去になるよう決定。正式リリース日時の代用として全体設定を書き換えない。
3. 合成ユーザー作成そのものが `auth.users` への実書き込みになるため、別途OWNER承認があるまで作成しない。作成承認後、対象の本人情報と生成したUUIDはSecret扱いの承認済み実行環境でのみ扱う。
4. 合成ユーザー1件について、`auth.users.created_at >= TEST_REFERENCE_ISO`、`scout_point_ledger` 0行、`scout_xp_ledger` 0行、`scout_level_state` 0行、`scout_point_usage_wallets` 0行を**SELECTのみ**で確認する。どれか異なれば停止し、修正・削除しない。
5. Staging PGセッションが複数クエリを同一トランザクションで実行できること、`auth.users`の参照・private2テーブルの必要な参照/INSERTが許可されることを、接続方法・ロールの説明だけで確認する。権限付与や接続設定変更は別承認。

## 未公開アプリの注入（記述例：このまま実行しない）

```js
const app = createUnregisteredFormalApplication({
  pool: approvedStagingPool,
  supabase: approvedStagingAuthClient,
  stagingRef: 'wmlzjgvxgoyrovdhbqbg',
  stagingTestReferenceAt: ownerApprovedTestReferenceIso,
  // releaseTimestampIsoは指定しない。正式版のリリース日ではない。
  releaseConfiguration: {
    formalNewReaderOnboardingEnabled: false, // 承認前は必ずfalse
    formalRewardsEnabled: false,
    formalEarningsEnabled: false,
    productionCutoverApproved: false
  },
  trustedServerAuthorization: {},
  unitVerification: {}
});
// 初期状態は app.initializeNewReader(testUserId) で
// new_reader_initialization_disabled（DB接続なし）。
```

将来の**1件限定Staging書き込みをOWNERが別途承認した後だけ**、上記のフラグをtrueにし、trustedServerAuthorizationに次の固定値を与える。ユーザーIDと基準日時は明示承認値を使用する。

```js
{
  approved: true,
  scope: 'staging_formal_new_reader_onboarding',
  projectRef: 'wmlzjgvxgoyrovdhbqbg',
  trustedServerVerified: true,
  approvedUserId: testUserId,
  maxReaders: 1,
  referenceMode: 'staging_synthetic_one_reader_proof',
  approvedReferenceAt: ownerApprovedTestReferenceIso
}
```

**違うUUID・参照日時・実行モード・2人以上の許可値では、DBトランザクション開始前に拒否される。**この値は管理者の実承認と環境検証の代用品ではない。Webで公開する `api/*.js`、正式サイトの画面HTML、Vercel Previewはこの準備では変更しない。

## 実行手順（今は未承認）

1. 承認した1合成Authアカウントが存在し、読み取り専用 `app.inspectNewReader(testUserId)` が `new_reader_ready_for_initialization` を返すことを確認。
2. **1回だけ** `app.initializeNewReader(testUserId)` を起動する。単一PGセッションで SERIALIZABLE / Auth行ロックを使い、正式LEVEL Lv.1、XP0、判定基準 `auth.users.created_at`、Wallet利用可能0、交換適格0、予約0、保留0を作成する。競合・エラー時はROLLBACKし、別IDの処理や自動リトライをしない。
3. 同じ1ユーザーをSELECTで確認し、`scout_level_state` 1行と `scout_point_usage_wallets` 1行、初期値が上記の通りであることを確認。`scout_point_ledger` / `scout_xp_ledger` にそのUUIDの行が増えていないことを確認。検証中の旧1,604人・過去の3,581 Point・旧Badgeには触れない。
4. 読者HTTP経由の実JWT / 同一Origin / 管理者GET / UIクリック連動は、実JWT・実接続・画面の検証範囲が承認された場合に限り、同じ合成ユーザーで別途確認。未承認ならアプリ層の合成テスト結果のみを報告。
5. 検証で作成した合成Authユーザーと関連2行は、**削除承認なしに消去しない**。削除・復旧が必要な場合、対象1UUID/2テーブル/既存トリガー・外部依存を確認したうえで別途OWNER承認を得る。逆操作にCASCADEを使わない。

## 現在の非実施・依存関係

- 実際のStaging Authユーザー作成、DB書込、PGログイン設定、秘密値取得、実JWT、報酬トリガー、実Point発行・消費、外部交換、AI、Preview、main、Productionは**実施していない**。
- テスト基準日時、合成ユーザーUUID、Stagingの利用可能なPG接続方式、試験後の処理（残すか削除するか）は未確定。これらは実環境操作のOWNER承認に含めて固定すること。
- 今回の読者／管理者画面・API・旧β移行機能を作り直さず、新規の検証モードを既存接続に追加するのみ。

## 2026-11-11：既存構成での実行経路・一括承認境界（今回も未実行）

### 確認済みの接続資産

- Staging Supabase URLは `https://wmlzjgvxgoyrovdhbqbg.supabase.co`（本番は `fiepaguycecrredwrcwx`）。既存 `docs/STAGING-RUNBOOK.md` はGitHub `staging` Environmentの `STAGING_SUPABASE_SECRET_KEY` / `STAGING_SUPABASE_PUBLISHABLE_KEY` とRepository Variable `STAGING_SUPABASE_URL` を正本にする設計。ただし**既存Secretが実際に実行環境へ注入されているかは未確認**。Secretの値は取得・表示しない。
- **Auth生成と実JWT取得の再利用元**：`tests/e2e/staging/follow-live-runner.mjs` の `createSyntheticUser` / `signIn`。Staging専用Secretを使うサーバーで `auth.admin.createUser({ email, password, email_confirm: true })` により1ユーザーを作成し、公開キーで `auth.signInWithPassword`、Staging `auth.getUser(access_token)` で本人一致を確認する。合成アカウントは `@example.invalid`、乱数生成したパスワードを実行環境内だけで扱い、出力しない。**同ファイル全体はPreviewブラウザ操作を含むため実行禁止**。必要なのは認証部分だけ。
- 接続中のWindows作業PCでは `STAGING_SUPABASE_URL`、Secret、Publishable Key、PG接続情報の**環境変数が未設定**であり、作業用PR worktreeにはnode_modulesもない。GitHub Secretsの値をPCやチャットに持ち出さない。このPCからの実Auth試験は現状不可。
- **DBへの最小実行経路**：既存Supabase管理接続の `execute_sql(project_id='wmlzjgvxgoyrovdhbqbg')` を使い、OWNER承認後に同一要求の単一PostgreSQL `DO`ブロック（例外時に全体中断）で対象ユーザー1件の `scout_level_state` / `scout_point_usage_wallets` 各1行を追加することは技術上可能。これは**DBスキーマと初期値の実証**であり、未公開JSの `pool.connect()`、HTTP、UIの実証ではない。各SQL要求を別々のツール呼び出しに分解し、1トランザクションであると偽らない。
- 2026-11-11、読み取り専用で2テーブルの列を確認。Lv.1・進捗0・`review_anchor_at`・`revision=0` と、Walletの0 Point・交換適格0・予約0・保留0・revision0は既存列に一致。**正式サーバー用PGプール／LOGIN／`pg`直接依存は存在せず、JSの実HTTP初期化テストには別の接続手段が必要**。現行 `service_role` はPostgres LOGINではない。
- ブラウザUIは既存コードでも未公開。Previewもmainも禁止中なので、現段階でUIクリック・実HTTPリクエストを実機で証明したとは扱わない。

### 固定できる値・固定できない値

| 項目                   | 一括承認時の指定                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB対象                 | Staging `wmlzjgvxgoyrovdhbqbg` のみ                                                                                                                  |
| 一回限りの合成基準日時 | `2026-11-10T00:00:00.000Z`（**正式公開日ではない**、実際の合成登録時刻より前であることを確認）                                                       |
| 合成ユーザーID         | `auth.admin.createUser` の**最初の成功応答で発行されたUUIDだけ**。事前にUUIDを想像して指定しない。IDが確定した瞬間に固定し、そのID以外の処理はしない |
| 生成件数               | Auth1件、正式LEVEL1行、Wallet1行を上限                                                                                                               |
| 付与金額・XP           | どちらも0、報酬付与なし                                                                                                                              |
| 許可する検証           | 作成直後のAuthユーザー本人照合、Lv.1 / Wallet0のSELECT、合成ユーザーのJWT本人照合                                                                    |
| 禁止する操作           | 旧ユーザー1,604人の変更、旧Pointの換算、報酬トリガー、AI、外部交換、既存のPreview依存runnerの実行、削除、Production、main、Preview                   |
| 後片付け               | 承認なく自動削除しない。Auth生成によりprofiles等の既存トリガーで追加データが生じた場合も対象を事後に確認し、削除には別の明示承認                     |

### 実行時の最小手順（OWNERの書き込み・実JWT承認が得られた場合のみ）

1. 既存GitHub Stagingの認証Secretを**安全に利用できる実行環境**があることを値非表示で確認し、Previewを起動しない独立Auth呼出し経路を選ぶ。現時点では、既存Workflowの中にこの3操作だけを安全に実行する専用の動線があることは確認できていない。**実行環境の準備ができなければ開始しない**。
2. 承認済み対象でAuthユーザーを**最大1件だけ**作成し、結果のUUIDをStagingの新規作成本人として固定。パスワード・JWTは秘密値として非表示。
3. `auth.users.created_at` が合成基準日時以後で、本人の既存Point/XP/LEVEL/Wallet行が全0件であることを**SELECT**で確認。いずれか異なれば停止。
4. **1つのatomic DB要求だけ**で、同一UUIDの正式LEVEL Lv.1・進捗0・`review_anchor_at=auth.users.created_at`、Wallet 0を追加し、読み取り専用で本人だけの2行が増えたことを確認。実際の `createUnregisteredFormalNewReaderOnboarding` の**コードパスの実行確認とは区別**する。
5. 合成ユーザーのみに `signInWithPassword` でJWTを発行し、既存Supabase `auth.getUser(token)` で本人IDを確認。これも実HTTP/画面公開やPoint操作の証明ではない。
6. Authユーザーと関連レコードは**削除せず保持**し、UUID・行数・結果（秘密値なし）を報告。途中失敗は無断再実行しない。

### OWNER承認案を提示する条件

**接続先と基準日時は確定したが、認証Secretを利用できる「Previewを伴わない実行経路」がまだ確定していない**。このため、現時点では実Auth生成・実JWTを含む「実行可能な完全一括承認」の条件を満たしていない。接続が確認できるまでは、書き込み・実JWT実行の承認を押し進めず、次の具体的な要件だけを提示する。

- Staging専用Secretの**値の転送なし**で、既存GitHub `staging` 環境内の承認済み実行者が、独立した `createUser` / `signInWithPassword` / `getUser` のみを使えること。
- その結果の唯一のUUIDを確定してから、Staging管理接続を使った1件のDB操作が原子的に実行できること。
- 実JWTはStaging Authのユーザー本人一致まで。未公開サイトの読者・管理者APIやUI検証は実サーバー接続が整うまで別工程。

**この手順書そのものは実DB操作の許可ではない。**

## 2026-11-11：既存GitHub Actions全82件の実行入口を照合（Previewなし・Secret転送なし）

### 調査結果

- `.github/workflows` のWorkflow 82件をファイル単位で確認。**`STAGING_SUPABASE_SECRET_KEY` を使用し、`workflow_dispatch` で手動起動できるWorkflowは0件**。同Secretと`STAGING_DATABASE_URL`を併用するWorkflowは6件あるが、いずれも`issue_comment`の**用途限定OWNER承認**が条件であり、新規読者検証を実行できる汎用入口ではない。
- 既存 `.github/workflows/ai-020704-staging-review-jwt-proof.yml` の `stage` job は `environment: staging` から `STAGING_SUPABASE_SECRET_KEY`、`STAGING_SUPABASE_PUBLISHABLE_KEY`、`STAGING_DATABASE_URL` を取り込む。 `scripts/resolve-staging-session-pooler.mjs` がStaging refを検証し、TLS必須のSession pooler接続先をファイルモード0600で安全に受け渡す。この**接続方式は既存機能として再利用可能**。ただしWorkflowそのものはAI審査を行い、合成ユーザー等の削除を含むので、今回の目的には**起動してはいけない**。
- `staging-smoke.yml` は既存のAuthユーザー作成と実ログイン機能を持つがPreview検証を行うため、今回の「Preview禁止」には一致しない。 `follow-stage-jwt-preview-proof.yml` も同様。
- 既存 `.github/workflows/staging-reader-point-tenfold-proof.yml` は同じ読者Point領域の `issue_comment` 起動とStaging管理DB接続を持つため、**将来の機能限定入口を追記する先として最も自然**。ただし現時点ではAuth Secretを使う新規読者限定入口がない。そのまま流用して旧Point10倍操作を実行するのは不可。
- 接続したWindowsの作業環境には `gh` コマンドがなく、Staging Secret/DB接続の環境変数もない。GitHub Environment Secretの**設定名をWorkflow定義から確認しただけ**で、Secretが実際に登録済み・現在有効であることまでは証明していない。秘密値の表示・復号・転送はしていない。

### 既存機能だけで達成するための最小変更案（未実装・実行承認前）

1. **新しいWorkflowファイルは作らず**、既存 `staging-reader-point-tenfold-proof.yml` の別用途を妨げない**独立した、明示OWNER承認1件専用の実行分岐**を後日追加する。既存の旧Point10倍ジョブとは起動条件・業務SQL・対象を分離し、旧Pointの移行処理を決して同時起動しない。新規Issue・監査用データベースは作らない。
2. その分岐では既存の `environment: staging` を使用。先行する非Secretステップで、最新の承認対象PR HEAD・Staging ref・OWNER・一回限りの対象スコープを固定する。Secretはその後にだけ受け取り、値を出力しない。`scripts/resolve-staging-session-pooler.mjs` を再利用する。
3. 合成基準日時は `2026-11-10T00:00:00.000Z`、正式公開日とは別。既存 `tests/e2e/staging/follow-live-runner.mjs` のAuth管理API作成とパスワードログイン/本人JWT照合の**処理部分のみ**を再利用する。元のPreview用runnerは起動しない。Auth作成は最大1件で、成功応答に含まれるUUIDを以降の処理対象として固定する。
4. `scout_point_ledger` / `scout_xp_ledger` / `scout_level_state` / `scout_point_usage_wallets` にそのUUIDの既存行が0であることを確認後、既存Staging DB接続で**1トランザクションだけ**LEVEL Lv.1、XP0、Wallet0を新規作成する。件数・対象ID・初期値を読み取り確認し、実JWT本人一致までを実証。**旧Point1,604人、報酬関数、旧Point10倍SQL、トリガー、Previewには触れない**。
5. 検証専用Auth ID・LEVEL・Walletの試験後の扱いは**保持**。認証・関連状態を自動で削除する既存AI runnerは流用しない。削除は後続のOWNER承認を要する。
6. **GitHubの`issue_comment` Workflowはデフォルトブランチにある定義から実行される。** 既存Workflowの新規読者専用分岐をPRへ追加するだけでは現時点で起動できない。実行可能にするには、別途**既存Workflowの改修承認とmain反映承認**が必要。今回両方とも未承認なので、**Staging Auth作成・DB初期化・実JWTを一括で実行可能な条件はまだ満たさない**。

### 次の承認の対象は「実行」ではなく「既存Workflowの限定改修準備」

許される次工程は、**既存Workflowに対する未公開・未実行の差分と、合成読者1件専用の処理コード**を今のDraft PR #2762に準備し、合成データの局所テストを行うことだけ。Secretの実在確認、main反映、実Auth作成、JWT、DB書き込み、削除は含めない。その差分と実行入口が準備され、mainへの別承認が与えられた段階で、Staging実操作のOWNER一括承認を求める。

**今回の調査では、Previewなし・Secret転送なし・main変更なしで即実行可能な既存Workflow入口は存在しなかった。これは調査上の未解決事項ではなく、現在のWorkflow起動条件に起因する制約である。**

## 2026-11-11：既存Point10x Workflowに独立した1件専用実行分岐を実装（未公開・未実行）

### ファイルと実行入口

- **変更は既存Workflow 1件だけ**：`.github/workflows/staging-reader-point-tenfold-proof.yml`。既存 `admit` / `stage` / `record` のPoint10x用の起動条件・処理コードは変更せず、`admit_new_reader` / `stage_new_reader` / `record_new_reader` を独立追加。新規Workflowファイルはない。
- 新規の専用実行処理は `scripts/scout-formal-new-reader-staging-proof.mjs`。既存 `scripts/resolve-staging-session-pooler.mjs` と、`tests/e2e/staging/follow-live-runner.mjs` の `createUser` / `signInWithPassword` / `getUser` の実行方式を再利用し、**元のPreview runnerは呼ばない**。
- 起動条件は既存Issue #294のOWNER本人が**別承認した新規コメント**のみ。旧Point10x用の `NOVELIGHT_STAGING_READER_POINT10X_APPROVE` とは別の `NOVELIGHT_STAGING_NEW_READER_ONE_APPROVE` プレフィックス。main SHA / スコープ / Staging ref / 固定基準日時 / 人数1を厳密に照合してから既存Issueに一度だけCLAIMを記録。実行成否にかかわらずCONSUMEDを記録し自動再試行しない。
- 対象Stagingは `wmlzjgvxgoyrovdhbqbg` だけ、テスト日時 `2026-11-10T00:00:00.000Z`、最大Auth1件、正式LEVEL Lv.1とWallet0が各1行。既存のStaging TLS Session poolerを秘密値非表示の一時ファイル経由で使用する。JWTはStaging Authの本人一致のみ。旧Point、既存XP、報酬トリガーに書き込まない。検証終了後のユーザー・作成行は削除せず保持する。
- このrunnerは**実アプリHTTP/UIの動作を証明するものではない**。既存の初期化仕様と同じ2テーブルへのatomic SQLと実Auth本人確認を証明するだけ。既存 `formal-new-reader-onboarding.js` をWeb経由で起動・公開するわけではない。
- 対象ユーザーのUUIDはAuth作成APIの最初の成功応答だけを採用し、以後そのID1件に固定。失敗・競合・Partial時に自動再試行・削除はしない。生成UUIDと成否だけをジョブログへ記録し、メール、パスワード、JWT、DB URLを出力しない。

### 将来の別OWNER承認を要する有効化

1. **mainへの反映（別承認）**：GitHubの `issue_comment` はデフォルトブランチ上のWorkflowから実行されるため、Draft PR #2762のコードを保存しただけでは起動できない。PR全体には他の未公開開発が含まれるので、**今回のWorkflow変更だけをmainに反映する必要がある場合は範囲を固定した個別承認**を取る。今回はmain変更なし。
2. **Stagingの実Auth・実JWT・DB書き込み（さらに別承認）**：mainに入口が存在し、Staging環境の各Secretが利用可能であることを**存在有無のみ**確認後、OWNERはIssue #294に下記形式の独立した承認を行う。現在は**承認を与えていない／コメントを投稿していない**。

```text
NOVELIGHT_STAGING_NEW_READER_ONE_APPROVE {"confirmation":"STAGING APPROVED","mainSha":"＜その時点で個別承認したtrusted mainの40桁SHA＞","maxReaders":1,"pr":2762,"referenceAt":"2026-11-10T00:00:00.000Z","scope":"formal-new-reader-one-staging-proof","stagingRef":"wmlzjgvxgoyrovdhbqbg"}
```

このコメントで許可される操作は合成Auth1件作成、同IDで実JWT本人一致確認、Lv.1 / Wallet0の各1行を1トランザクションで初期化・SELECT検証まで。**データ削除、過去Pointの10倍、Point発行/消費、外部交換、有料AI、Preview、Productionの実行は一切含まれない**。

今回の合成局所テストはOWNER・PR・main・人数・Staging・日時・単発利用・2 INSERTと履歴不変更の条件を検証する。`npm exec --offline ... prettier` によるWorkflow YAML構文解析も成功。実Workflow・実DB・実JWTを呼び出したテストではない。
