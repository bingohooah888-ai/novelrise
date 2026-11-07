# Gate B Windows専用ユーザー／合成DPAPI／保護Runnerの接続準備（2026-11-07）

**OFFLINE ONLY / REAL CREDENTIALS DEFAULT DENY / Gate B NO-GO / Gate A–E 0/5**

## 1. 確認できた実機証拠（作成を再実行しない）

- PC `DESKTOP-8Q4GFC8`：OWNER承認済みWindows隔離準備用スクリプトが`GATEB_APPLY_SUCCESS`、別の管理者PowerShell読取検証が`GATEB_INDEPENDENT_READONLY_VERIFIED`を返した。
- `NOVELIGHT-GateB`は無効の非管理者アカウント。親`C:\ProgramData\NOVELIGHT`、空の子`C:\ProgramData\NOVELIGHT\GateB`は既に作成・指定ACL設定済み。繰り返し作成禁止。
- 本番用パスワードは作成時に生成後破棄。**再取得不可**。専用ユーザーとしてログオン・プロセス起動・DPAPI復号した証拠はまだない。
- 実行元：Draft PR #2778 / commit `49ac65cc61322a6b2a917c11f25542b56b30d069` / script SHA-256 `01d3fd35d67264d95716da436de8f2ccd67c5c4b62e5ce8718ea7402a6982d11`。結果記録：Draft PR #2780。いずれもmain統合・Production反映とは別。

## 2. 今回実装したオフライン接続準備

| 部品                                                           | 目的                                                                                                          | 絶対にできないこと                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tools/novelight-commander/gateb-host-readonly-inspection.ps1` | 固定PC、無効の非管理者、ACL主体/継承/最低権限、ディレクトリ構造を**読み取り専用**で再評価。結果は固定文字列。 | ユーザー作成・有効化、パスワード変更、ACL変更、資格取得、RunAs、サービス起動 |
| `scripts/nlo-ai-020705-gateb-host-handoff-offline.mjs`         | PowerShellスクリプトSHA-256固定、許可引数1個のみ。純粋な合成結果のステージング限定照合とRunnerの強制拒否。    | 実DPAPI復号、実認証、PAT/JWT・ENV入力、APIアクセス、クラウド変更、有料AI     |
| `tests/nlo-ai-020705-gateb-host-handoff-offline.test.mjs`      | ハッシュ・固定スコープ・合成結果偽装時も実行不可・Secret入力拒否・Windowsの読取テスト。                       | 実Runnerや本番資格の接続                                                     |

### 既存DPAPIの再利用関係

- Draft PR #2774 の `gateb-dpapi-synthetic-handoff.ps1` および固定SHA付きNodeアダプターの**合成資格テスト5件は過去成功済み**。今回、同じDPAPI処理を再実装せず、結果マーカー `OFFLINE_DPAPI_SYNTHETIC_HANDOFF_PASS` だけを**未信頼の模擬入力**として照合できるようにした。
- これはNodeアダプターから#2774のDPAPI合成実行を直接呼んだ証拠ではない。PR #2774は未統合であり、ユーザーが異なるWindowsセキュリティ境界に属することもまだ実証していない。
- DPAPIのユーザー固有復号は「同じOSユーザーなら別プロセスから復号可能」。現在のNLOアカウントで合成PASSでも、新しい `NOVELIGHT-GateB` アカウントが独立して使えるという意味には**ならない**。
- 本モジュールは合成結果の自己申告を信頼済み実証として扱わない。`OFFLINE_SYNTHETIC_CONTRACT_MATCH_NO_GO` にも `hostIdentityAuthenticated: false`、`runnerEnabled: false` 等の否定フラグを維持する。

## 3. 実行権限のない状態の限界

- 無効ユーザーにログオンできず、現在の初期パスワードも復元不能。そのため `NOVELIGHT-GateB` IDでDPAPI暗号化・復号する**実ホスト境界テスト**は未実施。
- WindowsユーザーACLはローカル機密境界の一部に過ぎない。管理者・SYSTEM・同一IDのプロセスからのアクセス、独立Watchdogの実停止権限などは別途評価する。
- 既存Staging `wmlzjgvxgoyrovdhbqbg` とProduction `fiepaguycecrredwrcwx` の実API拒否証明は未実施。単なる文字列チェックはProofではない。
- `.github/staging-ai-02-07-05/protected-stage-executor.mjs` はDormant/外部認証未接続。今回の `createProtectedGateBRunner()` は**常に例外を投げる**。AI工程②の活性化にはならない。
- 実資格入力、プロセス起動、Scheduled Task登録、ユーザー有効化・パスワード再設定、環境変数・Secrets設定、StagingやProduction変更は**今回のPRでは一切実施しない**。

## 4. 次の承認前に確定させる実行経路

1. 専用Windowsユーザーのパスワード初期化・有効化方法、ログオン種別、保管要否を**事前設計**する。平文パスワードの出力・保存・GitHub/Chat転送は禁止。失敗時は再実行を禁止する。
2. 新しいユーザーIDでの合成DPAPI暗号化・復号、別IDからの復号拒否と残留ゼロを**独立して証明**する。ユーザーを有効化すること自体が別の一回限り承認を要する。
3. 専用OSユーザーとRunnerの完全な認証・権限境界、ホスト起動元・署名・原子的one-shot・独立停止/cleanupの仕様を統合する。無効アカウントや合成PASSをlive access権限として扱わない。
4. Stagingに対する最小権限・Production拒否、Vercel Preview/runner保護、実PAT/Secret保管のそれぞれは別のスコープ・費用・リスクを事前に固定し、**それぞれの対象限定OWNER承認**を取得する。
5. Gate B実資格・実JWT・実Runnerの証拠が揃うまで**NO-GO**。PRをmainへ統合する場合は、Production自動デプロイ可能性を含めた別の明示的本番承認が必要。

## 5. オフライン検証

```powershell
node --test tests/nlo-ai-020705-gateb-host-handoff-offline.test.mjs
```

合成結果照合、実行拒否、PowerShell構文確認をコードとテストで行う。実IDでの権限昇格やDPAPI資格保管は実施しない。
