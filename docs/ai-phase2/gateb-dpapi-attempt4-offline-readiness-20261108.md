# NOVELIGHT Gate B 第4回：専用台帳・permit・Rescue・緊急復旧計画（オフライン）

## 変更範囲・状態

既存Draft PR #2774内の候補コードのみ。**実機変更なし / source-only / Gate A–E 0/5 NO-GO**。
開始時HEAD：53b03d5e15cbbf08a897e5b30d7005031c5bcdb0。
対象Windowsホスト：DESKTOP-8Q4GFC8。対象専用アカウント：NOVELIGHT-GateB。
今後の実機試験やWindows保護ファイル更新は本書で承認しない。

## 第4回の新規名前空間

| 役割 | 新規対象 |
|---|---|
| Coordinator候補 | tools/novelight-commander/gateb-dpapi-attempt4-one-shot-coordinator-candidate.ps1 |
| 独立SYSTEM Rescue候補 | tools/novelight-commander/gateb-dpapi-attempt4-system-rescue-candidate.ps1 |
| permit契約候補 | tools/novelight-commander/gateb-dpapi-attempt4-approval-contract-candidate.ps1 |
| 保護コード更新器候補 | tools/novelight-commander/gateb-dpapi-attempt4-protected-upgrade-candidate.ps1 |
| Apply消費台帳 | gateb-dpapi-attempt4-once-consumed.marker |
| 保護更新消費台帳 | gateb-dpapi-attempt4-protected-upgrade-once-consumed.marker |
| 原本とマニフェスト | state.json.dpapi-attempt4-original / gateb-dpapi-attempt4-arm-manifest.json |
| ARM stage/backup | state.json.dpapi-attempt4-arm-stage / state.json.dpapi-attempt4-arm-backup |
| Rescue stage/backup | state.json.dpapi-attempt4-rescue-stage / state.json.dpapi-attempt4-rescue-backup |
| Coordinator restore stage/backup | state.json.dpapi-attempt4-restore-stage / state.json.dpapi-attempt4-restore-backup |
| 初回失敗の保護証拠 | gateb-dpapi-attempt4-system-rescue-first-failure.json（CreateNew） |
| 別承認でのみ用いる最小緊急復旧台帳 | gateb-dpapi-attempt4-emergency-restore-once-consumed.marker（CreateNew） |
| 緊急復旧stage/backup | state.json.dpapi-attempt4-emergency-restore-stage / state.json.dpapi-attempt4-emergency-restore-backup |
| Owner permit | version=4、approvalId=GATEB_DPAPI_ATTEMPT4_OWNER_APPROVED、attemptId=GATEB_DPAPI_ATTEMPT4_20261108 |

Owner permitは既存保護root内の gateb-dpapi-owner-permit.json を別承認された更新器が作成する。prove permit gateb-dpapi-sid-proof-arm.json は既存の同SID契約から期限だけ同期する。いずれも**今は作成・変更しない**。

## 第1〜3回の不可逆な履歴

以前のApplyおよび緊急復旧の消費済みマーカーを削除・リセット・転用しない。
第1回・第2回証拠の検査は既存コードから継承する。
第3回については以下をSHA固定して読み取り専用で確認する。

| 過去の証拠 | 期待SHA-256 |
|---|---|
| Attempt3 Apply marker | 70056cc9690d12bbf87dbab363d3a1865ba89d444eaaf1d675c3fcd98c7c229e |
| Attempt3 Upgrade marker | c466f9eb87c95172c5e4ebce836356107d456aba7883e9d62bb4f971dbd38488 |
| Attempt3 Emergency restore marker | 102a9ce35fd30dcd615647cad10909922e9afed8b89c022361098182aba8738a |
| Attempt3 manifest | 3b2133232d04b238cffea4cc7ddd34939e66db09748279ac000d1bc4fe03060c |
| Attempt3 original | 1b6d10aa5365fb9dc355a2a04ea3da0e97f07ca933fd35bd4d947b758893744c |
| Attempt3 guarded emergency backup | 31ac3cece05d0d7cea0f115000f54e3aa2c872a4656768a2120ea9eabda26146 |
| Attempt3 first SYSTEM failure | f919c239656a7a2d88cdb564f98604147ec4900117168424c21402c9b9a4670b |

旧保護スクリプトSHAはCoordinator 50c952505c2784e660b1e7f3b696a44d39443e18c53eb940b007be61e4ef438f、Rescue db5882ce91e9336b9ad9d4b0f92f1ca18c51c44f60be655ad4e42bb3ef713222、Contract 5c2fc69c0d2811ff6fc64aa8048c4fc8dc5be5434d45c10602f9e47e2d5e68ed。実機の最新記録との照合を更新直前にやり直す。

## Root causeの取り込みと実機に反映しない保証

第3回では独立SYSTEM Rescueの Get-RescueScope が呼び出し元のJSONオブジェクト $state を、保護パス $State と誤認する動的スコープ衝突が発生し得た。$manifest にも同じ問題があった。第4回の独立Rescueでは $script:State、$script:Original、$script:Manifest、$script:Marker を明示し、呼び出し元JSONを $guardState と $scopeManifest に分離した。

機能試験はSYSTEM権限なしの隔離TEMPに限定する。実機のSystem Rescueスクリプト、タスク、permit、ACL、ユーザー、mainには自動反映しない。

## 次回、実機更新のために必要な別承認

1. その時点のPR HEADと変更コードSHA、旧コードSHA、対象ホストとSID、保存すべき過去台帳とmanifest SHAを固定した新規Owner明示承認。
2. 読み取り専用Preflightで保護root ACL、旧SHA、全履歴、現GUARD_ONLY、アカウント無効、セッション/プロファイル/対象プロセス0、Vault空、両監視Ready/結果0/最新heartbeatを再確認。
3. PASSしたときのみAttempt4専用の保護更新台帳をCreateNewで消費し、3スクリプト、Owner/proof permitを原子的に置換。旧ファイルはattempt4-previous名で別個保存し、置換後SHAを再照合。
4. 既存SYSTEM Rescueが新コードでIDLE_DISABLEDの新しいheartbeatを発行するまで**受動監視**。監視NG・期限切れならNO-GO。失敗したUpgradeの同台帳での再実行禁止。
5. その後、別のApply承認が必要。期限内かつ両監視がARMした場合に限って専用ユーザーを一時有効化する。DPAPI同SID/異SID試験、無効化、残留0、GUARD_ONLYと両SYSTEM heartbeatを証拠化する。

## 万一GUARDED_TESTで止まった場合：第4回専用の最小緊急復旧計画

この計画は**実行承認ではない**。最優先は既存の二重SYSTEM監視が自律的にGUARD_ONLYへ復旧すること。監視が失敗してもApplyのやり直しやマーカー削除はしない。

- まずWindowsアカウント無効、ログオンセッション0、プロファイル未ロード、ターゲット所有プロセス0を証明する。対象SIDの確証がない場合は停止。
- 最新原本・Manifest・GUARDED_TEST状態それぞれの実測SHAを保存し、マニフェスト記載originalSha256/guardedSha256、SID、host、task、parentPid、parentStartUtc、deadlineUtcと一致するか検証する。期限切れまたは親消失が必要。未知SHAの場合は**上書きしない**。
- 通常SYSTEM Watchdog、独立SYSTEM Rescueのタスク結果、heartbeat、初回失敗証拠を読み取り専用で保存。未解決の原因や他の残留がある場合は停止。
- 新しい明示Owner承認を得て、Attempt4緊急復旧専用台帳が不存在であることを検証する。管理者がその台帳をFileMode.CreateNewで一回だけ消費し、原本をAttempt4専用stageにコピー、原子的ReplaceによりGUARDED_TEST旧stateをAttempt4専用backupに残す。
- 復元後state.json SHAがoriginalSha256に一致しGUARD_ONLY、parentPid=0、専用ユーザー無効・残留0、両SYSTEM heartbeatの新鮮な正常状態まで確認する。
- 復旧途中で失敗した場合は**同じ台帳を再利用しない**。stage/backupを黙って削除しない。必要なら新しい固定対象と別承認で最小限対応する。
- 第1〜3回のマーカー・原本・manifest・失敗証拠やAttempt4 Apply markerは削除・上書き・再利用しない。

## 判定

オフラインの隔離テスト・CI・CodeQL成功は準備の妥当性を示すだけであり、Windows SYSTEM実権限での復旧またはDPAPIの成功は証明しない。**Gate A〜Eは0/5 NO-GOを維持**する。
