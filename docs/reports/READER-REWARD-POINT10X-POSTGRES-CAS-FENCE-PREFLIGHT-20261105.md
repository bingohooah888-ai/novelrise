# NOVELIGHT βScout Point10倍｜永続PostgreSQL CAS・DB fence候補 FULL PREFLIGHT

2026-11-05 JST。**結論：非稼働アダプターとSQLレビュー候補を追加。実Staging readinessはNO-GOのまま。**

## 1. 最新正本と変更禁止

| Source                 | 実際の確認                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| main                   | 03f64b14138ec5c6a90c0d8231a0784f878e78fa                                                                      |
| 正式MASTER             | docs/NOVELIGHT-MASTER.md blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                                        |
| リポジトリ安全ゲート   | mainのAGENTS.md、WORK-EXECUTION-PREFLIGHT.md、AUTOMATION-CONTINUATION-GATE.md、NLO-EXECUTION-POLICY.mdを照合  |
| Draft PR #2762         | 開始HEAD 364b1eccb09f9b9695e615629dfece12f33926d2、open/Draft/main未統合                                      |
| 独立SQL候補Draft #2763 | 58e60ef90801078e097e321590428c4b8b343486、rollback-only／未統合／変更禁止                                     |
| Issue #294             | [Staging Control] Supabase migration sync、open、新しいOWNER承認は投稿・消費していない                        |
| 起動経路               | 新atomic trusted-main実行器はmain上で未稼働。3種のconcurrency groupは一致せず、Issue read→appendはCASに非該当 |

ユーザーが許可したのは**設計・非稼働コード・SQLレビュー・反証試験・Draft PR更新**まで。実DBへのSELECTも含めたDB操作、Staging起動、Production、main merge、deploy、Secret、Issue #294へのCLAIMED/CONSUMEDは行っていない。

## 2. 今回追加した具体的候補

**A. 非稼働アダプター：** scripts/scout-point10x-postgres-cas-fence-review-adapter.mjs

- 既存のREQUEST_FIELDS、ATOMIC_PROOF_SCOPE／ATOMIC_WRITE_SCOPE、SHA、Staging ref、共通mutation domain、9種類のWriterと5種特権経路、5表の定数を再利用。
- trusted-mainのOWNER event、primary CASのserializable transaction、domain row FOR UPDATE、spentのcomment/operation/scope+headの一意性、version/epoch条件付き更新、GitHub副監査、CAS ack喪失read-only再照合をレビュー条件として明示。
- Data Plane側は全WriterのDB強制epoch・queue drain・旧SECDEF／service_role／owner経路、INSERT/UPDATE/DELETE/TRUNCATEを含む5表の遮断、CONTROL/Staging間の分散COMMITを仮定しないこと、Staging restore後のepoch巻き戻り防止を要求。
- 返却値は**レビュー順序と停止理由のみ**。認証、DB接続、SQL実行・Secret・GitHub書込み手段はない。全fixtureがtrueでもmayRunStaging=false、mayWriteDb=false、primaryCasActuallyCommitted=false、dataPlaneFenceActuallyInstalled=false。

**B. SQLレビュー候補：** docs/plans/READER-REWARD-POINT10X-POSTGRES-CAS-FENCE-SQL-REVIEW-20261105.md

- 独立CONTROL Postgresのprivate domain/epoch台帳と不可逆spent台帳、uniqueness案。
- 同一SERIALIZABLE取引で domain FOR UPDATE／spent INSERT／version+epoch条件付きUPDATE／RETURNING件数をチェックするCAS案。コメントやCLAIMEDは一次認証でない。
- Staging DB側のfreeze中DML拒否の原型、旧SECDEFとservice_role・owner・superuser・TRUNCATE・DDL迂回・GUC偽装の未解決問題、read-only catalog SQL。
- **SQLはdocs/plans内のMarkdownだけ**。全コード片に意図的RAISE EXCEPTIONを置き、直接利用不可。実DB catalog未照合・プライベートrole未確定・freeze中の正当cutover経路も未設計。
- CONTROL DBのCASが成功しても別Staging DBのfence/COMMITは原子的に連動しない。中間失敗は解除・再試行ではなくHOLDする。

**C. 負例テスト：** tests/scout-point10x-postgres-cas-fence-review-adapter.test.mjs

本人性・Issue・SHA/scope/mode・Secret先読み、read-only一次CASのack不明、17のCONTROL原子性条件、9種Writerの停止／epoch、5種特権経路、5表のDML/TRUNCATE、復元後epoch巻き戻りと不明commit等を反証。SQL候補が非稼働文書のままであることも検査。

## 3. 外部仕様との照合と未実証部分

- PostgreSQLのFOR UPDATE／advisory locksは適切な取引境界と全参加者の協調が必要。通常のadvisory lockだけで別DBに書き込む特権経路を遮断できない。
- SupabaseではGRANTとRLSは別で、service_roleはBYPASSRLS、既存SECURITY DEFINERは権限が強い。RLS／セッションGUCのみを特権経路の認可とみなさない。
- Supabase 2026 changelogではCLI v3のlocal-first変更、Data API公開/GRANTの変更がある。CLIは今回使用しない。
- 実CONTROL Postgres、独立Restore、現行Staging schema/GRANT/SECDEF/trigger、secret環境区別、service_role直接SQL、PGにおける並行tx、COMMIT ack不明からの再照会、全Writer制御は全て**未実証**。
- SQL候補は実行可能migrationの品質保証ではない。特に正当なcutoverだけを許すDB guardと、distributed failure reconciliationの安全な実装が次に必要。

## 4. 実装時の必要承認

別途OWNERの特定対象承認が必要なのは、(1) trusted-main実行器・制御スキーマ実装のmain統合、(2) StagingのDB schema/catalog/backup等の実試験、(3) Production mutation、(4) Writer再開である。各scope・SHA・project・1回限りを独立に固定する。既存承認の使い回しなし。

## 5. 証跡

今回追加の112件の非稼働負例テストを含む全対象スイートの合計、ESLint/Prettier、GitHub同一HEAD CI/CodeQLの結果はPR #2762本文へ固定後に記録する。安全フィルター、既存workflow、#2763、MASTER、main、Productionに変更なし。
