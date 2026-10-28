# NOVELIGHT AI Phase 2 / 02-07-04｜Migration parity + evidence guard

更新: 2026-10-28 JST。02-07-04の**同じ工程**で行う安全補強。追加工程番号なし。

## PR #2596後の現在状態（読み取り専用）

GitHub main \`dad3a690b831165b2afbaec2868905ee963fb48e\`、Supabase staging \`wmlzjgvxgoyrovdhbqbg\`、Supabase Production \`fiepaguycecrredwrcwx\`について、**移行ファイルのバージョン番号を206件すべて比較して完全一致**を確認した。

過去の \`Supabase Preview\` は \`Remote migration versions not found in local migrations directory.\` として失敗しており、その**履歴チェック結果は失敗のまま**。一致の回復は読み取り専用で検証済みだが、新しいSupabase Previewが自動的に成功したとは扱わない。

2026-10-28 Stagingで手動適用した2マイグレーションは、レビュー候補0件・既存小説15/話6件を確認した上で、一度限りのトランザクションロールバックにより完全撤収している。**本番DBのテーブル、migration履歴、AI予算0円には変更なし。**

## このPRの補強内容

1. **SQL内でも偽引用を拒否**：\`reports/sql/novelight_ai_review_candidates_PROPOSAL.sql\` の一括保存RPCで、候補の \`evidence\` が現在の原稿本文に厳密に含まれるか \`strpos\` で検査する。key/summary/evidence の空白のみの値も拒否する。既存の4KB分割検証・Node側の根拠検証・話タイトルと本文SHA256・行ロックに追加する防御層であり、AIから作者設定への自動昇格はしない。
2. **読み取り専用移行履歴の照合スクリプト**：\`scripts/check-ai-review-migration-parity.mjs\`。GitHubの \`supabase/migrations/\` 内の14桁バージョン、事前にエクスポートされた staging/prod 版一覧を比較。バージョン数が同じでも内容が違えば失敗、未登録の staging マイグレーションがあれば exit 1。DBには一切接続せず、秘密鍵も扱わない。
3. **自動テスト**：正常な206件比較、リモート側への見知らぬ追加2件、バージョン重複、不正形式、SQLの引用チェックと権限境界をオフラインで検証。

## 運用

最新のステージング/本番 \`supabase_migrations.schema_migrations\` を**読み取り専用**で取得し、GitHubで管理している \`supabase/migrations\` にあるバージョン番号と照合する。

\`versions.json\`の例:

\`\`\`json
{"migrations":[{"version":"20261027090000"},{"version":"20261027120000"}]}
\`\`\`

（実運用には省略なしの全バージョンが必要。）

\`\`\`bash
node scripts/check-ai-review-migration-parity.mjs staging-versions.json production-versions.json
\`\`\`

このスクリプトにはネットワーク機能がなく、自動でSupabaseへアクセスするものではない。**DBの一覧取得と同期の運用責務は引き続き承認済みの読み取り専用ツールにある**。

## 承認・残条件

- SQL案は \`reports/sql\` に留め、\`supabase/migrations\`へは置かない。GitHubへのPRマージでも本番DBにmigrationが実行されない設計を維持する。
- 既存stagingは撤収済みなので、更新した引用拒否SQLの**実DBでの再試験はまだ行っていない**。今後の適用にはステージング変更の別承認が必要。
- **実際の2セッション同時更新と原稿改稿の競合試験、HTTP/JWTのE2E**も未完了。合格と記載しない。
- 本番DBへの導入前には、GitHub正式migrationファイル作成・PR影響範囲・Supabase GitHub Appの自動適用動作を確定した上で、**別の本番DB承認**が必要。
- 有料AI・実作品の外部送信・作者向けボタン公開・グローバルAIスイッチ・予算設定には一切触れない。
