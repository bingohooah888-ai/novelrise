# NOVELIGHT AI 02-07-04 — 同意DB Staging実証前チェック（2026-10-30）

**状態：Staging未検証／Production未変更。** 本文は実行許可ではない。

## 読み取り専用で確認済み

- 最新main起点：7d8a35e65ff33bfbb9c0033c6616e27a150ef323（PR #2675）。
- Supabase接続から見えるprojectは novelrise／ref fiepaguycecrredwrcwx の1件のみ。Productionの接続先と一致。**独立Stagingのrefは現接続から確認できない**。Stagingが存在しないとは断定しない。
- Production DBの既存型：novels.id, episodes.id, episodes.novel_id は bigint、novels.user_id は uuid。pgcrypto のschemaは extensions。
- Productionには同意テーブル・監査テーブル・同意grant/revoke RPC・レビュー候補テーブル・stage/decide RPCはまだない。AI費用reserve/settle RPCは存在する。
- 同意SQL提案書でPL/pgSQLの引用符が欠落し、policy_revision の正規表現途中に説明コメントが混入していた。今回、原案を修正し、静的回帰テストを追加。**PostgreSQLでの構文実行やRLS検証が通ったことを意味しない。**
- 既存の scripts/verify-staging-migration-target.mjs はProduction refを拒否する。scripts/staging-candidate-sql.mjs と scripts/staging-candidate-persist-sql.mjs は承認済みStaging作業の別々のcomposeルート。新しい実行ワークフローは作らない。

## この準備PRの範囲

1. reports/sql/novelight_ai_external_consent_PROPOSAL.sql のSQL構造を修復。BEGIN／ROLLBACK、SECURITY INVOKER、service_role限定、RLS、AI OFF維持。migrationには追加しない。
2. tests/ai-owner-bible-consent-sql-structure.test.mjs：関数2本の完全なdollar-quoting、grant正規表現、RLS・権限・監査・rollbackを静的検証。DB実行検証の代替ではない。
3. reports/sql/novelight_ai_consent_STAGING_METADATA_READONLY.sql：独立Staging用のSELECT-onlyメタデータ検査。ユーザー原稿、同意レコード、Secretは取得しない。

## 将来のStaging実証前の条件（別途承認）

1. **独立Stagingの実体確認**：接続先project refとURLがProduction ref fiepaguycecrredwrcwx と異なり、verify-staging-migration-target.mjs に合格すること。現状未確認。Production接続を代用しない。
2. **対象固定**：その時点の最新main SHA、作業PR HEAD、SQL blob SHA、独立Staging ref、候補migration version、実行回数とscopeを指定。SHAやscopeが変更されたら新承認。
3. **read-only整合検査**：本PRに含むSTAGING_METADATA_READONLY.sqlでowner列型、同意・候補テーブル存在、RLS、RPC signatureとEXECUTE権限を確認。Stagingのmigration ledgerも確認し、漂流があれば停止。
4. **段階的なDB検証**：最初は独立Stagingでrollback-onlyの構文・権限検証（個別のステージング承認が必要）。永続migrationは別の承認とし、正式なmigrationを新規生成してreviewしたのち適用。SQL proposal のROLLBACKをCOMMITへ置換して直接適用しない。
5. **認可・競合テスト**：架空ユーザー・架空作品だけで、anon／他人／別作品へのアクセス拒否、grant→read→revoke→read、processor別拒否、撤回競合、期限切れ、改定版不一致、RLS、操作監査を確認。実AIプロバイダーは呼ばない。
6. **cleanupと残留検査**：作成対象IDと試験前件数を控え、rollbackまたは別途承認された対象ID限定の削除後、残留件数がゼロである証拠を残す。他のユーザー／作品／予約は削除しない。
7. **作者同意UIと実AIは別工程**：送信目的、事業者、保持・削除、国外移転、R18の正式な説明確定後に管理人本人の創作室だけに接続。モデル接続、予算変更、実原稿送信はさらに独立承認が必要。

## 停止条件

- Staging識別不能、Production refと一致、環境変数不備、migration差分、RLS・cleanup不備、対象SHA変化、秘密情報露出の可能性があれば停止。
- 『続けて』や以前の『本番承認』はStaging DB mutationや実JWT試験の承認ではない。MASTER冒頭の2026-10-29品質8規則を優先する。
