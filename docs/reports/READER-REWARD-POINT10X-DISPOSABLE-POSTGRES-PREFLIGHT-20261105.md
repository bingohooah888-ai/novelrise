# NOVELIGHT βScout Point10倍｜使い捨てPostgreSQL検証 FULL PREFLIGHT

2026-11-05 JST。**結論：ローカルPostgreSQL実行不可。隔離検証器と非稼働反証テストのみ追加。実StagingはNO-GO。**

## 正本と禁止境界

| 対象                  | 確認値                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| main                  | 0e4f3f594193d137d582fb693703ffdfe1d1cfd3                                                         |
| MASTER                | docs/NOVELIGHT-MASTER.md、blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                          |
| repo運用規則          | mainのAGENTS.md / WORK-EXECUTION-PREFLIGHT / AUTOMATION-CONTINUATION-GATE / NLO-EXECUTION-POLICY |
| 本体Draft PR #2762    | 開始時HEAD 9c29eed9f749f143cd3a8d3fd42cc14bf6b5bd14、open、Draft、未統合                         |
| SQL候補Draft PR #2763 | HEAD 58e60ef90801078e097e321590428c4b8b343486、rollback-only、未変更                             |
| Issue #294            | Open。OWNER承認・CLAIMED・CONSUMEDの新規投稿・消費なし                                           |
| 禁止                  | 実Supabase DBへのSELECT/DML/DDL、Staging実行、Production変更、Secret参照、main統合、deploy       |

## 1. 読取りで確認したローカル実行環境

WindowsのDocker CLIはインストール済み（v29.7.2）が、Linux Docker Engineは停止しておりDocker Desktop named pipeに接続できない。WindowsのPATHおよび調査対象の標準インストール先にPostgreSQL psql・pg_ctl・pg_configは見つからなかった。WSLディストリビューション docker-desktop は列挙されたが、ユーザー環境の操作はしなかった。

ハーネスの読取り専用 --probe は次を返した：available=false、dockerClientInstalled=true、linuxEngineAvailable=false、imageAlreadyCached=false。imageはdaemon未起動のため調査不能であり、実際にキャッシュされていないと断定しない。

**今回は実PostgreSQLのSQL・同時トランザクション・権限テストを実行していない。** Docker Desktopを起動せず、imageをダウンロードせず、既存コンテナやボリュームを変更していない。

## 2. 新規の具体的非稼働コード

- scripts/scout-point10x-disposable-postgres-proof.mjs：既定は --probe のみ。実行には --run と NOVELIGHT_POINT10X_LOCAL_PG=I_ACCEPT_DISPOSABLE_DB の両方が必要。DATABASE_URL、SUPABASE_DB_URL、SUPABASE_URL、POSTGRES_URL、PGHOST、PGSERVICE、PGPORT が有効なら停止。
- Docker imageは固定 postgres:16-alpine、既存ローカルimage必須、pullしない。--network none、host port公開なし、host volume bindなし、tmpfsデータ、memoryとPID制限あり。乱数由来の専用コンテナ名とowner labelで作成・finally cleanup（不一致時は既存コンテナの破壊を避けて停止）。
- PostgreSQLへは新規コンテナ内部のdocker execと127.0.0.1だけで接続。CONTROLとSTAGEは同一使い捨てコンテナ内の異なるDBを使用。**物理的に独立した2つのPostgreSQLインスタンスではない。**
- tests/fixtures/scout-point10x-localpg-control.sql：冒頭でcurrent_databaseが nl_point10x_control と完全一致しないと例外停止。private domain行 FOR UPDATE、spentのcomment ID・operation ID・scope+candidate SHAのUNIQUE、version・monotone epochを一つの合成CASで更新。SERIALIZABLE 2セッションの並行取得は1件しか成功しないことを検査する設計。
- tests/fixtures/scout-point10x-localpg-stage.sql：冒頭でcurrent_databaseが nl_point10x_stage と完全一致しないと例外停止。BYPASSRLS付き合成service roleに対し、DML・TRUNCATE・合成旧SECURITY DEFINER 5pt RPCをfreeze時のtriggerで拒否するテストを準備。
- **重要な負例：** superuserは ALTER TABLE ... DISABLE TRIGGER USER でguardを迂回できる。合成DBの一時transactionでこの事実を確認した後ROLLBACKするテストを用意。成功しても、実Stagingの特権書込みが防御できたとは判定しない。
- tests/scout-point10x-disposable-postgres-proof.test.mjs：実行許可、不要な外部DB URL、画像・port公開、host bind、既存コンテナ誤削除、SQL先頭のDB限定guard、CAS/Writerの想定ケース、失ったCOMMIT応答を後からPRIMARYを読取り確認する擬似失敗テストを静的・非稼働で検証。

## 3. 後日実施するためのコマンド（今回未実施）

Docker Engineが起動済みで、指定したPostgres imageがキャッシュされている場合に限る。別途の実行判断で、PowerShellから次を利用できる。

```powershell
node scripts/scout-point10x-disposable-postgres-proof.mjs --probe
$env:NOVELIGHT_POINT10X_LOCAL_PG = 'I_ACCEPT_DISPOSABLE_DB'
node scripts/scout-point10x-disposable-postgres-proof.mjs --run
Remove-Item Env:NOVELIGHT_POINT10X_LOCAL_PG
```

--run でもDocker/ローカルimageが利用できなければSKIPPED_UNAVAILABLEとなり、Docker imageはpullしない。テストが作成した自分のコンテナ以外は削除しない。

## 4. 検証結果の厳格な意味

- unitテストPASSは実SQLの確認ではない。実Docker実行は**今回は0回**。
- 将来の使い捨てDBテストが成功しても、合成SQL・別論理DBでの競合証明に限る。ACK消失は結果を捨てる擬似試験であり、本物のネットワーク切断・commit outcome ambiguityとは違う。
- 既存9種類の本物のPoint Writer、実Supabase service_role/owner/superuser/旧SECDEF、実RPC 5pt→50pt、private marker・5表の同一COMMIT、独立物理CONTROLサーバ、独立Backup/Restore、Point/XP・逆仕訳・外部side effectの一貫性は全て未検証。
- GitHubのNode CI/CodeQLとローカルunitテストがgreenでも、Staging/Production readiness NO-GOを解除しない。新規OWNER承認・対象SHA・scope・対象環境は別工程。

**変更範囲はこの非稼働テスト実行器、2つのローカルSQL fixtures、対応Nodeテストと本レポートに限定。** MASTER、既存実行workflow、SQL安全フィルター、旧scope、Issue #294、Draft #2763、main、Productionは触らない。
