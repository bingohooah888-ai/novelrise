# NOVELIGHT AI工程②：作者確認済み状態／Staging実接続前の判定表

**判定基準：2026-11-11 JST／main `fe1f5fffaf738d3fea1ee78959bc07598fce207a`、MASTER blob `e2501f9ed0722964e76fd0a49bf200717850b81d`。**
この文書は読み取り専用調査・提案であり、Staging承認、DB変更承認、Production承認、実JWT試験承認ではない。PR #2848の統合後CodeQL run #43003951093はSUCCESS。今回のPR作成時点でmainとProductionは変更しない。

## 1. 現状／証拠と不確定要素

| 領域          | リポジトリで確認した事実                                                                                                    | 実環境で未確認                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Migration分岐 | 既存のread-only監査ボードがStaging固有 `20261110080421` とmain固有 `20261110172000` を記録。後者のSQLは現行mainに存在する。 | 今日のStaging historyの全版・適用先・前者の変更内容とロールバック可否                            |
| 永続化SQL     | `reports/sql/novelight_ai_owner_review_state_PROPOSAL.sql` のみ。`supabase/migrations` にない。                             | SQL構文・実CAS・ロック順序・RLS・現物テーブルの存在                                              |
| 認証          | `owner-session-evidence.js` が署名済み `session_id` と `auth.sessions` の一致を要求。                                       | 実 `getClaims` の署名／issuer／audience検証と認可済みserver-only `lookupOneSession`              |
| DB権限        | SQLは `security invoker`・`service_role` 専用で、`auth.sessions` を `for share` する。                                      | `service_role` がauth schema USAGE・必要列SELECT・行ロックに必要なUPDATE権限を持つか             |
| 作者導線      | `OwnerStudio.attach`／`OwnerPanel`／`AuthorWorkspace` と未mount HTTPアダプタは合成で連結。                                  | 本番 `story-notes.html` に新readerは未import、公開 `api/ai-owner-bible-review-state.js` は未作成 |
| 動作          | オフラインテストのみ、デフォルトOFF、AI候補採否や作者確定設定と分離。                                                       | 実JWT・Staging DB・公開HTTP・ブラウザ実操作・付随費用                                            |

古いMigrationボードの215/215件比較は**当時のスナップショット**。本書の2つの版番号だけでは、今のStagingとmainが同じ状態と断定できない。既存 `scripts/audit-staging-migration-recovery.mjs` の `assessStagingMigrationRecovery` を再利用し、両方向の差分を出す。remote-only版がある間は `migration repair`、番号付け直し、無関係なSCOUT機能のSQL実行を自動判断しない。

## 2. 重大な権限ブロッカー（確認されるまでSQL適用禁止）

PostgreSQLの `SELECT ... FOR SHARE` は **SELECTに加えて、対象テーブルの少なくとも1列にUPDATE権限**を要する。これは読み取りしかしていないつもりでも変わらない（PostgreSQL SELECT Reference）。Supabaseの `service_role` がRLSをbypassできることは、`auth.sessions` に対するスキーマ権限やUPDATE権限を保証しない。

- `auth.sessions` のid/user_id SELECT、UPDATE（行ロック用）、authスキーマUSAGE、`public.novels` のid/user_id SELECTとUPDATEを区別して調べる。
- 新しい `reports/sql/novelight_ai_owner_review_state_READONLY_PREFLIGHT.sql` は**カタログ権限の真偽だけ**を返す。本人セッション行、JWT、原稿、APIキーは取得しない。リポジトリのmigration parity確認は別途必須。
- 権限のいずれかがFALSE、UNKNOWN、対象不一致なら**NO-GO**。新しい提案SQLにも適用時の権限ガードを設けている。
- 権限不足を `GRANT UPDATE ON auth.sessions`、`SECURITY DEFINER`をpublicに置く、Auth schemaをData APIへ露出する、ユーザー申告のsession_idを信用するといった操作で解消してはいけない。必要なら専用の**非公開・最小権限のsession attestation設計**を別PRと承認で検討する。

参照：PostgreSQL `https://www.postgresql.org/docs/current/sql-select.html`、Supabase `https://supabase.com/docs/guides/database/postgres/roles` と `https://supabase.com/docs/guides/api/securing-your-api`。

## 3. 接続前に整えるコード境界

1. **read**：作品所有者確認済みのworkをreadし、返却直前にも `novels(id,user_id)` を再照合。セッションが失効・作者が変更されたら非公開の確認済みIDは返さない。DBのservice_role使用はRLSを迂回するためサーバー検証は必須。
2. **save**：bearerはサーバー内でのみ扱い、署名済み `session_id` をSQLへ渡す。SQLがowner/signed-session/revisionを同一トランザクションで確認できることを実環境で証明するまで保存しない。
3. **HTTP/UI**：既存の `owner-bible-review-state-offline-api.js` とbrowser readerは未mount。production `story-notes.html`、公開 `api/*.js`、envを今回のPRでは変えない。実接続時は専用フラグ・Owner限定・正規のsession observer・負荷とエラー表示をStagingで確認してから。
4. **SQL**：proposalは将来の候補Migrationではあるが、Migrationタイムスタンプを今作ったり、直接適用したりしない。実Postgresの権限・CAS・同時書込・RLS・rollback証跡は現状ゼロ。

## 4. 次回S0「ステージング承認」候補――読み取り専用限定

**対象環境**：既存隔離Supabase Staging project ref **`wmlzjgvxgoyrovdhbqbg`** のみ。GitHub `bingohooah888-ai/novelrise` の最新承認対象HEAD、MASTER内容、対象projectが全て一致している場合のみ。Production projectへの切替・fallbackは禁止。

| 操作                                                                     | 最大回数 | 出力                                                                                      |
| ------------------------------------------------------------------------ | -------: | ----------------------------------------------------------------------------------------- |
| Staging既存Migration historyの**版番号だけ**取得                         |      1回 | mainの現行ファイル一覧との両方向差分。Remote-only/Local-onlyを確定                        |
| Stagingの `pg_catalog` 権限診断（`READONLY_PREFLIGHT.sql` の単一SELECT） |      1回 | 作品テーブル・Auth schema/columns/row-lock権限のboolean結果、既存object/EXECUTE権限の有無 |

**上限**：Staging読取要求合計2回。DB/SQLの更新0回、Migration実行0回、Repair0回、Preview0件、JWT/実Auth接続0回、AI Provider0回、ユーザーデータ取得0件。失敗した要求の自動再試行もしない。既存のStagingサービス利用枠内での読取が必要になり得るため、費用の**絶対0円保証はしない**が、有料AI・追加Previewは発生させない。権限診断の実行に新しいSecret、広い権限、追加構成が必要なら実行せず、再度範囲を提示する。

**停止条件**：project ref不一致、SHA/HEAD変更、scope逸脱、Migration history取得失敗・版差分あり、auth.sessions権限不足・不明、想定外のowner-review object、非秘密の証跡を残せない状況、再試行や有料/書込操作の必要性。Migration差分と権限診断の**両方がPASSして初めて**次の検討へ進む。S0はそれ自体でMigrationや本番利用を承認しない。

## 5. 将来S1／S2――今回は絶対に実行しない

- **S1 Migration分岐の整理**：Remote-only `20261110080421` とlocal-only `20261110172000` の内容・所有者・依存関係を独立レビューする。両方の正当性、バックアップ、復旧手順、Stagingのみへの影響、差分解消方式を確定し、**別のステージング承認**を得る。名前だけを揃える操作は禁止。
- **S2 独立した確認状態Migration・Staging検証**：S0/S1クリア後に、専用Migration 1件の作成・適用（それぞれ承認境界に従う）を計画。コード・権限・RLS・失効・同時CAS・HTTP・UIの実証は、独立したStaging承認（対象SHA、作業回数、テスト用作者/作品、費用上限、cleanupを特定）でのみ行う。本番へのMigrationやフラグON、公開は一切自動継続しない。
- **失敗時**：まずOwner reviewフラグOFF維持で新規アクセスを停止し、読取ログの機密混入を確認。ロールバック提案 `reports/sql/novelight_ai_owner_review_state_ROLLBACK_PROPOSAL.sql` は**隔離Stagingテーブルが空**のときだけ、別途の破壊的操作承認を得て使う。表に合成でも行が残れば自動DROPせず、データ保全・バックアップ・対象限定cleanup承認を先に判断する。`DROP CASCADE`、Auth/novels/候補採否の削除、Production操作、Migration history repairは行わない。

## 6. 完了条件と判定

**今回の成果は「実接続前のオフライン準備完了」まで。** main統合なし、Previewなし、Staging/Production変更なし、実SQL/JWT/API呼出しなし、SQLは未適用。Staging実環境検証・本番実稼働・一般作者開放はいずれも**未実証／不可**。正式Gate A〜Eは **0/5**。
