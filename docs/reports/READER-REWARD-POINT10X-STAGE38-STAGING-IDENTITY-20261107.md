# NOVELIGHT β Scout Point10倍・第3.8段階／Stagingの独立認証経路

**判定：コードおよび合成テストはレビュー可能。Staging実DB接続・SQL／第4段階のPoint変換はNO-GO。**

## Current authoritative sources

- Base main `ff7273b7f58dbdd9f148f3425577ddcb3d961f70`、正式MASTER blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`、AGENTS blob `3b5d3e5165856574aaa679cd14822d7face397b0`。
- Supabase `list_branches(fiepaguycecrredwrcwx)` で既存Staging `wmlzjgvxgoyrovdhbqbg` は `ACTIVE_HEALTHY`、`persistent:false`、`with_data:false`。ただし `get_project(wmlzjgvxgoyrovdhbqbg)` が **Project not found**。ブランチ登録とDB接続先の本人性は同じ証明ではない。
- 既存 `verify-staging-migration-target.mjs` は dedicated host/username/port を照合するが、`PGSSLMODE=require` は CA・ホスト名認証を行わない。Supabase公式SSLガイドも `verify-full` を推奨する。既存 `resolve-staging-session-pooler.mjs` の探査は今回起動しない。
- NLO direct MCPはこのチャットのツール一覧に露出しない。Bridge #1837はOWNERコメントが必要であり投稿禁止のため起動しない。NLOをofflineと推定しない。

## Prepared read-only diagnostic (Draft only / never run in this stage)

- 新規 `.github/workflows/scout-point10x-staging-identity-readonly.yml`: `workflow_dispatch` だけを受け、trusted main・OWNER本人／trigger／1回目・exact main SHA・明示的なStaging READONLY承認入力・`environment: staging` を確認。保存されるのは標準GitHub構成だけ。古いStaging書き込みWorkflowは起動しない。
- 新規 `scripts/scout-point10x-staging-identity-readonly.mjs`: 既存専用Staging Secretを**承認済み trusted-main Staging runnerの内部のみ**で参照する将来の経路。Secretの実値・URL・tokenはログ・PR・argv・成果物に出さない。認証のために既存Supabase管理トークンが利用可能な場合のみ公式管理APIで親Branch一覧と**独立のStaging Project詳細**をGETし、同じref、親、ACTIVE_HEALTHY、database host、Postgres 17+を一致確認する。いずれかのGETが404・未認証・不一致なら SQLの手前でHOLDする。Management APIトークンが既存Staging Environmentに設定されていることは**未確認**であり、Secretの新設・変更はしていない。
- Managementの事前認証と、既存 `verifyStagingMigrationTarget` によるdedicated route形式検証が通った場合だけ、libpqの **`PGSSLMODE=verify-full`＋`PGSSLROOTCERT=system`**（CA・ホスト名照合）を必須にする。互換性がなければHOLD。pooler経由もstagingユーザ名一致を要求し、Production接続は拒否。
- その後に限り、`psql` を外部shellなし・秘密URLをargvに渡さず・`default_transaction_read_only=on`・短いstatement timeoutで起動。`BEGIN READ ONLY` → 固定のcatalog SELECT（DB名、role、Postgresバージョン、TLS真偽、6表存在数、pg_cron拡張有無）→ `ROLLBACK`。ユーザーレコード／実XP／Point残高を読まず、表存在数などのwhitelist結果のみ表示。**Point変更SQL、DDL、EXPLAIN ANALYZE、バックアップ、Writer停止は一切含まない**。
- 新規ユニットテストは合成した管理情報・接続先形式・catalogレスポンス形状の検証のみ。実接続するrunner関数は外部公開せず、テストから任意のfetch／psql実行関数を差し込んで認証を偽装する構造を持たない。CIでは実Staging DBへ通信しない。Workflowはmain未統合で、OWNERによる別の明示的実Staging診断承認なしに実行しない。

## Still NO-GO / next gates

1. Supabase StagingのProject詳細が現在NotFound。既存管理トークンの存在も不明。管理APIでStagingの本人性を別途認証できるまで、diagnostic runnerはSQLを呼ばない。Stagingのリソースを作り直す・有料契約を追加することは別承認なしに禁止。
2. 実DB内のPostgres version、SSL接続、schema、Cron status、Writerなどは**未実証**。固定catalog SELECT成功でも100% Writer fenceや90秒更新可能性を証明しない。99%でなく独立実環境証拠が必要。
3. REST OWNER新scope本人認証のtrusted-main実装・耐改ざんかつ永続のsingle-spent ledger CAS、独立バックアップ・別環境の復元、Writer全経路停止・再開、実行時間とロック影響の証明は未完成。
4. 第4段階の実変換／Production SQLはNO-GO。追加のGitHub Actions／Secret書換え／workflow実行／DB書込はこのDraft自体によって許可されない。
5. Draft PRのmain統合は、Vercel Production自動ビルドの可能性があるため、正確なHEAD限定の別の本番承認を必要とする。統合後も `workflow_dispatch` は自動発火しない。実際のStaging診断起動も別承認。

**作業実績**：Staging SQL 0、Production SQL 0、Secret取得・変更 0、OWNERコメント投稿・承認消費 0、Writer停止 0、バックアップ 0、main統合 0、deploy 0。
