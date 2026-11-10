# NOVELIGHT AI工程②（02-07-05）Gate A〜C 実環境接続・実証の実行仕様

**作成：2026-11-10 JST／承認不要のコード・設定棚卸しのみ。**  
**観測main** `95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3`、**Draft PR #2825（観測HEAD）** `368914c919e3b057cba0b7dd9a17b39d865d9326`、**既存Staging branch** `staging/ai-02-07-05-gatebc-20261105` HEAD `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`。新しいcommitで値は変わり得るため、**実行直前に必ず再取得**する。この文書は承認、実行権限、Preview、実JWT、外部停止、有料AIを付与しない。

## 最優先の結論：機能完成と実証を混同しない

- 作品カルテの本文→候補→出典→作者の確認→作者による創作ノート保存の**オフライン実装・統合**はPR #2825に存在する。外部Providerに実際につなぎ、実JWT/実DBで最後まで成功したという証拠はない。
- 既存Gate B `inspect020705PreviewPrecreation`、Gate A `inspect020705DetachedSupervisorOffline`、Gate C `inspect020705ProtectedRunnerOffline` と、それらを一つの合成runへ結ぶ `inspect020705CombinedGateABCOffline` は**模擬証拠の整合判定**に限る。ネットワークアクセス、権限・Secrets・スケジュール・支出・停止機能は付与しない。
- `.github/workflows/ai-020705-owner-staging-paid-trial.yml` は**OFFLINE PREFLIGHT ONLY**。現時点のWorkflowから本物の`create020705ProtectedStageExecutor`は呼ばれない。これを実行可能にする別の変更は**ユーザーの具体的な承認を得るまで作成／有効化しない**。
- **Gate A〜E 0/5、外部作業ゼロ**。Gate Aで過去に合格した3シナリオ・SQL6件・旧Cron停止を再実行しない。既存のA2 Durable Object 3件には触れない。

## 1. 既存の部品をそのまま使う接続仕様

| 段階 | 呼ぶ既存コード・契約 | ライブ側で用意すべき未接続アダプター／必要な検証 | 実行権限 |
|---|---|---|---|
| A1：独立監視の根拠 | `watchdog-evidence-handoff.mjs`、`detached-supervisor-offline-drill.mjs`、`independent-recovery-plan.mjs`、`signed-runner-death-offline.mjs` | Runnerとは**別ホスト・別権限**のheartbeat、GitHub Runner終了の独立READ、Staging census、Owner台帳の認証済みREAD。時刻・source・runId・SHAの一致を実測 | READのみ。オフライン判定はkill不可 |
| A2：停止・再開阻止 | `signed-watchdog-arm.mjs`、`watchdog-arm-one-use.mjs`、`independent-watchdog-arm.mjs` | Controller専用Ed25519秘密鍵（Runnerから見えない）、保護された公開鍵・nonceの配布、**全Runnerで共有する原子的・永続的な一回限りnonce消費**。Staging限定のkill/disable/revoke/cleanupの最小権限、独立zero census、実費上限・失効時刻 | **未接続**。署名一致は実停止能力の証明にならない |
| B1：対象SHAとPreview分離 | `preview-precreation-readonly.mjs`、`stage-readonly-proofs.mjs` | mainと候補SHAの固定、GitHub branch head、Vercel `dpl_...`・READY・SSO・対象ブランチ、**Staging専用**秘密値／公開値の接続先の独立証拠。Production ref `fiepaguycecrredwrcwx` は不使用 | READのみ。Preview生成は別承認 |
| B2：StagingのOFF/0状態 | `staging-readonly-baseline.mjs` | Staging project `wmlzjgvxgoyrovdhbqbg`へREAD ONLY、AI OFF・4 budget=0・関連行=0・claim RLS/service_role限定を照合。旧合格の再実行はせず**実操作前の状態変化だけ**再確認 | READのみ。変更禁止 |
| C1：信頼できる保護実行 | `protected-stage-executor.mjs` の `create020705ProtectedStageExecutor`、`stage-readonly-proofs.mjs` | `context`（trustedRef、actor、runId、mainSha、previewID、Staging URL）と `expected`・`synthetic`・6つの`proofs`を**実際の独立観測源で供給**。一回限りのProtected Environment、強制承認、single-concurrency、検証済みActions OIDC/最小権限。一般環境変数で承認を偽装しない | 実資格は別承認まで未注入 |
| C2：管理人承認と原子一回限り | `owner-paid-trial-ledger.mjs`、`paid-trial-one-shot-provider.js` | GitHub Issue #294のOWNER署名でなく**GitHub API由来の本人コメント**を特定して `readComments/writeComment`、モデルPOST直前のStaging `novelight_ai_020705_claim_once`をservice_role権限で**原子消費**。失敗・中断・タイムアウトでも同一承認の再使用不可 | 書込み／claimは別承認 |
| C3：合成本人認証と停止・清掃 | `staging-synthetic-cleanup.mjs` | **Stagingに限る合成Authユーザー**の新規作成/本人確認、本人同意revision、実JWT、対象作品・1話・1chunk、`disableTrialEnvironment`／`revokeSyntheticSessions`／`independentCensus`、作者の明示的な確定・保存・再読込。実ユーザー・原稿は使わない | 合成Auth・DB書込・cleanupは対象別承認 |
| D：実モデル1回 | `paid-trial-cleanup-runner.mjs`、`approved-stage-coordinator.mjs` | 本人の別承認後、`gpt-5.6-luna` **1 POSTのみ、再試行・fallbackなし**、USD/JPY換算・通常/長文等の実料金から最悪費用が**10円以下**と証明、最大60分と外部停止、結果・cleanup/censusを検証 | Gate A〜C実証後の**別の課金承認** |

**コールバックの提供元は実装する側が記録しレビューする。** 特に `readIndependentWatchdogArm`、`trustedControllerPublicKey`、`expectedChallengeNonce`、`consumeWatchdogChallengeOnce` は`protected-stage-executor.mjs`内で注入され、**JSのbooleanやローカルSetでは実装不可**。外部Controllerの秘密鍵がRunner側へ漏れない設計を必須とする。

## 2. 今の構成にあるSHAの循環依存（決めないまま進めない）

現在の`protected-stage-executor.mjs`は `context.trustedRef === 'refs/heads/main'` を要求し、`stage-readonly-proofs.mjs`は `readPreview.gitCommitSha === approved.mainSha`を必須とする。

- **問題**：Draft PR #2825はmain未統合。今回の候補をStagingで試験するにはPRのSHAを使いたいのに、既存の実行契約は**main SHAとの一致**を要求する。mainへ先にmergeすると現行Productionの自動デプロイ可能性があり、Staging検証前にProductionへ入る。
- **推奨（まだ未承認）**：Reviewer/OWNERが**対象候補commit SHA・専用Stagingブランチ・期限・1回**を明示指定し、Protected Runnerの信頼済みチェックアウトがそのSHAのみを読み込み、Vercel Previewも同じSHAを指す**候補SHA限定検証契約**を別PRで審査する。承認対象main SHAは「その時点の安全な本番基準」として別フィールドに維持。**勝手に`mainSha`比較を削除・緩和しない**。
- **代替**：現契約を変えずPRをmainへ統合後に検証。ただしProduction自動デプロイの可能性があり、**機能のStaging先行検証という今回の目的と矛盾するため推奨しない**。
- 11月10日現在、既存Staging branch `0e4f3f...` はmain `95f9ddff...` より**43コミット古い**。差分やPreviewを無断で同期・作成しない。実操作前にブランチとPreviewの対象SHAを再取得する。

**2026-11-10 OWNER決定：候補SHA限定Staging先行方式を設計方針として採用。** ただし**実Runner有効化・外部環境操作・main統合への承認ではない**。候補検証契約は今回PR #2825のオフラインコードとして実装し、実環境アダプター／Workflowの変更は別途レビュー・対象限定承認が必要。

## 3. 認証情報の独立性と失敗時の絶対条件

- Vercel Previewの**名前が揃うだけでは不十分**。当該ブランチ専用6環境変数名と共通Preview3つのキー名が過去に観測されている。共通`SUPABASE_SECRET_KEY`／`SUPABASE_PUBLISHABLE_KEY`／`NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY`の**Staging専用性は未証明**。Secretの値やハッシュをPR/ログへ書かず、資格の発行主体・対象projectRef・権限を秘密値を出さない方法で検証する。
- `OWNER`/GitHub protected workflow、Cloudflareの独立Controller、Staging Supabaseサービス権限、Model API認証は分離。汎用の管理者資格やProductionと共通のSecretを勝手に転用しない。
- **生存しているRunnerの`finally`だけでは安全でない。** 強制kill/プロセス消失後も外部ControllerがStaging AIをOFF、予算0、合成JWT revoke、限定データ清掃、二重確認による残留0を独立して実行できることがGate A条件。
- モデルAPIの情報：2026-11-10時点の公開ドキュメントでは`gpt-5.6-luna`が存在し、標準・短いコンテキストの入力$0.20/100万token、出力$1.20/100万tokenと案内される。しかし**NOVELIGHTのProviderアカウントで利用可能か、料金モード・請求・為替・実効上限は未確認**。公式モデル: https://developers.openai.com/api/docs/models/gpt-5.6-luna / 料金: https://developers.openai.com/api/docs/pricing 。ユーザー資金の承認を得る直前に再確認し、補正・上限超過リスクがあればNO-GO。
- 想定外のHTTP失敗、署名期限切れ、承認comment不一致、異なるSHA、Preview不在、資格境界未証明、本人同意なし、価格不明、停止できない場合は**有料モデルに一度も送らずNO-GO**。外部呼出し後は成功/失敗不問で承認を消費し、二回目を実行しない。機密、本文、JWT、モデル出力をIssue/Actionsの証拠へ残さない。

## 4. 実証手順（複数項目をまとめてpreflight、外部操作は各承認で分離）

| 順序 | 実際に見る・実証するもの | 成果物／合格条件 | 別承認を要する操作 |
|---|---|---|---|
| 0 | 最新main、MASTER、Draft PR、既存PASS、Staging branch、Vercel Preview保護、Env名前のREAD、Supabaseの固定SELECTのみ | 正確なSHAと変更差分、Gate A〜Cの依存表。不明はNO-GO | 不要（現時点の範囲） |
| 1 | 候補SHA方式のOWNER判断、PRレビュー、最小権限・停止実行先・実費上限、料金見積 | SHA/対象ブランチ・認証境界・承認方式・費用・期限の確定。設計矛盾の解消 | 契約変更PRのmain統合は別の本番承認 |
| 2 | Gate A：外部独立監視を実配備、1回の合成Runner死亡に対し外部stop/revoke/cleanupと独立zero censusを確認 | Runner消失でも外部監視が止められる実証。DO/Worker/課金/トークン範囲の明示 | 外部コントローラの実配備・最小権限・DB/削除操作を対象別に明示承認 |
| 3 | Gate B：専用Staging Secretの隔離を証明、新Staging branchとProtected Preview作成 | exact candidate SHA、`dpl_...`、READY、SSO保護、Staging接続、Production非接続 | branch/Preview/環境変数はそれぞれ対象・回数・SHA固定のStaging承認 |
| 4 | Gate C：承認済みRunnerの起動元・6つの独立READ証拠、合成Auth/実JWT・同意・一回限りclaimの消費・停止能力 | owner-only、合成対象と一回限りの墓標、失敗時の後片付け/独立censusを確認 | Protected Workflow/Secret/合成JWT・Staging writeは操作ごとに承認 |
| 5 | Gate D：全A/B/C実証合格後、合成1作品・1話・1chunk・有料POST 1回のみ | 提出された候補/根拠、料金、使用済み承認、停止・清掃・zero census。失敗時も追加POSTなし | **実モデルと10円上限を指定した一度限りの別承認** |
| 6 | Gate E：誤読、出典根拠、作者の採否・保存・再表示、PIIと原価を評価 | 管理人限定試用の判断。一般公開はさらに別の承認 | 管理人限定試用・本番統合・公開はそれぞれ別承認 |

**承認のひな形として最低限必要**：操作種別、対象repository/projectRef、branch、確定commit SHA、Preview ID（存在する段階のみ）、実行者と資格の最小権限、処理件数/呼出し回数、上限費用・有効期限、対象合成ユーザー/作品/話（作成後のみ）、停止/失敗時動作、証拠保存先、何を**許可しない**か。未確定欄のある承認を起票しない。

## 5. 今回やってはいけないこと／完了判定

**この文書および更新する進捗ボードは実環境の操作指示ではない。** 今回の変更は文書のみで、既存の実行コードや古いPASS証拠は改変・再実行しない。実行権限を持つ新Watchdog、Runner、Secret配布レイヤー、CI/Workflowの有効化も行わない。

**今回の作業の完了条件**：既存アダプター・提供元・実環境で不足するもの・証拠と停止条件・SHA循環依存・承認順序を一箇所に固定し、Draft PRでレビュー可能にすること。Gate A〜Eは**0/5**のまま。外部で未実証の事項を成功と記載しない。

## 6. 2026-11-10 採用した候補SHA方式：オフラインコードの具体仕様

- 既存 `.github/staging-ai-02-07-05/preview-precreation-readonly.mjs` に **`scope.candidateSha`（省略可能）**を追加。`currentMain.sha === scope.mainSha`は引き続き必須。候補を指定した場合に限り、`stagingBranchHeadSha` と `existingPreview.sha` は **`candidateSha` に一致**させる。candidateShaとmainShaは同一不可。従来のmain専用モードは変更なし。
- 同一ファイルの `inspect020705CandidateStagingOffline` が **`ownerIntent`、`watchdogPlan`、`budget` の模擬メタデータ**を、repository、Staging project、base main SHA、candidate SHA、専用branch、Preview ID、承認comment ID、run IDで厳密に照合する。OWNER `bingohooah888-ai`、Issue #294、合成対象作品と話、失効時間は最大60分、1回限り・再試行禁止、10円相当上限 `capMicros <= 10000000`。停止計画には独立Host、stop/revoke、外部zero census、timeout停止をすべて必須とする。
- SHA・権限・費用のメタデータが一致していても **`ownerApprovalAuthenticated:false`、`independentStopVerified:false`、`billingEntitlementVerified:false`、`protectedRunnerWired:false`** のまま。`authorizesExecution`、`authorizesPaidCall`、`authorizesStagingWrite`、`authorizesPreviewCreation`、`authorizesMutation` は**すべて常にfalse**。外部Ownerの実承認・認証トランスポート・実署名・Secret分離・独立kill権限・Provider利用資格は本契約では証明できない。
- このオフライン検証を**既存 `protected-stage-executor.mjs` とライブ有料Workflowへ結線しない**。その既存コードは依然として `trustedRef=refs/heads/main` と `approved.mainSha` を要求し、候補SHAでの実有料実行は**未対応・NO-GO**。実資格・実JWT・実モデル・実監視へ接続するには、owner-paid ledger・signed watchdog scope・atomic one-shot claimを含む**正式な候補SHA版の権限契約を別のレビュー済み変更で一括整合**させる必要がある。現在の制約を抜くことで動かすのは禁止。
- **対象オフラインテスト**：base main ≠ candidate SHA、既存mainモード後方互換、branch/Previewずれ、共通Preview資格情報、OWNER/Issue/run/費用の不一致、独立停止条件欠落、Production/missing approvalsの拒否。Staging・DB・Secret・実Modelへの操作0件。Gate A〜Eは引き続き0/5。

次は、**本番基準SHAと候補SHAを区別したOwner台帳・外部Watchdog署名・one-shot claimを既存契約のままどう安全に接続するか**を、一回のレビュー対象としてオフラインでまとめて設計する。新しい資格・費用・実行トリガーの承認が必要になった時点で操作別に提示する。不要なガード増殖や過去PASSの再実行は禁止。
