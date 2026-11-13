# Gate B DPAPI CurrentUser 異SID実機検証の準備（2026-11-08）

**状態：OFFLINE候補のみ。実DPAPI操作・Windows変更・資格入力なし。Gate A〜E：0/5 NO-GO。**

## 再利用した既存資産
- PR #2774：既存の合成DPAPI SelfTest。今回は重複実行しない。
- PR #2782：Windows保護ホスト/ACLの読み取り確認とRunnerのdefault-deny接続契約。
- PR #2794：GUARD_ONLY下で一時有効化した専用Windowsユーザーを既存SYSTEM Watchdogが自動無効化した実機PASS。親死亡試験やDPAPIを証明したわけではない。

## 準備したコード
- tools/novelight-commander/gateb-dpapi-sid-proof-candidate.ps1：既定Inspectは拒否、実動作には別承認・SHA固定の保護されたインストール先・admin所有の許可ファイル・信頼できる起動経路が必須。
- TargetCreate：専用SIDのプロセスだけが32バイトの合成乱数をCurrentUser DPAPIで保護。暗号文と乱数のSHA-256だけを専用VaultにCreateNewで保存。
- TargetVerify：異なる専用SIDプロセスではなく、**同じSIDの別プロセス**で復号して合成乱数ダイジェスト一致を確認。
- AdminCrossSid：対象ユーザー再無効化後、別SIDの管理者から同じ暗号文のCurrentUser復号を試行。CryptographicExceptionだけを期待した拒否として判定。ACL読み取り失敗やファイル不在はPASSにしない。
- テストは静的・構文検証のみ。DPAPI処理は一度も呼ばない。

## 未解決の依存関係
1. 現時点でNOVELIGHT-GateBは無効・非管理者。保護Runner/Launcherも、専用ユーザーのログオン資格と起動経路も実証されていない。
2. GUARD_ONLYではWatchdogが有効化直後にユーザーを無効化する。専用SIDでDPAPI実機実行するには、独立監視と期限付きGUARDED_TESTの正しい移行・復旧が先に必要。
3. 将来の管理者調停役は、承認されたHEAD・スクリプトSHA、実行最大回数、権限、証跡順序、親・子プロセス・ログオンセッションと復旧の監査を原子的に固定する必要がある。**この調停役は今回未実装。**
4. 保護スクリプトのインストール先は C:\ProgramData\NOVELIGHT\GateB-Watchdog 、合成暗号文の保存先は C:\ProgramData\NOVELIGHT\GateB 。どちらにも今回変更なし。
5. 実際のログオン起動がパスワード変更を必要とする場合は、新しい別承認を取得する。現在はパスワード変更・秘密取得なし。

## 安全停止・残留・復旧
- DPAPI候補はWindowsアカウント、既存NLO、SYSTEM Watchdogタスク、クラウドには触れない。実資格・PAT・秘密・Production操作は禁止。
- プロファイルとDPAPIマスターキー、合成暗号文・ダイジェストは残留しうる。別承認まで削除せず、0残留を宣言しない。
- 親死亡や期限切れ時は既存SYSTEM Watchdogの無効化に依存するが、子プロセスとログオンセッション停止は別の検証が必要。
- 万一専用ユーザーが有効のままなら、管理者が対象SIDを確認して Disable-LocalUser を1回実行し、結果を再観測する。自動再試行や広範囲のプロセスkillはしない。
- PRのmain統合、実行・配置、パスワード操作、Staging、Productionは今後の別承認が必要。

## GO判定
コード/テストのOFFLINE PASSのみを記録。異SID DPAPI実機と保護Runner接続は NOT RUN / NO-GO。次は既存保護Runner資産を使った一回限りのGUARDED_TEST起動・復旧調停役を準備し、対象・HEAD・SHA-256・回数・リスクを固定した新しい承認ボタンを提示する。
