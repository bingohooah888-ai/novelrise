# NOVELIGHT AI 02-07-04｜管理人限定・実AI試用の最終接続ゲート

状態：**コード準備のみ。Staging/Productionとも試用開始未承認**（2026-10-31）。

## この変更で到達する範囲

- `api/ai-owner-bible-analyze.js` が、既存の認証済みHTTP APIから、既存の同意正本→原価Router→試用処理→作者確認待ち候補保存へ接続できる。
- 追加ゲート `NOVELIGHT_AI_TRIAL_LIVE_BINDING_ENABLED` はデフォルトOFF。その他7個の既存フラグもすべてONでなければ接続を構築しない。
- 許容する対象は**管理人本人の作品1つ・話1つ・先頭チャンクのみ**。試用設定の有効期限は最大24時間。
- モデルと送信先はOpenAIまたはGeminiの承認済み1〜2ルートのみ。公開鍵とJWTは本人用RPCへ、秘密鍵はserver-onlyへ分離する。
- 許諾済みの処理事業者の集合が選択したモデルの送信先と**完全一致**しない限り実行不可。既存のDB同意正本を毎回参照し、取消時は拒否する。
- Routerの最大36,000 UTF-8 bytesと各ルートの最大出力トークンに基づく**fallback合算の最悪予算予約額**が、個別承認したリクエスト上限以下であることを確認。設定できる上限は最大50円/リクエスト。ただし50円は**支出許可ではない**。既存DBのglobal switch/個人・全体日次月次上限は別途OFF/0を維持する。

## 必須設定名（値・鍵はGitHubやログに記録しない）

### フラグ（すべて文字列 `true` 必須）

`NOVELIGHT_AI_ENABLED`, `NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED`, `NOVELIGHT_AI_REVIEW_ENABLED`, `NOVELIGHT_AI_MODEL_TRIAL_ENABLED`, `NOVELIGHT_AI_EXTERNAL_PROCESSING_APPROVED`, `NOVELIGHT_AI_CONSENT_UI_ENABLED`, `NOVELIGHT_AI_CONSENT_SERVER_RUNTIME_ENABLED`, `NOVELIGHT_AI_TRIAL_LIVE_BINDING_ENABLED`。

### 所有者・DB・モデル

- `NOVELIGHT_AI_ADMIN_USER_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`：既存の本人限定設定に従う。
- `NOVELIGHT_AI_CONSENT_POLICY_REVISION`, `NOVELIGHT_AI_CONSENT_DISCLOSURES_JSON`：法務・事業者条件をレビューし、実際の送信先・保持・移転条件を正しく記述した同意説明。テスト文言の流用禁止。
- `NOVELIGHT_AI_TRIAL_ROUTES_JSON`：承認済みの1〜2ルート。各ルートに `provider`（openai/gemini）、`model`、`inputMicrosPerMillion`、`outputMicrosPerMillion`、`maxOutputTokens` の5項目が必須。料金は **micro-JPY / 100万トークン**。公式料金・為替・バッファを別途検証し、固定額を推測で設定しない。
- `OPENAI_API_KEY` / `GEMINI_API_KEY`：選択した事業者分だけServer-sideに登録。鍵値を表示・コミットしない。
- `NOVELIGHT_AI_TRIAL_ALLOWED_NOVEL_ID`, `NOVELIGHT_AI_TRIAL_ALLOWED_EPISODE_ID`：管理人本人の明示承認対象。
- `NOVELIGHT_AI_TRIAL_ALLOWED_CHUNK_INDEX=0`
- `NOVELIGHT_AI_TRIAL_MAX_REQUEST_MICROS`：1リクエストあたり承認上限。**1円=1,000,000 micro-JPY**。
- `NOVELIGHT_AI_TRIAL_EXPIRES_AT`：UTCのZ付きISO時刻。設定時点から24時間以内。

## 未承認・未実施の項目

1. 実事業者とモデル・最新価格・データ送信先・R18扱い・保持・越境移転条件の確認と管理人承認。
2. Staging専用の本人JWT、作品/話、同意画面、レビュー保存、RLS/cleanupの実環境テスト。**別の1回限りStaging承認が必要**。
3. 金額上限・対象作品・期限を指定した**実API試用承認**。事業者のAPI呼出しや予算ONはこのコードマージだけでは承認されない。
4. 管理人が創作室から実際に操作できるUIの最終確認と品質・原価測定（02-07-05）。

## 安全境界と停止方法

- フラグ未設定・同意不一致・予算0・本人/作品/話数不一致・有効期限切れでは実行不可。
- 緊急停止は `NOVELIGHT_AI_ENABLED=false` にし、DBのglobal AI switchをOFFにして予算上限を0に戻す。環境設定を変えた場合のデプロイ反映も確認すること。
- 本PRはStaging実行、モデル接続、Secret設定、課金、DB変更、公開、原稿送信を行わない。
- mainマージにはPR番号指定の本番承認が必要。管理人試用・一般公開・費用利用はそれぞれ別承認。

**02-07-04の合格判定は、本人限定のStagingで実AI抽出→根拠検証→候補保存→作者レビューまで実証した後。** このPR単体では完了を宣言しない。
