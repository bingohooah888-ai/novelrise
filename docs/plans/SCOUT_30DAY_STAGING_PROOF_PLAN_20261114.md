# NOVELIGHT — 30日SCOUT Staging安全検証計画

**DESIGN ONLY / DO NOT EXECUTE / NOT_EXECUTED** — このMarkdownとJSONマトリクスは検証の準備であり、実行の承認ではない。対象はDraft PR #2862。実際のStaging検証は**別途明示承認が必要**。Production、main、PR #2762、実ユーザー、秘密情報、Cron、既存レビューRPCに触れない。

## 0. 確認済みの安全境界（実行時には再確認必須）

- `FORMAL_MAINTENANCE_SAFETY_APPROVED = false` によりRunnerは停止中。ただし**JSの停止ゲートは管理権限からの直接RPC実行を止めない**。実 `review_scout_30_days` は一度も呼び出さない。
- Stagingの既定分離は `READ COMMITTED`。共通XPロックを使うDB関数は現在0件。レビューRPCの期間sealは未実装。
- `service_role` はprivateスキーマUSAGE・既存レビューRPC EXECUTEを持つが、`scout_level_state` の直接SELECTは不可。private `list_due_scout_30_day_reviews` は未作成。**No GRANT SELECT** を維持する。
- β版capトリガー、発掘XPの取り込み/補償、期間seal、共通ロック、非公開due-RPCが未完成。したがって運用判定は**HELD (fail-closed)**。

## 1. 実行前precheck（SELECTおよびカタログ確認に限定）

| ID | 必要条件と異常停止 |
|---|---|
| P01 | PR #2862のHEAD・最新main・参照SQLのGit blobを完全SHAで再照合。Draft以外、予期せぬ変更、別PRへの影響を検知したらSTOP。 |
| P02 | Supabase ref `wmlzjgvxgoyrovdhbqbg` が**Stagingであること**、branch健康度、移行履歴、既存の承認待ち作業を確認。失敗・不整合ならSTOP。 |
| P03 | 合成E2Eアカウントが厳密に1件で、内部管理の `raw_app_meta_data.internal_e2e` ・証明スコープ・登録時刻に一致。`user_metadata` を単独の権限証明にしない。実ユーザーは対象外。 |
| P04 | SELECTのみで合成UUIDの正式Lv・最高Lv・XP・review_anchor・last_review_end・revision、Wallet全残高とrevision、レビューclaim・XP/Point台帳の行数とフィンガープリントを保存。開始前と終了後で厳密に比較。 |
| P05 | `pg_proc` / `pg_trigger` / `pg_class` / `pg_roles` の定義・RLS・EXECUTE/SELECTを照合。直接SELECT不足・seal/RPC未実装は**運用を許可しない**停止条件。 |
| P06 | A/B/Cの3セッションをそれぞれ独立した**同一物理接続を維持する**PGクライアントで確立。backend PIDとbackend_startを複数文にわたり検証。接続プーラーやMCPの文単位セッションではSTOP。 |
| P07 | 各接続でBEGIN→ROLLBACKが維持されることを事前に無害な方法で検証。`statement_timeout` ・ `lock_timeout` ・ `idle_in_transaction_session_timeout`、例外時finallyのROLLBACK、接続切断時の回収を備える。 |
| P08 | 通知・外部HTTP・ジョブ送信・sequence等の非トランザクショナル副作用がゼロであること。疑いがあればSTOP。 |
| P09 | 別のStaging移行/バックフィル/ワンタイム承認/同一合成ユーザーの操作がないこと。不明ならSTOP。 |

**重要:** PostgreSQLのTEMPテーブルはセッション間で共有できない。未コミットの新規共有テーブルも他セッションから利用できない。**Stagingに共有fixtureを作成することは承認対象外**である。

## 2. 複数セッション（将来別承認のStagingロック試験、実データ変更なし）

### S01 — transaction-level advisory lock / 全接続ROLLBACK

1. A/B/Cの別セッションを開き、互いに異なるbackend PID・固定された接続を確認。各接続をBEGINし、全操作に短いtimeoutを設定する。
2. Aが内部合成UUIDと証明専用namespaceから導出した `pg_advisory_xact_lock` を取得。**session-level lockは禁止**。
3. Bが同じキーに `pg_try_advisory_xact_lock` を試し、**false**を確認。Bがtrueなら異常停止。
4. Cは別キーを試し、接続混線がないことを確認。AがROLLBACKした後、Bが同一キーを再試行して**true**を確認。
5. B/Cも必ずROLLBACK。すべての接続を切断し、専用ロックと残留トランザクションを読み取り専用で照合。

**この試験が証明するものはadvisory lockの基本動作のみ。** 既存XP付与関数・実レビューRPCが同じロックを採用したこと、XP200が正しく数えられることは一切証明しない。共通ロック実装はまだない。

### S02 — 安全停止・権限境界

Runner固定ゲートfalse、全フラグtrueのモックでもSQL/RPC/Cronが実行されないことを確認。StagingのカタログをSELECTして `service_role` のprivate state直接SELECT拒否、private due-RPC未実装、レビューRPCのclient EXECUTE拒否を照合する。**実レビューRPCは実行しない。** 未作成RPCを検証するためStagingへ導入してはいけない。

## 3. COMMIT順序・実XPの競合を試す使い捨てDB clone（Staging外・別承認）

実ユーザーデータを含まず、合成UUID・合成XP・事前に作られた共有fixtureテーブルのみを用いる。A/B/Cは別の物理接続を保持する。clone限定で**必要なCOMMITを含む**試験とし、最後にcloneを破棄する（別途承認）。

| ID | 競合手順 | 合格条件 |
|---|---|---|
| C01 | Aが199→200の1XPを未コミットINSERTしロック保持。Bは同一読者のロックを待つ。AがCOMMIT後、Bが**新しいSQL文のfresh snapshot**で集計。 | XP200、降格なし。 |
| C02 | AがXP追加をROLLBACK。Bはロック解放後に再集計。 | 199XP。しかしseal未証明なら**HELD**で降格しない。 |
| C03 | Bがレビュー候補を先に押さえ、Aから過去日時のlate XPが到着。 | 信頼できるseal前は**HELD**、seal後は永続的な隔離/訂正待ち。黙って破棄しない。 |
| C04 | 負XPの訂正、UPDATE/DELETE、バックフィルを競合させる。 | 同一のreader lockで直列化。訂正時は**HELD**。 |
| C05 | 2読者間の転記をA/B逆順で試す。 | 旧/新UUIDキーを決定的順で取得し、デッドロックなし。 |
| C06 | βcap継続・発掘XP未接続のまま起動判定。 | 正式cutover証明まで**HELD**。 |
| C07 | 将来のprivate due-RPCをclone限定で試験。 | NOLOGIN最小権限、最大25件、安定ソート、server time、権限外呼出し拒否。**No GRANT SELECT** to service_role。 |

**全接続ROLLBACKでは、他セッションのCOMMIT済みXPを新しいsnapshotから読めるか検証できない。** PostgreSQLのREAD COMMITTEDでは未コミット行が見えない。C01等はcloneの専用fixtureでCOMMITを許容する**別承認**が必要。StagingではCOMMITを行わない。

## 4. 強制ROLLBACKと異常時の扱い

- **StagingのA/B/C全トランザクションにfinallyのROLLBACKを必須**とする。成功・タイムアウト・中断のいずれでも同じ処理。
- ROLLBACKのサーバー応答が得られなければ接続を強制切断。別の独立した管理接続で `pg_stat_activity` と `pg_locks` を照合して未完了トランザクション/専用ロックがゼロであることを確認。不明ならFAIL・隔離。
- 期待したロック応答でない、backendが変わった、秘密がログに出る、合成ユーザー条件不一致、書き込み/外部副作用の疑い、意図しない別ジョブ検出なら**即STOP**。次の工程に進まず、変更・修復・承認消費を行わない。

## 5. 検証後SELECT（開始前P04と完全一致）

1. `scout_level_state` のcurrent_level、highest_level、level_progress_xp、review_anchor_at、last_review_end_at、revisionが完全一致。
2. `scout_point_usage_wallets` のavailable_points、exchange_eligible_points、reserved_points、held_points、revisionが完全一致。
3. 合成UUIDの `scout_review_claim`、`scout_xp_ledger`、`scout_point_ledger` は行数**だけでなく内容fingerprintも一致**。
4. A/B/Cの全接続終了と専用ロック/未完了transactionゼロ。Staging DDL、権限、トリガー、migration履歴、Cron、環境変数、Workflowに変化なし。
5. **PASS / FAIL / NOT_EXECUTED** を区別。差分・欠損が1つでもあればPASSを出さない。実レビューRPCを呼び出さない。

## 6. 別承認とリリース禁止

この計画は**PLAN_VALIDATED**であり、**STAGING_PROVEN**ではない。seal／late-XP補償／β→正式版cutoverの実装・権限変更・データ移行・RPC生成は別承認。共通ロック設計のテストで実XP writerの直列化まで証明したと扱わない。試験用Stagingロック取得さえ別の明示承認が必要。本番公開・Cron接続・実レビューRPCは禁止。

PostgreSQL公式資料:
- https://www.postgresql.org/docs/current/transaction-iso.html
- https://www.postgresql.org/docs/current/explicit-locking.html
- https://www.postgresql.org/docs/current/sql-createtable.html
