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

## 7. 2026-11-10：候補SHA方式の既存権限契約への整合（オフラインのみ）

本節は§6の続き。新しいWatchdog・Runner・承認基盤を作らず、既存部品の候補SHA契約だけを拡張した。従来のmain限定モードは維持する。

| 部品 | 候補SHAモードでの追加条件 | 維持する境界 |
| --- | --- | --- |
| owner-paid-trial-ledger.mjs | OWNERコメント本文のcandidateSha、stagingBranch、repository、Issue #294、runId、mainSha、対象・費用・期限を厳格に検証。CLAIMEDにも候補SHA・branchを含める | 実GitHub承認コメントを作らない。失敗・中断後の再使用を拒否 |
| stage-readonly-proofs.mjs | mainの独立READ、信頼済みmain由来runner、候補checkout、候補SHAのPreview、独立したreadCandidateBranchを全て照合 | Protected runnerのmain trust ref、SSO・Staging資格・認証・費用証明を緩めない |
| independent-watchdog-arm.mjs / watchdog-arm-one-use.mjs | 署名receiptと永続的原子nonce消費のscopeへcandidateSha、stagingBranch、capMicrosを加える | 署名一致だけで実停止能力の証明とはしない |
| protected-stage-executor.mjs | trustedRefは引き続きrefs/heads/main、trustedShaはmainSha。candidateCheckoutShaは候補SHA、stagingBranchは承認ブランチと一致必須 | PR由来Workflowへ権限を移さない。既存6証明の前にclaimしない |
| paid-trial-one-shot-provider.js | Previewのsha/branchを候補に一致。既存原子RPCのp_main_shaには試験対象のcandidateShaを渡す | DB migration/RLS・一回限りclaim・10円上限・再試行禁止は不変更 |

### 技術上の注意

- 既存DB列 main_sha は歴史的名称であり、候補方式の一回限りclaimでは「試験対象SHA」を記録する。基準main SHAはOWNER台帳・Watchdog・Runnerに別途固定して照合する。approval_comment_idの一意制約による二重使用防止は維持する。
- 既存GitHub Workflow ai-020705-owner-staging-paid-trial.yml は引き続きOFFLINE PREFLIGHT ONLY。保護Runnerの実アダプターは結線せず、Secrets、外部Controller、実JWT、実DB、Preview、モデル、課金に触れていない。
- **信頼済み制御コードの本番基準への配置は未解決。** 現時点の契約変更はDraft PR内のため、mainの信頼済みrunnerへ自動反映されない。作品カルテをmainへ先行統合しないまま実環境試験するには、制御面のみを分離・審査・承認して信頼済み経路へ配置する手段（または同等の承認済み独立runner方式）が必要。PR由来の非信頼Workflowに機密を渡して解決してはいけない。
- Watchdog実kill/revoke/cleanup権限、永続原子nonce、実OWNER本人確認、Staging Secret隔離、実JWT、請求・価格と円換算は未証明。ひとつでも未確認ならNO-GO。
- 既存main限定局所オフラインテスト43/43 PASS、新規候補契約テスト5/5 PASS。最終GitHub CI/CodeQLはPR更新後に確認。正式Gate A〜Eは引き続き0/5。

## 8. 2026-11-10：信頼済み制御面の分離・Gate A〜C接続前の最新READ-ONLY判断

本節は前回の候補SHA契約を再実装せず、**どのコードに権限を与えるか**と**実環境の未確認事項**を固定する。2026-11-10 JST の観測基準は main `95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3`、PR #2825 観測HEAD `96515f16b81f47e952e864e0162fc32115eb0b30`（Draft・未統合）、MASTER blob `e2501f9ed0722964e76fd0a49bf200717850b81d`。これらのSHAは**今回の調査スナップショットであり、OWNERの実行承認や固定済み候補SHAではない**。この文書の更新によってPR HEADは再度変わり得る。

### 8.1 実物の制御境界と解決案

- **確認した事実**：main に存在する `ai-020705-owner-staging-paid-trial.yml` は `OFFLINE preflight only`。main checkout、GitHub issue READ、局所テスト、オフライン承認判定のみで、Staging protected environmentの実実行job、独立停止Controllerの接続、DB claim、課金Provider、Preview作成は実装・起動しない。一方、候補SHAに対応した Owner台帳・署名Watchdog・保護Runnerのコードは現時点ではDraft PR側にしか存在しない。
- **推奨する最小構成**：信頼境界を「制御面（OWNER承認、GitHub API観測、署名検証、永続原子nonce、停止指令、費用監視）」と「検証対象（作品カルテUI/API、合成作品、StagingのPreview）」に分離。制御面は**審査済み・保護されたmain由来のコード**のみで動かす。PR候補のSHAはデータとして読み取り、承認対象の候補ブランチ・commit tree・Previewを独立に照合する。**PR由来のworkflow/NodeコードをSecrets付き制御jobで直接実行しない**。
- **制御面コードの配置**：将来必要になった場合に限り、候補対応済みの制御部分を作品カルテ機能と分離した**制御面専用の小さな審査PR**に抽出する。保護されたmainへ統合する際はProduction自動デプロイの可能性も明示し、対象PR専用の**別の本番承認**が必須。今回は別PR作成・main統合とも行わない。外部専用repo/Runnerで代替する案は、権限境界を守れるが新規運用の負担が大きいため現段階では採用しない。
- **実行分離**：信頼済み制御jobと候補ソースのbuild/アプリ実行を分離し、候補コードのpackage script・PR workflow・任意のインストールフックにOWNER/Controller/Production資格を渡さない。候補ソースを処理する場所はStaging専用・合成データ限定・最小権限とし、承認した**commit SHAそのもの**を独立取得して、ブランチHEAD・Preview SHA・Owner承認・署名済み停止スコープと照合する。実JWT/DB/有料POSTに必要なStaging限定資格は、その操作の別承認まで注入しない。
- **既存システムを再利用**：既存Owner ledger、独立Watchdog署名、one-use claim、protected runner、read-only proof、cleanupを再実装しない。現在のオフライン契約は実権限の代わりにならない。main限定旧動作を緩めず、候補SHAモードのみ厳密に追加する。

### 8.2 読み取り専用で確認した外部状態と未解決事項

| 領域 | 実観測（2026-11-10） | 判定・次に必要な証拠 |
| --- | --- | --- |
| GitHub | mainは上記SHA、PR #2825はDraft/未統合。既存Staging branch `staging/ai-02-07-05-gatebc-20261105` HEAD `0e4f3f594193d137d582fb693703ffdfe1d1cfd3` | 当該branchは候補SHAと一致しない。今はbranch更新・新設不可。別のStaging承認後にのみ、exact candidate SHAに結び付いたbranchを用意 |
| GitHub保護Workflow | mainの既存WorkflowはOFFLINEのみ。Issue #294 のOwner paid ledgerとPreview/Staging作成のOwner承認は**異なる操作** | 実OwnerコメントのGitHub API真正性、制御jobの保護環境・承認者・権限・single concurrencyを未証明。一般的な `workflow_dispatch` 引数やbooleanで承認を代替しない。Preview/Staging承認は既存の専用経路（Issue #188等）を別途使用 |
| Vercel | project `novelrise`、SSO Protection設定はenabled（`all_except_custom_domains`）。指定旧Staging branchと上記候補SHAでのdeployment一覧は各0件 | 実候補Preview `dpl_`・READY・当該URLのSSO有効・Production非接続は未証明。新規Previewは別のStaging承認まで作成禁止 |
| Vercel Env | 旧Staging branchにスコープ固定された必須9キーのうち6キー名を確認。未確認は `SUPABASE_SECRET_KEY`、`SUPABASE_PUBLISHABLE_KEY`、`NOVELIGHT_STAGING_SUPABASE_PUBLISHABLE_KEY` | 共通Preview/他branch用キーは代用不可。今回の確認は**decrypt=false・値を取得しないメタデータ**だけ。対象branch専用の資格・実Staging projectRef・最小権限を独立して証明するまでNO-GO |
| Supabase | Production projectRef `fiepaguycecrredwrcwx` に対するbranch一覧に Staging `wmlzjgvxgoyrovdhbqbg` が存在。branchのstatusは `MIGRATIONS_FAILED`（updated_atは2026-08-25）、preview_project_statusは `ACTIVE_HEALTHY`。Staging project個別詳細取得は `NotFound` | branch statusは更新時刻が古く、現時点のDB失敗を断定しない。一方、個別Project APIの不可視性も解消していない。接続先と権限の可視範囲・環境独立性を整理 |
| Supabase Migration | Staging projectRefの `list_migrations` READは成功し215件を返した。既存one-shot claim版 `20261101060000` が履歴に含まれる | 「Staging全面アクセス不可」とは判断しない。ただし履歴の存在だけでテーブル/RLS/RPCの実権限、budget=0、合成JWT実行可を証明しない。実操作前に許可された最小のREADで別確認 |
| Gate A | 既存合成結果とDO3件の凍結は従前のとおり。今回外部Controllerの停止操作なし | Runner消失時でも別host/権限がkill、AI OFF、JWT revoke、合成データcleanup、zero censusを完遂できる実証を別承認後に限定実施 |
| Gate C/D | 候補SHAの局所契約は前回PASS、Workflow未接続。Provider利用資格・為替・最悪費用の実証なし | 本人承認・原子的consumption・価格上限・同意・停止条件が全て実観測できるまでは実JWT・DB claim・モデルPOST禁止。Dの10円以内1回はA〜C合格後の別承認 |

### 8.3 依存の順番を固定（無用な安全機構・承認の増殖を禁止）

1. **今回**：上記の設計とメタデータ観測をPR内に確定。既存のオフラインPASSは再実行しない。候補の新しいcommitはまだ実行対象として承認しない。
2. **制御面のレビュー判断**：mainの信頼済み実行経路へ「制御面だけ」を置く小PRの差分・依存・Production影響を先に審査。これ自体の統合・workflowの有効化は別承認。制御面にPR由来の実行コードやProduction Secretを混入させない。
3. **Gate A/Bの実接続**：独立Watchdogの停止能力、Staging branch/Secretの完全分離、Vercel protected Previewのexact SHA、Supabaseの実接続を**操作ごとのStaging/外部Controller承認**で実証。A/BのREAD棚卸しは並行可、実mutationは各承認まで停止。
4. **Gate C以降**：独立証拠が揃った後にだけ、本人の合成JWT、既存原子one-shot claim、停止/cleanup/独立censusを一回限りの承認で検証。Gate Dの有料POST、Eの品質/管理人限定試用はさらに別承認。

**結論**：現時点では候補SHAのオフライン契約整合まで完了し、**信頼済み制御面の配置・実資格と停止・Previewの実証は未完了**。Gate A〜Eは**0/5**。本節作成は実操作の承認、請求、DB mutation、公開の許可にならない。

## 9. 2026-11-10：保護制御コードだけの分離準備（オフライン実装）

- **原因**：保護Runnerの `protected-stage-executor.mjs` と `paid-trial-cleanup-runner.mjs` が `../../api/_lib/ai/paid-trial-one-shot-provider.js` を直接importしていた。制御jobへ作品カルテ/APIコードを持ち込む依存が残り、候補ソースをSecrets付き信頼済みjobから隔離できなかった。
- **最小差分**：上記Providerの実装本体を**変更なしで** `.github/staging-ai-02-07-05/paid-trial-one-shot-provider.mjs` へ移し、保護Runnerの2つのimportを同じ制御フォルダ内へ変更。既存API側の旧公開経路は3つの関数を同一モジュールから再exportするだけの互換shimとした。WeakMapの一回限りガード／scope比較の**同一インスタンス**を使用し、二重実装・二重claimを作らない。JWT・DB・有料Providerへの実接続は行わない。
- **信頼境界の局所試験**：既存の候補SHA契約試験に、全 `.github/staging-ai-02-07-05/*.mjs` の静的importが同じ制御フォルダかNode内蔵のみであること、dynamic import / requireが存在しないこと、制御ProviderとAPI互換exportの関数identityが一致すること、DB claim実装が制御側の一箇所にしかないことを追加。既存Owner ledger / signed Watchdog / protected Runner / Provider契約を再利用する。これらは**静的構造とオフライン動作のみの証拠**で、保護branchへの配置や外部権限の証明ではない。
- **将来の制御面専用PRに切り出す単位**：上記制御フォルダ内の候補SHA対応差分（Owner ledger、署名Watchdog、one-use、read-only proofs、protected executorとその同フォルダ依存、guarded Provider）をレビュー済みの**最小依存閉包**として抽出する。API互換shim・作者UI・Novel Bible機能・Previewアプリ本体は抽出PRへ混ぜない。抽出範囲を固定した後、main/Productionへの影響を確認して**別の本番承認**を得る。現在のDraft PR #2825自体は未統合のまま維持する。
- **明確に未実装・未実証**：保護実行Workflowの実接続、GitHub Owner承認の真正性、永続atomic nonce、独立Watchdogの実停止/cleanup、Staging資格・Previewの候補SHA一致、実JWT/DBと費用上限。既存 `ai-020705-owner-staging-paid-trial.yml` は引き続き `OFFLINE PREFLIGHT ONLY`。Gate A〜E **0/5**。このPR更新でPreview/環境/DB/Secret/課金を動かさない。

## 10. 2026-11-10：独立Draft PR #2835 と #2825 の統合前オフライン監査

- **監査基準**：main `95f9ddff7fb882ae4f3edaa89ef77ec79d52bcf3`、MASTER blob `e2501f9ed0722964e76fd0a49bf200717850b81d`、制御面Draft PR #2835 HEAD `7532748cf79537a0d5d33cd7667b533a14880791`、作品カルテDraft PR #2825 監査開始HEAD `b941ea2727136f8a713d1c918916cfcd7f353d16`。双方Draft・未統合。実承認・live操作なし。
- **選定順序**：① #2835の制御面だけを別途OWNER本番承認後mainへ統合し、②更新後mainに対し #2825 を再同期、差分・Node/CI/CodeQL・Production影響を再審査し、③ #2825自身の別途OWNER本番承認後に限り統合。**#2835の承認は#2825の承認ではない。** 旧main向け承認を新main SHAの審査へ流用しない。
- **競合の実測**：mainを起点とする完全隔離のローカルworktreeに #2835→#2825 を通常のローカルmergeで適用。制御モジュール本体は競合0。競合は `docs/NOVELIGHT-AI-PHASE2-CURRENT-WORKBOARD.md` と `tests/ai-020705-candidate-runtime-contract-offline.test.mjs` の2件のみ。前者は双方の経緯・source_mainを保つ統合解消、後者は**完成形のAPI互換shimと制御Providerの同一性を検証する #2825版テスト**を優先。隔離worktreeで仮解消した統合結果の対象テスト **96/96 PASS**。仮解消はローカルだけで、PRやmainへcommit/pushしていない。実際のmain統合方式（squash/merge/rebase）で結果が変わるため、#2835統合後の新main上で改めて解消し再試験する。
- **WeakMapの段階的互換性**：#2835単独では既存 `api/_lib/ai/paid-trial-one-shot-provider.js` と制御側 `.github/staging-ai-02-07-05/paid-trial-one-shot-provider.mjs` が別実装・別WeakMap。旧API生成のguarded Providerを新Runnerに渡すと**fail closed**であり、無理にidentity制約を緩和しない。#2825にはAPI経路の**同じ制御Provider関数の再exportだけを行うshim**があり、両者が揃った仮統合後の同一関数identity・guarded契約試験がPASS。#2835単独main配置はlive連携・有料AIの実行許可ではない。
- **Production既存機能への影響と限界**：#2835の差分は `.github/staging-ai-02-07-05/`、対応オフラインテスト、継続ボードに限られ、API・UI・Workflow・DBに変更なし。mainへの統合自体はVercel Productionの自動デプロイ対象（`vercel.json` のmain有効設定）なので、別の本番承認を要する。#2825では作者向けNovel BibleのUI/内部API/オフライン導線が変更される。既存Workflowは `OFFLINE PREFLIGHT ONLY`。 `.vercelignore` は関連する `.github` モジュールを明示除外しておらず、Nodeの静的importはオフライン解決するが、Vercel実際の関数バンドルとProduction稼働の成功は**未実証**。公開・有料AI利用を自動許可しない。
- **承認前の必須確認**：#2835の最新SHA、main/MASTER、CI/CodeQL、Draft差分、Production自動デプロイ影響を再照合してから**#2835に限った**本番承認。#2825は #2835のmain統合後に新しいmainを確認し、上記2ファイルの差分・統合順序を再解消。最新版SHAで対象テストとCI/CodeQLを再確認し、#2825に限る別の本番承認を得る。Staging、Preview、実JWT、実DB、Secret、独立Watchdog実稼働、有料AIはさらに個別承認が必要。**Gate A〜E 0/5**。
