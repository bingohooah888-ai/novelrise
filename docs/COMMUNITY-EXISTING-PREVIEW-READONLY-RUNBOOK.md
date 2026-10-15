# 交流広場 Phase 1 — 既存Previewを再作成しないread-only検証

## 対象と境界
- 固定済みのVercel Preview: `https://novelrise-ibyeza739-ranobe1.vercel.app`
- デプロイされたFeature SHA: `0fb3cd158c4ef2b16185abb7b628b161cd0f0e92`（PR #2222の履歴コミット）
- 作成元: GitHub Actions run #38788191875。既存PreviewのREADY到達は確認済み。ただし当時の保護環境facts検証はアクセス保護で停止。
- 今回追加するworkflowは**既存PreviewのGETのみ**。新規Preview deployment、Redeploy、post/like/comment、Staging DB fixtureや書き込みを禁止する。

## 証明する内容
1. Issue #188のOWNER投稿 `NOVELIGHT_STAGING_COMMUNITY_REUSE_APPROVE` による、current main SHA、scope、既存Preview URL、固定済み候補SHAの一回限りの承認。過去の承認は再利用せず、ClaimとConsumeを新規記録する。
2. 元のPreview実行が同Issue #188のbotによるCONSUMED記録にあること、およびPreview hostと候補SHAが正式に固定されていること。
3. Vercel Deployment Protectionの自動化用バイパスで既存Previewの環境factsをGETし、`VERCEL_ENV=preview`、候補SHA、実際のapp URL、Staging Supabase URLとpublic keyのfingerprint、server secretの存在、Stripe test modeを照合する。
4. 同Previewの `/api/staging-browser-config` が専用Staging URL `wmlzjgvxgoyrovdhbqbg` とGitHub Environmentのpublishable keyに一致すること。値やbypass secretはログに出さない。
5. 交流広場HTML、共通Preview Supabase bootstrap、交流JS、既定 `timeline:false / board:false` の配信内容をGETのみで照合する。

## 証明しない内容
- 本検証は**PC/モバイル操作試験ではない**。現時点で新機能は公開OFFのため、表示・いいね・コメント・通報・Block/Mute・作者同意操作が実際に成功するとは判定しない。
- 元のコミットを再利用するため、のちにPR #2222を同期・変更した場合、新HEADの実機能証明にもならない。
- Previewページをブラウザで人手操作する場合は、既存のshared `novelight-client.js` が有効にStagingへ差し替えることと、非Production接続・ユーザー認証が実証されるまで書き込みを行わない。
- 今回のワークフローをmainへ導入するには対象PR専用の「本番承認」、実際のStaging read-only検証を行うには別の「ステージング承認」が必要。
- DB公開ゲート、UIフラグは変更しない。Phase 2掲示板は対象外。

## 既存関連の未完了事項
- #2266: Staging永続導入のpostcheck shellで `public_enabled::text` を `false` ではなく `f` と比較した誤判定の修正。DB適用は実際には成功済み。
- #2222: Phase 1機能本体はDraftでProduction未マージ。Production migration/公開フラグ変更はそれぞれ別の承認境界。
