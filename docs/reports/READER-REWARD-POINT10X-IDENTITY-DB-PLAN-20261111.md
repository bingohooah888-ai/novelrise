# NOVELIGHT正式Point：旧ユーザー出所・過去10倍・Staging DB接続（2026-11-11）

対象: 既存Draft PR #2762、開始HEAD `a3faf966b15743dda505803242045089e5308977`。この文書とコードは読み取り専用の計画であり、実行承認ではない。

## 1. 旧ユーザーIDの出所

既に確認済みの実測: `scout_point_ledger` 3,581行／1,605ユーザー、`auth.users` 17、台帳と認証が一致するユーザー1人・不一致1,604人、`profiles`一致0、`user_scout_badges`約91.7万行／6,500ユーザー。台帳`user_id`は`auth.users`を外部キー参照していない。

既存 `docs/STAGING-RUNBOOK.md` に一時的なStaging Auth fixtureを作成・削除する運用がある。`docs/COMMUNITY-STAGING-VERIFICATION-ROUTE.md` に古いPhase1 Stagingスキーマスナップショットの記録がある。しかし、**当該1,604ユーザーについて、Authが欠落したのか、過去のテスト／負荷データなのか、過去に正規ユーザーだったのかを直接特定する証拠は見つからなかった**。現在のStaging Authだけで旧IDを正規／不正規と断定できない。未確認ユーザーの削除・付替え・架空Auth作成・移行対象からの除外は禁止のまま。

## 2. 実際の10倍Migrationの範囲と残り

`supabase_migrations.schema_migrations` の20261109173000 `scout_point_future_rewards_10x` は、既存データへの一括UPDATEではない。`scout_badge_definitions`のreaderカテゴリの今後の報酬を10倍に変更し、レベルアップRPCの新規付与額を5→50とする**将来分のみ**。過去バッジPointは2026年9月の1 Point単位のまま。

既存`beta-point-tenfold-plan.js` の `quoteScoutPointTenfoldValue` を再利用し、新規`formal-staging-point10x-quote.js`で**合計見積りのみ**実施する。現観測の全3,581行が本人所有かつ旧単位という条件を将来証明できた場合、3,581→35,810、差分+32,229 Point。ただし今は1,604人の出所不明、旧・新単位を混ぜる危険あり、当該全件を正式Pointに移行する承認は不可。

将来の変換は、明示的に正規性・出所が確定したユーザーの旧単位Point行だけをイベントIDと状態を保持して一度だけ換算し、すでに10倍の将来報酬は再換算しない。残高と関連する既存バッジ指標・運営調整額は同一スナップショットで整合させる。処理の正本は旧・新台帳の全量整合および既存の一次移行計画とする。**不一致1,604人の証拠がない段階でそれらを除外するSQLは作らない**。

`docs/plans/SCOUT-FORMAL-HISTORICAL-POINT10X-READONLY-20261111.sql`は候補数量のSELECTのみで、UPDATE/Migration/GRANTを含まない。見積りとSQLは実データの全件正当性・認証の出所・切替の一回性を証明しない。

## 3. Staging PostgreSQL接続方式の選択

既存 `api/_lib/reader-reward/formal-application-host.js` と `formal-opening-sync.js` は、外部注入の`pool.query`／`pool.connect`と同一セッションのBEGIN/COMMITを要求している。現在の`package.json`にはPostgreSQL `pg` 依存がなく、正式APIのPGプール起動エントリポイントもない。現行サイトはSupabase JSのHTTPS PostgREST／Authを利用しており、`SUPABASE_SECRET_KEY`は**PostgreSQLログインパスワードではない**。

Staging DBロールの既存事実: `service_role`はNOLOGIN。`postgres`・`authenticator`はLOGIN。専用のformalアプリLOGINロールはない。認証なしに`service_role`をPG USERとして指定しても接続できない。

**推奨する接続案（未設定・未適用）**

- 一度きりのStaging初期同期は、既存の承認済み管理DBセッションでトランザクション実行する方法を優先し、恒久的な本番アプリ接続を作らない。管理DB接続は人間の承認・対象ID・件数固定の操作に限り、Webリクエストには使用しない。
- 将来の正式APIでは、Staging専用の権限を限定したPostgreSQL LOGINとサーバー側TLS接続プール（`pg`など）を、利用可能な既存設定・接続方式に合わせて別途承認・設定する。現時点で存在しない資格情報を想像してコードに埋め込まない。ブラウザは既存Supabase AuthのJWTをサーバーで検証する。匿名ブラウザにDB資格情報を渡さない。
- 既存`service_role` Supabase JWTはPostgREST RPC用で、PostgreSQLトランザクションと同一の接続プールを提供しない。高権限`postgres`を恒久的な公開APIに利用する案も採用しない。
- StagingとProductionを識別するproject refは`wmlzjgvxgoyrovdhbqbg`。接続文字列やパスワードをチャット／Git／ログへ転送せず、実装段階に既存Secretsを参照する。

## 4. 続きで必要なOWNER判断（現時点では未承認）

1. **出所確認**: 既存Staging作成時・データ複製時の証拠、Authバックアップ、旧Point保有者の正規性証明を読み取りで確認する。証拠が出なければ初期同期保留。
2. **10倍変換対象の確定**: 旧PointとAuthの対応および過去1→10単位と将来報酬の境界が検証できたユーザー・イベントを確定。既存の10倍offline quoteと一度限りのStaging実施用SQLを、その確定後に用意する。未特定の1,604人を勝手に省かない。
3. **一括承認の提示**: ①②が揃った時点で、Staging限定の一度きりの旧Point換算、初期LEVEL／ウォレットの対象と上限、管理DBセッションによる単一transactionと読み取り後確認、限定実JWT試験の範囲を**具体的な対象・接続先・回数**で一括提示。接続ロールを新設する場合はそれ自体別の明示承認とする。
4. 実Point発行・消費、正式報酬トリガー有効化、外部交換、有料AI、Production、main、Previewはこれらの承認にも含めず別判断。

追加したのは局所的な非実行見積りとSELECT案のみ。新規PR・Workflow・監査基盤、DB更新、実JWT、秘密情報取得なし。
