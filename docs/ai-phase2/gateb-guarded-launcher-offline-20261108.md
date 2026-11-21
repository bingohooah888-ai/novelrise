# NOVELIGHT AI② Gate B — Guarded DPAPI Launcher/Recovery OFFLINE候補（2026-11-08）

**実機アカウント、認証、DPAPI、SYSTEMタスク、保護フォルダ、Vercel、Supabase、Staging、Productionは一切変更しない。Gate A～E 0/5・NO-GO。**

## 既存資産

- Draft PR #2774：合成DPAPI SelfTestとCurrentUser異SID proof候補を変更せず再利用。
- Draft PR #2782：専用Windowsユーザー、保護VaultとRunnerの境界（default deny）を再利用。
- Draft PR #2794：実機Watchdogの有効ユーザー自動無効化PASS。消費済みマーカー削除・試験再実行はしない。

## 今回の最小コード

- `tools/novelight-commander/gateb-dpapi-guarded-launcher-candidate.ps1`：対象PC/対象ユーザー/既存SYSTEM WatchdogのACL・コードハッシュ・定期期限・Heartbeat・GUARD_ONLY・残留を読み取り検査する。将来の信頼済みPSCREDENTIALを使う専用SIDプロセス起動関数を実装したが、**Apply入口は固定で拒否（exit 4）**。
- `tools/novelight-commander/gateb-dpapi-guarded-restore-candidate.ps1`：SID・元stateと試験stateのSHA-256・親PID/起動時刻・期限を照合したうえで原子的にGUARD_ONLYへ復旧する関数候補。**Restore入口は固定で拒否（exit 4）**、実機復旧は未実行。
- `scripts/nlo-ai-020705-gateb-guarded-launcher-offline.mjs`：一回限りの台帳消費、原子的ガード切替、独立Heartbeat、専用SIDプロセス二回、合成DPAPI、異SID拒否、アカウント無効、残留ゼロ、GUARD_ONLY復帰の19ステップを**純粋なオフラインモデル**で順序検証する。
- `tests/nlo-ai-020705-gateb-guarded-launcher-offline.test.mjs`：失敗注入、停止・期限切れ、セッション残留、SID違い、異SID DPAPI復号成功をNO-GOにする専用テスト。古い合格済み合成DPAPI/Watchdog試験は繰り返さない。

## 実機で使える状態にするまでの必須条件

1. 対象 `DESKTOP-8Q4GFC8` / `NOVELIGHT-GateB`、最新HEADと各SHA-256、既存SYSTEM Watchdogの7日間定期期限、GUARD_ONLY、Fresh heartbeat、対象SIDとACLの読み取り検証。
2. **実ログオン資格が不明**。パスワードをリセットせずに専用SIDのユーザープロファイルを実ロードできる信頼済み認証経路は未実証。S4Uの無資格ログオンではCurrentUser DPAPIの信頼できる鍵アクセスを前提にできない。ユーザー操作の最小化を優先するが、認証方法は別承認と実機検証を要する。
3. 一回限りのOWNER承認を最新HEAD・SHA、時限5分以下、許容アカウント有効240秒以下、実行最大1回、対象プロセス/ログオンセッション、停止/復旧に束縛する。実機台帳はCreateNewで消費し削除・再利用しない。
4. **原子的なGUARDED_TESTへの切替とSYSTEM Watchdogの独立Heartbeat確認を済ませるまで、アカウント有効化・専用SID起動を禁止**。ガード状態への切替は既存コードから未接続。
5. CurrentUser DPAPI合成乱数を専用SIDで暗号化→同じSIDの**別プロセス**で復号→アカウント無効化→異SIDの管理者で暗号学的失敗を確認。実トークン/PAT/ネットワーク/実AIは使用しない。
6. 子プロセスはPIDと開始時刻＋対象SIDで検証。アカウント無効化は既存トークン、子プロセス、セッションを自動終了しない。照会不能はゼロと推定せずNO-GO。
7. 強制終了時のSYSTEM Watchdogは対象アカウントの無効化を試みるだけで、GUARD_ONLYへの原子的自動復帰や子プロセス停止は保証しない。既存#2794の成功を本シナリオへ拡大解釈しない。ガード復元関数は**コード候補であり自律復旧ではない**。
8. 実DPAPI試験で作成される暗号文・SHA、プロファイル、DPAPIマスターキー、監査台帳は残留し得る。事前に対象と停止基準を固定し、必要な削除はさらに別承認。秘密・平文・SID・認証値はログやチャットへ送らない。

## 現在の判定

LOCAL OFFLINEコード実装と静的/故障注入テストのみ。起動、認証、GUARDED_TEST実機武装、DPAPI実機、独立自律復旧、実ログオンセッション残留確認は **NOT RUN / NO-GO**。
次の段階で、既存の保護Run/credential経路を使えるか読み取りで確定してから、対象PCと最新HEAD/SHA固定の**新しいワンタップ承認**を要求する。承認前にWindowsの変更は禁止。
