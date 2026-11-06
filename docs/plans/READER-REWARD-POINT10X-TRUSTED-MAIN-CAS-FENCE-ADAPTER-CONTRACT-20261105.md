# NOVELIGHT βScout Point10倍｜trusted-main／永続CAS／Data Plane fencing 受渡し契約

**2026-11-05 JST｜非稼働・OWNER承認前設計。実SQL、実Secret、実DB環境接続、GitHub Issue実CLAIMED投稿、workflow activationは行わない。**

## 1. 問題を引き起こしている仕組み

最新mainは 03f64b14138ec5c6a90c0d8231a0784f878e78fa（MASTER blob 91d11fa367b7de64990b13397b13d4bb6e3c0230）。今回開始時の本体Draft #2762 HEADは 90a858ea53f263cdf1cd51a310d987f2026db8dd、SQL rollback-only候補Draft #2763 は 58e60ef90801078e097e321590428c4b8b343486。いずれもmain未統合。

旧Staging rollback-only workflowのadmit jobはconcurrency group novelight-reader-point10x-admit-issue294、stage jobは supabase-staging-migration-sync、非稼働atomic blueprintは novelight-issue294-staging-atomic-review-inert。3グループは共通排他の証明にならない。

Issue #294コメントの「全履歴を読む→CLAIMEDコメントを書く」は原子的比較更新でない。2つのrunnerがそれぞれ「まだCLAIMEDがない」と判断できる。GitHub Actions concurrencyは単独では永続一回限りの承認消費でもDBのfencing tokenでもない。

また service_role による直接テーブル更新・旧SECURITY DEFINER RPCは、アプリケーション側のtokenや単なるRLSで必ず遮断できると証明されていない。旧・新の全Writerが同じDB側強制機構へ収束するまで、実Stagingの解禁は不可。

## 2. trusted-main実行器の明確な責務境界（今は稼働しない）

1. main上のレビュー済み実行器を**新たなOWNER承認により別途導入**するまで起動しない。PR headのworkflowやリポジトリ外部から渡されたGitHub commentを実行コードとして信用しない。
2. Issue #294（表題・state・owner／actor／triggering actor／author_association・コメントIDとnonce）を**信頼できるGitHub APIの完全な履歴から新鮮に検証**する。過去承認は再利用しない。対象modeは atomic rollback-only proof と atomic persistent Staging cutoverで別、main SHAと候補HEAD・Staging ref・operation ID・RPC hash・marker hash・実行回数を固定。
3. Secret／Stagingへのアクセス前に、**独立した永続プライマリの原子的トランザクション**で a) 唯一のmutation-domain owner、b) comment ID＋operation ID＋scope/候補HEADのspent tombstone、c) monotonic fencing epoch を同時に確定する。別トランザクション・Issue追記だけで代用しない。
4. PRIMARY CASの成功応答が消えても「失敗だから承認未消費」と判断しない。原本PRIMARYを**read-only再照会**するまで保留。GitHub CLAIMED/CONSUMEDは監査用の**副記録**で、一次証明ではない。投稿失敗／クラッシュでもtombstoneを消さない。
5. 旧・新の全Staging Point mutationを横断する単一ドメイン（issue294-point10x-all-staging-writers）へ合流させる。異なるActions concurrency名を揃えるだけでは未解決。管理者直接DMLなど迂回経路を閉鎖できない限りFail Closed。
6. 9種類のWriter／SECDEF・service_role／Edge・Cron・queued／outbox・inflightに**DB側で単調epoch照合**を行う。単なるアプリ側チェックはTOCTOUであり、短時間leaseの期限切れで古い実行を勝手に再開させてはいけない。
7. 実データのバックアップを別インスタンスに独立Restoreし、XP・Point・Badge・Operator5表、event_key・逆仕訳・RLS・ACL・trigger・markerを照合する。実Postgresに対する証拠は別Staging承認後でしか取得できない。
8. private marker／5→50 SECDEF RPC／5表の全行整合性を単一DB COMMIT内で検証。COMMIT応答unknownは**自動再試行・古いバックアップ復元・Writer再開とも禁止**。独立read-only再照会と新規OWNER判断へ。

## 3. 実装候補ストレージの監査要件（レビュー専用、SQLファイルではない）

- **Primary durable ledger**：一回限りのclaim／spentを一つの線形化可能トランザクションで更新できる実ストレージ。GitHub issueコメントはバックアップ監査であって主台帳ではない。
- **Domain record**：unique domain、version、monotonic epoch、owner comment ID／run ID／request hash、active state、commit-unknown保留。競合したtxnは必ず片方を中止。
- **Spent record**：独立unique(issue,comment ID)、unique(operation ID)、unique(scope,candidate HEAD)、created-at・決定理由・一回限りの状態。事後cleanupでも削除しない（長期保持と個人情報最小化は別監査）。
- **Atomic acquire**：unique制約とdomain epochの増加、active lease取得、spent insertは**一つのDBトランザクション内**。DB障害やack消失時に「未消費」と扱うことは許さない。
- **DB enforcement**：実Stagingは既存テーブル権限、trigger・SECDEF owner、service_role相当権限、DB catalogを独立検査。すべての書込みをfence付き保護経路へ通すか、その時間だけDB権限で確実に拒否する。**PostgreSQLの通常RLSはservice_role/所有者に対する必須の拒否策ではない**。
- **Writer pause proof**：9種類全てでadmission closed、active/inflight/queued/retry/unacked/outbox=0、旧token拒否、2つの独立read-only sequence/digestサンプル。
- **Security**：repoのDraftにSecret／DB URL／JWT／Service Role Token／OAuth／署名URLを保存しない。失敗ログは段階名・sanitized reason code・run IDだけ。
- **OWNER gate**：trusted-main実行器の採用・Staging実行・main merge・Production mutationはそれぞれ別の明示承認。scope・SHA・対象環境が変われば新規承認。

## 4. 非稼働モデルの位置付け

scripts/scout-point10x-cas-fencing-handoff-model.mjs は実CAS/DB強制ロックではない。自己申告の所有者情報・writer evidenceは信頼してよい証明ではなく、純関数は常に canReadSecrets=false／canCommitSql=false／canRunStaging=false／canWriteDb=false／canMergeMain=falseを返す。特権経路の侵入、同時claim、旧token、失敗ack、domain競合を模擬的にFail Closedにするだけである。

**要実証：** 独立CASストア／全Writer DB gate／privileged DML遮断／GitHub OWNER認証／真正なStaging backup/Restore／COMMIT不明状態の実読取り。**今回はこれらを解決したと報告しない。**

## 5. 最小の次の実装単位（今ターンでは禁止）

許可された範囲の次ステップは、別のセキュリティレビューで Staging専用の永続CAS＋DB gate案を選定し、既存DBの権限・SECDEF・トリガーのどの経路にも抜け穴がないことを**read-only catalog**で調査すること。現在の実行禁止を超えてSupabase migrationを作成・適用、旧workflowを自動起動、Secretを取得することはしない。
