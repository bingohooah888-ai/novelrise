# NOVELIGHT AI工程② Gate B：Protected Install／OWNER Permit／独立SYSTEM復旧接続

## 実装段階と承認境界

2026-11-08。既存Draft PR #2774のオフライン開発のみ。実機インストール、パスワード再設定、DPAPI本体、タスク変更、保護フォルダへの書き込みは全て**未実施**。Gate A〜E 0/5 NO-GO。
前回合格済みのSYSTEM Watchdog実機再無効化試験と既存24テストは無関係にやり直さない。

## 今回の最小追加

- `gateb-dpapi-protected-install-candidate.ps1`：OWNERが別途承認した最新HEAD・インストーラー自身/その他スクリプトのSHA-256、対象PC・SID・期限・1回限りpermitを要求。管理者のみ。保護rootが危険なACLなら拒否し、インストール済みや使用済みのマーカーがあれば停止。
- 同スクリプトの将来 `-Mode Install` は admin-owned permitを検証し、4本だけを保護領域へCreateNew相当でコピー、DPAPI用の期限付きpermitを保護フォルダへ作り、別SYSTEM復旧タスク1件だけ登録。既存SYSTEM Watchdogタスクは変更しない。
- 復旧タスク `NOVELIGHT-GateB-DPAPI-Independent-Rescue` の将来登録：SYSTEM、起動時＋日次繰り返し毎分、適用時にタスクPrincipal/Actionを再検証し、実際の `IDLE_DISABLED` Heartbeatを確認できなければ失敗。現時点のスクリプトはOSへのInstallを実行していない。
- `gateb-dpapi-approval-contract.ps1`：保護permitの所有者/ACL（Administrators・SYSTEM・対象SIDのみ）、最新HEAD参照、期限、全インストール済スクリプトSHA、最大Apply1回、許容有効240秒、GUARDED_TEST上限300秒を確認。
- Coordinatorの将来 `-Mode Apply` は保護領域からの管理者実行・期限内permit・二重SYSTEM heartbeatの受領が必須。CreateNew台帳を消費し、既存GUARD_ONLYと対象SIDを検証後、合成データだけでCurrentUser DPAPI（同SID別プロセス復号、異SID暗号学的拒否）を実証する候補。
- `gateb-dpapi-system-rescue-candidate.ps1` の将来 `-Mode Recover` は保護されたSYSTEMタスクからのみ実行可能。GUARD_ONLYでは独立Heartbeat、GUARDED_TESTでは親PID/startと期限を照合。異常時は対象ユーザー無効化を優先し、子プロセス・ログオンセッションが残れば復帰成功を宣言しない。
- 試験正常終了時も既存Watchdogと新しいSYSTEM救済タスクの `GUARD_ONLY` Heartbeatを再確認できなければNO-GO。結果マーカーだけでは実DPAPIの証明ではない。

## 実機で止まるべき条件

- ユーザーやタスクのSID・ACL・ハッシュ・HEADが違う。ソースのgitがdirty。permitが期限切れ/過去承認/余分な許可権限を持つ。登録済タスクが既にある。実機アカウントが有効/管理者。7日反復の既存Watchdogが期限間近。プロセス所有者やログオンセッションが不明。
- 旧パスワードが不明なので、DPAPI実機試験では1回だけ安全なランダムパスワード再設定の可能性がある。旧DPAPIデータがあれば復号性への影響がある。専用ユーザープロファイルが既存なら試験停止。パスワード/PAT/Tokenをコンソールやログへ出してはいけない。
- SYSTEM復旧タスク自体は正常登録されても、OS異常・子プロセス残留・ユーザープロファイルの保持により完全復旧は保証されない。アカウント無効化はログオントークンを削除しない。
- 途中失敗したインストール・guard・復旧の自動再試行は禁止。既存消費済みマーカーは絶対に消さない。新たな一回限り承認ではインストール・タスク登録・パスワード変更・DPAPI操作・緊急復旧の範囲を明示する。
- 実験後のプロファイル/DPAPIマスターキー、合成暗号文・digest/receipt、保護台帳や監査ファイルは残り得る。削除は別承認。

## 完了判定

オフラインの構文テストと局所テストは実機準備候補の品質証拠であり、SYSTEMタスク登録成功、資格付きログオン、期限付きGUARDED_TEST、異SID DPAPI、完全自律復旧の証拠ではない。実機操作直前には固定HEAD・全SHA-256・対象・回数・最大有効時間・停止/復旧・リスクを示す新しいワンタップ承認が必要。
