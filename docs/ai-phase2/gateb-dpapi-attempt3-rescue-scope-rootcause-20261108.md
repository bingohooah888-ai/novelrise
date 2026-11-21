# NOVELIGHT AI工程② Gate B：第3回独立SYSTEM Rescue失敗のオフライン原因分析（2026-11-08）

## 結論

第3回の最初の失敗記録 SCOPE_MANIFEST_FILES / UNCLASSIFIED_SYSTEM_ERROR と、Coordinatorの停止 WAIT_INDEPENDENT_SYSTEM_RESCUE_ARMED / INDEPENDENT_SYSTEM_RESCUE_HEARTBEAT_MISSING に対して、**再現可能なコード上の根本原因**を特定した。

PowerShellは大文字小文字を区別せず、呼び出し元のローカルスコープからも変数を解決する。Invoke-AuthorizedSystemRecovery にあるローカルの $state（読み込んだJSONオブジェクト）が、そこから呼ばれる Get-RescueScope 内の $State（スクリプトスコープの保護対象ファイルパス）を隠す。その状態で Assert-PinnedLeaf や ReadAllText にJSONオブジェクトが渡され、SCOPE_MANIFEST_FILES で未分類例外となり得る。

また Invoke-IndependentSystemGuardRestore のローカル $manifest が、同様に $Manifest（保護済みマニフェストのパス）と衝突する潜在不具合があった。

**証拠水準**：実機記録は失敗ステージと分類コードのみで、例外の生スタックや詳細メッセージは保存されていない。したがって実機記録そのものだけで例外型は確定できない。一方、Windows PowerShellの隔離fixtureで上記の名前解決を直接再現し、既存コードの呼び出し関係とステージに一致することを確認した。現状で最も具体的かつ実証済みの原因である。

## 実機の観測事実（読み取り専用）

- Draft PR #2774の修正前固定HEAD：ed029ee39e9eaa0e4a71365a365a021a78462587
- 第3回Coordinator：NO_GO_STAGE=WAIT_INDEPENDENT_SYSTEM_RESCUE_ARMED、NO_GO_CODE=INDEPENDENT_SYSTEM_RESCUE_HEARTBEAT_MISSING
- 初回SYSTEM Rescue失敗証拠：stage=SCOPE_MANIFEST_FILES、reasonCode=UNCLASSIFIED_SYSTEM_ERROR。失敗時のTask Scheduler結果は3
- 第3回実行台帳は消費済み。第3回DPAPI暗号化・復号試験はアカウント有効化前に停止
- 別途承認された最小緊急復旧で state.json は GUARD_ONLY、SHA-256 1b6d10aa5365fb9dc355a2a04ea3da0e97f07ca933fd35bd4d947b758893744c に復帰
- 最後の実機照合では対象ユーザー無効、セッションとプロファイル各0、両SYSTEM監視はReady/結果0、Heartbeat正常
- 本調査・修正ではWindows保護ファイル、permit、ユーザー、タスク、ACL、台帳を変更していない

## オフライン修正

対象は同じDraft PR #2774内の候補ソースのみ：
tools/novelight-commander/gateb-dpapi-attempt3-system-rescue-candidate.ps1

1. Get-RescueScope のパス参照を $script:State、$script:Original、$script:Manifest、$script:Marker に限定し、ハッシュ計算とJSON読込も明示的にスクリプトスコープを参照する。
2. 呼び出し元のJSONオブジェクト名 $state を $guardState、復旧スコープオブジェクト名 $manifest を $scopeManifest に変更する。
3. SYSTEM本人確認、SID固定、SHA固定、期限、使用済みマーカー保持、原子的復旧およびfail closed条件は変更しない。

回帰テスト tests/nlo-ai-020705-gateb-attempt3-rescue-scope-shadow-offline.test.mjs では、実際の Get-RescueScope を隔離TEMPで動かし、呼び出し元に $state と $manifest がある場合に4つの正規パスを読めることを確認。ガードファイルのSHA改変時は UNKNOWN_STATE_NO_OVERWRITE となり、使用済みマーカーを触らない。

このテストではSYSTEM本人確認のみTEMP限定ゲートに差し替えている。SYSTEM実権限・保護済みACL・実機復旧の成功証明にはならない。

## 次の判断と禁止事項

- 第3回実機台帳と緊急復旧台帳は両方消費済み。再実行、削除、使い回しは禁止。
- 既存保護領域の第3回Rescue実行ファイルは修正前のまま。候補コードをpushしても実機には自動反映されない。
- 将来の実機検証には新しい試験・更新専用台帳、保護コードSHA、期限付きpermitを新規に用意し、別途明示承認が必要。
- 今回は新たな試験、Windows設定変更、main統合、Staging/Production更新を行わない。
- Gate A〜Eの正式判定は 0/5 NO-GO のまま。
