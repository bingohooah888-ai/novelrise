# NOVELIGHT AI工程② Gate B — 独立Watchdog復旧理由コード候補（オフライン専用）

**2026-11-07 / Windowsの実環境変更0回 / Gate A～E：0/5 NO-GO**

## 対象と根拠

- 端末：DESKTOP-8Q4GFC8、専用アカウント：NOVELIGHT-GateB（無効・非管理者）、既存固定SYSTEMタスク：NOVELIGHT-GateB-Independent-Recovery。
- 現在の実機WorkerはDraft PR #2787の修正版（SHA-256：dd418a7a50854c54a182fd3042b8dfadd5b8da77f9c99d106aab4bd706c3e66f）。管理者PowerShellによるGUARD_ONLY Heartbeat sequence=5/Task LastTaskResult=0の証拠あり。ただし、これは有効ユーザーを再無効化した証拠ではない。
- Draft PR #2790（HEAD 050fdffaf8e9607935d39ed0a0c68dc36046b47d）で安全な合成クラッシュ試験・DPAPI/子プロセス/プロフィールのNO-GO契約を25/25テストで確認。実機試験未実施。
- 最新main、MASTER、AGENTS、継続ボードを照合。ボードの旧source_mainは過去の監査基準。既存の合格済みA2 SQL/Cron・合成試験は再実行しない。
- **今回の変更は別ブランチ内の新しい候補ファイルのみ。既存PR #2787の元ファイル・現行OSのwatchdog.ps1/state.json/heartbeat.json/タスク/ユーザー/プロファイルは変更しない。**

## 既存Workerの監査で確定した問題

元のWorkerはGUARDED_TEST中の親PID消滅・期限切れ・GUARD_ONLY等を分岐判定していたが、最終的に専用ユーザーが無効であるとstatusをWATCHDOG_DISABLED_CONFIRMEDで上書きする。このためHeartbeatから「親死亡を検知したか」と「最初から無効だったか」を区別できなかった。

同じHeartbeatを繰り返し受け取っても、親死亡検出・有効アカウント再無効化・ログオンセッション/子プロセス停止・DPAPI安全性・プロフィール残留ゼロの証拠にはならない。

## 今回の候補実装

新ファイル：

- tools/novelight-commander/gateb-recovery-reason-worker-candidate.ps1
- tools/novelight-commander/gateb-reason-worker-one-shot-update.ps1（次の別承認専用の一回限り更新候補。既定Preflightは読取のみ。Applyは本作業で実行しない）
- tests/nlo-ai-020705-gateb-watchdog-reason-offline.test.mjs
- 本文書

元WorkerのWindows SYSTEM主体、対象PC/ユーザー/SID固定、Administrators/SYSTEM/専用ユーザーのみの保護ACL検証、既存のGuard-only安全動作、20分以内のGUARDED_TEST期限、親PID＋起動UTC時刻照合、固定SIDのDisable-LocalUserだけ、Heartbeat失敗時exit 3を維持する。

**Heartbeat version=1を維持して追加フィールドのみ導入**（既存managerの読み取り条件との後方互換性を維持）：

| フィールド                               | 値／意味                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| status                                   | 既存のWATCHDOG_DISABLED_CONFIRMED / WATCHDOG_PARENT_ALIVE / WATCHDOG_RECOVERY_UNCONFIRMED等   |
| reasonCode                               | STATE_INVALID / GUARD_ONLY / DEADLINE_EXPIRED / PARENT_GONE / PARENT_ALIVE / UNVERIFIED_ERROR |
| disableOutcome                           | ALREADY_DISABLED / DISABLED_BY_WATCHDOG / NOT_REQUIRED_PARENT_ALIVE / DISABLE_UNCONFIRMED     |
| accountWasEnabledBefore                  | 信頼済み対象SIDの最初の読取時にEnabledだったかの真偽値                                        |
| disableAttempted                         | この1回のWorker実行でDisable-LocalUserを呼んだかの真偽値                                      |
| sequence / checkedUtc / observedDisabled | 従来どおり。個人識別情報や機密値を追加しない                                                  |

### 理由コードの優先順位

1. 状態欠落・構造不一致・不正UTC期限・期限が20分を超える等は **STATE_INVALID**。
2. GUARD_ONLYは **GUARD_ONLY**。
3. GUARDED_TESTで期限経過なら **DEADLINE_EXPIRED**（同時に親も死亡していても期限切れを優先）。
4. 期限内で、親PID不存在または作成UTC時刻不一致なら **PARENT_GONE**。
5. 期限内、親PID＋起動時刻が一致なら **PARENT_ALIVE**。
6. 検証途中の予期せぬ障害は **UNVERIFIED_ERROR**。状態破損だと断定しない。

### 「無効化した」と誤認しない条件

- **ALREADY_DISABLED**：最初から無効、かつDisable-LocalUser未呼出し、独立再読取でも無効。
- **DISABLED_BY_WATCHDOG**：最初は有効、固定SIDへのDisable-LocalUserを実際に1回呼び、コマンドが成功し、独立の再読取で無効。子プロセス停止の証明ではない。
- **NOT_REQUIRED_PARENT_ALIVE**：親が正常稼働、ユーザーも有効、Disable-LocalUser不要。
- **DISABLE_UNCONFIRMED**：それ以外の不一致、SIDずれ、失敗、再読取不能。結果を成功とみなさない。
- 単一Worker実行内でDisable-LocalUserの自動再試行はしない。既存のSYSTEMタスクが繰り返し実行されること自体は現在の設置状態であり、今回変更しない。

### 検証の仕方と限界

- PowerShell ASTから副作用のない2つの関数だけを抽出し、別プロセスのメモリ内で「理由8ケース・無効化結果8ケース」を実行。OSアカウント/タスク/保護ファイルは触らない。
- JavaScriptの静的契約検査で固定対象、SID/ACL、期限、親PID＋時刻、Heartbeatの追加フィールド、資格やネットワーク操作の不在、Inspectのみの安全起動を確認。
- 実際のSYSTEM Recover、ユーザー有効化、プロセス停止、DPAPI、Guarded State更新、OSタスク更新は全て実行しない。
- 状態ファイル破損またはSYSTEM権限・ACL/SID検証失敗時、理由コードを**確実に書けるとは限らない**。信頼境界未確立ならHeartbeatを書かず、失敗扱いとする。
- アカウントの無効化だけでは既に起動しているプロセス/ログオントークンを止められない。子プロセス残留、プロフィール/DPAPI素材、空vault、Watchdog自身の後片付けはPR #2790の独立NO-GO契約を引き続き必須とする。
- 既存SYSTEMタスクのOnce反復は7日間。期限切れ・OS停止・Task Scheduler不調時の即時安全復旧保証はない。

## 次の実機承認までの必須条件

1. 新Draft PRのCI・CodeQL・オフラインテスト、固定HEAD・新Worker SHAを確定。
2. 対象PCが一致、既存タスク1件のみ・SYSTEM主体・Action固定・既存Workerの旧SHAが一致・保護ACL/SID/GUARD_ONLY・最新Heartbeatと現在アカウント無効、7日期限の余裕を**管理者読取で検証**。
3. 新しい専用更新候補 gateb-reason-worker-one-shot-update.ps1 は、事前管理者照合、旧Worker/新WorkerのSHA、7日間反復期限30分以上、最新GUARD_ONLY Heartbeat、ACL/SID、タスクAction/Principalの固定を必須とする。対象タスク1件を一時無効化・停止して元Workerをバックアップした原子的差し替え、同タスクの再有効化・起動1回、**更新前より増えた**Heartbeat sequenceと reasonCode=GUARD_ONLY、disableOutcome=ALREADY_DISABLED、accountWasEnabledBefore=false、disableAttempted=false、旧statusとの互換性を確認する。成功時だけ旧Workerバックアップを削除。失敗時はNO-RETRY/手動整合が必要で、タスク停止や一時バックアップの残留リスクがある。**新しい1回限りの対象限定OWNER承認がなければApply禁止**。既存のArm/修復承認は消費済み。
4. 差し替えが成功してもGUARD_ONLYの稼働証拠にすぎない。次の **「無効のまま親死亡の合成state注入」** はさらに別承認。実ユーザー有効化・パスワード設定・親kill/DPAPIはさらに後続の独立承認。
5. main統合はProduction自動ビルド・デプロイの可能性があるため別の本番承認が必要。Draftの段階で統合しない。

**費用：今回追加0円（クラウド課金0、実AI呼出し0）。** 実PAT・Secrets・Cloudflare・Supabase・Vercel・Staging・Production、既存NLOやOSは未変更。Gate A～Eは0/5 NO-GO。
