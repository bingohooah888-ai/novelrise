# Gate B 異常終了・復旧・合成DPAPI：実機試験準備（2026-11-07）

**OFFLINE ONLY / 実機の変更なし / Gate A～E：0/5 NO-GO**

## 1. 実証済みの事実

- 対象PCは DESKTOP-8Q4GFC8。専用ローカルユーザー NOVELIGHT-GateB は無効・非管理者。
- 既存SYSTEMタスク NOVELIGHT-GateB-Independent-Recovery は稼働し、OWNER管理者PowerShellで GATEB_WATCHDOG_REPEAT_HEARTBEAT_VERIFIED を確認済み。Heartbeat sequence=5、fresh、Task LastTaskResult=0、GUARD_ONLY、Workerハッシュ一致、修復一時ファイル無し。これは「無効ユーザーの継続確認」の証拠であり、有効ユーザーを再無効化した証拠ではない。
- Draft PR #2787修正HEAD 2847487ea1e26aa14dab88976b69055f8da00189 のWorker SHA-256は dd418a7a50854c54a182fd3042b8dfadd5b8da77f9c99d106aab4bd706c3e66f。
- 関連PR #2774（合成DPAPI）、#2782（接続境界）、#2784（認証事前検証）、#2787（独立Watchdog）は未統合。実資格、Staging、Production、Runner稼働は未承認。
- NLOとRemote Desktop Commanderは別物。非管理者Commanderからタスク詳細と保護フォルダは読み取れない。現在のHeartbeat回数はOWNERの管理者スクリーンショットの時点の実証値で、今も5回とは断定しない。
- 継続ボードのsource_mainは旧監査時点の記録で、最新mainとは差がある。MASTER blobは以前の完全読了証拠と一致。過去承認の復活は認めない。

## 2. 今回の安全な実装範囲

- tools/novelight-commander/gateb-crash-recovery-readonly-preflight.ps1：管理者の読み取り専用でホスト/SID、無効ユーザー、固定SYSTEMタスクとACL、GUARD_ONLY、空vault、プロフィール未作成、Heartbeatと7日定期Triggerの残存期間を検証。Applyは常に終了コード4で拒否。
- scripts/nlo-ai-020705-gateb-crash-recovery-contract.mjs：OSやDPAPI呼出しを持たない純粋なモデル。15段階の状態遷移、親プロセス強制終了、別SYSTEM監視、子プロセス残留、DPAPI異ユーザー拒否、プロフィール残留、監視復帰、残留ゼロを判定。
- tests/nlo-ai-020705-gateb-crash-recovery-contract.test.mjs：資格値混入や実行要求を拒否し、15段階の故障注入、スケジュール期限、子プロセスとプロフィール残留、クロスユーザーDPAPI未証明をすべてNO-GOにする回帰テスト。
- この文書：リスク、将来の実機手順、失敗・後片付け契約、個別承認を整理。

**未実装・実行禁止**：有効化、パスワード再設定、親PIDの実kill、タスク/保護状態ファイル変更、実DPAPI、プロフィール削除、NLO変更、クラウド/Secrets/有料AI。今回のコードに本番実行機能はない。

## 3. 実機テストの推奨順（次の各承認が必要）

### Phase 0：管理者のREAD ONLYプレフライト

1. 固定ホスト、HEAD・各SHA、既存NLOタスク不変、対象アカウントの無効・非管理者・プロファイル未作成、空の既存vaultを照合する。
2. 独立SYSTEMタスクのAction/Principal、保護ACL、Worker SHA、対象SID、GUARD_ONLY、LastTaskResult=0、sequence 2以上・新鮮なHeartbeatを確認する。
3. 7日間のOnce反復Triggerの残時間を計算する。残り30分未満や時計不整合ではNO-GO。AtStartupがあるだけでは反復期限切れを補えない。
4. 子プロセスID、親プロセスIDと各作成日時、固定SID、監視期限の非秘密な証拠形式を決める。いずれか照合できなければ有効化はしない。

### Phase 1：アカウント無効のまま「親死亡検出」経路を合成検証

1. これが最も低リスクな次の候補。専用ユーザーは無効のまま、保護stateを期限付きのGUARDED_TEST・存在しない親PIDに原子的に一度だけ切り替え、独立SYSTEMタスクの次のHeartbeatを読む。これは別のスコープ/HEAD/SHA固定OWNER承認が必要。
2. **現行Workerは死亡・期限切れの原因コードを、アカウントが無効な時に WATCHDOG_DISABLED_CONFIRMED で上書きする。** よって現状のHeartbeatだけでは「親死亡を検出した」ことを証明できない。Phase 1へ進む前に、秘密やPIDを露出しない固定の理由コード（例：WATCHDOG_PARENT_GONE）を別Worker候補へ追加し、変更SHAを固定して別承認下で安全に再配置する必要がある。単なるsequence増加やタスク成功だけではPhase 1をPASSにしない。
3. 終了時はGUARD_ONLYに原子的に復帰し、再び独立Heartbeat 2回以上を確認する。親停止ロジックの模擬検証にはなるが、「有効ユーザーを再無効化した」とは扱わない。
4. stateの部分書込み/監視未起動/期限切れならユーザーは無効のまま停止。繰り返しや既存NLOタスク操作は禁止。

### Phase 2：実ユーザーを短時間だけ有効化して強制終了する実試験

1. Phase 1の証拠に加え、子プロセス/既存ログオントークンの片付け経路を実装し、別承認。ユーザーに実行スクリプトの固定Git HEADとSHA、対象/回数/停止条件を提示する。
2. 前提の未作成プロフィール/空vault/無効SIDを再検証。新パスワードはCSPRNGのSecureStringでメモリ内生成し、ログ/文字列引数/環境変数/チャット/ファイル/GitHubに露出させない。元のパスワードは復元不能。
3. GUARD_ONLYのWatchdogが稼働していることを確認した後、親の固定PID＋開始UTC時刻、期限を保護stateへ原子的に記録する。独立Heartbeatで監視が武装したと検証できない限り、アカウントを有効化しない。
4. NOVELIGHT-GateBだけ一時有効化し、SHA固定のネットワーク無し合成子プロセスを専用SIDで作成。PIDと開始日時の両方を保護領域に記録する。未承認のRunner、PAT、DBへの接続は禁止。
5. 親だけをPID＋作成日時一致で特定して強制終了する。プロセス名一括killや既存NLOプロセスkillは禁止。親のfinallyには一切依存しない。
6. SYSTEM監視が親死亡/期限を認識して固定SIDをDisable-LocalUserで無効化したことを別の管理者PowerShellで独立に照合する。Heartbeat 1回ではなく、復旧後のsequence、時刻、アカウント無効状態を照合する。
7. **アカウントの無効化は既存の子プロセスやログオントークンを終了した証明ではない。** 子PIDと開始時刻、同SIDの残存プロセスを確認。残る場合は、別途承認したその子だけの停止と残留ゼロ確認が必要。広いOSプロセスkillは禁止。
8. GUARD_ONLYへ復帰し、独立Heartbeatを検証してから、プロフィールとvaultに何が残ったかを読み取る。曖昧ならNO-GOで停止し、無承認削除しない。

### Phase 3：専用SIDでの合成DPAPIユーザー境界テスト

1. **現在は準備設計のみ**。専用アカウント下のプロセスで合成乱数をCurrentUser DPAPIで暗号化/復号し、さらに異なるWindows SIDでの復号拒否を証明する。DPAPI LocalMachineスコープは禁止（同一マシンの別ユーザーが復号できるため）。
2. 生の合成乱数、復号結果、資格・トークンを標準出力、コマンドライン、環境変数、ログ、GitHub、チャットへ書かない。保護ACLに限定した暗号文だけを別プロセスへ受け渡す。OWNERの明示した別承認が必要。
3. 合成DPAPIが成功しても実PATやProtected Runnerへの資格入力は許可されない。専用ユーザープロファイルとDPAPIマスターキー等の新規作成を残留確認する。

## 4. 安全停止と後片付け

| 故障点                                | 停止・調査方針                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Heartbeat途絶／7日トリガー期限切れ    | 有効化を禁じる。別承認で監視の修復/延長を検討する                                                               |
| GUARD_ONLY→GUARDED_TEST移行失敗       | 有効化せず停止。保護stateの現状を読み取り専用で監査                                                             |
| CSPRNGパスワードリセット失敗          | 承認消費、再試行禁止、ユーザー無効を確認                                                                        |
| 親/子PID再利用・開始日時不一致        | 他プロセスをkillしない。NO-GO                                                                                   |
| 親強制終了・finally未実行             | SYSTEM監視経由で無効化を確認。曖昧なら手動隔離を優先                                                            |
| 既存子プロセス/ログオントークン残留   | 無効状態でもNO-GO。対象PID限定の別承認で停止・残留検証                                                          |
| 異SIDのDPAPI復号成功／未検証          | NO-GO、秘密資格の利用を停止                                                                                     |
| 新規プロフィール、vault、暗号文の残留 | 新たな対象SID限定・ファイル範囲限定の削除承認まで記録を保全                                                     |
| GUARD_ONLY復帰に失敗                  | タスクを勝手に削除しない。無効ユーザーと保護stateを調査                                                         |
| Watchdog自体のCleanup                 | ユーザー無効、子0、プロフィール残留解消、GUARD_ONLY独立Heartbeat確認後、タスク1件/保護フォルダ1件を別承認で削除 |

## 5. 証明できないこと（強制NO-GO）

- 現行SYSTEMタスクは7日反復Trigger＋AtStartupで、OS停止・Task Scheduler停止・時刻異常時の即時無効化を保証しない。
- 現行Workerは固定SIDのアカウント無効化を試みるが、既存の子プロセス停止は未実装。親死亡検出だけでZero Residueとしない。
- 既存プロファイルは検証時未作成だが、今後のログオンで新規作成し得る。PROFILE削除の安全性は証明されていない。
- Guard-only Heartbeatは活性化後の復旧実証でなく、合成モックは承認を付与しない。
- 失敗後の再実行は既存承認で行わない。課金/Cloudflare/Supabase/Vercel/Secrets/Production/Staging/NLO改変は今回禁止。Gate A～Eは0/5 NO-GO。

## 6. 次の意思決定

推奨する次工程は、まず **既存Workerが親死亡の理由コードを保持できる安全な診断仕様を実装・オフライン検証すること**。現行Workerでは親死亡をHeartbeatから判別できないため、今このままProtected Stateを更新しても実証にならない。新Workerの固定SHA・失敗時停止を確定後に別の一回限り承認を得て実機へ再配置し、次に**ユーザー無効のまま親死亡を模擬するProtected State更新とGUARD_ONLY復帰**を別承認で実施する。さらに実アカウント有効化/親kill/DPAPI/cleanupは分離する。各操作で固定HEAD・SHA、残留ゼロ、緊急復旧手順を要する。

**追加クラウド費用：0円。** Draft PRは未統合、Productionへ未反映。

参考：Microsoft Learn New-ScheduledTaskTrigger、CryptProtectData、Start-Process -Credential/-LoadUserProfile。Microsoftの一般仕様は実機での成功を証明しない。
