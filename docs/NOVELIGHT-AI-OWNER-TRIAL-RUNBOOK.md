# NOVELIGHT AI：作品カルテ管理人限定試用・開始前手順

更新日：2026-10-27（JST）

## 現在の境界

作品カルテは既存の「創作ノート」画面に読み取り専用で接続済み。ただし `NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED` は未設定／OFFであり、APIはすべて404で閉じる。本手順書のマージで**試用を開始しない**。

2026-10-27のVercel Production設定名の確認では、`NOVELIGHT_AI_ADMIN_USER_ID` とProduction対象の `SUPABASE_PUBLISHABLE_KEY` が未設定。`NOVELIGHT_ADMIN_USER_IDS`、`SUPABASE_URL`、`SUPABASE_SECRET_KEY` は設定名として確認済み。**値はチャット、PR、ログ、文書へ記録しない。**

AI本体のグローバルスイッチはOFF、個人・全体の日次・月次予算上限は0を維持する。今回の対象は既存登場人物・作者の非公開創作ノート・作品カルテ記録の**読み取りのみ**であり、AI生成、外部送信、課金、クレジット消費、データ編集を含めない。

## 有効化前チェック（すべて必須）

1. 管理人本人のSupabase Auth UUIDを**本人確認済みの値**として取得する。推測やメールアドレスでは代用しない。`NOVELIGHT_AI_ADMIN_USER_ID` をProductionに設定し、同じUUIDが既存の `NOVELIGHT_ADMIN_USER_IDS` の**ID**一覧に明示的に含まれることを検証する。メールのみの管理者許可では試用しない。
2. 対象Supabaseプロジェクトの本番**公開用**キーを `SUPABASE_PUBLISHABLE_KEY` にProductionスコープで安全に設定する。Preview専用キー、サービス秘密鍵、`sb_secret_` を流用しない。本番URLは正しいHTTPS Supabase URLであること。
3. `NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED` は**OFFのまま**必要設定を検証する。必要な環境変数変更、再デプロイ、試用開始はそれぞれ既存のProduction承認ゲートを通す。
4. 最新CI、CodeQL、匿名・別管理者・別作品・本人のアクセス境界、非公開内容の漏洩、no-store、GET限定、ログアウト時消去を確認する。テストで実作品本文・ユーザーUUID・トークンをログ出力しない。
5. 上記条件を満たしたうえで、**別途「管理人限定試用開始承認」**を取得する。承認された場合に限りProductionの`NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED=true` を設定し、許可された手段で再デプロイ、本人の作品だけ表示できることを確認する。

## 即時停止

不具合・情報漏洩疑い・設定不一致のときは、承認された運用経路で`NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED`を未設定／falseに戻して本番へ反映する。APIが404に戻ること、キャッシュが`private, no-store`であること、ログアウト・アカウント切替で表示済みの非公開情報を除去することを確認する。

## 承認の区別

- **本PRの「本番承認」**：認証設定の事前検証・テスト・手順書をmainへマージする承認に限る。
- **管理人限定試用開始承認**：Production設定を変更して管理人本人だけに読み取り専用機能を表示する別承認。
- **「全体公開OK」**：試用後に管理人が実際に合否判定してから一般公開を許可する別承認。

AIモデル接続、global AI ON、予算上限引き上げ、有料API、Stripe、AI Credit、外部AIへの作品送信は上記のいずれにも含まれず、さらに個別の原価・安全承認が必要。Preview/Stagingの実行には独立した「ステージング承認」が必要。
