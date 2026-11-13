# Gate B 第3回 — 専用台帳・permit・独立SYSTEM復旧候補（オフライン）

状態：**SOURCE ONLY / NO-GO / 実機更新未承認**。既存Draft PR #2774。第1回・第2回Windows Applyは消費済みで再実行禁止。

## 新規スコープ

- Coordinator: gateb-dpapi-attempt3-one-shot-coordinator-candidate.ps1
- SYSTEM Rescue: gateb-dpapi-attempt3-system-rescue-candidate.ps1
- Owner Permit Contract: gateb-dpapi-attempt3-approval-contract-candidate.ps1
- 保護コード更新候補: gateb-dpapi-attempt3-protected-upgrade-candidate.ps1（Planは無変更）
- 一回限りの新実行台帳: gateb-dpapi-attempt3-once-consumed.marker（CreateNew）
- 新保護更新台帳: gateb-dpapi-attempt3-protected-upgrade-once-consumed.marker（CreateNew）
- 新原本: state.json.dpapi-attempt3-original / 新マニフェスト: gateb-dpapi-attempt3-arm-manifest.json
- 新復旧バックアップ: state.json.dpapi-attempt3-rescue-backup（復旧stageもattempt3）
- 初回失敗証拠: gateb-dpapi-attempt3-system-rescue-first-failure.json（CreateNew）
- Owner Permit: version=3 / approvalId=GATEB_DPAPI_ATTEMPT3_OWNER_APPROVED / attemptId=GATEB_DPAPI_ATTEMPT3_20261108。旧version 1/2は拒否。

## 再利用と保護

第1回・第2回の消費済みマーカー・元state・第2回マニフェストを読み取り専用で検証し、削除・書換え・再利用しない。既存SID proof、既存Windows Watchdog、独立SYSTEMタスク、Heartbeatと原子的置換ロジックを再利用する。新規タスク登録・クラウド変更はしない。

Coordinatorは対象SID無効・非管理者、プロセス/セッション/プロファイル残留0、Vault空、両SYSTEM Heartbeat確認後のみ一回の実機Apply。GUARDED_TESTは300秒以内、アカウント有効は240秒以内。独立復旧役は期限切れ・親消失時に元状態SHA、マニフェスト、SID、残留を照合して原子的GUARD_ONLY復旧。未知の状態はNO-GO、既存安全条件は緩めない。

## 実機変更前の依存順序（現在は全操作未承認）

1. 新規Owner明示承認で固定HEAD・更新器と4実行ファイルSHA-256・現保護ファイルの旧SHA・ホストとSID・最大回数・期限・復旧方法を明記。ワンタップボタンは承認メッセージのみ送信する。
2. Read-only Preflightで第1回・第2回証拠、GUARD_ONLY、対象無効/残留0、2 SYSTEM監視、旧SHAを照合。
3. 明示承認後のみ1回の保護コード更新。旧版バックアップを残し3実行コード・Owner/proof permitを置換、新v3 permitとSHA、独立SYSTEM Heartbeatを受動確認。失敗したUpgradeは再実行禁止。
4. 別途明示承認後のみ一度の第3回Coordinator Apply。専用SID CurrentUser DPAPI暗号化・同SID復号・異SID拒否、無効化、残留ゼロ、GUARD_ONLY、両SYSTEM監視を確認する。
5. 証拠が揃うまでNO-GO。自動復旧失敗時は新しい固定対象と別承認で最小緊急復旧。旧ファイル・マーカーは保持。

実機USER/TASK/ACL/permit/guardに影響する操作は現時点では禁止。main統合・Staging/Production変更・NLO変更もしない。

## 局所検証と限界

Windows隔離TEMP上で実際の第3回SYSTEM Rescue関数を使い、期限切れ、親消失、親生存、SHA不一致、原子的復元、バックアップ、Heartbeat、使用済みマーカー非改変を確認する。**このテストはSYSTEM権限・保護ACL・実機DPAPI証明ではない。** Gate BのPASSに使わない。

**正式 Gate A–E：0/5 NO-GO。第3回実機試験未承認。**
