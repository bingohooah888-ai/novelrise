# NOVELIGHT AI 02-07-05｜既定解析API接続・OWNER Staging workflow安全境界

作業基準 main：`d99087b04b042b46aa49ba4f773ee9a1debd9a67`。日付：2026-11-01 JST。
状態：**専用ブランチ上の実装・無課金CIのみ。LIVE外部AI試行はNO-GO**。

## 実装した範囲

- `api/ai-owner-bible-analyze.js` の**既定HTTP bridge**を、旧 `createOwnerNovelBibleLiveTrialBridge()` から `createOwnerNovelBible020705GuardedLiveTrialBridge()` へ変更。旧factoryは単体試験用に残すが**公開HTTPの既定経路から利用しない**。
- `api/_lib/ai/owner-novel-bible-020705-guarded-live.js` は従来の8個の独立フラグに加え、`NOVELIGHT_AI_020705_ONE_SHOT_ENABLED`、Staging Supabase URL、`VERCEL_ENV=preview`、main/deployment IDの現行実体照合、固定単一OpenAI `gpt-5.6-luna`、リクエスト上限10円、最大1時間、1作品・1話・chunk=0、Issue #294のOWNER承認ID・GitHub Actions run IDをすべて必要とする。**欠落・不一致はnull/503、モデルAPIへの送信0**。
- `.github/staging-ai-02-07-05/owner-paid-trial-ledger.mjs` の追加read-only検証で、GitHubのOWNER本人による正確なscope承認コメント、`github-actions[bot]` が付けた同一runのCLAIMEDが一件だけ存在し、まだCONSUMEDではないことを検査する。GitHub API読み取り障害・不正/重複・期限切れは遮断する。
- 認証後に渡される**実際のservice client**のURLもStaging専用と照合し、PR #2720の `createPaidTrialOneShotOpenAiProvider()` で**外部POST直前の原子的RPC claim**を必ず通す。既存Routerの予算予約・同意・原稿改稿チェック・review永続化は保持。複数プロバイダーとfallbackは拒否。
- `.github/staging-ai-02-07-05/approved-stage-coordinator.mjs` はOWNERの GitHub CLAIM→DB one-shot guarded provider→停止→合成cleanup→独立最終census→必ずGitHub CONSUMEDという実行フローの**未接続コア**。合成Nodeテストでsuccess/timeout/census失敗/再試行拒否を検証する。
- `.github/workflows/ai-020705-owner-staging-paid-trial.yml` は**手動OWNERのみの読み取り専用Staging事前審査ワークフロー**。main HEAD、承認scope、GitHub OWNERコメントを確認しても、**CLAIM/実JWT/Secret読取/DB書込/外部AI POSTは行わない**。別のOWNER承認と実行アダプター整備を経るまでは起動モードを増やさない。

## 今回の非実行事項と残るブロッカー

1. **まだ有料試験できない**：Staging専用の実Preview（新mainと一致）、保護されたStaging secrets、費用・同意・実モデル利用資格、Staging migration `20261101060000_novelight_ai_020705_one_shot_claim.sql` の別承認適用、ステージング環境のAI ON/予算設定、実JWTが未承認・未検証。
2. **専用のlive executor/clean-up callback wiringが残る**：現ワークフローは読み取り専用審査まで。GitHub owner-ledgerのCLAIM/CONSUMEDを失敗時も適切に永続化し、Staging Preview設定を停止できるprotected runner・操作権限・秘密値を追加するには別PR／承認が必要。既存合成cleanupモジュールは現在inactive。
3. **StagingでのSQL原子性・実ユーザーセッション失効・費用請求・クリーンアップは未実証**。CIの合成テストPASSをこれらの実証とみなさない。
4. **既存HTTPハンドラーのテスト注入入口は単体試験用に維持**。実サーバーのdefault exportのみ安全なbridgeへ差し替えたことをコードで確認。将来別の実HTTP routeから旧factoryを直接利用する追加変更は禁止・CI監査が必要。
5. GitHub公開コメントをHTTP側で照合する設計は、GitHub APIの読み取りレート制限/障害時に**API利用不可を優先**する。漏洩・回避のために承認結果を長期間キャッシュしない。

## 次の承認順序

1. 本PRは**Draft**でCIとセキュリティ境界を確認する。main統合にはPR exact HEADへの別承認が必要。
2. Staging専用live runnerと環境停止callback配線の追加は次の最小PRで実装し、別承認する。実稼働前にgit SHA/Preview、Supabase project ref、GitHub ledger、同意版、請求上限10円/1時間/1回を改めて照合。
3. **新Preview作成承認**、**Staging DB migration/必要な合成書き込み承認**、**実JWT・外部AI最大1回・最大10円承認**は、それぞれ別のscopeでOWNER承認を取得する。ProductionのDB・Vercel環境変数・Stripe・一般公開は別件で今回の対象外。

**NO-GOのまま**：main統合、新Preview、Staging/Production DB書込、Vercel環境変数変更、Stripe、実JWT、有料AI、AI機能有効化は本PRで実施しない。
