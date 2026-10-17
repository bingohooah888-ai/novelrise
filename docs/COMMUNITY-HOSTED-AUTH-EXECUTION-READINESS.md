# 交流広場 Phase 1 — Hosted実ログイン検証の安全な実行経路

2026-10-17 の準備状況。**コード審査用。Staging承認・課金承認・実行許可・Production公開許可ではない。**
検証対象は交流広場本体 Draft PR #2222。対象HEADは実行直前に再取得し、immutable hashを必ず照合する。

## 実装済みと未接続

| 部品 | 現在の状態 |
| --- | --- |
| 隔離対象の構造検証 | `scripts/community-hosted-write-preparation.mjs`、Productionおよび共有Stagingを拒否 |
| OWNER Ledger形式の検査 | `scripts/community-hosted-write-admission.mjs`、**準備判定のみ**。実行grantは発行しない |
| データなしSupabaseブランチの管理APIアダプター | `scripts/community-hosted-branch-manager.mjs`、許可証とmanagement tokenが必要。実API未実行 |
| Hosted Browserと後片付けのライフサイクル | `scripts/community-hosted-write-lifecycle.mjs`、grantとadapterを外部から要求。接続済みexecutorはない |
| 作者・読者・管理者のPlaywrightシナリオ | `tests/e2e/staging/community-hosted-auth-write.spec.js`、未承認ではdefault skip |
| OWNER読取専用Hosted事前審査 | Draft PR #2317。CI成功だがmain未マージ |
| 本体の投稿・いいね・通知・通報・管理 | Draft PR #2222。main未マージ・一般公開OFF |

### 未実装の実行経路（本番承認前にDraft PRへ実装できる範囲）

1. **一度限りのOWNER実行権限**：Issue #188の本人承認を最新main + 正確なPR #2222 HEAD + 単一scope + run IDに固定。Claimを**最初の有料・書込処理より前**に原子的に確定する。重複イベント・再実行・並列競合・既使用証跡を拒否し、成功/失敗/取消のいずれでもCONSUMEDにする。単なるread-only preflightの成功を実行grantに昇格させない。
2. **費用・環境事前確認**：Management API料金見積り、利用可能な安全なbranch plan、使用するVercelの保護方式、Secretの保管・最小権限・漏えい防止を確認。実費のある実行はユーザーの明示的な「ステージング承認」まで止める。
3. **隔離ブランチの生成・照合**：`with_data=false`、`persistent=false`、`is_default=false` の専用ブランチ。Production `fiepaguycecrredwrcwx` と既存共有Staging `wmlzjgvxgoyrovdhbqbg` を書込対象にしない。API応答喪失・timeout時に、同一runのbranchが作成済みか名前とIDで読取照合できる回復経路が必要。削除不能なら必ず失敗・要回収として残す。
4. **schema・fixture・protected Preview**：PR #2222のレビュー済みmigrationを隔離DBへだけ適用し、RLS/公開OFF/履歴を検査。synthetic作者・読者・管理者の独立アカウントを作る。Previewのbrowser/server両方が**同じ専用Supabase ref**を利用すること、Vercel Previewがexact PR HEADであり保護されていることを別APIで再照合。既存 `community-candidate-preview.yml` は共有Staging固定なので今回のwrite用に流用しない。
5. **対話E2Eと強制cleanup**：同意/取消、投稿・いいね・コメント・通知・通報、Block/Mute、管理者の非表示/復元と権限拒否、匿名/別人、R15/R18・非公開・未公開のUIとRPC境界。失敗・timeout・未確定応答でもgate OFF、session失効、fixture削除、アカウント削除、ブランチ削除、APIによる最終不存在確認を必須にする。認証・課金のSecretをtrace・artifact・logに保存しない。
6. **再現可能な審査証跡**：各段階の非機密ステータス・commit・対象ref・approval comment ID・cleanup結果を残す。後片付けが確認できない場合はSUCCESSにせず、手動回収が必要なリソースだけを知らせる。

## このPRで補強する異常系

初回 `getSnapshot()` が例外を返す場合、以前は後片付けへ入らなかった。実行grant・ターゲット・必須adapterの形が確認済みなら、**ブラウザも公開ゲートも起動せず**、後片付けと専用ブランチの削除確認を試み、全体はFAILとする。読み取りに成功して開始時データが汚れている場合は、既存データの所有権を証明できないため、これまで通り破壊的cleanを実行せずFAILとする。

## 実環境へ進む条件

- この準備PR、および必要な安全ワークフローPRのmain導入には**本番承認**が必要。交流広場本体PR #2222のmergeや公開への承認ではない。
- 新規Supabaseブランチ/Preview/書込/Hosted E2E/課金の実行には、見積費用・対象環境・scope・最新SHAを提示したうえで**ステージング承認**が別途必要。
- 承認前にBranch作成・Preview作成・Hosted実ログイン試験を開始しない。CIの既成功テストはむやみに再実行しない。
