# NOVELIGHT AI — 02-07-04 管理人限定試用の実行前チェック（2026-10-30）

**状態：readiness inventory / 未承認・未起動。** 本文のチェックは実行許可ではない。正本 \`docs/NOVELIGHT-MASTER.md\` 冒頭8原則および第47章、\`docs/WORK-EXECUTION-PREFLIGHT.md\` を優先する。

## 既存のコード証跡

| 境界 | 既存の入口 / 根拠 | 現状 |
|---|---|---|
| 管理人専用POST API | \`api/ai-owner-bible-analyze.js\`（#2665） | 5フラグ初期OFF、\`createTrialBridge=null\`。本番ではAI実行不可 |
| 解析・根拠・再認証 | \`api/_lib/ai/owner-novel-bible-model-bridge.js\`（#2661） | サーバー内部のみ、モデル未接続 |
| 作者レビュー | \`api/_lib/ai/owner-bible-review-workflow.js\`、\`owner-bible-review-repository.js\` | 内部のみ。候補は作者の正式設定に自動昇格しない |
| 予約・精算・監査 | \`api/_lib/ai/router.js\`、\`supabase-store.js\` | 既存の原子的RPCを呼ぶ設計。Staging／Productionの現行DB状態は本表だけでは証明できない |
| 試用処理の構成 | \`api/_lib/ai/owner-novel-bible-trial-runtime.js\`（#2667） | 内部のみ。実行は別途明示承認が必要 |
| 作者JWT用クライアント | \`api/_lib/ai/owner-novel-bible-author-client.js\`（本PR） | 公開可能鍵とリクエスト固有JWTでクライアント生成／再認証。HTTP APIへ未接続 |
| レビュー候補DB | \`reports/sql/novelight_ai_review_candidates_PROPOSAL.sql\`、Draft PR #2601 | draft／既存のStaging検証履歴あり。現在のStaging・Production適用は改めて読み取り専用で照合が必要 |

## 次の一括Read-only preflight — 承認前に確定すること

1. **環境識別**：Supabase Staging/Production のproject参照、Vercel Preview保護、接続先、必要環境変数の存在・対象環境を**値なしの有無・分類のみ**で照合。認証情報・JWT・原稿は表示／保存しない。
2. **DB前提**：候補テーブル、\`novelight_ai_review_stage_batch\` / \`novelight_ai_review_decide\`、\`novelight_ai_reserve_usage\` / \`novelight_ai_settle_usage\`、監査表、Chapter 43作者専用RPC、関連RLSとmigration履歴を対象Stagingで読み取り専用確認。Draft #2601をProductionへ推定適用しない。
3. **同意の正本**：作者が「外部AIによる作品カルテ解析」目的と送信先・保持条件を明示許可できる保管／撤回仕様を先に確定する。現在の \`permissionCheck\` は注入コールバック**だけ**であり、承認済み永続同意システムを意味しない。未実装・不明なら外部送信を拒否。
4. **課金停止条件**：global AI OFF／予算ゼロを維持。試用候補モデルの事業者規約・現行価格・越境移転・保持／削除・R18取り扱い、入力・出力上限、フェイルオーバー、予約／精算の原子的上限・監査・緊急停止を承認前に整理。過去の原価試算は支出許可ではない。
5. **安全な作者認証**：既存管理画面でだけ操作可能とし、サーバーが都度Auth、作品所有権、改稿ハッシュ、同意を送信前後に検証。作者RPCはJWT＋publishable keyで実行し、service_roleで代行しない。ログは sanitized stage / error code / correlation ID のみ。
6. **後片付け**：架空作品・試験レコード・予約・候補・セッションの作成対象を事前に明示し、停止／失敗時のcleanupと残留検査を独立させる。

## ステージ別の未実施事項

- **offline**：上記の作者JWT factoryはテスト用モックのみ。実際のSupabase Auth / RPC契約・RLSの成功は未確認。
- **Staging**：本PRではPreview発行、実JWT、DB書き込み、課金プロバイダー通信を行わない。別の対象限定・main SHA固定・1回限りの「ステージング承認」が必要。
- **Production**：本PRのmain統合は番号指定の「本番承認」まで保留。統合によるVercel自動ビルドの可能性はあるが、実AI・公開フラグ・予算は変更しない。
- **管理人試用**：モデル・最大JPY支出・対象作品・同意・期間・緊急停止・後片付けを特定した**別の明示承認**を取るまで実行しない。
- **一般公開**：管理人本人による合否判定と「全体公開OK」があるまで行わない。

**Phase 02-07-04完了とはしない。** 次工程は未完成の同意／DB／管理人UIの実装と、承認後のStaging実証である。
