# NOVELIGHT AI 02-07-05｜1回限定の有料合成試行：安全機構実装レポート

更新日：2026-11-01 JST。基準main：`9104259a59a5dc568c659a2b598d2d6d5d94f0dc`。
**状態：コード実装・無課金テスト候補のみ。実環境/Production未検証、実API試行未承認、未公開。**

## 1. 今回追加した専用の安全機構

1. `supabase/migrations/20261101060000_novelight_ai_020705_one_shot_claim.sql`：別承認後に**Stagingにのみ**適用する候補migration。service_role専用の `novelight_ai_020705_claim_once` RPCと、固有のOWNER承認comment ID／main SHA／Preview ID／作品／話で一意制約を持つ消費台帳。並列/再送はPostgreSQLの原子的 `ON CONFLICT DO NOTHING` により2回目を拒否する。既存AI runtimeのONと日次/月次予算10円以下も検査。現時点ではDB未適用。
2. `api/_lib/ai/paid-trial-one-shot-provider.js`：**未接続**のserver-only OpenAIアダプター。Staging Supabase URL（実clientのURL含む）、Preview identity、承認scope、1モデル、expiry 1時間以内、予算10円以内がすべて合う場合にのみ構築。外部POSTの**直前**に上記RPCを呼び、真の新規claim成功時だけモデルへ渡す。DB outage、重複claim、モデル違いはモデル呼出し0。プロバイダーのtimeout/5xxでも自動retryしない。
3. `.github/staging-ai-02-07-05/owner-paid-trial-ledger.mjs`：既存02-07-04承認とは名前空間を分離。GitHubのOWNER本人による、1回の合成有料試行を正確なmain/Preview/owner/作品/話/同意版/金額/期限へ束縛するJSONコメントの読取・CLAIM・CONSUMEDを担当。**GitHub側のissue_comment workflowへは未接続**。callerが対象issue/OWNER/承認コメントを信頼できる形で取得し、workflowのconcurrency groupで承認台帳操作を直列化する必要がある。GitHubコメント単体はDBの代替にならない。
4. `.github/staging-ai-02-07-05/paid-trial-cleanup-runner.mjs`：**CLI入口なし**の単発処理コア。正規のone-shot providerでなければ拒否。1回だけモデルへ委譲した後は成功・timeout・例外に関係なく、`stop`→`cleanup`→`finalCensus` の順にすべて試行し、どれか1つでも不合格なら処理失敗のまま維持する。
5. `.github/staging-ai-02-07-05/staging-synthetic-cleanup.mjs`：Staging client URLを照合したうえで、`internal_e2e` と合成メールで認証したユーザー／所有作品だけを対象にDB runtime全上限0、外部AI起動停止callback、usage履歴の限定delete、合成novel削除（既存FK CASCADEで章・候補・同意・同意監査を削除）、合成Auth削除と独立censusを提供。**外部AI起動フラグ停止・サーバー側認証セッション失効・プロバイダー料金の最終照合などの実行アダプターは承認後のprotected runnerで接続する必要がある。**

## 2. 永久保存する最小の消費証跡と「cleanup」の定義

- これまでの02-07-04と同じく、合成Auth/works/episodes/analysis/candidates/consent/consent audit/usage request/usage audit/セッションは**最終0件**を必須とする。
- ただし02-07-05の**有料外部POST消費claimだけは1件の非機密tombstoneを残す**。これは原稿・認証情報・メールアドレスを含まない最小記録で、削除すると同じ承認で外部POSTを再送できてしまうため必須。最終censusは「合成残留0件＋承認消費tombstoneちょうど1件＋runtime OFF/予算0円」が合格基準。GitHubのCLAIM/CONSUMEDも監査目的で保存する。
- 外部AI事業者側の監視ログはDB削除で消せない。APIの `store:false` は即時完全削除を意味しない。

## 3. 設計・試験の厳格な限界

- 今回の部品は**本番HTTPの解析APIや既存実モデルtrial bindingに接続していない**。新しいmigrationも適用していない。**現状の既存trial APIに上記one-shotが効くと主張してはならない。**
- 有料試験の実行開始には、現在のowner試用APIから本guardへの**必須配線**と、古い無guard経路をfail-closed化する別途コードレビュー・CIが必要。特に新たなStaging Previewの設定ではguardを通らないモデル呼出しが存在しないことを独立確認する。
- 追加するProtected GitHub Actions workflowは、OWNERだけがissue_commentから一意に承認でき、対象main HEAD・Staging deployment・DB ref・ロック/CLAIM/CONSUMEDを一致させること。**今回workflowは作成も稼働もしていない。**
- DB migrationを将来Productionで自動適用してはならない。Staging適用はexact SHA・project IDと1回限りの別承認が必要。ProductionはAI OFF/予算0円を維持する。
- SupabaseのRPCはservice_roleだけで実行可能とする。public/anon/authenticatedにEXECUTE/SELECT/DELETEを付与せず、RLSを有効にする。
- OpenAI model `gpt-5.6-luna` の最新公式料金/利用資格/region/利用規約/実アカウント上限、合成作者の明示同意と許諾、Providerのログを確認するまではNO-GO。最新の公式価格を承認金額へ再反映する。見積2.53円は実請求保証ではない。

## 4. 必要な承認を区別する

1. **このPRのmain統合**（HEAD SHA限定）：コードと文書の統合のみ。既存の自動Productionビルドの可能性を説明し、有料試験の承認とは別。
2. **guardを既存AI trial entrypointへ強制接続する実装PR**（無課金のfocused tests、未承認の有料APIは呼ばない）。
3. **新Previewの生成承認**（exact main SHA／Staging branch／1回）、**Staging専用migration書込み承認**（exact migration／project／1回）を個別に取得。
4. **保護された有料試行workflow・cleanup実行配線の実装PRとレビュー**（GitHub OWNER ledger、GitHub Actions concurrency・environment staging、原価アカウント制御、Secretの非表示、完全なcleanupと独立census、失敗時CONSUMEDを確認）。
5. **初回の実JWT・OpenAI実モデル1回・10円以内・1時間以内のStaging実行承認**。承認は exact SHA、Preview ID、project ref、actor・novel・episode・policy revision・モデル・原価と期限に縛る。失敗でも使用済み、繰り返し禁止。

**結論：現時点で有料試行はNO-GO。** 今回はAtomic Claim・OWNER Ledger・失敗時Cleanupの**未接続・未稼働の部品と無課金テスト**までが作業範囲。
