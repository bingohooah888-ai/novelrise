# NOVELIGHT AI Phase ② Gate B — Windows隔離環境・管理者スクリプト準備

**2026-11-06 / OFFLINE ONLY / Gate B NO-GO**

## 目的・対象

次の対象について、**本人から独立した新しい一回限りの承認を受けた後**、
Windowsの管理者として実行するためのスクリプトを準備した。

- 対象Windows: `DESKTOP-8Q4GFC8` のみ
- 新規非管理者アカウント（作成時は無効）: `NOVELIGHT-GateB` 1件
- 新規親フォルダ: `C:\ProgramData\NOVELIGHT` 1件
- 新規空保管フォルダ: `C:\ProgramData\NOVELIGHT\GateB` 1件
- 既存NLOのフォルダ、ACL、ユーザー、タスク、資格情報: 変更なし

Script: `tools/novelight-commander/prepare-gateb-isolation.ps1`.

## 実行前のHard Fail条件

このPRはスクリプトの**作成・構文解析・静的テストのみ**。
**実行（Preflightモードを含む）は今回していない。**
実環境変更用 `Apply` は、本人の**新しい対象限定承認と管理者実行**の両方を必要とする。

- ホスト名・ProgramData・管理者昇格のどれかが一致しなければ拒否
- 同名ユーザー、親フォルダまたは保管フォルダが既に存在する場合は拒否（上書き禁止）
- パスにreparse pointが見つかったら拒否
- `-Mode Apply` に加え、固定の `-OwnerApproval` 文字列が一致しなければ拒否
- Windows LocalAccounts APIが使えなければ拒否
- PasswordはWindowsのCSPRNG（RandomNumberGenerator）で生成。
  SecureStringへ入力し、秘密の値をチャット、stdout、ログ、GitHub、
  ディスクに保存・表示しない。ランダムバイト列はゼロ化する。
  作成アカウントは無効化され、パスワードは**復元できない**。
  後の実運用には別承認による安全なパスワードリセット・有効化が必要。
- 親・子フォルダをDirectorySecurity指定付きで作成し、継承ACLを遮断。
  明示許可する主体は BUILTIN\\Administrators、SYSTEM、対象ユーザーのみ。
  対象ユーザーは親フォルダをReadAndExecute、空の子フォルダをModify。
- 事後に無効アカウント／SID／非管理者／ACLの保護・権限主体／空のディレクトリを照合。
  障害時には**この実行で作ったものだけ**削除を試みる。フォルダは空でなければ削除しない。
  状態不確定や削除不可は `GATEB_PARTIAL_STATE_MANUAL_RECONCILIATION_REQUIRED` として停止。
- 確認済みコードでも、管理者昇格後の実適用と独立ホスト隔離が成功した証拠ではない。

## 非破壊検証

`node --test tests/nlo-ai-020705-gateb-windows-setup-static.test.mjs`

上記テストは構文解析のみ（script bodyの実行・dot-sourceなし）、
静的境界とWindows現状の**読み取り専用**確認を行う。
`Apply`、`Preflight`のいずれのモードも呼び出さない。

本ドキュメントは新しい管理者実行許可ではない。既存のPR #2774は
**合成DPAPIの検証専用**であり、Scopeと承認を統合しない。

## 後続承認で明示する追加範囲

Windows管理者PowerShellでの**本人による1回限りの実行**、
親フォルダ `C:\ProgramData\NOVELIGHT` **1個の追加作成**、
新規無効ユーザー・専用空フォルダ・対象ACLの設定と確認が必要。
想定クラウド費用は0円（WindowsのOS操作）。アカウント作成／
ACLを伴うローカル変更であり、管理者権限が必要。

新しい承認が出たとしても、同一内容の再試行・Production・Staging・
PAT作成・実資格保存・NLO既存環境改変・タスク登録・クラウド変更は**含まない**。
Gate Bは引き続き **NO-GO**。
