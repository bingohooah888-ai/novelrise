# NOVELIGHT AI 02-07-04 — Staging migration差分の安全な復旧計画（2026-10-30）

**結論：検証資料は作成できるが、既存のStaging同期workflowをこのまま実行してはいけない。Staging/Productionのmutation承認は未取得。**

## 確認済み（read-only実査）

- main SHA：`4749dc869e434a4303f40c4e21dbd236a302f4c8`（PR #2678統合後）。
- Staging Supabase ref：`wmlzjgvxgoyrovdhbqbg`、Production：`fiepaguycecrredwrcwx`。接続先を読み取り専用で区別済み。
- main/Productionのmigration 208件中、Staging未適用は `20261030010000_comment_public_scout_identity` の1件。Stagingはmain/Productionにない `20261028084410_novelight_ai_review_candidates` を適用済み。Staging/Productionとも208件という**件数一致は偽のパリティ**。
- Staging `novelight_ai_review_candidates` はRLS有効、読み取り専用の件数照合で**0件**。候補stage/decide RPCはStagingのみ存在し、anon/authenticated EXECUTE不可、service_role EXECUTE可。
- `novelight_comment_feed_scope(bigint,bigint,integer)` の `pg_get_functiondef` MD5：Staging `92dd0172a48e9c35deb38eb8ba75f4cf`、Production `9883e151750cf28b49c30a2b4a286e9d`。**関数定義は実際に異なる**。両方ともSECURITY DEFINER・anon/authenticated/service_role EXECUTE不可。
- 既存のAI候補保存機能にはStaging実JWT検証成功の証拠あり：GitHub Actions run `40965587573`（2026-10-29 22:29 UTC終了）で本人401/200試験・cleanup・残留件数確認PASS。**これは同意/撤回機能の実JWT検証ではない**。消費済み承認を再利用してはならない。

## 作業ブランチに準備した検証資材（実DBでは未実行）

- `supabase/checks/20261030010000_comment_public_scout_identity_precheck.sql`：特定Staging関数の旧ハッシュ、候補保存migrationの存在、コメントmigration未適用、関数権限、候補RLS・候補行数0を確認。想定外なら例外。
- `supabase/checks/20261030010000_comment_public_scout_identity_postcheck.sql`：コメントmigration適用済みか、関数がProductionで実測した新ハッシュと一致するか、権限・AI候補RLS・候補行数が維持されたかを確認。
- `supabase/rollback/20261030010000_comment_public_scout_identity_rollback.sql`：**復旧専用**。現行Stagingから取得した関数定義を事前固定し、関数の新ハッシュを検査した場合のみ元のStaging関数を復元する。migration履歴の更新/削除は実施しない。実行には別のStaging承認が必要。
- `tests/ai-comment-staging-migration-kit.test.mjs`：上記ファイルの構造・期待ハッシュ・権限・履歴非改変をオフラインで検証する。**実Postgresでの構文・権限動作の証拠ではない。**

**重要：`supabase/migrations/20261030010000_comment_public_scout_identity.sql` 自体は変更しない。** このmigrationは既にProductionに適用済み。

## 実行を止める理由

`.github/workflows/supabase-staging-sync.yml` は、対象migrationのpre/post/rollbackファイルを要求し、適用前のpending一致・dry-runと適用後の**main/Staging全migration一致**を必須としている。

仮に今回の追加資材をmainに統合して `20261030010000` をStagingへ適用できても、StagingにはDraft PR #2601由来の `20261028084410` が残るため、Stagingのmigration数は209、mainは208となり**適用後の完全パリティが成立しない**。適用後のチェックだけが失敗する「変更済みだが不合格」の状態になる恐れがある。

そのため、既存workflowの最後のチェックが失敗すると分かっている状態では、**Staging migration-syncの承認を依頼・投入しない**。パリティゲートを削除・迂回する、履歴テーブルだけにINSERT/DELETEする、候補保存テーブルを削除する、候補migrationをProductionに無断適用する、という対処は禁止。

## 意思決定と順序

1. **今回のPRはコード/資料のみの統合承認**。Vercelの自動Production buildが起き得るが、新DB・AI機能公開・DB mutationなし。
2. Stagingに先行している候補保存migration `20261028084410` についてDraft PR #2601の内容・実JWT成功証拠とRLSをレビューし、**Productionへ将来導入するかを独立して判断する**。単なるmigration帳尻合わせのためにProductionへ導入しない。
3. 候補機能をProductionへ正式導入する判断が成立した場合に限り、mainへのmigration統合のコード承認と、Production DB migration適用の**別個の本番承認**を準備する。Productionの導入が拒否または時期尚早なら、既存Stagingを無断整理せず、別の独立検証環境など代替手段の費用・リスクを提示する。
4. 既存Stagingで `20261030010000` を同期する場合は、候補保存migrationとの履歴・実スキーマ整合性が成立し、**適用後のパリティを含めて**受け入れられる実行経路を審査する。main SHA、migration SQL blob、Staging ref、pre/post/rollback SQL blob、予想差分、cleanup計画を固定した1回限りの**ステージング承認**が必要。
5. その後に初めて同意管理SQLのrollback-only実証→Staging永続migration（別承認）→作者本人の同意・撤回UI/JWT試験（別承認）へ進む。実AI原稿送信・課金・一般公開はさらに別の承認。

## 停止条件

- 現在のStaging関数ハッシュ・候補データ件数・RLS・migration版・Secret接続先のどれかが変わった。
- スクリプト実行後の履歴パリティが成立することを事前に示せない。
- 関数を戻すこととmigration履歴を戻すことが混同されている。
- main SHA/環境/回数/対象SQLが異なる承認を流用する必要がある。
- Staging操作の前にProductionへの変更を要求するが、独立したProduction DB承認が存在しない。

当該事象では**停止し、新しい実行経路や例外承認を勝手に作らない**。
