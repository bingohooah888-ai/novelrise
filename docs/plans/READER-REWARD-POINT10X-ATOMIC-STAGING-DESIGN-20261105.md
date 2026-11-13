# NOVELIGHT βScout Point 10倍 — 専用Staging原子切替の設計案（未実行）

作成：2026-11-05 JST
対象：将来の別途OWNER承認を受けたStagingだけ。本書の提出はDB書込みを許可しない。

## 1. 正式基準と別PRの境界

- 正式main SHA 03f64b14138ec5c6a90c0d8231a0784f878e78fa。MASTER blob 91d11fa367b7de64990b13397b13d4bb6e3c0230（5,089行）。AGENTS、FULL PREFLIGHT、Continuation Gate、NLO Policy、development workflowに従う。
- 本体Draft PR #2762には10 Point＝1円、β旧Pointを全件10倍、external gift最低30,000 Point、reader-level 50ptの方針、OwnerのIssue #294承認検証経路がある。ただし当該workflowはmain未統合のため**実行できない**。
- 独立Draft PR #2763は、precheck／migration／postcheck／rollbackの4 SQLによる**ROLLBACK限定**候補。現行trusted-main scripts/staging-candidate-sql.mjsはSECURITY DEFINERを禁止し、レベルアップ付与RPCの変更を含まない。既存フィルターを緩めず、#2763を永続migrationとみなさない。
- Issue #294のrollback-only OWNER承認、HEAD固定、CLAIMED／CONSUMED、Supabase専用Staging project ref wmlzjgvxgoyrovdhbqbgを保持。永続Staging cutoverは**別scope・別承認・別監査**が必要。Production ref fiepaguycecrredwrcwxへの接続は禁止。

## 2. 専用Staging実行経路に必要な仕組み

1. Trusted main上の新規レビュー済みexecutorだけが、新しい正規のOWNER承認を検証し、対象Staging project／最新main SHA／候補HEAD／使い切り承認IDを照合する。PR内の任意scriptやworkflowを実行しない。承認モードはatomic-rollback-only-proofとatomic-persistent-staging-cutoverに分離し、前者を後者へ昇格できない。
2. 5pt→50pt関数は、現行SECURITY DEFINERトリガー関数のpg_get_functiondef()をSHA-256で固定し、報酬リテラル1か所だけを置換する候補を作る。owner=postgres、EXECUTE ACL（postgres/service_role）、LANGUAGE plpgsql、SECURITY DEFINER、SET search_path TO 空、元のevent_key冪等性、scout_xp_level_up_pointsトリガーのenabled/AFTER INSERTを変更してはいけない。新しい専用審査経路の安全性が成立するまでDDLを実行しない。
3. 旧Rank内部RPC、発掘、称号付与、運営調整、XPトリガー、Service Role直接SQL、API、Edge、Cron、Queue/Retry、Outbox、潜在する旧経路を全部棚卸しする。表示だけを隠しても停止証明にならない。停止した全writerをDBレベルのフェンス＋実行経路停止で保証し、in-flight=0、再送=0、未分類writer=0を独立確認する。
4. Staging全体の論理バックアップを確実に取得し、別のPostgreSQLへ完全復元してRLS・ACL・SECURITY DEFINER・trigger・extension・関数・台帳全件が一致することを確認。Backupとローカル復元の結果は漏洩させない。Cloud StorageなどDB外資産は別途保護が必要。
5. 専用private schemaに、cutover_scope×target_unit_versionを一意化した永続markerを設計。anon/authenticatedや一般公開APIから閲覧・書換え不能、強権限の操作に監査をつけ、markerの再実行防止を行う。markerのDDLは今回作成も適用もしない。

## 3. 原子的な一括変更手順（擬似手順、実行可能SQLではない）

    Gate: 最新mainと候補HEAD、Issue #294 OWNER本人の新規scope専用承認
    Gate: Staging projectの分離／独立Backup・Restore／現行権限とRPCのdigest
    Gate: すべての旧・新Point writer停止、in-flight=0、DB-enforced fence
    BEGIN SERIALIZABLE / bounded timeouts
      専用advisory lock＋XP／Point／Badge／Operatorの強制ロック
      最新の一貫した全行snapshotと旧単位を再照合
      対象private markerが未登録、source versionが一致と検証
      private unique markerをこの1トランザクションにINSERT
      Scout Point台帳全行のPoint数値を10倍（負数・非confirmed含む）
      全称号Point報酬を10倍（earned状態は保持）
      Scout Point獲得条件の称号閾値だけを10倍
      対応するScout Point称号進捗だけを10倍
      運営Point調整金額だけを10倍（NULLと符号を維持）
      既存SECURITY DEFINER関数の旧5pt→新50ptを一か所だけ変更
      owner／ACL／search_path／trigger／source signature／event_keyを照合
      台帳全行・残高・獲得済み称号・XP・reversal・監査を照合
      全対象の一致を確認。障害時にはCOMMITを禁止
    COMMIT（marker、データ、RPCを同一の確定境界で不可分に更新）
    書込み停止を維持して、更新後のRead RPC・画面・RLS・新付与を実証
    別途承認された場合だけwritersを再開

既存Point台帳トリガーはpoint_valueのUPDATEのみではPoint累積称号を自動追随させない。対応するprogressを同一commit内で変換し、称号報酬の二重授与を発生させない。台帳の原則追記不可変と旧行換算の例外も事前監査が必要。

## 4. 障害・二重変換・復旧の反証条件

- BEGIN前：SHA、Staging project、承認scope、バックアップ、復旧、writer fenceに不一致があればSQL実行せず停止。
- COMMIT前：marker挿入直後、Point台帳中、報酬定義中、条件・progress中、運営調整中、50pt関数置換直後、完全照合中の全段階で障害注入。ROLLBACK後、marker未登録・旧5pt RPC・旧Point全行・XPとearned等の元値が完全一致することを独立証明。
- COMMIT後：**DB ROLLBACKはできない**。正当な新規Pointを発行済みなら旧backupを自動上書きするとポイントが消えるため禁止。event journalでforward repairを別審査し、別途OWNER承認まで安全停止。
- 二重適用、異なるSource Unit、旧Writer直書き、旧Rank内部関数、unknown service_role、retry race、row-count一致だがevent_keyや元値が変化、signed integer overflow、反転reversal破壊、markerの権限違反、未知のtrigger増加を拒否。
- Staging過去集計（ledger 3,581件／旧3,581pt、Point進捗12,870件）は現在の確定数値ではない。実施前に新たなread-only全件確認・Owner reviewが必要。

## 5. このDraftで実際に作成したもの

- api/_lib/reader-reward/point10x-atomic-staging-simulation.js：合成データだけを受け付ける純粋ESM。14段階のlogical transaction、private marker候補、50pt definer parity、旧writer fence、故障注入、COMMIT前ROLLBACKとCOMMIT後recovery holdを扱う。成功しても絶対に実DB権限を返さない。
- tests/reader-reward-point10x-atomic-staging-simulation.test.mjs：14段階の故障注入、データ変換とPoint以外の不変性、承認・backups・writer fenceの欠落、二重変換・権限ドリフト・外部データ混入、COMMIT後の誤った古いbackup復元を拒否する反証テスト。
- この設計案と別レポートをDraft PR #2762に追加。本体の旧GateやDraft PR #2763、安全ゲート・既存SQLフィルターは変更しない。

## 6. できたこと／できていないこと

できた：read-only preflight、旧・新Staging scopeと安全境界の設計、合成データによるtransaction failure/rollback/post-commit recoveryの反証。
未実施：private marker DDL／SQL composer新経路／実DB SQL／Staging独立backup／Restore／DB-enforced writer fence／SECURITY DEFINER関数変更／実ブラウザ・RLS検証／本番デプロイ／main merge。これらは実装・レビュー・正規の一回限り承認が必要。

**本書・合成シミュレーションはStaging実行許可やlive-proofではない。**
