# NOVELIGHT Staging Runbook

## 目的

Stagingは、本番を直接テスト環境として使わず、β公開前の変更を安全に検証するための中間ゲートとする。

NOVELIGHTでは「壊れない」だけでなく「壊れても戻せる」ことを重視するため、Preview/Stagingで再現できる検証を本番で初めて試さない。

## 現在の安全境界

現時点のHTMLはSupabase接続先を静的に保持しているため、Vercel Previewだけを作成してもブラウザ側まで自動的に独立Stagingへ切り替わるわけではない。

通常の自動Staging smokeはread-onlyを維持し、`STAGING_E2E_READY=true` のwrite smokeだけが独立Staging Supabase / Stripe test modeを使用する。write smokeは依存関係のinstallやfixture作成より前に、実際に配備されたPreviewの公開可能な環境factsをGitHub側のStaging期待値と照合し、Production混入や設定driftをfail closedで拒否する。

- 公開ページの配備確認
- Previewが対象commitと一致することの確認
- 安全なGET API契約の確認
- 読者導線の表示確認
- 計測系RPCの書き込み抑止
- RESTテーブルへの非GETリクエスト遮断
- 本番ホスト `novelrise.vercel.app` の拒否
- write smokeでは本番Supabase project / Stripe live mode /異なるpublishable keyの拒否
- write smokeでは既存Staging server credentialを使い、対象変更が必要とするCheckout RPCが実際のStaging schemaへ公開されていることを呼び出しなしで確認

認証ユーザー作成、作品投稿、お気に入り、LIGHT SEED、Stripe Checkout等の書き込みを伴うStaging E2Eは、独立したStaging SupabaseとStripe test modeが接続され、`STAGING_E2E_READY=true` にした場合だけ実行する。

## Production / Staging 設定のSingle Source

秘密値そのものはこの文書へ記録しない。ここでは「どこを正本とするか」「別システムへ複製が必要な場合に何が同期または検証するか」だけを定義する。

| 設定クラス | Productionの正本 / 同期 | Stagingの正本 / 同期・検証 |
| --- | --- | --- |
| アプリURL / deployment | Vercel Productionとcanonical `NOVELIGHT_APP_URL`。Production bootstrapが対象hostを検証する | 通常実行はVercel `deployment_status` が返す実Preview URLが対象。手動時だけGitHub Repository Variable `STAGING_BASE_URL`をfallback候補にできるが、必ず明示したcommit SHAと照合する。PreviewのStripe戻り先は`VERCEL_URL`から自動導出し、deploymentごとの`NOVELIGHT_APP_URL`重複入力を不要にする |
| Supabase project URL | approval-scoped GitHub Production値をProduction bootstrapがVercelへ同期し、機能証明する | GitHub Repository Variable `STAGING_SUPABASE_URL`が期待値の正本。Vercel Preview `SUPABASE_URL`は同じprojectを指し、write前に`staging-environment-facts`経由でexact matchを検証する |
| Supabase schema / migration | `supabase/migrations/*.sql`とProduction migration historyをProduction deploy gateで比較する | `supabase/migrations/*.sql`を望ましいschemaの正本とする。通常のwrite smokeは`verify-staging-schema-capabilities.mjs`で必要なCheckout RPCを既存Staging server credentialから`OPTIONS`確認し、RPC本体を実行せずschema capabilityを証明する。migrationを含むmain pushのProduction migration planでは、承認handoff前に`verify-staging-migration-parity.mjs`でStaging migration historyとの完全一致も別途read-only確認する |
| Supabase browser key | Vercel Production runtime | GitHub `staging` Environment Secret `STAGING_SUPABASE_PUBLISHABLE_KEY`がE2E期待値。Vercel Preview `SUPABASE_PUBLISHABLE_KEY`との一致は値をログへ出さずSHA-256 fingerprintで検証する |
| Supabase server secret | approval-scoped Production credentialをbootstrapがVercelへ同期 | GitHub `staging` Environment Secretはfixtureとschema capability proof用、Vercel Preview secretはServerless用。公開APIは存在booleanだけを返し、最終的な同一project/権限の成立はschema capability proofとauthenticated E2Eのsemantic proofで確認する |
| Stripe credentials / Price | Stripe live resourcesが正本。Production bootstrapがVercelへ同期しno-live-charge control proofまで同一承認内で行う | Vercel PreviewはStripe test resourcesのみ。公開factsでsecret key modeが`test`、必要Priceが存在することを先行検査し、billing smokeの`cs_test_` Checkoutとsubscription lifecycleを最終semantic proofとする |
| Deployment Protection bypass | Vercelで生成したautomation bypass secret | GitHub Repository Actions Secret `VERCEL_AUTOMATION_BYPASS_SECRET`へ複製。値そのものは比較・出力せず、保護Previewへheaderで到達できることがfunctional verificationになる |
| write gate | Productionは各approval workflowのgate | GitHub Repository Variable `STAGING_E2E_READY`。独立Stagingが完成するまで未設定または`false`。Variableの存在だけを成功証拠にしない |

設定値がGitHubとVercelの両方に必要な場合、名前の存在だけでは完了扱いにしない。exact match可能な公開情報は機械比較し、secretそのものを公開比較できないものはmode/class検査とend-to-end functional proofで成立を確認する。

## 統合Staging workflow contract

現行のStaging検証は `.github/workflows/staging-smoke.yml` をSingle Sourceとする。旧来のreadiness / authenticated / billingの別Workflowへ分割せず、1本のWorkflow内で安全境界を段階的に引き上げる。

1. `scripts/verify-staging-deployment.mjs` によるread-only deployment contract
2. Desktop / Mobile read-only Playwright smoke
3. `STAGING_E2E_READY=true` の場合のみwrite-capable environment contract
4. `scripts/verify-staging-schema-capabilities.mjs` による必要Checkout RPCのread-only capability確認
5. Desktop authenticated smokeを専用ephemeral fixtureで実行してcleanup
6. Mobile authenticated smokeを新しい専用ephemeral fixtureで実行してcleanup
7. Desktop / Mobile双方の成功をaggregate確認
8. freshなbilling fixtureでStripe test billing smokeを実行してcleanup

通常実行では、成功した非Production `deployment_status` の `environment_url` を対象とし、存在しない場合だけ同じdeploymentの `target_url` を使う。候補URLが存在するのに不正だった場合、別branchや古い固定URLへsilent fallbackしない。

手動実行は `staging_url` を明示するか、GitHub Repository Variable `STAGING_BASE_URL` を使用できる。ただしどちらの場合も `revision` にexact 40-character commit SHAを指定し、配備側のSHAと一致しなければ実行しない。

共通deployment verifierはpackage install、browser起動、fixture作成より前に以下を確認する。

1. 対象がHTTPSの非Production `*.vercel.app` deploymentである。
2. `/api/staging-environment-facts` が対象commit SHAを返す。
3. `VERCEL_ENV=preview` である。
4. Previewの実効app base URLが検証対象deployment URLと一致する。
5. write smokeではSupabase URL、publishable key fingerprint、server secret存在、Stripe test mode、必要Price存在を確認する。

revisionがまだ一致しない場合だけ短いbounded retryを行う。設定driftを検出した場合は再試行せず `CONFIG_DRIFT` として即時failする。revisionが時間内に一致しない場合は `DEPLOYMENT_NOT_CONVERGED` としてfailする。

`api/staging-environment-facts.js` はPreviewでのみ利用でき、秘密値を返さない。Supabase URL、browser keyのclass/fingerprint、server secretの存在boolean、Stripe keyのmode class、Price存在boolean、Vercel環境、commit SHA、実効app base URLだけを返す。Vercel Productionでは404にする。

## Staging schema capability gate

`STAGING_E2E_READY=true` のwrite smokeでは、環境変数が正しいことだけでDB schemaが正しいとは扱わない。`scripts/verify-staging-schema-capabilities.mjs` が、今回のCheckout concurrency保護に必要な以下のRPCについて、実際のStaging PostgREST endpointへ到達できることをfixture作成前に確認する。

- `novelight_reserve_checkout_attempt`
- `novelight_attach_checkout_session`
- `novelight_release_checkout_attempt`

確認には既存のStaging server credentialを使用し、各 `/rest/v1/rpc/<function>` endpointへ `OPTIONS` だけを送る。RPC本体をPOST実行せず、`Allow` に `POST` が含まれることを要求する。Production Supabase project refを検出した場合は即時拒否し、credentialそのものはログへ出さない。

このgateは、Staging smokeへ新しいManagement API Secretを要求せず、「Checkout APIが500になって初めてRPC不足を推測する」状態を防ぐための早期capability proofである。必要RPCが存在しない、対象RPCがPOST可能として公開されていない、Staging server credentialが使えない、またはProduction projectを指している場合は `SCHEMA_DRIFT` としてfail closedする。

一方、14桁migration version集合の完全一致は、migrationを含むmain pushに対するProduction migration planで `scripts/verify-staging-migration-parity.mjs` を実行して別途確認する。こちらはSupabase Management APIのread-only queryを使用し、Production chat-approval handoffより前にStaging migration historyがrepositoryと完全一致していることを要求する。

### migrationを含む変更の昇格順序

migrationを含む変更では次の順序を維持する。

1. migration / precheck / postcheck / rollbackと関連コードをCIで検証する。
2. 専用Stagingへ対象migrationを正式な再現可能手順で同期する。
3. Staging schema capability gateをPASSさせる。
4. authenticated / billing Staging smokeをPASSさせる。
5. Production migration planでProduction pending一致とdry-runを行う。
6. Production migration planはStaging migration historyの完全一致をread-onlyで確認し、PASSした場合だけchat-approval handoffを出す。
7. freshなProduction承認後もProduction境界のpending一致とdry-runを再確認してから適用する。

Production migration plan側のStaging exact parity再確認は、安全に意味がある重複確認なので削除しない。Staging同期そのものはProduction deploy workflowへ混在させず、Production mutationと別の非Production操作として扱う。

## 自動Read-only smoke

Workflow: `.github/workflows/staging-smoke.yml`

Playwright config: `tests/e2e/playwright.staging.config.mjs`

Test suite: `tests/e2e/staging/read-only-smoke.spec.js`

### Vercel Previewからの自動実行

GitHubへ成功した非Production deployment statusが届いた場合、Workflowはそのdeployment URLを取得してread-only smokeを実行する。

最初に共通Staging deployment contractでVercel Git commit SHAと検証対象revisionを照合し、別revisionや古いPreviewを誤って検証しない。HTML本文のbyte-for-byte比較は、配信時の変換やDeployment Protectionの中間ページによって正しいdeploymentでも不一致になり得るためrevision判定には使用しない。

Vercel Project Settingsでは **Automatically expose System Environment Variables** を有効にし、Serverless APIから `VERCEL_GIT_COMMIT_SHA` と `VERCEL_URL` を取得できる状態を維持する。取得できない場合は安全側に倒してStaging smokeを失敗させる。

### Vercel Deployment Protection

Preview Deployment Protectionを有効にしたまま自動テストする場合は、Vercelの **Protection Bypass for Automation** を使用する。

Vercel Project Settings > Deployment Protection でautomation bypass secretを作成し、同じ値をGitHub Repository Actions Secretとして以下の名前で登録する。

- `VERCEL_AUTOMATION_BYPASS_SECRET`

このSecretはURL、ログ、HTML、クライアントコードへ埋め込まない。GitHub ActionsのHTTP requestとPlaywrightが `x-vercel-protection-bypass` request headerとしてのみ送信する。

Vercel側のbypass secretを変更・再生成・失効した場合は、GitHub側Secretも同じ値へ同期する。

### Stripe Webhookと保護Preview

Stripe等の外部サービスは、GitHub ActionsやPlaywrightのように `x-vercel-protection-bypass` headerを付与できない。そのためVercel Deployment Protectionで保護されたPreviewへStripe Webhookを直接配送することは、通常のStaging Billing Smokeの前提にしない。

`VERCEL_AUTOMATION_BYPASS_SECRET` をWebhook URLのquery parameterや共有URLへ埋め込んで回避しない。

保護Previewでの課金統合確認では `api/staging-billing-reconcile.js` を使用する。このAPIは実際のStripe test mode Checkout / Customer Portal操作後に、Stripe上のsubscription状態をStaging Supabaseへ再同期し、Webhook内部処理と同じ `syncCustomerSubscription` を通してentitlementを検証する。

このAPIは以下をすべて満たさない限りfail closedする。

- `VERCEL_ENV=preview`
- `STRIPE_SECRET_KEY` が `sk_test_` で始まる
- `SUPABASE_URL` がHTTPSのSupabase projectで、本番project `fiepaguycecrredwrcwx` ではない
- 有効なBearer tokenでStagingユーザー本人を認証できる
- 初回同期時は `cs_test_` Checkout Sessionがその本人に属する

この再同期がPASSしても、Stripe外部ネットワークからVercel Webhook endpointへ実際に配送された証拠とは扱わない。Productionは公開Webhook endpointを使用するため、本番公開前のハードゲートとして外部Webhook配送、署名検証、Supabase entitlement反映、event historyを別途確認する。

### 手動実行

統合Staging Workflowの `workflow_dispatch` では、必要ならHTTPSのPreview/Staging URLを指定し、必ずそのdeploymentのexact 40-character `revision` を指定する。URLを省略した場合だけRepository Variable `STAGING_BASE_URL` を使う。

ローカルread-only testは `tests/e2e/` で以下を使用する。

```bash
STAGING_BASE_URL=https://<preview-host> npm run test:staging
```

Deployment Protection対象へローカル実行する場合は `VERCEL_AUTOMATION_BYPASS_SECRET` も安全なローカル環境変数として渡す。本番URLを指定した場合は拒否する。

## 失敗時の証拠

Staging Playwright失敗時はtrace、screenshot、video、HTML report、browser console/page error、failed request等をGitHub Actions artifactへ保存する。

まず `CONFIG_DRIFT` / `SCHEMA_DRIFT` / `DEPLOYMENT_NOT_CONVERGED` 等の早期分類を確認し、package installやブラウザ再実行だけを繰り返して原因を隠さない。

Authenticated Staging smokeはDesktopとMobileで同じFree作者を共有しない。Desktop専用fixtureを作成・実行・cleanupした後、Mobile用にfresh fixtureを再作成する。Desktopの途中failureで作品が残ってもMobileのFree 1作品制限へ連鎖させず、一次障害と二次障害を分離する。

## 独立Stagingへ移行する条件

書き込みE2Eを有効化する前に、以下をすべて満たす。

1. Staging専用Supabase projectを用意する。
2. Staging専用のpublishable key / server-side secretを使う。
3. 本番Supabase project ID、service-role/secret keyをStagingに渡さない。
4. Staging側へ本番と同じmigrationを再現可能な手順で適用し、必要schema capabilityを機械確認する。migrationを含むmain昇格時はProduction migration planでもStaging migration historyの完全一致を確認する。
5. Stripeはtest modeのみを使用する。
6. Staging専用Price、Checkout設定を使用する。
7. GitHub `staging` EnvironmentへStaging専用Secretsだけを登録する。
8. Vercel Preview scopeへStaging server runtime設定を置き、共通verifierでGitHub期待値との一致/classを証明する。
9. E2E用ユーザー・作品・お気に入り・LIGHT SEED等を毎回生成し、cleanup stepで削除する。
10. production host / production project / live Stripeを検出した場合はfail closedする。

### Authenticated / Billing smokeの設定場所

非機密の期待値はGitHub Repository Actions Variablesへ置く。

- `STAGING_E2E_READY`
- `STAGING_BASE_URL`（手動実行のcanonical fallback。通常のdeployment_status実行では使用しない）
- `STAGING_SUPABASE_URL`

秘密値はGitHub `staging` Environment Secretsへ置く。

- `STAGING_SUPABASE_SECRET_KEY`
- `STAGING_SUPABASE_PUBLISHABLE_KEY`

通常のStaging schema capability proofは既存の `STAGING_SUPABASE_SECRET_KEY` を使用し、追加のSupabase Management API SecretをStaging Environmentへ要求しない。migrationを含むmain push時のexact history parityはProduction migration plan側の既存Management API境界でread-only確認する。

Vercel Deployment Protection用の `VERCEL_AUTOMATION_BYPASS_SECRET` はread-only smokeでも利用するため、GitHub Repository Actions Secretとして管理する。

`STAGING_E2E_READY` は独立Stagingが完成するまで未設定または `false` のまま維持する。ほかの値が未完成の状態で先に `true` にしない。

Vercel Preview側のServerless runtimeでは少なくとも以下をStaging/Test用に設定し、本番値を流用しない。

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_STANDARD_PRICE_ID`
- `STRIPE_PREMIUM_PRICE_ID`
- 必要に応じて `STRIPE_PORTAL_CONFIGURATION_ID`

PreviewのCheckout / Customer Portalの戻り先は `VERCEL_URL` から自動解決するため、deploymentごとに `NOVELIGHT_APP_URL` を複製しない。Productionでは引き続きcanonical `NOVELIGHT_APP_URL` を使う。

ブラウザ側HTMLは現時点で本番Supabase URL/keyを静的保持している。そのためAuthenticated smokeではPlaywrightがページスクリプト実行前にStaging Supabase URL / publishable keyを注入し、ブラウザの `supabase.createClient()` をStagingへ差し替える。

この差し替えはAuthenticated smokeのBrowserContext内だけで有効であり、通常ユーザーがPreviewを開いた場合のアプリ設定を書き換えるものではない。したがって、独立した通常Staging UIが完成するまでは、手動Preview操作を安全な書き込み環境とみなさない。

次のarchitecture stepは、散在するブラウザ側Supabase初期化を共通bootstrapへ移し、deployed Preview自身がStaging publishable configurationを読むようにすることである。これは多数ページの初期化順と失敗UIへ影響する横断変更なので、本P0の環境契約変更とは分離する。

## 独立Staging完成後の書き込みE2E

以下を順番に自動化する。

1. Staging schema capability確認
2. Desktop用テストユーザー作成
3. Desktopでログイン、作品作成、第1話公開、別読者閲覧、お気に入り、LIGHT SEED、SCOUT RECORD、LIGHT ANALYTICS、Stripe test Checkout確認
4. Desktop fixture cleanup
5. Mobile用freshテストユーザー作成
6. Mobileで同じbeta-critical product flowを確認
7. Mobile fixture cleanup
8. fresh billing fixture作成
9. Stripe test modeの完全billing lifecycle確認
10. billing fixture cleanup
11. migration postcheck / rollbackの非本番確認

## Go / No-Go

Stagingを通過しただけで本番変更を自動承認しない。

本番反映前には少なくとも以下を確認する。

- CIの最終 `check` が成功
- Staging schema capability gateが成功
- migrationを含むmain昇格ではProduction migration planのStaging exact migration parityが成功
- Staging smoke成功または、write Stagingがまだsafe-disabledの場合はその理由が明確
- 高リスク変更では独立レビュー完了
- DB変更ではprecheck / postcheck / rollbackが確認済み
- 本番用SecretsとStaging用Secretsが混在していない
- 復旧手段がある

migrationを含むmain pushでは、Production migration plan自身がStaging exact parityを再確認する。Stagingがcurrent repositoryと一致しない間は、Production chat-approval handoffをREADYとして扱わない。

本番DB変更、高リスクmain merge、production write smoke等は既存の承認ポイントを維持する。
