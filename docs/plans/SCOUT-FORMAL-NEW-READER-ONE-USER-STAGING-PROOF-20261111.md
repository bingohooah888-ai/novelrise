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
