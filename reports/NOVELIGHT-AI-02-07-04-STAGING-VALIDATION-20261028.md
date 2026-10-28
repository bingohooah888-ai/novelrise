# NOVELIGHT AI 02-07-04｜ステージングDB実地検証（2026-10-28 JST）

## 実施環境と承認範囲

ユーザーの明示「ステージング承認」に基づき、**Supabase staging \`wmlzjgvxgoyrovdhbqbg\` のみに適用**。本番は \`fiepaguycecrredwrcwx\`、main コミット \`96657276f8d3015f13f5b954f18c03c0feac9961\` から検証開始。

- Stagingは既存の非default branchであることをSupabase \`list_branches\` で確認。
- 適用前の履歴はstaging/prodとも206件、最後は \`20261027120000 novelight_ai_shared_runtime_foundation\`。
- Stagingには既存作品15件・話6件あり、Production（作品115件・話1465件）とは別DB。**既存話・本文・作品は変更しない**。
- Staging \`get_project\` 直接取得はNotFoundだったが、\`list_branches\`・\`list_migrations\`・ステージングref指定の読み取りSQLと実際のDDL成功を別途照合した。
- 外部AI送信・APIの有効化・予算設定変更・料金発生なし。

## 事前修正

\`reports/sql/novelight_ai_review_candidates_PROPOSAL.sql\` の \`novelight_ai_review_decide\` 関数定義に\`as $\`（1個）という構文エラーを発見し、\`as $$\`に修正。**mainにはまだマージしていない**。

\`Supabase apply_migration\` で以下を**stagingのみ**に登録・適用。

| Staging migration version | 内容 |
|---|---|
| \`20261028020331\` | \`ai_owner_review_candidates_staging_validation\`: 候補テーブル、RLS、専用RPC、権限GRANT/REVOKE、現在の本文・タイトルに対するロックとSHA256検証 |
| \`20261028020804\` | \`ai_owner_review_candidate_fk_indexes_staging_validation\`: \`novel_id\` と \`source_episode_id\` のFK用インデックス2本 |

**Production migration履歴は206件のまま、候補テーブルは存在しないことをSELECTで確認。**

## 実行して合格した検証

- RLS: 新規テーブル \`relrowsecurity=true\`。
- 権限: \`anon\` と \`authenticated\` は候補テーブルのSELECT/INSERTおよび専用RPCのEXECUTE不可。service_roleは必要なSELECTと専用RPC権限あり。
- トランザクション内の合成候補検証: 新規登録1件、同一requestHashの再送0件、誤SHAの登録拒否、候補配列途中の不正kindに対する**全件ロールバック**。
- 採用: pending→accepted（revision 1→2）、同revisionでの再度の却下拒否、他人のactor UUIDでは保存不可。
- 古い候補: 現在の原稿と一致しないSHAを候補に持たせて採用を試みた場合、拒否。候補状態はpendingのまま。
- 上記の操作テストは\`BEGIN; SET LOCAL ROLE service_role; DO ...; ROLLBACK;\`で実行。SQL上で実作品の本文ハッシュを**DB内で計算するのみ**、本文文字列は外部出力しない。既存作品・話はSELECTとSHAREロックだけ。
- 最終照合: **レビュー候補0件、作品15件、話6件**。テスト候補が残っていない。
- Performance Advisorで新テーブルに外部キー2件の「未インデックス」警告が出たためステージングへ2本追加。再検査では当該警告は消滅。新規インデックスの「未使用」情報のみ（テストデータは残していないので想定内）。
- Security Advisorでは新レビュー候補テーブル・RPCへの固有警告なし。既存の別テーブル/別関数についての多数の警告は今回の変更対象外。

## まだ合格と判断していないこと

- **独立した2接続からの同時UPDATEと採用の競合試験**。行ロックとCASは実装・単一接続の更新拒否試験で確認済みだが、実際に既存エピソードを書き換える二接続レースは既存作品保護のため未実施。
- **Supabase Data API 経由の匿名/通常JWT E2E**。DBの\`has_*_privilege\`・RLS・ロール実行制約で遮断を確認したがHTTP経由の本人/別作者テストは未実施。
- ステージングから**完全にスキーマを撤収する破壊的ロールバック**は未実施。データ/候補操作はトランザクション\`ROLLBACK\`で確認済み。ステージングの新規2マイグレーションは保持し、再検証可能にしてある。
- DBとの統合を含む実UI試用、実モデルによる生成と費用上限は引き続き別承認。

## リリースの次ゲート

PRの正式SQL案の構文と2インデックスを修正したコードは**本番用マージ承認待ち**で保持。これ自体はDB適用を意味しない。

**本番DBへの適用は新たな明示承認が必要**。Production ref \`fiepaguycecrredwrcwx\`に現時点で変更なし。AIの利用開始、外部AIの原稿送信、課金、管理人限定UI表示、一般公開は一切未実施。

02-07-04のうち、ステージングでの単独トランザクション安全性とRLS・冪等性は検証済み。上記未完項目を隠して「04完全完了」と宣言しない。
