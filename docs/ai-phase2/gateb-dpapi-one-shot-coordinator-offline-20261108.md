# NOVELIGHT AI工程② Gate B — DPAPI一回限り実機制御のオフライン統合（2026-11-08）

**状態：コード/局所テストのみ。Windows OS操作、DPAPI実呼出し、資格設定、Runner起動は未実施。Gate A～E 0/5、NO-GO。**

## 変更対象と既存資産

- 既存Draft PR #2774を継続。新規PRは作成しない。
- PR #2782：保護Vaultと専用SIDのACL要件を再利用。PR #2794：GUARD_ONLY下で対象ユーザーを一時有効化した既存SYSTEM Watchdogが自動再無効化した成功実機証拠のみを再利用。合成/実機試験を再実行しない。
- 既存の `gateb-dpapi-sid-proof-candidate.ps1` に、成功後だけ書き込む非秘密のVault完了receiptを追加。Watchdogの保護ディレクトリは対象SIDに対して読み取り専用のため、ターゲットからそこへ標準出力を直接書かない。

## 統合コード候補（現在は実行禁止）

- `gateb-dpapi-one-shot-coordinator-candidate.ps1`：`Plan`は説明だけ、`Apply`は常時exit 4。実コード関数はエントリポイント未接続。ホスト・SID・非管理者・ACL・既存worker SHA・スケジュール7日期限・GUARD_ONLY・Heartbeat・残留を事前確認。
- 新しい一回限りのCreateNew台帳 → 48文字のCSPRNG SecureStringで必要時の専用アカウントパスワード再設定 → 元state保存、親PID＋作成UTCと最長300秒期限を持つGUARDED_TESTへ原子的切替 → 別SYSTEM Watchdogの `PARENT_ALIVE` 新Heartbeat確認 → 専用ユーザー有効化。
- 資格付き非S4Uログオン＋ `LoadUserProfile`、CurrentUser合成DPAPI `TargetCreate`、同SID別プロセス `TargetVerify`。各プロセスを55秒以内に監視し、長引いたらPID・開始時刻・SIDが完全一致する子だけを停止候補にする。認証情報、合成乱数の生値、シークレットは引数・環境変数・ファイル・ログ・チャットに送らない。
- ユーザー再無効化を照合後、プロセスおよびWin32_LogonSessionのSID残留ゼロを別々に確認、異SIDの管理者によるCurrentUser復号拒否（実CryptographicException）を確認し、GUARD_ONLYを原子的に復元。
- `gateb-dpapi-system-rescue-candidate.ps1`：**別SYSTEMタスク向け、未インストール**。親死亡/期限切れ時にのみ専用ユーザーを無効化し、元と現stateのSHA、保護arm-manifest、対象SID、子/セッション0件を照合できる場合だけGUARD_ONLYへ原子的復元する候補。現時点の `Recover` は常時exit 4。

## 危険と未完了条件（偽のGOを避ける）

1. 統合関数は実機入口から意図的に到達不能であり、実機実行を承認できる状態ではない。新しい固定HEAD・全スクリプトSHA・OWNERワンタップ承認・保護permit・SYSTEM独立復旧タスクの**実機設置／稼働証拠**が必要。
2. パスワードは現在不明。提案方式では既存パスワードを復元せず、管理者による一度限りのCSPRNG再設定が必要。生成値は保持しないため将来ログオン時には再設定が必要となり得る。旧DPAPIデータがあれば影響を受ける。現実装では **Set-LocalUserは未実行**。
3. GUARDED_TESTの独立SYSTEM Workerは対象ユーザーの無効化を行うが、ログオントークン・子プロセス停止とstate復元までは行わない。今回のSystem-rescue候補を**別のSYSTEMタスクとして先に設置・1回の復旧検証に合格させない限り、専用ユーザーを有効化してはいけない**。
4. スケジュールは7日反復で期限切れの可能性がある。残り30分を下回った場合はNO-GO。恒久期限対策は別承認。
5. アカウント無効化は既存セッションを終了させない。未知の子PID・セッションがある場合はSTOP/NO-GO。対象外プロセスの停止や親の一括killは禁止。
6. 実験で合成暗号文/ダイジェスト、非秘密receipt、監査台帳、専用プロファイルやDPAPIマスターキーが残り得る。自動削除しない。後片付けには対象固定の別承認が必要。
7. 元のGUARD_ONLYバックアップ/arm-manifest/one-shot ledgerはAdmin/System書き込み限定にする必要がある。既存の消費済みParentGone/GuardOnly試験マーカーを変更しない。
8. 対象Windows、PASSWORD、SYSTEMタスク、Staging/Production、Vercel、Supabase、Secret、PAT、mainへは今回一切操作しない。

## 実機向け次の承認契約

次回は、現HEAD、Coordinator/Rescue/DPAPI-probe各SHA-256、対象PC・SID、パスワード再設定を含むか、保護SCRIPT設置と別SYSTEMタスク1件、Apply最大1回、GUARDED_TEST最長300秒、アカウント有効240秒以内、個別停止対象、緊急管理者 `Disable-LocalUser`、残留証拠、別件のプロフィール削除承認を明記したワンタップ承認を必要とする。**現時点はこの承認を提示しない。**

## 検証区分

PowerShell構文・Node静的契約・オフライン故障モデル PASS を合格記録とし、Windowsの実機End-to-End/DPAPI異SID/SYSTEM独立復旧/子セッションゼロは**NOT RUN / NO-GO**。実機のための保護タスク管理と検証は今後の局所実装対象。
