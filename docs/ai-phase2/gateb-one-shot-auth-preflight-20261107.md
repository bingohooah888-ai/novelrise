# AI工程② Gate B — 一時有効化／合成DPAPI実機試験に向けた安全確認

**2026-11-07 / OFFLINE DESIGN ONLY / NO LIVE APPLY / Gate B: NO-GO**

## 実機で確認できた状態

- PC: `DESKTOP-8Q4GFC8`、`NOVELIGHT-GateB` は現在も**無効**。作成済みの親 `C:\ProgramData\NOVELIGHT` と子 `C:\ProgramData\NOVELIGHT\GateB` は再作成しない。
- 2026-11-07の別個の管理者PowerShell検証 `GATEB_INDEPENDENT_READONLY_VERIFIED` で、非管理者・保護ACL・空ディレクトリを確認済み。前回の承認で行った作成を再実行しない。
- Remote Desktop Commander（非管理者）による2026-11-07の読取確認では `seclogon` サービスRunning、無効アカウント、初回 `Win32_UserProfile` が存在しないことを確認した。ただしリモート非管理者から子ACLは読み取れない。
- 既存Draft PR #2774のDPAPI試験は**そのユーザーのローカル合成データ**が対象。専用OSユーザー `NOVELIGHT-GateB` で暗号化・復号した証明ではない。PR #2782は実行拒否のオフライン境界準備のみ。

## 今回作成したコード

1. `tools/novelight-commander/gateb-one-shot-auth-preflight.ps1`：管理者権限、固定PC、ユーザー無効・非管理者、両ディレクトリのACL、空ディレクトリ、専用ユーザープロファイル未作成、Secondary Logon利用可、PowerShellコマンド存在を**読み取り専用**で検証。すべて合格でも「独立復旧監視未実証」を出力する。**Applyは常に拒否**。
2. `scripts/nlo-ai-020705-gateb-one-shot-auth-model.mjs`：模擬状態遷移と障害注入（9段階）。合成Watchdogの真偽を含め**すべてOFFLINE / NO-GO**、実アカウントやRunnerを動かすAPIはない。
3. `tests/nlo-ai-020705-gateb-one-shot-auth-model.test.mjs`：誤ホスト／誤ユーザー／Production／認証再利用／Crash前後／Preflight／Apply拒否の検証。

## 安全上の阻害要因

**現行の一時アカウント有効化には、親PowerShellの`finally`だけでは足りない。**

- 有効化した直後に管理者PowerShellが終了する、電源断、プロセスが強制停止されるなどの場合、`finally`は実行されない可能性がある。
- 本人が今回許可した対象は専用OSユーザー1件の一時有効化・再無効化・合成DPAPI実証であり、**独立したWindowsタスク/サービスの新規作成までは明示されていない**。別対象のOS変更を既承認に紛れ込ませない。
- `New-LocalUser`の元パスワードは復元不可。管理者による `Set-LocalUser -Password` リセットは新しいユーザーに未使用の既存DPAPI素材があれば復号不能にする可能性があるため、**対象SIDのプロファイルと保管データの未作成をPreflightで照合**する。
- `Start-Process -Credential -LoadUserProfile` のMicrosoft公式仕様は、異なるOSユーザーで起動する経路を提供するが、専用IDでの実証成功やクラッシュ時の無効化は保証しない。
- ユーザー別DPAPIは同じOSユーザーに復号を許す。クロスユーザー拒否は、実際に専用IDと別のOSユーザーのプロセスで個別に検証する必要がある（合成文字列の照合では不十分）。
- 初回ログオン時にユーザープロファイルやDPAPIマスターキーが生成され得る。予め作成されていないことを確認し、後片付けは新たに作られた対象SIDのプロファイルだけに限定する。識別不能時は破壊的な手動除去をせずNO-GO。

## 次の安全な実装条件（すべて必要）

- **独立した復旧監視（例：対象PCで一時的な専用Scheduled Task）**の対象名・実行ID・期限・実行権限・復旧成功証拠・後片付け契約を設計し、独立した対象限定OWNER承認を取得する。監視は`NOVELIGHT-GateB`だけを無効化し、その他のユーザーやNLOタスクを変更しない。
- 専用Watchdogを**先に**実機で登録・武装・別プロセスで復旧可能と確認してから、アカウントのパスワード変更／有効化を許す。復旧監視なしのApplyは禁止。
- パスワードはCSPRNGでメモリ内SecureString生成。チャット、GitHub、PowerShell標準出力、引数、環境変数、ディスクへの保存を禁止。ログオン時はPSCREDENTIALをメモリ経由で渡し、生のパスワード文字列を一切ログに出さない。
- 有効化から子プロセス生成までの短い区間の直後に、管理者側がまずユーザーを再無効化。その後合成DPAPI暗号化・復号と別ID拒否を確認する。タイムアウト・child process残留・Watchdog停止・ユーザー有効状態・ユーザープロファイル残留は**NO-GO**。
- Watchdogの強制停止時・管理者側の途中終了時・PC再起動など異常系の扱いを実機に合わせて別検証。ユーザーが無効である独立確認と、Watchdog自身の削除証明を揃える。
- Windowsの専用実行テストの前に、その時点での**具体的な実行スクリプトの固定Git HEADとSHA-256**を提示する。固定前の承認を後から開発した別スクリプトの実行へ転用しない。

## 境界と費用

- 今回のスクリプトはWindowsユーザー・ACL・タスク・Secrets・本番の状態変更を**一切実行しない**。
- 一時監視の設計・必要な権限・事前/事後確認の実コードとCI検証は引き続きOFFLINE作業として進められるが、実登録は別のワンタップ承認が必要。
- 外部料金：今回0円。実PAT、JWT、Staging/Production、Cloudflare/Vercel、AI課金は引き続き完全禁止。
- Gate B全体・Gate A～EともNO-GO。

参考：Microsoft Learn `Start-Process` (PowerShell 5.1) および Windows DPAPI `CryptProtectData` のユーザー境界の説明。
