# NOVELIGHT AI 02-07-04｜候補レビューSQL・ステージング検証ゲート

確認日: 2026-10-28 JST  
種別: FULL PREFLIGHT / **未適用のDB SQL案・準備文書**  
mainの監査基準: \`e9c66673448a18ec34e30bf628a6525f8255912b\`

## 環境の特定（読み取り専用のメタデータで確認）

- Production Supabase project: \`fiepaguycecrredwrcwx\`（**一切変更しない**）
- 別ステージング Supabase branch ref: \`wmlzjgvxgoyrovdhbqbg\`（名称 \`staging\`、\`is_default=false\`、\`with_data=false\`）
- ステージングが存在することは確認済み。ただし**スキーマ差分、同一マイグレーション状態、料金、実行権限は未確認**。先に存在・状態を確かめただけで、SQLの適用はしていない。
- 本PRは \`reports/sql/novelight_ai_review_candidates_PROPOSAL.sql\` を改善するのみ。**\`supabase/migrations/\` へ移動しない**。

## 発見した問題と修正

従前は \`novelight_ai_review_decide\` が保存済みの \`source_hash\` とCASのrevision/statusだけを比較していた。この条件では、Nodeが読んだあと、同時に原稿本文・話タイトルが更新された場合に**旧原稿由来の候補を採用できる**。

改訂SQL案では \`stage_batch\` と \`decide\` の両方で、以下をトランザクション内で実施する。

1. Supabase \`service_role\` 以外のRPC実行を禁止。小説の作者、作品ID、話ID、現在の \`pending\`、期待revisionを毎回確認。
2. 現在の \`episodes.title\` / \`episodes.content\` と \`novels.user_id\` を \`FOR SHARE OF e, n\` でロックし、並行したUPDATEを同トランザクション終了まで待たせる。
3. SQL側で \`sha256(JSON.stringify([title, content]))\` と同じUTF-8形式に整形し、現在のハッシュを計算。保存済みハッシュとの不一致は**データ変更なしで拒否**。
4. 保存は一括で実施（UNIQUEとrequestHash、advisory transaction lock）。意思決定は \`status='pending'\` と \`revision\` をWHEREに含む単一UPDATEでCAS。
5. 成功は \`accepted\` または \`rejected\` のレビュー状態だけ。作者の確定設定、登場人物台帳、創作ノート、本文に書き込まない。

### 同一ハッシュになることの検証（実作品を使用しない）

ProductionのPostgreSQLに対して**SELECTのみ**を実行し、Node側のJSON.stringify/SHA256と照合。全て一致。

| 架空fixture | Node と PostgreSQL |
|---|---|
| ASCII「A/B」 | 一致 |
| 日本語「架空の第一話／凛は青い鍵」 | 一致 |
| 絵文字を含む改稿 | 一致 |
| 制御文字 \`\\b\`, \`\\f\` | 一致 |
| Unicode行区切り \`U+2028/U+2029\` | 一致 |
| バックスラッシュ・CR/LF・タブ | 一致 |

PostgreSQLの \`pgcrypto\` は \`extensions\` スキーマに存在（SELECTのみで確認）。ただし、**すべてのUnicodeケースが完全一致するという証明ではなく、ステージングで追加の境界試験が必要**。

## ステージング承認後の検証（現時点では未実施）

**承認対象は \`wmlzjgvxgoyrovdhbqbg\` のみ。Production \`fiepaguycecrredwrcwx\` への書込、ステージングリセット、merge/rebase、prodへのmigrationは含まない。**

- [ ] ステージングの\`project_ref\`・git対応・migration履歴・Supabaseスキーマの差分・既存データの有無・バックアップ/撤収方法を読み取り専用で確認。Productionを向いていないことを2系統で確認。
- [ ] 現在の正式\`supabase/migrations\`の適用状況を調べた上で、レビューSQLを承認済みステージング**だけに**新規migrationとして適用。Migrationファイル名はCLIで生成。
- [ ] 権限: \`anon\`、\`authenticated\`、別作者、別作品、未ログインはテーブルとRPCを使用できず、Service-roleのみ必要最小限の権限。SQLの \`REVOKE\`、RLS、PostgREST経由も検証。
- [ ] 成功: 合成のowner+novel+episodeで1〜12候補が1回だけ保存。再送で0件。異なるrequestHashの混入、同一batch内重複、型・長さ違反はすべて中断し、中途半端な候補行がない。
- [ ] 更新: \`accept\` と \`reject\` は本人クリック1回に対応。2つのクライアントが同時に操作しても一方だけ成功。承認直前のタイトル・本文変更では409相当の失敗となり、review-statusは\`pending\`維持。
- [ ] 同時実行: Transaction Aの検証中にTransaction Bが本文を更新した場合、ロック待ち／更新前後の整合性を確認。逆順の場合も古いSHAの保存・採用を拒否する。
- [ ] 取り消し: テスト用データの消去・\`ROLLBACK\`・スキーマrevert手順と復旧時間を確認。監査ログには原稿/トークン/本文引用を出さない。
- [ ] CI: Node/SQL/RLS/rollback/staging deployの結果とDB advisorを記録。問題があればフラグOFFのまま修正。一般公開はしない。

**停止条件:** 異なるproject ref・既存データの混在・料金不明・期待と異なるmigration/RLS・ハッシュ不一致・不明なユーザーアクセス・rollback不可なら、適用を中止。

## 承認の分離

1. 今回の**PR本番承認**: GitHubコード・未適用SQL案だけをmainへマージするための承認。DB変更なし。
2. **ステージング承認**: 上記project refでの一回限りのSQL検証とテスト用データ操作。
3. **本番DB承認**: ステージング全試験合格後、別途対象migrationとmain SHAを提示し、本番への適用を承認。
4. **管理人限定試用承認**: UIマウントとAPIフラグ有効化、対象作品・外部モデル・円建て予算・許諾・期間を別承認。AI global OFF・予算0円は維持。

02-07-04はこの作業だけでは完了しない。02-07-05は実際の品質・原価試験と完成判定。
