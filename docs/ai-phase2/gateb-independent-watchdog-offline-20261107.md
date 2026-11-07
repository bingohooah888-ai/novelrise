# Gate B 専用Windowsユーザー独立復旧Watchdog（OFFLINE、2026-11-07）

**対象：DESKTOP-8Q4GFC8 / NOVELIGHT-GateB / 一時認証復旧。Gate A-E：0/5 NO-GO。**

## 現在の確実な実機証拠

- NOVELIGHT-GateBは現在も無効。パスワード再設定・有効化・合成DPAPI実行は未実施。ユーザープロファイルは未作成。
- 既存のWindows隔離環境は一回限りの前回承認で作成済み。ユーザー・親子フォルダ・ACLは再作成禁止。
- Remote Desktop Commanderからタスク NOVELIGHT-GateB-Independent-Recovery が存在しないことと、専用ディレクトリ C:\ProgramData\NOVELIGHT\GateB-Watchdog が存在しないことを確認。
- 本件はGate BのローカルOS専用Watchdog。Gate AのCloudflare/実Runner停止・revoke・cleanup・zero census監視とは別物。Gate A合格を主張しない。
- 正式継続ボードはlatest mainとの照合対象。PR #2774、#2782、#2784は合成または事前検査用で未統合。実PAT・Staging・Production・Secretsとは未接続。

## ファイルと動作契約

| ファイル                                                         | 用途                                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| tools/novelight-commander/gateb-recovery-watchdog-worker.ps1     | SYSTEM専用の復旧エンジン。標準Inspectは非稼働。将来固定タスクがRecoverとして起動                                 |
| tools/novelight-commander/gateb-independent-watchdog-manager.ps1 | Plan（既定/無変更）、Preflight（管理者読取）、Arm（将来の別承認）、Verify（管理者読取）、Cleanup（将来の別承認） |
| scripts/nlo-ai-020705-gateb-independent-watchdog-contract.mjs    | scope固定・再無効化判断・障害注入・後片付けの純粋なオフラインモデル                                              |
| tests/nlo-ai-020705-gateb-independent-watchdog-contract.test.mjs | 実変更なしのWindows構文、拒否条件、親死亡/期限切れ/再起動契約/片付けモデル                                       |

## 設計済みの独立監視

1. Windows Task Schedulerの1件のみ：名前 NOVELIGHT-GateB-Independent-Recovery、固定SYSTEM ServiceAccount、Onceの1分間隔/7日間繰返し、およびAtStartup。既存NLOタスクは変更しない。
2. 一般ユーザー書換え可能なGitチェックアウトをSYSTEMで直接実行しない。WorkerのSHA-256を固定したうえで、保護された C:\ProgramData\NOVELIGHT\GateB-Watchdog\watchdog.ps1 へコピーして起動。
3. WatchdogディレクトリはAdministrators/SYSTEM FullControlとNOVELIGHT-GateB ReadAndExecuteだけ。ACL継承OFF、Administrators所有。対象SID、非秘密状態、Heartbeatを同ディレクトリで管理。パスワード、PAT、JWTは保存しない。
4. 初回GUARD_ONLYではユーザーを無効に保ち、固定SYSTEMタスクの時刻付きHeartbeatを観測する。さらに別時刻の2回目以降のHeartbeat（単調増加カウンター）と無効状態を管理者から読み取り専用でVerifyする。
5. 将来のGUARDED_TEST状態では親PowerShellのPIDと実起動時刻/UTC期限（上限20分）を毎回検査。親死亡・時刻差・期限超過・状態破損では対象アカウントの固定SIDだけをDisable-LocalUserで再無効化し、再読取で確認する。SID不一致なら他人のアカウントは変更せず安全停止する。
6. Cleanupはユーザー無効、GUARD_ONLY、Task Principal/Action/トリガー数とWorkerハッシュ一致、ファイル所有範囲限定の場合だけ。対象タスクを停止して停止確認後に1件解除し、列挙した4ファイルだけ削除して空フォルダを削除。他NLOユーザー・タスク・Secretには触れない。
7. Armの失敗時は自動再試行や曖昧なロールバックを行わず、どの段階で停止したかだけ出力する。部分作成なら手動で対象特定し、別承認で整理する。

## 実証前の強制停止条件

- 今回のコード・オフラインテストはタスクを実機登録していない。独立起動/権限/再無効化/後片付けの実機成功を保証しない。
- 1分間隔のスケジュールは即時リアルタイム停止ではない。電源断、Task Scheduler停止、再起動時タスク遅延、時刻異常などで再無効化に遅れが生じ得る。保護できない状況ではアカウントを有効化しない。
- GUARD_ONLYのHeartbeatはSYSTEM実行の証拠だが、有効アカウントを実際に無効化できる証拠ではない。実認証試験の前に異常系を独立実証する必要がある。
- 新しく生成されるWindowsユーザープロファイル/DPAPI素材の片付け、別OSユーザーからの復号拒否、実PAT、Staging許可/Production拒否は未実証。
- 対象のGit HEAD・Worker/Manager SHA-256を固定する前に実機コマンドを提示しない。古い承認を別SHAへ転用しない。

## 後続の個別承認

- 第1段階：GUARD_ONLYの専用1タスク＋保護1フォルダの登録、SYSTEM Heartbeat観測のみ。対象PC、タスク名、固定HEAD/両SHA-256、範囲・失敗時停止・残留を明示した新しい一回限り承認が必要。ユーザーは無効維持。
- 第2段階：別プロセスの実停止能力と2回以上のHeartbeat/再起動・異常終了評価を完了してから、合成DPAPI専用ユーザーのパスワード再設定・一時有効化・再無効化・新規プロファイル片付けを、別の固定SHA/一回限り承認で行う。
- 第3段階：無効状態の独立確認後、Watchdog自体のタスク解除と保護フォルダ削除を別の対象限定承認で実施し、残留ゼロ・他NLO不変を確認する。

## 2026-11-07 GUARD_ONLY登録後の障害と修正候補

- OWNERの一回限り承認による実機 `Arm` は**登録まで実施済み**。`GATEB_WATCHDOG_FAILURE_STAGE=VERIFY_INDEPENDENT_SYSTEM_HEARTBEAT`、タスク終了コード3、Heartbeat未生成。旧承認は消費済みであり**Arm再実行禁止**。
- OWNER管理者PowerShellの読み取り専用診断でタスク登録・SYSTEM指定、保護ACL/所有者、SID・GUARD_ONLY状態、旧Workerハッシュ一致を確認。ユーザーは引き続き無効。
- **根本原因：Windows PowerShellの変数は大文字・小文字を区別しない**。旧Worker冒頭の `$Account = 'NOVELIGHT-GateB'` が `$account = $null` により破壊され、`Get-LocalUser -Name $Account` がnullを受け取って$trusted確定前に失敗することを非破壊メモリ内再現で確認。
- 新Workerはアカウント名の定数を `$TargetAccountName` に改名し、Get-LocalUser参照3箇所を修正。manager内のWorker SHAピンも変更する。**installed workerは旧ハッシュのまま**であり、ローカルGit修正はOS側のタスク・ファイルに自動反映されない。
- 復旧は**新たな対象限定OWNER承認でのみ**、既存タスク1件の一時停止・旧Workerハッシュの照合・保護ディレクトリ内の原子的差替え・タスク再開・Heartbeat検証を実施できる。未承認でのファイル更新、タスク再起動、無効ユーザーの有効化は禁止。
- この原因修正でSYSTEM実機Heartbeatの成功を保証しない。二度の独立Heartbeatとユーザー無効状態を別途観測するまでNO-GO。

**追加クラウド費用0円。** Cloudflare、Supabase、Vercel、Staging/Production、実資格、有料AIは今回禁止。Draft PRはmainへ統合しない。
参考：Microsoft Learn / ScheduledTasks / New-ScheduledTaskTrigger（Once RepetitionInterval、AtStartup）。
