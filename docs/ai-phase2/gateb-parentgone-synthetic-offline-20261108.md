# NOVELIGHT AI工程② Gate B：親死亡の合成故障注入・GUARD_ONLY原子的復帰候補（2026-11-08）

**OFFLINE設計・コード・テストのみ。今回の承認はOS protected state書込み、Windowsタスク・ユーザー・プロファイル・DPAPI・NLO変更を許可しない。Gate A～E：0/5 NO-GO。**

## 1. 実証済みの既存証拠と未検証の区別

- 対象：DESKTOP-8Q4GFC8。専用ユーザー NOVELIGHT-GateB（無効、非管理者）。既存SYSTEMタスク NOVELIGHT-GateB-Independent-Recovery。
- 新Worker SHA-256 78242cd888dcb3bedb0a899daf5549e21461a1b65d6a604188acdecccf78f15c。OWNERが一回限りの管理者PowerShellで理由コードのGUARD_ONLY初回Heartbeatを確認した。Draft PR #2792のHEAD 995747d1e9b473b00f090aea339485095be73d92。
- 過去のGUARD_ONLY 5回連続Heartbeatは既存Workerで証明済み。ただし**新Workerでの継続Heartbeat（2回以上）は現在の非管理者RDCでは保護ファイルにアクセスできず未確認**。管理者READ ONLY証拠が次段階で必要。
- Draft PR #2790（HEAD 050fdffaf8e9607935d39ed0a0c68dc36046b47d）のオフライン合成DPAPI・親kill/プロセス/profile残留NO-GO契約を引き継ぐ。PR #2790/#2792とも未統合。
- 最新main ce63201d6bd0df4ce06c40b1b2d587fd0eaf7a1d、MASTER/AGENTS、進捗ボード、Phase2終了ゲートと照合。MASTER blob 91d11fa367b7de64990b13397b13d4bb6e3c0230は既読正本と一致。ボードのsource_mainは古い監査時点。過去の承認は使用済みで復活しない。

## 2. 今回の独立ブランチのファイル

| ファイル                                                          | 用途                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| tools/novelight-commander/gateb-parentgone-synthetic-one-shot.ps1 | **将来の別承認専用**。既定Preflightは管理者READ ONLY。ApplyをこのPRでは呼ばない                                  |
| scripts/nlo-ai-020705-gateb-parentgone-offline-model.mjs          | 14段階の故障注入、実行済み台帳、GUARD_ONLY復帰、残留とGate NO-GOを判定する副作用のない純粋関数                   |
| tests/nlo-ai-020705-gateb-parentgone-offline.test.mjs             | オフライン故障注入、権限/scope/監視期限、PowerShell AST、非管理者Preflight拒否を検査。ApplyやRecoverは実行しない |
| この文書                                                          | 検証・安全停止・次のOWNER承認の正確な対象                                                                        |

今回の実機SYSTEMタスク、protected state.json、installed watchdog.ps1、heartbeat.json、NOVELIGHT-GateBユーザー、NLOタスクを変更しない。

## 3. 将来の一回限りのsynthetic親死亡試験（実機実行は未承認）

1. 管理者Preflightで対象PC、管理者、固定SID、非管理者かつ無効ユーザー、ユーザープロファイル未作成、空vault、専用ユーザーSID所有プロセスの残留0を照合する。WindowsがプロセスのOwnerSidを読めなければ残留0を推定せずNO-GO。
2. protected directoryの所有者Administrators、Administrators/SYSTEM FullControl、GateB SID ReadAndExecute、ACL継承OFF、既知ファイル4件、固定Worker SHAを照合する。実行済み一回限りマーカーや不明ファイルがある場合はNO-GO。
3. 既存SYSTEMタスク1件のPrincipal/Action/TimeTrigger毎分7日+起動Trigger、期限残30分超、LastTaskResult=0、既存NLO3タスクXML定義を管理者READ ONLYで照合する。
4. protected state.jsonが8フィールドのGUARD_ONLYで、親PID 0、開始時刻空、固定SID一致。最新Heartbeatがversion1、status WATCHDOG_DISABLED_CONFIRMED、reasonCode GUARD_ONLY、disableOutcome ALREADY_DISABLED、sequence2以上、新鮮なUTC時刻であることを確認。
5. 別の正確な一回限り承認を受けた時だけ、protected directoryにCreateNewで実行済みマーカー1件を作成し、その承認を消費する。再実行してもマーカーの存在で事前拒否。**マーカーは非秘密の監査証跡であり、成功後も意図的に残る**。削除は将来の別承認。
6. [int]: :MaxValueという存在しない親PIDを固定し占有確認（**プロセスのkillは一切なし**）。期限はUTC+5分、GUARDED_TEST。新stateを同ディレクトリにstageし、File.Replaceで現在のstateを原子的に置換、元ファイルを保護バックアップ。
7. SYSTEM Watchdogの**通常1分周期**で新しいHeartbeatを観測し、reasonCode PARENT_GONE、disableOutcome ALREADY_DISABLED、accountWasEnabledBefore false、disableAttempted false、observedDisabled true、既存statusの互換性を検証。ユーザーは最初から無効なので**実際の再無効化能力は証明しない**。
8. 成功/例外を問わず、一度だけ元のGUARD_ONLY stateへ原子的に復帰を試みる。元バックアップ/現在stateのSHA照合を必須とし、第三者が変えた不明stateは上書き禁止。復帰後のstate SHAは試験前と完全一致。
9. 独立した**さらに新しいGUARD_ONLY Heartbeat**を確認。対象ユーザー無効・プロファイルなし・SID所有プロセス0・空vault・NLO定義不変を検証。自分が作ったバックアップだけをSHA照合後削除し一時ファイル0。消費済み監査マーカーは保持。
10. 全条件を満たしてもGate BはNO-GO。成功とは「synthetic親PID不在の判定＋GUARD_ONLY復帰」を意味し、実親kill/DPAPI/有効ユーザー再無効化には使えない。

## 4. 失敗条件とリスク

- ユーザーが有効、別プロセス/プロファイル残留、Heartbeat不鮮明、監視間隔・7日期限切れ、ACL/SID/Worker/task/NLO差異 → Apply前に停止。
- 親死亡を識別しない、結果がALREADY_DISABLEDでない、sequenceが増えない → 目的未実証・NO-GO。元stateへの原子的復帰を一度だけ試みる。未知のstateを無断上書きしない。
- **PowerShell/PC強制終了・停電ではfinallyの復帰保証がない。** 現Workerはユーザーの無効化を試行するが、stateを自律的にGUARD_ONLYへ戻す機能はない。この残留リスクが受容できなければ実機試験前に独立復帰経路を設計・検証する必要がある。
- SID所有プロセスのOwnerSid照合はWindowsの保護プロセスなどで不可となる可能性がある。確認不能は成功でなくNO-GO。広いプロセスkillやOSのACL変更はしない。
- 一回限りマーカー作成後の失敗・中断でも承認は消費済み。修復や後片付けは新しい承認とread-only残留確認が必要。マーカーは計画的監査残留なので**完全ファイル0件とは報告しない**。
- 監視タスクの7日間Once反復は本試験で延長しない。Staging/Production/Cloudflare/Supabase/Vercel/Secrets/有料AI/実PATは一切接続しない。

## 5. 最小の緊急復旧手段（本PR #2794内で追加）

将来のsynthetic試験がPowerShellの強制終了・端末停止などで中断された場合、既存SYSTEM Watchdogはユーザーの無効状態を保つが、保護`state.json`を自律復帰しない。

- `tools/novelight-commander/gateb-parentgone-interrupted-guard-restore.ps1` を**同じPR内**に追加。既定`Inspect`は管理者の読み取り専用。実際の`Restore`は**新しい対象限定の一回限り承認が必要**。
- 現行Worker固定SHA、保護ACL・固定SID、無効/非管理者ユーザー、残留プロフィールなし、一回限りの消費マーカー、synthetic親PID（`[int]::MaxValue`）、旧`GUARD_ONLY`バックアップの内容を検証する。
- 既に元のGUARD_ONLYなら変更せず終了。それ以外は、保護バックアップとsynthetic stateを照合し、専用`state.json`一件だけを`[IO.File]::Replace`で原子的に戻す。元stateのSHA不一致・未知の途中状態なら止める。
- 緊急復旧の成功後も、台帳・バックアップ・一時ファイルは**勝手に削除しない**。管理者の残留確認・別承認のCleanupが必要。
- **これは自律復旧ではない**。PC停止中/管理者不在の復帰保証はまだなく、合成試験の残留リスクを減らすための限定的な緊急対処手段である。実アカウント有効化・パスワード変更・実親プロセスkill・DPAPI試験は全く認めない。

## 6. 別承認の入口

本PRはoffline実装・CI・CodeQL・Draft PRまでが承認範囲。管理者READ ONLYで**現在の理由コード付きHeartbeat継続、タスク期限、SIDプロセスcensus**を確認できない限り、実機Applyの承認を求めない。将来必要なら固定HEAD・試験スクリプトSHA-256、PC、改変state1ファイル、監査マーカー1件、許可する一時バックアップ、最大実行1回、原子的復帰の限界、費用0円を明記した**新しいワンタップ承認**を要する。既存NLO、クラウド、Secrets、Production、アカウント有効化、パスワード再設定、親kill、DPAPIは引き続き別の承認が必要。

**本PRはDraft・未統合。追加クラウド/有料AI費用0円。Gate A～Eは0/5 NO-GOを維持。**
