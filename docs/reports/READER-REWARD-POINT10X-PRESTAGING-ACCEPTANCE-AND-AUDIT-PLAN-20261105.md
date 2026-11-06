# NOVELIGHT βScout Point10倍｜Staging実証前の受入基準・最小権限・監査計画

**2026-11-05（JST）／FULL PREFLIGHT／#2762 Draft／完全非稼働／NO-GO**

> **本書は承認発行・実行手順書の有効化ではなく、将来の証拠受入基準です。** 実DB接続、SQL実行、Docker、Staging／Productionへの変更、OWNER承認の代理発行・消費、Issue #294のCLAIMED／CONSUMED、main merge、デプロイを許可しません。

## 1. 正本と変更禁止領域

| 対象                     | 2026-11-05 本工程開始時の確認値                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| 最新 main                | `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`                                                                |
| 正式 MASTER              | `docs/NOVELIGHT-MASTER.md` blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`                                |
| 本体 Draft PR #2762      | 開始HEAD `3502ddc31ee591e4a5b3ed3d59623dbafe15ab92`                                                       |
| 別SQL候補 Draft PR #2763 | `58e60ef90801078e097e321590428c4b8b343486`。変更しない                                                    |
| OWNER管理 Issue #294     | `[Staging Control] Supabase migration sync`。新read-only scopeは未登録・未承認。既存OWNER承認は使用しない |
| 既存8照会SQL SHA256      | `740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11`                                        |
| 既存3照会SQL SHA256      | `6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1`                                        |
| 実装ルール               | mainのMASTER・AGENTS.md・WORK-EXECUTION-PREFLIGHT・AUTOMATION-CONTINUATION-GATE・NLO-EXECUTION-POLICY     |

従来の2 SQLは別々のBEGIN／ROLLBACKを持つため、そのまま2本実行しても同一snapshotにはならない。将来の信頼済みread-only executorだけが原本byte hashを照合し、固定11 SELECTを承認済み派生計画どおり単一物理接続／単一REPEATABLE READ READ ONLYトランザクションで実行する設計とする。静的抽出器はPostgreSQL実パーサーの証明ではない。

## 2. 受入の5段階と責任分界

| 段階                           | 機械ゲート     | 位置づけ                                                                       | 証拠の責任主体                                             | 現状態                     |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------- |
| A. 非稼働設計確認              | D01–D05（5件） | SHA、設計、証拠保護、scope分離をソースのみで確認                               | trusted code reviewer（将来の独立審査が必要）              | 非稼働で形状監査可能       |
| B. read-only Staging実行の入場 | R01–R08（8件） | 新規OWNER承認・永続CAS・最小権限・独立Staging identity・完全履歴               | OWNER本人イベント、独立CONTROL primary、Staging権限管理者  | **未登録／未承認／未実証** |
| C. read-only実行の実証         | P01–P06（6件） | 実PG 11 SELECT、同一snapshot、結果整合、ROLLBACK確認、監査保存                 | 信頼済みread-only executor／独立auditor                    | **未実施**                 |
| D. 永続切替の入場              | C01–C09（9件） | 新たな**別の**mutation scope、CAS、全Writer遮断、独立Restore、atomic変換・復旧 | OWNER／独立CONTROL／Data Plane／別DB復旧担当               | **未実装・未実証**         |
| E. 永続切替の実証              | Q01–Q06（6件） | 実Writer排他、独立Restore、1 COMMIT・5→50 RPC・データ保存・後続整合            | 信頼済み実行器／独立復旧・監査主体／将来の別Production承認 | **未実施**                 |

**重要：BとCは、read-only監査の証拠を収集するための承認とその実証。DとEは後続の永続mutationの安全性であり、B/Cが成功してもD/Eの承認やWriter再開を許可しない。** 独立Backup/Restoreは永続切替の入場条件であり、メタデータのみのread-only SELECTを始める以前に「実施済み」と誤記してはならない。source-onlyの設計確認がPASSしてもAは実環境ではない。

## 3. 新規read-only OWNER scopeの提案（今回未登録）

`reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly`

提案操作 `read-catalog-11-same-snapshot`、対象Issue #294、**新しい一回限りのOWNER本人イベント**、専用Staging ref、最新main SHA・#2762の最新HEAD・固定8+3原SQLの全bytes SHA・派生11照会manifest digest・実行器コードdigest・実行回数1・期限・保存ポリシーをセットとして識別する。**新scopeをIssue #294へ登録・投稿していない。** 旧catalog、rollback-only、persist、main統合承認は流用不可。

信頼できる認証主体は「chat文字列」や「caller-provided JSON」ではなく、信頼済みmainからGitHubの実ユーザー／comment ID／Issue／全ページ／更新・削除・再利用履歴をfresh確認する別実装。承認の取得、CONTROL CAS消費、実Staging接続は将来の専用承認境界であり、**今回のマトリクスが返す値はすべて非権威的**。

### 承認のスコープ分離

1. **read-only catalog scope**：原SQL 11 SELECT、同一snapshot、ROLLBACK限定。Point更新不可。
2. **atomic rollback-only proof scope**：別操作、別SHA、別OWNER承認。既存Draft #2763の数値列×10候補が本番切替と同一とは扱わない。
3. **persistent Staging cutover scope**：旧5→50 RPC、private marker、5表整合、全Writer遮断、独立Restoreが必要。read-only承認を流用不可。
4. **Production/main統合**：さらに別対象・別承認。mainへ統合されると自動デプロイの可能性があり、事前説明なしには行わない。

## 4. 最小権限・接続と監査証拠の受入基準

| 項目               | 必要な独立実証                                                                                                                                                                                                     | HOLD条件                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 実行器の信頼性     | 審査済みtrusted-mainの専用read-only executor。PR由来の任意shell／SQLを起動しない。実行器・extractorのSHAがOWNER scopeと一致                                                                                        | 主張だけのtrusted属性、任意driver、未承認スクリプト                              |
| Project ID         | 専用Staging接続先を接続前後に独立照合。Productionを明示的に排除。資格情報は環境限定で値を非表示                                                                                                                    | Project/endpoint不明、Productionへの転送、Secret露出                             |
| PostgreSQL role    | catalogメタデータ閲覧に必要な最小権限（検証されたpg_catalog／information_schema経路のみ）、read-only transaction、DML／DDL／EXECUTEやrole escalation禁止。service_role／DB owner／superuser／BYPASSRLSを利用しない | 過剰権限、SECURITY DEFINERの副作用や動的SQL、未監査関数の呼出し                  |
| SQL                | 全bytes SHA256固定の2原本と派生manifest SHA。11個の許可SELECT/WITH句だけ。1物理session・1 transaction・`READ ONLY REPEATABLE READ`                                                                                 | fragment追加・順序変更、別session混入、COMMIT、禁止関数                          |
| 正当な結果         | 全11 section ID・順序・statement digest・件数・schema・anon result digest・同一session/transaction/snapshot証拠・known privileged routeの漏れなし                                                                  | 結果欠損、未知のACL・role・RPC・trigger、途中timeout                             |
| ROLLBACK / cleanup | 同一sessionのROLLBACK ACK、connection close ACK、失敗時の部分結果廃棄と明示HOLD                                                                                                                                    | ACK不明、途中再接続、再試行、cleanup未証明                                       |
| 監査保存           | access制限した不変の証拠・独立の完全性証明、run/correlation ID、SHA、section ID・匿名digest・失敗分類・cleanup結果。保持期限・閲覧権限・削除基準を別審査                                                           | 生の行、個人情報、SQL全文、DB URL、Cookie、JWT、Secrets、未認証の単なるSHA文字列 |

**受入判断の主体**：Trusted GitHub OWNER確認／独立CONTROL spent CAS／最小権限Staging PostgreSQL／独立監査保管を分離する。特に「監査digestが一致した」は署名・実行主体本人性・DB側強制権限の代替にならない。新規read-only権限付与は既存ロール変更を伴い得るため、今回作成・付与しない。

## 5. 永続CONTROL CASの受入基準（設計のみ）

- 独立した永続primaryの**1つのlinearizable transaction**で、`UNIQUE(issue_number,comment_id)`、`UNIQUE(operation_id)`、scope/headの再利用拒否、shared domain `issue294-point10x-all-staging-writers` の排他、永久spent tombstone、単調epoch増加を不可分に記録する。GitHub Issueコメントread→appendやActions concurrencyを代わりにしない。
- CAS前にOwner本人性、全Issue #294履歴、最新main/PR HEAD、未失効、未spent、単一実行scopeを独立確認する。秘密へのアクセスより先に承認を原子的に消費する。
- CAS競合・epoch不一致・DB障害・ACK消失時は**自動再CLAIM、自動再接続、自動実行、writer解放を禁止**。同じ承認を失敗後に再利用しない。必要な独立primary readbackまでHOLD。
- read-only catalogの取得結果は**Writer fencingの実証ではない**。CONTROL上で排他ロックが取れたことだけを根拠に、旧SECURITY DEFINER／service_roleのDB側Writerが止まったと推測しない。
- GitHubのCLAIMED／CONSUMEDは二次監査であって、CONTROL primaryのspent強制と別物。今回はどちらにも書き込まない。

## 6. 永続切替用Data Plane fencingと独立Backup/Restore

**Writer分類：** source契約の9分類（XP level trigger、legacy rank internal、discovery/event trigger、badge、operator adjustment、service_role／privileged RPC、scheduled Edge/Cron/queue、application award routes、inflight/retry/outbox）。**特権経路：** legacy SECURITY DEFINER RPC／direct service_role DML／DB trigger・owner role／Edge-Cron-queue-retry／future unknown writerの5種類。これは**ソース分類**であり、9本の実Writer・5経路の稼働状態を実証した数ではない。

**Cutoverの入場条件：** 全旧・新WriterのData Plane側deny、旧token拒否、各クラスのactive/inflight/pending/queued/unacknowledged/retry/outboxのゼロ、共有fencing epochとDB強制排他、別sampleでwatermark不変を確認。unknown route・superuser/owner/DDL bypass・失われたfenceはHOLD。ソース上だけの遮断記述や1つのAPIのpause応答では不可。

**Backup/Restoreの入場条件：** Staging source全体の不変backupと検証可能なチェックサム・manifestを作り、**独立した別の隔離Postgres instance**に実Restore。XP/Point ledger、Badge定義・進捗、Operator actions等のデータ、function、owner、ACL、RLS、trigger、extension、event/reversal historyのscopeと整合を確認する。全表のcountだけでなくrow digestとsource watermark（backup時点、fence後locked source、独立Restore）を突合。欠落・不明・別時点ドリフト・未署名の単なるdump成功はHOLD。証拠はSecrets／生行データを公開しない。

**COMMIT後の復旧：** 結果不明ならprimary marker/ledger/journalを独立read-only確認するまでHOLD。COMMIT成立後は正当な新規Point・取消・XPイベントを古いbackupで上書きせず、別承認のforward repairをレビューする。実Restore操作は今回行わない。

## 7. 将来の監査実行計画（今回は一切実行しない）

| 順  | フェーズ                        | 観測物・完成条件                                                                                      | Stop条件                                      |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | P0 ソース固定                   | fresh main／MASTER／#2762/#2763 HEAD、Issue #294現状、SQL2本SHA、11計画digest、監査対象一覧を相互記録 | drift・差分未審査                             |
| 2   | P0 境界審査                     | trusted executor・role設計・scope・証拠の項目／保管・個人情報処理を独立レビュー                       | 既存安全ゲートへの例外要求                    |
| 3   | P1 新OWNER承認（将来）          | read-onlyだけの新規OWNER Issue #294 event＋最新SHA・期限・1回・Staging projectをtrusted mainで認証    | 旧scope／記録欠落／OWNER未承認                |
| 4   | P1 永続CONTROL（将来）          | read-onlyのfresh claim／spent CAS／共有epochのコミットが権威主体から確認できる                        | ACK unknown・競合・一部だけspent              |
| 5   | P1 Staging最小権限（将来）      | target/role実照合、secret非表示、read-only実行器のみが接続                                            | 余剰権限／本番混入                            |
| 6   | P2 同一snapshot取得（将来）     | 1接続1 transaction・固定11 SELECT・全section digests・ROLLBACK＋close ACK                             | 異常時は結果破棄、無断再試行禁止              |
| 7   | P2 独立監査（将来）             | ACL/owner/RPC/SECDEF/service_role/triggerの結果・不明経路・証拠保管を独立判定                         | 不一致ならNO-GO。Writer遮断済みとは宣言しない |
| 8   | P3 別切替審査（将来）           | Writer fence、drain、独立Restore、private marker、5→50 RPC、原子Point変換、復旧計画の実証             | 1つでも欠けたら切替承認申請不可               |
| 9   | P3 別OWNER mutation承認（将来） | 先行のread-onlyイベントとは**別の**一回限りの新scope/HEAD/対象                                        | 旧承認再利用・権限混同                        |
| 10  | P4 永続Staging cutover（将来）  | 個別承認後の実測、全行整合、権限照合、異常復旧、再試行防止、cleanup                                   | 不明時は隔離してHOLD                          |
| 11  | Production（将来）              | 独立した新しいOWNER決裁とProduction専用証拠                                                           | Staging承認を本番承認に解釈しない             |

## 8. 今回の非稼働成果物と証拠階層

1. `scripts/scout-point10x-prestaging-acceptance-matrix.mjs`：34項目の受入ゲートと5段階の証拠起点・受入／HOLD条件を静的定義。検証関数は過去の非稼働CAS／fencingを**再実装しない**。呼出し元の「live PASS」「承認済み」は拒否し、context・11 SELECT digest・scope・元SQL SHA・OWNER issue・9/5分類を完全に固定。正常な形のpacketは`DESIGN_MATRIX_COMPLETE_NO_GO`のみ、破損は`HOLD_INERT_ACCEPTANCE_CONTRACT`。
2. `tests/scout-point10x-prestaging-acceptance-matrix.test.mjs`：各ゲートの欠落、順序、type、偽証拠、URL参照の捏造、main/head/scope/DB target/SQL/hash drift、過剰権限要求、実実行フラグ等を反証。
3. 本書：将来の実証時に集めるべき証拠、役割分担、許容レベル、停止・復旧手順を記録。

| 区分                                                     | 本工程の証明範囲                                                                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ソース実装                                               | **非稼働の受入基準・監査計画のみ**                                                                                                                                                 |
| 自動テスト                                               | focused 147 PASS／0 FAIL、Node全5,404件中5,395 PASS／0 FAIL／9 SKIP。Prettier・ESLint・362 JS構文PASS、Runtime Gate start／implementation PASS。GitHub／CIとCodeQLは新HEADで別照合 |
| GitHub CI・CodeQL                                        | 同一HEADの成功／安全停止を別証拠として確認し、実DBの証明と混同しない                                                                                                               |
| Staging実DB 11 SELECT・CAS・Writer fence・Backup/Restore | **すべて未実施・未実証**                                                                                                                                                           |
| Production／main merge／deploy／OWNER消費                | **すべて未実施**                                                                                                                                                                   |

**最終判定：NO-GO維持。** 現在、read-only実行器が信頼済みmainに設置・承認された状態ではないため、34の項目を全部「満たした」とすることはできない。今回のマトリクスで「設計形状が正しい」という結果だけが得られても、OWNER登録、実DBの特権、実行許可、Production反映、Writer再開を一切生じさせない。
