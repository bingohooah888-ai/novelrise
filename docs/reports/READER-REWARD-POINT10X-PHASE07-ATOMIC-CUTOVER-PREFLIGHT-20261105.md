# NOVELIGHT βScout Point10倍｜第7工程 原子的Unit切替・非稼働監査

記録日：2026-11-05（JST）。この資料は非稼働設計と模擬テストのみであり、実DB・Staging・Productionを検証した証拠ではない。

## FULL PREFLIGHT と対象の境界

- 最新 main SHA：03f64b14138ec5c6a90c0d8231a0784f878e78fa。
- 正式 MASTER：docs/NOVELIGHT-MASTER.md の main blob 91d11fa367b7de64990b13397b13d4bb6e3c0230。2026-10-29 OWNER恒久規則の一回限り承認・環境の区別・4段階の実証レベルを優先。
- 最新 main の AGENTS.md、WORK-EXECUTION-PREFLIGHT.md、AUTOMATION-CONTINUATION-GATE.md、NLO-EXECUTION-POLICY.md、および Runtime Gate を確認。
- 本体 Draft PR #2762：開始時 aeb6cf0e1bf040225ad25fa3caf56912aae345a6、未統合・Draft。
- SQL候補 Draft PR #2763：58e60ef90801078e097e321590428c4b8b343486、変更しない。
- Issue #294・旧 rollback-only scope・atomic rollback/persist の別scope・既存OWNER承認／SQL safety filter／稼働workflowを変更しない。今回の設計依頼は実Staging／Production承認とは解釈しない。

## 確認した既存コードの意味

独立SQL候補 #2763 は rollback-only 数値変換（Point ledger・badge reward・Point badge threshold/progress・operator amount）であり、scout_xp_ledgerの数値も、5ptの SECURITY DEFINER RPC も変更せず、private unit markerも作らない。永続cutoverの実行器や移行SQLとして流用してはならない。

既存契約は private marker のスキーマを novelight_reward_private、表を point_unit_cutovers と定義。scope×target unitとapproval comment IDの一意性、非公開権限、RLS/ACL、schema非露出が必要。旧 public.novelight_award_level_up_points() の正確な本文に対する5→50の単一箇所変更のみが許容候補であり、SECURITY DEFINER属性、owner、ACL、search_path、trigger、event_key/idempotencyを維持しなければならない。

## 新規非稼働モジュール

scripts/scout-point10x-atomic-unit-transaction-model.mjs

- 既存の Staging ref、private marker、RPC/marker固定SHA、atomic scope/mode、writer DB relations を参照し、新規の稼働SQLやworkflowを生成しない。
- 承認の使い切りtombstoneとfencing epoch、fresh main/HEAD、独立Backup/Restore、9種類Writer停止、旧SECDEF/service_roleを含むData Plane fence、SERIALIZABLE isolationと表ロック、source watermark・全行digestを前提条件とする。
- 対象5関係：scout_xp_ledger、scout_point_ledger、scout_badge_definitions、user_scout_badges、scout_point_operator_actions。Point value・全badge reward・対象2badgeのthreshold/progress・operator amountだけを×10。XP自体と非対象列・状態・イベントキー・逆仕訳参照・metadata・非Point進捗を変更しない。
- signed integer overflow/underflow、bigintのJS安全整数範囲、重複row/event key、未知Point metric badge、既存unit marker、前回unit変換があれば停止。
- private marker案と旧5pt→50pt RPC案を**同一の仮想transaction**で組み立てる。仮想出力にも実行可能なSQL・DB接続・Secretは含めない。post-commit fingerprintは実測していないため null／未検証と表記する。
- 12 checkpointで故障を挿入。COMMIT判定前の故障は仮想rollbackとし、COMMIT不明・timeoutでは自動rollback/retryしない。使い切り承認・Writer fenceを維持し、read-onlyのmarker/journal/DB状態の再照会へ保留。
- 呼出し側の全fixtureがtrueでも、actualTransactionStarted、actualMarkerInserted、actualRpcReplaced、actualCommitConfirmed、mayRunSql、mayWriteDb、mayRunStaging、mayChangeProduction、mayMergeMain、mayDeployは常に false。成功ステータスは REVIEW_ONLY_ATOMIC_PROJECTION で実権限を表さない。

## 検証と残る未実証

新規 tests/scout-point10x-atomic-unit-transaction-model.test.mjs は scopeとSHAの改ざん、旧scope混入、tombstone欠落、古いfencing token、private marker重複、旧RPC/候補RPCハッシュ異常、Point・XPイベントキーの重複、各列のoverflow、12段階のクラッシュ、COMMIT不明時の再試行阻止を反証。新規89件、既存928件と合わせ全対象1017件が隔離Node24でPASS／0 FAIL。Prettier・ESLint・Node構文・git diff --checkもPASS。CI/CodeQLは同一HEADでGitHubの結果を追跡し、PR本文へ記録する。

未実証：真正な原子的DB transaction、fencing付きの旧/新Writer完全停止、独立Backup/Restore、private marker DDL／SECURITY DEFINER実置換、既存ACL/RLS/triggerの実システムカタログ同一性、全行Reconciliation、COMMIT後のUI表示、実Staging試験。

現行の競合問題は解決していない：GitHub Issue commentのread→appendは原子的CLAIMでない。GitHub Actionsのadmit/stageと非稼働案のconcurrency groupが一致しておらず、名称を合わせるだけではData Plane fencingと永続原子性を証明できない。

## 本タスクの実操作禁止と後続条件

実DB read/write、Staging SQL、Staging secrets、Production mutation、CLAIMED/CONSUMED実投稿、main merge、本番deployは行わない。Draft PR #2762の隔離ソース・テスト・設計レポート・非稼働YAMLの注釈以外は変更しない。実Staging実行には新たな対象SHA・project・scope・実行回数に固定したOWNER承認と、安全な原子的実行器の別審査が必要。
