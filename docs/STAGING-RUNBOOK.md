# NOVELIGHT Staging Runbook

## 目的

Stagingは、本番を直接テスト環境として使わず、β公開前の変更を安全に検証するための中間ゲートとする。

NOVELIGHTでは「壊れない」だけでなく「壊れても戻せる」ことを重視するため、Preview/Stagingで再現できる検証を本番で初めて試さない。

## 現在の安全境界

現時点のHTMLはSupabase接続先を静的に保持しているため、Vercel Previewだけを作成してもバックエンドまで自動的に独立Stagingへ切り替わるわけではない。

そのため、通常の自動Staging smokeは **read-only** とする。

- 公開ページの配備確認
- Previewが対象commitと一致することの確認
- 安全なGET API契約の確認
- 読者導線の表示確認
- 計測系RPCの書き込み抑止
- RESTテーブルへの非GETリクエスト遮断
- 本番ホスト `novelrise.vercel.app` をStaging設定から明示的に拒否

認証ユーザー作成、作品投稿、お気に入り、LIGHT SEED、Stripe Checkout等の書き込みを伴うStaging E2Eは、独立したStaging SupabaseとStripe test modeが接続されるまで自動実行しない。

## 自動Read-only smoke

Workflow: `.github/workflows/staging-readiness-smoke.yml`

Playwright config: `tests/e2e/playwright.staging.config.mjs`

Test suite: `tests/e2e/staging/read-only-smoke.spec.js`

Revision endpoint: `api/deployment-revision.js`

### Vercel Previewからの自動実行

GitHubへ成功した非Production deployment statusが届いた場合、WorkflowはPreview URLを取得してread-only smokeを実行する。

最初に `/api/deployment-revision` が返すVercel Git commit SHAと、GitHub Workflowが検証対象としているrevisionを照合し、別revisionや古いPreviewを誤って検証しない。HTML本文のbyte-for-byte比較は、配信時の変換やDeployment Protectionの中間ページによって正しいdeploymentでも不一致になり得るためrevision判定には使用しない。

Vercel Project Settingsでは **Automatically expose System Environment Variables** を有効にし、Serverless APIから `VERCEL_GIT_COMMIT_SHA` を取得できる状態を維持する。revisionを取得できない場合は安全側に倒してStaging smokeを失敗させる。

### Vercel Deployment Protection

Preview Deployment Protectionを有効にしたまま自動テストする場合は、Vercelの **Protection Bypass for Automation** を使用する。

Vercel Project Settings > Deployment Protection でautomation bypass secretを作成し、同じ値をGitHub Repository Actions Secretとして以下の名前で登録する。

- `VERCEL_AUTOMATION_BYPASS_SECRET`

このSecretはURL、ログ、HTML、クライアントコードへ埋め込まない。GitHub ActionsのcurlとPlaywrightが `x-vercel-protection-bypass` request headerとしてのみ送信する。

Vercel側のbypass secretを変更・再生成・失効した場合は、GitHub側Secretも同じ値へ同期する。

`/api/deployment-revision` はJSONとして厳密に解析し、任意のHTML内に偶然含まれる40文字のハッシュをcommit SHAとして扱わない。Vercel Authentication等に遮断され `WWW-Authenticate` が返った場合は、bypass設定不足として明示的に失敗する。

### 手動実行

GitHub Actionsの `NOVELIGHT Staging Readiness Smoke` から `workflow_dispatch` を実行し、HTTPSのPreview/Staging URLを指定する。

ローカルから実行する場合は `tests/e2e/` で以下を使用する。

```bash
STAGING_BASE_URL=https://<preview-host> npm run test:staging
```

Deployment Protection対象へローカル実行する場合は `VERCEL_AUTOMATION_BYPASS_SECRET` も安全なローカル環境変数として渡す。

本番URLを指定した場合はconfig側で拒否する。

## 失敗時の証拠

Staging Playwright失敗時は以下を14日間GitHub Actions artifactへ保存する。

- HTML report
- trace
- screenshot
- video
- browser console error
- page error
- failed request
- HTTP 4xx/5xx
- failure時DOM snapshot

まずartifactを確認し、再実行だけで原因を隠さない。

## 独立Stagingへ移行する条件

書き込みE2Eを有効化する前に、以下をすべて満たす。

1. Staging専用Supabase projectを用意する。
2. Staging専用のpublishable key / server-side secretを使う。
3. 本番Supabase project ID、service-role/secret keyをStagingに渡さない。
4. Staging側へ本番と同じmigrationを再現可能な手順で適用する。
5. Stripeはtest modeのみを使用する。
6. Staging専用Price、Webhook secret、Checkout設定を使用する。
7. GitHub `staging` EnvironmentへStaging専用Secretsだけを登録する。
8. E2E用ユーザー・作品・お気に入り・LIGHT SEED等を毎回生成し、`finally` / cleanup stepで削除する。
9. cleanup失敗を成功扱いにしない。
10. production host / production project / live Stripe IDを検出した場合はfail closedする。

### Authenticated smokeの設定場所

Workflow: `.github/workflows/staging-authenticated-smoke.yml`

現行Workflowでは、job開始前に判定・展開する非機密値はGitHub Repository Actions Variablesへ置く。

- `STAGING_E2E_READY`
- `STAGING_BASE_URL`
- `STAGING_SUPABASE_URL`

秘密値はGitHub `staging` Environment Secretsへ置く。

- `STAGING_SUPABASE_SECRET_KEY`
- `STAGING_SUPABASE_PUBLISHABLE_KEY`

Vercel Deployment Protection用の `VERCEL_AUTOMATION_BYPASS_SECRET` はread-only smokeでも利用するため、GitHub Repository Actions Secretとして管理する。

`STAGING_E2E_READY` は独立Stagingが完成するまで未設定または `false` のまま維持する。ほかの値が未完成の状態で先に `true` にしない。

`workflow_dispatch` では `staging_url` を指定すると `STAGING_BASE_URL` を一時的に上書きできる。PRのVercel Preview等を明示的に検証する場合に使用する。

Authenticated smokeも書き込み開始前に `/api/deployment-revision` を確認し、Workflowの `github.sha` と一致しないStaging deploymentでは実行しない。対象ページについてはrevision確認後に到達可能性を確認する。Deployment Protectionが有効な場合はrevision確認、ページ到達確認、Playwrightのすべてで同じautomation bypass secretを使用する。

Vercel Preview/Staging側のServerless APIも本番から分離する。少なくとも以下をPreview/StagingスコープでStaging/Test用に設定し、本番値を流用しない。

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_STANDARD_PRICE_ID`
- `STRIPE_PREMIUM_PRICE_ID`
- 必要に応じて `STRIPE_PORTAL_CONFIGURATION_ID`
- `NOVELIGHT_APP_URL`

ブラウザ側HTMLは現時点で本番Supabase URL/keyを静的保持している。そのためAuthenticated smokeではPlaywrightがページスクリプト実行前にStaging Supabase URL / publishable keyを注入し、ブラウザの `supabase.createClient()` をStagingへ差し替える。

この差し替えはAuthenticated smokeのBrowserContext内だけで有効とし、通常ユーザーがPreviewを開いた場合のアプリ設定を書き換えるものではない。したがって、独立した通常Staging UIが完成するまでは、手動Preview操作を安全な書き込み環境とみなさず、通常のPreview検証はread-only境界を維持する。

Authenticated smokeはログイン後のSupabase auth localStorage keyが指定したStaging project refと一致し、本番project refではないことも確認する。Staging Supabase URLとして本番 `fiepaguycecrredwrcwx.supabase.co` が指定された場合は実行を拒否する。

## 独立Staging完成後の書き込みE2E

以下を順番に自動化する。

1. 新規登録またはテストユーザー作成
2. ログイン
3. 作品作成
4. 第1話公開
5. 別読者で作品閲覧
6. お気に入り
7. LIGHT SEED
8. SCOUT RECORD確認
9. LIGHT ANALYTICS確認
10. Stripe test mode Checkout Session生成（`cs_test_`のみ許可）
11. テストデータcleanup
12. migration postcheck / rollbackの非本番確認

## Go / No-Go

Stagingを通過しただけで本番変更を自動承認しない。

本番反映前には少なくとも以下を確認する。

- CIの最終 `check` が成功
- Staging smoke成功
- 高リスク変更では独立レビュー完了
- DB変更ではprecheck / postcheck / rollbackが確認済み
- 本番用SecretsとStaging用Secretsが混在していない
- 復旧手段がある

本番DB変更、main merge、production write smoke等は既存の承認ポイントを維持する。
