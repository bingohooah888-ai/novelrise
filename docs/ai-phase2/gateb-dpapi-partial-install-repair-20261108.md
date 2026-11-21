# Gate B DPAPI — 既存保護ファイルの一回限り修復（オフライン候補）

2026-11-08。**この文書と専用スクリプトはオフライン実装だけ。Windows保護ファイル・Owner permit・proof arm・タスク・ユーザーは変更していない。** Gate A～E = 0/5 NO-GO。

## 原因と固定資産

- 既存Draft PR #2774 を使用。基準旧HEAD `5ffda47c3d2f82ce6a323640551471b1cc31a13d`。旧2本スクリプトはまだ保護領域に設置されている。既存インストールおよび復旧タスク登録用の一回限りマーカーは消費済みで、削除や再実行は禁止。
- 旧SYSTEM復旧タスクは初回 `IDLE_DISABLED` Heartbeat を書けたが、2回目以降の `File.Replace($temp,$hb,$null)` がWindowsで `0x80070057` により失敗。バックアップファイルを明示した候補を隔離した一時フォルダで3回連続検証してPASS。
- Coordinatorが `CalendarTrigger` と照合していたのも誤り。Windowsは日次タスクを `MSFT_TaskDailyTrigger` として公開する。既存PRに修正済み。
- DPAPI proof arm permitは既存状態でACL継承あり。Owner permitは保護された3ルール、両permitとも期限切れ。

## 専用コード

`tools/novelight-commander/gateb-dpapi-partial-install-repair-once-candidate.ps1`。既定の `-Mode Plan` は処理概要を出すだけ。 `-Mode Repair` は別の新しいOwner承認トークンと最新HEADを要求し、以下をこの順序で実施する候補である。

1. 事前に対象ホスト、管理者、Git HEAD/作業ツリー、対象SIDと無効状態、GUARD_ONLY、既存/新SYSTEMタスク構成、既存Watchdog、旧/新2本のSHA-256、両permitのSID/ACL/旧HEAD/旧ハッシュ/旧期限、既存の消費済みマーカー、未開始DPAPI、旧正常Heartbeatを全て検査。差があれば**1文字も変更せずNO-GO**。
2. 新規の修復専用マーカー `gateb-dpapi-protected-repair-once-consumed.marker` をCreateNewで**変更前に消費**。失敗後に再試行できない。
3. Coordinator、SYSTEM Rescueの2本だけを保護領域にステージング、SHA確認後、`[IO.File]::Replace` で差し替える。旧ファイルを `.repair-previous` に保管。既存2本の他のスクリプトは無変更。
4. Owner permitは新HEAD・新2本のSHAと18分の期限、proof armは同じ18分期限と3ルールの**保護ACL**へ更新。どちらも一時ファイル→原子的Replace、旧版バックアップを保持。秘密値は記録しない。
5. 新版の承認契約を実際に照合後、**SYSTEM復旧タスクが新しい`IDLE_DISABLED` Heartbeatを実際に更新し、最終終了コード0、専用アカウント無効のまま**という証拠が揃った場合のみPASS。

## 重要な制約と障害時

- **タスクの登録/変更/停止/再起動、DPAPI Apply、OSアカウントの有効化、パスワード変更、プロファイル削除、既存マーカー削除、main/Staging/Production/NLO変更は一切しない。**
- 定期稼働中のSYSTEMタスクは差し替え中に旧コード・旧ハッシュで一時的に失敗し得る。更新後の新しいHeartbeat確認までPASSではない。
- 4対象のファイル差し替えは**それぞれ原子的でも4件全体のトランザクションではない**。途中停止では一部だけ新旧が混じる危険がある。修復用マーカー・ステージファイル・旧版バックアップを保持し、自動ロールバック/再試行はせずNO-GO。対象アカウントは無効を保持し、再度の独立Owner承認に基づく部分状態診断が必要。
- 新しいpermit期限は短期（18分）。期限切れでのDPAPI Applyは自動許可しない。今回の実機修復承認を将来のDPAPI試験に流用しない。
- 次回Windows変更の前に、**最新HEAD、専用ランチャー自身のSHA-256、新旧2本のSHA、対象PC/SID、4ファイル更新最大1回、事前条件、途中失敗時の診断・手動復旧**を指定した新しいワンタップOwner承認を必須とする。

## 確認範囲

PowerShell構文・オフラインPlan／未承認Repair拒否・既存の局所テストだけを実施。SYSTEM実機での新版Heartbeat、保護ファイル差し替えやACL更新は **NOT RUN / NO-GO**。
