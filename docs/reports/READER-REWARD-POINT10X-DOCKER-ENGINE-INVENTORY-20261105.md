# NOVELIGHT βScout Point10倍｜Docker Desktop安全確認・実測可否 FINAL PREFLIGHT

2026-11-05 JST。**結論：Docker Linux Engineに接続できないため、使い捨てPostgreSQL実測は安全停止（NO-GO）。既存環境に対する起動・変更・削除なし。**

## 1. 正本の確認

| 項目                    | 実際に確認した値                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| main                    | 0e4f3f594193d137d582fb693703ffdfe1d1cfd3                                                                   |
| MASTER                  | docs/NOVELIGHT-MASTER.md、blob 91d11fa367b7de64990b13397b13d4bb6e3c0230                                    |
| 運用規則                | main版 AGENTS.md / WORK-EXECUTION-PREFLIGHT.md / AUTOMATION-CONTINUATION-GATE.md / NLO-EXECUTION-POLICY.md |
| 本体Draft PR #2762      | 開始HEAD bb2f9fac069da3b38b0bb8a27725c855d1ecd4af、Draft/open/未統合                                       |
| 別SQL候補Draft PR #2763 | HEAD 58e60ef90801078e097e321590428c4b8b343486、Draft/open/未統合／変更なし                                 |

## 2. Dockerのread-only調査結果

対象はユーザーのWindows上のDesktop Commander認可端末。Dockerの変更系コマンドは実行していない。

- Docker CLIは29.7.2。Serverはnamed pipe不在により接続不可。
- Linux Engine endpointは npipe:////./pipe/dockerDesktopLinuxEngine。Engine停止のためdocker info失敗。
- Docker context showは desktop-linux。docker context inspect desktop-linuxでlocal Windows named pipeのendpointを確認（設定の読取りのみ）。
- Engineに接続できないため、既存コンテナ一覧・volume一覧・postgres:16-alpineのimage cacheは確認できない。**既存コンテナ0件・volume0件・imageなしとは判定しない。**
- Docker Desktop起動／再起動、image pull、既存コンテナやvolumeの作成／削除／変更、Docker context切替、host port公開は一切なし。
- 新規使い捨てPostgreSQLでの14項目のSQL・並行CAS・BYPASSRLS/SECDEF迂回試験は**全て未実施（実SQL 0/14）**。

**NO-GO理由：** Engine起動前に既存コンテナ・データへの影響を排除できず、ユーザーの禁止範囲を超えてDocker Desktopを勝手に起動できない。

## 3. 今回の非稼働安全機構

- 新規 scripts/scout-point10x-docker-inventory-policy.mjs：Dockerの読取り結果を純粋に判定。local desktop-linux context + Windows named pipe／Linux Engine／既存コンテナ0／既存volume0／cache image確認済みが全て揃わない場合はfail-closed。
- 既存 scripts/scout-point10x-disposable-postgres-proof.mjsを強化：Docker commandのcontextを desktop-linux に固定。DOCKER_HOST・DOCKER_CONTEXT・TLS設定などのendpoint overrideが存在すれば**daemon問合せ前に停止**。
- read-onlyのcontext inspectが厳密にローカルnamed pipeを指すときだけEngine照会。Engine稼働時に限り全コンテナ・volumeの一覧とimage cacheを照合し、いずれか不明／既存データありなら起動禁止。
- Docker run直前に再び安全inventoryを検証し、変化時に中止。Docker runのACK消失時にも生成nonce付きの専用コンテナ名・ラベル一致を検査してからのみ後片付けを検討。既存リソースに触れない。
- 新規 tests/scout-point10x-docker-inventory-policy.test.mjs：remote endpoint、Engine停止、一覧不明、既存container・volume、image未確認、環境override、実行前再チェック等の負例テスト。
- 既存 tests/scout-point10x-disposable-postgres-proof.test.mjsを更新：生成した専用コンテナのみ安全にcleanupする契約を確認する。

## 4. 到達範囲と実証待ち

- Node単体テストは実SQL検証とは異なる。現時点の実PostgreSQL実証件数は**0/14**。
- 将来の使い捨てDB検証も、同一コンテナ内のsynthetic CONTROLとSTAGEという別論理DBに限定。独立物理CONTROLサーバ、実Supabase ACL/SECDEF・service_role、実9種類のPoint Writer、private marker、RPC 5pt→50pt、Point/XP／逆仕訳保全、独立Restore、本物のCOMMITネットワーク喪失を証明しない。
- 本ターンはSupabase DB read/write、Staging実行、Production変更、Secret参照、Issue #294のOWNER承認・CLAIMED・CONSUMED実投稿、main merge、deployを実施していない。

## 5. 次工程の条件

Docker Engineが安全に稼働し、既存コンテナもvolumeも存在せず、postgres:16-alpineがローカルcache済みで、ユーザーの許可がある場合に限って新規使い捨てPostgresで14シナリオを検証する。条件が一つでも欠ければ安全停止を維持し、既存環境を起動・削除しない。

隔離実証の成功後も、Staging／Production readinessには実環境での安全性・OWNER承認という別ゲートが残る。

最終のローカルテスト／CI／CodeQL結果はDraft PR #2762へ追記する。
