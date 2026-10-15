# 星灯祭 第1回：受付開始SQLの単一文・原子性設計（2026-10-15）

> **非公開の技術レビュー資料。応募要項の採択／受付開始承認／本番実行ではない。**
> 正式な公開はIssue #2120上のOWNERによる独立した規約採択と`受付開始承認`を必要とする。現行Productionは`draft/public_visible=false`、規約版・URLは空、応募0件。

## 問題と判断

現行の`scripts/november-contest-registration-open-plan.mjs`は、Supabase Management API `POST /v1/projects/{ref}/database/query`のベータインターフェースに、トップレベルの`BEGIN; SET LOCAL; DO; COMMIT;`を1 HTTPリクエストで送る仕様だった。

Supabase公開API仕様はこの書式の**複数文の一括実行、各文の返却・途中エラーと原子性**を保証していない。HTTP 201だけをもって複数文のトランザクションが確実にcommitされたと見なすのは不適切。今回の変更で、1つの`DO $novelight_stage05_open$ ... $novelight_stage05_open$;`だけを送る形へ変更する。

PostgreSQLのDOは単一SQL文なので、**当該文に含まれるUPDATEと監査INSERTは同一トランザクション内で実行される**。途中でSQLエラーになれば当該文はロールバックされる。なおHTTP接続断や曖昧なAPI返答の後は結果を推測して再実行せず、元のGitHub CLAIMED証跡とDB状態を人間が照合する。

## 修正の限定範囲

- トップレベル`BEGIN/COMMIT/SET LOCAL`を削除。
- `DO`内部の冒頭で`pg_catalog.set_config('lock_timeout','5s',true)`と`pg_catalog.set_config('statement_timeout','20s',true)`を実施。`pg_catalog.pg_advisory_xact_lock`と対象contest行の`FOR UPDATE`を引き続き利用する。
- 有効期間/10公開話/terms版・URL/二重応募禁止、`status='draft'`、`public_visible=false`等の既存の行検証は変えない。
- 参照URL・版・同意・支払・得点計算や、不正・ランキング計測には変更を入れない。
- `registration/public_visible=true`への更新と`novelight_contest_review_audit`への監査追記は同じDO内のまま。
- Nodeテストでトップレベル複数文が復活していないこと、失敗時の停止・DB後確認が維持されることを固定する。

## 未解決の実地ゲート

これは**PostgreSQLの文単位原子性に関する修正**であり、以下を証明しない。

1. 現在設定済み`SUPABASE_ACCESS_TOKEN`がBeta Management API `/database/query/read-only` と`/database/query`の両方に認可されていること（OAuth `database:read`/`database:write`およびscoped PAT permission）。
2. APIが本番環境でDO文を受け付けること、レスポンスが現行release.jsの厳密な`Array<{...}>`前提に一致すること。
3. Productionの現在時点で規約採択・法務/税務/送金体制/安全な個人情報処理が完了していること。
4. 実作者による応募/取消、公開HTTP 200、ゲストの表示を、受付開始後の安全なスモークで検証できること。

**別に「本番承認」がなければ、この変更をmainにmergeしない。** さらに独立した「受付開始承認」がなければ実releaseを呼ばない。HTTP 201の前後で結果が不明な場合、CLAIMED済み承認を再利用しない。

公式資料：
- https://supabase.com/docs/reference/api/v1-read-only-query
- https://supabase.com/docs/reference/api/v1-run-a-query
- https://www.postgresql.org/docs/current/sql-do.html
