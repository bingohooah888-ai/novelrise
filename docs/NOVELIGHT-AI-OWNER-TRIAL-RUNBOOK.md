# NOVELIGHT AI：作品カルテ管理人限定試用・開始前手順

更新日：2026-11-01（JST、02-07-04 Staging合格・Production読取監査を追記）

## 2026-10-27時点の準備記録（以下の旧状態は現在の証明ではない）

作品カルテは既存の「創作ノート」画面に読み取り専用で接続済み。2026-10-27当時は `NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED` を未設定／OFFとしてAPIを404で閉じる前提であった。本手順書のマージだけで**試用を開始しない**。

2026-10-27にProductionの `NOVELIGHT_AI_ADMIN_USER_ID` と `SUPABASE_PUBLISHABLE_KEY` を登録済み。ただし現在の稼働デプロイはその登録より前に作成されており、再デプロイするまで有効化に必要な設定が反映されているとは扱わない。管理人本人のUIDは管理操作監査ログの単一実行者と照合済み。共有 `NOVELIGHT_ADMIN_USER_IDS` に本人IDが含まれていないことを確認したため、**共有管理者権限を追加せず、作品カルテ専用のUID照合を使用する**。UUIDや設定値をチャット、PR、ログ、文書に記録しない。

AI本体のグローバルスイッチはOFF、個人・全体の日次・月次予算上限は0を維持する。今回の対象は既存登場人物・作者の非公開創作ノート・作品カルテ記録の**読み取りのみ**であり、AI生成、外部送信、課金、クレジット消費、データ編集を含めない。

## 2026-11-01 現行証跡（読み取り専用、承認や再実行の代用ではない）

- **検証合格の範囲**：GitHub Actions [#41263146000](https://github.com/bingohooah888-ai/novelrise/actions/runs/41263146000)、main `c59b0038e06816ace42cdf2e50e24a2c02fb5927`、Preview `dpl_EQij5nLkYSiha2Yn4UyGYs9pszwu`。合成データのみで実JWT認証、採用HTTP成功、候補 `accepted/revision=2` のDB永続化、pending 0件、別セッションJWTの有効性、作者候補一覧0件を検証した。`POST_BROWSER_PERSISTENCE_PASS`、`REVIEW_CANDIDATE_PERSISTENCE_PASS`、`FINAL_CENSUS_PASS`、`STAGING_AI_020704_HOSTED_BROWSER_REVIEW_PASS` を記録。最後の合成データ残留は0件。承認は成功として消費済み。
- **このPASSの対象外**：外部AIモデルの有料送信、実原稿、AI推論品質、二接続での改稿競合、長編性能、AI Credit購入、ProductionでのHTTP/API/DB動作、一般公開。02-07-05の品質・原価・安全性検証と個別承認は引き続き必要。
- **Production環境設定メタデータの現行観測**：Vercel project `prj_SmotUNrcyuUntdWTayzWeJ8eQGqe` のProductionスコープで `NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED=true`（plain）を確認。`NOVELIGHT_AI_ENABLED`、`NOVELIGHT_AI_REVIEW_ENABLED`、同意UI・モデル試用・外部処理承認・live bindingフラグ、OpenAI/GeminiキーはProductionスコープの登録を確認できなかった（値の復号なし）。`true` 設定は管理人UI/外部AIが公開済みとの証明ではない。
- **Productionデプロイの識別**：`novelight.jp` のVercel READY deployment `dpl_CwDpFna7L6FABmdikX2pxySVgjE5`、ビルドSHA `3b4e6f867816e4a4644a43e5310a195155e3dee8`。現在のGitHub main `c59b0038e06816ace42cdf2e50e24a2c02fb5927` とは異なる。mainの安全テストPASSをProductionのHTTP動作PASSへ流用しない。
- **未確認事項**：公開APIへの匿名HTTP応答は今回の読取経路で取得できず未検証。Production DBのAI runtime enabled・個人/全体予算0円・同意/候補migrationの現在状態も未実査。Stagingの予算0円PASSをProductionのDB設定確認と混同しない。これらの確認に別途実行が必要な場合は、通常の承認境界を守る。
- **02-07-05の無課金検証**：既存のNode合成テストに、モデル処理中のセッション切替・エピソード変更時の保存拒否、再試行後の使用量不明時の合算上限精算、複数ルートの保守的な原価見積もりを追加する。モデル・ネットワーク・DB・実予算へのアクセスなし。CI合格は実API・実請求の試験に代わらない。

古い報告書に「Staging未実施」とある場合も、その文書の時点・対象を特定し、上記の最新RUN証跡を優先する。公開設定の意図が未確定の間は設定変更や管理人試用開始を実施しない。

## 有効化前チェック（すべて必須）

1. 管理人本人のSupabase Auth UUIDを**管理操作の監査証跡と一致した本人確認済みの値**として取得し、Productionの `NOVELIGHT_AI_ADMIN_USER_ID` に設定する。作品カルテ専用のサーバー認証でSupabase AuthのBearerを検証し、そのUIDが上記IDと完全一致することを確認する。**共有 `NOVELIGHT_ADMIN_USER_IDS` へ追加しない**。未ログイン、別の管理者、別作品の作者は拒否する。
2. 対象Supabaseプロジェクトの本番**公開用**キーを `SUPABASE_PUBLISHABLE_KEY` にProductionスコープで安全に設定する。Preview専用キー、サービス秘密鍵、`sb_secret_` を流用しない。本番URLは正しいHTTPS Supabase URLであること。
3. `NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED` は**OFFのまま**必要設定を検証する。必要な環境変数変更、再デプロイ、試用開始はそれぞれ既存のProduction承認ゲートを通す。
4. 最新CI、CodeQL、匿名・別管理者・別作品・本人のアクセス境界、非公開内容の漏洩、no-store、GET限定、ログアウト時消去を確認する。テストで実作品本文・ユーザーUUID・トークンをログ出力しない。
5. 上記条件を満たしたうえで、**別途「管理人限定試用開始承認」**を取得する。承認された場合に限りProductionの`NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED=true` を設定し、許可された手段で再デプロイ、本人の作品だけ表示できることを確認する。

## 即時停止

不具合・情報漏洩疑い・設定不一致のときは、承認された運用経路で`NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED`を未設定／falseに戻して本番へ反映する。APIが404に戻ること、キャッシュが`private, no-store`であること、ログアウト・アカウント切替で表示済みの非公開情報を除去することを確認する。

## 承認の区別

- **作品カルテ専用認証PRの「本番承認」**：作品カルテだけに限定したUID照合と安全テスト・手順書をmainへマージする承認に限る。
- **管理人限定試用開始承認**：Production設定を変更して管理人本人だけに読み取り専用機能を表示する別承認。
- **「全体公開OK」**：試用後に管理人が実際に合否判定してから一般公開を許可する別承認。

AIモデル接続、global AI ON、予算上限引き上げ、有料API、Stripe、AI Credit、外部AIへの作品送信は上記のいずれにも含まれず、さらに個別の原価・安全承認が必要。Preview/Stagingの実行には独立した「ステージング承認」が必要。
