# NOVELIGHT｜β Scout Point ×10 Staging専用承認経路・復旧証明 Runbook（Draft）

作成日：2026-11-05 JST  
対象：Draft PR #2762、`feature/reader-reward-gate01-20261104`  
参照：現行main `03f64b14138ec5c6a90c0d8231a0784f878e78fa`、正式MASTER `docs/NOVELIGHT-MASTER.md`、Issue [#294](https://github.com/bingohooah888-ai/novelrise/issues/294)。

**結論：既存ゲートに新scopeをねじ込まず、OWNER専用Issue #294の別エントリポイントを追加する。実行方式は rollback-only に限定する。今回、Stagingへの書込み・バックアップ取得・復元・デプロイ・main統合は実施しない。**

## A. 承認前の恒久ルール

1. 入口は新規 `.github/workflows/staging-reader-point-tenfold-proof.yml` に限定し、発火条件は**OWNER本人がIssue #294に投稿する新しい`issue_comment:created`だけ**。PR、push、workflow_dispatch、schedule、Issue #188、bot再実行、旧scope承認は不可。
2. OWNER認証は `issue.user.login`、`comment.user.login`、`comment.author_association='OWNER'`、`github.actor`、`github.triggering_actor`のすべて。どれか違えばFail Closed。Issueはexact number 294／exact title／open／PRでないこと。
3. canonical prefix は `NOVELIGHT_STAGING_READER_POINT10X_APPROVE `。**exact 8 field**：`scope`,`mode`,`mainSha`,`candidateSha`,`pr`,`stagingRef`,`version`,`confirmation`。許可値：`scope='reader-reward-beta-point-10x-staging'`,`mode='rollback-only'`,`stagingRef='wmlzjgvxgoyrovdhbqbg'`,`confirmation='STAGING APPROVED'`。実値のmainSha／candidateShaは承認直前にfresh取得。
4. 完全なIssue #294コメント台帳を全ページ取得し、`CLAIMED`または`CONSUMED`の同一commentIdがあれば二度目を拒否。claimは**Staging環境シークレットへアクセスする前**、同じIssueにOWNER認証済みGitHub Actions経路で記録。成功／失敗／中断時の結果をCONSUMEDとして追記し、復旧目的でも使用済み承認を再利用しない。
5. exact current main SHAとcandidate PR HEAD、base SHA、PRがopen/draft/unmerged、head repositoryが`bingohooah888-ai/novelrise`、compare behind0、SHA固定された候補SQL（migration/pre/post/rollback計4本）を検証。候補PRの`scripts/`、`.github/workflows/`、`api/`、MASTER、AGENTS変更を禁止。候補SQLのGit Blob SHA一致を検査し、PR内のscript／workflowを**実行しない**。
6. GitHub workflow自体は**mainに追加されるまでは起動しない**。今回のDraft PRはmain統合禁止のため、承認入口はコードとして準備しただけで稼働開始していない。また、#2762が後にmergeされればそのPRはclosedとなるため、SQL検証は**別の最小限の候補Draft PR**で行う。旧#2762のHEAD承認を使い回さない。

## B. SQL候補ファイルの固定フォーマット（別作業・未作成）

新しい候補Draft PRには、14桁version `YYYYMMDDHHMMSS`に対応する4ファイルを用意する。

- `supabase/migrations/<version>_reader_reward_point10x.sql`
- `supabase/checks/<version>_reader_reward_point10x_precheck.sql`
- `supabase/checks/<version>_reader_reward_point10x_postcheck.sql`
- `supabase/rollback/<version>_reader_reward_point10x_rollback.sql`

ファイルはOWNERレビュー・pin対象であり、将来の承認があっても**検証だけで永続化する能力は与えない**。既存のtrusted-main `scripts/staging-candidate-sql.mjs`は1つの`BEGIN...COMMIT`本文を取り出し、単一`BEGIN...ROLLBACK`のSQLに書き換える。既存の危険操作フィルターを緩めず、`SECURITY DEFINER`等はブロックされる。現行の`novelight_award_level_up_points()`はSECURITY DEFINERなので、このrollback-only経路だけではその関数の実変更を証明できない。**将来の正規のRPC変更・永続Staging書込みには別のレビュー・別承認が必要**。

## C. バックアップと独立したRestoreの検証順序

1. GitHub Actions job `admit`：Issue commentを厳密検証しCLAIMEDを先行記録。Validation失敗時はStaging用資格情報にアクセスしない。
2. job `stage`：GitHub`environment:staging`と既存の`supabase-staging-migration-sync`排他concurrencyを利用。trusted mainだけをcheckout。main/PR HEADのfresh再確認、SHA一致の4 SQL artifactだけを読み、trusted mainのcompilerに渡す。
3. `STAGING_SUPABASE_URL`の完全一致と秘密URLの接続先を、既存trusted-main `scripts/verify-staging-migration-target.mjs`で検査し、Production `fiepaguycecrredwrcwx`へ一切接続しない。
4. Staging DBの**全体論理バックアップを`pg_dump -Fc`で取得**。バックアップ内容一覧を`pg_restore --list`で読み、Point台帳が含まれることを確認。バックアップ本体・DB URL・ユーザー行データをログ／artifactに出力・アップロードしない。
5. `postgres:17`の一時ローカルサービスへ`pg_restore --exit-on-error --no-owner --no-acl`で復元し、**少なくともPoint台帳のcount/sumをStaging読み取り値と突合**。関数・extension・権限、クロススキーマ依存で完全Restoreできないなら、その時点でfail closedし、Stagingへのrollback-only SQLも実行しない。単なる`pg_dump`成功では十分としない。
6. main/PR HEADと接続先を再検証。バックアップ＋Restoreが成功した場合だけ、Approved SQLを1回`ROLLBACK`限定で実行する。前後のPoint台帳count/sumの一致を検証し、結果にかかわらずCONSUMEDを記録。ステージングの永続的なPoint残高・RPC・スキーマは変更しない。
7. Runnerはbackup、SQL、database URL、一時ファイルを`always()`で削除する。Disposable PostgreSQLのDBはjob終了とともに廃棄。BackupをGitHub artifactにアップロードしないため、復元可能性の**当該run証明に限定**され、長期災害対策用の永続バックアップを取得済みとはみなさない。

## D. 独立復旧・永続Cutoverの残存ゲート

- 今回の`rollback-only`と、実Stagingの永続10倍Point切替を同一承認で併用しない。永続切替には**別scope／別の明示的OWNER承認**と、実バックアップの保管場所・暗号化・復元SLA・保持期限・復旧責任者・事後整合を決める必要あり。
- Pointを旧単位で書く付与RPC、トリガー、管理画面や他のService Role書込み経路を単一の停止境界で揃える。**現存の5pt付与RPCをそのままにして台帳だけ10倍しない**。更新中の新規イベント消失・誤付与・重複防止を独立検証。
- Ledger、称号報酬、Point条件・進捗、運営調整、Writer RPCを同じcutoverとし、全件の元値／新値、source/reversal/event_key/earned/XPを監査。marker付き一回限りの更新、障害注入、再実行拒否、復元後の全件突合をStagingで実証する。
- Stagingでread-only確認した2026-11-05時点の件数（Ledger 3,581行／Point合計3,581、Point進捗12,870行）は**現時点固定ではない**。承認直前に最新を再取得し、変化したらスナップショットを更新してレビュー。
- RuntimeのSQL保護機能の限界、必要なSQL Blobの未作成、実バックアップ・Restore未実証を解決するまで「Staging実環境検証完了」とは報告しない。

## E. 承認状態

**このPRにおける状態**：承認入口・認証・一回限り台帳・独立バックアップ/Restore前提の`rollback-only`検証workflowをDraftで準備。実Staging操作なし。後にmainへ統合するには別途main統合承認が必要で、今回の依頼はそれを含まない。workflowがmainに反映されたら対象SQLの新しい候補PRを作成し、最新mainとPR HEADに結び付いた**新規のStaging承認**で検証する。Production DB／本番デプロイは別独立ゲートを維持。

これまでのStaging手順書 `docs/plans/READER-REWARD-POINT10X-STAGING-RUNBOOK-20261105.md` を置き換えず、この承認経路設計を補足として使用する。
