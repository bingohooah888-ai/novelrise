# NOVELIGHT βScout Point10倍｜trusted-main専用Staging実行器・一回限り承認実装案

作成日：2026年11月5日 JST  
状態：**未稼働の設計・read-only契約**。Staging実行、実DB変更、Production変更、main統合・本番デプロイは禁止。

## 0. 正式根拠とブランチ

- 正式main `03f64b14138ec5c6a90c0d8231a0784f878e78fa`、MASTER blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`（5,089行）。`AGENTS.md`、`WORK-EXECUTION-PREFLIGHT`、`AUTOMATION-CONTINUATION-GATE`、`NLO-EXECUTION-POLICY`、`development-workflow`の安全ゲートに従う。
- 本体Draft PR #2762 事前HEAD `43b268d11e68c74a885618b618692ceeb164085e`、独立SQL候補Draft PR #2763 HEAD `58e60ef90801078e097e321590428c4b8b343486`。前回の`scripts/scout-point10x-atomic-execution-contract.mjs`はread-onlyの前提レビュー。
- Issue #294は既存の`[Staging Control] Supabase migration sync`。本体Draft PRにある`staging-reader-point-tenfold-proof.yml`は`reader-reward-beta-point-10x-staging`／`rollback-only`専用で、**mainへ未統合**。今回もそのworkflow／SQL安全フィルター／OWNER認証ゲートを変更しない。
- 独立候補のSQL4本は数値変換をROLLBACKで検証するもので、SECURITY DEFINERの5→50pt関数切替やprivate markerの永続作成を含まない。**既存SQLを永続cutoverとして使い回さない**。

## 1. 新しい承認境界は2段階（別scope・別mode）

| 将来の行為 | 新scope | mode | データを残すか |
| --- | --- | --- | --- |
| 原子性のread/write ROLLBACK実証 | `reader-reward-beta-point-10x-staging-atomic-rollback` | `atomic-rollback-only-proof` | **最終ROLLBACK必須** |
| Staging内で永続的な10倍へ変更 | `reader-reward-beta-point-10x-staging-atomic-persist` | `atomic-persistent-staging-cutover` | 新規OWNER承認・専用Trusted Executor・実証が成立するまで禁止 |

**両方とも、現時点で有効な承認手段ではない。** 旧scope／`rollback-only`／通常の`本番承認`を昇格させない。将来trusted mainに**別のレビュー済みOWNER認証・使い切り承認処理**が入るまではIssue #294のコメントがあっても起動不可。新scopeの追加は既存の一回限り台帳の変更・省略ではない。

機械可読OWNERリクエストを`NOVELIGHT_STAGING_READER_POINT10X_ATOMIC_REQUEST `の固定接頭辞＋exact 10-field canonical JSONに限定する。GitHubから取得するIssue number/title/creator、コメントのOWNER本人とauthor_association、github.actor、github.triggering_actor、fresh main SHA、候補Draft PR HEAD、Staging ref、対象scope/mode、source snapshot digestと固定marker/RPC SHAを別々に照合する。Issueコメント全ページ取得完了の証拠がなければ停止。既存CLAIMED／CONSUMEDはリクエストコメントIDだけでなくoperationId、scope＋candidate HEADでも重複停止し、**再承認扱いしない**。

GitHub自身の認証済みイベントを取得しているのは、将来のtrusted-main workflowのみ。今回の関数へ渡したJSONがすべて一致しても、それは実証ではなくcaller input。レビューコードは**常に`mayExecuteSql=false`**。

## 2. 将来のtrusted-main executor：実装順序と境界

既存のmain版SQLコンパイラは`SECURITY DEFINER`を拒否する。緩和せず、将来の一括切替には**別のレビュー済み・hash pin方式の権限付き関数差分審査器**を設計する。実行器を候補Draft PRに置いたまま候補ブランチで実行しない。候補PRから読み込めるのはハッシュ固定した静的SQL assetのみ（任意JSやworkflowは禁止）。

1. Github issue_comment(created)から正規OWNERを認証。latest mainと候補Draft PR headを照合し、新しい専用scope+modeであることを検証。
2. 承認ごとの`operationId`＋comment IDを**一度だけ**CLAIMEDとしてIssue #294へ記録し、書込みの成否や中断にかかわらず最後はCONSUMED。CLAIM記録前にStaging秘密情報を読み込まない。Claim投稿失敗・履歴取得漏れはFail Closed。
3. 実際のStaging project `wmlzjgvxgoyrovdhbqbg`の接続先をセッション内で確認し、Production ref `fiepaguycecrredwrcwx`に一致する場合は停止。接続先の単なるURL文字列確認だけに依存しない。
4. **全体バックアップ取得＋隔離したPostgreSQLへの復元成功**を、権限、RLS、schema、functions、triggers、extensions、全行fingerprintまで照合する。バックアップの秘密値やユーザー情報をログ／PRへ載せない。独立復元できなければ次へ進まない。
5. API・service_role・直接SQL・旧Rank/発掘・称号・運営・Cron/Edge/Queue/Retry/Outbox・読書/コメント付与を棚卸し。**全旧単位writerと新単位writerを一時停止**し、inflight=0、未分類writer=0、DB-enforced version fence、XP/Point/Badge/Operatorのロックと権限を独立証明。RLSのみではservice_role BYPASSRLSを防げない。DBロックはCOMMIT後に外れるのでwriter再開までの持続ゲートが必要。
6. 対象表と現在の機密情報をロックした状態でsource row digest、point unit、owner/ACL/search_path/trigger、旧RPC SHA-256 `24be8677e21321908b27733eec1005c7bdf394aba32bdaa9de0f7b071e53c1a9`を再確認。未知のtrigger・函数定義差異・データバージョンがあれば停止。
7. 将来の一つのDBトランザクションで、非公開`novelight_reward_private.point_unit_cutovers`のunique marker、5種類のPointデータ面、旧5pt→新50ptのSECURITY DEFINER関数差分を原子更新。private markerのSQL review SHA-256は`8f00276cc74a3a821aa7ef93f0bcf7d5f1e552d9b13b05b3a433a3db02129656`。**今回のファイルはdocs/plans下の非実行案であり、適用しない**。
8. 全台帳／読者ごと残高、event key・source・reversal・status、獲得済称号・進捗・XP、owner/ACL/search_path/trigger、private marker、二重イベントを完全照合。**Point累積称号進捗はPoint台帳のpoint_value更新だけでは自動更新されない**ので同じ境界で変更。監査外のmetadata変更は禁止。
9. `atomic-rollback-only-proof`なら常にROLLBACKし、復元された現状態と独立snapshotが一致することを確認。`atomic-persistent-staging-cutover`なら**別の新規OWNER承認と全証拠が成立した場合のみ**COMMITできるレビューを行う。現時点に実行可能なCOMMIT処理は存在しない。
10. COMMIT後も付与再開は保留し、新旧単位のRPC/API/UI、read-only全件照合・本人RLS、意図的障害と再接続ケースを検証。新規Point発行後の障害は古いバックアップを自動上書きせず、読み取り専用のmarker／イベントジャーナルから履歴を再照合してforward repairを別承認で判断。

## 3. CODE / TEST / REPORT境界

`scripts/scout-point10x-atomic-staging-plan.mjs`は上記を**実行不可の17ステージ**へ展開する純粋ESM。OWNER承認とCLAIM／CONSUMED履歴の全ページ確認、別scope/モード、SHA/SQL assetの固定、復旧方針を非実行の読み取り解析で提示する。

`tests/scout-point10x-atomic-staging-plan.test.mjs`：認証偽装、別scope流用、JSON重複キー、履歴の不完全ページ、重複CLAIM/CONSUMED、Production接続先、SHA drift、未検証証拠、COMMIT結果不明・commit後合法イベント・未証明forward repairを反証。**実GitHubイベント・実Staging認証／書込み試験ではない**。

**最優先の未完了事項**：OWNER承認を受けてStagingへ到達するtrusted-main workflowの本実装、旧単位writerを完全停止するDB側フェンス、SECURITY DEFINER関数の権限を維持する別の安全審査器、private markerの実テーブル／権限、バックアップの独立復元、COMMIT不明時の再照会・forward repair。既存の安全ゲートを弱めて代替しない。

## 4. 実行禁止と段階別完成判定

- **コード設計・isolated tests**：今回の作業範囲。
- **Staging実環境のread/write証明**：未着手、独立OWNER承認必須。
- **Production DB変更・公開**：未着手、別承認。main統合自体もProductionデプロイを伴いうるため今回禁止。

テスト成功＝DBやGitHubの真正なOWNER認証、耐障害なCOMMITやProduction安全性の証明ではない。重大な未証明条件をなくさないままStaging接続やSQL実行へ進めない。
