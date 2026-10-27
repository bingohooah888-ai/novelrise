# NOVELIGHT AI Phase 2｜02-07-04 候補の保存・採用・却下 実DB接続準備

日付：2026-10-28 JST

## 到達点

PR #2591で本番反映済みの「管理人の認証・作品照合・AI候補の意思決定」を再利用し、**別工程番号を増やさず**下記の準備をまとめる。

- \`api/_lib/ai/owner-bible-review-repository.js\`：Service-role専用の候補DBリポジトリ。既存の作者JWT RPCで登場人物と非公開創作ノートを確認し、追加の作者確定Factsを取得。候補は自動確定せず \`pending/accepted/rejected\` を独立保持する前提。
- \`api/_lib/ai/owner-bible-review-workflow.js\`：\`list()\` を追加。毎回Auth認証と作品所有権を確認して最大100件だけを返す。本文全文、JWT、Secretはレスポンスに入れない。
- \`api/ai-owner-bible-review.js\`：GETで保留候補、POSTで明示的な採用/却下のみ。新規候補の生成・モデル文章の受付・本文アップロードは禁止。Service-roleはサーバー内のみ。
- \`novelight-ai-bible-review-actions.js\`：管理人画面用の未マウント操作部品。候補はtextContentのみ、手動クリック以外でPOSTしない。サインアウト/認証変更で候補を消去。
- \`reports/sql/novelight_ai_review_candidates_PROPOSAL.sql\`：review候補表、RLS/REVOKE、冪等一括保存RPC、原子的CAS決定RPCの**未実行のSQL設計案**。
- テスト：API既定OFF、CSRF/Origin検証、オーナー権限、RPC呼び出し/項目allowlist、手動UI操作、二重更新、ログアウト消去、SQL設計のアクセス制限。

## 安全と承認（変更しない条件）

1. 本番環境では \`NOVELIGHT_AI_REVIEW_ENABLED\` を追加設定していない（**既定404**）。既存の \`NOVELIGHT_AI_ADMIN_PREVIEW_ENABLED\` と**両方が明示true**でない限り、データ読込・Service-role初期化を行わない。
2. **現行の作者画面から \`novelight-ai-bible-review-actions.js\` は読み込まない**。既存の作品カルテ閲覧は維持し、レビュー用ボタンは見えない。
3. **SQL提案は \`supabase/migrations/\` に置かない**。Supabase CLIで正式migrationを生成し、ステージング承認に紐づくRLS/ROLLBACK試験で検証後、Productionへの別途本番承認を受ける。承認なしにSQLを適用しない。
4. 作品外部送信、モデル呼び出し、AI予算0円、グローバルOFF、AIクレジット、Stripe、作者確定設定への自動昇格は一切変更しない。
5. \`savePendingBatch()\` は内部サーバー生成済みのJSONのみを受ける。一般ユーザーPOSTに入力用の \`modelText\` を設けない。
6. \`accepted\` は候補を作者が確認した状態であり、**作者設定の原本**を更新しない。
7. SQLで候補保存時に作品/話の外部キーは再検査するが、原稿のNode SHA256とDB時点の同一トランザクション確認は未実装。**本文改稿との完全なrace-free保証を謳わない**。実運用前に、話の更新と候補確定の同時実行テスト/ロック戦略を検証する。
8. 本PRを本番に反映しても新APIは既定404、DB側には新テーブル/RPCがないため**機能は起動しない**。SQL設計のままフラグを有効化してはいけない。

## 今後の必要な許可と検証

- **ステージング承認**：対象main SHAと一回限りのDB migration+RLS/rollback試験スコープを確定。実テーブルとRPCのトランザクション整合性、他作者遮断、service_roleのみGRANT、DELETE/rollbackを検証。
- **本番承認**：テスト済みmigrationの本番適用、既存運用へ安全なread-only状態で導入。
- **管理人限定試用承認**：レビューAPIを有効化し、管理人の作品設定画面に操作UIを追加、実作品の許諾/原価/モデルを改めて審査。
- 実モデルを利用する場合は送信対象作品・モデル名・円建て日/月上限・外部送信の同意・期間を定めて別途承認。**全体公開OK**の前に一般公開しない。
- 02-07-04はまだ完了扱いにしない。終了後のみ02-07-05（品質・費用・完成判定）へ進む。

## Rollback

本PRのみなら追加API/リポジトリ/UIスクリプトと \`list()\` メソッドのrevert。DB未変更のためDB rollbackなし。SQLを将来適用した場合はテーブルの候補保全・移行前バックアップ・手順ごとの明示承認を別途必要とする。
